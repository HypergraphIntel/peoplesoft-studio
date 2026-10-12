import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTER_TYPES } from '../db/connection.js';
import {
  addPartition, applyChannelOp, copyChannel, documentFromRows, newChannel, partitionCandidates, rowsFromDocument, setPartition, validateChannel,
  type ChannelDocument, type ChannelOp, type Row
} from '../model/channelDocument.js';
import { channelToken, planChannelDelete, planChannelRename, planChannelSave, type Counters, type StoredChannel } from '../providers/channelWriter.js';
import { channelCaptureExists, counters, deltaRows, rowsOf, storedChannel } from './channelCaptures.js';

/*
 * The message channel writer against App Designer's saves
 * (docs/MESSAGE_CHANNELS.md): each captured action replayed as the Message
 * Channel window's own operations on the channel as it was, and the plan
 * must write App Designer's rows and move its counters; File > Delete and
 * File > Rename planned against the sweeps of App Designer's.
 */

const CHNL = 'ZZ_PCODE_LAB_CHNL';
const CHN4 = 'ZZ_PCODE_LAB_CHN4';
const CHN5 = 'ZZ_PCODE_LAB_CHN5';
/** The fields CHNL's window lists: its message's level-0 record field, then the standard four [CHNL window]. */
const CHNL_CANDIDATES = partitionCandidates([['ZZ_KEY0']]);
/** ZZ_PCODE_LAB_R6's fields without its Long fields L1 and L2, as App Designer lists them for a message on it. */
const R6_FIELDS = ['KEY', 'N1', 'N2', 'N3', 'N4', 'S1', 'S2', 'D1', 'T1', 'DT', 'C08'].map((f) => `ZZ_PCODE_LAB_${f}`);

interface Case {
  name: string;
  channel: string;
  /** The window as App Designer opened it, from the channel before the save (undefined: File > New). */
  open?: (s: StoredChannel) => ChannelDocument;
  ops: ChannelOp[];
}

const opened = (candidates: string[]) => (s: StoredChannel) => documentFromRows(s.rows, [], candidates);

const CASES: Case[] = [
  // File > New, saved at once [chn00]; the dialog given a description before the first save [chn10].
  { name: 'chn00-create', channel: 'ZZ_PCODE_LAB_CHN4', ops: [] },
  { name: 'chn10-create-props', channel: CHN5, ops: [{ kind: 'setChannel', patch: { descr: 'Lab channel five' } }] },
  { name: 'chn01-partition', channel: CHNL, open: opened(CHNL_CANDIDATES), ops: [{ kind: 'setPartition', field: 'ZZ_KEY0', checked: true }] },
  { name: 'chn02-props', channel: CHNL, open: opened(CHNL_CANDIDATES), ops: [{ kind: 'setChannel', patch: { descr: 'Lab channel two', owner: 'HTAC', descrlong: 'Channel comments' } }] },
  { name: 'chn03-use', channel: CHNL, open: opened(CHNL_CANDIDATES), ops: [{ kind: 'setChannel', patch: { status: 'pause', archive: true, unordered: true } }] },
  { name: 'chn04-ordered', channel: CHNL, open: opened(CHNL_CANDIDATES), ops: [{ kind: 'setChannel', patch: { status: 'run', unordered: false } }] },
  { name: 'chn05-partitions', channel: CHNL, open: opened(CHNL_CANDIDATES),
    ops: [{ kind: 'setPartition', field: 'ZZ_KEY0', checked: false }, { kind: 'setPartition', field: 'MSGNAME', checked: true }, { kind: 'setPartition', field: 'PUBLISHER', checked: true }] },
  // Properties OK, nothing changed: status and throughput written explicitly [chn09].
  { name: 'chn09-ok-noop', channel: CHN4, open: opened([]), ops: [{ kind: 'setChannel', patch: {} }] },
  { name: 'chn11-archive-off', channel: CHN5, open: opened([]), ops: [{ kind: 'setChannel', patch: { archive: false } }] },
  // Add Partition Field on a channel without messages; in the window's order, saved as a set [chn12].
  { name: 'chn12-add-fields', channel: CHN5, open: opened([]), ops: [{ kind: 'addPartition', field: 'emplid' }, { kind: 'addPartition', field: 'BUSINESS_UNIT' }] },
  { name: 'chn13-uncheck', channel: CHN5, open: (s) => addPartition(addPartition(opened([])(s), 'EMPLID'), 'BUSINESS_UNIT'), ops: [{ kind: 'setPartition', field: 'EMPLID', checked: false }] },
  { name: 'chn14-readd', channel: CHN5, open: (s) => setPartition(addPartition(addPartition(opened([])(s), 'EMPLID'), 'BUSINESS_UNIT'), 'EMPLID', false),
    ops: [{ kind: 'addPartition', field: 'EMPLID' }] },
  // Reopened: no messages, so no fields listed -- the stored two are dropped and the save deletes them [chn15].
  { name: 'chn15-reopen-save', channel: CHN5, open: opened([]), ops: [{ kind: 'setChannel', patch: { descr: 'Lab channel 5' } }] },
  // App Designer editing a channel this writer made (tools/lab/channel-e2e.mts), its message's R6 fields listed: Pause, PUBPROC checked [nchn01].
  { name: 'nchn01-native-edit', channel: 'ZZ_CHNL_E2E4', open: opened(partitionCandidates([R6_FIELDS])),
    ops: [{ kind: 'setChannel', patch: { status: 'pause' } }, { kind: 'setPartition', field: 'PUBPROC', checked: true }] }
];

const COUNTER_NAMES: (keyof Counters)[] = ['CHDM', 'MSDM', 'PJM', 'SYS'];
const startOf = (caseName: string) => Object.fromEntries(COUNTER_NAMES.map((n) => [n, counters(caseName, 'before')[n] ?? 0])) as unknown as Counters;
function moved(caseName: string): Record<string, number> {
  const b = counters(caseName, 'before');
  const a = counters(caseName, 'after');
  return Object.fromEntries(COUNTER_NAMES.map((n) => [n, (a[n] ?? 0) - (b[n] ?? 0)]).filter(([, d]) => d !== 0));
}

const STAMP = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
const norm = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() === '' ? ' ' : String(v).trim());
const shape = (rows: Row[]) => rows.map((r) => JSON.stringify(Object.keys(r).filter((k) => !STAMP.has(k)).sort().map((k) => [k, norm(r[k])]))).sort();
const OPTS = { operatorId: 'JARED', lastupddttm: '2026-10-12T12:00:00.000000', oracledb: ADAPTER_TYPES };

function edited(c: Case): { before: StoredChannel; doc: ChannelDocument } {
  const before = storedChannel(c.name, 'before', c.channel);
  let doc = c.open ? c.open(before) : newChannel(c.channel);
  for (const op of c.ops) doc = applyChannelOp(doc, op);
  return { before, doc };
}

const present = CASES.filter((c) => channelCaptureExists(c.name));

test('the captures are here', () => {
  assert.equal(present.length, CASES.length, `missing: ${CASES.filter((c) => !channelCaptureExists(c.name)).map((c) => c.name).join(', ')}`);
  for (const k of ['chn06-saveas', 'chn07-rename', 'chn08-delete', 'chn17-rename-refs']) assert.ok(channelCaptureExists(k), k);
});

test('the window\'s operations write the rows App Designer wrote', () => {
  for (const c of present) {
    const { before, doc } = edited(c);
    const p = planChannelSave(before, doc, { ...OPTS, counters: startOf(c.name) });
    const after = (t: string) => rowsOf(c.name, 'after', t, c.channel);
    const [stored] = after('PSCHNLDEFN');
    assert.deepEqual(shape([p.desired.channel]), shape([Object.fromEntries(Object.keys(p.desired.channel).map((k) => [k, stored[k]]))]), `${c.name} PSCHNLDEFN`);
    assert.deepEqual(shape(p.desired.partitions), shape(after('PSSUBCHNL')), `${c.name} PSSUBCHNL`);
    assert.equal(p.counters.CHDM, Number(stored.VERSION), `${c.name} VERSION`);
    assert.deepEqual(p.increments, moved(c.name), `${c.name} counters`);
    assert.equal(stored.LASTUPDOPRID, 'JARED', c.name);
  }
});

test('a sweep shows nothing else written', () => {
  // The create sweep: the channel row and the counters only [chn00].
  const d = JSON.parse(JSON.stringify(deltaRows('chn00-create', 'PSCHNLDEFN')));
  assert.equal(d.inserted.length, 1);
  const p = planChannelSave({ exists: false, rows: { channel: {}, partitions: [], languages: [], nodes: [] }, messages: [], candidates: [], tombstones: [] },
    newChannel('ZZ_PCODE_LAB_CHN4'), { ...OPTS, counters: startOf('chn00-create') });
  assert.deepEqual(p.statements.map((s) => s.what), ['Inserting PSCHNLDEFN', 'Updating PSVERSION CHDM', 'Updating PSLOCK CHDM', 'Updating PSVERSION SYS']);
});

test('Save As copies the properties and the checked partitions under the new name [chn06]', () => {
  const source = storedChannel('chn05-partitions', 'after', CHNL);
  const doc = copyChannel(documentFromRows(source.rows, [], CHNL_CANDIDATES), 'ZZ_PCODE_LAB_CHN2');
  const p = planChannelSave(storedChannel('chn06-saveas', 'before', 'ZZ_PCODE_LAB_CHN2'), doc, { ...OPTS, counters: startOf('chn06-saveas') });
  const after = (t: string) => rowsOf('chn06-saveas', 'after', t, 'ZZ_PCODE_LAB_CHN2');
  const [stored] = after('PSCHNLDEFN');
  assert.deepEqual(shape([p.desired.channel]), shape([Object.fromEntries(Object.keys(p.desired.channel).map((k) => [k, stored[k]]))]));
  assert.deepEqual(shape(p.desired.partitions), shape(after('PSSUBCHNL')));
  assert.equal(p.counters.CHDM, Number(stored.VERSION));
  assert.deepEqual(p.increments, moved('chn06-saveas'));
});

test('File > Delete: the rows, PSCHNLDEL at the new CHDM, CHDM and SYS [chn08]', () => {
  const name = 'ZZ_PCODE_LAB_CHN3';
  const stored: StoredChannel = {
    exists: true, messages: [], candidates: [], tombstones: [],
    rows: { channel: rowsOf('chn08-delete', 'before', 'PSCHNLDEFN', name)[0], partitions: rowsOf('chn08-delete', 'before', 'PSSUBCHNL', name), languages: [], nodes: [] }
  };
  const p = planChannelDelete(stored, startOf('chn08-delete'));
  const [tomb] = deltaRows('chn08-delete', 'PSCHNLDEL').inserted!;
  const ins = p.statements.find((s) => s.what === 'Inserting PSCHNLDEL')!;
  assert.equal(ins.binds.v, Number(tomb.VERSION));
  assert.equal(ins.binds.c, tomb.CHNLNAME);
  const a = counters('chn08-delete', 'after');
  for (const n of COUNTER_NAMES) assert.equal(p.counters[n], a[n], n);
});

for (const [caseName, from, to] of [['chn07-rename', 'ZZ_PCODE_LAB_CHN2', 'ZZ_PCODE_LAB_CHN3'], ['chn17-rename-refs', CHNL, 'ZZ_PCODE_LAB_CHN6']] as const) {
  test(`File > Rename re-keys the channel and repoints its references [${caseName}]`, () => {
    const empty: StoredChannel = { exists: false, rows: { channel: {}, partitions: [], languages: [], nodes: [] }, messages: [], candidates: [], tombstones: [] };
    const stored: StoredChannel = { ...empty, exists: true, rows: { channel: { CHNLNAME: from }, partitions: [], languages: [], nodes: [] } };
    const p = planChannelRename(stored, to, empty, { ...OPTS, counters: startOf(caseName) });
    const a = counters(caseName, 'after');
    for (const n of COUNTER_NAMES) assert.equal(p.counters[n], a[n], `${caseName} ${n}`);
    const changed = (table: string) => deltaRows(caseName, table).updated ?? [];
    const [row] = changed('PSCHNLDEFN');
    assert.equal(row.changes.CHNLNAME.after, to);
    assert.equal(row.changes.CHNLDISPLAYNAME.after, to);
    assert.equal(p.statements.find((s) => s.what === 'Renaming PSCHNLDEFN')!.binds.v, Number(row.changes.VERSION.after));
    for (const r of changed('PSSUBCHNL')) assert.equal(r.changes.CHNLNAME.after, to);
    for (const r of changed('PSMSGDEFN')) {
      assert.equal(r.changes.CHNLNAME.after, to);
      assert.equal(p.statements.find((s) => s.what === 'Repointing PSMSGDEFN')!.binds.v, Number(r.changes.VERSION.after));
    }
    for (const r of changed('PSPROJECTDEFN')) assert.equal(p.statements.find((s) => s.what === 'Updating PSPROJECTDEFN')!.binds.v, Number(r.changes.VERSION.after));
    for (const r of changed('PSPROJECTITEM')) assert.equal(r.changes.OBJECTVALUE1.after, to);
    assert.ok(!(deltaRows(caseName, 'PSCHNLDEL').inserted ?? []).length, 'no tombstone');
  });
}

test('the partition list is App Designer\'s: shared level-0 fields, then the standard four; none without messages', () => {
  assert.deepEqual(partitionCandidates([]), []);
  assert.deepEqual(partitionCandidates([['ZZ_KEY0']]), ['ZZ_KEY0', 'MSGNAME', 'MSGNAMEDETAIL', 'PUBLISHER', 'PUBPROC']);
  // Two messages with no level-0 field in common: the standard four alone (CHN5 with ZZ_PCODE_LAB_MS2 and ZZ_PCODE_LAB_MSG).
  assert.deepEqual(partitionCandidates([['ZZ_PCODE_LAB_KEY', 'ZZ_PCODE_LAB_N1'], ['ZZ_KEY0']]), ['MSGNAME', 'MSGNAMEDETAIL', 'PUBLISHER', 'PUBPROC']);
  assert.deepEqual(partitionCandidates([['A', 'B', 'C'], ['C', 'A']]), ['A', 'C', 'MSGNAME', 'MSGNAMEDETAIL', 'PUBLISHER', 'PUBPROC']);
});

test('opening drops stored partitions the window does not list, and says so', () => {
  const s = storedChannel('chn15-reopen-save', 'before', CHN5);
  const doc = documentFromRows(s.rows, [], []);
  assert.deepEqual(doc.partitions, []);
  assert.deepEqual(doc.dropped, ['BUSINESS_UNIT', 'EMPLID']);
  assert.ok(validateChannel(doc).some((d) => d.code === 'partition-dropped'));
  assert.deepEqual(rowsFromDocument(doc).partitions, []);
});

test('Add Partition Field: uppercased, a duplicate ignored, an unchecked one re-checked', () => {
  let doc = newChannel('ZZ_X');
  doc = addPartition(doc, 'emplid');
  doc = addPartition(doc, 'EMPLID');
  assert.deepEqual(doc.partitions, [{ field: 'EMPLID', checked: true, added: true }]);
  doc = setPartition(doc, 'EMPLID', false);
  doc = addPartition(doc, 'EMPLID');
  assert.deepEqual(doc.partitions, [{ field: 'EMPLID', checked: true, added: true }]);
  assert.throws(() => addPartition(doc, 'NOT A FIELD'));
});

test('the token moves with the version and the partitions', () => {
  const a = storedChannel('chn12-add-fields', 'before', CHN5);
  const b = storedChannel('chn12-add-fields', 'after', CHN5);
  assert.notEqual(channelToken(a), channelToken(b));
  assert.equal(channelToken({ ...a, exists: false }), 'absent');
});
