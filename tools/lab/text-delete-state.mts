/** Read-only observation of the owned native deletion calibration fixtures. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openDatabase } from '../../src/db/open.js';
const manifest=JSON.parse(await readFile('/tmp/psft-text-delete-lab.json','utf8'));
const pool=await openDatabase('oracle',{connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!}),c=await pool.getConnection();
try{
 const db=(await c.execute<{DB:string}>("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL")).rows![0].DB;assert.equal(db.toUpperCase(),'HRDMO');assert.equal(manifest.database,db);
 const states:Record<string,unknown>={};
 for(const [kind,name] of Object.entries(manifest.names) as [string,string][]){
  assert.match(name,/^ZZ_PCODE_LAB_D(?:SQ|HT|CS)7$/);
  const table=kind==='sql'?'PSSQLDEFN':kind==='html'?'PSCONTDEFN':'PSSTYLSHEETDEFN',column=kind==='sql'?'SQLID':kind==='html'?'CONTNAME':'STYLESHEETNAME';
  const heads=(await c.execute(`SELECT VERSION FROM ${table} WHERE ${column}=:n`,{n:name})).rows!;
  const markerTable=kind==='sql'?'PSSQLDEL':kind==='html'?'PSCONTDEL':'PSSTYLSHEETDEL';
  const markers=(await c.execute(`SELECT VERSION FROM ${markerTable} WHERE ${column}=:n`,{n:name})).rows!;
  const contentMarkers=kind==='stylesheet'?(await c.execute('SELECT VERSION FROM PSCONTDEL WHERE CONTNAME=:n',{n:name})).rows!:undefined;
  if(process.argv[2]===kind&&process.argv[3])assert.equal(heads.length,process.argv[3]==='present'?1:0,kind+' native persistence is not yet confirmed');
  states[kind]={name,heads,markers,...(contentMarkers?{contentMarkers}:{})};
 }
 console.log(JSON.stringify(states));
}finally{await c.close();await pool.close();}
