import { createHash } from 'node:crypto';
import type { QueryView, Row } from './queryDefinition.js';

export const QUERY_TABLES = {
  PSQRYDEFN:'query', PSQRYSELECT:'selects', PSQRYRECORD:'records', PSQRYFIELD:'fields',
  PSQRYCRITERIA:'criteria', PSQRYEXPR:'expressions', PSQRYBIND:'binds'
} as const;
export type QueryTable = keyof typeof QUERY_TABLES;
export function queryRows(view: QueryView, table: QueryTable): Row[] {
  const value=view[QUERY_TABLES[table]];
  return Array.isArray(value)?value:[value];
}
export function canonicalQueryRows(rows: Row[]): string {
  return JSON.stringify(rows.map(row=>Object.fromEntries(Object.keys(row).filter(k=>k!=='CAPTURE_ROWID' && k!=='LASTUPD').sort()
    .map(k=>[k,row[k]===null?null:String(row[k])]))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
export function queryToken(view: QueryView): string {
  return createHash('sha256').update(Object.keys(QUERY_TABLES).map(t=>canonicalQueryRows(queryRows(view,t as QueryTable))).join('\n')).digest('hex');
}

export interface QuerySaveClock { version: number; operator: string; updatedAt: string; createdAt: string }
/** Row replacement and QDM VERSION observed in qry01–qry13; runtime clocks are supplied separately. */
export function planQuerySave(source: QueryView, clock: QuerySaveClock, stored?: QueryView): QueryView {
  const view=structuredClone(source);
  const owner=String(view.query.OPRID ?? '').trim() || ' ';
  const name=String(view.query.QRYNAME ?? '').trim();
  if (!name) throw new Error('A query name is required.');
  for (const table of Object.keys(QUERY_TABLES) as QueryTable[]) {
    for (const row of queryRows(view,table)) { row.OPRID=owner; row.QRYNAME=name; delete row.CAPTURE_ROWID; delete row.LASTUPD; }
  }
  view.query.VERSION=clock.version;
  view.query.LASTUPDOPRID=clock.operator;
  view.query.LASTUPDDTTM=clock.updatedAt;
  view.query.CREATEOPRID=stored?stored.query.CREATEOPRID:clock.operator;
  view.query.CREATEDTTM=stored?stored.query.CREATEDTTM:clock.createdAt;
  return view;
}
