/** Actual SIGKILL/lost-response acceptance against a unique HRDMO HTML definition; no installed UI claim. */
import assert from 'node:assert/strict';
import Module from 'node:module';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { DatabaseProvider } from '../../src/providers/database.js';
import { openDatabase } from '../../src/db/open.js';
import { makeKey, DefinitionType } from '../../src/model/definitions.js';
import { ReviewService } from '../../src/changeReview/service.js';
import { ReviewStore } from '../../src/changeReview/store.js';
import { migrationJson } from '../../src/changeReview/migration.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';
import { setWriteGuard, writeOrigin } from '../../src/providers/writeGuard.js';
import { isReviewedWrite } from '../../src/changeReview/authorization.js';
import type { Workspace } from '../../src/workspace.js';
const {createStub}=await import('../../scripts/vscode-stub.mjs');const {vscode}=createStub(),load=(Module as any)._load;
(Module as any)._load=function(name:string,parent:unknown,main:boolean){return name==='vscode'?vscode:load.call(this,name,parent,main);};
const {databaseReviewAdapters}=await import('../../src/changeReview/adapters.js');
const config={name:'HRDMO crash acceptance',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};assert.match(config.connectString,/hrdmo/i);assert.ok(config.user&&config.password);
const name='ZZ_BX'+randomBytes(3).toString('hex').toUpperCase(),operatorId=process.env.PSLAB_OPERATOR??'JARED',key=makeKey(DefinitionType.HtmlDefinition,name,'4');
const root=await mkdtemp(path.join(os.tmpdir(),'psft-native-crash-')),p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection();
let owned=false,child:ReturnType<typeof spawn>|undefined;
setWriteNamePrefix(name);setWriteGuard(async w=>{assert.equal(w.key.parts[0],name);if(writeOrigin()==='agent')assert.ok(isReviewedWrite(p.id,w.key));});
const workspace={connections:[],activeProviders:[p],require:async()=>p,isWritable:()=>true,isSqlWritable:()=>true,isPeopleCodeWritable:()=>true,configFor:()=>({peoplesoftOperatorId:operatorId,peoplecodeSaveMode:'compile-and-save'})} as unknown as Workspace;
const registry=databaseReviewAdapters(workspace,()=>({mode:()=> 'confirm',confirm:async()=>{throw Error('No legacy prompt.');},hasUnsavedEditor:()=>false,saved(){}}));
const service=new ReviewService(new ReviewStore(root),{environment:registry.environment,changed(){}},registry.adapters);
const checks:unknown[]=[],report:Record<string,unknown>={checkedAt:new Date().toISOString(),scope:'Actual child-process SIGKILL around real HRDMO commit; durable native baseline/readback reconciliation with no replay; test service approval, not installed UI',name,checks};
const counters=async()=> (await c.execute("SELECT OBJECTTYPENAME, VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('CRM','SYS') ORDER BY OBJECTTYPENAME")).rows;
async function approve(id:string){let s=await service.validate(id);assert.equal(s.status,'READY_FOR_REVIEW',JSON.stringify(s.journal.at(-1)));return service.review(id,s.objects.map(c=>c.id),'APPROVED',s.revision);}
async function crash(id:string,mode:string){
 const spec=path.join(root,'child.json');await writeFile(spec,JSON.stringify({id,name,root,mode,operatorId,connection:config.name}),{mode:0o600});
 child=spawn(process.execPath,['--import','tsx','tools/lab/recovery-crash-child.mts',spec],{cwd:process.cwd(),stdio:['ignore','pipe','pipe'],env:process.env});
 const proc=child;let stderr='';proc.stderr!.on('data',d=>{stderr=(stderr+d.toString()).slice(-5000);});
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Crash child did not reach boundary: '+stderr)),45000);let output='';proc.stdout!.on('data',d=>{output+=d.toString();if(output.includes('CRASH_BOUNDARY '+mode)){clearTimeout(timer);resolve();}});proc.once('exit',(code,signal)=>{clearTimeout(timer);reject(Error('Child exited before boundary '+code+' '+signal+' '+stderr));});});
 const exited=once(proc,'exit');proc.kill('SIGKILL');const [code,signal]=await exited;assert.equal(signal,'SIGKILL');assert.equal(code,null);child=undefined;
}
try{await p.connect();assert.equal(await p.readContentForMigration(key),undefined);owned=true;
 await p.saveHtmlDefinition({name,text:'<p>Baseline</p>\r\n',description:'Crash acceptance',operatorId,expectedSnapshotToken:'absent'});
 for(const mode of ['after-commit','before-commit']){
  const before=(await p.readContentForMigration(key))!;let set=await service.create('Native '+mode+' crash',p.id);
  set=await service.stage(set.id,'migration-html',migrationJson(key),migrationJson({...before.data,text:'<p>'+mode+'</p>\r\n'}),[],undefined,before.token);set=await approve(set.id);
  const countsBefore=await counters();await crash(set.id,mode);
  const interrupted=await service.store.get(set.id);assert.equal(interrupted.status,'APPLYING');assert.equal(interrupted.objects[0].application,'APPLYING');
  const live=(await p.readContentForMigration(key))!,countsAfterCrash=await counters();const recovered=await service.recover(set.id);
  assert.deepEqual(await counters(),countsAfterCrash,'Recovery never executes a native writer.');assert.equal((await p.readContentForMigration(key))!.token,live.token);
  if(mode==='after-commit'){assert.equal(recovered.status,'APPLIED');assert.equal(recovered.objects[0].application,'VERIFIED');assert.equal(live.data.text,'<p>after-commit</p>\r\n');assert.notDeepEqual(countsBefore,countsAfterCrash);await assert.rejects(service.apply(set.id),/approved/);}
  else{assert.deepEqual(countsAfterCrash,countsBefore);assert.equal(live.token,before.token);assert.equal(recovered.status,'PARTIALLY_APPLIED');assert.equal(recovered.objects[0].application,'PENDING');let next=await service.prepareRemaining(set.id);assert.equal(next.objects[0].review,'PENDING');await assert.rejects(service.apply(next.id),/approved/);next=await approve(next.id);assert.equal((await service.apply(next.id)).status,'APPLIED');assert.equal((await p.readContentForMigration(key))!.data.text,'<p>before-commit</p>\r\n');}
  checks.push({mode,actualSignal:'SIGKILL',interruptedStatus:interrupted.status,recoveredStatus:recovered.status,noReplay:true,stableNativeTokenDuringRecovery:true});console.log('ok '+mode+' hard crash recovered without replay');
 }
 report.passed=true;
}catch(error){report.error=error instanceof Error?error.message:String(error);throw error;}
finally{if(child){child.kill('SIGKILL');await once(child,'exit').catch(()=>{});}try{if(owned){await c.rollback();for(const t of ['PSCONTENTLANG','PSCONTDEFNLANG','PSCONTENT','PSCONTDEFN'])await c.execute(`DELETE FROM ${t} WHERE CONTNAME=:n`,{n:name});await c.commit();report.cleanupVerified=!(await p.readContentForMigration(key));}}finally{await writeFile('tools/lab/results/recovery-crash-native-2026-10-20.json',JSON.stringify(report,null,2)+'\n');await c.close();await pool.close();await p.dispose();await rm(root,{recursive:true,force:true});}}
