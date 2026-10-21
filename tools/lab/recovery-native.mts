/** HRDMO disposable creation/continuation inverse and redo through production adapters. Test service approval, not installed UI. */
import assert from 'node:assert/strict';
import Module from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseProvider } from '../../src/providers/database.js';
import { openDatabase } from '../../src/db/open.js';
import { documentFromSpec } from '../../src/model/aeSpec.js';
import { ReviewService } from '../../src/changeReview/service.js';
import { ReviewStore } from '../../src/changeReview/store.js';
import { hash, type Json } from '../../src/changeReview/model.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';
import { setWriteGuard, writeOrigin } from '../../src/providers/writeGuard.js';
import { isReviewedWrite } from '../../src/changeReview/authorization.js';
import type { Workspace } from '../../src/workspace.js';
const {createStub}=await import('../../scripts/vscode-stub.mjs'); const {vscode}=createStub(),load=(Module as any)._load;
(Module as any)._load=function(name:string,parent:unknown,main:boolean){return name==='vscode'?vscode:load.call(this,name,parent,main);};
const {databaseReviewAdapters}=await import('../../src/changeReview/adapters.js');
const config={name:'HRDMO recovery acceptance',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};
assert.match(config.connectString,/hrdmo/i);assert.ok(config.user&&config.password);
const prefix='ZZ_BR'+randomBytes(2).toString('hex').toUpperCase(),record=prefix+'R',program=prefix+'A',operatorId=process.env.PSLAB_OPERATOR??'JARED';
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection(),root=await mkdtemp(path.join(os.tmpdir(),'psft-recovery-native-'));
setWriteNamePrefix(prefix);setWriteGuard(async w=>{assert.ok([record,program].includes(w.key.parts[0]));if(writeOrigin()==='agent')assert.ok(isReviewedWrite(p.id,w.key));});
const resumeInverse=process.argv.includes('--resume-inverse');
const checks:string[]=[],report:Record<string,unknown>={checkedAt:new Date().toISOString(),scope:resumeInverse?'Disposable HRDMO interrupted inverse with test-injected lost reply after actual native AE deletion, reconciliation, fresh remaining inverse approval and complete redo; trusted service test approval, not installed UI':'Disposable HRDMO native creation/paused continuation/combined deletion/redo; trusted service test approval, not installed UI',record,program,checks};
let owned=false;
const check=async(name:string,fn:()=>Promise<void>)=>{await fn();checks.push(name);console.log('ok '+checks.length+' - '+name);};
const workspace={connections:[],activeProviders:[p],require:async()=>p,isWritable:()=>true,isSqlWritable:()=>true,isPeopleCodeWritable:()=>true,configFor:()=>({peoplesoftOperatorId:operatorId,peoplecodeSaveMode:'compile-and-save'})} as unknown as Workspace;
const registry=databaseReviewAdapters(workspace,()=>({mode:()=> 'confirm',confirm:async()=>{throw Error('No legacy approval path.');},hasUnsavedEditor:()=>false,saved(){}}));
const service=new ReviewService(new ReviewStore(root),{environment:registry.environment,changed(){}},registry.adapters);
const approve=async(id:string,destructive=false)=>{let s=await service.validate(id);assert.equal(s.status,'READY_FOR_REVIEW',JSON.stringify(s.objects.map(c=>c.validation))+' '+JSON.stringify(s.journal.at(-1)));return service.review(id,s.objects.map(c=>c.id),'APPROVED',s.revision,destructive);};
async function cleanup(){if(!owned)return;await c.rollback();
 for(const t of ['PSAEAPPLDEL','PSAESECTDEL','PSAEAPPLDEFN','PSAEAPPLSTATE','PSAEAPPLTEMPTBL','PSAEAPPLLANG','PSAESECTDEFN','PSAESECTDTLDEFN','PSAESTEPDEFN','PSAESTMTDEFN','PSAESTEPMSGDEFN'])await c.execute(`DELETE FROM ${t} WHERE AE_APPLID=:n`,{n:program});
 for(const t of ['PSSQLTEXTDEFN','PSSQLHASH','PSSQLDESCR','PSSQLDEFN','PSSQLDEL'])await c.execute(`DELETE FROM ${t} WHERE SUBSTR(SQLID,1,12)=RPAD(:n,12) AND SQLTYPE IN ('1','6')`,{n:program});
 for(const t of ['PSPCMPROG','PSPCMTXT','PSPCMNAME','PSPCMPROGDEL'])await c.execute(`DELETE FROM ${t} WHERE OBJECTID1=66 AND OBJECTVALUE1=:n`,{n:program});
 for(const t of ['PSRECFIELDDB','PSRECFIELD','PSINDEXDEFN','PSKEYDEFN','PSRECTBLSPC','PSRECDEFN','PSRECDEL'])await c.execute(`DELETE FROM ${t} WHERE RECNAME=:n`,{n:record});await c.commit();}
try{await p.connect();assert.equal((await p.readStructuredCreationForReview('record',record)).value,null);assert.equal((await p.readStructuredCreationForReview('ae',program)).value,null);owned=true;
 const rp=await p.saveRecord({operatorId,dryRun:true,captureSnapshots:true,edit:{recname:record,recordType:2,openedVersion:0,isNew:true,fields:[{name:'PROCESS_INSTANCE',useEdit:1,isNew:true},{name:'DESCR',useEdit:0,isNew:true}]}});
 assert.ok(rp.creationPreview);const rvalue=rp.creationPreview.after.value as unknown as Json;
 const doc=documentFromSpec({program,disableRestart:true,stateRecords:[{record,default:true}],sections:[{name:'MAIN',steps:[{name:'INIT',actions:[{type:'PeopleCode',peopleCode:'Local number &count = 1;\n'}]}]}]});
 const ap=await p.saveAppEngineDocument({doc,openedToken:'absent',operatorId,dryRun:true,captureSnapshots:true});assert.ok(ap.creationPreview);const avalue=ap.creationPreview.after.value as unknown as Json;
 let original=await service.create('Native creation recovery',p.id);original=await service.stage(original.id,'record-create',record,rvalue,[],undefined,rp.creationPreview.before.token);original=await service.stage(original.id,'ae-create',program,avalue,[original.objects[0].id],undefined,ap.creationPreview.before.token);original=await approve(original.id);
 await check('Native one-object apply creates only the record; continuation requires fresh approval and preserves its checkpoint',async()=>{const paused=await service.apply(original.id,true);assert.equal(paused.status,'PARTIALLY_APPLIED');assert.equal((await p.readStructuredCreationForReview('ae',program)).value,null);assert.equal((await p.readStructuredCreationForReview('record',record)).hash,hash(rvalue));});
 let leaf=await service.prepareRemaining(original.id);leaf=await approve(leaf.id);leaf=await service.apply(leaf.id);assert.equal(leaf.status,'APPLIED',JSON.stringify(leaf.journal));
 await check('Continuation applies AE and retains exact native binary/text checkpoint plus record prerequisite',async()=>{assert.equal((await p.readStructuredCreationForReview('ae',program)).hash,hash(avalue));assert.equal(leaf.continuation?.prerequisites.length,1);});
 let inverse=await service.reverse(leaf.id);assert.equal(inverse.schema,3);inverse=await approve(inverse.id,true);
 const inverseRoot=inverse.id;
 if(resumeInverse){
  const adapter=registry.adapters.find(a=>a.id==='ae-create')!,write=adapter.write;let lost=false,deletions=0;
  adapter.write=async(...args)=>{await write(...args);if(args[2]===null){deletions++;if(!lost){lost=true;throw Error('Test-injected lost native deletion reply after commit.');}}};
  await check('Lost AE deletion reply stops undo before Record deletion and leaves forward histories unreverted',async()=>{inverse=await service.apply(inverse.id);assert.equal(inverse.status,'PARTIALLY_APPLIED');assert.equal(inverse.objects.find(o=>o.adapter==='ae-create')?.application,'UNCERTAIN');assert.equal((await p.readStructuredCreationForReview('ae',program,true)).value,null);assert.equal((await p.readStructuredCreationForReview('record',record)).hash,hash(rvalue));assert.equal((await service.store.get(original.id)).status,'PARTIALLY_APPLIED');assert.equal((await service.store.get(leaf.id)).status,'APPLIED');});
  await check('Live reconciliation confirms committed deletion without replay; schema-4 continuation includes only the untouched Record inverse',async()=>{inverse=await service.recover(inverse.id);assert.equal(deletions,1);inverse=await service.prepareRemaining(inverse.id);assert.equal(inverse.schema,4);assert.deepEqual(inverse.objects.map(o=>o.adapter),['record-create']);assert.equal(inverse.continuation?.prerequisites.length,1);assert.equal(inverse.reversalSources?.length,2);await assert.rejects(service.apply(inverse.id),/approved/);inverse=await approve(inverse.id,true);});
  report.inverseRoot=inverseRoot;report.nativeAeDeletionWrites=deletions;
 }
 await check('Combined inverse deletes AE before the state record and verifies native tombstones with both definitions absent',async()=>{inverse=await service.apply(inverse.id);assert.equal(inverse.status,'APPLIED',JSON.stringify(inverse.journal));assert.equal((await p.readStructuredCreationForReview('ae',program,true)).value,null);assert.equal((await p.readStructuredCreationForReview('record',record,true)).value,null);assert.equal((await service.store.get(original.id)).status,'REVERTED');assert.equal((await service.store.get(leaf.id)).status,'REVERTED');});
 let redo=await service.redo(resumeInverse?original.id:leaf.id);redo=await approve(redo.id);
 await check('Fresh redo recreates typed definitions through calibrated writers, removes native tombstones and matches both complete checkpoints',async()=>{redo=await service.apply(redo.id);assert.equal(redo.status,'APPLIED',JSON.stringify(redo.journal));assert.equal((await p.readStructuredCreationForReview('record',record)).hash,hash(rvalue));assert.equal((await p.readStructuredCreationForReview('ae',program)).hash,hash(avalue));});
 report.sets=[original.id,leaf.id,inverse.id,redo.id];report.passed=true;
}catch(error){report.error=error instanceof Error?error.message:String(error);throw error;}
finally{try{await cleanup();report.cleanupVerified=owned?(await p.readStructuredCreationForReview('record',record)).value===null&&(await p.readStructuredCreationForReview('ae',program)).value===null:true;}finally{await writeFile('tools/lab/results/'+(resumeInverse?'recovery-inverse-continuation':'recovery-native')+'-2026-10-20.json',JSON.stringify(report,null,2)+'\n');await c.close();await pool.close();await p.dispose();await rm(root,{recursive:true,force:true});}}
