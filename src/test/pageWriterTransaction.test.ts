import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savePage, type PageSaveRequest } from '../providers/pageWriter.js';
import { pageTransaction } from './fixtures/pageTransaction.js';
import { ADAPTER_TYPES } from '../db/connection.js';
import { readPageSnapshot, requestForPageSnapshot, PAGE_SNAPSHOT_TABLES } from '../providers/pageSnapshot.js';
import { hash } from '../changeReview/model.js';

const request = (): PageSaveRequest => ({ pnlName: 'ZZ_PREVIEW_PAGE', operatorId: 'JARED', openedVersion: 7, controls: [], properties: { description: 'Preview page', comments: 'Preview only' } });

test('Page native writer preview executes and verifies DML then rolls back page and counters', async () => {
    const f = pageTransaction();
    const result = await savePage(f.connection, { ...request(), dryRun: true });
    assert.equal(result.version, 11, 'the returned version is hypothetical');
    assert.deepEqual(f.counts(), { committed: 0, rolledBack: 1, updates: 1 });
    assert.deepEqual(f.state(), f.initial);
    const persisted = pageTransaction();
    assert.equal((await savePage(persisted.connection, request())).version, 11);
    assert.equal(persisted.state().page.DESCR, 'Preview page');
    assert.equal(persisted.state().page.DESCRLONG, 'Preview only');
    assert.equal(persisted.state().pdm, 11);
    assert.equal(persisted.state().sys, 21);
    assert.deepEqual(persisted.counts(), { committed: 1, rolledBack: 0, updates: 1 });
});

test('Page preview validation/readback failures roll back and never commit', async () => {
    for (const mode of ['stale', 'readback']) {
        const f = pageTransaction();
        if (mode === 'readback') f.failReadback();
        await assert.rejects(savePage(f.connection, { ...request(), dryRun: true, openedVersion: mode === 'stale' ? 6 : 7 }), /changed since|did not land/);
        assert.deepEqual(f.state(), f.initial);
        assert.equal(f.counts().committed, 0);
        assert.equal(f.counts().rolledBack, 1);
        assert.equal(f.counts().updates, mode === 'stale' ? 0 : 1);
    }
});

test('unchanged Page preview releases its transaction without touching rows or counters', async () => {
    const f = pageTransaction();
    const r = await savePage(f.connection, { ...request(), properties: undefined, dryRun: true });
    assert.equal(r.version, 7);
    assert.deepEqual(f.counts(), { committed: 0, rolledBack: 1, updates: 0 });
    assert.deepEqual(f.state(), f.initial);
});

test('Page preview captures exact native scoped rows before rollback, with full CLOB text and separate content/token identity', async () => {
    const longText = 'Full native text '.repeat(500);
    const f = pageTransaction({ PSPNLFIELDEXT: [{ PNLNAME: 'ZZ_PREVIEW_PAGE', PNLFLDID: 1, FFSTYLELONG: longText, FUTURE_COLUMN: null }],
        PSPNLHTMLAREA: [{ PNLNAME: 'ZZ_PREVIEW_PAGE', PNLFLDID: 1, HTMLAREA: '<div>' + longText + '</div>' }],
        PSPNLTREECTRL: [{ PNLNAME: 'ZZ_PREVIEW_PAGE', TREECTRLID: 1, TREELEVEL: 2 }, { PNLNAME: 'ZZ_PREVIEW_PAGE', TREECTRLID: 1, TREELEVEL: 1 }] });
    const result = await savePage(f.connection, { ...request(), dryRun: true, captureSnapshots: true }, ADAPTER_TYPES);
    assert.ok(result.snapshots);
    const { before, after } = result.snapshots;
    assert.equal(before.version, 7); assert.equal(after.version, 11);
    assert.equal(before.value.tables.PSPNLDEFN[0].DESCR, 'Original page');
    assert.equal(after.value.tables.PSPNLDEFN[0].DESCR, 'Preview page');
    assert.equal(after.value.tables.PSPNLFIELDEXT[0].FFSTYLELONG, longText);
    assert.equal(after.value.tables.PSPNLHTMLAREA[0].HTMLAREA, '<div>' + longText + '</div>');
    assert.equal(after.value.tables.PSPNLFIELDEXT[0].FUTURE_COLUMN, null);
    assert.deepEqual(Object.keys(after.value.tables), [...PAGE_SNAPSHOT_TABLES]);
    assert.equal('VERSION' in after.value.tables.PSPNLDEFN[0], false);
    assert.equal('LASTUPDDTTM' in after.value.tables.PSPNLDEFN[0], false);
    assert.notEqual(before.hash, after.hash);
    assert.equal(after.hash, hash(after.value));
    assert.notEqual(before.token, after.token);
    assert.deepEqual(f.state(), f.initial);
    const live = await readPageSnapshot(f.connection, ADAPTER_TYPES, 'ZZ_PREVIEW_PAGE');
    assert.equal(live.token, before.token);
    assert.equal(live.hash, before.hash);
    assert.deepEqual(f.counts(), { committed: 0, rolledBack: 1, updates: 1 });
});

test('Page snapshot failures roll back and snapshots cannot be requested on a committing save', async () => {
    const f = pageTransaction({ PSPNLFIELDEXT: [{ PNLNAME: 'ZZ_PREVIEW_PAGE', PNLFLDID: 1, UNSUPPORTED: Buffer.from('opaque') }] });
    await assert.rejects(savePage(f.connection, { ...request(), dryRun: true, captureSnapshots: true }, ADAPTER_TYPES), /unsupported native value/);
    assert.deepEqual(f.state(), f.initial);
    assert.deepEqual(f.counts(), { committed: 0, rolledBack: 1, updates: 0 });
    const normal = pageTransaction();
    await assert.rejects(savePage(normal.connection, { ...request(), captureSnapshots: true }, ADAPTER_TYPES), /rollback preview/);
    assert.deepEqual(normal.counts(), { committed: 0, rolledBack: 0, updates: 0 });
});

test('unchanged Page snapshots retain identical content and native tokens after rollback', async () => {
    const f = pageTransaction();
    const result = await savePage(f.connection, { ...request(), properties: undefined, dryRun: true, captureSnapshots: true }, ADAPTER_TYPES);
    assert.ok(result.snapshots);
    assert.deepEqual(result.snapshots.before, result.snapshots.after);
    assert.deepEqual(f.state(), f.initial);
    assert.deepEqual(f.counts(), { committed: 0, rolledBack: 1, updates: 0 });
});

test('failure to capture the native after-image rolls back completed DML', async () => {
    const f = pageTransaction(), columns = f.connection.catalog.columns;
    let heads = 0;
    f.connection.catalog.columns = async (c, table) => {
        if (table === 'PSPNLDEFN' && ++heads === 2) throw new Error('after-image unavailable');
        return columns(c, table);
    };
    await assert.rejects(savePage(f.connection, { ...request(), dryRun: true, captureSnapshots: true }, ADAPTER_TYPES), /after-image unavailable/);
    assert.deepEqual(f.state(), f.initial);
    assert.deepEqual(f.counts(), { committed: 0, rolledBack: 1, updates: 1 });
});

test('full Page token guard catches unversioned native changes inside the locked writer', async () => {
    const f = pageTransaction(), before = await readPageSnapshot(f.connection, ADAPTER_TYPES, 'ZZ_PREVIEW_PAGE');
    f.editCommitted(s => { s.page.DESCR = 'External edit'; });
    await assert.rejects(savePage(f.connection, { ...request(), expectedSnapshotToken: before.token }, ADAPTER_TYPES), /snapshot changed/);
    assert.equal(f.state().page.VERSION, 7);
    assert.equal(f.state().page.DESCR, 'External edit');
    assert.deepEqual(f.counts(), { committed: 0, rolledBack: 1, updates: 0 });
});

test('Page snapshots retain full timestamp text and ignore relational row storage order', async () => {
    const f = pageTransaction({ PSPNLTREECTRL: [{ PNLNAME: 'ZZ_PREVIEW_PAGE', TREECTRLID: 1, TREELEVEL: 2, STAMP: '2026-10-15T10:00:00.123456789' },
        { PNLNAME: 'ZZ_PREVIEW_PAGE', TREECTRLID: 1, TREELEVEL: 1, STAMP: null }] });
    const execute = f.connection.execute.bind(f.connection), columns = f.connection.catalog.columns;
    let precisionProjection = false;
    f.connection.catalog.columns = async (c, table) => (await columns(c, table)).map(col => col.name === 'STAMP' ? { ...col, dataType: 'TIMESTAMP(9)' } : col);
    f.connection.execute = async (...args) => { if (args[0].includes('FROM PSPNLTREECTRL')) precisionProjection = args[0].includes('CAST(STAMP AS TIMESTAMP(9))'); return execute(...args); };
    const before = await readPageSnapshot(f.connection, ADAPTER_TYPES, 'ZZ_PREVIEW_PAGE');
    f.editCommitted(s => { s.tables.PSPNLTREECTRL.reverse(); });
    const after = await readPageSnapshot(f.connection, ADAPTER_TYPES, 'ZZ_PREVIEW_PAGE');
    assert.equal(precisionProjection, true);
    assert.equal(before.hash, after.hash);
    assert.equal(before.token, after.token);
    assert.equal(after.value.tables.PSPNLTREECTRL.find(r => r.TREELEVEL === 2)?.STAMP, '2026-10-15T10:00:00.123456789');
});

test('Page projection accepts native SECUREINVISIBLE character flags without coercing snapshots or geometry', async () => {
    // HRDMO ZZ_PCODE_LAB_PG control 2, observed in a rollback-only preview.
    const row = { PNLNAME: 'ZZ_PREVIEW_PAGE', PNLFLDID: 2, FIELDNUM: 1,
        FIELDLEFT: 360, FIELDTOP: 20, FIELDRIGHT: 536, FIELDBOTTOM: 38,
        EDITLBLLEFT: 384, EDITLBLTOP: -100, EDITLBLRIGHT: 384, EDITLBLBOTTOM: -100,
        LBLTYPE: 1, LBLTEXT: 'My Label', FIELDUSE: 0, FIELDSIZETYPE: 2, SECUREINVISIBLE: '0' };
    const f = pageTransaction({ PSPNLFIELD: [row] });
    const before = await readPageSnapshot(f.connection, ADAPTER_TYPES, 'ZZ_PREVIEW_PAGE');
    for (const flag of ['0', '1']) {
        const after = structuredClone(before.value);
        after.tables.PSPNLFIELD[0].SECUREINVISIBLE = flag;
        const originalHash = hash(after);
        const request = requestForPageSnapshot('ZZ_PREVIEW_PAGE', before.value, after, 7, 'JARED');
        assert.equal(request.controls[0].secureInvisible, Number(flag));
        assert.equal(after.tables.PSPNLFIELD[0].SECUREINVISIBLE, flag);
        assert.equal(hash(after), originalHash);
    }
    for (const flag of [' ', '', '2', '01', 'true', null]) {
        const after = structuredClone(before.value);
        after.tables.PSPNLFIELD[0].SECUREINVISIBLE = flag;
        assert.throws(() => requestForPageSnapshot('ZZ_PREVIEW_PAGE', before.value, after, 7, 'JARED'), /SECUREINVISIBLE/);
    }
    const after = structuredClone(before.value);
    after.tables.PSPNLFIELD[0].FIELDLEFT = '360';
    assert.throws(() => requestForPageSnapshot('ZZ_PREVIEW_PAGE', before.value, after, 7, 'JARED'), /FIELDLEFT/);
});

const field = (id: number, num: number, top: number, extra: Record<string, unknown> = {}) => ({ PNLNAME: 'ZZ_PREVIEW_PAGE', PNLFLDID: id, FIELDNUM: num, FIELDTYPE: 0,
    FIELDLEFT: 10, FIELDTOP: top, FIELDRIGHT: 0, FIELDBOTTOM: 0, EDITLBLLEFT: 0, EDITLBLTOP: 0, EDITLBLRIGHT: 0, EDITLBLBOTTOM: 0, FIELDSIZETYPE: 0,
    LBLTYPE: 1, LBLTEXT: 'Text ' + id, FIELDUSE: 0, SECUREINVISIBLE: '0', OCCURSLEVEL: 0, RECNAME: ' ', FIELDNAME: ' ', ASSOCFIELDNUM: 0, DSPLFORMAT: 1, ...extra });
const extRow = (id: number) => ({ PNLNAME: 'ZZ_PREVIEW_PAGE', PNLFLDID: id, FFSTYLELONG: ' ', PARENTPNLFLDID: 'ZZ_PREVIEW_PAGE$0', PAGEPNLFLDID: 'ZZ_PREVIEW_PAGE$0' });
const structural = () => pageTransaction({ PSPNLFIELD: [field(1, 1, 20), field(2, 2, 60), field(3, 3, 100)], PSPNLFIELDEXT: [extRow(1), extRow(2), extRow(3)],
    PSPNLHTMLAREA: [{ PNLNAME: 'ZZ_PREVIEW_PAGE', PNLFLDID: 2, HTMLAREA: '<b>kept with its control</b>' }] });

test('structural Page review: insert/delete/order reproduce exactly, and the checkpoint inverse and redo restore ids, rows and the high-water mark', async () => {
    const f = structural();
    const add = { pnlFldId: -1, fieldLeft: 10, fieldTop: 40, fieldRight: 0, fieldBottom: 0, editLblLeft: 0, editLblTop: 0, editLblRight: 0, editLblBottom: 0,
        fieldSizeType: 0, lblType: 1, lblText: 'Added', fieldUse: 0, secureInvisible: 0, add: { kind: 'staticText' as const, recName: '', fieldName: '' } };
    const start = await readPageSnapshot(f.connection, ADAPTER_TYPES, 'ZZ_PREVIEW_PAGE');
    const base = requestForPageSnapshot('ZZ_PREVIEW_PAGE', start.value, start.value, 7, 'JARED');
    // Delete control 2 (and its HTML row with it), add a Static Text between 1 and 3, and put 3 first.
    const preview = await savePage(f.connection, { pnlName: 'ZZ_PREVIEW_PAGE', openedVersion: 7, operatorId: 'JARED',
        controls: [...base.controls.filter(c => c.pnlFldId !== 2), add], order: [3, 1], dryRun: true, captureSnapshots: true }, ADAPTER_TYPES);
    const { before, after } = preview.snapshots!;
    assert.deepEqual(after.value.tables.PSPNLFIELD.map(r => [r.PNLFLDID, r.FIELDNUM]).sort(), [[1, 2], [3, 1], [4, 3]]);
    assert.equal(after.value.tables.PSPNLDEFN[0].MAXPNLFLDID, 4);
    assert.deepEqual(after.value.tables.PSPNLHTMLAREA, []);
    assert.deepEqual(f.state(), f.initial);
    // Review validation: the typed request rebuilt from the snapshots reproduces the whole after-image.
    const forward = requestForPageSnapshot('ZZ_PREVIEW_PAGE', before.value, after.value, 7, 'JARED');
    assert.ok(forward.controls.find(c => c.pnlFldId === 4)?.restore?.PSPNLFIELD);
    const replay = await savePage(f.connection, { ...forward, dryRun: true, captureSnapshots: true, expectedSnapshotToken: before.token }, ADAPTER_TYPES);
    assert.equal(replay.snapshots!.after.hash, after.hash);
    await savePage(f.connection, { ...forward, expectedSnapshotToken: before.token }, ADAPTER_TYPES);
    const applied = await readPageSnapshot(f.connection, ADAPTER_TYPES, 'ZZ_PREVIEW_PAGE');
    assert.equal(applied.hash, after.hash);
    // Checkpoint inverse: control 2 and its HTML row come back under id 2; the added 4 goes and MAXPNLFLDID returns to 3.
    const inverse = requestForPageSnapshot('ZZ_PREVIEW_PAGE', applied.value, before.value, applied.version, 'JARED');
    await savePage(f.connection, { ...inverse, expectedSnapshotToken: applied.token }, ADAPTER_TYPES);
    const restored = await readPageSnapshot(f.connection, ADAPTER_TYPES, 'ZZ_PREVIEW_PAGE');
    assert.equal(restored.hash, before.hash, 'the checkpoint is restored exactly');
    assert.equal(f.state().page.MAXPNLFLDID, 3);
    // Redo: the added control returns under its reviewed id 4.
    const redo = requestForPageSnapshot('ZZ_PREVIEW_PAGE', restored.value, after.value, restored.version, 'JARED');
    await savePage(f.connection, { ...redo, expectedSnapshotToken: restored.token }, ADAPTER_TYPES);
    assert.equal((await readPageSnapshot(f.connection, ADAPTER_TYPES, 'ZZ_PREVIEW_PAGE')).hash, after.hash);
});

test('restoring rows or lowering MAXPNLFLDID is refused outside a reviewed snapshot-guarded save', async () => {
    const f = structural();
    const start = await readPageSnapshot(f.connection, ADAPTER_TYPES, 'ZZ_PREVIEW_PAGE');
    const without = structuredClone(start.value);
    without.tables.PSPNLFIELD = without.tables.PSPNLFIELD.filter(r => r.PNLFLDID !== 3);
    without.tables.PSPNLFIELDEXT = without.tables.PSPNLFIELDEXT.filter(r => r.PNLFLDID !== 3);
    // Releasing id 3 by lowering the high-water mark needs the guard.
    const lower = requestForPageSnapshot('ZZ_PREVIEW_PAGE', start.value, { ...without, tables: { ...without.tables, PSPNLDEFN: [{ ...without.tables.PSPNLDEFN[0], MAXPNLFLDID: 2 }] } }, 7, 'JARED');
    await assert.rejects(savePage(f.connection, lower), /only done by a reviewed/);
    // A plain manual save built from snapshots without structural change remains an ordinary save.
    const same = requestForPageSnapshot('ZZ_PREVIEW_PAGE', start.value, start.value, 7, 'JARED');
    await savePage(f.connection, { ...same, properties: { description: 'Manual', comments: '' } });
    assert.equal(f.state().page.DESCR, 'Manual');
});
