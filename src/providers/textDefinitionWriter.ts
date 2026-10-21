import { createHash } from 'node:crypto';
import type { DbConnection, DbTypes } from '../db/connection.js';
import { hash, type Json } from '../changeReview/model.js';
import { readSqlMigration, readSqlLobValue } from './sqlSnapshot.js';
import { readContentMigration, type ContentMigrationData } from './contentMigration.js';
import { saveSqlDefinition, bindMarkerInComment } from './sqlWriter.js';
import { prepareSqlText, SQL_TEXT_ROW_LIMIT, type SqlDefinitionData } from '../model/sqlDefinition.js';
import { saveHtmlDefinition, prepareHtmlText, contentTextRefusal } from './htmlWriter.js';
import { saveStyleSheet } from './styleSheetWriter.js';
import { predictSourceSignature } from '../peoplecode/sourceSignature.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { operatorExists, select, expectRows } from './peopleCodeWriter.js';
import { writeScopeRefusal } from './writeScope.js';

export type TextDefinitionKind = 'sql' | 'html' | 'stylesheet';
export type TextDefinitionData = SqlDefinitionData | ContentMigrationData;
export interface TextDefinitionState { value: TextDefinitionData | null; token: string; version: number; deleted: boolean }
interface Markers { content: Record<string, unknown>[]; definition: Record<string, unknown>[] }
const markerHash = (markers: Markers) => 'text-deleted:' + createHash('sha256').update(JSON.stringify(markers)).digest('hex');
const count = async (c: DbConnection, sql: string, binds: Record<string, unknown>) => {
    const rows = await select<{N:number}>(c, sql, binds);
    if (rows.length !== 1 || !Number.isSafeInteger(Number(rows[0].N)) || Number(rows[0].N) < 0) throw Error('Incomplete text-definition scope count.');
    return Number(rows[0].N);
};
function checkedName(name: string) { if (!/^[A-Z][A-Z0-9_]{0,29}$/.test(name)) throw Error('Invalid text-definition name.'); }
const json = (data: TextDefinitionData | null): Json => data as unknown as Json;

/** Closed portable projection; all remaining native columns are fixed by the bounded readers. */
export function textDefinitionData(kind: TextDefinitionKind, name: string, value: unknown): TextDefinitionData {
    checkedName(name);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('A complete text-definition payload is required.');
    const d = value as Record<string, unknown>, keys = kind === 'sql' ? ['name','text','description','definition','ownerId'] : ['name','text','description'];
    if (Object.keys(d).sort().join(',') !== keys.sort().join(',') || d.name !== name || keys.some(k => typeof d[k] !== 'string')) throw Error('Text-definition payload keys or identity differ.');
    const text = d.text as string, description = d.description as string;
    if (description.length > 30 || (kind==='sql'?description.trimEnd():description.trim()) !== description) throw Error('Description is not in its native portable form or exceeds 30 characters.');
    if (kind === 'sql') {
        if (!text || text.length > SQL_TEXT_ROW_LIMIT || prepareSqlText(text) !== text || bindMarkerInComment(text)) throw Error('Unsupported or noncanonical SQL text.');
        if ((d.ownerId as string).length > 4 || (d.ownerId as string).trimEnd() !== d.ownerId) throw Error('SQL owner ID is at most four native portable characters.');
    } else if (prepareHtmlText(text) !== text || contentTextRefusal(text)) throw Error('Unsupported or noncanonical content text.');
    return structuredClone(d) as unknown as TextDefinitionData;
}

/** Full native token, including calibrated deletion markers; ordinary creation refuses deleted names. */
export async function readTextDefinitionState(c: DbConnection, types: DbTypes, kind: TextDefinitionKind, name: string, allowDeleted = false, lock = false): Promise<TextDefinitionState> {
    checkedName(name);const suffix = lock ? ' FOR UPDATE' : '', n = {n:name};
    const markers: Markers = { content: [], definition: [] };
    const sql = kind === 'sql', stylesheet = kind === 'stylesheet';
    if (sql) markers.definition = await select(c, `SELECT SQLID, SQLTYPE, VERSION FROM PSSQLDEL WHERE SQLID=:n ORDER BY VERSION${suffix}`, n);
    else {
        markers.content = await select(c, `SELECT CONTNAME, CONTTYPE, ALTCONTNUM, VERSION FROM PSCONTDEL WHERE CONTNAME=:n ORDER BY CONTTYPE, ALTCONTNUM, VERSION${suffix}`, n);
        markers.definition = await select(c, `SELECT STYLESHEETNAME, VERSION FROM PSSTYLSHEETDEL WHERE STYLESHEETNAME=:n ORDER BY VERSION${suffix}`, n);
    }
    const scoped = sql ? ['PSSQLDEFN','PSSQLDESCR','PSSQLTEXTDEFN','PSSQLHASH','PSSQLLANG'] : ['PSCONTDEFN','PSCONTENT','PSCONTDEFNLANG','PSCONTENTLANG'];
    const amounts = await Promise.all(scoped.map(t => count(c, `SELECT COUNT(*) AS N FROM ${t} WHERE ${sql?'SQLID':'CONTNAME'}=:n`, n)));
    const sheetTables = ['PSSTYLSHEETDEFN','PSSTYLECLASS','PSSTYLECLSLANG','PSSTYLEDFNLANG'];
    const sheetAmounts = sql ? [] : await Promise.all(sheetTables.map(t => count(c, `SELECT COUNT(*) AS N FROM ${t} WHERE STYLESHEETNAME=:n`, n)));
    if (sql) for (const t of scoped) if (await count(c, `SELECT COUNT(*) AS N FROM ${t} WHERE SQLID=:n AND SQLTYPE<>'0'`,n)) throw Error(name + ': another SQL type shares the native scope.');
    if (!sql && ((!stylesheet && sheetAmounts.some(Boolean)) || sheetAmounts.slice(1).some(Boolean))) throw Error(name + ': stylesheet classes, translations or cross-type orphan rows are unsupported.');
    const deleted = markers.content.length + markers.definition.length > 0;
    if (deleted) {
        if (!allowDeleted || amounts.some(Boolean) || sheetAmounts.some(Boolean)) throw Error(name + ': deleted or mixed live/deleted scope requires explicit reviewed restoration.');
        const validVersion = (r:Record<string,unknown>) => Number.isSafeInteger(Number(r.VERSION)) && Number(r.VERSION)>0;
        if (sql) {
            if (markers.definition.length !== 1 || markers.definition.some(r => String(r.SQLTYPE)!=='0' || !validVersion(r))) throw Error('Uncalibrated SQL tombstone scope.');
        } else {
            if (markers.content.length !== 1 || markers.content.some(r => Number(r.CONTTYPE)!==(stylesheet?9:4) || Number(r.ALTCONTNUM)!==1 || !validVersion(r)) ||
                markers.definition.length !== (stylesheet?1:0) || markers.definition.some(r=>!validVersion(r))) throw Error('Uncalibrated content tombstone scope.');
        }
        return {value:null,token:markerHash(markers),version:0,deleted:true};
    }
    const live = sql ? await readSqlMigration(c,types,name,lock) : await readContentMigration(c,name,kind,lock);
    if (!live) {
        if (amounts.some(Boolean) || sheetAmounts.some(Boolean)) throw Error(name + ': incomplete native absence.');
        return {value:null,token:'absent',version:0,deleted:false};
    }
    const data = textDefinitionData(kind,name,live.data);
    if (sql) {
        const rows = (await c.execute<{T:unknown;H:string}>(`SELECT T.SQLTEXT AS T, H.HASH_SIGNATURE AS H FROM PSSQLTEXTDEFN T, PSSQLHASH H
            WHERE T.SQLID=:n AND T.SQLTYPE='0' AND H.SQLID=T.SQLID AND H.SQLTYPE=T.SQLTYPE`,n,{outFormat:types.OUT_FORMAT_OBJECT})).rows ?? [];
        for(const row of rows) row.T=await readSqlLobValue(row.T);
        if (rows.length!==1 || rows[0].T!==data.text || rows[0].H!==predictSourceSignature(data.text)) throw Error(name + ': native SQL text/hash is not exactly reproducible.');
    }
    return {value:data,token:live.token,version:live.version,deleted:false};
}

export interface TextDefinitionWriteRequest {
    kind: TextDefinitionKind; name: string; after: TextDefinitionData | null; operatorId: string;
    expectedSnapshotToken: string; expectedAfterHash: string; dryRun?: boolean; allowDeletedBaseline?: boolean;
    /** Only rollback validation may account for declared inverse dependencies. */
    proposedProjectDeletions?: readonly string[]; proposedAeDeletions?: readonly string[];
    proposedTextDeletions?: readonly {kind:TextDefinitionKind;name:string}[];
}
export interface TextDefinitionWriteResult { before: TextDefinitionState; after: TextDefinitionState }

async function references(c:DbConnection, r:TextDefinitionWriteRequest) {
    const projects = r.proposedProjectDeletions ?? [], programs = r.proposedAeDeletions ?? [], texts=r.proposedTextDeletions??[];
    if ((projects.length || programs.length || texts.length) && !r.dryRun) throw Error('Proposed deletion assumptions cannot be used by a committing writer.');
    if (projects.some(n=>!/^[A-Z][A-Z0-9_]{0,29}$/.test(n)) || programs.some(n=>!/^[A-Z][A-Z0-9_]{0,11}$/.test(n))) throw Error('Invalid proposed inverse dependency.');
    for(const t of texts){checkedName(t.name);if(!['sql','html','stylesheet'].includes(t.kind))throw Error('Invalid proposed text inverse.');}
    const binds: Record<string,unknown> = {n:r.name};
    const list = (values:readonly string[], prefix:string) => values.map((v,i)=>{binds[prefix+i]=v;return ':'+prefix+i;}).join(',');
    const projectList=list(projects,'pr'), aeList=list(programs,'ae');
    const projectType=r.kind==='sql'?30:r.kind==='html'?51:50;
    if (await count(c,`SELECT COUNT(*) AS N FROM PSPROJECTITEM WHERE OBJECTTYPE=${projectType} AND OBJECTVALUE1=:n${projects.length?' AND PROJECTNAME NOT IN ('+projectList+')':''}`,{n:r.name,...Object.fromEntries(projects.map((v,i)=>['pr'+i,v]))})) throw Error('A project still references this text definition.');
    const aePc=programs.length?` AND NOT (OBJECTID1=66 AND OBJECTVALUE1 IN (${aeList}))`:'';
    const pcBinds={n:r.name,...Object.fromEntries(programs.map((v,i)=>['ae'+i,v]))};
    // Conservative source mentions also catch literal-name use and save-only source.
    // A mention in a comment can require inspection; dynamic names remain unknown.
    if (await count(c,`SELECT COUNT(*) AS N FROM PSPCMNAME WHERE REFNAME=:n AND RECNAME='${r.kind==='sql'?'SQL':r.kind==='html'?'HTML':'STYLESHEET'}'${aePc}`,pcBinds) ||
        await count(c,`SELECT COUNT(*) AS N FROM PSPCMTXT WHERE DBMS_LOB.INSTR(UPPER(PCTEXT),:n)>0${aePc}`,pcBinds)) throw Error('Stored PeopleCode references or mentions this definition.');
    const exclusions=programs.map((_,i)=>`(SQLTYPE IN ('1','6') AND SUBSTR(SQLID,1,12)=RPAD(:ae${i},12))`);
    const sqlTexts=texts.filter(t=>t.kind==='sql');sqlTexts.forEach((t,i)=>{exclusions.push(`(SQLTYPE='0' AND SQLID=:tx${i})`);});
    if(await count(c,`SELECT COUNT(*) AS N FROM PSSQLTEXTDEFN WHERE DBMS_LOB.INSTR(UPPER(SQLTEXT),:n)>0${r.kind==='sql'?" AND NOT (SQLID=:n AND SQLTYPE='0')":''}${exclusions.length?' AND NOT ('+exclusions.join(' OR ')+')':''}`,{...pcBinds,...Object.fromEntries(sqlTexts.map((t,i)=>['tx'+i,t.name]))})) throw Error('Stored SQL references or mentions this definition.');
    if(r.kind==='stylesheet'){
        if(await count(c,`SELECT COUNT(*) AS N FROM PSPNLDEFN WHERE STYLESHEETNAME=:n OR FFSTYLESHEETNAME=:n OR FFSTYLEDESKTOP=:n OR FFSTYLEPHONE=:n OR FFSTYLETABLET=:n OR FFSTYLEMEDIUM=:n OR FFSTYLEEXLARGE=:n`,{n:r.name}) ||
            await count(c,"SELECT COUNT(*) AS N FROM PSSTYLSHEETDEFN WHERE PARENTSTYLENAME=:n",{n:r.name}) ||
            await count(c,"SELECT COUNT(*) AS N FROM PSSTYLECLASS WHERE SUBSTYLESHEET=1 AND STYLECLASSNAME=:n",{n:r.name})) throw Error('A page or stylesheet still references this stylesheet.');
    }
    const contentTexts=texts.filter(t=>t.kind!=='sql');
    if(r.kind!=='sql' && await count(c,`SELECT COUNT(*) AS N FROM PSCONTENT WHERE CONTNAME<>:n AND DBMS_LOB.INSTR(CONTDATA,:needle)>0${contentTexts.length?' AND CONTNAME NOT IN ('+contentTexts.map((_,i)=>':ct'+i).join(',')+')':''}`,{n:r.name,needle:Buffer.from(r.name,'utf16le'),...Object.fromEntries(contentTexts.map((t,i)=>['ct'+i,t.name]))})) throw Error('Stored content mentions this definition.');
}

async function counters(c:DbConnection,kind:TextDefinitionKind,lock=false){
    const names=kind==='sql'?['SRM','SYS']:kind==='html'?['CRM','SYS']:['CRM','SSM','SYS'];
    const clause=names.map(n=>"'"+n+"'").join(','),suffix=lock?' FOR UPDATE':'';
    const versions=await select<{T:string;V:number}>(c,`SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN (${clause}) ORDER BY OBJECTTYPENAME${suffix}`);
    const locks=await select<{T:string;V:number}>(c,`SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSLOCK WHERE OBJECTTYPENAME IN (${clause}) AND OBJECTTYPENAME<>'SYS' ORDER BY OBJECTTYPENAME${suffix}`);
    if(versions.length!==names.length || locks.length!==names.length-1)throw Error('Incomplete native text cache counters.');
    const v=Object.fromEntries(versions.map(r=>[String(r.T).trim(),Number(r.V)])),l=Object.fromEntries(locks.map(r=>[String(r.T).trim(),Number(r.V)]));
    if([...Object.values(v),...Object.values(l)].some(n=>!Number.isSafeInteger(n)||n<0))throw Error('Invalid native cache version.');
    return {v,l};
}

/** td01-td06: typed native transactions, never raw checkpoint row replay. */
export async function writeTextDefinition(c:DbConnection,types:DbTypes,r:TextDefinitionWriteRequest):Promise<TextDefinitionWriteResult>{
    try{
        checkedName(r.name);const refusal=writeScopeRefusal(r.name)||validateOperatorId(r.operatorId);if(refusal)throw Error(refusal);
        if(!r.dryRun&&((r.proposedProjectDeletions?.length??0)+(r.proposedAeDeletions?.length??0)+(r.proposedTextDeletions?.length??0)))throw Error('Proposed deletion assumptions cannot be used by a committing writer.');
        if(!r.expectedSnapshotToken || !/^[0-9a-f]{64}$/.test(r.expectedAfterHash))throw Error('Reviewed baseline and after-image hashes are required.');
        if(!await operatorExists(c,r.operatorId))throw Error('Configured PeopleSoft operator does not exist.');
        const before=await readTextDefinitionState(c,types,r.kind,r.name,r.allowDeletedBaseline===true,true);
        if(before.token!==r.expectedSnapshotToken)throw Error('Complete text-definition baseline changed.');
        // Lock the baseline before any nested writer can wait for another save.
        // Otherwise a concurrent definition's save can advance SYS between this
        // read and the nested writer's lock, producing a false readback failure.
        const priorCounters=await counters(c,r.kind,true);
        const afterValue=r.after===null?null:textDefinitionData(r.kind,r.name,r.after);
        if(hash(json(afterValue))!==r.expectedAfterHash)throw Error('Text-definition after-image differs from review.');
        const n={n:r.name};
        if(afterValue===null){
            if(before.value===null)throw Error('Cannot delete an absent text definition.');
            await references(c,r);
            if(r.kind==='sql'){
                for(const t of ['PSSQLTEXTDEFN','PSSQLHASH','PSSQLDESCR','PSSQLDEFN'])await expectRows(c,`DELETE FROM ${t} WHERE SQLID=:n AND SQLTYPE='0'`,n,1,'Deleting '+t);
                await expectRows(c,"INSERT INTO PSSQLDEL (SQLID,SQLTYPE,VERSION) VALUES (:n,'0',:v)",{...n,v:priorCounters.v.SRM+1},1,'Recording SQL deletion');
            }else{
                const rows=await count(c,'SELECT COUNT(*) AS N FROM PSCONTENT WHERE CONTNAME=:n',n);
                await expectRows(c,'DELETE FROM PSCONTENT WHERE CONTNAME=:n',n,rows,'Deleting content chunks');
                await expectRows(c,'DELETE FROM PSCONTDEFN WHERE CONTNAME=:n',n,1,'Deleting content header');
                await expectRows(c,'INSERT INTO PSCONTDEL (CONTNAME,CONTTYPE,ALTCONTNUM,VERSION) VALUES (:n,:t,1,:v)',{...n,t:r.kind==='html'?4:9,v:priorCounters.v.CRM+1},1,'Recording content deletion');
                if(r.kind==='stylesheet'){
                    await expectRows(c,'DELETE FROM PSSTYLSHEETDEFN WHERE STYLESHEETNAME=:n',n,1,'Deleting stylesheet header');
                    await expectRows(c,'INSERT INTO PSSTYLSHEETDEL (STYLESHEETNAME,VERSION) VALUES (:n,:v)',{...n,v:priorCounters.v.SSM+1},1,'Recording stylesheet deletion');
                }
            }
            for(const [table,values] of [['PSVERSION',priorCounters.v],['PSLOCK',priorCounters.l]] as const)for(const [o,v] of Object.entries(values))await expectRows(c,`UPDATE ${table} SET VERSION=:v WHERE OBJECTTYPENAME=:o`,{o,v:v+1},1,'Advancing '+table+' '+o);
        }else{
            if(before.deleted){
                if(r.kind==='sql')await expectRows(c,"DELETE FROM PSSQLDEL WHERE SQLID=:n AND SQLTYPE='0'",n,1,'Clearing reviewed SQL tombstone');
                else{
                    await expectRows(c,'DELETE FROM PSCONTDEL WHERE CONTNAME=:n',n,1,'Clearing reviewed content tombstone');
                    if(r.kind==='stylesheet')await expectRows(c,'DELETE FROM PSSTYLSHEETDEL WHERE STYLESHEETNAME=:n',n,1,'Clearing reviewed stylesheet tombstone');
                }
            }
            const openedVersion=before.value===null?undefined:before.version,expectedSnapshotToken=before.value===null?'absent':before.token;
            if(r.kind==='sql'){
                const d=afterValue as SqlDefinitionData;
                await saveSqlDefinition(c,{sqlId:r.name,text:d.text,metadata:{description:d.description,definition:d.definition,ownerId:d.ownerId},openedVersion,expectedSnapshotToken,operatorId:r.operatorId},types,true);
            }else{
                const request={...afterValue,name:r.name,openedVersion,expectedSnapshotToken,operatorId:r.operatorId};
                if(r.kind==='html')await saveHtmlDefinition(c,types.BLOB,request,true);else await saveStyleSheet(c,types.BLOB,request,true);
            }
        }
        const after=await readTextDefinitionState(c,types,r.kind,r.name,true,true);
        if(hash(json(after.value))!==r.expectedAfterHash || (afterValue===null?!after.deleted:after.deleted))throw Error('Native text-definition readback differs from review.');
        if(afterValue===null){
            const expected:Markers={content:[],definition:[]};
            if(r.kind==='sql')expected.definition=[{SQLID:r.name,SQLTYPE:'0',VERSION:priorCounters.v.SRM+1}];
            else{expected.content=[{CONTNAME:r.name,CONTTYPE:r.kind==='html'?4:9,ALTCONTNUM:1,VERSION:priorCounters.v.CRM+1}];if(r.kind==='stylesheet')expected.definition=[{STYLESHEETNAME:r.name,VERSION:priorCounters.v.SSM+1}];}
            if(after.token!==markerHash(expected))throw Error('Native deletion tombstone versions differ from the calibrated counters.');
        }
        const currentCounters=await counters(c,r.kind),changed=r.after===null?Object.keys(priorCounters.v):r.kind==='sql'?['SRM','SYS']:r.kind==='html'?['CRM','SYS']:['SSM','SYS'];
        for(const [o,v] of Object.entries(priorCounters.v))if(currentCounters.v[o]!==v+(changed.includes(o)?1:0))throw Error('Unexpected native text version counter.');
        for(const [o,v] of Object.entries(priorCounters.l))if(currentCounters.l[o]!==v+(changed.includes(o)?1:0))throw Error('Unexpected native text lock counter.');
        if(r.dryRun){
            await c.rollback();const restored=await readTextDefinitionState(c,types,r.kind,r.name,true);
            if(restored.token!==before.token || hash(json(restored.value))!==hash(json(before.value)) || JSON.stringify(await counters(c,r.kind))!==JSON.stringify(priorCounters))throw Error('Text-definition rollback did not restore the complete baseline.');
        }else await c.commit();
        return {before,after};
    }catch(error){await c.rollback().catch(()=>{});throw error;}
}
