import type { DbConnection, DbTypes, ColumnInfo } from '../db/connection.js';
import type { QueryView, Row } from '../model/queryDefinition.js';
import { QUERY_TABLES, queryRows, queryToken, canonicalQueryRows, planQuerySave, type QueryTable } from '../model/querySavePlan.js';
import { prepareQueryExecution } from './queryRunner.js';
import { expectRows } from './peopleCodeWriter.js';
import { writeScopeRefusal } from './writeScope.js';

const TABLES=Object.keys(QUERY_TABLES) as QueryTable[];
const TIME_FORMAT=`'YYYY-MM-DD"T"HH24:MI:SS.FF9'`;
const timestamp=(column: ColumnInfo) => /^(DATE|TIMESTAMP)/.test(column.dataType);
export interface QueryEdit { view: QueryView; token: string }
export interface QuerySaveRequest { view: QueryView; openedToken: string; operatorId: string }
export interface QuerySaveResult extends QueryEdit { written: boolean; replaced: Record<string,number> }

async function readTable(c: DbConnection, types: DbTypes, table: QueryTable, name: string, owner: string, lock = false): Promise<Row[]> {
  const columns=await c.catalog.columns(c,table);
  if (!columns.length) throw new Error(`${table} is missing.`);
  const projection=columns.map(col=>timestamp(col)?`TO_CHAR(CAST(${col.name} AS TIMESTAMP(9)), ${TIME_FORMAT}) AS ${col.name}`:col.name).join(', ');
  const fetchInfo=Object.fromEntries(columns.filter(col=>/CLOB/.test(col.dataType)).map(col=>[col.name,{type:types.STRING}]));
  return (await c.execute<Row>(`SELECT ${projection} FROM ${table} WHERE QRYNAME=:n AND OPRID=:o${lock?' FOR UPDATE':''}`,
    {n:name,o:owner.trim() || ' '},{outFormat:types.OUT_FORMAT_OBJECT,fetchInfo})).rows ?? [];
}

export async function readQueryForEdit(c: DbConnection, types: DbTypes, name: string, owner: string, lock = false): Promise<QueryEdit | undefined> {
  const query=await readTable(c,types,'PSQRYDEFN',name,owner,lock);
  if (!query.length) return undefined;
  if (query.length!==1) throw new Error('More than one query header matches this key.');
  const view: QueryView={query:query[0],selects:[],records:[],fields:[],criteria:[],expressions:[],binds:[]};
  for (const table of TABLES.filter(t=>t!=='PSQRYDEFN')) {
    const property=QUERY_TABLES[table] as Exclude<typeof QUERY_TABLES[QueryTable],'query'>;
    view[property]=await readTable(c,types,table,name,owner);
  }
  return {view,token:queryToken(view)};
}

function validateShape(view: QueryView): void {
  const header=view.query;
  if (String(header.QRYAPPROVED ?? '').trim()!=='A' || String(header.APPROVEOPRID ?? '').trim() || header.APPROVEDTTM!==null
    || String(header.EXECLOGGING ?? '').trim() || Number(header.QRYJOINOPTIMIZE) || Number(header.QRYIMGTYPE)) {
    throw new Error('This query approval, logging or optimization state is not calibrated for saving.');
  }
  const counts={SELCOUNT:view.selects.length,EXPCOUNT:view.expressions.length,BNDCOUNT:view.binds.length};
  for (const [column,value] of Object.entries(counts)) if (Number(header[column])!==value) throw new Error(`Query ${column} is inconsistent.`);
  if (view.expressions.length!==view.criteria.length || Number(view.selects[0]?.FLDCOUNT)!==view.fields.length
    || Number(view.selects[0]?.CRTCOUNT)!==view.criteria.length) throw new Error('Query field, criterion or expression counts are inconsistent.');
  for (const table of TABLES) for (const row of queryRows(view,table)) {
    if (String(row.QRYNAME).trim()!==String(header.QRYNAME).trim() || String(row.OPRID).trim()!==String(header.OPRID).trim()) {
      throw new Error('All query rows must belong to the same query key.');
    }
  }
}

async function ancillaryRows(c: DbConnection, name: string, owner: string): Promise<void> {
  const catalog=(await c.execute<{TABLE_NAME:string}>(`SELECT T.TABLE_NAME FROM ALL_TABLES T
    WHERE T.OWNER=SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AND T.TABLE_NAME LIKE 'PSQRY%'
    AND EXISTS (SELECT 1 FROM ALL_TAB_COLUMNS X WHERE X.OWNER=T.OWNER AND X.TABLE_NAME=T.TABLE_NAME AND X.COLUMN_NAME='QRYNAME')
    AND EXISTS (SELECT 1 FROM ALL_TAB_COLUMNS X WHERE X.OWNER=T.OWNER AND X.TABLE_NAME=T.TABLE_NAME AND X.COLUMN_NAME='OPRID')`)).rows ?? [];
  for (const {TABLE_NAME:table} of catalog) {
    if (TABLES.includes(table as QueryTable)) continue;
    if (!/^[A-Z0-9_]+$/.test(table)) throw new Error('Unexpected table identifier.');
    const rows=(await c.execute(`SELECT QRYNAME FROM ${table} WHERE QRYNAME=:n AND OPRID=:o AND ROWNUM<=1`,{n:name,o:owner.trim() || ' '})).rows ?? [];
    if (rows.length) throw new Error(`${table} has related rows; this save shape is not calibrated.`);
  }
}

async function verifyView(c: DbConnection, types: DbTypes, expected: QueryView): Promise<QueryEdit> {
  const read=await readQueryForEdit(c,types,String(expected.query.QRYNAME).trim(),String(expected.query.OPRID).trim());
  if (!read) throw new Error('Saved query is missing.');
  for (const table of TABLES) if (canonicalQueryRows(queryRows(read.view,table))!==canonicalQueryRows(queryRows(expected,table))) {
    throw new Error(`${table}: saved query rows do not match the save plan.`);
  }
  return read;
}

export async function saveQuery(c: DbConnection, types: DbTypes, request: QuerySaveRequest): Promise<QuerySaveResult> {
  const name=String(request.view.query.QRYNAME ?? '').trim();
  const owner=String(request.view.query.OPRID ?? '').trim();
  const refusal=writeScopeRefusal(name);
  if (refusal) throw new Error(refusal);
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('Invalid query name.');
  try {
    const [release]=(await c.execute<{TOOLSREL:string;PTPATCHREL:number}>('SELECT TOOLSREL,PTPATCHREL FROM PSSTATUS')).rows ?? [];
    if (!release || String(release.TOOLSREL).trim()!=='8.62' || Number(release.PTPATCHREL)!==9) throw new Error('Query saves are currently calibrated for PeopleTools 8.62.09.');
    await prepareQueryExecution(c,request.view,request.operatorId);
    validateShape(request.view);
    const [limits]=(await c.execute<{LENGTH:number}>('SELECT LENGTH FROM PSDBFIELD WHERE FIELDNAME=:f',{f:'QRYNAME'})).rows ?? [];
    if (!limits || name.length>Number(limits.LENGTH)) throw new Error('Query name exceeds the field definition length.');
    await ancillaryRows(c,name,owner);
    // Take the shared counters before the definition lock, as the other writers do.
    const counters=(await c.execute<{OBJECTTYPENAME:string;VERSION:number}>(`SELECT OBJECTTYPENAME,VERSION FROM PSVERSION
      WHERE OBJECTTYPENAME IN ('QDM','SYS') FOR UPDATE`)).rows ?? [];
    const locks=(await c.execute<{VERSION:number}>("SELECT VERSION FROM PSLOCK WHERE OBJECTTYPENAME='QDM' FOR UPDATE")).rows ?? [];
    const qdm=counters.find(row=>String(row.OBJECTTYPENAME).trim()==='QDM');
    const sys=counters.find(row=>String(row.OBJECTTYPENAME).trim()==='SYS');
    if (!qdm || !sys || locks.length!==1 || Number(locks[0].VERSION)!==Number(qdm.VERSION)) throw new Error('Query version counters are missing or inconsistent.');
    const stored=await readQueryForEdit(c,types,name,owner,true);
    if (request.openedToken==='absent' ? !!stored : !stored || stored.token!==request.openedToken) {
      throw new Error('Query changed since it was opened, or that name already exists. Reload before saving.');
    }
    if (!stored) for (const table of TABLES.filter(t=>t!=='PSQRYDEFN')) {
      if ((await readTable(c,types,table,name,owner)).length) throw new Error('Orphan query rows exist under the new key.');
    }
    if (stored && queryToken(request.view)===stored.token) { await c.rollback(); return {...stored,written:false,replaced:{}}; }
    const [clock]=(await c.execute<{UPDATED_AT:string;CREATED_AT:string}>(`SELECT
      TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIME_FORMAT}) AS UPDATED_AT,
      TO_CHAR(CAST(SYSDATE AS TIMESTAMP(9)), ${TIME_FORMAT}) AS CREATED_AT FROM DUAL`)).rows ?? [];
    if (!clock) throw new Error('No database clock.');
    const planned=planQuerySave(request.view,{version:Number(qdm.VERSION)+1,operator:request.operatorId,updatedAt:clock.UPDATED_AT,createdAt:clock.CREATED_AT},stored?.view);
    const columns: Record<string,ColumnInfo[]>={};
    for (const table of TABLES) {
      columns[table]=await c.catalog.columns(c,table);
      for (const row of queryRows(planned,table)) for (const column of columns[table]) {
        if (!Object.hasOwn(row,column.name)) throw new Error(`${table}.${column.name} is not represented by this save plan.`);
      }
    }
    const names=[...new Set(Object.values(columns).flat().map(column=>column.name))];
    const lengthBinds=Object.fromEntries(names.map((field,i)=>[`f${i}`,field]));
    const lengths=(await c.execute<{FIELDNAME:string;LENGTH:number}>(`SELECT FIELDNAME,LENGTH FROM PSDBFIELD
      WHERE FIELDTYPE=0 AND FIELDNAME IN (${names.map((_,i)=>`:f${i}`).join(',')})`,lengthBinds)).rows ?? [];
    const limitsByName=new Map(lengths.map(row=>[String(row.FIELDNAME).trim(),Number(row.LENGTH)]));
    for (const table of TABLES) for (const row of queryRows(planned,table)) for (const column of columns[table]) {
      const limit=limitsByName.get(column.name);
      const value=row[column.name];
      if (limit!==undefined && typeof value==='string' && value.length>limit) throw new Error(`${column.name} exceeds its ${limit} character length.`);
    }
    const replaced: Record<string,number>={};
    for (const table of [...TABLES].reverse()) {
      const count=stored?queryRows(stored.view,table).length:0;
      await expectRows(c,`DELETE FROM ${table} WHERE QRYNAME=:n AND OPRID=:o`,{n:name,o:owner || ' '},count,`Replacing ${table}`);
      replaced[table]=count;
    }
    for (const table of TABLES) for (const row of queryRows(planned,table)) {
      const binds: Record<string,unknown>={};
      const values=columns[table].map((column,i)=>{
        const parameter=`v${i}`;
        const value=row[column.name];
        binds[parameter]=/CLOB/.test(column.dataType) && value!==null?{val:value,type:types.CLOB}:value;
        return timestamp(column)?`TO_TIMESTAMP(:${parameter},${TIME_FORMAT})`:`:${parameter}`;
      });
      await expectRows(c,`INSERT INTO ${table} (${columns[table].map(col=>col.name).join(',')}) VALUES (${values.join(',')})`,binds,1,`Inserting ${table}`);
    }
    await expectRows(c,"UPDATE PSVERSION SET VERSION=VERSION+1 WHERE OBJECTTYPENAME IN ('QDM','SYS')",{},2,'Updating QDM and SYS');
    await expectRows(c,"UPDATE PSLOCK SET VERSION=VERSION+1 WHERE OBJECTTYPENAME='QDM'",{},1,'Updating QDM lock');
    const verified=await verifyView(c,types,planned);
    await c.commit();
    return {...verified,written:true,replaced};
  } catch (error) { await c.rollback(); throw error; }
}

export async function verifyQuerySave(c: DbConnection, types: DbTypes, result: QuerySaveResult): Promise<void> {
  await verifyView(c,types,result.view);
}
