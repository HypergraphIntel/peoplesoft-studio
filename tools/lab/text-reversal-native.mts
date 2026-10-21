/** Disposable HRDMO provider/transaction acceptance. No installed UI or runtime-execution claim. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile,mkdtemp,rm } from 'node:fs/promises';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { DatabaseProvider } from '../../src/providers/database.js';
import { openDatabase } from '../../src/db/open.js';
import { hash, type Json } from '../../src/changeReview/model.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';
import { setWriteGuard } from '../../src/providers/writeGuard.js';
import { DefinitionType, makeKey } from '../../src/model/definitions.js';
import type { TextDefinitionData, TextDefinitionKind } from '../../src/providers/textDefinitionWriter.js';
import { ReviewStore } from '../../src/changeReview/store.js';
import { ReviewService } from '../../src/changeReview/service.js';
import { isReviewedWrite } from '../../src/changeReview/authorization.js';
import { writeOrigin } from '../../src/providers/writeGuard.js';
import type { Workspace } from '../../src/workspace.js';
const reviewed=process.argv.includes('--review'),root=await mkdtemp(path.join(os.tmpdir(),'psft-text-review-native-'));
const config={name:'HRDMO text reversal acceptance',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};
assert.match(config.connectString,/hrdmo/i);assert.ok(config.user&&config.password);
const prefix='ZZ_BT'+randomBytes(3).toString('hex').toUpperCase(),operatorId=process.env.PSLAB_OPERATOR??'JARED';
const names={sql:prefix+'S',html:prefix+'H',stylesheet:prefix+'C'},project=prefix+'P',reference=prefix+'X';
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection();
const checks:string[]=[],report:Record<string,unknown>={checkedAt:new Date().toISOString(),scope:'Disposable Oracle 8.62 provider/native transactions, rollback previews, guarded deletion, tombstone-aware recreation and complete portable checkpoints; not installed UI',names,project,reference,checks};
const data:Record<TextDefinitionKind,TextDefinitionData>={
 sql:{name:names.sql,text:'SELECT 9 FROM PS_INSTALLATION',description:'Native SQL reversal',definition:'Installed complete comments é😀 '.repeat(600),ownerId:'PPT'},
 html:{name:names.html,text:'<div>Reversal é😀</div>\r\n'.repeat(1200),description:'Native HTML reversal'},
 stylesheet:{name:names.stylesheet,text:'.nativeReversal { color: blue; }\r\n'.repeat(700),description:'Native CSS reversal'}
};
setWriteNamePrefix(prefix);setWriteGuard(async w=>{assert.ok([...Object.values(names),project,reference].includes(w.key.parts[0]));if(writeOrigin()==='agent')assert.ok(isReviewedWrite(p.id,w.key));});
const check=async(name:string,fn:()=>Promise<void>)=>{await fn();checks.push(name);console.log('ok '+checks.length+' - '+name);};
let owned=false;
const write=async(kind:TextDefinitionKind,name:string,after:TextDefinitionData|null,dryRun=false,allowDeletedBaseline=false)=>{
 const before=await p.readTextDefinitionForReview(kind,name,true);
 return p.writeTextDefinitionForReview({kind,name,after,operatorId,expectedSnapshotToken:before.token,expectedAfterHash:hash(after as unknown as Json),dryRun,allowDeletedBaseline});
};
async function cleanup(){if(!owned)return;await c.rollback();
 for(const t of ['PSPROJECTITEM','PSPROJECTDEFN'])await c.execute(`DELETE FROM ${t} WHERE PROJECTNAME=:n`,{n:project});
 for(const n of [names.sql,reference])for(const t of ['PSSQLTEXTDEFN','PSSQLHASH','PSSQLDESCR','PSSQLDEFN','PSSQLLANG','PSSQLDEL'])await c.execute(`DELETE FROM ${t} WHERE SQLID=:n`,{n});
 for(const n of [names.html,names.stylesheet]){
  for(const t of ['PSCONTENTLANG','PSCONTDEFNLANG','PSCONTENT','PSCONTDEFN','PSCONTDEL'])await c.execute(`DELETE FROM ${t} WHERE CONTNAME=:n`,{n});
  for(const t of ['PSSTYLECLSLANG','PSSTYLEDFNLANG','PSSTYLECLASS','PSSTYLSHEETDEL','PSSTYLSHEETDEFN'])await c.execute(`DELETE FROM ${t} WHERE STYLESHEETNAME=:n`,{n});
 }await c.commit();
}
try{
 await p.connect();for(const kind of ['sql','html','stylesheet'] as const)assert.equal((await p.readTextDefinitionForReview(kind,names[kind])).token,'absent');
 assert.equal((await p.readTextDefinitionForReview('sql',reference)).token,'absent');assert.equal(await p.projectExists(project),false);
 assert.equal(Number((await c.execute<{N:number}>('SELECT COUNT(*) AS N FROM PSPROJECTITEM WHERE PROJECTNAME=:n',{n:project})).rows![0].N),0);owned=true;
 for(const kind of ['sql','html','stylesheet'] as const){const name=names[kind],after=data[kind];
  await check(kind+' preview rolls back native rows/counters; create preserves full metadata and multi-chunk Unicode content',async()=>{
   const preview=await write(kind,name,after,true);assert.deepEqual(preview.after.value,after);assert.equal((await p.readTextDefinitionForReview(kind,name)).token,'absent');
   await write(kind,name,after);assert.deepEqual((await p.readTextDefinitionForReview(kind,name)).value,after);
  });
  await check(kind+' stale full token refuses deletion without mutation',async()=>{const live=await p.readTextDefinitionForReview(kind,name);
   await assert.rejects(p.writeTextDefinitionForReview({kind,name,after:null,operatorId,expectedSnapshotToken:'stale',expectedAfterHash:hash(null)}),/baseline changed/);
   assert.equal((await p.readTextDefinitionForReview(kind,name)).token,live.token);
  });
  if(kind==='sql'){
   await check('Native project membership and stored SQL macro references refuse deletion; proposed assumptions cannot commit',async()=>{
    const created=await p.createProject({project,operatorId});await p.saveProject({project,operatorId,openedVersion:created.version,add:[makeKey(DefinitionType.SqlDefinition,name,'0')]});
    const before=await p.readTextDefinitionForReview(kind,name);await assert.rejects(write(kind,name,null,true),/project still references/);
    await assert.rejects(p.writeTextDefinitionForReview({kind,name,after:null,operatorId,expectedSnapshotToken:before.token,expectedAfterHash:hash(null),proposedProjectDeletions:[project]}),/cannot be used by a committing writer/);
    await c.execute('DELETE FROM PSPROJECTITEM WHERE PROJECTNAME=:n',{n:project});await c.commit();
    const refData={name:reference,text:'%SQL('+name+')',description:'Native reference check',definition:'',ownerId:''};await write('sql',reference,refData);
    await assert.rejects(write(kind,name,null,true),/Stored SQL references/);await write('sql',reference,null);assert.equal((await p.readTextDefinitionForReview(kind,name)).token,before.token);
   });
  }
  await check(kind+' deletion preview rolls back; committed deletion writes the calibrated marker scope',async()=>{
   const before=await p.readTextDefinitionForReview(kind,name);const preview=await write(kind,name,null,true);assert.equal(preview.after.deleted,true);assert.equal((await p.readTextDefinitionForReview(kind,name)).token,before.token);
   await write(kind,name,null);const deleted=await p.readTextDefinitionForReview(kind,name,true);assert.equal(deleted.value,null);assert.equal(deleted.deleted,true);
   await assert.rejects(p.readTextDefinitionForReview(kind,name),/explicit reviewed restoration/);
   await assert.rejects(write(kind,name,after),/explicit reviewed restoration/);assert.equal((await p.readTextDefinitionForReview(kind,name,true)).token,deleted.token);
  });
  await check(kind+' explicit redo preview restores tombstone baseline on rollback; redo clears markers and reproduces the complete checkpoint',async()=>{
   const before=await p.readTextDefinitionForReview(kind,name,true);await write(kind,name,after,true,true);assert.equal((await p.readTextDefinitionForReview(kind,name,true)).token,before.token);
   await write(kind,name,after,false,true);assert.deepEqual((await p.readTextDefinitionForReview(kind,name)).value,after);
  });
 }
 if(reviewed){
  await cleanup();
  const {createStub}=await import('../../scripts/vscode-stub.mjs'),{vscode}=createStub(),load=(Module as any)._load;
  (Module as any)._load=function(name:string,parent:unknown,main:boolean){return name==='vscode'?vscode:load.call(this,name,parent,main);};
  const {databaseReviewAdapters}=await import('../../src/changeReview/adapters.js');
  const workspace={connections:[],activeProviders:[p],require:async()=>p,isWritable:()=>true,isSqlWritable:()=>true,isPeopleCodeWritable:()=>true,configFor:()=>({peoplesoftOperatorId:operatorId,peoplecodeSaveMode:'compile-and-save'})} as unknown as Workspace;
  const registry=databaseReviewAdapters(workspace,()=>({mode:()=> 'confirm',confirm:async()=>{throw Error('Review must not fall back to legacy modal approval.');},hasUnsavedEditor:()=>false,saved(){}}));
  const service=new ReviewService(new ReviewStore(root),{environment:registry.environment,changed(){}},registry.adapters);
  const approve=async(id:string,destructive=false)=>{const s=await service.validate(id);assert.equal(s.status,'READY_FOR_REVIEW',JSON.stringify(s.objects.map(c=>c.validation))+' '+JSON.stringify(s.journal.at(-1)));return service.review(id,s.objects.map(c=>c.id),'APPROVED',s.revision,destructive);};
  const values={...data,html:{...data.html,text:'<link href="%StyleSheet('+names.stylesheet+')">\r\n'+data.html.text}};
  let original=await service.create('Native complete text recovery',p.id);
  for(const kind of ['sql','stylesheet','html'] as const)original=await service.stage(original.id,kind+'-definition',names[kind],values[kind] as unknown as Json,original.objects.length?[original.objects.at(-1)!.id]:[]);
  await check('Complete text proposals retain metadata without writing and require fresh approval',async()=>{assert.equal((await p.readTextDefinitionForReview('sql',names.sql)).value,null);await assert.rejects(service.apply(original.id),/approved/);original=await approve(original.id);});
  await check('Native one-object pause verifies SQL metadata; unchanged-VERSION comment drift blocks remaining work',async()=>{
   original=await service.apply(original.id,true);assert.equal(original.status,'PARTIALLY_APPLIED');assert.deepEqual((await p.readTextDefinitionForReview('sql',names.sql)).value,values.sql);
   const previous=(values.sql as any).definition;
   await c.execute('UPDATE PSSQLDESCR SET DESCRLONG=:d WHERE SQLID=:n AND SQLTYPE=0',{n:names.sql,d:{val:previous+' drift',type:pool.types.CLOB}});await c.commit();
   try{await assert.rejects(service.prepareRemaining(original.id),/confirmed object changed/);}finally{await c.execute('UPDATE PSSQLDESCR SET DESCRLONG=:d WHERE SQLID=:n AND SQLTYPE=0',{n:names.sql,d:{val:previous,type:pool.types.CLOB}});await c.commit();}
  });
  let leaf=await service.prepareRemaining(original.id);leaf=await approve(leaf.id);leaf=await service.apply(leaf.id);assert.equal(leaf.status,'APPLIED',JSON.stringify(leaf.journal));
  await check('Fresh native continuation creates CSS before its referring HTML and verifies complete checkpoints',async()=>{for(const kind of ['sql','html','stylesheet'] as const)assert.deepEqual((await p.readTextDefinitionForReview(kind,names[kind])).value,values[kind]);await assert.rejects(write('stylesheet',names.stylesheet,null,true),/Stored content mentions/);});
  let inverse=await service.reverse(leaf.id);inverse=await approve(inverse.id,true);const inverseRoot=inverse.id;
  const htmlAdapter=registry.adapters.find(a=>a.id==='html-definition')!,htmlWrite=htmlAdapter.write;let lost=false,htmlDeletions=0;
  htmlAdapter.write=async(...args)=>{await htmlWrite(...args);if(args[2]===null){htmlDeletions++;if(!lost){lost=true;throw Error('Test-injected lost reply after native HTML deletion commit.');}}};
  await check('Combined text inverse validates declared content dependencies and stops safely after a lost committed deletion reply',async()=>{inverse=await service.apply(inverse.id);assert.equal(inverse.status,'PARTIALLY_APPLIED');assert.equal(inverse.objects.find(o=>o.adapter==='html-definition')?.application,'UNCERTAIN');assert.equal((await service.store.get(leaf.id)).status,'APPLIED');});
  await check('Reconciliation never repeats the committed HTML deletion; remaining CSS/SQL undo needs fresh destructive approval',async()=>{inverse=await service.recover(inverse.id);assert.equal(htmlDeletions,1);inverse=await service.prepareRemaining(inverse.id);assert.equal(inverse.schema,4);assert.deepEqual(new Set(inverse.objects.map(o=>o.adapter)),new Set(['stylesheet-definition','sql-definition']));await assert.rejects(service.apply(inverse.id),/approved/);inverse=await approve(inverse.id,true);inverse=await service.apply(inverse.id);assert.equal(inverse.status,'APPLIED',JSON.stringify(inverse.journal));for(const kind of ['sql','html','stylesheet'] as const)assert.equal((await p.readTextDefinitionForReview(kind,names[kind],true)).deleted,true);assert.equal((await service.store.get(original.id)).status,'REVERTED');assert.equal((await service.store.get(leaf.id)).status,'REVERTED');});
  let redo=await service.redo(original.id);redo=await approve(redo.id);redo=await service.apply(redo.id);
  await check('Fresh redo from original source history restores all three complete native checkpoints and removes every tombstone',async()=>{assert.equal(redo.status,'APPLIED',JSON.stringify(redo.journal));for(const kind of ['sql','html','stylesheet'] as const)assert.deepEqual((await p.readTextDefinitionForReview(kind,names[kind])).value,values[kind]);assert.equal(htmlDeletions,1);});
  report.reviewSets=[original.id,leaf.id,inverseRoot,inverse.id,redo.id];report.htmlDeletionWrites=htmlDeletions;
 }
 await check('Concurrent native SQL and stylesheet saves serialize shared counters and preserve both full after-images',async()=>{
  const sql=(await p.readTextDefinitionForReview('sql',names.sql)).value!,css=(await p.readTextDefinitionForReview('stylesheet',names.stylesheet)).value!;
  for(let i=0;i<3;i++){
   const nextSql={...sql,description:'Concurrent SQL '+i},nextCss={...css,description:'Concurrent CSS '+i};
   const results=await Promise.allSettled([write('sql',names.sql,nextSql),write('stylesheet',names.stylesheet,nextCss)]);
   for(const result of results)assert.equal(result.status,'fulfilled',result.status==='rejected'?String(result.reason):'');
   assert.deepEqual((await p.readTextDefinitionForReview('sql',names.sql)).value,nextSql);
   assert.deepEqual((await p.readTextDefinitionForReview('stylesheet',names.stylesheet)).value,nextCss);
  }
 });
 report.passed=true;
}catch(error){report.error=error instanceof Error?error.message:String(error);throw error;}
finally{try{await cleanup();report.cleanupVerified=owned?(await Promise.all((['sql','html','stylesheet'] as const).map(k=>p.readTextDefinitionForReview(k,names[k])))).every(s=>s.value===null&&!s.deleted)&&(await p.readTextDefinitionForReview('sql',reference)).token==='absent'&&!await p.projectExists(project):true;}finally{await writeFile('tools/lab/results/'+(reviewed?'text-reversal-reviewed-native':'text-reversal-native')+'-2026-10-20.json',JSON.stringify(report,null,2)+'\n');await c.close();await pool.close();await p.dispose();await rm(root,{recursive:true,force:true});}}
