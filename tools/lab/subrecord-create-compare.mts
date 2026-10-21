/** Studio-created SubRecord vs App Designer's (capture sb01, ZZ_PCODE_LAB_SB): every row but name/version/stamps. */
import assert from 'node:assert/strict';
import {DatabaseProvider} from '../../src/providers/database.js';
import {openDatabase} from '../../src/db/open.js';
import {RecordType} from '../../src/model/record.js';
import {applyRecordOperations} from '../../src/model/recordOperations.js';
import {setWriteNamePrefix} from '../../src/providers/writeScope.js';
const config={name:'HRDMO subrecord compare',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};assert.match(config.connectString,/hrdmo/i);
const native='ZZ_PCODE_LAB_SB',studio='ZZ_PCODE_LAB_SC',operatorId=process.env.PSLAB_OPERATOR??'JARED';
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection();setWriteNamePrefix('ZZ_PCODE_LAB');
const rows=async(r:string)=>Object.fromEntries(await Promise.all(['PSRECDEFN','PSRECFIELD','PSRECFIELDDB','PSINDEXDEFN','PSKEYDEFN','PSRECTBLSPC'].map(async t=>[t,((await c.execute<Record<string,unknown>>(`SELECT * FROM ${t} WHERE RECNAME=:r`,{r},{outFormat:pool.types.OUT_FORMAT_OBJECT,fetchInfo:{DESCRLONG:{type:pool.types.STRING}}})).rows??[])
 .map(x=>JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k])=>!['VERSION','LASTUPDDTTM','LASTUPDOPRID'].includes(k)).map(([k,v])=>[k,v===r?'<NAME>':v]).sort()))).sort()])));
try{await p.connect();
 const edit=applyRecordOperations({recname:studio,recordType:RecordType.Subrecord,openedVersion:0,fields:[],isNew:true},RecordType.Subrecord,[{op:'insert_field',field:'DESCR'}]);
 await p.saveRecord({operatorId,edit});const a=await rows(native),b=await rows(studio);
 for(const t of Object.keys(a))if(JSON.stringify(a[t])!==JSON.stringify(b[t]))console.log('DIFF',t,'\n  AD    ',a[t].join('\n        '),'\n  Studio',b[t].join('\n        '));
 console.log(JSON.stringify(a)===JSON.stringify(b)?'IDENTICAL':'DIFFERENT');
}finally{for(const t of ['PSRECFIELDDB','PSRECFIELD','PSRECDEFN','PSRECDEL'])await c.execute(`DELETE FROM ${t} WHERE RECNAME=:n`,{n:studio});await c.commit();await c.close();await pool.close();await p.dispose();}
