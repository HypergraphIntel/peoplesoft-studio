/**
 * HRDMO package-properties migration. Source: ZZ_PCODE_LAB_PK as App Designer saved it with description, comments and
 * owner (capture pk01) and a second subpackage (pk02). Export, removal, import and review are compared row for row.
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
const config={name:'HRDMO package properties acceptance',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};assert.match(config.connectString,/hrdmo/i);assert.ok(config.user&&config.password);
const root='ZZ_PCODE_LAB_PK',project='ZZ_PCODE_LAB_PKP',operatorId=process.env.PSLAB_OPERATOR??'JARED';
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection(),dir=await mkdtemp(path.join(os.tmpdir(),'psft-package-properties-native-'));
setWriteNamePrefix('ZZ_PCODE_LAB');setWriteGuard(async w=>{assert.ok([root,project].includes(w.key.parts[0])||w.key.parts[1]===root,JSON.stringify(w.key));if(writeOrigin()==='agent')assert.ok(isReviewedWrite(p.id,w.key));});
const checks:string[]=[],report:Record<string,unknown>={checkedAt:new Date().toISOString(),scope:'HRDMO Application Package '+root+' saved by Windows App Designer with Package Properties (pk01) and a second subpackage (pk02): export, removal, vacant-target creation compared row for row with App Designer, unchanged repeat, property-only update and durable review; same database; trusted service test approval, not installed UI',root,project,checks};
const check=async(n:string,fn:()=>Promise<void>)=>{await fn();checks.push(n);console.log('ok '+checks.length+' - '+n);};
const rows=async()=>((await c.execute<Record<string,unknown>>('SELECT * FROM PSPACKAGEDEFN WHERE PACKAGEROOT=:r',{r:root},{outFormat:pool.types.OUT_FORMAT_OBJECT,fetchInfo:{DESCRLONG:{type:pool.types.STRING}}})).rows??[])
 .map(r=>JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>!['VERSION','LASTUPDDTTM','LASTUPDOPRID'].includes(k)).sort()))).sort();
const counters=async()=>(await c.execute("SELECT OBJECTTYPENAME, VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('APM','PJM','SYS') ORDER BY OBJECTTYPENAME")).rows;
async function removePackage(){await c.rollback();await c.execute('DELETE FROM PSAPPCLASSDEFN WHERE PACKAGEROOT=:r',{r:root});await c.execute('DELETE FROM PSPACKAGEDEFN WHERE PACKAGEROOT=:r',{r:root});await c.commit();}
async function removeProject(){for(const t of ['PSPROJECTITEM','PSPROJECTDEFN'])await c.execute(`DELETE FROM ${t} WHERE PROJECTNAME=:n`,{n:project});await c.commit();}
/** Earlier runs remove the App Designer-saved source; restore App Designer's own rows from capture pk02 (VERSION and stamps are not compared). */
async function restore(){const {readFile}=await import('node:fs/promises');const after=JSON.parse(await readFile('tools/corpus/save-protocol/results/pk02-native-subpackage-under-owned-root/after.json','utf8'));
 const t=after.watch.PSPACKAGEDEFN,cols:string[]=t.columns.map((x:{name:string}|string)=>typeof x==='string'?x:x.name),[{V}]=(await c.execute<{V:number}>("SELECT VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME='APM'")).rows!;
 for(const values of t.rows.filter((r:unknown[])=>r[cols.indexOf('PACKAGEROOT')]===root)){const row=Object.fromEntries(cols.map((col,i)=>[col,values[i]]));
  await c.execute(`INSERT INTO PSPACKAGEDEFN (${cols.join(',')}) VALUES (${cols.map(col=>col==='LASTUPDDTTM'?"TO_TIMESTAMP(:LASTUPDDTTM,'YYYY-MM-DD\"T\"HH24:MI:SS.FF9')":':'+col).join(',')})`,
   {...row,PACKAGELEVEL:Number(row.PACKAGELEVEL),VERSION:Number(V)});}
 await c.execute('DELETE FROM PSPACKAGEDEL WHERE PACKAGEROOT=:r',{r:root});await c.commit();report.sourceRestoredFromCapture='pk02-native-subpackage-under-owned-root/after.json';}
try{await p.connect();if(!await p.readPackageForMigration(root))await restore();const native=await rows();report.appDesignerRows=native;assert.equal(native.length,3);assert.equal(await p.projectExists(project),false);
 await writeFile('tools/lab/results/package-properties-native-2026-10-20.json',JSON.stringify(report,null,2)+'\n');
 const created=await p.createProject({project,operatorId});await p.saveProject({project,operatorId,openedVersion:created.version,add:[makeKey(DefinitionType.ApplicationPackage,root,root,'.')]});
 const pkg=await exportMigrationPackage(p,project),target=await databaseMigrationTarget(p,operatorId);
 await check('Export carries the root description, comments and owner ID App Designer saved, and both subpackages',async()=>{assert.deepEqual(pkg.assets[0].data,{name:root,packages:['SUB','SUB2'],description:'Capture package',comments:'Capture comments',ownerId:'PPTD'});});
 await removePackage();await removeProject();
 await check('Vacant-target apply recreates every PSPACKAGEDEFN row equal to App Designer, apart from version stamps',async()=>{const plan=await previewMigrationImport(pkg,target);assert.deepEqual(plan.blockers,[]);const r=await applyMigrationImport(pkg,plan,target);assert.equal(r.error,undefined,r.error);assert.deepEqual(await rows(),native);});
 await check('Unchanged repeat import writes nothing and preserves APM/PJM counters',async()=>{const before=await counters(),plan=await previewMigrationImport(pkg,target);assert.ok(plan.changes.every(x=>x.action==='same'),JSON.stringify(plan.changes.map(x=>x.action)));assert.deepEqual((await applyMigrationImport(pkg,plan,target)).completed,[]);assert.deepEqual(await counters(),before);});
 await check('A property-only difference is saved by the Package Properties writer: APM/SYS +1, every row at the new version',async()=>{const live=(await p.readPackageForMigration(root))!;await p.savePackageProperties({root,openedVersion:live.version,description:'Target edit',comments:'',ownerId:'',operatorId});
  const plan=await previewMigrationImport(pkg,target);assert.deepEqual(plan.changes.map(x=>x.action),['update']);const before=await counters() as {OBJECTTYPENAME:string;VERSION:number}[];assert.equal((await applyMigrationImport(pkg,plan,target)).error,undefined);assert.deepEqual(await rows(),native);
  const after=await counters() as {OBJECTTYPENAME:string;VERSION:number}[];for(const x of after)assert.equal(Number(x.VERSION)-Number(before.find(y=>y.OBJECTTYPENAME===x.OBJECTTYPENAME)!.VERSION),['APM','SYS'].includes(x.OBJECTTYPENAME.trim())?1:0,x.OBJECTTYPENAME);
  const versions=(await c.execute<{V:number}>('SELECT DISTINCT VERSION AS V FROM PSPACKAGEDEFN WHERE PACKAGEROOT=:r',{r:root})).rows!;assert.equal(versions.length,1);});
 await check('Subpackage owner IDs refuse export (no App Designer path sets them)',async()=>{await c.execute("UPDATE PSPACKAGEDEFN SET OBJECTOWNERID='PPT' WHERE PACKAGEROOT=:r AND PACKAGEID='SUB'",{r:root});await c.commit();
  try{await assert.rejects(p.readPackageForMigration(root),/subpackage or class/);}finally{await c.execute("UPDATE PSPACKAGEDEFN SET OBJECTOWNERID=' ' WHERE PACKAGEROOT=:r AND PACKAGEID='SUB'",{r:root});await c.commit();}});
 await removePackage();
 await check('Durable migration review stages the package with its properties and the project; approved apply reproduces App Designer rows',async()=>{const workspace={connections:[],activeProviders:[p],require:async()=>p,isWritable:()=>true,isSqlWritable:()=>true,isPeopleCodeWritable:()=>true,configFor:()=>({peoplesoftOperatorId:operatorId,peoplecodeSaveMode:'compile-and-save'})} as unknown as Workspace;
  const registry=databaseReviewAdapters(workspace,()=>({mode:()=> 'confirm',confirm:async()=>{throw Error('No legacy confirmation path.');},hasUnsavedEditor:()=>false,saved(){}}));const service=new ReviewService(new ReviewStore(dir),{environment:registry.environment,changed(){}},registry.adapters);
  await removeProject();const plan=await previewMigrationImport(pkg,target);let set=(await stageMigrationImport(service,p.id,pkg,plan,target,p))!;assert.equal(set.objects.length,2);assert.equal(await p.readPackageForMigration(root),undefined);
  set=await service.validate(set.id);assert.equal(set.status,'READY_FOR_REVIEW',JSON.stringify(set.objects.map(o=>o.validation)));set=await service.review(set.id,set.objects.map(o=>o.id),'APPROVED',set.revision);set=await service.apply(set.id);
  assert.equal(set.status,'APPLIED',JSON.stringify(set.journal));assert.deepEqual(await rows(),native);report.changeSet=set.id;});
 report.passed=true;
}catch(error){report.error=error instanceof Error?error.stack??error.message:String(error);throw error;}
finally{try{await removePackage();await removeProject();report.cleanupVerified=!(await p.readPackageForMigration(root))&&!(await p.projectExists(project));}finally{await writeFile('tools/lab/results/package-properties-native-2026-10-20.json',JSON.stringify(report,null,2)+'\n');await c.close();await pool.close();await p.dispose();await rm(dir,{recursive:true,force:true});}}
