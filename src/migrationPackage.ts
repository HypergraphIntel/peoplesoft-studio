import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { DefinitionType, makeKey, type DefinitionKey } from './model/definitions.js';
import type { FieldDefinition } from './model/fieldDefinition.js';
import { FieldType, RecordType } from './model/record.js';
import type { RecordLayout } from './model/recordLayout.js';
import { EDITABLE_USE_BITS, EDITABLE_USE2_BITS, KNOWN_PAGE_CONTROLS, type RecordEditField, type RecordPropertyEdits, type RecordTypeEdits } from './model/recordEdit.js';
import type { AeDocument } from './model/aeDocument.js';
import { validateAppEngine } from './model/aeValidation.js';
import { peopleCodeKeyParts } from './model/appEngine.js';
import { projectKeyIdentity } from './projectCompare.js';
import type { DefinitionSummary } from './providers/provider.js';

export interface PortableRecord {
  name: string;
  recordType: RecordType;
  fields: Omit<RecordEditField, 'isNew'>[];
  properties: RecordPropertyEdits;
  type: RecordTypeEdits;
}
export type MigrationAsset =
  | { kind: 'field'; key: DefinitionKey; data: FieldDefinition }
  | { kind: 'record'; key: DefinitionKey; data: PortableRecord }
  | { kind: 'ae'; key: DefinitionKey; data: AeDocument };
export interface StudioMigrationPackage {
  format: 'psft-migration/1';
  project: string;
  toolsRelease: string;
  members: DefinitionKey[];
  assets: MigrationAsset[];
  requirements: DefinitionKey[];
  checksum: string;
}
export interface MigrationPackageReader {
  listProjectItems(project: string): Promise<DefinitionSummary[]>;
  readField(key: DefinitionKey): Promise<FieldDefinition | undefined>;
  readRecordLayout(key: DefinitionKey): Promise<RecordLayout | undefined>;
  readAppEngineDocument(name: string): Promise<{ doc: AeDocument; token: string } | undefined>;
  readEnvironment(): Promise<{ toolsRelease: string }>;
  readTranslates(fieldName: string): Promise<unknown[]>;
}

/** Strip installation-local concurrency stamps, not semantic values. */
export function migrationCanonical(value: unknown): string {
  return JSON.stringify(value, (key, item: unknown) => {
    if (['version', 'lastUpdated', 'lastUpdatedBy', 'origin', 'copiedFrom'].includes(key)) return undefined;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
}
export const migrationHash = (value: unknown): string => createHash('sha256').update(migrationCanonical(value)).digest('hex');

function assetRequirements(asset: MigrationAsset): DefinitionKey[] {
  const keys: DefinitionKey[] = [];
  const record = (name: string | undefined) => { if (name) keys.push(makeKey(DefinitionType.Record, name)); };
  if (asset.kind === 'record') {
    for (const field of asset.data.fields) {
      keys.push(makeKey(DefinitionType.Field, field.name));
      record(field.editTable); record(field.defaultRecord);
    }
    for (const property of ['parentRecord', 'relatedLanguageRecord', 'querySecurityRecord', 'analyticDeleteRecord', 'auditRecord'] as const) record(asset.data.properties[property]);
  } else if (asset.kind === 'ae') {
    for (const state of asset.data.stateRecords) record(state.record);
    for (const table of asset.data.tempTables) record(table);
    for (const section of asset.data.sections) for (const variant of section.variants) for (const step of variant.steps) {
      if (step.actions.some(a => a.type === 'C') && !step.dynamic && step.doProgram) keys.push(makeKey(DefinitionType.AppEngineProgram, step.doProgram));
    }
  }
  return keys;
}

export function portableField(field: FieldDefinition): FieldDefinition {
  if (field.notUsed || field.auxFlagMask || field.defaultCenturyYear || field.formatFamily) throw new Error(`${field.name}: advanced field properties are not supported by migration v1.`);
  if (field.type === FieldType.Character && ![0, 6].includes(field.format ?? 0)) throw new Error(`${field.name}: unsupported character format.`);
  if (!field.labels.length || field.labels.filter(label => label.isDefault).length !== 1) throw new Error(`${field.name}: exactly one default label is required.`);
  return {
    name: field.name, type: field.type, length: field.length, decimalPositions: field.decimalPositions,
    ...(field.type === FieldType.Character ? { format: field.format ?? 0 } : {}),
    description: field.description ?? '',
    labels: [...field.labels].sort((a, b) => a.id.localeCompare(b.id))
  };
}

export function portableRecord(layout: RecordLayout): PortableRecord {
  if (![RecordType.Table, RecordType.DerivedWork].includes(layout.recordType)) throw new Error(`${layout.name}: migration v1 supports SQL Table and Derived/Work records.`);
  if (layout.auxFlagMask || layout.properties?.auxFlagMask || layout.indexIds?.some(id => id !== '_')) throw new Error(`${layout.name}: auxiliary flags and secondary indexes are not supported by migration v1.`);
  if (layout.properties?.optTrigFlag && layout.properties.optTrigFlag !== 'N') throw new Error(`${layout.name}: unsupported record trigger setting.`);
  if (layout.fields.some(field => field.isSubrecord || field.hasPeopleCode || field.setControlField
    || !KNOWN_PAGE_CONTROLS.includes(field.defGuiControl ?? 99)
    || (field.useEdit & ~EDITABLE_USE_BITS) !== 0 || ((field.useEdit2 ?? 0) & ~EDITABLE_USE2_BITS) !== 0)) {
    throw new Error(`${layout.name}: subrecords, associated PeopleCode or unsupported field settings require another migration adapter.`);
  }
  const properties: RecordPropertyEdits = { description: layout.description };
  const p = layout.properties;
  if (p) for (const key of ['description', 'definition', 'ownerId', 'setControlField', 'parentRecord', 'relatedLanguageRecord',
    'querySecurityRecord', 'analyticDeleteRecord', 'auditRecord', 'systemIdField', 'timestampField', 'recUse'] as const) {
    Object.assign(properties, { [key]: p[key] });
  }
  return {
    name: layout.name, recordType: layout.recordType,
    fields: layout.fields.map(field => ({
      name: field.name, useEdit: field.useEdit, useEdit2: field.useEdit2 ?? 0, editTable: field.editTable,
      defaultRecord: field.defaultRecord, defaultField: field.defaultField, labelId: field.labelId ?? '',
      pageControl: field.defGuiControl ?? 99
    })),
    properties, type: { recordType: layout.recordType, sqlTableName: layout.sqlTableName, buildSequence: layout.buildSequence ?? 1 }
  };
}

const name = z.string().regex(/^[A-Z0-9_]{1,30}$/);
const keySchema = z.object({ type: z.number().int(), parts: z.array(z.string()).min(1).max(7) }).strict();
const labelSchema = z.object({ id: z.string().min(1), longName: z.string(), shortName: z.string(), isDefault: z.boolean() }).strict();
const fieldSchema = z.object({
  name, type: z.number().int(), length: z.number().int().nonnegative(), decimalPositions: z.number().int().nonnegative(),
  format: z.number().int().optional(), description: z.string(), labels: z.array(labelSchema).min(1)
}).strict();
const propertySchema = z.object({
  description: z.string().optional(), definition: z.string().optional(), ownerId: z.string().optional(),
  setControlField: z.string().optional(), parentRecord: z.string().optional(), relatedLanguageRecord: z.string().optional(),
  querySecurityRecord: z.string().optional(), analyticDeleteRecord: z.string().optional(), auditRecord: z.string().optional(),
  systemIdField: z.string().optional(), timestampField: z.string().optional(), recUse: z.number().int().optional()
}).strict();
const recordSchema = z.object({
  name, recordType: z.union([z.literal(0), z.literal(2)]),
  fields: z.array(z.object({ name, useEdit: z.number().int(), useEdit2: z.number().int().optional(),
    editTable: z.string().optional(), defaultRecord: z.string().optional(), defaultField: z.string().optional(),
    labelId: z.string().optional(), pageControl: z.number().int().optional() }).strict()).min(1),
  properties: propertySchema,
  type: z.object({ recordType: z.union([z.literal(0), z.literal(2)]), sqlTableName: z.string(), buildSequence: z.number().int() }).strict()
}).strict();
const aeSchema = z.custom<AeDocument>(value => {
  try { return !!value && typeof value === 'object' && validateAppEngine(value as AeDocument).every(d => d.severity !== 'error'); }
  catch { return false; }
}, 'Invalid App Engine document');
const assetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('field'), key: keySchema, data: fieldSchema }).strict(),
  z.object({ kind: z.literal('record'), key: keySchema, data: recordSchema }).strict(),
  z.object({ kind: z.literal('ae'), key: keySchema, data: aeSchema }).strict()
]);
const packageSchema = z.object({
  format: z.literal('psft-migration/1'), project: name, toolsRelease: z.string().regex(/^8\.\d{2}$/),
  members: z.array(keySchema).max(10000), assets: z.array(assetSchema).max(10000),
  requirements: z.array(keySchema).max(10000), checksum: z.string().regex(/^[0-9a-f]{64}$/)
}).strict();

export function parseMigrationPackage(text: string): StudioMigrationPackage {
  const parsed = packageSchema.parse(JSON.parse(text)) as StudioMigrationPackage;
  const { checksum, ...body } = parsed;
  if (migrationHash(body) !== checksum) throw new Error('Migration package checksum does not match its contents.');
  const seen = new Set<string>();
  for (const asset of parsed.assets) {
    const expectedType = { field: DefinitionType.Field, record: DefinitionType.Record, ae: DefinitionType.AppEngineProgram }[asset.kind];
    if (asset.key.type !== expectedType || asset.key.parts.length !== 1 || asset.key.parts[0] !== asset.data.name) throw new Error('Migration asset identity does not match its payload.');
    const id = projectKeyIdentity(asset.key);
    if (seen.has(id)) throw new Error('Duplicate migration asset.');
    seen.add(id);
    if (asset.kind === 'field') portableField(asset.data);
    if (asset.kind === 'record') {
      if (asset.data.recordType !== asset.data.type.recordType) throw new Error('Record type mismatch.');
      const names = new Set<string>();
      for (const field of asset.data.fields) {
        if (names.has(field.name)) throw new Error('Duplicate record field.');
        names.add(field.name);
        if ((field.useEdit & ~EDITABLE_USE_BITS) !== 0 || ((field.useEdit2 ?? 0) & ~EDITABLE_USE2_BITS) !== 0
          || !KNOWN_PAGE_CONTROLS.includes(field.pageControl ?? 99)) throw new Error('Unsupported record field settings.');
      }
    }
  }
  for (const member of parsed.members) {
    const parent = [DefinitionType.AppEngineSection, DefinitionType.AppEnginePeopleCode].includes(member.type)
      ? makeKey(DefinitionType.AppEngineProgram, member.parts[0]) : member;
    if (!seen.has(projectKeyIdentity(parent))) throw new Error('Project member has no migration asset: ' + member.parts.join('.'));
    if ([DefinitionType.AppEngineSection, DefinitionType.AppEnginePeopleCode].includes(member.type)) {
      const asset = parsed.assets.find(a => a.kind === 'ae' && a.data.name === member.parts[0]);
      if (!asset || asset.kind !== 'ae') throw new Error('AE parent missing.');
      const keys: DefinitionKey[] = [];
      for (const section of asset.data.sections) {
        keys.push(makeKey(DefinitionType.AppEngineSection, asset.data.name, section.name));
        for (const variant of section.variants) for (const step of variant.steps) {
          const parts = peopleCodeKeyParts(asset.data.name, section.name, variant, step.name);
          if (parts && step.actions.some(a => a.type === 'P')) keys.push(makeKey(DefinitionType.AppEnginePeopleCode, ...parts));
        }
      }
      if (!keys.some(k => projectKeyIdentity(k) === projectKeyIdentity(member))) throw new Error('AE project member has no section or PeopleCode action in the package.');
    }
  }
  const declared = new Set(parsed.requirements.map(projectKeyIdentity));
  for (const asset of parsed.assets) for (const dependency of assetRequirements(asset)) {
    const id = projectKeyIdentity(dependency);
    if (!seen.has(id) && !declared.has(id)) throw new Error('Required dependency was omitted from the package: ' + dependency.parts.join('.'));
  }
  return JSON.parse(migrationCanonical(parsed)) as StudioMigrationPackage;
}

export async function exportMigrationPackage(source: MigrationPackageReader, project: string): Promise<StudioMigrationPackage> {
  const items = await source.listProjectItems(project);
  const assets = new Map<string, MigrationAsset>();
  for (const { key } of items) {
    const type = [DefinitionType.AppEngineSection, DefinitionType.AppEnginePeopleCode].includes(key.type) ? DefinitionType.AppEngineProgram : key.type;
    const assetKey = makeKey(type, key.parts[0]);
    if (assets.has(projectKeyIdentity(assetKey))) continue;
    let asset: MigrationAsset;
    if (type === DefinitionType.Field) {
      const field = await source.readField(assetKey);
      if (!field) throw new Error('Field not found: ' + key.parts[0]);
      if ((await source.readTranslates(field.name)).length) throw new Error(field.name + ': translate values require another migration adapter.');
      asset = { kind: 'field', key: assetKey, data: portableField(field) };
    } else if (type === DefinitionType.Record) {
      const record = await source.readRecordLayout(assetKey);
      if (!record) throw new Error('Record not found: ' + key.parts[0]);
      asset = { kind: 'record', key: assetKey, data: portableRecord(record) };
    } else if (type === DefinitionType.AppEngineProgram) {
      const program = await source.readAppEngineDocument(key.parts[0]);
      if (!program) throw new Error('App Engine not found: ' + key.parts[0]);
      asset = { kind: 'ae', key: assetKey, data: JSON.parse(migrationCanonical(program.doc)) as AeDocument };
    } else throw new Error('No migration adapter for definition type ' + type + ': ' + key.parts.join('.'));
    assets.set(projectKeyIdentity(assetKey), asset);
  }
  const requirements = new Map<string, DefinitionKey>();
  const require = (key: DefinitionKey) => { if (!assets.has(projectKeyIdentity(key))) requirements.set(projectKeyIdentity(key), key); };
  for (const asset of assets.values()) for (const key of assetRequirements(asset)) require(key);
  const body = { format: 'psft-migration/1' as const, project, toolsRelease: (await source.readEnvironment()).toolsRelease,
    members: items.map(item => item.key), assets: [...assets.values()], requirements: [...requirements.values()] };
  return parseMigrationPackage(JSON.stringify({ ...body, checksum: migrationHash(body) }));
}

export interface MigrationTarget {
  toolsRelease: string;
  read(asset: MigrationAsset): Promise<{ data: MigrationAsset['data']; token: string } | undefined>;
  exists(key: DefinitionKey): Promise<boolean>;
  validate?(asset: MigrationAsset, expectedToken: string, assets: readonly MigrationAsset[]): Promise<string[]>;
  projectToken?(project: string): Promise<string>;
  write(asset: MigrationAsset, expectedToken: string): Promise<void>;
  finish(project: string, members: DefinitionKey[], expectedToken?: string): Promise<void>;
}
export interface MigrationImportPlan {
  packageChecksum: string;
  changes: { asset: MigrationAsset; action: 'create' | 'update' | 'same'; expectedToken: string }[];
  blockers: string[];
  projectToken?: string;
}
export async function previewMigrationImport(pkg: StudioMigrationPackage, target: MigrationTarget): Promise<MigrationImportPlan> {
  const plan: MigrationImportPlan = { packageChecksum: pkg.checksum, changes: [], blockers: [] };
  plan.projectToken = await target.projectToken?.(pkg.project);
  if (target.toolsRelease !== pkg.toolsRelease) plan.blockers.push('Source and target PeopleTools release families differ.');
  for (const key of pkg.requirements) if (!await target.exists(key)) plan.blockers.push('Required definition missing: ' + key.parts.join('.'));
  const pending = [...pkg.assets].sort((a, b) => ['field', 'record', 'ae'].indexOf(a.kind) - ['field', 'record', 'ae'].indexOf(b.kind));
  const ordered: MigrationAsset[] = [];
  while (pending.length) {
    const index = pending.findIndex(asset => {
      const required = new Set(assetRequirements(asset).map(projectKeyIdentity));
      return !pending.some(other => other !== asset && required.has(projectKeyIdentity(other.key)));
    });
    if (index < 0) { plan.blockers.push('Migration contains cyclic definition dependencies.'); break; }
    ordered.push(pending.splice(index, 1)[0]);
  }
  for (const asset of ordered) {
    const existing = await target.read(asset);
    const expectedToken = existing?.token ?? 'absent';
    const action = !existing ? 'create' : migrationHash(existing.data) === migrationHash(asset.data) ? 'same' : 'update';
    if (action !== 'same' || asset.kind === 'ae') plan.blockers.push(...await target.validate?.(asset, expectedToken, pkg.assets) ?? []);
    plan.changes.push({ asset, action, expectedToken });
  }
  return plan;
}

/** Each existing writer commits independently; failures report exactly what completed. */
export async function applyMigrationImport(pkg: StudioMigrationPackage, plan: MigrationImportPlan, target: MigrationTarget): Promise<{ completed: string[]; failed?: string; error?: string }> {
  parseMigrationPackage(JSON.stringify(pkg));
  if (pkg.checksum !== plan.packageChecksum || plan.blockers.length) throw new Error('Migration preview is blocked or does not match this package.');
  const current = await previewMigrationImport(pkg, target);
  if (current.blockers.length || migrationHash(current) !== migrationHash(plan)) throw new Error('Target changed after the preview; review migration again.');
  const completed: string[] = [];
  let failed = pkg.project;
  try {
    for (const change of plan.changes) {
      if (change.action === 'same') continue;
      failed = change.asset.data.name;
      await target.write(change.asset, change.expectedToken);
      const stored = await target.read(change.asset);
      if (!stored || migrationHash(stored.data) !== migrationHash(change.asset.data)) throw new Error('Stored definition does not match migration package: ' + change.asset.data.name);
      completed.push(change.asset.data.name);
    }
    failed = pkg.project;
    await target.finish(pkg.project, pkg.members, plan.projectToken);
    return { completed };
  } catch (error) { return { completed, failed, error: error instanceof Error ? error.message : String(error) }; }
}
