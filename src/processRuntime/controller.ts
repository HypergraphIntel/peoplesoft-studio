import * as vscode from 'vscode';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {Workspace} from '../workspace.js';
import {DatabaseProvider} from '../providers/database.js';
import {DefinitionType,makeKey} from '../model/definitions.js';
import type {McpWriteHost} from '../mcp/writeTools.js';
import {ProcessRuntimeClient,runtimeUrl,type RuntimeReport,type RuntimeRequest} from './protocol.js';
import {RuntimeStore,type RuntimeIntent} from './store.js';
import {ProcessRuntimeService,type RuntimeSession} from './service.js';
import {processRuntimeHtml} from './html.js';
import {awaitWriteApproval,assertWriteRequestActive} from '../providers/writeGuard.js';
interface PanelState {panel:vscode.WebviewPanel;connection:string;initialProcess?:string;selected?:string;message?:string;error?:boolean;files?:RuntimeReport[];candidates?:unknown[];choices?:Awaited<ReturnType<ProcessRuntimeService['choices']>>;queue:Promise<void>;disposed:boolean;}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
/** Interactive runtime sign-in and confirmation never leave the trusted VS Code host. */
export class ProcessRuntimeController implements vscode.Disposable {
 readonly service:ProcessRuntimeService;
 private readonly panels=new Map<string,PanelState>();
 private readonly clients=new Map<string,{key:string;client:ProcessRuntimeClient}>();
 private readonly timer:ReturnType<typeof setInterval>;
 private polling=false;
 constructor(private readonly context:vscode.ExtensionContext,private readonly workspace:Workspace,private readonly writeHost:()=>McpWriteHost|undefined){
  this.service=new ProcessRuntimeService(new RuntimeStore(path.join(context.globalStorageUri.fsPath,'process-runtime')),{session:id=>this.session(id),changed:()=>{}});
  this.timer=setInterval(()=>{void this.poll();},5000);this.timer.unref();
 }
 dispose():void{clearInterval(this.timer);for(const p of this.panels.values())p.panel.dispose();this.panels.clear();this.clients.clear();}
 private endpointKey(connection:string):string{return 'processRuntime.endpoint.'+digest(connection);}
 private secretKey(connection:string,endpoint:string,operator:string):string{return 'processRuntime.password.'+digest(JSON.stringify([connection,endpoint,operator]));}
 private async contextFor(connection:string){
  const provider=await this.workspace.require(connection);if(!(provider instanceof DatabaseProvider)||provider.platform!=='oracle')throw Error('Run and Monitor currently requires an Oracle database connection.');
  const config=this.workspace.configFor(provider.id),operator=config?.peoplesoftOperatorId?.trim();if(!operator)throw Error('Configure a PeopleSoft Operator ID for this connection.');
  const environment=await provider.readEnvironment();if(environment.toolsRelease!=='8.62')throw Error('The initial Process Scheduler runtime workflow is calibrated for PeopleTools 8.62.');
  const endpoint=this.context.globalState.get<string>(this.endpointKey(connection))||(await provider.readProcessRuntimeMetadata(operator)).endpoint;
  runtimeUrl(endpoint);return {provider,operator,endpoint};
 }
 private async session(connection:string):Promise<RuntimeSession>{
  const {provider,operator,endpoint}=await this.contextFor(connection),password=await this.context.secrets.get(this.secretKey(connection,endpoint,operator));
  if(!password)throw Error('Use Scheduler sign-in to authenticate the configured PeopleSoft operator.');
  const key=digest(JSON.stringify([endpoint,operator,password]));let cached=this.clients.get(connection);
  if(cached?.key!==key){cached={key,client:new ProcessRuntimeClient(endpoint,{operatorId:operator,password})};this.clients.set(connection,cached);}
  return {endpoint,operator,client:cached!.client,metadata:()=>provider.readProcessRuntimeMetadata(operator),baseline:request=>provider.readProcessRuntimeBaseline(operator,request),assertCanSubmit:async request=>{
   assertWriteRequestActive();
   if(this.workspace.configFor(connection)?.peoplesoftOperatorId?.trim()!==operator||(this.context.globalState.get<string>(this.endpointKey(connection))||endpoint)!==endpoint)throw Error('The runtime operator or endpoint changed. Prepare a fresh request.');
   if(!this.workspace.isWritable(connection))throw Error('Set this connection to Writable before submitting a process. Monitoring remains available.');
   for(const type of [DefinitionType.ProcessDefinition,DefinitionType.AppEngineProgram]){
    const key=type===DefinitionType.ProcessDefinition?makeKey(type,'Application Engine',request.process):makeKey(type,request.process);
    if(this.writeHost()?.hasUnsavedEditor(connection,key))throw Error('Save or revert the process/program editor before preparing or submitting a run.');
   }
   if(vscode.workspace.textDocuments.some(doc=>doc.isDirty&&['psft','psft-ae'].includes(doc.uri.scheme)&&decodeURIComponent(doc.uri.toString()).includes(request.process)))throw Error('Save or revert unsaved App Engine source before submitting a run.');
  }};
 }
 async configure(connection:string):Promise<boolean>{
  const current=await this.contextFor(connection);
  const entered=await vscode.window.showInputBox({title:'Process Scheduler endpoint — '+current.provider.displayName,value:current.endpoint,prompt:'Delivered PROCESSREQUEST service endpoint (HTTPS)',ignoreFocusOut:true,validateInput:value=>{try{runtimeUrl(value);return undefined;}catch(e){return e instanceof Error?e.message:String(e);}}});
  if(entered===undefined)return false;
  const endpoint=runtimeUrl(entered).href,password=await vscode.window.showInputBox({title:'PeopleSoft Scheduler password — '+current.operator+' on '+current.provider.displayName,prompt:'PeopleSoft operator password, stored in VS Code SecretStorage. This is separate from the database password.',password:true,ignoreFocusOut:true});
  if(password===undefined)return false;
  const client=new ProcessRuntimeClient(endpoint,{operatorId:current.operator,password});await client.discover();await client.servers();
  await this.context.secrets.store(this.secretKey(connection,endpoint,current.operator),password);await this.context.globalState.update(this.endpointKey(connection),endpoint);this.clients.delete(connection);return true;
 }
 async signOut(connection:string):Promise<void>{const {operator,endpoint}=await this.contextFor(connection);await this.context.secrets.delete(this.secretKey(connection,endpoint,operator));this.clients.delete(connection);}
 async show(connection?:string,process?:string):Promise<void>{
  if(!connection){const candidates=this.workspace.activeProviders.filter(p=>p.isConnected&&p instanceof DatabaseProvider);
   const selected=candidates.find(p=>p.id===this.workspace.selectedConnectionId)??candidates[0];if(!selected)throw Error('Connect to a PeopleSoft database first.');connection=selected.id;}
  const provider=await this.workspace.require(connection);
  const existing=this.panels.get(connection);if(existing){existing.panel.reveal();if(process){existing.initialProcess=process;await existing.panel.webview.postMessage({type:'selectProcess',process});}await this.paint(existing);return;}
  const panel=vscode.window.createWebviewPanel('psft.processRuntime','Run and Monitor — '+provider.displayName,vscode.ViewColumn.Active,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]});
  const state:PanelState={panel,connection,initialProcess:process,queue:Promise.resolve(),disposed:false};this.panels.set(connection,state);panel.webview.html=processRuntimeHtml();
  panel.onDidDispose(()=>{state.disposed=true;this.panels.delete(state.connection);});
  panel.webview.onDidReceiveMessage((message:unknown)=>{state.queue=state.queue.then(()=>this.receive(state,message)).catch(async error=>{state.message=error instanceof Error?error.message:String(error);state.error=true;await this.paint(state);});});
 }
 private async refresh(state:PanelState):Promise<void>{state.choices=await this.service.choices(state.connection);}
 private async paint(state:PanelState):Promise<void>{
  if(state.disposed)return;let requests:RuntimeIntent[]=[],operator='',configured=false;
  try{const c=await this.contextFor(state.connection);operator=c.operator;configured=!!await this.context.secrets.get(this.secretKey(state.connection,c.endpoint,c.operator));if(configured)requests=await this.service.list(state.connection);}catch(error){state.message=error instanceof Error?error.message:String(error);state.error=true;}
  if(!state.selected&&requests.length)state.selected=requests[0].id;
  await state.panel.webview.postMessage({type:'state',environment:this.workspace.configFor(state.connection)?.name??state.connection,operator,configured,canSubmit:this.workspace.isWritable(state.connection),...state.choices,requests,initialProcess:state.initialProcess,selected:state.selected,message:state.message,error:state.error,files:state.files?.map(({id,name,description})=>({id,name,description})),candidates:state.candidates});
 }
 private async selected(state:PanelState,id:unknown):Promise<string>{
  if(typeof id!=='string'||!(await this.service.list(state.connection)).some(r=>r.id===id))throw Error('Select a request belonging to this connection and operator.');return id;
 }
 private async receive(state:PanelState,raw:unknown):Promise<void>{
  if(!raw||typeof raw!=='object'||typeof (raw as any).type!=='string')throw Error('Invalid runtime action.');const m=raw as Record<string,any>;state.message=undefined;state.error=false;
  switch(m.type){
   case 'ready':{try{await this.refresh(state);}catch(error){state.message=error instanceof Error?error.message:String(error);}break;}
   case 'configure':if(await this.configure(state.connection)){await this.refresh(state);state.message='Native scheduler sign-in verified.';}break;
   case 'signOut':await this.signOut(state.connection);state.choices=undefined;state.files=undefined;break;
   case 'refresh':await this.refresh(state);if(state.selected){const selected=(await this.service.list(state.connection)).find(r=>r.id===state.selected);if(selected?.instance)await this.service.status(selected.id);}break;
   case 'prepare':{if(!m.request||typeof m.request!=='object')throw Error('Choose process and run control.');const intent=await this.service.prepare(state.connection,m.request as RuntimeRequest);state.selected=intent.id;state.files=undefined;state.candidates=undefined;break;}
   case 'select':state.selected=await this.selected(state,m.id);state.files=undefined;state.candidates=undefined;{const r=await this.service.store.get(state.selected);if(r.instance)await this.service.status(r.id);}break;
   case 'submit':{const id=await this.selected(state,m.id);if(typeof m.confirmationHash!=='string')throw Error('Missing rendered run confirmation.');const result=await this.service.submit(id,m.confirmationHash,async()=>true);state.selected=result.id;if(result.instance){await this.service.status(result.id);state.message='Submitted instance '+result.instance+'.';}break;}
   case 'cancel':await this.service.cancel(await this.selected(state,m.id));break;
   case 'status':await this.service.status(await this.selected(state,m.id));break;
   case 'find':state.candidates=await this.service.candidates(await this.selected(state,m.id));if(!state.candidates.length)state.message='No matching native requests were returned. Check Process Monitor before preparing another run.';break;
   case 'reconcile':await this.service.reconcile(await this.selected(state,m.id),Number(m.instance));state.candidates=undefined;break;
   case 'reports':state.files=await this.service.reports(await this.selected(state,m.id));break;
   case 'view':case 'download':case 'browser':await this.openReport(state,await this.selected(state,m.id),String(m.file),m.type);break;
   default:throw Error('Unknown runtime action.');
  }await this.paint(state);
 }
 private async openReport(state:PanelState,id:string,file:string,action:string):Promise<void>{
  if(action==='browser'){const report=await this.service.report(id,file);await vscode.env.openExternal(vscode.Uri.parse(report.url));return;}
  let result:Awaited<ReturnType<ProcessRuntimeService['download']>>;
  try{result=await this.service.download(id,file);}catch(error){const message=error instanceof Error?error.message:String(error);if(await vscode.window.showWarningMessage(message,'Open in PeopleSoft')==='Open in PeopleSoft'){const report=await this.service.report(id,file);await vscode.env.openExternal(vscode.Uri.parse(report.url));}state.message=message;return;}
  if(action==='view'){
   if(result.bytes.length>2*1024*1024)throw Error('This file exceeds the 2 MB preview limit. Use Download.');
   const sample=result.bytes.subarray(0,4096);if(sample.includes(0))throw Error('This is a binary file. Use Download or open it in PeopleSoft.');
   const doc=await vscode.workspace.openTextDocument({content:new TextDecoder().decode(result.bytes),language:/\.csv$/i.test(result.report.name)?'csv':'plaintext'});await vscode.window.showTextDocument(doc,{preview:false,viewColumn:vscode.ViewColumn.Beside});
  }else{const target=await vscode.window.showSaveDialog({title:'Download '+result.report.name,defaultUri:vscode.Uri.file(path.join(require('node:os').homedir(),'Downloads',result.report.name)),saveLabel:'Download'});if(target){await vscode.workspace.fs.writeFile(target,result.bytes);state.message='Downloaded '+result.report.name;}}
 }
 private async poll():Promise<void>{
  if(this.polling)return;this.polling=true;
  // A background refresh never connects: activating its connection would close the active one (one connection at a
  // time), as it did to a promotion's target on ps-win-client (NJS-064). Refresh and the panel's actions still connect.
  const active=new Set(this.workspace.activeProviders.filter(p=>p.isConnected).map(p=>p.id));
  try{for(const state of this.panels.values())if(state.panel.visible&&!state.disposed&&state.selected&&active.has(state.connection)){state.queue=state.queue.then(async()=>{
    try{const request=(await this.service.list(state.connection)).find(r=>r.id===state.selected);if(request?.instance&&(!request.run?.ended||!request.run.contentIds.length)){await this.service.status(request.id);await this.paint(state);}}
    catch(error){state.message=error instanceof Error?error.message:String(error);state.error=true;await this.paint(state);}
   });await state.queue;}}finally{this.polling=false;}
 }
 async submitFromAgent(id:string,hash:string):Promise<RuntimeIntent>{
  const host=this.writeHost();if(!host||host.mode()==='off')throw Error('MCP runtime submission is disabled.');
  return this.service.submit(id,hash,async intent=>{
   const accepted=await awaitWriteApproval(signal=>host.confirm({title:'Run '+intent.request.process+' on '+intent.connection,detail:JSON.stringify({operator:intent.operator,processType:'Application Engine',...intent.request,output:'Web / TXT',warning:'Submits a real process. Runtime effects cannot be undone by Change Review.'},null,2),signal}),'Process Scheduler runtime approval');
   if(host.mode()==='off')throw Error('MCP runtime submission is disabled.');
   return accepted;
  });
 }
}
