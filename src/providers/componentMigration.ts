import type { DbConnection as Connection, DbTypes } from '../db/connection.js';
import { canonical, hash, type Json } from '../changeReview/model.js';
import { DefinitionType, makeKey, type DefinitionKey } from '../model/definitions.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { ComponentSaveRefusedError } from './componentWriter.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { deletePrograms, moveCounters, nextCounters, programKeys, type ProposedDeletions } from './pageMigration.js';
import { writeScopeRefusal } from './writeScope.js';

/** Every table the component writer keeps (c01-c08b, i340); rows are the component's complete content. */
export const COMPONENT_TABLES = ['PSPNLGRPDEFN', 'PSPNLGROUP', 'PSPNLGRPDEFNEXT', 'PSPNLGRPSCRIPTS'] as const;
export type ComponentTable = typeof COMPONENT_TABLES[number];
/** Component-keyed content with no migration yet (translations, Performance Monitor): any row refuses export. */
export const COMPONENT_UNMIGRATED_TABLES = ['PSPNLGDEFNLANG', 'PSPNLGROUPLANG', 'PSPMPNLGRPDEFN'] as const;
type Row = Record<string, Json>;
/** Performance Monitor's table is keyed by component name alone. */
const where = (table: string) => table === 'PSPMPNLGRPDEFN' ? 'PNLGRPNAME = :n' : 'PNLGRPNAME = :n AND MARKET = :m';
const binds = (table: string, n: string, m: string) => table === 'PSPMPNLGRPDEFN' ? { n } : { n, m };
export interface ComponentMigrationData { name: string; market: string; tables: Record<ComponentTable, Row[]> }
const STAMPS = ['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID'];
const order = (a: Row, b: Row) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0;
const NAME = /^[A-Z][A-Z0-9_#@$]{0,17}$/, MARKET = /^[A-Z0-9]{3}$/;

async function readRows(c: Connection, types: DbTypes, name: string, market: string) {
  const tables = {} as Record<ComponentTable, Row[]>;
  let version: number | undefined;
  for (const table of COMPONENT_TABLES) {
    const columns = await c.catalog.columns(c, table);
    if (columns.some(col => /^(DATE|TIMESTAMP)/.test(col.dataType) && !(table === 'PSPNLGRPDEFN' && col.name === 'LASTUPDDTTM')))
      throw new ComponentSaveRefusedError(table + ' has date columns the migration does not carry.');
    const fetchInfo = Object.fromEntries(columns.filter(col => /CLOB/.test(col.dataType)).map(col => [col.name, { type: types.STRING }]));
    const rows = (await c.execute<Row>(`SELECT ${columns.filter(col => col.name !== 'LASTUPDDTTM').map(col => col.name).join(', ')} FROM ${table} WHERE PNLGRPNAME = :n AND MARKET = :m`,
      { n: name, m: market }, { outFormat: types.OUT_FORMAT_OBJECT, fetchInfo })).rows ?? [];
    if (table === 'PSPNLGRPDEFN') { if (rows.length > 1) throw new ComponentSaveRefusedError('Ambiguous component header.'); version = rows[0] ? Number(rows[0].VERSION) : undefined; }
    tables[table] = rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => table !== 'PSPNLGRPDEFN' || !STAMPS.includes(k)))).sort(order);
  }
  return { tables, version };
}

export async function readComponentForMigration(c: Connection, types: DbTypes, name: string, market: string): Promise<{ data: ComponentMigrationData; token: string } | undefined> {
  const { tables, version } = await readRows(c, types, name, market);
  if (version === undefined) {
    if (COMPONENT_TABLES.some(t => tables[t].length)) throw new ComponentSaveRefusedError(`${name}.${market}: orphan component rows.`);
    return undefined;
  }
  for (const table of COMPONENT_UNMIGRATED_TABLES) {
    const [{ N }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM ${table} WHERE ${where(table)}`, binds(table, name, market));
    if (Number(N)) throw new ComponentSaveRefusedError(`${name}.${market}: ${table} rows (translations or Performance Monitor) are not migrated yet.`);
  }
  const data = { name, market, tables };
  return { data, token: hash({ version, tables } as unknown as Json) };
}

export function checkedComponentMigration(data: ComponentMigrationData): ComponentMigrationData {
  if (!NAME.test(data.name) || !MARKET.test(data.market)) throw new Error('Invalid component migration identity.');
  if (!data.tables || Object.keys(data.tables).sort().join(',') !== [...COMPONENT_TABLES].sort().join(',')) throw new Error(data.name + ': incomplete component tables.');
  for (const table of COMPONENT_TABLES) {
    const rows = data.tables[table];
    if (!Array.isArray(rows) || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r) || r.PNLGRPNAME !== data.name || String(r.MARKET).trim() !== data.market))
      throw new Error(data.name + ': component rows must all belong to the component.');
    if (rows.some((r, i) => i && canonical(rows[i - 1]) >= canonical(r))) throw new Error(data.name + ': component rows must be unique and in canonical order.');
  }
  if (data.tables.PSPNLGRPDEFN.length !== 1 || STAMPS.some(k => k in data.tables.PSPNLGRPDEFN[0])) throw new Error(data.name + ': one component header without installation stamps is required.');
  return data;
}

export function componentRequirements(data: ComponentMigrationData): DefinitionKey[] {
  const keys: DefinitionKey[] = [], t = data.tables, head = t.PSPNLGRPDEFN[0];
  const text = (v: Json | undefined) => typeof v === 'string' ? v.trim() : '';
  const add = (type: DefinitionType, ...parts: string[]) => { if (parts.every(Boolean)) keys.push(makeKey(type, ...parts)); };
  const message = (set: Json | undefined, nbr: Json | undefined) => { if (Number(set) > 0) keys.push(makeKey(DefinitionType.MessageCatalog, String(Number(set)), String(Number(nbr)))); };
  for (const col of ['SEARCHRECNAME', 'ADDSRCHRECNAME']) add(DefinitionType.Record, text(head[col]));
  add(DefinitionType.Page, text(head.SEARCHPNLNAME));
  for (const [s, n] of [['ADDLINKMSGSET', 'ADDLINKMSGNUM'], ['SRCHLINKMSGSET', 'SRCHLINKMSGNUM'], ['SRCHTEXTMSGSET', 'SRCHTEXTMSGNUM']]) message(head[s], head[n]);
  for (const r of t.PSPNLGROUP) add(DefinitionType.Page, text(r.PNLNAME));
  for (const r of t.PSPNLGRPDEFNEXT) { add(DefinitionType.Record, text(r.PTCTXSEARCHRECNAME)); message(r.PTKEYWDSRCHMSGSET, r.PTKEYWDSRCHMSGNUM); message(r.PTRTSRCHLINKMSGSET, r.PTRTSRCHLINKMSGNUM); }
  for (const r of t.PSPNLGRPSCRIPTS) {
    if (text(r.PTSCRIPTTYPE) === 'CSS') add(DefinitionType.StyleSheet, text(r.PTSCRIPTNAME));
    else if (text(r.PTSCRIPTTYPE) === 'JS') add(DefinitionType.HtmlDefinition, text(r.PTSCRIPTNAME));
  }
  const seen = new Set<string>();
  return keys.filter(k => { const id = k.type + ':' + k.parts.join('.'); return !seen.has(id) && !!seen.add(id); });
}

/**
 * Writes a component from its complete rows. Creation follows App Designer's create (c01): PSPNLGRPDEFN at the new PGM
 * with the save's stamp; PSVERSION PGM/SYS and PSLOCK PGM + 1, no MDM. An existing component is replaced only when its
 * complete token is `expectedToken`: its rows are deleted and the package rows inserted, as App Designer's save
 * deletes and re-inserts every row, and MDM moves too (c02-c08b).
 */
export async function createComponentFromMigration(c: Connection, types: DbTypes, request: { data: ComponentMigrationData; operatorId: string; dryRun?: boolean; expectedToken?: string }) {
  const { data, operatorId } = request, { name, market } = data, replace = request.expectedToken !== undefined && request.expectedToken !== 'absent';
  try {
    checkedComponentMigration(data);
    const refusal = writeScopeRefusal(name) ?? validateOperatorId(operatorId);
    if (refusal) throw new ComponentSaveRefusedError(refusal);
    if (!(await operatorExists(c, operatorId))) throw new ComponentSaveRefusedError(`PeopleSoft operator ${operatorId} does not exist in this database (PSOPRDEFN).`);
    const kinds = replace ? ['PGM', 'MDM'] : ['PGM'];
    const v = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN ('SYS', ${kinds.map(k => `'${k}'`).join(', ')}) FOR UPDATE`);
    const l = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSLOCK WHERE OBJECTTYPENAME IN (${kinds.map(k => `'${k}'`).join(', ')}) FOR UPDATE`);
    const get = (rows: { T: string; V: number }[], t: string) => rows.find(r => String(r.T).trim() === t)?.V;
    if ([...kinds, 'SYS'].some(k => get(v, k) === undefined) || kinds.some(k => get(l, k) === undefined)) throw new ComponentSaveRefusedError(`PSVERSION ${kinds.join(' / ')} / SYS or their PSLOCK rows are missing; refusing to write.`);
    const version = Number(get(v, 'PGM')) + 1;
    const exists = (await select(c, `SELECT 1 FROM PSPNLGRPDEFN WHERE PNLGRPNAME = :n AND MARKET = :m FOR UPDATE`, { n: name, m: market })).length > 0;
    if (exists !== replace) throw new ComponentSaveRefusedError(exists ? `${name}.${market} exists; review its replacement.` : `${name}.${market} no longer exists here.`);
    // Creating a deleted name clears its PSPNLGRPDEL tombstone, as App Designer's save does (dl13).
    const tombstones = (await select(c, `SELECT 1 FROM PSPNLGRPDEL WHERE PNLGRPNAME = :n AND MARKET = :m FOR UPDATE`, { n: name, m: market })).length;
    if (tombstones && replace) throw new ComponentSaveRefusedError(`${name}.${market} has both rows and a PSPNLGRPDEL tombstone.`);
    if (tombstones) await expectRows(c, `DELETE FROM PSPNLGRPDEL WHERE PNLGRPNAME = :n AND MARKET = :m`, { n: name, m: market }, tombstones, 'Clearing PSPNLGRPDEL');
    for (const table of COMPONENT_UNMIGRATED_TABLES) {
      const [{ N }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM ${table} WHERE ${where(table)}`, binds(table, name, market));
      if (Number(N)) throw new ComponentSaveRefusedError(`${name}.${market}: ${table} rows exist here, which a migrated component would not replace.`);
    }
    if (replace) {
      const live = await readRows(c, types, name, market);
      if (hash({ version: live.version, tables: live.tables } as unknown as Json) !== request.expectedToken) throw new ComponentSaveRefusedError(`${name}.${market} changed since the migration was reviewed.`);
      for (const table of [...COMPONENT_TABLES].reverse()) await c.execute(`DELETE FROM ${table} WHERE PNLGRPNAME = :n AND MARKET = :m`, { n: name, m: market });
    } else for (const table of COMPONENT_TABLES) {
      const [{ N }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM ${table} WHERE PNLGRPNAME = :n AND MARKET = :m`, { n: name, m: market });
      if (Number(N)) throw new ComponentSaveRefusedError(`${name}.${market}: orphan ${table} rows exist here.`);
    }
    const [{ TS: ts }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    for (const table of COMPONENT_TABLES) {
      const columns = await c.catalog.columns(c, table), byName = new Map(columns.map(col => [col.name, col]));
      for (const source of data.tables[table]) {
        const row: Row = table === 'PSPNLGRPDEFN' ? { ...source, VERSION: version, LASTUPDOPRID: operatorId } : { ...source };
        const names = Object.keys(row);
        if (names.some(n => !byName.has(n)) || columns.some(col => !(col.name in row) && !(table === 'PSPNLGRPDEFN' && col.name === 'LASTUPDDTTM')))
          throw new ComponentSaveRefusedError(`${name}: ${table} columns differ between the package and this database.`);
        const binds: Record<string, unknown> = Object.fromEntries(names.map((n, i) => ['b' + i, /CLOB/.test(byName.get(n)!.dataType) && row[n] !== null ? { val: row[n], type: types.CLOB } : row[n]]));
        const stamp = table === 'PSPNLGRPDEFN';
        if (stamp) binds.ts = ts;
        await expectRows(c, `INSERT INTO ${table} (${names.join(', ')}${stamp ? ', LASTUPDDTTM' : ''}) VALUES (${names.map((_, i) => ':b' + i).join(', ')}${stamp ? `, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT})` : ''})`, binds, 1, `Inserting ${table}`);
      }
    }
    for (const k of [...kinds, 'SYS']) await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = :t`, { v: Number(get(v, k)) + 1, t: k }, 1, 'Updating PSVERSION ' + k);
    for (const k of kinds) await expectRows(c, `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = :t`, { v: Number(get(l, k)) + 1, t: k }, 1, 'Updating PSLOCK ' + k);
    const stored = await readRows(c, types, name, market);
    if (stored.version !== version || hash(stored.tables as unknown as Json) !== hash(data.tables as unknown as Json)) throw new ComponentSaveRefusedError(`${name}.${market} did not land as its package rows; rolled back.`);
    if (request.dryRun) await c.rollback(); else await c.commit();
    return { version };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/**
 * File > Delete of a component (dl02, dl07): its rows and component PeopleCode go; PSPNLGRPDEL at the new PGM; PGM/MDM/SYS
 * and locks PGM/MDM + 1, and with PeopleCode PCM + 1 with a PSPCMPROGDEL per program. Menus, pages, content references
 * and projects that still use it refuse, unless a rollback preview assumes the same inverse deletes them first.
 */
export async function deleteComponentForMigration(c: Connection, types: DbTypes, request: { name: string; market: string; operatorId: string; expectedToken: string; dryRun?: boolean; proposed?: ProposedDeletions }) {
  const { name, market, operatorId } = request, assumed = request.proposed ?? {};
  try {
    if (request.proposed && !request.dryRun) throw new ComponentSaveRefusedError('Proposed deletions are valid only in rollback preview.');
    const refusal = writeScopeRefusal(name) ?? validateOperatorId(operatorId);
    if (refusal) throw new ComponentSaveRefusedError(refusal);
    if (!(await operatorExists(c, operatorId))) throw new ComponentSaveRefusedError(`PeopleSoft operator ${operatorId} does not exist in this database (PSOPRDEFN).`);
    if (!(await select(c, `SELECT 1 FROM PSPNLGRPDEFN WHERE PNLGRPNAME = :n AND MARKET = :m FOR UPDATE`, { n: name, m: market })).length) throw new ComponentSaveRefusedError(`There is no component ${name}.${market}.`);
    const live = await readRows(c, types, name, market);
    if (hash({ version: live.version, tables: live.tables } as unknown as Json) !== request.expectedToken) throw new ComponentSaveRefusedError(`${name}.${market} changed since the deletion was reviewed.`);
    for (const table of COMPONENT_UNMIGRATED_TABLES) {
      const [{ N }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM ${table} WHERE ${where(table)}`, binds(table, name, market));
      if (Number(N)) throw new ComponentSaveRefusedError(`${name}.${market}: ${table} rows are outside this deletion.`);
    }
    const names = (rows: { N: string }[], allowed: readonly string[] = []) => rows.map(r => String(r.N).trim()).filter(n => !allowed.includes(n));
    const users = [
      ...names(await select<{ N: string }>(c, `SELECT DISTINCT MENUNAME AS N FROM PSMENUITEM WHERE PNLGRPNAME = :n AND MARKET = :m`, { n: name, m: market }), assumed.menus).map(n => 'menu ' + n),
      ...names(await select<{ N: string }>(c, `SELECT DISTINCT PNLNAME AS N FROM PSPNLFIELD WHERE GOTOPNLGRPNAME = :n AND GOTOMKTNAME = :m`, { n: name, m: market }), assumed.pages).map(n => 'page ' + n),
      ...names(await select<{ N: string }>(c, `SELECT DISTINCT PORTAL_NAME || '.' || PORTAL_OBJNAME AS N FROM PSPRSMDEFN WHERE PORTAL_URI_SEG2 = :n AND PORTAL_URI_SEG3 = :m`, { n: name, m: market })).map(n => 'content reference ' + n),
      ...names(await select<{ N: string }>(c, `SELECT DISTINCT PROJECTNAME AS N FROM PSPROJECTITEM WHERE OBJECTTYPE = 7 AND OBJECTVALUE1 = :n AND OBJECTVALUE2 = :m`, { n: name, m: market }), assumed.projects).map(n => 'project ' + n)
    ];
    if (users.length) throw new ComponentSaveRefusedError(`${name}.${market} is still used by ${users.slice(0, 5).join(', ')}.`);
    if ((await select(c, `SELECT 1 FROM PSPNLGRPDEL WHERE PNLGRPNAME = :n AND MARKET = :m`, { n: name, m: market })).length) throw new ComponentSaveRefusedError(`${name}.${market} already has a PSPNLGRPDEL tombstone.`);
    const programs = await programKeys(c, 10, name, ' AND OBJECTVALUE2 = :m', { m: market }), kinds = programs.length ? ['PGM', 'MDM', 'PCM'] : ['PGM', 'MDM'];
    const start = await nextCounters(c, kinds);
    for (const table of [...COMPONENT_TABLES].reverse()) await c.execute(`DELETE FROM ${table} WHERE PNLGRPNAME = :n AND MARKET = :m`, { n: name, m: market });
    await deletePrograms(c, programs, programs.map(() => start.version.PCM + 1));
    await expectRows(c, `INSERT INTO PSPNLGRPDEL (PNLGRPNAME, MARKET, VERSION) VALUES (:n, :m, :v)`, { n: name, m: market, v: start.version.PGM + 1 }, 1, 'Inserting PSPNLGRPDEL');
    await moveCounters(c, start, Object.fromEntries([...kinds, 'SYS'].map(k => [k, 1])));
    if ((await readRows(c, types, name, market)).version !== undefined) throw new ComponentSaveRefusedError(`${name}.${market} remains after the delete; rolled back.`);
    if (request.dryRun) await c.rollback(); else await c.commit();
    return { version: start.version.PGM + 1 };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}
