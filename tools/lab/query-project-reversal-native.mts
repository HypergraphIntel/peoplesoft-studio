/** Disposable HRDMO Query/project creation reversal: provider transactions, then (--review) durable Change Review. Not installed UI. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { DatabaseProvider } from '../../src/providers/database.js';
import { openDatabase } from '../../src/db/open.js';
import { hash, type Json } from '../../src/changeReview/model.js';
import { querySnapshot } from '../../src/changeReview/query.js';
import { applyQueryOp, newQueryDocument } from '../../src/model/queryDocument.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';
import { setWriteGuard, writeOrigin } from '../../src/providers/writeGuard.js';
import { DefinitionType, makeKey, type DefinitionKey } from '../../src/model/definitions.js';
import { ReviewStore } from '../../src/changeReview/store.js';
import { ReviewService } from '../../src/changeReview/service.js';
import { isReviewedWrite } from '../../src/changeReview/authorization.js';
import type { Workspace } from '../../src/workspace.js';
const reviewed=process.argv.includes('--review'),root=await mkdtemp(path.join(os.tmpdir(),'psft-query-project-reversal-'));
const config={name:'HRDMO Query/project reversal acceptance',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};
assert.match(config.connectString,/hrdmo/i);assert.ok(config.user&&config.password);
const prefix='ZZ_BR'+randomBytes(3).toString('hex').toUpperCase(),operatorId=process.env.PSLAB_OPERATOR??'JARED';
const pub=prefix+'Q',priv=prefix+'J',project=prefix+'P',queryKey=makeKey(DefinitionType.Query,pub);
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection();
const checks:string[]=[],report:Record<string,unknown>={checkedAt:new Date().toISOString(),scope:'Disposable Oracle 8.62 Query (public/private) and project creation reversal: rollback previews, guarded deletion, owner-specific tombstones, marker-bound redo'+(reviewed?', durable Change Review apply/pause/inverse/lost reply/redo with trusted service approval':'')+'; not installed UI',names:{pub,priv,project},operatorId,checks};
setWriteNamePrefix(prefix);setWriteGuard(async w=>{assert.ok([pub,priv,project].includes(w.key.parts[0]));if(writeOrigin()==='agent')assert.ok(isReviewedWrite(p.id,w.key));});
const check=async(name:string,fn:()=>Promise<void>)=>{await fn();checks.push(name);console.log('ok '+checks.length+' - '+name);};
const counters=async()=>(await c.execute<{T:string;V:number}>("SELECT OBJECTTYPENAME AS T,VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN ('QDM','PJM','SYS') ORDER BY 1")).rows!.map(r=>r.T+'='+r.V).join(',');
const marker=async(table:'PSQRYDEL'|'PSPROJECTDEL',name:string)=>(await c.execute<Record<string,unknown>>(`SELECT * FROM ${table} WHERE ${table==='PSQRYDEL'?'QRYNAME':'PROJECTNAME'}=:n`,{n:name})).rows!;
let owned=false;
const writeQuery=async(name:string,owner:string,after:Json,dryRun=false,extra:{proposedProjectDeletions?:string[]}={})=>{
 const before=await p.readQueryForReview(name,owner,true);
 return p.writeQueryForReview({name,owner,after,operatorId,expectedSnapshotToken:before.token,expectedAfterHash:hash(after),allowDeletedBaseline:true,dryRun,...extra});
};
const writeProject=async(items:DefinitionKey[]|null,after:Json,dryRun=false)=>{
 const before=await p.readProjectCreationForReview(project,true);
 return p.writeProjectForReview({name:project,items,mode:'full',operatorId,expectedSnapshotToken:before.token,expectedAfterHash:hash(after),allowDeletedBaseline:true,dryRun});
};
async function cleanup(){if(!owned)return;await c.rollback();
 for(const [n,o] of [[pub,' '],[priv,operatorId]])for(const t of ['PSQRYBIND','PSQRYEXPR','PSQRYCRITERIA','PSQRYFIELD','PSQRYRECORD','PSQRYSELECT','PSQRYDEFN','PSQRYDEL'])await c.execute(`DELETE FROM ${t} WHERE QRYNAME=:n AND OPRID=:o`,{n,o});
 for(const t of ['PSPROJECTITEM','PSPROJECTDEFN','PSPROJECTDEL'])await c.execute(`DELETE FROM ${t} WHERE PROJECTNAME=:n`,{n:project});await c.commit();
}
try{
 await p.connect();assert.equal((await p.readEnvironment()).toolsRelease,'8.62');
 for(const n of [pub,priv]){assert.equal((await c.execute<{N:number}>('SELECT COUNT(*) AS N FROM PSQRYDEFN WHERE QRYNAME=:n',{n})).rows![0].N,0);assert.equal((await marker('PSQRYDEL',n)).length,0);}
 assert.equal(await p.projectExists(project),false);assert.equal((await marker('PSPROJECTDEL',project)).length,0);
 assert.equal(Number((await c.execute<{N:number}>('SELECT COUNT(*) AS N FROM PSPROJECTITEM WHERE PROJECTNAME=:n',{n:project})).rows![0].N),0);owned=true;
 const layout=await p.readRecordLayout(makeKey(DefinitionType.Record,'AAP_TBL')),field=layout!.fields.find(f=>f.name==='DESCR')!;assert.ok(field&&field.type===0);
 const info={DESCR:{type:field.type,length:field.length,decimalPositions:field.decimalPositions??0,format:6,shortName:field.shortName,longName:field.longName,editTable:field.editTable,useEdit:field.useEdit}};
 const queryValue=(name:string,owner:string)=>{let view=applyQueryOp(newQueryDocument(name,owner,'AAP_TBL'),{kind:'select',field:'DESCR',selected:true},info);
  view=applyQueryOp(view,{kind:'properties',description:'Reversal Query',comments:'Native reversal é😀'},info);return querySnapshot(view);};
 const pubValue=queryValue(pub,''),privValue=queryValue(priv,operatorId);
 await check('Public Query creation preview rolls back rows and QDM; committed creation reproduces the complete checkpoint',async()=>{
  const before=await counters(),preview=await writeQuery(pub,'',pubValue,true);assert.equal(preview.after.hash,hash(pubValue));
  assert.equal((await p.readQueryForReview(pub,'')).token,'absent');assert.equal(await counters(),before);
  await writeQuery(pub,'',pubValue);assert.deepEqual((await p.readQueryForReview(pub,'')).value,pubValue);
 });
 await check('Stale complete Query token refuses deletion without mutation',async()=>{const live=await p.readQueryForReview(pub,'');
  await assert.rejects(p.writeQueryForReview({name:pub,owner:'',after:null,operatorId,expectedSnapshotToken:'stale',expectedAfterHash:hash(null)}),/baseline changed/);
  assert.equal((await p.readQueryForReview(pub,'')).token,live.token);
 });
 let projectValue:Json=null;
 await check('Project creation with the Query member previews, commits and reproduces its full calibrated checkpoint',async()=>{
  const preview=await p.createProjectForReview({project,operatorId,items:[queryKey],dryRun:true,expectedSnapshotToken:(await p.readProjectCreationForReview(project,true)).token});
  projectValue=preview.after.value;assert.ok(projectValue);assert.equal((await p.readProjectCreationForReview(project)).value,null);
  const before=await counters();await writeProject([queryKey],projectValue,true);assert.equal(await counters(),before);assert.equal((await p.readProjectCreationForReview(project)).value,null);
  await writeProject([queryKey],projectValue);assert.deepEqual((await p.readProjectCreationForReview(project)).value,projectValue);
 });
 await check('Project membership refuses Query deletion; a proposed project deletion is a rollback-preview assumption only',async()=>{
  const live=await p.readQueryForReview(pub,'');await assert.rejects(writeQuery(pub,'',null,true),/project still references/);
  await writeQuery(pub,'',null,true,{proposedProjectDeletions:[project]});
  await assert.rejects(writeQuery(pub,'',null,false,{proposedProjectDeletions:[project]}),/rollback-preview assumptions only/);
  assert.equal((await p.readQueryForReview(pub,'')).token,live.token);
 });
 await check('Nondefault project metadata refuses deletion without mutation',async()=>{
  await c.execute("UPDATE PSPROJECTDEFN SET PROJECTDESCR='Edited' WHERE PROJECTNAME=:n",{n:project});await c.commit();
  try{const s=await p.readProjectCreationForReview(project);await assert.rejects(p.writeProjectForReview({name:project,items:null,mode:'full',operatorId,expectedSnapshotToken:s.token,expectedAfterHash:hash(null),dryRun:true}),/calibrated creation defaults/);}
  finally{await c.execute("UPDATE PSPROJECTDEFN SET PROJECTDESCR=' ' WHERE PROJECTNAME=:n",{n:project});await c.commit();}
  assert.deepEqual((await p.readProjectCreationForReview(project)).value,projectValue);
 });
 await check('Project deletion preview rolls back; committed deletion removes header/members only, writes PSPROJECTDEL at PJM and keeps the Query',async()=>{
  const queryToken=(await p.readQueryForReview(pub,'')).token,before=await p.readProjectCreationForReview(project),counts=await counters();
  await writeProject(null,null,true);assert.equal((await p.readProjectCreationForReview(project)).token,before.token);assert.equal(await counters(),counts);
  await writeProject(null,null);const deleted=await p.readProjectCreationForReview(project,true);assert.equal(deleted.value,null);assert.equal(deleted.deleted,true);
  const pjm=(await c.execute<{V:number}>("SELECT VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME='PJM'")).rows![0].V,rows=await marker('PSPROJECTDEL',project);
  assert.equal(rows.length,1);assert.equal(Number(rows[0].VERSION),Number(pjm));assert.equal((await p.readQueryForReview(pub,'')).token,queryToken);
  await assert.rejects(p.readProjectCreationForReview(project),/explicit reviewed restoration/);
  await assert.rejects(p.createProjectForReview({project,operatorId,items:[],expectedSnapshotToken:deleted.token}),/./);assert.equal((await p.readProjectCreationForReview(project,true)).token,deleted.token);
 });
 await check('Public Query deletion writes the blank-owner PSQRYDEL at QDM; ordinary reads and creation refuse the tombstone',async()=>{
  const before=await p.readQueryForReview(pub,''),preview=await writeQuery(pub,'',null,true);assert.equal(preview.after.deleted,true);assert.equal((await p.readQueryForReview(pub,'')).token,before.token);
  await writeQuery(pub,'',null);const deleted=await p.readQueryForReview(pub,'',true);assert.equal(deleted.value,null);assert.equal(deleted.deleted,true);
  const qdm=(await c.execute<{V:number}>("SELECT VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME='QDM'")).rows![0].V,rows=await marker('PSQRYDEL',pub);
  assert.equal(rows.length,1);assert.equal(String(rows[0].OPRID),' ');assert.equal(Number(rows[0].VERSION),Number(qdm));
  await assert.rejects(p.readQueryForReview(pub,''),/explicit reviewed restoration/);
  await assert.rejects(p.writeQueryForReview({name:pub,owner:'',after:pubValue,operatorId,expectedSnapshotToken:deleted.token,expectedAfterHash:hash(pubValue)}),/explicit reviewed restoration/);
  assert.equal((await p.readQueryForReview(pub,'',true)).token,deleted.token);
 });
 await check('Query and project redo previews restore tombstones on rollback; redo clears each bound marker and reproduces both checkpoints',async()=>{
  const q=await p.readQueryForReview(pub,'',true),pr=await p.readProjectCreationForReview(project,true);
  await writeQuery(pub,'',pubValue,true);assert.equal((await p.readQueryForReview(pub,'',true)).token,q.token);
  await writeQuery(pub,'',pubValue);assert.deepEqual((await p.readQueryForReview(pub,'')).value,pubValue);assert.equal((await marker('PSQRYDEL',pub)).length,0);
  await writeProject([queryKey],projectValue,true);assert.equal((await p.readProjectCreationForReview(project,true)).token,pr.token);
  await writeProject([queryKey],projectValue);assert.deepEqual((await p.readProjectCreationForReview(project)).value,projectValue);assert.equal((await marker('PSPROJECTDEL',project)).length,0);
 });
 await check('Private Query deletion writes an owner-specific marker; its redo clears only that owner',async()=>{
  await writeQuery(priv,operatorId,privValue);assert.deepEqual((await p.readQueryForReview(priv,operatorId)).value,privValue);
  await writeQuery(priv,operatorId,null);const rows=await marker('PSQRYDEL',priv);assert.equal(rows.length,1);assert.equal(String(rows[0].OPRID),operatorId);
  assert.equal((await p.readQueryForReview(priv,'')).token,'absent');
  await writeQuery(priv,operatorId,privValue);assert.deepEqual((await p.readQueryForReview(priv,operatorId)).value,privValue);assert.equal((await marker('PSQRYDEL',priv)).length,0);
 });
 if(reviewed){
  await cleanup();
  const {createStub}=await import('../../scripts/vscode-stub.mjs'),{vscode}=createStub(),load=(Module as any)._load;
  (Module as any)._load=function(name:string,parent:unknown,main:boolean){return name==='vscode'?vscode:load.call(this,name,parent,main);};
  const {databaseReviewAdapters}=await import('../../src/changeReview/adapters.js');
  const workspace={connections:[],activeProviders:[p],require:async()=>p,isWritable:()=>true,isSqlWritable:()=>true,isPeopleCodeWritable:()=>true,configFor:()=>({peoplesoftOperatorId:operatorId,peoplecodeSaveMode:'compile-and-save'})} as unknown as Workspace;
  const registry=databaseReviewAdapters(workspace,()=>({mode:()=> 'confirm',confirm:async()=>{throw Error('Review must not fall back to legacy modal approval.');},hasUnsavedEditor:()=>false,saved(){}}));
  const service=new ReviewService(new ReviewStore(root),{environment:registry.environment,changed(){}},registry.adapters);
  const approve=async(id:string,destructive=false)=>{const s=await service.validate(id);assert.equal(s.status,'READY_FOR_REVIEW',JSON.stringify(s.objects.map(o=>o.validation))+' '+JSON.stringify(s.journal.at(-1)));return service.review(id,s.objects.map(o=>o.id),'APPROVED',s.revision,destructive);};
  let original=await service.create('Native Query/project creation recovery',p.id);
  original=await service.stage(original.id,'query',[pub,''],pubValue);original=await service.stage(original.id,'project-create',project,projectValue,[original.objects[0].id]);
  await check('Query and dependent project proposals stage without writing and require approval',async()=>{assert.equal((await p.readQueryForReview(pub,'')).token,'absent');assert.equal((await p.readProjectCreationForReview(project)).value,null);await assert.rejects(service.apply(original.id),/approved/);original=await approve(original.id);});
  await check('One-object pause creates and verifies only the Query; continuation needs fresh approval',async()=>{
   original=await service.apply(original.id,true);assert.equal(original.status,'PARTIALLY_APPLIED');assert.deepEqual((await p.readQueryForReview(pub,'')).value,pubValue);assert.equal((await p.readProjectCreationForReview(project)).value,null);
  });
  let leaf=await service.prepareRemaining(original.id);await assert.rejects(service.apply(leaf.id),/approved/);leaf=await approve(leaf.id);leaf=await service.apply(leaf.id);assert.equal(leaf.status,'APPLIED',JSON.stringify(leaf.journal));
  await check('Continuation creates the project after its Query and verifies the complete checkpoint',async()=>{assert.deepEqual((await p.readProjectCreationForReview(project)).value,projectValue);});
  let inverse=await service.reverse(leaf.id);
  await check('Inverse requires destructive approval',async()=>{const s=await service.validate(inverse.id);assert.equal(s.status,'READY_FOR_REVIEW',JSON.stringify(s.objects.map(o=>o.validation)));await assert.rejects(service.review(s.id,s.objects.map(o=>o.id),'APPROVED',s.revision,false),/destructive|delet/i);inverse=await approve(inverse.id,true);});
  const inverseRoot=inverse.id,projectAdapter=registry.adapters.find(a=>a.id==='project-create')!,projectWrite=projectAdapter.write;let lost=false,projectDeletions=0;
  projectAdapter.write=async(...args)=>{await projectWrite(...args);if(args[2]===null){projectDeletions++;if(!lost){lost=true;throw Error('Test-injected lost reply after native project deletion commit.');}}};
  await check('Inverse deletes the project before its Query and stops safely after a lost committed deletion reply',async()=>{inverse=await service.apply(inverse.id);assert.equal(inverse.status,'PARTIALLY_APPLIED',JSON.stringify(inverse.journal));assert.equal(inverse.objects.find(o=>o.adapter==='project-create')?.application,'UNCERTAIN');assert.equal((await p.readProjectCreationForReview(project,true)).deleted,true);assert.deepEqual((await p.readQueryForReview(pub,'')).value,pubValue);});
  await check('Reconciliation never repeats the project deletion; the remaining Query undo needs fresh destructive approval',async()=>{
   inverse=await service.recover(inverse.id);assert.equal(projectDeletions,1);inverse=await service.prepareRemaining(inverse.id);
   assert.deepEqual(inverse.objects.map(o=>o.adapter),['query']);await assert.rejects(service.apply(inverse.id),/approved/);inverse=await approve(inverse.id,true);inverse=await service.apply(inverse.id);
   assert.equal(inverse.status,'APPLIED',JSON.stringify(inverse.journal));assert.equal((await p.readQueryForReview(pub,'',true)).deleted,true);assert.equal((await p.readProjectCreationForReview(project,true)).deleted,true);
   assert.equal((await service.store.get(original.id)).status,'REVERTED');assert.equal((await service.store.get(leaf.id)).status,'REVERTED');
  });
  let redo=await service.redo(original.id);redo=await approve(redo.id);redo=await service.apply(redo.id);
  await check('Fresh redo from original history clears both tombstones and restores the Query and project checkpoints',async()=>{assert.equal(redo.status,'APPLIED',JSON.stringify(redo.journal));assert.deepEqual((await p.readQueryForReview(pub,'')).value,pubValue);assert.deepEqual((await p.readProjectCreationForReview(project)).value,projectValue);assert.equal(projectDeletions,1);});
  report.reviewSets=[original.id,leaf.id,inverseRoot,inverse.id,redo.id];report.projectDeletionWrites=projectDeletions;
 }
 report.passed=true;
}catch(error){report.error=error instanceof Error?error.stack??error.message:String(error);throw error;}
finally{try{await cleanup();report.cleanupVerified=owned?(await Promise.all([[pub,' '],[priv,operatorId]].map(async([n,o])=>Number((await c.execute<{N:number}>('SELECT (SELECT COUNT(*) FROM PSQRYDEFN WHERE QRYNAME=:n AND OPRID=:o)+(SELECT COUNT(*) FROM PSQRYDEL WHERE QRYNAME=:n AND OPRID=:o) AS N FROM DUAL',{n,o})).rows![0].N)===0))).every(Boolean)&&!await p.projectExists(project)&&(await marker('PSPROJECTDEL',project)).length===0:true;}
 finally{await writeFile('tools/lab/results/query-project-reversal'+(reviewed?'-reviewed':'')+'-native-2026-10-20.json',JSON.stringify(report,null,2)+'\n');await c.close();await pool.close();await p.dispose();await rm(root,{recursive:true,force:true});}}
