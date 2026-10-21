/** Local test-window control. The bearer token stays in the private descriptor and is never printed. */
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const c=JSON.parse(await readFile('/tmp/psft-build-handoff-control.json','utf8'));
const payload=JSON.parse(process.argv[2]??'{"command":"status"}');
if(['terminal','key'].includes(payload.command)){
 const call=async body=>(await fetch(c.url,{method:'POST',headers:{authorization:'Bearer '+c.token,'content-type':'application/json'},body:JSON.stringify(body)})).json();
 await call({command:'terminal',name:payload.name});
 for(let n=0;n<20;n++){const s=await call({command:'status'});if(s.data?.active===payload.name)break;if(n===19)throw Error('Target terminal did not activate');await new Promise(r=>setTimeout(r,50));}
 await new Promise(r=>setTimeout(r,100));
}
if(['page','dialog','screenshot','key'].includes(payload.command)){
 const require=createRequire(import.meta.url),ui=await require('../../../scripts/peoplecode-editor-cdp.cjs').connectWorkbench(c.cdpUrl);
 try {
  const result=payload.command==='page'?await ui.webviewAction(payload.match,payload.action??'inspect',payload.value)
    :payload.command==='dialog'?await ui.dialogAction(payload.action??'inspect',payload.value)
    :payload.command==='key'?await ui.terminalKey(payload.value??'Enter')
    :await ui.screenshot(c.dir+'/'+(payload.name??'window.png'));
  console.log(JSON.stringify(result??null,null,2));
 }finally{ui.close();}
 process.exit(0);
}
const response=await fetch(c.url,{method:'POST',headers:{authorization:'Bearer '+c.token,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
const result=await response.json();if(!result.ok)throw Error(result.error);
if(result.data?.screen)result.data.screen=result.data.screen.split('\n').map(line=>/https?:\/\/|oauth|code_challenge|Paste code here|[A-Za-z0-9_-]{45,}/i.test(line)?'[Authentication or long token line omitted]':line).join('\n');
console.log(JSON.stringify(result.data,null,2));
