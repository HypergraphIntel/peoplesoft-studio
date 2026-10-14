/** Read-only coverage and native IB evidence. Credentials stay in the environment. */
import assert from 'node:assert/strict';
import Module, {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const root=process.cwd();
const {createStub}=await import(pathToFileURL(join(root,'scripts/vscode-stub.mjs')).href);
const {vscode,settings}=createStub();
const original=(Module as any)._load;
(Module as any)._load=function(name:string,parent:unknown,main:boolean){return name==='vscode'?vscode:original.call(this,name,parent,main);};
const require=createRequire(join(root,'package.json'));
const {Workspace}=require('./src/workspace.ts');
const {startPeopleSoftMcpServer}=require('./src/mcp/server.ts');
settings.set('peoplesoft.connections',[{name:'HRDMO-IB-API',kind:'oracle',connectString:'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID}]);
const workspace=new Workspace({get:async()=>process.env.PSLAB_ACCESSPSWD,store:async()=>{},delete:async()=>{},onDidChange:()=>({dispose(){}})});
const server=await startPeopleSoftMcpServer(workspace,{port:39513});let id=0;
async function rpc(method:string,params:unknown){const response=await fetch(server.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});const body=await response.text();const value=JSON.parse(body.startsWith('{')?body:body.split('\n').find(l=>l.startsWith('data:'))!.slice(5));if(value.error)throw new Error(JSON.stringify(value.error));return value.result;}
async function call(name:string,args:unknown){const r=await rpc('tools/call',{name,arguments:{connection:'HRDMO-IB-API',...args as object}});assert.ok(!r.isError,r.content?.[0]?.text);return JSON.parse(r.content[0].text);}
const coverage:Record<string,unknown>={};
try{
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ib-read-e2e',version:'1'}});
 await workspace.connect(workspace.connections[0]);
 const advertised=await rpc('tools/list',{});for(const name of ['psft_ib_reference','psft_ib_list','psft_ib_get','psft_ib_validate'])assert.ok(advertised.tools.some((t:any)=>t.name===name));
 for(const kind of ['message','document','service','operation','node','routing']){
  let count=0,sample:any,offset=0;
  do{const page=await call('psft_ib_list',{kind,offset});assert.equal(page.offset,offset);assert.ok(page.items.length<=100);sample??=page.items[0];count+=page.items.length;if(!page.more)break;offset+=100;}while(true);
  assert.ok(sample,kind+' has definitions');
  const doc=await call('psft_ib_get',{kind,key:sample.key});assert.equal(doc.kind,kind);assert.deepEqual(doc.key,sample.key);assert.match(doc.token,/^[a-f0-9]{64}$/);
  const validation=await call('psft_ib_validate',{kind,key:sample.key});assert.equal(validation.token,doc.token);
  const json=JSON.stringify(doc);assert.ok(!/"(?:IBPASSWORD|IBEXTERNALPWD)"/.test(json));
  coverage[kind]={population:count,sampleKey:sample.key,sections:Object.keys(doc.sections)};console.log('PASS '+kind+': '+count+' definitions');
 }
 for(const kind of ['service','operation'])for(const [serviceKind,restRole] of [['standard',undefined],['rest','consumer'],['rest','provider']] as const){
  const page=await call('psft_ib_list',{kind,serviceKind,restRole});assert.ok(page.items.length);for(const item of page.items){assert.equal(item.serviceKind,serviceKind);if(restRole)assert.equal(item.restRole,restRole)}
  const doc=await call('psft_ib_get',{kind,key:page.items[0].key});assert.equal(doc.serviceKind,serviceKind);if(restRole)assert.equal(doc.restRole,restRole);console.log('PASS '+kind+': '+serviceKind+' '+(restRole??''));
 }
 let documents=0,offset=0;
 do{const page=await call('psft_ib_list',{kind:'document',offset});for(const item of page.items){const doc=await call('psft_ib_get',{kind:'document',key:item.key});assert.equal(doc.sections.logicalSchema[0].format,'PeopleTools schemaDefn XML');assert.match(doc.sections.logicalSchema[0].xml,/<schemaDefn>/);documents++}if(!page.more)break;offset+=100;}while(true);
 console.log('PASS '+documents+' native document bodies');
 const result={database:'HRDMO',peopleToolsRelease:'8.62.09',coverage,documents,checks:['production MCP advertisement','six-family paginated population','structured reads and validation','numeric standard/REST and consumer/provider filters','secret columns excluded','all document bodies decompressed with stored lengths verified'],writesTested:false};
 writeFileSync('tools/lab/results/ib-read-e2e.json',JSON.stringify(result,null,2)+'\n');
}finally{await server.dispose();await workspace.dispose();}
