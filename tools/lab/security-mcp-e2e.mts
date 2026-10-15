/** Production MCP routing against the fresh custom administration smoke entries. */
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
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
settings.set('peoplesoft.connections',[{name:'HRDMO-SECURITY-API',kind:'oracle',connectString:'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID,peoplecodeAccess:'writable',peoplesoftOperatorId:process.env.PSLAB_OPRID??'JARED'}]);
const workspace=new Workspace({get:async()=>process.env.PSLAB_ACCESSPSWD,store:async()=>{},delete:async()=>{},onDidChange:()=>({dispose(){}})});
let mode='off',dirty=false,approved=0;
const server=await startPeopleSoftMcpServer(workspace,{port:39515,writeHost:()=>({mode:()=>mode,hasUnsavedEditor:()=>dirty,saved(){},confirm:async()=>{approved++;return true;}})});
let id=0;
async function rpc(method:string,params:unknown){
  const response=await fetch(server.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  const body=await response.text();
  const value=JSON.parse(body.startsWith('{')?body:body.split('\n').find(line=>line.startsWith('data:'))!.slice(5));
  if(value.error)throw new Error(JSON.stringify(value.error));
  return value.result;
}
async function tool(name:string,args:unknown){return rpc('tools/call',{name,arguments:{connection:'HRDMO-SECURITY-API',...args as object}});}
const checks:string[]=[];
const check=(name:string)=>{checks.push(name);console.log('PASS '+name);};
try {
  await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'security-e2e',version:'1'}});
  await workspace.connect(workspace.connections[0]);
  const tools=await rpc('tools/list',{});
  for(const name of ['psft_security_list','psft_security_get','psft_security_reference','psft_oauth_save'])assert.ok(tools.tools.some((t:any)=>t.name===name));
  check('security tools advertised by production HTTP MCP server');
  const invoke=async(name:string,args:unknown)=>{const r=await tool(name,args);assert.ok(!r.isError,r.content?.[0]?.text);return JSON.parse(r.content[0].text);};
  assert.ok((await invoke('psft_security_list',{kind:'oauth',query:'ZZ_STUDIO_OAUTH_01'})).items.length);check('OAuth search');
  const key=['ZZ_STUDIO_OAUTH_01','CU'];
  const before=(await invoke('psft_security_get',{kind:'oauth',key})).document;
  assert.ok(!JSON.stringify(before).includes('PTCLIENT_SECRET'));check('public configuration without secret fields');
  const args={key,expectedToken:before.token,changes:{PTSCOPE_URL:'studio.mcp.verified'}};
  assert.ok((await tool('psft_oauth_save',args)).isError);check('MCP off gate');
  mode='confirm';dirty=true;
  assert.ok((await tool('psft_oauth_save',args)).isError);check('unsaved editor gate');dirty=false;
  const preview=await invoke('psft_oauth_save',{...args,dryRun:true});assert.equal(preview.saved,false);assert.equal(approved,0);check('preview rolls back without approval');
  assert.equal((await invoke('psft_security_get',{kind:'oauth',key})).document.token,before.token);
  const saved=await invoke('psft_oauth_save',args);assert.equal(saved.saved,true);assert.equal(approved,1);check('confirmed write and committed readback');
  assert.ok((await tool('psft_oauth_save',args)).isError);check('stale-token write refused');
  await invoke('psft_oauth_save',{key,expectedToken:saved.document.token,changes:{PTSCOPE_URL:before.properties.PTSCOPE_URL}});check('fixture public configuration restored');
  assert.ok((await invoke('psft_security_reference',{})).choices.length);check('reference returns installed code labels');
  await invoke('psft_security_list',{kind:'saml'});check('legacy inbound SAML search');
  writeFileSync('tools/lab/results/security-mcp-e2e.json',JSON.stringify({database:'HRDMO',checks},null,2)+'\n');
} finally { await server.dispose(); await workspace.dispose(); }
