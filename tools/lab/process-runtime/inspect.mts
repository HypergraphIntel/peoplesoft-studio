/** Read-only inspection of delivered PROCESSREQUEST operations and runtime metadata. Never reads credential columns. */
import {openDatabase} from '../../../src/db/open.js';
import {readIb} from '../../../src/providers/ibReader.js';
import {writeFile} from 'node:fs/promises';
const config={connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};
if(!/hrdmo/i.test(config.connectString))throw Error('Read-only HRDMO inspection only.');
const pool=await openDatabase('oracle',config),c=await pool.getConnection();
try{await c.execute('SET TRANSACTION READ ONLY');
const service=await readIb(c,pool.types,'service',['PROCESSREQUEST']);
const operations=[];for(const name of ['PRCS_SCHEDULE','PRCS_GETREQUEST','PRCS_GETREPORT','PRCS_FINDREQUESTS','PRCS_GETPROCESSNAMES','PRCS_GETPROMPT','PRCS_UPDATEREQUEST']){const doc=await readIb(c,pool.types,'operation',[name]);operations.push(doc);}
const q=async(sql:string)=>(await c.execute(sql,{}, {outFormat:pool.types.OUT_FORMAT_OBJECT,fetchTypeHandler:(m:{dbType?:unknown})=>m.dbType===pool.types.DB_TYPE_CLOB||m.dbType===pool.types.DB_TYPE_NCLOB?{type:pool.types.STRING}:undefined})).rows;
const report={at:new Date().toISOString(),service,operations,
 tables:await q("SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM ALL_TAB_COLUMNS WHERE OWNER=SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AND TABLE_NAME IN ('PSPRCSQUE','PSPRCSRQST','PS_CDM_LIST','PS_CDM_FILE_LIST','PS_AEREQUESTTBL','PS_PRCSRUNCNTL','PSIBSVCSETUP','PSIBWSDLDEFN') ORDER BY TABLE_NAME,COLUMN_ID"),
 serviceLocations:await q("SELECT IB_TGTLOCATION,IB_SECTGTLOCATION,IB_SVCSTATUS FROM PSIBSVCSETUP"),
 endpoints:await q("SELECT TABLE_NAME,COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER=SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AND (TABLE_NAME LIKE 'PSIBSVC%' OR TABLE_NAME LIKE 'PSIBWSDL%') ORDER BY TABLE_NAME,COLUMN_ID"),
 nativeCode:await q("SELECT OBJECTVALUE1,OBJECTVALUE2,OBJECTVALUE3,OBJECTVALUE4,PCTEXT FROM PSPCMTXT WHERE OBJECTID1=104 AND (OBJECTVALUE1 IN ('PRCS_SCHEDULE','PRCS_GETREQUEST','PRCS_GETREPORT','PRCS_FINDREQUESTS','PRCS_GETPROMPT','PT_PRCS','PROCESSREQUEST') OR OBJECTVALUE2 IN ('PRCS_SCHEDULE','PRCS_GETREQUEST','PRCS_GETREPORT')) ORDER BY OBJECTVALUE1,OBJECTVALUE2,OBJECTVALUE3,PROGSEQ")};
await writeFile('/tmp/psft-process-runtime-inspection.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({file:'/tmp/psft-process-runtime-inspection.json',service:!!service,operations:operations.map(d=>d?{key:d.key,active:d.properties.IB_OPERATIONACTIVE,version:d.properties.DEFAULTVER,sections:Object.keys(d.sections)}:null),nativeCodeRows:report.nativeCode?.length},null,2));
}finally{await c.rollback();await c.close();await pool.close();}
