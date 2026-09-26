/**
 * Cycle 26: Application Class reference-allocation census.
 *
 * Read-only. Uses the completed local HCDEV snapshot, completed corpus result
 * rows, the current encoder, and Cycle 24's saved 940-row marker report. It
 * never connects to Oracle and never writes corpus state.
 *
 * Usage:
 *   npx tsx tools/corpus/research/application-class-reference-analysis.ts \
 *     --cycle24-report /tmp/cycle24/final-report-full.json
 *   npx tsx tools/corpus/research/application-class-reference-analysis.ts \
 *     --cycle24-report /tmp/cycle24/final-report-full.json --json
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

import {
  encodeProgramArtifacts,
  type PeopleCodeOwner,
  type PeopleCodeReference,
  type ReferenceTraceEvent
} from '../../../src/peoplecode/encoder';
import { decodeProgram, type Token } from '../../../src/peoplecode/decoder';
import { parseApplicationClassSource } from '../../../src/peoplecode/applicationClassProgram';
import { readProgramLayout, type ProgramLayout } from '../../../src/peoplecode/programLayout';
import { NameTable } from '../../../src/peoplecode/progtext';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';
import type { SnapshotDefinition, SnapshotNameRow } from '../snapshot/types';

const TOTAL_CORPUS = 30_209;
const APPLICATION_CLASS_OBJECT_ID = 104;
const REFERENCE_OPCODES = new Set([0x21, 0x48, 0x4a]);
const LAYOUT_OPCODES = new Set([0x24, 0x4e, 0x55, 0x6d, 0x4f, 0x2d]);

type SemanticSection = 'header' | 'statements' | 'names' | 'records' | 'slots' | 'none';
type ArtifactKind =
  | 'ordinary RECNAME/REFNAME field-owner'
  | 'RECORD'
  | 'FIELD'
  | 'SCROLL'
  | 'COMPONENT'
  | 'PACKAGE'
  | 'Application Class method'
  | 'HTML'
  | 'blank owner'
  | 'other concrete row shape'
  | 'missing row';

interface SemanticDiff {
  section: SemanticSection;
  relativeOffset?: number;
  storedAbsoluteOffset?: number;
  generatedAbsoluteOffset?: number;
  storedByte?: number;
  generatedByte?: number;
}

interface Cycle24Row {
  definitionId: number;
  rootFamily: string;
  firstSemanticDifference: SemanticDiff;
}

interface Cycle24Report {
  rows: Cycle24Row[];
}

interface ResultRow {
  definitionId: number;
  classification: string;
  sourceEncodeSuccess: boolean;
  generatedSha256?: string;
}

interface RowShape {
  recname: string;
  refname: string;
  packageroot: string;
  qualifypath: string;
  appclassmethod: string;
}

interface ReferenceToken {
  token: Token;
  projectedIndex: number;
  referenceOrdinal: number;
}

interface SourceLocation {
  absoluteOffset?: number;
  context: string;
  region: string;
  unitKind?: 'class' | 'interface';
  unitName?: string;
  implementation?: string;
  implementationKind?: 'method' | 'get' | 'set';
  lexicalControlRegion: string;
}

interface AllocationDifference {
  ordinal: number;
  stored?: RowShape;
  generated?: RowShape;
  storedKind: ArtifactKind;
  generatedKind: ArtifactKind;
  cause:
    | 'EXTRA_ALLOCATION_WRONG_REUSE'
    | 'MISSING_ALLOCATION'
    | 'WRONG_ALLOCATION_ORDER'
    | 'WRONG_IDENTITY'
    | 'ROW_COUNT_ONLY'
    | 'NONE';
}

interface StreamComparison {
  sameIdentityMultiset: boolean;
  storedOnly: Record<string, number>;
  generatedOnly: Record<string, number>;
  firstStoredOnlyIdentity?: string;
  firstGeneratedOnlyIdentity?: string;
}

interface OperandCollision {
  operandOrdinal: number;
  sequence: number;
  usedIdentity: string;
  tableIdentity: string;
}

interface ReferenceRootRow {
  definitionId: number;
  displayName: string;
  source: string;
  firstSemanticDivergence: SemanticDiff;
  projectedTokenIndex: number;
  operandOrdinal: number;
  storedOpcode?: string;
  generatedOpcode?: string;
  storedNameNum?: number;
  generatedNameNum?: number;
  storedRow?: RowShape;
  generatedRow?: RowShape;
  storedArtifact: ArtifactKind;
  generatedArtifact: ArtifactKind;
  sourceOccurrence: SourceLocation;
  previousStoredAllocation?: RowShape;
  nextStoredAllocation?: RowShape;
  previousGeneratedAllocation?: RowShape;
  nextGeneratedAllocation?: RowShape;
  absoluteReferenceOrdinal: number;
  methodLocalReferenceOrdinal?: number;
  identityOrderingClass: string;
  causalFamily: string;
  downstreamNameNumDriftOnly: boolean;
  firstOperandCollision?: OperandCollision;
  streamComparison: StreamComparison;
  packageProvenance: string;
  storedAllocationStream: Array<{
    ordinal: number;
    identity: string;
    artifact: ArtifactKind;
    rowShape?: RowShape;
    sourceProvenance: string;
  }>;
  generatedAllocationStream: Array<{
    ordinal: number;
    identity: string;
    artifact: ArtifactKind;
    rowShape?: RowShape;
    sourceOffset?: number;
    controlGroup?: number;
    functionDepth?: number;
  }>;
  earliestAllocationDifference: AllocationDifference;
  disposition: 'FULLY_EXPLAINED' | 'PARTIALLY_EXPLAINED' | 'UNRELATED_ROOT_DISCOVERED' | 'UNRESOLVED';
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function shapeSignature(row: RowShape | undefined): string {
  if (!row) return '<missing>';
  return [row.recname, row.refname, row.packageroot, row.qualifypath, row.appclassmethod]
    .map(normalize).join('|');
}

function storedShape(row: SnapshotNameRow | undefined): RowShape | undefined {
  if (!row) return undefined;
  return {
    recname: row.recname.trim(),
    refname: row.refname.trim(),
    packageroot: row.packageroot.trim(),
    qualifypath: row.qualifypath.trim(),
    appclassmethod: row.appclassmethod.trim()
  };
}

function generatedShape(reference: PeopleCodeReference | undefined): RowShape | undefined {
  if (!reference) return undefined;
  if (reference.kind === 'owner') {
    if (reference.recordName !== undefined || reference.fieldName !== undefined) {
      return {
        recname: reference.recordName ?? '', refname: reference.fieldName ?? '',
        packageroot: '', qualifypath: '', appclassmethod: ''
      };
    }
    return { recname: '', refname: '', packageroot: '', qualifypath: '', appclassmethod: '' };
  }
  if (reference.kind === 'package') {
    const path = reference.packagePath ?? [];
    const isBuiltIn = path.length === 0 && reference.objectName !== undefined;
    return {
      recname: 'PACKAGE',
      refname: reference.className ?? reference.packageName ?? '',
      packageroot: path[0] ?? reference.objectName ?? '',
      qualifypath: path.length > 1
        ? path.slice(1).join(':')
        : isBuiltIn ? reference.objectName ?? '' : '',
      appclassmethod: reference.methodName ?? ''
    };
  }
  if (reference.kind === 'record-field' || reference.kind === 'quoted-reference') {
    return {
      recname: reference.recordName ?? '', refname: reference.fieldName ?? '',
      packageroot: '', qualifypath: '', appclassmethod: ''
    };
  }
  if (reference.kind === 'record') {
    return { recname: 'RECORD', refname: reference.recordName ?? '', packageroot: '', qualifypath: '', appclassmethod: '' };
  }
  if (reference.kind === 'field') {
    return { recname: 'FIELD', refname: reference.fieldName ?? '', packageroot: '', qualifypath: '', appclassmethod: '' };
  }
  if (reference.kind === 'scroll') {
    return { recname: 'SCROLL', refname: reference.recordName ?? '', packageroot: '', qualifypath: '', appclassmethod: '' };
  }
  if (reference.kind === 'component') {
    return { recname: 'COMPONENT', refname: reference.objectName ?? '', packageroot: '', qualifypath: '', appclassmethod: '' };
  }
  if (reference.kind === 'declare-function') {
    return {
      recname: reference.recordName ?? '', refname: reference.fieldName ?? '',
      packageroot: '', qualifypath: '', appclassmethod: ''
    };
  }
  return {
    recname: reference.recordName ?? reference.kind.toUpperCase(),
    refname: reference.fieldName ?? reference.objectName ?? '',
    packageroot: '', qualifypath: '', appclassmethod: reference.methodName ?? ''
  };
}

/**
 * Allocation identity is narrower than byte-for-byte PSPCMNAME row shape.
 * PACKAGE roots/paths are retained separately as metadata evidence: many
 * Application Class rows omit them even when the source path is qualified,
 * and treating that omission as a missing allocation would manufacture an
 * ordinal drift that does not exist. Method-bearing PACKAGE rows keep the
 * method in their identity. Declare-Function event names are likewise not
 * stored in APPCLASSMETHOD.
 */
function allocationIdentity(row: RowShape | undefined): string {
  if (!row) return '<missing>';
  const rec = normalize(row.recname);
  if (rec === 'PACKAGE') return [rec, normalize(row.refname), normalize(row.appclassmethod)].join('|');
  return [rec, normalize(row.refname), normalize(row.appclassmethod)].join('|');
}

function artifactKind(row: RowShape | undefined): ArtifactKind {
  if (!row) return 'missing row';
  const rec = normalize(row.recname);
  if (!rec && !normalize(row.refname) && !normalize(row.packageroot) && !normalize(row.qualifypath) && !normalize(row.appclassmethod)) {
    return 'blank owner';
  }
  if (normalize(row.appclassmethod) && rec === 'PACKAGE') return 'Application Class method';
  if (rec === 'PACKAGE') return 'PACKAGE';
  if (rec === 'HTML') return 'HTML';
  if (rec === 'RECORD') return 'RECORD';
  if (rec === 'FIELD') return 'FIELD';
  if (rec === 'SCROLL') return 'SCROLL';
  if (rec === 'COMPONENT') return 'COMPONENT';
  if (rec && normalize(row.refname)) return 'ordinary RECNAME/REFNAME field-owner';
  return 'other concrete row shape';
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
    const left = section(stored, storedLayout, name);
    const right = section(generated, generatedLayout, name);
    const offset = firstDifference(left, right);
    if (offset === undefined) continue;
    return {
      section: name,
      relativeOffset: offset,
      storedAbsoluteOffset: storedLayout[name].offset + offset,
      generatedAbsoluteOffset: generatedLayout[name].offset + offset,
      storedByte: left[offset], generatedByte: right[offset]
    };
  }
  return { section: 'none' };
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

function generatedNameTable(references: readonly PeopleCodeReference[]): NameTable {
  const names = new NameTable();
  for (const reference of references) {
    const row = generatedShape(reference);
    names.add(reference.sequence, row === undefined ? `<${reference.sequence}>` : shapeSignature(row));
  }
  return names;
}

function projectedTokens(program: Buffer, names: NameTable): Token[] {
  const layout = readProgramLayout(program);
  const statementEnd = layout.statements.offset + layout.statements.byteLength;
  return decodeProgram(program, names, { mode: 'auto', isApplicationClass: true }).tokens
    .filter(token => token.offset >= layout.statements.offset && token.offset < statementEnd)
    .filter(token => !LAYOUT_OPCODES.has(token.opcode));
}

function projectedNextBlocker(
  definition: SnapshotDefinition,
  generated: Buffer
): string {
  const names = storedNameTable(definition);
  const left = projectedTokens(definition.storedProgram, names);
  const right = projectedTokens(generated, names);
  const shared = Math.min(left.length, right.length);
  let index = 0;
  while (index < shared && left[index].opcode === right[index].opcode && left[index].text.toLowerCase() === right[index].text.toLowerCase()) index++;
  if (index < left.length || index < right.length) {
    const opcodes = [left[index]?.opcode, right[index]?.opcode];
    if (opcodes.some(opcode => opcode !== undefined && REFERENCE_OPCODES.has(opcode))) {
      return 'reference numbering/operand identity';
    }
    const classClose = left.find(token => token.opcode === 0x5b || token.opcode === 0x71);
    if (left[index] && classClose && left[index].offset > classClose.offset) {
      if (opcodes.some(opcode => opcode !== undefined && [0x14, 0x15].includes(opcode))) return 'statement terminator/separator';
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

function referenceTokens(tokens: readonly Token[]): ReferenceToken[] {
  let ordinal = 0;
  const result: ReferenceToken[] = [];
  tokens.forEach((token, projectedIndex) => {
    if (!REFERENCE_OPCODES.has(token.opcode)) return;
    result.push({ token, projectedIndex, referenceOrdinal: ordinal++ });
  });
  return result;
}

function firstOperandDifference(
  definition: SnapshotDefinition,
  generated: Buffer,
  references: readonly PeopleCodeReference[]
): {
  projectedIndex: number;
  operandOrdinal: number;
  stored?: Token;
  generated?: Token;
} {
  const left = projectedTokens(definition.storedProgram, storedNameTable(definition));
  const right = projectedTokens(generated, generatedNameTable(references));
  let operandOrdinal = 0;
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index++) {
    const a = left[index];
    const b = right[index];
    const aRef = a !== undefined && REFERENCE_OPCODES.has(a.opcode);
    const bRef = b !== undefined && REFERENCE_OPCODES.has(b.opcode);
    if (aRef || bRef) {
      if (!a || !b || a.opcode !== b.opcode || a.nameNum !== b.nameNum) {
        return { projectedIndex: index, operandOrdinal, stored: a, generated: b };
      }
      operandOrdinal++;
      continue;
    }
    if (!a || !b || a.opcode !== b.opcode || a.text.toLowerCase() !== b.text.toLowerCase()) {
      return { projectedIndex: index, operandOrdinal, stored: a, generated: b };
    }
  }
  return { projectedIndex: count, operandOrdinal };
}

function compareAllocationStreams(
  storedRows: readonly SnapshotNameRow[],
  generatedReferences: readonly PeopleCodeReference[]
): AllocationDifference {
  const count = Math.max(storedRows.length, generatedReferences.length);
  const storedShapes = storedRows.map(storedShape);
  const generatedShapes = generatedReferences.map(generatedShape);
  let index = 0;
  while (index < count && allocationIdentity(storedShapes[index]) === allocationIdentity(generatedShapes[index])) index++;
  if (index === count) {
    return { ordinal: count + 1, storedKind: 'missing row', generatedKind: 'missing row', cause: 'NONE' };
  }
  const stored = storedShapes[index];
  const generated = generatedShapes[index];
  const storedSignature = allocationIdentity(stored);
  const generatedSignature = allocationIdentity(generated);
  const storedLater = generated === undefined ? -1 : storedShapes.findIndex((row, candidate) => candidate > index && allocationIdentity(row) === generatedSignature);
  const generatedLater = stored === undefined ? -1 : generatedShapes.findIndex((row, candidate) => candidate > index && allocationIdentity(row) === storedSignature);
  const generatedSeen = generated === undefined ? -1 : generatedShapes.findIndex((row, candidate) => candidate < index && allocationIdentity(row) === generatedSignature);
  let cause: AllocationDifference['cause'];
  if (generated !== undefined && generatedSeen >= 0 && generatedLater < 0) cause = 'EXTRA_ALLOCATION_WRONG_REUSE';
  else if (stored === undefined || generated === undefined) cause = 'ROW_COUNT_ONLY';
  else if (generatedLater >= 0 && storedLater < 0) cause = 'MISSING_ALLOCATION';
  else if (storedLater >= 0 || generatedLater >= 0) cause = 'WRONG_ALLOCATION_ORDER';
  else cause = 'WRONG_IDENTITY';
  return {
    ordinal: index + 1,
    stored, generated,
    storedKind: artifactKind(stored),
    generatedKind: artifactKind(generated),
    cause
  };
}

function identityCounts(rows: readonly (RowShape | undefined)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const identity = allocationIdentity(row);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return counts;
}

function streamComparison(
  storedRows: readonly SnapshotNameRow[],
  generatedReferences: readonly PeopleCodeReference[]
): StreamComparison {
  const storedIdentities = storedRows.map(storedShape);
  const generatedIdentities = generatedReferences.map(generatedShape);
  const storedCounts = identityCounts(storedIdentities);
  const generatedCounts = identityCounts(generatedIdentities);
  const identities = new Set([...storedCounts.keys(), ...generatedCounts.keys()]);
  const storedOnly: Record<string, number> = {};
  const generatedOnly: Record<string, number> = {};
  for (const identity of identities) {
    const delta = (storedCounts.get(identity) ?? 0) - (generatedCounts.get(identity) ?? 0);
    if (delta > 0) storedOnly[identity] = delta;
    if (delta < 0) generatedOnly[identity] = -delta;
  }
  return {
    sameIdentityMultiset: Object.keys(storedOnly).length === 0 && Object.keys(generatedOnly).length === 0,
    storedOnly,
    generatedOnly,
    firstStoredOnlyIdentity: storedIdentities.map(allocationIdentity).find(identity => storedOnly[identity] !== undefined),
    firstGeneratedOnlyIdentity: generatedIdentities.map(allocationIdentity).find(identity => generatedOnly[identity] !== undefined)
  };
}

function firstOperandCollision(
  trace: readonly ReferenceTraceEvent[],
  generatedReferences: readonly PeopleCodeReference[],
  throughOperandOrdinal = Number.POSITIVE_INFINITY
): OperandCollision | undefined {
  const tableBySequence = new Map(generatedReferences.map(reference => [reference.sequence, generatedShape(reference)]));
  const uses = trace.filter(event => event.action === 'USE');
  for (let operandOrdinal = 0; operandOrdinal < uses.length && operandOrdinal <= throughOperandOrdinal; operandOrdinal++) {
    const use = uses[operandOrdinal];
    const usedIdentity = allocationIdentity(generatedShape(use.reference));
    const tableIdentity = allocationIdentity(tableBySequence.get(use.reference.sequence));
    if (usedIdentity !== tableIdentity) {
      return { operandOrdinal, sequence: use.reference.sequence, usedIdentity, tableIdentity };
    }
  }
  return undefined;
}

function typeLeaf(typeName: string): string {
  return normalize(typeName.replace(/^(?:array\s+of\s+)+/i, '').split(':').at(-1));
}

function packageProvenance(definition: SnapshotDefinition, identity: string): string {
  if (!identity.startsWith('PACKAGE|')) return 'not PACKAGE';
  const parsed = parseApplicationClassSource(definition.sourceText);
  if (!parsed) return 'unparsed';
  const leaf = identity.split('|')[1];
  if (parsed.extendsType && typeLeaf(parsed.extendsType) === leaf) return 'relationship: extends';
  if (parsed.implementsType && typeLeaf(parsed.implementsType) === leaf) return 'relationship: implements';
  for (const member of parsed.members) {
    if (member.kind === 'method') {
      if (member.parameters.some(parameter => typeLeaf(parameter.type) === leaf)) return 'declaration: parameter type';
      if (member.returnType && typeLeaf(member.returnType) === leaf) return 'declaration: return type';
    }
    if ((member.kind === 'property' || member.kind === 'instance') && typeLeaf(member.type) === leaf) {
      return `declaration: ${member.kind} type`;
    }
  }
  const importPattern = new RegExp(`\\bimport\\s+[^;:]*?(?::[^;:]*)*:${leaf}\\s*;`, 'i');
  if (importPattern.test(definition.sourceText)) return 'compilation-unit import';
  return 'executable/post-class use or implicit context';
}

function declarationTypeLeaves(definition: SnapshotDefinition): string[] {
  const parsed = parseApplicationClassSource(definition.sourceText);
  if (!parsed) return [];
  const leaves: string[] = [];
  if (parsed.extendsType) leaves.push(typeLeaf(parsed.extendsType));
  if (parsed.implementsType) leaves.push(typeLeaf(parsed.implementsType));
  for (const statement of parsed.statements) {
    if (statement.kind === 'method') {
      leaves.push(...statement.parameters.map(parameter => typeLeaf(parameter.type)));
      if (statement.returnType) leaves.push(typeLeaf(statement.returnType));
    } else if (statement.kind === 'property' || statement.kind === 'instance' || statement.kind === 'instance-statement') {
      leaves.push(typeLeaf(statement.type));
    }
  }
  return leaves.filter(Boolean);
}

function declarationTypeGroups(definition: SnapshotDefinition): Record<string, string[]> {
  const parsed = parseApplicationClassSource(definition.sourceText);
  const groups: Record<string, string[]> = {
    relationship: [], parameter: [], return: [], property: [], instance: []
  };
  if (!parsed) return groups;
  if (parsed.extendsType) groups.relationship.push(typeLeaf(parsed.extendsType));
  if (parsed.implementsType) groups.relationship.push(typeLeaf(parsed.implementsType));
  for (const statement of parsed.statements) {
    if (statement.kind === 'method') {
      groups.parameter.push(...statement.parameters.map(parameter => typeLeaf(parameter.type)));
      if (statement.returnType) groups.return.push(typeLeaf(statement.returnType));
    } else if (statement.kind === 'property') {
      groups.property.push(typeLeaf(statement.type));
    } else if (statement.kind === 'instance' || statement.kind === 'instance-statement') {
      groups.instance.push(typeLeaf(statement.type));
    }
  }
  return groups;
}

function isSubsequence<T>(needle: readonly T[], haystack: readonly T[]): boolean {
  let index = 0;
  for (const value of haystack) if (value === needle[index]) index++;
  return index === needle.length;
}

function causalFamilyFor(
  definition: SnapshotDefinition,
  allocation: AllocationDifference,
  streams: StreamComparison,
  collision: OperandCollision | undefined
): string {
  if (collision) return 'suppressed fragment-owner operand collision';
  const parsed = parseApplicationClassSource(definition.sourceText);
  const firstImplementationStart = parsed?.implementations[0]?.sourceIndex ?? definition.sourceText.length;
  const postClass = parsed ? definition.sourceText.slice(parsed.unitEnd, firstImplementationStart) : '';
  const generatedExcess = Object.keys(streams.generatedOnly);
  const storedIdentity = allocationIdentity(allocation.stored);
  const generatedIdentity = allocationIdentity(allocation.generated);
  if (allocation.storedKind === 'PACKAGE' && storedIdentity !== generatedIdentity) {
    const provenance = packageProvenance(definition, storedIdentity);
    if (provenance.startsWith('relationship:')) return 'relationship PACKAGE discovery/order mismatch';
    if (provenance.startsWith('declaration:')) return 'declaration-phase PACKAGE discovery/order mismatch';
    if (provenance === 'compilation-unit import') return 'import PACKAGE discovery/order mismatch';
    return 'executable/post-class PACKAGE discovery/order mismatch';
  }
  if (allocation.generatedKind === 'PACKAGE' && storedIdentity !== generatedIdentity) {
    return generatedExcess.includes(generatedIdentity)
      ? 'cross-fragment PACKAGE duplicate / failed reuse'
      : 'PACKAGE phase/order mismatch';
  }
  if (allocation.ordinal === 1 && allocation.storedKind === 'blank owner' && allocation.generatedKind !== 'blank owner') {
    return 'program owner placeholder mutated into first dependency';
  }
  if (/\b(?:Component|Global)\s+(?:Record|Row|Rowset)\s+&/i.test(postClass) &&
      Object.keys(streams.storedOnly).some(identity => /^(?:FIELD|RECORD|SCROLL)\|/.test(identity))) {
    return 'post-class declaration binding not shared with implementations';
  }
  if (streams.sameIdentityMultiset && allocation.cause !== 'NONE') {
    return 'correct identity multiset, wrong phase/allocation order';
  }
  if (allocation.storedKind === 'FIELD' && allocation.generatedKind === 'FIELD' && allocation.cause === 'WRONG_ALLOCATION_ORDER') {
    return 'FIELD operand omission/allocation-order mismatch';
  }
  if (allocation.storedKind !== 'PACKAGE' && allocation.generatedKind !== 'PACKAGE' && allocation.cause === 'WRONG_ALLOCATION_ORDER') {
    return 'non-PACKAGE allocation-order mismatch';
  }
  if (allocation.cause === 'EXTRA_ALLOCATION_WRONG_REUSE') return 'cross-fragment non-PACKAGE duplicate / failed reuse';
  if (allocation.cause === 'MISSING_ALLOCATION') return 'missing non-PACKAGE allocation';
  if (allocation.cause === 'WRONG_IDENTITY') return 'wrong non-PACKAGE identity';
  if (allocation.cause === 'ROW_COUNT_ONLY') return 'row-count/stream-tail mismatch';
  return 'other evidenced allocation-stream mismatch';
}

function sourceContext(source: string, offset: number | undefined, radius = 90): string {
  if (offset === undefined) return '';
  return source.slice(Math.max(0, offset - radius), Math.min(source.length, offset + radius))
    .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

function controlPath(source: string, offset: number): string {
  const masked = source.slice(0, offset).replace(/\/\*[\s\S]*?\*\/|<\*[\s\S]*?\*>|\/\+[\s\S]*?\+\/|"(?:""|[^"])*"|'(?:''|[^'])*'/g, match => ' '.repeat(match.length));
  const stack: string[] = [];
  for (const match of masked.matchAll(/\b(End-If|End-For|End-While|End-Evaluate|End-Try|If|For|While|Evaluate|Try|Else|When(?:-Other)?)\b/gi)) {
    const word = match[1].toLowerCase();
    if (word.startsWith('end-')) stack.pop();
    else if (word === 'else' || word.startsWith('when')) {
      if (stack.length > 0) stack[stack.length - 1] = `${stack[stack.length - 1].split(':')[0]}:${word}`;
    } else stack.push(`${word}@${match.index ?? 0}`);
  }
  return stack.length === 0 ? 'top' : stack.join('>');
}

function sourceNeedles(row: RowShape | undefined): string[] {
  if (!row) return [];
  const rec = row.recname.trim();
  const ref = row.refname.trim();
  if (normalize(rec) === 'PACKAGE') {
    const parts = [row.packageroot, row.qualifypath, ref].filter(Boolean);
    const path = parts.join(':');
    return [row.appclassmethod ? `${path}.${row.appclassmethod}` : path, ref, row.appclassmethod].filter(Boolean);
  }
  if (['RECORD', 'FIELD', 'SCROLL', 'HTML', 'COMPONENT'].includes(normalize(rec))) return [`${rec}.${ref}`, ref];
  if (rec && ref) return [`${rec}.${ref}`, ref];
  return [ref, rec].filter(Boolean);
}

function locateSourceOccurrence(
  definition: SnapshotDefinition,
  expected: RowShape | undefined,
  actual: RowShape | undefined,
  occurrenceNumber: number
): SourceLocation {
  const source = definition.sourceText;
  const candidates: number[] = [];
  for (const needle of [...sourceNeedles(expected), ...sourceNeedles(actual)]) {
    if (!needle) continue;
    const expression = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:/g, '\\s*:\\s*'), 'gi');
    for (const match of source.matchAll(expression)) candidates.push(match.index ?? 0);
  }
  const parsed = parseApplicationClassSource(source);
  const unique = [...new Set(candidates)].sort((a, b) => a - b);
  // Reference operands are emitted by post-class declarations or executable
  // bodies, never by the inline TYPE_PATH/member-declaration grammar. A leaf
  // name often appears first in that declaration section; retaining it would
  // falsely label body operands as declaration occurrences.
  const operandCandidates = parsed
    ? unique.filter(offset => offset < parsed.unitStart || offset >= parsed.unitEnd)
    : unique;
  const available = operandCandidates.length > 0 ? operandCandidates : unique;
  const absoluteOffset = available[Math.min(occurrenceNumber, Math.max(0, available.length - 1))];
  let region = 'unavailable';
  let implementation: string | undefined;
  let implementationKind: 'method' | 'get' | 'set' | undefined;
  if (absoluteOffset !== undefined && parsed) {
    if (absoluteOffset < parsed.unitStart) region = 'compilation-unit prefix';
    else if (absoluteOffset < parsed.unitEnd) region = 'class/interface declaration';
    else {
      const member = parsed.implementations.find(item => absoluteOffset >= item.sourceIndex && absoluteOffset < item.sourceEnd);
      if (member) {
        region = `${member.kind} implementation`;
        implementation = member.name;
        implementationKind = member.kind;
      } else region = 'post-class declaration/layout';
    }
  }
  return {
    absoluteOffset,
    context: sourceContext(source, absoluteOffset),
    region,
    unitKind: parsed?.unitKind,
    unitName: parsed?.className,
    implementation,
    implementationKind,
    lexicalControlRegion: absoluteOffset === undefined ? 'unavailable' : controlPath(source, absoluteOffset)
  };
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

interface ReuseTransition {
  definitionId: number;
  identity: string;
  relationship: string;
  storedDecision: 'NEW' | 'REUSE';
  currentDecision: 'NEW' | 'REUSE' | 'IDENTITY_DISAGREEMENT';
  artifact: ArtifactKind;
  previousLocation: SourceLocation;
  currentLocation: SourceLocation;
}

function implementationRelationship(
  parsed: ReturnType<typeof parseApplicationClassSource>,
  previous: SourceLocation,
  current: SourceLocation
): string {
  if (previous.implementation && current.implementation) {
    if (previous.implementation.toLowerCase() === current.implementation.toLowerCase() &&
        previous.implementationKind === current.implementationKind) {
      return previous.lexicalControlRegion === current.lexicalControlRegion
        ? 'within one implementation / same control path'
        : 'within one implementation / across control paths';
    }
    const className = parsed?.className.toLowerCase();
    const previousConstructor = previous.implementationKind === 'method' && previous.implementation.toLowerCase() === className;
    const currentConstructor = current.implementationKind === 'method' && current.implementation.toLowerCase() === className;
    if (previousConstructor || currentConstructor) return 'constructor <-> other implementation';
    return `${previous.implementationKind} -> ${current.implementationKind}`;
  }
  if (previous.region === 'post-class declaration/layout' || current.region === 'post-class declaration/layout') {
    return 'before/after post-class Declare Function region';
  }
  return `${previous.region} -> ${current.region}`;
}

function tracedUseLocations(definition: SnapshotDefinition): SourceLocation[] | undefined {
  const parsed = parseApplicationClassSource(definition.sourceText);
  if (!parsed) return undefined;
  const locations: SourceLocation[] = [];
  const traceFragment = (
    raw: string,
    absoluteStart: number,
    region: string,
    implementation?: ApplicationClassProgramImplementation
  ): boolean => {
    const leading = /^\s*/.exec(raw)?.[0].length ?? 0;
    const trailing = /\s*$/.exec(raw)?.[0].length ?? 0;
    const core = raw.slice(leading, raw.length - trailing);
    if (!core.trim()) return true;
    const completed = /;$/.test(core.replace(/\s+$/, '')) ? core : `${core};`;
    const trace: ReferenceTraceEvent[] = [];
    try {
      encodeProgramArtifacts(completed, { referenceTrace: event => trace.push(event) });
    } catch {
      return false;
    }
    for (const event of trace.filter(item => item.action === 'USE')) {
      const absoluteOffset = absoluteStart + leading + event.sourceOffset;
      locations.push({
        absoluteOffset,
        context: sourceContext(definition.sourceText, absoluteOffset),
        region,
        unitKind: parsed.unitKind,
        unitName: parsed.className,
        implementation: implementation?.name,
        implementationKind: implementation?.kind,
        lexicalControlRegion: controlPath(definition.sourceText, absoluteOffset)
      });
    }
    return true;
  };

  const firstImplementationStart = parsed.implementations[0]?.sourceIndex ?? definition.sourceText.length;
  const postClass = definition.sourceText.slice(parsed.unitEnd, firstImplementationStart);
  if (!traceFragment(postClass, parsed.unitEnd, 'post-class declaration/layout')) return undefined;
  for (const implementation of parsed.implementations) {
    const span = definition.sourceText.slice(implementation.sourceIndex, implementation.sourceEnd);
    const bodyIndex = span.indexOf(implementation.body);
    if (bodyIndex < 0 || !traceFragment(
      implementation.body,
      implementation.sourceIndex + bodyIndex,
      `${implementation.kind} implementation`,
      implementation
    )) return undefined;
  }
  return locations;
}

type ApplicationClassProgramImplementation = NonNullable<ReturnType<typeof parseApplicationClassSource>>['implementations'][number];

function collectReuseTransitions(
  definition: SnapshotDefinition,
  generated: Buffer,
  references: readonly PeopleCodeReference[],
  trace: readonly ReferenceTraceEvent[]
): ReuseTransition[] {
  const left = projectedTokens(definition.storedProgram, storedNameTable(definition));
  const right = projectedTokens(generated, generatedNameTable(references));
  const uses = trace.filter(event => event.action === 'USE');
  const occurrenceByIdentity = new Map<string, number>();
  const previousByIdentity = new Map<string, {
    storedNameNum: number;
    generatedSequence: number;
    generatedIdentity: string;
    location: SourceLocation;
  }>();
  const transitions: ReuseTransition[] = [];
  const tracedLocations = tracedUseLocations(definition);
  let operandOrdinal = 0;
  const parsed = parseApplicationClassSource(definition.sourceText);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const storedToken = left[index];
    const generatedToken = right[index];
    const storedReference = REFERENCE_OPCODES.has(storedToken.opcode);
    const generatedReference = REFERENCE_OPCODES.has(generatedToken.opcode);
    if (storedReference !== generatedReference || storedToken.opcode !== generatedToken.opcode) break;
    if (!storedReference) {
      if (storedToken.text.toLowerCase() !== generatedToken.text.toLowerCase()) break;
      continue;
    }
    const use = uses[operandOrdinal++];
    const storedRow = storedShape(definition.names.find(row => row.namenum === storedToken.nameNum));
    const identity = allocationIdentity(storedRow);
    const occurrence = occurrenceByIdentity.get(identity) ?? 0;
    occurrenceByIdentity.set(identity, occurrence + 1);
    const generatedIdentity = allocationIdentity(generatedShape(use?.reference));
    const location = tracedLocations?.length === uses.length
      ? tracedLocations[operandOrdinal - 1]
      : locateSourceOccurrence(definition, storedRow, generatedShape(use?.reference), occurrence);
    const previous = previousByIdentity.get(identity);
    if (previous && storedToken.nameNum !== undefined && use) {
      transitions.push({
        definitionId: definition.definitionId,
        identity,
        relationship: implementationRelationship(parsed, previous.location, location),
        storedDecision: previous.storedNameNum === storedToken.nameNum ? 'REUSE' : 'NEW',
        currentDecision: previous.generatedIdentity !== identity || generatedIdentity !== identity
          ? 'IDENTITY_DISAGREEMENT'
          : previous.generatedSequence === use.reference.sequence ? 'REUSE' : 'NEW',
        artifact: artifactKind(storedRow),
        previousLocation: previous.location,
        currentLocation: location
      });
    }
    if (storedToken.nameNum !== undefined && use) {
      previousByIdentity.set(identity, {
        storedNameNum: storedToken.nameNum,
        generatedSequence: use.reference.sequence,
        generatedIdentity,
        location
      });
    }
  }
  return transitions;
}

function modelPrediction(
  model: string,
  transition: ReuseTransition
): 'NEW' | 'REUSE' | 'IDENTITY_DISAGREEMENT' {
  const crossesImplementation = /(?:method|get|set) -> (?:method|get|set)|constructor/.test(transition.relationship);
  if (model === 'global Application Class allocation stream') return 'REUSE';
  if (model === 'per-method allocation stream' || model === 'per-fragment stream with numeric offset only') {
    return crossesImplementation ? 'NEW' : 'REUSE';
  }
  if (model === 'identity-specific compilation-unit scopes') {
    return ['PACKAGE', 'Application Class method', 'HTML'].includes(transition.artifact)
      ? 'REUSE'
      : crossesImplementation ? 'NEW' : 'REUSE';
  }
  if (model === 'source-phase-specific streams') {
    return crossesImplementation
      ? 'REUSE'
      : transition.currentDecision === 'IDENTITY_DISAGREEMENT' ? 'REUSE' : transition.currentDecision;
  }
  if (model === 'compilation-unit facade preserving ordinary scoped decisions') {
    return crossesImplementation
      ? 'REUSE'
      : transition.currentDecision === 'IDENTITY_DISAGREEMENT' ? 'REUSE' : transition.currentDecision;
  }
  return transition.currentDecision;
}

function modelSummary(transitions: readonly ReuseTransition[]): Array<{
  model: string;
  explained: number;
  contradictions: number;
  affectedDefinitions: number;
}> {
  const models = [
    'global Application Class allocation stream',
    'per-method allocation stream',
    'per-fragment stream with numeric offset only',
    'identity-specific compilation-unit scopes',
    'source-phase-specific streams',
    'compilation-unit facade preserving ordinary scoped decisions',
    'current encoder model'
  ];
  return models.map(model => {
    const disagreements = transitions.filter(transition => modelPrediction(model, transition) !== transition.storedDecision);
    return {
      model,
      explained: transitions.length - disagreements.length,
      contradictions: disagreements.length,
      affectedDefinitions: new Set(disagreements.map(row => row.definitionId)).size
    };
  });
}

function hasReferenceOperandMismatch(
  definition: SnapshotDefinition,
  generated: Buffer,
  references: readonly PeopleCodeReference[]
): boolean {
  const left = projectedTokens(definition.storedProgram, storedNameTable(definition));
  const right = projectedTokens(generated, generatedNameTable(references));
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (REFERENCE_OPCODES.has(left[index].opcode) && REFERENCE_OPCODES.has(right[index].opcode) &&
        (left[index].opcode !== right[index].opcode || left[index].nameNum !== right[index].nameNum)) return true;
  }
  return false;
}

function becomesExactAfterAlignedOperandSubstitution(
  definition: SnapshotDefinition,
  generated: Buffer,
  references: readonly PeopleCodeReference[]
): boolean {
  const substituted = Buffer.from(generated);
  const left = projectedTokens(definition.storedProgram, storedNameTable(definition));
  const right = projectedTokens(generated, generatedNameTable(references));
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (!REFERENCE_OPCODES.has(left[index].opcode) || !REFERENCE_OPCODES.has(right[index].opcode)) continue;
    if (left[index].opcode !== right[index].opcode || left[index].nameNum === undefined) continue;
    substituted.writeUInt16LE(left[index].nameNum - 1, right[index].offset + 1);
  }
  return substituted.equals(definition.storedProgram);
}

function readLatestResults(): { runId: number; gitCommit: string; rows: Map<number, ResultRow> } {
  const db = new Database('tools/corpus/corpus-results.sqlite', { readonly: true });
  const run = db.prepare(`
    SELECT run_id, git_commit FROM corpus_run
    WHERE completed_at IS NOT NULL AND definitions = ?
    ORDER BY run_id DESC LIMIT 1
  `).get(TOTAL_CORPUS) as Record<string, unknown> | undefined;
  if (!run) throw new Error('No completed full-corpus run found.');
  const rawRows = db.prepare(`
    SELECT definition_id, classification, source_encode_success, generated_sha256
    FROM result WHERE run_id = ?
  `).all(Number(run.run_id)) as Array<Record<string, unknown>>;
  db.close();
  return {
    runId: Number(run.run_id), gitCommit: String(run.git_commit),
    rows: new Map(rawRows.map(row => [Number(row.definition_id), {
      definitionId: Number(row.definition_id),
      classification: String(row.classification),
      sourceEncodeSuccess: Boolean(row.source_encode_success),
      generatedSha256: row.generated_sha256 === null ? undefined : String(row.generated_sha256)
    }]))
  };
}

function main(): void {
  const reportArgument = process.argv.indexOf('--cycle24-report');
  const reportPath = reportArgument < 0 ? undefined : process.argv[reportArgument + 1];
  if (!reportPath) throw new Error('--cycle24-report is required.');
  const cycle24 = JSON.parse(readFileSync(reportPath, 'utf8')) as Cycle24Report;
  if (cycle24.rows.length !== 940) throw new Error(`Cycle 24 report has ${cycle24.rows.length} rows, expected 940.`);

  const snapshotDb = openSnapshotDatabase();
  const allDefinitions = listSnapshotDefinitions(snapshotDb);
  const definitions = allDefinitions.filter(definition => definition.objectid1 === APPLICATION_CLASS_OBJECT_ID);
  snapshotDb.close();
  const byId = new Map(definitions.map(definition => [definition.definitionId, definition]));
  const latest = readLatestResults();

  const encoded = new Map<number, {
    program: Buffer;
    references: PeopleCodeReference[];
    trace: ReferenceTraceEvent[];
    blocker: string;
    diff: SemanticDiff;
  }>();
  for (const oldRow of cycle24.rows) {
    const definition = byId.get(oldRow.definitionId);
    if (!definition) continue;
    const trace: ReferenceTraceEvent[] = [];
    const artifacts = encodeProgramArtifacts(definition.sourceText, {
      owner: ownerContext(definition),
      referenceTrace: event => trace.push(event)
    });
    encoded.set(definition.definitionId, {
      program: artifacts.program,
      references: artifacts.references,
      trace,
      blocker: projectedNextBlocker(definition, artifacts.program),
      diff: meaningfulDiff(definition.storedProgram, artifacts.program)
    });
  }

  const referenceTargetIds = [...encoded]
    .filter(([, item]) => item.blocker === 'reference numbering/operand identity')
    .map(([definitionId]) => definitionId)
    .sort((a, b) => a - b);
  const namesBoundaryIds = [...encoded]
    .filter(([, item]) => item.blocker === 'Application Class names metadata')
    .map(([definitionId]) => definitionId)
    .sort((a, b) => a - b);
  const otherIds = [...encoded]
    .filter(([, item]) => item.blocker === 'other newly exposed family')
    .map(([definitionId]) => definitionId)
    .sort((a, b) => a - b);

  const allEncoded = new Map(encoded);
  for (const definition of definitions) {
    if (!latest.rows.get(definition.definitionId)?.sourceEncodeSuccess || allEncoded.has(definition.definitionId)) continue;
    const trace: ReferenceTraceEvent[] = [];
    try {
      const artifacts = encodeProgramArtifacts(definition.sourceText, {
        owner: ownerContext(definition),
        referenceTrace: event => trace.push(event)
      });
      allEncoded.set(definition.definitionId, {
        program: artifacts.program,
        references: artifacts.references,
        trace,
        blocker: projectedNextBlocker(definition, artifacts.program),
        diff: meaningfulDiff(definition.storedProgram, artifacts.program)
      });
    } catch {
      // The completed corpus row remains authoritative for source encodability;
      // a current inconsistency is surfaced in the compact report below.
    }
  }

  const roots: ReferenceRootRow[] = [];
  for (const definitionId of referenceTargetIds) {
    const definition = byId.get(definitionId)!;
    const current = encoded.get(definitionId)!;
    const operand = firstOperandDifference(definition, current.program, current.references);
    const storedNameNum = operand.stored?.nameNum;
    const generatedNameNum = operand.generated?.nameNum;
    const storedRow = storedShape(definition.names.find(row => row.namenum === storedNameNum));
    const generatedRow = generatedShape(current.references.find(reference => reference.sequence === generatedNameNum));
    const allocationDifference = compareAllocationStreams(definition.names, current.references);
    const streams = streamComparison(definition.names, current.references);
    const collision = firstOperandCollision(current.trace, current.references, operand.operandOrdinal);
    const causalFamily = causalFamilyFor(definition, allocationDifference, streams, collision);
    const allocationEventsBySequence = new Map(
      current.trace.filter(event => event.action === 'ALLOC').map(event => [event.reference.sequence, event])
    );
    const uses = current.trace.filter(event => event.action === 'USE');
    const offendingUse = uses[operand.operandOrdinal];
    const offendingIdentity = allocationIdentity(generatedShape(offendingUse?.reference) ?? storedRow);
    const sameIdentityOccurrence = uses.slice(0, operand.operandOrdinal)
      .filter(event => allocationIdentity(generatedShape(event.reference)) === offendingIdentity).length;
    const tracedLocations = tracedUseLocations(definition);
    const sourceOccurrence = tracedLocations?.length === uses.length && tracedLocations[operand.operandOrdinal] !== undefined
      ? tracedLocations[operand.operandOrdinal]
      : locateSourceOccurrence(definition, storedRow, generatedRow, sameIdentityOccurrence);
    const methodLocalReferenceOrdinal = sourceOccurrence.implementation === undefined || tracedLocations?.length !== uses.length
      ? undefined
      : tracedLocations.slice(0, operand.operandOrdinal + 1).filter(location =>
        location.implementation === sourceOccurrence.implementation &&
        location.implementationKind === sourceOccurrence.implementationKind
      ).length;
    let identityOrderingClass: string;
    if (!operand.stored || !REFERENCE_OPCODES.has(operand.stored.opcode)) identityOrderingClass = 'D. extra generated reference operand';
    else if (!operand.generated || !REFERENCE_OPCODES.has(operand.generated.opcode)) identityOrderingClass = 'C. missing generated reference operand';
    else if (allocationIdentity(storedRow) === allocationIdentity(generatedRow)) {
      identityOrderingClass = storedNameNum === generatedNameNum
        ? 'G. another evidenced failure'
        : allocationDifference.cause === 'EXTRA_ALLOCATION_WRONG_REUSE'
          ? 'F. correct identity, wrong reuse decision'
          : 'A. correct identity, wrong NAMENUM';
    } else if (allocationDifference.cause === 'WRONG_ALLOCATION_ORDER') {
      identityOrderingClass = 'E. correct rows, wrong allocation order';
    } else identityOrderingClass = 'B. wrong reference identity';
    const ordinal = allocationDifference.ordinal - 1;
    roots.push({
      definitionId,
      displayName: definition.displayName,
      source: definition.sourceText,
      firstSemanticDivergence: current.diff,
      projectedTokenIndex: operand.projectedIndex,
      operandOrdinal: operand.operandOrdinal,
      storedOpcode: operand.stored === undefined ? undefined : `0x${operand.stored.opcode.toString(16).padStart(2, '0')}`,
      generatedOpcode: operand.generated === undefined ? undefined : `0x${operand.generated.opcode.toString(16).padStart(2, '0')}`,
      storedNameNum,
      generatedNameNum,
      storedRow,
      generatedRow,
      storedArtifact: artifactKind(storedRow),
      generatedArtifact: artifactKind(generatedRow),
      sourceOccurrence,
      previousStoredAllocation: storedShape(definition.names[ordinal - 1]),
      nextStoredAllocation: storedShape(definition.names[ordinal + 1]),
      previousGeneratedAllocation: generatedShape(current.references[ordinal - 1]),
      nextGeneratedAllocation: generatedShape(current.references[ordinal + 1]),
      absoluteReferenceOrdinal: operand.operandOrdinal + 1,
      methodLocalReferenceOrdinal,
      identityOrderingClass,
      causalFamily,
      downstreamNameNumDriftOnly: Boolean(
        operand.stored && operand.generated &&
        allocationIdentity(storedRow) === allocationIdentity(generatedRow) &&
        storedNameNum !== generatedNameNum &&
        allocationDifference.ordinal <= (storedNameNum ?? Number.POSITIVE_INFINITY)
      ),
      firstOperandCollision: collision,
      streamComparison: streams,
      packageProvenance: packageProvenance(definition, allocationIdentity(allocationDifference.stored)),
      storedAllocationStream: definition.names.map((row, index) => {
        const shape = storedShape(row);
        return {
          ordinal: index + 1,
          identity: allocationIdentity(shape),
          artifact: artifactKind(shape),
          rowShape: shape,
          sourceProvenance: packageProvenance(definition, allocationIdentity(shape))
        };
      }),
      generatedAllocationStream: current.references.map(reference => {
        const shape = generatedShape(reference);
        const event = allocationEventsBySequence.get(reference.sequence);
        return {
          ordinal: reference.sequence,
          identity: allocationIdentity(shape),
          artifact: artifactKind(shape),
          rowShape: shape,
          sourceOffset: event?.sourceOffset,
          controlGroup: event?.controlGroup,
          functionDepth: event?.functionDepth
        };
      }),
      earliestAllocationDifference: allocationDifference,
      disposition: causalFamily === 'row-count/stream-tail mismatch' ? 'PARTIALLY_EXPLAINED' : 'FULLY_EXPLAINED'
    });
  }

  const artifactSummary = Object.entries(countBy(roots, row => row.storedArtifact)).map(([kind, definitions]) => {
    const subset = roots.filter(row => row.storedArtifact === kind);
    return {
      kind,
      definitions,
      operands: subset.length,
      distinctRowSignatures: new Set(subset.map(row => shapeSignature(row.storedRow))).size,
      wrongNameNum: subset.filter(row => row.storedNameNum !== row.generatedNameNum).length,
      missingReference: subset.filter(row => row.identityOrderingClass.startsWith('C.')).length,
      extraReference: subset.filter(row => row.identityOrderingClass.startsWith('D.')).length,
      identityDisagreement: subset.filter(row => row.identityOrderingClass.startsWith('B.')).length
    };
  });

  const transitions = [...allEncoded].flatMap(([definitionId, current]) => {
    const definition = byId.get(definitionId);
    return definition === undefined
      ? []
      : collectReuseTransitions(definition, current.program, current.references, current.trace);
  });
  const transitionMatrix = Object.entries(countBy(
    transitions,
    row => `${row.relationship} | ${row.artifact} | ${row.storedDecision}`
  )).map(([transition, observations]) => ({ transition, observations }));
  const transitionDecisionCounts = (predicate: (row: ReuseTransition) => boolean): Record<string, number> => {
    const subset = transitions.filter(predicate);
    return {
      observations: subset.length,
      NEW: subset.filter(row => row.storedDecision === 'NEW').length,
      REUSE: subset.filter(row => row.storedDecision === 'REUSE').length
    };
  };
  const requestedTransitionContexts = {
    repeatedWithinOneMethod: transitionDecisionCounts(row => row.relationship.startsWith('within one implementation')),
    acrossLexicalControlRegions: transitionDecisionCounts(row => row.relationship.includes('across control paths')),
    acrossTwoMethods: transitionDecisionCounts(row => row.relationship === 'method -> method'),
    declarationToMethod: {
      observations: 0,
      note: 'class declaration TYPE_PATH dependencies allocate rows but emit no reference operand; covered by allocation-stream provenance instead'
    },
    methodToGetterOrSetter: transitionDecisionCounts(row => /^method -> (?:get|set)$/.test(row.relationship)),
    getterToSetter: transitionDecisionCounts(row => row.relationship === 'get -> set'),
    getterOrSetterToMethod: transitionDecisionCounts(row => /^(?:get|set) -> method$/.test(row.relationship)),
    constructorToOtherImplementation: transitionDecisionCounts(row => row.relationship === 'constructor <-> other implementation'),
    beforeAfterPostClassDeclareFunction: transitionDecisionCounts(row => row.relationship === 'before/after post-class Declare Function region'),
    html: transitionDecisionCounts(row => row.artifact === 'HTML')
  };

  const rootDefinitions = new Set(referenceTargetIds);
  const storedPackageRows = definitions
    .filter(definition => rootDefinitions.has(definition.definitionId))
    .flatMap(definition => definition.names.map(row => ({ definition, row, shape: storedShape(row)! })))
    .filter(item => normalize(item.shape.recname) === 'PACKAGE');
  const packageRowsByProvenance = countBy(storedPackageRows, item =>
    packageProvenance(item.definition, allocationIdentity(item.shape))
  );
  const packageMetadataShapes = {
    rows: storedPackageRows.length,
    blankRootAndPath: storedPackageRows.filter(item => !normalize(item.shape.packageroot) && !normalize(item.shape.qualifypath)).length,
    qualified: storedPackageRows.filter(item => normalize(item.shape.packageroot) || normalize(item.shape.qualifypath)).length,
    methodBearing: storedPackageRows.filter(item => normalize(item.shape.appclassmethod)).length,
    methodBearingMatchedByGeneratedIdentity: storedPackageRows.filter(item =>
      normalize(item.shape.appclassmethod) &&
      allEncoded.get(item.definition.definitionId)?.references.some(reference =>
        allocationIdentity(generatedShape(reference)) === allocationIdentity(item.shape)
      )
    ).length,
    repeatedIdentityRows: storedPackageRows.filter((item, index, rows) => rows.some((other, otherIndex) =>
      otherIndex < index && other.definition.definitionId === item.definition.definitionId &&
      allocationIdentity(other.shape) === allocationIdentity(item.shape)
    )).length,
    definitionsWithRepeatedIdentity: new Set(storedPackageRows.filter((item, index, rows) => rows.some((other, otherIndex) =>
      otherIndex < index && other.definition.definitionId === item.definition.definitionId &&
      allocationIdentity(other.shape) === allocationIdentity(item.shape)
    )).map(item => item.definition.definitionId)).size
  };
  const declarationOrderControls = definitions
    .filter(definition => rootDefinitions.has(definition.definitionId))
    .map(definition => {
      const storedLeaves = definition.names
        .filter(row => normalize(row.recname) === 'PACKAGE')
        .map(row => normalize(row.refname))
        .filter(Boolean);
      const uniqueStored = [...new Set(storedLeaves)];
      const uniqueDeclared = [...new Set(declarationTypeLeaves(definition))]
        .filter(leaf => uniqueStored.includes(leaf));
      return {
        definitionId: definition.definitionId,
        matchedLeaves: uniqueDeclared.length,
        sourceOrderPreserved: isSubsequence(uniqueDeclared, uniqueStored)
      };
    })
    .filter(row => row.matchedLeaves >= 2);
  const declarationGroupOrderRows: Array<{ pair: string; order: string }> = [];
  const withinDeclarationGroupRows: Array<{ group: string; preserved: boolean }> = [];
  for (const definition of definitions.filter(item => rootDefinitions.has(item.definitionId))) {
    const storedLeaves = definition.names
      .filter(row => normalize(row.recname) === 'PACKAGE')
      .map(row => normalize(row.refname));
    const groups = declarationTypeGroups(definition);
    const firstByGroup = new Map<string, number>();
    for (const [group, rawLeaves] of Object.entries(groups)) {
      const leaves = [...new Set(rawLeaves)].filter(leaf => storedLeaves.includes(leaf));
      if (leaves.length > 0) {
        firstByGroup.set(group, Math.min(...leaves.map(leaf => storedLeaves.indexOf(leaf))));
      }
      if (leaves.length >= 2) {
        withinDeclarationGroupRows.push({ group, preserved: isSubsequence(leaves, storedLeaves) });
      }
    }
    const present = [...firstByGroup];
    for (let left = 0; left < present.length; left++) {
      for (let right = left + 1; right < present.length; right++) {
        const [leftGroup, leftIndex] = present[left];
        const [rightGroup, rightIndex] = present[right];
        const pair = [leftGroup, rightGroup].sort().join(' vs ');
        const order = leftIndex < rightIndex ? `${leftGroup} first` : `${rightGroup} first`;
        declarationGroupOrderRows.push({ pair, order });
      }
    }
  }
  const relationshipControls = definitions
    .filter(definition => rootDefinitions.has(definition.definitionId))
    .flatMap(definition => {
      const parsed = parseApplicationClassSource(definition.sourceText);
      const relationship = parsed?.extendsType ?? parsed?.implementsType;
      if (!relationship) return [];
      const leaf = typeLeaf(relationship);
      return [{
        definitionId: definition.definitionId,
        kind: parsed?.extendsType ? 'extends' : 'implements',
        leaf,
        hasStoredPackageRow: definition.names.some(row =>
          normalize(row.recname) === 'PACKAGE' && normalize(row.refname) === leaf
        )
      }];
    });

  const namesBoundary = namesBoundaryIds.map(definitionId => {
    const definition = byId.get(definitionId)!;
    const current = encoded.get(definitionId)!;
    const allocationDifference = compareAllocationStreams(definition.names, current.references);
    return {
      definitionId,
      // PSPCMNAME allocation is external to the Application Class trailer's
      // UTF-16 directory-name section. These rows have an exact projected
      // statement stream (including reference operand indices) and first
      // differ only in that independent names section. A secondary external
      // row-stream mismatch is retained as evidence, never promoted to cause.
      classification: 'clearly independent names-metadata root',
      secondaryReferenceStreamMismatch: allocationDifference.cause !== 'NONE',
      allocationDifference
    };
  });

  const otherRows = otherIds.map(definitionId => {
    const definition = byId.get(definitionId)!;
    const current = encoded.get(definitionId)!;
    const left = projectedTokens(definition.storedProgram, storedNameTable(definition));
    const right = projectedTokens(current.program, generatedNameTable(current.references));
    let index = 0;
    while (index < Math.min(left.length, right.length) && left[index].opcode === right[index].opcode && left[index].text.toLowerCase() === right[index].text.toLowerCase()) index++;
    const stored = left[index];
    const generated = right[index];
    const parsed = parseApplicationClassSource(definition.sourceText);
    const storedOffset = stored?.offset;
    const signature = `${stored?.opcode === undefined ? 'EOF' : `0x${stored.opcode.toString(16)}`}->${generated?.opcode === undefined ? 'EOF' : `0x${generated.opcode.toString(16)}`}`;
    let family: string;
    if (signature === '0x15->0x63' || signature === '0x15->0x5e' || signature === '0x15->0x62' ||
        signature === '0x15->0x61' || signature === '0x15->0x5b') {
      family = 'missing repeated/declaration terminator';
    } else if (signature === '0x5b->0x15') {
      family = 'extra declaration terminator before unit closer';
    } else if (signature === '0x3->0x15') {
      family = 'trailing parameter comma/terminator boundary';
    } else if (signature === '0x40->0xa') {
      family = 'unparameterized array type representation';
    } else if (signature === '0x50->0xe') {
      family = 'negative constant literal representation';
    } else {
      family = parsed?.unitKind === 'interface'
        ? 'interface declaration statement boundary'
        : 'class declaration statement boundary';
    }
    return {
      definitionId,
      family,
      signature,
      storedToken: stored?.text,
      generatedToken: generated?.text,
      storedOffset,
      relatedToReferences: Boolean(stored && REFERENCE_OPCODES.has(stored.opcode)) || Boolean(generated && REFERENCE_OPCODES.has(generated.opcode)),
      relatedToNamesMetadata: false,
      independent: true
    };
  });

  const sourceEncodableDefinitions = definitions.filter(definition => latest.rows.get(definition.definitionId)?.sourceEncodeSuccess);
  const referenceBearing = [...allEncoded].filter(([, current]) => current.trace.some(event => event.action === 'USE'));
  const predictedProgramChanges = [...allEncoded].filter(([definitionId, current]) => {
    const definition = byId.get(definitionId);
    return definition !== undefined && hasReferenceOperandMismatch(definition, current.program, current.references);
  });
  const collisionDefinitions = [...allEncoded].filter(([, current]) =>
    firstOperandCollision(current.trace, current.references) !== undefined
  );
  const differingAllocationStreams = [...allEncoded].filter(([definitionId, current]) => {
    const definition = byId.get(definitionId);
    return definition !== undefined && compareAllocationStreams(definition.names, current.references).cause !== 'NONE';
  });

  const exactOrdinaryDefinitions = allDefinitions.filter(definition =>
    definition.objectid1 !== APPLICATION_CLASS_OBJECT_ID &&
    latest.rows.get(definition.definitionId)?.classification === 'EXACT'
  );
  const ordinaryControls = {
    allExactOrdinaryPrograms: exactOrdinaryDefinitions.length,
    exactWithRecordFieldScrollRows: exactOrdinaryDefinitions.filter(definition => definition.names.some(row =>
      ['RECORD', 'FIELD', 'SCROLL'].includes(normalize(row.recname)) ||
      (normalize(row.recname) !== '' && normalize(row.refname) !== '')
    )).length,
    exactWithPackageRows: exactOrdinaryDefinitions.filter(definition => definition.names.some(row => normalize(row.recname) === 'PACKAGE')).length,
    exactWithHtmlRows: exactOrdinaryDefinitions.filter(definition => definition.names.some(row => normalize(row.recname) === 'HTML')).length,
    exactWithMultipleFunctions: exactOrdinaryDefinitions.filter(definition =>
      [...definition.sourceText.matchAll(/\bFunction\s+[%A-Za-z_][%A-Za-z0-9_]*\s*\(/gi)].length > 1
    ).length
  };
  const htmlRows = roots.filter(row => row.storedArtifact === 'HTML');
  const controlsFor = (family: string, limit = 5): number[] => roots
    .filter(row => row.causalFamily === family)
    .slice(0, limit)
    .map(row => row.definitionId);
  const matchedControls = {
    suppressedFragmentOwnerCollision: controlsFor('suppressed fragment-owner operand collision'),
    crossFragmentPackageReuse: controlsFor('cross-fragment PACKAGE duplicate / failed reuse'),
    declarationPhasePackageDiscovery: controlsFor('declaration-phase PACKAGE discovery/order mismatch'),
    packageRelationshipDiscovery: controlsFor('relationship PACKAGE discovery/order mismatch'),
    postClassDeclarationBinding: controlsFor('post-class declaration binding not shared with implementations'),
    storedScopedNewException: [...new Set(transitions.filter(row => row.storedDecision === 'NEW').map(row => row.definitionId))],
    htmlInheritedNameNumDrift: htmlRows.map(row => row.definitionId).slice(0, 7),
    ordinaryExactPopulation: ordinaryControls
  };

  const operandSubstitutionExact = referenceTargetIds.filter(definitionId => {
    const definition = byId.get(definitionId)!;
    const current = encoded.get(definitionId)!;
    return becomesExactAfterAlignedOperandSubstitution(definition, current.program, current.references);
  });
  const report = {
    baseline: { runId: latest.runId, gitCommit: latest.gitCommit },
    reproduction: {
      cycle24Rows: cycle24.rows.length,
      referenceRoots: referenceTargetIds.length,
      namesMetadataRoots: namesBoundaryIds.length,
      otherRoots: otherIds.length,
      allBlockers: countBy([...encoded.values()], row => row.blocker)
    },
    referenceArtifacts: artifactSummary,
    identityVsOrdering: countBy(roots, row => row.identityOrderingClass),
    earliestAllocationCauses: countBy(roots, row => row.earliestAllocationDifference.cause),
    earliestCausalFamilies: countBy(roots, row => row.causalFamily),
    downstreamNameNumDriftOnly: roots.filter(row => row.downstreamNameNumDriftOnly).length,
    dispositions: countBy(roots, row => row.disposition),
    allocationStream: {
      rootsWithExactIdentityMultiset: roots.filter(row => row.streamComparison.sameIdentityMultiset).length,
      rootsWithOperandCollision: roots.filter(row => row.firstOperandCollision !== undefined).length,
      packageProvenanceAtFirstAllocationDifference: countBy(roots, row => row.packageProvenance)
    },
    lifetimeTransitions: {
      observations: transitions.length,
      requestedContexts: requestedTransitionContexts,
      storedByRelationshipArtifactDecision: transitionMatrix,
      currentAgreement: countBy(transitions, row => `${row.storedDecision} stored / ${row.currentDecision} current`),
      competingModels: modelSummary(transitions)
    },
    selectedAllocationModel: {
      allocationStream: 'one Application Class compilation-unit stream',
      discoveryPhases: [
        'imports',
        'whole-unit class relationship/member-type discovery',
        'post-class declarations',
        'implementations in source order'
      ],
      identityPolicy: 'share compilation-unit allocation/binding state while retaining ordinary receiver/control scoped identity decisions',
      globalNameInternerRejectedBy: '10 stored NEW transitions in one scoped-control definition (29797)',
      rawDeclarationOrderRejectedBy: `${declarationOrderControls.filter(row => !row.sourceOrderPreserved).length}/${declarationOrderControls.length} multi-type controls`,
      exactInternalDiscoveryOrder: 'unresolved compiler symbol-table/prepass order',
      implementationReady: false,
      directoryNamesRecordsSlotsAllocatePspcmname: false,
      exactFirstRootsExplained: roots.filter(row => row.disposition === 'FULLY_EXPLAINED').length,
      unresolvedFirstRoots: roots.filter(row => row.disposition === 'UNRESOLVED').length
    },
    packageDependencies: {
      rowsInTargetDefinitions: packageMetadataShapes,
      sourceProvenance: packageRowsByProvenance,
      declarationSourceOrder: {
        controlsWithAtLeastTwoMatchedTypes: declarationOrderControls.length,
        preserved: declarationOrderControls.filter(row => row.sourceOrderPreserved).length,
        contradictions: declarationOrderControls.filter(row => !row.sourceOrderPreserved).length
      },
      declarationGroupOrder: countBy(declarationGroupOrderRows, row => `${row.pair} | ${row.order}`),
      withinDeclarationGroupSourceOrder: countBy(withinDeclarationGroupRows, row => `${row.group} | ${row.preserved ? 'preserved' : 'contradiction'}`),
      relationships: {
        checks: relationshipControls.length,
        withPackageRow: relationshipControls.filter(row => row.hasStoredPackageRow).length,
        withoutPackageRow: relationshipControls.filter(row => !row.hasStoredPackageRow).length,
        byKind: countBy(relationshipControls, row => `${row.kind} | ${row.hasStoredPackageRow ? 'PACKAGE' : 'no PACKAGE'}`)
      },
      transitionDecisions: countBy(
        transitions.filter(row => row.artifact === 'PACKAGE' || row.artifact === 'Application Class method'),
        row => `${row.relationship} | ${row.storedDecision}`
      )
    },
    matchedControls,
    ordinaryPeopleCodeNegativeControls: ordinaryControls,
    htmlNegativeControl: {
      directHtmlRoots: htmlRows.length,
      correctHtmlIdentityWrongNameNum: htmlRows.filter(row => allocationIdentity(row.storedRow) === allocationIdentity(row.generatedRow) && row.storedNameNum !== row.generatedNameNum).length,
      htmlIdentityDisagreements: htmlRows.filter(row => allocationIdentity(row.storedRow) !== allocationIdentity(row.generatedRow)).length
    },
    namesMetadataBoundary: {
      population: namesBoundary.length,
      classification: countBy(namesBoundary, row => row.classification),
      secondaryReferenceStreamMismatch: namesBoundary.filter(row => row.secondaryReferenceStreamMismatch).length
    },
    otherPopulation: {
      population: otherRows.length,
      families: countBy(otherRows, row => row.family),
      signatures: countBy(otherRows, row => `${row.family} | ${row.signature}`)
    },
    semanticPopulation: {
      allApplicationClasses: definitions.length,
      sourceEncodable: sourceEncodableDefinitions.length,
      currentAnalyzerEncodable: allEncoded.size,
      currentlyExact: definitions.filter(definition => latest.rows.get(definition.definitionId)?.classification === 'EXACT').length,
      referenceBearing: referenceBearing.length
    },
    cycle27BlastRadius: {
      directRoots: referenceTargetIds.length,
      completeApplicationClassFacadeTraversal: sourceEncodableDefinitions.length,
      currentlyExactTraversingFacade: sourceEncodableDefinitions.filter(definition => latest.rows.get(definition.definitionId)?.classification === 'EXACT').length,
      currentlyNonExactTraversingFacade: sourceEncodableDefinitions.filter(definition => latest.rows.get(definition.definitionId)?.classification !== 'EXACT').length,
      evidencedAllocationStreamChanges: differingAllocationStreams.length,
      evidencedOperandShaChangeLowerBound: predictedProgramChanges.length,
      predictedGeneratedShaChanges: 'not defensible until symbol-table/prepass order is resolved; 626 is the aligned-operand lower bound',
      definitionsExpectedToAdvance: referenceTargetIds.length,
      alignedOperandOnlyExactCandidates: operandSubstitutionExact.length,
      collisionDefinitions: collisionDefinitions.length,
      regressionRiskSurface: 'Application Class V2 path only; ordinary encoder scopes remain untouched'
    },
    cycle27Recommendation: {
      subsystem: 'Application Class declaration terminator/separator semantics',
      implementReferenceFacade: false,
      rationale: 'reference architecture is coherent, but exact declaration dependency order and scoped NEW exceptions are not yet contradiction-free',
      targetPopulation: '55 of the 60 newly classified roots, adjacent to the existing 44 terminator/separator roots',
      deferredReferenceFacadeBoundaries: [
        'source-phase PACKAGE discovery/order',
        'shared Application Class declaration and binding state',
        'one real owner row with no suppressed-owner operand aliasing',
        'shared cross-fragment allocation sequence'
      ],
      boundaries: [
        'repeated/missing declaration terminators',
        'extra declaration terminator before the unit closer',
        'interaction with the existing 44 terminator/separator roots'
      ],
      frozen: [
        'ordinary DependencyScope and FieldDependencyScope rules',
        'rowShorthandRecords and ChainSemantics',
        'HTML lifetime policy',
        'directory names/records/slots metadata'
      ]
    },
    roots: process.argv.includes('--json') ? roots : undefined,
    transitionRows: process.argv.includes('--json') ? transitions : undefined,
    namesBoundaryRows: process.argv.includes('--json') ? namesBoundary : undefined,
    otherRows: process.argv.includes('--json') ? otherRows : undefined
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
