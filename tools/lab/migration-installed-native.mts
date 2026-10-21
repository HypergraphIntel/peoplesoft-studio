/**
 * Installed-VSIX migration acceptance (separate VS Code window, private history; tools/lab/build-handoff/installed-host.mjs).
 * `prepare <file>`: disposable HRDMO sources -- a field with translate values, a page copied from HRS_APP_PRINT_PAGE, a
 * component listing it, an Application Package with a class, their project -- exported to <file>, then removed.
 * `run <file>`: the installed Import command stages the package; the rendered Approve and apply creates everything;
 * a prepared inverse is approved destructively in the rendered review and deletes it all; a redo recreates it.
 */
import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {createRequire} from 'node:module';import {randomBytes} from 'node:crypto';
import {DatabaseProvider} from '../../src/providers/database.js';import {openDatabase} from '../../src/db/open.js';
import {DefinitionType,makeKey} from '../../src/model/definitions.js';import {canonical,reviewStateToken} from '../../src/changeReview/model.js';
import {PAGE_SNAPSHOT_TABLES} from '../../src/providers/pageSnapshot.js';import {COMPONENT_TABLES} from '../../src/providers/componentMigration.js';
import {setWriteNamePrefix} from '../../src/providers/writeScope.js';import {readMigrationAsset} from '../../src/providers/migrationTarget.js';
import {exportMigrationPackage,migrationHash,type StudioMigrationPackage} from '../../src/migrationPackage.js';
const [mode,file]=process.argv.slice(2);assert.ok(['prepare','run'].includes(mode)&&file);
const config={name:'HRDMO installed migration acceptance',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};assert.match(config.connectString,/hrdmo/i);
const operatorId=process.env.PSLAB_OPERATOR??'JARED',p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection();
const names=(prefix:string)=>({field:prefix+'F',page:prefix+'G',component:prefix+'C',root:prefix+'PKG',project:prefix+'P'});
async function cleanup(n:ReturnType<typeof names>){await c.rollback();
 for(const t of ['PSXLATITEM','PSXLATDEFN','PSXLATDEFNDEL','PSDBFLDLABL','PSDBFIELD'])await c.execute(`DELETE FROM ${t} WHERE FIELDNAME=:n`,{n:n.field});
 for(const t of [...PAGE_SNAPSHOT_TABLES].reverse())await c.execute(`DELETE FROM ${t} WHERE PNLNAME=:n`,{n:n.page});await c.execute('DELETE FROM PSPNLDEL WHERE PNLNAME=:n',{n:n.page});
 for(const t of [...COMPONENT_TABLES].reverse())await c.execute(`DELETE FROM ${t} WHERE PNLGRPNAME=:n`,{n:n.component});await c.execute('DELETE FROM PSPNLGRPDEL WHERE PNLGRPNAME=:n',{n:n.component});
 for(const t of ['PSPCMTXT','PSPCMNAME','PSPCMPROG','PSPCMPROGDEL'])await c.execute(`DELETE FROM ${t} WHERE OBJECTID1=104 AND OBJECTVALUE1=:n`,{n:n.root});
 for(const t of ['PSAPPCLASSDEFN','PSPACKAGEDEFN','PSPACKAGEDEL'])await c.execute(`DELETE FROM ${t} WHERE PACKAGEROOT=:n`,{n:n.root});
 for(const t of ['PSPROJECTITEM','PSPROJECTDEFN','PSPROJECTDEL'])await c.execute(`DELETE FROM ${t} WHERE PROJECTNAME=:n`,{n:n.project});await c.commit();}
try{await p.connect();
 if(mode==='prepare'){
  const prefix='ZZ_BJ'+randomBytes(3).toString('hex').toUpperCase(),n=names(prefix);setWriteNamePrefix(prefix);
  const fv=await p.createField({name:n.field,type:0,length:1,decimalPositions:0,label:{id:n.field,longName:'Installed field',shortName:'Inst'},operatorId});
  await p.saveField({name:n.field,openedVersion:fv.version,operatorId,properties:{format:0,formatFamily:'',displayName:'',formatLength:0,defaultCenturyYear:50,imeMode:1,ownerId:'PPT'}});
  await p.saveTranslate(n.field,{kind:'add',item:{value:'Y',effectiveDate:'1900-01-01',status:'A',longName:'Yes',shortName:'Yes'}},operatorId);
  const sorted=(rows:any[])=>rows.sort((a,b)=>canonical(a)<canonical(b)?-1:1);
  const src=(await p.readPageForMigration('HRS_APP_PRINT_PAGE'))!.data.native,swap=(v:unknown)=>typeof v==='string'&&(v.trim()==='HRS_APP_PRINT_PAGE'||v.startsWith('HRS_APP_PRINT_PAGE$'))?n.page+v.trim().slice(18):v;
  await p.createPageFromMigration({operatorId,data:{name:n.page,native:{scope:src.scope,tables:Object.fromEntries(PAGE_SNAPSHOT_TABLES.map(t=>[t,sorted(src.tables[t].map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,['PNLNAME','PARENTPNLFLDID','PAGEPNLFLDID'].includes(k)?swap(v):v]))))]))} as never}});
  const comp=(await p.readComponentForMigration('DEPEND_BENEF','GBL'))!.data,first=String(comp.tables.PSPNLGROUP.find(r=>Number(r.SUBITEMNUM)===1)!.PNLNAME);
  await p.createComponentFromMigration({operatorId,data:{name:n.component,market:'GBL',tables:Object.fromEntries(COMPONENT_TABLES.map(t=>[t,sorted(comp.tables[t].map(r=>({...r,PNLGRPNAME:n.component,...(t==='PSPNLGROUP'&&r.PNLNAME===first?{PNLNAME:n.page}:{})})))])) as never}});
  await p.createPackage({name:n.root,operatorId});const pk=(await p.readPackageForMigration(n.root))!;await p.createSubpackage({root:n.root,path:['UI'],openedVersion:pk.version,operatorId});
  await p.savePeopleCode(makeKey(DefinitionType.ApplicationClassPeopleCode,n.root,'UI','Panel','OnExecute'),{source:'class Panel\r\nend-class;\r\n',openedFingerprint:'absent',operatorId,createClass:true});
  const cp=await p.createProject({project:n.project,operatorId});
  await p.saveProject({project:n.project,operatorId,openedVersion:cp.version,add:[makeKey(DefinitionType.Field,n.field),makeKey(DefinitionType.Page,n.page),makeKey(DefinitionType.Component,n.component,'GBL'),makeKey(DefinitionType.ApplicationPackage,n.root,n.root,'.')]});
  const pkg=await exportMigrationPackage(p,n.project);await writeFile(file,JSON.stringify(pkg,null,2)+'\n',{mode:0o600});await cleanup(n);
  console.log(JSON.stringify({prefix,assets:pkg.assets.map(a=>a.kind+':'+a.key.parts.join('.'))}));
 }else{
  const pkg=JSON.parse(await readFile(file,'utf8')) as StudioMigrationPackage,prefix=pkg.project.slice(0,-1),n=names(prefix);assert.match(prefix,/^ZZ_BJ[0-9A-F]{6}$/);
  const control=JSON.parse(await readFile('/tmp/psft-build-handoff-control.json','utf8'));assert.equal(control.privateHistory,true,'Private test history is mandatory.');
  const ui=await createRequire(import.meta.url)('../../scripts/peoplecode-editor-cdp.cjs').connectWorkbench(control.cdpUrl);
  const command=async(body:unknown)=>{const r=await fetch(control.url,{method:'POST',headers:{authorization:'Bearer '+control.token,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)}).then(r=>r.json()) as any;if(!r.ok)throw Error(r.error);return r.data;};
  let seq=0;const call=async(name:string,args:unknown):Promise<any>=>{const r=await fetch(control.mcpUrl,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method:'tools/call',params:{name,arguments:args}})});
   const body=await r.text(),value=JSON.parse(body.startsWith('{')?body:body.split('\n').find(l=>l.startsWith('data:'))!.slice(5));if(value.error||value.result.isError)throw Error(JSON.stringify(value.error??value.result.content));return JSON.parse(value.result.content[0].text);};
  const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  async function wait<T>(fn:()=>Promise<T|false|undefined|null>,label:string,tries=600):Promise<T>{for(let i=0;i<tries;i++){const r=await fn();if(r)return r as T;await pause(100);}throw Error('Timed out: '+label);}
  const get=(id:string)=>call('psft_get_change_set',{changeSetId:id}),sets=async()=>((await call('psft_list_change_sets',{})).changeSets as any[]);
  const open=async(set:any)=>{await command({command:'openReview',id:set.id});return wait(async()=>{const page=await ui.webviewAction('PeopleSoft Change Review');return page?.selectedTitle===set.title&&page.reviewToken===reviewStateToken(set)&&page.busy!=='true'?page:false;},'review '+set.id);};
  const click=async(set:any,action:string)=>{await wait(async()=>{const page=await ui.webviewAction('PeopleSoft Change Review');return page?.selectedTitle===set.title&&page.busy!=='true'&&page.buttons.some((b:any)=>b.action===action&&!b.disabled);},'enabled '+action);await ui.webviewAction('PeopleSoft Change Review','click',action);};
  const applied=async(set:any)=>{const result=await wait(async()=>{const s=await get(set.id);if(['CONFLICTED','FAILED','PARTIALLY_APPLIED'].includes(s.status))throw Error('Apply failed: '+JSON.stringify(s.journal.slice(-3)));return s.status==='APPLIED'?s:false;},'APPLIED',3000);
   await wait(async()=>{const page=await ui.webviewAction('PeopleSoft Change Review');return page?.selectedTitle===result.title&&page.status==='APPLIED'&&page.busy!=='true';},'final UI render');return result;};
  const approveApply=async(set:any,destructive=false)=>{await call('psft_validate_change_set',{changeSetId:set.id});set=await get(set.id);assert.equal(set.status,'READY_FOR_REVIEW',JSON.stringify(set.objects.map((o:any)=>o.validation)));await open(set);
   if(destructive){await ui.webviewAction('PeopleSoft Change Review','checkbox','destructive');const refreshed=await open(set);assert.equal(refreshed.checkboxes.find((x:any)=>x.id==='destructive')?.checked,true);}await click(set,'approveAndApply');return applied(set);};
  const keys=pkg.assets.map(a=>a.key),expected=new Map(pkg.assets.map(a=>[JSON.stringify(a.key),migrationHash(a.data)]));
  const present=async()=>{for(const k of keys)assert.equal(migrationHash((await readMigrationAsset(p,k))?.data??null),expected.get(JSON.stringify(k)),k.parts.join('.'));assert.ok(await p.projectExists(pkg.project));};
  const absent=async()=>{for(const k of keys)assert.equal(await readMigrationAsset(p,k),undefined,k.parts.join('.'));assert.equal(await p.projectExists(pkg.project),false);};
  const checks:string[]=[],report:Record<string,unknown>={checkedAt:new Date().toISOString(),bundleSha256:control.bundleSha256,scope:'Separate installed candidate VSIX, private history, actual HRDMO writers: Import command, rendered Approve and apply, rendered destructive inverse, redo; migration assets '+pkg.assets.map(a=>a.kind).join(', '),prefix,checks};
  const check=async(name:string,fn:()=>Promise<void>)=>{await fn();checks.push(name);console.log('ok '+checks.length+' - '+name);};
  try{await absent();
   await command({command:'importMigration'});await wait(async()=>await command({command:'input',title:'Import Studio Migration Package',value:file}),'file picker');
   await wait(async()=>await command({command:'input',title:'Import into which environment?',value:'HRDMO'}),'target picker');
   let migration=await wait(async()=>(await sets()).find(s=>s.title.startsWith('Migrate '+pkg.project)&&['DRAFT','VALIDATING','READY_FOR_REVIEW'].includes(s.status)),'staged import',1200);
   await check('Installed Import stages field, page, component, package, class and project without writing; the rendered primary action applies them all exactly',async()=>{
    migration=await wait(async()=>{const s=await get(migration.id);return s.status==='READY_FOR_REVIEW'?s:false;},'migration validation',1200);await absent();assert.equal(migration.objects.length,pkg.assets.length+1);
    await open(migration);await ui.screenshot(control.dir+'/installed-migration-before.png');await click(migration,'approveAndApply');migration=await applied(migration);await present();await ui.screenshot(control.dir+'/installed-migration-after.png');report.migrationSet=migration.id;});
   let inverse=await call('psft_prepare_revert',{changeSetId:migration.id});
   await check('The rendered review applies the destructive inverse only with explicit consent, deleting every migrated definition',async()=>{assert.ok(inverse.objects.every((o:any)=>o.operation==='DELETE'));inverse=await approveApply(inverse,true);await absent();await ui.screenshot(control.dir+'/installed-migration-inverse.png');report.inverseSet=inverse.id;});
   let redo=await call('psft_prepare_redo',{changeSetId:migration.id});
   await check('Redo from the original history, approved in the rendered review, recreates everything exactly',async()=>{redo=await approveApply(redo);await present();report.redoSet=redo.id;});
   report.passed=true;
  }catch(error){report.error=error instanceof Error?error.stack??error.message:String(error);throw error;}
  finally{ui.close();await cleanup(n);report.cleanupVerified=(await Promise.all(keys.map(k=>readMigrationAsset(p,k)))).every(x=>!x)&&!(await p.projectExists(pkg.project));
   await writeFile('tools/lab/results/migration-installed-2026-10-21.json',JSON.stringify(report,null,2)+'\n');}
 }
}finally{await c.close();await pool.close();await p.dispose();}
