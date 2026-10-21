/** Actual HRDMO Windows App Designer captures behind the migration adapters (ix01, sb01, pk01, pk02), not simulated writer behavior. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { userIndexRefusal } from '../providers/recordWriter.js';
import { RecordType } from '../model/record.js';
type Rows = { tables: Record<string, { before: Record<string, unknown>[]; after: Record<string, unknown>[] }> };
const load = (name: string, file: string) => JSON.parse(readFileSync(path.resolve('tools/corpus/save-protocol/results', name, file), 'utf8'));
function counters(name: string) {
  const d = load(name, 'delta.json');
  assert.equal(d.database, 'HRDMO'); assert.match(d.peopleToolsRelease, /^8\.62/); assert.deepEqual(d.summary.incomplete, []);
  return { version: Object.fromEntries(Object.entries(d.summary.psversion).map(([k, v]) => [k, (v as { delta: number }).delta])), lock: Object.fromEntries(Object.entries(d.summary.pslock).map(([k, v]) => [k, (v as { delta: number }).delta])) };
}

test('ix01: Add Index stores one INDEXTYPE 4 row and its keys, raises INDEXCOUNT at the new RDM, and moves RDM/SYS once', () => {
  assert.deepEqual(counters('ix01-native-user-index-add'), { version: { RDM: 1, SYS: 1 }, lock: { RDM: 1 } });
  const rows = load('ix01-native-user-index-add', 'record-rows.json') as Rows, t = rows.tables;
  assert.deepEqual(t.PSINDEXDEFN.before, []); assert.equal(t.PSINDEXDEFN.after.length, 1);
  const index = t.PSINDEXDEFN.after[0], keys = t.PSKEYDEFN.after;
  assert.deepEqual([index.INDEXID, index.INDEXTYPE, index.UNIQUEFLAG, index.CLUSTERFLAG, index.ACTIVEFLAG, index.CUSTKEYORDER, index.KEYCOUNT, index.DDLCOUNT, index.IDXCOMMENTS], ['A', 4, 0, 0, 1, 1, 2, 0, 'Capture index']);
  assert.deepEqual([index.PLATFORM_DB2, index.PLATFORM_ORA, index.PLATFORM_MSS, index.PLATFORM_SBS], [1, 1, 1, 0]);
  assert.deepEqual(keys.map(k => [k.KEYPOSN, k.FIELDNAME, k.ASCDESC]), [[1, 'DESCR', 1], [2, 'EFF_STATUS', 1]]);
  const [before] = t.PSRECDEFN.before, [after] = t.PSRECDEFN.after;
  assert.equal(Number(after.INDEXCOUNT), Number(before.INDEXCOUNT) + 1); assert.equal(Number(after.VERSION), Number(before.VERSION) + 1);
  for (const table of ['PSRECFIELD', 'PSRECFIELDDB', 'PSRECTBLSPC', 'PSIDXDDLPARM']) assert.deepEqual([t[table].before, t[table].after], [[], []], table);
  // The writer accepts exactly App Designer's rows for the record's fields.
  const strip = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'RECNAME')) as never;
  assert.equal(userIndexRefusal([{ index: strip(index), keys: keys.map(strip) }], ['EMPLID', 'EFFDT', 'DESCR', 'EFF_STATUS']), undefined);
  assert.match(userIndexRefusal([{ index: strip({ ...index, DDLCOUNT: 1 }), keys: keys.map(strip) }], ['DESCR', 'EFF_STATUS'])!, /custom DDL/);
  assert.match(userIndexRefusal([{ index: strip(index), keys: keys.map(strip) }], ['DESCR'])!, /record's fields/);
});

test('sb01: a new SubRecord is a Derived/Work-shaped creation with RECTYPE 3, no index or tablespace, RDM/SYS once', () => {
  assert.deepEqual(counters('sb01-native-subrecord-create'), { version: { RDM: 1, SYS: 1 }, lock: { RDM: 1 } });
  const t = (load('sb01-native-subrecord-create', 'record-rows.json') as Rows).tables;
  assert.deepEqual(t.PSRECDEFN.after.map(r => [r.RECTYPE, r.FIELDCOUNT, r.INDEXCOUNT]), [[RecordType.Subrecord, 1, 0]]);
  assert.deepEqual(t.PSRECFIELD.after.map(r => [r.FIELDNAME, r.SUBRECORD, r.USEEDIT]), [['DESCR', 'N', 8388608]]);
  assert.deepEqual(t.PSRECFIELDDB.after.map(r => [r.FIELDNAME, r.RECNAME_PARENT]), [['DESCR', 'ZZ_PCODE_LAB_SB']]);
  for (const table of ['PSINDEXDEFN', 'PSKEYDEFN', 'PSRECTBLSPC']) assert.deepEqual(t[table].after, [], table);
  for (const table of Object.keys(t)) assert.deepEqual(t[table].before, [], table);
});

test('pk01/pk02: Package Properties live on the root row; every save moves all package rows to the new APM; new subpackages start unowned', () => {
  for (const name of ['pk01-native-package-properties', 'pk02-native-subpackage-under-owned-root']) assert.deepEqual(counters(name), { version: { APM: 1, SYS: 1 }, lock: { APM: 1 } });
  type Change = { key: Record<string, string>; changes: Record<string, { before: unknown; after: unknown }> };
  const watch = (name: string) => load(name, 'delta.json').watch.PSPACKAGEDEFN as { inserted: Record<string, unknown>[]; updated: Change[] };
  const props = watch('pk01-native-package-properties');
  const root = props.updated.find(u => u.key.QUALIFYPATH === '.')!, sub = props.updated.find(u => u.key.PACKAGEID === 'SUB')!;
  assert.deepEqual(Object.keys(root.changes).sort(), ['DESCR', 'DESCRLONG', 'LASTUPDDTTM', 'OBJECTOWNERID', 'VERSION']);
  assert.deepEqual([root.changes.DESCR.after, root.changes.DESCRLONG.after, root.changes.OBJECTOWNERID.after], ['Capture package', 'Capture comments', 'PPTD']);
  assert.deepEqual(Object.keys(sub.changes).sort(), ['LASTUPDDTTM', 'VERSION']);
  const inserted = watch('pk02-native-subpackage-under-owned-root');
  assert.deepEqual(inserted.inserted.map(r => [r.PACKAGEID, r.OBJECTOWNERID, r.DESCR, r.DESCRLONG]), [['SUB2', ' ', ' ', null]]);
  assert.equal(inserted.updated.length, 2);
});

test('dl01-dl13: File > Delete and recreation of pages, components, fields, packages and classes, as the deletion writers reproduce them', () => {
  const rows = (name: string) => (load(name, 'definition-rows.json') as Rows).tables;
  const after = (name: string, type: string) => (load(name, 'delta.json').summary.psversion[type] as { after: number }).after;
  const deleted = { PSPNLDEL: 'dl01-native-page-delete', PSPNLGRPDEL: 'dl02-native-component-delete', PSPACKAGEDEL: 'dl04-native-package-delete' };
  assert.deepEqual(counters('dl01-native-page-delete'), { version: { PCM: 1, PDM: 1, SYS: 1 }, lock: { PCM: 1, PDM: 1 } });
  assert.deepEqual(counters('dl06-native-page-without-peoplecode-delete'), { version: { PDM: 1, SYS: 1 }, lock: { PDM: 1 } });
  assert.deepEqual(counters('dl02-native-component-delete'), { version: { MDM: 1, PCM: 1, PGM: 1, SYS: 1 }, lock: { MDM: 1, PCM: 1, PGM: 1 } });
  assert.deepEqual(counters('dl07-native-component-without-peoplecode-delete'), { version: { MDM: 1, PGM: 1, SYS: 1 }, lock: { MDM: 1, PGM: 1 } });
  for (const name of ['dl03-native-field-delete', 'dl08-native-field-without-translates-delete']) {
    assert.deepEqual(counters(name), { version: { RDM: 1, SYS: 1, XTM: 1 }, lock: { RDM: 1, XTM: 1 } });
    for (const [table, v] of Object.entries(rows(name))) assert.deepEqual(v.after, [], 'no tombstone: ' + table);
  }
  assert.deepEqual(counters('dl04-native-package-delete'), { version: { APM: 1, PCM: 2, SYS: 1 }, lock: { APM: 1, PCM: 2 } });
  assert.deepEqual(counters('dl05-native-package-two-classes-delete'), { version: { APM: 1, PCM: 3, SYS: 1 }, lock: { APM: 1, PCM: 3 } });
  assert.deepEqual(counters('dl10-native-empty-package-delete'), { version: { APM: 1, PCM: 1, SYS: 1 }, lock: { APM: 1, PCM: 1 } });
  assert.deepEqual(counters('dl09-native-class-delete'), { version: { APM: 1, PBM: 1, PCM: 1, SYS: 2 }, lock: { APM: 1, PBM: 1, PCM: 1 } });
  // Tombstones take the new counter value of their kind.
  assert.equal(rows(deleted.PSPNLDEL).PSPNLDEL.after[0].VERSION, after(deleted.PSPNLDEL, 'PDM'));
  assert.equal(rows(deleted.PSPNLGRPDEL).PSPNLGRPDEL.after[0].VERSION, after(deleted.PSPNLGRPDEL, 'PGM'));
  assert.equal(rows(deleted.PSPACKAGEDEL).PSPACKAGEDEL.after[0].VERSION, after(deleted.PSPACKAGEDEL, 'APM'));
  for (const name of ['dl01-native-page-delete', 'dl02-native-component-delete', 'dl04-native-package-delete', 'dl09-native-class-delete'])
    assert.equal(rows(name).PSPCMPROGDEL.after.at(-1)!.VERSION, after(name, 'PCM'), name);
  // Two classes: the base PCM step, then one per class in descending QUALIFYPATH (deletePackage).
  const two = rows('dl05-native-package-two-classes-delete').PSPCMPROGDEL.after.map(r => [r.OBJECTVALUE2, r.VERSION]).sort((a, b) => Number(a[1]) - Number(b[1]));
  const pcm = after('dl05-native-package-two-classes-delete', 'PCM');
  assert.deepEqual(two, [['UI', pcm - 1], ['Top', pcm]]);
  // Saving a deleted name again clears its tombstone and is otherwise an ordinary creation.
  for (const [name, table] of [['dl11-native-package-recreate-deleted-name', 'PSPACKAGEDEL'], ['dl12-native-page-recreate-deleted-name', 'PSPNLDEL'], ['dl13-native-component-recreate-deleted-name', 'PSPNLGRPDEL']]) {
    assert.equal(rows(name)[table].before.length, 1, name); assert.deepEqual(rows(name)[table].after, [], name);
  }
});
