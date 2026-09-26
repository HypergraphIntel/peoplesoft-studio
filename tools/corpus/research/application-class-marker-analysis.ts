/**
 * Cycle 24: Application Class comment/blank-line/structural-marker census.
 *
 * Read-only. Uses completed full-corpus result rows plus the completed local
 * HCDEV snapshot. It never connects to Oracle and never writes corpus state.
 *
 * Usage:
 *   npx tsx tools/corpus/research/application-class-marker-analysis.ts
 *   npx tsx tools/corpus/research/application-class-marker-analysis.ts --json
 */

import Database from 'better-sqlite3';

import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { decodeProgram, TokenKind, type Token } from '../../../src/peoplecode/decoder';
import { encodeProgramArtifacts, type PeopleCodeOwner } from '../../../src/peoplecode/encoder';
import { PROGRAM_HEADER_LENGTH, readProgramLayout, type ProgramLayout } from '../../../src/peoplecode/programLayout';
import { NameTable } from '../../../src/peoplecode/progtext';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';
import type { SnapshotDefinition } from '../snapshot/types';

const TOTAL_CORPUS = 30_209;
const APPLICATION_CLASS_OBJECT_ID = 104;

type RootFamily =
  | 'comment placement'
  | 'missing 0x4F'
  | 'extra 0x4F'
  | 'extra 0x2D';

type ByteRegion =
  | 'before class/interface header'
  | 'inside class declaration section'
  | 'after end-class/end-interface'
  | 'before implementation wrapper'
  | 'inside implementation wrapper/body'
  | 'between implementations'
  | 'before final [0x2D] 0x07'
  | 'unavailable';

type CommentKind = 'block' | 'REM' | 'disabled' | 'signature' | 'line';

interface RunInfo {
  runId: number;
  gitCommit: string;
  exactCount: number;
  appClassEncodeSuccess: number;
}

interface ResultRow {
  definitionId: number;
  classification: string;
  sourceEncodeSuccess: boolean;
  sourceEncodeExact: boolean;
  firstDiffOffset?: number;
  generatedSha256?: string;
  storedDiffHex?: string;
  generatedDiffHex?: string;
}

interface SemanticDiff {
  section: 'header' | 'statements' | 'names' | 'records' | 'slots' | 'none';
  relativeOffset?: number;
  storedAbsoluteOffset?: number;
  generatedAbsoluteOffset?: number;
  storedByte?: number;
  generatedByte?: number;
  storedWindow?: string;
  generatedWindow?: string;
}

interface SourceComment {
  kind: CommentKind;
  start: number;
  end: number;
  raw: string;
  payload: string;
  blankLinesBefore: number;
  blankLinesAfter: number;
}

interface ProgramRegions {
  region: ByteRegion;
  previousToken?: string;
  nextToken?: string;
  nextOpcode?: number;
  nextText?: string;
  nearestCommentOpcode?: number;
  nearestCommentText?: string;
  implementationIndex?: number;
  implementationCount: number;
}

interface CensusRow {
  definitionId: number;
  displayName: string;
  source: string;
  rootFamily: RootFamily;
  classification: string;
  firstSemanticDifference: SemanticDiff;
  sourceContext: string;
  sourceOffset: number;
  sourceLine: number;
  enclosingRegion: ByteRegion;
  previousConstruct?: string;
  nextConstruct?: string;
  commentKind?: CommentKind;
  commentOpcode?: string;
  commentPayload?: string;
  blankLinesBefore: number;
  blankLinesAfter: number;
  implementationIndex?: number;
  implementationCount: number;
  applicationClassShape: string;
  storedStatementWindow: string;
  generatedStatementWindow: string;
  markerMultiplicity: number;
  sourceGapBlankLines?: number;
  mechanism: string;
  disposition: 'FULLY_EXPLAINED' | 'PARTIALLY_EXPLAINED' | 'UNRELATED_ROOT_DISCOVERED' | 'UNRESOLVED';
  layoutProjectionExact: boolean;
  predictedNextBlocker: string;
}

interface CommentObservation {
  definitionId: number;
  kind: CommentKind;
  location: string;
  opcode: string;
  inlineAfterCode: boolean;
  followsTerminator: boolean;
  precedesCodeOnLine: boolean;
  blankLinesBefore: number;
  blankLinesAfter: number;
  consecutive: boolean;
  storedMarkersBefore: number;
  storedMarkersAfter: number;
  hasCompiledReferences: boolean;
  payload: string;
}

interface BodyGapObservation {
  definitionId: number;
  implementationIndex: number;
  implementationKind: string;
  sourceLeadingBlankLines: number;
  storedLeadingMarkers: number;
  sourceTrailingBlankLines: number;
  storedTrailingMarkers: number;
  bodyKind: 'empty' | 'comment-only' | 'nonempty';
  hasCompiledReferences: boolean;
}

function ownerContext(definition: SnapshotDefinition): PeopleCodeOwner {
  const values = [
    definition.objectvalue1, definition.objectvalue2, definition.objectvalue3,
    definition.objectvalue4, definition.objectvalue5, definition.objectvalue6,
    definition.objectvalue7
  ].map(value => value.trim());
  const eventIndex = values.findIndex(value => value.toLowerCase() === 'onexecute');
  return {
    recordName: values[0],
    fieldName: values[1],
    packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean)
  };
}

function firstDifference(a: Buffer, b: Buffer): number | undefined {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index++) if (a[index] !== b[index]) return index;
  return a.length === b.length ? undefined : shared;
}

function hexWindow(bytes: Buffer, offset: number, radius = 16): string {
  const start = Math.max(0, offset - radius);
  const end = Math.min(bytes.length, offset + radius + 1);
  return bytes.subarray(start, end).toString('hex').replace(/(..)/g, '$1 ').trim();
}

function section(bytes: Buffer, layout: ProgramLayout, name: 'statements' | 'names' | 'records' | 'slots'): Buffer {
  const target = layout[name];
  return bytes.subarray(target.offset, target.offset + target.byteLength);
}

function meaningfulDiff(stored: Buffer, generated: Buffer): SemanticDiff {
  let storedLayout: ProgramLayout;
  let generatedLayout: ProgramLayout;
  try {
    storedLayout = readProgramLayout(stored);
    generatedLayout = readProgramLayout(generated);
  } catch {
    const offset = firstDifference(stored, generated);
    return { section: 'header', relativeOffset: offset };
  }
  for (const name of ['statements', 'names', 'records', 'slots'] as const) {
    const a = section(stored, storedLayout, name);
    const b = section(generated, generatedLayout, name);
    const offset = firstDifference(a, b);
    if (offset === undefined) continue;
    return {
      section: name,
      relativeOffset: offset,
      storedAbsoluteOffset: storedLayout[name].offset + offset,
      generatedAbsoluteOffset: generatedLayout[name].offset + offset,
      storedByte: a[offset],
      generatedByte: b[offset],
      storedWindow: hexWindow(a, offset),
      generatedWindow: hexWindow(b, offset)
    };
  }
  return { section: 'none' };
}

function classifyRoot(diff: SemanticDiff): RootFamily | undefined {
  if (diff.section !== 'statements') return undefined;
  if (diff.storedByte === 0x4f) return 'missing 0x4F';
  if (diff.generatedByte === 0x4f) return 'extra 0x4F';
  if (diff.generatedByte === 0x2d) return 'extra 0x2D';
  if ([0x24, 0x4e].includes(diff.storedByte ?? -1) || [0x24, 0x4e].includes(diff.generatedByte ?? -1)) {
    return 'comment placement';
  }
  return undefined;
}

function storedNameTable(definition: SnapshotDefinition): NameTable {
  const names = new NameTable();
  for (const row of definition.names) {
    const record = row.recname.trim();
    const reference = row.refname.trim();
    names.add(row.namenum, record && reference ? `${record}.${reference}` : reference || record || `<${row.namenum}>`);
  }
  return names;
}

function tokenLabel(token: Token | undefined): string | undefined {
  if (!token) return undefined;
  return `${token.text || '(empty)'} @${token.offset} [0x${token.opcode.toString(16).padStart(2, '0')}]`;
}

function programRegion(
  definition: SnapshotDefinition,
  byteOffset: number
): ProgramRegions {
  try {
    const layout = readProgramLayout(definition.storedProgram);
    const statementEnd = layout.statements.offset + layout.statements.byteLength;
    const tokens = decodeProgram(definition.storedProgram, storedNameTable(definition), {
      mode: 'auto', isApplicationClass: true
    }).tokens.filter(token => token.offset >= layout.statements.offset && token.offset < statementEnd);
    const classIndex = tokens.findIndex(token => token.opcode === 0x5a || token.opcode === 0x70);
    const closeIndex = tokens.findIndex((token, index) => index > classIndex && (token.opcode === 0x5b || token.opcode === 0x71));
    if (classIndex < 0 || closeIndex < 0) return { region: 'unavailable', implementationCount: 0 };
    const implementations = tokens
      .map((token, index) => ({ token, index }))
      .filter(({ token, index }) =>
        index > closeIndex && [0x63, 0x5f, 0x49].includes(token.opcode) &&
        definition.storedProgram[token.offset + 1] === 0x41
      );
    const closers = tokens
      .map((token, index) => ({ token, index }))
      .filter(({ token, index }) => index > closeIndex && [0x64, 0x6a, 0x6b].includes(token.opcode));
    let previous = tokens[0];
    let next: Token | undefined;
    for (const token of tokens) {
      if (token.offset > byteOffset) { next = token; break; }
      previous = token;
    }
    const comment = [...tokens]
      .sort((a, b) => Math.abs(a.offset - byteOffset) - Math.abs(b.offset - byteOffset))
      .find(token => token.kind === TokenKind.Comment);

    let region: ByteRegion;
    let implementationIndex: number | undefined;
    if (byteOffset < tokens[classIndex].offset) region = 'before class/interface header';
    else if (byteOffset < tokens[closeIndex].offset) region = 'inside class declaration section';
    else if (implementations.length === 0) region = 'before final [0x2D] 0x07';
    else if (byteOffset < implementations[0].token.offset) {
      region = byteOffset <= tokens[closeIndex].offset + 1
        ? 'after end-class/end-interface'
        : 'before implementation wrapper';
    } else {
      const containing = implementations.findIndex(({ token }, index) => {
        const closer = closers[index]?.token;
        return byteOffset >= token.offset && byteOffset <= (closer?.offset ?? statementEnd);
      });
      if (containing >= 0) {
        region = 'inside implementation wrapper/body';
        implementationIndex = containing;
      } else {
        const nextImplementation = implementations.findIndex(({ token }) => token.offset > byteOffset);
        if (nextImplementation >= 0) {
          region = 'between implementations';
          implementationIndex = nextImplementation - 1;
        } else {
          region = 'before final [0x2D] 0x07';
          implementationIndex = implementations.length - 1;
        }
      }
    }
    return {
      region,
      previousToken: tokenLabel(previous),
      nextToken: tokenLabel(next),
      nextOpcode: next?.opcode,
      nextText: next?.text,
      nearestCommentOpcode: comment?.opcode,
      nearestCommentText: comment?.text,
      implementationIndex,
      implementationCount: implementations.length
    };
  } catch {
    return { region: 'unavailable', implementationCount: 0 };
  }
}

function adjacentBlankLines(source: string, start: number, direction: -1 | 1): number {
  let index = direction < 0 ? start - 1 : start;
  let newlines = 0;
  while (index >= 0 && index < source.length) {
    const char = source[index];
    if (char === ' ' || char === '\t' || char === '\r') { index += direction; continue; }
    if (char === '\n') { newlines++; index += direction; continue; }
    break;
  }
  return Math.max(0, newlines - 1);
}

function commentPayload(raw: string, kind: CommentKind): string {
  if (kind === 'block') return raw.slice(2, -2);
  if (kind === 'disabled') return raw.slice(2, -2);
  if (kind === 'signature') return raw.slice(2, -2);
  if (kind === 'line') return raw.slice(2);
  return raw.replace(/^\s*REM\b/i, '').replace(/;\s*$/, '');
}

function scanComments(source: string): SourceComment[] {
  const comments: SourceComment[] = [];
  let index = 0;
  while (index < source.length) {
    if (source[index] === '"' || source[index] === "'") {
      const quote = source[index++];
      while (index < source.length) {
        if (source[index] !== quote) { index++; continue; }
        if (source[index + 1] === quote) { index += 2; continue; }
        index++;
        break;
      }
      continue;
    }
    let kind: CommentKind | undefined;
    let end = index;
    if (source.startsWith('/*', index)) { kind = 'block'; end = source.indexOf('*/', index + 2); end = end < 0 ? source.length : end + 2; }
    else if (source.startsWith('<*', index)) { kind = 'disabled'; end = source.indexOf('*>', index + 2); end = end < 0 ? source.length : end + 2; }
    else if (source.startsWith('/+', index)) { kind = 'signature'; end = source.indexOf('+/', index + 2); end = end < 0 ? source.length : end + 2; }
    else if (source.startsWith('//', index)) { kind = 'line'; const newline = source.indexOf('\n', index + 2); end = newline < 0 ? source.length : newline; }
    else if (
      source.slice(index, index + 3).toLowerCase() === 'rem' &&
      (index === 0 || !/[A-Za-z0-9_%&]/.test(source[index - 1])) &&
      /[\s:]/.test(source[index + 3] ?? '')
    ) {
      kind = 'REM';
      const semicolon = source.indexOf(';', index + 3);
      end = semicolon < 0 ? source.length : semicolon + 1;
    }
    if (!kind) { index++; continue; }
    const raw = source.slice(index, end);
    comments.push({
      kind, start: index, end, raw, payload: commentPayload(raw, kind),
      blankLinesBefore: adjacentBlankLines(source, index, -1),
      blankLinesAfter: adjacentBlankLines(source, end, 1)
    });
    index = Math.max(end, index + 1);
  }
  return comments;
}

function maskNonCode(source: string): string {
  const chars = [...source];
  for (const comment of scanComments(source)) {
    for (let index = comment.start; index < comment.end; index++) {
      if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
    }
  }
  let index = 0;
  while (index < chars.length) {
    if (chars[index] !== '"' && chars[index] !== "'") { index++; continue; }
    const quote = chars[index];
    chars[index++] = ' ';
    while (index < chars.length) {
      if (chars[index] === quote) {
        chars[index++] = ' ';
        if (chars[index] === quote) { chars[index++] = ' '; continue; }
        break;
      }
      if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
      index++;
    }
  }
  return chars.join('');
}

function statementTokens(program: Buffer, names: NameTable, isApplicationClass = true): Token[] {
  const layout = readProgramLayout(program);
  const end = layout.statements.offset + layout.statements.byteLength;
  return decodeProgram(program, names, { mode: 'auto', isApplicationClass }).tokens
    .filter(token => token.offset >= layout.statements.offset && token.offset < end);
}

function blankLinesInWhitespace(value: string): number {
  return Math.max(0, (value.match(/\r?\n/g) ?? []).length - 1);
}

function leadingBlankLines(value: string): number {
  return blankLinesInWhitespace(/^[ \t\r\n]*/.exec(value)?.[0] ?? '');
}

function trailingBlankLines(value: string): number {
  return blankLinesInWhitespace(/[ \t\r\n]*$/.exec(value)?.[0] ?? '');
}

function countConsecutiveTokens(tokens: readonly Token[], start: number, direction: -1 | 1, opcode: number): number {
  let count = 0;
  for (let index = start; index >= 0 && index < tokens.length && tokens[index].opcode === opcode; index += direction) count++;
  return count;
}

function bodyGapObservations(definition: SnapshotDefinition): BodyGapObservation[] {
  const parsed = parseApplicationClassSource(definition.sourceText);
  if (!parsed) return [];
  const tokens = statementTokens(definition.storedProgram, storedNameTable(definition));
  const headers = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => [0x63, 0x5f, 0x49].includes(token.opcode) && definition.storedProgram[token.offset + 1] === 0x41);
  const observations: BodyGapObservation[] = [];
  for (let implementationIndex = 0; implementationIndex < Math.min(headers.length, parsed.implementations.length); implementationIndex++) {
    const member = parsed.implementations[implementationIndex];
    const headerIndex = headers[implementationIndex].index;
    let cursor = headerIndex + 1;
    while (cursor < tokens.length && tokens[cursor].opcode !== 0x2d) cursor++;
    cursor++;
    while (cursor < tokens.length && tokens[cursor].opcode === 0x6d) cursor++;
    const storedLeadingMarkers = countConsecutiveTokens(tokens, cursor, 1, 0x4f);
    const closerOpcode = member.kind === 'method' ? 0x64 : member.kind === 'get' ? 0x6a : 0x6b;
    let closerIndex = cursor;
    while (closerIndex < tokens.length && tokens[closerIndex].opcode !== closerOpcode) closerIndex++;
    const storedTrailingMarkers = countConsecutiveTokens(tokens, closerIndex - 1, -1, 0x4f);
    const bodyWithoutComments = maskNonCode(member.body).trim();
    observations.push({
      definitionId: definition.definitionId,
      implementationIndex,
      implementationKind: member.kind,
      sourceLeadingBlankLines: leadingBlankLines(member.body),
      storedLeadingMarkers,
      sourceTrailingBlankLines: trailingBlankLines(member.body),
      storedTrailingMarkers,
      bodyKind: member.body.trim() === '' ? 'empty' : bodyWithoutComments === '' ? 'comment-only' : 'nonempty',
      hasCompiledReferences: definition.names.some(row => row.recname.trim() !== '' || row.refname.trim() !== '')
    });
  }
  return observations;
}

function implementationSpans(source: string, parsed: NonNullable<ReturnType<typeof parseApplicationClassSource>>): Array<{ start: number; end: number }> {
  const implementationRegion = maskNonCode(source).slice(parsed.unitEnd);
  const pattern = /\b(method|get|set)\s+[A-Za-z_][A-Za-z0-9_$]*[\s\S]*?\bend-(?:method|get|set)\s*;/gid;
  return [...implementationRegion.matchAll(pattern)].map(match => ({
    start: parsed.unitEnd + (match.index ?? 0),
    end: parsed.unitEnd + (match.index ?? 0) + match[0].length
  }));
}

function sourceLocation(
  parsed: ReturnType<typeof parseApplicationClassSource>,
  comment: SourceComment,
  spans: ReadonlyArray<{ start: number; end: number }>
): string {
  if (!parsed) return 'unparsed';
  if (comment.end <= parsed.unitStart) return 'before class/interface header';
  if (comment.start < parsed.unitEnd) return 'inside class declaration section';
  if (comment.kind === 'signature') return 'implementation signature';
  if (spans.length === 0) return 'after class/interface';
  if (comment.start < spans[0].start) return 'before first implementation';
  for (let index = 0; index < spans.length; index++) {
    if (comment.start >= spans[index].start && comment.end <= spans[index].end) return 'inside implementation body';
    if (index + 1 < spans.length && comment.start >= spans[index].end && comment.end <= spans[index + 1].start) {
      return 'between implementations';
    }
  }
  return comment.start >= spans[spans.length - 1].end ? 'after final implementation' : 'implementation region';
}

function commentObservations(definition: SnapshotDefinition): CommentObservation[] {
  const parsed = parseApplicationClassSource(definition.sourceText);
  const sourceComments = scanComments(definition.sourceText);
  const spans = parsed ? implementationSpans(definition.sourceText, parsed) : [];
  const allTokens = statementTokens(definition.storedProgram, storedNameTable(definition));
  const storedComments = allTokens.filter(token => token.kind === TokenKind.Comment);
  const available = new Set(storedComments.map((_, index) => index));
  return sourceComments.map((comment, sourceIndex) => {
    const normalized = normalizePayload(comment.raw);
    let matchIndex = storedComments.findIndex((token, index) => available.has(index) && normalizePayload(token.text) === normalized);
    if (matchIndex < 0) {
      const loose = loosePayload(comment.raw);
      const expectedOpcodes = comment.kind === 'disabled' ? [0x55]
        : comment.kind === 'signature' ? [0x6d]
          : comment.kind === 'REM' ? [0x24]
            : [0x24, 0x4e];
      matchIndex = storedComments.findIndex((token, index) => {
        if (!available.has(index) || !expectedOpcodes.includes(token.opcode)) return false;
        const candidate = loosePayload(token.text);
        return candidate === loose || (loose.length >= 24 && (
          candidate.includes(loose.slice(0, 24)) || loose.includes(candidate.slice(0, 24))
        ));
      });
    }
    if (matchIndex >= 0) available.delete(matchIndex);
    const token = matchIndex >= 0 ? storedComments[matchIndex] : undefined;
    const tokenIndex = token ? allTokens.indexOf(token) : -1;
    const lineStart = definition.sourceText.lastIndexOf('\n', comment.start - 1) + 1;
    const lineEndFound = definition.sourceText.indexOf('\n', comment.end);
    const lineEnd = lineEndFound < 0 ? definition.sourceText.length : lineEndFound;
    const before = definition.sourceText.slice(lineStart, comment.start);
    const after = definition.sourceText.slice(comment.end, lineEnd);
    const previous = definition.sourceText.slice(0, comment.start).match(/\S(?=\s*$)/)?.[0];
    return {
      definitionId: definition.definitionId,
      kind: comment.kind,
      location: sourceLocation(parsed, comment, spans),
      opcode: token ? `0x${token.opcode.toString(16).padStart(2, '0')}` : 'unmatched',
      inlineAfterCode: before.trim() !== '',
      followsTerminator: previous === ';',
      precedesCodeOnLine: after.trim() !== '',
      blankLinesBefore: comment.blankLinesBefore,
      blankLinesAfter: comment.blankLinesAfter,
      consecutive: sourceIndex > 0 && definition.sourceText.slice(sourceComments[sourceIndex - 1].end, comment.start).trim() === '',
      storedMarkersBefore: tokenIndex < 0 ? 0 : countConsecutiveTokens(allTokens, tokenIndex - 1, -1, 0x4f),
      storedMarkersAfter: tokenIndex < 0 ? 0 : countConsecutiveTokens(allTokens, tokenIndex + 1, 1, 0x4f),
      hasCompiledReferences: definition.names.some(row => row.recname.trim() !== '' || row.refname.trim() !== ''),
      payload: comment.raw.replace(/\s+/g, ' ').slice(0, 160)
    };
  });
}

function tokenProjection(program: Buffer, names: NameTable): string[] {
  const ignored = new Set([0x24, 0x4e, 0x55, 0x6d, 0x4f, 0x2d]);
  return statementTokens(program, names)
    .filter(token => !ignored.has(token.opcode))
    .map(token => `${token.opcode.toString(16)}:${token.text.toLowerCase()}`);
}

function projectedTokens(program: Buffer, names: NameTable): Token[] {
  const ignored = new Set([0x24, 0x4e, 0x55, 0x6d, 0x4f, 0x2d]);
  return statementTokens(program, names).filter(token => !ignored.has(token.opcode));
}

function predictedNextBlocker(
  stored: Buffer,
  generated: Buffer,
  names: NameTable,
  storedLayout: ProgramLayout,
  generatedLayout: ProgramLayout
): string {
  const a = projectedTokens(stored, names);
  const b = projectedTokens(generated, names);
  const shared = Math.min(a.length, b.length);
  let index = 0;
  while (index < shared && a[index].opcode === b[index].opcode && a[index].text.toLowerCase() === b[index].text.toLowerCase()) index++;
  if (index < a.length || index < b.length) {
    const storedToken = a[index];
    const generatedToken = b[index];
    const opcodes = [storedToken?.opcode, generatedToken?.opcode];
    if (opcodes.some(opcode => opcode !== undefined && [0x21, 0x48, 0x4a].includes(opcode))) {
      return 'reference numbering/operand identity';
    }
    const classClose = a.find(token => token.opcode === 0x5b || token.opcode === 0x71);
    if (storedToken && classClose && storedToken.offset > classClose.offset) {
      if (opcodes.some(opcode => opcode !== undefined && [0x14, 0x15].includes(opcode))) {
        return 'statement terminator/separator';
      }
      return 'Application Class implementation wrapper/body';
    }
    return 'Application Class class/member statement stream';
  }
  for (const name of ['names', 'records', 'slots'] as const) {
    if (!section(stored, storedLayout, name).equals(section(generated, generatedLayout, name))) {
      return `Application Class ${name} metadata`;
    }
  }
  return 'none after layout correction';
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function markerCountAt(program: Buffer, absoluteOffset: number | undefined, opcode: number): number {
  if (absoluteOffset === undefined) return 0;
  let start = absoluteOffset;
  while (start > 0 && program[start - 1] === opcode) start--;
  let end = absoluteOffset;
  while (program[end] === opcode) end++;
  return end - start;
}

function sourceGapForRoot(
  definition: SnapshotDefinition,
  regions: ProgramRegions,
  root: RootFamily,
  storedAbsoluteOffset?: number
): { blankLines: number; offset: number } | undefined {
  const parsed = parseApplicationClassSource(definition.sourceText);
  if (!parsed || root === 'comment placement' || root === 'extra 0x2D') return undefined;
  if (storedAbsoluteOffset === undefined) return undefined;
  const tokens = statementTokens(definition.storedProgram, storedNameTable(definition));
  let nextIndex = tokens.findIndex(token => token.offset >= storedAbsoluteOffset && token.opcode !== 0x4f);
  if (nextIndex < 0) return undefined;
  const next = tokens[nextIndex];
  if (next.opcode === 0x5a || next.opcode === 0x70) {
    return { blankLines: adjacentBlankLines(definition.sourceText, parsed.unitStart, -1), offset: parsed.unitStart };
  }
  if (next.opcode === 0x58) {
    const ordinal = tokens.slice(0, nextIndex + 1).filter(token => token.opcode === 0x58).length - 1;
    const imports = [...maskNonCode(definition.sourceText).slice(0, parsed.unitStart).matchAll(/\bimport\b/gi)];
    const sourceOffset = imports[ordinal]?.index;
    return sourceOffset === undefined ? undefined : {
      blankLines: adjacentBlankLines(definition.sourceText, sourceOffset, -1), offset: sourceOffset
    };
  }
  if ([0x24, 0x4e, 0x55, 0x6d].includes(next.opcode)) {
    const comment = scanComments(definition.sourceText).find(candidate =>
      normalizePayload(candidate.raw) === normalizePayload(next.text)
    );
    return comment ? { blankLines: adjacentBlankLines(definition.sourceText, comment.start, -1), offset: comment.start } : undefined;
  }
  if (regions.region === 'before implementation wrapper') {
    const implementationHeaders = tokens
      .slice(0, nextIndex + 1)
      .filter(token => [0x63, 0x5f, 0x49].includes(token.opcode) && definition.storedProgram[token.offset + 1] === 0x41);
    const index = Math.max(0, implementationHeaders.length - 1);
    const sourceOffset = parsed.implementations[index]?.sourceIndex ?? parsed.unitEnd;
    return { blankLines: adjacentBlankLines(definition.sourceText, sourceOffset, -1), offset: sourceOffset };
  }
  if (regions.region === 'inside class declaration section') {
    const opcodeByKeyword = new Map<string, number>([
      ['private', 0x61], ['protected', 0x73], ['method', 0x63], ['property', 0x5e],
      ['instance', 0x62], ['constant', 0x56], ['end-class', 0x5b], ['end-interface', 0x71]
    ]);
    const sourceEvents = [...maskNonCode(definition.sourceText)
      .slice(parsed.unitStart, parsed.unitEnd)
      .matchAll(/\b(private|protected|method|property|instance|constant|end-class|end-interface)\b/gi)]
      .map(match => ({ opcode: opcodeByKeyword.get(match[1].toLowerCase()), offset: parsed.unitStart + (match.index ?? 0) }));
    const classStart = tokens.findIndex(token => token.opcode === 0x5a || token.opcode === 0x70);
    const ordinal = tokens.slice(classStart, nextIndex + 1).filter(token => token.opcode === next.opcode).length - 1;
    const matchingEvents = sourceEvents.filter(event => event.opcode === next.opcode);
    const sourceOffset = matchingEvents[ordinal]?.offset;
    return sourceOffset === undefined ? undefined : {
      blankLines: adjacentBlankLines(definition.sourceText, sourceOffset, -1), offset: sourceOffset
    };
  }
  return undefined;
}

function mechanismFor(root: RootFamily, region: ByteRegion, nextConstruct?: string): string {
  if (root === 'comment placement') return 'omitted comment event in compilation-unit layout stream';
  if (root === 'extra 0x2D') return 'premature import-fragment declaration close before comment';
  if (region === 'before class/interface header') return 'omitted pre-header structural gap';
  if (region === 'inside class declaration section') return 'omitted inter-declaration structural gap';
  if (region === 'before implementation wrapper') return 'omitted post-class/pre-wrapper structural gap';
  if (root === 'extra 0x4F') return 'unconditional nonempty-body entry marker with zero source blank lines';
  if (/\[0x6[4ab]\]$/.test(nextConstruct ?? '')) return 'trailing body blank line stripped before wrapper closer';
  return 'body-fragment blank-line multiplicity mismatch';
}

function separatorContexts(definition: SnapshotDefinition): string[] {
  const tokens = statementTokens(definition.storedProgram, storedNameTable(definition));
  const classHeaderIndex = tokens.findIndex(token => token.opcode === 0x5a || token.opcode === 0x70);
  return tokens.flatMap((token, index) => {
    if (token.opcode !== 0x2d) return [];
    const previous = tokens[index - 1];
    const previousPrevious = tokens[index - 2];
    if (
      index === tokens.length - 1 || tokens[index + 1]?.opcode === 0x07 ||
      definition.storedProgram[token.offset + 1] === 0x07
    ) return ['final program boundary'];
    if (classHeaderIndex >= 0 && index < classHeaderIndex) return ['import/declaration fragment close'];
    if (previous?.opcode === 0x15 && [0x5b, 0x71].includes(previousPrevious?.opcode ?? -1)) {
      return ['declaration-section close'];
    }
    if (previous?.opcode === 0x15 && [0x64, 0x6a, 0x6b].includes(previousPrevious?.opcode ?? -1)) {
      return ['implementation terminator suffix'];
    }
    const recent = tokens.slice(Math.max(0, index - 4), index);
    if (recent.some(candidate =>
      [0x63, 0x5f, 0x49].includes(candidate.opcode) && definition.storedProgram[candidate.offset + 1] === 0x41
    )) return ['implementation wrapper separator'];
    if (previous?.opcode === 0x15 && recent.some(candidate => candidate.opcode === 0x58)) {
      return ['import/declaration fragment close'];
    }
    return ['ordinary fragment declaration boundary'];
  });
}

function firstObservation<T>(values: readonly T[], predicate: (value: T) => boolean): T | undefined {
  return values.find(predicate);
}

function normalizePayload(value: string): string {
  return value.replace(/^\s*(?:\/\*|<\*|\/\+|REM\b)/i, '')
    .replace(/(?:\*\/|\*>|\+\/|;)\s*$/i, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function loosePayload(value: string): string {
  return normalizePayload(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function nearestSourceComment(source: string, storedText: string | undefined): SourceComment | undefined {
  const comments = scanComments(source);
  const target = normalizePayload(storedText ?? '');
  if (target) {
    const exact = comments.find(comment => normalizePayload(comment.payload) === target);
    if (exact) return exact;
    const contained = comments.find(comment => {
      const payload = normalizePayload(comment.payload);
      return payload.includes(target) || target.includes(payload);
    });
    if (contained) return contained;
  }
  return comments[0];
}

function sourceSnippet(source: string, offset: number, radius = 120): string {
  return source.slice(Math.max(0, offset - radius), Math.min(source.length, offset + radius))
    .replace(/\s+/g, ' ').trim();
}

function shape(definition: SnapshotDefinition): string {
  const parsed = parseApplicationClassSource(definition.sourceText);
  if (!parsed) return 'unparsed';
  const counts = new Map<string, number>();
  for (const statement of parsed.statements) counts.set(statement.kind, (counts.get(statement.kind) ?? 0) + 1);
  return `${parsed.unitKind}${parsed.extendsType ? '+extends' : ''}${parsed.implementsType ? '+implements' : ''};` +
    [...counts].map(([kind, count]) => `${kind}=${count}`).join(',') + `;impl=${parsed.implementations.length}`;
}

function hasPreprocessor(source: string): boolean {
  return /(^|\n)\s*#(?:if|elseif|else|end-if|toolsrel|define|undef|ifdef|ifndef)\b/im.test(source);
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = key(value);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function readRuns(db: Database.Database): RunInfo[] {
  const rows = db.prepare(`
    SELECT cr.run_id, cr.git_commit, cr.exact_count,
           SUM(CASE WHEN d.objectid1 = ? AND r.source_encode_success = 1 THEN 1 ELSE 0 END) AS app_ok
    FROM corpus_run cr
    JOIN result r USING (run_id)
    JOIN definition d USING (definition_id)
    WHERE cr.completed_at IS NOT NULL AND cr.definitions = ?
    GROUP BY cr.run_id
    ORDER BY cr.run_id DESC
  `).all(APPLICATION_CLASS_OBJECT_ID, TOTAL_CORPUS) as Array<Record<string, unknown>>;
  return rows.map(row => ({
    runId: Number(row.run_id), gitCommit: String(row.git_commit),
    exactCount: Number(row.exact_count), appClassEncodeSuccess: Number(row.app_ok)
  }));
}

function readResults(db: Database.Database, runId: number): Map<number, ResultRow> {
  const rows = db.prepare(`
    SELECT definition_id, classification, source_encode_success, source_encode_exact,
           first_diff_offset, generated_sha256, stored_diff_hex, generated_diff_hex
    FROM result WHERE run_id = ?
  `).all(runId) as Array<Record<string, unknown>>;
  return new Map(rows.map(row => [Number(row.definition_id), {
    definitionId: Number(row.definition_id), classification: String(row.classification),
    sourceEncodeSuccess: Boolean(row.source_encode_success), sourceEncodeExact: Boolean(row.source_encode_exact),
    firstDiffOffset: row.first_diff_offset === null ? undefined : Number(row.first_diff_offset),
    generatedSha256: row.generated_sha256 === null ? undefined : String(row.generated_sha256),
    storedDiffHex: row.stored_diff_hex === null ? undefined : String(row.stored_diff_hex),
    generatedDiffHex: row.generated_diff_hex === null ? undefined : String(row.generated_diff_hex)
  }]));
}

function main(): void {
  const resultDb = new Database('tools/corpus/corpus-results.sqlite', { readonly: true });
  const runs = readRuns(resultDb);
  const currentRun = runs[0];
  if (!currentRun) throw new Error(`No completed ${TOTAL_CORPUS}-definition run found.`);
  const baselineRun = runs.find(run =>
    run.runId < currentRun.runId &&
    currentRun.appClassEncodeSuccess - run.appClassEncodeSuccess >= 1_000
  );
  if (!baselineRun) throw new Error('No pre-Cycle-23 full-corpus baseline found.');
  const currentResults = readResults(resultDb, currentRun.runId);
  const baselineResults = readResults(resultDb, baselineRun.runId);
  resultDb.close();

  const snapshotDb = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(snapshotDb).filter(definition => definition.objectid1 === APPLICATION_CLASS_OBJECT_ID);
  snapshotDb.close();
  const rows: CensusRow[] = [];
  const allComments = definitions.flatMap(commentObservations);
  const allBodyGaps = definitions.flatMap(bodyGapObservations);
  const allSeparatorContexts = definitions.flatMap(separatorContexts);
  let reencodeFailures = 0;

  for (const definition of definitions) {
    const before = baselineResults.get(definition.definitionId);
    const after = currentResults.get(definition.definitionId);
    if (!before || !after || before.sourceEncodeSuccess || !after.sourceEncodeSuccess) continue;
    // Cycle 21/23 root assignment treats the compile-time environment as the
    // earlier cause even when the first raw byte is a marker. Keep that same
    // precedence so this analyzer reproduces the exact Cycle 24 population.
    if (hasPreprocessor(definition.sourceText)) continue;
    let generated: Buffer;
    try {
      generated = encodeProgramArtifacts(definition.sourceText, { owner: ownerContext(definition) }).program;
    } catch {
      reencodeFailures++;
      continue;
    }
    const diff = meaningfulDiff(definition.storedProgram, generated);
    const rootFamily = classifyRoot(diff);
    if (!rootFamily || diff.storedAbsoluteOffset === undefined || diff.generatedAbsoluteOffset === undefined) continue;
    const regions = programRegion(definition, diff.storedAbsoluteOffset);
    const comment = nearestSourceComment(definition.sourceText, regions.nearestCommentText);
    const names = storedNameTable(definition);
    const storedProjection = tokenProjection(definition.storedProgram, names);
    const generatedProjection = tokenProjection(generated, names);
    const storedLayout = readProgramLayout(definition.storedProgram);
    const generatedLayout = readProgramLayout(generated);
    const metadataSections = ['names', 'records', 'slots'] as const;
    const metadataExact = metadataSections.every(name =>
      section(definition.storedProgram, storedLayout, name).equals(section(generated, generatedLayout, name))
    );
    const layoutProjectionExact = metadataExact && arraysEqual(storedProjection, generatedProjection);
    const mechanism = mechanismFor(rootFamily, regions.region, regions.nextToken);
    const relevantBodyGap = regions.implementationIndex === undefined
      ? undefined
      : allBodyGaps.find(gap =>
          gap.definitionId === definition.definitionId && gap.implementationIndex === regions.implementationIndex
        );
    const parsed = parseApplicationClassSource(definition.sourceText);
    const sourceGapEvidence = rootFamily === 'extra 0x4F' && relevantBodyGap && parsed
      ? {
          blankLines: relevantBodyGap.sourceLeadingBlankLines,
          offset: parsed.implementations[relevantBodyGap.implementationIndex]?.sourceIndex ?? parsed.unitEnd
        }
      : sourceGapForRoot(definition, regions, rootFamily, diff.storedAbsoluteOffset);
    let sourceOffset = (rootFamily === 'comment placement' || rootFamily === 'extra 0x2D') && comment
      ? comment.start
      : sourceGapEvidence?.offset ?? parsed?.unitStart ?? 0;
    if (relevantBodyGap && parsed) {
      const member = parsed.implementations[relevantBodyGap.implementationIndex];
      const bodyStart = member ? definition.sourceText.indexOf(member.body, member.sourceIndex) : -1;
      if (bodyStart >= 0) {
        if (rootFamily === 'extra 0x4F' || regions.nextOpcode === 0x4f) sourceOffset = bodyStart;
        else if ([0x64, 0x6a, 0x6b].includes(regions.nextOpcode ?? -1)) {
          const closer = definition.sourceText.toLowerCase().indexOf(`end-${member.kind}`, bodyStart);
          if (closer >= 0) sourceOffset = closer;
        } else if (regions.nextText) {
          const nextSource = definition.sourceText.indexOf(regions.nextText, bodyStart);
          if (nextSource >= 0) sourceOffset = nextSource;
        }
      }
    }
    rows.push({
      definitionId: definition.definitionId,
      displayName: definition.displayName,
      source: definition.sourceText,
      rootFamily,
      classification: after.classification,
      firstSemanticDifference: diff,
      sourceContext: sourceSnippet(definition.sourceText, sourceOffset),
      sourceOffset,
      sourceLine: definition.sourceText.slice(0, sourceOffset).split(/\r?\n/).length,
      enclosingRegion: regions.region,
      previousConstruct: regions.previousToken,
      nextConstruct: regions.nextToken,
      commentKind: comment?.kind,
      commentOpcode: regions.nearestCommentOpcode === undefined
        ? undefined
        : `0x${regions.nearestCommentOpcode.toString(16).padStart(2, '0')}`,
      commentPayload: comment?.payload,
      blankLinesBefore: comment?.blankLinesBefore ?? 0,
      blankLinesAfter: comment?.blankLinesAfter ?? 0,
      implementationIndex: regions.implementationIndex,
      implementationCount: regions.implementationCount,
      applicationClassShape: shape(definition),
      storedStatementWindow: diff.storedWindow ?? '',
      generatedStatementWindow: diff.generatedWindow ?? '',
      markerMultiplicity: markerCountAt(
        rootFamily === 'extra 0x4F' || rootFamily === 'extra 0x2D' ? generated : definition.storedProgram,
        rootFamily === 'extra 0x4F' || rootFamily === 'extra 0x2D'
          ? diff.generatedAbsoluteOffset
          : diff.storedAbsoluteOffset,
        rootFamily === 'extra 0x2D' ? 0x2d : rootFamily === 'comment placement' ? (diff.storedByte ?? 0) : 0x4f
      ),
      sourceGapBlankLines: sourceGapEvidence?.blankLines,
      mechanism,
      disposition: 'FULLY_EXPLAINED',
      layoutProjectionExact,
      predictedNextBlocker: predictedNextBlocker(
        definition.storedProgram, generated, names, storedLayout, generatedLayout
      )
    });
  }

  const rootIds = new Set(rows.map(row => row.definitionId));
  const currentEncodableDefinitions = definitions.filter(definition => currentResults.get(definition.definitionId)?.sourceEncodeSuccess);
  const outerCommentDefinitions = new Set(allComments
    .filter(comment => !['implementation signature', 'inside implementation body'].includes(comment.location))
    .map(comment => comment.definitionId));
  const bodyDefinitions = new Set(allBodyGaps.map(gap => gap.definitionId));
  const bodyMismatchDefinitions = new Set(allBodyGaps
    .filter(gap => gap.sourceLeadingBlankLines !== gap.storedLeadingMarkers || gap.sourceTrailingBlankLines !== gap.storedTrailingMarkers)
    .map(gap => gap.definitionId));
  const bodyCurrentChangeDefinitions = new Set(allBodyGaps
    .filter(gap => gap.bodyKind !== 'empty' && (gap.sourceLeadingBlankLines !== 1 || gap.sourceTrailingBlankLines > 0))
    .map(gap => gap.definitionId));
  const importDefinitions = new Set(definitions
    .filter(definition => /^\s*import\b/i.test(definition.sourceText))
    .map(definition => definition.definitionId));
  const parsedDefinitions = definitions.filter(definition => parseApplicationClassSource(definition.sourceText) !== undefined);
  const currentEncodableIds = new Set(currentEncodableDefinitions.map(definition => definition.definitionId));
  const predictedChangeIds = new Set<number>();
  for (const id of outerCommentDefinitions) if (currentEncodableIds.has(id)) predictedChangeIds.add(id);
  for (const id of bodyCurrentChangeDefinitions) if (currentEncodableIds.has(id)) predictedChangeIds.add(id);
  for (const row of rows) if (currentEncodableIds.has(row.definitionId)) predictedChangeIds.add(row.definitionId);

  const layoutOnlyIds = new Set(rows.filter(row => row.layoutProjectionExact).map(row => row.definitionId));

  const report = {
    baseline: baselineRun,
    current: currentRun,
    population: {
      exactTarget: 940,
      reproduced: rows.length,
      reencodeFailures,
      byRoot: countBy(rows, row => row.rootFamily),
      mutuallyExclusive: new Set(rows.map(row => row.definitionId)).size === rows.length
    },
    byRegion: countBy(rows, row => `${row.rootFamily} | ${row.enclosingRegion}`),
    commentForms: countBy(rows.filter(row => row.rootFamily === 'comment placement'), row => `${row.commentKind ?? 'unmatched'} | ${row.commentOpcode ?? 'none'}`),
    blankLineContexts: countBy(rows, row => `${row.rootFamily} | before=${row.blankLinesBefore} after=${row.blankLinesAfter}`),
    semanticPartition: countBy(rows, row => row.mechanism),
    disposition: countBy(rows, row => row.disposition),
    markerMultiplicity: countBy(rows.filter(row => row.rootFamily !== 'comment placement'), row => `${row.rootFamily} | count=${row.markerMultiplicity}`),
    rootEvidence: {
      commentRootsMatchedToStoredOperand: rows.filter(row => row.rootFamily === 'comment placement' && row.commentKind !== undefined && row.commentOpcode !== undefined).length,
      outerGapRootsWithExactSourceMultiplicity: rows.filter(row =>
        row.rootFamily === 'missing 0x4F' && row.enclosingRegion !== 'inside implementation wrapper/body' &&
        row.sourceGapBlankLines === row.markerMultiplicity
      ).length,
      extraBodyEntryRootsWithZeroSourceGapAndOneGeneratedMarker: rows.filter(row =>
        row.rootFamily === 'extra 0x4F' && row.sourceGapBlankLines === 0 && row.markerMultiplicity === 1
      ).length,
      bodyGapPopulationContradictions: allBodyGaps.filter(gap =>
        gap.sourceLeadingBlankLines !== gap.storedLeadingMarkers || gap.sourceTrailingBlankLines !== gap.storedTrailingMarkers
      ).length,
      importCommentBoundaryRoots: rows.filter(row => row.rootFamily === 'extra 0x2D').length
    },
    commentModel: {
      sourceCommentCount: allComments.length,
      lineCommentCount: allComments.filter(comment => comment.kind === 'line').length,
      matchedStoredOperands: allComments.filter(comment => comment.opcode !== 'unmatched').length,
      unmatchedInPreprocessorDefinitions: allComments.filter(comment =>
        comment.opcode === 'unmatched' && hasPreprocessor(
          definitions.find(definition => definition.definitionId === comment.definitionId)?.sourceText ?? ''
        )
      ).length,
      definitionsWithComments: new Set(allComments.map(comment => comment.definitionId)).size,
      byKindAndOpcode: countBy(allComments, comment => `${comment.kind} | ${comment.opcode}`),
      byLocationAndOpcode: countBy(allComments, comment => `${comment.location} | ${comment.opcode}`),
      byPlacementAndOpcode: countBy(allComments, comment =>
        `${comment.inlineAfterCode ? 'inline-after-code' : 'line-leading'} | ${comment.followsTerminator ? 'after-terminator' : 'not-after-terminator'} | ${comment.opcode}`
      ),
      markerAdjacency: {
        beforeExact: allComments.filter(comment => comment.opcode !== 'unmatched' && comment.blankLinesBefore === comment.storedMarkersBefore).length,
        beforeContradictions: allComments.filter(comment => comment.opcode !== 'unmatched' && comment.blankLinesBefore !== comment.storedMarkersBefore).length,
        afterExact: allComments.filter(comment => comment.opcode !== 'unmatched' && comment.blankLinesAfter === comment.storedMarkersAfter).length,
        afterRelocatedOrConsumed: allComments.filter(comment => comment.opcode !== 'unmatched' && comment.blankLinesAfter !== comment.storedMarkersAfter).length,
        inline0x4eAfterRelocatedOrConsumed: allComments.filter(comment =>
          comment.opcode === '0x4e' && comment.blankLinesAfter !== comment.storedMarkersAfter
        ).length,
        referenceConclusion: 'compiled-reference presence is not sufficient: both adjacent and relocated inline-comment gaps occur with the same reference state'
      },
      consecutiveByOpcode: countBy(allComments.filter(comment => comment.consecutive), comment => comment.opcode),
      blankLinesByOpcode: countBy(allComments, comment => `${comment.opcode} | before=${comment.blankLinesBefore} after=${comment.blankLinesAfter}`),
      sourceToStoredMarkers: countBy(allComments.filter(comment => comment.opcode !== 'unmatched'), comment =>
        `${comment.opcode} | source-before=${comment.blankLinesBefore} stored-before=${comment.storedMarkersBefore} | source-after=${comment.blankLinesAfter} stored-after=${comment.storedMarkersAfter}`
      ),
      inlineCommentGapControls: countBy(allComments.filter(comment => comment.opcode === '0x4e'), comment =>
        `${comment.location} | refs=${comment.hasCompiledReferences} | source-after=${comment.blankLinesAfter} stored-after=${comment.storedMarkersAfter}`
      ),
      unmatchedDefinitions: [...new Set(allComments.filter(comment => comment.opcode === 'unmatched').map(comment => comment.definitionId))].sort((a, b) => a - b),
      unmatchedSamples: allComments.filter(comment => comment.opcode === 'unmatched').slice(0, 20).map(comment => ({
        definitionId: comment.definitionId,
        kind: comment.kind,
        location: comment.location,
        payload: comment.payload
      }))
    },
    separatorModel: {
      contextCounts: countBy(allSeparatorContexts, context => context),
      extraRootCount: rows.filter(row => row.rootFamily === 'extra 0x2D').length,
      extraRootIds: rows.filter(row => row.rootFamily === 'extra 0x2D').map(row => row.definitionId),
      conclusion: '0x2D is context-owned; the four roots close an isolated import fragment before its following comment instead of keeping one compilation-unit layout stream'
    },
    bodyGapModel: {
      wrapperCount: allBodyGaps.length,
      definitionCount: bodyDefinitions.size,
      commentOnlyWrapperCount: allBodyGaps.filter(gap => gap.bodyKind === 'comment-only').length,
      leadingExact: allBodyGaps.filter(gap => gap.sourceLeadingBlankLines === gap.storedLeadingMarkers).length,
      leadingContradictions: allBodyGaps.filter(gap => gap.sourceLeadingBlankLines !== gap.storedLeadingMarkers).length,
      trailingExact: allBodyGaps.filter(gap => gap.sourceTrailingBlankLines === gap.storedTrailingMarkers).length,
      trailingContradictions: allBodyGaps.filter(gap => gap.sourceTrailingBlankLines !== gap.storedTrailingMarkers).length,
      leadingSourceToStored: countBy(allBodyGaps, gap =>
        `${gap.bodyKind} | refs=${gap.hasCompiledReferences} | source=${gap.sourceLeadingBlankLines} stored=${gap.storedLeadingMarkers}`
      ),
      trailingSourceToStored: countBy(allBodyGaps, gap =>
        `${gap.bodyKind} | refs=${gap.hasCompiledReferences} | source=${gap.sourceTrailingBlankLines} stored=${gap.storedTrailingMarkers}`
      ),
      mismatchDefinitionCount: bodyMismatchDefinitions.size
    },
    controls: {
      applicationClassDefinitions: definitions.length,
      parsedDefinitions: parsedDefinitions.length,
      classCount: parsedDefinitions.filter(definition => parseApplicationClassSource(definition.sourceText)?.unitKind === 'class').length,
      interfaceCount: parsedDefinitions.filter(definition => parseApplicationClassSource(definition.sourceText)?.unitKind === 'interface').length,
      currentSourceEncodable: currentEncodableDefinitions.length,
      currentExact: currentEncodableDefinitions.filter(definition => currentResults.get(definition.definitionId)?.classification === 'EXACT').length,
      rootPopulation: rootIds.size,
      rootByUnitKind: countBy(rows, row => parseApplicationClassSource(
        definitions.find(definition => definition.definitionId === row.definitionId)?.sourceText ?? ''
      )?.unitKind ?? 'unparsed'),
      examples: {
        standaloneBlock: firstObservation(allComments, comment => comment.kind === 'block' && comment.opcode === '0x24')?.definitionId,
        inlineBlock: firstObservation(allComments, comment => comment.kind === 'block' && comment.opcode === '0x4e')?.definitionId,
        rem: firstObservation(allComments, comment => comment.kind === 'REM' && comment.opcode === '0x24')?.definitionId,
        disabled: firstObservation(allComments, comment => comment.kind === 'disabled' && comment.opcode === '0x55')?.definitionId,
        signature: firstObservation(allComments, comment => comment.kind === 'signature' && comment.opcode === '0x6d')?.definitionId,
        zeroBodyGap: firstObservation(allBodyGaps, gap => gap.bodyKind === 'nonempty' && gap.sourceLeadingBlankLines === 0)?.definitionId,
        oneBodyGap: firstObservation(allBodyGaps, gap => gap.bodyKind === 'nonempty' && gap.sourceLeadingBlankLines === 1)?.definitionId,
        manyBodyGaps: firstObservation(allBodyGaps, gap => gap.bodyKind === 'nonempty' && gap.sourceLeadingBlankLines >= 2)?.definitionId,
        emptyBodyNoGap: firstObservation(allBodyGaps, gap => gap.bodyKind === 'empty' && gap.sourceLeadingBlankLines === 0)?.definitionId,
        emptyBodyWithGap: firstObservation(allBodyGaps, gap => gap.bodyKind === 'empty' && gap.sourceLeadingBlankLines > 0)?.definitionId,
        withoutCompiledReferences: firstObservation(allBodyGaps, gap => !gap.hasCompiledReferences)?.definitionId
      }
    },
    stateMachine: {
      compilationUnit: [
        'walk imports, ordinary comments, class header, declarations, unit closer, post-class comments, and implementations in source order',
        'queue one 0x4F per source blank line and flush immediately before the next layout event',
        'do not close an import fragment before an adjacent comment; declaration close remains owned by its structural context'
      ],
      declaration: [
        'emit semantic declaration tokens only; layout events surrounding declarations remain compilation-unit-owned',
        'line-leading block and REM comments use 0x24; trailing inline block comments use 0x4E'
      ],
      wrapper: [
        'emit implementation header, wrapper 0x2D, and /+ +/ signature operands as 0x6D',
        'BODY-GAP multiplicity is source-owned and is not an unconditional wrapper marker',
        'closer 0x15 0x2D and inter-implementation transition remain distinct contexts'
      ],
      bodyFragment: [
        'ordinary, disabled, and inline comments stay delegated to the shared fragment encoder',
        'preserve leading and trailing blank-line markers; do not strip a source-owned trailing 0x4F when removing a synthetic final statement separator'
      ]
    },
    blastRadius: {
      compilationUnitLayout: {
        directRoots: rows.filter(row => ['comment placement', 'missing 0x4F', 'extra 0x2D'].includes(row.rootFamily) && row.enclosingRegion !== 'inside implementation wrapper/body').length,
        semanticPopulation: parsedDefinitions.length,
        currentlyExact: 0,
        currentlyNonExact: parsedDefinitions.length,
        commentBearingPopulation: outerCommentDefinitions.size,
        predictedCommentChangesAmongCurrentEncodable: [...outerCommentDefinitions].filter(id => currentEncodableIds.has(id)).length,
        importedPopulation: importDefinitions.size,
        risk: 'all parsed Application Classes; source-to-layout event ownership only'
      },
      methodBodyGap: {
        directRoots: rows.filter(row => row.enclosingRegion === 'inside implementation wrapper/body' && ['missing 0x4F', 'extra 0x4F'].includes(row.rootFamily)).length,
        semanticPopulation: bodyDefinitions.size,
        currentlyExact: 0,
        currentlyNonExact: bodyDefinitions.size,
        observedMismatchPopulation: bodyMismatchDefinitions.size,
        currentRuleChangePopulation: bodyCurrentChangeDefinitions.size,
        predictedGeneratedShaChangesAmongCurrentEncodable: [...bodyCurrentChangeDefinitions].filter(id => currentEncodableIds.has(id)).length,
        risk: 'Application Class wrapper/body boundary; ordinary fragment semantics remain shared'
      },
      predictedGeneratedShaChangePopulation: predictedChangeIds.size,
      predictionKind: 'source-driven union among the 1,325 currently encodable Application Classes; declaration-gap hidden roots remain a lower-bound component'
    },
    payoff: {
      likelyImmediateExact: layoutOnlyIds.size,
      expectedOnlyToAdvance: rows.length - layoutOnlyIds.size,
      nextBlockers: countBy(rows, row => row.predictedNextBlocker)
    },
    rows
  };

  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    const compact = { ...report, rows: undefined };
    console.log(JSON.stringify(compact, null, 2));
  }
}

main();
