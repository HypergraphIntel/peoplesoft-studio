import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ADAPTER_TYPES } from '../db/connection.js';
import { inputForIb, IB_STAMPS } from '../model/ibOperations.js';
import { readIb } from '../providers/ibReader.js';
import { saveIb } from '../providers/ibWriter.js';
import { ibTransaction } from './fixtures/ibTransaction.js';

type Rows = Record<string, Record<string, unknown>[]>;
const captures: Array<{ case: string; before: Rows; after: Rows }> = JSON.parse(readFileSync('src/test/fixtures/ib-native-8.62.09/handler-lifecycle.json', 'utf8'));
const normalize = (rows: Rows[string]) => rows.map(row => Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'LASTUPDDTTM'))).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

for (const capture of captures) test(capture.case + ': real writer reproduces native scoped rows, tombstones and counters', async () => {
    const name = 'ZZ_PCODE_LAB_IBO';
    const f = ibTransaction('operation', true, { name, schemaRows: capture.after, nativeRows: { ...capture.before, PSAPPCLASSDEFN: [{ PACKAGEROOT: 'PT_IB_INTROSPECTION', QUALIFYPATH: ':', APPCLASSID: 'Introspection' }] } });
    const live = (await readIb(f.connection, ADAPTER_TYPES, 'operation', [name]))!, input = inputForIb(live);
    for (const [section, table] of [['handlers','PSOPRHDLR'], ['applicationClassHandlers','PSOPERATIONAC']])
        input.sections[section] = capture.after[table].map(row => Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'IB_OPERATIONNAME' && !IB_STAMPS.has(k)))) as typeof input.sections[string];
    const initial = f.state();
    const preview = await saveIb(f.connection, ADAPTER_TYPES, { input, expectedToken: live.token, operatorId: 'JARED', dryRun: true, captureSnapshots: true });
    assert.equal(preview.written, false); assert.deepEqual(f.state(), initial, 'native-protocol preview restores rows and markers');
    await saveIb(f.connection, ADAPTER_TYPES, { input, expectedToken: live.token, operatorId: 'JARED', expectedSnapshotToken: preview.snapshots!.before.token, expectedAfterHash: preview.snapshots!.after.hash });
    for (const [table, expected] of Object.entries(capture.after)) assert.deepEqual(normalize(f.state()[table]), normalize(expected), table + ' differs from captured native result');
});
