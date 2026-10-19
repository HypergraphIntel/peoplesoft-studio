import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processEdit, processToken, validateProcessEdit } from '../model/processEdit.js';
import type { ProcessView } from '../model/processDefinition.js';
import { saveProcess } from '../providers/processWriter.js';
import { ADAPTER_TYPES, type DbConnection, type DbResult } from '../db/connection.js';
import { canonical } from '../changeReview/model.js';
function fixture(): ProcessView {
  return {process:{PRCSTYPE:'SQR Report',PRCSNAME:'ABS002',DESCR:'Absence Periods Report',VERSION:1,LASTUPDOPRID:'PPLSOFT',PARMLIST:' ',PARMLISTTYPE:'0',OUTDESTTYPE:'1',OUTDESTFORMAT:'0',OUTDESTSRC:'3',OUTDEST:' ',RESTARTENABLED:'0',RETRYCOUNT:0,RUNLOCATION:'0',SERVERNAME:' ',RECURNAME:' ',PRCSCATEGORY:'Default',DESCRLONG:'A description',RECVRYPRCSTYPE:' ',RECVRYPRCSNAME:' ',OTHER_SETTING:'keep'},components:[{PNLGRPNAME:'RUN_ABS002'}],groups:[{PRCSGRP:'HRALL'}],translates:new Map([['OUTDESTFORMAT',new Map([['0','Any'],['2','PDF']])]])};
}
function db(view: ProcessView) {
  const counters={ppc:10,lock:12,sys:20};let committed=0,rolledBack=0;const original=structuredClone(view),originalCounters={...counters};const statements:string[]=[];
  const c={catalog:{},async execute(sql:string,b:Record<string,unknown>={}):Promise<DbResult<Record<string,unknown>>>{
    statements.push(sql);
    if(sql.startsWith('SELECT OPRID'))return {rows:[{OPRID:'JARED'}]};
    if(sql.startsWith('SELECT OBJECTTYPENAME'))return {rows:[{OBJECTTYPENAME:'PPC',VERSION:counters.ppc},{OBJECTTYPENAME:'SYS',VERSION:counters.sys}]};
    if(sql.startsWith('SELECT VERSION FROM PSLOCK'))return {rows:[{VERSION:counters.lock}]};
    if(sql.startsWith('SELECT GENPRCSTYPE'))return {rows:[{GENPRCSTYPE:1}]};
    if(sql.startsWith('SELECT'))return {rows:[]};
    if(sql.startsWith('UPDATE PS_PRCSDEFN')){for(const m of sql.matchAll(/(\w+)=:(\w+)/g)){if(!['PRCSTYPE','PRCSNAME'].includes(m[1]))view.process[m[1]]=b[m[2]];}return {rowsAffected:1};}
    if(sql.startsWith('UPDATE PSVERSION SET VERSION=:v'))counters.ppc=Number(b.v);
    else if(sql.startsWith('UPDATE PSLOCK'))counters.lock=Number(b.v);
    else if(sql.startsWith('UPDATE PSVERSION SET VERSION=VERSION+2'))counters.sys+=2;
    else if(sql.startsWith('DELETE FROM PS_PRCSDEFNGRP'))view.groups=view.groups.filter(r=>r.PRCSGRP!==b.v);
    else if(sql.startsWith('INSERT INTO PS_PRCSDEFNGRP'))view.groups.push({PRCSGRP:b.v});
    return {rowsAffected:1};
  },async commit(){committed++;},async rollback(){rolledBack++;Object.assign(view,structuredClone(original));Object.assign(counters,originalCounters);},async close(){}} as unknown as DbConnection;
  return {c,counters,statements,get committed(){return committed;},get rolledBack(){return rolledBack;}};
}
test('process token detects parent and association changes independent of column order',()=>{
  const v=fixture(),token=processToken(v);v.process=Object.fromEntries(Object.entries(v.process).reverse());assert.equal(processToken(v),token);v.groups.push({PRCSGRP:'NEW'});assert.notEqual(processToken(v),token);
});
test('process validation rejects unknown columns, invalid translate values, duplicates, empty groups and unsafe numbers',()=>{
  const v=fixture();for(const mutate of [(e:ReturnType<typeof processEdit>)=>{e.properties.VERSION='9';},(e:ReturnType<typeof processEdit>)=>{e.properties.OUTDESTFORMAT='99';},(e:ReturnType<typeof processEdit>)=>{e.groups=[];},(e:ReturnType<typeof processEdit>)=>{e.components.push(e.components[0]);},(e:ReturnType<typeof processEdit>)=>{e.properties.RETRYCOUNT='100';}]){const e=processEdit(v);mutate(e);assert.throws(()=>validateProcessEdit(e,v));}
});
test('save uses larger PPC counter, stamps operator, verifies edit and preserves unrelated properties',async()=>{
  const v=fixture(),d=db(v),edit=processEdit(v);edit.properties.DESCR='Updated report';edit.groups.push('ZZ_REPORT');
  const after=await saveProcess(d.c,ADAPTER_TYPES,{key:['SQR Report','ABS002'],token:processToken(v),edit,operatorId:'JARED'},async()=>v);
  assert.equal(after.process.DESCR,'Updated report');assert.equal(after.process.VERSION,13);assert.equal(after.process.LASTUPDOPRID,'JARED');assert.equal(after.process.OTHER_SETTING,'keep');assert.deepEqual(d.counters,{ppc:13,lock:13,sys:22});assert.equal(d.committed,1);assert.ok(!d.statements.some(s=>s.startsWith('DELETE FROM PS_PRCSDEFNPNL')));
});
test('stale process save and invalid drafts roll back without commit',async()=>{
  for(const stale of [true,false]){const v=fixture(),d=db(v),edit=processEdit(v);if(!stale)edit.groups=[];await assert.rejects(saveProcess(d.c,ADAPTER_TYPES,{key:['SQR Report','ABS002'],token:stale?'stale':processToken(v),edit,operatorId:'JARED'},async()=>v));assert.equal(d.committed,0);assert.equal(d.rolledBack,1);assert.ok(!d.statements.some(s=>s.startsWith('UPDATE ')));}
});
test('preview rolls back edits and counters; unchanged save does not increment counters',async()=>{
  for(const change of [false,true]){const v=fixture(),d=db(v),edit=processEdit(v);if(change)edit.properties.DESCR='Preview';await saveProcess(d.c,ADAPTER_TYPES,{key:['SQR Report','ABS002'],token:processToken(v),edit,operatorId:'JARED',dryRun:true},async()=>v);assert.equal(v.process.DESCR,'Absence Periods Report');assert.deepEqual(d.counters,{ppc:10,lock:12,sys:20});assert.equal(d.committed,0);}
});
test('Change Review canonical snapshots verify Process saves independently of property order', async () => {
  for (const dryRun of [true, false]) {
    const v=fixture(), d=db(v), before=processToken(v), edit=processEdit(v);
    v.translates=new Map([...v.translates,['PARMLISTTYPE',new Map([['0','None'],['3','Append']])]]);
    edit.properties.PARMLISTTYPE='3'; edit.properties.PARMLIST=' -TRACE 7 -TOOLSTRACEPC 2131 -TOOLSTRACESQL 3';
    const persisted=JSON.parse(canonical(edit));
    assert.notEqual(JSON.stringify(persisted.properties),JSON.stringify(edit.properties));
    const result=await saveProcess(d.c,ADAPTER_TYPES,{key:['SQR Report','ABS002'],token:before,edit:persisted,operatorId:'JARED',dryRun},async()=>v);
    assert.equal(d.committed,dryRun ? 0 : 1);
    assert.equal(d.rolledBack,dryRun ? 1 : 0);
    if(dryRun) { assert.equal(processToken(v),before); assert.deepEqual(d.counters,{ppc:10,lock:12,sys:20}); }
    else { assert.equal(result.process.PARMLIST,edit.properties.PARMLIST); assert.equal(result.process.PARMLISTTYPE,'3'); assert.deepEqual(d.counters,{ppc:13,lock:13,sys:22}); }
  }
});
test('reordered equivalent Process input is a no-op, while a real readback difference still rolls back', async () => {
  const v=fixture(),d=db(v),edit=JSON.parse(canonical(processEdit(v)));
  await saveProcess(d.c,ADAPTER_TYPES,{key:['SQR Report','ABS002'],token:processToken(v),edit,operatorId:'JARED'},async()=>v);
  assert.equal(d.committed,0); assert.equal(d.rolledBack,1);
  assert.ok(!d.statements.some(s=>s.startsWith('UPDATE ')));
  const changed=fixture(),bad=db(changed),proposal=JSON.parse(canonical(processEdit(changed)));
  proposal.properties.DESCR='Reviewed description'; let reads=0;
  await assert.rejects(saveProcess(bad.c,ADAPTER_TYPES,{key:['SQR Report','ABS002'],token:processToken(changed),edit:proposal,operatorId:'JARED'},async()=>{
    if(++reads===2) changed.process.DESCR='Unexpected value';
    return changed;
  }),/readback verification/);
  assert.equal(bad.committed,0); assert.equal(bad.rolledBack,1);
  assert.equal(changed.process.DESCR,'Absence Periods Report');
});
