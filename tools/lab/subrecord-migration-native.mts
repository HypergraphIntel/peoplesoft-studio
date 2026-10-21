/** Disposable HRDMO Derived/Work record with a subrecord: migration and durable review. The delivered subrecord is only read. */
import assert from 'node:assert/strict';
import Module from 'node:module';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {DatabaseProvider} from '../../src/providers/database.js';
import {openDatabase} from '../../src/db/open.js';
import {DefinitionType,makeKey} from '../../src/model/definitions.js';
import {RecordType} from '../../src/model/record.js';
import {applyRecordOperations} from '../../src/model/recordOperations.js';
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
const config={name:'HRDMO subrecord migration acceptance',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};assert.match(config.connectString,/hrdmo/i);assert.ok(config.user&&config.password);
const prefix='ZZ_BS'+randomBytes(3).toString('hex').toUpperCase(),record=prefix+'W',own=prefix+'S',project=prefix+'P',sub='ABS_HIST_GERSBR',operatorId=process.env.PSLAB_OPERATOR??'JARED',key=makeKey(DefinitionType.Record,record);
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection(),dir=await mkdtemp(path.join(os.tmpdir(),'psft-subrecord-migration-native-'));let owned=false;
setWriteNamePrefix(prefix);setWriteGuard(async w=>{assert.ok([record,own,project].includes(w.key.parts[0]),JSON.stringify(w.key));if(writeOrigin()==='agent')assert.ok(isReviewedWrite(p.id,w.key));});
const checks:string[]=[],report:Record<string,unknown>={checkedAt:new Date().toISOString(),scope:'Disposable HRDMO Derived/Work record holding a field, the delivered subrecord '+sub+' (read only) and a new SubRecord definition in the same project: export, vacant-target creation (SubRecord first) with PSRECFIELDDB expansion, unchanged repeat and durable review; same database; trusted service test approval, not installed UI',record,ownSubrecord:own,project,sub,checks};
const check=async(n:string,fn:()=>Promise<void>)=>{await fn();checks.push(n);console.log('ok '+checks.length+' - '+n);};
const db=async()=>(await c.execute<{F:string;P:string}>('SELECT FIELDNAME AS F, RECNAME_PARENT AS P FROM PSRECFIELDDB WHERE RECNAME=:r ORDER BY FIELDNUM',{r:record})).rows!.map(r=>r.F.trim()+'<'+r.P.trim());
async function cleanup(){if(!owned)return;await c.rollback();for(const n of [record,own])for(const t of ['PSRECFIELDDB','PSRECFIELD','PSINDEXDEFN','PSKEYDEFN','PSRECTBLSPC','PSRECDEFN','PSRECDEL'])await c.execute(`DELETE FROM ${t} WHERE RECNAME=:n`,{n});for(const t of ['PSPROJECTITEM','PSPROJECTDEFN'])await c.execute(`DELETE FROM ${t} WHERE PROJECTNAME=:n`,{n:project});await c.commit();}
try{await p.connect();assert.equal(await p.readRecordLayout(key),undefined);assert.equal(await p.readRecordLayout(makeKey(DefinitionType.Record,own)),undefined);assert.equal(await p.projectExists(project),false);const subVersion=(await p.readRecordLayout(makeKey(DefinitionType.Record,sub)))!.version;owned=true;
 await p.saveRecord({operatorId,edit:applyRecordOperations({recname:own,recordType:RecordType.Subrecord,openedVersion:0,fields:[],isNew:true},RecordType.Subrecord,[{op:'insert_field',field:'EFFDT'},{op:'insert_field',field:'EFF_STATUS'},{op:'set_properties',description:'Own subrecord'}])});
 await p.saveRecord({operatorId,edit:{recname:record,recordType:RecordType.DerivedWork,openedVersion:0,isNew:true,properties:{description:'Subrecord migration'},
  fields:[{name:'DESCR',useEdit:0,useEdit2:0,isNew:true},{name:sub,useEdit:0,useEdit2:0,isNew:true,isSubrecord:true},{name:own,useEdit:0,useEdit2:0,isNew:true,isSubrecord:true}]}});
 const expandedSource=await db();assert.ok(expandedSource.some(f=>f.endsWith('<'+sub))&&expandedSource.includes('EFF_STATUS<'+own),JSON.stringify(expandedSource));
 const created=await p.createProject({project,operatorId});await p.saveProject({project,operatorId,openedVersion:created.version,add:[key,makeKey(DefinitionType.Record,own)]});
 const pkg=await exportMigrationPackage(p,project),target=await databaseMigrationTarget(p,operatorId);
 await check('Export carries the SubRecord definition and the record\'s plain subrecord rows; only the delivered subrecord is a prerequisite',async()=>{const a=pkg.assets.find(x=>x.data.name===record)!,s=pkg.assets.find(x=>x.data.name===own)!;assert.equal(a.kind,'record');assert.equal(s.kind==='record'&&s.data.recordType,RecordType.Subrecord);
  assert.deepEqual(a.kind==='record'&&a.data.fields.map(f=>[f.name,!!f.isSubrecord]),[['DESCR',false],[sub,true],[own,true]]);assert.ok(pkg.requirements.some(r=>r.type===DefinitionType.Record&&r.parts[0]===sub),JSON.stringify(pkg.requirements));assert.ok(!pkg.requirements.some(r=>r.parts[0]===own));});
 await cleanup();owned=true;
 await check('Vacant-target apply creates the SubRecord, then the record with both subrecord rows and the same expanded PSRECFIELDDB rows',async()=>{const plan=await previewMigrationImport(pkg,target);assert.deepEqual(plan.blockers,[]);const r=await applyMigrationImport(pkg,plan,target);assert.equal(r.error,undefined,r.error);
  assert.deepEqual(await db(),expandedSource);assert.equal((await p.readRecordLayout(makeKey(DefinitionType.Record,sub)))!.version,subVersion);});
 await check('Unchanged repeat import writes nothing',async()=>{const v=(await p.readRecordLayout(key))!.version,plan=await previewMigrationImport(pkg,target);assert.ok(plan.changes.every(c=>c.action==='same'));assert.deepEqual((await applyMigrationImport(pkg,plan,target)).completed,[]);assert.equal((await p.readRecordLayout(key))!.version,v);});
 await cleanup();owned=true;
 await check('Durable migration review stages the SubRecord, record and project without writing; approved dependency-ordered apply verifies all',async()=>{const workspace={connections:[],activeProviders:[p],require:async()=>p,isWritable:()=>true,isSqlWritable:()=>true,isPeopleCodeWritable:()=>true,configFor:()=>({peoplesoftOperatorId:operatorId,peoplecodeSaveMode:'compile-and-save'})} as unknown as Workspace;
  const registry=databaseReviewAdapters(workspace,()=>({mode:()=> 'confirm',confirm:async()=>{throw Error('No legacy confirmation path.');},hasUnsavedEditor:()=>false,saved(){}}));const service=new ReviewService(new ReviewStore(dir),{environment:registry.environment,changed(){}},registry.adapters);
  const plan=await previewMigrationImport(pkg,target);let set=(await stageMigrationImport(service,p.id,pkg,plan,target,p))!;assert.equal(set.objects.length,3);assert.equal(await p.readRecordLayout(key),undefined);
  set=await service.validate(set.id);assert.equal(set.status,'READY_FOR_REVIEW',JSON.stringify(set.objects.map(o=>o.validation)));set=await service.review(set.id,set.objects.map(o=>o.id),'APPROVED',set.revision);set=await service.apply(set.id);
  assert.equal(set.status,'APPLIED',JSON.stringify(set.journal));assert.deepEqual(await db(),expandedSource);report.changeSet=set.id;});
 report.passed=true;
}catch(error){report.error=error instanceof Error?error.stack??error.message:String(error);throw error;}
finally{try{await cleanup();report.cleanupVerified=owned?!(await p.readRecordLayout(key))&&!(await p.readRecordLayout(makeKey(DefinitionType.Record,own)))&&!(await p.projectExists(project)):true;}finally{await writeFile('tools/lab/results/subrecord-migration-native-2026-10-20.json',JSON.stringify(report,null,2)+'\n');await c.close();await pool.close();await p.dispose();await rm(dir,{recursive:true,force:true});}}
