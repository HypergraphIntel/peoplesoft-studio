/** Actual installed MCP and rendered approvals; all Process creates deliberately target an existing lab definition. */
import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const info=JSON.parse(await readFile('/tmp/psft-build-handoff-window.json','utf8'));
const ui=await createRequire(import.meta.url)('../../../scripts/peoplecode-editor-cdp.cjs').connectWorkbench(info.cdpUrl);
let seq=0;
async function rpc(method,params){const response=await fetch(info.mcpUrl,{method:'POST',signal:AbortSignal.timeout(75000),headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params})});const s=await response.text(),r=JSON.parse(s.startsWith('{')?s:s.split('\n').find(l=>l.startsWith('data:')).slice(5));assert.ok(!r.error,JSON.stringify(r.error));return r.result;}
async function call(name,args){return rpc('tools/call',{name,arguments:args});}
const data=r=>{assert.ok(!r.isError,r.content?.[0]?.text);return JSON.parse(r.content[0].text);};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const page=()=>ui.webviewAction('Requests expire after 60 seconds');
async function waitFor(fn){for(let n=0;n<150;n++){if(await fn())return;await pause(100);}throw Error('Installed UI condition did not appear.');}
const identity={connection:'HRDMO',processType:'Application Engine',name:'ZZ_BC_EXPORT'};
const args={...identity,properties:{DESCR:'Synthetic handoff CSV',RESTARTENABLED:'0'},components:['AE_REQUEST'],groups:['TLSALL']};
const before=data(await call('psft_process_get',identity));
const report={checkedAt:new Date().toISOString(),bundleSha256:info.bundleSha256,tests:[]};
let restore;
try {
 const previousIds=new Set((await page())?.buttons.map(b=>b.requestId)??[]);let firstId;
 const expired=call('psft_process_create',args);
 await waitFor(async()=>{const b=(await page())?.buttons.find(b=>b.text==='Allow'&&!b.disabled&&!previousIds.has(b.requestId));if(b)firstId=b.requestId;return !!b;});
 await ui.screenshot(info.dir+'/approval-pending.png');
 console.log('Installed pending approval visible; waiting for its real 60-second deadline.');
 const result=await expired;assert.equal(result.isError,true);assert.match(result.content[0].text,/timed out.*Nothing was written/);
 await waitFor(async()=>{const p=await page();return /EXPIRED/.test(p?.text??'')&&!p.buttons.some(b=>b.requestId===firstId);});
 assert.ok(!(await page()).buttons.some(b=>b.requestId===firstId&&b.text==='Allow'&&!b.disabled));
 report.tests.push('Real MCP request expires, UI shows EXPIRED and offers no stale Allow button.');
 const oldDeclineIds=new Set((await page()).buttons.map(b=>b.requestId));
 const declined=call('psft_process_create',args);
 await waitFor(async()=>(await page())?.buttons.some(b=>b.text==='Decline'&&!b.disabled&&!oldDeclineIds.has(b.requestId)));
 await ui.webviewAction('Requests expire after 60 seconds','click','Decline');
 const no=await declined;assert.equal(no.isError,true);assert.match(no.content[0].text,/declined/);
 report.tests.push('Fresh retry appears independently and explicit Decline returns without writing.');
 const oldAllowIds=new Set((await page()).buttons.map(b=>b.requestId));
 const allowed=call('psft_process_create',args);
 await waitFor(async()=>(await page())?.buttons.some(b=>b.text==='Allow'&&!b.disabled&&!oldAllowIds.has(b.requestId)));
 await ui.webviewAction('Requests expire after 60 seconds','click','Allow');
 const yes=await allowed;assert.equal(yes.isError,true);assert.match(yes.content[0].text,/already exists/);
 assert.deepEqual(data(await call('psft_process_get',identity)),before);
 report.tests.push('Explicit Allow reaches native writer, which refuses existing lab definition before any save; full process readback unchanged.');
 await ui.screenshot(info.dir+'/approval-outcomes.png');
 const advertised=(await rpc('tools/list',{})).tools.find(t=>t.name==='psft_build_request_report');
 assert.ok(advertised.inputSchema.properties.entries.items.properties.status.enum.includes('PENDING'));
 const request=data(await call('psft_build_request_get',{id:'br-b7ed22ea1caa'}));
 restore=request.spec.objects.find(o=>o.ref==='scheduler').progress;
 assert.equal(restore.status,'BUILT');
 const pending=data(await call('psft_build_request_report',{id:request.id,entries:[{ref:'scheduler',status:'PENDING',detail:'Installed acceptance: deferred progress, metadata unchanged.'}]}));
 assert.ok(pending.remaining.includes('scheduler'));assert.notEqual(pending.status,'BUILT');
 const deferred=data(await call('psft_build_request_get',{id:request.id}));
 assert.equal(deferred.spec.objects.find(o=>o.ref==='scheduler').progress.status,'PENDING');
 data(await call('psft_build_request_report',{id:request.id,entries:[{ref:'scheduler',status:restore.status,detail:restore.detail,...(restore.changeSetId?{changeSetId:restore.changeSetId}:{})}]}));restore=undefined;
 const restored=data(await call('psft_build_request_get',{id:request.id}));assert.equal(restored.status,'BUILT');
 assert.deepEqual(restored.spec.objects.find(o=>o.ref==='scheduler').progress.history.slice(-2).map(h=>h.status),['PENDING','BUILT']);
 report.tests.push('Installed tools/list advertises PENDING; HTTP report keeps create object unfinished, restores BUILT and preserves both history entries.');
 report.passed=true;
 for(const n of ['pending','outcomes'])await copyFile(info.dir+'/approval-'+n+'.png','tools/lab/results/write-approval-'+n+'-2026-10-20.png');
 await writeFile('tools/lab/results/write-approval-installed-2026-10-20.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{
 if(restore)data(await call('psft_build_request_report',{id:'br-b7ed22ea1caa',entries:[{ref:'scheduler',status:restore.status,detail:restore.detail}]}));
 ui.close();
}
