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
