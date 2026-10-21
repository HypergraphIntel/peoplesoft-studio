/** Disposable HRDMO Query migration and durable review. No grants or application data changed. */
import assert from 'node:assert/strict';
import Module from 'node:module';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {DatabaseProvider} from '../../src/providers/database.js';
import {openDatabase} from '../../src/db/open.js';
import {DefinitionType,makeKey} from '../../src/model/definitions.js';
import {applyQueryOp,newQueryDocument} from '../../src/model/queryDocument.js';
import {querySnapshot} from '../../src/changeReview/query.js';
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
const config={name:'HRDMO Query migration acceptance',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};assert.match(config.connectString,/hrdmo/i);assert.ok(config.user&&config.password);
const prefix='ZZ_BQ'+randomBytes(3).toString('hex').toUpperCase(),name=prefix+'Q',project=prefix+'P',operatorId=process.env.PSLAB_OPERATOR??'JARED',key=makeKey(DefinitionType.Query,name);
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection(),root=await mkdtemp(path.join(os.tmpdir(),'psft-query-migration-native-'));let owned=false;
setWriteNamePrefix(prefix);setWriteGuard(async w=>{assert.ok([name,project].includes(w.key.parts[0]));if(writeOrigin()==='agent')assert.ok(isReviewedWrite(p.id,w.key));});
const checks:string[]=[],report:Record<string,unknown>={checkedAt:new Date().toISOString(),scope:'Disposable HRDMO public one-record Query migration; existing JARED Query access retained; source/vacant-target same database; trusted service test approval, not installed UI',name,project,checks};
const check=async(n:string,fn:()=>Promise<void>)=>{await fn();checks.push(n);console.log('ok '+checks.length+' - '+n);};
async function cleanup(){if(!owned)return;await c.rollback();for(const t of ['PSQRYBIND','PSQRYEXPR','PSQRYCRITERIA','PSQRYFIELD','PSQRYRECORD','PSQRYSELECT','PSQRYDEFN'])await c.execute(`DELETE FROM ${t} WHERE QRYNAME=:n AND OPRID=' '`,{n:name});for(const t of ['PSPROJECTITEM','PSPROJECTDEFN'])await c.execute(`DELETE FROM ${t} WHERE PROJECTNAME=:n`,{n:project});await c.commit();}
try{await p.connect();assert.equal(await p.readQueryForMigration(key),undefined);assert.equal(await p.projectExists(project),false);const orphan=(await c.execute<{N:number}>('SELECT COUNT(*) AS N FROM PSPROJECTITEM WHERE PROJECTNAME=:n',{n:project})).rows!;assert.equal(Number(orphan[0].N),0);owned=true;
 const layout=await p.readRecordLayout(makeKey(0,'AAP_TBL'));const field=layout!.fields.find(f=>f.name==='DESCR')!;assert.ok(field&&field.type===0);
 const info={type:field.type,length:field.length,decimalPositions:field.decimalPositions??0,format:6,shortName:field.shortName,longName:field.longName,editTable:field.editTable,useEdit:field.useEdit};
 let view=applyQueryOp(newQueryDocument(name,'','AAP_TBL'),{kind:'select',field:'DESCR',selected:true},{DESCR:info});
 view=applyQueryOp(view,{kind:'properties',description:'Migration Query',comments:'Native full Query payload'},{DESCR:info});
 await p.saveQueryDocument({view,openedToken:'absent',operatorId});const created=await p.createProject({project,operatorId});await p.saveProject({project,operatorId,openedVersion:created.version,add:[key]});
 const pkg=await exportMigrationPackage(p,project),target=await databaseMigrationTarget(p,operatorId);
 await check('Query export reads all supported native tables, preserves public ownership/comments and declares AAP_TBL prerequisite',async()=>{assert.equal(pkg.assets[0].kind,'query');assert.deepEqual(pkg.assets[0].data,{name,owner:'',view:querySnapshot((await p.readQueryDocument(name,''))!.view)});assert.deepEqual(pkg.requirements,[makeKey(0,'AAP_TBL')]);});
 await cleanup();
 await check('Vacant target native rollback preview then migration apply preserve the exact full semantic Query',async()=>{const plan=await previewMigrationImport(pkg,target);assert.deepEqual(plan.blockers,[]);assert.equal((await applyMigrationImport(pkg,plan,target)).error,undefined);assert.deepEqual((await p.readQueryForMigration(key))!.data,pkg.assets[0].data);report.sql=(await p.prepareQuery((await p.readQueryDocument(name,''))!.view,operatorId)).sql;});
 await check('Unchanged repeat import preserves Query and project native counters',async()=>{const counters=async()=>(await c.execute("SELECT OBJECTTYPENAME, VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('QDM','PJM','SYS') ORDER BY OBJECTTYPENAME")).rows;const before=await counters(),plan=await previewMigrationImport(pkg,target);assert.ok(plan.changes.every(c=>c.action==='same'));assert.deepEqual((await applyMigrationImport(pkg,plan,target)).completed,[]);assert.deepEqual(await counters(),before);});
 await cleanup();
 await check('Durable migration review stages a new Query and project without writing, then exact approved native apply verifies both',async()=>{const workspace={connections:[],activeProviders:[p],require:async()=>p,isWritable:()=>true,isSqlWritable:()=>true,isPeopleCodeWritable:()=>true,configFor:()=>({peoplesoftOperatorId:operatorId,peoplecodeSaveMode:'compile-and-save'})} as unknown as Workspace;
 const registry=databaseReviewAdapters(workspace,()=>({mode:()=> 'confirm',confirm:async()=>{throw Error('No legacy confirmation path.');},hasUnsavedEditor:()=>false,saved(){}}));const service=new ReviewService(new ReviewStore(root),{environment:registry.environment,changed(){}},registry.adapters);
 const plan=await previewMigrationImport(pkg,target);let set=(await stageMigrationImport(service,p.id,pkg,plan,target,p))!;assert.equal(set.objects.length,2);assert.equal(await p.readQueryForMigration(key),undefined);set=await service.validate(set.id);assert.equal(set.status,'READY_FOR_REVIEW',JSON.stringify(set.journal.at(-1))+' '+JSON.stringify(set.objects.map(c=>c.validation)));set=await service.review(set.id,set.objects.map(c=>c.id),'APPROVED',set.revision);set=await service.apply(set.id);assert.equal(set.status,'APPLIED',JSON.stringify(set.journal));assert.ok(set.objects.every(c=>c.application==='VERIFIED'));assert.deepEqual((await p.readQueryForMigration(key))!.data,pkg.assets[0].data);report.changeSet=set.id;});
 report.passed=true;
}catch(error){report.error=error instanceof Error?error.message:String(error);throw error;}
finally{try{await cleanup();report.cleanupVerified=owned?!(await p.readQueryForMigration(key))&&!(await p.projectExists(project)):true;}finally{await writeFile('tools/lab/results/query-migration-native-2026-10-20.json',JSON.stringify(report,null,2)+'\n');await c.close();await pool.close();await p.dispose();await rm(root,{recursive:true,force:true});}}
