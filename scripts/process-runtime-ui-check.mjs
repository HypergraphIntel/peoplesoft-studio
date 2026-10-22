import {chromiumExecutable} from './chromium.mjs';
import {pathToFileURL} from 'node:url';
/** Actual runtime webview in Chromium with a fixture host. No native execution claim. */
import {buildSync} from 'esbuild';import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),directory=mkdtempSync(path.join(os.tmpdir(),'psft-runtime-ui-'));
try{
 buildSync({entryPoints:['src/processRuntime/html.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(directory,'html.cjs'),logLevel:'silent'});
 const {processRuntimeHtml}=require(path.join(directory,'html.cjs'));
 let html=processRuntimeHtml(),nonce=/<script nonce="([^"]+)"/.exec(html)[1];
 const mock=`<style nonce="${nonce}">:root{--vscode-editor-background:#1f1f1f;--vscode-editor-foreground:#ddd;--vscode-panel-border:#454545;--vscode-input-background:#292929;--vscode-input-foreground:#eee;--vscode-descriptionForeground:#aaa;--vscode-button-background:#007acc;--vscode-button-foreground:white;--vscode-focusBorder:#007acc;--vscode-font-family:Arial}</style><script nonce="${nonce}">window.messages=[];let saved;window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m),getState:()=>saved,setState:s=>saved=s});</script>`;
 const run=`<script nonce="${nonce}">
try{
const check=(ok,name)=>{if(!ok)throw Error(name)},p={id:'request',operator:'JARED',request:{process:'ZZ_RUNTIME',runControl:'ONCE',server:'PSUNX'},state:'PREPARED',confirmationHash:'exact-rendered-hash',expires:new Date(Date.now()+300000).toISOString()},s={type:'state',environment:'Fixture — no native execution',operator:'JARED',configured:true,canSubmit:true,processes:['ZZ_RUNTIME'],servers:['PSUNX'],runControls:[{id:'ONCE',aeProgram:'ZZ_RUNTIME'},{id:'OTHER',aeProgram:'OTHER'}],requests:[],initialProcess:'ZZ_RUNTIME'};
const state=v=>window.dispatchEvent(new MessageEvent('message',{data:{...s,...v}}));state({});
check(document.getElementById('process').value==='ZZ_RUNTIME','initial process');
document.getElementById('runControl').value='ONCE';document.getElementById('server').value='PSUNX';document.getElementById('run').requestSubmit();
check(messages.at(-1).type==='prepare'&&messages.at(-1).request.runControl==='ONCE','prepare values');
state({requests:[p],selected:p.id});const submit=document.querySelector('[data-submit]');check(submit.dataset.hash===p.confirmationHash,'rendered hash');
check(document.getElementById('runControl').value==='ONCE','draft survived state update');check(!document.getElementById('controls').innerHTML.includes('OTHER'),'other generic AE control filtered');
const before=messages.length;submit.click();submit.click();check(messages.length===before+1,'duplicate click blocked');check(messages.at(-1).id===p.id&&messages.at(-1).confirmationHash===p.confirmationHash,'exact submit message');
state({canSubmit:false,requests:[]});check(document.getElementById('prepare').disabled,'monitor only');
state({requests:[{...p,state:'UNCERTAIN',error:'Check native matches'}],selected:p.id});check(!document.querySelector('[data-submit]')&&document.querySelector('[data-find]'),'uncertain cannot resubmit');
state({requests:[{...p,state:'SUBMITTED',instance:42,run:{runStatus:'Error',distributionStatus:'Not Posted',started:'fixture',ended:'fixture'}}],selected:p.id,files:[{id:'file',name:'<img src=x onerror=alert(1)>.out',description:'Fixture output'}]});check(!document.querySelector('img'),'escaped file name');check(document.body.textContent.includes('Not Posted'),'failure distribution');
document.querySelector('[data-file][data-action=download]').click();check(messages.at(-1).type==='download'&&messages.at(-1).file==='file','download identity');
state({requests:[{...p,state:'SUBMITTED',instance:42,run:{runStatus:'Success',distributionStatus:'Posted',started:'fixture',ended:'fixture'}}],selected:p.id,files:[{id:'file',name:'runtime.csv',description:'Fixture CSV'}]});
window.dispatchEvent(new MessageEvent('message',{data:{type:'selectProcess',process:'OTHER'}}));check(document.getElementById('process').value==='OTHER'&&document.getElementById('runControl').value==='','editor entry point selects new process');window.dispatchEvent(new MessageEvent('message',{data:{type:'selectProcess',process:'ZZ_RUNTIME'}}));document.body.dataset.browserResult='passed';
}catch(e){document.body.dataset.browserResult='failed: '+e.message}
</script>`;
 html=html.replace('<script nonce="'+nonce+'">',mock+'<script nonce="'+nonce+'">').replace('</body>',run+'</body>');
 const file=path.join(directory,'runtime.html');writeFileSync(file,html);mkdirSync('tools/lab/results',{recursive:true});
 const {stdout}=await promisify(execFile)(await chromiumExecutable(),['--headless','--disable-crash-reporter','--no-sandbox','--disable-gpu','--no-first-run','--disable-background-networking','--user-data-dir='+path.join(directory,'chromium'),'--window-size=1400,1050','--screenshot='+path.resolve('tools/lab/results/process-runtime-ui-fixture.png'),'--dump-dom',pathToFileURL(file).href],{timeout:30000,maxBuffer:2e6});
 assert.match(stdout,/data-browser-result="passed"/);console.log('PASS rendered runtime form, exact confirmation, duplicate clicks, retained draft, control filter, monitoring-only, uncertain recovery, failure statuses, escaped reports and download identity');
}finally{rmSync(directory,{recursive:true,force:true,maxRetries:6,retryDelay:100});}
