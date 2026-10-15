import type { DbConnection, DbTypes } from '../db/connection.js';
import type { ProcessView } from '../model/processDefinition.js';
import { processEdit, processToken, processValue, validateProcessEdit, type ProcessEdit } from '../model/processEdit.js';
import { writeScopeRefusal } from './writeScope.js';
export interface ProcessSaveRequest { key: string[]; token: string; edit: ProcessEdit; operatorId: string; dryRun?: boolean }
/** Native PRCSDEFN SavePreChange/SavePostChange and FUNCLIB_PSM: PPC=max(version,lock)+1; SYS twice (component UpdateSysVersion, then UpdateSysObject). */
export async function saveProcess(c: DbConnection, types: DbTypes, request: ProcessSaveRequest, read: (c: DbConnection)=>Promise<ProcessView>): Promise<ProcessView> {
  const [t,n]=request.key, binds={t,n};
  const q=async <T>(sql:string,b:Record<string,unknown>={})=>(await c.execute<T>(sql,b,{outFormat:types.OUT_FORMAT_OBJECT})).rows??[];
  const run=async(sql:string,b:Record<string,unknown>,count:number)=>{if((await c.execute(sql,b)).rowsAffected!==count)throw new Error('Process save affected an unexpected number of rows.');};
  try {
    const scope=writeScopeRefusal(n); if(scope)throw new Error(scope);
    if (!(await q('SELECT OPRID FROM PSOPRDEFN WHERE OPRID=:o',{o:request.operatorId})).length)throw new Error('A valid PeopleSoft Operator ID is required.');
    const counters=await q<{OBJECTTYPENAME:string;VERSION:number}>("SELECT OBJECTTYPENAME,VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('PPC','SYS') ORDER BY OBJECTTYPENAME FOR UPDATE");
    const locks=await q<{VERSION:number}>("SELECT VERSION FROM PSLOCK WHERE OBJECTTYPENAME='PPC' FOR UPDATE");
    await q('SELECT PRCSNAME FROM PS_PRCSDEFN WHERE PRCSTYPE=:t AND PRCSNAME=:n FOR UPDATE',binds);
    const before=await read(c);
    if(processToken(before)!==request.token)throw new Error('Process definition changed since it was opened. Revert or reopen before saving.');
    const edit=validateProcessEdit(request.edit,before), old=processEdit(before);
    const props=edit.properties;
    const [type]=await q<{GENPRCSTYPE:number}>('SELECT GENPRCSTYPE FROM PS_PRCSTYPEDEFN WHERE PRCSTYPE=:t',{t});
    if(props.OUTDESTTYPE!==old.properties.OUTDESTTYPE && ![1,2,3,5,7].includes(Number(type?.GENPRCSTYPE)))throw new Error('This process type does not support output destination overrides.');
    if(props.OUTDESTTYPE!==old.properties.OUTDESTTYPE && ['1','4'].includes(props.OUTDESTTYPE)){props.OUTDESTSRC='0';props.OUTDEST='';}
    if(props.OUTDESTSRC!==old.properties.OUTDESTSRC && props.OUTDESTSRC==='0')props.OUTDEST='';
    for(const [mode,value] of [['PARMLISTTYPE','PARMLIST'],['CMDLINETYPE','CMDLINE'],['WORKINGDIRTYPE','WORKINGDIR']])if(props[mode]==='0' && props[value]!==old.properties[value] && props[value])throw new Error('Choose an override mode before entering '+value+'.');
    if(props.OUTDEST!==old.properties.OUTDEST && props.OUTDEST && props.OUTDESTSRC!=='2')throw new Error('Choose Process Definition as the destination source before editing the destination.');
    if(JSON.stringify(edit)===JSON.stringify(old)){await c.rollback();return before;}
    for(const [list,table,field,prompt] of [['components','PS_PRCSDEFNPNL','PNLGRPNAME','PSPNLGRPDEFN'],['groups','PS_PRCSDEFNGRP','PRCSGRP','']] as const){
      for(const value of edit[list].filter(v=>!old[list].includes(v)))if(prompt && !(await q(`SELECT ${field} FROM ${prompt} WHERE ${field}=:v`,{v:value})).length)throw new Error(`Unknown ${list}: ${value}`);
      // Only changed associations are touched; other stored rows remain intact.
      for(const value of old[list].filter(v=>!edit[list].includes(v)))await run(`DELETE FROM ${table} WHERE PRCSTYPE=:t AND PRCSNAME=:n AND ${field}=:v`,{...binds,v:value},1);
      for(const value of edit[list].filter(v=>!old[list].includes(v)))await run(`INSERT INTO ${table} (PRCSTYPE,PRCSNAME,${field}) VALUES (:t,:n,:v)`,{...binds,v:value},1);
    }
    const p=edit.properties;
    for(const [field,table] of [['SERVERNAME','PS_SERVERDEFN'],['RECURNAME','PS_PRCSRECUR'],['PRCSCATEGORY','PS_PRCS_CAT_TBL']] as const)if(p[field] && p[field]!==old.properties[field] && !(await q(`SELECT ${field} FROM ${table} WHERE ${field}=:v`,{v:p[field]})).length)throw new Error(`Unknown ${field}: ${p[field]}`);
    if(p.RECVRYPRCSTYPE||p.RECVRYPRCSNAME)if(!(await q('SELECT PRCSNAME FROM PS_PRCSDEFN WHERE PRCSTYPE=:t AND PRCSNAME=:n',{t:p.RECVRYPRCSTYPE,n:p.RECVRYPRCSNAME})).length)throw new Error('Recovery process does not exist.');
    if(p.RUNLOCATION==='2'&&!p.SERVERNAME&&(await q<{OPSYS:string}>('SELECT OPSYS FROM PS_PRCSSYSTEM')).some(r=>String(r.OPSYS).trim()==='1'))throw new Error('A server is required for the configured operating system.');
    if(p.SERVERNAME&&p.PRCSCATEGORY){const category=await q<{MAXCONCURRENT:number}>('SELECT MAXCONCURRENT FROM PS_SERVERCATEGORY WHERE SERVERNAME=:s AND PRCSCATEGORY=:g',{s:p.SERVERNAME,g:p.PRCSCATEGORY});if(!category.length||category.some(r=>Number(r.MAXCONCURRENT)===0))throw new Error('Invalid server / process category.');}
    const ppc=counters.find(r=>r.OBJECTTYPENAME.trim()==='PPC'),sys=counters.find(r=>r.OBJECTTYPENAME.trim()==='SYS');
    if(!ppc||!sys||locks.length!==1)throw new Error('Process Scheduler version counters are missing.');
    const version=Math.max(Number(ppc.VERSION),Number(locks[0].VERSION))+1;
    const assignments:string[]=[],values:Record<string,unknown>={...binds,v:version,o:request.operatorId};
    for(const [field,value] of Object.entries(p))if(value!==old.properties[field]){const b='p'+assignments.length;values[b]=typeof before.process[field]==='number'?Number(value):value||' ';assignments.push(`${field}=:${b}`);}
    assignments.push('VERSION=:v','LASTUPDOPRID=:o','LASTUPDDTTM=SYSTIMESTAMP');
    await run(`UPDATE PS_PRCSDEFN SET ${assignments.join(',')} WHERE PRCSTYPE=:t AND PRCSNAME=:n`,values,1);
    await run("UPDATE PSVERSION SET VERSION=:v WHERE OBJECTTYPENAME='PPC'",{v:version},1);
    await run("UPDATE PSLOCK SET VERSION=:v WHERE OBJECTTYPENAME='PPC'",{v:version},1);
    await run("UPDATE PSVERSION SET VERSION=VERSION+2 WHERE OBJECTTYPENAME='SYS'",{},1);
    if(p.OUTDESTSRC!==old.properties.OUTDESTSRC && p.OUTDESTSRC!=='2')await c.execute('DELETE FROM PS_PRCSDEFNCNTDIST WHERE PRCSTYPE=:t AND PRCSNAME=:n',binds);
    const after=await read(c),actual=processEdit(after);
    if(JSON.stringify({...actual,components:actual.components.sort(),groups:actual.groups.sort()})!==JSON.stringify({...edit,components:[...edit.components].sort(),groups:[...edit.groups].sort()}) || Number(after.process.VERSION)!==version || processValue(after.process.LASTUPDOPRID)!==request.operatorId)throw new Error('Process save failed readback verification.');
    for(const [field,value] of Object.entries(before.process))if(!['VERSION','LASTUPD','LASTUPDDTTM','LASTUPDOPRID',...Object.keys(p)].includes(field) && JSON.stringify(after.process[field])!==JSON.stringify(value))throw new Error('An unrelated process property changed during save: '+field);
    const checkCounters=await q<{OBJECTTYPENAME:string;VERSION:number}>("SELECT OBJECTTYPENAME,VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN ('PPC','SYS') ORDER BY OBJECTTYPENAME");
    const checkLocks=await q<{VERSION:number}>("SELECT VERSION FROM PSLOCK WHERE OBJECTTYPENAME='PPC'");
    if(Number(checkCounters.find(r=>r.OBJECTTYPENAME.trim()==='PPC')?.VERSION)!==version || Number(checkCounters.find(r=>r.OBJECTTYPENAME.trim()==='SYS')?.VERSION)!==Number(sys.VERSION)+2 || Number(checkLocks[0]?.VERSION)!==version)throw new Error('Process version counters failed verification.');
    if(request.dryRun)await c.rollback();else await c.commit();
    return after;
  }catch(e){await c.rollback();throw e;}
}
