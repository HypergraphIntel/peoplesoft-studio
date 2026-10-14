/** Production MCP portal and administration discovery/write integration gate. */
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
const {portalInputForDocument}=require('./src/model/portalDocument.ts');
const result=JSON.parse(readFileSync('tools/lab/results/portal-e2e.json','utf8'));
assert.equal(result.database,'HRDMO');
settings.set('peoplesoft.connections',[{name:'HRDMO-PORTAL-API',kind:'oracle',connectString:'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID,peoplecodeAccess:'writable',peoplesoftOperatorId:process.env.PSLAB_OPRID??'JARED'}]);
const workspace=new Workspace({get:async()=>process.env.PSLAB_ACCESSPSWD,store:async()=>{},delete:async()=>{},onDidChange:()=>({dispose(){}})});
let mode='off',dirty=false,approved=0;
const server=await startPeopleSoftMcpServer(workspace,{port:39513,writeHost:()=>({mode:()=>mode,hasUnsavedEditor:()=>dirty,saved(){},confirm:async()=>{approved++;return true;}})});
let id=0;
async function rpc(method:string,params:unknown){
  const response=await fetch(server.url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  const body=await response.text();
  const value=JSON.parse(body.startsWith('{')?body:body.split('\n').find(line=>line.startsWith('data:'))!.slice(5));
  if(value.error)throw new Error(JSON.stringify(value.error));
  return value.result;
}
async function tool(name:string,args:unknown){return rpc('tools/call',{name,arguments:{connection:'HRDMO-PORTAL-API',...args as object}});}
const checks:string[]=[];
const check=(name:string)=>{checks.push(name);console.log('PASS '+name);};
try{
  await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'administration-e2e',version:'1'}});
  await workspace.connect(workspace.connections[0]);
  const tools=await rpc('tools/list',{});
  for(const name of ['psft_admin_list','psft_admin_get','psft_admin_save','psft_admin_choices','psft_admin_reference','psft_portal_list','psft_portal_structure','psft_portal_get','psft_portal_create_folder','psft_portal_create_content_reference','psft_portal_edit'])assert.ok(tools.tools.some((t:any)=>t.name===name),name);
  check('portal and administration tools advertised by production server');
  const get=async(name:string,args:unknown)=>{const r=await tool(name,args);assert.ok(!r.isError,r.content?.[0]?.text);return JSON.parse(r.content[0].text);};
  assert.ok((await get('psft_portal_list',{})).portals.some((p:any)=>p.value==='EMPLOYEE'));check('portal entry point lists installed portals');
  const tree=await get('psft_portal_structure',{portal:'EMPLOYEE'});assert.ok(tree.nodes.some((n:any)=>n.PORTAL_OBJNAME===result.entries.folder));check('structure returns portal-scoped tree nodes');
  const doc=await get('psft_portal_get',{portal:'EMPLOYEE',refType:'C',name:result.entries.external});
  const args={input:{...doc.input,description:'Verified through production MCP'},expectedToken:doc.token};
  assert.ok((await tool('psft_portal_edit',args)).isError);check('MCP off gate blocks registry write');
  mode='confirm';dirty=true;assert.ok((await tool('psft_portal_edit',args)).isError);check('unsaved editor gate blocks registry write');dirty=false;
  const dry=await get('psft_portal_edit',{...args,dryRun:true});assert.equal(dry.saved,false);assert.equal(approved,0);check('MCP dry run validates and rolls back without approval');
  const saved=await get('psft_portal_edit',args);assert.equal(saved.saved,true);assert.equal(approved,1);check('MCP edit confirms and verifies saved registry entry');
  assert.ok((await tool('psft_portal_edit',args)).isError);check('MCP stale token rejected');
  const seed=String(Date.now()%100000).padStart(5,'0');
  const folder={portal:'EMPLOYEE',name:'ZZ_PORTAL_MF_'+seed,parent:result.entries.folder,label:'MCP Folder',sequence:1};
  const created=await get('psft_portal_create_folder',{input:folder});assert.equal(created.saved,true);check('dedicated MCP create-folder route');
  const cref={...folder,name:'ZZ_PORTAL_MC_'+seed,parent:folder.name,label:'MCP Reference',target:{type:'external',url:'https://example.invalid/mcp'}};
  const made=await get('psft_portal_create_content_reference',{input:cref});assert.equal(made.saved,true);check('dedicated MCP create-content-reference route');
  const admin=JSON.parse(readFileSync('tools/lab/results/administration-e2e.json','utf8'));
  for(const [kind,query] of [['message',String(admin.entries.messageSet)],['url',admin.entries.url],['text',admin.entries.text]]) {
    const list=await get('psft_admin_list',{kind,query});assert.ok(list.items.length);
    const key=kind==='message'?[String(admin.entries.messageSet),'1']:kind==='url'?[admin.entries.url]:list.items.find((x:any)=>x.key[2]===admin.entries.text).key;
    const entry=await get('psft_admin_get',{kind,key});assert.ok(entry.input);assert.ok(entry.token);check(kind+' catalog list/get return machine-editable input and token');
    const written=await get('psft_admin_save',{kind,input:entry.input,expectedToken:entry.token});assert.equal(written.saved,true);check(kind+' catalog save through typed MCP schema');
  }
  assert.ok((await get('psft_admin_choices',{})).languages.length);check('Text Catalog configuration and language choices');
  const reference=await get('psft_admin_reference',{});for(const kind of ['message','text','url'])assert.ok(reference[kind]);check('MCP reference explains all three catalogs');
  writeFileSync('tools/lab/results/portal-mcp-e2e.json',JSON.stringify({database:'HRDMO',checks,entries:{folder:folder.name,cref:cref.name}},null,2)+'\n');
}finally{await server.dispose();await workspace.dispose();}
