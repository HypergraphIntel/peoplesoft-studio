/** HRDMO only. Uses an inert native PIA fixture; preserves credentials and never contacts endpoints. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import oracledb from 'oracledb';
import { listSecurity, readSecurity, securityChoices } from '../../src/providers/securityReader.js';
import { saveOAuth } from '../../src/providers/securityWriter.js';
import type { DbConnection, DbTypes } from '../../src/db/connection.js';
const native = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo' });
const c = native as unknown as DbConnection, types = oracledb as unknown as DbTypes;
const checks: string[] = [], key = ['ZZ_STUDIO_OAUTH_01','CU'];
const q = async (sql: string) => (await native.execute<Record<string, unknown>>(sql, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows!;
const pass = (s: string) => { checks.push(s); console.log('PASS ' + s); };
try {
  assert.equal((await q("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL"))[0].DB,'HRDMO');
  const before = (await readSecurity(c,types,'oauth',key))!; assert.ok(before);
  const secretFingerprint = async () => (await q("SELECT RAWTOHEX(STANDARD_HASH(PTCLIENT_SECRET,'SHA256')) AS H FROM PSPTSEC_TOKEN WHERE PTAPP_NAME='ZZ_STUDIO_OAUTH_01' AND PTAUTHSERVER='CU'"))[0].H;
  const fingerprint = await secretFingerprint();
  const counters = await q('SELECT OBJECTTYPENAME,VERSION FROM PSVERSION ORDER BY OBJECTTYPENAME');
  assert.ok((await listSecurity(c,types,'oauth','ZZ_STUDIO_OAUTH_01')).items.some(i=>i.key.join('/')===key.join('/'))); pass('OAuth search and two-part identity');
  assert.ok((await securityChoices(c,types)).some(x=>x.code==='CU'&&x.field==='PTAUTHSERVER')); pass('installed authorization-server choices');
  await listSecurity(c,types,'saml',''); pass('legacy inbound SAML query');
  const changes = { PTSCOPE_URL:'studio.preview' };
  await saveOAuth(c,types,{key,expectedToken:before.token,changes,operatorId:'JARED',dryRun:true});
  assert.equal((await readSecurity(c,types,'oauth',key))!.token,before.token); pass('preview rolled back');
  await assert.rejects(saveOAuth(c,types,{key,expectedToken:'stale',changes,operatorId:'JARED'}),/changed since/); pass('stale token rejected');
  const saved = await saveOAuth(c,types,{key,expectedToken:before.token,changes:{PTSCOPE_URL:'studio.writer.verified'},operatorId:'JARED'});
  assert.equal((await readSecurity(c,types,'oauth',key))!.token,saved.token); pass('committed edit verified');
  const restored = await saveOAuth(c,types,{key,expectedToken:saved.token,changes:{PTSCOPE_URL:String(before.properties.PTSCOPE_URL)},operatorId:'JARED'});
  assert.equal(restored.token,before.token); pass('original public configuration restored');
  assert.equal(await secretFingerprint(),fingerprint); pass('encrypted secret unchanged (database digest comparison only)');
  assert.deepEqual(await q('SELECT OBJECTTYPENAME,VERSION FROM PSVERSION ORDER BY OBJECTTYPENAME'),counters); pass('PSVERSION counters unchanged, matching native save');
  writeFileSync('tools/lab/results/security-e2e.json',JSON.stringify({database:'HRDMO',key,checks},null,2)+'\n');
} finally { await native.close(); }
