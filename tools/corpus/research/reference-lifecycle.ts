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

interface StoredOccurrence {
  occurrenceIndex: number;
  opcode: number;
  nameNum: number;
  resolvedName: string;
  byteOffset: number;
  decision: 'ALLOC' | 'REUSE';
  firstOccurrenceOfThisNameNum: number;
}

interface GeneratedOccurrence {
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
}

interface PairedRow {
  occurrenceIndex: number;
  stored?: StoredOccurrence;
  generated?: GeneratedOccurrence;
  namenumSequenceAgree?: boolean;
  decisionAgree?: boolean;
  alignmentTrust: 'aligned' | 'lost';
}

interface DefinitionEvidence {
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
            )
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

function generateEvidence(
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
        `generated=${row.generated ? `${row.generated.decision} seq=${row.generated.sequence} kind=${row.generated.kind} call=${row.generated.enclosingCall ?? '?'} arg#${row.generated.argumentPosition ?? '?'} prevMatch@${row.generated.previousMatchingOccurrence ?? 'none'}(${row.generated.previousMatchingDecision ?? '-'}) intervening=[${row.generated.interveningIntrinsics.join(',')}]` : '(none)'}`
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

main();
