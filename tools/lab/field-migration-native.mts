/** Disposable HRDMO field migration: translate values and every stored property, plus durable review. No application data changed. */
import assert from 'node:assert/strict';
import Module from 'node:module';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {DatabaseProvider} from '../../src/providers/database.js';
import {openDatabase} from '../../src/db/open.js';
import {DefinitionType,makeKey} from '../../src/model/definitions.js';
import {setWriteNamePrefix} from '../../src/providers/writeScope.js';
import {setWriteGuard,writeOrigin} from '../../src/providers/writeGuard.js';
import {isReviewedWrite} from '../../src/changeReview/authorization.js';
import {databaseMigrationTarget} from '../../src/providers/migrationTarget.js';
import {exportMigrationPackage,previewMigrationImport,applyMigrationImport,parseMigrationPackage,migrationHash,type StudioMigrationPackage} from '../../src/migrationPackage.js';
import {stageMigrationImport} from '../../src/changeReview/migration.js';
import {ReviewService} from '../../src/changeReview/service.js';import {ReviewStore} from '../../src/changeReview/store.js';
import type {Workspace} from '../../src/workspace.js';
const {createStub}=await import('../../scripts/vscode-stub.mjs');const {vscode}=createStub(),load=(Module as any)._load;
(Module as any)._load=function(n:string,p:unknown,m:boolean){return n==='vscode'?vscode:load.call(this,n,p,m);};const {databaseReviewAdapters}=await import('../../src/changeReview/adapters.js');
const config={name:'HRDMO translate migration acceptance',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};assert.match(config.connectString,/hrdmo/i);assert.ok(config.user&&config.password);
const prefix='ZZ_BX'+randomBytes(3).toString('hex').toUpperCase(),field=prefix+'F',project=prefix+'P',others={number:prefix+'N',date:prefix+'D',phone:prefix+'C',time:prefix+'T'},fields=[field,...Object.values(others)],operatorId=process.env.PSLAB_OPERATOR??'JARED',key=makeKey(DefinitionType.Field,field);
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection(),root=await mkdtemp(path.join(os.tmpdir(),'psft-field-migration-native-'));let owned=false;
setWriteNamePrefix(prefix);setWriteGuard(async w=>{assert.ok([...fields,project].includes(w.key.parts[0]));if(writeOrigin()==='agent')assert.ok(isReviewedWrite(p.id,w.key));});
const checks:string[]=[],report:Record<string,unknown>={checkedAt:new Date().toISOString(),scope:'Disposable HRDMO fields: base translate values plus owner ID, IME mode, number/time formats, default century, custom format family and formatted length; export, vacant-target creation, update/add, refusals and durable review; same database; trusted service test approval, not installed UI',fields,project,checks};
const check=async(n:string,fn:()=>Promise<void>)=>{await fn();checks.push(n);console.log('ok '+checks.length+' - '+n);};
const counters=async()=>(await c.execute("SELECT OBJECTTYPENAME, VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('PDM','XTM','PJM','SYS') ORDER BY OBJECTTYPENAME")).rows;
async function cleanup(){if(!owned)return;await c.rollback();for(const n of fields)for(const t of ['PSXLATITEM','PSXLATDEFN','PSXLATDEFNDEL','PSDBFLDLABL','PSDBFIELD'])await c.execute(`DELETE FROM ${t} WHERE FIELDNAME=:n`,{n});for(const t of ['PSPROJECTITEM','PSPROJECTDEFN'])await c.execute(`DELETE FROM ${t} WHERE PROJECTNAME=:n`,{n:project});await c.commit();}
const repackage=(pkg:StudioMigrationPackage,translates:unknown)=>{const {checksum:_,...body}=pkg,next={...body,assets:body.assets.map(a=>a.data.name===field?{...a,data:{...a.data,translates}}:a)};return parseMigrationPackage(JSON.stringify({...next,checksum:migrationHash(next)}));};
const props={[field]:{format:0,formatFamily:'',displayName:'',formatLength:0,defaultCenturyYear:50,imeMode:1,ownerId:'PPT'},
 [others.number]:{format:7,formatFamily:'',displayName:'',formatLength:0,defaultCenturyYear:50,imeMode:0,ownerId:'HHR'},
 [others.date]:{format:0,formatFamily:'',displayName:'',formatLength:0,defaultCenturyYear:80,imeMode:-1,ownerId:''},
 [others.phone]:{format:14,formatFamily:'PHONE',displayName:'NORMAL',formatLength:10,defaultCenturyYear:0,imeMode:0,ownerId:''},
 [others.time]:{format:13,formatFamily:'',displayName:'',formatLength:0,defaultCenturyYear:50,imeMode:0,ownerId:''}};
const shapes={[field]:{type:0,length:2,decimalPositions:0},[others.number]:{type:2,length:10,decimalPositions:2},[others.date]:{type:4,length:10,decimalPositions:0},[others.phone]:{type:0,length:12,decimalPositions:0},[others.time]:{type:5,length:15,decimalPositions:0}};
const stored=async(n:string)=>{const f=(await p.readField(makeKey(DefinitionType.Field,n)))!;return {format:f.format,formatFamily:f.formatFamily,displayName:f.displayName,formatLength:f.formatLength,defaultCenturyYear:f.defaultCenturyYear,imeMode:f.imeMode,ownerId:f.ownerId};};
try{await p.connect();for(const n of fields)assert.equal(await p.readField(makeKey(DefinitionType.Field,n)),undefined);assert.equal(await p.projectExists(project),false);owned=true;
 for(const n of fields){const created=await p.createField({name:n,...shapes[n],label:{id:n,longName:'Field '+n.slice(-1),shortName:n.slice(-1)},operatorId}) as {version:number};
  await p.saveField({name:n,openedVersion:created.version,operatorId,properties:props[n]});assert.deepEqual(await stored(n),props[n]);}
 const items=[{value:'A',effectiveDate:'1900-01-01',status:'A',longName:'Active é',shortName:'Act'},{value:'I',effectiveDate:'1900-01-01',status:'A',longName:'Inactive',shortName:'Inact'},{value:'I',effectiveDate:'2020-01-01',status:'I',longName:'Inactive (retired)',shortName:'Ret'}];
 for(const item of [items[2],items[0],items[1]])await p.saveTranslate(field,{kind:'add',item},operatorId);
 const created=await p.createProject({project,operatorId});await p.saveProject({project,operatorId,openedVersion:created.version,add:fields.map(n=>makeKey(DefinitionType.Field,n))});
 const pkg=await exportMigrationPackage(p,project),target=await databaseMigrationTarget(p,operatorId);
 await check('Export carries every base translate value with effective dating in canonical order',async()=>{const a=pkg.assets.find(a=>a.data.name===field)!;assert.equal(a.kind,'field');assert.deepEqual(a.kind==='field'&&a.data.translates,items);});
 await check('Export states owner ID, IME mode, number/time format, default century, format family and formatted length only where not New Field defaults',async()=>{
  const data=(n:string)=>pkg.assets.find(a=>a.data.name===n)!.data as Record<string,unknown>;
  assert.deepEqual([data(field).ownerId,data(field).imeMode,data(field).defaultCenturyYear],['PPT',1,undefined]);assert.deepEqual([data(others.number).format,data(others.number).ownerId],[7,'HHR']);
  assert.deepEqual([data(others.date).defaultCenturyYear,data(others.date).imeMode,data(others.date).format],[80,-1,undefined]);
  assert.deepEqual([data(others.phone).format,data(others.phone).formatFamily,data(others.phone).displayName,data(others.phone).formatLength,data(others.phone).defaultCenturyYear],[14,'PHONE','NORMAL',10,0]);assert.equal(data(others.time).format,13);});
 await cleanup();owned=true;
 await check('Vacant-target preview then apply creates the field and all translate values, with exact readback',async()=>{const plan=await previewMigrationImport(pkg,target);assert.deepEqual(plan.blockers,[]);assert.equal(plan.changes[0].action,'create');const r=await applyMigrationImport(pkg,plan,target);assert.equal(r.error,undefined);assert.deepEqual((await p.readTranslatesForMigration(field)).items,items);for(const n of fields)assert.deepEqual(await stored(n),props[n],n);});
 await check('A property-only update (owner ID) saves the field definition and verifies the full payload',async()=>{const {checksum:_,...body}=pkg,next={...body,assets:body.assets.map(a=>a.data.name===others.number?{...a,data:{...a.data,ownerId:'PPT'}}:a)},changedOwner=parseMigrationPackage(JSON.stringify({...next,checksum:migrationHash(next)}));
  const plan=await previewMigrationImport(changedOwner,target);assert.deepEqual(plan.changes.filter(c=>c.action!=='same').map(c=>c.asset.data.name),[others.number]);assert.equal((await applyMigrationImport(changedOwner,plan,target)).error,undefined);assert.equal((await stored(others.number)).ownerId,'PPT');
  const back=await previewMigrationImport(pkg,target);assert.equal((await applyMigrationImport(pkg,back,target)).error,undefined);assert.equal((await stored(others.number)).ownerId,'HHR');});
 await check('A format family absent from the target blocks preview',async()=>{const {checksum:_,...body}=pkg,next={...body,assets:body.assets.map(a=>a.data.name===others.phone?{...a,data:{...a.data,formatFamily:'ZZ_NOFAMILY'}}:a)},bad=parseMigrationPackage(JSON.stringify({...next,checksum:migrationHash(next)}));
  const plan=await previewMigrationImport(bad,target);assert.ok(plan.blockers.some(b=>/ZZ_NOFAMILY \/ NORMAL does not exist/.test(b)),JSON.stringify(plan.blockers));});
 await check('Unchanged repeat import writes nothing and preserves PDM/XTM/PJM counters',async()=>{const before=await counters(),plan=await previewMigrationImport(pkg,target);assert.ok(plan.changes.every(c=>c.action==='same'));assert.deepEqual((await applyMigrationImport(pkg,plan,target)).completed,[]);assert.deepEqual(await counters(),before);});
 const changed=[{...items[0],longName:'Active (renamed)'},items[1],items[2],{value:'P',effectiveDate:'1900-01-01',status:'A',longName:'Pending',shortName:'Pend'}];
 const update=repackage(pkg,changed);
 await check('Translate-only update changes and adds values without re-saving the unchanged field definition',async()=>{const fieldVersion=(await p.readField(key))!.version,plan=await previewMigrationImport(update,target);assert.deepEqual(plan.blockers,[]);assert.deepEqual(plan.changes.filter(c=>c.action!=='same').map(c=>[c.asset.data.name,c.action]),[[field,'update']]);assert.equal((await applyMigrationImport(update,plan,target)).error,undefined);assert.deepEqual((await p.readTranslatesForMigration(field)).items,changed);assert.equal((await p.readField(key))!.version,fieldVersion);});
 await check('A target-only translate value blocks preview; migration never deletes translate values',async()=>{const plan=await previewMigrationImport(pkg,target);assert.ok(plan.blockers.some(b=>/P effective 1900-01-01 is absent from the package/.test(b)),JSON.stringify(plan.blockers));});
 await check('Translated (language) rows refuse the complete migration scope',async()=>{await c.execute("INSERT INTO PSXLATITEMLANG (FIELDNAME,FIELDVALUE,EFFDT,LANGUAGE_CD,XLATLONGNAME,XLATSHORTNAME) VALUES (:f,'A',DATE '1900-01-01','FRA','Actif','Act')",{f:field});await c.commit();
  try{await assert.rejects(p.readTranslatesForMigration(field),/language migration scope/);}finally{await c.execute('DELETE FROM PSXLATITEMLANG WHERE FIELDNAME=:f',{f:field});await c.commit();}});
 await cleanup();owned=true;
 await check('Durable migration review stages the translated field and project without writing; approved apply verifies both',async()=>{const workspace={connections:[],activeProviders:[p],require:async()=>p,isWritable:()=>true,isSqlWritable:()=>true,isPeopleCodeWritable:()=>true,configFor:()=>({peoplesoftOperatorId:operatorId,peoplecodeSaveMode:'compile-and-save'})} as unknown as Workspace;
  const registry=databaseReviewAdapters(workspace,()=>({mode:()=> 'confirm',confirm:async()=>{throw Error('No legacy confirmation path.');},hasUnsavedEditor:()=>false,saved(){}}));const service=new ReviewService(new ReviewStore(root),{environment:registry.environment,changed(){}},registry.adapters);
  const plan=await previewMigrationImport(pkg,target);let set=(await stageMigrationImport(service,p.id,pkg,plan,target,p))!;assert.equal(set.objects.length,fields.length+1);assert.equal(await p.readField(key),undefined);
  set=await service.validate(set.id);assert.equal(set.status,'READY_FOR_REVIEW',JSON.stringify(set.objects.map(o=>o.validation)));set=await service.review(set.id,set.objects.map(o=>o.id),'APPROVED',set.revision);set=await service.apply(set.id);
  assert.equal(set.status,'APPLIED',JSON.stringify(set.journal));assert.ok(set.objects.every(o=>o.application==='VERIFIED'));assert.deepEqual((await p.readTranslatesForMigration(field)).items,items);for(const n of fields)assert.deepEqual(await stored(n),props[n],n);report.changeSet=set.id;});
 report.passed=true;
}catch(error){report.error=error instanceof Error?error.stack??error.message:String(error);throw error;}
finally{try{await cleanup();report.cleanupVerified=owned?(await Promise.all(fields.map(n=>p.readField(makeKey(DefinitionType.Field,n))))).every(f=>!f)&&!(await p.projectExists(project))&&Number((await c.execute<{N:number}>('SELECT COUNT(*) AS N FROM PSXLATITEM WHERE FIELDNAME=:n',{n:field})).rows![0].N)===0:true;}finally{await writeFile('tools/lab/results/field-migration-native-2026-10-20.json',JSON.stringify(report,null,2)+'\n');await c.close();await pool.close();await p.dispose();await rm(root,{recursive:true,force:true});}}
