import type { DbConnection, DbTypes } from '../db/connection.js';
import { canonical, hash, privacy, type Json } from '../changeReview/model.js';
import { IB_PARENTS, IB_SECTIONS, ibSecretColumn, validateIbInput, type IbWriteInput } from '../model/ibOperations.js';
import { readIb, rows, validateIb } from './ibReader.js';
import { saveIb, checkedRow } from './ibWriter.js';
import { operatorExists } from './peopleCodeWriter.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { writeScopeRefusal } from './writeScope.js';

type Row = Record<string, Json>;
export interface IbLifecycleKey { kind: 'service' | 'operation'; name: string; service?: string }
export interface IbLifecycleState { value: Json; token: string; hash: string; deleted: boolean }
export interface IbLifecycleRequest extends IbLifecycleKey { after: Json; operatorId: string; expectedSnapshotToken: string; expectedAfterHash: string; allowDeletedBaseline?: boolean; dryRun?: boolean }
const SERVICE = ['PSSERVICE', 'PSSERVICELANG', 'PSSERVICEUDDI', 'PSSERVICEOPR'];
const OPERATION = ['PSOPERATION', ...Object.values(IB_SECTIONS.operation).map(t => t.table), 'PSIBOPRROOT', 'PSOPRGENRTGPARM', 'PSSERVICEOPR', 'PSIBRTNGDEFN', 'PSOPERATIONLANG', 'PSOPRHDLRLANG', 'PSOPRVERDFNLANG', 'PSOPRVDPARMTYPE', 'PSOPRVERDEPLOY', 'PSOPRVERDPLYDAT', 'PSOPRVERDPLYVER'];
const MARKERS: Record<string, string[]> = { PSSERVICEDEL: ['IB_SERVICENAME','VERSION'], PSOPERATIONDEL: ['IB_OPERATIONNAME','VERSION'], PSOPRVERDFNDEL: ['IB_OPERATIONNAME','VERSIONNAME','VERSION'], PSOPRHDLRDEL: ['IB_OPERATIONNAME','HANDLERNAME','VERSION'] };
const trim = (v: Json | undefined) => String(v ?? '').trim();
const stamp = new Set(['VERSION','LASTUPDDTTM','LASTUPDOPRID']);
const sort = (r: Row[]) => r.sort((a,b) => canonical(a).localeCompare(canonical(b)));
const tablesFor = (k: IbLifecycleKey) => k.kind === 'service' ? SERVICE : OPERATION;
const markersFor = (k: IbLifecycleKey) => k.kind === 'service' ? ['PSSERVICEDEL'] : ['PSOPERATIONDEL','PSOPRVERDFNDEL','PSOPRHDLRDEL'];
const columnFor = (k: IbLifecycleKey) => k.kind === 'service' ? 'IB_SERVICENAME' : 'IB_OPERATIONNAME';
const writableTables = (k: IbLifecycleKey) => k.kind === 'service' ? ['PSSERVICE'] : ['PSOPERATION','PSOPRVERDFN','PSOPRVERDFNPARM','PSOPRHDLR','PSOPERATIONAC','PSSERVICEOPR'];
export function ibLifecycleIdentity(k: IbLifecycleKey): void {
    if (!['service','operation'].includes(k.kind) || !/^[A-Z][A-Z0-9_]{0,29}$/.test(k.name) || (k.kind === 'operation' ? !k.service || !/^[A-Z][A-Z0-9_]{0,29}$/.test(k.service) : k.service !== undefined)) throw new Error('Invalid IB definition lifecycle identity.');
}
async function release(c: DbConnection, types: DbTypes) { const [r] = await rows(c,types,'SELECT TOOLSREL,PTPATCHREL FROM PSSTATUS'); if (trim(r?.TOOLSREL as Json) !== '8.62' || Number(r?.PTPATCHREL) !== 9) throw new Error('IB definition lifecycle is calibrated only on PeopleTools 8.62.09.'); }
async function count(c: DbConnection, types: DbTypes, sql: string, binds: Record<string,unknown>) { const [r] = await rows(c,types,sql,binds); if (!r || !Number.isSafeInteger(Number(r.N)) || Number(r.N) < 0) throw new Error('Incomplete IB dependency count.'); return Number(r.N); }
async function tableRows(c: DbConnection, types: DbTypes, table: string, column: string, name: string): Promise<Row[]> {
    const columns = await c.catalog.columns(c,table);
    if (!columns.length || !columns.some(c => c.name === column) || columns.some(c => !/^[A-Z][A-Z0-9_]*$/.test(c.name) || /TIME ZONE|BLOB|RAW|^LONG/.test(c.dataType))) throw new Error('Unsupported IB lifecycle table schema: ' + table);
    if (table in MARKERS && columns.map(c=>c.name).sort().join() !== [...MARKERS[table]].sort().join()) throw new Error('Unsupported IB lifecycle marker schema: ' + table);
    const selected = columns.filter(c => !ibSecretColumn(c.name));
    const projection = selected.map(c => /^(DATE|TIMESTAMP)/.test(c.dataType) ? `TO_CHAR(CAST(${c.name} AS TIMESTAMP(9)), 'YYYY-MM-DD"T"HH24:MI:SS.FF9') AS ${c.name}` : c.name).join(',');
    const found = await rows(c,types,`SELECT ${projection} FROM ${table} WHERE ${column}=:n`,{n:name});
    return sort(found.map(r => Object.fromEntries(selected.map(col => {
        const v = r[col.name];
        if (!(col.name in r) || !(v === null || typeof v === 'string' || typeof v === 'number' && Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v)))) throw new Error('Incomplete IB lifecycle cell: ' + table + '.' + col.name);
        return [col.name,v];
    })) as Row));
}
const logical = (tables: Record<string,Row[]>) => Object.fromEntries(Object.entries(tables).map(([t,r]) => [t,sort(r.map(row => Object.fromEntries(Object.entries(row).filter(([k]) => !stamp.has(k)))))]));
async function rawState(c: DbConnection, types: DbTypes, k: IbLifecycleKey) {
    ibLifecycleIdentity(k); const tables: Record<string,Row[]> = {}, markers: Record<string,Row[]> = {};
    for (const t of tablesFor(k)) {
        if(writableTables(k).includes(t))tables[t] = await tableRows(c,types,t,columnFor(k),k.name);
        else {
            const columns=await c.catalog.columns(c,t);if(!columns.some(col=>col.name===columnFor(k)))throw new Error('Missing IB lifecycle preservation schema: '+t);
            if(await count(c,types,`SELECT COUNT(*) AS N FROM ${t} WHERE ${columnFor(k)}=:n`,{n:k.name}))throw new Error(t+': this IB definition needs a wider lifecycle preservation scope.');
            tables[t]=[];
        }
    }
    for (const t of markersFor(k)) {
        markers[t] = await tableRows(c,types,t,columnFor(k),k.name);
        for (const r of markers[t]) if (!Number.isSafeInteger(r.VERSION) || Number(r.VERSION) < 1) throw new Error('Invalid IB lifecycle deletion marker.');
    }
    const parent = k.kind === 'operation' ? await tableRows(c,types,'PSSERVICE','IB_SERVICENAME',k.service!) : [];
    return { tables, markers, parent };
}
function state(k: IbLifecycleKey, raw: Awaited<ReturnType<typeof rawState>>, allowDeleted: boolean): IbLifecycleState {
    const header = raw.tables[k.kind === 'service' ? 'PSSERVICE' : 'PSOPERATION'], anyRows = Object.values(raw.tables).some(r => r.length), anyMarkers = Object.values(raw.markers).some(r => r.length);
    if (header.length > 1 || header.length && (!Number.isSafeInteger(header[0].VERSION) || Number(header[0].VERSION) < 0)) throw new Error('Invalid IB lifecycle header.');
    if (!header.length && anyRows) throw new Error('Orphan IB definition rows are not absence.');
    if (k.kind === 'operation' && raw.parent.length !== 1) throw new Error('Operation lifecycle requires its existing owning service.');
    const deleted = !header.length && anyMarkers;
    if(deleted&&(raw.markers[k.kind==='service'?'PSSERVICEDEL':'PSOPERATIONDEL'].length!==1||k.kind==='operation'&&raw.markers.PSOPRVERDFNDEL.length!==1))throw new Error('Incomplete or unsupported IB definition deletion history.');
    if (deleted && !allowDeleted) throw new Error('Deleted IB definition requires explicit reviewed restoration.');
    if (header.length && (raw.markers[k.kind === 'service' ? 'PSSERVICEDEL' : 'PSOPERATIONDEL'].length || k.kind === 'operation' && raw.markers.PSOPRVERDFNDEL.length)) throw new Error('Live IB definition has conflicting deletion markers.');
    const value: Json = header.length ? { scope:`ib-${k.kind}-definition/1`,tables:logical(raw.tables), ...(k.kind === 'operation' ? { service: logical({PSSERVICE:raw.parent}).PSSERVICE[0] } : {}) } : null;
    privacy(value); if (Buffer.byteLength(canonical(value)) > 8*1024*1024) throw new Error('IB lifecycle checkpoint exceeds 8 MiB.');
    return { value, hash:hash(value), token: !anyRows && !anyMarkers && k.kind === 'service' ? 'absent' : hash(raw as unknown as Json), deleted };
}
export async function readIbLifecycle(c: DbConnection, types: DbTypes, k: IbLifecycleKey, allowDeleted = false): Promise<IbLifecycleState> { await release(c,types); return state(k,await rawState(c,types,k),allowDeleted); }

/** The native writer, under rollback, defines a creation proposal's complete after-image. */
export async function previewIbLifecycleCreation(c:DbConnection,types:DbTypes,input:IbWriteInput,operatorId:string){
    try{
        if(input.kind!=='service'&&input.kind!=='operation')throw new Error('IB lifecycle creation supports services and operations only.');
        const k:IbLifecycleKey={kind:input.kind,name:input.key[0],...(input.kind==='operation'?{service:String(input.properties.IB_SERVICENAME).trim()}:{})};
        const before=await readIbLifecycle(c,types,k);
        const names=k.kind==='service'?['SRVM','SYS']:['OPRHM','OPRM','OPRVM','SRVM','SYS'],counters=await cache(c,types,names);
        if(before.value!==null)throw new Error('IB creation requires a completely absent definition.');
        await dependencies(c,types,k,false);
        const request=structuredClone(input),handlers=request.sections.handlers??[],classes=request.sections.applicationClassHandlers??[];
        if(k.kind==='operation'){request.sections.handlers=[];request.sections.applicationClassHandlers=[];}
        await saveIb(c,types,{input:request,expectedToken:'absent',operatorId},true);
        if(k.kind==='operation'&&handlers.length){const live=(await readIb(c,types,'operation',[k.name]))!;await saveIb(c,types,{input:{...request,sections:{...request.sections,handlers,applicationClassHandlers:classes}},expectedToken:live.token,operatorId},true);}
        const after=await readIbLifecycle(c,types,k);ibLifecycleInput(after.value,k);
        await c.rollback();if((await readIbLifecycle(c,types,k)).token!==before.token||canonical(await cache(c,types,names))!==canonical(counters))throw new Error('IB creation preview failed to restore its baseline or cache counters.');
        return {key:k,before,after};
    }catch(error){await c.rollback().catch(()=>{});throw error;}
}

/** Reconstruct only the typed shape captured natively in ib03..ib06. No raw row replay. */
export function ibLifecycleInput(value: Json, k: IbLifecycleKey): IbWriteInput {
    ibLifecycleIdentity(k);
    if (!value || Array.isArray(value) || typeof value !== 'object' || value.scope !== `ib-${k.kind}-definition/1` || Object.keys(value).sort().join() !== (k.kind === 'service' ? 'scope,tables' : 'scope,service,tables') || !value.tables || Array.isArray(value.tables) || typeof value.tables !== 'object') throw new Error('Invalid IB lifecycle checkpoint.');
    const tables = value.tables as Record<string,Row[]>;
    if (Object.keys(tables).sort().join() !== [...tablesFor(k)].sort().join() || Object.values(tables).some(r => !Array.isArray(r) || r.some(row => !row || Array.isArray(row) || typeof row !== 'object' || Object.keys(row).some(key => stamp.has(key) || ibSecretColumn(key))))) throw new Error('Incomplete IB lifecycle tables.');
    privacy(value);
    const head = tables[k.kind === 'service' ? 'PSSERVICE' : 'PSOPERATION'];
    if (head.length !== 1 || trim(head[0][columnFor(k)]) !== k.name) throw new Error('IB lifecycle checkpoint identifies another definition.');
    const allowed = k.kind === 'service' ? ['PSSERVICE'] : ['PSOPERATION','PSOPRVERDFN','PSOPRVERDFNPARM','PSOPRHDLR','PSOPERATIONAC','PSSERVICEOPR'];
    for (const [t,r] of Object.entries(tables)) if (!allowed.includes(t) && r.length) throw new Error(t + ': this IB definition needs a wider lifecycle protocol.');
    const service = k.kind === 'service' ? head[0] : value.service as Row;
    if (!service || typeof service !== 'object' || Array.isArray(service) || trim(service.IB_SERVICENAME) !== (k.service ?? k.name) || Number(service.IB_REST_SERVICE) !== 0 || trim(service.IB_PSOFTSERVICE) !== 'N' || Number(service.PT_OPEN_API) !== 0 || Object.keys(service).some(key => stamp.has(key) || ibSecretColumn(key))) throw new Error('Lifecycle requires an unrestricted standard service; REST lifecycle needs its own native protocol.');
    const properties = Object.fromEntries(Object.entries(head[0]).filter(([key]) => key !== columnFor(k) && !['IB_REST_SERVICE','IB_PSOFTSERVICE'].includes(key))) as IbWriteInput['properties'];
    if(!trim(head[0].DESCR)||k.kind==='service'&&!trim(head[0].IB_NAMESPACE))throw new Error('IB lifecycle description/namespace is required.');
    const input: IbWriteInput = { kind:k.kind,key:[k.name],properties,sections:{},...(k.kind === 'service' ? {serviceKind:'standard' as const} : {}) };
    if (k.kind === 'operation') {
        if (trim(head[0].IB_SERVICENAME) !== k.service || trim(head[0].RTNGTYPE) !== 'S' || Number(head[0].IB_REST_SERVICE) !== 0 || trim(head[0].IB_RESTMETHOD) || trim(head[0].IB_ALIASNAME) || trim(head[0].MSGNAME) || trim(head[0].IB_MSGVERSION) || tables.PSOPRVERDFN.length !== 1 || trim(tables.PSOPRVERDFN[0].VERSIONNAME) !== trim(head[0].DEFAULTVER)) throw new Error('Lifecycle supports one-version standard synchronous operations without aliases or URI message binding only.');
        if (tables.PSSERVICEOPR.length !== 1 || trim(tables.PSSERVICEOPR[0].IB_SERVICENAME) !== k.service || trim(tables.PSSERVICEOPR[0].IB_OPERATIONNAME) !== k.name) throw new Error('Operation service mapping differs from its lifecycle identity.');
        if (tables.PSOPRVERDFNPARM.length !== 2 || !['REQUEST','RESPONSE'].every(role => tables.PSOPRVERDFNPARM.some(r => trim(r.PARAMETERNAME) === role && trim(r.VERSIONNAME) === trim(head[0].DEFAULTVER)))) throw new Error('Operation requires its request/response parameter pair.');
        if (tables.PSOPRHDLR.length !== tables.PSOPERATIONAC.length || tables.PSOPRHDLR.length > 1 || tables.PSOPRHDLR.some(h => trim(h.HANDLERNAME) !== 'REQUESTHDLR' || trim(h.HANDLERID) !== 'RQST' || trim(h.HANDLERTYPE) !== 'ApplicationClass') || tables.PSOPERATIONAC.some(h => trim(h.HANDLERNAME) !== 'REQUESTHDLR' || trim(h.APPCLASSMETHOD) !== 'OnRequest')) throw new Error('Only the paired application-class OnRequest handler is reproducible by this lifecycle.');
        for (const [section,t] of Object.entries(IB_SECTIONS.operation)) input.sections[section] = tables[t.table].map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'IB_OPERATIONNAME'))) as IbWriteInput['sections'][string];
    }
    validateIbInput(input); return input;
}
async function dependencies(c: DbConnection, types: DbTypes, k: IbLifecycleKey, deleting=true) {
    const tables = await rows(c,types,"SELECT T.TABLE_NAME FROM ALL_TABLES T WHERE T.OWNER=SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AND SUBSTR(T.TABLE_NAME,1,2)='PS' AND EXISTS (SELECT 1 FROM ALL_TAB_COLUMNS C WHERE C.OWNER=T.OWNER AND C.TABLE_NAME=T.TABLE_NAME AND C.COLUMN_NAME=:col) ORDER BY T.TABLE_NAME",{col:columnFor(k)});
    for (const row of tables) {
        const t = String(row.TABLE_NAME); if (!/^[A-Z][A-Z0-9_]*$/.test(t)) throw new Error('Invalid IB dependency table.');
        if ([...tablesFor(k),...markersFor(k)].includes(t)) continue;
        if (await count(c,types,`SELECT COUNT(*) AS N FROM ${t} WHERE ${columnFor(k)}=:n`,{n:k.name})) throw new Error(t + ': a related definition or runtime/reference row prevents lifecycle deletion.');
    }
    if(!deleting)return;
    if (await count(c,types,'SELECT COUNT(*) AS N FROM PSPROJECTITEM WHERE OBJECTTYPE=:t AND OBJECTVALUE1=:n',{t:k.kind === 'service' ? 79 : 80,n:k.name})) throw new Error('A project still references the IB definition.');
    for (const [t,col] of [['PSPCMTXT','PCTEXT'],['PSSQLTEXTDEFN','SQLTEXT']]) if (await count(c,types,`SELECT COUNT(*) AS N FROM ${t} WHERE DBMS_LOB.INSTR(UPPER(${col}),:n)>0`,{n:k.name})) throw new Error('Stored source references or mentions the IB definition.');
}
async function secretsAbsent(c: DbConnection, types: DbTypes, service: string) {
    const columns = (await c.catalog.columns(c,'PSSERVICE')).filter(col => ibSecretColumn(col.name));
    for (const col of columns) {
        if (!/^[A-Z][A-Z0-9_]*$/.test(col.name) || !(col.name in IB_PARENTS.service.defaults) || trim(IB_PARENTS.service.defaults[col.name] as Json)) throw new Error('Uncalibrated IB service credential column.');
        if (await count(c,types,`SELECT COUNT(*) AS N FROM PSSERVICE WHERE IB_SERVICENAME=:n AND TRIM(${col.name}) IS NOT NULL`,{n:service})) throw new Error('Credential-bearing service lifecycle is not supported.');
    }
}
async function cache(c: DbConnection, types: DbTypes, names: string[], lock = false) {
    const suffix = lock ? ' FOR UPDATE' : '', binds = Object.fromEntries(names.map((n,i)=>['c'+i,n]));
    const v = await rows(c,types,`SELECT OBJECTTYPENAME,VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN (${names.map((_,i)=>':c'+i).join(',')}) ORDER BY OBJECTTYPENAME${suffix}`,binds);
    const l = await rows(c,types,`SELECT OBJECTTYPENAME,VERSION FROM PSLOCK WHERE OBJECTTYPENAME IN (${names.filter(n=>n!=='SYS').map((_,i)=>':c'+i).join(',')}) ORDER BY OBJECTTYPENAME${suffix}`,Object.fromEntries(names.filter(n=>n!=='SYS').map((n,i)=>['c'+i,n])));
    if (v.length !== names.length || l.length !== names.length-1 || [...v,...l].some(r=>!Number.isSafeInteger(r.VERSION) || Number(r.VERSION)<0) || l.some(r=>v.find(x=>x.OBJECTTYPENAME===r.OBJECTTYPENAME)?.VERSION!==r.VERSION)) throw new Error('Incomplete IB lifecycle cache counters.');
    return {v:Object.fromEntries(v.map(r=>[String(r.OBJECTTYPENAME),Number(r.VERSION)])),l:Object.fromEntries(l.map(r=>[String(r.OBJECTTYPENAME),Number(r.VERSION)]))};
}
async function expect(c: DbConnection, sql: string, binds: Record<string,unknown>, n: number) { if ((await c.execute(sql,binds)).rowsAffected !== n) throw new Error('Unexpected IB lifecycle affected-row count.'); }
export async function writeIbLifecycle(c: DbConnection, types: DbTypes, r: IbLifecycleRequest) {
    try {
        await release(c,types); ibLifecycleIdentity(r);
        const refusal = writeScopeRefusal(r.name) || (r.service ? writeScopeRefusal(r.service) : undefined) || validateOperatorId(r.operatorId); if (refusal) throw new Error(refusal);
        if (!r.expectedSnapshotToken || !r.expectedAfterHash || !await operatorExists(c,r.operatorId)) throw new Error('A valid Operator ID, complete baseline token and expected after-image are required.');
        const head = r.kind === 'service' ? 'PSSERVICE' : 'PSOPERATION';
        await rows(c,types,`SELECT ${columnFor(r)} FROM ${head} WHERE ${columnFor(r)}=:n FOR UPDATE`,{n:r.name});
        if (r.service) await rows(c,types,'SELECT IB_SERVICENAME FROM PSSERVICE WHERE IB_SERVICENAME=:n FOR UPDATE',{n:r.service});
        const names = r.kind === 'service' ? ['SRVM','SYS'] : ['OPRHM','OPRM','OPRVM','SRVM','SYS'], counters = await cache(c,types,names,true);
        const raw = await rawState(c,types,r), before = state(r,raw,!!r.allowDeletedBaseline);
        if (before.token !== r.expectedSnapshotToken) throw new Error('Complete IB lifecycle baseline changed.');
        const delta = Object.fromEntries(names.map(n=>[n,0]));
        if (r.after === null) {
            if (before.value === null) throw new Error('Cannot delete an absent IB definition.');
            const input=ibLifecycleInput(before.value,r); await dependencies(c,types,r);
            await checkedRow(c,IB_PARENTS[r.kind],input.properties,undefined,{[columnFor(r)]:r.name});
            for(const [section,list]of Object.entries(input.sections))for(const row of list)await checkedRow(c,IB_SECTIONS[r.kind][section],row,undefined,{[columnFor(r)]:r.name});
            const live=(await readIb(c,types,r.kind,[r.name]))!,errors=(await validateIb(c,types,live)).filter(d=>d.severity==='error');if(errors.length)throw new Error('IB inverse dependencies are invalid: '+errors.map(e=>e.message).join('; '));
            for(const h of input.sections.applicationClassHandlers??[])if(!(await rows(c,types,'SELECT 1 AS N FROM PSAPPCLASSDEFN WHERE PACKAGEROOT=:p AND QUALIFYPATH=:q AND APPCLASSID=:c',{p:h.PACKAGEROOT,q:trim(h.QUALIFYPATH)||':',c:h.APPCLASSID})).length)throw new Error('Handler class required by the inverse no longer exists.');
            if (r.kind === 'service') {
                await secretsAbsent(c,types,r.name);
                await expect(c,'DELETE FROM PSSERVICE WHERE IB_SERVICENAME=:n',{n:r.name},1);
                await expect(c,'INSERT INTO PSSERVICEDEL (IB_SERVICENAME,VERSION) VALUES (:n,:v)',{n:r.name,v:counters.v.SRVM+1},1);
                delta.SRVM=delta.SYS=1;
            } else {
                const value = before.value as {tables:Record<string,Row[]>}, handlers = value.tables.PSOPRHDLR.length, version = trim(value.tables.PSOPRVERDFN[0].VERSIONNAME);
                if(handlers&&raw.markers.PSOPRHDLRDEL.some(h=>trim(h.HANDLERNAME)==='REQUESTHDLR'))throw new Error('Live handler has a conflicting deletion marker.');
                for (const t of ['PSOPERATIONAC','PSOPRHDLR','PSOPRVERDFNPARM','PSOPRVERDFN','PSSERVICEOPR','PSOPERATION']) await expect(c,`DELETE FROM ${t} WHERE IB_OPERATIONNAME=:n`,{n:r.name},value.tables[t].length);
                delta.OPRM=2+handlers; delta.OPRVM=1; delta.OPRHM=handlers; delta.SRVM=1; delta.SYS=3+handlers;
                await expect(c,'INSERT INTO PSOPERATIONDEL (IB_OPERATIONNAME,VERSION) VALUES (:n,:v)',{n:r.name,v:counters.v.OPRM+2},1);
                await expect(c,'INSERT INTO PSOPRVERDFNDEL (IB_OPERATIONNAME,VERSIONNAME,VERSION) VALUES (:n,:ver,:v)',{n:r.name,ver:version,v:counters.v.OPRVM+1},1);
                if (handlers) await expect(c,'INSERT INTO PSOPRHDLRDEL (IB_OPERATIONNAME,HANDLERNAME,VERSION) VALUES (:n,:h,:v)',{n:r.name,h:'REQUESTHDLR',v:counters.v.OPRHM+1},1);
                await expect(c,'UPDATE PSSERVICE SET VERSION=:v,LASTUPDDTTM=SYSTIMESTAMP,LASTUPDOPRID=:o WHERE IB_SERVICENAME=:n',{n:r.service,v:counters.v.SRVM+1,o:r.operatorId},1);
            }
            for (const [n,d] of Object.entries(delta)) if (d) { await expect(c,'UPDATE PSVERSION SET VERSION=:v WHERE OBJECTTYPENAME=:n',{n,v:counters.v[n]+d},1); if(n!=='SYS')await expect(c,'UPDATE PSLOCK SET VERSION=:v WHERE OBJECTTYPENAME=:n',{n,v:counters.v[n]+d},1); }
        } else {
            if (before.value !== null) throw new Error('IB lifecycle UPDATE uses the existing structural review adapters.');
            const input = ibLifecycleInput(r.after,r);
            await dependencies(c,types,r,false);
            if(before.deleted&&r.kind==='operation'&&trim(input.properties.DEFAULTVER)!==trim(raw.markers.PSOPRVERDFNDEL[0].VERSIONNAME))throw new Error('Recreation must match the bound native version marker.');
            // Clear only the bound root/version markers. Handler Save clears its own.
            for (const t of markersFor(r).filter(t=>t!=='PSOPRHDLRDEL')) if(raw.markers[t].length) await expect(c,`DELETE FROM ${t} WHERE ${columnFor(r)}=:n`,{n:r.name},raw.markers[t].length);
            const handlers = input.sections.handlers ?? [], classes = input.sections.applicationClassHandlers ?? [];
            if(r.kind==='operation'){input.sections.handlers=[];input.sections.applicationClassHandlers=[];}
            await saveIb(c,types,{input,expectedToken:'absent',operatorId:r.operatorId},true);
            delta.SRVM=1; delta.SYS=r.kind==='service'?1:3;
            if(r.kind==='operation'){
                delta.OPRM=1;delta.OPRVM=1;
                if(handlers.length){const doc=(await readIb(c,types,'operation',[r.name]))!;await saveIb(c,types,{input:{...input,sections:{...input.sections,handlers,applicationClassHandlers:classes}},expectedToken:doc.token,operatorId:r.operatorId},true);delta.OPRM++;delta.OPRVM++;delta.OPRHM++;delta.SYS+=3;}
            }
        }
        const afterRaw = await rawState(c,types,r), after = state(r,afterRaw,true);
        if (after.hash !== r.expectedAfterHash || r.after===null && !after.deleted || r.after!==null && markersFor(r).filter(t=>t!=='PSOPRHDLRDEL').some(t=>afterRaw.markers[t].length)) throw new Error('Complete IB lifecycle after-image or deletion markers differ before commit.');
        const next=await cache(c,types,names);
        for(const n of names)if(next.v[n]!==counters.v[n]+delta[n]||(n!=='SYS'&&next.l[n]!==counters.l[n]+delta[n]))throw new Error('IB lifecycle cache movement differs from its native protocol.');
        if(r.kind==='operation'&&(canonical(logical({PSSERVICE:raw.parent}))!==canonical(logical({PSSERVICE:afterRaw.parent}))||afterRaw.parent[0].VERSION!==next.v.SRVM))throw new Error('Owning service content or cache version differs before commit.');
        if(r.kind==='service'&&r.after!==null)await secretsAbsent(c,types,r.name);
        if(r.after===null){const expected:Record<string,Row[]>=structuredClone(raw.markers);
            if(r.kind==='service')expected.PSSERVICEDEL=[{IB_SERVICENAME:r.name,VERSION:next.v.SRVM}];
            else{const v=(before.value as {tables:Record<string,Row[]>}).tables;expected.PSOPERATIONDEL=[{IB_OPERATIONNAME:r.name,VERSION:counters.v.OPRM+2}];expected.PSOPRVERDFNDEL=[{IB_OPERATIONNAME:r.name,VERSIONNAME:v.PSOPRVERDFN[0].VERSIONNAME,VERSION:next.v.OPRVM}];if(v.PSOPRHDLR.length)expected.PSOPRHDLRDEL=sort([...expected.PSOPRHDLRDEL,{IB_OPERATIONNAME:r.name,HANDLERNAME:'REQUESTHDLR',VERSION:next.v.OPRHM}]);}
            if(canonical(afterRaw.markers)!==canonical(expected))throw new Error('IB lifecycle marker identities or versions differ before commit.');
        }else if(r.kind==='operation'){
            const v=r.after as {tables:Record<string,Row[]>},expected=v.tables.PSOPRHDLR.length?raw.markers.PSOPRHDLRDEL.filter(h=>trim(h.HANDLERNAME)!=='REQUESTHDLR'):raw.markers.PSOPRHDLRDEL;
            if(canonical(afterRaw.markers.PSOPRHDLRDEL)!==canonical(expected))throw new Error('IB lifecycle changed unrelated handler tombstones.');
        }
        if(r.dryRun){await c.rollback();if((await readIbLifecycle(c,types,r,true)).token!==before.token||canonical(await cache(c,types,names))!==canonical(counters))throw new Error('IB lifecycle rollback did not restore its complete baseline.');}else await c.commit();
        return {before,after};
    } catch(error) { await c.rollback().catch(()=>{}); throw error; }
}
