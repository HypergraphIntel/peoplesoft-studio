/** Runs the same installed upgrade checks in the Windows lab; credentials enter through stdin only. */
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import os from 'node:os';
import path from 'node:path';
const exec=promisify(execFile),root=process.cwd();
let stdin='';for await(const chunk of process.stdin)stdin+=chunk;
const credentials=JSON.parse(stdin);stdin='';
const env={...process.env,PSLAB_ACCESSID:credentials.user,PSLAB_ACCESSPSWD:credentials.password};
credentials.password=undefined;
const scenario=credentials.scenario??'upgrade';if(!['upgrade','fresh'].includes(scenario))throw Error('Invalid qualification scenario');
const phases=scenario==='fresh'?['fresh']:['seed','upgrade','reload','final'];
for(const key of Object.keys(env))if(key.startsWith('VSCODE_')||key==='ELECTRON_RUN_AS_NODE')delete env[key];
const codeHome=path.join(process.env.LOCALAPPDATA,'Programs/Microsoft VS Code'),code=path.join(codeHome,'Code.exe');
const cliRelative=readFileSync(path.join(codeHome,'bin/code.cmd'),'utf8').match(/"%~dp0([^"]*cli\.js)"/i)?.[1];
if(!cliRelative)throw Error('Cannot locate VS Code CLI from its installed launcher');
const cli=path.resolve(codeHome,'bin',cliRelative);
const dir=mkdtempSync(path.join(os.tmpdir(),'psft-v1-upgrade-')),artifacts=path.join(root,'results');mkdirSync(artifacts,{recursive:true});
writeFileSync(path.join(artifacts,'location.txt'),dir);
const hash=f=>createHash('sha256').update(readFileSync(f)).digest('hex');
const candidate=path.join(root,'candidate.vsix'),old=path.join(root,'peoplesoft-studio-0.9.7.vsix');
const version=JSON.parse(readFileSync(path.join(root,'candidate-manifest.json'),'utf8')).version;
const user=path.join(dir,'user'),extensions=path.join(dir,'extensions'),workspace=path.join(dir,'workspace'),driver=path.join(extensions,'psft-tests.v1-qualification-driver-0.0.1'),seed=path.join(dir,'seed.json');
for(const p of [path.join(user,'User'),workspace,driver])mkdirSync(p,{recursive:true});
const port=async()=>{const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;};
const mcpPort=await port(),connection={name:'HRDMO 1.0 qualification',kind:'oracle',connectString:credentials.connectString,user:env.PSLAB_ACCESSID,peoplecodeAccess:'writable',peoplesoftOperatorId:'JARED'};
const settings=path.join(user,'User/settings.json');
writeFileSync(settings,JSON.stringify({'files.autoSave':'off','files.hotExit':'onExitAndWindowClose','window.restoreWindows':'all','workbench.startupEditor':'none','security.workspace.trust.enabled':false,'update.mode':'none','extensions.autoCheckUpdates':false,'extensions.autoUpdate':false,'chat.disableAIFeatures':true,'peoplesoft.connections':[connection],'peoplesoft.mcp.enabled':true,'peoplesoft.mcp.port':mcpPort,'peoplesoft.mcp.writes':'confirm','peoplesoft.writeNamePrefix':'ZZ_V1_','window.dialogStyle':'custom','peoplesoft.peoplecode.validateAsYouType':false}));
writeFileSync(path.join(driver,'package.json'),JSON.stringify({name:'v1-qualification-driver',publisher:'psft-tests',version:'0.0.1',engines:{vscode:'^1.90.0'},activationEvents:['onStartupFinished'],main:'./driver.cjs'}));
writeFileSync(path.join(driver,'driver.cjs'),`exports.activate=()=>{void require(${JSON.stringify(path.join(root,'tools/lab/release-1.0/installed-driver.cjs'))}).run().catch(e=>console.error(e)).finally(()=>require('vscode').commands.executeCommand('workbench.action.quit'))};`);
const name='ZZ_V1_'+randomBytes(5).toString('hex').toUpperCase(),results={at:new Date().toISOString(),platform:process.platform,scenario,scope:scenario==='fresh'?'Blank Windows VS Code profile; current unmodified candidate; real credential prompt, rendered SQL creation/draft/inverse and native readback':'Windows normal installed VS Code; published 0.9.7 upgrade; real SecretStorage and native HRDMO SQL writers through rendered review',name,phases:[],candidateSha256:hash(candidate),oldAssetSha256:scenario==='upgrade'?hash(old):undefined};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
for(const phase of phases){
 console.log('Starting '+phase+' in '+dir);const expectedVersion=phase==='seed'?'0.9.7':version;
 if((phase==='seed'||phase==='upgrade'||phase==='fresh'))await exec(code,[cli,'--install-extension',phase==='seed'?old:candidate,'--force','--extensions-dir',extensions,'--user-data-dir',user],{cwd:root,env:{...env,ELECTRON_RUN_AS_NODE:'1'},maxBuffer:2e6});
 const installed=path.join(extensions,readdirSync(extensions).find(n=>n.toLowerCase()==='jarednorris.peoplesoft-studio-'+expectedVersion));
 const manifestBytes=readFileSync(path.join(installed,'package.json')),bundleHash=hash(path.join(installed,'dist/extension.js')),workerHash=hash(path.join(installed,'dist/validateWorker.js'));
 const cdpPort=await port(),input=path.join(dir,phase+'-input.json'),result=path.join(dir,phase+'-result.json');
 writeFileSync(input,JSON.stringify({root,phase,seed,name,candidate:installed,expectedVersion,settings,connection,cdpUrl:'http://127.0.0.1:'+cdpPort,mcpUrl:'http://127.0.0.1:'+mcpPort+'/mcp',artifactDirectory:artifacts}));
 const log=await import('node:fs').then(m=>m.openSync(path.join(dir,phase+'-host.log'),'w'));
 const host=spawn(code,['--disable-gpu','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--new-window','--remote-debugging-port='+cdpPort,'--remote-debugging-address=127.0.0.1','--user-data-dir',user,'--extensions-dir',extensions,workspace],{cwd:root,env:{...env,PSFT_V1_INPUT:input,PSFT_V1_RESULT:result},stdio:['ignore',log,log]});
 let exited=false;host.once('exit',()=>exited=true);
 const start=Date.now();while(!existsSync(result)&&!exited&&Date.now()-start<600000)await delay(500);
 // The result precedes normal window shutdown; allow profile and backups to flush.
 await delay(6000);
 let r;try{r=JSON.parse(readFileSync(result,'utf8'));}catch{r={phase,passed:false,error:'Host ended without a result; private logs: '+dir};}
 r.integrity={manifestUnmodified:readFileSync(path.join(installed,'package.json')).equals(manifestBytes),bundleUnmodified:hash(path.join(installed,'dist/extension.js'))===bundleHash,workerUnmodified:hash(path.join(installed,'dist/validateWorker.js'))===workerHash};
 r.backups=existsSync(path.join(user,'Backups'))?readdirSync(path.join(user,'Backups'),{recursive:true}):[];
 r.passed&&=Object.values(r.integrity).every(Boolean);results.phases.push(r);results.passed=results.phases.length===phases.length&&results.phases.every(p=>p.passed);
 writeFileSync(path.join(artifacts,scenario==='fresh'?'windows-fresh-install.json':'windows-upgrade.json'),JSON.stringify(results,null,2)+'\n');
 if(!r.passed)throw Error('Installed '+phase+' failed: '+r.error);
}
console.log(JSON.stringify(results,null,2));
