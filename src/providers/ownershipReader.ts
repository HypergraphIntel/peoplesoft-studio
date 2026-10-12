import type { DbConnection as Connection } from '../db/connection.js';
import { DefinitionType, isPeopleCode, type DefinitionKey } from '../model/definitions.js';
import { matchPrefix, type NamingPrefix, type OwnershipEvidence } from '../model/ownership.js';
import { pcmProgKeyParts, PEOPLECODE_OBJECTIDS, APPLICATION_CLASS_OBJECTID } from '../model/peopleCodeKeys.js';
import { projectItemFor } from '../model/projectItems.js';
import { select, TIMESTAMP_FORMAT, valueBinds, VALUE_PREDICATE } from './peopleCodeWriter.js';

/*
 * The evidence of who owns a definition (model/ownership.ts,
 * docs/CUSTOMIZATION.md), read from the database: the definition's stamp,
 * an Oracle-delivered project listing it, and -- when one was captured for
 * this application release -- a delivered baseline. A PeopleCode program not
 * yet stored is judged by the definition it belongs to (a record, component,
 * page ...): adding PeopleCode to a delivered record changes a delivered
 * definition. Also the baseline itself: captured from a vanilla demo
 * database, the definitions Oracle delivered, by kind.
 */

/** A definition type's row: its table and key columns, in the key's order. */
interface DefinitionRow { table: string; columns: string[]; values: (key: DefinitionKey) => string[]; extra?: string }

const DEFINITION_ROWS: Readonly<Partial<Record<DefinitionType, DefinitionRow>>> = {
  [DefinitionType.Record]: { table: 'PSRECDEFN', columns: ['RECNAME'], values: (k) => [k.parts[0]] },
  [DefinitionType.Field]: { table: 'PSDBFIELD', columns: ['FIELDNAME'], values: (k) => [k.parts[0]] },
  [DefinitionType.Page]: { table: 'PSPNLDEFN', columns: ['PNLNAME'], values: (k) => [k.parts[0]] },
  [DefinitionType.Component]: { table: 'PSPNLGRPDEFN', columns: ['PNLGRPNAME', 'MARKET'], values: (k) => [k.parts[0], k.parts[1] || 'GBL'] },
  [DefinitionType.Menu]: { table: 'PSMENUDEFN', columns: ['MENUNAME'], values: (k) => [k.parts[0]] },
  [DefinitionType.AppEngineProgram]: { table: 'PSAEAPPLDEFN', columns: ['AE_APPLID'], values: (k) => [k.parts[0]] },
  [DefinitionType.AppEngineSection]: { table: 'PSAEAPPLDEFN', columns: ['AE_APPLID'], values: (k) => [k.parts[0]] },
  [DefinitionType.SqlDefinition]: { table: 'PSSQLDEFN', columns: ['SQLID', 'SQLTYPE'], values: (k) => [k.parts[0], k.parts[1] ?? '0'] },
  [DefinitionType.HtmlDefinition]: { table: 'PSCONTDEFN', columns: ['CONTNAME'], values: (k) => [k.parts[0]], extra: 'CONTTYPE = 4' },
  [DefinitionType.StyleSheet]: { table: 'PSSTYLSHEETDEFN', columns: ['STYLESHEETNAME'], values: (k) => [k.parts[0]] },
  [DefinitionType.ComponentInterface]: { table: 'PSBCDEFN', columns: ['BCNAME'], values: (k) => [k.parts[0]] },
  [DefinitionType.MessageChannel]: { table: 'PSCHNLDEFN', columns: ['CHNLNAME'], values: (k) => [k.parts[0]] },
  [DefinitionType.IbMessage]: { table: 'PSMSGDEFN', columns: ['MSGNAME'], values: (k) => [k.parts[0]] }
};

/** The baseline kinds: a definition table, or PSPCMPROG for PeopleCode. */
export const BASELINE_KINDS = [...new Set(Object.values(DEFINITION_ROWS).map((r) => r!.table)), 'PSPCMPROG'];

/** The definition a not-yet-stored PeopleCode program belongs to. */
export function ownerOfPeopleCode(key: DefinitionKey): DefinitionKey | undefined {
  const p = key.parts;
  switch (key.type) {
    case DefinitionType.RecordPeopleCode: return { type: DefinitionType.Record, parts: [p[0]] };
    case DefinitionType.ComponentPeopleCode:
    case DefinitionType.ComponentRecordPeopleCode:
    case DefinitionType.ComponentRecordFieldPeopleCode: return { type: DefinitionType.Component, parts: [p[0], p[1] || 'GBL'] };
    case DefinitionType.PagePeopleCode: return { type: DefinitionType.Page, parts: [p[0]] };
    case DefinitionType.MenuPeopleCode: return { type: DefinitionType.Menu, parts: [p[0]] };
    case DefinitionType.AppEnginePeopleCode: return { type: DefinitionType.AppEngineProgram, parts: [p[0]] };
    case DefinitionType.ComponentInterfacePeopleCode: return { type: DefinitionType.ComponentInterface, parts: [p[0]] };
    default: return undefined;
  }
}

/** A PeopleCode program's baseline key: its non-zero OBJECTID=VALUE pairs. */
export function peopleCodeBaselineKey(row: Record<string, unknown>): string {
  const out: string[] = [];
  for (let n = 1; n <= 7; n++) {
    const id = Number(row[`OBJECTID${n}`]);
    if (id) out.push(`${id}=${String(row[`OBJECTVALUE${n}`] ?? '').trim()}`);
  }
  return out.join('|');
}

/** The application and tools release a database is at: a baseline applies only to its own application release. */
export interface DatabaseRelease { appRelease: string; toolsRelease: string; database: string }

export async function readRelease(c: Connection): Promise<DatabaseRelease> {
  const [rel] = await select<{ L: string }>(c, `SELECT RELEASELABEL AS L FROM PSRELEASE ORDER BY RELEASEDTTM DESC FETCH FIRST 1 ROWS ONLY`).catch(() => []);
  const [st] = await select<{ T: string; D: string }>(c, `SELECT TOOLSREL AS T, DBNAME AS D FROM PSSTATUS`).catch(async () =>
    select<{ T: string; D: string }>(c, `SELECT TOOLSREL AS T, ' ' AS D FROM PSSTATUS`));
  return { appRelease: String(rel?.L ?? '').trim(), toolsRelease: String(st?.T ?? '').trim(), database: String(st?.D ?? '').trim() };
}

/** A delivered baseline as stored: what Oracle delivered in one application release, by kind. */
export interface BaselineFile {
  format: 'psft-delivered-baseline/1';
  appRelease: string;
  toolsRelease: string;
  /** The database it was captured from (a vanilla demo). */
  capturedFrom: string;
  capturedAt: string;
  kinds: Record<string, string[]>;
}

export class BaselineIndex {
  private readonly sets = new Map<string, Set<string>>();
  constructor(readonly file: BaselineFile) {
    for (const [kind, names] of Object.entries(file.kinds)) this.sets.set(kind, new Set(names));
  }
  get label(): string { return `${this.file.appRelease} (PeopleTools ${this.file.toolsRelease}, from ${this.file.capturedFrom})`; }
  covers(kind: string): boolean { return this.sets.has(kind); }
  has(kind: string, value: string): boolean { return this.sets.get(kind)?.has(value) ?? false; }
}

/**
 * The delivered baseline of a vanilla demo database: every definition, by
 * kind, Oracle's operator saved last -- on an untouched demo that is all of
 * them. Read only.
 */
export async function captureBaseline(c: Connection, onProgress?: (what: string) => void): Promise<BaselineFile> {
  const release = await readRelease(c);
  const kinds: Record<string, string[]> = {};
  for (const [table, row] of new Map(Object.values(DEFINITION_ROWS).map((r) => [r!.table, r!]))) {
    onProgress?.(table);
    const cols = row.columns.join(` || '.' || `);
    const rows = await select<{ V: string }>(c, `SELECT DISTINCT ${cols} AS V FROM ${table} WHERE LASTUPDOPRID = 'PPLSOFT'${row.extra ? ` AND ${row.extra}` : ''}`);
    kinds[table] = rows.map((r) => String(r.V).replace(/\s+\./g, '.').trim()).sort();
  }
  onProgress?.('PSPCMPROG');
  const ids = [1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTID${n}, OBJECTVALUE${n}`).join(', ');
  const programs = await select<Record<string, unknown>>(c, `SELECT ${ids} FROM PSPCMPROG WHERE PROGSEQ = 0 AND LASTUPDOPRID = 'PPLSOFT'`);
  kinds.PSPCMPROG = programs.map(peopleCodeBaselineKey).sort();
  return {
    format: 'psft-delivered-baseline/1', appRelease: release.appRelease, toolsRelease: release.toolsRelease,
    capturedFrom: release.database || 'unknown database', capturedAt: new Date().toISOString(), kinds
  };
}

/**
 * The evidence for a definition: whether it is stored, its stamp, an
 * Oracle-delivered project listing it, the baseline's verdict, the prefix.
 * A PeopleCode program not stored yet is judged by its owner.
 */
export async function readOwnershipEvidence(c: Connection, key: DefinitionKey, prefixes: readonly NamingPrefix[], baseline?: BaselineIndex): Promise<OwnershipEvidence & { judgedBy?: DefinitionKey }> {
  if (isPeopleCode(key.type)) {
    const parts = pcmProgKeyParts(key);
    const first = key.type === DefinitionType.ApplicationClassPeopleCode ? APPLICATION_CLASS_OBJECTID : PEOPLECODE_OBJECTIDS[key.type]?.[0];
    const [row] = await select<Record<string, unknown>>(c,
      `SELECT ${[1, 2, 3, 4, 5, 6, 7].map((n) => `OBJECTID${n}, OBJECTVALUE${n}`).join(', ')}, LASTUPDOPRID, TO_CHAR(LASTUPDDTTM, ${TIMESTAMP_FORMAT}) AS LASTUPDDTTM
         FROM PSPCMPROG WHERE ${VALUE_PREDICATE} AND PROGSEQ = 0${first ? ` AND OBJECTID1 = ${first}` : ''}`, valueBinds(parts));
    if (!row) {
      const owner = ownerOfPeopleCode(key);
      if (!owner) return { exists: false };
      const ev = await readOwnershipEvidence(c, owner, prefixes, baseline);
      return { ...ev, judgedBy: owner };
    }
    return {
      exists: true, operator: String(row.LASTUPDOPRID ?? '').trim(), updated: String(row.LASTUPDDTTM ?? '').slice(0, 19),
      ...(baseline?.covers('PSPCMPROG') ? { baseline: { label: baseline.label, contains: baseline.has('PSPCMPROG', peopleCodeBaselineKey(row)) } } : {}),
      ...withPrefix(parts[0], prefixes),
      ...await deliveredProject(c, key, prefixes)
    };
  }
  const spec = DEFINITION_ROWS[key.type];
  if (!spec) return { exists: false };
  const values = spec.values(key);
  const binds = Object.fromEntries(values.map((v, i) => [`k${i}`, v]));
  const [row] = await select<{ OPRID: string; DTTM: string }>(c,
    `SELECT LASTUPDOPRID AS OPRID, TO_CHAR(LASTUPDDTTM, ${TIMESTAMP_FORMAT}) AS DTTM FROM ${spec.table}
      WHERE ${spec.columns.map((col, i) => `${col} = :k${i}`).join(' AND ')}${spec.extra ? ` AND ${spec.extra}` : ''} FETCH FIRST 1 ROWS ONLY`, binds);
  if (!row) return { exists: false };
  return {
    exists: true, operator: String(row.OPRID ?? '').trim(), updated: String(row.DTTM ?? '').slice(0, 19),
    ...(baseline?.covers(spec.table) ? { baseline: { label: baseline.label, contains: baseline.has(spec.table, values.join('.')) } } : {}),
    ...withPrefix(key.parts[0], prefixes),
    ...await deliveredProject(c, key, prefixes)
  };
}

function withPrefix(name: string, prefixes: readonly NamingPrefix[]): { prefix?: NamingPrefix } {
  const p = matchPrefix(name, prefixes);
  return p ? { prefix: p } : {};
}

/**
 * An Oracle-delivered project that lists the definition: stamped PPLSOFT, and
 * not named with a configured prefix (that is the organization's or a vendor's,
 * whoever stamped it).
 */
async function deliveredProject(c: Connection, key: DefinitionKey, prefixes: readonly NamingPrefix[]): Promise<{ deliveredProject?: string }> {
  let item;
  try { item = projectItemFor(key); } catch { return {}; }
  const binds: Record<string, unknown> = { t: item.objectType };
  const cond = item.objectValues.map((v, i) => { binds[`v${i}`] = v; return `I.OBJECTVALUE${i + 1} = :v${i}`; }).join(' AND ');
  const rows = await select<{ P: string }>(c,
    `SELECT DISTINCT I.PROJECTNAME AS P FROM PSPROJECTITEM I JOIN PSPROJECTDEFN D ON D.PROJECTNAME = I.PROJECTNAME
      WHERE D.LASTUPDOPRID = 'PPLSOFT' AND I.OBJECTTYPE = :t AND ${cond} FETCH FIRST 50 ROWS ONLY`, binds).catch(() => []);
  const oracle = rows.map((r) => String(r.P).trim()).find((p) => !matchPrefix(p, prefixes));
  return oracle ? { deliveredProject: oracle } : {};
}

/** Finds the delivered baseline for a database's release (the extension keeps them in its storage). */
export type BaselineResolver = (release: DatabaseRelease) => Promise<BaselineIndex | undefined>;

let resolver: BaselineResolver | undefined;
export function setBaselineResolver(r: BaselineResolver | undefined): void { resolver = r; }
export async function resolveBaseline(release: DatabaseRelease): Promise<BaselineIndex | undefined> {
  return resolver ? resolver(release) : undefined;
}
