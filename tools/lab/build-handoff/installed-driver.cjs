/** Test control for a separate installed VS Code host. Product actions use native commands/rendered controls. */
const vscode=require('vscode'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
exports.run=async()=>{
 const info=JSON.parse(fs.readFileSync(process.env.PSFT_BUILD_INPUT,'utf8'));
 const ui=await require(path.join(info.root,'scripts/peoplecode-editor-cdp.cjs')).connectWorkbench(info.cdpUrl);
 const extension=vscode.extensions.getExtension('JaredNorris.peoplesoft-studio');if(extension.extensionPath!==info.candidate)throw Error('The installed candidate is required.');await extension.activate();
 let settled=false;const connect=vscode.commands.executeCommand('psft.connect',info.connection).finally(()=>settled=true);
 const start=Date.now();while(!settled&&Date.now()-start<30000){await ui.answerPassword(`Password for ${info.connection.user}@${info.connection.connectString}`,process.env.PSLAB_ACCESSPSWD);await delay(70);}if(!settled)throw Error('HRDMO connection did not settle.');await connect;
 const token=crypto.randomBytes(24).toString('hex');let stop;
 const done=new Promise(r=>stop=r),ids=new Set(['br-b7ed22ea1caa','br-b6a1848629e9']);
 const handlers={
  status:async()=>({terminals:vscode.window.terminals.map(t=>({name:t.name,pid:null})),active:vscode.window.activeTerminal?.name,tabs:vscode.window.tabGroups.all.flatMap(g=>g.tabs.map(t=>({label:t.label}))),mcpUrl:info.mcpUrl}),
  openRequest:async m=>{if(!ids.has(m.id))throw Error('Only prepared lab requests.');await vscode.commands.executeCommand('psft.buildRequest.open',m.id);return true;},
  openReview:async m=>{if(!/^[0-9a-f-]{36}$/.test(m.id))throw Error('Invalid Change Set');const set=JSON.parse(fs.readFileSync(path.join(info.storage,'change-review/sets',m.id+'.json'))).value;if(!info.privateHistory&&!ids.has(set.requestKey))throw Error('Only request-linked lab reviews.');await vscode.commands.executeCommand('psft.changeReview.open',m.id);return true;},
  importMigration:async()=>{if(!info.privateHistory)throw Error('Migration tests require private history.');void vscode.commands.executeCommand('psft.project.importMigration');return true;},
  input:async m=>ui.answerInput(m.title,m.value),
  quickInput:async()=>ui.quickInputState(),
  page:async m=>ui.webviewAction(m.match,m.action??'inspect',m.value),
  dialog:async m=>ui.dialogAction(m.action??'inspect',m.value),
  terminal:async m=>{const t=vscode.window.terminals.find(t=>t.name===m.name);if(!t)throw Error('Terminal not found');t.show();if(m.text!==undefined){await vscode.commands.executeCommand('workbench.action.terminal.sendSequence',{text:m.text});await delay(250);}return {name:t.name,pid:await t.processId,screen:await ui.terminalScreen()};},
  screenshot:async m=>{const file=path.join(info.dir,path.basename(m.name??'window.png'));await ui.screenshot(file);return {file};},
  shutdown:async()=>{for(const t of vscode.window.terminals)t.dispose();stop();return true;}
 };
 const server=http.createServer(async(req,res)=>{try{if(req.method!=='POST'||req.headers.authorization!=='Bearer '+token){res.writeHead(403);res.end();return;}let b='';for await(const c of req){b+=c;if(b.length>100000)throw Error('Request too large');}const m=JSON.parse(b);if(!handlers[m.command])throw Error('Unsupported test control');const data=await handlers[m.command](m);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,data}));}catch(e){res.statusCode=400;res.end(JSON.stringify({ok:false,error:e.message}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const control={url:`http://127.0.0.1:${server.address().port}`,token,...info};fs.writeFileSync('/tmp/psft-build-handoff-control.json',JSON.stringify(control),{mode:0o600});console.log('Build handoff acceptance window ready');
 await done;await new Promise(r=>server.close(r));ui.close();
};
