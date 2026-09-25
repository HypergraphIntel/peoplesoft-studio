/**
 * Machine-readable reference-lifecycle evidence generator.
 *
 * Phase 1 tooling for the compiler-semantics research cycle (see
 * .claude/corpus-progress.md). For each requested definition, this pairs:
 *
 *  - the STORED side: every reference-operand token (opcodes 0x21/0x4A/0x48)
 *    decoded from the real PSPCMPROG, in stream order, with its raw 1-based
 *    PSPCMNAME NAMENUM and a derived ALLOC/REUSE decision (ALLOC the first
 *    time a NAMENUM appears in this decode pass, REUSE every time after);
 *
 *  - the GENERATED side: every ReferenceTraceEvent the encoder emits while
 *    encoding the definition's real source text, in source order, already
 *    carrying its own ALLOC/USE decision plus controlGroup/controlDepth/
 *    functionDepth and full reference identity.
 *
 * The two sides are paired positionally (Nth stored reference token vs Nth
 * generated reference event). This is exact for a definition whose
 * source-encode is byte-EXACT, and remains meaningful up to the first
 * disagreement for a non-EXACT definition -- disagreement is itself the
 * evidence. Pairing past a disagreement is not reliable and is emitted with
 * `alignmentTrust: 'lost'` rather than silently trusted.
 *
 * This tool is read-only research infrastructure: it does not change encoder
 * or decoder behavior, and it must always run against the local snapshot.
 *
 * Usage:
 *   tsx tools/corpus/research/reference-lifecycle.ts --definition-id 1521
 *   tsx tools/corpus/research/reference-lifecycle.ts --definition-ids 1521,1423,1424
 *   tsx tools/corpus/research/reference-lifecycle.ts --construct FetchValue --definition-ids ...
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  encodeProgram,
  PeopleCodeReference,
  ReferenceTraceEvent
} from '../../../src/peoplecode/encoder';

import {
  decodeProgram,
  Token
} from '../../../src/peoplecode/decoder';

import {
  NameTable
} from '../../../src/peoplecode/progtext';

import {
  openSnapshotDatabase
} from '../snapshot/store';

import {
  getSnapshotDefinition
} from '../snapshot/reader';

import type {
  SnapshotDefinition
} from '../snapshot/types';

// Reference-operand opcodes; see decoder.ts's Token.nameNum doc comment.
const REFERENCE_OPCODES = new Set([0x21, 0x4a, 0x48]);

// Known intrinsic/statement names whose presence between two occurrences of
// the same reference identity is itself evidence (candidate "epoch
// boundary" triggers per the research directive).
const WATCHED_INTRINSICS = [
  'FetchValue',
  'SetCursorPos',
  'ScrollFlush',
  'ScrollSelect',
  'RowScrollSelectNew',
  'RowScrollSelect',
  'PriorValue',
  'GetRecord',
  'GetRow',
  'GetRowset',
  'ActiveRowCount',
  'UpdateValue',
  'InsertRow',
  'DeleteRow',
  'HideScroll',
  'UnhideScroll',
  'UnhideRow',
  'CopyFields',
  'RecordDeleted',
  'RecordChanged',
  'CreateRecord',
  'CreateRowset',
  'CreateRow'
];

// Same length-preserving masking approach as encoder.ts's own
// maskCommentsAndStringLiteralsForFunctionScan (not exported, so
// reimplemented narrowly here): block comments, double-quoted strings, and
// REM/remark-to-semicolon runs replaced with spaces so a keyword regex scan
// doesn't fire on "If"/"Then"/etc. appearing inside comments or string
// literals. Every offset below still indexes correctly into the real
// source. Not a full PeopleCode lexer -- good enough for keyword-boundary
// branch tracking, not for anything byte-exact.
function maskForBranchScan(source: string): string {
  let masked = '';
  let i = 0;

  while (i < source.length) {
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      masked += ' '.repeat(stop - i);
      i = stop;
    } else if (source[i] === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"') {
        j++;
      }
      j = Math.min(j + 1, source.length);
      masked += ' '.repeat(j - i);
      i = j;
    } else if (/^(rem|remark)\b/i.test(source.slice(i))) {
      const semi = source.indexOf(';', i);
      const stop = semi === -1 ? source.length : semi + 1;
      masked += ' '.repeat(stop - i);
      i = stop;
    } else {
      masked += source[i];
      i++;
    }
  }

  return masked;
}

type BranchFrameType =
  | 'If'
  | 'For'
  | 'While'
  | 'Repeat'
  | 'Evaluate'
  | 'Function'
  | 'Method';

/**
 * Which part of the construct an offset falls in, for the Phase 1A
 * header/body reference-visibility investigation:
 * - 'header': a For/While loop's own `For &i = 1 To N Step S` /
 *   `While <cond>` clause, before the first body statement.
 * - 'condition': an If's condition (before Then), an Evaluate's own
 *   selector expression (before the first When), or a Repeat's trailing
 *   `Until <cond>`.
 * - 'body': everything else inside the frame (loop body, Then/Else body,
 *   When body, Repeat's own body before Until).
 */
type BranchPhase = 'header' | 'condition' | 'body';

interface BranchFrame {
  type: BranchFrameType;
  id: number;
  branch?: string;
  statementCount: number;
  phase: BranchPhase;
  entryOffset: number;
}

interface BranchCheckpoint {
  offset: number;
  branchPath: string;
  blockStatementIndex: number;
  epoch: number;
  controlConstruct: BranchFrameType | 'top';
  controlPhase: BranchPhase | 'top';
  scopeId: number | undefined;
  parentScopeId: number | undefined;
  scopeEntryOffset: number | undefined;
  loopEpochId: number;
}

const BRANCH_KEYWORD_PATTERN = new RegExp(
  '\\b(' +
    [
      'End-If',
      'If',
      'Then',
      'Else',
      'End-For',
      'For',
      'End-While',
      'While',
      'Repeat',
      'Until',
      'End-Evaluate',
      'Evaluate',
      'When-Other',
      'When',
      'End-Function',
      'Function',
      'End-Method',
      'Method'
    ].join('|') +
    ')\\b',
  'gi'
);

const EPOCH_TRIGGER_PATTERN = new RegExp(
  '\\b(' + WATCHED_INTRINSICS.join('|') + ')\\s*\\(',
  'gi'
);

/**
 * A source-order timeline of {offset, branchPath, blockStatementIndex,
 * epoch} checkpoints, one per keyword/statement/epoch-trigger boundary.
 * `lookupBranchState` finds the checkpoint in effect at any given offset.
 * This is heuristic source-text tracking (If/Then/Else/For/While/Evaluate/
 * When/Function/Method nesting plus a semicolon-based statement count and
 * an epoch counter over WATCHED_INTRINSICS calls), not a real parse -- it
 * exists to let sequential-vs-sibling-branch repetition be told apart
 * mechanically when reviewing evidence, not to drive any encoder decision.
 */
function buildBranchTimeline(source: string): BranchCheckpoint[] {
  const masked = maskForBranchScan(source);
  const checkpoints: BranchCheckpoint[] = [];

  // Paren depth at every offset, so a newline inside a wrapped argument
  // list (rare, but present in the corpus) doesn't falsely end a For/While
  // header -- the header ends at the first newline at paren depth 0.
  const parenDepthAt: number[] = new Array(masked.length);
  {
    let depth = 0;
    for (let i = 0; i < masked.length; i++) {
      if (masked[i] === '(') depth++;
      else if (masked[i] === ')') depth--;
      parenDepthAt[i] = depth;
    }
  }

  const frames: BranchFrame[] = [];
  let nextId = 1;
  let epoch = 0;
  let loopEpochId = 0;
  let topLevelStatementCount = 0;

  const renderBranchPath = (): string =>
    frames.length === 0
      ? 'top'
      : frames
          .map(f => `${f.type}#${f.id}${f.branch ? `:${f.branch}` : ''}`)
          .join('>');

  const pushCheckpoint = (offset: number): void => {
    const top = frames[frames.length - 1];
    const parent = frames[frames.length - 2];

    checkpoints.push({
      offset,
      branchPath: renderBranchPath(),
      blockStatementIndex:
        frames.length === 0 ? topLevelStatementCount : top.statementCount,
      epoch,
      controlConstruct: top === undefined ? 'top' : top.type,
      controlPhase: top === undefined ? 'top' : top.phase,
      scopeId: top?.id,
      parentScopeId: parent?.id,
      scopeEntryOffset: top?.entryOffset,
      loopEpochId
    });
  };

  const pushFrame = (
    type: BranchFrameType,
    entryOffset: number,
    phase: BranchPhase
  ): void => {
    frames.push({
      type,
      id: nextId++,
      statementCount: 0,
      phase,
      entryOffset
    });

    if (type === 'For' || type === 'While' || type === 'Repeat') {
      loopEpochId++;
    }
  };

  // Merge keyword, epoch-trigger, and newline events into one source-order
  // pass. Newlines only matter for closing a For/While header (see
  // 'newline' handling below); every other position relies solely on
  // keywords/semicolons.
  type Event = {
    offset: number;
    end: number;
    text: string;
    isEpoch: boolean;
    isNewline: boolean;
  };
  const events: Event[] = [];

  for (const m of masked.matchAll(BRANCH_KEYWORD_PATTERN)) {
    events.push({
      offset: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      text: m[1],
      isEpoch: false,
      isNewline: false
    });
  }

  for (const m of masked.matchAll(EPOCH_TRIGGER_PATTERN)) {
    events.push({
      offset: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      text: m[1],
      isEpoch: true,
      isNewline: false
    });
  }

  // Semicolons (outside comments/strings, already masked) advance the
  // current frame's statement counter.
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === ';') {
      events.push({ offset: i, end: i + 1, text: ';', isEpoch: false, isNewline: false });
    } else if (masked[i] === '\n' && parenDepthAt[i] === 0) {
      events.push({ offset: i, end: i + 1, text: '\n', isEpoch: false, isNewline: true });
    }
  }

  events.sort((a, b) => a.offset - b.offset);

  for (const event of events) {
    if (event.isEpoch) {
      epoch++;
      pushCheckpoint(event.end);
      continue;
    }

    if (event.isNewline) {
      // A For/While header ends at the first paren-depth-0 newline after
      // it opens -- corpus convention keeps these single-line. Once the
      // frame is in 'body' phase this is a no-op (idempotent).
      const top = frames[frames.length - 1];
      if (top !== undefined && (top.type === 'For' || top.type === 'While') && top.phase === 'header') {
        top.phase = 'body';
        pushCheckpoint(event.end);
      }
      continue;
    }

    switch (event.text) {
      case ';': {
        if (frames.length > 0) {
          frames[frames.length - 1].statementCount++;
        } else {
          topLevelStatementCount++;
        }
        pushCheckpoint(event.end);
        break;
      }
      case 'If': {
        pushFrame('If', event.offset, 'condition');
        pushCheckpoint(event.end);
        break;
      }
      case 'Then': {
        const top = frames[frames.length - 1];
        if (top?.type === 'If' && top.branch === undefined) {
          top.branch = 'Then';
          top.phase = 'body';
        }
        pushCheckpoint(event.end);
        break;
      }
      case 'Else': {
        const top = frames[frames.length - 1];
        if (top?.type === 'If') {
          top.branch = 'Else';
          top.statementCount = 0;
          top.phase = 'body';
        }
        pushCheckpoint(event.end);
        break;
      }
      case 'End-If': {
        if (frames[frames.length - 1]?.type === 'If') frames.pop();
        pushCheckpoint(event.end);
        break;
      }
      case 'For': {
        pushFrame('For', event.offset, 'header');
        pushCheckpoint(event.end);
        break;
      }
      case 'End-For': {
        if (frames[frames.length - 1]?.type === 'For') frames.pop();
        pushCheckpoint(event.end);
        break;
      }
      case 'While': {
        pushFrame('While', event.offset, 'header');
        pushCheckpoint(event.end);
        break;
      }
      case 'End-While': {
        if (frames[frames.length - 1]?.type === 'While') frames.pop();
        pushCheckpoint(event.end);
        break;
      }
      case 'Repeat': {
        // Repeat's body comes FIRST, its own condition (Until <cond>) comes
        // last with no separate End-Repeat -- the statement after Until's
        // condition closes the frame (handled in the ';' case below via
        // pendingRepeatClose, since Until doesn't have a distinct closing
        // keyword of its own).
        pushFrame('Repeat', event.offset, 'body');
        pushCheckpoint(event.end);
        break;
      }
      case 'Until': {
        const top = frames[frames.length - 1];
        if (top?.type === 'Repeat') {
          top.phase = 'condition';
        }
        pushCheckpoint(event.end);
        break;
      }
      case 'Evaluate': {
        pushFrame('Evaluate', event.offset, 'condition');
        pushCheckpoint(event.end);
        break;
      }
      case 'When':
      case 'When-Other': {
        const top = frames[frames.length - 1];
        if (top?.type === 'Evaluate') {
          const whenIndex =
            (Number(top.branch?.replace(/^When/, '')) || 0) + 1;
          top.branch =
            event.text === 'When-Other'
              ? 'WhenOther'
              : `When${whenIndex}`;
          top.statementCount = 0;
          top.phase = 'body';
        }
        pushCheckpoint(event.end);
        break;
      }
      case 'End-Evaluate': {
        if (frames[frames.length - 1]?.type === 'Evaluate') frames.pop();
        pushCheckpoint(event.end);
        break;
      }
      case 'Function': {
        // "Declare Function NAME PeopleCode RECORD.FIELD EVENT;" is a
        // single-statement declaration, not a block -- it has no matching
        // End-Function. Pushing a frame for it would never get popped,
        // corrupting every branchPath after it for the rest of the
        // definition (confirmed against definition 1420, which opens with
        // four Declare Function headers and produced a phantom
        // Function#1>Function#2>Function#3>Function#4 nesting before this
        // fix). Only a real `Function NAME(...) ... End-Function;` block
        // header opens a frame.
        const precedingText = masked
          .slice(Math.max(0, event.offset - 20), event.offset);
        const isDeclareFunction = /\bDeclare\s+$/i.test(precedingText);

        if (!isDeclareFunction) {
          pushFrame('Function', event.offset, 'body');
        }
        pushCheckpoint(event.end);
        break;
      }
      case 'End-Function': {
        if (frames[frames.length - 1]?.type === 'Function') frames.pop();
        pushCheckpoint(event.end);
        break;
      }
      case 'Method': {
        pushFrame('Method', event.offset, 'body');
        pushCheckpoint(event.end);
        break;
      }
      case 'End-Method': {
        if (frames[frames.length - 1]?.type === 'Method') frames.pop();
        pushCheckpoint(event.end);
        break;
      }
    }

    // Repeat has no End-Repeat: the statement immediately following its
    // own Until <condition> closes the frame. Handle it after the ';'
    // case's own statementCount bump above so the closing ';' itself still
    // counts as part of the Repeat frame's last statement.
    if (event.text === ';') {
      const top = frames[frames.length - 1];
      if (top?.type === 'Repeat' && top.phase === 'condition') {
        frames.pop();
      }
    }
  }

  return checkpoints;
}

function lookupBranchState(
  timeline: BranchCheckpoint[],
  offset: number
): {
  branchPath: string;
  blockStatementIndex: number;
  epoch: number;
  controlConstruct: BranchFrameType | 'top';
  controlPhase: BranchPhase | 'top';
  scopeId: number | undefined;
  parentScopeId: number | undefined;
  scopeEntryOffset: number | undefined;
  loopEpochId: number;
} {
  // Checkpoints are sorted by offset (built in source order); find the
  // last one at or before `offset` via binary search.
  let lo = 0;
  let hi = timeline.length - 1;
  let result: BranchCheckpoint | undefined;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].offset <= offset) {
      result = timeline[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return result === undefined
    ? {
        branchPath: 'top',
        blockStatementIndex: -1,
        epoch: 0,
        controlConstruct: 'top',
        controlPhase: 'top',
        scopeId: undefined,
        parentScopeId: undefined,
        scopeEntryOffset: undefined,
        loopEpochId: 0
      }
    : {
        branchPath: result.branchPath,
        blockStatementIndex: result.blockStatementIndex,
        epoch: result.epoch,
        controlConstruct: result.controlConstruct,
        controlPhase: result.controlPhase,
        scopeId: result.scopeId,
        parentScopeId: result.parentScopeId,
        scopeEntryOffset: result.scopeEntryOffset,
        loopEpochId: result.loopEpochId
      };
}

export interface StoredOccurrence {
  occurrenceIndex: number;
  opcode: number;
  nameNum: number;
  resolvedName: string;
  byteOffset: number;
  decision: 'ALLOC' | 'REUSE';
  firstOccurrenceOfThisNameNum: number;
}

export interface GeneratedOccurrence {
  occurrenceIndex: number;
  /**
   * ALLOC the first time this reference's sequence is emitted as an
   * operand, REUSE every time after -- derived from the trace's 'USE'
   * events only (one per real emitted operand). The trace's own 'ALLOC'
   * events are internal bookkeeping (a reference object was just created)
   * that fire immediately before the matching first 'USE' at the same
   * source position; including them would double-count every first
   * occurrence against the stored side, which emits exactly one token per
   * occurrence either way.
   */
  decision: 'ALLOC' | 'REUSE';
  sequence: number;
  index: number;
  kind: PeopleCodeReference['kind'];
  identityKey: string;
  recordName?: string;
  fieldName?: string;
  eventName?: string;
  packageName?: string;
  objectName?: string;
  packagePath?: string[];
  className?: string;
  methodName?: string;
  controlGroup: number;
  controlDepth: number;
  functionDepth: number;
  sourceOffset: number;
  sourceContext: string;
  enclosingCall?: string;
  argumentPosition?: number;
  previousMatchingOccurrence?: number;
  previousMatchingDecision?: 'ALLOC' | 'REUSE';
  sourceOffsetSinceLastMatch?: string;
  interveningIntrinsics: string[];
  /**
   * Heuristic source-text branch path (e.g. "If#3:Then", "Evaluate#1:When2",
   * "Function#2>If#5:Else") from buildBranchTimeline/lookupBranchState --
   * NOT derived from the encoder's own controlGroup/controlDepth, so it can
   * distinguish two occurrences the encoder currently treats identically
   * (e.g. same controlGroup, same controlDepth) but which sit in mutually
   * exclusive branches vs. the same straight-line flow.
   */
  branchPath: string;
  /** Statement position within the innermost branchPath frame (heuristic, semicolon-counted), or at top level when branchPath is "top". */
  blockStatementIndex: number;
  /** Count of WATCHED_INTRINSICS calls textually before this occurrence -- a candidate "reference epoch" counter, independent of branchPath/controlGroup. */
  epochCandidate: number;
  /** Innermost enclosing construct type, or 'top'. Phase 1A field. */
  controlConstruct: BranchFrameType | 'top';
  /**
   * Which part of the innermost construct this occurrence sits in --
   * 'header' (For/While's own bound clause), 'condition' (If's condition,
   * Evaluate's selector, Repeat's trailing Until), 'body', or 'top'. Phase
   * 1A field: lets a header-vs-body reference-visibility hypothesis be
   * tested mechanically instead of by re-reading source for every case.
   */
  controlPhase: BranchPhase | 'top';
  /** Innermost frame's own id (undefined at top level). Phase 1A field. */
  scopeId?: number;
  /** The innermost frame's PARENT frame id (undefined if innermost is top-level, or if at top level). Phase 1A field. */
  parentScopeId?: number;
  /** Source offset where the innermost frame was entered (the construct's own opening keyword). Phase 1A field. */
  scopeEntryOffset?: number;
  /** Count of For/While/Repeat frames entered so far -- a candidate "loop epoch" counter, distinct from epochCandidate (which counts WATCHED_INTRINSICS calls). Phase 1A field, for testing hypothesis B (loop body entry opens a new reference epoch). */
  loopEpochId: number;
}

export interface PairedRow {
  occurrenceIndex: number;
  stored?: StoredOccurrence;
  generated?: GeneratedOccurrence;
  namenumSequenceAgree?: boolean;
  decisionAgree?: boolean;
  alignmentTrust: 'aligned' | 'lost';
}

export interface DefinitionEvidence {
  definitionId: number;
  displayName: string;
  sourceEncodeError?: {
    message: string;
  };
  storedOccurrenceCount: number;
  generatedOccurrenceCount: number;
  firstDisagreementOccurrence?: number;
  rows: PairedRow[];
}

function referenceIdentityKey(reference: PeopleCodeReference): string {
  return [
    reference.kind,
    reference.recordName ?? '',
    reference.fieldName ?? '',
    reference.eventName ?? '',
    reference.packageName ?? '',
    reference.objectName ?? '',
    (reference.packagePath ?? []).join(':'),
    reference.className ?? '',
    reference.methodName ?? ''
  ].join('|');
}

function sourceWindow(source: string, offset: number, radius = 60): string {
  if (!Number.isInteger(offset) || offset < 0) {
    return '';
  }

  const start = Math.max(0, offset - radius);
  const end = Math.min(source.length, offset + radius);

  return source
    .slice(start, end)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

/**
 * Best-effort: the nearest `Identifier(` opening a call that encloses
 * `offset`, scanning backward. Heuristic, not a real parse -- good enough to
 * label evidence rows for a human/LLM reviewer, not to drive any decision.
 */
function enclosingCall(
  source: string,
  offset: number
): { name: string; openParenIndex: number } | undefined {
  const window = source.slice(Math.max(0, offset - 400), offset);
  const matches = [...window.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)];

  if (matches.length === 0) {
    return undefined;
  }

  const last = matches[matches.length - 1];
  const windowStart = Math.max(0, offset - 400);
  const openParenIndex = windowStart + (last.index ?? 0) + last[0].length - 1;

  return { name: last[1], openParenIndex };
}

/**
 * Best-effort top-level (paren-depth-0-relative-to-the-call) argument index
 * between `openParenIndex` and `offset`. Heuristic: does not understand
 * string literals containing commas/parens, which is rare in this corpus's
 * argument position but not impossible.
 */
function argumentPosition(
  source: string,
  openParenIndex: number,
  offset: number
): number | undefined {
  if (offset <= openParenIndex) {
    return undefined;
  }

  let depth = 0;
  let position = 0;

  for (let i = openParenIndex + 1; i < offset; i++) {
    const ch = source[i];

    if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      position++;
    }
  }

  return position;
}

function decodeStoredOccurrences(
  tokens: Token[]
): StoredOccurrence[] {
  const seen = new Map<number, number>();
  const occurrences: StoredOccurrence[] = [];

  let occurrenceIndex = 0;

  for (const token of tokens) {
    if (!REFERENCE_OPCODES.has(token.opcode) || token.nameNum === undefined) {
      continue;
    }

    const firstOccurrence = seen.get(token.nameNum);
    const decision: 'ALLOC' | 'REUSE' =
      firstOccurrence === undefined ? 'ALLOC' : 'REUSE';

    if (firstOccurrence === undefined) {
      seen.set(token.nameNum, occurrenceIndex);
    }

    occurrences.push({
      occurrenceIndex,
      opcode: token.opcode,
      nameNum: token.nameNum,
      resolvedName: token.text,
      byteOffset: token.offset,
      decision,
      firstOccurrenceOfThisNameNum: firstOccurrence ?? occurrenceIndex
    });

    occurrenceIndex++;
  }

  return occurrences;
}

function findInterveningIntrinsics(
  source: string,
  fromOffset: number,
  toOffset: number
): string[] {
  if (toOffset <= fromOffset) {
    return [];
  }

  const between = source.slice(fromOffset, toOffset);
  const found = new Set<string>();

  for (const name of WATCHED_INTRINSICS) {
    const pattern = new RegExp(`\\b${name}\\s*\\(`, 'i');
    if (pattern.test(between)) {
      found.add(name);
    }
  }

  return [...found];
}

function decodeGeneratedOccurrences(
  source: string,
  events: ReferenceTraceEvent[]
): GeneratedOccurrence[] {
  // Every real operand emission fires a 'USE' trace event, whether the
  // reference was just allocated or is being reused; a fresh reference
  // additionally fires a bookkeeping 'ALLOC' event immediately before that
  // same 'USE', which would double-count the occurrence if kept. See
  // encoder.ts's nextReference()/referenceOperand(): the former fires ALLOC
  // when a PeopleCodeReference is created, the latter fires USE every time
  // that reference's index is actually written to the output, including
  // the write that happens right after creation.
  const useEvents = events.filter(event => event.action === 'USE');

  const seenSequence = new Set<number>();

  const lastByIdentity = new Map<
    string,
    { occurrenceIndex: number; decision: 'ALLOC' | 'REUSE'; sourceOffset: number }
  >();

  const branchTimeline = buildBranchTimeline(source);

  const occurrences: GeneratedOccurrence[] = [];

  useEvents.forEach((event, occurrenceIndex) => {
    const reference = event.reference;
    const identityKey = referenceIdentityKey(reference);

    const decision: 'ALLOC' | 'REUSE' = seenSequence.has(reference.sequence)
      ? 'REUSE'
      : 'ALLOC';
    seenSequence.add(reference.sequence);

    const call = enclosingCall(source, event.sourceOffset);

    const previous = lastByIdentity.get(identityKey);

    const branchState = lookupBranchState(branchTimeline, event.sourceOffset);

    const row: GeneratedOccurrence = {
      occurrenceIndex,
      decision,
      sequence: reference.sequence,
      index: reference.index,
      kind: reference.kind,
      identityKey,
      recordName: reference.recordName,
      fieldName: reference.fieldName,
      eventName: reference.eventName,
      packageName: reference.packageName,
      objectName: reference.objectName,
      packagePath: reference.packagePath,
      className: reference.className,
      methodName: reference.methodName,
      controlGroup: event.controlGroup,
      controlDepth: event.controlDepth,
      functionDepth: event.functionDepth,
      sourceOffset: event.sourceOffset,
      sourceContext: sourceWindow(source, event.sourceOffset),
      enclosingCall: call?.name,
      argumentPosition:
        call === undefined
          ? undefined
          : argumentPosition(source, call.openParenIndex, event.sourceOffset),
      previousMatchingOccurrence: previous?.occurrenceIndex,
      previousMatchingDecision: previous?.decision,
      interveningIntrinsics:
        previous === undefined
          ? []
          : findInterveningIntrinsics(
              source,
              previous.sourceOffset,
              event.sourceOffset
            ),
      branchPath: branchState.branchPath,
      blockStatementIndex: branchState.blockStatementIndex,
      epochCandidate: branchState.epoch,
      controlConstruct: branchState.controlConstruct,
      controlPhase: branchState.controlPhase,
      scopeId: branchState.scopeId,
      parentScopeId: branchState.parentScopeId,
      scopeEntryOffset: branchState.scopeEntryOffset,
      loopEpochId: branchState.loopEpochId
    };

    occurrences.push(row);

    lastByIdentity.set(identityKey, {
      occurrenceIndex,
      decision,
      sourceOffset: event.sourceOffset
    });
  });

  return occurrences;
}

function pairOccurrences(
  stored: StoredOccurrence[],
  generated: GeneratedOccurrence[]
): { rows: PairedRow[]; firstDisagreementOccurrence?: number } {
  const rows: PairedRow[] = [];
  let alignmentTrust: 'aligned' | 'lost' = 'aligned';
  let firstDisagreementOccurrence: number | undefined;

  const count = Math.max(stored.length, generated.length);

  for (let i = 0; i < count; i++) {
    const s = stored[i];
    const g = generated[i];

    const namenumSequenceAgree =
      s !== undefined && g !== undefined
        ? s.nameNum === g.sequence
        : undefined;

    const decisionAgree =
      s !== undefined && g !== undefined
        ? s.decision === g.decision
        : undefined;

    if (
      alignmentTrust === 'aligned' &&
      (decisionAgree === false || namenumSequenceAgree === false)
    ) {
      firstDisagreementOccurrence = i;
      // The row that first disagrees is still reported as 'aligned' (it IS
      // the evidence); everything after it is untrustworthy positionally.
      rows.push({
        occurrenceIndex: i,
        stored: s,
        generated: g,
        namenumSequenceAgree,
        decisionAgree,
        alignmentTrust
      });
      alignmentTrust = 'lost';
      continue;
    }

    rows.push({
      occurrenceIndex: i,
      stored: s,
      generated: g,
      namenumSequenceAgree,
      decisionAgree,
      alignmentTrust
    });
  }

  return { rows, firstDisagreementOccurrence };
}

function buildNameTable(definition: SnapshotDefinition): NameTable {
  const names = new NameTable();

  for (const row of definition.names) {
    const recname = String(row.recname ?? '').trim();
    const refname = String(row.refname ?? '').trim();

    let name: string;

    if (recname && refname) {
      name = `${recname}.${refname}`;
    } else if (refname) {
      name = refname;
    } else {
      name = recname;
    }

    names.add(Number(row.namenum), name);
  }

  return names;
}

export function generateEvidence(
  definitionId: number,
  definition: SnapshotDefinition
): DefinitionEvidence {
  const names = buildNameTable(definition);

  const decoded = decodeProgram(definition.storedProgram, names, {
    mode: 'auto'
  });

  const stored = decodeStoredOccurrences(decoded.tokens);

  const events: ReferenceTraceEvent[] = [];

  let sourceEncodeError: { message: string } | undefined;

  // Match validator.ts's real corpus-harness behavior: the owning
  // record/field always comes from the definition's own key
  // (objectvalue1/objectvalue2), never inferred from source text. Omitting
  // this would make every bare owner-record.field reference look like a
  // spurious ALLOC-vs-USE disagreement that has nothing to do with real
  // encoder behavior.
  try {
    encodeProgram(definition.sourceText, {
      owner: {
        recordName: definition.objectvalue1.trim(),
        fieldName: definition.objectvalue2.trim()
      },
      referenceTrace: event => events.push(event)
    });
  } catch (error) {
    sourceEncodeError = {
      message: error instanceof Error ? error.message : String(error)
    };
  }

  const generated = decodeGeneratedOccurrences(definition.sourceText, events);

  const { rows, firstDisagreementOccurrence } = pairOccurrences(
    stored,
    generated
  );

  return {
    definitionId,
    displayName: definition.displayName,
    sourceEncodeError,
    storedOccurrenceCount: stored.length,
    generatedOccurrenceCount: generated.length,
    firstDisagreementOccurrence,
    rows
  };
}

interface CliOptions {
  definitionIds: number[];
  construct?: string;
  outDir: string;
}

function parseArgs(argv: string[]): CliOptions {
  const definitionIds: number[] = [];
  let construct: string | undefined;
  let outDir = path.join(
    __dirname,
    '..',
    'reports',
    'reference-lifecycle'
  );

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--definition-id') {
      definitionIds.push(Number(argv[++i]));
    } else if (arg === '--definition-ids') {
      for (const raw of argv[++i].split(',')) {
        definitionIds.push(Number(raw.trim()));
      }
    } else if (arg === '--construct') {
      construct = argv[++i];
    } else if (arg === '--out') {
      outDir = argv[++i];
    }
  }

  if (definitionIds.length === 0) {
    throw new Error(
      'Usage: reference-lifecycle.ts --definition-id <id> | --definition-ids <id,id,...> [--construct <name>] [--out <dir>]'
    );
  }

  return { definitionIds, construct, outDir };
}

function summarizeConsole(evidence: DefinitionEvidence): void {
  console.log(
    `definition ${evidence.definitionId} (${evidence.displayName}): ` +
      `stored=${evidence.storedOccurrenceCount} generated=${evidence.generatedOccurrenceCount}` +
      (evidence.sourceEncodeError
        ? ` ENCODE_ERROR: ${evidence.sourceEncodeError.message}`
        : '')
  );

  if (evidence.firstDisagreementOccurrence !== undefined) {
    const row = evidence.rows[evidence.firstDisagreementOccurrence];

    console.log(
      `  first disagreement @ occurrence ${row.occurrenceIndex}: ` +
        `stored=${row.stored ? `${row.stored.decision} nameNum=${row.stored.nameNum} "${row.stored.resolvedName}"` : '(none)'} ` +
        `generated=${row.generated ? `${row.generated.decision} seq=${row.generated.sequence} kind=${row.generated.kind} call=${row.generated.enclosingCall ?? '?'} arg#${row.generated.argumentPosition ?? '?'} branch=${row.generated.branchPath} stmt#${row.generated.blockStatementIndex} epoch=${row.generated.epochCandidate} prevMatch@${row.generated.previousMatchingOccurrence ?? 'none'}(${row.generated.previousMatchingDecision ?? '-'}) intervening=[${row.generated.interveningIntrinsics.join(',')}]` : '(none)'}`
    );

    if (row.generated) {
      console.log(`  source: ${row.generated.sourceContext}`);
    }
  } else {
    console.log('  stored/generated decisions agree at every paired occurrence.');
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  const db = openSnapshotDatabase();

  fs.mkdirSync(options.outDir, { recursive: true });

  const summary: {
    construct?: string;
    generatedAt: string;
    definitions: {
      definitionId: number;
      displayName: string;
      storedOccurrenceCount: number;
      generatedOccurrenceCount: number;
      firstDisagreementOccurrence?: number;
      encodeError?: string;
    }[];
  } = {
    construct: options.construct,
    generatedAt: new Date().toISOString(),
    definitions: []
  };

  for (const definitionId of options.definitionIds) {
    const definition = getSnapshotDefinition(db, definitionId);
    const evidence = generateEvidence(definitionId, definition);

    summarizeConsole(evidence);

    const outFile = path.join(options.outDir, `${definitionId}.json`);
    fs.writeFileSync(outFile, JSON.stringify(evidence, null, 2));

    summary.definitions.push({
      definitionId,
      displayName: evidence.displayName,
      storedOccurrenceCount: evidence.storedOccurrenceCount,
      generatedOccurrenceCount: evidence.generatedOccurrenceCount,
      firstDisagreementOccurrence: evidence.firstDisagreementOccurrence,
      encodeError: evidence.sourceEncodeError?.message
    });
  }

  const summaryFile = path.join(
    options.outDir,
    options.construct
      ? `_summary-${options.construct}.json`
      : '_summary.json'
  );

  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

  console.log(`\nWrote ${options.definitionIds.length} evidence file(s) and summary to ${options.outDir}`);

  db.close();
}

// Only run the CLI when this file is the entry point, not when another
// script (e.g. getrecord-branch-analysis.ts) imports generateEvidence from
// it -- otherwise the import alone would re-parse process.argv and run a
// second, redundant CLI pass as a side effect.
if (require.main === module) {
  main();
}
