/** Installed runtime acceptance. Submits only the existing synthetic HRDMO export after rendered confirmation. */
const vscode=require('vscode'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
exports.run=async()=>{
 const input=JSON.parse(fs.readFileSync(process.env.PSFT_RUNTIME_INPUT,'utf8')),result=process.env.PSFT_RUNTIME_RESULT;
 const results={at:new Date().toISOString(),scope:'Unmodified installed candidate; normal isolated visible VS Code; native JARED/HRDMO PROCESSREQUEST and read-only independent SQL',checks:[]};
 const load=n=>require(path.join(input.root,'dist-test',n+'.js')),{DatabaseProvider}=load('providers/database');
 const reader=new DatabaseProvider({name:'Independent runtime readback',platform:'oracle',connectString:input.connection.connectString,user:process.env.PSLAB_ACCESSID,password:process.env.PSLAB_ACCESSPSWD});
 const progress=operation=>fs.writeFileSync(result+'.progress',JSON.stringify({operation,checks:results.checks.length}));
 const check=async(name,fn)=>{progress(name);await fn();results.checks.push({name,passed:true});console.log('PASS '+name);};
 const until=async(fn,timeout=60000)=>{const start=Date.now();while(Date.now()-start<timeout){const value=await fn();if(value)return value;await sleep(150);}throw Error('Timed out: '+JSON.parse(fs.readFileSync(result+'.progress')).operation);};
 let ui,connection,seq=0,request,instance;
 const call=async(name,args={})=>{const res=await fetch(input.mcpUrl,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(60000)});const body=await res.text(),r=JSON.parse(body.startsWith('{')?body:body.split('\n').find(l=>l.startsWith('data:')).slice(5));if(r.error||r.result?.isError)throw Error(JSON.stringify(r.error??r.result.content));return JSON.parse(r.result.content[0].text);};
 const page=()=>ui.webviewAction('Run and Monitor');
 const settled=async()=>until(async()=>{const p=await page();return p&&p.busy!=='true'&&p;});
 const click=async text=>{await ui.webviewAction('Run and Monitor','click',text);return settled();};
 const sql=async s=>(await reader.runReadOnlyQuery(s,100)).rows;
 const snapshot=()=>sql("SELECT VERSION FROM PSAEAPPLDEFN WHERE AE_APPLID='ZZ_BC_EXPORT'");
 try{
  await reader.connect();results.environment=await reader.readEnvironment();assert.equal((await sql("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL"))[0].DB,'HRDMO');
  const baseline=await snapshot();
  assert.equal((await sql("SELECT PROCESS_FREQUENCY FROM PS_AEREQUESTTBL WHERE OPRID='JARED' AND RUN_CNTL_ID='ZZ_BC_ACC01' AND AE_APPLID='ZZ_BC_EXPORT'"))[0]?.PROCESS_FREQUENCY,'O');
  const ext=vscode.extensions.getExtension('JaredNorris.peoplesoft-studio');assert.equal(ext.extensionPath,input.candidate);await ext.activate();
  ui=await require('./peoplecode-editor-cdp.cjs').connectWorkbench(input.cdpUrl);
  await check('Installed candidate connects to HRDMO and exposes the runtime reference',async()=>{
   let done=false;const pending=vscode.commands.executeCommand('psft.connect',input.connection).finally(()=>done=true);
   await until(async()=>{if(!done)await ui.answerPassword(`Password for ${input.connection.user}@${input.connection.connectString}`,process.env.PSLAB_ACCESSPSWD);return done;});await pending;
   const cs=await until(async()=>{try{return await call('psft_list_connections');}catch{return false;}});connection=cs.connections.find(c=>c.connected).id;
   await call('psft_process_runtime_reference');
  });
  await check('Rendered Scheduler sign-in authenticates JARED through the native service',async()=>{
   await vscode.commands.executeCommand('psft.process.run',connection,'ZZ_BC_EXPORT');await until(page);
   progress('WAITING_FOR_PUBLIC_GATEWAY_TLS');await until(()=>fs.existsSync(result+'.tls-ready'),1200000);
   await ui.webviewAction('Run and Monitor','click','Scheduler sign-in');
   await until(()=>ui.answerInput('Process Scheduler endpoint — '+input.connection.name,'https://hcm.deathstar.chickenkiller.com/PSIGW/PeopleSoftServiceListeningConnector'));
   await until(async()=>{const p=await ui.quickInputState();return p?.title==='PeopleSoft Scheduler password — JARED on '+input.connection.name;});
   progress('READY_FOR_JARED_PASSWORD');
   await until(async()=>{const p=await page();if(p?.busy!=='true'&&p?.text.includes('Native scheduler sign-in verified.'))return p;return false;},1200000);
   const choices=await call('psft_process_runtime_choices',{connection});results.choices={processCount:choices.processes.length,servers:choices.servers};assert.ok(choices.processes.includes('ZZ_BC_EXPORT'));assert.ok(choices.runControls.some(c=>c.id==='ZZ_BC_ACC01'));
  });
  // Pause read-only after sign-in so an external observer can inspect native report authentication before submission.
  progress('AUTHENTICATED_READY');
  await until(()=>fs.existsSync(result+'.continue'),1200000);
  await check('Reviewing the rendered request leaves the native queue untouched',async()=>{
   const before=await reader.readProcessRuntimeBaseline('JARED',{process:'ZZ_BC_EXPORT',runControl:'ZZ_BC_ACC01',server:'HCMDMO'});results.beforeInstance=before.lastInstance;
   await ui.webviewAction('Run and Monitor','query',{values:{'#process':'ZZ_BC_EXPORT','#runControl':'ZZ_BC_ACC01','#server':'HCMDMO'},submit:'#run'});
   const p=await until(async()=>{const p=await page();return p?.busy!=='true'&&p.text.includes('Confirm and run')&&p;});
   assert.match(p.text,/JARED/);assert.match(p.text,/ZZ_BC_ACC01/);assert.match(p.text,/HCMDMO/);
   const list=await call('psft_process_run_list',{connection});request=(list.requests??list).find(r=>r.state==='PREPARED');assert.ok(request);assert.equal((await reader.readProcessRuntimeBaseline('JARED',request.request)).lastInstance,before.lastInstance);
   await ui.screenshot(path.join(input.artifactDirectory,'process-runtime-confirmation.png'));
  });
  await check('Explicit rendered confirmation submits exactly one native scheduler instance',async()=>{
   await click('Confirm and run');
   const list=await call('psft_process_run_list',{connection});request=(list.requests??list).find(r=>r.id===request.id);assert.equal(request.state,'SUBMITTED',JSON.stringify(request));instance=request.instance;assert.ok(instance>results.beforeInstance);results.instance=instance;
   const rows=await sql(`SELECT PRCSINSTANCE,PRCSNAME,OPRID,RUNCNTLID FROM PSPRCSQUE WHERE PRCSINSTANCE=${instance}`);assert.equal(rows.length,1);assert.equal(rows[0].PRCSNAME,'ZZ_BC_EXPORT');assert.equal(rows[0].OPRID,'JARED');assert.equal(rows[0].RUNCNTLID,'ZZ_BC_ACC01');
  });
  await check('Native monitor reaches Success and Posted with matching independent database status',async()=>{
   let run;await until(async()=>{const r=await call('psft_process_run_status',{id:request.id});run=r.run??r;if(/error|no success|cancel|deleted/i.test(run.runStatus??''))throw Error('Native execution failed: '+JSON.stringify(run));return /success/i.test(run.runStatus??'')&&run.contentIds?.length;},300000);results.nativeRun=run;
   const rows=await sql(`SELECT RUNSTATUS,DISTSTATUS FROM PSPRCSQUE WHERE PRCSINSTANCE=${instance}`);assert.equal(rows[0].RUNSTATUS,'9');assert.equal(rows[0].DISTSTATUS,'5');await click('Refresh status');await ui.screenshot(path.join(input.artifactDirectory,'process-runtime-monitor.png'));
  });
  await check('Native logs and exact CSV output open through the installed workflow',async()=>{
   await click('View logs and output');let reports=await call('psft_process_run_reports',{id:request.id});reports=reports.reports??reports;results.files=reports.map(({name,description})=>({name,description}));
   const csv=reports.find(f=>f.name==='ZZ_BC_EXPORT.csv');assert.ok(csv);const data=await call('psft_process_report_read',{id:request.id,reportId:csv.id});results.csv=data;assert.equal(createHash('sha256').update(data.text).digest('hex'),'62d92d414fc02901271744facb65c61b5d9bbecc6f7edfecc31fc734f11b6367');
   const log=reports.find(f=>/stdout|\.out$/.test(f.name));assert.ok(log);
   await ui.webviewAction('Run and Monitor','query',{click:`[data-file="${log.id}"][data-action="view"]`});
   await until(()=>vscode.workspace.textDocuments.some(d=>d.getText().includes('accepted=3')&&d.getText().includes('rejected=1')));
   await ui.screenshot(path.join(input.artifactDirectory,'process-runtime-output.png'));
  });
  await check('Reopening Run and Monitor retains verified history and leaves the program unchanged',async()=>{
   await vscode.commands.executeCommand('workbench.action.closeAllEditors');await vscode.commands.executeCommand('psft.process.run',connection,'ZZ_BC_EXPORT');const p=await until(async()=>{const p=await page();return p?.text.includes('Instance '+instance)&&p;});assert.match(p.text,/Success/);assert.deepEqual(await snapshot(),baseline);
   const list=await call('psft_process_run_list',{connection});assert.equal((list.requests??list).filter(r=>r.instance===instance).length,1);
  });
  results.passed=true;
 }catch(e){results.error=e instanceof Error?e.message:String(e);results.passed=false;try{if(ui)await ui.screenshot(path.join(input.artifactDirectory,'process-runtime-failure.png'));}catch{}throw e;}
 finally{fs.writeFileSync(result,JSON.stringify(results,null,2)+'\n');ui?.close();await reader.dispose().catch(()=>{});}
};
