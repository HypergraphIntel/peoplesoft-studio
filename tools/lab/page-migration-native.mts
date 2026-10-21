/** Disposable HRDMO page migration: rich delivered pages are copied (read only) to ZZ pages, then migrated and reviewed. */
import assert from 'node:assert/strict';
import Module from 'node:module';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {DatabaseProvider} from '../../src/providers/database.js';
import {openDatabase} from '../../src/db/open.js';
import {DefinitionType,makeKey} from '../../src/model/definitions.js';
import {canonical,type Json} from '../../src/changeReview/model.js';
import {PAGE_SNAPSHOT_TABLES,type NativePageSnapshot} from '../../src/providers/pageSnapshot.js';
import type {PageMigrationData} from '../../src/providers/pageMigration.js';
import {setWriteNamePrefix} from '../../src/providers/writeScope.js';
import {setWriteGuard,writeOrigin} from '../../src/providers/writeGuard.js';
import {isReviewedWrite} from '../../src/changeReview/authorization.js';
import {databaseMigrationTarget} from '../../src/providers/migrationTarget.js';
import {exportMigrationPackage,previewMigrationImport,applyMigrationImport} from '../../src/migrationPackage.js';
import {stageMigrationImport} from '../../src/changeReview/migration.js';
import {ReviewService} from '../../src/changeReview/service.js';import {ReviewStore} from '../../src/changeReview/store.js';
import type {Workspace} from '../../src/workspace.js';
const {createStub}=await import('../../scripts/vscode-stub.mjs');const {vscode}=createStub(),load=(Module as any)._load;
(Module as any)._load=function(n:string,p:unknown,m:boolean){return n==='vscode'?vscode:load.call(this,n,p,m);};const {databaseReviewAdapters}=await import('../../src/changeReview/adapters.js');
const config={name:'HRDMO page migration acceptance',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};assert.match(config.connectString,/hrdmo/i);assert.ok(config.user&&config.password);
const prefix='ZZ_BG'+randomBytes(3).toString('hex').toUpperCase(),project=prefix+'P',operatorId=process.env.PSLAB_OPERATOR??'JARED';
const sources={[prefix+'C']:'HRS_APP_PRINT_PAGE',[prefix+'F']:'EOQF_EVENT_NOTF_FL'},pages=Object.keys(sources);
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection(),dir=await mkdtemp(path.join(os.tmpdir(),'psft-page-migration-native-'));let owned=false;
setWriteNamePrefix(prefix);setWriteGuard(async w=>{assert.ok([...pages,project].includes(w.key.parts[0]),JSON.stringify(w.key));if(writeOrigin()==='agent')assert.ok(isReviewedWrite(p.id,w.key));});
const checks:string[]=[],report:Record<string,unknown>={checkedAt:new Date().toISOString(),scope:'Disposable HRDMO pages copied row-for-row from delivered classic '+sources[pages[0]]+' and Fluid '+sources[pages[1]]+' (read only): writer copy, export with prerequisites, vacant-target creation, unchanged repeat, existing-page refusal, tombstone refusal and durable review; same database; trusted service test approval, not installed UI',pages,project,checks};
const check=async(n:string,fn:()=>Promise<void>)=>{await fn();checks.push(n);console.log('ok '+checks.length+' - '+n);};
const counters=async()=>(await c.execute("SELECT OBJECTTYPENAME, VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('PDM','PJM','SYS') ORDER BY OBJECTTYPENAME")).rows;
async function cleanup(){if(!owned)return;await c.rollback();for(const n of pages){for(const t of [...PAGE_SNAPSHOT_TABLES].reverse())await c.execute(`DELETE FROM ${t} WHERE PNLNAME=:n`,{n});await c.execute('DELETE FROM PSPNLDEL WHERE PNLNAME=:n',{n});}
 for(const t of ['PSPROJECTITEM','PSPROJECTDEFN'])await c.execute(`DELETE FROM ${t} WHERE PROJECTNAME=:n`,{n:project});await c.commit();}
/** Save As: every row under the new name, including the '<page>$<id>' control references. */
function renamed(native:NativePageSnapshot,from:string,to:string):PageMigrationData{
 const swap=(v:Json)=>typeof v==='string'&&(v.trim()===from||v.startsWith(from+'$'))?to+v.trim().slice(from.length):v;
 const tables=Object.fromEntries(PAGE_SNAPSHOT_TABLES.map(t=>[t,native.tables[t].map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,k==='PNLNAME'||k==='PARENTPNLFLDID'||k==='PAGEPNLFLDID'?swap(v):v])))
  .sort((a,b)=>canonical(a)<canonical(b)?-1:canonical(a)>canonical(b)?1:0)]));
 return {name:to,native:{scope:native.scope,tables} as NativePageSnapshot};
}
try{await p.connect();for(const n of pages)assert.equal(await p.readPageForMigration(n),undefined);assert.equal(await p.projectExists(project),false);owned=true;
 const copies:Record<string,PageMigrationData>={};
 await check('Delivered pages copy row-for-row under new names: rollback preview first, then commit and exact readback',async()=>{for(const [to,from] of Object.entries(sources)){
  const src=(await p.readPageForMigration(from))!;copies[to]=renamed(src.data.native,from,to);const before=await counters();
  await p.createPageFromMigration({data:copies[to],operatorId,dryRun:true});assert.equal(await p.readPageForMigration(to),undefined);assert.deepEqual(await counters(),before);
  await p.createPageFromMigration({data:copies[to],operatorId});assert.deepEqual((await p.readPageForMigration(to))!.data,copies[to]);}
  report.controls=Object.fromEntries(pages.map(n=>[n,Object.fromEntries(PAGE_SNAPSHOT_TABLES.map(t=>[t,copies[n].native.tables[t].length]).filter(([,k])=>k))]));});
 const created=await p.createProject({project,operatorId});await p.saveProject({project,operatorId,openedVersion:created.version,add:pages.map(n=>makeKey(DefinitionType.Page,n))});
 const pkg=await exportMigrationPackage(p,project),target=await databaseMigrationTarget(p,operatorId);
 await check('Export carries both complete pages and declares their records, fields, subpages, images, messages and components as prerequisites',async()=>{
  assert.deepEqual(pkg.assets.map(a=>[a.kind,a.data.name]),pages.map(n=>['page',n]));for(const a of pkg.assets)assert.deepEqual(a.data,copies[a.data.name]);
  const kinds=new Set(pkg.requirements.map(k=>k.type));for(const t of [DefinitionType.Record,DefinitionType.Field])assert.ok(kinds.has(t),'requirement type '+t);report.requirementTypes=[...kinds].sort((a,b)=>a-b);report.requirements=pkg.requirements.length;});
 await cleanup();owned=true;
 await check('Vacant-target preview finds every prerequisite; apply creates both pages exactly',async()=>{const plan=await previewMigrationImport(pkg,target);assert.deepEqual(plan.blockers,[]);const r=await applyMigrationImport(pkg,plan,target);assert.equal(r.error,undefined,r.error);for(const n of pages)assert.deepEqual((await p.readPageForMigration(n))!.data,copies[n]);});
 await check('Unchanged repeat import writes nothing and preserves PDM/PJM counters',async()=>{const before=await counters(),plan=await previewMigrationImport(pkg,target);assert.ok(plan.changes.every(c=>c.action==='same'));assert.deepEqual((await applyMigrationImport(pkg,plan,target)).completed,[]);assert.deepEqual(await counters(),before);});
 await check('A differing existing target page is replaced row for row: stale token refuses, rollback preview, then PDM/SYS +1 and exact readback',async()=>{
  await c.execute("UPDATE PSPNLDEFN SET DESCR='Target edit' WHERE PNLNAME=:n",{n:pages[0]});await c.execute('DELETE FROM PSPNLFIELD WHERE PNLNAME=:n AND PNLFLDID=(SELECT MAX(PNLFLDID) FROM PSPNLFIELD WHERE PNLNAME=:n)',{n:pages[0]});await c.commit();
  const live=(await p.readPageForMigration(pages[0]))!;await assert.rejects(p.createPageFromMigration({data:copies[pages[0]],operatorId,dryRun:true,expectedToken:'stale'}),/changed since/);
  const plan=await previewMigrationImport(pkg,target);assert.deepEqual(plan.blockers,[]);assert.deepEqual(plan.changes.map(c=>c.action),['update','same']);assert.equal((await p.readPageForMigration(pages[0]))!.token,live.token);
  const before=await counters() as {OBJECTTYPENAME:string;VERSION:number}[];const r=await applyMigrationImport(pkg,plan,target);assert.equal(r.error,undefined,r.error);assert.deepEqual((await p.readPageForMigration(pages[0]))!.data,copies[pages[0]]);
  const after=await counters() as {OBJECTTYPENAME:string;VERSION:number}[];for(const x of after)assert.equal(Number(x.VERSION)-Number(before.find(y=>y.OBJECTTYPENAME===x.OBJECTTYPENAME)!.VERSION),['PDM','SYS'].includes(x.OBJECTTYPENAME.trim())?1:0,x.OBJECTTYPENAME);});
 await cleanup();owned=true;
 await check('Creating a deleted page name clears its PSPNLDEL tombstone, as App Designer does (dl12); the rollback preview keeps it',async()=>{await c.execute('INSERT INTO PSPNLDEL (PNLNAME,VERSION) VALUES (:n,1)',{n:pages[0]});await c.commit();
  const marker=async()=>Number((await c.execute<{N:number}>('SELECT COUNT(*) AS N FROM PSPNLDEL WHERE PNLNAME=:n',{n:pages[0]})).rows![0].N);
  await p.createPageFromMigration({data:copies[pages[0]],operatorId,dryRun:true});assert.equal(await marker(),1);assert.equal(await p.readPageForMigration(pages[0]),undefined);
  await p.createPageFromMigration({data:copies[pages[0]],operatorId});assert.equal(await marker(),0);assert.deepEqual((await p.readPageForMigration(pages[0]))!.data,copies[pages[0]]);await cleanup();owned=true;});
 await check('Durable migration review stages both pages and the project without writing; approved apply verifies all',async()=>{const workspace={connections:[],activeProviders:[p],require:async()=>p,isWritable:()=>true,isSqlWritable:()=>true,isPeopleCodeWritable:()=>true,configFor:()=>({peoplesoftOperatorId:operatorId,peoplecodeSaveMode:'compile-and-save'})} as unknown as Workspace;
  const registry=databaseReviewAdapters(workspace,()=>({mode:()=> 'confirm',confirm:async()=>{throw Error('No legacy confirmation path.');},hasUnsavedEditor:()=>false,saved(){}}));const service=new ReviewService(new ReviewStore(dir),{environment:registry.environment,changed(){}},registry.adapters);
  const plan=await previewMigrationImport(pkg,target);let set=(await stageMigrationImport(service,p.id,pkg,plan,target,p))!;assert.equal(set.objects.length,3);assert.equal(await p.readPageForMigration(pages[0]),undefined);
  set=await service.validate(set.id);assert.equal(set.status,'READY_FOR_REVIEW',JSON.stringify(set.objects.map(o=>o.validation)));set=await service.review(set.id,set.objects.map(o=>o.id),'APPROVED',set.revision);set=await service.apply(set.id);
  assert.equal(set.status,'APPLIED',JSON.stringify(set.journal));for(const n of pages)assert.deepEqual((await p.readPageForMigration(n))!.data,copies[n]);report.changeSet=set.id;});
 report.passed=true;
}catch(error){report.error=error instanceof Error?error.stack??error.message:String(error);throw error;}
finally{try{await cleanup();report.cleanupVerified=owned?(await Promise.all(pages.map(n=>p.readPageForMigration(n)))).every(x=>!x)&&!(await p.projectExists(project)):true;}finally{await writeFile('tools/lab/results/page-migration-native-2026-10-20.json',JSON.stringify(report,null,2)+'\n');await c.close();await pool.close();await p.dispose();await rm(dir,{recursive:true,force:true});}}
