import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTER_TYPES } from '../db/connection.js';
import { readStructuredSnapshot, type StructuredFamily } from '../providers/structuredSnapshot.js';
import { recordHeaderRequest, recordStructureRequest, aeHeaderDocument, headerProposal, headerChange, structuredHeaderDiff } from '../changeReview/structuredHeaders.js';
import { saveRecord } from '../providers/recordWriter.js';
import { saveAppEngine, readStoredAppEngine, documentOf, appEngineToken } from '../providers/appEngineWriter.js';
import { structuredTransaction } from './fixtures/structuredTransaction.js';
import { hash, type Json } from '../changeReview/model.js';

for (const family of ['record', 'ae'] as const) {
    async function preview(f: ReturnType<typeof structuredTransaction>, before: Awaited<ReturnType<typeof readStructuredSnapshot>>, target: Json, commit = false) {
        const opts = { expectedSnapshotToken: before.token, ...(!commit ? { dryRun: true, captureSnapshots: true } : {}) };
        if (family === 'record') return saveRecord(f.connection, { ...recordHeaderRequest(f.name, before.value, target, before.version, 'JARED'), ...opts }, ADAPTER_TYPES);
        const stored = await readStoredAppEngine(f.connection, ADAPTER_TYPES, f.name, false);
        return saveAppEngine(f.connection, ADAPTER_TYPES, { doc: aeHeaderDocument(f.name, before.value, target, documentOf(stored!)), operatorId: 'JARED', openedToken: appEngineToken(stored), ...opts });
    }
    test(family + ' header native writer executes/validates DML then rolls back full snapshot and counters; normal save commits', async () => {
        const f = structuredTransaction(family), before = await readStructuredSnapshot(f.connection, ADAPTER_TYPES, family, f.name);
        const target = headerProposal(before.value as unknown as Json, family, { description: 'Reviewed header' });
        assert.deepEqual(structuredHeaderDiff(family).compare(before.value as unknown as Json, target).map(d => d.path), [family === 'record' ? '$.tables.PSRECDEFN.RECDESCR' : '$.tables.PSAEAPPLDEFN.DESCR']);
        const result = await preview(f, before, target);
        assert.ok(result.snapshots); assert.equal(result.snapshots.before.hash, before.hash);
        assert.equal(result.snapshots.after.hash, hash(target));
        assert.notEqual(result.snapshots.after.token, before.token);
        assert.deepEqual(f.state(), f.initial); assert.equal(f.counts().commits, 0); assert.equal(f.counts().rollbacks, 1);
        assert.ok(f.counts().updates > 0);
        await preview(f, before, target, true);
        assert.equal(f.counts().commits, 1);
        const after = await readStructuredSnapshot(f.connection, ADAPTER_TYPES, family, f.name);
        assert.equal(after.hash, hash(target));
        assert.equal(after.value.tables[family === 'record' ? 'PSRECDEFN' : 'PSAEAPPLDEFN'][0].FUTURE_COLUMN, 'preserved');
        // The inverse uses typed header edits and new stamps, never row replay.
        await preview(f, after, before.value as unknown as Json, true);
        assert.equal((await readStructuredSnapshot(f.connection, ADAPTER_TYPES, family, f.name)).hash, before.hash);
        assert.equal(f.counts().commits, 2);
    });
    test(family + ' header token catches unversioned edits and after-image failures roll back actual DML', async () => {
        const f = structuredTransaction(family), before = await readStructuredSnapshot(f.connection, ADAPTER_TYPES, family, f.name);
        const target = headerProposal(before.value as unknown as Json, family, { description: 'Reviewed header' });
        f.editCommitted(t => { t[family === 'record' ? 'PSRECDEFN' : 'PSAEAPPLDEFN'][0].FUTURE_COLUMN = 'outside'; });
        await assert.rejects(preview(f, before, target), /snapshot changed/);
        assert.equal(f.counts().updates, 0); assert.equal(f.counts().commits, 0);
        const broken = structuredTransaction(family), b = await readStructuredSnapshot(broken.connection, ADAPTER_TYPES, family, broken.name);
        broken.failAfter();
        await assert.rejects(preview(broken, b, headerProposal(b.value as unknown as Json, family, { description: 'Reviewed header' })), /after snapshot unavailable/);
        assert.deepEqual(broken.state(), broken.initial); assert.equal(broken.counts().commits, 0); assert.ok(broken.counts().updates > 0);
    });
    test(family + ' header projection rejects other native columns, missing tables and cross-definition keys', async () => {
        const f = structuredTransaction(family), before = await readStructuredSnapshot(f.connection, ADAPTER_TYPES, family, f.name);
        const bad = structuredClone(before.value), table = family === 'record' ? 'PSRECDEFN' : 'PSAEAPPLDEFN';
        bad.tables[table][0].FUTURE_COLUMN = 'must never write';
        assert.throws(() => headerChange(before.value, bad, family, f.name), /Only existing-definition/);
        bad.tables[table][0][family === 'record' ? 'RECNAME' : 'AE_APPLID'] = 'OTHER';
        assert.throws(() => headerChange(before.value, bad, family, f.name), /another definition/);
        delete bad.tables[table];
        assert.throws(() => headerChange(before.value, bad, family, f.name), /Incomplete/);
        assert.equal(f.counts().updates, 0);
    });
}
test('Record review refuses Related Language referrers before any DML and refuses creation over an existing name', async () => {
    const f = structuredTransaction('record'), before = await readStructuredSnapshot(f.connection, ADAPTER_TYPES, 'record', f.name);
    const target = headerProposal(before.value as unknown as Json, 'record', { description: 'Reviewed header' });
    const request = recordHeaderRequest(f.name, before.value, target, before.version, 'JARED');
    f.related();
    await assert.rejects(saveRecord(f.connection, { ...request, dryRun: true, captureSnapshots: true }, ADAPTER_TYPES), /Related Language referrers/);
    assert.equal(f.counts().updates, 0);
    await assert.rejects(saveRecord(f.connection, { ...request, edit: { ...request.edit, isNew: true }, dryRun: true }, ADAPTER_TYPES), /already exists|left rows|only new fields/);
});
test('legacy AE plan-only dryRun still does not execute DML', async () => {
    const f = structuredTransaction('ae'), stored = await readStoredAppEngine(f.connection, ADAPTER_TYPES, f.name, false), doc = documentOf(stored!);
    doc.program.descr = 'Plan only';
    const result = await saveAppEngine(f.connection, ADAPTER_TYPES, { doc, openedToken: appEngineToken(stored), operatorId: 'JARED', dryRun: true });
    assert.equal(result.written, false); assert.equal(result.snapshots, undefined); assert.equal(f.counts().updates, 0);
});
test('AE preservation snapshots retain binary PeopleCode losslessly and full native timestamps without executing code', async () => {
    const f = structuredTransaction('ae'), columns = f.connection.catalog.columns, execute = f.connection.execute.bind(f.connection);
    f.connection.catalog.columns = async (c, table) => table === 'PSPCMPROG'
        ? [{ name: 'OBJECTVALUE1', dataType: 'VARCHAR2' }, { name: 'PROGTXT', dataType: 'BLOB' }]
        : (await columns(c, table)).map(col => col.name === 'FUTURE_COLUMN' ? { ...col, dataType: 'TIMESTAMP(9)' } : col);
    let timestampProjection = false;
    f.connection.execute = async <T>(sql: string, ...args: Parameters<typeof execute> extends [string, ...infer R] ? R : never) => {
        if (sql.includes('FROM PSPCMPROG WHERE')) return { rows: [{ OBJECTVALUE1: f.name, PROGTXT: Buffer.from([0, 255, 1, 128]) }] as T[] };
        if (sql.includes('FROM PSAEAPPLDEFN')) timestampProjection = sql.includes('CAST(FUTURE_COLUMN AS TIMESTAMP(9))');
        return execute<T>(sql, ...args);
    };
    f.editCommitted(t => { t.PSAEAPPLDEFN[0].FUTURE_COLUMN = '2026-10-15T12:00:00.123456789'; });
    const read = await readStructuredSnapshot(f.connection, ADAPTER_TYPES, 'ae', f.name);
    assert.deepEqual(read.value.tables.PSPCMPROG[0].PROGTXT, { nativeBinaryHex: '00ff0180' });
    assert.equal(read.value.tables.PSAEAPPLDEFN[0].FUTURE_COLUMN, '2026-10-15T12:00:00.123456789');
    assert.equal(timestampProjection, true); assert.equal(f.counts().updates, 0);
});
test('structured snapshot refuses unsafe native precision and timezone columns without partial checkpoints', async () => {
    for (const family of ['record', 'ae'] as StructuredFamily[]) {
        const f = structuredTransaction(family), head = family === 'record' ? 'PSRECDEFN' : 'PSAEAPPLDEFN';
        f.editCommitted(t => { t[head][0].VERSION = Number.MAX_SAFE_INTEGER + 1; });
        await assert.rejects(readStructuredSnapshot(f.connection, ADAPTER_TYPES, family, f.name), /unsupported|versioned/i);
        const g = structuredTransaction(family), columns = g.connection.catalog.columns;
        g.connection.catalog.columns = async (c, table) => (await columns(c, table)).map(col => col.name === 'LASTUPDDTTM' ? { ...col, dataType: 'TIMESTAMP WITH TIME ZONE' } : col);
        await assert.rejects(readStructuredSnapshot(g.connection, ADAPTER_TYPES, family, g.name), /unsupported.*schema/);
    }
});

test('record field structure: insert/remove/move reproduce exactly; the checkpoint inverse restores a removed field from its own row', async () => {
    const f = structuredTransaction('record');
    // A stored field with a non-default column: restoring it with App Designer's new-row values would not be exact.
    f.editCommitted(t => { t.PSRECFIELD[0].CURCTLFIELDNAME = 'CTRL'; t.PSRECFIELDDB[0].CURCTLFIELDNAME = 'CTRL'; });
    const start = await readStructuredSnapshot(f.connection, ADAPTER_TYPES, 'record', f.name);
    const run = (before: typeof start, target: Json | undefined, edit?: Parameters<typeof saveRecord>[1]['edit'], commit = false) =>
        saveRecord(f.connection, { edit: edit ?? recordStructureRequest(f.name, before.value, target, before.version, 'JARED').edit, operatorId: 'JARED',
            expectedSnapshotToken: before.token, ...(!commit ? { dryRun: true, captureSnapshots: true } : {}) }, ADAPTER_TYPES);
    // Forward: insert NAME before DESCR (the editor's state), previewed with full checkpoints.
    const added = await run(start, undefined, { recname: f.name, recordType: 2, openedVersion: start.version,
        fields: [{ name: 'NAME', useEdit: 0, isNew: true }, { name: 'DESCR', useEdit: 0, useEdit2: 0, isNew: false }] });
    const insertAfter = added.snapshots!.after.value as unknown as Json;
    assert.equal((await run(start, insertAfter)).snapshots!.after.hash, added.snapshots!.after.hash, 'the rebuilt typed edit reproduces the insert');
    await run(start, insertAfter, undefined, true);
    const inserted = await readStructuredSnapshot(f.connection, ADAPTER_TYPES, 'record', f.name);
    assert.equal(inserted.hash, hash(insertAfter));
    // Remove DESCR (and leave NAME), then undo: DESCR comes back with its own CURCTLFIELDNAME, at its place.
    const removed = await run(inserted, undefined, { recname: f.name, recordType: 2, openedVersion: inserted.version, fields: [{ name: 'NAME', useEdit: 0, useEdit2: 0, isNew: false }] });
    const removeAfter = removed.snapshots!.after.value as unknown as Json;
    await run(inserted, removeAfter, undefined, true);
    const gone = await readStructuredSnapshot(f.connection, ADAPTER_TYPES, 'record', f.name);
    await run(gone, inserted.value as unknown as Json, undefined, true);
    const back = await readStructuredSnapshot(f.connection, ADAPTER_TYPES, 'record', f.name);
    assert.equal(back.hash, inserted.hash, 'undoing the removal restores the field row exactly');
    assert.equal(back.value.tables.PSRECFIELD.find(r => r.FIELDNAME === 'DESCR')?.CURCTLFIELDNAME, 'CTRL');
    // Undo the insert: back to the original checkpoint.
    await run(back, start.value as unknown as Json, undefined, true);
    assert.equal((await readStructuredSnapshot(f.connection, ADAPTER_TYPES, 'record', f.name)).hash, start.hash);
    // A restored row outside a reviewed save is refused.
    const restore = recordStructureRequest(f.name, start.value, insertAfter, start.version, 'JARED');
    await assert.rejects(saveRecord(f.connection, { ...restore, edit: { ...restore.edit, openedVersion: (await readStructuredSnapshot(f.connection, ADAPTER_TYPES, 'record', f.name)).version } }, ADAPTER_TYPES), /only done by a reviewed/);
});
