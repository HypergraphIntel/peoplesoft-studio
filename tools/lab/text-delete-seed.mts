/** Disposable native deletion calibration setup. Refuses every pre-existing row. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { openDatabase } from '../../src/db/open.js';
import { saveSqlDefinition } from '../../src/providers/sqlWriter.js';
import { saveHtmlDefinition } from '../../src/providers/htmlWriter.js';
import { saveStyleSheet } from '../../src/providers/styleSheetWriter.js';
import { setWriteNamePrefix } from '../../src/providers/writeScope.js';
import { readSqlMigration } from '../../src/providers/sqlSnapshot.js';
const names={sql:'ZZ_PCODE_LAB_DSQ7',html:'ZZ_PCODE_LAB_DHT7',stylesheet:'ZZ_PCODE_LAB_DCS7'};
const pool=await openDatabase('oracle',{connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!});
const c=await pool.getConnection(),operatorId=process.env.PSLAB_OPERATOR??'JARED';
const finish=process.argv.includes('--finish');
try {
 const db=(await c.execute<{DB:string}>("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL")).rows![0].DB;assert.equal(db.toUpperCase(),'HRDMO');
 setWriteNamePrefix('ZZ_PCODE_LAB_D');
 if(finish){const previous=JSON.parse(await readFile('/tmp/psft-text-delete-lab.json','utf8'));assert.deepEqual(previous.names,names);assert.equal(previous.database,db);const live=await readSqlMigration(c,pool.types,names.sql);assert.deepEqual(live?.data,{name:names.sql,text:'SELECT 7 FROM PS_INSTALLATION',description:'Native deletion calibration',definition:'Disposable standalone SQL',ownerId:''});}
 for(const [kind,name] of Object.entries(names)) {
  if(finish&&kind==='sql')continue;
  const scope=kind==='sql'?['PSSQLDEFN','PSSQLDESCR','PSSQLTEXTDEFN','PSSQLHASH','PSSQLLANG','PSSQLDEL']:['PSCONTDEFN','PSCONTENT','PSCONTDEFNLANG','PSCONTENTLANG','PSCONTDEL'];
  for(const table of scope)assert.equal(Number((await c.execute<{N:number}>(`SELECT COUNT(*) AS N FROM ${table} WHERE ${kind==='sql'?'SQLID':'CONTNAME'}=:n`,{n:name})).rows![0].N),0,table+' is not vacant');
  if(kind!=='sql')for(const table of ['PSSTYLSHEETDEFN','PSSTYLSHEETDEL','PSSTYLECLASS'])assert.equal(Number((await c.execute<{N:number}>(`SELECT COUNT(*) AS N FROM ${table} WHERE STYLESHEETNAME=:n`,{n:name})).rows![0].N),0,table+' is not vacant');
 }
 if(!finish){await writeFile('/tmp/psft-text-delete-lab.json',JSON.stringify({database:db,names,operatorId})+'\n',{flag:'wx',mode:0o600});
 await saveSqlDefinition(c,{sqlId:names.sql,text:'SELECT 7 FROM PS_INSTALLATION',operatorId,metadata:{description:'Native deletion calibration',definition:'Disposable standalone SQL',ownerId:''}},pool.types);}
 await saveHtmlDefinition(c,pool.types.BLOB,{name:names.html,text:'<div>Native deletion calibration</div>',description:'Native deletion calibration',operatorId});
 await saveStyleSheet(c,pool.types.BLOB,{name:names.stylesheet,text:'.nativeDelete { color: blue; }',description:'Native deletion calibration',operatorId});
 console.log(JSON.stringify({seeded:names}));
}finally{await c.close();await pool.close();}
