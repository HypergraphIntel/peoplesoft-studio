/** Builds the REST lifecycle replay fixture from native captures (tools/corpus/save-protocol/results/ib09..ib16). */
import { readFileSync, writeFileSync } from 'node:fs';

const RESULTS = 'tools/corpus/save-protocol/results/';
const OUT = 'src/test/fixtures/ib-native-8.62.09/rest-lifecycle.json';
const cases = [
    ['ib09-native-rest-empty-service-delete', 'service', 'ZZ_PCODE_LAB_IBRE'],
    ['ib10-native-rest-empty-service-recreate', 'service', 'ZZ_PCODE_LAB_IBRE'],
    ['ib11-native-rest-provider-operation-delete', 'operation', 'ZZ_PCODE_LAB_IBRPG', 'ZZ_PCODE_LAB_IBRP'],
    ['ib12-native-rest-provider-operation-recreate', 'operation', 'ZZ_PCODE_LAB_IBRPG_GET', 'ZZ_PCODE_LAB_IBRP'],
    ['ib13-native-rest-provider-operation-nohandler-delete', 'operation', 'ZZ_PCODE_LAB_IBRPG_GET', 'ZZ_PCODE_LAB_IBRP'],
    ['ib14-native-rest-provider-operation-recreate', 'operation', 'ZZ_PCODE_LAB_IBRPG_GET', 'ZZ_PCODE_LAB_IBRP'],
    ['ib15-native-rest-consumer-operation-delete', 'operation', 'ZZ_PCODE_LAB_IBRCG', 'ZZ_PCODE_LAB_IBRC'],
    ['ib16-native-rest-consumer-operation-create', 'operation', 'ZZ_PCODE_LAB_IBRCG_GET', 'ZZ_PCODE_LAB_IBRC']
] as const;
// The standard lifecycle fixture's table set, plus the generated routing and its tombstone.
const standard = JSON.parse(readFileSync('src/test/fixtures/ib-native-8.62.09/definition-lifecycle.json', 'utf8'))[0];
const tables = [...Object.keys(standard.schema), 'PSIBRTNGSUBDEFN', 'PSRTNGDFNPARM', 'PSIBRTNGDEFNDEL'];
// Captures never read credential columns; the fixture carries them blank so credential refusals run.
const credentials: Record<string, string> = { PSSERVICE: 'IBEXTERNALPWD', PSRTNGDFNPARM: 'IBEXTERNALPWD' };

type Column = { name: string; type: string };
type Watch = Record<string, { columns: Column[]; rows: (string | null)[][] }>;
function convert(watch: Watch) {
    const rows: Record<string, Record<string, unknown>[]> = {}, schema: Record<string, { name: string; dataType: string }[]> = {};
    for (const t of tables) {
        const w = watch[t]; if (!w) throw new Error(`Capture lacks ${t}; recapture with PSLAB_ROUTINGS set.`);
        const extra = credentials[t];
        schema[t] = [...w.columns.map(c => ({ name: c.name, dataType: c.type })), ...(extra ? [{ name: extra, dataType: 'VARCHAR2' }] : [])];
        // DATE values as the lifecycle reader projects them (TO_CHAR ... FF9), so checkpoints match live reads.
        const value = (c: Column, v: string | null) => v === null ? null : c.type === 'NUMBER' ? Number(v) : c.type === 'DATE' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(v) ? v + '.000000000' : v;
        rows[t] = w.rows.map(r => ({ ...Object.fromEntries(w.columns.map((c, i) => [c.name, value(c, r[i])])), ...(extra ? { [extra]: ' ' } : {}) }));
    }
    return { rows, schema };
}
const out = cases.map(([name, kind, definition, service]) => {
    const before = JSON.parse(readFileSync(`${RESULTS}${name}/before.json`, 'utf8')), after = JSON.parse(readFileSync(`${RESULTS}${name}/after.json`, 'utf8'));
    if (before.database !== 'HRDMO' || before.peopleToolsRelease !== '8.62.09') throw new Error(name + ' is not an HRDMO 8.62.09 capture.');
    const b = convert(before.watch), a = convert(after.watch);
    return { case: name, kind, name: definition, ...(service ? { service } : {}), before: b.rows, schema: b.schema, after: a.rows };
});
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`Wrote ${out.length} cases to ${OUT}`);
