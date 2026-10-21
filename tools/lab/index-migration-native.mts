/**
 * HRDMO user-index migration. Source: ZZ_PCODE_LAB_IX as App Designer saved it with index A (capture ix01). The trial
 * exports it, removes it, imports it again and compares every row with App Designer's, then reviews a second import.
 */
import assert from 'node:assert/strict';
import Module from 'node:module';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {DatabaseProvider} from '../../src/providers/database.js';
import {openDatabase} from '../../src/db/open.js';
import {DefinitionType,makeKey} from '../../src/model/definitions.js';
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
const config={name:'HRDMO index migration acceptance',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};assert.match(config.connectString,/hrdmo/i);assert.ok(config.user&&config.password);
const record='ZZ_PCODE_LAB_IX',project='ZZ_PCODE_LAB_IXP',operatorId=process.env.PSLAB_OPERATOR??'JARED',key=makeKey(DefinitionType.Record,record);
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection(),dir=await mkdtemp(path.join(os.tmpdir(),'psft-index-migration-native-'));
setWriteNamePrefix('ZZ_PCODE_LAB');setWriteGuard(async w=>{assert.ok([record,project].includes(w.key.parts[0]),JSON.stringify(w.key));if(writeOrigin()==='agent')assert.ok(isReviewedWrite(p.id,w.key));});
const checks:string[]=[],report:Record<string,unknown>={checkedAt:new Date().toISOString(),scope:'HRDMO SQL Table '+record+' with user index A (DESCR, EFF_STATUS; comment) saved by Windows App Designer (capture ix01): export, removal, vacant-target creation compared row for row with App Designer, unchanged repeat, existing-record refusal and durable review; same database; trusted service test approval, not installed UI',record,project,checks};
const check=async(n:string,fn:()=>Promise<void>)=>{await fn();checks.push(n);console.log('ok '+checks.length+' - '+n);};
const STAMPS=['VERSION','LASTUPDDTTM','LASTUPDOPRID'];
async function rows(){const out:Record<string,string[]>={};for(const t of ['PSRECDEFN','PSRECFIELD','PSRECFIELDDB','PSINDEXDEFN','PSKEYDEFN','PSRECTBLSPC','PSIDXDDLPARM','PSRECDDLPARM'])
 out[t]=((await c.execute<Record<string,unknown>>(`SELECT * FROM ${t} WHERE RECNAME=:r`,{r:record},{outFormat:pool.types.OUT_FORMAT_OBJECT,fetchInfo:{DESCRLONG:{type:pool.types.STRING}}})).rows??[])
  .map(r=>JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>!STAMPS.includes(k)).sort()),(_k,v)=>v instanceof Date?v.toISOString():v)).sort();return out;}
async function remove(){await c.rollback();for(const t of ['PSKEYDEFN','PSINDEXDEFN','PSIDXDDLPARM','PSRECFIELDDB','PSRECFIELD','PSRECTBLSPC','PSRECDDLPARM','PSRECDEFN','PSRECDEL'])await c.execute(`DELETE FROM ${t} WHERE RECNAME=:n`,{n:record});await c.commit();}
async function dropProject(){for(const t of ['PSPROJECTITEM','PSPROJECTDEFN'])await c.execute(`DELETE FROM ${t} WHERE PROJECTNAME=:n`,{n:project});await c.commit();}
/** Run 1's cleanup removed the App Designer-saved source; later runs restore those recorded rows (stamps are not compared). */
async function restore(){const {readFile}=await import('node:fs/promises');const saved=JSON.parse(await readFile('tools/lab/results/index-migration-native-run1-2026-10-20.json','utf8')).appDesignerRows as Record<string,string[]>;
 const [{V}]=(await c.execute<{V:number}>("SELECT VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME='RDM'")).rows!;
 for(const t of ['PSRECDEFN','PSRECFIELD','PSRECFIELDDB','PSINDEXDEFN','PSKEYDEFN','PSRECTBLSPC'])for(const text of saved[t]){const row:Record<string,unknown>={...JSON.parse(text)};
  const cols=(await c.execute<{C:string}>(`SELECT COLUMN_NAME AS C FROM USER_TAB_COLUMNS WHERE TABLE_NAME=:t`,{t})).rows!.map(r=>r.C);
  if(cols.includes('VERSION'))row.VERSION=V;if(cols.includes('LASTUPDOPRID'))row.LASTUPDOPRID=operatorId;const names=Object.keys(row),stamp=cols.includes('LASTUPDDTTM');
  await c.execute(`INSERT INTO ${t} (${names.join(',')}${stamp?',LASTUPDDTTM':''}) VALUES (${names.map((_,i)=>`:b${i}`).join(',')}${stamp?',SYSTIMESTAMP':''})`,Object.fromEntries(names.map((n,i)=>['b'+i,row[n]])));}
 await c.commit();report.sourceRestoredFromRun1=true;}
try{await p.connect();if(!await p.readRecordLayout(key))await restore();const native=await rows();assert.equal(native.PSINDEXDEFN.length,2,'App Designer key index and index A');assert.equal(await p.projectExists(project),false);report.appDesignerRows=native;
 const created=await p.createProject({project,operatorId});await p.saveProject({project,operatorId,openedVersion:created.version,add:[key]});
 const pkg=await exportMigrationPackage(p,project),target=await databaseMigrationTarget(p,operatorId);
 await check('Export carries index A with its two keys, platform flags and comment exactly as App Designer stored them',async()=>{const a=pkg.assets[0];assert.equal(a.kind,'record');
  const ix=a.kind==='record'?a.data.indexes:undefined;assert.equal(ix?.length,1);assert.equal(ix![0].index.INDEXID,'A');assert.equal(ix![0].index.IDXCOMMENTS,'Capture index');assert.deepEqual(ix![0].keys.map(k=>k.FIELDNAME),['DESCR','EFF_STATUS']);});
 await remove();await dropProject();
 await check('Vacant-target apply recreates the record and every key/index row equal to App Designer, apart from version stamps',async()=>{const plan=await previewMigrationImport(pkg,target);assert.deepEqual(plan.blockers,[]);const r=await applyMigrationImport(pkg,plan,target);assert.equal(r.error,undefined,r.error);
  const now=await rows();for(const t of Object.keys(native))assert.deepEqual(now[t],native[t],t);});
 await check('Unchanged repeat import writes nothing',async()=>{const v=(await p.readRecordLayout(key))!.version,plan=await previewMigrationImport(pkg,target);assert.ok(plan.changes.every(c=>c.action==='same'),JSON.stringify(plan.changes.map(c=>c.action)));assert.deepEqual((await applyMigrationImport(pkg,plan,target)).completed,[]);assert.equal((await p.readRecordLayout(key))!.version,v);});
 await check('An existing target record whose user indexes differ blocks preview; indexed records are not updated',async()=>{await c.execute("UPDATE PSINDEXDEFN SET IDXCOMMENTS='Target edit' WHERE RECNAME=:r AND INDEXID='A'",{r:record});await c.commit();
  const plan=await previewMigrationImport(pkg,target);assert.ok(plan.blockers.some(b=>/does not update them yet/.test(b)),JSON.stringify(plan.blockers));});
 await check('User indexes with custom DDL refuse export',async()=>{await c.execute("UPDATE PSINDEXDEFN SET DDLCOUNT=1 WHERE RECNAME=:r AND INDEXID='A'",{r:record});await c.commit();
  try{await assert.rejects(p.readRecordIndexesForMigration(record),/custom DDL/);}finally{await c.execute("UPDATE PSINDEXDEFN SET DDLCOUNT=0,IDXCOMMENTS='Capture index' WHERE RECNAME=:r AND INDEXID='A'",{r:record});await c.commit();}});
 await remove();await dropProject();
 await check('Durable migration review stages the indexed record and project without writing; approved apply reproduces App Designer rows',async()=>{const workspace={connections:[],activeProviders:[p],require:async()=>p,isWritable:()=>true,isSqlWritable:()=>true,isPeopleCodeWritable:()=>true,configFor:()=>({peoplesoftOperatorId:operatorId,peoplecodeSaveMode:'compile-and-save'})} as unknown as Workspace;
  const registry=databaseReviewAdapters(workspace,()=>({mode:()=> 'confirm',confirm:async()=>{throw Error('No legacy confirmation path.');},hasUnsavedEditor:()=>false,saved(){}}));const service=new ReviewService(new ReviewStore(dir),{environment:registry.environment,changed(){}},registry.adapters);
  const plan=await previewMigrationImport(pkg,target);let set=(await stageMigrationImport(service,p.id,pkg,plan,target,p))!;assert.equal(set.objects.length,2);assert.equal(await p.readRecordLayout(key),undefined);
  set=await service.validate(set.id);assert.equal(set.status,'READY_FOR_REVIEW',JSON.stringify(set.objects.map(o=>o.validation)));set=await service.review(set.id,set.objects.map(o=>o.id),'APPROVED',set.revision);set=await service.apply(set.id);
  assert.equal(set.status,'APPLIED',JSON.stringify(set.journal));const now=await rows();for(const t of Object.keys(native))assert.deepEqual(now[t],native[t],t);report.changeSet=set.id;});
 report.passed=true;
}catch(error){report.error=error instanceof Error?error.stack??error.message:String(error);throw error;}
finally{try{await remove();await dropProject();report.cleanupVerified=!(await p.readRecordLayout(key))&&!(await p.projectExists(project));}finally{await writeFile('tools/lab/results/index-migration-native-2026-10-20.json',JSON.stringify(report,null,2)+'\n');await c.close();await pool.close();await p.dispose();await rm(dir,{recursive:true,force:true});}}
