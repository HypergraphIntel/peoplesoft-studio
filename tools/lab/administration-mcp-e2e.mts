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
const {inputForAdminDocument}=require('./src/model/administration.ts');
const result=JSON.parse(readFileSync('tools/lab/results/administration-e2e.json','utf8'));
assert.equal(result.database,'HRDMO');
assert.match(result.entries.url,/^ZZ_ADMIN_\d{5}$/);
assert.ok(result.entries.messageSet>=30000 && result.entries.messageSet<=32767);
settings.set('peoplesoft.connections',[{name:'HRDMO-ADMIN-API',kind:'oracle',connectString:'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID,peoplecodeAccess:'writable',peoplesoftOperatorId:process.env.PSLAB_OPRID??'JARED'}]);
const workspace=new Workspace({get:async()=>process.env.PSLAB_ACCESSPSWD,store:async()=>{},delete:async()=>{},onDidChange:()=>({dispose(){}})});
let mode='off',dirty=false,approved=0;
const server=await startPeopleSoftMcpServer(workspace,{port:39512,writeHost:()=>({mode:()=>mode,hasUnsavedEditor:()=>dirty,saved(){},confirm:async()=>{approved++;return true;}})});
let id=0;
async function rpc(method:string,params:unknown){
  const response=await fetch(server.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  const body=await response.text();
  const value=JSON.parse(body.startsWith('{')?body:body.split('\n').find(line=>line.startsWith('data:'))!.slice(5));
  if(value.error)throw new Error(JSON.stringify(value.error));
  return value.result;
}
async function tool(name:string,args:unknown){return rpc('tools/call',{name,arguments:{connection:'HRDMO-ADMIN-API',...args as object}});}
const checks:string[]=[];
const check=(name:string)=>{checks.push(name);console.log('PASS '+name);};
try{
  await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'administration-e2e',version:'1'}});
  await workspace.connect(workspace.connections[0]);
  const tools=await rpc('tools/list',{});
  for(const name of ['psft_admin_list','psft_admin_get','psft_admin_save'])assert.ok(tools.tools.some((t:any)=>t.name===name));
  check('administration tools advertised by production MCP server');
  for(const [kind,query] of [['message',String(result.entries.messageSet)],['url',result.entries.url],['text',result.entries.text]]){
    const listed=await tool('psft_admin_list',{kind,query});
    assert.ok(!listed.isError,listed.content?.[0]?.text);
    assert.ok(JSON.parse(listed.content[0].text).items.length);check(kind+' list through MCP');
  }
  const response=await tool('psft_admin_get',{kind:'url',key:[result.entries.url]});
  assert.ok(!response.isError,response.content?.[0]?.text);
  const doc=JSON.parse(response.content[0].text);
  check('URL get returns exact concurrency token');
  const input={...inputForAdminDocument(doc),comments:'Verified through the production MCP administration tool.'};
  const args={kind:'url',input,expectedToken:doc.token};
  const off=await tool('psft_admin_save',args);assert.ok(off.isError);check('MCP off gate blocks write');
  mode='confirm';dirty=true;
  const unsaved=await tool('psft_admin_save',args);assert.ok(unsaved.isError);check('unsaved editor gate blocks write');
  dirty=false;
  const saved=await tool('psft_admin_save',args);
  assert.ok(!saved.isError,saved.content?.[0]?.text);
  assert.equal(JSON.parse(saved.content[0].text).saved,true);assert.equal(approved,1);check('MCP save confirms, writes and verifies');
  const stale=await tool('psft_admin_save',args);assert.ok(stale.isError);check('MCP stale token rejected');
  writeFileSync('tools/lab/results/administration-mcp-e2e.json',JSON.stringify({database:'HRDMO',checks,entries:result.entries},null,2)+'\n');
}finally{await server.dispose();await workspace.dispose();}
