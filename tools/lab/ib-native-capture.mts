/** SELECT-only snapshots around native saves of ZZ_IB_* fixtures; no credential columns. */
import oracledb from 'oracledb';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const output=process.argv[2];if(!output)throw new Error('Give a snapshot output path.');
oracledb.outFormat=oracledb.OUT_FORMAT_OBJECT;oracledb.fetchAsBuffer=[oracledb.BLOB];
const c=await oracledb.getConnection({user:process.env.PSLAB_ACCESSID,password:process.env.PSLAB_ACCESSPSWD,connectString:'127.0.0.1:15210/hrdmo'});
try{
 await c.execute('SET TRANSACTION READ ONLY');
 const q=async(sql:string,binds:Record<string,unknown>={})=>(await c.execute<Record<string,unknown>>(sql,binds,{fetchTypeHandler:m=>m.dbType===oracledb.DB_TYPE_CLOB?{type:oracledb.STRING}:undefined})).rows??[];
 const [id]=await q("SELECT SYS_CONTEXT('USERENV','DB_NAME') AS DB FROM DUAL");if(id.DB!=='HRDMO')throw new Error('HRDMO only.');
 const tables=await q("SELECT DISTINCT TABLE_NAME FROM ALL_TAB_COLUMNS WHERE OWNER='SYSADM' AND COLUMN_NAME IN ('IB_SERVICENAME','IB_OPERATIONNAME','MSGNAME','MSGNODENAME','ROUTINGDEFNNAME','IB_PACKAGEID') AND TABLE_NAME NOT LIKE '%VW%' AND TABLE_NAME NOT LIKE '%LANG%' AND TABLE_NAME NOT LIKE '%LOG%' ORDER BY TABLE_NAME");
 const stored:Record<string,unknown[]>={};
 for(const {TABLE_NAME:t} of tables){
  const cols=await q('SELECT COLUMN_NAME,DATA_TYPE FROM ALL_TAB_COLUMNS WHERE OWNER=\'SYSADM\' AND TABLE_NAME=:t ORDER BY COLUMN_ID',{t});
  const keys=cols.filter(x=>['IB_SERVICENAME','IB_OPERATIONNAME','MSGNAME','MSGNODENAME','ROUTINGDEFNNAME','IB_PACKAGEID'].includes(String(x.COLUMN_NAME)));
  const selected=cols.filter(x=>(!/PASSWORD|PASSWD|PWD|SECRET|TOKEN|CREDENTIAL|PRIVATE/i.test(String(x.COLUMN_NAME)) || ['TOKENTYPE','TOKEN_ENCRYPTED','TOKEN_SIGNED','IB_USERPWDREQ','IB_EXCLUDE_TOKEN','CHECKTOKENID','IB_ISPRIVATE'].includes(String(x.COLUMN_NAME))));
  const rr=await q(`SELECT ${selected.map(x=>x.COLUMN_NAME).join(',')} FROM ${t} WHERE ${keys.map(x=>`${x.COLUMN_NAME} LIKE 'ZZ_IB_%'`).join(' OR ')}`);
  stored[String(t)]=rr.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,k==='PROPVALUE'&& /PASSWORD|PASSWD|PWD|SECRET|TOKEN|CREDENTIAL|PRIVATE/i.test(String(r.PROPNAME)+' '+String(r.PROPID))?'(not captured)':Buffer.isBuffer(v)?{bytes:v.length,sha256:createHash('sha256').update(v).digest('hex'),base64:v.toString('base64')}:v])));
 }
 const counters=await q('SELECT OBJECTTYPENAME,VERSION FROM PSVERSION ORDER BY OBJECTTYPENAME');
 const locks=await q('SELECT OBJECTTYPENAME,VERSION FROM PSLOCK ORDER BY OBJECTTYPENAME');
 const snapshot={database:id.DB,at:new Date().toISOString(),counters,locks,stored};writeFileSync(output,JSON.stringify(snapshot,null,2)+'\n');console.log(JSON.stringify({output,rows:Object.fromEntries(Object.entries(stored).filter(([,v])=>v.length).map(([k,v])=>[k,v.length]))}));
}finally{await c.rollback();await c.close();}
