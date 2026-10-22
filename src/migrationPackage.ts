import { querySnapshot, queryView } from './changeReview/query.js';
import { checkedMenuMigration, menuMigrationSchema, type MenuMigrationData } from './providers/menuMigration.js';
import type { Json } from './changeReview/model.js';
import { validateQuerySaveShape } from './providers/queryWriter.js';
import type { ContentMigrationData, ContentMigrationRead } from './providers/contentMigration.js';
import { prepareHtmlText, contentTextRefusal } from './providers/htmlWriter.js';
import { prepareSourceForSave } from './peoplecode/writeback/savePlan.js';
import { pcmProgKeyParts, PEOPLECODE_OBJECTIDS } from './model/peopleCodeKeys.js';
import { packageAddress } from './model/appPackages.js';
import { checkedPageMigration, pageRequirements, type PageMigrationData } from './providers/pageMigration.js';
import { checkedComponentMigration, componentRequirements, type ComponentMigrationData } from './providers/componentMigration.js';
import { channelMigrationSchema, type ChannelMigrationData } from './providers/channelMigration.js';
import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { DefinitionType, makeKey, type DefinitionKey } from './model/definitions.js';
import type { FieldDefinition } from './model/fieldDefinition.js';
import { FieldType, RecordFlag, RecordType } from './model/record.js';
import type { RecordLayout } from './model/recordLayout.js';
import { EDITABLE_USE_BITS, EDITABLE_USE2_BITS, KNOWN_PAGE_CONTROLS, inMemoryMode, type RecordEditField, type RecordPropertyEdits, type RecordTypeEdits } from './model/recordEdit.js';
import type { AeDocument } from './model/aeDocument.js';
import { validateAppEngine } from './model/aeValidation.js';
import { peopleCodeKeyParts } from './model/appEngine.js';
import { projectKeyIdentity } from './projectCompare.js';
import type { DefinitionSummary } from './providers/provider.js';
import { prepareSqlText, SQL_TEXT_ROW_LIMIT, type SqlDefinitionData } from './model/sqlDefinition.js';
import { bindMarkerInComment } from './providers/sqlWriter.js';
import { checkTranslateItem } from './providers/translateWriter.js';
import { userIndexRefusal, type UserIndexRows } from './providers/recordWriter.js';
import { DEFAULT_FIELD_PROPERTIES, fieldPropertiesRefusal, type FieldProperties } from './providers/fieldWriter.js';
import type { TranslateValue } from './model/recordLayout.js';

export interface PortableRecord {
  name: string;
  recordType: RecordType;
  fields: Omit<RecordEditField, 'isNew'>[];
  properties: RecordPropertyEdits;
  type: RecordTypeEdits;
  /** SQL Table user-defined indexes (ix01), by INDEXID; absent when there are none. */
  indexes?: UserIndexRows[];
}
export type MigrationAsset =
  | { kind: 'field'; key: DefinitionKey; data: FieldDefinition }
  | { kind: 'record'; key: DefinitionKey; data: PortableRecord }
  | { kind: 'sql'; key: DefinitionKey; data: SqlDefinitionData }
  | { kind: 'ae'; key: DefinitionKey; data: AeDocument }
  | { kind: 'html'; key: DefinitionKey; data: ContentMigrationData }
  | { kind: 'stylesheet'; key: DefinitionKey; data: ContentMigrationData }
  | { kind: 'query'; key: DefinitionKey; data: { name: string; owner: string; view: Json } }
  | { kind: 'menu'; key: DefinitionKey; data: MenuMigrationData }
  | { kind: 'peoplecode'; key: DefinitionKey; data: { name: string; text: string } }
  | { kind: 'package'; key: DefinitionKey; data: PackageMigrationData }
  | { kind: 'page'; key: DefinitionKey; data: PageMigrationData }
  | { kind: 'component'; key: DefinitionKey; data: ComponentMigrationData }
  | { kind: 'channel'; key: DefinitionKey; data: ChannelMigrationData };
/**
 * An Application Package root, its subpackage paths ('SUB1', 'SUB1:SUB2') and the root's Package Properties when not
 * blank; its classes travel as PeopleCode assets.
 */
export interface PackageMigrationData { name: string; packages: string[]; description?: string; comments?: string; ownerId?: string }
export interface StudioMigrationPackage {
  format: 'psft-migration/1';
  project: string;
  toolsRelease: string;
  members: DefinitionKey[];
  assets: MigrationAsset[];
  requirements: DefinitionKey[];
  /** The exporting environment (database, container, schema, PeopleSoft GUID and release), when its reader records one. */
  source?: { environment: string };
  checksum: string;
}
export interface MigrationPackageReader {
  /** A digest of the database, container, schema, PeopleSoft GUID and release this reader reads (no address or credentials). */
  environmentFingerprint?(): Promise<string>;
  listProjectItems(project: string): Promise<DefinitionSummary[]>;
  readField(key: DefinitionKey): Promise<FieldDefinition | undefined>;
  readRecordLayout(key: DefinitionKey): Promise<RecordLayout | undefined>;
  readAppEngineDocument(name: string): Promise<{ doc: AeDocument; token: string } | undefined>;
  readEnvironment(): Promise<{ toolsRelease: string }>;
  readTranslates(fieldName: string): Promise<unknown[]>;
  readTranslatesForMigration?(fieldName: string): Promise<{ items: TranslateValue[] }>;
  readQueryForMigration?(key: DefinitionKey): Promise<{ data: { name:string; owner:string; view:Json }; token:string } | undefined>;
  readMenuForMigration?(name:string):Promise<{data:MenuMigrationData;token:string}|undefined>;
  readChannelForMigration?(name: string): Promise<{ data: ChannelMigrationData; token: string } | undefined>;
  readRecordPeopleCodeForMigration?(name: string): Promise<DefinitionKey[]>;
  readRecordIndexesForMigration?(name: string): Promise<UserIndexRows[]>;
  readContentForMigration?(key: DefinitionKey): Promise<ContentMigrationRead | undefined>;
  readPeopleCodeForEdit?(key: DefinitionKey): Promise<{ text: string; fingerprint: string } | undefined>;
  readSqlForMigration?(key: DefinitionKey): Promise<{ data: SqlDefinitionData; token: string; version: number } | undefined>;
  readPackageForMigration?(root: string): Promise<{ data: PackageMigrationData; classes: string[]; token: string; version: number } | undefined>;
  readPageForMigration?(name: string): Promise<{ data: PageMigrationData; token: string } | undefined>;
  readComponentForMigration?(name: string, market: string): Promise<{ data: ComponentMigrationData; token: string } | undefined>;
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

export function assetRequirements(asset: MigrationAsset): DefinitionKey[] {
  const keys: DefinitionKey[] = [];
  const record = (name: string | undefined) => { if (name) keys.push(makeKey(DefinitionType.Record, name)); };
  if (asset.kind === 'record') {
    for (const field of asset.data.fields) {
      if (field.isSubrecord) { record(field.name); continue; }
      keys.push(makeKey(DefinitionType.Field, field.name));
      record(field.editTable); record(field.defaultRecord);
    }
    for (const property of ['parentRecord', 'relatedLanguageRecord', 'querySecurityRecord', 'analyticDeleteRecord', 'auditRecord'] as const) record(asset.data.properties[property]);
  } else if (asset.kind === 'menu') {
    for (const bar of asset.data.bars) for (const item of bar.items) {
      if(item.component) keys.push(makeKey(DefinitionType.Component,item.component,item.market||'GBL'));
      record(item.searchRecord);
      if(item.transfer && !item.transfer.node) {
        if(item.transfer.menu && item.transfer.menu!==asset.data.name)keys.push(makeKey(DefinitionType.Menu,item.transfer.menu));
        if(item.transfer.component)keys.push(makeKey(DefinitionType.Component,item.transfer.component,item.transfer.market||'GBL'));
        if(item.transfer.page)keys.push(makeKey(DefinitionType.Page,item.transfer.page));
      }
    }
  } else if (asset.kind === 'query') {
    const view = queryView(asset.data.view);
    for (const name of new Set(view.records.map(row => String(row.RECNAME ?? '').trim()))) record(name);
    for (const row of view.binds) record(String(row.EDITTABLE ?? '').trim());
  } else if (asset.kind === 'peoplecode') {
    const p = pcmProgKeyParts(asset.key);
    if (asset.key.type === DefinitionType.RecordPeopleCode) { record(p[0]); keys.push(makeKey(DefinitionType.Field, p[1])); }
    else if (asset.key.type === DefinitionType.PagePeopleCode) keys.push(makeKey(DefinitionType.Page, p[0]));
    else if ([46, 47, 48].includes(asset.key.type)) { keys.push(makeKey(DefinitionType.Component, p[0], p[1])); if (p.length > 3) record(p[2]); if (p.length > 4) keys.push(makeKey(DefinitionType.Field, p[3])); }
    else if (asset.key.type === DefinitionType.ApplicationClassPeopleCode) keys.push(makeKey(DefinitionType.ApplicationPackage, p[0]));
    else if (asset.key.type === DefinitionType.MenuPeopleCode) keys.push(makeKey(DefinitionType.Menu, p[0]));
    else if (asset.key.type === DefinitionType.ComponentInterfacePeopleCode) keys.push(makeKey(DefinitionType.ComponentInterface, p[0]));
  } else if (asset.kind === 'channel') {
    for (const field of asset.data.partitions) keys.push(makeKey(DefinitionType.Field, field));
  } else if (asset.kind === 'page') {
    keys.push(...pageRequirements(asset.data));
  } else if (asset.kind === 'component') {
    keys.push(...componentRequirements(asset.data));
  } else if (asset.kind === 'ae') {
    for (const state of asset.data.stateRecords) record(state.record);
    for (const table of asset.data.tempTables) record(table);
    // SQL definitions the program names: SQL.NAME in its PeopleCode, %SQL(NAME) in its actions' SQL (not its own action SQL).
    const sql = new Set<string>();
    for (const section of asset.data.sections) for (const variant of section.variants) for (const step of variant.steps) for (const action of step.actions) {
      for (const m of (action.peopleCode ?? '').matchAll(/\bSQL\.([A-Za-z][A-Za-z0-9_]{0,29})\b/g)) sql.add(m[1].toUpperCase());
      for (const m of (action.text ?? '').matchAll(/%SQL\(\s*([A-Za-z][A-Za-z0-9_]{0,29})/gi)) sql.add(m[1].toUpperCase());
    }
    for (const name of sql) keys.push(makeKey(DefinitionType.SqlDefinition, name, '0'));
    for (const section of asset.data.sections) for (const variant of section.variants) for (const step of variant.steps) {
      if (step.actions.some(a => a.type === 'C') && !step.dynamic && step.doProgram) keys.push(makeKey(DefinitionType.AppEngineProgram, step.doProgram));
    }
  }
  return keys;
}

const translateOrder = (a: TranslateValue, b: TranslateValue) => a.value < b.value ? -1 : a.value > b.value ? 1 : a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0;
/** Stored PSDBFIELD properties with New Field's defaults for any a source does not carry. */
export function portableFieldProperties(field: FieldDefinition): FieldProperties {
  const d = DEFAULT_FIELD_PROPERTIES;
  return { format: field.format ?? d.format, formatFamily: field.formatFamily ?? d.formatFamily, displayName: field.displayName ?? d.displayName,
    formatLength: field.formatLength ?? d.formatLength, defaultCenturyYear: field.defaultCenturyYear ?? d.defaultCenturyYear, imeMode: field.imeMode ?? d.imeMode, ownerId: field.ownerId ?? d.ownerId };
}
export function portableField(field: FieldDefinition): FieldDefinition {
  if (field.notUsed || field.auxFlagMask || field.imageFormat || field.keyboardLayout) throw new Error(`${field.name}: Not Used, auxiliary flags, image format and keyboard layout are not supported by migration.`);
  const properties = portableFieldProperties(field), refusal = fieldPropertiesRefusal(field.type, field.length, properties);
  if (refusal) throw new Error(`${field.name}: ${refusal}`);
  // Character fields always state their format (package v1); other properties appear only when not New Field's default.
  const stated = Object.fromEntries(Object.entries(properties).filter(([k, v]) => k === 'format' ? field.type === FieldType.Character || v !== 0 : v !== DEFAULT_FIELD_PROPERTIES[k as keyof FieldProperties]));
  if (!field.labels.length || field.labels.filter(label => label.isDefault).length !== 1) throw new Error(`${field.name}: exactly one default label is required.`);
  const translates = [...field.translates ?? []].sort(translateOrder);
  for (const [i, item] of translates.entries()) {
    checkTranslateItem(item);
    if (i && !translateOrder(translates[i - 1], item)) throw new Error(`${field.name}: duplicate translate value ${item.value} effective ${item.effectiveDate}.`);
    if (field.type !== FieldType.Character || item.value.length > field.length) throw new Error(`${field.name}: translate value ${item.value} does not fit the field.`);
  }
  return {
    name: field.name, type: field.type, length: field.length, decimalPositions: field.decimalPositions,
    ...stated,
    description: field.description ?? '',
    labels: [...field.labels].sort((a, b) => a.id.localeCompare(b.id)),
    ...(translates.length ? { translates: translates.map(t => ({ value: t.value, effectiveDate: t.effectiveDate, status: t.status, longName: t.longName, shortName: t.shortName })) } : {})
  };
}

const PACKAGE_SEGMENT = /^[A-Za-z][A-Za-z0-9_]{0,29}$/;
/** Ordered, unique subpackage paths at most two deep, each under a listed parent (the writer's bound). */
export function checkedPackageMigration(data: PackageMigrationData): PackageMigrationData {
  if (!/^[A-Z0-9_]{1,30}$/.test(data.name)) throw new Error('Invalid Application Package root.');
  if (data.description !== undefined && (!data.description.trim() || data.description !== data.description.trimEnd())) throw new Error(data.name + ': package description must be unpadded text.');
  for (const [i, path] of data.packages.entries()) {
    const parts = path.split(':');
    if (parts.length > 2 || parts.some(p => !PACKAGE_SEGMENT.test(p))) throw new Error(data.name + ': invalid subpackage path ' + path + '.');
    if (i && data.packages[i - 1] >= path) throw new Error(data.name + ': subpackage paths must be unique and ordered.');
    if (parts.length === 2 && !data.packages.includes(parts[0])) throw new Error(data.name + ': subpackage ' + path + ' has no parent.');
  }
  return data;
}

export function portableRecord(layout: RecordLayout, includePeopleCode = false, indexes: readonly UserIndexRows[] = []): PortableRecord {
  if (![RecordType.Table, RecordType.DerivedWork, RecordType.Subrecord].includes(layout.recordType)) throw new Error(`${layout.name}: migration supports SQL Table, Derived/Work and SubRecord records.`);
  if (layout.recordType === RecordType.Subrecord && layout.fields.some(f => f.isSubrecord)) throw new Error(`${layout.name}: nested subrecords are not migrated yet.`);
  const userIds = indexes.map(ix => String(ix.index.INDEXID).trim());
  // An SQL Table's alternate search key indexes '0'-'9' follow from its fields' Alt Search Key settings: the target's record
  // writer derives them again (r55) and refuses a record whose stored ones were made by hand.
  const derivedAltKey = (id: string) => layout.recordType === RecordType.Table && /^[0-9]$/.test(id);
  // Oracle In-Memory (r65-r72) is the one auxiliary setting migration carries: the record writer sets it with its fields' marks.
  const aux = Number(layout.auxFlagMask || layout.properties?.auxFlagMask || 0), inMemoryBits = RecordFlag.InMemoryAllFields | RecordFlag.InMemorySelectiveFields;
  if (aux & ~inMemoryBits || (aux && layout.recordType !== RecordType.Table)) throw new Error(`${layout.name}: auxiliary flags other than Oracle In-Memory on an SQL Table are not supported by migration.`);
  if (layout.indexIds?.some(id => id !== '_' && !userIds.includes(id) && !derivedAltKey(id))) throw new Error(`${layout.name}: unread indexes are not supported by migration.`);
  if (indexes.length && layout.recordType !== RecordType.Table) throw new Error(`${layout.name}: only an SQL Table has user-defined indexes.`);
  if (layout.properties?.optTrigFlag && layout.properties.optTrigFlag !== 'N') throw new Error(`${layout.name}: unsupported record trigger setting.`);
  // Subrecord rows: as App Designer inserts them into a Derived/Work record (r53), carrying no settings of their own.
  const plainSubrecord = (field: RecordLayout['fields'][number]) => layout.recordType === RecordType.DerivedWork && !field.useEdit && !field.useEdit2
    && !field.editTable && !field.defaultRecord && !field.defaultField && !field.labelId && (field.defGuiControl ?? 99) === 99;
  if (layout.fields.some(field => field.isSubrecord && !plainSubrecord(field))) throw new Error(`${layout.name}: subrecords are migrated only in Derived/Work records, without row settings.`);
  if (layout.fields.some(field => !field.isSubrecord && field.hasPeopleCode && !includePeopleCode || field.setControlField
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
  if (aux) properties.inMemory = inMemoryMode(aux);
  return {
    name: layout.name, recordType: layout.recordType,
    fields: layout.fields.map(field => ({
      name: field.name, useEdit: field.useEdit, useEdit2: field.useEdit2 ?? 0, editTable: field.editTable,
      defaultRecord: field.defaultRecord, defaultField: field.defaultField, labelId: field.labelId ?? '',
      pageControl: field.defGuiControl ?? 99, ...(field.isSubrecord ? { isSubrecord: true } : {})
    })),
    properties, type: { recordType: layout.recordType, sqlTableName: layout.sqlTableName, buildSequence: layout.buildSequence ?? 1 },
    ...(indexes.length ? { indexes: indexes.map(ix => ({ index: { ...ix.index }, keys: ix.keys.map(k => ({ ...k })) })) } : {})
  };
}

const name = z.string().regex(/^[A-Z0-9_]{1,30}$/);
const keySchema = z.object({ type: z.number().int(), parts: z.array(z.string()).min(1).max(7) }).strict();
const labelSchema = z.object({ id: z.string().min(1), longName: z.string(), shortName: z.string(), isDefault: z.boolean() }).strict();
const fieldSchema = z.object({
  name, type: z.number().int(), length: z.number().int().nonnegative(), decimalPositions: z.number().int().nonnegative(),
  format: z.number().int().optional(), formatFamily: z.string().optional(), displayName: z.string().optional(), formatLength: z.number().int().optional(),
  defaultCenturyYear: z.number().int().optional(), imeMode: z.number().int().optional(), ownerId: z.string().optional(),
  description: z.string(), labels: z.array(labelSchema).min(1),
  translates: z.array(z.object({ value: z.string(), effectiveDate: z.string(), status: z.string(), longName: z.string(), shortName: z.string() }).strict()).min(1).max(10000).optional()
}).strict();
const propertySchema = z.object({
  description: z.string().optional(), definition: z.string().optional(), ownerId: z.string().optional(),
  setControlField: z.string().optional(), parentRecord: z.string().optional(), relatedLanguageRecord: z.string().optional(),
  querySecurityRecord: z.string().optional(), analyticDeleteRecord: z.string().optional(), auditRecord: z.string().optional(),
  systemIdField: z.string().optional(), timestampField: z.string().optional(), recUse: z.number().int().optional(),
  inMemory: z.enum(['all', 'selective']).optional()
}).strict();
const recordSchema = z.object({
  name, recordType: z.union([z.literal(0), z.literal(2), z.literal(3)]),
  fields: z.array(z.object({ name, useEdit: z.number().int(), useEdit2: z.number().int().optional(),
    editTable: z.string().optional(), defaultRecord: z.string().optional(), defaultField: z.string().optional(),
    labelId: z.string().optional(), pageControl: z.number().int().optional(), isSubrecord: z.literal(true).optional() }).strict()).min(1),
  properties: propertySchema,
  type: z.object({ recordType: z.union([z.literal(0), z.literal(2), z.literal(3)]), sqlTableName: z.string(), buildSequence: z.number().int() }).strict(),
  indexes: z.array(z.object({ index: z.record(z.string(), z.union([z.string(), z.number(), z.null()])), keys: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))) }).strict()).min(1).max(26).optional()
}).strict();
const aeSchema = z.custom<AeDocument>(value => {
  try { return !!value && typeof value === 'object' && validateAppEngine(value as AeDocument).every(d => d.severity !== 'error'); }
  catch { return false; }
}, 'Invalid App Engine document');
const textSchema = z.object({ name, text: z.string().max(4 * 1024 * 1024), description: z.string().max(30) }).strict();
const querySchema = z.custom<Json>(value => {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'binds,criteria,expressions,fields,query,records,selects') return false;
    const view=queryView(value as Json); validateQuerySaveShape(view);
    // Any shape the Query writer validates; the target's preview save compiles its SQL and applies the release gate.
    return migrationCanonical(querySnapshot(view))===migrationCanonical(value);
  } catch { return false; }
}, 'Unsupported Query migration snapshot');
const assetSchema = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('menu'),key:keySchema,data:menuMigrationSchema}).strict(),
  z.object({ kind: z.literal('channel'), key: keySchema, data: channelMigrationSchema }).strict(),
  z.object({ kind:z.literal('query'), key:keySchema, data:z.object({ name, owner:z.string().max(30), view:querySchema }).strict() }).strict(),
  z.object({ kind: z.literal('html'), key: keySchema, data: textSchema }).strict(),
  z.object({ kind: z.literal('stylesheet'), key: keySchema, data: textSchema }).strict(),
  z.object({ kind: z.literal('peoplecode'), key: keySchema, data: z.object({ name, text: z.string().min(1).max(4 * 1024 * 1024) }).strict() }).strict(),
  z.object({ kind: z.literal('field'), key: keySchema, data: fieldSchema }).strict(),
  z.object({ kind: z.literal('record'), key: keySchema, data: recordSchema }).strict(),
  z.object({ kind: z.literal('sql'), key: keySchema, data: z.object({ name, text: z.string().min(1).max(SQL_TEXT_ROW_LIMIT),
    description: z.string().max(30), definition: z.string(), ownerId: z.string().max(4) }).strict() }).strict(),
  z.object({ kind: z.literal('ae'), key: keySchema, data: aeSchema }).strict(),
  z.object({ kind: z.literal('package'), key: keySchema, data: z.object({ name, packages: z.array(z.string()).max(1000),
    description: z.string().min(1).max(30).optional(), comments: z.string().min(1).max(4000).optional(), ownerId: z.string().regex(/^[A-Z0-9_]{1,4}$/).optional() }).strict() }).strict(),
  z.object({ kind: z.literal('page'), key: keySchema, data: z.object({ name: z.string(), native: z.custom<PageMigrationData['native']>(v => !!v && typeof v === 'object') }).strict() }).strict(),
  z.object({ kind: z.literal('component'), key: keySchema, data: z.object({ name: z.string(), market: z.string(), tables: z.custom<ComponentMigrationData['tables']>(v => !!v && typeof v === 'object') }).strict() }).strict()
]);
const packageSchema = z.object({
  format: z.literal('psft-migration/1'), project: name, toolsRelease: z.string().regex(/^8\.\d{2}$/),
  members: z.array(keySchema).max(10000), assets: z.array(assetSchema).max(10000),
  requirements: z.array(keySchema).max(10000), source: z.object({ environment: z.string().regex(/^[0-9a-f]{64}$/) }).strict().optional(),
  checksum: z.string().regex(/^[0-9a-f]{64}$/)
}).strict();

export function parseMigrationPackage(text: string): StudioMigrationPackage {
  const parsed = packageSchema.parse(JSON.parse(text)) as StudioMigrationPackage;
  const { checksum, ...body } = parsed;
  if (migrationHash(body) !== checksum) throw new Error('Migration package checksum does not match its contents.');
  const seen = new Set<string>();
  for (const asset of parsed.assets) {
    const expectedType = { field: DefinitionType.Field, record: DefinitionType.Record, sql: DefinitionType.SqlDefinition, ae: DefinitionType.AppEngineProgram,
      html: DefinitionType.HtmlDefinition, stylesheet: DefinitionType.StyleSheet, query: DefinitionType.Query, menu:DefinitionType.Menu, peoplecode: asset.key.type,
      package: DefinitionType.ApplicationPackage, page: DefinitionType.Page, component: DefinitionType.Component, channel: DefinitionType.MessageChannel }[asset.kind];
    if (asset.kind === 'query') {
      const view=queryView(asset.data.view);
      if (asset.key.type!==DefinitionType.Query || asset.key.parts.length>2 || asset.data.name!==asset.key.parts[0] || asset.data.owner!==asset.data.owner.trim() || asset.data.owner!==(asset.key.parts[1]??'') || String(view.query.QRYNAME).trim()!==asset.data.name || String(view.query.OPRID).trim()!==asset.data.owner) throw new Error('Query migration identity does not match payload.');
    } else if (asset.kind === 'component') {
      if (asset.key.type !== DefinitionType.Component || asset.key.parts.length !== 2 || asset.key.parts[0] !== asset.data.name || asset.key.parts[1] !== asset.data.market) throw new Error('Component migration identity does not match payload.');
    } else if (asset.kind === 'peoplecode') {
      const parts = pcmProgKeyParts(asset.key), length = PEOPLECODE_OBJECTIDS[asset.key.type]?.length;
      if (asset.key.type === DefinitionType.AppEnginePeopleCode || (!length && asset.key.type !== DefinitionType.ApplicationClassPeopleCode)
        || (asset.key.type === DefinitionType.ApplicationClassPeopleCode ? parts.length < 3 || parts.length > 5 || parts.at(-1) !== 'OnExecute' : parts.length !== length)
        || parts.some(p => !p.trim()) || asset.data.name !== asset.key.parts[0]
        || prepareSourceForSave(asset.data.text) !== asset.data.text || !asset.data.text.trim()) throw new Error('Invalid standalone PeopleCode migration identity or source.');
    } else if (asset.key.type !== expectedType || asset.key.parts.length !== (['sql', 'html'].includes(asset.kind) ? 2 : 1)
      || (asset.kind === 'sql' && asset.key.parts[1] !== '0') || (asset.kind === 'html' && asset.key.parts[1] !== '4') || asset.key.parts[0] !== asset.data.name) throw new Error('Migration asset identity does not match its payload.');
    if (asset.kind === 'html' || asset.kind === 'stylesheet') {
      const refusal = contentTextRefusal(asset.data.text);
      if (refusal || prepareHtmlText(asset.data.text) !== asset.data.text || asset.data.description !== asset.data.description.trim()) throw new Error(refusal ?? 'Content migration requires native CRLF text and unpadded description.');
    }
    const id = projectKeyIdentity(asset.key);
    if (seen.has(id)) throw new Error('Duplicate migration asset.');
    seen.add(id);
    if (asset.kind === 'field' && migrationCanonical(portableField(asset.data)) !== migrationCanonical(asset.data)) throw new Error(asset.data.name + ': field payload is not canonical (ordered translate values and labels, only non-default properties).');
    if (asset.kind === 'menu') checkedMenuMigration(asset.data);
    if (asset.kind === 'package') checkedPackageMigration(asset.data);
    if (asset.kind === 'page') checkedPageMigration(asset.data);
    if (asset.kind === 'component') checkedComponentMigration(asset.data);
    if (asset.kind === 'sql') {
      if (asset.data.text !== prepareSqlText(asset.data.text)) throw new Error(asset.data.name + ': SQL text must use native CRLF/trailing-space normalization.');
      if (bindMarkerInComment(asset.data.text)) throw new Error(asset.data.name + ': a colon inside an SQL comment is refused by the SQL writer.');
      if (asset.data.description !== asset.data.description.trimEnd() || asset.data.ownerId !== asset.data.ownerId.trimEnd()) throw new Error('SQL metadata must omit storage padding.');
    }
    if (asset.kind === 'record') {
      if (asset.data.recordType !== asset.data.type.recordType) throw new Error('Record type mismatch.');
      const names = new Set<string>();
      if (asset.data.indexes) {
        const refusal = asset.data.recordType !== RecordType.Table ? 'only an SQL Table has user-defined indexes' : userIndexRefusal(asset.data.indexes, asset.data.fields.filter(f => !f.isSubrecord).map(f => f.name));
        if (refusal) throw new Error(asset.data.name + ': ' + refusal);
        if (asset.data.indexes.some((ix, i) => i && String(asset.data.indexes![i - 1].index.INDEXID) >= String(ix.index.INDEXID))) throw new Error(asset.data.name + ': user indexes must be in INDEXID order.');
      }
      for (const field of asset.data.fields) {
        if (names.has(field.name)) throw new Error('Duplicate record field.');
        names.add(field.name);
        if ((field.useEdit & ~EDITABLE_USE_BITS) !== 0 || ((field.useEdit2 ?? 0) & ~EDITABLE_USE2_BITS) !== 0
          || !KNOWN_PAGE_CONTROLS.includes(field.pageControl ?? 99)) throw new Error('Unsupported record field settings.');
        if (field.isSubrecord && (asset.data.recordType !== RecordType.DerivedWork || field.useEdit || field.useEdit2 || field.editTable || field.defaultRecord
          || field.defaultField || field.labelId || (field.pageControl ?? 99) !== 99)) throw new Error('Subrecord rows are migrated only in Derived/Work records, without row settings.');
      }
    }
  }
  for (const member of parsed.members) {
    if(member.type===DefinitionType.MenuPeopleCode) {
      const parent=parsed.assets.find(a=>a.kind==='menu'&&a.data.name===member.parts[0]);
      if(parent?.kind==='menu') {
        const item=parent.data.bars.find(b=>b.name===member.parts[1])?.items.find(i=>i.name===member.parts[2]);
        if(member.parts.length!==4||member.parts[3]!=='ItemSelected'||!item?.peopleCode)throw Error('Menu PeopleCode member is missing from its complete menu asset.');
        continue;
      }
    }
    if (member.type === DefinitionType.ApplicationPackage) {
      const { root, path } = packageAddress(member), asset = parsed.assets.find(a => a.kind === 'package' && a.data.name === root);
      if (asset?.kind !== 'package' || path.length && !asset.data.packages.includes(path.join(':'))) throw new Error('Package project member has no migration asset: ' + member.parts.join('.'));
      continue;
    }
    const parent = [DefinitionType.AppEngineSection, DefinitionType.AppEnginePeopleCode].includes(member.type)
      ? makeKey(DefinitionType.AppEngineProgram, member.parts[0]) : member.type === DefinitionType.HtmlDefinition ? makeKey(member.type, member.parts[0], '4') : member;
    if (!seen.has(projectKeyIdentity(parent))) throw new Error('Project member has no migration asset: ' + member.parts.join('.'));
    if ([DefinitionType.AppEngineSection, DefinitionType.AppEnginePeopleCode].includes(member.type)) {
      const asset = parsed.assets.find(a => a.kind === 'ae' && a.data.name === member.parts[0]);
      if (!asset || asset.kind !== 'ae') throw new Error('AE parent missing.');
      const keys = containedMemberKeys(asset);
      if (!keys.some(k => projectKeyIdentity(k) === projectKeyIdentity(member))) throw new Error('AE project member has no section or PeopleCode action in the package.');
    }
  }
  for (const asset of parsed.assets) if (asset.kind === 'peoplecode' && asset.key.type === DefinitionType.ApplicationClassPeopleCode) {
    const [root, ...rest] = pcmProgKeyParts(asset.key).slice(0, -1), pkg = parsed.assets.find(a => a.kind === 'package' && a.data.name === root);
    if (pkg?.kind === 'package' && rest.length > 1 && !pkg.data.packages.includes(rest.slice(0, -1).join(':'))) throw new Error('Class ' + [root, ...rest].join(':') + ' is outside its package asset.');
  }
  for(const asset of parsed.assets)if(asset.kind==='peoplecode'&&asset.key.type===DefinitionType.MenuPeopleCode&&parsed.assets.some(a=>a.kind==='menu'&&a.data.name===asset.key.parts[0]))throw Error('Menu and standalone ItemSelected assets overlap; include the program only in its menu.');
  const declared = new Set(parsed.requirements.map(projectKeyIdentity));
  for (const asset of parsed.assets) for (const dependency of assetRequirements(asset)) {
    const id = projectKeyIdentity(dependency);
    if (!seen.has(id) && !declared.has(id)) throw new Error('Required dependency was omitted from the package: ' + dependency.parts.join('.'));
  }
  return JSON.parse(migrationCanonical(parsed)) as StudioMigrationPackage;
}

/**
 * The project members an asset brings into being besides itself: an App Engine program's sections and PeopleCode
 * actions, a menu's ItemSelected programs, a package's subpackages (PSPACKAGEDEFN keys as projects list them).
 */
export function containedMemberKeys(asset: MigrationAsset): DefinitionKey[] {
  const keys: DefinitionKey[] = [];
  if (asset.kind === 'ae') for (const section of asset.data.sections) {
    keys.push(makeKey(DefinitionType.AppEngineSection, asset.data.name, section.name));
    for (const variant of section.variants) for (const step of variant.steps) {
      const parts = peopleCodeKeyParts(asset.data.name, section.name, variant, step.name);
      if (parts && step.actions.some(a => a.type === 'P')) keys.push(makeKey(DefinitionType.AppEnginePeopleCode, ...parts));
    }
  }
  if (asset.kind === 'menu') for (const bar of asset.data.bars) for (const item of bar.items) if (item.peopleCode) keys.push(makeKey(DefinitionType.MenuPeopleCode, asset.data.name, bar.name, item.name, 'ItemSelected'));
  if (asset.kind === 'package') {
    keys.push(makeKey(DefinitionType.ApplicationPackage, asset.data.name, asset.data.name, '.'));
    for (const path of asset.data.packages) {
      const segments = path.split(':');
      keys.push(makeKey(DefinitionType.ApplicationPackage, segments.at(-1)!, asset.data.name, segments.length === 1 ? ':' : segments.slice(0, -1).join(':')));
    }
  }
  return keys;
}

export async function exportMigrationPackage(source: MigrationPackageReader, project: string): Promise<StudioMigrationPackage> {
  const items = await source.listProjectItems(project);
  const assets = new Map<string, MigrationAsset>();
  const queue = [...items];
  for (const { key } of queue) {
    const type = [DefinitionType.AppEngineSection, DefinitionType.AppEnginePeopleCode].includes(key.type) ? DefinitionType.AppEngineProgram : key.type;
    if (type === DefinitionType.SqlDefinition && (key.parts.length > 2 || (key.parts[1] ?? '0') !== '0')) throw new Error('Only standalone SQLTYPE 0 definitions can be migrated.');
    const isCode = type !== DefinitionType.AppEnginePeopleCode && (type === DefinitionType.ApplicationClassPeopleCode || PEOPLECODE_OBJECTIDS[type] !== undefined);
    const assetKey = isCode ? makeKey(type, ...pcmProgKeyParts(key).slice(0, type === DefinitionType.ApplicationClassPeopleCode ? -1 : undefined))
      : makeKey(type, key.parts[0], ...(type === DefinitionType.SqlDefinition ? ['0'] : type === DefinitionType.HtmlDefinition ? ['4'] : type === DefinitionType.Query ? [key.parts[1]??''] : type === DefinitionType.Component ? [(key.parts[1] || 'GBL').trim()] : []));
    if (type === DefinitionType.HtmlDefinition && (key.parts.length > 2 || (key.parts[1] ?? '4') !== '4')) throw new Error('Only HTML CONTTYPE 4 can be migrated.');
    if (assets.has(projectKeyIdentity(assetKey))) continue;
    let asset: MigrationAsset;
    if (type === DefinitionType.ApplicationPackage) {
      const root = packageAddress(key).root, rootKey = makeKey(type, root);
      if (assets.has(projectKeyIdentity(rootKey))) continue;
      if (!source.readPackageForMigration) throw new Error('Source cannot read the complete Application Package scope.');
      const pkg = await source.readPackageForMigration(root);
      if (!pkg) throw new Error('Application Package not found: ' + root);
      // Every class is package content: its source travels even when the project lists only the package.
      queue.push(...pkg.classes.map(path => ({ key: makeKey(DefinitionType.ApplicationClassPeopleCode, root, ...path.split(':'), 'OnExecute') })));
      assets.set(projectKeyIdentity(rootKey), { kind: 'package', key: rootKey, data: pkg.data });
      continue;
    } else if (type === DefinitionType.Component) {
      if (!source.readComponentForMigration) throw new Error('Source cannot read the complete component scope.');
      const component = await source.readComponentForMigration(assetKey.parts[0], assetKey.parts[1]);
      if (!component) throw new Error('Component not found: ' + assetKey.parts.join('.'));
      asset = { kind: 'component', key: assetKey, data: component.data };
    } else if (type === DefinitionType.Page) {
      if (!source.readPageForMigration) throw new Error('Source cannot read the complete page scope.');
      const page = await source.readPageForMigration(assetKey.parts[0]);
      if (!page) throw new Error('Page not found: ' + assetKey.parts[0]);
      asset = { kind: 'page', key: assetKey, data: page.data };
    } else if (type === DefinitionType.MessageChannel) {
      if (!source.readChannelForMigration) throw new Error('Source cannot read the complete message channel scope.');
      const channel = await source.readChannelForMigration(assetKey.parts[0]);
      if (!channel) throw new Error('Message channel not found: ' + assetKey.parts[0]);
      asset = { kind: 'channel', key: assetKey, data: channel.data };
    } else if (type===DefinitionType.Menu) {
      if(!source.readMenuForMigration)throw Error('Source cannot read complete menu migration scope.');
      const menu=await source.readMenuForMigration(assetKey.parts[0]);if(!menu)throw Error('Menu not found: '+assetKey.parts[0]);
      asset={kind:'menu',key:assetKey,data:menu.data};
    } else if (type===DefinitionType.Query) {
      if (!source.readQueryForMigration) throw new Error('Source cannot read complete Query migration scope.');
      const query=await source.readQueryForMigration(assetKey);
      if (!query) throw new Error('Query not found: '+assetKey.parts.join('.'));
      asset={kind:'query',key:assetKey,data:query.data};
    } else if ([DefinitionType.HtmlDefinition, DefinitionType.StyleSheet].includes(type)) {
      if (!source.readContentForMigration) throw new Error('Source cannot read the complete content migration scope.');
      const content = await source.readContentForMigration(assetKey);
      if (!content) throw new Error('Text definition not found: ' + key.parts[0]);
      asset = { kind: type === DefinitionType.HtmlDefinition ? 'html' : 'stylesheet', key: assetKey, data: content.data };
    } else if (isCode) {
      if (!source.readPeopleCodeForEdit) throw new Error('Source cannot read authoritative stored PeopleCode.');
      const code = await source.readPeopleCodeForEdit(assetKey);
      if (!code) throw new Error('Authoritative PeopleCode source unavailable: ' + key.parts.join('.'));
      asset = { kind: 'peoplecode', key: assetKey, data: { name: assetKey.parts[0], text: prepareSourceForSave(code.text) } };
    } else if (type === DefinitionType.Field) {
      const field = await source.readField(assetKey);
      if (!field) throw new Error('Field not found: ' + key.parts[0]);
      let translates: TranslateValue[] = [];
      if (source.readTranslatesForMigration) translates = (await source.readTranslatesForMigration(field.name)).items;
      else if ((await source.readTranslates(field.name)).length) throw new Error(field.name + ': source cannot read the complete translate migration scope.');
      asset = { kind: 'field', key: assetKey, data: portableField({ ...field, translates }) };
    } else if (type === DefinitionType.Record) {
      const record = await source.readRecordLayout(assetKey);
      if (!record) throw new Error('Record not found: ' + key.parts[0]);
      if (record.fields.some(f => f.hasPeopleCode)) {
        if (!source.readRecordPeopleCodeForMigration) throw new Error(record.name + ': associated PeopleCode needs a complete native program listing.');
        const programs = await source.readRecordPeopleCodeForMigration(record.name);
        if (!programs.length || programs.some(k => k.type !== DefinitionType.RecordPeopleCode || k.parts[0] !== record.name) || record.fields.some(f=>f.hasPeopleCode && !programs.some(k=>k.parts[1]===f.name))) throw new Error('Incomplete associated Record PeopleCode listing.');
        queue.push(...programs.map(key => ({ key })));
      }
      const indexes = record.indexIds?.some(id => /^[A-Z]$/.test(id)) && source.readRecordIndexesForMigration ? await source.readRecordIndexesForMigration(record.name) : [];
      asset = { kind: 'record', key: assetKey, data: portableRecord(record, true, indexes) };
    } else if (type === DefinitionType.SqlDefinition) {
      if (!source.readSqlForMigration) throw new Error('Source cannot read complete standalone SQL migration metadata.');
      const sql = await source.readSqlForMigration(assetKey);
      if (!sql) throw new Error('SQL definition not found: ' + key.parts[0]);
      asset = { kind: 'sql', key: assetKey, data: sql.data };
    } else if (type === DefinitionType.AppEngineProgram) {
      const program = await source.readAppEngineDocument(key.parts[0]);
      if (!program) throw new Error('App Engine not found: ' + key.parts[0]);
      asset = { kind: 'ae', key: assetKey, data: JSON.parse(migrationCanonical(program.doc)) as AeDocument };
    } else throw new Error('No migration adapter for definition type ' + type + ': ' + key.parts.join('.'));
    assets.set(projectKeyIdentity(assetKey), asset);
  }
  for(const [id,asset]of assets)if(asset.kind==='peoplecode'&&asset.key.type===DefinitionType.MenuPeopleCode) {
    const parent=assets.get(projectKeyIdentity(makeKey(DefinitionType.Menu,asset.key.parts[0])));
    if(parent?.kind==='menu') {
      const item=parent.data.bars.find(b=>b.name===asset.key.parts[1])?.items.find(i=>i.name===asset.key.parts[2]);
      if(item?.peopleCode!==asset.data.text)throw Error('Menu source changed while exporting associated PeopleCode.');
      assets.delete(id);
    }
  }
  const requirements = new Map<string, DefinitionKey>();
  const require = (key: DefinitionKey) => { if (!assets.has(projectKeyIdentity(key))) requirements.set(projectKeyIdentity(key), key); };
  for (const asset of assets.values()) for (const key of assetRequirements(asset)) require(key);
  const body = { format: 'psft-migration/1' as const, project, toolsRelease: (await source.readEnvironment()).toolsRelease,
    members: items.map(item => item.key), assets: [...assets.values()], requirements: [...requirements.values()],
    ...(source.environmentFingerprint ? { source: { environment: await source.environmentFingerprint() } } : {}) };
  return parseMigrationPackage(JSON.stringify({ ...body, checksum: migrationHash(body) }));
}

export interface MigrationTarget {
  toolsRelease: string;
  identity?: string;
  readIdentity?(): Promise<string>;
  read(asset: MigrationAsset): Promise<{ data: MigrationAsset['data']; token: string } | undefined>;
  exists(key: DefinitionKey): Promise<boolean>;
  validate?(asset: MigrationAsset, expectedToken: string, assets: readonly MigrationAsset[]): Promise<string[]>;
  validateMembers?(members:readonly DefinitionKey[]):Promise<string[]>;
  projectToken?(project: string): Promise<string>;
  write(asset: MigrationAsset, expectedToken: string): Promise<void>;
  finish(project: string, members: DefinitionKey[], expectedToken?: string): Promise<void>;
}
export interface MigrationImportPlan {
  packageChecksum: string;
  targetIdentity?: string;
  changes: { asset: MigrationAsset; action: 'create' | 'update' | 'same'; expectedToken: string; before?: MigrationAsset['data'] }[];
  blockers: string[];
  projectToken?: string;
}
export async function previewMigrationImport(pkg: StudioMigrationPackage, target: MigrationTarget): Promise<MigrationImportPlan> {
  parseMigrationPackage(JSON.stringify(pkg));
  const plan: MigrationImportPlan = { packageChecksum: pkg.checksum, targetIdentity: await target.readIdentity?.() ?? target.identity, changes: [], blockers: [] };
  plan.projectToken = await target.projectToken?.(pkg.project);
  plan.blockers.push(...await target.validateMembers?.(pkg.members)??[]);
  if (target.toolsRelease !== pkg.toolsRelease) plan.blockers.push('Source and target PeopleTools release families differ.');
  for (const key of pkg.requirements) if (!await target.exists(key)) plan.blockers.push('Required definition missing: ' + key.parts.join('.'));
  const kinds=['field', 'channel', 'record', 'sql', 'html', 'stylesheet', 'ae', 'page', 'component', 'menu', 'package', 'peoplecode', 'query'];
  const pending = [...pkg.assets].sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
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
    plan.changes.push({ asset, action, expectedToken, ...(existing ? { before: existing.data } : {}) });
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
      const live = await target.read(change.asset);
      if ((live?.token ?? 'absent') !== change.expectedToken || migrationHash(live?.data ?? null) !== migrationHash(change.before ?? null)) {
        throw new Error(failed + ': target changed after preview; review migration again.');
      }
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

/** Validate a single durable review payload using the same closed package contract. */
export function checkedMigrationAsset(kind: MigrationAsset['kind'], key: DefinitionKey, data: unknown): MigrationAsset {
  const asset = { kind, key, data } as MigrationAsset;
  const body = { format: 'psft-migration/1', project: 'ZZ_REVIEW', toolsRelease: '8.62', members: [], assets: [asset], requirements: assetRequirements(asset) };
  return parseMigrationPackage(JSON.stringify({ ...body, checksum: migrationHash(body) })).assets[0];
}
