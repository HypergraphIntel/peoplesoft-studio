/** Read-only: every row of one lab record in the record/index tables, AS OF a capture's before SCN and now. */
import assert from 'node:assert/strict';
import oracledb from 'oracledb';
const [recname,scn,out]=process.argv.slice(2);assert.ok(recname?.startsWith('ZZ_')&&/^\d+$/.test(scn??''));
const c=await oracledb.getConnection({connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID,password:process.env.PSLAB_ACCESSPSWD});
const tables=['PSRECDEFN','PSRECFIELD','PSRECFIELDDB','PSINDEXDEFN','PSKEYDEFN','PSIDXDDLPARM','PSRECTBLSPC','PSRECDDLPARM','PSRECDEL'];
const read=async(t:string,asOf:string)=>((await c.execute(`SELECT * FROM ${t}${asOf} WHERE RECNAME=:r`,{r:recname},{outFormat:oracledb.OUT_FORMAT_OBJECT,fetchInfo:{DESCRLONG:{type:oracledb.STRING},IDXCOMMENTS:{type:oracledb.STRING}}})).rows??[])
 .map(r=>JSON.stringify(r,(_k,v)=>v instanceof Date?v.toISOString():v)).sort();
const result:Record<string,unknown>={recname,beforeScn:scn,tables:{}};
for(const t of tables){const b=await read(t,` AS OF SCN ${scn}`),a=await read(t,'');(result.tables as Record<string,unknown>)[t]={before:b.filter(r=>!a.includes(r)).map(r=>JSON.parse(r)),after:a.filter(r=>!b.includes(r)).map(r=>JSON.parse(r)),unchanged:b.filter(r=>a.includes(r)).length};}
const text=JSON.stringify(result,null,1);if(out)await (await import('node:fs/promises')).writeFile(out,text+'\n');console.log(text);await c.close();
