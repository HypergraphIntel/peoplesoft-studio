import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { Statement } from '../providers/appEngineWriter.js';
import type { DropZone } from '../model/dropZones.js';
import {
  planDropZoneSave, rootFolderId, peopleCodeHash, type CounterState, type DropZoneState, type StoredDropZoneConfig
} from '../providers/dropZoneWriter.js';

/*
 * The Drop Zone writer replays PIA's Configure Drop Zones saves captured on
 * HRDMO (tools/corpus/save-protocol/results/dz01-configure, dz02-remove): each
 * case planned from the state before it, then every inserted and deleted row,
 * tracking row and counter compared with what PIA wrote.
 */

const RESULTS = path.join('tools', 'corpus', 'save-protocol', 'results');
type Row = Record<string, unknown>;
const delta = (c: string) => JSON.parse(readFileSync(path.join(RESULTS, c, 'delta.json'), 'utf8'));
const have = (c: string) => existsSync(path.join(RESULTS, c, 'delta.json'));
const t = (v: unknown) => (v === null || v === undefined ? null : String(v).trim());

/** The rows a plan inserts into (or deletes from) a table, as column -> value. */
function planned(plan: { statements: Statement[] }, verb: 'INSERT INTO' | 'DELETE FROM', table: string): Row[] {
  return plan.statements.filter((st) => st.sql.startsWith(`${verb} ${table} `)).map((st) => {
    if (verb === 'DELETE FROM') {
      const cols = [...st.sql.matchAll(/(\w+) = :w\d+/g)].map((m) => m[1]);
      return Object.fromEntries(cols.map((c, i) => [c, st.binds[`w${i}`]]));
    }
    const cols = /\(([^)]*)\)/.exec(st.sql)![1].split(',').map((c) => c.trim()).filter((c) => c !== 'LASTUPDDTTM');
    return Object.fromEntries(cols.map((c, i) => [c, st.binds[`b${i}`]]));
  });
}

/** A captured row and a planned one agree on every column (LASTUPDDTTM aside; a null column is one the plan leaves out). */
function sameRow(captured: Row, mine: Row, what: string): void {
  for (const [col, v] of Object.entries(captured)) {
    if (col === 'LASTUPDDTTM' || col === 'ROWID') continue;
    assert.equal(t(mine[col]), t(v), `${what}.${col}`);
  }
  for (const col of Object.keys(mine)) assert.ok(col in captured, `${what}: ${col} is not a column PIA wrote`);
}

/** The tracking rows a plan stamps (its INSERT ... WHERE NOT EXISTS halves), as PSADSTRACKING rows. */
function trackingRows(plan: { statements: Statement[] }): Row[] {
  return plan.statements.filter((st) => st.sql.startsWith('INSERT INTO PSADSTRACKING')).map((st) => {
    const r: Row = { PTADSNAME: st.binds.a, RECNAME: st.binds.r, PTKEYHASH: st.binds.h };
    for (let i = 1; i <= 16; i++) { r[`PTKEYCOL${i}`] = st.binds[`c${i}`]; r[`PTKEYVALUE${i}`] = st.binds[`v${i}`]; }
    return r;
  });
}

const OWNER = { portal: 'EMPLOYEE', cref: 'ZZ_PCODE_LAB_CMP_GBL', menu: 'ZZ_PCODE_LAB_MENU' };
const ZONE: DropZone = {
  component: 'ZZ_PCODE_LAB_CMP', market: 'GBL', page: 'ZZ_PCODE_LAB_PG', container: 'ZZ_PCODE_LAB_PG', groupBoxId: 26, tabOrder: 1,
  level: 0, record: '', field: '', label: 'ZZ Lab Drop Zone', fieldName: '0...26', fieldId: 'ZZ_PCODE_LAB_PG.26.'
};
const TRACKED = new Set(['RCF_SERVICES|PSPTCS_SRVCFG', 'RCF_SERVICE_CREFS|PSPTCS_SRVCFG', 'RCF_SERVICE_DEFINITIONS|PSPTCSSRVDEFN',
  'RCF_SERVICE_CONFIGURATIONS|PSPTCSSRVCONF', 'RCF_MENU_LAYOUTS|PSPTCS_MENU_TBL', 'RCF_MENU_FOLDERS|PSPTCS_MNUFLDRS', 'RCF_MENU_LINKS|PSPTCS_MNULINKS']);

/** The counters a capture started from, PSVERSION and PSLOCK. */
function countersBefore(c: string): CounterState {
  const sm = delta(c).summary;
  const before = (x: Record<string, { before: number }>, n: string, fallback: number) => (x[n] ? Number(x[n].before) : fallback);
  // Counters a case did not move stayed as the previous case left them (dz01 -> dz02).
  const base = { RCSDM: 14, RCSCM: 15, SCNFM: 58, RCMTM: 3, SYS: 2865 };
  return {
    version: { RCSDM: before(sm.psversion, 'RCSDM', base.RCSDM), RCSCM: before(sm.psversion, 'RCSCM', base.RCSCM), SCNFM: before(sm.psversion, 'SCNFM', base.SCNFM),
      RCMTM: before(sm.psversion, 'RCMTM', base.RCMTM), SYS: before(sm.psversion, 'SYS', base.SYS) },
    lock: { RCSDM: before(sm.pslock, 'RCSDM', base.RCSDM), RCSCM: before(sm.pslock, 'RCSCM', base.RCSCM), SCNFM: before(sm.pslock, 'SCNFM', base.SCNFM),
      RCMTM: before(sm.pslock, 'RCMTM', base.RCMTM) }
  };
}

function assertCounters(c: string, after: CounterState): void {
  const sm = delta(c).summary;
  for (const [n, x] of Object.entries(sm.psversion as Record<string, { after: number }>)) assert.equal(after.version[n as keyof CounterState['version']], Number(x.after), `PSVERSION ${n}`);
  for (const [n, x] of Object.entries(sm.pslock as Record<string, { after: number }>)) assert.equal(after.lock[n as keyof CounterState['lock']], Number(x.after), `PSLOCK ${n}`);
}

test('a drop zone menu\'s Root folder id is PeopleCode Hash(menuId|"-Root") [dz01]', () => {
  assert.equal(rootFolderId('ZZ_PCODE_LAB_PG.26.'), 'GSkctLrpG69RxvrPZz09qbXp6Ik=');
  assert.equal(peopleCodeHash('ZZ_PCODE_LAB_PG.26.-Root'), 'GSkctLrpG69RxvrPZz09qbXp6Ik=');
});

test('configuring a drop zone writes what Configure Drop Zones wrote [dz01]', { skip: !have('dz01-configure') }, () => {
  const d = delta('dz01-configure').otherTables;
  const state: DropZoneState = {
    component: 'ZZ_PCODE_LAB_CMP', market: 'GBL', zones: [ZONE], owners: [OWNER], srvcfg: new Map([['EMPLOYEE|ZZ_PCODE_LAB_CMP_GBL', undefined]]),
    configs: [], instances: new Map([['EMPLOYEE|ZZ_PCODE_LAB_CMP_GBL', new Set<number>()]])
  };
  const draws = [0.59575, 0.468265];
  const plan = planDropZoneSave(state, [{ page: 'ZZ_PCODE_LAB_PG', fieldName: '0...26', subpage: 'ZZ_PCODE_LAB_SUB' }], {
    counters: countersBefore('dz01-configure'), ts: '2026-10-13-18.54.21.025000', operatorId: 'JARED', tracked: TRACKED,
    services: new Map([['ZZ_PCODE_LAB_SUB', { exists: false, urlType: '' }]]), random: () => draws.shift()!
  });
  for (const table of ['PSPTCSSRVDEFN', 'PSPTCS_SRVCFG', 'PSPTCSSRVCONF', 'PSPTCS_MAPFLDS', 'PSPTCS_MENU_TBL', 'PSPTCS_MNUFLDRS', 'PSPTCS_MNULINKS']) {
    const mine = planned(plan, 'INSERT INTO', table);
    assert.equal(mine.length, d[table].inserted.length, `${table} rows`);
    sameRow(d[table].inserted[0], mine[0], table);
    assert.equal(planned(plan, 'DELETE FROM', table).length, 0, `${table} deletes`);
  }
  const mineTracking = trackingRows(plan).map((r) => `${t(r.PTADSNAME)} ${t(r.RECNAME)} ${t(r.PTKEYHASH)} ${[1, 2, 3, 4, 5, 6].map((i) => `${t(r[`PTKEYCOL${i}`])}=${t(r[`PTKEYVALUE${i}`])}`).join(' ')}`).sort();
  const theirs = (d.PSADSTRACKING.inserted as Row[]).map((r) => `${t(r.PTADSNAME)} ${t(r.RECNAME)} ${t(r.PTKEYHASH)} ${[1, 2, 3, 4, 5, 6].map((i) => `${t(r[`PTKEYCOL${i}`])}=${t(r[`PTKEYVALUE${i}`])}`).join(' ')}`).sort();
  assert.deepEqual(mineTracking, theirs);
  assertCounters('dz01-configure', plan.counters);
});

test('removing a drop zone\'s subpage deletes and tombstones as PIA did, keeping the service [dz02]', { skip: !have('dz02-remove') }, () => {
  const d = delta('dz02-remove').otherTables;
  const conf: StoredDropZoneConfig = { owner: 'EMPLOYEE|ZZ_PCODE_LAB_CMP_GBL', serviceId: 'ZZ_PCODE_LAB_SUB', instanceId: 595746826, page: 'ZZ_PCODE_LAB_PG',
    fieldName: '0...26', version: 58, menuId: 'ZZ_PCODE_LAB_PG.26.' };
  const srvcfg = d.PSPTCS_SRVCFG.deleted[0] as Row;
  const state: DropZoneState = {
    component: 'ZZ_PCODE_LAB_CMP', market: 'GBL', zones: [{ ...ZONE, subpage: 'ZZ_PCODE_LAB_SUB' }], owners: [OWNER],
    srvcfg: new Map([['EMPLOYEE|ZZ_PCODE_LAB_CMP_GBL', srvcfg]]), configs: [conf], instances: new Map([['EMPLOYEE|ZZ_PCODE_LAB_CMP_GBL', new Set([595746826])]])
  };
  const plan = planDropZoneSave(state, [{ page: 'ZZ_PCODE_LAB_PG', fieldName: '0...26', subpage: '' }], {
    counters: countersBefore('dz02-remove'), ts: '2026-10-13-18.57.07.187000', operatorId: 'JARED', tracked: TRACKED, services: new Map()
  });
  for (const table of ['PSPTCSSRVCONF', 'PSPTCS_MAPFLDS', 'PSPTCS_MENU_TBL', 'PSPTCS_MNUFLDRS', 'PSPTCS_MNULINKS', 'PSPTCS_SRVCFG']) {
    const gone = planned(plan, 'DELETE FROM', table);
    assert.equal(gone.length, d[table].deleted.length, `${table} deletes`);
    for (const [col, v] of Object.entries(gone[0])) assert.equal(t(v), t((d[table].deleted[0] as Row)[col]), `${table} delete ${col}`);
  }
  for (const table of ['PSPTCSSRVCNFDEL', 'PSPTCSMNUTBLDEL', 'PSPTCS_SRVCFG']) sameRow(d[table].inserted[0], planned(plan, 'INSERT INTO', table)[0], table);
  assert.equal(planned(plan, 'INSERT INTO', 'PSPTCSSRVCONF').length, 0);
  assert.equal(planned(plan, 'DELETE FROM', 'PSPTCSSRVDEFN').length, 0, 'the service definition is kept');
  // Tracking: the service record's rows stamped; the configuration, menu and PIA's odd folder row re-stamped, not removed.
  const refreshed = plan.statements.filter((st) => st.sql.startsWith('UPDATE PSADSTRACKING') && !plan.statements.some((x) => x !== st && x.sql.startsWith('INSERT INTO PSADSTRACKING') && x.binds.h === st.binds.h && x.binds.a === st.binds.a));
  assert.deepEqual(refreshed.map((st) => `${st.binds.a}`).sort(), ['RCF_MENU_FOLDERS', 'RCF_MENU_LAYOUTS', 'RCF_SERVICE_CONFIGURATIONS']);
  assert.ok(!plan.statements.some((st) => st.sql.startsWith('DELETE FROM PSADSTRACKING')));
  assertCounters('dz02-remove', plan.counters);
});

test('a save that changes nothing plans nothing; an unknown drop zone is refused', () => {
  const state: DropZoneState = { component: 'X', market: 'GBL', zones: [ZONE], owners: [OWNER], srvcfg: new Map(), configs: [], instances: new Map() };
  const opts = { counters: { version: { RCSDM: 1, RCSCM: 1, SCNFM: 1, RCMTM: 1, SYS: 1 }, lock: { RCSDM: 1, RCSCM: 1, SCNFM: 1, RCMTM: 1 } },
    ts: 'x', operatorId: 'JARED', tracked: new Set<string>(), services: new Map() };
  assert.equal(planDropZoneSave(state, [{ page: 'ZZ_PCODE_LAB_PG', fieldName: '0...26', subpage: '' }], opts).empty, true);
  assert.throws(() => planDropZoneSave(state, [{ page: 'ZZ_PCODE_LAB_PG', fieldName: '0...99', subpage: 'ZZ_X' }], opts), /no drop zone/);
});
