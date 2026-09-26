/**
 * Cycle 29: Application Class program-name/directory metadata census.
 *
 * Read-only. Uses the completed local HCDEV snapshot, the current encoder,
 * and Cycle 28's saved post-fix report. It never connects to Oracle or writes
 * corpus state.
 *
 * Usage:
 *   npx tsx tools/corpus/research/application-class-name-metadata-analysis.ts \
 *     --cycle28-report /tmp/cycle29-baseline-full.json
 *   npx tsx tools/corpus/research/application-class-name-metadata-analysis.ts \
 *     --cycle28-report /tmp/cycle29-baseline-full.json --json
 */

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  APPLICATION_CLASS_FLAGS,
  parseApplicationClassSource,
  type ApplicationClassProgram
} from '../../../src/peoplecode/applicationClassProgram';
import {
  encodeProgramArtifacts,
  type PeopleCodeOwner,
  type PeopleCodeReference
} from '../../../src/peoplecode/encoder';
import {
  PROGRAM_DIRECTORY_RECORD_SIZE,
  PROGRAM_DISPATCH_SLOT_SIZE,
  readProgramLayout
} from '../../../src/peoplecode/programLayout';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';
import type { SnapshotDefinition, SnapshotNameRow } from '../snapshot/types';

const APPLICATION_CLASS_OBJECT_ID = 104;

const NON_DIRECTORY_TYPE_NAMES = new Set([
  'string', 'date', 'any', 'boolean', 'time', 'datetime', 'object', 'integer', 'number',
  'file', 'sql', 'record', 'rowset', 'row', 'field', 'processrequest', 'message',
  'apiobject', 'grid', 'javaobject', 'xmldoc', 'exception', 'xmlnode', 'document',
  'compound', 'collection', 'map', 'mapelement', 'jsonbuilder', 'jsonobject', 'jsonarray'
]);

interface Cycle28Report {
  cycle28Validation: {
    cycle27DirectRoots: number;
    currentTargetBlockers: Array<{ definitionId: number; blocker: string }>;
  };
}

interface ResultRow {
  sourceEncodeSuccess: boolean;
  generatedSha256?: string;
}

interface NameEntry {
  text: string;
  charOffset: number;
}

type RecordKind = 'self' | 'property' | 'instance' | 'getter' | 'setter' | 'method';

interface DirectoryRecord {
  index: number;
  nameOffset: number;
  name: string;
  signatureSlotOffset: number;
  attributesAndCount: number;
  flags: number;
  low: number;
  descriptor: number;
  kind: RecordKind;
}

interface ParsedMetadata {
  names: NameEntry[];
  records: DirectoryRecord[];
  slots: number[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function readBaseline(runId: number): Map<number, ResultRow> {
  const db = new Database('tools/corpus/corpus-results.sqlite', { readonly: true });
  const run = db.prepare(`
    SELECT run_id FROM corpus_run
    WHERE run_id = ? AND completed_at IS NOT NULL AND definitions = 30209
  `).get(runId);
  if (!run) throw new Error(`Completed full-corpus baseline run ${runId} was not found.`);
  const rows = db.prepare(`
    SELECT definition_id, source_encode_success, generated_sha256
    FROM result WHERE run_id = ?
  `).all(runId) as Array<Record<string, unknown>>;
  db.close();
  return new Map(rows.map(row => [Number(row.definition_id), {
    sourceEncodeSuccess: Boolean(row.source_encode_success),
    generatedSha256: row.generated_sha256 === null ? undefined : String(row.generated_sha256)
  }]));
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = key(value);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function firstDifference<T>(left: readonly T[], right: readonly T[], equal: (a: T, b: T) => boolean): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index++) {
    if (!equal(left[index], right[index])) return index;
  }
  return left.length === right.length ? -1 : shared;
}

function classifyRecord(attributesAndCount: number): RecordKind {
  const flags = attributesAndCount & 0xffff0000;
  if ((flags & APPLICATION_CLASS_FLAGS.self) !== 0) return 'self';
  if ((flags & APPLICATION_CLASS_FLAGS.getter) !== 0) return 'getter';
  if ((flags & APPLICATION_CLASS_FLAGS.setter) !== 0) return 'setter';
  if ((flags & APPLICATION_CLASS_FLAGS.property) !== 0) {
    return (flags & APPLICATION_CLASS_FLAGS.private) !== 0 &&
      (flags & APPLICATION_CLASS_FLAGS.storage) !== 0
      ? 'instance'
      : 'property';
  }
  return 'method';
}

function parseMetadata(program: Buffer): ParsedMetadata {
  const layout = readProgramLayout(program);
  const names: NameEntry[] = [];
  let offset = layout.names.offset;
  const end = offset + layout.names.byteLength;
  while (offset < end) {
    let terminator = offset;
    while (terminator + 1 < end && (program[terminator] !== 0 || program[terminator + 1] !== 0)) {
      terminator += 2;
    }
    if (terminator + 1 >= end) throw new Error('Unterminated Application Class directory name.');
    names.push({
      text: program.toString('utf16le', offset, terminator),
      charOffset: (offset - layout.names.offset) / 2
    });
    offset = terminator + 2;
  }
  const nameByOffset = new Map(names.map(name => [name.charOffset, name.text]));
  const records: DirectoryRecord[] = [];
  for (let index = 0; index < layout.recordCount; index++) {
    const base = layout.records.offset + index * PROGRAM_DIRECTORY_RECORD_SIZE;
    const nameOffset = program.readUInt32LE(base);
    const attributesAndCount = program.readUInt32LE(base + 8);
    records.push({
      index,
      nameOffset,
      name: nameByOffset.get(nameOffset) ?? '<invalid-name-offset>',
      signatureSlotOffset: program.readUInt32LE(base + 4),
      attributesAndCount,
      flags: attributesAndCount & 0xffff0000,
      low: attributesAndCount & 0xffff,
      descriptor: program.readUInt32LE(base + 12),
      kind: classifyRecord(attributesAndCount)
    });
  }
  const slots: number[] = [];
  for (let index = 0; index < layout.slotCount; index++) {
    slots.push(program.readUInt32LE(layout.slots.offset + index * PROGRAM_DISPATCH_SLOT_SIZE));
  }
  return { names, records, slots };
}

function sectionBytes(program: Buffer, name: 'statements' | 'names' | 'records' | 'slots'): Buffer {
  const layout = readProgramLayout(program);
  return program.subarray(layout[name].offset, layout[name].offset + layout[name].byteLength);
}

function ownerContext(definition: SnapshotDefinition): PeopleCodeOwner {
  const values = [
    definition.objectvalue1, definition.objectvalue2, definition.objectvalue3,
    definition.objectvalue4, definition.objectvalue5, definition.objectvalue6,
    definition.objectvalue7
  ].map(value => value.trim());
  const eventIndex = values.findIndex(value => normalize(value) === 'onexecute');
  return {
    recordName: values[0],
    fieldName: values[1],
    packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean)
  };
}

function storedReferenceShape(row: SnapshotNameRow): string {
  return [row.recname, row.refname, row.packageroot, row.qualifypath, row.appclassmethod]
    .map(value => normalize(value)).join('|');
}

function generatedReferenceShape(reference: PeopleCodeReference): string {
  if (reference.kind === 'owner') return '||||';
  if (reference.kind === 'package') {
    const path = reference.packagePath ?? (reference.packageName ? [reference.packageName] : []);
    return [
      'package', reference.className ?? reference.objectName ?? '',
      path[0] ?? '', path.slice(1).join(':'), reference.methodName ?? ''
    ].map(normalize).join('|');
  }
  return [
    reference.recordName ?? '', reference.fieldName ?? '', '', '', reference.methodName ?? ''
  ].map(normalize).join('|');
}

function sourceShape(parsed: ApplicationClassProgram): string {
  const counts = countBy(parsed.members, member => member.kind);
  return [
    parsed.unitKind,
    `methods=${counts.method ?? 0}`,
    `properties=${counts.property ?? 0}`,
    `instances=${counts.instance ?? 0}`,
    `constants=${counts.constant ?? 0}`,
    `implementations=${parsed.implementations.length}`,
    `extends=${parsed.extendsType === undefined ? 0 : 1}`,
    `implements=${parsed.implementsType === undefined ? 0 : 1}`
  ].join('|');
}

function typeDirectoryName(typeName: string | undefined): string | undefined {
  if (typeName === undefined) return undefined;
  let remaining = normalize(typeName).replace(/^(?:array\s+of\s+)+/, '');
  if (NON_DIRECTORY_TYPE_NAMES.has(remaining)) return undefined;
  return typeName.trim().replace(/^(?:array\s+of\s+)+/i, '');
}

function concreteMethodMetadataModel(
  definition: SnapshotDefinition,
  parsed: ApplicationClassProgram
): { recordedNames: string[]; typeSuffix: string[] } | undefined {
  const methods = parsed.members.filter(member => member.kind === 'method');
  if (parsed.unitKind !== 'class' || parsed.members.some(member => member.kind === 'property' || member.kind === 'instance') ||
      methods.some(method => method.abstract || method.implementationOrder < 0)) return undefined;
  const owner = ownerContext(definition).packagePath ?? [];
  const physicalMethods = [...methods].sort((a, b) => a.implementationOrder - b.implementationOrder);
  const declarationMethods = [...methods].sort((a, b) => a.declarationOrdinal - b.declarationOrdinal);
  const relationName = typeDirectoryName(parsed.extendsType ?? parsed.implementsType);
  return {
    recordedNames: [owner.join(':'), ...physicalMethods.map(method => method.name)],
    typeSuffix: [
      ...(relationName === undefined ? [] : [relationName]),
      ...physicalMethods.flatMap(method => {
        const name = typeDirectoryName(method.returnType);
        return name === undefined ? [] : [name];
      }),
      ...declarationMethods.flatMap(method => method.parameters.flatMap(parameter => {
        const name = typeDirectoryName(parameter.type);
        return name === undefined ? [] : [name];
      }))
    ]
  };
}

function descriptorNameOffset(descriptor: number): number | undefined {
  const core = descriptor & 0x000fffff;
  if ((core & 0x80000) === 0) return undefined;
  const sub = core & ~0x80000;
  return sub >= 0x100 ? sub - 0x100 : undefined;
}

function storedTypeAllocationOrder(metadata: ParsedMetadata): {
  exact: boolean;
  suffixOffsets: number[];
  descriptorOffsets: number[];
} {
  const suffixOffsets = metadata.names.slice(metadata.records.length).map(name => name.charOffset);
  const descriptorOffsets = [
    ...metadata.records.flatMap(record => {
      const offset = descriptorNameOffset(record.descriptor);
      return offset === undefined ? [] : [offset];
    }),
    ...metadata.slots.flatMap(slot => {
      const offset = descriptorNameOffset(slot);
      return offset === undefined ? [] : [offset];
    })
  ];
  return {
    exact: firstDifference(suffixOffsets, descriptorOffsets, (a, b) => a === b) < 0,
    suffixOffsets,
    descriptorOffsets
  };
}

function nameMismatchFamily(
  stored: ParsedMetadata,
  generated: ParsedMetadata
): string {
  const storedRecorded = stored.names.slice(0, stored.records.length).map(name => normalize(name.text));
  const generatedRecorded = generated.names.slice(0, generated.records.length).map(name => normalize(name.text));
  const storedSuffix = stored.names.slice(stored.records.length).map(name => normalize(name.text));
  const generatedSuffix = generated.names.slice(generated.records.length).map(name => normalize(name.text));
  if (stored.records.length !== generated.records.length) return 'missing/extra directory-record names';
  if (firstDifference(storedRecorded, generatedRecorded, (a, b) => a === b) >= 0) {
    const sameMultiset = [...storedRecorded].sort().join('\0') === [...generatedRecorded].sort().join('\0');
    return sameMultiset ? 'directory-record name ordering' : 'directory-record name identity';
  }
  if (firstDifference(storedSuffix, generatedSuffix, (a, b) => a === b) >= 0) {
    const sameMultiset = [...storedSuffix].sort().join('\0') === [...generatedSuffix].sort().join('\0');
    return sameMultiset ? 'type-name suffix ordering' : 'type-name suffix identity/multiplicity';
  }
  return 'names exact after concrete-method metadata fix';
}

function main(): void {
  const reportIndex = process.argv.indexOf('--cycle28-report');
  const reportPath = reportIndex < 0 ? undefined : process.argv[reportIndex + 1];
  if (!reportPath) throw new Error('--cycle28-report is required.');
  const cycle28 = JSON.parse(readFileSync(reportPath, 'utf8')) as Cycle28Report;
  if (cycle28.cycle28Validation.cycle27DirectRoots !== 99) {
    throw new Error('Cycle 28 report does not reproduce the 99 Cycle 27 roots.');
  }
  const targetIds = cycle28.cycle28Validation.currentTargetBlockers
    .filter(row => row.blocker === 'Application Class names metadata')
    .map(row => row.definitionId)
    .sort((a, b) => a - b);
  if (targetIds.length !== 49) throw new Error(`Expected 49 names-metadata roots, received ${targetIds.length}.`);
  const baselineIndex = process.argv.indexOf('--baseline-run');
  const baselineRunId = baselineIndex < 0 ? undefined : Number(process.argv[baselineIndex + 1]);
  const baseline = baselineRunId === undefined ? undefined : readBaseline(baselineRunId);

  const db = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(db)
    .filter(definition => definition.objectid1 === APPLICATION_CLASS_OBJECT_ID);
  db.close();
  const byId = new Map(definitions.map(definition => [definition.definitionId, definition]));

  const rows = targetIds.map(definitionId => {
    const definition = byId.get(definitionId);
    if (!definition) throw new Error(`Missing target definition ${definitionId}.`);
    const parsed = parseApplicationClassSource(definition.sourceText);
    if (!parsed) throw new Error(`Target definition ${definitionId} does not parse as an active Application Class.`);
    const artifacts = encodeProgramArtifacts(definition.sourceText, { owner: ownerContext(definition) });
    const stored = parseMetadata(definition.storedProgram);
    const generated = parseMetadata(artifacts.program);
    const storedNames = stored.names.map(name => name.text);
    const generatedNames = generated.names.map(name => name.text);
    const firstNameDifference = firstDifference(storedNames, generatedNames, (a, b) => a === b);
    const firstNormalizedNameDifference = firstDifference(storedNames, generatedNames, (a, b) => normalize(a) === normalize(b));
    const storedReferences = definition.names.map(storedReferenceShape);
    const generatedReferences = artifacts.references.map(generatedReferenceShape);
    const statementsExact = sectionBytes(definition.storedProgram, 'statements')
      .equals(sectionBytes(artifacts.program, 'statements'));
    const namesExact = sectionBytes(definition.storedProgram, 'names')
      .equals(sectionBytes(artifacts.program, 'names'));
    const recordsExact = sectionBytes(definition.storedProgram, 'records')
      .equals(sectionBytes(artifacts.program, 'records'));
    const slotsExact = sectionBytes(definition.storedProgram, 'slots')
      .equals(sectionBytes(artifacts.program, 'slots'));
    const externalReferenceDifference = firstDifference(storedReferences, generatedReferences, (a, b) => a === b);
    const currentOutcome = !namesExact ? 'names metadata'
      : !recordsExact ? 'directory records metadata'
        : !slotsExact ? 'signature slots metadata'
          : !statementsExact ? 'comment/marker residual'
            : externalReferenceDifference >= 0 ? 'PSPCMNAME/reference identity'
              : 'source program + PSPCMNAME exact';
    return {
      definitionId,
      displayName: definition.displayName,
      sourceShape: sourceShape(parsed),
      sourceMembers: parsed.members.map(member => ({
        kind: member.kind,
        name: member.name,
        sourceOrder: member.sourceOrder,
        declarationOrdinal: 'declarationOrdinal' in member ? member.declarationOrdinal : undefined,
        implementationOrder: member.kind === 'method' ? member.implementationOrder : undefined,
        type: member.kind === 'property' || member.kind === 'instance' ? member.type : undefined,
        mode: member.kind === 'property' || member.kind === 'instance' ? member.mode : undefined,
        abstract: member.kind === 'method' ? member.abstract : undefined,
        parameters: member.kind === 'method' ? member.parameters : undefined,
        returnType: member.kind === 'method' ? member.returnType : undefined
      })),
      implementations: parsed.implementations.map(implementation => `${implementation.kind}:${implementation.name}`),
      family: nameMismatchFamily(stored, generated),
      firstNameDifference,
      firstNormalizedNameDifference,
      storedNames,
      generatedNames,
      storedRecordedNames: stored.records.map(record => `${record.kind}:${record.name}`),
      generatedRecordedNames: generated.records.map(record => `${record.kind}:${record.name}`),
      storedTypeSuffix: stored.names.slice(stored.records.length).map(name => name.text),
      generatedTypeSuffix: generated.names.slice(generated.records.length).map(name => name.text),
      storedRecords: stored.records,
      generatedRecords: generated.records,
      storedSlots: stored.slots,
      generatedSlots: generated.slots,
      statementsExact,
      namesExact,
      recordsExact,
      slotsExact,
      currentOutcome,
      externalReferenceDifference,
      storedReferences,
      generatedReferences
    };
  });

  const concreteMethodControls = definitions.flatMap(definition => {
    const parsed = parseApplicationClassSource(definition.sourceText);
    if (!parsed) return [];
    const model = concreteMethodMetadataModel(definition, parsed);
    if (!model) return [];
    const stored = parseMetadata(definition.storedProgram);
    const storedRecordedNames = stored.records.map(record => record.name);
    const storedTypeSuffix = stored.names.slice(stored.records.length).map(name => name.text);
    return [{
      definitionId: definition.definitionId,
      recordedNamesMatch: firstDifference(storedRecordedNames, model.recordedNames, (a, b) => normalize(a) === normalize(b)) < 0,
      typeSuffixMatches: firstDifference(storedTypeSuffix, model.typeSuffix, (a, b) => normalize(a) === normalize(b)) < 0,
      storedRecordedNames,
      modeledRecordedNames: model.recordedNames,
      storedTypeSuffix,
      modeledTypeSuffix: model.typeSuffix
    }];
  });
  const allocationOrderControls = definitions.map(definition => {
    const metadata = parseMetadata(definition.storedProgram);
    return { definitionId: definition.definitionId, ...storedTypeAllocationOrder(metadata) };
  });
  const currentShaById = new Map<number, string>();
  if (baseline !== undefined) {
    for (const definition of definitions) {
      if (!baseline.get(definition.definitionId)?.sourceEncodeSuccess) continue;
      const program = encodeProgramArtifacts(definition.sourceText, { owner: ownerContext(definition) }).program;
      currentShaById.set(definition.definitionId, createHash('sha256').update(program).digest('hex'));
    }
  }
  const changedIds = baseline === undefined ? [] : [...currentShaById]
    .filter(([definitionId, sha]) => baseline.get(definitionId)?.generatedSha256 !== sha)
    .map(([definitionId]) => definitionId)
    .sort((a, b) => a - b);
  const unchangedIds = baseline === undefined ? [] : [...currentShaById]
    .filter(([definitionId, sha]) => baseline.get(definitionId)?.generatedSha256 === sha)
    .map(([definitionId]) => definitionId)
    .sort((a, b) => a - b);
  const targetIdSet = new Set(targetIds);

  const report = {
    reproduction: {
      cycle27DirectRoots: cycle28.cycle28Validation.cycle27DirectRoots,
      namesMetadataRoots: targetIds.length,
      definitionIds: targetIds
    },
    families: countBy(rows, row => row.family),
    sourceShapes: countBy(rows, row => row.sourceShape),
    sourceMemberKinds: countBy(rows.flatMap(row => row.sourceMembers), member => member.kind),
    recordCounts: countBy(rows, row => `${row.storedRecords.length} stored / ${row.generatedRecords.length} generated`),
    typeSuffixCounts: countBy(rows, row => `${row.storedTypeSuffix.length} stored / ${row.generatedTypeSuffix.length} generated`),
    externalReferenceStreams: countBy(rows, row => row.externalReferenceDifference < 0 ? 'exact' : 'different'),
    currentOutcomes: countBy(rows, row => row.currentOutcome),
    blastRadius: baseline === undefined ? undefined : {
      baselineRunId,
      sourceEncodableApplicationClasses: currentShaById.size,
      generatedShaChanges: changedIds.length,
      changedTargets: changedIds.filter(id => targetIdSet.has(id)).length,
      changedBeyondTargets: changedIds.filter(id => !targetIdSet.has(id)).length,
      unchangedDefinitions: unchangedIds.length,
      changedDefinitionIds: process.argv.includes('--json') ? changedIds : undefined,
      unchangedDefinitionIds: process.argv.includes('--json') ? unchangedIds : undefined
    },
    concreteMethodMetadataModel: {
      population: concreteMethodControls.length,
      recordedNamesMatch: concreteMethodControls.filter(row => row.recordedNamesMatch).length,
      recordedNamesContradictions: concreteMethodControls.filter(row => !row.recordedNamesMatch).length,
      typeSuffixMatches: concreteMethodControls.filter(row => row.typeSuffixMatches).length,
      typeSuffixContradictions: concreteMethodControls.filter(row => !row.typeSuffixMatches).length,
      contradictionRows: process.argv.includes('--json')
        ? concreteMethodControls.filter(row => !row.recordedNamesMatch || !row.typeSuffixMatches)
        : undefined
    },
    storedTypeAllocationOrder: {
      population: allocationOrderControls.length,
      exact: allocationOrderControls.filter(row => row.exact).length,
      contradictions: allocationOrderControls.filter(row => !row.exact).length,
      suffixEntries: allocationOrderControls.reduce((sum, row) => sum + row.suffixOffsets.length, 0),
      contradictionRows: process.argv.includes('--json')
        ? allocationOrderControls.filter(row => !row.exact)
        : undefined
    },
    rows: process.argv.includes('--json') ? rows : undefined
  };
  console.log(JSON.stringify(report, null, 2));
}

main();
