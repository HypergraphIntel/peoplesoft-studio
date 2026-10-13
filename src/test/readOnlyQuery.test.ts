import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskSql, metaSqlIn, prepareReadOnlyQuery } from '../sql/readOnlyQuery.js';

const ok = (text: string, tableOf?: (r: string) => string) => {
  const p = prepareReadOnlyQuery(text, tableOf);
  assert.ok(p.ok, `refused: ${!p.ok ? p.reason : ''}`);
  return p.ok ? p.sql : '';
};
const refused = (text: string, why: RegExp) => {
  const p = prepareReadOnlyQuery(text);
  assert.ok(!p.ok, `allowed: ${text}`);
  if (!p.ok) assert.match(p.reason, why);
};

test('a query runs; a trailing ; or / line is dropped', () => {
  assert.equal(ok('SELECT OPRID FROM PSOPRDEFN;'), 'SELECT OPRID FROM PSOPRDEFN');
  assert.equal(ok('select * from psstatus\n/\n'), 'select * from psstatus');
  assert.equal(ok('WITH x AS (SELECT 1 A FROM DUAL) SELECT A FROM x'), 'WITH x AS (SELECT 1 A FROM DUAL) SELECT A FROM x');
  assert.equal(ok("SELECT 'a;b -- not a comment' FROM DUAL"), "SELECT 'a;b -- not a comment' FROM DUAL");
  ok('SELECT UPDATE_DTTM, DELETED_FLAG FROM PS_X', ) ;
});

test('anything that could write or lock is refused, and so is more than one statement', () => {
  refused('UPDATE PSOPRDEFN SET OPRDEFNDESC = 1', /queries only/);
  refused('DELETE FROM PS_X', /queries only/);
  refused('SELECT 1 FROM DUAL; DELETE FROM PS_X', /one statement/);
  refused('SELECT * INTO PS_COPY FROM PS_X', /INTO/);
  refused('SELECT * FROM PS_X FOR UPDATE', /FOR UPDATE/);
  refused('WITH x AS (SELECT 1 A) DELETE FROM PS_X', /writes/);
  refused('  ', /no SQL/);
  refused('BEGIN NULL; END;', /one statement|queries only/);
});

test('comments and string literals do not count: neither hide a write nor block a query', () => {
  assert.equal(maskSql("SELECT 'it''s; DELETE' /* ; */ -- ;\nFROM X"), `SELECT '${' '.repeat(13)}'   \nFROM X`);
  ok("SELECT 'DELETE FROM PS_X; INSERT' FROM DUAL -- update\n");
  refused('/* select */ DELETE FROM PS_X', /queries only/);
});

test('%Table(REC) becomes the table; other meta-SQL and binds are refused by name', () => {
  assert.equal(ok('SELECT EMPLID FROM %Table(JOB) WHERE EMPLID = \'K0G001\'', (r) => `PS_${r}`), "SELECT EMPLID FROM PS_JOB WHERE EMPLID = 'K0G001'");
  assert.equal(ok('SELECT 1 FROM %table( psoprdefn )', (r) => (r === 'PSOPRDEFN' ? 'PSOPRDEFN' : `PS_${r}`)), 'SELECT 1 FROM PSOPRDEFN');
  refused('SELECT %DateOut(EFFDT) FROM PS_JOB', /%DateOut/);
  refused('SELECT 1 FROM PS_JOB WHERE EMPLID = :1', /:1/);
  refused('SELECT 1 FROM %Table(JOB)', /needs a database/);
  assert.deepEqual(metaSqlIn("SELECT '%Bind(:1)' FROM X -- %Select\n WHERE A = :2"), { meta: [], binds: [':2'] });
});

test('results: values escaped, NULL and binary shown as such, long text cut, nothing runs in the page', async () => {
  const { cellText, renderQueryResults } = await import('../editors/queryResults.js');
  assert.deepEqual(cellText(null), { text: 'NULL', kind: 'null' });
  assert.deepEqual(cellText(Buffer.from([1, 2, 3])), { text: '(3 bytes)', kind: 'binary' });
  assert.equal(cellText(new Date('2026-10-13T11:52:51.000Z')).text, '2026-10-13 11:52:51');
  assert.equal(cellText('x'.repeat(600)).text.length, 501);
  const page = renderQueryResults({ connection: 'HRDMO', sql: 'SELECT A FROM X', rows: [{ OPRID: '<script>x</script>', N: 1 }, { OPRID: null, N: 2 }], truncated: true, maxRows: 2, ms: 7 });
  assert.ok(page.includes("default-src 'none'") && !page.includes('<script>x'));
  assert.ok(page.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(page.includes('<th>OPRID</th><th>N</th>') && page.includes('<td class="null">NULL</td>'));
  assert.ok(page.includes('2 rows (the first 2; there are more)') && page.includes('read only, rolled back'));
  assert.ok(renderQueryResults({ connection: 'H', sql: 'S', rows: [], truncated: false, maxRows: 500, ms: 1 }).includes('No rows'));
});
