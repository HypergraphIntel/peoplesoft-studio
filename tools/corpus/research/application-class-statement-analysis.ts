/**
 * Cycle 22: Application Class executable declaration-statement census.
 *
 * Read-only. Uses the completed local HCDEV snapshot, the latest completed
 * 30,209-definition corpus run, and the current local encoder/decoder. It does
 * not connect to Oracle and does not write corpus state.
 *
 * Usage:
 *   npx tsx tools/corpus/research/application-class-statement-analysis.ts
 *   npx tsx tools/corpus/research/application-class-statement-analysis.ts --json
 */

import Database from 'better-sqlite3';

import { decodeProgram, type Token } from '../../../src/peoplecode/decoder';
import {
  encodeProgramArtifacts,
  type PeopleCodeOwner
} from '../../../src/peoplecode/encoder';
import {
  PROGRAM_DIRECTORY_RECORD_SIZE,
  PROGRAM_DISPATCH_SLOT_SIZE,
  PROGRAM_HEADER_LENGTH,
  readProgramLayout,
  type ProgramLayout
} from '../../../src/peoplecode/programLayout';
import { NameTable } from '../../../src/peoplecode/progtext';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';
import type { SnapshotDefinition } from '../snapshot/types';

const TOTAL_CORPUS = 30_209;
const EXPECTED_EXACT = 23_217;
const EXPECTED_TARGET = 1_361;
const APPLICATION_CLASS_OBJECT_ID = 104;

const OP = {
  variable: 0x01,
  comma: 0x03,
  equals: 0x06,
  inlineName: 0x0a,
  openParen: 0x0b,
  closeParen: 0x14,
  semicolon: 0x15,
  string: 0x16,
  comment: 0x24,
  boundary: 0x2d,
  true: 0x2f,
  false: 0x30,
  as: 0x35,
  returns: 0x39,
  implementationMarker: 0x41,
  inlineComment: 0x4e,
  blankLine: 0x4f,
  integer: 0x50,
  constant: 0x56,
  colon: 0x57,
  import: 0x58,
  class: 0x5a,
  endClass: 0x5b,
  extends: 0x5c,
  out: 0x5d,
  property: 0x5e,
  get: 0x5f,
  readonly: 0x60,
  private: 0x61,
  instance: 0x62,
  method: 0x63,
  endMethod: 0x64,
  endGet: 0x6a,
  endSet: 0x6b,
  abstract: 0x6f,
  interface: 0x70,
  endInterface: 0x71,
  implements: 0x72,
  protected: 0x73,
  typeWord: 0x40
} as const;

const FLAGS = {
  private: 0x00010000,
  property: 0x00020000,
  storage: 0x00080000,
  getter: 0x00100000,
  setter: 0x00200000,
  self: 0x00400000,
  abstract: 0x00800000,
  protected: 0x01000000
} as const;

type Visibility = 'public' | 'private' | 'protected';
type UnitKind = 'class' | 'interface' | 'unparsed';
type DeclarationKind = 'method' | 'property' | 'instance' | 'constant';
type ImplementationKind = 'method' | 'get' | 'set';

interface FullRun {
  runId: number;
  gitCommit: string;
  definitions: number;
  exactCount: number;
  failureCount: number;
}

interface ResultRow {
  definitionId: number;
  displayName: string;
  classification: string;
  sourceEncodeSuccess: boolean;
  sourceEncodeExact: boolean;
  firstDiffOffset?: number;
  errorMessage?: string;
  storedDiffHex?: string;
  generatedDiffHex?: string;
}

interface Diff {
  section: 'header' | 'statements' | 'names' | 'records' | 'slots' | 'none';
  relativeOffset?: number;
  storedAbsoluteOffset?: number;
  generatedAbsoluteOffset?: number;
  storedByte?: number;
  generatedByte?: number;
  storedWindow?: string;
  generatedWindow?: string;
}

interface Parameter {
  name: string;
  type: string;
  out: boolean;
}

interface SourceDeclaration {
  kind: DeclarationKind;
  names: string[];
  type?: string;
  parameters?: Parameter[];
  returnType?: string;
  modifiers: string[];
  visibility: Visibility;
  sourceIndex: number;
  raw: string;
  constantValue?: string;
}

interface SourceEvent {
  kind: 'visibility' | 'declaration';
  index: number;
  visibility?: Exclude<Visibility, 'public'>;
  declaration?: SourceDeclaration;
}

interface SourceImplementation {
  kind: ImplementationKind;
  name: string;
  sourceIndex: number;
}

interface SourceModel {
  status: 'active' | 'entire-unit-commented' | 'no-source-unit';
  unitKind: UnitKind;
  name: string;
  unitStart: number;
  unitEnd: number;
  classRegionStart: number;
  classRegionEnd: number;
  extendsType?: string;
  implementsTypes: string[];
  events: SourceEvent[];
  declarations: SourceDeclaration[];
  implementations: SourceImplementation[];
  nativeLibraryDeclarations: number;
}

interface StoredDeclaration {
  kind: DeclarationKind;
  names: string[];
  type?: string;
  parameters?: Parameter[];
  returnType?: string;
  modifiers: string[];
  abstract: boolean;
  offset: number;
  endOffset: number;
  validSkeleton: boolean;
  terminated: boolean;
  constantValueOpcode?: number;
}

interface StoredEvent {
  kind: 'visibility' | 'declaration';
  offset: number;
  visibility?: Exclude<Visibility, 'public'>;
  declaration?: StoredDeclaration;
}

interface DirectoryRecord {
  index: number;
  name: string;
  signatureSlotOffset: number;
  flagsAndCount: number;
  flags: number;
  low: number;
  descriptor: number;
  kind: 'self' | 'property' | 'instance' | 'getter' | 'setter' | 'method';
}

interface SectionBoundaries {
  programHeader: [number, number];
  imports: [number, number];
  classHeader: [number, number];
  memberDeclarations: [number, number];
  postClassDeclarations: [number, number];
  implementations: [number, number];
  statementBoundary: [number, number];
  names: [number, number];
  records: [number, number];
  slots: [number, number];
}

interface StoredModel {
  tokens: Token[];
  unknownOpcodes: Array<{ offset: number; opcode: number }>;
  layout: ProgramLayout;
  classStart: number;
  classEndKeyword: number;
  classEnd: number;
  firstDeclaration: number;
  firstImplementation: number;
  relationships: Array<{ opcode: number; path: string; offset: number }>;
  events: StoredEvent[];
  declarations: StoredDeclaration[];
  implementations: SourceImplementation[];
  records: DirectoryRecord[];
  slots: number[];
  boundaries: SectionBoundaries;
}

interface TargetRow {
  result: ResultRow;
  definition: SnapshotDefinition;
  family: string;
  diff?: Diff;
  generated?: Buffer;
}

interface AnalysisRow {
  definitionId: number;
  displayName: string;
  source: string;
  cycle21Family: string;
  sourceEncodeSuccess: boolean;
  firstDiffOffset?: number;
  meaningfulDiff?: Diff;
  firstDivergence: {
    coordinate: 'stored/generated byte' | 'source error';
    offset?: number;
    storedWindow?: string;
    generatedWindow?: string;
  };
  sourceShape: {
    unitKind: UnitKind;
    extends: boolean;
    implements: number;
    declarations: Record<DeclarationKind, number>;
    implementations: number;
  };
  sourceDeclarationSequence: string[];
  implementationSequence: string[];
  storedDeclarationSequence: string[];
  storedImplementationSequence: string[];
  boundaries?: SectionBoundaries;
  directoryRecords: DirectoryRecord[];
  signatureSlots: number[];
  pspcmnameRows: SnapshotDefinition['names'];
  headerMatches: boolean;
  declarationOrderMatches: boolean;
  declarationGrammarMatches: boolean;
  implementationOrderMatches: boolean;
  declarationMismatches: Array<{ index: number; source?: SourceDeclaration; stored?: StoredDeclaration }>;
  divergenceRegion: 'before-class' | 'class-declarations' | 'after-class' | 'unavailable';
  explanation: 'fully explained by new model' | 'partially explained' | 'unrelated root discovered' | 'unresolved';
  potentialExactAfterStatementFix: boolean;
  postStatementBlockers: string[];
}

function percentage(value: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((100 * value / denominator).toFixed(2));
}

function normalize(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeName(value: string): string {
  return normalize(value).replace(/^&/, '');
}

function normalizeType(value: string | undefined): string {
  const result = normalize(value).replace(/\s*:\s*/g, ':');
  if (result === 'array') return 'array of any';
  if (/^(?:array of )+array$/.test(result)) return `${result} of any`;
  return result;
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = key(value);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function firstDifference(a: Buffer, b: Buffer): number | undefined {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index++) if (a[index] !== b[index]) return index;
  return a.length === b.length ? undefined : shared;
}

function hexWindow(bytes: Buffer, offset: number, radius = 10): string {
  return bytes.subarray(Math.max(0, offset - radius), Math.min(bytes.length, offset + radius + 1)).toString('hex');
}

function programSection(bytes: Buffer, layout: ProgramLayout, name: 'statements' | 'names' | 'records' | 'slots'): Buffer {
  return bytes.subarray(layout[name].offset, layout[name].offset + layout[name].byteLength);
}

function meaningfulDiff(stored: Buffer, generated: Buffer): Diff {
  let storedLayout: ProgramLayout;
  let generatedLayout: ProgramLayout;
  try {
    storedLayout = readProgramLayout(stored);
    generatedLayout = readProgramLayout(generated);
  } catch {
    const offset = firstDifference(stored, generated);
    return {
      section: 'header',
      relativeOffset: offset,
      storedAbsoluteOffset: offset,
      generatedAbsoluteOffset: offset,
      storedByte: offset === undefined ? undefined : stored[offset],
      generatedByte: offset === undefined ? undefined : generated[offset],
      storedWindow: offset === undefined ? undefined : hexWindow(stored, offset),
      generatedWindow: offset === undefined ? undefined : hexWindow(generated, offset)
    };
  }
  for (const name of ['statements', 'names', 'records', 'slots'] as const) {
    const a = programSection(stored, storedLayout, name);
    const b = programSection(generated, generatedLayout, name);
    const offset = firstDifference(a, b);
    if (offset === undefined) continue;
    const storedAbsoluteOffset = storedLayout[name].offset + offset;
    const generatedAbsoluteOffset = generatedLayout[name].offset + offset;
    return {
      section: name,
      relativeOffset: offset,
      storedAbsoluteOffset,
      generatedAbsoluteOffset,
      storedByte: a[offset],
      generatedByte: b[offset],
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

function hasPreprocessor(source: string): boolean {
  return /(^|\n)\s*#(?:if|elseif|else|end-if)\b/i.test(source);
}

function hasNativeLibraryDeclaration(source: string): boolean {
  return /\bDeclare\s+Function\b[^;]*\bLibrary\b/i.test(source);
}

function applicationClassFamily(source: string): string {
  if (/\binterface\b/i.test(source)) return 'Application Class statement grammar: interface';
  if (/\b(?:extends|implements)\b/i.test(source)) return 'Application Class statement grammar: extends/implements';
  if (/\b(?:property|instance)\b/i.test(source)) return 'Application Class statement grammar: property/instance';
  if (/\babstract\b/i.test(source)) return 'Application Class statement grammar: abstract member';
  if (/\bconstant\b/i.test(source)) return 'Application Class statement grammar: constant';
  return 'Application Class method-body grammar';
}

function isCycle21SuccessfulTarget(definition: SnapshotDefinition, generated: Buffer, diff: Diff): boolean {
  if (hasPreprocessor(definition.sourceText)) return false;
  if (diff.section !== 'statements' || diff.relativeOffset === undefined) return false;
  const storedLayout = readProgramLayout(definition.storedProgram);
  const generatedLayout = readProgramLayout(generated);
  const stored = programSection(definition.storedProgram, storedLayout, 'statements');
  const actual = programSection(generated, generatedLayout, 'statements');
  const offset = diff.relativeOffset;
  const storedByte = stored[offset];
  const generatedByte = actual[offset];
  const precedingReference = [1, 2].some(back =>
    offset >= back &&
    [0x21, 0x48, 0x4a].includes(stored[offset - back]) &&
    stored[offset - back] === actual[offset - back]
  );
  if (precedingReference) return false;
  if ([0x21, 0x48, 0x4a].includes(storedByte) || [0x21, 0x48, 0x4a].includes(generatedByte)) return false;
  if (storedByte === OP.blankLine || generatedByte === OP.blankLine) return false;
  if (storedByte === OP.boundary || generatedByte === OP.boundary) return false;
  if ([OP.comment, OP.inlineComment].includes(storedByte) || [OP.comment, OP.inlineComment].includes(generatedByte)) return false;
  if (storedByte === OP.semicolon || generatedByte === OP.semicolon) return false;
  return true;
}

function maskNonCode(source: string): string {
  const chars = source.split('');
  let index = 0;
  while (index < chars.length) {
    const pair = `${chars[index] ?? ''}${chars[index + 1] ?? ''}`;
    if (
      source.slice(index, index + 3).toLowerCase() === 'rem' &&
      (index === 0 || !/[A-Za-z0-9_%&]/.test(source[index - 1])) &&
      /[\s:]/.test(source[index + 3] ?? '')
    ) {
      while (index < chars.length && chars[index] !== ';') {
        if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
        index++;
      }
      if (index < chars.length) chars[index++] = ' ';
      continue;
    }
    if (pair === '/*' || pair === '<*') {
      const close = pair === '/*' ? '*/' : '*>';
      chars[index++] = ' ';
      chars[index++] = ' ';
      while (index < chars.length && `${source[index]}${source[index + 1] ?? ''}` !== close) {
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
    if (chars[index] === '"') {
      chars[index++] = ' ';
      while (index < chars.length) {
        if (chars[index] === '"') {
          chars[index++] = ' ';
          if (chars[index] === '"') {
            chars[index++] = ' ';
            continue;
          }
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

function splitParameters(text: string): Parameter[] {
  if (text.trim() === '') return [];
  return text.split(',').map(part => part.trim()).filter(Boolean).map(part => {
    const match = /^\s*(&[A-Za-z0-9_][A-Za-z0-9_]*#?)\s+As\s+(.+?)(\s+out)?\s*$/i.exec(part);
    return match
      ? { name: match[1], type: match[2].trim(), out: match[3] !== undefined }
      : { name: part, type: '<unparsed>', out: false };
  });
}

function parseSource(definition: SnapshotDefinition): SourceModel {
  const source = definition.sourceText;
  let masked = maskNonCode(source);
  let status: SourceModel['status'] = 'active';
  let start = /\b(class|interface)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(masked);
  if (!start && /\bend-(?:class|interface)\b/i.test(source)) {
    const rawStart = /\b(class|interface)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(source);
    if (rawStart) {
      masked = source;
      start = rawStart;
      status = 'entire-unit-commented';
    }
  }
  if (!start) {
    return {
      status: 'no-source-unit', unitKind: 'unparsed', name: '', unitStart: -1,
      unitEnd: -1, classRegionStart: -1, classRegionEnd: -1,
      implementsTypes: [], events: [], declarations: [], implementations: [],
      nativeLibraryDeclarations: [...source.matchAll(/\bDeclare\s+Function\b[^;]*\bLibrary\b/gi)].length
    };
  }

  const unitKind = start[1].toLowerCase() as Exclude<UnitKind, 'unparsed'>;
  const unitStart = start.index ?? 0;
  const classRegionStart = unitStart + start[0].length;
  const endMatch = new RegExp(`\\bend-${unitKind}\\s*;?`, 'i').exec(masked.slice(classRegionStart));
  if (!endMatch) {
    return {
      status: 'no-source-unit', unitKind: 'unparsed', name: start[2], unitStart,
      unitEnd: -1, classRegionStart, classRegionEnd: -1,
      implementsTypes: [], events: [], declarations: [], implementations: [],
      nativeLibraryDeclarations: [...source.matchAll(/\bDeclare\s+Function\b[^;]*\bLibrary\b/gi)].length
    };
  }
  const classRegionEnd = classRegionStart + (endMatch.index ?? 0);
  const unitEnd = classRegionEnd + endMatch[0].length;
  const classMasked = masked.slice(classRegionStart, classRegionEnd);
  const classOriginal = source.slice(classRegionStart, classRegionEnd);
  const implementationMasked = masked.slice(unitEnd);

  const firstMember = /\b(?:public|private|protected|method|property|instance|constant)\b/i.exec(classMasked);
  const header = classMasked.slice(0, firstMember?.index ?? classMasked.length).replace(/;/g, ' ');
  const extendsType = /\bextends\s+([%A-Za-z_][%A-Za-z0-9_]*(?::[%A-Za-z_][%A-Za-z0-9_]*)*)/i.exec(header)?.[1];
  const implementsMatch = /\bimplements\s+([\s\S]*)/i.exec(header);
  const implementsTypes = implementsMatch
    ? implementsMatch[1].split(',').map(value => value.trim()).filter(Boolean)
    : [];

  type PendingEvent = { index: number; visibility?: Visibility; declaration?: SourceDeclaration };
  const pending: PendingEvent[] = [];
  for (const match of classMasked.matchAll(/\b(public|private|protected)\b/gi)) {
    pending.push({ index: match.index ?? 0, visibility: match[1].toLowerCase() as Visibility });
  }

  for (const match of classMasked.matchAll(
    /\bmethod\s+([A-Za-z_][A-Za-z0-9_$]*)\s*(?:\(([^;]*?)\))?\s*(?:Returns\s+([^;]+?))?\s*(abstract\s*)?(?:;|(?=\s*$))/gi
  )) {
    let returnType = match[3]?.trim();
    let abstract = match[4] !== undefined;
    if (returnType && /\s+abstract$/i.test(returnType)) {
      returnType = returnType.replace(/\s+abstract$/i, '').trim();
      abstract = true;
    }
    const localIndex = match.index ?? 0;
    pending.push({
      index: localIndex,
      declaration: {
        kind: 'method', names: [match[1]], parameters: splitParameters(match[2] ?? ''),
        returnType, modifiers: abstract ? ['abstract'] : [], visibility: 'public',
        sourceIndex: classRegionStart + localIndex,
        raw: classOriginal.slice(localIndex, localIndex + match[0].length)
      }
    });
  }

  const typePattern = '(?:array\\s+of\\s+)*(?:[%A-Za-z_][%A-Za-z0-9_]*(?::[%A-Za-z_][%A-Za-z0-9_]*)*)';
  const propertyPattern = new RegExp(
    `\\bproperty\\s+(${typePattern})\\s+([A-Za-z_][A-Za-z0-9_]*#?)\\s*(readonly|get(?:\\s+set)?|set(?:\\s+get)?)?\\s*;`,
    'gi'
  );
  for (const match of classMasked.matchAll(propertyPattern)) {
    const localIndex = match.index ?? 0;
    pending.push({
      index: localIndex,
      declaration: {
        kind: 'property', names: [match[2]], type: match[1].trim(),
        modifiers: normalize(match[3]).split(' ').filter(Boolean), visibility: 'public',
        sourceIndex: classRegionStart + localIndex,
        raw: classOriginal.slice(localIndex, localIndex + match[0].length)
      }
    });
  }

  const instancePattern = new RegExp(`\\binstance\\s+(${typePattern})\\s+([^;]+?)(?:;|$)`, 'gim');
  for (const match of classMasked.matchAll(instancePattern)) {
    const localIndex = match.index ?? 0;
    const names = match[2].match(/&[A-Za-z0-9_][A-Za-z0-9_]*#?/g) ?? [];
    pending.push({
      index: localIndex,
      declaration: {
        kind: 'instance', names, type: match[1].trim(), modifiers: [], visibility: 'private',
        sourceIndex: classRegionStart + localIndex,
        raw: classOriginal.slice(localIndex, localIndex + match[0].length)
      }
    });
  }

  for (const match of classMasked.matchAll(/\bconstant\s+(&?[A-Za-z_][A-Za-z0-9_#]*)\s*=\s*([^;]*);/gi)) {
    const localIndex = match.index ?? 0;
    pending.push({
      index: localIndex,
      declaration: {
        kind: 'constant', names: [match[1]], modifiers: [], visibility: 'public',
        sourceIndex: classRegionStart + localIndex,
        raw: classOriginal.slice(localIndex, localIndex + match[0].length),
        constantValue: source.slice(classRegionStart + localIndex, classRegionStart + localIndex + match[0].length)
          .replace(/^[\s\S]*?=/, '').replace(/;\s*$/, '').trim()
      }
    });
  }

  pending.sort((a, b) => a.index - b.index);
  let visibility: Visibility = 'public';
  const events: SourceEvent[] = [];
  const declarations: SourceDeclaration[] = [];
  for (const event of pending) {
    if (event.visibility) {
      visibility = event.visibility;
      if (visibility !== 'public') events.push({ kind: 'visibility', index: event.index, visibility });
    }
    if (event.declaration) {
      event.declaration.visibility = event.declaration.kind === 'instance' ? 'private' : visibility;
      declarations.push(event.declaration);
      events.push({ kind: 'declaration', index: event.index, declaration: event.declaration });
    }
  }

  const implementations: SourceImplementation[] = [];
  for (const match of implementationMasked.matchAll(/^\s*(method|get|set)\s+([A-Za-z_][A-Za-z0-9_$]*)\b/gim)) {
    implementations.push({
      kind: match[1].toLowerCase() as ImplementationKind,
      name: match[2],
      sourceIndex: unitEnd + (match.index ?? 0)
    });
  }

  return {
    status, unitKind, name: start[2], unitStart, unitEnd, classRegionStart, classRegionEnd,
    extendsType, implementsTypes, events, declarations, implementations,
    nativeLibraryDeclarations: [...source.matchAll(/\bDeclare\s+Function\b[^;]*\bLibrary\b/gi)].length
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

function tokensBetween(tokens: readonly Token[], start: number, end: number): Token[] {
  return tokens.filter(token => token.offset >= start && token.offset < end);
}

function findDeclarationEnd(tokens: readonly Token[], startIndex: number, limitIndex: number): number {
  for (let index = startIndex + 1; index < limitIndex; index++) {
    if (tokens[index].opcode === OP.semicolon) return index;
    if ([OP.method, OP.property, OP.instance, OP.constant, OP.private, OP.protected, OP.endClass, OP.endInterface].includes(tokens[index].opcode)) {
      return index - 1;
    }
  }
  return limitIndex - 1;
}

function typeFromTokens(tokens: readonly Token[]): string {
  let result = '';
  for (const token of tokens) {
    if (![OP.typeWord, OP.inlineName, OP.colon, 0x12].includes(token.opcode)) continue;
    if (token.opcode === OP.colon) result = result.trimEnd() + ':';
    else result += `${token.text} `;
  }
  return result.trim().replace(/:\s+/g, ':');
}

function parseStoredMethod(tokens: readonly Token[], startIndex: number, endIndex: number): StoredDeclaration {
  const slice = tokens.slice(startIndex, endIndex + 1);
  const name = slice.find(token => token.opcode === OP.inlineName)?.text ?? '<missing>';
  const open = slice.findIndex(token => token.opcode === OP.openParen);
  const close = slice.findIndex(token => token.opcode === OP.closeParen);
  const parameters: Parameter[] = [];
  if (open >= 0 && close > open) {
    let part: Token[] = [];
    const finish = () => {
      if (part.length === 0) return;
      const variable = part.find(token => token.opcode === OP.variable);
      // PeopleTools preserves an otherwise empty trailing comma when a
      // signature ends `, /* comment */)`. It is syntax, not a ninth
      // parameter (definition 28818).
      if (!variable) {
        part = [];
        return;
      }
      const asIndex = part.findIndex(token => token.opcode === OP.as);
      parameters.push({
        name: variable.text,
        type: typeFromTokens(part.slice(asIndex + 1)),
        out: part.some(token => token.opcode === OP.out)
      });
      part = [];
    };
    for (const token of slice.slice(open + 1, close)) {
      if (token.opcode === OP.comma) finish();
      else part.push(token);
    }
    finish();
  }
  const returns = slice.findIndex(token => token.opcode === OP.returns);
  const abstract = slice.some(token => token.opcode === OP.abstract);
  const returnEnd = slice.findIndex((token, index) => index > returns && [OP.abstract, OP.semicolon].includes(token.opcode));
  return {
    kind: 'method', names: [name], parameters,
    returnType: returns < 0 ? undefined : typeFromTokens(slice.slice(returns + 1, returnEnd < 0 ? slice.length : returnEnd)),
    modifiers: abstract ? ['abstract'] : [], abstract,
    offset: slice[0]?.offset ?? -1, endOffset: slice.at(-1)?.offset ?? -1,
    validSkeleton: slice[0]?.opcode === OP.method && open > 0 && close > open,
    terminated: slice.at(-1)?.opcode === OP.semicolon
  };
}

function parseStoredDeclaration(tokens: readonly Token[], startIndex: number, limitIndex: number): { declaration: StoredDeclaration; endIndex: number } {
  const start = tokens[startIndex];
  const endIndex = findDeclarationEnd(tokens, startIndex, limitIndex);
  const slice = tokens.slice(startIndex, endIndex + 1);
  if (start.opcode === OP.method) return { declaration: parseStoredMethod(tokens, startIndex, endIndex), endIndex };
  if (start.opcode === OP.property) {
    const nameIndex = slice.map(token => token.opcode).lastIndexOf(OP.inlineName);
    const modifiers = slice.filter(token => [OP.readonly, OP.get, 0x49].includes(token.opcode)).map(token => token.text.toLowerCase());
    return {
      declaration: {
        kind: 'property', names: [slice[nameIndex]?.text ?? '<missing>'],
        type: typeFromTokens(slice.slice(1, nameIndex)), modifiers, abstract: false,
        offset: start.offset, endOffset: slice.at(-1)?.offset ?? start.offset,
        validSkeleton: nameIndex > 1,
        terminated: slice.at(-1)?.opcode === OP.semicolon
      },
      endIndex
    };
  }
  if (start.opcode === OP.instance) {
    const firstVariable = slice.findIndex(token => token.opcode === OP.variable);
    return {
      declaration: {
        kind: 'instance', names: slice.filter(token => token.opcode === OP.variable).map(token => token.text),
        type: typeFromTokens(slice.slice(1, firstVariable)), modifiers: [], abstract: false,
        offset: start.offset, endOffset: slice.at(-1)?.offset ?? start.offset,
        validSkeleton: firstVariable > 1,
        terminated: slice.at(-1)?.opcode === OP.semicolon
      },
      endIndex
    };
  }
  const variable = slice.findIndex(token => token.opcode === OP.variable);
  const equals = slice.findIndex(token => token.opcode === OP.equals);
  return {
    declaration: {
      kind: 'constant', names: [slice[variable]?.text ?? '<missing>'], modifiers: [], abstract: false,
      offset: start.offset, endOffset: slice.at(-1)?.offset ?? start.offset,
      validSkeleton: variable === 1 && equals > variable && equals + 1 < slice.length - 1 && slice.at(-1)?.opcode === OP.semicolon,
      terminated: slice.at(-1)?.opcode === OP.semicolon,
      constantValueOpcode: slice[equals + 1]?.opcode
    },
    endIndex
  };
}

function classifyRecord(flagsAndCount: number): DirectoryRecord['kind'] {
  const flags = flagsAndCount & 0xffff0000;
  if ((flags & FLAGS.self) !== 0) return 'self';
  if ((flags & FLAGS.getter) !== 0) return 'getter';
  if ((flags & FLAGS.setter) !== 0) return 'setter';
  if ((flags & FLAGS.property) !== 0) {
    return (flags & FLAGS.private) !== 0 && (flags & FLAGS.storage) !== 0 ? 'instance' : 'property';
  }
  return 'method';
}

function parseDirectory(definition: SnapshotDefinition, layout: ProgramLayout): { records: DirectoryRecord[]; slots: number[] } {
  const bytes = definition.storedProgram;
  const names: Array<{ text: string; charOffset: number }> = [];
  let offset = layout.names.offset;
  const end = offset + layout.names.byteLength;
  while (offset < end) {
    let zero = offset;
    while (zero + 1 < end && (bytes[zero] !== 0 || bytes[zero + 1] !== 0)) zero += 2;
    names.push({ text: bytes.toString('utf16le', offset, zero), charOffset: (offset - layout.names.offset) / 2 });
    offset = zero + 2;
  }
  const byOffset = new Map(names.map(name => [name.charOffset, name.text]));
  const records: DirectoryRecord[] = [];
  for (let index = 0; index < layout.recordCount; index++) {
    const base = layout.records.offset + index * PROGRAM_DIRECTORY_RECORD_SIZE;
    const flagsAndCount = bytes.readUInt32LE(base + 8);
    records.push({
      index,
      name: byOffset.get(bytes.readUInt32LE(base)) ?? '<invalid-name-offset>',
      signatureSlotOffset: bytes.readUInt32LE(base + 4),
      flagsAndCount,
      flags: flagsAndCount & 0xffff0000,
      low: flagsAndCount & 0xffff,
      descriptor: bytes.readUInt32LE(base + 12),
      kind: classifyRecord(flagsAndCount)
    });
  }
  const slots: number[] = [];
  for (let index = 0; index < layout.slotCount; index++) {
    slots.push(bytes.readUInt32LE(layout.slots.offset + index * PROGRAM_DISPATCH_SLOT_SIZE));
  }
  return { records, slots };
}

function parseStored(definition: SnapshotDefinition): StoredModel | undefined {
  const layout = readProgramLayout(definition.storedProgram);
  const decoded = decodeProgram(definition.storedProgram, storedNameTable(definition), {
    mode: 'auto', isApplicationClass: true
  });
  const statementEnd = layout.statements.offset + layout.statements.byteLength;
  const tokens = decoded.tokens.filter(token => token.offset >= layout.statements.offset && token.offset < statementEnd);
  const classTokenIndex = tokens.findIndex(token => token.opcode === OP.class || token.opcode === OP.interface);
  if (classTokenIndex < 0) return undefined;
  const classStart = tokens[classTokenIndex].offset;
  const closerIndex = tokens.findIndex((token, index) =>
    index > classTokenIndex && (token.opcode === OP.endClass || token.opcode === OP.endInterface)
  );
  if (closerIndex < 0) return undefined;
  const closerTerminator = tokens.find((token, index) => index > closerIndex && token.opcode === OP.semicolon);
  const classEnd = (closerTerminator?.offset ?? tokens[closerIndex].offset) + 1;

  const classTokens = tokens.slice(classTokenIndex + 1, closerIndex);
  const relationships: StoredModel['relationships'] = [];
  for (let index = 0; index < classTokens.length; index++) {
    const token = classTokens[index];
    if (token.opcode !== OP.extends && token.opcode !== OP.implements) continue;
    let endIndex = index + 1;
    while (
      endIndex < classTokens.length &&
      ![OP.extends, OP.implements, OP.method, OP.property, OP.instance, OP.constant, OP.private, OP.protected].includes(classTokens[endIndex].opcode)
    ) endIndex++;
    relationships.push({ opcode: token.opcode, path: typeFromTokens(classTokens.slice(index + 1, endIndex)), offset: token.offset });
  }

  const events: StoredEvent[] = [];
  const declarations: StoredDeclaration[] = [];
  for (let index = classTokenIndex + 1; index < closerIndex; index++) {
    const token = tokens[index];
    if (token.opcode === OP.private || token.opcode === OP.protected) {
      events.push({ kind: 'visibility', offset: token.offset, visibility: token.opcode === OP.private ? 'private' : 'protected' });
      continue;
    }
    if (![OP.method, OP.property, OP.instance, OP.constant].includes(token.opcode)) continue;
    const parsed = parseStoredDeclaration(tokens, index, closerIndex);
    declarations.push(parsed.declaration);
    events.push({ kind: 'declaration', offset: token.offset, declaration: parsed.declaration });
    index = parsed.endIndex;
  }

  const implementations: SourceImplementation[] = [];
  for (let index = closerIndex + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (![OP.method, OP.get, 0x49].includes(token.opcode)) continue;
    if (definition.storedProgram[token.offset + 1] !== OP.implementationMarker) continue;
    const name = tokens.slice(index + 1).find(candidate => candidate.opcode === OP.inlineName);
    implementations.push({
      kind: token.opcode === OP.method ? 'method' : token.opcode === OP.get ? 'get' : 'set',
      name: name?.text ?? '<missing>', sourceIndex: token.offset
    });
  }

  const firstDeclaration = events[0]?.offset ?? tokens[closerIndex].offset;
  const statementBoundaryStart = definition.storedProgram[statementEnd - 2] === OP.boundary ? statementEnd - 2 : statementEnd - 1;
  const firstImplementation = implementations[0]?.sourceIndex ?? statementBoundaryStart;
  const directory = parseDirectory(definition, layout);
  return {
    tokens, unknownOpcodes: decoded.unknownOpcodes, layout, classStart,
    classEndKeyword: tokens[closerIndex].offset, classEnd, firstDeclaration, firstImplementation,
    relationships, events, declarations, implementations,
    records: directory.records, slots: directory.slots,
    boundaries: {
      programHeader: [0, PROGRAM_HEADER_LENGTH],
      imports: [layout.statements.offset, classStart],
      classHeader: [classStart, firstDeclaration],
      memberDeclarations: [firstDeclaration, tokens[closerIndex].offset],
      postClassDeclarations: [classEnd, firstImplementation],
      implementations: [firstImplementation, statementBoundaryStart],
      statementBoundary: [statementBoundaryStart, statementEnd],
      names: [layout.names.offset, layout.names.offset + layout.names.byteLength],
      records: [layout.records.offset, layout.records.offset + layout.records.byteLength],
      slots: [layout.slots.offset, layout.slots.offset + layout.slots.byteLength]
    }
  };
}

function declarationLabel(declaration: SourceDeclaration | StoredDeclaration): string {
  return `${declaration.kind}:${declaration.names.map(normalizeName).join(',')}`;
}

function eventLabel(event: SourceEvent | StoredEvent): string {
  return event.kind === 'visibility'
    ? `visibility:${event.visibility}`
    : declarationLabel(event.declaration!);
}

function implementationLabel(implementation: SourceImplementation): string {
  return `${implementation.kind}:${normalizeName(implementation.name)}`;
}

function sameParameter(a: Parameter, b: Parameter): boolean {
  return normalizeName(a.name) === normalizeName(b.name) && normalizeType(a.type) === normalizeType(b.type) && a.out === b.out;
}

function sameDeclaration(source: SourceDeclaration, stored: StoredDeclaration): boolean {
  if (source.kind !== stored.kind) return false;
  if (source.names.map(normalizeName).join('|') !== stored.names.map(normalizeName).join('|')) return false;
  if (normalizeType(source.type) !== normalizeType(stored.type)) return false;
  if (normalizeType(source.returnType) !== normalizeType(stored.returnType)) return false;
  if (source.modifiers.map(normalize).join('|') !== stored.modifiers.map(normalize).join('|')) return false;
  if (source.raw.trimEnd().endsWith(';') !== stored.terminated) return false;
  const a = source.parameters ?? [];
  const b = stored.parameters ?? [];
  return a.length === b.length && a.every((parameter, index) => sameParameter(parameter, b[index]));
}

function headerMatches(source: SourceModel, stored: StoredModel): boolean {
  const first = stored.tokens.find(token => token.offset === stored.classStart);
  const name = stored.tokens.find(token => token.offset > stored.classStart && token.opcode === OP.inlineName);
  if (source.unitKind === 'class' && first?.opcode !== OP.class) return false;
  if (source.unitKind === 'interface' && first?.opcode !== OP.interface) return false;
  if (normalizeName(name?.text ?? '') !== normalizeName(source.name)) return false;
  const expected = [
    ...(source.extendsType ? [{ opcode: OP.extends, path: source.extendsType }] : []),
    ...source.implementsTypes.map(path => ({ opcode: OP.implements, path }))
  ];
  return expected.length === stored.relationships.length && expected.every((relation, index) =>
    relation.opcode === stored.relationships[index].opcode && normalizeType(relation.path) === normalizeType(stored.relationships[index].path)
  );
}

function declarationGrammarMatches(source: SourceModel, stored: StoredModel): boolean {
  if (source.declarations.length !== stored.declarations.length) return false;
  return source.declarations.every((declaration, index) =>
    stored.declarations[index].validSkeleton && sameDeclaration(declaration, stored.declarations[index])
  );
}

function findRawClassBounds(bytes: Buffer, layout: ProgramLayout, source: SourceModel): { start: number; end: number } | undefined {
  if (source.unitKind === 'unparsed') return undefined;
  const opener = source.unitKind === 'class' ? OP.class : OP.interface;
  const closer = source.unitKind === 'class' ? OP.endClass : OP.endInterface;
  const pattern = Buffer.concat([Buffer.from([opener, OP.inlineName]), Buffer.from(`${source.name}\0`, 'utf16le')]);
  const statementsEnd = layout.statements.offset + layout.statements.byteLength;
  const start = bytes.indexOf(pattern, layout.statements.offset);
  if (start < 0 || start >= statementsEnd) return undefined;
  for (let offset = start + pattern.length; offset + 1 < statementsEnd; offset++) {
    if (bytes[offset] === closer && bytes[offset + 1] === OP.semicolon) return { start, end: offset + 2 };
  }
  return undefined;
}

function postStatementBlockers(target: TargetRow, source: SourceModel, stored: StoredModel): string[] {
  if (!target.generated) return [];
  const generatedLayout = readProgramLayout(target.generated);
  const generatedBounds = findRawClassBounds(target.generated, generatedLayout, source);
  if (!generatedBounds) return ['generated class bounds unavailable'];
  const storedBytes = target.definition.storedProgram;
  const storedPrefix = storedBytes.subarray(stored.layout.statements.offset, stored.classStart);
  const generatedPrefix = target.generated.subarray(generatedLayout.statements.offset, generatedBounds.start);
  const storedStatementEnd = stored.layout.statements.offset + stored.layout.statements.byteLength;
  const generatedStatementEnd = generatedLayout.statements.offset + generatedLayout.statements.byteLength;
  const storedSuffix = storedBytes.subarray(stored.classEnd, storedStatementEnd);
  const generatedSuffix = target.generated.subarray(generatedBounds.end, generatedStatementEnd);
  const blockers: string[] = [];
  if (!storedPrefix.equals(generatedPrefix)) blockers.push('pre-class statements');
  if (!storedSuffix.equals(generatedSuffix)) blockers.push('post-class statements/wrappers');
  for (const name of ['names', 'records', 'slots'] as const) {
    if (!programSection(storedBytes, stored.layout, name).equals(programSection(target.generated, generatedLayout, name))) {
      blockers.push(`${name} metadata`);
    }
  }
  return blockers;
}

function sourceErrorOffset(message: string | undefined): number | undefined {
  const match = /source offset (\d+)/i.exec(message ?? '');
  return match ? Number(match[1]) : undefined;
}

function divergenceRegion(target: TargetRow, source: SourceModel, stored: StoredModel | undefined): AnalysisRow['divergenceRegion'] {
  if (target.result.sourceEncodeSuccess) {
    const offset = target.diff?.storedAbsoluteOffset;
    if (offset === undefined || stored === undefined) return 'unavailable';
    if (offset < stored.classStart) return 'before-class';
    if (offset < stored.classEnd) return 'class-declarations';
    return 'after-class';
  }
  const offset = sourceErrorOffset(target.result.errorMessage);
  if (offset === undefined || source.classRegionStart < 0 || source.classRegionEnd < 0) return 'unavailable';
  if (offset < source.unitStart) return 'before-class';
  if (offset <= source.classRegionEnd) return 'class-declarations';
  return 'after-class';
}

function buildTargetRows(definitions: readonly SnapshotDefinition[], results: readonly ResultRow[]): TargetRow[] {
  const definitionById = new Map(definitions.map(definition => [definition.definitionId, definition]));
  const targets: TargetRow[] = [];
  for (const result of results) {
    const definition = definitionById.get(result.definitionId);
    if (!definition || definition.objectid1 !== APPLICATION_CLASS_OBJECT_ID) continue;
    if (!result.sourceEncodeSuccess) {
      if (hasPreprocessor(definition.sourceText) || hasNativeLibraryDeclaration(definition.sourceText)) continue;
      targets.push({ result, definition, family: applicationClassFamily(definition.sourceText) });
      continue;
    }
    const artifacts = encodeProgramArtifacts(definition.sourceText, { owner: ownerContext(definition) });
    const diff = meaningfulDiff(definition.storedProgram, artifacts.program);
    if (!isCycle21SuccessfulTarget(definition, artifacts.program, diff)) continue;
    const leading = /^\s*(?:\/\*|<\*|\/+)/.test(definition.sourceText);
    targets.push({
      result, definition,
      family: leading ? 'Application Class leading comment/wrapper layout' : 'Application Class executable-body/wrapper mismatch',
      diff, generated: artifacts.program
    });
  }
  return targets;
}

function readRunAndResults(): { run: FullRun; results: ResultRow[] } {
  const db = new Database('tools/corpus/corpus-results.sqlite', { readonly: true });
  const rawRun = db.prepare(`
    SELECT run_id, git_commit, definitions, exact_count, failure_count
    FROM corpus_run
    WHERE completed_at IS NOT NULL AND definitions = ?
    ORDER BY run_id DESC LIMIT 1
  `).get(TOTAL_CORPUS) as Record<string, unknown> | undefined;
  if (!rawRun) throw new Error(`No completed ${TOTAL_CORPUS}-definition run found.`);
  const run: FullRun = {
    runId: Number(rawRun.run_id), gitCommit: String(rawRun.git_commit),
    definitions: Number(rawRun.definitions), exactCount: Number(rawRun.exact_count),
    failureCount: Number(rawRun.failure_count)
  };
  const rawRows = db.prepare(`
    SELECT r.definition_id, d.display_name, r.classification,
           r.source_encode_success, r.source_encode_exact, r.first_diff_offset,
           r.error_message, r.stored_diff_hex, r.generated_diff_hex
    FROM result r JOIN definition d USING (definition_id)
    WHERE r.run_id = ? AND r.classification <> 'EXACT'
    ORDER BY r.definition_id
  `).all(run.runId) as Array<Record<string, unknown>>;
  db.close();
  return {
    run,
    results: rawRows.map(row => ({
      definitionId: Number(row.definition_id), displayName: String(row.display_name),
      classification: String(row.classification), sourceEncodeSuccess: Boolean(row.source_encode_success),
      sourceEncodeExact: Boolean(row.source_encode_exact),
      firstDiffOffset: row.first_diff_offset === null ? undefined : Number(row.first_diff_offset),
      errorMessage: row.error_message === null ? undefined : String(row.error_message),
      storedDiffHex: row.stored_diff_hex === null ? undefined : String(row.stored_diff_hex),
      generatedDiffHex: row.generated_diff_hex === null ? undefined : String(row.generated_diff_hex)
    }))
  };
}

function filteredOrderMatches(source: SourceModel, stored: StoredModel, predicate: (declaration: SourceDeclaration | StoredDeclaration) => boolean): boolean {
  const a = source.declarations.filter(predicate).map(declarationLabel);
  const b = stored.declarations.filter(predicate).map(declarationLabel);
  return a.join('|') === b.join('|');
}

function control(programs: readonly { source: SourceModel; stored?: StoredModel }[], kind: DeclarationKind): Record<string, number> {
  let positive = 0;
  let positiveMatches = 0;
  let negative = 0;
  let negativeMatches = 0;
  for (const program of programs.filter(item => item.source.status === 'active' && item.stored)) {
    const sourceCount = program.source.declarations.filter(declaration => declaration.kind === kind).length;
    const storedCount = program.stored!.declarations.filter(declaration => declaration.kind === kind).length;
    if (sourceCount > 0) {
      positive++;
      if (sourceCount === storedCount) positiveMatches++;
    } else {
      negative++;
      if (storedCount === 0) negativeMatches++;
    }
  }
  return { positive, positiveMatches, positiveContradictions: positive - positiveMatches, negative, negativeMatches, negativeContradictions: negative - negativeMatches };
}

function relationControl(programs: readonly { source: SourceModel; stored?: StoredModel }[], opcode: number): Record<string, number> {
  let positive = 0;
  let positiveMatches = 0;
  let negative = 0;
  let negativeMatches = 0;
  for (const program of programs.filter(item => item.source.status === 'active' && item.stored)) {
    const expected = opcode === OP.extends ? (program.source.extendsType ? 1 : 0) : program.source.implementsTypes.length;
    const actual = program.stored!.relationships.filter(relation => relation.opcode === opcode).length;
    if (expected > 0) {
      positive++;
      if (expected === actual) positiveMatches++;
    } else {
      negative++;
      if (actual === 0) negativeMatches++;
    }
  }
  return { positive, positiveMatches, positiveContradictions: positive - positiveMatches, negative, negativeMatches, negativeContradictions: negative - negativeMatches };
}

function finalPathPart(path: string): string {
  return path.split(':').at(-1)?.trim().toUpperCase() ?? '';
}

function main(): void {
  const { run, results } = readRunAndResults();
  if (run.definitions !== TOTAL_CORPUS || run.exactCount !== EXPECTED_EXACT) {
    throw new Error(`Cycle 22 baseline drift: ${run.exactCount}/${run.definitions}, expected ${EXPECTED_EXACT}/${TOTAL_CORPUS}.`);
  }
  const snapshotDb = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(snapshotDb).filter(definition => definition.objectid1 === APPLICATION_CLASS_OBJECT_ID);
  snapshotDb.close();
  const targets = buildTargetRows(definitions, results);
  if (targets.length !== EXPECTED_TARGET) {
    throw new Error(`Cycle 21 target drift: ${targets.length}, expected ${EXPECTED_TARGET}.`);
  }

  const programs = definitions.map(definition => ({
    definition,
    source: parseSource(definition),
    stored: parseStored(definition)
  }));
  const byId = new Map(programs.map(program => [program.definition.definitionId, program]));
  const rows: AnalysisRow[] = [];
  for (const target of targets) {
    const program = byId.get(target.definition.definitionId)!;
    const { source, stored } = program;
    const sourceSequence = source.events.map(eventLabel);
    const storedSequence = stored?.events.map(eventLabel) ?? [];
    const sourceImplementations = source.implementations.map(implementationLabel);
    const storedImplementations = stored?.implementations.map(implementationLabel) ?? [];
    const headerExact = stored !== undefined && headerMatches(source, stored);
    const orderExact = sourceSequence.join('|') === storedSequence.join('|');
    const grammarExact = stored !== undefined && declarationGrammarMatches(source, stored);
    const implementationExact = sourceImplementations.join('|') === storedImplementations.join('|');
    const declarationMismatches: AnalysisRow['declarationMismatches'] = [];
    const declarationCount = Math.max(source.declarations.length, stored?.declarations.length ?? 0);
    for (let index = 0; index < declarationCount; index++) {
      const sourceDeclaration = source.declarations[index];
      const storedDeclaration = stored?.declarations[index];
      if (!sourceDeclaration || !storedDeclaration || !sameDeclaration(sourceDeclaration, storedDeclaration) || !storedDeclaration.validSkeleton) {
        declarationMismatches.push({ index, source: sourceDeclaration, stored: storedDeclaration });
      }
    }
    const region = divergenceRegion(target, source, stored);
    const blockers = stored ? postStatementBlockers(target, source, stored) : [];
    let explanation: AnalysisRow['explanation'];
    if (region !== 'class-declarations') explanation = 'unrelated root discovered';
    else if (!stored || source.status !== 'active') explanation = 'unresolved';
    else if (headerExact && orderExact && grammarExact) explanation = 'fully explained by new model';
    else explanation = 'partially explained';
    rows.push({
      definitionId: target.definition.definitionId,
      displayName: target.definition.displayName,
      source: target.definition.sourceText,
      cycle21Family: target.family,
      sourceEncodeSuccess: target.result.sourceEncodeSuccess,
      firstDiffOffset: target.result.firstDiffOffset,
      meaningfulDiff: target.diff,
      firstDivergence: target.result.sourceEncodeSuccess
        ? {
            coordinate: 'stored/generated byte',
            offset: target.diff?.storedAbsoluteOffset,
            storedWindow: target.diff?.storedWindow,
            generatedWindow: target.diff?.generatedWindow
          }
        : {
            coordinate: 'source error',
            offset: sourceErrorOffset(target.result.errorMessage),
            storedWindow: stored ? hexWindow(target.definition.storedProgram, stored.classStart, 16) : undefined
          },
      sourceShape: {
        unitKind: source.unitKind,
        extends: source.extendsType !== undefined,
        implements: source.implementsTypes.length,
        declarations: {
          method: source.declarations.filter(declaration => declaration.kind === 'method').length,
          property: source.declarations.filter(declaration => declaration.kind === 'property').length,
          instance: source.declarations.filter(declaration => declaration.kind === 'instance').length,
          constant: source.declarations.filter(declaration => declaration.kind === 'constant').length
        },
        implementations: source.implementations.length
      },
      sourceDeclarationSequence: sourceSequence,
      implementationSequence: sourceImplementations,
      storedDeclarationSequence: storedSequence,
      storedImplementationSequence: storedImplementations,
      boundaries: stored?.boundaries,
      directoryRecords: stored?.records ?? [],
      signatureSlots: stored?.slots ?? [],
      pspcmnameRows: target.definition.names,
      headerMatches: headerExact,
      declarationOrderMatches: orderExact,
      declarationGrammarMatches: grammarExact,
      implementationOrderMatches: implementationExact,
      declarationMismatches,
      divergenceRegion: region,
      explanation,
      potentialExactAfterStatementFix: stored !== undefined && target.generated !== undefined && region === 'class-declarations' && blockers.length === 0,
      postStatementBlockers: blockers
    });
  }

  const analyzable = programs.filter(program => program.source.status === 'active' && program.stored);
  const statementBoundaryFailures = programs.filter(program => {
    if (!program.stored) return true;
    const [start, end] = program.stored.boundaries.statementBoundary;
    const boundary = program.definition.storedProgram.subarray(start, end);
    return !(boundary.equals(Buffer.from([OP.boundary, 0x07])) || boundary.equals(Buffer.from([0x07])));
  });
  const statementBoundaryKinds = countBy(programs.filter(program => program.stored), program => {
    const [start, end] = program.stored!.boundaries.statementBoundary;
    return program.definition.storedProgram.subarray(start, end).toString('hex');
  });
  const headerExactPrograms = analyzable.filter(program => headerMatches(program.source, program.stored!));
  const declarationGrammarExactPrograms = analyzable.filter(program => declarationGrammarMatches(program.source, program.stored!));
  const declarationOrderExactPrograms = analyzable.filter(program =>
    program.source.events.map(eventLabel).join('|') === program.stored!.events.map(eventLabel).join('|')
  );
  const implementationOrderExactPrograms = analyzable.filter(program =>
    program.source.implementations.map(implementationLabel).join('|') === program.stored!.implementations.map(implementationLabel).join('|')
  );

  const allDeclarations = analyzable.flatMap(program => program.source.declarations.map((declaration, index) => ({
    program, declaration, stored: program.stored!.declarations[index]
  })));
  const constants = allDeclarations.filter(item => item.declaration.kind === 'constant');
  const methodDeclarations = allDeclarations.filter(item => item.declaration.kind === 'method');
  const propertyDeclarations = allDeclarations.filter(item => item.declaration.kind === 'property');
  const constantDefinitions = new Set(constants.map(item => item.program.definition.definitionId));
  const constantLiteralKinds = countBy(constants, item => {
    const value = item.declaration.constantValue ?? '';
    if (/^"/.test(value)) return 'string';
    if (/^(?:true|false)$/i.test(value)) return 'boolean';
    if (/^[+-]?\d+(?:\.\d+)?$/.test(value)) return 'number';
    return 'expression/other';
  });
  const constantOpcodes = countBy(constants, item => `0x${(item.stored?.constantValueOpcode ?? -1).toString(16)}`);
  const constantDirectoryMatches = constants.filter(item =>
    item.program.stored!.records.some(record => normalizeName(record.name) === normalizeName(item.declaration.names[0]))
  );

  const relationPrograms = analyzable.filter(program => program.source.extendsType || program.source.implementsTypes.length > 0);
  let relationStatementMatches = 0;
  let relationDependencyMatches = 0;
  let relationSelfDescriptorPresent = 0;
  for (const program of relationPrograms) {
    if (headerMatches(program.source, program.stored!)) relationStatementMatches++;
    const relations = [program.source.extendsType, ...program.source.implementsTypes].filter((value): value is string => Boolean(value));
    if (relations.every(path => program.definition.names.some(row =>
      row.recname.trim().toUpperCase() === 'PACKAGE' && row.refname.trim().toUpperCase() === finalPathPart(path)
    ))) relationDependencyMatches++;
    if (program.stored!.records[0]?.kind === 'self' && program.stored!.records[0].descriptor !== 7) relationSelfDescriptorPresent++;
  }

  const ordering = (predicate: (declaration: SourceDeclaration | StoredDeclaration) => boolean) => {
    const compared = analyzable.filter(program => program.source.declarations.filter(predicate).length > 1);
    const exact = compared.filter(program => filteredOrderMatches(program.source, program.stored!, predicate));
    return { compared: compared.length, sourceOrderMatches: exact.length, contradictions: compared.length - exact.length };
  };
  const constructorPrograms = analyzable.filter(program => program.source.declarations.some(declaration =>
    declaration.kind === 'method' && normalizeName(declaration.names[0]) === normalizeName(program.source.name)
  ));
  const abstractPrograms = analyzable.filter(program => program.source.declarations.some(declaration => declaration.modifiers.includes('abstract')));
  const interfacePrograms = analyzable.filter(program => program.source.unitKind === 'interface');

  const exactRows = results.length === run.failureCount ? run.exactCount : -1;
  const currentExactApplicationClasses = definitions.length - results.filter(result =>
    definitions.some(definition => definition.definitionId === result.definitionId)
  ).length;
  const coverageCounts = countBy(rows, row => row.explanation);
  const changeRows = rows.filter(row => row.explanation === 'fully explained by new model');
  const downstreamRows = rows.filter(row => row.explanation === 'unrelated root discovered');
  const possibleExactRows = rows.filter(row => row.potentialExactAfterStatementFix);
  const changedSuccessfulRows = changeRows.filter(row => row.sourceEncodeSuccess);
  const provenPostStatementBlockedRows = changedSuccessfulRows.filter(row => row.postStatementBlockers.length > 0);
  const relationProgramsWithoutPackageRow = relationPrograms.filter(program => {
    const relations = [program.source.extendsType, ...program.source.implementsTypes].filter((value): value is string => Boolean(value));
    return !relations.every(path => program.definition.names.some(row =>
      row.recname.trim().toUpperCase() === 'PACKAGE' && row.refname.trim().toUpperCase() === finalPathPart(path)
    ));
  });

  const report = {
    baseline: {
      run,
      exactRows,
      applicationClassDefinitions: definitions.length,
      currentlyExactApplicationClasses: currentExactApplicationClasses,
      targetDefinitions: rows.length,
      targetMatchesCycle21: rows.length === EXPECTED_TARGET
    },
    targetPopulation: {
      byCycle21Family: countBy(rows, row => row.cycle21Family),
      byDivergenceRegion: countBy(rows, row => row.divergenceRegion),
      byUnitKind: countBy(rows, row => row.sourceShape.unitKind),
      subfamilies: {
        extends: rows.filter(row => row.sourceShape.extends).length,
        implements: rows.filter(row => row.sourceShape.implements > 0).length,
        interface: rows.filter(row => row.sourceShape.unitKind === 'interface').length,
        method: rows.filter(row => row.sourceShape.declarations.method > 0).length,
        property: rows.filter(row => row.sourceShape.declarations.property > 0).length,
        instance: rows.filter(row => row.sourceShape.declarations.instance > 0).length,
        constant: rows.filter(row => row.sourceShape.declarations.constant > 0).length
      }
    },
    statementSections: {
      programHeaderBytes: PROGRAM_HEADER_LENGTH,
      parsedStoredPrograms: programs.filter(program => program.stored).length,
      unparsedStoredPrograms: programs.filter(program => !program.stored).length,
      terminalGrammar: '... [0x2D structural boundary] 0x07, then UTF-16 directory names',
      terminalChecks: programs.filter(program => program.stored).length,
      terminalMatches: programs.filter(program => program.stored).length - statementBoundaryFailures.filter(program => program.stored).length,
      terminalContradictions: statementBoundaryFailures.filter(program => program.stored).length,
      terminalForms: statementBoundaryKinds,
      boundaries: 'HEADER | IMPORTS/comments/markers | CLASS_HEADER | MEMBER_DECLARATIONS | END_UNIT [;] | post-class Declare Function/comments/markers | IMPLEMENTATIONS | [2D] 07 | NAMES | RECORDS | SLOTS'
    },
    classHeaderGrammar: {
      grammar: 'CLASS(5A)|INTERFACE(70), INLINE_NAME(0A UTF16 NUL), [EXTENDS(5C) TYPE_PATH], [IMPLEMENTS(72) TYPE_PATH], MEMBER* , END_CLASS(5B)|END_INTERFACE(71), SEMICOLON(15)',
      checkedDefinitions: analyzable.length,
      exactDefinitions: headerExactPrograms.length,
      contradictions: analyzable.length - headerExactPrograms.length,
      classDefinitions: analyzable.filter(program => program.source.unitKind === 'class').length,
      interfaceDefinitions: interfacePrograms.length,
      extendsControls: relationControl(programs, OP.extends),
      implementsControls: relationControl(programs, OP.implements),
      inlineNamesNotPspcmnameOperands: true
    },
    memberDeclarationGrammar: {
      method: '63 INLINE_NAME 0B (01 VAR 35 TYPE [5D OUT])*(03 separated; optional preserved trailing comma/comment) 14 [39 TYPE] [6F ABSTRACT] [15 if source semicolon]',
      property: '5E TYPE 0A INLINE_NAME [60 READONLY | 5F GET | 49 SET]* 15',
      instance: '62 TYPE (01 VAR)*(03 separated) 15',
      constant: '56 01 VAR 06 LITERAL 15',
      visibility: 'PUBLIC emits no opcode; PRIVATE=61; PROTECTED=73',
      checkedDefinitions: analyzable.length,
      exactDefinitions: declarationGrammarExactPrograms.length,
      contradictions: analyzable.length - declarationGrammarExactPrograms.length,
      declarationCounts: countBy(allDeclarations, item => item.declaration.kind),
      controls: {
        method: control(programs, 'method'),
        property: control(programs, 'property'),
        instance: control(programs, 'instance'),
        constant: control(programs, 'constant')
      },
      constructor: {
        definitions: constructorPrograms.length,
        representation: 'ordinary method declaration whose inline name equals the unit name; no distinct constructor opcode'
      },
      abstractMethod: {
        definitions: abstractPrograms.length,
        representation: 'ordinary method declaration plus trailing 0x6F before 0x15; no implementation wrapper'
      },
      interfaceMethod: {
        definitions: interfacePrograms.length,
        representation: 'ordinary 0x63 method declaration; interface-ness is carried by 0x70/0x71 and directory flags, not a second method opcode'
      },
      getterSetter: {
        readonlyDeclarations: propertyDeclarations.filter(item => item.declaration.modifiers.includes('readonly')).length,
        getterDeclarations: propertyDeclarations.filter(item => item.declaration.modifiers.includes('get')).length,
        setterDeclarations: propertyDeclarations.filter(item => item.declaration.modifiers.includes('set')).length,
        declarationRepresentation: '0x5F/0x49 modifiers inside one property statement',
        implementationRepresentation: 'separate 5F 41 / 49 41 wrapper headers after end-class, closed by 6A/6B'
      },
      outParameters: methodDeclarations.reduce(
        (count, item) => count + (item.declaration.parameters ?? []).filter(parameter => parameter.out).length,
        0
      ),
      visibilityTransitions: countBy(
        analyzable.flatMap(program => program.source.events.filter(event => event.kind === 'visibility')),
        event => event.visibility ?? '<missing>'
      ),
      representationMatrix: {
        method: 'executable declaration + directory record + signature slots; concrete implementation has a separate wrapper',
        constructor: 'same three method manifestations; no constructor-specific statement opcode',
        abstractMethod: 'executable declaration + abstract directory/signature metadata; no implementation wrapper',
        interfaceMethod: 'executable declaration + abstract directory/signature metadata; no implementation wrapper',
        property: 'executable declaration + property directory metadata; custom accessors add signature records and wrappers',
        instance: 'executable declaration + storage directory metadata; no signature slots',
        constant: 'executable declaration only; no directory record and no signature slots'
      },
      analogy: 'Unit/member keywords are Application-Class-specific opcodes; TYPE, variable, As, Returns, punctuation, and literal operands reuse ordinary PeopleCode declaration bytecode.'
    },
    ordering: {
      executableDeclarationSequence: {
        compared: analyzable.length,
        sourceOrderMatches: declarationOrderExactPrograms.length,
        contradictions: analyzable.length - declarationOrderExactPrograms.length
      },
      methods: ordering(declaration => declaration.kind === 'method'),
      properties: ordering(declaration => declaration.kind === 'property'),
      instances: ordering(declaration => declaration.kind === 'instance'),
      abstractMethods: ordering(declaration => declaration.kind === 'method' && declaration.modifiers.includes('abstract')),
      constructors: {
        compared: constructorPrograms.length,
        sourceOrderMatches: constructorPrograms.filter(program => filteredOrderMatches(program.source, program.stored!, declaration => declaration.kind === 'method')).length
      },
      implementationSequence: {
        compared: analyzable.length,
        sourceOrderMatches: implementationOrderExactPrograms.length,
        contradictions: analyzable.length - implementationOrderExactPrograms.length,
        note: 'This is independent of executable declaration order and remains the Cycle 13 physical callable-directory axis.'
      }
    },
    constants: {
      fullPopulationDefinitions: constantDefinitions.size,
      declarations: constants.length,
      literalKinds: constantLiteralKinds,
      storedValueFirstOpcodes: constantOpcodes,
      validSkeletons: constants.filter(item => item.stored?.validSkeleton).length,
      directoryRecordNameMatches: constantDirectoryMatches.length,
      dependencyBearingExpressions: constants.filter(item => !/^(?:"|[+-]?\d|true$|false$)/i.test(item.declaration.constantValue ?? '')).length,
      model: 'Constants are executable declaration statements with literal value bytecode; they create no directory/signature record and this population has no dependency-bearing constant expression.'
    },
    relationships: {
      definitions: relationPrograms.length,
      statementPathMatches: relationStatementMatches,
      statementContradictions: relationPrograms.length - relationStatementMatches,
      packageDependencyMatches: relationDependencyMatches,
      packageDependencyAbsences: relationPrograms.length - relationDependencyMatches,
      packageDependencyAbsenceKinds: countBy(relationProgramsWithoutPackageRow, program => {
        const relations = [program.source.extendsType, ...program.source.implementsTypes].filter((value): value is string => Boolean(value));
        return relations.some(path => path.includes(':')) ? 'qualified relationship without matching PACKAGE row' : 'unqualified/built-in relationship';
      }),
      selfDescriptorPresent: relationSelfDescriptorPresent,
      model: 'The 5C/72 inline TYPE_PATH, self-record descriptor, and PACKAGE PSPCMNAME row are independent manifestations of the relationship.'
    },
    nativeLibrary: {
      targetDefinitions: rows.filter(row => byId.get(row.definitionId)!.source.nativeLibraryDeclarations > 0).length,
      fullApplicationClassDefinitions: programs.filter(program => program.source.nativeLibraryDeclarations > 0).length,
      disposition: 'Not part of the class-member grammar; retain as the native/library metadata subsystem.'
    },
    explanationCoverage: {
      counts: coverageCounts,
      percentages: Object.fromEntries(Object.entries(coverageCounts).map(([name, count]) => [name, percentage(count, rows.length)])),
      unrelatedDefinitionIds: downstreamRows.map(row => row.definitionId),
      partialDefinitionIds: rows.filter(row => row.explanation === 'partially explained').map(row => row.definitionId),
      unresolvedDefinitionIds: rows.filter(row => row.explanation === 'unresolved').map(row => row.definitionId)
    },
    cycle23Prediction: {
      definitionsPredictedToChange: changeRows.length,
      definitionsWhoseFirstDivergenceMovesLater: changeRows.length,
      directlyProvenPotentialExactDefinitions: possibleExactRows.length,
      directlyProvenPotentialExactDefinitionIds: possibleExactRows.map(row => row.definitionId),
      knownDownstreamBlockedDefinitions: downstreamRows.length + provenPostStatementBlockedRows.length,
      knownDownstreamBlockedDefinitionIds: [...downstreamRows, ...provenPostStatementBlockedRows].map(row => row.definitionId).sort((a, b) => a - b),
      postStatementBlockersAmongSuccessfulChangedRows: countBy(
        provenPostStatementBlockedRows.flatMap(row => row.postStatementBlockers),
        blocker => blocker
      ),
      outcomeIndeterminateUntilCycle23Encoding: changeRows.filter(row => !row.sourceEncodeSuccess).length,
      currentlyExactDefinitionsTraversingChangedPath: currentExactApplicationClasses,
      implementationScope: 'Parse declarations into an ordered ApplicationClassStatement IR and emit the stored grammar only for non-EXACT Application Class paths; preserve Cycle 13 directory/signature construction and Cycle 17-18 wrapper emission as separate phases.'
    },
    cycle14Assessment: {
      correct: 'The existing 5A/5B, 63 declaration, 63 41 implementation, inline-name, parameter, Returns, and basic type fragments are valid within their narrow methods-only population.',
      incomplete: 'It does not model interface units, extends/implements, visibility transitions, properties, instances, constants, abstract/out modifiers, %metadata type roots, or source-optional final declaration terminators.',
      wrongAbstraction: 'Declarations must be emitted from one ordered statement IR; synthesizing only method bytes independently loses source interleaving and modifier/terminator state.'
    },
    proposedIr: {
      unit: 'kind + inline name + ordered relationship paths',
      declarations: 'ordered discriminated nodes for visibility, method, property, instance, and constant; each node retains source terminator and comments/markers',
      types: 'ordered path/type tokens supporting scalar, array-of, package path, and %metadata root',
      phases: 'emit statement IR first; build Cycle 13 names/records/slots separately; append Cycle 17-18 implementation wrappers in implementation order'
    },
    matchedControls: {
      declarationPresenceAbsence: {
        method: control(programs, 'method'), property: control(programs, 'property'),
        instance: control(programs, 'instance'), constant: control(programs, 'constant')
      },
      relationships: { extends: relationControl(programs, OP.extends), implements: relationControl(programs, OP.implements) },
      terminalMarker: {
        checked: programs.filter(program => program.stored).length,
        matched: programs.filter(program => program.stored).length - statementBoundaryFailures.filter(program => program.stored).length
      }
    },
    unresolvedCases: {
      commentedUnitsWithoutStoredClassOpcodes: programs.filter(program => !program.stored).map(program => program.definition.definitionId),
      activeDeclarationGrammarContradictions: analyzable
        .filter(program => !declarationGrammarMatches(program.source, program.stored!))
        .map(program => program.definition.definitionId),
      relationDefinitionsWithoutMatchingPackageRow: relationProgramsWithoutPackageRow.map(program => program.definition.definitionId),
      note: 'Commented units without class opcodes and relationship rows absent from PSPCMNAME are retained as explicit exceptions; they are not used to invent a general rule.'
    }
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ...report, rows }, null, 2));
    return;
  }
  console.log('=== Cycle 22 Application Class statement analysis ===');
  console.log(JSON.stringify(report, null, 2));
}

main();
