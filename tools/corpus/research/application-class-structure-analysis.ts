/**
 * Cycle 13: reconstruct the Application Class program directory from the
 * complete local HCDEV snapshot. Read-only: this does not call encodeProgram
 * and does not use a live connection.
 *
 * Usage:
 *   npx tsx tools/corpus/research/application-class-structure-analysis.ts
 *   npx tsx tools/corpus/research/application-class-structure-analysis.ts --examples
 */

import {
  PROGRAM_DIRECTORY_RECORD_SIZE,
  PROGRAM_DISPATCH_SLOT_SIZE,
  readProgramLayout
} from '../../../src/peoplecode/programLayout';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';
import type { SnapshotDefinition } from '../snapshot/types';

const APPLICATION_CLASS_OBJECT_ID = 104;

const FLAGS = {
  private: 0x00010000,
  property: 0x00020000,
  readonly: 0x00040000,
  storage: 0x00080000,
  getter: 0x00100000,
  setter: 0x00200000,
  self: 0x00400000,
  abstract: 0x00800000,
  protected: 0x01000000
} as const;

interface NameEntry {
  text: string;
  charOffset: number;
}

interface DirectoryRecord {
  index: number;
  nameOffset: number;
  name: string;
  signatureSlotOffset: number;
  attributesAndCount: number;
  descriptor: number;
  low: number;
  flags: number;
  kind: 'self' | 'property' | 'instance' | 'getter' | 'setter' | 'method';
}

type Visibility = 'public' | 'private' | 'protected';

interface Parameter {
  name: string;
  type: string;
  out: boolean;
}

interface MethodDeclaration {
  kind: 'method';
  name: string;
  parameters: Parameter[];
  returnType?: string;
  visibility: Visibility;
  abstract: boolean;
  sourceIndex: number;
}

interface PropertyDeclaration {
  kind: 'property';
  name: string;
  type: string;
  mode: 'plain' | 'readonly' | 'get' | 'get-set';
  visibility: Visibility;
  sourceIndex: number;
}

interface InstanceDeclaration {
  kind: 'instance';
  name: string;
  type: string;
  visibility: Visibility;
  sourceIndex: number;
}

interface ConstantDeclaration {
  kind: 'constant';
  name: string;
  visibility: Visibility;
  sourceIndex: number;
}

type MemberDeclaration =
  | MethodDeclaration
  | PropertyDeclaration
  | InstanceDeclaration
  | ConstantDeclaration;

interface Implementation {
  kind: 'method' | 'get' | 'set';
  name: string;
  sourceIndex: number;
}

interface ParsedSource {
  unitKind: 'class' | 'interface' | 'unparsed';
  sourceStatus: 'active' | 'entire-unit-commented' | 'no-source-unit';
  name: string;
  ownerPath: string;
  packageDepth: number;
  extendsType?: string;
  implementsTypes: string[];
  members: MemberDeclaration[];
  implementations: Implementation[];
  classRegion: string;
  implementationRegion: string;
}

interface ParsedProgram {
  definition: SnapshotDefinition;
  source: ParsedSource;
  names: NameEntry[];
  records: DirectoryRecord[];
  slots: number[];
  statementBytes: number;
  nameBytes: number;
  format: number;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeType(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = normalize(value);
  if (normalized === 'array') return 'array of any';
  if (/^(?:array of )+array$/.test(normalized)) return `${normalized} of any`;
  return normalized;
}

function sameName(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && normalize(a) === normalize(b);
}

function sameType(a: string | undefined, b: string | undefined): boolean {
  return normalizeType(a) === normalizeType(b);
}

function maskNonCode(source: string): string {
  const chars = [...source];
  let i = 0;
  while (i < chars.length) {
    const pair = `${chars[i] ?? ''}${chars[i + 1] ?? ''}`;
    if (
      source.slice(i, i + 3).toLowerCase() === 'rem' &&
      (i === 0 || !/[A-Za-z0-9_%&]/.test(source[i - 1])) &&
      /[\s:]/.test(source[i + 3] ?? '')
    ) {
      while (i < chars.length && chars[i] !== ';') {
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
        i++;
      }
      if (i < chars.length) chars[i++] = ' ';
      continue;
    }
    if (pair === '/*' || pair === '<*') {
      const close = pair === '/*' ? '*/' : '*>';
      chars[i++] = ' ';
      chars[i++] = ' ';
      while (i < chars.length && `${chars[i]}${chars[i + 1] ?? ''}` !== close) {
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
        i++;
      }
      if (i < chars.length) chars[i++] = ' ';
      if (i < chars.length) chars[i++] = ' ';
      continue;
    }
    if (pair === '//') {
      while (i < chars.length && chars[i] !== '\n') chars[i++] = ' ';
      continue;
    }
    if (chars[i] === '"') {
      chars[i++] = ' ';
      while (i < chars.length) {
        if (chars[i] === '"') {
          chars[i++] = ' ';
          if (chars[i] === '"') {
            chars[i++] = ' ';
            continue;
          }
          break;
        }
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
        i++;
      }
      continue;
    }
    i++;
  }
  return chars.join('');
}

function splitParameters(text: string): Parameter[] {
  const inner = text.trim();
  if (inner === '') return [];
  return inner.split(',').map(part => part.trim()).filter(Boolean).map(part => {
    const match = /^\s*(&[A-Za-z0-9_][A-Za-z0-9_]*#?)\s+As\s+(.+?)(\s+out)?\s*$/i.exec(part);
    return match
      ? { name: match[1], type: match[2].trim(), out: match[3] !== undefined }
      : { name: part.trim(), type: '<unparsed>', out: false };
  });
}

function ownerPath(definition: SnapshotDefinition): string {
  const values = [
    definition.objectvalue1,
    definition.objectvalue2,
    definition.objectvalue3,
    definition.objectvalue4,
    definition.objectvalue5,
    definition.objectvalue6,
    definition.objectvalue7
  ].map(value => value.trim());
  const onExecute = values.findIndex(value => value.toLowerCase() === 'onexecute');
  return values.slice(0, onExecute < 0 ? values.length : onExecute).filter(Boolean).join(':');
}

function parseSource(definition: SnapshotDefinition): ParsedSource {
  let masked = maskNonCode(definition.sourceText);
  let sourceStatus: ParsedSource['sourceStatus'] = 'active';
  let start = /\b(class|interface)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(masked);
  if (!start && /\bend-(?:class|interface)\b/i.test(definition.sourceText)) {
    const rawStart = /\b(class|interface)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(definition.sourceText);
    if (rawStart) {
      masked = definition.sourceText;
      start = rawStart;
      sourceStatus = 'entire-unit-commented';
    }
  }
  if (!start) {
    const path = ownerPath(definition);
    return {
      unitKind: 'unparsed',
      sourceStatus: 'no-source-unit',
      name: path.split(':').at(-1) ?? '',
      ownerPath: path,
      packageDepth: Math.max(0, path.split(':').length - 1),
      implementsTypes: [],
      members: [],
      implementations: [],
      classRegion: '',
      implementationRegion: ''
    };
  }
  const unitKind = start[1].toLowerCase() as 'class' | 'interface';
  const endPattern = new RegExp(`\\bend-${unitKind}\\s*;?`, 'i');
  const afterStart = masked.slice((start.index ?? 0) + start[0].length);
  const end = endPattern.exec(afterStart);
  if (!end) throw new Error(`Definition ${definition.definitionId}: no end-${unitKind}`);
  const absoluteStart = (start.index ?? 0) + start[0].length;
  const absoluteEnd = absoluteStart + (end.index ?? 0);
  const classRegion = masked.slice(absoluteStart, absoluteEnd);
  const implementationRegion = masked.slice(absoluteEnd + end[0].length);

  const firstMember = /\b(?:public|private|protected|method|property|instance|constant)\b/i.exec(classRegion);
  const header = classRegion.slice(0, firstMember?.index ?? classRegion.length).replace(/;/g, ' ');
  const extendsMatch = /\bextends\s+([%A-Za-z_][%A-Za-z0-9_]*(?::[%A-Za-z_][%A-Za-z0-9_]*)*)/i.exec(header);
  const implementsMatch = /\bimplements\s+([\s\S]*)/i.exec(header);
  const implementsTypes = implementsMatch
    ? implementsMatch[1].split(',').map(value => value.trim()).filter(Boolean)
    : [];

  type Event = { index: number; visibility?: Visibility; member?: MemberDeclaration };
  const events: Event[] = [];
  for (const match of classRegion.matchAll(/\b(public|private|protected)\b/gi)) {
    events.push({ index: match.index ?? 0, visibility: match[1].toLowerCase() as Visibility });
  }
  for (const match of classRegion.matchAll(
    /\bmethod\s+([A-Za-z_][A-Za-z0-9_$]*)\s*(?:\(([^;]*?)\))?\s*(?:Returns\s+([^;]+?))?\s*(abstract\s*)?;/gi
  )) {
    let returnType = match[3]?.trim();
    let abstract = match[4] !== undefined;
    if (returnType && /\s+abstract$/i.test(returnType)) {
      returnType = returnType.replace(/\s+abstract$/i, '').trim();
      abstract = true;
    }
    events.push({
      index: match.index ?? 0,
      member: {
        kind: 'method',
        name: match[1],
        parameters: splitParameters(match[2] ?? ''),
        returnType,
        visibility: 'public',
        abstract,
        sourceIndex: match.index ?? 0
      }
    });
  }
  const typePattern = '(?:array\\s+of\\s+)*(?:[%A-Za-z_][%A-Za-z0-9_]*(?::[%A-Za-z_][%A-Za-z0-9_]*)*)';
  const propertyPattern = new RegExp(
    `\\bproperty\\s+(${typePattern})\\s+([A-Za-z_][A-Za-z0-9_]*#?)\\s*(readonly|get(?:\\s+set)?|set(?:\\s+get)?)?\\s*;`,
    'gi'
  );
  for (const match of classRegion.matchAll(propertyPattern)) {
    const spelling = normalize(match[3] ?? '');
    const mode = spelling === 'readonly'
      ? 'readonly'
      : spelling === 'get'
        ? 'get'
        : spelling.includes('get') && spelling.includes('set')
          ? 'get-set'
          : 'plain';
    events.push({
      index: match.index ?? 0,
      member: {
        kind: 'property',
        type: match[1].trim(),
        name: match[2],
        mode,
        visibility: 'public',
        sourceIndex: match.index ?? 0
      }
    });
  }
  const instancePattern = new RegExp(`\\binstance\\s+(${typePattern})\\s+([^;]+?)(?:;|$)`, 'gim');
  for (const match of classRegion.matchAll(instancePattern)) {
    for (const name of match[2].match(/&[A-Za-z0-9_][A-Za-z0-9_]*#?/g) ?? []) {
      events.push({
        index: match.index ?? 0,
        member: {
          kind: 'instance',
          type: match[1].trim(),
          name: name.slice(1),
          visibility: 'private',
          sourceIndex: match.index ?? 0
        }
      });
    }
  }
  for (const match of classRegion.matchAll(/\bconstant\s+(&?[A-Za-z_][A-Za-z0-9_]*)\s*=/gi)) {
    events.push({
      index: match.index ?? 0,
      member: {
        kind: 'constant',
        name: match[1].replace(/^&/, ''),
        visibility: 'public',
        sourceIndex: match.index ?? 0
      }
    });
  }
  events.sort((a, b) => a.index - b.index);
  let visibility: Visibility = 'public';
  const members: MemberDeclaration[] = [];
  for (const event of events) {
    if (event.visibility) visibility = event.visibility;
    if (event.member) {
      event.member.visibility = event.member.kind === 'instance' ? 'private' : visibility;
      members.push(event.member);
    }
  }

  const implementations: Implementation[] = [];
  for (const match of implementationRegion.matchAll(/^\s*(method|get|set)\s+([A-Za-z_][A-Za-z0-9_$]*)\b/gim)) {
    implementations.push({
      kind: match[1].toLowerCase() as Implementation['kind'],
      name: match[2],
      sourceIndex: match.index ?? 0
    });
  }

  const path = ownerPath(definition);
  return {
    unitKind,
    sourceStatus,
    name: start[2],
    ownerPath: path,
    packageDepth: Math.max(0, path.split(':').length - 1),
    extendsType: extendsMatch?.[1],
    implementsTypes,
    members,
    implementations,
    classRegion,
    implementationRegion
  };
}

function classifyRecord(attributesAndCount: number): DirectoryRecord['kind'] {
  const flags = attributesAndCount & 0xffff0000;
  if ((flags & FLAGS.self) !== 0) return 'self';
  if ((flags & FLAGS.getter) !== 0) return 'getter';
  if ((flags & FLAGS.setter) !== 0) return 'setter';
  if ((flags & FLAGS.property) !== 0) {
    return (flags & FLAGS.private) !== 0 && (flags & FLAGS.storage) !== 0
      ? 'instance'
      : 'property';
  }
  return 'method';
}

function parseProgram(definition: SnapshotDefinition): ParsedProgram {
  const layout = readProgramLayout(definition.storedProgram);
  const bytes = definition.storedProgram;
  const names: NameEntry[] = [];
  let offset = layout.names.offset;
  const namesEnd = offset + layout.names.byteLength;
  while (offset < namesEnd) {
    let end = offset;
    while (end + 1 < namesEnd && (bytes[end] !== 0 || bytes[end + 1] !== 0)) end += 2;
    if (end + 1 >= namesEnd) throw new Error(`Definition ${definition.definitionId}: unterminated name`);
    names.push({
      text: bytes.toString('utf16le', offset, end),
      charOffset: (offset - layout.names.offset) / 2
    });
    offset = end + 2;
  }
  const nameByOffset = new Map(names.map(name => [name.charOffset, name.text]));
  const records: DirectoryRecord[] = [];
  for (let index = 0; index < layout.recordCount; index++) {
    const base = layout.records.offset + index * PROGRAM_DIRECTORY_RECORD_SIZE;
    const nameOffset = bytes.readUInt32LE(base);
    const attributesAndCount = bytes.readUInt32LE(base + 8);
    records.push({
      index,
      nameOffset,
      name: nameByOffset.get(nameOffset) ?? '<invalid-name-offset>',
      signatureSlotOffset: bytes.readUInt32LE(base + 4),
      attributesAndCount,
      descriptor: bytes.readUInt32LE(base + 12),
      low: attributesAndCount & 0xffff,
      flags: attributesAndCount & 0xffff0000,
      kind: classifyRecord(attributesAndCount)
    });
  }
  const slots: number[] = [];
  for (let index = 0; index < layout.slotCount; index++) {
    slots.push(bytes.readUInt32LE(layout.slots.offset + index * PROGRAM_DISPATCH_SLOT_SIZE));
  }
  return {
    definition,
    source: parseSource(definition),
    names,
    records,
    slots,
    statementBytes: layout.statements.byteLength,
    nameBytes: layout.names.byteLength,
    format: layout.format
  };
}

function decodeDescriptor(descriptor: number, names: readonly NameEntry[]): string | undefined {
  const arrayDepth = descriptor >>> 20;
  const core = descriptor & 0x000fffff;
  const scalars = new Map<number, string>([
    [1, 'string'], [2, 'date'], [4, 'any'], [5, 'boolean'], [10, 'time'], [11, 'datetime'],
    [13, 'object'], [17, 'integer'], [19, 'number']
  ]);
  const builtins = new Map<number, string>([
    [1, 'File'], [2, 'SQL'], [3, 'Record'], [7, 'Rowset'], [8, 'Row'], [9, 'Field'],
    [11, 'ProcessRequest'], [14, 'Message'], [15, 'ApiObject'], [20, 'Grid'],
    [27, 'JavaObject'], [29, 'XmlDoc'], [33, 'Exception'], [34, 'XmlNode'],
    [63, 'Document'], [66, 'Compound'], [67, 'Collection'], [73, 'Map'],
    [75, 'MapElement'], [97, 'JsonBuilder'], [99, 'JsonObject'], [100, 'JsonArray']
  ]);
  let result = scalars.get(core);
  if (result === undefined && (core & 0x80000) !== 0) {
    const sub = core & ~0x80000;
    result = builtins.get(sub);
    if (result === undefined && sub >= 0x100) {
      result = names.find(name => name.charOffset === sub - 0x100)?.text;
    }
  }
  return result === undefined ? undefined : `${'array of '.repeat(arrayDepth)}${result}`;
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) {
    const name = key(value);
    result[name] = (result[name] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => a[0].localeCompare(b[0])));
}

function topCounts(values: Record<string, number>, limit = 16): Record<string, number> {
  return Object.fromEntries(Object.entries(values).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit));
}

function sample<T>(values: readonly T[], render: (value: T) => unknown, limit = 12): unknown[] {
  return values.slice(0, limit).map(render);
}

function callableKey(kind: string, name: string): string {
  return `${kind.toLowerCase()}:${name.toLowerCase()}`;
}

function recordCallableKey(record: DirectoryRecord): string {
  const kind = record.kind === 'getter' ? 'get' : record.kind === 'setter' ? 'set' : 'method';
  return callableKey(kind, record.name);
}

function sourceTypePaths(source: string): Set<string> {
  const results = new Set<string>();
  for (const match of source.matchAll(/[%A-Za-z_][%A-Za-z0-9_]*(?::[%A-Za-z_][%A-Za-z0-9_]*)+/g)) {
    results.add(match[0].toUpperCase());
  }
  return results;
}

function finalPathPart(path: string): string {
  return path.split(':').at(-1)?.toUpperCase() ?? '';
}

function main(): void {
  const db = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(db).filter(definition => definition.objectid1 === APPLICATION_CLASS_OBJECT_ID);
  db.close();
  const programs = definitions.map(parseProgram);

  const invalidNameOffsets = programs.flatMap(program =>
    program.records.filter(record => record.name === '<invalid-name-offset>').map(record => ({
      id: program.definition.definitionId,
      record: record.index,
      offset: record.nameOffset
    }))
  );
  const selfFailures = programs.filter(program => {
    const self = program.records[0];
    return !self || self.kind !== 'self' || self.attributesAndCount !== FLAGS.self ||
      !sameName(self.name, program.source.ownerPath);
  });
  const recordedPrefixFailures = programs.filter(program =>
    program.records.some((record, index) => record.nameOffset !== program.names[index]?.charOffset)
  );
  const unrecordedNames = programs.flatMap(program =>
    program.names.slice(program.records.length).map(name => ({ program, name }))
  );
  const duplicateUnrecordedNames = programs.map(program => {
    const suffix = program.names.slice(program.records.length);
    const unique = new Set(suffix.map(name => normalize(name.text)));
    return { program, duplicates: suffix.length - unique.size };
  }).filter(item => item.duplicates > 0);

  const shapes = programs.map(program => {
    const methods = program.source.members.filter(member => member.kind === 'method') as MethodDeclaration[];
    const properties = program.source.members.filter(member => member.kind === 'property') as PropertyDeclaration[];
    const instances = program.source.members.filter(member => member.kind === 'instance');
    const constants = program.source.members.filter(member => member.kind === 'constant');
    return {
      id: program.definition.definitionId,
      unitKind: program.source.unitKind,
      sourceStatus: program.source.sourceStatus,
      methods: methods.length,
      properties: properties.length,
      instances: instances.length,
      constants: constants.length,
      extends: program.source.extendsType !== undefined,
      implements: program.source.implementsTypes.length > 0,
      nested: program.source.packageDepth > 1,
      constructor: methods.some(method => sameName(method.name, program.source.name))
    };
  });

  const records = programs.flatMap(program => program.records.map(record => ({ program, record })));
  const recordFlagCounts = countBy(records, item => `0x${item.record.flags.toString(16)}`);
  const recordKindCounts = countBy(records, item => item.record.kind);
  const directoryPhaseFailures = programs.filter(program => {
    let phase = -1;
    return program.records.some(record => {
      const next = record.kind === 'self'
        ? 0
        : record.kind === 'property' || record.kind === 'instance'
          ? 1
          : (record.flags & FLAGS.abstract) === 0
            ? 2
            : 3;
      if (next < phase) return true;
      phase = next;
      return false;
    });
  });

  const slotFailures: Array<Record<string, unknown>> = [];
  let callableRecords = 0;
  let terminators = 0;
  let parameterSlots = 0;
  let parameterSlotsWithModeFlags = 0;
  const referencedParameterSlotFlags: Record<string, number> = {};
  for (const program of programs) {
    const callables = program.records.filter(record => ['method', 'getter', 'setter'].includes(record.kind));
    callableRecords += callables.length;
    let expectedSlots = 0;
    const starts = [...callables].sort((a, b) => a.signatureSlotOffset - b.signatureSlotOffset);
    for (const record of starts) {
      if (record.signatureSlotOffset !== expectedSlots) {
        slotFailures.push({ id: program.definition.definitionId, name: record.name, expectedSlots, actual: record.signatureSlotOffset });
      }
      const end = record.signatureSlotOffset + record.low;
      if (program.slots[end] !== 7) {
        slotFailures.push({ id: program.definition.definitionId, name: record.name, terminatorAt: end, value: program.slots[end] });
      } else {
        terminators++;
      }
      for (let index = record.signatureSlotOffset; index < end; index++) {
        parameterSlots++;
        const flag = program.slots[index] & 0xc0000000;
        const key = `0x${(flag >>> 0).toString(16)}`;
        referencedParameterSlotFlags[key] = (referencedParameterSlotFlags[key] ?? 0) + 1;
        if (flag !== 0) parameterSlotsWithModeFlags++;
      }
      expectedSlots += record.low + 1;
    }
    if (expectedSlots !== program.slots.length) {
      slotFailures.push({ id: program.definition.definitionId, expectedSlotCount: expectedSlots, actualSlotCount: program.slots.length });
    }
  }

  let callableImplementationExact = 0;
  let callableImplementationCompared = 0;
  let interfaceDeclarationExact = 0;
  let interfaceDeclarationCompared = 0;
  const callableOrderMismatches: Array<Record<string, unknown>> = [];
  let abstractOrderCompared = 0;
  let abstractOrderExact = 0;
  for (const program of programs) {
    const actual = program.records
      .filter(record => ['method', 'getter', 'setter'].includes(record.kind))
      .filter(record => (record.flags & FLAGS.abstract) === 0)
      .map(recordCallableKey);
    const expected = program.source.implementations.map(implementation => callableKey(implementation.kind, implementation.name));
    if (program.source.unitKind === 'class' && program.source.sourceStatus === 'active' && expected.length > 0) {
      callableImplementationCompared++;
      if (actual.join('|') === expected.join('|')) callableImplementationExact++;
      else callableOrderMismatches.push({
        id: program.definition.definitionId,
        actual: actual.slice(0, 20),
        expected: expected.slice(0, 20)
      });
    }
    if (program.source.unitKind === 'interface') {
      const actualMethods = program.records.filter(record => record.kind === 'method').map(record => record.name.toLowerCase());
      const declared = program.source.members.filter(member => member.kind === 'method').map(member => member.name.toLowerCase());
      interfaceDeclarationCompared++;
      if (actualMethods.join('|') === declared.join('|')) interfaceDeclarationExact++;
      else callableOrderMismatches.push({ id: program.definition.definitionId, interfaceActual: actualMethods, interfaceExpected: declared });
    }
    const actualAbstract = program.records
      .filter(record => record.kind === 'method' && (record.flags & FLAGS.abstract) !== 0)
      .map(record => record.name.toLowerCase());
    const declaredAbstract = program.source.members
      .filter(member => member.kind === 'method' && (member.abstract || program.source.unitKind === 'interface'))
      .map(member => member.name.toLowerCase());
    if (declaredAbstract.length >= 2 && actualAbstract.length === declaredAbstract.length) {
      abstractOrderCompared++;
      if (actualAbstract.join('|') === declaredAbstract.join('|')) abstractOrderExact++;
    }
  }

  let memberOrderCompared = 0;
  let memberOrderExact = 0;
  const memberOrderSamples: Array<Record<string, unknown>> = [];
  for (const program of programs) {
    const declared = program.source.members
      .filter(member => member.kind === 'property' || member.kind === 'instance')
      .map(member => member.name.toLowerCase());
    const actual = program.records
      .filter(record => record.kind === 'property' || record.kind === 'instance')
      .map(record => record.name.toLowerCase());
    if (declared.length < 2 || declared.length !== actual.length) continue;
    memberOrderCompared++;
    if (declared.join('|') === actual.join('|')) memberOrderExact++;
    else if (memberOrderSamples.length < 12) memberOrderSamples.push({
      id: program.definition.definitionId,
      declared,
      directory: actual,
      storedOrdinals: program.records
        .filter(record => record.kind === 'property' || record.kind === 'instance')
        .map(record => record.low)
    });
  }

  let ordinalChecks = 0;
  let ordinalMatches = 0;
  const ordinalMismatches: Array<Record<string, unknown>> = [];
  for (const program of programs) {
    const storedMembers = program.source.members.filter(member =>
      member.kind === 'instance' ||
      (member.kind === 'property' && (member.mode === 'plain' || member.mode === 'readonly'))
    );
    for (const record of program.records) {
      if (record.kind !== 'instance' && !(record.kind === 'property' && (record.flags & FLAGS.storage) !== 0)) continue;
      ordinalChecks++;
      const expected = storedMembers.findIndex(member => sameName(member.name, record.name));
      if (expected === record.low) ordinalMatches++;
      else if (ordinalMismatches.length < 12) ordinalMismatches.push({
        id: program.definition.definitionId,
        kind: record.kind,
        name: record.name,
        expected,
        actual: record.low
      });
    }
  }

  const relationChecks: Record<string, number> = {
    noneMatched7: 0,
    extendsMatched: 0,
    implementsMatched: 0,
    bothMatchedExtends: 0,
    bothMatchedImplements: 0,
    mismatch: 0
  };
  const relationMismatches: Array<Record<string, unknown>> = [];
  for (const program of programs) {
    const selfType = decodeDescriptor(program.records[0].descriptor, program.names);
    const extended = program.source.extendsType;
    const implemented = program.source.implementsTypes;
    let bucket: keyof typeof relationChecks;
    if (!extended && implemented.length === 0 && program.records[0].descriptor === 7) bucket = 'noneMatched7';
    else if (extended && implemented.length === 0 && sameName(selfType, extended)) bucket = 'extendsMatched';
    else if (!extended && implemented.some(type => sameName(selfType, type))) bucket = 'implementsMatched';
    else if (extended && implemented.length > 0 && sameName(selfType, extended)) bucket = 'bothMatchedExtends';
    else if (extended && implemented.some(type => sameName(selfType, type))) bucket = 'bothMatchedImplements';
    else bucket = 'mismatch';
    relationChecks[bucket]++;
    if (bucket === 'mismatch' && relationMismatches.length < 12) relationMismatches.push({
      id: program.definition.definitionId,
      descriptor: `0x${program.records[0].descriptor.toString(16)}`,
      decoded: selfType,
      extends: extended,
      implements: implemented
    });
  }

  let methodSignatureChecks = 0;
  let methodParamCountMatches = 0;
  let methodReturnMatches = 0;
  let methodParameterTypeChecks = 0;
  let methodParameterTypeMatches = 0;
  let methodParameterModeChecks = 0;
  let methodParameterModeMatches = 0;
  let methodSlotOffsetChecks = 0;
  let methodSlotOffsetMatches = 0;
  let accessorSlotOffsetChecks = 0;
  let accessorSlotOffsetMatches = 0;
  let methodFlagChecks = 0;
  let methodFlagMatches = 0;
  const methodFlagMismatches: Array<Record<string, unknown>> = [];
  const unresolvedDescriptorEvidence = new Map<number, Map<string, number>>();
  const addUnresolvedDescriptor = (descriptor: number, sourceType: string | undefined, names: readonly NameEntry[]) => {
    if (sourceType === undefined || sourceType.includes(':') || decodeDescriptor(descriptor, names) !== undefined) return;
    const types = unresolvedDescriptorEvidence.get(descriptor) ?? new Map<string, number>();
    const type = normalizeType(sourceType) ?? '<none>';
    types.set(type, (types.get(type) ?? 0) + 1);
    unresolvedDescriptorEvidence.set(descriptor, types);
  };
  const signatureMismatches: Array<Record<string, unknown>> = [];
  for (const program of programs) {
    const declarations = program.source.members.filter(member => member.kind === 'method') as MethodDeclaration[];
    let expectedSlotOffset = 0;
    for (const declaration of declarations) {
      const candidates = program.records.filter(record =>
        record.kind === 'method' && sameName(record.name, declaration.name)
      );
      if (candidates.length !== 1) continue;
      const record = candidates[0];
      methodSignatureChecks++;
      methodSlotOffsetChecks++;
      if (record.signatureSlotOffset === expectedSlotOffset) methodSlotOffsetMatches++;
      if (record.low === declaration.parameters.length) methodParamCountMatches++;
      const decodedReturn = record.descriptor === 7 ? undefined : decodeDescriptor(record.descriptor, program.names);
      if (sameType(decodedReturn, declaration.returnType)) {
        methodReturnMatches++;
      }
      addUnresolvedDescriptor(record.descriptor, declaration.returnType, program.names);
      let expectedFlags = 0;
      if (declaration.abstract || program.source.unitKind === 'interface') {
        expectedFlags = FLAGS.abstract;
      } else if (declaration.visibility === 'private') {
        expectedFlags = FLAGS.private;
      } else if (declaration.visibility === 'protected') {
        expectedFlags = FLAGS.protected;
      }
      methodFlagChecks++;
      if (record.flags === expectedFlags) methodFlagMatches++;
      else if (methodFlagMismatches.length < 40) methodFlagMismatches.push({
        id: program.definition.definitionId,
        name: declaration.name,
        visibility: declaration.visibility,
        abstract: declaration.abstract,
        unitKind: program.source.unitKind,
        expectedFlags: `0x${expectedFlags.toString(16)}`,
        actualFlags: `0x${record.flags.toString(16)}`
      });
      const decodedParameters = declaration.parameters.map((_, index) =>
        decodeDescriptor(program.slots[record.signatureSlotOffset + index] & ~0xc0000000, program.names)
      );
      declaration.parameters.forEach((parameter, index) => {
        if (parameter.type === '<unparsed>') return;
        methodParameterTypeChecks++;
        const descriptor = program.slots[record.signatureSlotOffset + index] & ~0xc0000000;
        if (sameType(decodedParameters[index], parameter.type)) methodParameterTypeMatches++;
        methodParameterModeChecks++;
        const flags = (program.slots[record.signatureSlotOffset + index] & 0xc0000000) >>> 0;
        if ((flags === 0x80000000) === parameter.out && flags !== 0xc0000000) methodParameterModeMatches++;
        addUnresolvedDescriptor(descriptor, parameter.type, program.names);
      });
      if ((record.low !== declaration.parameters.length ||
        !sameType(decodedReturn, declaration.returnType)) &&
        signatureMismatches.length < 12) {
        signatureMismatches.push({
          id: program.definition.definitionId,
          name: declaration.name,
          sourceParams: declaration.parameters.map(parameter => parameter.type),
          recordParams: record.low,
          sourceReturn: declaration.returnType,
          decodedReturn
        });
      }
      expectedSlotOffset += declaration.parameters.length + 1;
    }
    const accessorImplementations = program.source.implementations.filter(implementation =>
      implementation.kind === 'get' || implementation.kind === 'set'
    );
    for (const implementation of accessorImplementations) {
      const kind = implementation.kind === 'get' ? 'getter' : 'setter';
      const accessor = program.records.find(record => record.kind === kind && sameName(record.name, implementation.name));
      if (accessor) {
        accessorSlotOffsetChecks++;
        if (accessor.signatureSlotOffset === expectedSlotOffset) accessorSlotOffsetMatches++;
        expectedSlotOffset += implementation.kind === 'get' ? 1 : 2;
      }
    }
  }

  let propertyTypeChecks = 0;
  let propertyTypeMatches = 0;
  const propertyFlagChecks: Record<string, { checked: number; matched: number }> = {};
  const propertyMismatches: Array<Record<string, unknown>> = [];
  for (const program of programs) {
    const properties = program.source.members.filter(member => member.kind === 'property') as PropertyDeclaration[];
    for (const property of properties) {
      const record = program.records.find(candidate => candidate.kind === 'property' && sameName(candidate.name, property.name));
      if (!record) continue;
      propertyTypeChecks++;
      const decoded = decodeDescriptor(record.descriptor, program.names);
      if (sameType(decoded, property.type)) propertyTypeMatches++;
      addUnresolvedDescriptor(record.descriptor, property.type, program.names);
      let expected = FLAGS.property;
      if (program.source.unitKind !== 'interface' && (property.mode === 'plain' || property.mode === 'readonly')) expected |= FLAGS.storage;
      if (property.mode === 'readonly' || property.mode === 'get') expected |= FLAGS.readonly;
      if (program.source.unitKind === 'interface') expected |= FLAGS.abstract;
      if (property.visibility === 'private') expected |= FLAGS.private;
      if (property.visibility === 'protected') expected |= FLAGS.protected;
      const key = `${program.source.unitKind}:${property.visibility}:${property.mode}`;
      propertyFlagChecks[key] ??= { checked: 0, matched: 0 };
      propertyFlagChecks[key].checked++;
      if (record.flags === expected) propertyFlagChecks[key].matched++;
      else if (propertyMismatches.length < 12) propertyMismatches.push({
        id: program.definition.definitionId,
        name: property.name,
        sourceType: property.type,
        decodedType: decoded,
        expectedFlags: `0x${expected.toString(16)}`,
        actualFlags: `0x${record.flags.toString(16)}`
      });
    }
  }

  const constants = programs.flatMap(program => program.source.members
    .filter(member => member.kind === 'constant')
    .map(member => ({ program, member }))
  );
  const constantRecordNameMatches = constants.filter(({ program, member }) =>
    program.records.some(record => sameName(record.name, member.name))
  );

  const outParameterCallables = records.filter(({ program, record }) => {
    if (!['method', 'getter', 'setter'].includes(record.kind)) return false;
    for (let index = 0; index < record.low; index++) {
      if ((program.slots[record.signatureSlotOffset + index] & 0xc0000000) !== 0) return true;
    }
    return false;
  });

  const unresolvedDescriptors = [...unresolvedDescriptorEvidence.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([descriptor, types]) => ({
      descriptor: `0x${descriptor.toString(16)}`,
      observations: [...types.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count }))
    }));

  const dependencyRows = programs.flatMap(program => program.definition.names.map(row => ({ program, row })));
  const packageRows = dependencyRows.filter(item => item.row.recname.trim().toUpperCase() === 'PACKAGE');
  let relationDependencyChecks = 0;
  let relationDependencyMatches = 0;
  for (const program of programs) {
    const relation = program.source.extendsType ?? program.source.implementsTypes[0];
    if (!relation) continue;
    relationDependencyChecks++;
    if (program.definition.names.some(row =>
      row.recname.trim().toUpperCase() === 'PACKAGE' && row.refname.trim().toUpperCase() === finalPathPart(relation)
    )) relationDependencyMatches++;
  }
  const dependencyOrigin = { classOnly: 0, bodyOnly: 0, both: 0, unresolved: 0 };
  for (const { program, row } of packageRows) {
    const reference = row.refname.trim().toUpperCase();
    const classPaths = sourceTypePaths(program.source.classRegion);
    const bodyPaths = sourceTypePaths(program.source.implementationRegion);
    const inClass = [...classPaths].some(path => finalPathPart(path) === reference);
    const inBody = [...bodyPaths].some(path => finalPathPart(path) === reference) || row.appclassmethod.trim() !== '';
    if (inClass && inBody) dependencyOrigin.both++;
    else if (inClass) dependencyOrigin.classOnly++;
    else if (inBody) dependencyOrigin.bodyOnly++;
    else dependencyOrigin.unresolved++;
  }

  const summary = {
    snapshot: {
      applicationClassDefinitions: programs.length,
      definitionRange: [programs[0]?.definition.definitionId, programs.at(-1)?.definition.definitionId],
      sourceBytes: programs.reduce((sum, program) => sum + Buffer.byteLength(program.definition.sourceText), 0),
      programBytes: programs.reduce((sum, program) => sum + program.definition.storedProgram.length, 0)
    },
    shapes: {
      units: countBy(shapes, shape => shape.unitKind),
      sourceStatus: countBy(shapes, shape => shape.sourceStatus),
      empty: shapes.filter(shape => shape.methods === 0 && shape.properties === 0 && shape.instances === 0 && shape.constants === 0).length,
      emptyActiveUnits: shapes.filter(shape => shape.sourceStatus === 'active' && shape.methods === 0 && shape.properties === 0 && shape.instances === 0 && shape.constants === 0).length,
      methodCount: countBy(shapes, shape => shape.methods === 0 ? '0' : shape.methods === 1 ? '1' : '2+'),
      properties: shapes.filter(shape => shape.properties > 0).length,
      instances: shapes.filter(shape => shape.instances > 0).length,
      constants: shapes.filter(shape => shape.constants > 0).length,
      inheritance: shapes.filter(shape => shape.extends).length,
      interfacesImplemented: shapes.filter(shape => shape.implements).length,
      nestedPackagePath: shapes.filter(shape => shape.nested).length,
      constructorPresent: shapes.filter(shape => shape.constructor).length
    },
    sections: {
      formats: countBy(programs, program => `0x${program.format.toString(16)}`),
      statementBytes: {
        min: Math.min(...programs.map(program => program.statementBytes)),
        max: Math.max(...programs.map(program => program.statementBytes))
      },
      nameBytes: {
        min: Math.min(...programs.map(program => program.nameBytes)),
        max: Math.max(...programs.map(program => program.nameBytes))
      },
      names: programs.reduce((sum, program) => sum + program.names.length, 0),
      unrecordedTypeNames: unrecordedNames.length,
      unrecordedNamesWithoutColon: unrecordedNames.filter(item => !item.name.text.includes(':')).length,
      programsWithDuplicateTypeNames: duplicateUnrecordedNames.length,
      duplicateTypeNameOccurrences: duplicateUnrecordedNames.reduce((sum, item) => sum + item.duplicates, 0),
      records: records.length,
      slots: programs.reduce((sum, program) => sum + program.slots.length, 0),
      invalidNameOffsets: invalidNameOffsets.length,
      recordedNamesArePrefixFailures: recordedPrefixFailures.length,
      selfRecordFailures: selfFailures.length
    },
    directory: {
      recordKinds: recordKindCounts,
      flagWords: recordFlagCounts,
      phaseOrderFailures: directoryPhaseFailures.length,
      implementationOrder: {
        comparedClasses: callableImplementationCompared,
        exactClasses: callableImplementationExact,
        mismatches: callableImplementationCompared - callableImplementationExact
      },
      interfaceDeclarationOrder: {
        comparedInterfaces: interfaceDeclarationCompared,
        exactInterfaces: interfaceDeclarationExact,
        mismatches: interfaceDeclarationCompared - interfaceDeclarationExact
      },
      abstractDeclarationOrder: {
        comparedPrograms: abstractOrderCompared,
        exactPrograms: abstractOrderExact,
        differsFromSourceOrder: abstractOrderCompared - abstractOrderExact
      },
      storedMemberOrder: {
        compared: memberOrderCompared,
        equalsSourceOrder: memberOrderExact,
        differsFromSourceOrder: memberOrderCompared - memberOrderExact,
        ordinalChecks,
        ordinalMatches,
        ordinalMismatches: ordinalChecks - ordinalMatches
      }
    },
    signatures: {
      callableRecords,
      terminators,
      slotLayoutFailures: slotFailures.length,
      parameterSlots,
      parameterSlotsWithModeFlags,
      referencedParameterSlotFlags,
      methodSignatureChecks,
      parameterCountMatches: methodParamCountMatches,
      returnTypeMatches: methodReturnMatches,
      parameterTypeChecks: methodParameterTypeChecks,
      parameterTypeMatches: methodParameterTypeMatches,
      parameterModeChecks: methodParameterModeChecks,
      parameterModeMatches: methodParameterModeMatches,
      methodSlotOffsetChecks,
      methodSlotOffsetMatches,
      accessorSlotOffsetChecks,
      accessorSlotOffsetMatches,
      methodFlagChecks,
      methodFlagMatches,
      outParameterCallableRecords: outParameterCallables.length,
      outParameterCallablePrograms: new Set(outParameterCallables.map(item => item.program.definition.definitionId)).size,
      unresolvedFixedDescriptors: unresolvedDescriptors
    },
    properties: {
      typeChecks: propertyTypeChecks,
      typeMatches: propertyTypeMatches,
      flagChecks: propertyFlagChecks
    },
    constants: {
      declarations: constants.length,
      directoryNameMatches: constantRecordNameMatches.length
    },
    classRelationDescriptor: relationChecks,
    dependencies: {
      totalRows: dependencyRows.length,
      blankSentinels: dependencyRows.filter(item => item.row.recname.trim() === '').length,
      packageRows: packageRows.length,
      packageRowsWithRoot: packageRows.filter(item => item.row.packageroot.trim() !== '').length,
      packageRowsWithQualifyPath: packageRows.filter(item => item.row.qualifypath.trim() !== '').length,
      packageRowsWithMethod: packageRows.filter(item => item.row.appclassmethod.trim() !== '').length,
      relationDependencyChecks,
      relationDependencyMatches,
      packageOriginByFinalTypeName: dependencyOrigin,
      recnameKindsTop16: topCounts(countBy(dependencyRows, item => item.row.recname.trim() || '<blank>'))
    }
  };

  console.log(JSON.stringify(summary, null, 2));
  if (process.argv.includes('--examples')) {
    console.log(JSON.stringify({
      selfFailures: sample(selfFailures, program => program.definition.definitionId),
      recordedPrefixFailures: sample(recordedPrefixFailures, program => program.definition.definitionId),
      callableOrderMismatches: callableOrderMismatches.slice(0, 12),
      memberOrderSamples,
      ordinalMismatches,
      slotFailures: slotFailures.slice(0, 12),
      relationMismatches,
      signatureMismatches,
      methodFlagMismatches,
      outParameterCallableSamples: sample(outParameterCallables, ({ program, record }) => ({
        id: program.definition.definitionId,
        name: record.name,
        slots: program.slots.slice(record.signatureSlotOffset, record.signatureSlotOffset + record.low)
          .map(value => `0x${value.toString(16)}`)
      })),
      propertyMismatches
    }, null, 2));
  }
}

main();
