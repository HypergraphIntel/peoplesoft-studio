/** Blank-profile current-candidate native save acceptance. */
const assert=require('node:assert/strict');
exports.run=async({input,seed,saveSeed,reader,vscode,ui,connection,until,load,check,call,get,apply,draft,native})=>{
 await check('Fresh current candidate stages creation without a native write, then renders approval and verifies persistence',async()=>{
  assert.equal(await native(),undefined);seed.owned=true;saveSeed();
  const set=await call('psft_create_change_set',{connection,title:'Fresh install '+input.name});seed.original=set.id;saveSeed();
  await call('psft_save_text_definition',{connection,type:30,name:input.name,text:'SELECT 1 FROM DUAL',changeSetId:set.id});assert.equal(await native(),undefined);
  const applied=await apply(await get(set.id));assert.ok(applied.objects.every(o=>o.application==='VERIFIED'));assert.equal((await native()).data.text.trim(),'SELECT 1 FROM DUAL');
 });
 await check('Fresh current candidate opens editable SQL and preserves the native source while drafting',async()=>{
  const doc=await draft('SELECT 99 FROM DUAL /* fresh install unsaved draft */');assert.equal((await native()).data.text.trim(),'SELECT 1 FROM DUAL');
  const editor=await vscode.window.showTextDocument(doc);assert.equal(doc.languageId,'psft-sql');editor.selection=new vscode.Selection(0,0,0,0);
  await vscode.commands.executeCommand('editor.action.commentLine');assert.match(doc.getText(),/^\s*--\s*SELECT 99/);
  await vscode.commands.executeCommand('editor.action.commentLine');assert.equal(doc.getText(),seed.draft.text);
  await vscode.commands.executeCommand('workbench.action.files.revert');await until(()=>!doc.isDirty);
  await ui.screenshot(require('node:path').join(input.artifactDirectory,'v1-fresh-'+process.platform+'.png'));
 });
 await check('Fresh creation inverse requires rendered destructive approval and cleans only the owned native scope',async()=>{
  await apply(await call('psft_prepare_revert',{changeSetId:seed.original}),true);assert.equal(await native(),undefined);
  const {openDatabase}=load('db/open'),pool=await openDatabase('oracle',{connectString:input.connection.connectString,user:process.env.PSLAB_ACCESSID,password:process.env.PSLAB_ACCESSPSWD}),c=await pool.getConnection();
  try{for(const table of ['PSSQLTEXTDEFN','PSSQLHASH','PSSQLDESCR','PSSQLDEFN','PSSQLLANG','PSSQLDEL'])await c.execute(`DELETE FROM ${table} WHERE SQLID=:n`,{n:input.name});await c.commit();}finally{await c.close();await pool.close();}
  seed.cleaned=true;saveSeed();
 });
};
