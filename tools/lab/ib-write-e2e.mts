/** Production MCP routing against the fresh custom administration smoke entries. */
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.cwd();
const {createStub}=await import(pathToFileURL(join(root,'scripts/vscode-stub.mjs')).href);
const {vscode,settings}=createStub();
const loader=(Module as any)._load;
(Module as any)._load=function(name:string,parent:unknown,main:boolean){return name==='vscode'?vscode:loader.call(this,name,parent,main);};
const require=createRequire(join(root,'package.json'));
const {Workspace}=require('./src/workspace.ts');
const {startPeopleSoftMcpServer}=require('./src/mcp/server.ts');
settings.set('peoplesoft.connections',[{name:'HRDMO-IB-API',kind:'oracle',connectString:'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID,peoplecodeAccess:'writable',peoplesoftOperatorId:process.env.PSLAB_OPRID??'JARED'}]);
const workspace=new Workspace({get:async()=>process.env.PSLAB_ACCESSPSWD,store:async()=>{},delete:async()=>{},onDidChange:()=>({dispose(){}})});
let mode='off',dirty=false,approved=0;
const server=await startPeopleSoftMcpServer(workspace,{port:39514,writeHost:()=>({mode:()=>mode,hasUnsavedEditor:()=>dirty,saved(){},confirm:async()=>{approved++;return true;}})});
let id=0;
async function rpc(method:string,params:unknown){
  const response=await fetch(server.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  const body=await response.text();
  const value=JSON.parse(body.startsWith('{')?body:body.split('\n').find(line=>line.startsWith('data:'))!.slice(5));
  if(value.error)throw new Error(JSON.stringify(value.error));
  return value.result;
}
async function tool(name:string,args:unknown){return rpc('tools/call',{name,arguments:{connection:'HRDMO-IB-API',...args as object}});}

const checks:string[]=[];const names:Record<string,string[]>={};
const stamp=String(Date.now()).slice(-7),name=(s:string)=>'ZZ_IB_API_'+stamp+'_'+s;
async function call(toolName:string,args:unknown){const r=await tool(toolName,args);assert.ok(!r.isError,r.content?.[0]?.text);return JSON.parse(r.content[0].text);}
try{
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ib-e2e',version:'1'}});await workspace.connect(workspace.connections[0]);mode='allow';
 const cases=[['service',[name('S')],{serviceKind:'standard'}],['service',[name('R')],{serviceKind:'rest',restRole:'provider'}],['service',[name('C')],{serviceKind:'rest',restRole:'consumer'}],['message',[name('M')],{}],['node',[name('N')],{}],['document',[name('P'),'Payload','V1'],{}],['operation',[name('O')],{service:name('S'),operationType:'S'}],['operation',[name('G')],{service:name('R'),method:'GET'}],['operation',[name('E')],{service:name('C'),method:'GET'}],['routing',[name('T'),'1900-01-01'],{}]] as const;
 for(const [kind,key,options] of cases){
  let {input}=await call('psft_ib_new',{kind,key, ...options});
  input.properties.DESCR='IB MCP verification';
  if(kind==='message')input.sections.versions[0].IB_ROOTELEMENT='Payload';
  if(kind==='node'){input.properties.USERID='JARED';input.properties.ACTIVE_NODE='0';}
  if(kind==='operation'){if((options as any).method){input.properties.IB_RESTBASE_URL='http://example.invalid/rest';input.sections.uriTemplates=[{IB_URI_SEQ:1,IBTRANSACTIONID:' ',IB_RESERVED:0,PTIBURLPARAMNAME:' ',IB_URI_TEMPLATE:'payload'}];}input.sections.versions[0].ACTIVE_FLAG='I';for(const p of input.sections.parameters){if(p.MSGNAME!=='IB_REST_STUB'){p.MSGNAME=name('M');p.IB_MSGVERSION='V1';}}}
  if(kind==='routing'){Object.assign(input.properties,{IB_OPERATIONNAME:name('O'),VERSIONNAME:'v1',SENDERNODENAME:name('N'),RECEIVERNODENAME:'PSFT_HR',EFF_STATUS:'I'});}
  const preview=await call('psft_ib_create',{input,dryRun:true});assert.equal(preview.saved,false);
  const made=await call('psft_ib_create',{input});assert.equal(made.saved,true);names[kind+(options as any).serviceKind+((options as any).restRole??'')+((options as any).method??'')]=[...input.key];
  // A REST operation is created as <name>_<METHOD>, as PIA names it.
  const got=await call('psft_ib_get',{kind,key:input.key});assert.equal(got.properties.DESCR.trim(),'IB MCP verification');
  got.input.properties.DESCR='IB MCP edited';
  const saved=await call('psft_ib_save',{input:got.input,expectedToken:got.token});assert.equal(saved.saved,true);
  const stale=await tool('psft_ib_save',{input:got.input,expectedToken:got.token});assert.ok(stale.isError);
  const now=await call('psft_ib_get',{kind,key:input.key});
  const noop=await call('psft_ib_save',{input:now.input,expectedToken:now.token});assert.equal(noop.saved,false);
  checks.push(kind+' create/preview/read/edit/stale/no-op');console.log('PASS '+checks.at(-1));
 }
 const target=await call('psft_ib_get',{kind:'service',key:[name('S')]});target.input.properties.DESCR='Gate test';mode='off';assert.ok((await tool('psft_ib_save',{input:target.input,expectedToken:target.token})).isError);mode='allow';dirty=true;assert.ok((await tool('psft_ib_save',{input:target.input,expectedToken:target.token})).isError);dirty=false;checks.push('off and unsaved editor gates');
 writeFileSync('tools/lab/results/ib-write-e2e.json',JSON.stringify({database:'HRDMO',checks,names},null,2)+'\n');
}finally{await server.dispose();await workspace.dispose();}
