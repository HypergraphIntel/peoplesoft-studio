/** Noncredential HRDMO report-node fields and the two original native report rows. Read only. */
import oracledb from 'oracledb';
import {writeFile} from 'node:fs/promises';
const connectString=process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo';if(!/hrdmo/i.test(connectString))throw Error('HRDMO only');
const c=await oracledb.getConnection({user:process.env.PSLAB_ACCESSID,password:process.env.PSLAB_ACCESSPSWD,connectString});
try{
 await c.execute('SET TRANSACTION READ ONLY');
 const q=async(sql:string)=>(await c.execute(sql,{}, {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows as Record<string,any>[];
 const columns=await q("SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER='SYSADM' AND TABLE_NAME='PS_CDM_DIST_NODE' ORDER BY COLUMN_ID");
 const names=columns.map(r=>String(r.COLUMN_NAME)).filter(n=>/^[A-Z0-9_]+$/.test(n)&&/URI|URL|HOST|PORT|PROTCOL|DISTNODE|TRANSFER/.test(n)&&!/PASS|TOKEN|SECRET|KEY|AUTH|USER|OPRID/.test(n));
 const report={checkedAt:new Date().toISOString(),columns:columns.map(r=>r.COLUMN_NAME),node:await q(`SELECT ${names.join(',')} FROM SYSADM.PS_CDM_DIST_NODE WHERE DISTNODENAME='REPORTS_HCMDMO'`),
  protocolValues:await q("SELECT FIELDNAME,FIELDVALUE,XLATLONGNAME FROM SYSADM.PSXLATITEM WHERE FIELDNAME IN ('PT_TRANSFR_PROTCOL','URI_SCHEME') ORDER BY FIELDNAME,FIELDVALUE"),
  peopleCode:await q("SELECT DISTINCT OBJECTID1,OBJECTVALUE1,OBJECTID2,OBJECTVALUE2,OBJECTID3,OBJECTVALUE3 FROM SYSADM.PSPCMPROG WHERE OBJECTVALUE1 IN ('CDM_DIST_NODE','CDM_DIST_NODE2','CDM_DIST_NODE_WRK') ORDER BY OBJECTVALUE1,OBJECTVALUE2,OBJECTVALUE3"),
  reports:await q("SELECT PRCSINSTANCE,CONTENTID,DISTSTATUS,DISTNODENAME,OUTPUTDIR FROM SYSADM.PS_CDM_LIST WHERE PRCSINSTANCE IN (607265,607266)")};
 await writeFile('/tmp/psft-report-delivery-diagnosis.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report,null,2));
}finally{await c.rollback();await c.close();}
