/** Read-only: one lab definition's rows in its native tables, AS OF a capture's before SCN and now. Usage: <kind> <name> <scn> [out.json] */
import assert from 'node:assert/strict';
import oracledb from 'oracledb';
const [kind,name,scn,out]=process.argv.slice(2);assert.ok(name?.startsWith('ZZ_')&&/^\d+$/.test(scn??''));
const pcm=(id:number):[string,string]=>['PSPCMPROG',`OBJECTID1=${id} AND OBJECTVALUE1=:n`];
const specs:Record<string,[string,string][]>={
 page:[...['PSPNLDEFN','PSPNLFIELD','PSPNLFIELDEXT','PSPNLHTMLAREA','PSPNLHTMLLANG','PSPTPNLRTEDITOR','PSPNLCNTRLDATA','PSPNLBTNDATA','PSPNLACEGRDDATA','PSPNLACEGRDAXIS','PSPNLTREECTRL','PSPNLDEFNLANG','PSPNLFIELDLANG','PSPNLDEL','PSPNLGROUP'].map(t=>[t,'PNLNAME=:n'] as [string,string]),
  pcm(9),['PSPCMTXT','OBJECTID1=9 AND OBJECTVALUE1=:n'],['PSPCMNAME','OBJECTID1=9 AND OBJECTVALUE1=:n'],['PSPCMPROGDEL','OBJECTID1=9 AND OBJECTVALUE1=:n'],['PSPROJECTITEM','OBJECTVALUE1=:n']],
 component:[...['PSPNLGRPDEFN','PSPNLGROUP','PSPNLGRPDEFNEXT','PSPNLGRPSCRIPTS','PSPNLGDEFNLANG','PSPNLGROUPLANG','PSPNLGRPDEL','PSMENUITEM'].map(t=>[t,'PNLGRPNAME=:n'] as [string,string]),
  ['PSAUTHITEM','BARITEMNAME=:n'],pcm(10),['PSPCMTXT','OBJECTID1=10 AND OBJECTVALUE1=:n'],['PSPCMNAME','OBJECTID1=10 AND OBJECTVALUE1=:n'],['PSPCMPROGDEL','OBJECTID1=10 AND OBJECTVALUE1=:n'],['PSPROJECTITEM','OBJECTVALUE1=:n']],
 field:[...['PSDBFIELD','PSDBFLDLABL','PSDBFIELDLANG','PSDBFLDLABLLANG','PSXLATITEM','PSXLATITEMLANG','PSXLATDEFN','PSXLATDEFNDEL','PSRECFIELD'].map(t=>[t,'FIELDNAME=:n'] as [string,string]),['PSPROJECTITEM','OBJECTVALUE1=:n']],
 package:[['PSPACKAGEDEFN','PACKAGEROOT=:n'],['PSAPPCLASSDEFN','PACKAGEROOT=:n'],['PSPACKAGEDEL','PACKAGEROOT=:n'],pcm(104),['PSPCMTXT','OBJECTID1=104 AND OBJECTVALUE1=:n'],['PSPCMNAME','OBJECTID1=104 AND OBJECTVALUE1=:n'],['PSPCMPROGDEL','OBJECTID1=104 AND OBJECTVALUE1=:n'],['PSPROJECTITEM','OBJECTVALUE1=:n OR OBJECTVALUE2=:n']]
};
assert.ok(specs[kind],'kind: '+Object.keys(specs).join('|'));
const c=await oracledb.getConnection({connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID,password:process.env.PSLAB_ACCESSPSWD});
const exists=async(t:string)=>((await c.execute<{N:number}>('SELECT COUNT(*) AS N FROM USER_TABLES WHERE TABLE_NAME=:t',{t},{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows![0] as {N:number}).N>0;
const read=async(t:string,where:string,asOf:string)=>((await c.execute(`SELECT * FROM ${t}${asOf} WHERE ${where}`,{n:name},{outFormat:oracledb.OUT_FORMAT_OBJECT,fetchInfo:{DESCRLONG:{type:oracledb.STRING},HTMLAREA:{type:oracledb.STRING},FFSTYLELONG:{type:oracledb.STRING},PCTEXT:{type:oracledb.STRING},PROGTXT:{type:oracledb.BUFFER}}})).rows??[])
 .map(r=>JSON.stringify(r,(_k,v)=>v instanceof Date?v.toISOString():Buffer.isBuffer(v)?'hex:'+v.toString('hex'):v)).sort();
const result:Record<string,unknown>={kind,name,beforeScn:scn,tables:{}};
for(const [t,where] of specs[kind]){if(!await exists(t))continue;const b=await read(t,where,` AS OF SCN ${scn}`),a=await read(t,where,'');
 (result.tables as Record<string,unknown>)[t]={before:b.filter(r=>!a.includes(r)).map(r=>JSON.parse(r)),after:a.filter(r=>!b.includes(r)).map(r=>JSON.parse(r)),unchanged:b.filter(r=>a.includes(r)).length};}
const text=JSON.stringify(result,null,1);if(out)await (await import('node:fs/promises')).writeFile(out,text+'\n');
for(const [t,v] of Object.entries(result.tables as Record<string,{before:unknown[];after:unknown[];unchanged:number}>))if(v.before.length||v.after.length)console.log(t,'removed',v.before.length,'added',v.after.length,'kept',v.unchanged);
await c.close();
