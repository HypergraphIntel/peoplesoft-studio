/** HRDMO-only administration smoke test. Retains fresh custom entries for inspection. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import oracledb from 'oracledb';
import { listAdministration, readAdministration, saveAdministration, verifyAdministration } from '../../src/providers/administrationWriter.js';
import { inputForAdminDocument } from '../../src/model/administration.js';
import type { DbConnection } from '../../src/db/connection.js';

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
const native = await oracledb.getConnection({ user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD, connectString });
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
const c = native as unknown as DbConnection;
const types = oracledb;
const checks: string[] = [];
const seed = String(Date.now() % 100000).padStart(5, '0');
const operatorId = process.env.PSLAB_OPRID ?? 'JARED';
const check = (name: string) => { checks.push(name); console.log('PASS ' + name); };
try {
  const identity = await native.execute<{ DB: string }>("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL");
  assert.equal(identity.rows?.[0].DB, 'HRDMO', 'refuse any database other than HRDMO');
  const counters = () => native.execute<{ OBJECTTYPENAME: string; VERSION: number }>('SELECT OBJECTTYPENAME,VERSION FROM PSVERSION ORDER BY OBJECTTYPENAME');
  const beforeCounters = (await counters()).rows!;
  const used = new Set((await native.execute<{ MESSAGE_SET_NBR: number }>('SELECT MESSAGE_SET_NBR FROM PSMSGSETDEFN WHERE MESSAGE_SET_NBR BETWEEN 30000 AND 32767')).rows?.map(r => Number(r.MESSAGE_SET_NBR)));
  const set = Array.from({length:2768},(_,i)=>30000+i).find(s=>!used.has(s))!;
  assert.ok(set);
  const message = { set, number:1, setDescription:'Studio administration test',setShortDescription:'Studio',
    severity:'M' as const,text:'Studio message %1  ',explanation:'Administration write/readback smoke test.' };
  let saved = await saveAdministration(c,types,{kind:'message',input:message,expectedToken:'absent',operatorId});
  await verifyAdministration(c,types,saved); check('create message set and message; preserve trailing spaces');
  const oldToken=saved.token;
  saved=await saveAdministration(c,types,{kind:'message',input:{...message,severity:'W',text:'Updated message'},expectedToken:saved.token,operatorId});
  await verifyAdministration(c,types,saved);check('update message with SYS cache version');
  const stamp = saved.row.LAST_UPDATE_DTTM;
  saved=await saveAdministration(c,types,{kind:'message',input:{...message,severity:'W',text:'Updated message',setDescription:'Updated set description'},expectedToken:saved.token,operatorId});
  assert.equal(saved.row.LAST_UPDATE_DTTM,stamp);check('set-only edit preserves message timestamp');
  await assert.rejects(saveAdministration(c,types,{kind:'message',input:message,expectedToken:oldToken,operatorId}),/changed/);check('stale message save rejected');
  const sibling=await saveAdministration(c,types,{kind:'message',input:{...message,number:2,setDescription:'',setShortDescription:''},expectedToken:'absent',operatorId});
  assert.equal(String(sibling.parent?.DESCR).trim(),String(saved.parent?.DESCR).trim());check('adding sibling preserves set descriptions');
  await assert.rejects(saveAdministration(c,types,{kind:'message',input:{...message,set:19999},expectedToken:'absent',operatorId}));check('reserved message set rejected');
  const url={id:'ZZ_ADMIN_'+seed,description:'Studio URL smoke test',url:'https://example.invalid/studio',owner:'',comments:'No external request is made.'};
  let u=await saveAdministration(c,types,{kind:'url',input:url,expectedToken:'absent',operatorId});
  await verifyAdministration(c,types,u);check('create URL with stamp and SYS cache version');
  const oldUrlToken=u.token;
  u=await saveAdministration(c,types,{kind:'url',input:{...url,url:'https://example.invalid/updated'},expectedToken:u.token,operatorId});
  await verifyAdministration(c,types,u);check('update URL');
  await assert.rejects(saveAdministration(c,types,{kind:'url',input:url,expectedToken:oldUrlToken,operatorId}),/changed/);check('stale URL save rejected');
  const text={owner:'HCR',subId:'NFMT',id:'ZZ_ADMIN_'+seed,effectiveDate:'2026-10-14',keys:['','','','','',''],language:'',
    text:'Studio Text Catalog smoke test',description:'Studio administration text',usage:'FLBL',systemData:false};
  let t=await saveAdministration(c,types,{kind:'text',input:text,expectedToken:'absent',operatorId});
  await verifyAdministration(c,types,t);check('create text ID, effective date and base context');
  const oldTextToken=t.token;
  t=await saveAdministration(c,types,{kind:'text',input:{...text,text:'Updated text'},expectedToken:t.token,operatorId});
  await verifyAdministration(c,types,t);check('update Text Catalog');
  await assert.rejects(saveAdministration(c,types,{kind:'text',input:text,expectedToken:oldTextToken,operatorId}),/changed/);check('stale Text Catalog save rejected');
  const translated=await saveAdministration(c,types,{kind:'text',input:{...text,language:'FRA',text:'Texte de test'},expectedToken:'absent',operatorId});
  await verifyAdministration(c,types,translated);check('create related-language text');
  const contextual=await saveAdministration(c,types,{kind:'text',input:{...text,keys:['','', '', '', 'FIFTH','SIXTH'],text:'Context test'},expectedToken:'absent',operatorId});
  assert.deepEqual(contextual.key.slice(8,10),['FIFTH','SIXTH']);check('fifth and sixth context keys are preserved');
  for(const kind of ['message','url','text'] as const){
    const page=await listAdministration(c,types,kind,kind==='message'?String(set):seed);
    assert.ok(page.items.length);check(kind+' search and pagination');
  }
  assert.equal((await readAdministration(c,types,'text',t.key))?.related.length,1);
  check('base text includes translations');
  const reopened=await readAdministration(c,types,'url',u.key);
  assert.deepEqual(inputForAdminDocument(reopened!),inputForAdminDocument(u));check('reopen matches saved URL');
  const afterCounters = (await counters()).rows!;
  assert.deepEqual(afterCounters.filter(r=>r.OBJECTTYPENAME!=='SYS'),beforeCounters.filter(r=>r.OBJECTTYPENAME!=='SYS'));
  check('unrelated definition counters are unchanged');
  assert.ok((await native.execute('SELECT LANGUAGE_CD,ISO_LOCALE FROM PSLANGUAGES ORDER BY LANGUAGE_CD')).rows?.length);
  check('Text Catalog language picker query is valid');
  writeFileSync('tools/lab/results/administration-e2e.json',JSON.stringify({database:'HRDMO',checks,entries:{messageSet:set,url:url.id,text:text.id},nativeRuntimeProbe:'PSAE probe blocked by missing 64-bit Oracle SQL library'},null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,messageSet:set,url:url.id,text:text.id}));
} finally { await native.close(); }
