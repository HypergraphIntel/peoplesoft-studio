/** Studio-written HRDMO queries with typed criteria (qcr/qnm calibration) for Windows Query reopen, SQL and results checks. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { DatabaseProvider } from '../../src/providers/database.js';
import { makeKey } from '../../src/model/definitions.js';
import { applyQueryOp, newQueryDocument, type QueryCriterion, type QueryFieldInfo } from '../../src/model/queryDocument.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';

const config = { name: 'HRDMO Query criteria acceptance', platform: 'oracle' as const,
    connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! };
assert.match(config.connectString, /hrdmo/i); assert.ok(config.user && config.password);
const p = new DatabaseProvider(config), operatorId = process.env.PSLAB_OPERATOR ?? 'JARED', mode = process.argv[2] ?? 'dry';
if (!['dry', 'save', 'run'].includes(mode)) throw new Error('Use dry, save or run.');
setWriteNamePrefix('ZZ_QRY_STUDIO_');
const report: Record<string, unknown> = { at: new Date().toISOString(), mode, database: 'HRDMO', owner: operatorId };
async function metadata(record: string, names: string[]): Promise<Record<string, QueryFieldInfo>> {
    const layout = (await p.readRecordLayout(makeKey(0, record)))!;
    return Object.fromEntries(names.map(name => {
        const f = layout.fields.find(x => x.name === name)!; assert.ok(f, record + '.' + name);
        return [name, { type: f.type, length: f.length, decimalPositions: f.decimalPositions ?? 0, format: f.format ?? 0, shortName: f.shortName, longName: f.longName, editTable: f.editTable, useEdit: f.useEdit }];
    }));
}
const queries: Array<{ name: string; record: string; fields: string[]; criteria: QueryCriterion[]; prompts: Record<string, string> }> = [
    { name: 'ZZ_QRY_STUDIO_CRIT', record: 'AAP_TBL', fields: ['DESCR', 'ESTABID'], prompts: {}, criteria: [
        { field: 'ESTABID', operator: 'notEqual', not: true, value: { field: 'DESCR' } },
        { field: 'DESCR', operator: 'isNull', logical: 'OR', open: 1 },
        { field: 'ESTABID', operator: 'inList', logical: 'AND', close: 1, value: { list: ['A', 'B'] } },
        { field: 'DESCR', operator: 'like', logical: 'OR', value: { constant: '%' } }] },
    { name: 'ZZ_QRY_STUDIO_NUM', record: 'AAP_YEAR', fields: ['ESTABID', 'START_DT', 'FEMALE_GOAL'], prompts: { '1': '1900-01-01' }, criteria: [
        { field: 'FEMALE_GOAL', operator: 'notLess', value: { constant: '0' } },
        { field: 'START_DT', operator: 'greater', logical: 'AND', value: { prompt: 'new' } }] }
];
try {
    await p.connect();
    assert.equal((await p.runReadOnlyQuery("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL", 1)).rows[0].DB, 'HRDMO');
    const results: unknown[] = [];
    for (const q of queries) {
        const fields = await metadata(q.record, q.fields);
        let view = newQueryDocument(q.name, operatorId, q.record);
        for (const field of q.fields) view = applyQueryOp(view, { kind: 'select', field, selected: true }, fields);
        view = applyQueryOp(view, { kind: 'criteria', criteria: q.criteria }, fields);
        view = applyQueryOp(view, { kind: 'properties', description: 'Studio criteria verification', comments: '' }, fields);
        const existing = await p.readQueryDocument(q.name, operatorId);
        if (mode === 'save') {
            assert.equal(existing, undefined, q.name + ' already exists; never reuse a verification query.');
            await p.saveQueryDocument({ view, openedToken: 'absent', operatorId });
        } else if (mode === 'dry') {
            assert.equal(existing, undefined, q.name + ' already exists.');
            const r = await p.saveQueryDocument({ view, openedToken: 'absent', operatorId, dryRun: true });
            assert.equal(r.written, false);
        }
        const stored = mode === 'dry' ? view : (await p.readQueryDocument(q.name, operatorId))!.view;
        const run = await p.runQuery(stored, operatorId, q.prompts);
        results.push({ name: q.name, sql: run.sql, prompts: q.prompts, rows: run.rows });
        console.log(`${q.name}\n${run.sql}\n${JSON.stringify(run.rows)}`);
    }
    report.queries = results; report.passed = true;
} finally {
    if (mode !== 'dry') await writeFile('tools/lab/results/query-criteria-native-2026-10-21.json', JSON.stringify(report, null, 2) + '\n');
    await p.dispose();
}
process.exit(0);
