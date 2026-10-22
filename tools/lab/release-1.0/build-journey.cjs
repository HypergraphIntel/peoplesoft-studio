/** Fresh owned native table only. Product operations run through the installed Record editor and actual Build confirmation. */
const assert=require('node:assert/strict');
exports.run=async({input,seed,saveSeed,reader,vscode,ui,connection,until,load,check})=>{
 const {applyRecordOperations}=load('model/recordOperations'),{RecordType}=load('model/record'),{ddlRecordFromLayout}=load('model/recordBuild'),{planAlterTable}=load('model/recordAlter'),{openDatabase}=load('db/open');
 const name=input.name.slice(0,15),table='PS_'+name,key={type:0,parts:[name]};
 const pool=await openDatabase('oracle',{connectString:input.connection.connectString,user:process.env.PSLAB_ACCESSID,password:process.env.PSLAB_ACCESSPSWD}),c=await pool.getConnection();
 const closeEditors=async()=>{
  for(const doc of vscode.workspace.textDocuments.filter(d=>d.isDirty))assert.ok(doc.isUntitled&&doc.getText().includes(table),'Only the owned generated Build script may be discarded');
  let settled=false;const pending=vscode.commands.executeCommand('workbench.action.closeAllEditors').finally(()=>settled=true);
  await until(async()=>{const dialog=await ui.dialogAction();if(dialog){assert.ok(dialog.text.includes(table)||dialog.text.includes('PSY'+name));assert.ok(dialog.buttons.includes("Don't Save"));await ui.dialogAction('click',"Don't Save");}return settled;});await pending;
 };
 const operation=async label=>{
  await closeEditors();
  await vscode.commands.executeCommand('psft.openDefinition',connection,key);
  await until(async()=>{const p=await ui.webviewAction(name);return p?.buttons.some(b=>b.text==='Build…')&&p;});
  await ui.webviewAction(name,'click','Build…');
  await until(()=>ui.answerInput('Build '+name,label));
  await until(()=>ui.answerInput('Build '+name+': '+label,'Build and execute'));
  const dialog=await until(()=>ui.dialogAction());assert.match(dialog.text,/DDL commits as it runs/);assert.ok(dialog.buttons.some(b=>b.replaceAll('&','')==='Execute'));
  await ui.dialogAction('click','Execute');
  await until(async()=>{const notices=await ui.notifications();const failure=notices.find(n=>n.includes('Build of '+name+' failed'));if(failure)throw Error(failure);return notices.some(n=>n.includes('Built '+table+' on ')&&n.includes('('+label+')'));});
 };
 try{
  await check('Installed Record Build creates a fresh native table and key index after actual DDL confirmation',async()=>{
   assert.equal(await reader.recordNameStatus(name),'free');assert.equal((await reader.tableState(table)).exists,false);
   seed.build={name,table,owned:true};saveSeed();
   await reader.saveRecord({operatorId:'JARED',edit:applyRecordOperations({recname:name,recordType:RecordType.Table,openedVersion:0,fields:[],isNew:true},RecordType.Table,[{op:'insert_field',field:'DEPTID'},{op:'set_use',field:'DEPTID',key:true},{op:'set_properties',description:'Owned 1.0 build acceptance'}])});
   const before=await reader.readRecordLayout(key);await operation('Create Tables');
   await until(async()=>(await reader.tableState(table)).exists);
   await until(async()=>Number((await c.execute("SELECT COUNT(*) N FROM USER_INDEXES WHERE TABLE_NAME=:n AND STATUS='VALID'",{n:table})).rows[0].N)===1);
   assert.equal((await reader.readRecordLayout(key)).version,before.version,'Physical build does not silently resave metadata');
   await c.execute(`INSERT INTO ${table} (DEPTID) VALUES (:d)`,{d:'V1TEST'});await c.commit();
  });
  await check('Installed Alter copies the owned row and produces the exact saved column layout',async()=>{
   const r=await reader.readRecordLayout(key),state={recname:name,recordType:r.recordType,openedVersion:r.version,fields:r.fields.map(f=>({name:f.name,useEdit:f.useEdit,useEdit2:f.useEdit2??0,isNew:false}))};
   await reader.saveRecord({operatorId:'JARED',edit:applyRecordOperations(state,RecordType.Table,[{op:'insert_field',field:'DESCR'}])});
   await operation('Alter Tables');
   await until(async()=>Number((await c.execute("SELECT COUNT(*) N FROM USER_TAB_COLUMNS WHERE TABLE_NAME=:n AND COLUMN_NAME='DESCR'",{n:table})).rows[0].N)===1);
   const row=(await c.execute(`SELECT DEPTID, DESCR FROM ${table}`)).rows;assert.equal(row.length,1);assert.equal(row[0].DEPTID.trim(),'V1TEST');assert.equal(row[0].DESCR.trim(),'');
   assert.equal((await reader.tableState('PSY'+name)).exists,false);
   const current=await reader.readRecordLayout(key),facts=await reader.readBuildFacts(table),model=await reader.readDdlModel(name);
   const plan=planAlterTable(ddlRecordFromLayout(current),model,facts,{tableOption:'rename',dropColumn:'skip',changeLength:'skip',adds:true,changes:true,renames:true,deletes:true,evenIfNoChanges:false});assert.equal(plan.statements.length,0,JSON.stringify(plan));
  });
  await check('Installed Create Indexes rebuilds the native key without losing the owned row',async()=>{
   await vscode.workspace.getConfiguration('peoplesoft').update('build.create.index','recreate',vscode.ConfigurationTarget.Global);
   await operation('Create Indexes');
   await until(async()=>Number((await c.execute("SELECT COUNT(*) N FROM USER_INDEXES WHERE TABLE_NAME=:n AND STATUS='VALID'",{n:table})).rows[0].N)===1);
   assert.equal(Number((await c.execute(`SELECT COUNT(*) N FROM ${table}`)).rows[0].N),1);
   await ui.screenshot(require('node:path').join(input.artifactDirectory,'v1-build-'+process.platform+'.png'));
  });
 }finally{
  await closeEditors();
  if(seed.build?.owned){
   if((await reader.tableState(table)).exists)await c.execute(`DROP TABLE ${table} PURGE`);
   if((await reader.tableState('PSY'+name)).exists)await c.execute(`DROP TABLE PSY${name} PURGE`);
   const record=await reader.readRecordLayout(key);if(record)await reader.deleteRecord({recname:name,openedVersion:record.version,operatorId:'JARED'});
   await c.execute('DELETE FROM PSRECDEL WHERE RECNAME=:n',{n:name});await c.commit();
   assert.equal(await reader.readRecordLayout(key),undefined);assert.equal((await reader.tableState(table)).exists,false);seed.build.cleaned=true;saveSeed();
  }
  await c.close();await pool.close();
 }
};
