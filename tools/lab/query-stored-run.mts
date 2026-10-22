/** Read-only: run stored HRDMO queries (by name, owner PSLAB_OPERATOR) through Studio's compiler and print SQL and rows, for comparison with Windows Query's Results. */
import assert from 'node:assert/strict';
import { DatabaseProvider } from '../../src/providers/database.js';

const config = { name: 'HRDMO stored query run', platform: 'oracle' as const,
    connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! };
assert.match(config.connectString, /hrdmo/i); assert.ok(config.user && config.password);
const p = new DatabaseProvider(config), operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';
try {
    await p.connect();
    for (const name of process.argv.slice(2)) {
        const stored = (await p.readQueryDocument(name, operatorId)) ?? assert.fail(`${name} not found`);
        const run = await p.runQuery(stored.view, operatorId, {});
        console.log(`${name}: ${run.rows.length} rows\n${run.sql}\n${JSON.stringify(run.rows.slice(0, 10))}`);
    }
} finally { await p.dispose(); }
process.exit(0);
