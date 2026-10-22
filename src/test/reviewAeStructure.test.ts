import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTER_TYPES } from '../db/connection.js';
import { readStructuredSnapshot, type StructuredSnapshot } from '../providers/structuredSnapshot.js';
import { readStoredAppEngine, documentOf } from '../providers/appEngineWriter.js';
import { aeDocumentFromSnapshot, aeTombstoneProjection } from '../changeReview/aeStructure.js';
import { structuredTransaction } from './fixtures/structuredTransaction.js';
import type { Json } from '../changeReview/model.js';

test('an App Engine checkpoint rebuilds the program document the reader builds', async () => {
    const f = structuredTransaction('ae'), snapshot = await readStructuredSnapshot(f.connection, ADAPTER_TYPES, 'ae', f.name);
    const own = documentOf((await readStoredAppEngine(f.connection, ADAPTER_TYPES, f.name, false))!);
    const rebuilt = aeDocumentFromSnapshot(f.name, snapshot.value);
    // Stamps are not checkpoint content; everything the writer saves from the document is.
    const strip = (d: typeof own) => JSON.parse(JSON.stringify({ ...d, program: { ...d.program, version: 0, lastUpdated: '', lastUpdatedBy: '' },
        sections: d.sections.map((s) => ({ ...s, version: 0 })) }));
    assert.deepEqual(strip(rebuilt), strip(own));
    assert.throws(() => aeDocumentFromSnapshot('ZZ_OTHER', snapshot.value), /another definition/);
});

test('an App Engine undo target may add only the deletion records the undo itself writes', async () => {
    const f = structuredTransaction('ae'), base = (await readStructuredSnapshot(f.connection, ADAPTER_TYPES, 'ae', f.name)).value;
    const withRows = (s: StructuredSnapshot, table: string, rows: Record<string, Json>[]) => ({ ...s, tables: { ...s.tables, [table]: [...s.tables[table], ...rows] } });
    const tomb = { SQLID: 'ZZ_AE_REVIEW MAIN    ADDED   S', SQLTYPE: '1' };
    assert.equal(aeTombstoneProjection(base, base, withRows(base, 'PSSQLDEL', [tomb])), undefined, 'a new deletion record for a removed key');
    assert.match(aeTombstoneProjection(base, withRows(base, 'PSSQLDEL', [tomb]), withRows(base, 'PSSQLDEL', [tomb]))!, /did not write/);
    assert.match(aeTombstoneProjection(withRows(base, 'PSSQLDEL', [tomb]), base, base)!, /remove a deletion record/);
    const changed = structuredClone(base); changed.tables.PSAEAPPLDEFN[0].DESCR = 'Different';
    assert.match(aeTombstoneProjection(base, base, changed)!, /cannot restore PSAEAPPLDEFN/);
    // App Designer's first re-save sets a NULL ASOF_DT to 1900-01-01 [ap01]: an allowed side effect, nothing else is.
    const nullAsOf = structuredClone(base); nullAsOf.tables.PSAEAPPLDEFN[0].ASOF_DT = null;
    const saved = structuredClone(base); saved.tables.PSAEAPPLDEFN[0].ASOF_DT = '1900-01-01T00:00:00.000000000';
    assert.equal(aeTombstoneProjection(nullAsOf, base, saved), undefined);
});
