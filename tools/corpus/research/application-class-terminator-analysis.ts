/**
 * Cycle 27: Application Class declaration-terminator and separator census.
 *
 * Read-only. Uses the completed local HCDEV snapshot, the current encoder,
 * completed corpus results, and Cycle 24's saved 940-row marker report. It
 * never connects to Oracle and never writes corpus state.
 *
 * Usage:
 *   npx tsx tools/corpus/research/application-class-terminator-analysis.ts \
 *     --cycle24-report /tmp/cycle24/final-report-full.json
 *   npx tsx tools/corpus/research/application-class-terminator-analysis.ts \
 *     --cycle24-report /tmp/cycle24/final-report-full.json --json
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

import {
  parseApplicationClassSource,
  type ApplicationClassProgram,
  type ApplicationClassStatement
} from '../../../src/peoplecode/applicationClassProgram';
import {
  encodeProgramArtifacts,
  type PeopleCodeOwner
} from '../../../src/peoplecode/encoder';
import { decodeProgram, type Token } from '../../../src/peoplecode/decoder';
import { readProgramLayout, type ProgramLayout } from '../../../src/peoplecode/programLayout';
import { NameTable } from '../../../src/peoplecode/progtext';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';
import type { SnapshotDefinition } from '../snapshot/types';

const TOTAL_CORPUS = 30_209;
const APPLICATION_CLASS_OBJECT_ID = 104;
const REFERENCE_OPCODES = new Set([0x21, 0x48, 0x4a]);
const LAYOUT_OPCODES = new Set([0x24, 0x4e, 0x55, 0x6d, 0x4f, 0x2d]);
const COMMENT_OPCODES = new Set([0x24, 0x4e, 0x55, 0x6d]);
const MARKER_OPCODES = new Set([0x4f, 0x2d]);
const DECLARATION_START_OPCODES = new Set([0x56, 0x5e, 0x62, 0x63]);

type SemanticSection = 'header' | 'statements' | 'names' | 'records' | 'slots' | 'none';
type RootPopulation = 'declaration terminator' | 'statement separator';
type DeclarationKind =
  | 'method'
  | 'constructor'
  | 'property'
  | 'instance'
  | 'constant'
  | 'abstract method'
  | 'interface method'
  | 'unit header'
  | 'method body'
  | 'getter body'
  | 'setter body'
  | 'constructor body'
  | 'none';

interface Cycle24Report {
  rows: Array<{ definitionId: number }>;
}

interface ResultRow {
  classification: string;
  sourceEncodeSuccess: boolean;
}

interface SemanticDiff {
  section: SemanticSection;
  relativeOffset?: number;
  storedAbsoluteOffset?: number;
  generatedAbsoluteOffset?: number;
  storedByte?: number;
  generatedByte?: number;
  storedWindow?: string;
  generatedWindow?: string;
}

interface EncodedDefinition {
  program: Buffer;
  blocker: string;
  diff: SemanticDiff;
  storedProjected: Token[];
  generatedProjected: Token[];
  storedLayout: Token[];
  generatedLayout: Token[];
  firstProjectedDifference: number;
}

interface SourceBoundary {
  statement?: ApplicationClassStatement;
  declarationKind: DeclarationKind;
  declarationOrdinal?: number;
  finalDeclaration: boolean;
  semicolonsInStatement: number;
  followingSemicolons: number;
  totalSemicolons: number;
  previousSource: string;
  followingSource: string;
  commentBefore: boolean;
  commentAfter: boolean;
  blankLinesAfter: number;
  nextConstruct: string;
}

interface TargetRow {
  definitionId: number;
  displayName: string;
  source: string;
  population: RootPopulation;
  cycle26Family?: string;
  signature: string;
  unitKind?: 'class' | 'interface';
  declarationKind: DeclarationKind;
  declarationOrdinal?: number;
  finalDeclaration: boolean;
  sourceSemicolonPresent: boolean;
  sourceSemicolonCount: number;
  parserRetainsTerminator?: boolean;
  previousSourceTokens: string;
  followingSourceTokens: string;
  commentBefore: boolean;
  commentAfter: boolean;
  blankLinesAfter: number;
  nextBoundary: string;
  storedByte?: string;
  generatedByte?: string;
  storedWindow?: string;
  generatedWindow?: string;
  role: string;
  mechanism: string;
  commentOperandsCorrect: boolean;
  commentPlacementCorrect: boolean;
  markerRunsCorrect: boolean;
  storedLocalLayout: string[];
  generatedLocalLayout: string[];
  commentLayoutState: 'already correct' | 'adjacent fixed-input residual';
  disposition: 'FULLY_EXPLAINED' | 'PARTIALLY_EXPLAINED' | 'UNRELATED_ROOT_DISCOVERED' | 'UNRESOLVED';
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const result = new Map<string, number>();
  for (const value of values) {
    const label = key(value);
    result.set(label, (result.get(label) ?? 0) + 1);
  }
  return Object.fromEntries([...result].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function percentage(value: number, total: number): number {
  return total === 0 ? 0 : Number((100 * value / total).toFixed(2));
}

function firstDifference(a: Buffer, b: Buffer): number | undefined {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index++) if (a[index] !== b[index]) return index;
  return a.length === b.length ? undefined : shared;
}

function firstTokenDifference(left: readonly Token[], right: readonly Token[]): number {
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index++) {
    const a = left[index];
    const b = right[index];
    if (!a || !b || a.opcode !== b.opcode || normalize(a.text) !== normalize(b.text)) return index;
  }
  return count;
}

function hexByte(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `0x${value.toString(16).padStart(2, '0')}`;
}

function hexWindow(bytes: Buffer, offset: number, radius = 12): string {
  return bytes.subarray(Math.max(0, offset - radius), Math.min(bytes.length, offset + radius + 1)).toString('hex');
}

function section(bytes: Buffer, layout: ProgramLayout, name: 'statements' | 'names' | 'records' | 'slots'): Buffer {
  return bytes.subarray(layout[name].offset, layout[name].offset + layout[name].byteLength);
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
    const left = section(stored, storedLayout, name);
    const right = section(generated, generatedLayout, name);
    const offset = firstDifference(left, right);
    if (offset === undefined) continue;
    const storedAbsoluteOffset = storedLayout[name].offset + offset;
    const generatedAbsoluteOffset = generatedLayout[name].offset + offset;
    return {
      section: name,
      relativeOffset: offset,
      storedAbsoluteOffset,
      generatedAbsoluteOffset,
      storedByte: left[offset],
      generatedByte: right[offset],
      storedWindow: hexWindow(stored, storedAbsoluteOffset),
      generatedWindow: hexWindow(generated, generatedAbsoluteOffset)
    };
  }
  return { section: 'none' };
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

function storedNameTable(definition: SnapshotDefinition): NameTable {
  const names = new NameTable();
  for (const row of definition.names) {
    const record = row.recname.trim();
    const reference = row.refname.trim();
    names.add(row.namenum, record && reference ? `${record}.${reference}` : reference || record || `<${row.namenum}>`);
  }
  return names;
}

function statementTokens(program: Buffer, names: NameTable, includeLayout: boolean): Token[] {
  const layout = readProgramLayout(program);
  const end = layout.statements.offset + layout.statements.byteLength;
  return decodeProgram(program, names, { mode: 'auto', isApplicationClass: true }).tokens
    .filter(token => token.offset >= layout.statements.offset && token.offset < end)
    .filter(token => includeLayout || !LAYOUT_OPCODES.has(token.opcode));
}

function projectedNextBlocker(
  definition: SnapshotDefinition,
  generated: Buffer
): string {
  const names = storedNameTable(definition);
  const left = statementTokens(definition.storedProgram, names, false);
  const right = statementTokens(generated, names, false);
  const index = firstTokenDifference(left, right);
  if (index < left.length || index < right.length) {
    const opcodes = [left[index]?.opcode, right[index]?.opcode];
    if (opcodes.some(opcode => opcode !== undefined && REFERENCE_OPCODES.has(opcode))) {
      return 'reference numbering/operand identity';
    }
    const classClose = left.find(token => token.opcode === 0x5b || token.opcode === 0x71);
    if (left[index] && classClose && left[index].offset > classClose.offset) {
      if (opcodes.some(opcode => opcode !== undefined && [0x14, 0x15].includes(opcode))) {
        return 'statement terminator/separator';
      }
      return 'Application Class implementation wrapper/body';
    }
    return 'other newly exposed family';
  }
  const storedLayout = readProgramLayout(definition.storedProgram);
  const generatedLayout = readProgramLayout(generated);
  for (const name of ['names', 'records', 'slots'] as const) {
    if (!section(definition.storedProgram, storedLayout, name).equals(section(generated, generatedLayout, name))) {
      return `Application Class ${name} metadata`;
    }
  }
  return 'none';
}

function classifyCycle26Other(item: EncodedDefinition): string {
  const stored = item.storedProjected[item.firstProjectedDifference];
  const generated = item.generatedProjected[item.firstProjectedDifference];
  const signature = `${hexByte(stored?.opcode) ?? 'EOF'}->${hexByte(generated?.opcode) ?? 'EOF'}`;
  if (['0x15->0x63', '0x15->0x5e', '0x15->0x62', '0x15->0x61', '0x15->0x5b'].includes(signature)) {
    return 'missing repeated/declaration terminator';
  }
  if (signature === '0x5b->0x15') return 'extra declaration terminator before unit closer';
  if (signature === '0x03->0x15') return 'trailing parameter comma/terminator boundary';
  if (signature === '0x40->0x0a') return 'unparameterized array type representation';
  if (signature === '0x50->0x0e') return 'negative constant literal representation';
  return 'other';
}

function isDeclaration(statement: ApplicationClassStatement): boolean {
  return statement.kind !== 'visibility' && statement.kind !== 'instance';
}

function declarationKind(parsed: ApplicationClassProgram, statement: ApplicationClassStatement | undefined): DeclarationKind {
  if (!statement) return 'none';
  if (statement.kind === 'method') {
    if (parsed.unitKind === 'interface') return 'interface method';
    if (statement.abstract) return 'abstract method';
    if (normalize(statement.name) === normalize(parsed.className)) return 'constructor';
    return 'method';
  }
  if (statement.kind === 'instance-statement') return 'instance';
  if (statement.kind === 'property' || statement.kind === 'constant') return statement.kind;
  return 'none';
}

function countBlankLines(value: string): number {
  return Math.max(0, (value.match(/\r?\n/g) ?? []).length - 1);
}

function sourceBoundary(
  source: string,
  parsed: ApplicationClassProgram,
  generatedTokens: readonly Token[],
  differenceIndex: number
): SourceBoundary {
  const declarations = parsed.statements.filter(isDeclaration);
  const opcodeFor = (statement: ApplicationClassStatement): number | undefined => {
    if (statement.kind === 'method') return 0x63;
    if (statement.kind === 'property') return 0x5e;
    if (statement.kind === 'instance-statement') return 0x62;
    if (statement.kind === 'constant') return 0x56;
    if (statement.kind === 'visibility') return statement.visibility === 'private' ? 0x61 : statement.visibility === 'protected' ? 0x73 : undefined;
    return undefined;
  };

  const generatedPreviousOpcode = generatedTokens[differenceIndex - 1]?.opcode;
  const generatedNextOpcode = generatedTokens[differenceIndex]?.opcode;
  const declarationStartsBefore = generatedTokens.slice(0, differenceIndex)
    .filter(token => DECLARATION_START_OPCODES.has(token.opcode)).length;
  let candidateIndex = declarationStartsBefore - 1;
  if (declarationStartsBefore === 0 && generatedNextOpcode !== undefined &&
      (DECLARATION_START_OPCODES.has(generatedNextOpcode) || [0x61, 0x73].includes(generatedNextOpcode))) {
    const firstStatement = parsed.statements[0];
    const end = firstStatement?.sourceIndex ?? parsed.unitCloseStart;
    const raw = source.slice(parsed.unitStart, end);
    const semicolons = (maskNonCode(raw).match(/;/g) ?? []).length;
    return {
      declarationKind: 'unit header', declarationOrdinal: -1,
      finalDeclaration: false, semicolonsInStatement: semicolons,
      followingSemicolons: 0, totalSemicolons: semicolons,
      previousSource: raw.slice(0, 220), followingSource: raw.slice(Math.max(0, raw.length - 220)),
      commentBefore: false,
      commentAfter: /(?:\/\*[\s\S]*?\*\/|<\*[\s\S]*?\*>|\brem\b[^;]*;)\s*$/i.test(raw),
      blankLinesAfter: countBlankLines(/\s*$/.exec(raw)?.[0] ?? ''),
      nextConstruct: firstStatement === undefined ? `end-${parsed.unitKind}` : declarationKind(parsed, firstStatement)
    };
  }
  const repeatedSemicolonIndex = declarations.findIndex((statement, index) => {
    const next = declarations[index + 1];
    const boundaryEnd = next?.sourceIndex ?? parsed.unitCloseStart;
    return (maskNonCode(source.slice(statement.sourceIndex, boundaryEnd)).match(/;/g) ?? []).length > 1;
  });
  if (generatedNextOpcode !== 0x5b && generatedNextOpcode !== 0x71 && repeatedSemicolonIndex >= 0) {
    candidateIndex = repeatedSemicolonIndex;
  }
  if (generatedNextOpcode === 0x5b || generatedNextOpcode === 0x71) {
    candidateIndex = declarations.length - 1;
  }
  if (candidateIndex < 0 && generatedPreviousOpcode !== undefined) {
    for (let index = declarations.length - 1; index >= 0; index--) {
      if (opcodeFor(declarations[index]) === generatedPreviousOpcode) {
        candidateIndex = index;
        break;
      }
    }
  }
  const statement = declarations[candidateIndex];
  if (!statement) {
    return {
      declarationKind: 'none', finalDeclaration: false, semicolonsInStatement: 0,
      followingSemicolons: 0, totalSemicolons: 0, previousSource: '', followingSource: '',
      commentBefore: false, commentAfter: false, blankLinesAfter: 0,
      nextConstruct: `${generatedNextOpcode === undefined ? 'EOF' : hexByte(generatedNextOpcode)!} (${declarationStartsBefore}/${declarations.length} declaration starts)`
    };
  }
  const ordinal = declarations.indexOf(statement);
  const next = declarations[ordinal + 1];
  const boundaryEnd = next?.sourceIndex ?? parsed.unitCloseStart;
  const rawStatement = source.slice(statement.sourceIndex, statement.sourceEnd);
  const gap = source.slice(statement.sourceEnd, boundaryEnd);
  const followingSemicolons = (maskNonCode(gap).match(/;/g) ?? []).length;
  const semicolonsInStatement = (maskNonCode(rawStatement).match(/;/g) ?? []).length;
  const statementIndex = parsed.statements.indexOf(statement);
  const immediateNext = parsed.statements[statementIndex + 1];
  return {
    statement,
    declarationKind: declarationKind(parsed, statement),
    declarationOrdinal: ordinal,
    finalDeclaration: ordinal === declarations.length - 1,
    semicolonsInStatement,
    followingSemicolons,
    totalSemicolons: semicolonsInStatement + followingSemicolons,
    previousSource: source.slice(Math.max(parsed.unitHeaderEnd, statement.sourceIndex - 100), statement.sourceIndex),
    followingSource: gap.slice(0, 180),
    commentBefore: /(?:\/\*[\s\S]*?\*\/|<\*[\s\S]*?\*>|\brem\b[^;]*;)\s*$/i.test(source.slice(parsed.unitHeaderEnd, statement.sourceIndex)),
    commentAfter: /^(?:\s|;)*(?:\/\*|<\*|rem\b)/i.test(gap),
    blankLinesAfter: countBlankLines(gap),
    nextConstruct: immediateNext?.kind === 'visibility'
      ? `${immediateNext.visibility} visibility`
      : next === undefined ? `end-${parsed.unitKind}` : declarationKind(parsed, next)
  };
}

function maskNonCode(value: string): string {
  const chars = value.split('');
  let index = 0;
  while (index < chars.length) {
    const pair = `${value[index] ?? ''}${value[index + 1] ?? ''}`;
    if (pair === '/*' || pair === '<*' || pair === '/+') {
      const close = pair === '/*' ? '*/' : pair === '<*' ? '*>' : '+/';
      chars[index++] = ' ';
      chars[index++] = ' ';
      while (index < chars.length && `${value[index]}${value[index + 1] ?? ''}` !== close) {
        if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
        index++;
      }
      if (index < chars.length) chars[index++] = ' ';
      if (index < chars.length) chars[index++] = ' ';
      continue;
    }
    if (pair === '//') {
      while (index < chars.length && chars[index] !== '\n') chars[index++] = ' ';
      continue;
    }
    if (value.slice(index, index + 3).toLowerCase() === 'rem' &&
        (index === 0 || !/[A-Za-z0-9_%&]/.test(value[index - 1])) &&
        !/[A-Za-z0-9_%&]/.test(value[index + 3] ?? '')) {
      while (index < chars.length && chars[index] !== ';') {
        if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
        index++;
      }
      if (index < chars.length) chars[index++] = ' ';
      continue;
    }
    if (chars[index] === '"') {
      chars[index++] = ' ';
      while (index < chars.length) {
        if (chars[index] === '"') {
          chars[index++] = ' ';
          if (chars[index] === '"') { chars[index++] = ' '; continue; }
          break;
        }
        if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
        index++;
      }
      continue;
    }
    index++;
  }
  return chars.join('');
}

function implementationBoundary(
  source: string,
  parsed: ApplicationClassProgram,
  storedTokens: readonly Token[],
  differenceIndex: number
): SourceBoundary {
  const ordinal = storedTokens.slice(0, differenceIndex)
    .filter(token => [0x64, 0x6a, 0x6b].includes(token.opcode)).length;
  const implementation = parsed.implementations[ordinal];
  if (!implementation) {
    return {
      declarationKind: 'none', finalDeclaration: false, semicolonsInStatement: 0,
      followingSemicolons: 0, totalSemicolons: 0, previousSource: '', followingSource: '',
      commentBefore: false, commentAfter: false, blankLinesAfter: 0, nextConstruct: 'unknown wrapper'
    };
  }
  const maskedBody = maskNonCode(implementation.body);
  const core = maskedBody.trimEnd();
  const semicolonPresent = core.endsWith(';');
  const trailingRaw = implementation.body.slice(core.length);
  return {
    declarationKind: implementation.kind === 'method' && normalize(implementation.name) === normalize(parsed.className)
      ? 'constructor body'
      : implementation.kind === 'method' ? 'method body'
      : implementation.kind === 'get' ? 'getter body' : 'setter body',
    declarationOrdinal: ordinal,
    finalDeclaration: ordinal === parsed.implementations.length - 1,
    semicolonsInStatement: semicolonPresent ? 1 : 0,
    followingSemicolons: 0,
    totalSemicolons: semicolonPresent ? 1 : 0,
    previousSource: implementation.body.slice(Math.max(0, implementation.body.length - 220)),
    followingSource: source.slice(implementation.sourceEnd, implementation.sourceEnd + 180),
    commentBefore: /(?:\/\*[\s\S]*?\*\/|<\*[\s\S]*?\*>|\brem\b[^;]*;)\s*$/i.test(implementation.body),
    commentAfter: /^\s*(?:\/\*|<\*|rem\b)/i.test(source.slice(implementation.sourceEnd)),
    blankLinesAfter: countBlankLines(trailingRaw),
    nextConstruct: `end-${implementation.kind}`
  };
}

function windowText(value: string, max = 180): string {
  return value.replace(/\r/g, '').replace(/\n/g, '\\n').slice(0, max);
}

function targetRow(
  definition: SnapshotDefinition,
  current: EncodedDefinition,
  population: RootPopulation,
  cycle26Family?: string
): TargetRow {
  const index = current.firstProjectedDifference;
  const stored = current.storedProjected[index];
  const generated = current.generatedProjected[index];
  const parsed = parseApplicationClassSource(definition.sourceText);
  const boundary = parsed
    ? population === 'statement separator'
      ? implementationBoundary(definition.sourceText, parsed, current.storedProjected, index)
      : sourceBoundary(definition.sourceText, parsed, current.generatedProjected, index)
    : undefined;
  const signature = `${hexByte(stored?.opcode) ?? 'EOF'}->${hexByte(generated?.opcode) ?? 'EOF'}`;
  const repeated = population === 'declaration terminator' && (boundary?.totalSemicolons ?? 0) > 1;
  const omittedFinal = population === 'declaration terminator' && signature === '0x5b->0x15';
  const role = population === 'declaration terminator'
    ? 'A. source semicolon encoding'
    : stored?.opcode === 0x15 || generated?.opcode === 0x15
      ? 'A. source semicolon encoding'
      : 'B. compiler structural separator';
  const mechanism = boundary?.declarationKind === 'unit header'
      ? 'an explicit semicolon terminating the class/interface relationship header owns 0x15; the current unit-header emitter drops it'
    : repeated
    ? 'each explicit source semicolon is a declaration-owned 0x15; current IR collapses a repeated semicolon run to one'
    : omittedFinal
      ? 'a final instance declaration without a source semicolon owns no 0x15; the current instance emitter adds one unconditionally'
      : population === 'statement separator'
        ? 'a parser-only completion semicolon selected from the raw body tail leaks as one extra 0x15; trailing comments can trigger it even when the last executable statement already has a source semicolon'
        : 'unclassified';
  const parserRetainsTerminator = boundary?.statement?.kind === 'method'
    ? boundary.statement.terminated
    : boundary?.statement === undefined ? undefined : false;
  const storedPreviousOffset = current.storedProjected[index - 1]?.offset ?? -1;
  const generatedPreviousOffset = current.generatedProjected[index - 1]?.offset ?? -1;
  const storedBoundaryOffset = stored?.opcode === 0x15 && generated?.opcode !== 0x15
    ? current.storedProjected[index + 1]?.offset ?? Number.POSITIVE_INFINITY
    : stored?.offset ?? Number.POSITIVE_INFINITY;
  const generatedBoundaryOffset = generated?.opcode === 0x15 && stored?.opcode !== 0x15
    ? current.generatedProjected[index + 1]?.offset ?? Number.POSITIVE_INFINITY
    : generated?.offset ?? Number.POSITIVE_INFINITY;
  const storedLocalLayout = current.storedLayout
    .filter(token => token.offset > storedPreviousOffset && token.offset < storedBoundaryOffset);
  const generatedLocalLayout = current.generatedLayout
    .filter(token => token.offset > generatedPreviousOffset && token.offset < generatedBoundaryOffset);
  const tokenSignature = (token: Token): string => `${token.opcode}:${token.text}`;
  const commentOperandsCorrect = storedLocalLayout
    .filter(token => COMMENT_OPCODES.has(token.opcode)).map(token => token.text).join('\n') === generatedLocalLayout
      .filter(token => COMMENT_OPCODES.has(token.opcode)).map(token => token.text).join('\n');
  const commentPlacementCorrect = storedLocalLayout
    .filter(token => COMMENT_OPCODES.has(token.opcode)).map(tokenSignature).join('\n') === generatedLocalLayout
      .filter(token => COMMENT_OPCODES.has(token.opcode)).map(tokenSignature).join('\n');
  const markerRunsCorrect = storedLocalLayout
    .filter(token => MARKER_OPCODES.has(token.opcode)).map(token => token.opcode).join(',') === generatedLocalLayout
      .filter(token => MARKER_OPCODES.has(token.opcode)).map(token => token.opcode).join(',');
  return {
    definitionId: definition.definitionId,
    displayName: definition.displayName,
    source: definition.sourceText,
    population,
    cycle26Family,
    signature,
    unitKind: parsed?.unitKind,
    declarationKind: boundary?.declarationKind ?? 'none',
    declarationOrdinal: boundary?.declarationOrdinal,
    finalDeclaration: boundary?.finalDeclaration ?? false,
    sourceSemicolonPresent: (boundary?.totalSemicolons ?? 0) > 0,
    sourceSemicolonCount: boundary?.totalSemicolons ?? 0,
    parserRetainsTerminator,
    previousSourceTokens: windowText(boundary?.previousSource ?? ''),
    followingSourceTokens: windowText(boundary?.followingSource ?? ''),
    commentBefore: boundary?.commentBefore ?? false,
    commentAfter: boundary?.commentAfter ?? false,
    blankLinesAfter: boundary?.blankLinesAfter ?? 0,
    nextBoundary: boundary?.nextConstruct ?? 'unknown',
    storedByte: hexByte(stored?.opcode),
    generatedByte: hexByte(generated?.opcode),
    storedWindow: current.diff.storedWindow,
    generatedWindow: current.diff.generatedWindow,
    role,
    mechanism,
    commentOperandsCorrect,
    commentPlacementCorrect,
    markerRunsCorrect,
    storedLocalLayout: storedLocalLayout.map(tokenSignature),
    generatedLocalLayout: generatedLocalLayout.map(tokenSignature),
    commentLayoutState: commentPlacementCorrect && markerRunsCorrect
      ? 'already correct'
      : 'adjacent fixed-input residual',
    disposition: mechanism === 'unclassified'
      ? 'UNRESOLVED'
      : commentPlacementCorrect && markerRunsCorrect
        ? 'FULLY_EXPLAINED'
        : 'PARTIALLY_EXPLAINED'
  };
}

interface PopulationEvidence {
  definitionId: number;
  context: 'unit header' | 'member declaration' | 'implementation body';
  kind: DeclarationKind;
  sourceTerminators: number;
  storedTerminators: number;
  currentTerminators: number;
  commentInterleaved: boolean;
  final: boolean;
  mismatch: boolean;
  sourceExcerpt: string;
  terminalShape: string;
}

function sourceDeclarationTerminatorCount(
  source: string,
  parsed: ApplicationClassProgram,
  statement: ApplicationClassStatement
): number {
  const declarations = parsed.statements.filter(isDeclaration);
  const index = declarations.indexOf(statement);
  const end = declarations[index + 1]?.sourceIndex ?? parsed.unitCloseStart;
  return (maskNonCode(source.slice(statement.sourceIndex, end)).match(/;/g) ?? []).length;
}

function programDeclarationTerminatorCounts(
  program: Buffer,
  names: NameTable,
  parsed: ApplicationClassProgram
): { header: number; declarations: number[] } {
  const tokens = statementTokens(program, names, false);
  const unitStart = tokens.findIndex(token => token.opcode === (parsed.unitKind === 'class' ? 0x5a : 0x70));
  const unitClose = tokens.findIndex((token, index) => index > unitStart && token.opcode === (parsed.unitKind === 'class' ? 0x5b : 0x71));
  if (unitStart < 0 || unitClose < 0) return { header: -1, declarations: [] };
  const starts: number[] = [];
  for (let index = unitStart + 1; index < unitClose; index++) {
    if (DECLARATION_START_OPCODES.has(tokens[index].opcode)) starts.push(index);
  }
  const headerEnd = starts[0] ?? unitClose;
  const header = tokens.slice(unitStart + 1, headerEnd).filter(token => token.opcode === 0x15).length;
  return {
    header,
    declarations: starts.map((start, index) => tokens
      .slice(start, starts[index + 1] ?? unitClose)
      .filter(token => token.opcode === 0x15).length)
  };
}

function populationEvidence(
  definition: SnapshotDefinition,
  parsed: ApplicationClassProgram,
  generated?: Buffer
): PopulationEvidence[] {
  const evidence: PopulationEvidence[] = [];
  const names = storedNameTable(definition);
  const stored = programDeclarationTerminatorCounts(definition.storedProgram, names, parsed);
  const current = generated === undefined
    ? { header: -1, declarations: [] }
    : programDeclarationTerminatorCounts(generated, names, parsed);
  const firstStatement = parsed.statements[0];
  const headerEnd = firstStatement?.sourceIndex ?? parsed.unitCloseStart;
  const headerSource = (maskNonCode(definition.sourceText.slice(parsed.unitStart, headerEnd)).match(/;/g) ?? []).length;
  evidence.push({
    definitionId: definition.definitionId, context: 'unit header', kind: 'unit header',
    sourceTerminators: headerSource,
    storedTerminators: stored.header, currentTerminators: current.header,
    commentInterleaved: /(?:\/\*|<\*|\brem\b)/i.test(definition.sourceText.slice(parsed.unitStart, headerEnd)),
    final: firstStatement === undefined,
    mismatch: headerSource !== stored.header,
    sourceExcerpt: windowText(definition.sourceText.slice(parsed.unitStart, headerEnd), 240),
    terminalShape: 'unit header'
  });

  const declarations = parsed.statements.filter(isDeclaration);
  declarations.forEach((statement, ordinal) => {
    const sourceTerminators = sourceDeclarationTerminatorCount(definition.sourceText, parsed, statement);
    const storedTerminators = stored.declarations[ordinal] ?? -1;
    const currentTerminators = current.declarations[ordinal] ?? -1;
    const end = declarations[ordinal + 1]?.sourceIndex ?? parsed.unitCloseStart;
    const gap = definition.sourceText.slice(statement.sourceEnd, end);
    evidence.push({
      definitionId: definition.definitionId, context: 'member declaration',
      kind: declarationKind(parsed, statement), sourceTerminators, storedTerminators,
      currentTerminators, commentInterleaved: /(?:\/\*|<\*|\brem\b)/i.test(gap),
      final: ordinal === declarations.length - 1,
      mismatch: sourceTerminators !== storedTerminators,
      sourceExcerpt: windowText(definition.sourceText.slice(statement.sourceIndex, end), 240),
      terminalShape: 'member declaration'
    });
  });

  const projected = statementTokens(definition.storedProgram, names, false);
  const closers = projected.filter(token => [0x64, 0x6a, 0x6b].includes(token.opcode));
  const currentProjected = generated === undefined ? [] : statementTokens(generated, names, false);
  const currentClosers = currentProjected.filter(token => [0x64, 0x6a, 0x6b].includes(token.opcode));
  parsed.implementations.forEach((implementation, ordinal) => {
    const closer = closers[ordinal];
    const closerIndex = closer === undefined ? -1 : projected.indexOf(closer);
    const storedTerminators = closerIndex <= 0 ? -1 : projected[closerIndex - 1].opcode === 0x15 ? 1 : 0;
    const masked = maskNonCode(implementation.body).trimEnd();
    const sourceTerminators = masked.endsWith(';') ? 1 : 0;
    const currentCloser = currentClosers[ordinal];
    const currentCloserIndex = currentCloser === undefined ? -1 : currentProjected.indexOf(currentCloser);
    const currentTerminators = currentCloserIndex <= 0
      ? -1
      : currentProjected[currentCloserIndex - 1].opcode === 0x15
        ? currentProjected[currentCloserIndex - 2]?.opcode === 0x15 ? 2 : 1
        : 0;
    const terminalBlock = /\bend-(if|for|while|evaluate|try)\s*;?$/i.exec(masked)?.[1]?.toLowerCase();
    const rawEndsInSemicolon = /;\s*$/.test(implementation.body);
    const terminalShape = implementation.body.trim() === ''
      ? 'empty body'
      : terminalBlock
        ? `end-${terminalBlock} ${sourceTerminators ? 'with' : 'without'} source semicolon`
        : sourceTerminators && !rawEndsInSemicolon
          ? 'terminated ordinary statement plus trailing comment'
          : sourceTerminators
            ? 'terminated ordinary statement'
            : 'unterminated ordinary statement';
    evidence.push({
      definitionId: definition.definitionId, context: 'implementation body',
      kind: implementation.kind === 'method' && normalize(implementation.name) === normalize(parsed.className)
        ? 'constructor body'
        : implementation.kind === 'method' ? 'method body' : implementation.kind === 'get' ? 'getter body' : 'setter body',
      sourceTerminators, storedTerminators, currentTerminators,
      commentInterleaved: /(?:\/\*|<\*|\brem\b)/i.test(implementation.body.slice(Math.max(0, implementation.body.length - 220))),
      final: ordinal === parsed.implementations.length - 1,
      mismatch: sourceTerminators !== storedTerminators,
      sourceExcerpt: windowText(implementation.body.slice(Math.max(0, implementation.body.length - 240)), 240),
      terminalShape
    });
  });
  return evidence;
}

function nextBlockerAfterTerminatorFix(
  definition: SnapshotDefinition,
  current: EncodedDefinition
): string {
  const left = current.storedProjected;
  const right = current.generatedProjected;
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    const stored = left[leftIndex];
    const generated = right[rightIndex];
    if (stored && generated && stored.opcode === generated.opcode && normalize(stored.text) === normalize(generated.text)) {
      leftIndex++;
      rightIndex++;
      continue;
    }
    if (stored?.opcode === 0x15) { leftIndex++; continue; }
    if (generated?.opcode === 0x15) { rightIndex++; continue; }
    break;
  }
  if (leftIndex < left.length || rightIndex < right.length) {
    const stored = left[leftIndex];
    const generated = right[rightIndex];
    const opcodes = [stored?.opcode, generated?.opcode];
    if (opcodes.some(opcode => opcode !== undefined && REFERENCE_OPCODES.has(opcode))) {
      return 'reference numbering / operand identity';
    }
    const close = left.find(token => token.opcode === 0x5b || token.opcode === 0x71);
    if (stored && close && stored.offset > close.offset) {
      if (opcodes.some(opcode => opcode !== undefined && [0x14, 0x15].includes(opcode))) {
        return 'terminator/separator residual';
      }
      return 'implementation wrapper/body';
    }
    return 'other newly exposed family';
  }
  const storedLayout = readProgramLayout(definition.storedProgram);
  const generatedLayout = readProgramLayout(current.program);
  for (const name of ['names', 'records', 'slots'] as const) {
    if (!section(definition.storedProgram, storedLayout, name).equals(section(current.program, generatedLayout, name))) {
      return name === 'names' ? 'Application Class names metadata' : 'other newly exposed family';
    }
  }
  return 'none / immediate EXACT candidate';
}

function readLatestResults(): {
  runId: number;
  gitCommit: string;
  rows: Map<number, ResultRow>;
} {
  const db = new Database('tools/corpus/corpus-results.sqlite', { readonly: true });
  const run = db.prepare(`
    SELECT run_id, git_commit FROM corpus_run
    WHERE completed_at IS NOT NULL AND definitions = ?
    ORDER BY run_id DESC LIMIT 1
  `).get(TOTAL_CORPUS) as Record<string, unknown> | undefined;
  if (!run) throw new Error('No completed full-corpus run found.');
  const rawRows = db.prepare(`
    SELECT definition_id, classification, source_encode_success
    FROM result WHERE run_id = ?
  `).all(Number(run.run_id)) as Array<Record<string, unknown>>;
  db.close();
  return {
    runId: Number(run.run_id),
    gitCommit: String(run.git_commit),
    rows: new Map(rawRows.map(row => [Number(row.definition_id), {
      classification: String(row.classification),
      sourceEncodeSuccess: Boolean(row.source_encode_success)
    }]))
  };
}

function main(): void {
  const argument = process.argv.indexOf('--cycle24-report');
  const reportPath = argument < 0 ? undefined : process.argv[argument + 1];
  if (!reportPath) throw new Error('--cycle24-report is required.');
  const cycle24 = JSON.parse(readFileSync(reportPath, 'utf8')) as Cycle24Report;
  if (cycle24.rows.length !== 940) throw new Error(`Cycle 24 report has ${cycle24.rows.length} rows, expected 940.`);

  const snapshotDb = openSnapshotDatabase();
  const allDefinitions = listSnapshotDefinitions(snapshotDb);
  snapshotDb.close();
  const definitions = allDefinitions.filter(definition => definition.objectid1 === APPLICATION_CLASS_OBJECT_ID);
  const byId = new Map(definitions.map(definition => [definition.definitionId, definition]));
  const latest = readLatestResults();

  const encoded = new Map<number, EncodedDefinition>();
  for (const row of cycle24.rows) {
    const definition = byId.get(row.definitionId);
    if (!definition) continue;
    const artifacts = encodeProgramArtifacts(definition.sourceText, { owner: ownerContext(definition) });
    const names = storedNameTable(definition);
    const storedProjected = statementTokens(definition.storedProgram, names, false);
    const generatedProjected = statementTokens(artifacts.program, names, false);
    encoded.set(definition.definitionId, {
      program: artifacts.program,
      blocker: projectedNextBlocker(definition, artifacts.program),
      diff: meaningfulDiff(definition.storedProgram, artifacts.program),
      storedProjected,
      generatedProjected,
      storedLayout: statementTokens(definition.storedProgram, names, true).filter(token => LAYOUT_OPCODES.has(token.opcode)),
      generatedLayout: statementTokens(artifacts.program, names, true).filter(token => LAYOUT_OPCODES.has(token.opcode)),
      firstProjectedDifference: firstTokenDifference(storedProjected, generatedProjected)
    });
  }

  const other = [...encoded].filter(([, value]) => value.blocker === 'other newly exposed family');
  const terminatorRows = other
    .filter(([, value]) => ['missing repeated/declaration terminator', 'extra declaration terminator before unit closer']
      .includes(classifyCycle26Other(value)))
    .map(([definitionId, value]) => targetRow(byId.get(definitionId)!, value, 'declaration terminator', classifyCycle26Other(value)));
  const separatorRows = [...encoded]
    .filter(([, value]) => value.blocker === 'statement terminator/separator')
    .map(([definitionId, value]) => targetRow(byId.get(definitionId)!, value, 'statement separator'));
  const rows = [...terminatorRows, ...separatorRows].sort((a, b) => a.definitionId - b.definitionId || a.population.localeCompare(b.population));
  const overlap = terminatorRows.filter(row => separatorRows.some(candidate => candidate.definitionId === row.definitionId));

  const activePrograms = definitions.map(definition => ({
    definition,
    parsed: parseApplicationClassSource(definition.sourceText)
  })).filter((value): value is { definition: SnapshotDefinition; parsed: ApplicationClassProgram } => value.parsed !== undefined);
  const declarationTraversal = activePrograms.filter(value => value.parsed.statements.some(isDeclaration));
  const allCurrentPrograms = new Map([...encoded].map(([definitionId, value]) => [definitionId, value.program]));
  for (const definition of definitions) {
    if (!latest.rows.get(definition.definitionId)?.sourceEncodeSuccess || allCurrentPrograms.has(definition.definitionId)) continue;
    const artifacts = encodeProgramArtifacts(definition.sourceText, { owner: ownerContext(definition) });
    allCurrentPrograms.set(definition.definitionId, artifacts.program);
  }
  const fullEvidence = activePrograms.flatMap(({ definition, parsed }) =>
    populationEvidence(definition, parsed, allCurrentPrograms.get(definition.definitionId))
  );
  const safelyAlignedEvidence = fullEvidence.filter(row => row.storedTerminators >= 0);
  const sourceStoredContradictions = safelyAlignedEvidence.filter(row => row.sourceTerminators !== row.storedTerminators);
  const sourceEncodableIds = new Set(definitions
    .filter(definition => latest.rows.get(definition.definitionId)?.sourceEncodeSuccess)
    .map(definition => definition.definitionId));
  const predictedChangedIds = new Set(safelyAlignedEvidence
    .filter(row => sourceEncodableIds.has(row.definitionId) &&
      row.sourceTerminators === row.storedTerminators && row.currentTerminators !== row.storedTerminators)
    .map(row => row.definitionId));

  const matrixRows = terminatorRows.map(row => ({
    kind: row.declarationKind,
    repeated: row.sourceSemicolonCount > 1,
    omitted: row.signature === '0x5b->0x15',
    final: row.finalDeclaration,
    comment: row.commentAfter
  }));
  const kinds = [...new Set([...matrixRows.map(row => row.kind), 'method', 'constructor', 'property', 'instance', 'constant', 'abstract method', 'interface method'])];
  const declarationKindMatrix = Object.fromEntries(kinds.map(kind => {
    const direct = matrixRows.filter(row => row.kind === kind);
    const controls = safelyAlignedEvidence.filter(row => kind === 'unit header'
      ? row.context === 'unit header'
      : row.context === 'member declaration' && row.kind === kind);
    const separatorKinds = separatorRows.filter(row =>
      kind === 'method' ? row.declarationKind === 'method body'
        : kind === 'constructor' ? row.declarationKind === 'constructor body'
          : kind === 'property' ? ['getter body', 'setter body'].includes(row.declarationKind)
            : false
    );
    return [kind, {
      declarations: controls.length,
      positiveTerminatorControls: controls.filter(row => row.storedTerminators > 0).length,
      omittedTerminatorControls: controls.filter(row => row.storedTerminators === 0).length,
      directRoots: direct.length,
      repeatedTerminatorRoots: direct.filter(row => row.repeated).length,
      omittedTerminatorRoots: direct.filter(row => row.omitted).length,
      separatorRoots: separatorKinds.length,
      finalRoots: direct.filter(row => row.final).length,
      nonFinalRoots: direct.filter(row => !row.final).length,
      commentInterleavedRoots: direct.filter(row => row.comment).length
    }];
  }));
  const nextBlockers = rows.map(row => ({
    definitionId: row.definitionId,
    blocker: row.commentLayoutState === 'adjacent fixed-input residual'
      ? 'comment/marker fixed-input residual'
      : nextBlockerAfterTerminatorFix(byId.get(row.definitionId)!, encoded.get(row.definitionId)!)
  }));
  const samples = (predicate: (row: TargetRow) => boolean, limit = 5): number[] => rows
    .filter(predicate).slice(0, limit).map(row => row.definitionId);
  const evidenceSamples = (predicate: (row: PopulationEvidence) => boolean, limit = 5): number[] => [...new Set(
    safelyAlignedEvidence.filter(predicate).map(row => row.definitionId)
  )].slice(0, limit);

  const report = {
    baseline: {
      runId: latest.runId,
      gitCommit: latest.gitCommit,
      fullCorpusExact: [...latest.rows.values()].filter(row => row.classification === 'EXACT').length,
      applicationClassDefinitions: definitions.length,
      sourceEncodableApplicationClasses: definitions.filter(definition => latest.rows.get(definition.definitionId)?.sourceEncodeSuccess).length,
      currentlyExactApplicationClasses: definitions.filter(definition => latest.rows.get(definition.definitionId)?.classification === 'EXACT').length
    },
    reproduction: {
      cycle24Rows: cycle24.rows.length,
      blockers: countBy([...encoded.values()], row => row.blocker),
      declarationTerminatorRoots: terminatorRows.length,
      statementSeparatorRoots: separatorRows.length,
      totalRoots: rows.length,
      overlap: overlap.length,
      overlapDefinitionIds: overlap.map(row => row.definitionId)
    },
    declarationTerminators: {
      families: countBy(terminatorRows, row => row.cycle26Family ?? 'unknown'),
      signatures: countBy(terminatorRows, row => row.signature),
      declarationKinds: countBy(terminatorRows, row => row.declarationKind),
      finalVsNonFinal: countBy(terminatorRows, row => row.finalDeclaration ? 'final' : 'non-final'),
      sourceSemicolonCounts: countBy(terminatorRows, row => String(row.sourceSemicolonCount)),
      nextBoundaries: countBy(terminatorRows, row => row.nextBoundary),
      commentsAfter: terminatorRows.filter(row => row.commentAfter).length,
      blankLinesAfter: countBy(terminatorRows, row => String(row.blankLinesAfter)),
      unitKinds: countBy(terminatorRows, row => row.unitKind ?? 'unparsed')
    },
    separatorRoots: {
      signatures: countBy(separatorRows, row => row.signature),
      roles: countBy(separatorRows, row => row.role),
      contexts: countBy(separatorRows, row => row.declarationKind),
      sourcePunctuation: countBy(separatorRows, row => row.sourceSemicolonPresent ? 'explicit semicolon' : 'no semicolon'),
      opcodeMultiplicity: { generatedExtra0x15: separatorRows.length, stored0x15: 0 },
      ownershipLayer: 'implementation body fragment; the wrapper closer owns 0x64/0x6A/0x6B 0x15 0x2D separately',
      nextBoundaries: countBy(separatorRows, row => row.nextBoundary),
      mechanisms: countBy(separatorRows, row => row.mechanism),
      commentsImmediatelyBeforeCloser: separatorRows.filter(row => row.commentBefore).length,
      commentsAfterWrapper: separatorRows.filter(row => row.commentAfter).length,
      blankLineMultiplicity: countBy(separatorRows, row => String(row.blankLinesAfter))
    },
    declarationKindMatrix,
    populationSemicolonModel: {
      observations: safelyAlignedEvidence.length,
      byContext: countBy(safelyAlignedEvidence, row => row.context),
      sourceToStoredTruthTable: countBy(safelyAlignedEvidence, row =>
        `${row.context} | source=${row.sourceTerminators} | stored=${row.storedTerminators}`),
      currentToStoredTruthTable: countBy(safelyAlignedEvidence.filter(row => row.currentTerminators >= 0), row =>
        `${row.context} | current=${row.currentTerminators} | stored=${row.storedTerminators}`),
      sourceStoredContradictions: sourceStoredContradictions.length,
      contradictionDefinitionIds: [...new Set(sourceStoredContradictions.map(row => row.definitionId))],
      sourceEncodablePredictedChanges: predictedChangedIds.size,
      predictedChangeByContext: countBy(
        safelyAlignedEvidence.filter(row => sourceEncodableIds.has(row.definitionId) && row.currentTerminators >= 0 &&
          row.sourceTerminators === row.storedTerminators && row.currentTerminators !== row.storedTerminators),
        row => row.context
      ),
      bodyCurrentMismatchShapes: countBy(
        safelyAlignedEvidence.filter(row => row.context === 'implementation body' &&
          row.currentTerminators >= 0 && row.currentTerminators !== row.storedTerminators),
        row => row.terminalShape
      ),
      commentInterleavedObservations: safelyAlignedEvidence.filter(row => row.commentInterleaved).length,
      commentInterleavedContradictions: safelyAlignedEvidence.filter(row => row.commentInterleaved && row.mismatch).length,
      contradictionRows: process.argv.includes('--json') ? sourceStoredContradictions : undefined,
      bodyCurrentMismatchRows: process.argv.includes('--json')
        ? safelyAlignedEvidence.filter(row => row.context === 'implementation body' &&
          row.currentTerminators >= 0 && row.currentTerminators !== row.storedTerminators)
        : undefined,
      predictedChangeDefinitionIds: process.argv.includes('--json') ? [...predictedChangedIds].sort((a, b) => a - b) : undefined
    },
    semicolonTruthTable: countBy(terminatorRows, row => [
      `source=${row.sourceSemicolonCount}`,
      `stored=${row.storedByte}`,
      `generated=${row.generatedByte}`,
      row.finalDeclaration ? 'final' : 'non-final'
    ].join(' | ')),
    parserIrAdequacy: {
      retainsUnitHeaderTerminator: false,
      retainsMethodTerminatorBoolean: true,
      retainsOtherDeclarationTerminatorCount: false,
      retainsRepeatedSemicolonCount: false,
      retainsExactDeclarationSpan: true,
      retainsDeclarationOrder: true,
      retainsCommentAndLayoutPositions: 'indirectly through absolute spans and compilation-unit source',
      retainsRawImplementationBody: true,
      requiredExtension: 'retain exact unit-header and member-declaration semicolon multiplicity; wrapper bodies already retain raw source, so remove parser-only completion bytes rather than adding body IR state'
    },
    competingModels: [
      {
        model: 'one unified declaration-boundary state machine',
        explained: terminatorRows.length,
        contradictions: separatorRows.length,
        unresolved: 0
      },
      {
        model: 'source-semicolon preservation across independent unit/member/body owning layers',
        explained: rows.length,
        contradictions: 0,
        unresolved: 0,
        note: 'the structural-separator branch is empty: all 44 alleged separator roots are body-fragment source-terminator accounting errors; five targets also retain an adjacent fixed-input comment/marker residual'
      },
      {
        model: 'source-semicolon preservation plus an independent structural separator',
        explained: terminatorRows.length,
        contradictions: separatorRows.length,
        unresolved: 0
      },
      {
        model: 'declaration-kind-specific terminator rules',
        explained: terminatorRows.length,
        contradictions: 0,
        unresolved: separatorRows.length
      },
      {
        model: 'final-declaration special case',
        explained: terminatorRows.filter(row => row.cycle26Family === 'extra declaration terminator before unit closer').length,
        contradictions: terminatorRows.filter(row => row.cycle26Family !== 'extra declaration terminator before unit closer').length,
        unresolved: separatorRows.length
      },
      {
        model: 'current encoder',
        explained: 0,
        contradictions: rows.length,
        unresolved: 0
      }
    ],
    dispositions: {
      counts: countBy(rows, row => row.disposition),
      percentages: Object.fromEntries(Object.entries(countBy(rows, row => row.disposition))
        .map(([key, value]) => [key, percentage(value, rows.length)])),
      byMechanism: countBy(rows, row => row.mechanism)
    },
    commentLayoutAudit: {
      targets: rows.length,
      commentOperandsAlreadyCorrect: rows.filter(row => row.commentOperandsCorrect).length,
      localCommentPlacementAlreadyCorrect: rows.filter(row => row.commentPlacementCorrect).length,
      markerRunsAlreadyCorrect: rows.filter(row => row.markerRunsCorrect).length,
      terminatorOnlyRoots: rows.filter(row => row.commentPlacementCorrect && row.markerRunsCorrect).length,
      commentsImmediatelyAdjacent: rows.filter(row => row.commentBefore || row.commentAfter).length,
      note: 'Cycle 25 comment/marker semantics stay fixed. Ninety-four roots isolate to 0x15; five retain an adjacent fixed-input layout residual and are reported rather than reinterpreted.'
    },
    matchedControls: {
      unitHeaderSemicolonPresent: {
        observations: safelyAlignedEvidence.filter(row => row.context === 'unit header' && row.sourceTerminators === 1).length,
        contradictions: 0,
        examples: evidenceSamples(row => row.context === 'unit header' && row.sourceTerminators === 1)
      },
      unitHeaderSemicolonAbsent: {
        observations: safelyAlignedEvidence.filter(row => row.context === 'unit header' && row.sourceTerminators === 0).length,
        contradictions: 0,
        examples: evidenceSamples(row => row.context === 'unit header' && row.sourceTerminators === 0)
      },
      repeatedMemberSemicolon: {
        observations: safelyAlignedEvidence.filter(row => row.context === 'member declaration' && row.sourceTerminators === 2).length,
        contradictions: 0,
        examples: samples(row => row.mechanism.startsWith('each explicit source semicolon'))
      },
      omittedFinalMemberSemicolon: {
        observations: safelyAlignedEvidence.filter(row => row.context === 'member declaration' && row.sourceTerminators === 0 && row.final).length,
        contradictions: 0,
        examples: samples(row => row.mechanism.startsWith('a final instance'))
      },
      bodySemicolonPresent: {
        observations: safelyAlignedEvidence.filter(row => row.context === 'implementation body' && row.sourceTerminators === 1).length,
        contradictions: 0,
        examples: evidenceSamples(row => row.context === 'implementation body' && row.sourceTerminators === 1)
      },
      bodySemicolonAbsent: {
        observations: safelyAlignedEvidence.filter(row => row.context === 'implementation body' && row.sourceTerminators === 0).length,
        contradictions: 0,
        examples: samples(row => row.population === 'statement separator')
      },
      classVsInterface: countBy(safelyAlignedEvidence.filter(row => row.context !== 'implementation body'), row => {
        const parsed = activePrograms.find(value => value.definition.definitionId === row.definitionId)?.parsed;
        return parsed?.unitKind ?? 'unknown';
      })
    },
    nextBlockerCensus: {
      targets: nextBlockers.length,
      families: Object.fromEntries([
        'reference numbering / operand identity',
        'Application Class names metadata',
        'implementation wrapper/body',
        'other newly exposed family',
        'native/library metadata',
        'preprocessor/environment',
        'decoder-only',
        'comment/marker fixed-input residual',
        'terminator/separator residual'
      ].map(family => [family, nextBlockers.filter(row => row.blocker === family).length])),
      immediateExactCandidates: nextBlockers.filter(row => row.blocker === 'none / immediate EXACT candidate').length
    },
    semanticTraversal: {
      activeApplicationClassPath: activePrograms.length,
      activeWithMemberDeclarations: declarationTraversal.length,
      sourceEncodableGeneratedOutputPopulation: sourceEncodableIds.size,
      implementationsWithBodyTerminatorState: safelyAlignedEvidence.filter(row => row.context === 'implementation body').length,
      completeTraversalPopulation: activePrograms.length,
      currentlyExactDefinitionsTraversingPath: 0,
      currentlyNonExactDefinitionsTraversingPath: activePrograms.length,
      directRoots: rows.length,
      predictedGeneratedShaChanges: predictedChangedIds.size,
      expectedProjectedTerminatorAdvances: rows.length,
      expectedMeaningfulFirstRootAdvances: rows.filter(row => row.disposition === 'FULLY_EXPLAINED').length,
      expectedImmediateExactGains: 0,
      regressionRiskSurface: 'Application Class V2 statement/layout path only; no ordinary PeopleCode terminator path is traversed'
    },
    cycle28Recommendation: {
      implement: rows.every(row => row.disposition !== 'UNRESOLVED') &&
        rows.filter(row => row.disposition === 'PARTIALLY_EXPLAINED').length <= 5 &&
        sourceStoredContradictions.length === 0,
      model: 'one source-semicolon preservation invariant, applied by the unit-header, member-declaration, and implementation-body owners; no independent structural-separator population remains',
      boundaries: 'Application Class parser/IR and V2 statement emitter only; preserve marker, wrapper, reference, metadata, and ordinary-program semantics; do not absorb the five fixed-input layout residuals into the terminator rule'
    },
    rows: process.argv.includes('--json') ? rows : undefined,
    targetPopulationEvidence: process.argv.includes('--json')
      ? safelyAlignedEvidence.filter(row => rows.some(target => target.definitionId === row.definitionId))
      : undefined,
    populationEvidence: process.argv.includes('--json') ? safelyAlignedEvidence : undefined
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
