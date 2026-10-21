import type { QueryView, Row } from './queryDefinition.js';
import { QueryUnsupportedError } from './querySql.js';
import { z } from 'zod';

/** Field operations calibrated with Windows Query saves qry01–qry13; typed criteria with qcr01–qcr10 and qnm01–qnm04. */
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
  | { kind: 'criteria'; criteria: QueryCriterion[] }
  | { kind: 'properties'; description: string; comments: string };
/** PSQRYCRITERIA.CONDTYPE for each Windows Query operator (CONDITIONS in queryDefinition.ts). */
export const QUERY_OPERATORS={equal:2,notEqual:3,greater:4,notGreater:5,less:6,notLess:7,inList:8,notInList:9,
  between:10,notBetween:11,like:14,notLike:15,isNull:16,isNotNull:17} as const;
export type QueryOperator=keyof typeof QUERY_OPERATORS;
export type QueryOperand={constant:string}|{field:string}|{prompt:number|'new'}|{list:string[]};
export interface QueryCriterion { field:string; operator:QueryOperator; logical?:'AND'|'OR'; not?:boolean; open?:number; close?:number; value?:QueryOperand; value2?:QueryOperand }
const fieldName=z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const operand=z.union([z.object({constant:z.string().max(254)}).strict(),z.object({field:fieldName}).strict(),
  z.object({prompt:z.union([z.number().int().positive(),z.literal('new')])}).strict(),z.object({list:z.array(z.string().max(254)).min(1).max(100)}).strict()]);
const criterion=z.object({field:fieldName,operator:z.enum(Object.keys(QUERY_OPERATORS) as [QueryOperator,...QueryOperator[]]),
  logical:z.enum(['AND','OR']).optional(),not:z.boolean().optional(),open:z.number().int().min(0).max(9).optional(),close:z.number().int().min(0).max(9).optional(),
  value:operand.optional(),value2:operand.optional()}).strict();
export const queryOpSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('select'),field:fieldName,selected:z.boolean()}).strict(),
  z.object({kind:z.literal('heading'),field:fieldName,mode:z.enum(['text','short']),text:z.string().optional()}).strict(),
  z.object({kind:z.literal('order'),field:fieldName,position:z.number().int().min(0),descending:z.boolean()}).strict(),
  z.object({kind:z.literal('constant'),field:fieldName,value:z.string()}).strict(),
  z.object({kind:z.literal('prompt'),field:fieldName,promptNumber:z.number().int().positive().optional()}).strict(),
  z.object({kind:z.literal('clearCriteria')}).strict(),
  z.object({kind:z.literal('criteria'),criteria:z.array(criterion).max(50)}).strict(),
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
  // qcr10: a field compared on the right counts as a use too.
  for (const f of view.fields) f.USECOUNT=view.criteria.reduce((sum,c)=>sum+[c.LCRTFLDNUM,n(c.EXPRTYPE)===2?c.R1CRTFLDNUM:0].filter(v=>n(v)===n(f.FLDNUM)).length,0);
  for (const b of view.binds) b.USECOUNT=view.criteria.filter(c=>n(c.EXPRTYPE)===8
    && s(view.expressions.find(e=>n(e.EXPNUM)===n(c.R1CRTEXPNUM))?.EXPRESSIONTEXT)===`:${n(b.BNDNUM)}`).length;
}

export function applyQueryOp(source: QueryView, op: QueryOp, metadata: Record<string,QueryFieldInfo>): QueryView {
  if (source.selects.length!==1 || source.records.length!==1 || n(source.records[0].RCDNUM)!==1) {
    throw new QueryUnsupportedError('Editing is currently calibrated for one record.');
  }
  if ((op.kind==='constant' || op.kind==='prompt') && source.criteria.length>1) {
    throw new QueryUnsupportedError('This query has several criteria; edit them together as criteria.');
  }
  const view=structuredClone(source);
  const k=key(view);
  let f: Row | undefined;
  let info: QueryFieldInfo | undefined;
  if (op.kind==='criteria') { setCriteria(view,op.criteria,metadata); counters(view); return view; }
  if ('field' in op) {
    info=metadata[op.field];
    // qnm01: number and date fields are selected exactly like character fields; their prompts use criteria.
    if (!info || ![0,2,4].includes(info.type) || info.type!==0 && (op.kind==='constant' || op.kind==='prompt')) throw new QueryUnsupportedError('Only record character, number and date fields are calibrated for editing.');
    f=view.fields.find(row=>s(row.FIELDNAME)===op.field && n(row.SELNUM)===1 && n(row.FLDRCDNUM)===1);
    // Windows Query's New Criteria on an unselected field adds it as a criteria-only
    // field: no column, heading None (8.61.15 XX_QRY_AD2, as an unselect leaves it).
    const criterion=op.kind==='constant' || op.kind==='prompt';
    if (!f && (op.kind==='select' && op.selected || criterion)) {
      f={...k,QRYFLDNAME:`${s(view.records[0].CORRNAME)}.${op.field}`,SELNUM:1,FLDNUM:Math.max(0,...view.fields.map(row=>n(row.FLDNUM)))+1,
        RECNAME:s(view.records[0].RECNAME),FIELDNAME:op.field,FLDRCDNUM:1,FLDEXPNUM:0,HDGTYPE:criterion?1:3,HEADING:' ',
        COLUMNNUM:0,GROUPBYNUM:0,ORDERBYNUM:0,ORDERBYDIR:' ',TTLTYPE:1,SUBTTLNUM:0,USECOUNT:0,
        XLATTYPE:1,XLATEXPRTYPE:6,XLATFLDNUM:0,XLATEXPNUM:0,AGGREGATEFUNC:' '};
      view.fields.push(f);
    }
    if (!f) throw new Error('Select that field before editing its properties.');
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

function fieldRow(view: QueryView, field: string, metadata: Record<string,QueryFieldInfo>): Row {
  const info=metadata[field];
  if (!info || ![0,2,4].includes(info.type)) throw new QueryUnsupportedError(`${field}: only record character, number and date fields are calibrated for criteria.`);
  let f=view.fields.find(row=>s(row.FIELDNAME)===field && n(row.SELNUM)===1 && n(row.FLDRCDNUM)===1);
  if (!f) {
    // As New Criteria on an unselected field: criteria-only, no column, heading None.
    f={...key(view),QRYFLDNAME:`${s(view.records[0].CORRNAME)}.${field}`,SELNUM:1,FLDNUM:Math.max(0,...view.fields.map(row=>n(row.FLDNUM)))+1,
      RECNAME:s(view.records[0].RECNAME),FIELDNAME:field,FLDRCDNUM:1,FLDEXPNUM:0,HDGTYPE:1,HEADING:' ',
      COLUMNNUM:0,GROUPBYNUM:0,ORDERBYNUM:0,ORDERBYDIR:' ',TTLTYPE:1,SUBTTLNUM:0,USECOUNT:0,
      XLATTYPE:1,XLATEXPRTYPE:6,XLATFLDNUM:0,XLATEXPNUM:0,AGGREGATEFUNC:' '};
    view.fields.push(f);
  }
  return f;
}
const isoDate=(v: string)=>/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
/** Expression text as Windows Query stores it: ISO dates (qnm02), bare numbers (qnm01), quoted lists (qcr08). */
function constantText(value: string, type: number, field: string): string {
  if (type===2 && !/^-?[0-9]+(\.[0-9]+)?$/.test(value)) throw new Error(`${field}: enter a number.`);
  if (type===4 && !isoDate(value)) throw new Error(`${field}: enter a date as YYYY-MM-DD.`);
  return blank(value);
}
type Operand=QueryOperand|undefined;
const identity=(kind: string, text: string)=>`${kind}:${text}`;
/**
 * Replace every criterion, numbering expressions as Windows Query does: a criterion
 * keeps its expression when that operand is unchanged and an operand-less operator
 * keeps the one it had (qcr09, qcr10); kept expressions are compacted in their old
 * order and new ones appended (qnm04). Unused prompts stay, as qry10 showed.
 */
function setCriteria(view: QueryView, specs: QueryCriterion[], metadata: Record<string,QueryFieldInfo>): void {
  const k=key(view), previous=[...view.criteria].sort((a,b)=>n(a.CRTNUM)-n(b.CRTNUM));
  const old=new Map(view.expressions.map(e=>[n(e.EXPNUM),e]));
  const previousId=(c: Row|undefined, side: 'R1'|'R2')=>{
    const e=c && old.get(n(c[`${side}CRTEXPNUM`]));
    if (!c || !e) return undefined;
    const kind=({1:'constant',9:'constant',5:'list',8:'prompt'} as Record<number,string>)[n(c.EXPRTYPE)];
    return kind && identity(kind,s(e.EXPRESSIONTEXT));
  };
  const kept: number[]=[], fresh: Row[]=[];
  const rows=specs.map((spec,i)=>{
    const left=fieldRow(view,spec.field,metadata), info=metadata[spec.field], before=previous[i];
    const cond=QUERY_OPERATORS[spec.operator], twoSided=cond===10 || cond===11, list=cond===8 || cond===9, none=cond===16 || cond===17;
    const like=cond===14 || cond===15;
    if (none ? spec.value || spec.value2 : !spec.value || !!spec.value2!==twoSided) throw new Error(`${spec.field} ${spec.operator}: wrong number of operands.`);
    if (info.type!==0 && (list || twoSided || like)) throw new QueryUnsupportedError(`${spec.operator} is calibrated for character fields only.`);
    if (twoSided && !('constant' in spec.value! && 'constant' in spec.value2!)) throw new QueryUnsupportedError('Between is calibrated for two constants only.');
    if (list !== ('list' in (spec.value ?? {}))) throw new Error(`${spec.operator} takes ${list?'a list of values':'a single value'}.`);
    if (like && !('constant' in spec.value! || 'prompt' in spec.value!)) throw new Error('Like takes a constant or prompt.');
    if (spec.value && 'field' in spec.value && (info.type!==0 || metadata[spec.value.field]?.type!==0)) throw new QueryUnsupportedError('Field comparison is calibrated for character fields only.');
    let exprtype=none?0:twoSided?9:1;
    const r1={SELNUM:0,FLDNUM:0,EXPNUM:0}, r2={SELNUM:0,FLDNUM:0,EXPNUM:0};
    const place=(value: Operand, side: 'R1'|'R2', target: typeof r1)=>{
      if (!value) return;
      if ('field' in value) { exprtype=2; target.SELNUM=1; target.FLDNUM=n(fieldRow(view,value.field,metadata).FLDNUM); return; }
      let kind: string, text: string, fieldtype=0;
      if ('constant' in value) { kind='constant'; text=constantText(value.constant,info.type,spec.field); fieldtype=info.type; }
      else if ('list' in value) { kind='list'; exprtype=5; text=`(${value.list.map(v=>`'${v.replace(/'/g,"''")}'`).join(',')})`; }
      else {
        exprtype=8; kind='prompt';
        let bind=value.prompt==='new' ? undefined : view.binds.find(b=>n(b.BNDNUM)===value.prompt);
        if (value.prompt!=='new' && !bind) throw new Error('No prompt with that number.');
        if (!bind) {
          if (info.type===0 && ![0,6].includes(info.format) || info.type!==0 && (info.decimalPositions || info.editTable)) throw new QueryUnsupportedError('This prompt format is not calibrated.');
          if (info.editTable && !(info.useEdit & 16384)) throw new QueryUnsupportedError('This prompt-table edit mode is not calibrated.');
          const num=Math.max(0,...view.binds.map(b=>n(b.BNDNUM)))+1;
          // qnm03/qnm04: a number or date prompt takes the field's type and length, format 0, no edit.
          bind={...k,BNDNAME:`BIND${num}`,BNDNUM:num,FIELDNAME:spec.field,HDGTYPE:4,HEADING:blank(info.longName),
            FIELDTYPE:info.type,LENGTH:info.length,DECIMALPOS:0,FORMAT:info.type===0?info.format:0,EDITTABLE:blank(info.editTable),
            USECOUNT:1,USEEDIT:info.editTable?16384:0,QRYREQUIREDPROMPT:'Y',QRYPROMPTDEFAULT:' '};
          view.binds.push(bind);
        }
        text=`:${n(bind.BNDNUM)}`;
      }
      const reuse=previousId(before,side)===identity(kind,text) ? n(before![`${side}CRTEXPNUM`]) : 0;
      if (reuse) { kept.push(reuse); target.EXPNUM=reuse; return; }
      const row={...k,EXPNUM:-(fresh.length+1),FIELDTYPE:fieldtype,LENGTH:0,DECIMALPOS:0,USECOUNT:1,EXPRESSIONTEXT:text};
      fresh.push(row); target.EXPNUM=n(row.EXPNUM);
    };
    place(spec.value,'R1',r1); place(spec.value2,'R2',r2);
    if (none && before && n(before.R1CRTEXPNUM) && old.has(n(before.R1CRTEXPNUM))) { kept.push(n(before.R1CRTEXPNUM)); r1.EXPNUM=n(before.R1CRTEXPNUM); }
    return {...k,SELNUM:1,CRTNUM:i+1,COMBTYPE:i?(spec.logical==='OR'?2:1):3,NEGATION:spec.not?'N':' ',LPARENLVL:spec.open??0,
      LCRTSELNUM:1,LCRTFLDNUM:n(left.FLDNUM),CONDTYPE:cond,EXPRTYPE:exprtype,R1CRTSELNUM:r1.SELNUM,R1CRTFLDNUM:r1.FLDNUM,R1CRTEXPNUM:r1.EXPNUM,
      R2CRTSELNUM:r2.SELNUM,R2CRTFLDNUM:r2.FLDNUM,R2CRTEXPNUM:r2.EXPNUM,RPARENLVL:spec.close??0,QRYOJSELNUM:0};
  });
  if (specs.reduce((d,c)=>d+(c.open??0)-(c.close??0),0) || specs.some((_,i)=>specs.slice(0,i+1).reduce((d,c)=>d+(c.open??0)-(c.close??0),0)<0)) throw new Error('Criteria parentheses do not balance.');
  const order=[...new Set(kept)].sort((a,b)=>a-b), renumber=new Map<number,number>(order.map((e,i)=>[e,i+1]));
  fresh.forEach((e,i)=>renumber.set(n(e.EXPNUM),order.length+i+1));
  view.expressions=[...order.map(e=>({...old.get(e)!,EXPNUM:renumber.get(e)!})),...fresh.map(e=>({...e,EXPNUM:renumber.get(n(e.EXPNUM))!}))];
  for (const row of rows) for (const side of ['R1','R2']) if (n(row[`${side}CRTEXPNUM` as 'R1CRTEXPNUM'])) row[`${side}CRTEXPNUM` as 'R1CRTEXPNUM']=renumber.get(n(row[`${side}CRTEXPNUM` as 'R1CRTEXPNUM']))!;
  view.criteria=rows;
  references(view);
}

export function copyQueryDocument(source: QueryView, name: string, owner: string): QueryView {
  const view=structuredClone(source);
  const k={QRYNAME:named(name),OPRID:blank(owner.trim())};
  for (const row of [view.query,...view.selects,...view.records,...view.fields,...view.criteria,...view.expressions,...view.binds]) Object.assign(row,k);
  view.query.VERSION=0; view.query.CREATEOPRID=' '; view.query.CREATEDTTM=null; view.query.LASTUPDOPRID=' '; view.query.LASTUPDDTTM=null;
  return view;
}
