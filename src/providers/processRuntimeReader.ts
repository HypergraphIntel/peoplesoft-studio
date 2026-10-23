import {createHash} from 'node:crypto';
import type {DbConnection,DbTypes} from '../db/connection.js';
import type {RuntimeRequest} from '../processRuntime/protocol.js';
import {validateRuntimeRequest} from '../processRuntime/protocol.js';
export interface RuntimeRunControl {id:string; aeProgram?:string; frequency?:string;}
export interface RuntimeMetadata {endpoint:string; operatorId:string; runControls:RuntimeRunControl[];}
export interface RuntimeBaseline {token:string; identity:string; description:string; control:RuntimeRunControl; lastInstance:number;}
const text=(v:unknown)=>String(v??'').trim();
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function readRuntimeMetadata(c:DbConnection,types:DbTypes,operatorId:string):Promise<RuntimeMetadata>{
 if(!operatorId.trim())throw Error('Configure a PeopleSoft Operator ID for this connection.');
 const locations=(await c.execute<{IB_SECTGTLOCATION:string}>('SELECT IB_SECTGTLOCATION FROM PSIBSVCSETUP ORDER BY SEQNO')).rows??[];
 const controls=(await c.execute<{RUN_CNTL_ID:string;AE_APPLID:string|null;PROCESS_FREQUENCY:string|null}>(`SELECT R.RUN_CNTL_ID,A.AE_APPLID,A.PROCESS_FREQUENCY FROM
 (SELECT RUN_CNTL_ID FROM PS_PRCSRUNCNTL WHERE OPRID=:o UNION SELECT RUN_CNTL_ID FROM PS_AEREQUESTTBL WHERE OPRID=:o) R
 LEFT JOIN PS_AEREQUESTTBL A ON A.OPRID=:o AND A.RUN_CNTL_ID=R.RUN_CNTL_ID ORDER BY R.RUN_CNTL_ID FETCH FIRST 1000 ROWS ONLY`,{o:operatorId},{outFormat:types.OUT_FORMAT_OBJECT})).rows??[];
 return {endpoint:text(locations[0]?.IB_SECTGTLOCATION),operatorId,runControls:controls.map(r=>({id:text(r.RUN_CNTL_ID),...(text(r.AE_APPLID)?{aeProgram:text(r.AE_APPLID),frequency:text(r.PROCESS_FREQUENCY)}:{})}))};
}
export async function runtimeBaseline(c:DbConnection,types:DbTypes,operatorId:string,raw:RuntimeRequest):Promise<RuntimeBaseline>{
 const request=validateRuntimeRequest(raw),options={outFormat:types.OUT_FORMAT_OBJECT};
 const identity=(await c.execute(`SELECT SYS_CONTEXT('USERENV','DB_UNIQUE_NAME') AS DB, SYS_CONTEXT('USERENV','CON_NAME') AS CONTAINER,SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS SCHEMA FROM DUAL`,{},options)).rows?.[0];
 const process=(await c.execute(`SELECT PRCSTYPE,PRCSNAME,VERSION,DESCR,TO_CHAR(LASTUPDDTTM,'YYYY-MM-DD"T"HH24:MI:SS.FF6') AS UPDATED FROM PS_PRCSDEFN WHERE PRCSTYPE='Application Engine' AND PRCSNAME=:p`,{p:request.process},options)).rows?.[0] as Record<string,unknown>|undefined;
 const ae=(await c.execute('SELECT AE_APPLID,VERSION FROM PSAEAPPLDEFN WHERE AE_APPLID=:p',{p:request.process},options)).rows?.[0];
 if(!process||!ae)throw Error('This Application Engine process and program must both exist before running.');
 const control=(await c.execute('SELECT OPRID,RUN_CNTL_ID,LANGUAGE_CD,LANGUAGE_OPTION FROM PS_PRCSRUNCNTL WHERE OPRID=:o AND RUN_CNTL_ID=:r',{o:operatorId,r:request.runControl},options)).rows?.[0];
 const generic=(await c.execute('SELECT AE_APPLID,PROCESS_FREQUENCY,AE_PROCESS_STATUS,PROCESS_INSTANCE,LAST_RUN_DTM,MARKET,ASOF_DT FROM PS_AEREQUESTTBL WHERE OPRID=:o AND RUN_CNTL_ID=:r',{o:operatorId,r:request.runControl},options)).rows?.[0] as Record<string,unknown>|undefined;
 if(!control&&!generic)throw Error('Choose a run control already saved for this PeopleSoft operator. Create or edit its parameters in PeopleSoft first.');
 if(generic&&text(generic.AE_APPLID)!==request.process)throw Error('This generic AE run control belongs to '+text(generic.AE_APPLID)+'. Choose its matching process.');
 if(generic&&text(generic.PROCESS_FREQUENCY)==='D')throw Error('This AE run control is set to Do Not Run. Change its frequency in PeopleSoft before submitting.');
 // A Run Once control that has completed is skipped natively: Success with only (108,517) "Request is not active".
 if(generic&&text(generic.PROCESS_FREQUENCY)==='O'&&text(generic.AE_PROCESS_STATUS)==='C')throw Error('This Run Once AE run control has already run (instance '+text(generic.PROCESS_INSTANCE)+'), so PeopleSoft would skip it. Set its frequency to Once or Always again in PeopleSoft before submitting.');
 if(request.server&&!(await c.execute('SELECT SERVERNAME FROM PS_SERVERDEFN WHERE SERVERNAME=:s',{s:request.server},options)).rows?.length)throw Error('The selected scheduler server no longer exists.');
 const previous=(await c.execute<{N:number}>("SELECT NVL(MAX(PRCSINSTANCE),0) AS N FROM PSPRCSQUE WHERE OPRID=:o AND PRCSNAME=:p AND PRCSTYPE='Application Engine' AND RUNCNTLID=:r",{o:operatorId,p:request.process,r:request.runControl},options)).rows?.[0]?.N??0;
 return {lastInstance:Number(previous),identity:digest(identity),token:digest({identity,operatorId,request,process,ae,control,generic,previous}),description:text(process.DESCR),control:{id:request.runControl,...(generic?{aeProgram:text(generic.AE_APPLID),frequency:text(generic.PROCESS_FREQUENCY)}:{})}};
}
