/** Remove only the verified, disposable fixtures owned by text-delete-seed.mts. */
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { openDatabase } from '../../src/db/open.js';
import { readSqlMigration } from '../../src/providers/sqlSnapshot.js';
import { readContentMigration } from '../../src/providers/contentMigration.js';
const manifest=JSON.parse(await readFile('/tmp/psft-text-delete-lab.json','utf8'));
assert.deepEqual(manifest.names,{sql:'ZZ_PCODE_LAB_DSQ7',html:'ZZ_PCODE_LAB_DHT7',stylesheet:'ZZ_PCODE_LAB_DCS7'});assert.equal(manifest.project,'ZZ_PCODE_LAB_DPR7');
const cases=['td01-native-sql-delete','td02-native-html-delete','td03-native-css-delete','td04-native-sql-recreate','td05-native-html-recreate','td06-native-css-recreate'];
const evidence=[];
for(const name of cases){const d=JSON.parse(await readFile('tools/corpus/save-protocol/results/'+name+'/delta.json','utf8'));assert.deepEqual(d.summary.incomplete,[]);assert.ok(Object.keys(d.watch).length>0);evidence.push({case:name,markers:d.markers,counters:d.summary.psversion,locks:d.summary.pslock});}
const pool=await openDatabase('oracle',{connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!}),c=await pool.getConnection();
try{
 assert.equal((await c.execute<{DB:string}>("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL")).rows![0].DB.toUpperCase(),'HRDMO');
 const s=await readSqlMigration(c,pool.types,manifest.names.sql);assert.deepEqual(s?.data,{name:manifest.names.sql,text:'SELECT 7 FROM PS_INSTALLATION',description:'',definition:'',ownerId:''});
 for(const [kind,text] of [['html','<div>Native deletion calibration</div>'],['stylesheet','.nativeDelete { color: blue; }']] as const){const r=await readContentMigration(c,manifest.names[kind],kind);assert.deepEqual(r?.data,{name:manifest.names[kind],text,description:''});}
 for(const n of Object.values(manifest.names))assert.equal(Number((await c.execute<{N:number}>('SELECT COUNT(*) AS N FROM PSPROJECTITEM WHERE OBJECTVALUE1=:n',{n})).rows![0].N),0,'A project now references this fixture; inspect instead of deleting.');
 const scopes:[string,string,string][]=[];
 for(const t of ['PSSQLDEFN','PSSQLDESCR','PSSQLTEXTDEFN','PSSQLHASH','PSSQLLANG','PSSQLDEL'])scopes.push([t,'SQLID',manifest.names.sql]);
 for(const kind of ['html','stylesheet']){
  for(const t of ['PSCONTDEFN','PSCONTENT','PSCONTDEFNLANG','PSCONTENTLANG','PSCONTDEL'])scopes.push([t,'CONTNAME',manifest.names[kind]]);
  for(const t of ['PSSTYLSHEETDEFN','PSSTYLSHEETDEL','PSSTYLECLASS'])scopes.push([t,'STYLESHEETNAME',manifest.names[kind]]);
 }
 for(const t of ['PSPROJECTITEM','PSPROJECTDEFN'])scopes.push([t,'PROJECTNAME',manifest.project]);
 for(const [t,k,n] of scopes)await c.execute(`DELETE FROM ${t} WHERE ${k}=:n`,{n});await c.commit();
 for(const [t,k,n] of scopes)assert.equal(Number((await c.execute<{N:number}>(`SELECT COUNT(*) AS N FROM ${t} WHERE ${k}=:n`,{n})).rows![0].N),0,t+' cleanup failed');
 await writeFile('tools/lab/results/text-deletion-calibration-2026-10-20.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:'Actual Windows App Designer / HRDMO Oracle 8.62 deletion and native recreation of disposable SQLTYPE 0, HTML and freeform stylesheet definitions. Native scoped rows, tombstones and counters are captured. Nonlab row values omitted; global table-count observations retained. Production deletion writers and reviewed integration are not yet implemented.',names:manifest.names,project:manifest.project,cases:evidence,passed:true,cleanupVerified:true},null,2)+'\n');
 console.log('Six native captures retained; every owned definition, child, marker and project row is absent.');
}catch(error){await c.rollback();throw error;}finally{await c.close();await pool.close();}
