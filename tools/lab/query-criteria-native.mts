/** Studio-written HRDMO queries for each calibrated Query family (qcr, qnm, qjn, qag, qex, qsq, qun, qxl) for Windows Query reopen, SQL and results checks. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { DatabaseProvider } from '../../src/providers/database.js';
import { makeKey } from '../../src/model/definitions.js';
import { applyQueryOp, describeQueryCriteria, newQueryDocument, type QueryCriterion, type QueryFieldInfo, type QueryOp } from '../../src/model/queryDocument.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';

const config = { name: 'HRDMO Query criteria acceptance', platform: 'oracle' as const,
    connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! };
assert.match(config.connectString, /hrdmo/i); assert.ok(config.user && config.password);
const p = new DatabaseProvider(config), operatorId = process.env.PSLAB_OPERATOR ?? 'JARED', mode = process.argv[2] ?? 'dry', only = process.argv[3]?.split(',');
if (!['dry', 'save', 'run'].includes(mode)) throw new Error('Use dry, save or run.');
setWriteNamePrefix('ZZ_QRY_STUDIO_');
const report: Record<string, unknown> = { at: new Date().toISOString(), mode, database: 'HRDMO', owner: operatorId };
async function metadata(record: string): Promise<Record<string, QueryFieldInfo>> {
    const layout = (await p.readRecordLayout(makeKey(0, record)))!;
    return Object.fromEntries(layout.fields.map(f => [f.name, { type: f.type!, length: f.length!, decimalPositions: f.decimalPositions ?? 0, format: f.format ?? 0, shortName: f.shortName, longName: f.longName, editTable: f.editTable, useEdit: f.useEdit }]));
}
type Spec = { name: string; record: string; fields: string[]; criteria: QueryCriterion[]; prompts: Record<string, string>; ops?: QueryOp[]; joined?: string[]; dated?: boolean };
const queries: Spec[] = [
    { name: 'ZZ_QRY_STUDIO_CRIT', record: 'AAP_TBL', fields: ['DESCR', 'ESTABID'], prompts: {}, criteria: [
        { field: 'ESTABID', operator: 'notEqual', not: true, value: { field: 'DESCR' } },
        { field: 'DESCR', operator: 'isNull', logical: 'OR', open: 1 },
        { field: 'ESTABID', operator: 'inList', logical: 'AND', close: 1, value: { list: ['A', 'B'] } },
        { field: 'DESCR', operator: 'like', logical: 'OR', value: { constant: '%' } }] },
    { name: 'ZZ_QRY_STUDIO_NUM', record: 'AAP_YEAR', fields: ['ESTABID', 'START_DT', 'FEMALE_GOAL'], prompts: { '1': '1900-01-01' }, criteria: [
        { field: 'FEMALE_GOAL', operator: 'notLess', value: { constant: '0' } },
        { field: 'START_DT', operator: 'greater', logical: 'AND', value: { prompt: 'new' } }] },
    // Joins (qjn01-qjn04): standard join (its detected key criterion kept) with a joined-record criterion; outer plus effective-dated related join.
    { name: 'ZZ_QRY_STUDIO_JOIN', record: 'AAP_YEAR', fields: ['ESTABID', 'FEMALE_GOAL'], prompts: {}, ops: [{ kind: 'join', record: 'AAP_TBL', type: 'standard' }], joined: ['B.DESCR'],
      criteria: [{ field: 'B.DESCR', operator: 'like', logical: 'AND', value: { constant: 'GBI%' } }] },
    { name: 'ZZ_QRY_STUDIO_REL', record: 'AAP_YEAR', fields: ['ESTABID'], prompts: {}, joined: ['B.DESCR', 'C.DESCR'],
      ops: [{ kind: 'join', record: 'AAP_TBL', type: 'leftOuter' }, { kind: 'join', record: 'ESTAB_TBL', type: 'related', field: 'A.ESTABID' }], criteria: [] },
    // Aggregates, HAVING and DISTINCT (qag01-qag05).
    { name: 'ZZ_QRY_STUDIO_AGG', record: 'AAP_YEAR', fields: ['ESTABID', 'FEMALE_GOAL'], prompts: {}, criteria: [{ field: 'ESTABID', operator: 'like', value: { constant: '%' } }],
      ops: [{ kind: 'aggregate', field: 'FEMALE_GOAL', function: 'average' }, { kind: 'distinct', distinct: true },
        { kind: 'having', criteria: [{ field: 'FEMALE_GOAL', operator: 'notLess', value: { constant: '0' } }] }] },
    // Expressions (qex01-qex03).
    { name: 'ZZ_QRY_STUDIO_EXPR', record: 'AAP_YEAR', fields: ['ESTABID'], prompts: {}, criteria: [{ field: 'FEMALE_GOAL', operator: 'notLess', value: { expression: '0 * 2' } }],
      ops: [{ kind: 'expression', text: 'A.FEMALE_GOAL * 2', type: 'number', length: 7 }, { kind: 'expression', text: 'A.FEMALE_GOAL + 100', type: 'number', length: 5 }] },
    // Subqueries (qsq01-qsq02): IN, and EXISTS correlated with the top level.
    { name: 'ZZ_QRY_STUDIO_SUB', record: 'AAP_YEAR', fields: ['ESTABID'], prompts: {}, criteria: [
        { field: 'ESTABID', operator: 'inList', value: { subquery: { record: 'AAP_TBL', field: 'ESTABID' } } },
        { operator: 'exists', logical: 'AND', value: { subquery: { record: 'AAP_TBL', field: 'ESTABID', criteria: [{ field: 'ESTABID', operator: 'equal', value: { field: 'A.ESTABID' } }] } } }] },
    // Union (qun01).
    { name: 'ZZ_QRY_STUDIO_UNION', record: 'AAP_TBL', fields: ['ESTABID'], prompts: {}, criteria: [], ops: [{ kind: 'union', record: 'AAP_YEAR' }], joined: ['B.ESTABID'] },
    // Translates on an effective-dated record (qxl01 Long, field date; qxl02 Short, current date).
    { name: 'ZZ_QRY_STUDIO_XLAT', record: 'ESTAB_TBL', fields: ['ESTABID', 'EFF_STATUS'], prompts: {}, criteria: [], dated: true,
      ops: [{ kind: 'translate', field: 'EFF_STATUS', value: 'long', effectiveDate: { field: 'EFFDT' } }] },
    { name: 'ZZ_QRY_STUDIO_XLAT2', record: 'ESTAB_TBL', fields: ['ESTABID', 'EFF_STATUS'], prompts: {}, criteria: [], dated: true,
      ops: [{ kind: 'translate', field: 'EFF_STATUS', value: 'short', effectiveDate: 'current' }] }
].filter(q => !only || only.includes(q.name)) as Spec[];
const recordsOf = (q: Spec) => [q.record, ...(q.ops ?? []).flatMap(o => o.kind === 'join' || o.kind === 'union' ? [o.record] : []),
    ...q.criteria.flatMap(c => c.value && 'subquery' in c.value ? [c.value.subquery.record] : [])];
try {
    await p.connect();
    assert.equal((await p.runReadOnlyQuery("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL", 1)).rows[0].DB, 'HRDMO');
    const results: unknown[] = [];
    for (const q of queries) {
        const records = Object.fromEntries(await Promise.all([...new Set(recordsOf(q))].map(async r => [r, { fields: await metadata(r) }])));
        const fields = records[q.record].fields, op = (v: typeof view, o: QueryOp) => applyQueryOp(v, o, fields, records);
        let view = newQueryDocument(q.name, operatorId, q.record, q.dated ? fields : undefined);
        for (const field of q.fields) view = op(view, { kind: 'select', field, selected: true });
        const [before, after] = [(q.ops ?? []).filter(o => o.kind !== 'having'), (q.ops ?? []).filter(o => o.kind === 'having')];
        for (const o of before) view = op(view, o);
        for (const field of q.joined ?? []) view = op(view, { kind: 'select', field, selected: true });
        // Replace the WHERE criteria, keeping any the record brought (the effective-date criterion of a dated record).
        if (q.criteria.length) view = op(view, { kind: 'criteria', criteria: [...describeQueryCriteria(view).criteria, ...q.criteria] });
        for (const o of after) view = op(view, o);
        view = op(view, { kind: 'properties', description: 'Studio criteria verification', comments: '' });
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
    if (mode !== 'dry') await writeFile(`tools/lab/results/query-criteria-native-2026-10-21${only ? '-' + only.join('-').toLowerCase() : ''}.json`, JSON.stringify(report, null, 2) + '\n');
    await p.dispose();
}
process.exit(0);
