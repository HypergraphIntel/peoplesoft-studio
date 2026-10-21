/** Installed inline preview in unsaved PeopleCode buffers only. No connection or PeopleSoft save. */
const vscode=require('vscode'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
exports.run=async()=>{
 const input=JSON.parse(fs.readFileSync(process.env.PSFT_INLINE_INPUT,'utf8')),report={checks:[],passed:false,scope:'Installed unmodified extension; rendered ghost text and physical Tab in unsaved PeopleCode; no database access or saves'};
 let ui;
 const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
 const until=async(fn,label)=>{for(let i=0;i<150;i++){if(await fn())return;await sleep(50);}throw Error('Timed out: '+label);};
 try {
  const ext=vscode.extensions.getExtension('JaredNorris.peoplesoft-studio');assert.equal(ext.extensionPath,input.candidate);await ext.activate();
  ui=await require('./peoplecode-editor-cdp.cjs').connectWorkbench(input.cdpUrl);
  const source='method StoreX\n   Local Record &r;\n   CreateSQL\nend-method;',doc=await vscode.workspace.openTextDocument({language:'psft-peoplecode',content:source.replace('CreateSQL','')}),editor=await vscode.window.showTextDocument(doc);
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  editor.selection=new vscode.Selection(doc.positionAt(source.indexOf('CreateSQL')),doc.positionAt(source.indexOf('CreateSQL')));
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  await check('PeopleCode enables inline suggestions by default; typing an opening parenthesis renders the complete call without changing the document',async()=>{
   assert.equal(vscode.workspace.getConfiguration('editor',{uri:doc.uri,languageId:doc.languageId}).get('inlineSuggest.enabled'),true);
   for(const ch of 'CreateSQL('){await ui.typeInEditor(ch);await sleep(50);}await until(()=>doc.getText().includes('CreateSQL('),'native input');
   await sleep(500);await until(async()=>(await ui.inlineText()).includes('sqlText'),'automatic inline call');
   assert.ok(!doc.getText().includes('sqlText'));await ui.screenshot(path.join(input.artifacts,'peoplecode-inline-preview.png'));
  });
  await check('Physical Tab accepts the full call once and selects the first editable argument',async()=>{
   await ui.editorTab();await until(()=>doc.getText().includes('CreateSQL(sqlText, bindValues);'),'Tab acceptance');
   assert.equal(doc.getText(editor.selection),'sqlText');assert.ok(!doc.getText().includes(');)'));
  });
  await check('Argument tab stops are editable and the optional comma/binds segment can be removed together',async()=>{
   await vscode.env.clipboard.writeText('"SELECT 1 FROM DUAL"');await vscode.commands.executeCommand('editor.action.clipboardPasteAction');await ui.editorTab();await until(()=>doc.getText(editor.selection)===', bindValues','optional argument selection');
   await vscode.commands.executeCommand('deleteLeft');await until(()=>doc.getText().includes('CreateSQL("SELECT 1 FROM DUAL");'),'optional argument removal');
   await vscode.commands.executeCommand('leaveSnippet');
  });
  await check('The preview setting disables ghost calls while standard signature help remains available',async()=>{
   await vscode.workspace.getConfiguration('peoplesoft').update('peoplecode.inlineCallPreview',false,vscode.ConfigurationTarget.Global);
   const edit=new vscode.WorkspaceEdit();edit.replace(doc.uri,new vscode.Range(doc.positionAt(0),doc.positionAt(doc.getText().length)),source.replace('CreateSQL','CreateSQL()'));assert.equal(await vscode.workspace.applyEdit(edit),true);
   const position=doc.positionAt(doc.getText().indexOf('CreateSQL(')+10);editor.selection=new vscode.Selection(position,position);
   await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');await sleep(300);
   assert.ok(!(await ui.inlineText()).includes('sqlText'));
   const help=await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider',doc.uri,position,'(');assert.equal(help.signatures[0].label,'CreateSQL(sqlText [, bindValues])');
  });
  report.passed=true;
 }catch(e){report.error=e.stack??String(e);await ui?.screenshot(path.join(input.artifacts,'peoplecode-inline-failure.png')).catch(()=>{});throw e;}
 finally{ui?.close();fs.writeFileSync(process.env.PSFT_INLINE_RESULT,JSON.stringify(report,null,2)+'\n');await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');}
};
