import type { QueryView, Row } from './queryDefinition.js';
import { QueryUnsupportedError } from './querySql.js';
import { z } from 'zod';

/**
 * Field operations calibrated with Windows Query saves qry01–qry13; typed criteria with qcr01–qcr10
 * and qnm01–qnm04; joins qjn01–qjn04; aggregates, HAVING and DISTINCT qag01–qag05; expressions
 * qex01–qex03; subqueries qsq01–qsq02; unions qun01; translates and base effective dating qxl01–qxl02; effective-date operators qed01–qed06.
 */
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
  | { kind: 'criteria'; criteria: QueryCriterion[]; select?: number }
  | { kind: 'having'; criteria: QueryCriterion[] }
  | { kind: 'join'; record: string; type: 'standard' | 'leftOuter' | 'related'; field?: string; effectiveDate?: 'current' | 'none' }
  | { kind: 'aggregate'; field: string; function: QueryAggregate }
  | { kind: 'distinct'; distinct: boolean; select?: number }
  | { kind: 'expression'; text: string; type: 'character' | 'number'; length: number; decimalPositions?: number }
  | { kind: 'translate'; field: string; value: 'none' | 'short' | 'long'; effectiveDate?: 'current' | { field: string } }
  | { kind: 'union'; record: string }
  | { kind: 'properties'; description: string; comments: string };
/** PSQRYCRITERIA.CONDTYPE for each Windows Query operator (CONDITIONS in queryDefinition.ts). */
export const QUERY_OPERATORS={equal:2,notEqual:3,greater:4,notGreater:5,less:6,notLess:7,inList:8,notInList:9,
  between:10,notBetween:11,exists:12,notExists:13,like:14,notLike:15,isNull:16,isNotNull:17,effectiveDate:20,
  // qed01-qed05: Eff Date >=, <, > against the current date; First / Last Eff Date take no operand.
  effectiveDateNotLess:21,effectiveDateLess:22,effectiveDateGreater:23,firstEffectiveDate:24,lastEffectiveDate:25} as const;
const effectiveDating=(cond: number)=>cond>=20 && cond<=25;
/** PSQRYFIELD.TTLTYPE (qry04–qry07, qag01–qag02). */
export const QUERY_AGGREGATE_TYPES={none:1,sum:2,count:3,min:4,max:5,average:6} as const;
export type QueryAggregate=keyof typeof QUERY_AGGREGATE_TYPES;
/** Other records' fields, in record order (keys carry UseEdit.Key), for joins, subqueries and unions. */
export interface QueryRecordInfo { fields: Record<string,QueryFieldInfo> }
export type QueryOperator=keyof typeof QUERY_OPERATORS;
/** A subquery operand (qsq01, qsq02): one record and output field; unaliased criteria fields are its record's. */
export interface QuerySubquery { record: string; field: string; criteria?: QueryCriterion[] }
export type QueryOperand={constant:string}|{field:string}|{prompt:number|'new'}|{list:string[]}|{currentDate:true}|{expression:string}|{subquery:QuerySubquery};
/** `field` is absent only for exists/notExists. */
export interface QueryCriterion { field?:string; operator:QueryOperator; logical?:'AND'|'OR'; not?:boolean; open?:number; close?:number; value?:QueryOperand; value2?:QueryOperand }
const fieldName=z.string().regex(/^(?:[A-Z]\.)?[A-Z][A-Z0-9_]*$/);
const recordName=z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const criterion: z.ZodType<QueryCriterion>=z.lazy(()=>z.object({field:fieldName.optional(),operator:z.enum(Object.keys(QUERY_OPERATORS) as [QueryOperator,...QueryOperator[]]),
  logical:z.enum(['AND','OR']).optional(),not:z.boolean().optional(),open:z.number().int().min(0).max(9).optional(),close:z.number().int().min(0).max(9).optional(),
  value:operand.optional(),value2:operand.optional()}).strict());
const operand: z.ZodType<QueryOperand>=z.lazy(()=>z.union([z.object({constant:z.string().max(254)}).strict(),z.object({field:fieldName}).strict(),
  z.object({prompt:z.union([z.number().int().positive(),z.literal('new')])}).strict(),z.object({list:z.array(z.string().max(254)).min(1).max(100)}).strict(),
  z.object({currentDate:z.literal(true)}).strict(),z.object({expression:z.string().min(1).max(254)}).strict(),
  z.object({subquery:z.object({record:recordName,field:fieldName,criteria:z.array(criterion).max(50).optional()}).strict()}).strict()]));
export const queryOpSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('select'),field:fieldName,selected:z.boolean()}).strict(),
  z.object({kind:z.literal('heading'),field:fieldName,mode:z.enum(['text','short']),text:z.string().optional()}).strict(),
  z.object({kind:z.literal('order'),field:fieldName,position:z.number().int().min(0),descending:z.boolean()}).strict(),
  z.object({kind:z.literal('constant'),field:fieldName,value:z.string()}).strict(),
  z.object({kind:z.literal('prompt'),field:fieldName,promptNumber:z.number().int().positive().optional()}).strict(),
  z.object({kind:z.literal('clearCriteria')}).strict(),
  z.object({kind:z.literal('criteria'),criteria:z.array(criterion).max(50),select:z.number().int().positive().optional()}).strict(),
  z.object({kind:z.literal('having'),criteria:z.array(criterion).max(50)}).strict(),
  z.object({kind:z.literal('join'),record:recordName,type:z.enum(['standard','leftOuter','related']),
    field:fieldName.optional(),effectiveDate:z.enum(['current','none']).optional()}).strict(),
  z.object({kind:z.literal('aggregate'),field:fieldName,function:z.enum(Object.keys(QUERY_AGGREGATE_TYPES) as [QueryAggregate,...QueryAggregate[]])}).strict(),
  z.object({kind:z.literal('distinct'),distinct:z.boolean(),select:z.number().int().positive().optional()}).strict(),
  z.object({kind:z.literal('expression'),text:z.string().min(1).max(254),type:z.enum(['character','number']),length:z.number().int().min(1).max(254),
    decimalPositions:z.number().int().min(0).max(31).optional()}).strict(),
  z.object({kind:z.literal('translate'),field:fieldName,value:z.enum(['none','short','long']),
    effectiveDate:z.union([z.literal('current'),z.object({field:fieldName}).strict()]).optional()}).strict(),
  z.object({kind:z.literal('union'),record:recordName}).strict(),
  z.object({kind:z.literal('properties'),description:z.string(),comments:z.string()}).strict()
]);
export function parseQueryOp(value: unknown): QueryOp { return queryOpSchema.parse(value) as QueryOp; }
const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => String(v ?? '').trim();
const blank = (v: string) => v || ' ';
const key = (view: QueryView) => ({OPRID: blank(s(view.query.OPRID)), QRYNAME:s(view.query.QRYNAME)});
function named(value: string): string {
  const name = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('Use a name starting with a letter, followed by letters, digits or underscores.');
  return name;
}
const HAVING=[4,5,6];
const isHaving=(c: Row)=>HAVING.includes(n(c.COMBTYPE));
const keysOf=(fields: Record<string,QueryFieldInfo>)=>Object.entries(fields).filter(([,f])=>f.useEdit & 1).map(([name])=>name);

/**
 * A new query on one record. With the record's fields, an effective-dated record gets
 * Windows Query's default `EFFDT Eff Date <= Current Date` criterion first (qxl01).
 */
export function newQueryDocument(name: string, owner: string, record: string, fields?: Record<string,QueryFieldInfo>): QueryView {
  const k = {QRYNAME:named(name),OPRID:blank(owner.trim())};
  const view: QueryView = {
    query:{...k,DESCR:' ',VERSION:0,QRYTYPE:1,SELCOUNT:1,EXPCOUNT:0,BNDCOUNT:0,QRYVALID:0,
      LASTUPDDTTM:null,LASTUPDOPRID:' ',QRYAPPROVED:'A',CREATEOPRID:' ',CREATEDTTM:null,
      APPROVEOPRID:' ',APPROVEDTTM:null,EXECLOGGING:' ',QRYDISABLED:' ',QRYFOLDER:' ',QRYJOINOPTIMIZE:0,QRYIMGTYPE:0,DESCRLONG:null},
    selects:[selectRow(k,1,1,0)],
    records:[{...k,SELNUM:1,RCDNUM:1,RECNAME:named(record),JOINTYPE:1,JOINRCDNUM:0,JOINFLDNUM:0,CORRNAME:'A',QRYRECPRUNABLE:' '}],
    fields:[],criteria:[],expressions:[],binds:[]
  };
  if (fields && keysOf(fields).includes('EFFDT')) {
    if (keysOf(fields).includes('EFFSEQ')) throw new QueryUnsupportedError('Effective-sequence records are not calibrated.');
    const meta: Meta={records:{[named(record)]:{fields}}};
    view.criteria.push(criterionRow(view,1,{LCRTFLDNUM:n(fieldRow(view,'A.EFFDT',meta).FLDNUM),CONDTYPE:20,EXPRTYPE:6}));
    counters(view);
  }
  return view;
}
const selectRow=(k: Row, selnum: number, type: number, parent: number): Row=>({...k,SELNUM:selnum,SELECTTYPE:type,PARENTSELNUM:parent,RCDCOUNT:1,FLDCOUNT:0,CRTCOUNT:0,QRYDISTINCT:' ',HAVECRTCOUNT:0});

function counters(view: QueryView): void {
  view.query.SELCOUNT=view.selects.length;
  view.query.EXPCOUNT=view.expressions.length;
  view.query.BNDCOUNT=view.binds.length;
  for (const sel of view.selects) {
    const of=(rows: Row[])=>rows.filter(r=>n(r.SELNUM)===n(sel.SELNUM));
    sel.RCDCOUNT=of(view.records).length;
    sel.FLDCOUNT=of(view.fields).length;
    // qag03/qag05: CRTCOUNT counts the WHERE criteria, HAVECRTCOUNT the HAVING ones.
    sel.CRTCOUNT=of(view.criteria).filter(c=>!isHaving(c)).length;
    sel.HAVECRTCOUNT=of(view.criteria).filter(isHaving).length;
  }
}
const fieldAt=(view: QueryView, sel: unknown, fld: unknown)=>view.fields.find(f=>n(f.SELNUM)===n(sel) && n(f.FLDNUM)===n(fld));
/** `:%SELNUM.FLDNUM` field tokens in expression text (qex01). */
const TOKEN=/ :%(\d+)\.(\d+)/g;
function references(view: QueryView): void {
  const uses: Array<[unknown,unknown]>=[];
  const recordOf=(sel: unknown, fld: unknown)=>n(fieldAt(view,sel,fld)?.FLDRCDNUM);
  for (const c of view.criteria) {
    if (effectiveDating(n(c.CONDTYPE))) continue; // qxl02, qed01-qed06: effective-date criteria are not uses.
    // qcr10: a field compared on the right counts as a use too. A join criterion (fields of two
    // records of one select, qjn01) does not; a correlated subquery criterion does (qsq02).
    if (n(c.EXPRTYPE)===2 && n(c.R1CRTSELNUM)===n(c.LCRTSELNUM) && recordOf(c.LCRTSELNUM,c.LCRTFLDNUM)!==recordOf(c.R1CRTSELNUM,c.R1CRTFLDNUM)) continue;
    if (n(c.LCRTFLDNUM)) uses.push([c.LCRTSELNUM,c.LCRTFLDNUM]);
    if (n(c.EXPRTYPE)===2) uses.push([c.R1CRTSELNUM,c.R1CRTFLDNUM]);
  }
  for (const e of view.expressions) for (const m of String(e.EXPRESSIONTEXT ?? '').matchAll(TOKEN)) uses.push([m[1],m[2]]);
  // A related join's field (qjn04) and a translate's effective-date field (qxl01, not qxl02) count.
  for (const r of view.records) if (n(r.JOINTYPE)===3) uses.push([r.SELNUM,r.JOINFLDNUM]);
  for (const f of view.fields) if (n(f.XLATEXPRTYPE)===2 && n(f.XLATFLDNUM)) uses.push([f.SELNUM,f.XLATFLDNUM]);
  for (const f of view.fields) f.USECOUNT=uses.filter(([sel,fld])=>n(sel)===n(f.SELNUM) && n(fld)===n(f.FLDNUM)).length;
  for (const b of view.binds) b.USECOUNT=view.criteria.filter(c=>n(c.EXPRTYPE)===8
    && s(view.expressions.find(e=>n(e.EXPNUM)===n(c.R1CRTEXPNUM))?.EXPRESSIONTEXT)===`:${n(b.BNDNUM)}`).length;
}
/** Selects are the top level, its subqueries (SELECTTYPE 2) and unions (3), each with consecutive records. */
function checkShape(view: QueryView): void {
  const sels=[...view.selects].sort((a,b)=>n(a.SELNUM)-n(b.SELNUM));
  if (!sels.length || sels.some((sel,i)=>n(sel.SELNUM)!==i+1 || (i ? ![2,3].includes(n(sel.SELECTTYPE)) || n(sel.PARENTSELNUM)!==1 : n(sel.SELECTTYPE)!==1 || n(sel.PARENTSELNUM)))
    || sels.some(sel=>view.records.filter(r=>n(r.SELNUM)===n(sel.SELNUM)).some((r,i)=>n(r.RCDNUM)!==i+1) || !view.records.some(r=>n(r.SELNUM)===n(sel.SELNUM)))
    || sels.some(sel=>n(sel.SELECTTYPE)===2) && sels.some(sel=>n(sel.SELECTTYPE)===3)) {
    throw new QueryUnsupportedError('Editing is calibrated for a top-level select with its subqueries or unions (not both).');
  }
}

export function applyQueryOp(source: QueryView, op: QueryOp, metadata: Record<string,QueryFieldInfo>, records: Record<string,QueryRecordInfo> = {}): QueryView {
  checkShape(source);
  const meta: Meta={records:{...records,[s(source.records.find(r=>n(r.SELNUM)===1 && n(r.RCDNUM)===1)!.RECNAME)]:{fields:metadata}}};
  if ((op.kind==='constant' || op.kind==='prompt') && (source.criteria.length>1 || source.selects.length>1)) {
    throw new QueryUnsupportedError('This query has several criteria; edit them together as criteria.');
  }
  const view=structuredClone(source);
  const k=key(view);
  let f: Row | undefined;
  let info: QueryFieldInfo | undefined;
  switch (op.kind) {
    case 'criteria': setCriteria(view,op.criteria,meta,op.select ?? 1,false); counters(view); return view;
    case 'having': setCriteria(view,op.criteria,meta,1,true); counters(view); return view;
    case 'join': join(view,op,meta); counters(view); return view;
    case 'distinct': {
      const sel=view.selects.find(x=>n(x.SELNUM)===(op.select ?? 1));
      if (!sel || n(sel.SELECTTYPE)===2) throw new Error('DISTINCT applies to the top-level select or a union.');
      sel.QRYDISTINCT=op.distinct?'Y':' '; return view;
    }
    case 'expression': addExpression(view,op,meta); counters(view); return view;
    case 'union': union(view,op.record,meta); counters(view); return view;
  }
  if ('field' in op) {
    const at=locate(view,op.field,meta);
    info=at.info;
    // qnm01: number and date fields are selected exactly like character fields; their prompts use criteria.
    if (!info || ![0,2,4].includes(info.type) || (info.type!==0 || n(at.record.RCDNUM)!==1 || n(at.record.SELNUM)!==1) && (op.kind==='constant' || op.kind==='prompt')) throw new QueryUnsupportedError('Only record character, number and date fields are calibrated for editing.');
    f=view.fields.find(row=>s(row.FIELDNAME)===at.field && n(row.SELNUM)===n(at.record.SELNUM) && n(row.FLDRCDNUM)===n(at.record.RCDNUM));
    // Windows Query's New Criteria on an unselected field adds it as a criteria-only
    // field: no column, heading None (8.61.15 XX_QRY_AD2, as an unselect leaves it).
    const criterion=op.kind==='constant' || op.kind==='prompt';
    if (!f && (op.kind==='select' && op.selected || criterion)) f=fieldRow(view,op.field,meta,criterion?1:3);
    if (!f) throw new Error('Select that field before editing its properties.');
  }
  const ofSelect=(row: Row)=>n(row.SELNUM)===n(f!.SELNUM);
  switch (op.kind) {
    case 'select': {
      const old=n(f!.COLUMNNUM);
      if (op.selected && !old) {
        f!.COLUMNNUM=Math.max(0,...view.fields.filter(ofSelect).map(row=>n(row.COLUMNNUM)))+1;
        f!.HDGTYPE=3; f!.HEADING=' ';
      } else if (!op.selected && old) {
        if (n(f!.XLATTYPE)!==1 || n(f!.TTLTYPE)!==1) throw new QueryUnsupportedError('Remove the field\'s translate or aggregate before unselecting it.');
        const order=n(f!.ORDERBYNUM);
        f!.COLUMNNUM=0; f!.HDGTYPE=1; f!.HEADING=' '; f!.ORDERBYNUM=0;
        for (const other of view.fields.filter(ofSelect)) {
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
    case 'aggregate': {
      // qry04-qry07, qag01-qag02: Windows Query's Aggregate sets TTLTYPE only.
      if (!n(f!.COLUMNNUM) || n(f!.SELNUM)!==1) throw new Error('Aggregate a selected top-level field.');
      if (info!.type===4 || n(f!.XLATTYPE)!==1) throw new QueryUnsupportedError('Aggregates are calibrated for character and number fields without translates.');
      if (op.function==='none' && view.criteria.some(c=>isHaving(c) && n(c.LCRTSELNUM)===1 && n(c.LCRTFLDNUM)===n(f!.FLDNUM))) throw new Error('A HAVING criterion uses this aggregate; change it first.');
      f!.TTLTYPE=QUERY_AGGREGATE_TYPES[op.function]; break;
    }
    case 'translate': translate(view,f!,info!,op,meta); break;
    case 'clearCriteria': {
      if (view.selects.length>1) throw new QueryUnsupportedError('Clear the criteria of a query with subqueries or unions with a criteria operation.');
      const expressions=new Set(view.criteria.map(c=>n(c.R1CRTEXPNUM)));
      view.criteria=view.criteria.filter(c=>n(c.QRYOJSELNUM) || effectiveDating(n(c.CONDTYPE)));
      if (view.criteria.length) throw new QueryUnsupportedError('Join and effective-date criteria stay; replace the criteria with a criteria operation.');
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
      if (previous && (n(previous.CONDTYPE)!==2 || ![1,8].includes(n(previous.EXPRTYPE)))) throw new QueryUnsupportedError('Replace this criterion with a criteria operation.');
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

interface Meta { records: Record<string,QueryRecordInfo> }
const fieldsOf=(meta: Meta, record: Row)=>meta.records[s(record.RECNAME)]?.fields;
/** `FIELD` is the select's first record's; `B.FIELD` names any record by its alias (aliases are unique across selects). */
function locate(view: QueryView, ref: string, meta: Meta, sel=1): { record: Row; field: string; info?: QueryFieldInfo } {
  const m=/^(?:([A-Z])\.)?([A-Z][A-Z0-9_]*)$/.exec(ref);
  if (!m) throw new Error(`Invalid field reference ${ref}.`);
  const record=m[1] ? view.records.find(r=>s(r.CORRNAME)===m[1]) : view.records.find(r=>n(r.SELNUM)===sel && n(r.RCDNUM)===1);
  if (!record) throw new Error(`No record with alias ${m[1]}.`);
  return { record, field:m[2], info:fieldsOf(meta,record)?.[m[2]] };
}
function fieldRow(view: QueryView, ref: string, meta: Meta, heading=1, sel=1): Row {
  const {record,field,info}=locate(view,ref,meta,sel);
  if (!info || ![0,2,4].includes(info.type)) throw new QueryUnsupportedError(`${ref}: only record character, number and date fields are calibrated.`);
  const selnum=n(record.SELNUM);
  let f=view.fields.find(row=>s(row.FIELDNAME)===field && n(row.SELNUM)===selnum && n(row.FLDRCDNUM)===n(record.RCDNUM));
  if (!f) {
    // As New Criteria on an unselected field: criteria-only, no column, heading None.
    f={...key(view),QRYFLDNAME:`${s(record.CORRNAME)}.${field}`,SELNUM:selnum,FLDNUM:Math.max(0,...view.fields.filter(row=>n(row.SELNUM)===selnum).map(row=>n(row.FLDNUM)))+1,
      RECNAME:s(record.RECNAME),FIELDNAME:field,FLDRCDNUM:n(record.RCDNUM),FLDEXPNUM:0,HDGTYPE:heading,HEADING:' ',
      COLUMNNUM:0,GROUPBYNUM:0,ORDERBYNUM:0,ORDERBYDIR:' ',TTLTYPE:1,SUBTTLNUM:0,USECOUNT:0,
      XLATTYPE:1,XLATEXPRTYPE:6,XLATFLDNUM:0,XLATEXPNUM:0,AGGREGATEFUNC:' '};
    view.fields.push(f);
  }
  return f;
}
const criterionRow=(view: QueryView, sel: number, extra: Row)=>{
  const count=view.criteria.filter(c=>n(c.SELNUM)===sel).length;
  return {...key(view),SELNUM:sel,CRTNUM:count+1,COMBTYPE:count?1:3,NEGATION:' ',LPARENLVL:0,
    LCRTSELNUM:sel,LCRTFLDNUM:0,CONDTYPE:2,EXPRTYPE:2,R1CRTSELNUM:0,R1CRTFLDNUM:0,R1CRTEXPNUM:0,R2CRTSELNUM:0,R2CRTFLDNUM:0,R2CRTEXPNUM:0,RPARENLVL:0,QRYOJSELNUM:0,...extra};
};
/** The next correlation letter after every alias in use (qsq01 B, qsq02 C, qun01 B). */
function nextAlias(view: QueryView): string {
  const code=Math.max(64,...view.records.map(r=>s(r.CORRNAME).charCodeAt(0)))+1;
  if (code>90) throw new Error('Too many records.');
  return String.fromCharCode(code);
}
const effectiveDated=(info: QueryRecordInfo)=>keysOf(info.fields).includes('EFFDT');
/**
 * New Join (qjn01 standard, qjn03 left outer): Windows detects the new record's keys in
 * an earlier record and adds `X.KEY = NEW.KEY`. A related record (qjn04) joins through
 * the field it is the prompt table of, with no criterion row; an effective-dated one
 * gets `EFFDT Eff Date <= Current Date`.
 */
function join(view: QueryView, op: Extract<QueryOp,{kind:'join'}>, meta: Meta): void {
  const info=meta.records[op.record];
  if (!info) throw new Error(`Supply ${op.record}'s fields to join it.`);
  if (view.selects.length>1) throw new QueryUnsupportedError('Joins in a query with subqueries or unions are not calibrated.');
  const rcd=view.records.length+1, alias=nextAlias(view), keys=keysOf(info.fields), dated=keys.includes('EFFDT');
  if (keys.includes('EFFSEQ')) throw new QueryUnsupportedError('Effective-sequence records are not calibrated for joins.');
  const record: Row={...key(view),SELNUM:1,RCDNUM:rcd,RECNAME:op.record,JOINTYPE:1,JOINRCDNUM:0,JOINFLDNUM:0,CORRNAME:alias,QRYRECPRUNABLE:' '};
  if (op.type==='related') {
    if (!op.field) throw new Error('A related-record join names the field it joins through.');
    const at=locate(view,op.field,meta);
    if (!at.info || s(at.info.editTable)!==op.record) throw new QueryUnsupportedError(`${op.record} is not the related (prompt) record of ${op.field}.`);
    if (keys.filter(k=>k!=='EFFDT').join()!==at.field) throw new QueryUnsupportedError('Related-record joins are calibrated for a prompt record keyed by the joining field (and EFFDT).');
    const joining=fieldRow(view,op.field,meta);
    Object.assign(record,{JOINTYPE:3,JOINRCDNUM:n(at.record.RCDNUM),JOINFLDNUM:n(joining.FLDNUM)});
    view.records.push(record);
    if (dated && op.effectiveDate!=='none') view.criteria.push(criterionRow(view,1,{LCRTFLDNUM:n(fieldRow(view,`${alias}.EFFDT`,meta).FLDNUM),CONDTYPE:20,EXPRTYPE:6}));
  } else {
    if (op.field || dated) throw new QueryUnsupportedError(op.field ? 'Standard and outer joins detect their keys.' : 'Joining an effective-dated record this way is not calibrated; use its related-record join.');
    const matches=keys.map(k=>({k,with:view.records.find(r=>fieldsOf(meta,r)?.[k])})).filter(m=>m.with);
    if (!matches.length) throw new QueryUnsupportedError(`No earlier record has ${op.record}'s keys; join criteria are not detected.`);
    if (op.type==='leftOuter') { if (rcd!==2) throw new QueryUnsupportedError('Left outer join is calibrated for the second record.'); Object.assign(record,{JOINTYPE:5,JOINRCDNUM:n(matches[0].with!.RCDNUM)}); }
    view.records.push(record);
    for (const m of matches) {
      const left=fieldRow(view,`${s(m.with!.CORRNAME)}.${m.k}`,meta), right=fieldRow(view,`${alias}.${m.k}`,meta);
      view.criteria.push(criterionRow(view,1,{LCRTFLDNUM:n(left.FLDNUM),R1CRTSELNUM:1,R1CRTFLDNUM:n(right.FLDNUM),QRYOJSELNUM:op.type==='leftOuter'?rcd:0}));
    }
  }
  references(view);
}
/** New Union (qun01): a SELECTTYPE 3 select under the top level, on the next alias; its fields are named by that alias. */
function union(view: QueryView, record: string, meta: Meta): void {
  const info=meta.records[record];
  if (!info) throw new Error(`Supply ${record}'s fields to union it.`);
  if (view.selects.some(sel=>n(sel.SELECTTYPE)===2)) throw new QueryUnsupportedError('Unions in a query with subqueries are not calibrated.');
  if (effectiveDated(info)) throw new QueryUnsupportedError('A union on an effective-dated record is not calibrated.');
  const selnum=view.selects.length+1, k=key(view);
  view.selects.push(selectRow(k,selnum,3,1));
  view.records.push({...k,SELNUM:selnum,RCDNUM:1,RECNAME:record,JOINTYPE:1,JOINRCDNUM:0,JOINFLDNUM:0,CORRNAME:nextAlias(view),QRYRECPRUNABLE:' '});
}
/**
 * New expression column (qex01, qex02): `A.FIELD` references become ` :%SELNUM.FLDNUM`
 * tokens (the field added hidden first), the column is named EXP<n>_<heading length>
 * and headed by the text with ` A.FIELD` for each token.
 */
function addExpression(view: QueryView, op: Extract<QueryOp,{kind:'expression'}>, meta: Meta): void {
  const text=tokenize(view,op.text,meta,1);
  const expnum=Math.max(0,...view.expressions.map(e=>n(e.EXPNUM)))+1, heading=detokenize(view,text), k=key(view);
  if (op.type==='character' && op.decimalPositions) throw new Error('A character expression has no decimal positions.');
  view.expressions.push({...k,EXPNUM:expnum,FIELDTYPE:op.type==='number'?2:0,LENGTH:op.length,DECIMALPOS:op.decimalPositions ?? 0,USECOUNT:1,EXPRESSIONTEXT:text});
  view.fields.push({...k,QRYFLDNAME:`EXP${expnum}_${heading.length}`,SELNUM:1,FLDNUM:Math.max(0,...view.fields.filter(f=>n(f.SELNUM)===1).map(f=>n(f.FLDNUM)))+1,
    RECNAME:' ',FIELDNAME:' ',FLDRCDNUM:0,FLDEXPNUM:expnum,HDGTYPE:2,HEADING:heading,
    COLUMNNUM:Math.max(0,...view.fields.filter(f=>n(f.SELNUM)===1).map(f=>n(f.COLUMNNUM)))+1,GROUPBYNUM:0,ORDERBYNUM:0,ORDERBYDIR:' ',TTLTYPE:1,SUBTTLNUM:0,USECOUNT:0,
    XLATTYPE:1,XLATEXPRTYPE:6,XLATFLDNUM:0,XLATEXPNUM:0,AGGREGATEFUNC:' '});
  references(view);
}
/** Expression text with field references outside string literals tokenized; statement breaks, comments and binds are refused. */
function tokenize(view: QueryView, text: string, meta: Meta, sel: number): string {
  if (/;|--|\/\*|\*\/|:/.test(text.replace(/'(?:[^']|'')*'/g,"''"))) throw new Error('Expressions cannot contain ;, comments or : binds.');
  if ((text.match(/'/g) ?? []).length % 2) throw new Error('Unbalanced quote in expression.');
  return text.split(/('(?:[^']|'')*')/).map((part,i)=>i%2 ? part : part.replace(/\b([A-Z])\.([A-Z][A-Z0-9_]*)\b/g,(_,alias: string,field: string)=>{
    const at=locate(view,`${alias}.${field}`,meta);
    if (n(at.record.SELNUM)!==sel) throw new QueryUnsupportedError('Expressions are calibrated for fields of their own select.');
    return ` :%${sel}.${n(fieldRow(view,`${alias}.${field}`,meta,1,sel).FLDNUM)}`;
  })).join('');
}
export function detokenize(view: QueryView, text: string): string {
  return text.replace(TOKEN,(_,sel: string,fld: string)=>{
    const f=fieldAt(view,sel,fld), r=f && view.records.find(x=>n(x.SELNUM)===n(sel) && n(x.RCDNUM)===n(f.FLDRCDNUM));
    if (!f || !r) throw new Error('Expression references a missing field.');
    return ` ${s(r.CORRNAME)}.${s(f.FIELDNAME)}`;
  });
}
/** Translate (qxl01 Long with effective date Field EFFDT; qxl02 Short with Current Date): XLATTYPE 1 none, 2 short, 3 long. */
function translate(view: QueryView, f: Row, info: QueryFieldInfo, op: Extract<QueryOp,{kind:'translate'}>, meta: Meta): void {
  if (n(f.SELNUM)!==1 || !n(f.COLUMNNUM)) throw new Error('Translate a selected top-level field.');
  if (view.records.length>1 || view.selects.length>1) throw new QueryUnsupportedError('Translates are calibrated for a one-record query.');
  if (info.type!==0 || info.length>4 || n(f.TTLTYPE)!==1) throw new QueryUnsupportedError('Translate a character field of four or fewer characters (a translate field), not aggregated.');
  if (op.value==='none') { Object.assign(f,{XLATTYPE:1,XLATEXPRTYPE:6,XLATFLDNUM:0,XLATEXPNUM:0}); }
  else if (!op.effectiveDate || op.effectiveDate==='current') Object.assign(f,{XLATTYPE:op.value==='short'?2:3,XLATEXPRTYPE:6,XLATFLDNUM:0,XLATEXPNUM:0});
  else {
    const dated=locate(view,op.effectiveDate.field,meta);
    if (dated.info?.type!==4) throw new Error('A translate\'s effective date field is a date.');
    Object.assign(f,{XLATTYPE:op.value==='short'?2:3,XLATEXPRTYPE:2,XLATFLDNUM:n(fieldRow(view,op.effectiveDate.field,meta).FLDNUM),XLATEXPNUM:0});
  }
  references(view);
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
const subqueryOf=(view: QueryView, c: Row)=>n(c.EXPRTYPE)===4 ? n(c.R1CRTSELNUM) : 0;
/** A select and every select under it, deepest last. */
function selectTree(view: QueryView, sel: number): number[] {
  return [sel,...view.selects.filter(x=>n(x.PARENTSELNUM)===sel && n(x.SELECTTYPE)===2).flatMap(x=>selectTree(view,n(x.SELNUM)))];
}
/**
 * Replace one select's WHERE (or the top level's HAVING) criteria, numbering expressions as
 * Windows Query does: a criterion keeps its expression when that operand is unchanged and an
 * operand-less operator keeps the one it had (qcr09, qcr10); every expression still used is
 * kept in its old order, then new ones are appended (qnm04, qex03, qag05). Outer-join ON
 * criteria stay first (qjn03), WHERE then HAVING (qag05). Subquery operands rebuild their
 * selects in criterion order, keeping an alias where the same record stays (qsq02).
 */
function setCriteria(view: QueryView, specs: QueryCriterion[], meta: Meta, sel: number, having: boolean): void {
  const selRow=view.selects.find(x=>n(x.SELNUM)===sel);
  if (!selRow || n(selRow.SELECTTYPE)===2) throw new Error('Criteria are replaced on the top-level select or a union; subquery criteria are part of their operand.');
  if (having && sel!==1) throw new QueryUnsupportedError('HAVING criteria are calibrated on the top-level select.');
  const k=key(view), mine=view.criteria.filter(c=>n(c.SELNUM)===sel).sort((a,b)=>n(a.CRTNUM)-n(b.CRTNUM));
  const on=mine.filter(c=>n(c.QRYOJSELNUM)), where=mine.filter(c=>!n(c.QRYOJSELNUM) && !isHaving(c)), have=mine.filter(isHaving);
  const previous=having ? have : where;
  const old=new Map(view.expressions.map(e=>[n(e.EXPNUM),e]));
  // Subqueries under the replaced criteria are removed and rebuilt from the specs.
  const oldSubs=previous.map(c=>subqueryOf(view,c)).filter(Boolean);
  if (oldSubs.some(x=>view.selects.some(y=>n(y.PARENTSELNUM)===x && n(y.SELECTTYPE)===2))) throw new QueryUnsupportedError('Nested subqueries are not calibrated.');
  const snapshot=structuredClone(view);
  const gone=new Set(oldSubs.flatMap(x=>selectTree(view,x)));
  view.selects=view.selects.filter(x=>!gone.has(n(x.SELNUM)));
  view.records=view.records.filter(x=>!gone.has(n(x.SELNUM)));
  view.fields=view.fields.filter(x=>!gone.has(n(x.SELNUM)));
  view.criteria=view.criteria.filter(x=>!gone.has(n(x.SELNUM)) && !(n(x.SELNUM)===sel && previous.includes(x)));
  if (gone.size && [...gone].some(x=>x<Math.max(...view.selects.map(y=>n(y.SELNUM))))) throw new QueryUnsupportedError('Replacing these subqueries would renumber later selects; this is not calibrated.');
  const fresh: Row[]=[];
  let subIndex=0;
  const build=(list: QueryCriterion[], at: number, before: Row[], combine: 'where'|'having', lead=0): Row[]=>{
    const rows=list.map((spec,i)=>{
      const cond=QUERY_OPERATORS[spec.operator], twoSided=cond===10 || cond===11, list=cond===8 || cond===9, none=[16,17,24,25].includes(cond);
      const like=cond===14 || cond===15, dated=effectiveDating(cond), exists=cond===12 || cond===13, prior=before[i];
      const sub=spec.value && 'subquery' in spec.value;
      if (exists !== !spec.field) throw new Error(exists ? 'Exists takes no field.' : 'A criterion names its field.');
      if (exists && !sub) throw new Error('Exists takes a subquery.');
      if (sub && !exists && !list) throw new QueryUnsupportedError('Subqueries are calibrated for in list, not in list, exists and does not exist.');
      if (combine==='having' && (sub || exists || dated)) throw new QueryUnsupportedError('HAVING criteria compare an aggregate with a value.');
      const left=spec.field ? fieldRow(view,spec.field,meta,1,at) : undefined, info=spec.field ? locate(view,spec.field,meta,at).info! : undefined;
      if (combine==='having' && n(left!.TTLTYPE)===1) throw new Error(`${spec.field}: a HAVING criterion is on an aggregated field.`);
      if ((dated && !none) !== ('currentDate' in (spec.value ?? {}))) throw new QueryUnsupportedError('Effective date criteria compare EFFDT with the current date (First / Last Eff Date take no value); other current-date comparisons are not calibrated.');
      if (dated && (s(locate(view,spec.field!,meta,at).field)!=='EFFDT' || info!.type!==4)) throw new Error('An effective date criterion is on a record\'s EFFDT.');
      if (none ? spec.value || spec.value2 : !spec.value || !!spec.value2!==twoSided) throw new Error(`${spec.field ?? spec.operator} ${spec.operator}: wrong number of operands.`);
      if (info && info.type!==0 && (list && !sub || twoSided || like)) throw new QueryUnsupportedError(`${spec.operator} is calibrated for character fields only.`);
      if (twoSided && !('constant' in spec.value! && 'constant' in spec.value2!)) throw new QueryUnsupportedError('Between is calibrated for two constants only.');
      if (list && !('list' in spec.value! || sub)) throw new Error(`${spec.operator} takes a list of values or a subquery.`);
      if (!list && spec.value && 'list' in spec.value) throw new Error(`${spec.operator} takes a single value.`);
      if (like && !('constant' in spec.value! || 'prompt' in spec.value!)) throw new Error('Like takes a constant or prompt.');
      if (spec.value && 'field' in spec.value && (info!.type!==0 || locate(view,spec.value.field,meta,at).info?.type!==0)) throw new QueryUnsupportedError('Field comparison is calibrated for character fields only.');
      if (spec.value && 'expression' in spec.value && (info!.type===4 || list || twoSided || like)) throw new QueryUnsupportedError('Expression operands are calibrated for comparing character and number fields.');
      let exprtype=none?0:twoSided?9:dated?6:1;
      const r1={SELNUM:0,FLDNUM:0,EXPNUM:0}, r2={SELNUM:0,FLDNUM:0,EXPNUM:0};
      const place=(value: Operand, side: 'R1'|'R2', target: typeof r1)=>{
        if (!value || 'currentDate' in value) return;
        if ('field' in value) { exprtype=2; const r=fieldRow(view,value.field,meta,1,at); target.SELNUM=n(r.SELNUM); target.FLDNUM=n(r.FLDNUM); return; }
        if ('subquery' in value) { exprtype=4; target.SELNUM=subquery(value.subquery,at,oldSubs[subIndex++]); return; }
        let kind: string, text: string, fieldtype=0;
        if ('constant' in value) { kind='constant'; text=constantText(value.constant,info!.type,spec.field!); fieldtype=info!.type; }
        else if ('list' in value) { kind='list'; exprtype=5; text=`(${value.list.map(v=>`'${v.replace(/'/g,"''")}'`).join(',')})`; }
        else if ('expression' in value) { kind='expression'; exprtype=3; text=tokenize(view,value.expression,meta,at); }
        else {
          exprtype=8; kind='prompt';
          let bind=value.prompt==='new' ? undefined : view.binds.find(b=>n(b.BNDNUM)===value.prompt);
          if (value.prompt!=='new' && !bind) throw new Error('No prompt with that number.');
          if (!bind) {
            const i2=info!;
            if (i2.type===0 && ![0,6].includes(i2.format) || i2.type!==0 && (i2.decimalPositions || i2.editTable)) throw new QueryUnsupportedError('This prompt format is not calibrated.');
            if (i2.editTable && !(i2.useEdit & 16384)) throw new QueryUnsupportedError('This prompt-table edit mode is not calibrated.');
            const num=Math.max(0,...view.binds.map(b=>n(b.BNDNUM)))+1;
            // qnm03/qnm04: a number or date prompt takes the field's type and length, format 0, no edit.
            bind={...k,BNDNAME:`BIND${num}`,BNDNUM:num,FIELDNAME:locate(view,spec.field!,meta,at).field,HDGTYPE:4,HEADING:blank(i2.longName),
              FIELDTYPE:i2.type,LENGTH:i2.length,DECIMALPOS:0,FORMAT:i2.type===0?i2.format:0,EDITTABLE:blank(i2.editTable),
              USECOUNT:1,USEEDIT:i2.editTable?16384:0,QRYREQUIREDPROMPT:'Y',QRYPROMPTDEFAULT:' '};
            view.binds.push(bind);
          }
          text=`:${n(bind.BNDNUM)}`;
        }
        const e=prior && old.get(n(prior[`${side}CRTEXPNUM`]));
        const kindOf=({1:'constant',9:'constant',5:'list',8:'prompt',3:'expression'} as Record<number,string>)[n(prior?.EXPRTYPE)];
        if (e && kindOf && identity(kindOf,s(e.EXPRESSIONTEXT))===identity(kind,s(text))) { target.EXPNUM=n(e.EXPNUM); return; }
        // qex03: an expression operand has no type; a constant takes its field's (qnm01, qag03).
        const row={...k,EXPNUM:-(fresh.length+1),FIELDTYPE:fieldtype,LENGTH:0,DECIMALPOS:0,USECOUNT:1,EXPRESSIONTEXT:text};
        fresh.push(row); target.EXPNUM=n(row.EXPNUM);
      };
      place(spec.value,'R1',r1); place(spec.value2,'R2',r2);
      if (none && prior && n(prior.R1CRTEXPNUM) && old.has(n(prior.R1CRTEXPNUM))) r1.EXPNUM=n(prior.R1CRTEXPNUM);
      // WHERE: first 3, AND 1, OR 2; HAVING: first 6, AND 4, OR 5 (qag03, qhv01).
      const first=combine==='having' ? 6 : 3, and=combine==='having' ? 4 : 1, or=combine==='having' ? 5 : 2;
      return {...k,SELNUM:at,CRTNUM:0,COMBTYPE:i || lead?(spec.logical==='OR'?or:and):first,NEGATION:spec.not?'N':' ',LPARENLVL:spec.open??0,
        LCRTSELNUM:left?n(left.SELNUM):0,LCRTFLDNUM:left?n(left.FLDNUM):0,CONDTYPE:cond,EXPRTYPE:exprtype,R1CRTSELNUM:r1.SELNUM,R1CRTFLDNUM:r1.FLDNUM,R1CRTEXPNUM:r1.EXPNUM,
        R2CRTSELNUM:r2.SELNUM,R2CRTFLDNUM:r2.FLDNUM,R2CRTEXPNUM:r2.EXPNUM,RPARENLVL:spec.close??0,QRYOJSELNUM:0};
    });
    if (list.reduce((d,c)=>d+(c.open??0)-(c.close??0),0) || list.some((_,i)=>list.slice(0,i+1).reduce((d,c)=>d+(c.open??0)-(c.close??0),0)<0)) throw new Error('Criteria parentheses do not balance.');
    return rows;
  };
  const subquery=(spec: QuerySubquery, parent: number, oldSel?: number): number=>{
    const info=meta.records[spec.record];
    if (!info) throw new Error(`Supply ${spec.record}'s fields to use it in a subquery.`);
    if (effectiveDated(info)) throw new QueryUnsupportedError('A subquery on an effective-dated record is not calibrated.');
    if (view.selects.some(x=>n(x.SELECTTYPE)===3)) throw new QueryUnsupportedError('Subqueries in a query with unions are not calibrated.');
    const selnum=Math.max(...view.selects.map(x=>n(x.SELNUM)))+1;
    const oldRecord=oldSel ? snapshot.records.find(r=>n(r.SELNUM)===oldSel && n(r.RCDNUM)===1) : undefined;
    const alias=oldRecord && s(oldRecord.RECNAME)===spec.record && !view.records.some(r=>s(r.CORRNAME)===s(oldRecord.CORRNAME)) ? s(oldRecord.CORRNAME) : nextAlias(view);
    view.selects.push(selectRow(k,selnum,2,parent));
    view.records.push({...k,SELNUM:selnum,RCDNUM:1,RECNAME:spec.record,JOINTYPE:1,JOINRCDNUM:0,JOINFLDNUM:0,CORRNAME:alias,QRYRECPRUNABLE:' '});
    const out=fieldRow(view,spec.field.includes('.') ? spec.field : `${alias}.${spec.field}`,meta,3,selnum);
    if (n(out.SELNUM)!==selnum) throw new Error('A subquery selects a field of its own record.');
    if (locate(view,`${alias}.${s(out.FIELDNAME)}`,meta).info!.type===4) throw new QueryUnsupportedError('Date subquery output is not calibrated.');
    out.COLUMNNUM=1;
    const priorRows=oldSel ? snapshot.criteria.filter(c=>n(c.SELNUM)===oldSel).sort((a,b)=>n(a.CRTNUM)-n(b.CRTNUM)) : [];
    const rows=build(spec.criteria ?? [],selnum,priorRows,'where');
    if (rows.some(r=>n(r.EXPRTYPE)===4)) throw new QueryUnsupportedError('Nested subqueries are not calibrated.');
    view.criteria.push(...rows.map((r,i)=>({...r,CRTNUM:i+1})));
    return selnum;
  };
  // qjn04: after an outer join's ON criteria the first WHERE criterion is AND, not the opening 3.
  const rows=build(specs,sel,previous,having?'having':'where',having?0:on.length);
  const ordered=having ? [...on,...where,...rows] : [...on,...rows,...have];
  const others=view.criteria.filter(c=>n(c.SELNUM)!==sel);
  view.criteria=[...others,...ordered.map((c,i)=>({...c,CRTNUM:i+1}))];
  renumberExpressions(view,old,fresh);
  view.selects.sort((a,b)=>n(a.SELNUM)-n(b.SELNUM));
  references(view);
}
/** Keep every old expression still used (criteria, columns, translates) in its old order, then append the new ones. */
function renumberExpressions(view: QueryView, old: Map<number,Row>, fresh: Row[]): void {
  const sides=['R1CRTEXPNUM','R2CRTEXPNUM'] as const;
  const used=new Set([...view.criteria.flatMap(c=>sides.map(x=>n(c[x]))),...view.fields.flatMap(f=>[n(f.FLDEXPNUM),n(f.XLATEXPNUM)])].filter(e=>e>0));
  const order=[...used].filter(e=>old.has(e)).sort((a,b)=>a-b), renumber=new Map<number,number>(order.map((e,i)=>[e,i+1]));
  fresh.forEach((e,i)=>renumber.set(n(e.EXPNUM),order.length+i+1));
  if (view.fields.some(f=>n(f.FLDEXPNUM) && renumber.get(n(f.FLDEXPNUM))!==n(f.FLDEXPNUM))) throw new QueryUnsupportedError('This change would renumber an expression column; that is not calibrated.');
  view.expressions=[...order.map(e=>({...old.get(e)!,EXPNUM:renumber.get(e)!})),...fresh.map(e=>({...e,EXPNUM:renumber.get(n(e.EXPNUM))!}))];
  for (const c of view.criteria) for (const side of sides) if (n(c[side])) c[side]=renumber.get(n(c[side]))!;
  for (const f of view.fields) if (n(f.XLATEXPNUM)) f.XLATEXPNUM=renumber.get(n(f.XLATEXPNUM))!;
}

/**
 * The stored criteria as criteria / having specs, so that replacing them with these specs
 * reproduces the stored rows (round trip). ON and subquery-internal rows are part of their join
 * and operand.
 */
export function describeQueryCriteria(view: QueryView, sel=1): { criteria: QueryCriterion[]; having: QueryCriterion[] } {
  const ref=(selnum: unknown, fldnum: unknown, at: number)=>{
    const f=fieldAt(view,selnum,fldnum), r=f && view.records.find(x=>n(x.SELNUM)===n(selnum) && n(x.RCDNUM)===n(f.FLDRCDNUM));
    if (!f || !r) throw new Error('Criterion references a missing field.');
    return n(selnum)===at && n(r.RCDNUM)===1 ? s(f.FIELDNAME) : `${s(r.CORRNAME)}.${s(f.FIELDNAME)}`;
  };
  const text=(num: unknown)=>String(view.expressions.find(e=>n(e.EXPNUM)===n(num))?.EXPRESSIONTEXT ?? ' ');
  const ops=Object.fromEntries(Object.entries(QUERY_OPERATORS).map(([name,code])=>[code,name])) as Record<number,QueryOperator>;
  const describe=(rows: Row[], at: number): QueryCriterion[]=>rows.map((c,i)=>{
    const operator=ops[n(c.CONDTYPE)];
    if (!operator) throw new QueryUnsupportedError(`Condition type ${n(c.CONDTYPE)} is not calibrated.`);
    const spec: QueryCriterion={operator};
    if (n(c.LCRTFLDNUM)) spec.field=ref(c.LCRTSELNUM,c.LCRTFLDNUM,at);
    if (i) spec.logical=[2,5].includes(n(c.COMBTYPE)) ? 'OR' : 'AND';
    if (s(c.NEGATION)==='N') spec.not=true;
    if (n(c.LPARENLVL)) spec.open=n(c.LPARENLVL);
    if (n(c.RPARENLVL)) spec.close=n(c.RPARENLVL);
    const constant=(num: unknown)=>({constant:s(text(num))});
    switch (n(c.EXPRTYPE)) {
      case 0: break;
      case 1: spec.value=constant(c.R1CRTEXPNUM); break;
      case 9: spec.value=constant(c.R1CRTEXPNUM); spec.value2=constant(c.R2CRTEXPNUM); break;
      case 2: spec.value={field:ref(c.R1CRTSELNUM,c.R1CRTFLDNUM,at)}; break;
      case 3: spec.value={expression:detokenize(view,text(c.R1CRTEXPNUM)).replace(/^ /,'')}; break;
      case 5: spec.value={list:[...s(text(c.R1CRTEXPNUM)).matchAll(/'((?:[^']|'')*)'/g)].map(m=>m[1].replace(/''/g,"'"))}; break;
      case 6: spec.value={currentDate:true}; break;
      case 8: spec.value={prompt:Number(/^:(\d+)$/.exec(s(text(c.R1CRTEXPNUM)))?.[1] ?? NaN)}; break;
      case 4: {
        const sub=n(c.R1CRTSELNUM), record=view.records.find(r=>n(r.SELNUM)===sub && n(r.RCDNUM)===1), out=view.fields.find(f=>n(f.SELNUM)===sub && n(f.COLUMNNUM)===1);
        if (!record || !out) throw new Error('Subquery operand is incomplete.');
        const inner=describe(view.criteria.filter(x=>n(x.SELNUM)===sub).sort((a,b)=>n(a.CRTNUM)-n(b.CRTNUM)),sub);
        spec.value={subquery:{record:s(record.RECNAME),field:s(out.FIELDNAME),...(inner.length?{criteria:inner}:{})}}; break;
      }
      default: throw new QueryUnsupportedError(`Operand type ${n(c.EXPRTYPE)} is not calibrated.`);
    }
    return spec;
  });
  const rows=view.criteria.filter(c=>n(c.SELNUM)===sel && !n(c.QRYOJSELNUM)).sort((a,b)=>n(a.CRTNUM)-n(b.CRTNUM));
  return { criteria:describe(rows.filter(c=>!isHaving(c)),sel), having:describe(rows.filter(isHaving),sel) };
}

export function copyQueryDocument(source: QueryView, name: string, owner: string): QueryView {
  const view=structuredClone(source);
  const k={QRYNAME:named(name),OPRID:blank(owner.trim())};
  for (const row of [view.query,...view.selects,...view.records,...view.fields,...view.criteria,...view.expressions,...view.binds]) Object.assign(row,k);
  view.query.VERSION=0; view.query.CREATEOPRID=' '; view.query.CREATEDTTM=null; view.query.LASTUPDOPRID=' '; view.query.LASTUPDDTTM=null;
  return view;
}
