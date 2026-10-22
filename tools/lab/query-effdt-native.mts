/** Each effective-date operator (qed01-qed06) on a new HRDMO ESTAB_TBL query: writer preview (validated, read back, rolled back) and read-only execution. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { DatabaseProvider } from '../../src/providers/database.js';
import { makeKey } from '../../src/model/definitions.js';
import { applyQueryOp, describeQueryCriteria, newQueryDocument, type QueryCriterion, type QueryFieldInfo } from '../../src/model/queryDocument.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';

const config = { name: 'HRDMO Query effective dating', platform: 'oracle' as const,
    connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! };
assert.match(config.connectString, /hrdmo/i); assert.ok(config.user && config.password);
const p = new DatabaseProvider(config), operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
setWriteNamePrefix('ZZ_QRY_STUDIO_');
const operators: Array<[string, QueryCriterion, string]> = [
    ['ZZ_QRY_STUDIO_ED20', { field: 'EFFDT', operator: 'effectiveDate', value: { currentDate: true } }, 'MAX(A_ED.EFFDT) FROM PS_ESTAB_TBL A_ED WHERE A.ESTABID = A_ED.ESTABID AND A_ED.EFFDT <= SYSDATE'],
    ['ZZ_QRY_STUDIO_ED21', { field: 'EFFDT', operator: 'effectiveDateNotLess', value: { currentDate: true } }, 'MIN(A_ED.EFFDT) FROM PS_ESTAB_TBL A_ED WHERE A.ESTABID = A_ED.ESTABID AND A_ED.EFFDT >= SYSDATE'],
    ['ZZ_QRY_STUDIO_ED22', { field: 'EFFDT', operator: 'effectiveDateLess', value: { currentDate: true } }, 'MAX(A_ED.EFFDT) FROM PS_ESTAB_TBL A_ED WHERE A.ESTABID = A_ED.ESTABID AND A_ED.EFFDT < SYSDATE'],
    ['ZZ_QRY_STUDIO_ED23', { field: 'EFFDT', operator: 'effectiveDateGreater', value: { currentDate: true } }, 'MIN(A_ED.EFFDT) FROM PS_ESTAB_TBL A_ED WHERE A.ESTABID = A_ED.ESTABID AND A_ED.EFFDT > SYSDATE'],
    ['ZZ_QRY_STUDIO_ED24', { field: 'EFFDT', operator: 'firstEffectiveDate' }, 'MIN(A_ED.EFFDT) FROM PS_ESTAB_TBL A_ED WHERE A.ESTABID = A_ED.ESTABID)'],
    ['ZZ_QRY_STUDIO_ED25', { field: 'EFFDT', operator: 'lastEffectiveDate' }, 'MAX(A_ED.EFFDT) FROM PS_ESTAB_TBL A_ED WHERE A.ESTABID = A_ED.ESTABID)']
];
const report: Record<string, unknown> = { at: new Date().toISOString(), mode: 'dry', database: 'HRDMO', owner: operatorId };
try {
    await p.connect();
    assert.equal((await p.runReadOnlyQuery("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL", 1)).rows[0].DB, 'HRDMO');
    const layout = (await p.readRecordLayout(makeKey(0, 'ESTAB_TBL')))!;
    const fields: Record<string, QueryFieldInfo> = Object.fromEntries(layout.fields.map(f => [f.name, { type: f.type!, length: f.length!, decimalPositions: f.decimalPositions ?? 0,
        format: f.format ?? 0, shortName: f.shortName, longName: f.longName, editTable: f.editTable, useEdit: f.useEdit }]));
    const records = { ESTAB_TBL: { fields } }, results: unknown[] = [];
    for (const [name, criterion, expected] of operators) {
        let view = newQueryDocument(name, operatorId, 'ESTAB_TBL', fields);
        view = applyQueryOp(view, { kind: 'select', field: 'ESTABID', selected: true }, fields, records);
        view = applyQueryOp(view, { kind: 'criteria', criteria: [criterion] }, fields, records);
        view = applyQueryOp(view, { kind: 'properties', description: 'Studio effective date check', comments: '' }, fields, records);
        assert.deepEqual(describeQueryCriteria(view).criteria, [criterion], name);
        assert.equal(await p.readQueryDocument(name, operatorId), undefined, name + ' already exists.');
        const saved = await p.saveQueryDocument({ view, openedToken: 'absent', operatorId, dryRun: true });
        assert.equal(saved.written, false);
        assert.equal(await p.readQueryDocument(name, operatorId), undefined, name + ' persisted after a preview.');
        const run = await p.runQuery(view, operatorId, {});
        assert.ok(run.sql.replace(/\s+/g, ' ').includes(expected), `${name}: ${run.sql}`);
        results.push({ name, operator: criterion.operator, sql: run.sql, rowCount: run.rows.length });
        console.log(`${name} ${criterion.operator}: ${run.rows.length} rows\n${run.sql}`);
    }
    report.queries = results; report.passed = true;
} finally {
    await writeFile('tools/lab/results/query-effdt-native-2026-10-22.json', JSON.stringify(report, null, 2) + '\n');
    await p.dispose();
}
process.exit(0);
