import type { DbConnection as Connection, DbTypes } from '../db/connection.js';
import { canonical, hash, type Json } from '../changeReview/model.js';
import { DefinitionType, makeKey, type DefinitionKey } from '../model/definitions.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { nativePageSnapshot, readPageSnapshot, PAGE_SNAPSHOT_TABLES, type NativePageSnapshot, type PageRow } from './pageSnapshot.js';
import { counters, PAGE_NAME, PageSaveRefusedError } from './pageWriter.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { writeScopeRefusal } from './writeScope.js';

/** A page's complete native rows in the page writer's tables; installation stamps (VERSION, LASTUPD*) excluded. */
export interface PageMigrationData { name: string; native: NativePageSnapshot }

/** Page-keyed tables that hold page content the migration cannot carry yet: any row refuses export. */
export const PAGE_UNMIGRATED_TABLES = ['PSPNLACTIVEX', 'PSPNLBTNLANG', 'PSPNLCTLDATALNG', 'PSPNLDEFNLANG', 'PSPNLFIELDLANG', 'PSPTPNLRAWIDGET'] as const;

export async function readPageForMigration(c: Connection, types: DbTypes, name: string): Promise<{ data: PageMigrationData; token: string } | undefined> {
  if (!(await select(c, `SELECT 1 FROM PSPNLDEFN WHERE PNLNAME = :n`, { n: name })).length) return undefined;
  for (const table of PAGE_UNMIGRATED_TABLES) {
    const [{ N }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM ${table} WHERE PNLNAME = :n`, { n: name });
    if (Number(N)) throw new PageSaveRefusedError(`${name}: ${table} rows (translations, ActiveX or rich-text widgets) are not migrated yet.`);
  }
  const read = await readPageSnapshot(c, types, name);
  return { data: { name, native: read.value }, token: read.token };
}

export function checkedPageMigration(data: PageMigrationData): PageMigrationData {
  if (!PAGE_NAME.test(data.name)) throw new Error('Invalid page migration name.');
  const native = nativePageSnapshot(data.native);
  if (native.tables.PSPNLDEFN.length !== 1 || PAGE_SNAPSHOT_TABLES.some(t => native.tables[t].some(r => typeof r.PNLNAME !== 'string' || r.PNLNAME.trim() !== data.name)))
    throw new Error(data.name + ': page rows must all belong to the page.');
  if (Object.keys(native.tables.PSPNLDEFN[0]).some(k => ['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID'].includes(k))) throw new Error(data.name + ': page payload carries installation stamps.');
  const sorted = (rows: PageRow[]) => rows.every((r, i) => !i || canonical(rows[i - 1]) < canonical(r));
  if (PAGE_SNAPSHOT_TABLES.some(t => !sorted(native.tables[t]))) throw new Error(data.name + ': page rows must be unique and in canonical order.');
  return data;
}

/** Definitions the page's controls name. Labels, style classes, format families and portal/node targets are not checked. */
export function pageRequirements(data: PageMigrationData): DefinitionKey[] {
  const keys: DefinitionKey[] = [], t = data.native.tables;
  const text = (v: Json | undefined) => typeof v === 'string' ? v.trim() : '';
  const num = (v: Json | undefined) => typeof v === 'number' ? v : Number(v ?? 0);
  const add = (type: DefinitionType, ...parts: string[]) => { if (parts.every(Boolean)) keys.push(makeKey(type, ...parts)); };
  const message = (set: Json | undefined, nbr: Json | undefined) => { if (num(set) > 0) keys.push(makeKey(DefinitionType.MessageCatalog, String(num(set)), String(num(nbr)))); };
  for (const r of t.PSPNLDEFN) { add(DefinitionType.StyleSheet, text(r.STYLESHEETNAME)); add(DefinitionType.StyleSheet, text(r.FFSTYLESHEETNAME)); add(DefinitionType.Menu, text(r.POPUPMENU)); }
  for (const r of t.PSPNLFIELD) {
    add(DefinitionType.Record, text(r.RECNAME));
    if (text(r.RECNAME)) add(DefinitionType.Field, text(r.FIELDNAME));
    add(DefinitionType.Page, text(r.SUBPNLNAME)); add(DefinitionType.Page, text(r.GOTOPNLNAME)); add(DefinitionType.Menu, text(r.POPUPMENU));
    add(DefinitionType.Menu, text(r.GOTOMENUNAME)); add(DefinitionType.Component, text(r.GOTOPNLGRPNAME), text(r.GOTOMKTNAME));
    add(DefinitionType.UrlDefinition, text(r.URL_ID)); add(DefinitionType.ProcessDefinition, text(r.PRCSTYPE), text(r.PRCSNAME));
    for (const c of ['CONTNAME', 'CONTNAMEOVER', 'CONTNAMEDISABLE', 'PTLBLIMGCOLLAPSE', 'PTLBLIMGEXPAND']) add(DefinitionType.Image, text(r[c]));
    message(r.GRDLBLMSGSET, r.GRDLBLMSGNUM);
  }
  for (const r of t.PSPNLBTNDATA) {
    for (const c of ['CONTNAME', 'CONTNAMEOVER', 'CONTNAMEDISABLE']) add(DefinitionType.Image, text(r[c]));
    message(r.MSGSET, r.MSGNUM); message(r.PTBTNMSGSET2, r.PTBTNMSGNUM2);
  }
  for (const r of t.PSPNLFIELDEXT) { add(DefinitionType.Page, text(r.PTPOPUPPNL)); message(r.MESSAGE_SET_NBR, r.MESSAGE_NBR); message(r.PLH_MSG_SET_NBR, r.PLH_MSG_NBR); }
  for (const r of t.PSPNLCNTRLDATA) message(r.PTSMRYMSGSET, r.PTSMRYMSGNUM);
  const seen = new Set<string>();
  return keys.filter(k => k.type !== DefinitionType.Page || k.parts[0] !== data.name).filter(k => { const id = k.type + ':' + k.parts.join('.'); return !seen.has(id) && !!seen.add(id); });
}

/**
 * Writes a page from its complete rows, as App Designer's page copy writes them (n02: rows verbatim but for the page's
 * name, version and stamp): PSPNLDEFN at the new PDM, PDM/SYS/lock PDM +1. An existing page is replaced only when its
 * complete token is `expectedToken`: every row in the page writer's tables is deleted and the package rows inserted, as
 * an App Designer page save deletes and re-inserts them.
 */
export async function createPageFromMigration(c: Connection, types: DbTypes, request: { data: PageMigrationData; operatorId: string; dryRun?: boolean; expectedToken?: string }) {
  const { data, operatorId } = request, name = data.name, replace = request.expectedToken !== undefined && request.expectedToken !== 'absent';
  try {
    checkedPageMigration(data);
    const scope = writeScopeRefusal(name) ?? validateOperatorId(operatorId);
    if (scope) throw new PageSaveRefusedError(scope);
    if (!(await operatorExists(c, operatorId))) throw new PageSaveRefusedError(`PeopleSoft operator ${operatorId} does not exist in this database (PSOPRDEFN).`);
    const next = await counters(c, true);
    const exists = (await select(c, `SELECT 1 FROM PSPNLDEFN WHERE PNLNAME = :n FOR UPDATE`, { n: name })).length > 0;
    if (exists !== replace) throw new PageSaveRefusedError(exists ? `There is already a page named ${name}; review its replacement.` : `${name} no longer exists here.`);
    // Creating a deleted name clears its PSPNLDEL tombstone, as App Designer's save does (dl12).
    const tombstones = (await select(c, `SELECT 1 FROM PSPNLDEL WHERE PNLNAME = :n FOR UPDATE`, { n: name })).length;
    if (tombstones && replace) throw new PageSaveRefusedError(`${name} has both rows and a PSPNLDEL tombstone.`);
    if (tombstones) await expectRows(c, `DELETE FROM PSPNLDEL WHERE PNLNAME = :n`, { n: name }, tombstones, 'Clearing PSPNLDEL');
    for (const table of PAGE_UNMIGRATED_TABLES) {
      const [{ N }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM ${table} WHERE PNLNAME = :n`, { n: name });
      if (Number(N)) throw new PageSaveRefusedError(`${name}: ${table} rows exist here, which a migrated page would not replace.`);
    }
    if (replace) {
      if ((await readPageSnapshot(c, types, name)).token !== request.expectedToken) throw new PageSaveRefusedError(`${name} changed since the migration was reviewed.`);
      for (const table of [...PAGE_SNAPSHOT_TABLES].reverse()) await c.execute(`DELETE FROM ${table} WHERE PNLNAME = :n`, { n: name });
    } else for (const table of PAGE_SNAPSHOT_TABLES) {
      const [{ N }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM ${table} WHERE PNLNAME = :n`, { n: name });
      if (Number(N)) throw new PageSaveRefusedError(`${name}: orphan ${table} rows exist here.`);
    }
    const [{ TS: ts }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    const version = next.pdm + 1;
    for (const table of PAGE_SNAPSHOT_TABLES) {
      const columns = await c.catalog.columns(c, table), byName = new Map(columns.map(col => [col.name, col]));
      for (const source of data.native.tables[table]) {
        const row: Record<string, Json> = table === 'PSPNLDEFN' ? { ...source, VERSION: version, LASTUPDOPRID: operatorId } : { ...source };
        const names = Object.keys(row);
        if (names.some(n => !byName.has(n)) || columns.some(col => !(col.name in row) && !(table === 'PSPNLDEFN' && col.name === 'LASTUPDDTTM')))
          throw new PageSaveRefusedError(`${name}: ${table} columns differ between the package and this database.`);
        const binds: Record<string, unknown> = { ts };
        const values = names.map((n, i) => {
          const col = byName.get(n)!;
          if (/^(DATE|TIMESTAMP)/.test(col.dataType)) throw new PageSaveRefusedError(`${name}: ${table}.${n} is a date column the migration does not carry.`);
          binds['b' + i] = /CLOB/.test(col.dataType) && row[n] !== null ? { val: row[n], type: types.CLOB } : row[n];
          return ':b' + i;
        });
        const stamp = table === 'PSPNLDEFN' ? [', LASTUPDDTTM', `, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT})`] : ['', ''];
        if (!stamp[0]) delete binds.ts;
        await expectRows(c, `INSERT INTO ${table} (${names.join(', ')}${stamp[0]}) VALUES (${values.join(', ')}${stamp[1]})`, binds, 1, `Inserting ${table}`);
      }
    }
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'PDM'`, { v: version }, 1, 'Updating PSVERSION PDM');
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: next.sys + 1 }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'PDM'`, { v: next.lockPdm + 1 }, 1, 'Updating PSLOCK PDM');
    const stored = await readPageSnapshot(c, types, name);
    if (stored.version !== version || stored.hash !== hash(data.native as unknown as Json)) throw new PageSaveRefusedError(`${name} did not land as its package rows; rolled back.`);
    if (request.dryRun) await c.rollback(); else await c.commit();
    return { version };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/** Same-inverse deletions a rollback preview may assume; application always sees the real rows. */
export interface ProposedDeletions { projects?: readonly string[]; pages?: readonly string[]; components?: readonly (readonly [string, string])[]; menus?: readonly string[]; records?: readonly string[] }

/** PeopleCode program keys (PROGSEQ 0 rows) under OBJECTID1 = id, OBJECTVALUE1 = name, with any extra key predicate. */
export async function programKeys(c: Connection, id: number, name: string, extra = '', binds: Record<string, unknown> = {}) {
  return select<Record<string, unknown>>(c, `SELECT ${[1, 2, 3, 4, 5, 6, 7].flatMap(n => ['OBJECTID' + n, 'OBJECTVALUE' + n]).join(', ')} FROM PSPCMPROG
    WHERE OBJECTID1 = :id AND OBJECTVALUE1 = :n AND PROGSEQ = 0${extra}`, { id, n: name, ...binds });
}
/** Deletes each program's PSPCMPROG/PSPCMTXT/PSPCMNAME rows and records PSPCMPROGDEL at the given PCM versions, in order. */
export async function deletePrograms(c: Connection, keys: readonly Record<string, unknown>[], versions: readonly number[]) {
  for (const [i, key] of keys.entries()) {
    const cols = [1, 2, 3, 4, 5, 6, 7].flatMap(n => ['OBJECTID' + n, 'OBJECTVALUE' + n]), where = cols.map((col, j) => `${col} = :k${j}`).join(' AND ');
    const binds = Object.fromEntries(cols.map((col, j) => ['k' + j, key[col]]));
    for (const table of ['PSPCMTXT', 'PSPCMNAME', 'PSPCMPROG']) await c.execute(`DELETE FROM ${table} WHERE ${where}`, binds);
    await c.execute(`DELETE FROM PSPCMPROGDEL WHERE ${where}`, binds);
    await expectRows(c, `INSERT INTO PSPCMPROGDEL (${cols.join(', ')}, VERSION) VALUES (${cols.map((_, j) => ':k' + j).join(', ')}, :v)`, { ...binds, v: versions[i] }, 1, 'Inserting PSPCMPROGDEL');
  }
}
/** Locks PSVERSION/PSLOCK rows for the types and returns their next values (SYS has no PSLOCK row). */
export async function nextCounters(c: Connection, types: readonly string[]) {
  const list = types.map(t => `'${t}'`).join(', ');
  const v = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN ('SYS', ${list}) FOR UPDATE`);
  const l = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSLOCK WHERE OBJECTTYPENAME IN (${list}) FOR UPDATE`);
  const get = (rows: { T: string; V: number }[], t: string) => { const r = rows.find(x => String(x.T).trim() === t); if (!r) throw new Error(`PSVERSION / PSLOCK ${t} is missing; refusing to write.`); return Number(r.V); };
  return { version: Object.fromEntries(['SYS', ...types].map(t => [t, get(v, t)])), lock: Object.fromEntries(types.map(t => [t, get(l, t)])) };
}
/** Moves each counter by its delta (SYS in PSVERSION only). */
export async function moveCounters(c: Connection, start: Awaited<ReturnType<typeof nextCounters>>, delta: Record<string, number>) {
  for (const [t, d] of Object.entries(delta)) {
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = :t`, { v: start.version[t] + d, t }, 1, 'Updating PSVERSION ' + t);
    if (t !== 'SYS') await expectRows(c, `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = :t`, { v: start.lock[t] + d, t }, 1, 'Updating PSLOCK ' + t);
  }
}
const excluded = (rows: { N: string }[], allowed: readonly string[] = []) => rows.map(r => String(r.N).trim()).filter(n => !allowed.includes(n));

/**
 * File > Delete of a page (dl01, dl06): every row in the page writer's tables and the page's PeopleCode go; PSPNLDEL at
 * the new PDM; PDM/SYS and lock PDM + 1, and with PeopleCode PCM + 1 with a PSPCMPROGDEL per program. Pages, components
 * or projects that still use the page refuse, unless a rollback preview assumes the same inverse deletes them first.
 */
export async function deletePageForMigration(c: Connection, types: DbTypes, request: { name: string; operatorId: string; expectedToken: string; dryRun?: boolean; proposed?: ProposedDeletions }) {
  const { name, operatorId } = request, assumed = request.proposed ?? {};
  try {
    if (request.proposed && !request.dryRun) throw new PageSaveRefusedError('Proposed deletions are valid only in rollback preview.');
    const refusal = writeScopeRefusal(name) ?? validateOperatorId(operatorId);
    if (refusal) throw new PageSaveRefusedError(refusal);
    if (!(await operatorExists(c, operatorId))) throw new PageSaveRefusedError(`PeopleSoft operator ${operatorId} does not exist in this database (PSOPRDEFN).`);
    if (!(await select(c, `SELECT 1 FROM PSPNLDEFN WHERE PNLNAME = :n FOR UPDATE`, { n: name })).length) throw new PageSaveRefusedError(`There is no page ${name}.`);
    if ((await readPageSnapshot(c, types, name)).token !== request.expectedToken) throw new PageSaveRefusedError(`${name} changed since the deletion was reviewed.`);
    for (const table of PAGE_UNMIGRATED_TABLES) {
      const [{ N }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM ${table} WHERE PNLNAME = :n`, { n: name });
      if (Number(N)) throw new PageSaveRefusedError(`${name}: ${table} rows are outside this deletion.`);
    }
    const users = [
      ...excluded(await select<{ N: string }>(c, `SELECT DISTINCT PNLGRPNAME || '.' || MARKET AS N FROM PSPNLGROUP WHERE PNLNAME = :n`, { n: name }), (assumed.components ?? []).map(([g, m]) => g + '.' + m)).map(n => 'component ' + n),
      ...excluded(await select<{ N: string }>(c, `SELECT DISTINCT PNLGRPNAME || '.' || MARKET AS N FROM PSPNLGRPDEFN WHERE SEARCHPNLNAME = :n`, { n: name }), (assumed.components ?? []).map(([g, m]) => g + '.' + m)).map(n => 'search page of ' + n),
      ...excluded(await select<{ N: string }>(c, `SELECT DISTINCT PNLNAME AS N FROM PSPNLFIELD WHERE (SUBPNLNAME = :n OR GOTOPNLNAME = :n) AND PNLNAME <> :n
        UNION SELECT DISTINCT PNLNAME AS N FROM PSPNLFIELDEXT WHERE PTPOPUPPNL = :n AND PNLNAME <> :n`, { n: name }), assumed.pages).map(n => 'page ' + n),
      ...excluded(await select<{ N: string }>(c, `SELECT DISTINCT PROJECTNAME AS N FROM PSPROJECTITEM WHERE OBJECTTYPE = 5 AND OBJECTVALUE1 = :n`, { n: name }), assumed.projects).map(n => 'project ' + n)
    ];
    if (users.length) throw new PageSaveRefusedError(`${name} is still used by ${users.slice(0, 5).join(', ')}.`);
    if ((await select(c, `SELECT 1 FROM PSPNLDEL WHERE PNLNAME = :n`, { n: name })).length) throw new PageSaveRefusedError(`${name} already has a PSPNLDEL tombstone.`);
    const programs = await programKeys(c, 9, name), kinds = programs.length ? ['PDM', 'PCM'] : ['PDM'];
    const start = await nextCounters(c, kinds);
    for (const table of [...PAGE_SNAPSHOT_TABLES].reverse()) await c.execute(`DELETE FROM ${table} WHERE PNLNAME = :n`, { n: name });
    await deletePrograms(c, programs, programs.map(() => start.version.PCM + 1));
    await expectRows(c, `INSERT INTO PSPNLDEL (PNLNAME, VERSION) VALUES (:n, :v)`, { n: name, v: start.version.PDM + 1 }, 1, 'Inserting PSPNLDEL');
    await moveCounters(c, start, Object.fromEntries([...kinds, 'SYS'].map(k => [k, 1])));
    for (const table of PAGE_SNAPSHOT_TABLES) {
      const [{ N }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM ${table} WHERE PNLNAME = :n`, { n: name });
      if (Number(N)) throw new PageSaveRefusedError(`${name}: ${table} rows remain after the delete; rolled back.`);
    }
    if (request.dryRun) await c.rollback(); else await c.commit();
    return { version: start.version.PDM + 1 };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}
