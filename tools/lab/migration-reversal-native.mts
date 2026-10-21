/**
 * Disposable HRDMO migration creation reversal: a reviewed import creates a field with translate values, a Derived/Work
 * record using it with Record PeopleCode, an App Engine program, a popup menu with ItemSelected PeopleCode, a page, a
 * component listing that page, an Application Package with a class, and their project; the inverse deletes them all
 * through the calibrated deletion writers (rollback previews first, project first) and a fresh redo recreates them.
 */
import assert from 'node:assert/strict';
import Module from 'node:module';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {DatabaseProvider} from '../../src/providers/database.js';
import {openDatabase} from '../../src/db/open.js';
import {DefinitionType,makeKey} from '../../src/model/definitions.js';
import {RecordType} from '../../src/model/record.js';
import {documentFromSpec} from '../../src/model/aeSpec.js';
import {newMenu,insertItem} from '../../src/model/menuDocument.js';
import {canonical} from '../../src/changeReview/model.js';
import {PAGE_SNAPSHOT_TABLES} from '../../src/providers/pageSnapshot.js';
import {COMPONENT_TABLES} from '../../src/providers/componentMigration.js';
import {setWriteNamePrefix} from '../../src/providers/writeScope.js';
import {setWriteGuard,writeOrigin} from '../../src/providers/writeGuard.js';
import {isReviewedWrite} from '../../src/changeReview/authorization.js';
import {databaseMigrationTarget,readMigrationAsset} from '../../src/providers/migrationTarget.js';
import {exportMigrationPackage,previewMigrationImport,migrationHash} from '../../src/migrationPackage.js';
import {stageMigrationImport} from '../../src/changeReview/migration.js';
import {ReviewService} from '../../src/changeReview/service.js';import {ReviewStore} from '../../src/changeReview/store.js';
import type {Workspace} from '../../src/workspace.js';
const {createStub}=await import('../../scripts/vscode-stub.mjs');const {vscode}=createStub(),load=(Module as any)._load;
(Module as any)._load=function(n:string,p:unknown,m:boolean){return n==='vscode'?vscode:load.call(this,n,p,m);};const {databaseReviewAdapters}=await import('../../src/changeReview/adapters.js');
const config={name:'HRDMO migration reversal acceptance',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};assert.match(config.connectString,/hrdmo/i);assert.ok(config.user&&config.password);
const prefix='ZZ_BM'+randomBytes(3).toString('hex').toUpperCase(),record=prefix+'W',program=prefix+'A',menu=prefix+'M',project=prefix+'P',field=prefix+'F',page=prefix+'G',component=prefix+'C',root=prefix+'PKG',operatorId=process.env.PSLAB_OPERATOR??'JARED';
const keys={field:makeKey(DefinitionType.Field,field),record:makeKey(DefinitionType.Record,record),code:makeKey(DefinitionType.RecordPeopleCode,record,field,'FieldChange'),program:makeKey(DefinitionType.AppEngineProgram,program),menu:makeKey(DefinitionType.Menu,menu),
 page:makeKey(DefinitionType.Page,page),component:makeKey(DefinitionType.Component,component,'GBL'),package:makeKey(DefinitionType.ApplicationPackage,root),class:makeKey(DefinitionType.ApplicationClassPeopleCode,root,'UI','Panel')};
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection(),dir=await mkdtemp(path.join(os.tmpdir(),'psft-migration-reversal-native-'));let owned=false;
setWriteNamePrefix(prefix);setWriteGuard(async w=>{assert.ok([record,program,menu,project,field,page,component,root].includes(w.key.parts[0]),JSON.stringify(w.key));if(writeOrigin()==='agent')assert.ok(isReviewedWrite(p.id,w.key));});
const checks:string[]=[],report:Record<string,unknown>={checkedAt:new Date().toISOString(),scope:'Disposable HRDMO reviewed migration of a field with translate values, a Derived/Work record using it with Record PeopleCode, an App Engine program, a popup menu with ItemSelected PeopleCode, a page copied from HRS_APP_PRINT_PAGE, a component listing that page, an Application Package with a class, and their project; destructive inverse through the calibrated deletion writers (dl01-dl13 and earlier captures), tombstones, fresh redo; no permission-list changes; trusted service test approval, not installed UI',prefix,checks};
const check=async(n:string,fn:()=>Promise<void>)=>{await fn();checks.push(n);console.log('ok '+checks.length+' - '+n);};
const one=async(sql:string,binds:Record<string,unknown>)=>Number((await c.execute<{N:number}>(sql,binds)).rows![0].N);
const tombstones=async()=>({record:await one('SELECT COUNT(*) AS N FROM PSRECDEL WHERE RECNAME=:n',{n:record}),program:await one('SELECT COUNT(*) AS N FROM PSAEAPPLDEL WHERE AE_APPLID=:n',{n:program}),
 menu:await one('SELECT COUNT(*) AS N FROM PSMENUDEL WHERE MENUNAME=:n',{n:menu}),code:await one('SELECT COUNT(*) AS N FROM PSPCMPROGDEL WHERE OBJECTID1=1 AND OBJECTVALUE1=:n',{n:record}),project:await one('SELECT COUNT(*) AS N FROM PSPROJECTDEL WHERE PROJECTNAME=:n',{n:project}),
 page:await one('SELECT COUNT(*) AS N FROM PSPNLDEL WHERE PNLNAME=:n',{n:page}),component:await one('SELECT COUNT(*) AS N FROM PSPNLGRPDEL WHERE PNLGRPNAME=:n',{n:component}),package:await one('SELECT COUNT(*) AS N FROM PSPACKAGEDEL WHERE PACKAGEROOT=:n',{n:root}),
 class:await one('SELECT COUNT(*) AS N FROM PSPCMPROGDEL WHERE OBJECTID1=104 AND OBJECTVALUE1=:n',{n:root})});
async function cleanup(){if(!owned)return;await c.rollback();
 for(const t of ['PSRECFIELDDB','PSRECFIELD','PSINDEXDEFN','PSKEYDEFN','PSRECTBLSPC','PSRECDEFN','PSRECDEL'])await c.execute(`DELETE FROM ${t} WHERE RECNAME=:n`,{n:record});
 for(const [id,v] of [[1,record],[66,program],[3,menu],[104,root]] as const)for(const t of ['PSPCMTXT','PSPCMNAME','PSPCMPROG','PSPCMPROGDEL'])await c.execute(`DELETE FROM ${t} WHERE OBJECTID1=:i AND OBJECTVALUE1=:n`,{i:id,n:v});
 for(const t of ['PSXLATITEM','PSXLATDEFN','PSXLATDEFNDEL','PSDBFLDLABL','PSDBFIELD'])await c.execute(`DELETE FROM ${t} WHERE FIELDNAME=:n`,{n:field});
 for(const t of [...PAGE_SNAPSHOT_TABLES].reverse())await c.execute(`DELETE FROM ${t} WHERE PNLNAME=:n`,{n:page});await c.execute('DELETE FROM PSPNLDEL WHERE PNLNAME=:n',{n:page});
 for(const t of [...COMPONENT_TABLES].reverse())await c.execute(`DELETE FROM ${t} WHERE PNLGRPNAME=:n`,{n:component});await c.execute('DELETE FROM PSPNLGRPDEL WHERE PNLGRPNAME=:n',{n:component});
 for(const t of ['PSAPPCLASSDEFN','PSPACKAGEDEFN','PSPACKAGEDEL'])await c.execute(`DELETE FROM ${t} WHERE PACKAGEROOT=:n`,{n:root});
 for(const t of ['PSAEAPPLDEL','PSAESECTDEL','PSAEAPPLDEFN','PSAEAPPLSTATE','PSAEAPPLTEMPTBL','PSAEAPPLLANG','PSAESECTDEFN','PSAESECTDTLDEFN','PSAESTEPDEFN','PSAESTMTDEFN','PSAESTEPMSGDEFN'])await c.execute(`DELETE FROM ${t} WHERE AE_APPLID=:n`,{n:program});
 for(const t of ['PSSQLTEXTDEFN','PSSQLHASH','PSSQLDESCR','PSSQLDEFN','PSSQLDEL'])await c.execute(`DELETE FROM ${t} WHERE SUBSTR(SQLID,1,12)=RPAD(:n,12) AND SQLTYPE IN ('1','6')`,{n:program});
 for(const t of ['PSMENUITEMLANG','PSMENUDEFNLANG','PSXFERITEM','PSMENUORIGIN','PSMENUITEM','PSMENUDEL','PSMENUDEFN'])await c.execute(`DELETE FROM ${t} WHERE MENUNAME=:n`,{n:menu});
 for(const t of ['PSPROJECTITEM','PSPROJECTDEFN','PSPROJECTDEL'])await c.execute(`DELETE FROM ${t} WHERE PROJECTNAME=:n`,{n:project});await c.commit();}
try{await p.connect();for(const k of Object.values(keys))assert.equal(await readMigrationAsset(p,k),undefined);assert.equal(await p.projectExists(project),false);assert.ok(Object.values(await tombstones()).every(n=>n===0));owned=true;
 const fv=await p.createField({name:field,type:0,length:1,decimalPositions:0,label:{id:field,longName:'Reversal field',shortName:'Rev'},operatorId});
 await p.saveField({name:field,openedVersion:fv.version,operatorId,properties:{format:0,formatFamily:'',displayName:'',formatLength:0,defaultCenturyYear:50,imeMode:0,ownerId:'PPT'}});
 await p.saveTranslate(field,{kind:'add',item:{value:'Y',effectiveDate:'1900-01-01',status:'A',longName:'Yes',shortName:'Yes'}},operatorId);
 await p.saveRecord({operatorId,edit:{recname:record,recordType:RecordType.DerivedWork,openedVersion:0,isNew:true,properties:{description:'Reversal record'},fields:[{name:field,useEdit:0,useEdit2:0,isNew:true}]}});
 await p.savePeopleCode(keys.code,{source:'Local string &s = '+record+'.'+field+'.Value;\r\n',openedFingerprint:'absent',operatorId});
 const sorted=(rows:any[])=>rows.sort((a,b)=>canonical(a)<canonical(b)?-1:1);
 const src=(await p.readPageForMigration('HRS_APP_PRINT_PAGE'))!.data.native,swap=(v:unknown)=>typeof v==='string'&&(v.trim()==='HRS_APP_PRINT_PAGE'||v.startsWith('HRS_APP_PRINT_PAGE$'))?page+v.trim().slice(18):v;
 await p.createPageFromMigration({operatorId,data:{name:page,native:{scope:src.scope,tables:Object.fromEntries(PAGE_SNAPSHOT_TABLES.map(t=>[t,sorted(src.tables[t].map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,['PNLNAME','PARENTPNLFLDID','PAGEPNLFLDID'].includes(k)?swap(v):v]))))]))} as never}});
 const comp=(await p.readComponentForMigration('DEPEND_BENEF','GBL'))!.data,first=String(comp.tables.PSPNLGROUP.find(r=>Number(r.SUBITEMNUM)===1)!.PNLNAME);
 await p.createComponentFromMigration({operatorId,data:{name:component,market:'GBL',tables:Object.fromEntries(COMPONENT_TABLES.map(t=>[t,sorted(comp.tables[t].map(r=>({...r,PNLGRPNAME:component,...(t==='PSPNLGROUP'&&r.PNLNAME===first?{PNLNAME:page}:{})})))])) as never}});
 await p.createPackage({name:root,operatorId});const pk=(await p.readPackageForMigration(root))!;await p.createSubpackage({root,path:['UI'],openedVersion:pk.version,operatorId});
 await p.savePeopleCode(keys.class,{source:'class Panel\r\nend-class;\r\n',openedFingerprint:'absent',operatorId,createClass:true});
 await p.saveAppEngineDocument({doc:documentFromSpec({program,description:'Reversal AE',disableRestart:true,sections:[{name:'MAIN',steps:[{name:'STEP1',actions:[{type:'PeopleCode',peopleCode:'Local number &n = 1;'}]}]}]}),openedToken:'absent',operatorId});
 const popup=insertItem(newMenu(menu,1),'MENUITEM1',{name:'RUN',type:9,label:'Run',peopleCode:'MessageBox(0, "", 0, 0, "Reversal");\r\n'}).doc;popup.descr='Reversal popup';await p.saveMenuDocument({doc:popup,openedToken:'absent',operatorId});
 const cp=await p.createProject({project,operatorId});await p.saveProject({project,operatorId,openedVersion:cp.version,add:[keys.field,keys.record,keys.code,keys.program,keys.menu,keys.page,keys.component,makeKey(DefinitionType.ApplicationPackage,root,root,'.')]});
 const pkg=await exportMigrationPackage(p,project),target=await databaseMigrationTarget(p,operatorId);
 const expected=Object.fromEntries(await Promise.all(Object.entries(keys).map(async([n,k])=>[n,migrationHash((await readMigrationAsset(p,k))!.data)])));
 const removed=async()=>{for(const k of Object.values(keys))assert.equal(await readMigrationAsset(p,k),undefined,k.parts.join('.'));};
 report.assets=pkg.assets.map(a=>a.kind+':'+a.key.parts.join('.'));await cleanup();owned=true;
 const workspace={connections:[],activeProviders:[p],require:async()=>p,isWritable:()=>true,isSqlWritable:()=>true,isPeopleCodeWritable:()=>true,configFor:()=>({peoplesoftOperatorId:operatorId,peoplecodeSaveMode:'compile-and-save'})} as unknown as Workspace;
 const registry=databaseReviewAdapters(workspace,()=>({mode:()=> 'confirm',confirm:async()=>{throw Error('No legacy confirmation path.');},hasUnsavedEditor:()=>false,saved(){}}));const service=new ReviewService(new ReviewStore(dir),{environment:registry.environment,changed(){}},registry.adapters);
 const approve=async(id:string,destructive=false)=>{const s=await service.validate(id);assert.equal(s.status,'READY_FOR_REVIEW',JSON.stringify(s.objects.map(o=>[o.adapter,o.validation])));return service.review(id,s.objects.map(o=>o.id),'APPROVED',s.revision,destructive);};
 const restored=async()=>{for(const [n,k] of Object.entries(keys))assert.equal(migrationHash((await readMigrationAsset(p,k))?.data??null),expected[n],n);assert.ok(await p.projectExists(project));};
 let original=(await stageMigrationImport(service,p.id,pkg,await previewMigrationImport(pkg,target),target,p))!;
 await check('Reviewed import creates the field, record and its PeopleCode, AE program, menu, page, component, package with its class, and the project exactly',async()=>{original=await approve(original.id);original=await service.apply(original.id);assert.equal(original.status,'APPLIED',JSON.stringify(original.journal));await restored();});
 let inverse=await service.reverse(original.id);
 await check('The creation inverse is ten deletions; rollback previews (assuming the same inverse\'s earlier deletions) leave everything in place and destructive approval is required',async()=>{
  assert.deepEqual(inverse.objects.map(o=>o.adapter).sort(),['migration-ae','migration-component','migration-field','migration-menu','migration-package','migration-page','migration-peoplecode','migration-peoplecode','migration-project','migration-record']);
  assert.ok(inverse.objects.every(o=>o.operation==='DELETE'));report.inverseObjects=inverse.objects.length;
  const s=await service.validate(inverse.id);assert.equal(s.status,'READY_FOR_REVIEW',JSON.stringify(s.objects.map(o=>[o.adapter,o.validation])));await restored();
  await assert.rejects(service.review(s.id,s.objects.map(o=>o.id),'APPROVED',s.revision,false),/destructive|delet/i);inverse=await service.review(s.id,s.objects.map(o=>o.id),'APPROVED',s.revision,true);});
 await check('Applying the inverse deletes every definition through its native writer, leaving each deletion tombstone',async()=>{inverse=await service.apply(inverse.id);assert.equal(inverse.status,'APPLIED',JSON.stringify(inverse.journal));
  await removed();assert.equal(await p.projectExists(project),false);
  const t=await tombstones();report.tombstones=t;for(const [n,v] of Object.entries(t))assert.ok(v>=1,n);assert.equal(await one('SELECT COUNT(*) AS N FROM PSDBFIELD WHERE FIELDNAME=:n',{n:field}),0);assert.equal((await service.store.get(original.id)).status,'REVERTED');});
 let redo=await service.redo(original.id);redo=await approve(redo.id);redo=await service.apply(redo.id);
 await check('Fresh redo from the original history recreates every definition exactly, clearing the tombstones',async()=>{assert.equal(redo.status,'APPLIED',JSON.stringify(redo.journal));await restored();
  const t=await tombstones();assert.deepEqual([t.record,t.program,t.menu,t.project,t.page,t.component,t.package],[0,0,0,0,0,0,0]);});
 report.reviewSets=[original.id,inverse.id,redo.id];report.passed=true;
}catch(error){report.error=error instanceof Error?error.stack??error.message:String(error);throw error;}
finally{try{await cleanup();report.cleanupVerified=owned?(await Promise.all(Object.values(keys).map(k=>readMigrationAsset(p,k)))).every(x=>!x)&&!(await p.projectExists(project))&&Object.values(await tombstones()).every(n=>n===0):true;}finally{await writeFile('tools/lab/results/migration-reversal-native-2026-10-20.json',JSON.stringify(report,null,2)+'\n');await c.close();await pool.close();await p.dispose();await rm(dir,{recursive:true,force:true});}}
