import type { QueryView, Row } from './queryDefinition.js';
import { QueryUnsupportedError } from './querySql.js';
import { z } from 'zod';

/** Character-field operations calibrated with Windows Query saves qry01–qry13. */
export interface QueryFieldInfo {
  type: number;
  length: number;
  decimalPositions: number;
  format: number;
  shortName: string;
  longName: string;
  editTable: string;
  useEdit: number;
}
export type QueryOp =
  | { kind: 'select'; field: string; selected: boolean }
  | { kind: 'heading'; field: string; mode: 'text' | 'short'; text?: string }
  | { kind: 'order'; field: string; position: number; descending: boolean }
  | { kind: 'constant'; field: string; value: string }
  | { kind: 'prompt'; field: string; promptNumber?: number }
  | { kind: 'clearCriteria' }
  | { kind: 'properties'; description: string; comments: string };
const fieldName=z.string().regex(/^[A-Z][A-Z0-9_]*$/);
export const queryOpSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('select'),field:fieldName,selected:z.boolean()}).strict(),
  z.object({kind:z.literal('heading'),field:fieldName,mode:z.enum(['text','short']),text:z.string().optional()}).strict(),
  z.object({kind:z.literal('order'),field:fieldName,position:z.number().int().min(0),descending:z.boolean()}).strict(),
  z.object({kind:z.literal('constant'),field:fieldName,value:z.string()}).strict(),
  z.object({kind:z.literal('prompt'),field:fieldName,promptNumber:z.number().int().positive().optional()}).strict(),
  z.object({kind:z.literal('clearCriteria')}).strict(),
  z.object({kind:z.literal('properties'),description:z.string(),comments:z.string()}).strict()
]);
export function parseQueryOp(value: unknown): QueryOp { return queryOpSchema.parse(value); }
const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => String(v ?? '').trim();
const blank = (v: string) => v || ' ';
const key = (view: QueryView) => ({OPRID: blank(s(view.query.OPRID)), QRYNAME:s(view.query.QRYNAME)});
function named(value: string): string {
  const name = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('Use a name starting with a letter, followed by letters, digits or underscores.');
  return name;
}

export function newQueryDocument(name: string, owner: string, record: string): QueryView {
  const k = {QRYNAME:named(name),OPRID:blank(owner.trim())};
  return {
    query:{...k,DESCR:' ',VERSION:0,QRYTYPE:1,SELCOUNT:1,EXPCOUNT:0,BNDCOUNT:0,QRYVALID:0,
      LASTUPDDTTM:null,LASTUPDOPRID:' ',QRYAPPROVED:'A',CREATEOPRID:' ',CREATEDTTM:null,
      APPROVEOPRID:' ',APPROVEDTTM:null,EXECLOGGING:' ',QRYDISABLED:' ',QRYFOLDER:' ',QRYJOINOPTIMIZE:0,QRYIMGTYPE:0,DESCRLONG:null},
    selects:[{...k,SELNUM:1,SELECTTYPE:1,PARENTSELNUM:0,RCDCOUNT:1,FLDCOUNT:0,CRTCOUNT:0,QRYDISTINCT:' ',HAVECRTCOUNT:0}],
    records:[{...k,SELNUM:1,RCDNUM:1,RECNAME:named(record),JOINTYPE:1,JOINRCDNUM:0,JOINFLDNUM:0,CORRNAME:'A',QRYRECPRUNABLE:' '}],
    fields:[],criteria:[],expressions:[],binds:[]
  };
}

function counters(view: QueryView): void {
  view.query.SELCOUNT=view.selects.length;
  view.query.EXPCOUNT=view.expressions.length;
  view.query.BNDCOUNT=view.binds.length;
  view.selects[0].FLDCOUNT=view.fields.length;
  view.selects[0].CRTCOUNT=view.criteria.length;
}
function references(view: QueryView): void {
  for (const f of view.fields) f.USECOUNT=view.criteria.filter(c=>n(c.LCRTFLDNUM)===n(f.FLDNUM)).length;
  for (const b of view.binds) b.USECOUNT=view.criteria.filter(c=>n(c.EXPRTYPE)===8
    && s(view.expressions.find(e=>n(e.EXPNUM)===n(c.R1CRTEXPNUM))?.EXPRESSIONTEXT)===`:${n(b.BNDNUM)}`).length;
}

export function applyQueryOp(source: QueryView, op: QueryOp, metadata: Record<string,QueryFieldInfo>): QueryView {
  if (source.selects.length!==1 || source.records.length!==1 || n(source.records[0].RCDNUM)!==1 || source.criteria.length>1) {
    throw new QueryUnsupportedError('Editing is currently calibrated for one record and at most one criterion.');
  }
  const view=structuredClone(source);
  const k=key(view);
  let f: Row | undefined;
  let info: QueryFieldInfo | undefined;
  if ('field' in op) {
    info=metadata[op.field];
    if (!info || info.type!==0) throw new QueryUnsupportedError('Only record character fields are calibrated for editing.');
    f=view.fields.find(row=>s(row.FIELDNAME)===op.field && n(row.SELNUM)===1 && n(row.FLDRCDNUM)===1);
    if (!f && op.kind==='select' && op.selected) {
      f={...k,QRYFLDNAME:`${s(view.records[0].CORRNAME)}.${op.field}`,SELNUM:1,FLDNUM:Math.max(0,...view.fields.map(row=>n(row.FLDNUM)))+1,
        RECNAME:s(view.records[0].RECNAME),FIELDNAME:op.field,FLDRCDNUM:1,FLDEXPNUM:0,HDGTYPE:3,HEADING:' ',
        COLUMNNUM:0,GROUPBYNUM:0,ORDERBYNUM:0,ORDERBYDIR:' ',TTLTYPE:1,SUBTTLNUM:0,USECOUNT:0,
        XLATTYPE:1,XLATEXPRTYPE:6,XLATFLDNUM:0,XLATEXPNUM:0,AGGREGATEFUNC:' '};
      view.fields.push(f);
    }
    if (!f) throw new Error('Select that field before editing its properties or criteria.');
  }
  switch (op.kind) {
    case 'select': {
      const old=n(f!.COLUMNNUM);
      if (op.selected && !old) {
        f!.COLUMNNUM=Math.max(0,...view.fields.map(row=>n(row.COLUMNNUM)))+1;
        f!.HDGTYPE=3; f!.HEADING=' ';
      } else if (!op.selected && old) {
        const order=n(f!.ORDERBYNUM);
        f!.COLUMNNUM=0; f!.HDGTYPE=1; f!.HEADING=' '; f!.ORDERBYNUM=0;
        for (const other of view.fields) {
          if (n(other.COLUMNNUM)>old) other.COLUMNNUM=n(other.COLUMNNUM)-1;
          if (order && n(other.ORDERBYNUM)>order) other.ORDERBYNUM=n(other.ORDERBYNUM)-1;
        }
      }
      break;
    }
    case 'heading': f!.HDGTYPE=op.mode==='text'?2:3; f!.HEADING=op.mode==='text'?blank(op.text ?? ''):' '; break;
    case 'order': {
      if (!Number.isInteger(op.position) || op.position<0 || op.position>view.fields.length) throw new Error('Invalid Order By position.');
      f!.ORDERBYNUM=op.position; f!.ORDERBYDIR=op.descending?'D':'A'; break;
    }
    case 'clearCriteria': {
      const expressions=new Set(view.criteria.map(c=>n(c.R1CRTEXPNUM)));
      view.criteria=[];
      view.expressions=view.expressions.filter(e=>!expressions.has(n(e.EXPNUM)));
      references(view); break;
    }
    case 'constant':
    case 'prompt': {
      let prompt: Row | undefined;
      if (op.kind==='prompt') {
        if (op.promptNumber!==undefined) {
          prompt=view.binds.find(b=>n(b.BNDNUM)===op.promptNumber);
          if (!prompt) throw new Error('No prompt with that number.');
        } else {
          if (![0,6].includes(info!.format)) throw new QueryUnsupportedError('This prompt format is not calibrated.');
          if (info!.editTable && !(info!.useEdit & 16384)) throw new QueryUnsupportedError('This prompt-table edit mode is not calibrated.');
          const num=Math.max(0,...view.binds.map(b=>n(b.BNDNUM)))+1;
          prompt={...k,BNDNAME:`BIND${num}`,BNDNUM:num,FIELDNAME:op.field,HDGTYPE:4,HEADING:blank(info!.longName),
            FIELDTYPE:0,LENGTH:info!.length,DECIMALPOS:0,FORMAT:info!.format,EDITTABLE:blank(info!.editTable),
            USECOUNT:1,USEEDIT:info!.editTable?16384:0,QRYREQUIREDPROMPT:'Y',QRYPROMPTDEFAULT:' '};
          view.binds.push(prompt);
        }
      }
      const previous=view.criteria[0];
      const expnum=previous?n(previous.R1CRTEXPNUM):Math.max(0,...view.expressions.map(e=>n(e.EXPNUM)))+1;
      let expression=view.expressions.find(e=>n(e.EXPNUM)===expnum);
      if (!expression) { expression={...k,EXPNUM:expnum,FIELDTYPE:0,LENGTH:0,DECIMALPOS:0,USECOUNT:1,EXPRESSIONTEXT:' '}; view.expressions.push(expression); }
      expression.EXPRESSIONTEXT=op.kind==='constant'?blank(op.value):`:${n(prompt!.BNDNUM)}`;
      view.criteria=[{...k,SELNUM:1,CRTNUM:1,COMBTYPE:3,NEGATION:' ',LPARENLVL:0,LCRTSELNUM:1,LCRTFLDNUM:n(f!.FLDNUM),
        CONDTYPE:2,EXPRTYPE:op.kind==='constant'?1:8,R1CRTSELNUM:0,R1CRTFLDNUM:0,R1CRTEXPNUM:expnum,
        R2CRTSELNUM:0,R2CRTFLDNUM:0,R2CRTEXPNUM:0,RPARENLVL:0,QRYOJSELNUM:0}];
      references(view); break;
    }
    case 'properties': view.query.DESCR=blank(op.description); view.query.DESCRLONG=op.comments || null; break;
  }
  counters(view);
  return view;
}

export function copyQueryDocument(source: QueryView, name: string, owner: string): QueryView {
  const view=structuredClone(source);
  const k={QRYNAME:named(name),OPRID:blank(owner.trim())};
  for (const row of [view.query,...view.selects,...view.records,...view.fields,...view.criteria,...view.expressions,...view.binds]) Object.assign(row,k);
  view.query.VERSION=0; view.query.CREATEOPRID=' '; view.query.CREATEDTTM=null; view.query.LASTUPDOPRID=' '; view.query.LASTUPDDTTM=null;
  return view;
}
