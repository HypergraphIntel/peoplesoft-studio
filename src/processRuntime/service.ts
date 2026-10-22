import {randomUUID} from 'node:crypto';
import type {RuntimeBaseline,RuntimeMetadata} from '../providers/processRuntimeReader.js';
import {PROCESS_TYPE,ProcessRuntimeClient,validateRuntimeRequest,type RuntimeRequest,type RuntimeReport,type RuntimeRun} from './protocol.js';
import {RuntimeStore,confirmationHash,type RuntimeIntent} from './store.js';
export interface RuntimeSession {
 endpoint:string; operator:string; client:ProcessRuntimeClient;
 baseline(request:RuntimeRequest):Promise<RuntimeBaseline>;
 metadata():Promise<RuntimeMetadata>;
 assertCanSubmit(request:RuntimeRequest):Promise<void>;
}
export interface RuntimeHost {session(connection:string):Promise<RuntimeSession>;changed?():void;}
export class ProcessRuntimeService {
 constructor(readonly store:RuntimeStore,private readonly host:RuntimeHost,private readonly now=()=>Date.now()){}
 async choices(connection:string){const session=await this.host.session(connection);
  const [metadata,processes,servers]=await Promise.all([session.metadata(),session.client.processes(),session.client.servers()]);
  return {...metadata,endpoint:session.endpoint,processes,servers};
 }
 async prepare(connection:string,raw:RuntimeRequest):Promise<RuntimeIntent>{
  const request=validateRuntimeRequest(raw),session=await this.host.session(connection);await session.assertCanSubmit(request);
  const [baseline,processes,servers]=await Promise.all([session.baseline(request),session.client.processes(),session.client.servers()]);
  if(!processes.includes(request.process)||request.server&&!servers.includes(request.server))throw Error('Reload the native process/server choices before preparing this request.');
  const created=new Date(this.now()).toISOString();
  const value:RuntimeIntent={schema:1,id:randomUUID(),connection,endpoint:session.endpoint,operator:session.operator,identity:baseline.identity,request,afterInstance:baseline.lastInstance,baselineToken:baseline.token,description:baseline.description,created,expires:new Date(this.now()+5*60000).toISOString(),updated:created,state:'PREPARED',confirmationHash:''};
  value.confirmationHash=confirmationHash(value);await this.store.exclusive(()=>this.store.put(value));this.host.changed?.();return value;
 }
 async list(connection:string){const session=await this.host.session(connection);return this.store.list(connection,session.operator);}
 private async owned(id:string):Promise<{intent:RuntimeIntent;session:RuntimeSession}>{
  const intent=await this.store.get(id),session=await this.host.session(intent.connection);
  if(intent.operator!==session.operator||intent.endpoint!==session.endpoint)throw Error('This process request belongs to another operator or scheduler endpoint.');return {intent,session};
 }
 async submit(id:string,expectedHash:string,confirm:(intent:RuntimeIntent)=>Promise<boolean>):Promise<RuntimeIntent>{
  return this.store.exclusive(async()=>{
   const {intent,session}=await this.owned(id);
   if(intent.state!=='PREPARED'||intent.confirmationHash!==expectedHash)throw Error('This confirmation is stale or has already been used. No new request was submitted.');
   const invalidate=async(message:string):Promise<never>=>{intent.state='INVALIDATED';intent.error=message;intent.updated=new Date(this.now()).toISOString();await this.store.put(intent);this.host.changed?.();throw Error(message);};
   if(this.now()>Date.parse(intent.expires))return invalidate('This run confirmation expired. Prepare a fresh request.');
   await session.assertCanSubmit(intent.request);
   if(!await confirm(structuredClone(intent))){intent.state='CANCELLED';intent.updated=new Date(this.now()).toISOString();await this.store.put(intent);this.host.changed?.();return intent;}
   await session.assertCanSubmit(intent.request);
   if(this.now()>Date.parse(intent.expires))return invalidate('The confirmation expired while awaiting approval. Prepare a fresh request.');
   const current=await session.baseline(intent.request);
   if(current.identity!==intent.identity||current.token!==intent.baselineToken)return invalidate('The environment, process or run control changed after preview. Prepare a fresh request.');
   // Discovery is read-only and completes before the durable point of possible submission.
   await session.client.discover();
   await session.assertCanSubmit(intent.request);
   if(this.now()>Date.parse(intent.expires))return invalidate('The run confirmation expired during preflight. Prepare a fresh request.');
   intent.state='SUBMITTING';intent.updated=new Date(this.now()).toISOString();await this.store.put(intent);this.host.changed?.();
   try{intent.instance=await session.client.schedule(intent.request);intent.state='SUBMITTED';}
   catch{intent.state='UNCERTAIN';intent.error='The native scheduling outcome is uncertain. Check native matches before any new submission; Studio will not retry this request.';}
   intent.updated=new Date(this.now()).toISOString();await this.store.put(intent);this.host.changed?.();return intent;
  });
 }
 async cancel(id:string):Promise<RuntimeIntent>{return this.store.exclusive(async()=>{const {intent}=await this.owned(id);if(intent.state!=='PREPARED')throw Error('Only an unsubmitted preparation can be cancelled here.');intent.state='CANCELLED';intent.updated=new Date(this.now()).toISOString();await this.store.put(intent);this.host.changed?.();return intent;});}
 async status(id:string):Promise<RuntimeIntent>{
  const {intent,session}=await this.owned(id);if(!intent.instance)return intent;
  const run=await session.client.get(intent.instance);this.matches(intent,run);
  return this.store.exclusive(async()=>{const latest=await this.store.get(id);if(latest.instance!==run.instance)throw Error('Process history changed during refresh.');latest.run=run;latest.updated=new Date(this.now()).toISOString();await this.store.put(latest);return latest;});
 }
 private matches(intent:RuntimeIntent,run:RuntimeRun):void{
  if(run.operator!==intent.operator||run.process!==intent.request.process||run.runControl!==intent.request.runControl||run.processType!==PROCESS_TYPE||run.instance<=intent.afterInstance)throw Error('Native process identity differs from the confirmed request.');
 }
 async candidates(id:string):Promise<RuntimeRun[]>{const {intent,session}=await this.owned(id);if(!['SUBMITTING','UNCERTAIN'].includes(intent.state))throw Error('Only an unresolved submission needs reconciliation.');return (await session.client.find(intent.request.process)).filter(run=>run.operator===intent.operator&&run.process===intent.request.process&&run.runControl===intent.request.runControl&&run.instance>intent.afterInstance);}
 async reconcile(id:string,instance:number):Promise<RuntimeIntent>{
  return this.store.exclusive(async()=>{const {intent,session}=await this.owned(id);if(!['SUBMITTING','UNCERTAIN'].includes(intent.state))throw Error('This request is not awaiting reconciliation.');
   const run=await session.client.get(instance);this.matches(intent,run);
   // Explicit user selection links the native instance; no writer or scheduling retry is called.
   intent.instance=run.instance;intent.run=run;intent.state='SUBMITTED';intent.error=undefined;intent.updated=new Date(this.now()).toISOString();await this.store.put(intent);this.host.changed?.();return intent;
  });
 }
 async reports(id:string):Promise<RuntimeReport[]>{const {intent,session}=await this.owned(id);if(!intent.instance)throw Error('No process instance is linked to this request.');this.matches(intent,await session.client.get(intent.instance));return session.client.reports(intent.instance);}
 async report(id:string,reportId:string):Promise<RuntimeReport>{const reports=await this.reports(id),report=reports.find(r=>r.id===reportId);if(!report)throw Error('The selected report is no longer available or authorized.');return report;}
 async download(id:string,reportId:string):Promise<{report:RuntimeReport;bytes:Uint8Array}>{const {session}=await this.owned(id),report=await this.report(id,reportId);return {report,bytes:await session.client.download(report)};}
}
