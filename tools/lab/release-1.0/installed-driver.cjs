/** Normal installed extension host: upgrade, SecretStorage, native text edits, review/history and hot-exit draft acceptance. */
const vscode=require('vscode'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
exports.run=async()=>{
 const input=JSON.parse(fs.readFileSync(process.env.PSFT_V1_INPUT,'utf8')),resultFile=process.env.PSFT_V1_RESULT,report={phase:input.phase,at:new Date().toISOString(),vscode:vscode.version,checks:[]};
 const load=n=>require(path.join(input.root,'dist-test',n+'.js')),{DatabaseProvider}=load('providers/database'),{openDatabase}=load('db/open'),{reviewStateToken}=load('changeReview/model');
 const reader=new DatabaseProvider({name:'Independent 1.0 readback',platform:'oracle',connectString:input.connection.connectString,user:process.env.PSLAB_ACCESSID,password:process.env.PSLAB_ACCESSPSWD});
 let ui,connection,seq=0,seed=['seed','fresh'].includes(input.phase)?{}:JSON.parse(fs.readFileSync(input.seed,'utf8'));
 const saveSeed=()=>fs.writeFileSync(input.seed,JSON.stringify(seed,null,2)+'\n');
 const progress=name=>fs.writeFileSync(resultFile+'.progress',JSON.stringify({phase:input.phase,operation:name,checks:report.checks.length}));
 const check=async(name,fn)=>{progress(name);await fn();report.checks.push({name,passed:true});};
 const until=async(fn,ms=60000)=>{const start=Date.now();while(Date.now()-start<ms){const r=await fn();if(r)return r;await delay(100);}throw Error('Timeout: '+JSON.parse(fs.readFileSync(resultFile+'.progress')).operation);};
 const call=async(name,args={},refusal)=>{const response=await fetch(input.mcpUrl,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(60000)});const text=await response.text(),r=JSON.parse(text.startsWith('{')?text:text.split('\n').find(l=>l.startsWith('data:')).slice(5));if(refusal){assert.ok(r.error||r.result?.isError);assert.match(JSON.stringify(r.error??r.result.content),refusal);return;}if(r.error||r.result?.isError)throw Error(JSON.stringify(r.error??r.result.content));return JSON.parse(r.result.content[0].text);};
 const get=id=>call('psft_get_change_set',{changeSetId:id});
 const native=()=>reader.readSqlForMigration({type:30,parts:[input.name,'0']});
 const open=async set=>{await vscode.commands.executeCommand('psft.changeReview.open',set.id);return until(async()=>{const p=await ui.webviewAction('PeopleSoft Change Review');return p?.selectedTitle===set.title&&p.reviewToken===reviewStateToken(set)&&p.busy!=='true'&&p;});};
 const apply=async(set,destructive=false)=>{set=await call('psft_validate_change_set',{changeSetId:set.id});assert.equal(set.status,'READY_FOR_REVIEW',JSON.stringify(set.objects.map(o=>o.validation)));await open(set);if(destructive)await ui.webviewAction('PeopleSoft Change Review','checkbox','destructive');await ui.webviewAction('PeopleSoft Change Review','click','approveAndApply');return until(async()=>{const s=await get(set.id);if(['CONFLICTED','FAILED','PARTIALLY_APPLIED'].includes(s.status))throw Error(JSON.stringify(s.journal));return s.status==='APPLIED'&&s;});};
 const draft=async text=>{await vscode.commands.executeCommand('psft.openDefinition',connection,{type:30,parts:[input.name,'0']});const doc=await until(()=>vscode.workspace.textDocuments.find(d=>d.uri.scheme==='psft'&&d.uri.toString().includes(input.name)));const edit=new vscode.WorkspaceEdit();edit.replace(doc.uri,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),text);assert.equal(await vscode.workspace.applyEdit(edit),true);assert.ok(doc.isDirty);seed.draft={uri:doc.uri.toString(),text};saveSeed();return doc;};
 try{
  await reader.connect();report.environment=await reader.readEnvironment();report.platform=process.platform;report.architecture=process.arch;assert.equal(report.environment.toolsRelease,'8.62');assert.equal(report.environment.patchLevel,9);assert.equal(process.arch,'x64');assert.equal((await reader.runReadOnlyQuery("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL",1)).rows[0].DB,'HRDMO');
  const extension=vscode.extensions.getExtension('JaredNorris.peoplesoft-studio');assert.equal(extension.extensionPath,input.candidate);assert.equal(extension.packageJSON.version,input.expectedVersion);await extension.activate();
  ui=await require(path.join(input.root,'scripts/peoplecode-editor-cdp.cjs')).connectWorkbench(input.cdpUrl);
  await check('Installed candidate connects through the real password/SecretStorage path',async()=>{
   let settled=false;const pending=vscode.commands.executeCommand('psft.connect',input.connection).finally(()=>settled=true);
   await until(async()=>{const q=await ui.quickInputState();if(q?.title===`Password for ${input.connection.user}@${input.connection.connectString}`){assert.ok(['seed','fresh'].includes(input.phase),'Stored database credential was lost across upgrade/reload');await ui.answerPassword(q.title,process.env.PSLAB_ACCESSPSWD);}return settled;});await pending;
   const cs=await until(async()=>{try{return await call('psft_list_connections');}catch{return false;}});connection=cs.connections.find(c=>c.connected).id;
  });
  if(input.phase==='fresh'){
   await require(path.join(input.root,'tools/lab/release-1.0/fresh-journey.cjs')).run({input,seed,saveSeed,reader,vscode,ui,connection,until,load,check,call,get,apply,draft,native});
  }else if(input.phase==='seed'){
   await check(process.platform==='win32'?'Published 0.9.7 retains local history despite its known Windows directory-fsync refusal':'Published 0.9.7 saves an owned SQL fixture only through rendered review and native readback',async()=>{
    assert.equal(await native(),undefined);seed.owned=true;saveSeed();
    const title='1.0 upgrade seed '+input.name;
    if(process.platform==='win32'){
     // Keep the published asset untouched. Its directory fsync fails after
     // publishing local history; this is precisely the Windows bug being fixed.
     await call('psft_create_change_set',{connection,title},/EPERM.*fsync/);
     const retained=(await call('psft_list_change_sets')).changeSets.find(s=>s.title===title);assert.ok(retained);assert.equal(retained.status,'DRAFT');
     seed.original=retained.id;seed.originalRevision=retained.revision;seed.originalStatus=retained.status;
     report.previousVersionIssue='Published 0.9.7 Windows directory fsync EPERM; retained DRAFT must survive upgrade. Fixture setup uses the independent native writer; current candidate writes still require rendered review.';
     await reader.saveSqlDefinition({sqlId:input.name,text:'SELECT 1 FROM DUAL',operatorId:'JARED'});
    }else{
     const set=await call('psft_create_change_set',{connection,title});seed.original=set.id;saveSeed();
     await call('psft_save_text_definition',{connection,type:30,name:input.name,text:'SELECT 1 FROM DUAL',changeSetId:set.id});assert.equal(await native(),undefined);
     const applied=await apply(await get(set.id));assert.ok(applied.objects.every(o=>o.application==='VERIFIED'));seed.originalRevision=applied.revision;seed.originalStatus=applied.status;
    }
    assert.equal((await native()).data.text.trim(),'SELECT 1 FROM DUAL');saveSeed();
   });
   await check('A dirty native SQL document is retained for upgrade without saving its draft',async()=>{await draft('SELECT 101 FROM DUAL /* preserved across upgrade */');assert.equal((await native()).data.text.trim(),'SELECT 1 FROM DUAL');await delay(5000);});
  }else if(input.phase==='final'){
   await check('Final restart retains verified history and the completed cleanup without replay',async()=>{assert.ok(seed.cleaned);assert.equal(await native(),undefined);for(const [id,status] of Object.entries(seed.finalHistory))assert.equal((await get(id)).status,status);});
  }else{
   await check('Native dirty document and Change Review history survive '+input.phase,async()=>{
    const doc=await until(()=>vscode.workspace.textDocuments.find(d=>d.uri.toString()===seed.draft.uri&&d.isDirty&&d.getText()===seed.draft.text));assert.ok(doc.isDirty);assert.equal(doc.getText(),seed.draft.text);
    const original=await get(seed.original);assert.equal(original.revision,seed.originalRevision);assert.equal(original.status,seed.originalStatus);assert.equal((await native()).data.text.trim(),'SELECT 1 FROM DUAL');
    const settings=fs.readFileSync(input.settings,'utf8');assert.ok(!settings.includes(process.env.PSLAB_ACCESSPSWD),'Credentials must not be written to settings');
   });
   if(input.phase==='upgrade'){
    await check('Settings and MCP expose the same release contract and preview boundary',async()=>{
     const reference=await call('psft_studio_reference');assert.equal(reference.releaseSupport.qualification,load('model/releaseSupport').RELEASE_SUPPORT.qualification);assert.equal(reference.releaseSupport.primary.nativePatch,'8.62.09');
     await vscode.commands.executeCommand('psft.settings.open');const p=await until(async()=>{const p=await ui.webviewAction('Release Support');return p?.text.includes('1.0 core')&&p;});assert.match(p.text,/qualification/i);await ui.screenshot(path.join(input.artifactDirectory,'v1-settings-support-'+process.platform+'.png'));
    });
    await check('Dirty native source blocks reviewed application without a database write',async()=>{
     const set=await call('psft_create_change_set',{connection,title:'Dirty refusal '+input.name});await call('psft_save_text_definition',{connection,type:30,name:input.name,text:'SELECT 2 FROM DUAL',changeSetId:set.id});
     let staged=await call('psft_validate_change_set',{changeSetId:set.id});await open(staged);
     if(staged.status==='READY_FOR_REVIEW'){await ui.webviewAction('PeopleSoft Change Review','click','approveAndApply');staged=await until(async()=>{const s=await get(set.id);return ['CONFLICTED','FAILED','PARTIALLY_APPLIED'].includes(s.status)&&s;});}
     assert.notEqual(staged.status,'APPLIED');assert.equal((await native()).data.text.trim(),'SELECT 1 FROM DUAL');seed.dirtyRefusalSet=set.id;saveSeed();
    });
    await check('Disconnect and reconnect retain the dirty draft and require no credential re-entry',async()=>{
     const doc=vscode.workspace.textDocuments.find(d=>d.uri.toString()===seed.draft.uri);
     await vscode.commands.executeCommand('psft.disconnect',input.connection);
     assert.ok(doc.isDirty);assert.equal(doc.getText(),seed.draft.text);
     let settled=false;const pending=vscode.commands.executeCommand('psft.connect',input.connection).finally(()=>settled=true);
     await until(async()=>{const q=await ui.quickInputState();assert.notEqual(q?.title,`Password for ${input.connection.user}@${input.connection.connectString}`);return settled;});await pending;
     assert.ok(doc.isDirty);assert.equal(doc.getText(),seed.draft.text);assert.equal((await native()).data.text.trim(),'SELECT 1 FROM DUAL');
    });
    await draft('SELECT 202 FROM DUAL /* preserved across reload */');
   }else{
    // The recovered draft is deliberately discarded after proving persistence.
    const doc=vscode.workspace.textDocuments.find(d=>d.uri.toString()===seed.draft.uri);await vscode.window.showTextDocument(doc);await vscode.commands.executeCommand('workbench.action.files.revert');await until(()=>!doc.isDirty);
    await check('Current installed source save, inverse and redo verify native SQL at every boundary',async()=>{
     const set=await call('psft_create_change_set',{connection,title:'1.0 native SQL '+input.name});await call('psft_save_text_definition',{connection,type:30,name:input.name,text:'SELECT 2 FROM DUAL',changeSetId:set.id});await apply(await get(set.id));assert.equal((await native()).data.text.trim(),'SELECT 2 FROM DUAL');
     const inverse=await apply(await call('psft_prepare_revert',{changeSetId:set.id}));assert.equal((await native()).data.text.trim(),'SELECT 1 FROM DUAL');await until(async()=>(await get(set.id)).status==='REVERTED');
     const redo=await apply(await call('psft_prepare_redo',{changeSetId:set.id}));assert.equal((await native()).data.text.trim(),'SELECT 2 FROM DUAL');await apply(await call('psft_prepare_revert',{changeSetId:redo.id}));assert.equal((await native()).data.text.trim(),'SELECT 1 FROM DUAL');
     seed.editSets=[set.id,inverse.id,redo.id];saveSeed();
    });
    await require(path.join(input.root,'tools/lab/release-1.0/build-journey.cjs')).run({input,seed,saveSeed,reader,vscode,ui,connection,until,load,check});
    await check('Owned fixture deletion uses rendered destructive review; cleanup removes only its native markers',async()=>{
     // Intervening edits advanced native versions: an old creation must refuse
     // reversal even though undo restored equivalent source. Delete from a fresh checkpoint.
     if(seed.originalStatus==='APPLIED')await call('psft_prepare_revert',{changeSetId:seed.original},/Live state changed/);
     const deletion=await call('psft_create_change_set',{connection,title:'1.0 cleanup '+input.name});
     await call('psft_stage_object_change',{changeSetId:deletion.id,adapter:'sql-definition',key:input.name,after:null});
     await apply(await get(deletion.id),true);assert.equal(await native(),undefined);
     const pool=await openDatabase('oracle',{connectString:input.connection.connectString,user:process.env.PSLAB_ACCESSID,password:process.env.PSLAB_ACCESSPSWD}),c=await pool.getConnection();try{for(const table of ['PSSQLTEXTDEFN','PSSQLHASH','PSSQLDESCR','PSSQLDEFN','PSSQLLANG','PSSQLDEL'])await c.execute(`DELETE FROM ${table} WHERE SQLID=:n`,{n:input.name});await c.commit();}finally{await c.close();await pool.close();}seed.cleaned=true;seed.finalHistory={};for(const id of [seed.original,...seed.editSets,deletion.id])seed.finalHistory[id]=(await get(id)).status;saveSeed();
    });
   }
  }
  report.passed=true;saveSeed();
 }catch(error){report.passed=false;report.error=error instanceof Error?error.message:String(error);try{if(ui)await ui.screenshot(path.join(input.artifactDirectory,'v1-'+input.phase+'-failure.png'));}catch{}throw error;}
 finally{report.hotExit=vscode.workspace.getConfiguration('files').get('hotExit');report.openDocuments=vscode.workspace.textDocuments.filter(d=>d.uri.scheme==='psft').map(d=>({uri:d.uri.toString(),dirty:d.isDirty,text:d.getText()}));fs.writeFileSync(resultFile,JSON.stringify(report,null,2)+'\n');ui?.close();await reader.dispose().catch(()=>{});}
};
