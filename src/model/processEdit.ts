import { createHash } from 'node:crypto';
import { PROCESS_TRANSLATE_FIELDS, type ProcessView, type Row } from './processDefinition.js';
export interface ProcessField { name: string; label: string; section: string; length?: number; max?: number; multiline?: boolean }
const fields = (section: string, entries: [string, string, number][]): ProcessField[] => entries.map(([name,label,length])=>({name,label,length,section}));
export const PROCESS_FIELDS: ProcessField[] = [
  ...fields('General', [['DESCR','Description',30],['PRCSPRIORITY','Priority',1],['RUNLOCATION','Run location',1],['APIAWARE','API aware',1],['LOGRQST','Log request',1],['PRCSCATEGORY','Process category',30],['SERVERNAME','Server',8],['RECURNAME','Recurrence',30]]),
  {name:'DESCRLONG',label:'Long description',section:'General',multiline:true},
  ...fields('Overrides', [['PARMLISTTYPE','Parameter list mode',1],['PARMLIST','Parameter list',254],['CMDLINETYPE','Command line mode',1],['CMDLINE','Command line',127],['WORKINGDIRTYPE','Working directory mode',1],['WORKINGDIR','Working directory',127]]),
  ...fields('Output', [['OUTDESTTYPE','Output type',3],['OUTDESTFORMAT','Output format',3],['OUTDESTSRC','Destination source',1],['OUTDEST','Output destination',127]]),
  ...fields('Options', [['RESTARTENABLED','Restart enabled',1],['RECVRYPRCSTYPE','Recovery process type',30],['RECVRYPRCSNAME','Recovery process name',12]]),
  ...[['RETRYCOUNT','Retry count',99],['MAXCONCURRENT','Maximum concurrent',999],['TIMEOUTMINUTES','Timeout (minutes)',99999],['RETENTIONDAYS','Retention (days)',999]].map(([name,label,max])=>({name:String(name),label:String(label),max:Number(max),section:'Options'}))
];
export interface ProcessEdit { properties: Record<string,string>; components: string[]; groups: string[] }
export const processValue = (v: unknown): string => String(v ?? '').trimEnd();
export function processEdit(view: ProcessView): ProcessEdit {
  return {properties:Object.fromEntries(PROCESS_FIELDS.filter(f=>f.name in view.process).map(f=>[f.name,f.multiline ? String(view.process[f.name] ?? '') : processValue(view.process[f.name])])),components:view.components.map(r=>processValue(r.PNLGRPNAME)).sort(),groups:view.groups.map(r=>processValue(r.PRCSGRP)).sort()};
}
export function processToken(view: ProcessView): string {
  const row = (r: Row) => Object.keys(r).sort().map(k=>[k,r[k]]);
  return createHash('sha256').update(JSON.stringify([row(view.process),view.components.map(row).sort(),view.groups.map(row).sort()])).digest('hex');
}
export function validateProcessEdit(input: unknown, view: ProcessView): ProcessEdit {
  if (!input || typeof input !== 'object') throw new Error('Invalid process definition.');
  const e=input as ProcessEdit;
  if (!e.properties || typeof e.properties !== 'object' || Array.isArray(e.properties)) throw new Error('Invalid properties.');
  const expected=processEdit(view);
  if (Object.keys(e.properties).length !== Object.keys(expected.properties).length) throw new Error('Incomplete process properties.');
  for (const [name,value] of Object.entries(e.properties)) {
    const f=PROCESS_FIELDS.find(x=>x.name===name);
    if (!f || !(name in expected.properties) || typeof value!=='string') throw new Error(`Unsupported property: ${name}`);
    if (f.length && value.length>f.length) throw new Error(`${f.label} exceeds ${f.length} characters.`);
    if (f.max!==undefined && (!/^\d+$/.test(value) || Number(value)>f.max)) throw new Error(`${f.label} must be an integer from 0 to ${f.max}.`);
    const options=view.translates.get(name);
    if (value!==expected.properties[name] && PROCESS_TRANSLATE_FIELDS.includes(name) && !options?.has(value)) throw new Error(`Invalid ${f.label}.`);
    if (name==='RESTARTENABLED' && !['','0','1'].includes(value)) throw new Error('Invalid restart setting.');
  }
  for (const [key,max] of [['components',18],['groups',30]] as const) {
    const values=e[key];
    if (!Array.isArray(values) || values.some(v=>typeof v!=='string'||!v.trim()||v!==v.trim()||v.length>max)||new Set(values).size!==values.length) throw new Error(`Invalid or duplicate ${key}.`);
  }
  if (!e.properties.DESCR?.trim()) throw new Error('Description is required.');
  if (!e.groups.length) throw new Error('At least one process group is required.');
  if (e.properties.RECVRYPRCSTYPE===processValue(view.process.PRCSTYPE) && e.properties.RECVRYPRCSNAME===processValue(view.process.PRCSNAME)) throw new Error('A process cannot be its own recovery process.');
  return structuredClone(e);
}
