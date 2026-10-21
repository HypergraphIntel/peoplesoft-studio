/** Owned HRDMO REST lifecycle with private durable review and trusted service test approval; not installed UI acceptance. */
import assert from 'node:assert/strict';
import Module from 'node:module';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseProvider } from '../../src/providers/database.js';
import { hash, type Json } from '../../src/changeReview/model.js';
import { ReviewStore } from '../../src/changeReview/store.js';
import { ReviewService } from '../../src/changeReview/service.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';
import { setWriteGuard, writeOrigin } from '../../src/providers/writeGuard.js';
import { isReviewedWrite } from '../../src/changeReview/authorization.js';
import type { Workspace } from '../../src/workspace.js';

import { readIbLifecycle, type IbLifecycleKey } from '../../src/providers/ibLifecycle.js';
import { ibTransaction } from '../../src/test/fixtures/ibTransaction.js';
import { ADAPTER_TYPES } from '../../src/db/connection.js';

const operatorId=process.env.PSLAB_OPERATOR??'JARED';
const config={name:'HRDMO IB REST lifecycle acceptance',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};
assert.match(config.connectString,/hrdmo/i);assert.ok(config.user&&config.password);
const p=new DatabaseProvider(config),root=await mkdtemp(join(tmpdir(),'psft-ib-rest-definition-review-'));
const owned=['ZZ_PCODE_LAB_IBRP','ZZ_PCODE_LAB_IBRC','ZZ_PCODE_LAB_IBRE','ZZ_PCODE_LAB_IBRPG','ZZ_PCODE_LAB_IBRPG_GET'];
setWriteNamePrefix('ZZ_PCODE_LAB_IBR');
setWriteGuard(async w=>{assert.ok(owned.includes(w.key.parts[0]));if(writeOrigin()==='agent')assert.ok(isReviewedWrite(p.id,w.key));});
const checks:string[]=[],report:Record<string,unknown>={at:new Date().toISOString(),scope:'Owned Oracle 8.62.09 REST lifecycle; production providers/adapters and private durable review with trusted service test approval; not installed UI',history:root,checks};
const originals=new Map<string,{key:IbLifecycleKey;value:Json;hash:string}>();
try{
 await p.connect();assert.equal((await p.runReadOnlyQuery("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL",1)).rows[0].DB,'HRDMO');
 const {createStub}=await import('../../scripts/vscode-stub.mjs'),{vscode}=createStub(),loader=(Module as any)._load;
 (Module as any)._load=function(id:string,parent:unknown,main:boolean){return id==='vscode'?vscode:loader.call(this,id,parent,main);};
 const {databaseReviewAdapters}=await import('../../src/changeReview/adapters.js');
 const workspace={activeProviders:[p],connections:[],require:async()=>p,isWritable:()=>true,configFor:()=>({peoplesoftOperatorId:operatorId})}as unknown as Workspace;
 const registry=databaseReviewAdapters(workspace,()=>({mode:()=> 'confirm',confirm:async()=>{throw new Error('No legacy fallback');},hasUnsavedEditor:()=>false,saved(){}}));
 const service=new ReviewService(new ReviewStore(root),{environment:registry.environment,changed(){}},registry.adapters);
 const apply=async(id:string)=>{let set=await service.validate(id);assert.equal(set.status,'READY_FOR_REVIEW',JSON.stringify(set.objects.map(c=>c.validation)));set=await service.review(id,set.objects.map(c=>c.id),'APPROVED',set.revision,true);const result=await service.apply(id,false,set.revision);assert.equal(result.status,'APPLIED',JSON.stringify(result.journal.at(-1)));};
 const captures=JSON.parse(await readFile('src/test/fixtures/ib-native-8.62.09/rest-lifecycle.json','utf8'));
 const histories:unknown[]=[];
 // ib11 deleted ZZ_PCODE_LAB_IBRPG natively: its typed recreation (with handler) is the forward change.
 const cases:{key:IbLifecycleKey;capture?:string}[]=[
  {key:{kind:'operation',name:'ZZ_PCODE_LAB_IBRPG',service:'ZZ_PCODE_LAB_IBRP'},capture:'ib11-native-rest-provider-operation-delete'},
  {key:{kind:'operation',name:'ZZ_PCODE_LAB_IBRPG_GET',service:'ZZ_PCODE_LAB_IBRP'}},
  {key:{kind:'service',name:'ZZ_PCODE_LAB_IBRE'}}
 ];
 for(const {key,capture:name} of cases){
  const live=await p.readIbDefinitionForReview(key,true);
  let value=live.value,target=value;
  if(name){
   assert.equal(value,null,key.name+' must be the natively deleted fixture.');
   const capture=captures.find((c:any)=>c.case===name);
   target=(await readIbLifecycle(ibTransaction(key.kind,true,{name:key.name,schema:capture.schema,nativeRows:capture.before}).connection,ADAPTER_TYPES,key,true)).value;
  }else assert.notEqual(value,null);
  originals.set(key.name,{key,value,hash:hash(value)});
  const reviewKey=key.service?[key.name,key.service]:[key.name],adapter='ib-'+key.kind+'-definition',label=key.kind+' '+key.name;
  let forward=await service.create('Native IB REST '+label,p.id);
  forward=await service.stage(forward.id,adapter,reviewKey,name?target:null,[],undefined,live.token);
  assert.equal((await p.readIbDefinitionForReview(key,true)).token,live.token,'Staging does not persist');
  await apply(forward.id);checks.push(label+' reviewed '+forward.objects[0].operation+' verifies complete native checkpoint, routing, markers, cache and parent');
  const inverse=await service.reverse(forward.id);await assert.rejects(service.apply(inverse.id,false,inverse.revision),/approved/i);await apply(inverse.id);
  checks.push(label+' fresh reviewed inverse applies exact typed restoration/deletion');
  const redo=await service.redo(forward.id);await apply(redo.id);checks.push(label+' fresh reviewed redo verifies complete native result');
  if(!name){const restore=await service.reverse(redo.id);await apply(restore.id);checks.push(label+' original live checkpoint restored after redo deletion');}
  assert.equal((await p.readIbDefinitionForReview(key,true)).hash,hash(name?target:value));
  histories.push({definition:key.name,forward:forward.id,inverse:inverse.id,redo:redo.id});
 }
 report.changeSets=histories;report.passed=true;
}finally{
 // Restore every original (the natively deleted provider operation stays recreated only if the trial completed).
 for(const original of originals.values()){
  const current=await p.readIbDefinitionForReview(original.key,true);
  if(report.passed&&original.value===null)continue;
  if(current.hash!==original.hash)await p.writeIbDefinitionForReview({...original.key,after:original.value,expectedSnapshotToken:current.token,expectedAfterHash:original.hash,operatorId,allowDeletedBaseline:true});
 }
 report.originalsRestored=true;
 await writeFile('tools/lab/results/ib-rest-definition-review-native-2026-10-21.json',JSON.stringify(report,null,2)+'\n');await p.dispose();
}
console.log(JSON.stringify(report,null,2));
// The VS Code stub and review store keep handles open; the report is already written.
process.exit(report.passed?0:1);
