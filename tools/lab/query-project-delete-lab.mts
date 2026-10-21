/** Owned HRDMO native deletion/recreation fixtures. Never targets an existing name. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {DatabaseProvider} from '../../src/providers/database.js';
import {openDatabase} from '../../src/db/open.js';
import {DefinitionType,makeKey} from '../../src/model/definitions.js';
import {applyQueryOp,newQueryDocument} from '../../src/model/queryDocument.js';
import {setWriteNamePrefix} from '../../src/providers/writeScope.js';
const names={public:'ZZ_PCODE_LAB_DQP8',private:'ZZ_PCODE_LAB_DQJ8',project:'ZZ_PCODE_LAB_DPR8'},file='/tmp/psft-query-project-delete-lab.json';
const config={name:'HRDMO owned Query/project calibration',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!},operatorId=process.env.PSLAB_OPERATOR??'JARED';
assert.match(config.connectString,/hrdmo/i);assert.equal(operatorId,'JARED');
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection();
const command=process.argv[2]??'state';assert.ok(['seed','state','cleanup','enrich-private'].includes(command));
try{
 assert.equal((await c.execute<{DB:string}>("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL")).rows![0].DB.toUpperCase(),'HRDMO');
 const tables=(await c.execute<{TABLE_NAME:string;COLUMN_NAME:string}>(`SELECT T.TABLE_NAME,C.COLUMN_NAME FROM ALL_TABLES T JOIN ALL_TAB_COLUMNS C ON C.OWNER=T.OWNER AND C.TABLE_NAME=T.TABLE_NAME
 WHERE T.OWNER=SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AND SUBSTR(T.TABLE_NAME,1,2)='PS' AND SUBSTR(T.TABLE_NAME,3,1)<>'_' AND C.COLUMN_NAME IN ('QRYNAME','PROJECTNAME') ORDER BY T.TABLE_NAME,C.COLUMN_NAME`)).rows!;
 const scoped=async()=>{const result:Record<string,unknown>={};for(const row of tables){assert.match(row.TABLE_NAME,/^[A-Z0-9_]+$/);const query=row.COLUMN_NAME==='QRYNAME',binds=query?{a:names.public,b:names.private}:{a:names.project,b:names.project};const columns=(await c.catalog.columns(c,row.TABLE_NAME)).filter(col=>row.TABLE_NAME!=='PSPROJECTDEFN'||!['TGTOPRID','TGTOPRACCT'].includes(col.name));const projection=columns.map(col=>/^(DATE|TIMESTAMP)/.test(col.dataType)?`TO_CHAR(CAST(${col.name} AS TIMESTAMP(9)),'YYYY-MM-DD"T"HH24:MI:SS.FF9') AS ${col.name}`:col.name).join(',');const rows=(await c.execute(`SELECT ${projection} FROM ${row.TABLE_NAME} WHERE ${row.COLUMN_NAME} IN (:a,:b)`,binds,{fetchInfo:Object.fromEntries(columns.filter(col=>/CLOB/.test(col.dataType)).map(col=>[col.name,{type:pool.types.STRING}]))})).rows!;if(rows.length)result[row.TABLE_NAME]=rows;}return result;};
 if(command==='seed'){
  assert.deepEqual(await scoped(),{},'A proposed fixture identity already has native rows.');
  await writeFile(file,JSON.stringify({names,operatorId,database:'HRDMO',tables})+'\n',{flag:'wx',mode:0o600});
  setWriteNamePrefix('ZZ_PCODE_LAB_D');await p.connect();
  const layout=await p.readRecordLayout(makeKey(DefinitionType.Record,'AAP_TBL')),field=layout!.fields.find(f=>f.name==='DESCR')!;assert.ok(field&&field.type===0&&field.length!==undefined);
  const info={type:field.type,length:field.length,decimalPositions:field.decimalPositions??0,format:6,shortName:field.shortName,longName:field.longName,editTable:field.editTable,useEdit:field.useEdit};
  for(const kind of ['public','private'] as const){let view=applyQueryOp(newQueryDocument(names[kind],kind==='public'?'':operatorId,'AAP_TBL'),{kind:'select',field:'DESCR',selected:true},{DESCR:info});view=applyQueryOp(view,{kind:'properties',description:'Native deletion calibration',comments:'Disposable Query deletion calibration'},{DESCR:info});await p.saveQueryDocument({view,openedToken:'absent',operatorId});}
  const project=await p.createProject({project:names.project,operatorId});await p.saveProject({project:names.project,operatorId,openedVersion:project.version,add:[makeKey(DefinitionType.Query,names.public),makeKey(DefinitionType.Query,names.private,operatorId)]});
  console.log(JSON.stringify({seeded:names}));
 }else{
  const manifest=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(manifest.names,names);assert.equal(manifest.operatorId,operatorId);assert.equal(manifest.database,'HRDMO');
  if(command==='enrich-private'){
   setWriteNamePrefix('ZZ_PCODE_LAB_D');await p.connect();
   const edit=await p.readQueryDocument(names.private,operatorId);assert.ok(edit);assert.equal(edit.view.criteria.length,0);
   const field=(await p.readRecordLayout(makeKey(DefinitionType.Record,'AAP_TBL')))!.fields.find(f=>f.name==='DESCR')!;
   assert.ok(field&&field.type===0&&field.length!==undefined);
   const info={type:field.type,length:field.length,decimalPositions:field.decimalPositions??0,format:6,shortName:field.shortName,longName:field.longName,editTable:field.editTable,useEdit:field.useEdit};
   const view=applyQueryOp(edit.view,{kind:'prompt',field:'DESCR'},{DESCR:info});
   await p.saveQueryDocument({view,openedToken:edit.token,operatorId});
   console.log('Owned private Query now includes criterion, expression and prompt rows.');
  }else if(command==='cleanup'){
   const allowed=new Set(['PSQRYDEFN','PSQRYSELECT','PSQRYRECORD','PSQRYFIELD','PSQRYCRITERIA','PSQRYEXPR','PSQRYBIND','PSQRYDEL','PSPROJECTDEFN','PSPROJECTITEM','PSPROJECTDEL']);
   for(const table of Object.keys(await scoped()))assert.ok(allowed.has(table),table+': an unexpected ancillary/reference row needs inspection, not automatic deletion.');
   assert.equal(Number((await c.execute<{N:number}>("SELECT COUNT(*) AS N FROM PSPROJECTITEM WHERE OBJECTTYPE=10 AND OBJECTVALUE1 IN (:a,:b) AND PROJECTNAME<>:p",{a:names.public,b:names.private,p:names.project})).rows![0].N),0,'A different project now references a fixture.');
   const cases=[];for(const name of ['qp01-native-project-delete','qp02-native-project-recreate','qp03-native-public-query-delete','qp04-native-public-query-recreate','qp05-native-private-query-delete','qp06-native-private-query-recreate']){
    const d=JSON.parse(await readFile('tools/corpus/save-protocol/results/'+name+'/delta.json','utf8'));assert.deepEqual(d.summary.incomplete,[]);assert.equal(d.nonLabRowsOmitted,true);assert.deepEqual(d.otherTables,{});cases.push({case:name,markers:d.markers,counters:d.summary.psversion,locks:d.summary.pslock,changed:d.summary.watchTablesChanged});
   }
   for(const row of tables.filter(t=>allowed.has(t.TABLE_NAME))){const query=row.COLUMN_NAME==='QRYNAME';await c.execute(`DELETE FROM ${row.TABLE_NAME} WHERE ${row.COLUMN_NAME} IN (:a,:b)`,query?{a:names.public,b:names.private}:{a:names.project,b:names.project});}await c.commit();assert.deepEqual(await scoped(),{});
   await writeFile('tools/lab/results/query-project-deletion-calibration-2026-10-20.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:'Actual Windows App Designer project deletion/native New recreation and Windows Query public/private deletion/native Save As recreation on HRDMO Oracle 8.62. Scoped rows and native markers/counters captured; nonlab row values omitted. This calibrates protocol, not implemented production deletion writers or reviewed creation reversal.',names,operatorId,cases,passed:true,cleanupVerified:true},null,2)+'\n');
   console.log('Every owned Query/project, ancillary and marker row is absent.');
  }else console.log(JSON.stringify({names,rows:await scoped(),versions:(await c.execute("SELECT OBJECTTYPENAME,VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('QDM','PJM','SYS') ORDER BY OBJECTTYPENAME")).rows,locks:(await c.execute("SELECT OBJECTTYPENAME,VERSION FROM PSLOCK WHERE OBJECTTYPENAME IN ('QDM','PJM') ORDER BY OBJECTTYPENAME")).rows},null,2));
 }
}catch(error){await c.rollback();throw error;}finally{await c.close();await pool.close();await p.dispose();}
