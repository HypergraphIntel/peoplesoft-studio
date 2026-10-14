/* HRDMO-only authoring test. Creates fresh custom definitions; keeps them for native verification. No deletion or AE execution. */
import Module, { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const { createStub } = await import(pathToFileURL(join(root, 'scripts', 'vscode-stub.mjs')).href);
const { vscode, settings } = createStub();
const original = (Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'vscode') return vscode;
  return original.call(this, request, parent, isMain);
};
const require = createRequire(join(root, 'package.json'));

const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
settings.set('peoplesoft.customization.agentDeliveredObjectPolicy','requireApproval');
settings.set('peoplesoft.customization.namingPrefixes',[]);
settings.set('peoplesoft.connections', [{
  name: 'HRDMO-E2E', kind: 'oracle', connectString, user: process.env.PSLAB_ACCESSID, peoplecodeAccess: 'writable',
  peoplesoftOperatorId: process.env.PSLAB_OPERATOR ?? 'JARED'
}]);
const secrets = new Map([['peoplesoft.password.HRDMO-E2E', process.env.PSLAB_ACCESSPSWD]]);
const fs=await import('node:fs/promises');
const storagePath=process.env.PSLAB_MCP_STORAGE??'/tmp/psft-mcp-release-receipts';
vscode.workspace.fs={readFile:async(u:any)=>{try{return await fs.readFile(u.fsPath);}catch(e){(e as any).code='FileNotFound';throw e;}},
 writeFile:(u:any,b:Uint8Array)=>fs.writeFile(u.fsPath,b),createDirectory:(u:any)=>fs.mkdir(u.fsPath,{recursive:true}),
 readDirectory:async(u:any)=>(await fs.readdir(u.fsPath,{withFileTypes:true})).map(d=>[d.name,d.isDirectory()?2:1]),
 stat:async(u:any)=>{const s=await fs.stat(u.fsPath);return {mtime:s.mtimeMs,size:s.size};}};
const ownershipApprovals:string[]=[];
vscode.window.showWarningMessage=async(title:string)=>{ownershipApprovals.push(title);throw new Error('Unexpected ownership approval: '+title);};
const {installCustomizationGuard}=require('./src/customizationGuard.ts');
const guardContext={globalStorageUri:vscode.Uri.file(storagePath),subscriptions:[] as any[]};
const { Workspace } = require('./src/workspace.ts');
const { startPeopleSoftMcpServer } = require('./src/mcp/server.ts');
const workspace = new Workspace({ get: async (k: string) => secrets.get(k), store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose() {} }) });
installCustomizationGuard(guardContext,workspace);
const approvals: string[] = [];
const port = Number(process.env.PSLAB_MCP_PORT??39491);
const server = await startPeopleSoftMcpServer(workspace, {
  port,
  writeHost: () => ({
    mode: () => 'allow', confirm: async ({ title }: { title: string }) => { approvals.push(title); return true; },
    hasUnsavedEditor: () => false, saved: () => {}
  })
});

let id = 0;
async function rpc(method: string, params: unknown): Promise<unknown> {
  const res = await fetch(server.url, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
  });
  const text = await res.text();
  const data = text.startsWith('{') ? JSON.parse(text) : JSON.parse(text.split('\n').find((l) => l.startsWith('data:'))!.slice(5));
  if (data.error) throw new Error(`${method}: ${JSON.stringify(data.error)}`);
  return data.result;
}
async function tool(name: string, args: Record<string, unknown>): Promise<any> {
  const r = await rpc('tools/call', { name, arguments: { connection: 'HRDMO-E2E', ...args } }) as { content: { text: string }[]; isError?: boolean };
  const text = r.content.map((c) => c.text).join('\n');
  if (r.isError) return { error: text };
  try { return JSON.parse(text); } catch { return text; }
}


const db=require('oracledb');
const guard=await db.getConnection({user:process.env.PSLAB_ACCESSID,password:process.env.PSLAB_ACCESSPSWD,connectString});
try{const [r]=(await guard.execute("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS N FROM DUAL",{}, {outFormat:db.OUT_FORMAT_OBJECT})).rows;if(r.N!=='HRDMO')throw new Error('HRDMO only.');}finally{await guard.close();}
const seed=process.env.PSLAB_MCP_SEED??String(Date.now()%100000).padStart(5,'0');
if(!/^\d{5}$/.test(seed))throw new Error('Seed must have five digits.');
const names={text:'ZZ_M_TEXT'+seed,flag:'ZZ_M_FLAG'+seed,state:'ZZ_M_'+seed+'AET',stage:'ZZ_M_S'+seed,program:'ZZ_M88_'+seed,project:'ZZ_MCP_88_'+seed};
const checks:Array<{name:string;ok:boolean;detail:unknown}>=[];
const check=(name:string,ok:boolean,detail:unknown='')=>{checks.push({name,ok,detail});console.log(JSON.stringify({name,ok,detail}));};
const call=async(name:string,args:any)=>{const r=await tool(name,args);const ok=name==='psft_ae_verify'?r.matches===true:args.dryRun?r.saved===false && r.reason==='dry run' && r.validation?.errors?.length===0:r.saved===true;check(name,ok,r.error??r.validation??r.saved??r.matches??'returned');return r;};
const basePc='Local string &s = "ok";\n';
const spec={program:names.program,description:'MCP release verification',disableRestart:true,
 stateRecords:[{record:names.state,default:true}],sections:[{name:'MAIN',steps:[
 {name:'Init',actions:[{type:'PeopleCode',peopleCode:basePc}]},
 {name:'Sql',actions:[{type:'SQL',sql:`%Select(${names.flag}) SELECT 'Y' FROM PS_INSTALLATION`,noRows:'Continue',reuse:'Yes'}]},
 {name:'Call',actions:[{type:'Call Section',section:'DONE'}]}]},
 {name:'DONE',public:true,steps:[{name:'Log',actions:[{type:'Log Message',messageSet:1,messageNumber:1,parameters:'%Bind(PROCESS_INSTANCE)'}]}]}]};
try{
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'release-88-e2e',version:'1'}});
 await workspace.connect(workspace.connections[0]);
 const list=await rpc('tools/list',{}) as any;check('record creation is advertised',list.tools.some((t:any)=>t.name==='psft_create_record'));
 await call('psft_create_field',{name:names.text,type:'character',length:10,format:'mixedCase',longName:'Mixed text',shortName:'Text'});
 await call('psft_edit_field',{name:names.text,format:'uppercase'});
 await call('psft_edit_field',{name:names.text,format:'mixedCase'});
 await call('psft_create_field',{name:names.flag,type:'character',length:1,longName:'Flag',shortName:'Flag'});
 await call('psft_edit_translate',{field:names.flag,action:'add',value:'Y',effectiveDate:'1900-01-01',longName:'Yes',shortName:'Yes'});
 await call('psft_create_record',{record:names.state,recordType:'derivedWork',operations:[{op:'insert_field',field:'PROCESS_INSTANCE'},{op:'insert_field',field:names.text},{op:'insert_field',field:names.flag},{op:'set_use',field:'PROCESS_INSTANCE',key:true}]});
 await call('psft_create_record',{record:names.stage,recordType:'sqlTable',operations:[{op:'insert_field',field:'PROCESS_INSTANCE'},{op:'insert_field',field:names.text},{op:'set_use',field:'PROCESS_INSTANCE',key:true},{op:'set_properties',description:'MCP custom staging record'}]});
 await call('psft_edit_record',{record:names.state,operations:[{op:'set_edits',field:names.flag,edit:'translate',required:true}]});
 const missing=await tool('psft_ae_create',{spec:{...spec,program:'ZZ_BAD_'+seed,stateRecords:[{record:'ZZ_MISSING_AET',default:true}]},dryRun:true});
 check('missing AET returns structured diagnostics',missing.saved===false && missing.validation?.errors?.some((s:string)=>s.includes('does not exist')),missing);
 await call('psft_ae_create',{spec,dryRun:true});
 await call('psft_ae_create',{spec});
 await call('psft_ae_verify',{spec});
 await call('psft_ae_edit',{program:names.program,operations:[{op:'set_program',description:'MCP edited program',batchOnly:true}]});
 // Saving a shared custom field must retain provenance of the new records whose VERSION it advances.
 await call('psft_edit_field',{name:names.text,length:12});
 await call('psft_edit_record',{record:names.stage,operations:[{op:'set_properties',description:'Stage after field resize'}]});
 const sources=[
   ["quotes and same-line statements","Local string &x; &x = 'Y';"],
   ["quoted apostrophe",`Local string &x = 'O''Brien';`],
   ["inline conditional",`If True Then ${names.state}.${names.flag} = 'Y'; Else ${names.state}.${names.flag} = 'N'; End-If;`],
   ["arithmetic loop",'Local number &i, &sum;\n&sum = 0;\nFor &i = 1 To 3\n   &sum = &sum + &i;\nEnd-For;\n'],
   ["function",'Function Echo(&value As string) Returns string;\n   Return &value;\nEnd-Function;\nLocal string &result = Echo("Y");\n'],
   ["SQLExec and conditional",'Local number &count = 0;\nSQLExec("SELECT 1 FROM DUAL", &count);\nIf &count > 0 Then\n   &count = &count + 1;\nEnd-If;\n']
 ];
 for(const [label,peopleCode] of sources){
   const r=await tool('psft_ae_edit',{program:names.program,operations:[{op:'set_action',section:'MAIN',step:'Init',type:'PeopleCode',peopleCode}]});
   check('PeopleCode '+label,r.saved===true,r.error??r.validation??r.verification);
 }
 const ops=[{op:'add_section',name:'LOOPS',type:'Critical Updates',public:true,autoCommit:true},
   {op:'add_step',section:'LOOPS',name:'Each',commitAfter:'After Step',frequency:10,onError:'Ignore',actions:[
    {type:'Do When',sql:'SELECT 1 FROM PS_INSTALLATION WHERE 1=0'},
    {type:'Do While',sql:'SELECT 1 FROM PS_INSTALLATION WHERE 1=0'},
    {type:'Do Select',sql:`%Select(${names.text}) SELECT ${names.text} FROM %Table(${names.stage})`,doSelectType:'Restartable'},
    {type:'PeopleCode',peopleCode:`If None(${names.state}.${names.text}) Then\n   Exit (1);\nEnd-If;\n`,onReturn:'Skip Step'},
    {type:'SQL',sql:`INSERT INTO %Table(${names.stage}) (PROCESS_INSTANCE, ${names.text}) VALUES (%Bind(PROCESS_INSTANCE), %Bind(${names.text}))`,reuse:'Bulk Insert',noRows:'Skip Step'},
    {type:'Log Message',messageSet:1,messageNumber:1,parameters:'%Bind(PROCESS_INSTANCE)'},
    {type:'Do Until',sql:'SELECT 1 FROM PS_INSTALLATION'}]},
   {op:'add_section',name:'ORACLE',public:true},
   {op:'set_section',section:'ORACLE',set:{market:'GBL',platform:'Oracle',effectiveDate:'2000-01-01',active:true}},
   {op:'add_step',section:'ORACLE',name:'Pc',actions:[{type:'PeopleCode',peopleCode:basePc}]},
   {op:'set_program',comments:'All action types except XSLT in a Standard program.',disableRestart:true,batchOnly:true,messageSet:1,useDeleteForTruncate:true}];
 const complex=await tool('psft_ae_edit',{program:names.program,operations:ops});check('all standard actions and Oracle variant save',complex.saved===true,complex.error??complex.validation??complex.verification);
 const invalid=await tool('psft_ae_edit',{program:names.program,operations:[{op:'add_action',section:'MAIN',step:'Sql',type:'Call Section',callSection:'DONE'}]});
 check('SQL plus Call Section refused',!!invalid.error||invalid.saved===false,invalid.error??invalid.validation);
 const library='ZZ_L88_'+seed;
 const libSpec={program:library,applicationLibrary:true,sections:[{name:'LIB',public:true,steps:[{name:'Pc',actions:[{type:'PeopleCode',peopleCode:basePc}]}]}]};
 const lib=await tool('psft_ae_create',{spec:libSpec});check('application library save',lib.saved===true,lib.error??lib.validation??lib.verification);
 const external=await tool('psft_ae_edit',{program:names.program,operations:[{op:'add_step',section:'MAIN',name:'LibCall',actions:[{type:'Call Section',section:'LIB',program:library}]}]});
 check('external Call Section save',external.saved===true,external.error??external.validation??external.verification);
 const transform='ZZ_X88_'+seed;
 const xspec={program:transform,programType:'Transform Only',sections:[{name:'MAIN',steps:[{name:'Map',actions:[{type:'XSLT',xslt:'<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:template match="/"><result/></xsl:template></xsl:stylesheet>',graphicalMapper:false}]}]}]};
 const x=await tool('psft_ae_create',{spec:xspec});check('Transform/XSLT save',x.saved===true,x.error??x.validation??x.verification);
 if(x.saved){const v=await tool('psft_ae_verify',{spec:xspec});check('Transform/XSLT verify',v.matches===true,v.differences??v.error);}
 const copy='ZZ_C88_'+seed;
 const copied=await tool('psft_ae_copy',{program:names.program,to:copy});check('complex copy',copied.saved===true,copied.error??copied.verification);
 if(copied.saved){const got=await tool('psft_ae_get',{program:copy});check('copy preserves sections and PeopleCode',got.spec?.sections?.length>=4,got.error??got.spec?.sections?.map((r:any)=>r.name));}
 const renamed='ZZ_R88_'+seed;
 if(copied.saved){
   const r=await tool('psft_ae_rename',{program:copy,to:renamed});check('rename copied program',r.renamed?.to===renamed,r.error??r.renamed);
   const edited=await tool('psft_ae_edit',{program:renamed,operations:[{op:'set_program',description:'Renamed editable copy'}]});check('renamed copy remains editable',edited.saved===true,edited.error??edited.validation);
 }
 await call('psft_create_project',{project:names.project});
 const items=[{type:2,parts:[names.text]},{type:2,parts:[names.flag]},{type:0,parts:[names.state]},{type:0,parts:[names.stage]},{type:33,parts:[names.program]},
 {type:34,parts:[names.program,'MAIN']},{type:34,parts:[names.program,'DONE']},{type:34,parts:[names.program,'LOOPS']},{type:34,parts:[names.program,'ORACLE']},{type:43,parts:[names.program,'ORACLE','GBL','Oracle','2000-01-01','Pc','OnExecute']},{type:43,parts:[names.program,'MAIN','GBL','default','1900-01-01','Init','OnExecute']}];
 await call('psft_add_to_project',{project:names.project,items});
 const provider=workspace.activeProviders[0];
 const members=await provider.listProjectItems(names.project);check('project members read back',members.length===items.length,members);
 check('no ownership approval for verified new definitions',ownershipApprovals.length===0,ownershipApprovals);
 const field=await provider.readField({type:2,parts:[names.text]});check('Mixed Case readback',field.format===6,field.format);
 const classify=await provider.classifyDefinition({type:2,parts:[names.text]},[]);check('creation receipt classifies Custom',classify.classification.ownership==='CUSTOM',classify.classification);
 console.log(JSON.stringify({nativeProgram:names.program,nativeField:names.text,names}));
 if(process.argv.includes('--hold')){console.log('Holding MCP for native calibration');await new Promise<void>(resolve=>process.once('SIGTERM',resolve));}
}finally{
 const report={database:'HRDMO',names,checks};await fs.writeFile('/tmp/psft-mcp-release-report.json',JSON.stringify(report,null,2));
 server.dispose();for(const d of guardContext.subscriptions)d.dispose();for(const p of workspace.activeProviders)await p.dispose();
}
process.exitCode=checks.some(c=>!c.ok)?1:0;
