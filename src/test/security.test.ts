import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { OAUTH_COLUMNS, oauthEditable, securityKey, validateOAuthChanges } from '../model/security.js';
import { securityHtml } from '../editors/securityHtml.js';
import { readSecurity } from '../providers/securityReader.js';
import { saveOAuth } from '../providers/securityWriter.js';
import type { DbConnection, DbTypes } from '../db/connection.js';
const fixture = JSON.parse(readFileSync('src/test/fixtures/security-8.62.09/oauth-native.json', 'utf8'));
const types = { OUT_FORMAT_OBJECT: 4002 } as DbTypes;
function database(columns: string[] = Object.keys(fixture.before)) {
  let row = { ...fixture.before }; let committed = 0, rolledBack = 0;
  const statements: string[] = [];
  const c = { catalog: { columns: async (_c: unknown, table: string) => (table === 'PSPTSEC_TOKEN' ? columns : []).map(name => ({ name, dataType: 'VARCHAR2' })), tableExists: async () => true },
    async execute(sql: string, binds: Record<string, unknown> = {}) {
    statements.push(sql);
    if (sql.includes('FROM PSSTATUS')) return { rows: [{ TOOLSREL: '8.62', PTPATCHREL: 9 }] };
    if (sql.includes('FROM PSOPRDEFN')) return { rows: [{ OPRID: 'TEST' }] };
    if (sql.startsWith('UPDATE')) { for (const match of sql.matchAll(/(\w+)=:(v\d+)/g)) row[match[1]] = binds[match[2]]; return { rowsAffected: 1 }; }
    if (sql.includes('FROM PSPTSEC_TOKEN')) return { rows: [{ ...row, PTCLIENT_SECRET: 'driver-extra-must-be-excluded' }] };
    if (sql.includes('FROM PSPTSEC_AUD') || sql.includes('FROM PSPTSEC_ROLES')) return { rows: [] };
    throw new Error('Unexpected SQL: ' + sql);
  }, async commit() { committed++; }, async rollback() { rolledBack++; } } as unknown as DbConnection;
  return { c, statements, counts: () => ({ committed, rolledBack }), row: () => row };
}
test('native OAuth edit changes four public properties and no cache counters', () => {
  assert.deepEqual(fixture.changedCounters, []);
  assert.deepEqual(Object.keys(fixture.before).filter(k => fixture.before[k] !== fixture.after[k]), ['PTCLIENT_ID', 'PTISS', 'PTTOKENURL', 'PTSCOPE_URL']);
});
test('security readers exclude extra driver fields and never query secrets/tokens', async () => {
  const db = database(); const doc = await readSecurity(db.c, types, 'oauth', ['ZZ_STUDIO_OAUTH_01', 'CU']);
  assert.ok(doc && oauthEditable(doc)); assert.deepEqual(Object.keys(doc.properties), [...OAUTH_COLUMNS]);
  assert.doesNotMatch(JSON.stringify(doc), /driver-extra|PTCLIENT_SECRET|PTACCESS_TOKEN/);
  assert.doesNotMatch(db.statements.join('\n'), /SELECT \*|PTCLIENT_SECRET|PTACCESS_TOKEN|PSPTSECUSERTOKN/);
});
test('on PeopleTools 8.61 (no PTJWTEXP) an OAuth application still opens, the column read as NULL', async () => {
  // HCDEV 8.61.15's PSPTSEC_TOKEN has every OAuth column but PTJWTEXP, which 8.62 added.
  const db = database(Object.keys(fixture.before).filter(k => k !== 'PTJWTEXP'));
  const doc = await readSecurity(db.c, types, 'oauth', ['ZZ_STUDIO_OAUTH_01', 'CU']);
  assert.ok(doc);
  const select = db.statements.find(sql => sql.startsWith('SELECT') && sql.includes('FROM PSPTSEC_TOKEN'))!;
  assert.match(select, /NULL AS PTJWTEXP/);
  assert.doesNotMatch(select, /T\.PTJWTEXP/);
});
test('writer replays native OAuth edit, preserving public state and related rows', async () => {
  const db = database(); const doc = (await readSecurity(db.c, types, 'oauth', ['ZZ_STUDIO_OAUTH_01', 'CU']))!;
  const changes = Object.fromEntries(['PTCLIENT_ID','PTISS','PTTOKENURL','PTSCOPE_URL'].map(k => [k, fixture.after[k]]));
  const saved = await saveOAuth(db.c, types, { key: doc.key, expectedToken: doc.token, changes, operatorId: 'TEST' });
  assert.deepEqual(saved.properties, Object.fromEntries(Object.entries(fixture.after).map(([k,v]) => [k, typeof v === 'string' ? v.trimEnd() : v])));
  assert.deepEqual(db.counts(), { committed: 1, rolledBack: 0 });
  assert.doesNotMatch(db.statements.filter(s => s.startsWith('UPDATE')).join('\n'), /PSVERSION|SECRET|PTSTATE|PTSECTYPE|PTREFRESH/);
});
test('stale-token writes roll back without updates', async () => {
  const db = database(); await assert.rejects(saveOAuth(db.c, types, { key: ['ZZ_STUDIO_OAUTH_01','CU'], expectedToken: 'stale', changes: { PTCLIENT_ID: 'changed' }, operatorId: 'TEST' }), /changed since/);
  assert.ok(!db.statements.some(s => s.startsWith('UPDATE'))); assert.equal(db.counts().rolledBack, 1);
});
test('OAuth preview rolls back and never commits', async () => {
  const db = database(); const doc = (await readSecurity(db.c, types, 'oauth', ['ZZ_STUDIO_OAUTH_01','CU']))!;
  await saveOAuth(db.c, types, { key: doc.key, expectedToken: doc.token, changes: { PTCLIENT_ID: 'preview' }, operatorId: 'TEST', dryRun: true });
  assert.deepEqual(db.counts(), { committed: 0, rolledBack: 1 });
});
test('OAuth updates reject credential, identity, grant and unsafe endpoint edits', () => {
  for (const key of ['PTCLIENT_SECRET','PTSTATE','PTSECTYPE','PTREFRESH','PTAUTHFLOW','PTTENANT', 'PTAPP_NAME']) assert.throws(() => validateOAuthChanges({ [key]: 'bad' }), /not calibrated/);
  for (const url of ['http://example.invalid','https://user:password@example.invalid','https://example.invalid/#fragment','javascript:alert(1)']) assert.throws(() => validateOAuthChanges({ PTTOKENURL: url }));
  assert.throws(() => validateOAuthChanges({ PTCLIENT_ID: 'x'.repeat(101) }));
});
test('legacy SAML reader binds the full four-part identity', async () => {
  let sql = '', values: unknown;
  const c = { async execute(s: string, binds: unknown) { sql = s; values = binds; return { rows: [] }; } } as unknown as DbConnection;
  await readSecurity(c, types, 'saml', ['CERT','issuer','subject','']);
  assert.match(sql,/CERTALIAS=:name AND PTISSUER=:issuer AND PTSUBJECTNAME=:subject AND PTQUALIFIERNAME=:qualifier/);
  assert.deepEqual(values,{ name:'CERT',issuer:'issuer',subject:'subject',qualifier:' ' });
  assert.throws(() => securityKey('saml',['CERT']));
});
test('security webview script parses and escapes connection markup', () => {
  for (const kind of ['oauth','saml'] as const) {
    const html = securityHtml(kind,'<img src=x onerror=alert(1)>','test');
    assert.doesNotMatch(html, /<img/); new vm.Script(html.match(/<script nonce="test">([\s\S]*)<\/script>/)![1]);
    if (kind === 'saml') assert.match(html, /requires PeopleTools 8.63/);
  }
});
