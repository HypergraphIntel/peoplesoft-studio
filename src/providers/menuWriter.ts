import { createHash } from 'node:crypto';
import type { DbConnection as Connection, DbTypes } from '../db/connection.js';
import {
  documentFromRows, MENU_PC_EVENT, MENU_PC_IDS, menuPeopleCodeKey, pcKeyOf, rowsFromDocument, type MenuDesiredRows, type MenuDocument, type MenuRows, type Row
} from '../model/menuDocument.js';
import { validateMenu } from '../model/menuSession.js';
import {
  checkStoredProgram, compileForSave, expectedProgram, planProgram, prepareSourceForSave, SaveRefusedError, storedText,
  validateOperatorId, type CompileTarget, type StoredProgram
} from '../peoplecode/writeback/savePlan.js';
import {
  deletePcTombstone, deletePeopleCode, insertPeopleCode, insertStatement, PC_EXACT, PC_KEY_COLUMNS, pcBinds, run, type Statement
} from './appEngineWriter.js';
import { operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { writeScopeRefusal } from './writeScope.js';
import { checkMenuMigrationUpdate, checkedMenuMigration, readMenuMigration } from './menuMigration.js';

/*
 * Saving a menu as App Designer's Menu Designer does (docs/MENUS.md).
 *
 * planMenuSave compares the menu as stored with the document and returns the
 * statements that make the one the other: PSMENUDEFN updated (changed
 * columns, then VERSION and the stamp), PSMENUITEM / PSXFERITEM / language
 * and origin rows inserted, updated and deleted by key, the items'
 * ItemSelected PeopleCode compiled as the PeopleCode writer compiles it and
 * moved with renamed items, tombstones written and removed, a group's order
 * and separator written to every menu of the group, permission-list items
 * (PSAUTHITEM) following renamed and deleted items, and the counters moved
 * as App Designer moves them. Pure: no database access.
 *
 * saveMenu runs a plan in one transaction (the menu re-read FOR UPDATE, the
 * open token checked, the result re-read and proved before COMMIT);
 * deleteMenu and renameMenu are File > Delete and File > Rename.
 */

export class MenuSaveRefusedError extends SaveRefusedError {
  constructor(message: string) { super(message); this.name = 'MenuSaveRefusedError'; }
}

export interface StoredMenu {
  exists: boolean;
  rows: MenuRows;
  /** ItemSelected programs by bar|item. */
  peopleCode: Map<string, StoredProgram>;
  tombstones: { menu: Row[]; peopleCode: Row[] };
  /** The other menus of the stored group: MENUNAME, VERSION. */
  group: Row[];
}

export interface Counters { MDM: number; PCM: number; CLM: number; PJM: number; SYS: number; ACM: number; TSM: number; TSTM: number }
type CounterName = keyof Counters;
const COUNTERS: readonly CounterName[] = ['MDM', 'PCM', 'CLM', 'PJM', 'SYS', 'ACM', 'TSM', 'TSTM'];

const OUT_FORMAT_OBJECT = 4002;
const MENU_TARGET: CompileTarget = { applicationClass: false, recordName: '', fieldName: '' };
const emptyRows = (): MenuRows => ({ menu: {}, items: [], transfers: [], languages: [], itemLanguages: [], origins: [] });

export async function readStoredMenu(c: Connection, oracledb: DbTypes, name: string, forUpdate: boolean): Promise<StoredMenu> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const opts = { outFormat: OUT_FORMAT_OBJECT, fetchInfo: { DESCRLONG: { type: oracledb.STRING }, PCTEXT: { type: oracledb.STRING } } };
  const all = async (sql: string, binds: Record<string, unknown> = { m: name }) => ((await c.execute<Row>(sql, binds, opts)).rows ?? []);
  const [menu] = await all(`SELECT M.*, TO_CHAR(M.LASTUPDDTTM, ${TIMESTAMP_FORMAT}) AS LASTUPDDTTM FROM PSMENUDEFN M WHERE MENUNAME = :m${lock}`);
  const tombstones = {
    menu: await all(`SELECT MENUNAME, VERSION FROM PSMENUDEL WHERE MENUNAME = :m`),
    peopleCode: await all(`SELECT ${PC_KEY_COLUMNS.join(', ')}, VERSION FROM PSPCMPROGDEL WHERE OBJECTID1 = 3 AND OBJECTVALUE1 = :m`)
  };
  if (!menu) return { exists: false, rows: emptyRows(), peopleCode: new Map(), tombstones, group: [] };
  const rows: MenuRows = {
    menu,
    items: await all(`SELECT * FROM PSMENUITEM WHERE MENUNAME = :m ORDER BY ITEMNUM${lock}`),
    transfers: await all(`SELECT * FROM PSXFERITEM WHERE MENUNAME = :m${lock}`),
    languages: await all(`SELECT * FROM PSMENUDEFNLANG WHERE MENUNAME = :m${lock}`),
    itemLanguages: await all(`SELECT * FROM PSMENUITEMLANG WHERE MENUNAME = :m${lock}`),
    origins: await all(`SELECT * FROM PSMENUORIGIN WHERE MENUNAME = :m${lock}`)
  };
  const groupName = String(menu.MENUGROUP ?? '').trim();
  const group = groupName && Number(menu.MENUTYPE) === 0
    ? await all(`SELECT MENUNAME, VERSION FROM PSMENUDEFN WHERE MENUGROUP = :g AND MENUTYPE = 0 AND MENUNAME <> :m`, { g: menu.MENUGROUP, m: name })
    : [];
  return { exists: true, rows, peopleCode: await readMenuPeopleCode(c, all, lock), tombstones, group };
}

async function readMenuPeopleCode(_c: Connection, all: (sql: string) => Promise<Row[]>, lock: string): Promise<Map<string, StoredProgram>> {
  const cols = PC_KEY_COLUMNS.join(', ');
  const text = await all(`SELECT ${cols}, PROGSEQ, HASH_SIGNATURE, PCTEXT FROM PSPCMTXT WHERE OBJECTID1 = 3 AND OBJECTVALUE1 = :m${lock}`);
  const prog = await all(`SELECT ${cols}, PROGSEQ, VERSION, NAMECOUNT, PROGLEN, PROGRUNLOC, PROGFLAGS, LICENSE_CODE,
                                 TO_CHAR(LASTUPDDTTM, ${TIMESTAMP_FORMAT}) AS LASTUPDDTTM, LASTUPDOPRID, PROGEXTENDS, PTTOOLSREL, PROGTXT
                            FROM PSPCMPROG WHERE OBJECTID1 = 3 AND OBJECTVALUE1 = :m${lock}`);
  const names = await all(`SELECT ${cols}, NAMENUM, RECNAME, REFNAME, PACKAGEROOT, QUALIFYPATH, APPCLASSMETHOD FROM PSPCMNAME WHERE OBJECTID1 = 3 AND OBJECTVALUE1 = :m${lock}`);
  const out = new Map<string, StoredProgram>();
  const entry = (r: Row): StoredProgram => {
    const values = [1, 2, 3, 4, 5, 6, 7].map((n) => String(r[`OBJECTVALUE${n}`]));
    const k = pcKeyOf(values[1].trim(), values[2].trim());
    let p = out.get(k);
    if (!p) {
      p = { key: { objectIds: [1, 2, 3, 4, 5, 6, 7].map((n) => Number(r[`OBJECTID${n}`])), objectValues: values }, text: [], program: [], names: [] };
      out.set(k, p);
    }
    return p;
  };
  for (const r of text) entry(r).text.push({ progseq: Number(r.PROGSEQ), text: String(r.PCTEXT ?? ''), hashSignature: String(r.HASH_SIGNATURE) });
  for (const r of prog) {
    entry(r).program.push({
      progseq: Number(r.PROGSEQ), version: Number(r.VERSION), namecount: Number(r.NAMECOUNT), proglen: Number(r.PROGLEN),
      progrunloc: Number(r.PROGRUNLOC), progflags: Number(r.PROGFLAGS), licenseCode: String(r.LICENSE_CODE),
      lastupddttm: String(r.LASTUPDDTTM), lastupdoprid: String(r.LASTUPDOPRID), progextends: String(r.PROGEXTENDS),
      pttoolsrel: String(r.PTTOOLSREL), bytes: Buffer.isBuffer(r.PROGTXT) ? r.PROGTXT : Buffer.alloc(0)
    });
  }
  for (const r of names) {
    entry(r).names.push({
      namenum: Number(r.NAMENUM), recname: String(r.RECNAME), refname: String(r.REFNAME), packageroot: String(r.PACKAGEROOT),
      qualifypath: String(r.QUALIFYPATH), appclassmethod: String(r.APPCLASSMETHOD)
    });
  }
  // Only ItemSelected programs are an item's; anything else under the menu is kept as it is.
  for (const [k, p] of out) if (p.key.objectValues[3].trim() !== MENU_PC_EVENT) out.delete(k);
  return out;
}

/** The document of a stored menu, with its items' PeopleCode. */
export function menuDocumentOf(stored: StoredMenu): MenuDocument {
  const sources = new Map([...stored.peopleCode].map(([k, p]) => [k, storedText(p)]));
  return documentFromRows(stored.rows, sources);
}

/** The concurrency token: the menu's VERSION and its PeopleCode's -- every App Designer save moves one. */
export function menuToken(stored: StoredMenu | undefined): string {
  if (!stored || !stored.exists) return 'absent';
  const parts = [`M${Number(stored.rows.menu.VERSION)}`, ...[...stored.peopleCode].map(([k, p]) => `C${k}=${p.program[0]?.version ?? 0}`).sort()];
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
}

export async function readMenuCounters(c: Connection, forUpdate: boolean): Promise<Counters> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const rows = await select<{ T: string; V: number }>(c, `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN (${COUNTERS.map((n) => `'${n}'`).join(', ')})${lock}`);
  const out = {} as Counters;
  for (const n of COUNTERS) {
    const r = rows.find((x) => String(x.T).trim() === n);
    if (!r) throw new MenuSaveRefusedError(`PSVERSION ${n} is missing; refusing to write.`);
    out[n] = Number(r.V);
  }
  return out;
}

/** PSVERSION moved, and PSLOCK set to the same value (App Designer sets it, it does not add to it [mi08]); SYS has no PSLOCK row it moves. */
function counterStatements(from: Counters, to: Counters): Statement[] {
  const st: Statement[] = [];
  for (const n of COUNTERS) {
    if (to[n] === from[n]) continue;
    st.push({ sql: `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: to[n] }, expect: 1, what: `Updating PSVERSION ${n}` });
    if (n !== 'SYS') st.push({ sql: `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = '${n}'`, binds: { v: to[n] }, what: `Updating PSLOCK ${n}` });
  }
  return st;
}

// ---------------------------------------------------------------------------
// Planning

export interface MenuPlanSummary {
  changes: string[];
  inserted: number;
  updated: number;
  deleted: number;
  peopleCodeChanged: string[];
  tombstones: string[];
  /** Other menus whose group order / separator the save sets. */
  groupMenus: string[];
}

export interface MenuPlan {
  name: string;
  empty: boolean;
  statements: Statement[];
  desired: MenuDesiredRows;
  increments: Partial<Counters>;
  counters: Counters;
  /** Whether the menu row takes the new MDM and the save's stamp. */
  menuStamped: boolean;
  /** Whether the group's rows (this menu's included) take the new MDM. */
  groupWritten: boolean;
  summary: MenuPlanSummary;
  peopleCode: Map<string, StoredProgram>;
}

export interface MenuPlanOptions {
  operatorId: string;
  toolsRelease: string;
  lastupddttm: string;
  counters: Counters;
  oracledb: DbTypes;
}

const STAMP = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
const GROUP_COLUMNS = new Set(['GROUPORDER', 'GROUPSEP']);
const KEYS: Record<string, string[]> = {
  PSMENUITEM: ['MENUNAME', 'BARNAME', 'ITEMNAME'],
  PSXFERITEM: ['MENUNAME', 'ITEMNAME'],
  PSMENUDEFNLANG: ['MENUNAME', 'LANGUAGE_CD'],
  PSMENUITEMLANG: ['MENUNAME', 'BARNAME', 'ITEMNAME', 'LANGUAGE_CD'],
  PSMENUORIGIN: ['MENUNAME', 'PTORIGINTYPE', 'PTORIGINNAME']
};
const val = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() === '' && typeof v === 'string' ? ' ' : String(v).trim());
const keyOf = (table: string, r: Row) => KEYS[table].map((k) => val(r[k])).join('\u0000');

function diff(table: string, stored: Row[], desired: Row[]): { inserted: Row[]; deleted: Row[]; updated: { key: Row; changes: Row }[] } {
  const s = new Map(stored.map((r) => [keyOf(table, r), r]));
  const d = new Map(desired.map((r) => [keyOf(table, r), r]));
  const out = { inserted: [] as Row[], deleted: [] as Row[], updated: [] as { key: Row; changes: Row }[] };
  for (const [k, r] of d) {
    const old = s.get(k);
    if (!old) { out.inserted.push(r); continue; }
    const changes: Row = {};
    for (const col of Object.keys(r)) if (!KEYS[table].includes(col) && val(r[col]) !== val(old[col])) changes[col] = r[col];
    if (Object.keys(changes).length) out.updated.push({ key: r, changes });
  }
  for (const [k, r] of s) if (!d.has(k)) out.deleted.push(r);
  return out;
}

function whereKey(table: string, r: Row, binds: Record<string, unknown>, prefix = 'k'): string {
  return KEYS[table].map((k, i) => { binds[`${prefix}${i}`] = r[k]; return `${k} = :${prefix}${i}`; }).join(' AND ');
}

function update(table: string, key: Row, changes: Row, oracledb: DbTypes): Statement {
  const binds: Record<string, unknown> = {};
  const sets = Object.keys(changes).map((c, i) => {
    binds[`u${i}`] = c === 'DESCRLONG' && changes[c] !== null ? { val: String(changes[c]), type: oracledb.CLOB } : changes[c];
    return `${c} = :u${i}`;
  });
  return { sql: `UPDATE ${table} SET ${sets.join(', ')} WHERE ${whereKey(table, key, binds)}`, binds, expect: 1, what: `Updating ${table}` };
}

function remove(table: string, r: Row): Statement {
  const binds: Record<string, unknown> = {};
  return { sql: `DELETE FROM ${table} WHERE ${whereKey(table, r, binds)}`, binds, expect: 1, what: `Deleting ${table}` };
}

function pcTombstone(values: readonly string[], version: number): Statement {
  return {
    sql: `INSERT INTO PSPCMPROGDEL (${PC_KEY_COLUMNS.join(', ')}, VERSION) VALUES (${[1, 2, 3, 4, 5, 6, 7].map((n) => `:i${n}, :v${n}`).join(', ')}, :dv)`,
    binds: { ...pcBinds(MENU_PC_IDS, values), dv: version }, expect: 1, what: 'Inserting PSPCMPROGDEL'
  };
}

const isMissing = (s: StoredMenu | undefined) => !s || !s.exists;

/**
 * The statements that turn the stored menu (missing: a create) into the
 * document, with the counters' moves (docs/MENUS.md "Counters").
 */
export function planMenuSave(stored: StoredMenu | undefined, doc: MenuDocument, opts: MenuPlanOptions): MenuPlan {
  const creating = isMissing(stored);
  const s = creating ? undefined : stored!;
  const name = doc.name;
  const ora = opts.oracledb;
  if (s && String(s.rows.menu.MENUNAME).trim() !== name) throw new MenuSaveRefusedError('The stored menu is another one; refusing.');
  const desired = rowsFromDocument(doc);
  const changes: string[] = [];
  const counts = { inserted: 0, updated: 0, deleted: 0 };
  const peopleCodeChanged: string[] = [];
  const tombstoneNotes: string[] = [];
  const statements: Statement[] = [];
  const authStatements: Statement[] = [];

  // ---- PSMENUDEFN columns: the menu's own, and the group's
  const menuChanges: Row = {};
  const groupChanges: Row = {};
  if (s) {
    for (const col of Object.keys(desired.menu)) {
      if (STAMP.has(col) || col === 'MENUNAME') continue;
      if (val(desired.menu[col]) === val(s.rows.menu[col])) continue;
      (GROUP_COLUMNS.has(col) && String(desired.menu.MENUGROUP).trim() ? groupChanges : menuChanges)[col] = desired.menu[col];
    }
  }
  const groupChanged = Object.keys(groupChanges).length > 0;
  const groupRenamed = !!s && 'MENUGROUP' in menuChanges;

  // ---- items and the tables keyed by them
  const tables: [string, Row[], Row[]][] = [
    ['PSMENUITEM', s?.rows.items ?? [], desired.items],
    ['PSXFERITEM', s?.rows.transfers ?? [], desired.transfers],
    ['PSMENUDEFNLANG', s?.rows.languages ?? [], desired.languages],
    ['PSMENUITEMLANG', s?.rows.itemLanguages ?? [], desired.itemLanguages],
    ['PSMENUORIGIN', s?.rows.origins ?? [], desired.origins]
  ];
  const diffs = new Map(tables.map(([t, a, b]) => [t, diff(t, a, b)]));
  const itemsChanged = [...diffs.values()].some((d) => d.inserted.length || d.deleted.length || d.updated.length);

  // Renames (an item's name or its bar's, as Menu / Bar Item Properties make them) and moves (Cut / Paste into another bar).
  let renames = 0;
  const renamedBars = new Set<string>();
  for (const bar of doc.bars) if (bar.origin && bar.origin !== bar.name) { renames++; renamedBars.add(bar.origin); }
  for (const bar of doc.bars) for (const it of bar.items) {
    if (it.origin && it.origin.item !== it.name) renames++;
  }
  // A stored item key gone (deleted, renamed, moved) that is not a separator: App Designer's security clean-up moves CLM [mi10, mi12, mi14].
  const keyRemoved = (diffs.get('PSMENUITEM')!.deleted).some((r) => Number(r.ITEMTYPE) !== 8);

  // Permission-list items follow (PSAUTHITEM: menu, bar, item) -- renamed with the item, deleted with it.
  if (s) {
    const desiredKeys = new Set(desired.items.map((r) => `${r.BARNAME}|${r.ITEMNAME}`));
    for (const bar of doc.bars) for (const it of bar.items) {
      if (!it.origin) continue;
      const from = it.origin;
      if (from.bar === bar.name && from.item === it.name) continue;
      const renamedOnly = from.item !== it.name || renamedBars.has(from.bar);
      if (renamedOnly) {
        authStatements.push({ sql: `UPDATE PSAUTHITEM SET BARNAME = :b, BARITEMNAME = :i WHERE MENUNAME = :m AND BARNAME = :ob AND BARITEMNAME = :oi`,
          binds: { b: bar.name, i: it.name, m: name, ob: from.bar, oi: from.item }, what: 'Updating PSAUTHITEM' });
      }
    }
    for (const r of diffs.get('PSMENUITEM')!.deleted) {
      const k = `${String(r.BARNAME).trim()}|${String(r.ITEMNAME).trim()}`;
      const followed = doc.bars.some((b) => b.items.some((it) => it.origin && `${it.origin.bar}|${it.origin.item}` === k &&
        (it.origin.item !== it.name || renamedBars.has(it.origin.bar))));
      if (!followed && !desiredKeys.has(k)) {
        authStatements.push({ sql: `DELETE FROM PSAUTHITEM WHERE MENUNAME = :m AND BARNAME = :b AND BARITEMNAME = :i`,
          binds: { m: name, b: r.BARNAME, i: r.ITEMNAME }, what: 'Deleting PSAUTHITEM' });
      }
    }
  }

  // ---- PeopleCode
  const storedPc = s?.peopleCode ?? new Map<string, StoredProgram>();
  const desiredPc = new Map(desired.peopleCode.map((p) => [pcKeyOf(p.bar, p.item), p]));
  const pcWritten = new Map<string, StoredProgram>();
  const pcStatements: Statement[] = [];
  let pcMoved = false;
  let pcChanged = false;
  const movedFrom = new Set<string>();
  const compiledKeys = new Set<string>();
  for (const [k, p] of desiredPc) {
    const source = prepareSourceForSave(p.source);
    const old = storedPc.get(k);
    if (old && old.program.length && storedText(old) === source) continue;
    const originKey = p.origin ? pcKeyOf(p.origin.bar, p.origin.item) : undefined;
    const origin = originKey && originKey !== k ? storedPc.get(originKey) : undefined;
    const key = { objectIds: [...MENU_PC_IDS], objectValues: menuPeopleCodeKey(name, p.bar, p.item) };
    let expected: StoredProgram;
    if (!old && origin && origin.program.length && storedText(origin) === source) {
      // Moved unchanged with a renamed item or bar: the stored rows under the new key, VERSION the PCM before the save's [mi08, mi09, mb05].
      expected = {
        key, text: origin.text.map((r) => ({ ...r })), names: origin.names.map((r) => ({ ...r })),
        program: origin.program.map((r) => ({ ...r, version: opts.counters.PCM, lastupddttm: opts.lastupddttm, lastupdoprid: opts.operatorId }))
      };
      movedFrom.add(originKey!);
      pcMoved = true;
      peopleCodeChanged.push(`${p.bar}.${p.item} moved`);
    } else {
      if (old && old.program.length) checkStoredProgram(old, MENU_TARGET, opts.toolsRelease);
      const compiled = planProgram(source, compileForSave(source, MENU_TARGET, opts.toolsRelease));
      expected = expectedProgram(key, compiled, { version: 0, lastupddttm: opts.lastupddttm, operatorId: opts.operatorId });
      compiledKeys.add(k);
      pcChanged = true;
      peopleCodeChanged.push(`${p.bar}.${p.item} ${old ? 'changed' : 'created'}`);
    }
    pcWritten.set(k, expected);
    pcStatements.push(...deletePeopleCode(k, old), ...insertPeopleCode(expected, ora));
    for (const t of stored?.tombstones.peopleCode ?? []) {
      if (String(t.OBJECTVALUE2).trim() === p.bar && String(t.OBJECTVALUE3).trim() === p.item && String(t.OBJECTVALUE4).trim() === MENU_PC_EVENT) pcStatements.push(deletePcTombstone(t));
    }
  }
  const pcTombstoneKeys: (readonly string[])[] = [];
  for (const [k, old] of storedPc) {
    if (desiredPc.has(k)) continue;
    pcStatements.push(...deletePeopleCode(k, old));
    pcTombstoneKeys.push(old.key.objectValues);
    tombstoneNotes.push(`PSPCMPROGDEL ${k.replace('|', '.')}`);
    if (!movedFrom.has(k)) { pcChanged = true; peopleCodeChanged.push(`${k.replace('|', '.')} deleted`); }
  }

  // ---- counters (docs/MENUS.md "Counters")
  const menuStamped = creating || Object.keys(menuChanges).length > 0 || itemsChanged;
  const definitionChanged = menuStamped || groupChanged;
  const inc: Partial<Counters> = {};
  if (definitionChanged) {
    let mdm = 0;
    if (menuStamped) mdm += 1 + renames + (groupRenamed ? 1 : 0);
    // A group's order and separator alone: GROUPORDER moves MDM by one, GROUPSEP alone by two [mn09, mn10, mn13, mn14, mn20].
    if (groupChanged && !menuStamped) mdm += 'GROUPORDER' in groupChanges ? 1 : 2;
    inc.MDM = mdm;
  }
  if (pcMoved || pcChanged || pcTombstoneKeys.length) inc.PCM = 1;
  const clm = renames + (keyRemoved ? 1 : 0);
  if (clm && !creating) inc.CLM = clm;
  const anything = definitionChanged || !!inc.PCM;
  if (anything) inc.SYS = 1 + (menuStamped ? renames + (groupRenamed ? 1 : 0) : 0);
  const next = { ...opts.counters };
  for (const n of COUNTERS) next[n] += inc[n] ?? 0;

  // ---- statements: children deleted first, the menu row, then inserts
  for (const t of ['PSMENUITEMLANG', 'PSXFERITEM', 'PSMENUITEM', 'PSMENUDEFNLANG', 'PSMENUORIGIN']) {
    for (const r of diffs.get(t)!.deleted) { statements.push(remove(t, r)); counts.deleted++; }
  }
  const stamp = `VERSION = :mdm, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op`;
  if (creating) {
    statements.push(insertStatement('PSMENUDEFN', { ...desired.menu, VERSION: next.MDM, LASTUPDOPRID: opts.operatorId }, ora));
    setStamp(statements[statements.length - 1], opts.lastupddttm);
    for (const t of stored?.tombstones.menu ?? []) statements.push({ sql: 'DELETE FROM PSMENUDEL WHERE MENUNAME = :m AND VERSION = :v', binds: { m: name, v: t.VERSION }, expect: 1, what: 'Deleting PSMENUDEL' });
    changes.push(`create ${doc.type === 1 ? 'popup ' : ''}menu ${name}`);
  } else if (menuStamped) {
    const binds: Record<string, unknown> = { m: name };
    const sets = Object.keys(menuChanges).map((c, i) => {
      binds[`u${i}`] = c === 'DESCRLONG' && menuChanges[c] !== null ? { val: String(menuChanges[c]), type: ora.CLOB } : menuChanges[c];
      return `${c} = :u${i}`;
    });
    statements.push({ sql: `UPDATE PSMENUDEFN SET ${[...sets, stamp].join(', ')} WHERE MENUNAME = :m`, binds, expect: 1, what: 'Updating PSMENUDEFN' });
    for (const c of Object.keys(menuChanges)) changes.push(`menu ${c}`);
  }
  for (const t of ['PSMENUORIGIN', 'PSMENUDEFNLANG', 'PSMENUITEM', 'PSXFERITEM', 'PSMENUITEMLANG']) {
    const d = diffs.get(t)!;
    for (const r of d.inserted) { statements.push(insertStatement(t, r, ora)); counts.inserted++; }
    for (const u of d.updated) {
      statements.push(update(t, u.key, u.changes, ora));
      counts.updated++;
      changes.push(`${t} ${KEYS[t].slice(1).map((k) => String(u.key[k]).trim()).join('.')}: ${Object.keys(u.changes).join(', ')}`);
    }
    if (d.inserted.length) changes.push(`${t}: ${d.inserted.length} inserted`);
    if (d.deleted.length) changes.push(`${t}: ${d.deleted.length} deleted`);
  }
  // The group's order and separator are the group's: every menu of it takes them and the new MDM, unstamped [mn13, mn14, mn20].
  const groupMenus: string[] = [];
  if (groupChanged) {
    const binds: Record<string, unknown> = { g: desired.menu.MENUGROUP, mdm: next.MDM };
    const sets = Object.keys(groupChanges).map((c, i) => { binds[`g${i}`] = groupChanges[c]; return `${c} = :g${i}`; });
    statements.push({ sql: `UPDATE PSMENUDEFN SET ${sets.join(', ')}, VERSION = :mdm WHERE MENUGROUP = :g AND MENUTYPE = 0`, binds, what: 'Updating PSMENUDEFN (group)' });
    for (const c of Object.keys(groupChanges)) changes.push(`group ${String(desired.menu.MENUGROUP).trim()} ${c}`);
    groupMenus.push(...(groupRenamed ? [] : (s?.group ?? []).map((r) => String(r.MENUNAME).trim())));
  }
  statements.push(...pcStatements);
  for (const values of pcTombstoneKeys) statements.push(pcTombstone(values, next.PCM));
  statements.push(...authStatements);

  for (const st of statements) {
    if (/:mdm\b/.test(st.sql)) st.binds.mdm = next.MDM;
    if (/:ts\b/.test(st.sql) && st.binds.ts === undefined) st.binds.ts = opts.lastupddttm;
    if (/:op\b/.test(st.sql)) st.binds.op = opts.operatorId;
  }
  // Compiled programs take the new PCM [mi06]; moved ones keep the PCM before the save (set above).
  for (const k of compiledKeys) for (const r of pcWritten.get(k)!.program) r.version = next.PCM;
  for (const st of pcStatements) {
    if (!/^INSERT INTO PSPCMPROG /.test(st.sql)) continue;
    const k = pcKeyOf(String(st.binds.v2).trim(), String(st.binds.v3).trim());
    st.binds.version = pcWritten.get(k)?.program[0]?.version ?? next.PCM;
  }
  statements.push(...counterStatements(opts.counters, next));

  return {
    name, empty: !anything, statements, desired, increments: inc, counters: next, menuStamped, groupWritten: groupChanged,
    summary: { changes, ...counts, peopleCodeChanged, tombstones: tombstoneNotes, groupMenus }, peopleCode: pcWritten
  };
}

function setStamp(st: Statement, ts: string): void {
  st.sql = st.sql.replace(/\) VALUES \(/, ', LASTUPDDTTM) VALUES (').replace(/\)$/, `, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}))`);
  st.binds.ts = ts;
}

// ---------------------------------------------------------------------------
// Saving

export interface MenuSaveRequest {
  doc: MenuDocument;
  openedToken: string;
  operatorId: string;
  dryRun?: boolean;
  /** Full scoped migration guard; ordinary Menu Designer saves keep their existing token contract. */
  expectedSnapshotToken?: string;
  /** Migration preview executes and verifies the native plan before rolling back. */
  verifyRollback?: boolean;
}

export interface MenuSaveResult {
  plan: MenuPlan;
  token: string;
  written: boolean;
}

async function prepare(c: Connection, operatorId: string, name: string): Promise<void> {
  const operatorError = validateOperatorId(operatorId);
  if (operatorError) throw new MenuSaveRefusedError(operatorError);
  const scope = writeScopeRefusal(name);
  if (scope) throw new MenuSaveRefusedError(scope);
  if (!(await operatorExists(c, operatorId))) throw new MenuSaveRefusedError(`PeopleSoft operator ${operatorId} does not exist in this database (PSOPRDEFN).`);
}

async function saveContext(c: Connection): Promise<{ toolsRelease: string; counters: Counters; lastupddttm: string }> {
  const [{ R }] = await select<{ R: string }>(c, `SELECT TOOLSREL AS R FROM PSSTATUS`);
  const counters = await readMenuCounters(c, true);
  const [{ TS }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
  return { toolsRelease: String(R).trim(), counters, lastupddttm: TS };
}

/** Saves the document in one transaction; refused on a validation error or a changed menu. */
export async function saveMenu(c: Connection, oracledb: DbTypes, request: MenuSaveRequest): Promise<MenuSaveResult> {
  try {
    await prepare(c, request.operatorId, request.doc.name);
    const problems = validateMenu(request.doc).filter((d) => d.severity === 'error');
    if (problems.length) throw new MenuSaveRefusedError(`The menu has errors: ${problems.slice(0, 5).map((p) => `${p.path}: ${p.message}`).join('; ')}`);
    const stored = await readStoredMenu(c, oracledb, request.doc.name, true);
    if(request.expectedSnapshotToken!==undefined) {
      const full=await readMenuMigration(c,oracledb,request.doc.name,true);
      if((full?.token??'absent')!==request.expectedSnapshotToken)throw new MenuSaveRefusedError('Menu migration scope changed after preview.');
      checkMenuMigrationUpdate(full?.data,checkedMenuMigration(request.doc));
    }
    const token = menuToken(stored);
    if (token !== request.openedToken) {
      throw new MenuSaveRefusedError(request.openedToken === 'absent'
        ? `A menu named ${request.doc.name} already exists.`
        : `${request.doc.name} was changed in the database since it was opened (another save, possibly in App Designer). Reopen it and reapply your edit.`);
    }
    const ctx = await saveContext(c);
    const plan = planMenuSave(stored, request.doc, { operatorId: request.operatorId, ...ctx, oracledb });
    if (request.dryRun && !request.verifyRollback || plan.empty) {
      await c.rollback();
      return { plan, token, written: false };
    }
    await run(c, plan.statements);
    await verifyMenu(c, oracledb, plan);
    if(request.expectedSnapshotToken!==undefined) {
      const after=await readMenuMigration(c,oracledb,request.doc.name);
      if(JSON.stringify(after?.data)!==JSON.stringify(checkedMenuMigration(request.doc)))throw new MenuSaveRefusedError('Menu migration native after-image differs from the approved payload.');
    }
    if(request.dryRun) { await c.rollback();return {plan,token,written:false}; }
    await c.commit();
    return { plan, token: menuToken(await readStoredMenu(c, oracledb, request.doc.name, false)), written: true };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

const normalize = (rows: Row[]) => rows.map((r) => JSON.stringify(Object.keys(r).filter((k) => !STAMP.has(k)).sort()
  .map((k) => [k, val(r[k])]))).sort();

/** Proves the stored menu is the plan's: rows, versions, PeopleCode, counters. */
export async function verifyMenu(c: Connection, oracledb: DbTypes, plan: MenuPlan): Promise<void> {
  const problems: string[] = [];
  const stored = await readStoredMenu(c, oracledb, plan.name, false);
  if (!stored.exists) throw new MenuSaveRefusedError(`After the save there is no menu ${plan.name}.`);
  const actual = rowsFromDocument(menuDocumentOf(stored));
  const want = plan.desired;
  for (const k of ['items', 'transfers', 'languages', 'itemLanguages', 'origins'] as const) {
    if (JSON.stringify(normalize(actual[k])) !== JSON.stringify(normalize(want[k]))) problems.push(`${k} differ`);
  }
  if (JSON.stringify(normalize([actual.menu])) !== JSON.stringify(normalize([want.menu]))) problems.push('the menu row differs');
  if ((plan.menuStamped || plan.groupWritten) && Number(stored.rows.menu.VERSION) !== plan.counters.MDM) problems.push(`menu VERSION ${stored.rows.menu.VERSION}, ${plan.counters.MDM} expected`);
  for (const [k, p] of plan.peopleCode) {
    const got = stored.peopleCode.get(k);
    if (!got || storedText(got) !== storedText(p) || got.program.length !== p.program.length ||
      got.program.some((r, i) => !r.bytes.equals(p.program[i].bytes) || r.version !== p.program[i].version)) problems.push(`PeopleCode ${k} is not what was written`);
  }
  const now = await readMenuCounters(c, false);
  for (const n of COUNTERS) if (now[n] !== plan.counters[n]) problems.push(`PSVERSION ${n} ${now[n]}, ${plan.counters[n]} expected`);
  if (problems.length) throw new MenuSaveRefusedError(`The written rows are not the planned ones (${problems.slice(0, 6).join('; ')}).`);
}

/** After COMMIT, on another connection: the menu is the one written. */
export async function verifyMenuSave(c: Connection, oracledb: DbTypes, result: MenuSaveResult): Promise<void> {
  if (!result.written) return;
  if (menuToken(await readStoredMenu(c, oracledb, result.plan.name, false)) !== result.token) throw new MenuSaveRefusedError('After COMMIT the menu is not what was written.');
}

// ---------------------------------------------------------------------------
// Delete and rename

/**
 * File > Delete [mn18]: every row of the menu, its PeopleCode with
 * tombstones, its permission-list items; PSMENUDEL at the new MDM; MDM, CLM,
 * SYS + 1 (PCM + 1 with PeopleCode). Transfers in other menus that name it
 * are left as App Designer leaves them.
 */
export async function deleteMenu(c: Connection, oracledb: DbTypes, name: string, openedToken: string, operatorId: string, dryRun = false): Promise<{ counters: Counters }> {
  try {
    await prepare(c, operatorId, name);
    const stored = await readStoredMenu(c, oracledb, name, true);
    if (!stored.exists) throw new MenuSaveRefusedError(`There is no menu ${name}.`);
    if (menuToken(stored) !== openedToken) throw new MenuSaveRefusedError(`${name} was changed in the database since it was opened.`);
    const from = await readMenuCounters(c, true);
    const to = { ...from, MDM: from.MDM + 1, CLM: from.CLM + 1, SYS: from.SYS + 1, PCM: from.PCM + (stored.peopleCode.size ? 1 : 0) };
    const st: Statement[] = [];
    for (const t of ['PSMENUITEMLANG', 'PSXFERITEM', 'PSMENUITEM', 'PSMENUDEFNLANG', 'PSMENUORIGIN', 'PSMENUDEFN']) {
      st.push({ sql: `DELETE FROM ${t} WHERE MENUNAME = :m`, binds: { m: name }, what: `Deleting ${t}` });
    }
    for (const p of stored.peopleCode.values()) {
      st.push(...deletePeopleCode('', p), pcTombstone(p.key.objectValues, to.PCM));
    }
    st.push({ sql: 'DELETE FROM PSAUTHITEM WHERE MENUNAME = :m', binds: { m: name }, what: 'Deleting PSAUTHITEM' });
    st.push({ sql: 'INSERT INTO PSMENUDEL (MENUNAME, VERSION) VALUES (:m, :v)', binds: { m: name, v: to.MDM }, expect: 1, what: 'Inserting PSMENUDEL' });
    st.push(...counterStatements(from, to));
    await run(c, st);
    if ((await readStoredMenu(c, oracledb, name, false)).exists) throw new MenuSaveRefusedError(`${name} still has rows after the delete.`);
    if (dryRun) await c.rollback(); else await c.commit();
    return { counters: to };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

/**
 * File > Rename [mn16, mn17]: every row re-keyed in place, the menu row
 * restamped with the new MDM; its origin rows renamed, or an R row naming
 * the old menu when it has none; transfers in every menu that named it
 * repointed; its PeopleCode re-keyed (VERSION the new PCM) with tombstones;
 * PSMENUDEL for the old name; permission-list items renamed. TSTM, ACM,
 * CLM, MDM, PCM, PJM, SYS and TSM each + 1.
 */
export async function renameMenu(c: Connection, oracledb: DbTypes, from: string, to: string, openedToken: string, operatorId: string): Promise<MenuSaveResult> {
  try {
    await prepare(c, operatorId, from);
    const scope = writeScopeRefusal(to);
    if (scope) throw new MenuSaveRefusedError(scope);
    const stored = await readStoredMenu(c, oracledb, from, true);
    if (!stored.exists) throw new MenuSaveRefusedError(`There is no menu ${from}.`);
    if (menuToken(stored) !== openedToken) throw new MenuSaveRefusedError(`${from} was changed in the database since it was opened.`);
    const target = await readStoredMenu(c, oracledb, to, true);
    if (target.exists) throw new MenuSaveRefusedError(`A menu named ${to} already exists.`);
    const ctx = await saveContext(c);
    const next = { ...ctx.counters };
    for (const n of COUNTERS) next[n] += 1;
    const b = { f: from, t: to };
    const st: Statement[] = [
      { sql: `UPDATE PSMENUDEFN SET MENUNAME = :t, VERSION = :v, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op WHERE MENUNAME = :f`,
        binds: { ...b, v: next.MDM, ts: ctx.lastupddttm, op: operatorId }, expect: 1, what: 'Renaming PSMENUDEFN' }
    ];
    for (const t of ['PSMENUITEM', 'PSXFERITEM', 'PSMENUDEFNLANG', 'PSMENUITEMLANG', 'PSMENUORIGIN']) {
      st.push({ sql: `UPDATE ${t} SET MENUNAME = :t WHERE MENUNAME = :f`, binds: { ...b }, what: `Renaming ${t}` });
    }
    if (!stored.rows.origins.length) {
      st.push({ sql: `INSERT INTO PSMENUORIGIN (MENUNAME, PTORIGINTYPE, PTORIGINNAME) VALUES (:t, 'R', :f)`, binds: { ...b }, expect: 1, what: 'Inserting PSMENUORIGIN' });
    }
    st.push({ sql: 'UPDATE PSXFERITEM SET XFERMENUNAME = :t WHERE XFERMENUNAME = :f', binds: { ...b }, what: 'Repointing PSXFERITEM' });
    for (const t of target.tombstones.menu) st.push({ sql: 'DELETE FROM PSMENUDEL WHERE MENUNAME = :m AND VERSION = :v', binds: { m: to, v: t.VERSION }, expect: 1, what: 'Deleting PSMENUDEL' });
    st.push({ sql: 'INSERT INTO PSMENUDEL (MENUNAME, VERSION) VALUES (:f, :v)', binds: { f: from, v: next.MDM }, expect: 1, what: 'Inserting PSMENUDEL' });
    const written = new Map<string, StoredProgram>();
    for (const [k, p] of stored.peopleCode) {
      const values = [to, ...p.key.objectValues.slice(1)];
      const moved: StoredProgram = {
        key: { objectIds: p.key.objectIds, objectValues: values }, text: p.text.map((r) => ({ ...r })), names: p.names.map((r) => ({ ...r })),
        program: p.program.map((r) => ({ ...r, version: next.PCM, lastupddttm: ctx.lastupddttm, lastupdoprid: operatorId }))
      };
      written.set(k, moved);
      st.push(...deletePeopleCode(k, p), ...insertPeopleCode(moved, oracledb), pcTombstone(p.key.objectValues, next.PCM));
      for (const t of target.tombstones.peopleCode) {
        if ([1, 2, 3, 4, 5, 6, 7].every((n) => String(t[`OBJECTVALUE${n}`]) === values[n - 1])) st.push(deletePcTombstone(t));
      }
    }
    st.push({ sql: 'UPDATE PSAUTHITEM SET MENUNAME = :t WHERE MENUNAME = :f', binds: { ...b }, what: 'Renaming PSAUTHITEM' });
    st.push(...counterStatements(ctx.counters, next));
    await run(c, st);
    const after = await readStoredMenu(c, oracledb, to, false);
    if (!after.exists || (await readStoredMenu(c, oracledb, from, false)).exists) throw new MenuSaveRefusedError(`The rename of ${from} to ${to} did not take.`);
    for (const [k, p] of written) {
      const got = after.peopleCode.get(k);
      if (!got || !got.program.every((r, i) => r.bytes.equals(p.program[i].bytes))) throw new MenuSaveRefusedError(`PeopleCode ${k} did not move.`);
    }
    await c.commit();
    const doc = menuDocumentOf(after);
    const plan: MenuPlan = {
      name: to, empty: false, statements: st, desired: rowsFromDocument(doc), increments: Object.fromEntries(COUNTERS.map((n) => [n, 1])), counters: next,
      menuStamped: true, groupWritten: false, peopleCode: written,
      summary: { changes: [`rename ${from} to ${to}`], inserted: 0, updated: 0, deleted: 0, peopleCodeChanged: [...written.keys()].map((k) => `${k} moved`), tombstones: [`PSMENUDEL ${from}`], groupMenus: [] }
    };
    return { plan, token: menuToken(after), written: true };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}

export { PC_EXACT };
