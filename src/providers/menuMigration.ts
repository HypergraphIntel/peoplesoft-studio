import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import type { DbConnection, DbTypes } from '../db/connection.js';
import { documentFromRows, MENU_PC_IDS, pcKeyOf, rowsFromDocument, type MenuDocument, type Row } from '../model/menuDocument.js';
import { validateMenu } from '../model/menuSession.js';
import { checkStoredProgram, prepareSourceForSave } from '../peoplecode/writeback/savePlan.js';
import { menuDocumentOf, menuToken, readStoredMenu } from './menuWriter.js';
import { PC_KEY_COLUMNS } from './appEngineWriter.js';

const text = z.string(), integer = z.number().int();
const transfer = z.object({ portal:text,node:text,menu:text,component:text,market:text,page:text,action:integer.min(0).max(3),newWindow:z.boolean(),useData:z.boolean() }).strict();
export const menuMigrationSchema = z.object({
  name:text, type:z.union([z.literal(0),z.literal(1)]), descr:text, descrlong:text.nullable(), owner:text, label:text, group:text,
  menuOrder:integer,menuSeparator:z.boolean(),groupOrder:integer,groupSeparator:z.boolean(),installed:z.boolean(),
  bars:z.array(z.object({name:text,label:text,items:z.array(z.object({name:text,label:text,type:z.union([z.literal(5),z.literal(8),z.literal(9),z.literal(12)]),
    component:text,market:text,searchRecord:text,peopleCode:text.optional(),transfer:transfer.optional(),languages:z.array(z.never()),xferCount:integer}).strict()).min(1)}).strict()),
  languages:z.array(z.never()), origins:z.array(z.object({type:text,name:text}).strict())
}).strict();
export type MenuMigrationData = z.infer<typeof menuMigrationSchema>;
const canonical = (v:unknown):string => JSON.stringify(v, (_k,v:unknown) => v && typeof v==='object' && !Array.isArray(v) && !Buffer.isBuffer(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) : v);

/** Installation stamps and editor rename hints never become portable instructions. */
export function menuMigrationData(doc:MenuDocument):MenuMigrationData {
  const {version:_v,lastUpdated:_t,lastUpdatedBy:_o,storedGroup:_g,copiedFrom:_c,...value}=doc;
  const data=menuMigrationSchema.parse({...value,origins:[...value.origins].sort((a,b)=>canonical(a).localeCompare(canonical(b))),bars:value.bars.map(({origin:_b,...bar})=>({...bar,items:bar.items.map(({origin:_i,...item})=>({...item,...(item.peopleCode===undefined?{}:{peopleCode:prepareSourceForSave(item.peopleCode)})}))}))});
  const errors=validateMenu(data).filter(d=>d.severity==='error');
  if(errors.length)throw Error('Unsupported menu migration: '+errors.map(d=>d.message).join('; '));
  return data;
}

/** Reject fields that the typed writer would normalize away, rather than approving a different after-image. */
export function checkedMenuMigration(value:unknown):MenuMigrationData {
  const data=menuMigrationSchema.parse(value), rows=rowsFromDocument(data);
  const code=new Map(rows.peopleCode.map(p=>[pcKeyOf(p.bar,p.item),p.source]));
  if(canonical(data)!==canonical(menuMigrationData(documentFromRows(rows,code))))throw Error('Menu migration payload is not a complete native canonical document.');
  return data;
}

const stamps=new Set(['VERSION','LASTUPDDTTM','LASTUPDOPRID']);
function semanticRows(rows:Row[]):string {
  return JSON.stringify(rows.map(r=>canonical(Object.fromEntries(Object.entries(r).filter(([k])=>!stamps.has(k)).map(([k,v])=>[k,typeof v==='string'&&k!=='DESCRLONG'?v.trimEnd():v])))).sort());
}

/** Full menu rows plus every program/name/text row and deletion marker form the concurrency scope. */
export async function readMenuMigration(c:DbConnection,types:DbTypes,name:string,lock=false) {
  if(!/^[A-Z][A-Z0-9_]{0,29}$/.test(name))throw Error('Invalid menu migration name.');
  const stored=await readStoredMenu(c,types,name,lock), raw:Record<string,Row[]>={}, suffix=lock?' FOR UPDATE':'';
  for(const table of ['PSMENUDEFN','PSMENUITEM','PSXFERITEM','PSMENUDEFNLANG','PSMENUITEMLANG','PSMENUORIGIN','PSMENUDEL','PSPCMPROG','PSPCMTXT','PSPCMNAME','PSPCMPROGDEL']) {
    const pc=table.startsWith('PSPCM'), columns=await c.catalog.columns(c,table);
    const pcColumns:Record<string,string[]>={PSPCMPROG:['PROGSEQ','VERSION','NAMECOUNT','PROGLEN','PROGRUNLOC','PROGFLAGS','LICENSE_CODE','LASTUPDDTTM','LASTUPDOPRID','PROGEXTENDS','PTTOOLSREL','PROGTXT'],PSPCMTXT:['PROGSEQ','HASH_SIGNATURE','PCTEXT'],PSPCMNAME:['NAMENUM','RECNAME','REFNAME','PACKAGEROOT','QUALIFYPATH','APPCLASSMETHOD'],PSPCMPROGDEL:['VERSION']};
    if(!columns.length||pc&&[...PC_KEY_COLUMNS,...pcColumns[table]].sort().join(',')!==columns.map(c=>c.name).sort().join(','))throw Error('Unsupported native menu migration schema: '+table);
    const projection=columns.map(col=>col.name==='LASTUPDDTTM'?`TO_CHAR(T.LASTUPDDTTM, 'YYYY-MM-DD"T"HH24:MI:SS.FF6') AS LASTUPDDTTM`:'T.'+col.name).join(', ');
    const rows=(await c.execute<Row>(`SELECT ${projection} FROM ${table} T WHERE ${pc?'OBJECTID1=3 AND OBJECTVALUE1':'MENUNAME'}=:m${suffix}`,
      {m:name},{outFormat:types.OUT_FORMAT_OBJECT,fetchInfo:{DESCRLONG:{type:types.STRING},PCTEXT:{type:types.STRING}}})).rows??[];
    raw[table]=rows.sort((a,b)=>canonical(a).localeCompare(canonical(b)));
  }
  if(!stored.exists) {
    // Deletion tombstones alone mean absent: the menu writer clears them when it creates the name again, as App Designer does.
    if(Object.entries(raw).some(([table,rows])=>rows.length&&!['PSMENUDEL','PSPCMPROGDEL'].includes(table)))throw Error(name+': orphaned menu rows are not a vacant scope.');
    return undefined;
  }
  const data=checkedMenuMigration(menuMigrationData(menuDocumentOf(stored))), desired=rowsFromDocument(data);
  const tables={PSMENUDEFN:[desired.menu],PSMENUITEM:desired.items,PSXFERITEM:desired.transfers,PSMENUDEFNLANG:desired.languages,PSMENUITEMLANG:desired.itemLanguages,PSMENUORIGIN:desired.origins};
  for(const [table,rows] of Object.entries(tables))if(semanticRows(raw[table])!==semanticRows(rows)) {
    const columns=Object.keys(raw[table][0]??{}).filter(k=>!stamps.has(k)&&semanticRows([{[k]:raw[table][0][k]}])!==semanticRows([{[k]:rows[0]?.[k]}]));
    throw Error(name+': unmodeled or inconsistent native menu rows in '+table+(columns.length?' ('+columns.join(', ')+')':'')+'.');
  }
  for(const table of ['PSPCMPROG','PSPCMTXT','PSPCMNAME'])for(const row of raw[table]) {
    const item=data.bars.find(b=>b.name===String(row.OBJECTVALUE2).trim())?.items.find(i=>i.name===String(row.OBJECTVALUE3).trim());
    if(!item||item.type!==9||MENU_PC_IDS.some((id,i)=>Number(row['OBJECTID'+(i+1)])!==id)||String(row.OBJECTVALUE4).trim()!=='ItemSelected'||[5,6,7].some(i=>String(row['OBJECTVALUE'+i]).trim()))throw Error(name+': unmodeled or orphaned menu PeopleCode.');
  }
  if(stored.peopleCode.size) {
    const release=(await c.execute<{R:string}>('SELECT TOOLSREL AS R FROM PSSTATUS')).rows?.[0]?.R;
    if(!release)throw Error('PeopleTools release is unavailable.');
    for(const p of stored.peopleCode.values())checkStoredProgram(p,{applicationClass:false,recordName:'',fieldName:''},String(release).trim());
  }
  if(Buffer.byteLength(canonical(raw))>8*1024*1024)throw Error('Menu migration scope exceeds 8 MiB.');
  return {data,token:createHash('sha256').update(canonical(raw)).digest('hex'),writerToken:menuToken(stored)};
}

/** Keep the writer within this menu's reviewed scope: no group-wide edits or permission-list cleanup. */
export function checkMenuMigrationUpdate(before:MenuMigrationData|undefined,after:MenuMigrationData):void {
  if(!before)return;
  if(before.type!==after.type||before.group!==after.group||before.groupOrder!==after.groupOrder||before.groupSeparator!==after.groupSeparator)throw Error('Menu migration cannot change an existing menu type or group settings.');
  const keys=new Set(after.bars.flatMap(b=>b.items.map(i=>pcKeyOf(b.name,i.name))));
  if(before.bars.some(b=>b.items.some(i=>!keys.has(pcKeyOf(b.name,i.name)))))throw Error('Menu migration cannot remove, rename or move target items; permission-list cleanup needs a separate review scope.');
}
