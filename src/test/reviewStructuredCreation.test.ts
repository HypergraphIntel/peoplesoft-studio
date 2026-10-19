import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTER_TYPES } from '../db/connection.js';
import { structuredTransaction } from './fixtures/structuredTransaction.js';
import { readStructuredForCreation, readStructuredSnapshot } from '../providers/structuredSnapshot.js';
import { saveRecord } from '../providers/recordWriter.js';
import { saveAppEngine } from '../providers/appEngineWriter.js';
import { applyRecordOperations } from '../model/recordOperations.js';
import { RecordType } from '../model/record.js';
import { newProgram } from '../model/aeDocument.js';
import { creationRecordEdit, creationAeDocument, proposedAeReferences } from '../changeReview/structuredCreation.js';
import { hash, type Json } from '../changeReview/model.js';

for (const family of ['record', 'ae'] as const) {
    test(family + ' new definition executes native writer inside rollback, then exact reviewed creation commits once', async () => {
        const f = structuredTransaction(family, true), before = await readStructuredForCreation(f.connection, ADAPTER_TYPES, family, f.name);
        assert.equal(before.value, null);
        const edit = applyRecordOperations({ recname: f.name, recordType: RecordType.DerivedWork, openedVersion: 0, fields: [], isNew: true }, RecordType.DerivedWork,
            [{ op: 'insert_field', field: 'DESCR' }, { op: 'set_properties', description: 'Synthetic state' }]);
        const doc = newProgram(f.name);
        const write = (dryRun: boolean, expectedAfterHash?: string, value?: Json) => family === 'record'
            ? saveRecord(f.connection, { edit: value ? creationRecordEdit(value, f.name) : edit, operatorId: 'JARED', dryRun, captureSnapshots: dryRun, expectedSnapshotToken: before.token, expectedAfterHash }, ADAPTER_TYPES)
            : saveAppEngine(f.connection, ADAPTER_TYPES, { doc: value ? creationAeDocument(value, f.name) : doc, openedToken: 'absent', operatorId: 'JARED', dryRun, captureSnapshots: dryRun, expectedSnapshotToken: before.token, expectedAfterHash });
        const preview = await write(true);
        assert.ok(preview.creationPreview);
        const value = preview.creationPreview.after.value as unknown as Json;
        assert.equal(preview.creationPreview.after.hash, hash(value));
        assert.deepEqual(f.state(), f.initial);
        assert.equal(f.counts().commits, 0);
        assert.ok(f.counts().updates > 0);
        await assert.rejects(write(false, hash({ wrong: true }), value), /differs from the reviewed/);
        assert.deepEqual(f.state(), f.initial);
        assert.equal(f.counts().commits, 0);
        await write(false, hash(value), value);
        assert.equal(f.counts().commits, 1);
        assert.equal((await readStructuredSnapshot(f.connection, ADAPTER_TYPES, family, f.name)).hash, hash(value));
        await assert.rejects(write(false, hash(value), value), /baseline changed|no longer absent/);
    });
    test(family + ' creation scope refuses orphaned child metadata and deletion markers before DML', async () => {
        const f = structuredTransaction(family, true);
        f.editCommitted(t => { t[family === 'record' ? 'PSRECFIELD' : 'PSAESECTDEFN'].push(family === 'record' ? { RECNAME: f.name } : { AE_APPLID: f.name }); });
        await assert.rejects(readStructuredForCreation(f.connection, ADAPTER_TYPES, family, f.name), /orphaned|Snapshot omitted/);
        const g = structuredTransaction(family, true);
        g.editCommitted(t => { t[family === 'record' ? 'PSRECDEL' : 'PSAEAPPLDEL'].push(family === 'record' ? { RECNAME: g.name } : { AE_APPLID: g.name }); });
        await assert.rejects(readStructuredForCreation(g.connection, ADAPTER_TYPES, family, g.name), /deletion markers|orphaned/);
        assert.equal(f.counts().updates + g.counts().updates, 0);
    });
}

test('proposed SQL dependencies supplement only the declared proposal context; live validation sees the database', () => {
    const references = { recordType: async () => undefined, recordFields: async () => undefined, programSections: async () => undefined, messageExists: async () => false };
    const dependency = { id: 'sql-id', adapter: 'sql', key: 'ZZ_ROWS', after: { text: 'SELECT A, B FROM PS_INSTALLATION WHERE A = :1' } };
    const overlay = proposedAeReferences(references, { phase: 'proposal', dependencies: [dependency] });
    assert.deepEqual(overlay?.sql.get('ZZ_ROWS'), { binds: 1, columns: 2 });
    assert.equal(proposedAeReferences(references, { phase: 'live', dependencies: [dependency] }), undefined);
    assert.throws(() => proposedAeReferences(references, { phase: 'proposal', dependencies: [dependency, dependency] }), /Ambiguous/);
});
