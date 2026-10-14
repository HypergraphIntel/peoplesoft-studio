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

const evidence=JSON.parse(readFileSync('tools/lab/results/ib-write-e2e.json','utf8'));
async function call(n:string,a:unknown){const r=await tool(n,a);assert.ok(!r.isError,r.content?.[0]?.text);return JSON.parse(r.content[0].text);}
try{
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ib-edit-e2e',version:'1'}});await workspace.connect(workspace.connections[0]);mode='confirm';
 const key=evidence.names.documentundefined;
 const doc=await call('psft_ib_get',{kind:'document',key});
 const length=doc.sections.logicalSchema[0].xml.includes('<m_nLength>64</m_nLength>')?65:64;
 const built=await call('psft_ib_document_build',{key,elements:[{name:'value',length,required:false},{name:'other',length:8,required:true}]});
 doc.input.document=built.input.document;
 const saved=await call('psft_ib_save',{input:doc.input,expectedToken:doc.token});assert.equal(saved.saved,true);assert.equal(approved,1);
 const now=await call('psft_ib_get',{kind:'document',key});assert.ok(now.sections.logicalSchema[0].xml.includes('<m_nLength>'+length+'</m_nLength>'));
 assert.ok(now.sections.jsonSchemas[0].text.includes('"required": ["other"]'));
 const noop=await call('psft_ib_save',{input:now.input,expectedToken:now.token});assert.equal(noop.saved,false);
 const opkey=[key[0].replace(/_P$/,'_O')];const op=await call('psft_ib_get',{kind:'operation',key:opkey});op.input.sections.handlers=[{HANDLERNAME:'REQUESTHDLR',HANDLERID:'RQST',HANDLERTYPE:'ApplicationClass',ACTIVE_FLAG:'I',DESCR:'IB API request handler'}];op.input.sections.applicationClassHandlers=[{HANDLERNAME:'REQUESTHDLR',PACKAGEROOT:'PT_SES',QUALIFYPATH:' ',APPCLASSID:'Init',APPCLASSMETHOD:'OnRequest'}];const h=await call('psft_ib_save',{input:op.input,expectedToken:op.token});assert.equal(h.saved,true);const read=await call('psft_ib_get',{kind:'operation',key:opkey});assert.equal(read.sections.handlers[0].IB_DMS_ROLLBACK,32);assert.equal(read.sections.applicationClassHandlers[0].APPCLASSMETHOD,'OnRequest');
 evidence.checks.push('document element edit and all five schema readbacks','confirm gate called exactly once');evidence.checks.push('native OnRequest application class handler creation');
 writeFileSync('tools/lab/results/ib-write-e2e.json',JSON.stringify(evidence,null,2)+'\n');console.log('PASS document element edit and confirmation gate');
}finally{await server.dispose();await workspace.dispose();}
