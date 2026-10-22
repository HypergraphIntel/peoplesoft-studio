import { randomBytes } from 'node:crypto';
import { escapeHtml as esc } from './propertiesHtml.js';
import { queryAggregateLabel, queryReferences, renderQuery, SELECT_TYPES, CONDITIONS, CONNECTORS, type QueryView, type Row } from '../model/queryDefinition.js';
import { describeQueryCriteria, QUERY_AGGREGATE_TYPES, QUERY_OPERATORS } from '../model/queryDocument.js';
import type { QuerySqlPlan } from '../model/querySql.js';
import type { FieldDefinition } from '../model/fieldDefinition.js';
import { FIELD_TYPE_LABELS, FieldType } from '../model/record.js';

export type QueryFieldMetadata = Pick<FieldDefinition, 'type' | 'length' | 'decimalPositions' | 'labels'> & {shortName?:string;longName?:string};

export interface QueryDesignerState {
  editable?: boolean; dirty?: boolean; plan?: QuerySqlPlan; unsupported?: string; message?: string;
  result?: {sql:string;rows:Array<Record<string,unknown>>;columnNames?:string[];truncated:boolean;maxRows:number;ms:number};
  canUndo?: boolean; canRedo?: boolean;
  /** Every record's field metadata by record name (joins, unions); `metadata` is record A's. */
  records?: Record<string, Record<string, QueryFieldMetadata>>;
}
/** Windows Query grids with host-owned operations and SQL execution. */
export function renderQueryDesigner(name: string, connection: string, view: QueryView, metadata: Record<string, QueryFieldMetadata> = {}, state: QueryDesignerState = {}): string {
  const nonce = randomBytes(16).toString('base64');
  const s = (v: unknown) => String(v ?? '').trim();
  const n = (v: unknown) => Number(v ?? 0);
  const metaOf = (f: Row) => (s(f.RECNAME) && state.records?.[s(f.RECNAME)]) || (s(f.RECNAME)===s(view.records[0]?.RECNAME) || !state.records ? metadata : {});
  const label = (f: Row) => {const m=metaOf(f)[s(f.FIELDNAME)];return m?.shortName!==undefined?{shortName:m.shortName,longName:m.longName??''}:m?.labels.find(l=>l.isDefault)??m?.labels[0];};
  const heading=(f:Row)=>s(f.HEADING)||(n(f.HDGTYPE)===3?label(f)?.shortName??'RFT Short':n(f.HDGTYPE)===4?label(f)?.longName??'RFT Long':'');
  const format = (f: Row) => {
    if (n(f.FLDEXPNUM)) { const e=view.expressions.find(x=>n(x.EXPNUM)===n(f.FLDEXPNUM)); return e ? `${n(e.FIELDTYPE)===2?'Num':'Char'}${n(e.LENGTH)}` : ''; }
    const m = metaOf(f)[s(f.FIELDNAME)];
    if (!m) return '';
    return m.type === FieldType.Character ? `Char${m.length}` : `${FIELD_TYPE_LABELS[m.type] ?? `Type ${m.type}`} ${m.length}${m.decimalPositions ? `.${m.decimalPositions}` : ''}`;
  };
  const table = (heads: string[], rows: string[][]) => `<table><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const disabled=state.editable?'':' disabled';
  const input=(attrs:string,value:unknown)=>`<input ${attrs} value="${esc(String(value ?? ''))}"${disabled}>`;
  const editable=!!state.editable;
  const recordMeta=(r: Row)=>state.records?.[s(r.RECNAME)] ?? (n(r.SELNUM)===1 && n(r.RCDNUM)===1 ? metadata : {});
  // Field references are A.FIELD, except record A's, which the operations accept bare (as before).
  const refOf=(r: Row, field: string)=>n(r.SELNUM)===1 && n(r.RCDNUM)===1 ? field : `${s(r.CORRNAME)}.${field}`;
  const editableSelects=[...view.selects].filter(x=>n(x.SELECTTYPE)!==2).sort((a,b)=>n(a.SELNUM)-n(b.SELNUM));
  const catalogRecords=view.records.filter(r=>editableSelects.some(x=>n(x.SELNUM)===n(r.SELNUM)));
  const fieldCatalog=catalogRecords.map(r=>`<details open><summary>${esc(`${s(r.CORRNAME)} = ${s(r.RECNAME)}`)}${n(r.SELNUM)>1?` (union ${n(r.SELNUM)})`:''}</summary>${Object.entries(recordMeta(r)).filter(([,m])=>[0,2,4].includes(m.type)).map(([name,m])=>
    `<label class="record-field"><input type="checkbox" data-select="${esc(refOf(r,name))}"${view.fields.some(f=>s(f.FIELDNAME)===name && n(f.SELNUM)===n(r.SELNUM) && n(f.FLDRCDNUM)===n(r.RCDNUM) && n(f.COLUMNNUM)>0)?' checked':''}${disabled}>${esc(name)} <span>${esc(m.longName ?? m.labels.find(l=>l.isDefault)?.longName ?? m.labels[0]?.longName ?? '')}</span></label>`).join('')}</details>`).join('');
  const refs0=queryReferences(view);
  // Expression columns are named #N (their expression number) in criteria.
  const allRefs=[...catalogRecords.flatMap(r=>Object.entries(recordMeta(r)).filter(([,m])=>[0,2,4].includes(m.type)).map(([name])=>`${s(r.CORRNAME)}.${name}`)),
    ...view.fields.filter(f=>n(f.SELNUM)===1 && n(f.FLDEXPNUM) && n(f.COLUMNNUM)>0).map(f=>`#${n(f.FLDEXPNUM)}`)];
  const selected=view.fields.filter(f=>n(f.COLUMNNUM)>0 && n(f.SELNUM)===1).sort((a,b)=>n(a.COLUMNNUM)-n(b.COLUMNNUM));
  const fieldRef=(f: Row)=>{const r=view.records.find(x=>n(x.SELNUM)===n(f.SELNUM) && n(x.RCDNUM)===n(f.FLDRCDNUM));return r?refOf(r,s(f.FIELDNAME)):s(f.FIELDNAME);};
  const dateRefs=catalogRecords.filter(r=>n(r.SELNUM)===1).flatMap(r=>Object.entries(recordMeta(r)).filter(([,m])=>m.type===4).map(([name])=>refOf(r,name)));
  const aggregates=Object.entries(QUERY_AGGREGATE_TYPES);
  const fieldEdits=view.fields.filter(f=>n(f.COLUMNNUM)>0 && !n(f.FLDEXPNUM) && editableSelects.some(x=>n(x.SELNUM)===n(f.SELNUM))).sort((a,b)=>n(a.SELNUM)-n(b.SELNUM) || n(a.COLUMNNUM)-n(b.COLUMNNUM)).map(f=>{
    const ref=fieldRef(f), m=metaOf(f)[s(f.FIELDNAME)], top=n(f.SELNUM)===1;
    const aggregate=top && m && [0,2].includes(m.type) ? `<form data-aggregate="${esc(ref)}"><label>Aggregate <select name="function"${disabled}>${aggregates.map(([name,code])=>`<option value="${name}"${n(f.TTLTYPE)===code?' selected':''}>${esc(name)}</option>`).join('')}</select></label><button>Apply aggregate</button></form>` : '';
    const translate=top && m && m.type===0 && m.length<=4 && view.records.length===1 ? `<form data-translate="${esc(ref)}"><label>Translate <select name="value"${disabled}>${['none','short','long'].map((v,i)=>`<option value="${v}"${n(f.XLATTYPE)===i+1?' selected':''}>${v}</option>`).join('')}</select></label><label>Effective date <select name="effective"${disabled}><option value="current">Current date</option>${dateRefs.map(d=>`<option value="${esc(d)}"${n(f.XLATEXPRTYPE)===2 && fieldRef(view.fields.find(x=>n(x.SELNUM)===1 && n(x.FLDNUM)===n(f.XLATFLDNUM)) ?? {})===d?' selected':''}>${esc(d)}</option>`).join('')}</select></label><button>Apply translate</button></form>` : '';
    return `<form data-heading="${esc(ref)}"><strong>${esc(refs0.field(n(f.SELNUM),n(f.FLDNUM)))}</strong> <label>Heading ${input('name="text"',s(f.HEADING)||label(f)?.shortName||'')}</label> <button>Apply heading</button><button type="button" data-short="${esc(ref)}">RFT Short</button></form>`
      +(top?`<form data-order="${esc(ref)}"><label>Order By position ${input('name="position" type="number" min="0"',n(f.ORDERBYNUM))}</label><label><input name="descending" type="checkbox"${s(f.ORDERBYDIR)==='D'?' checked':''}${disabled}>Descending</label><button>Apply order</button></form>`:'')+aggregate+translate;
  }).join('');
  const recordForm=`<form id="addRecord"><label>Record ${input('name="record" aria-label="Record name" placeholder="RECORD"','')}</label><label>As <select name="type"${disabled}><option value="standard">Standard join</option><option value="leftOuter">Left outer join</option><option value="related">Related record join</option><option value="union">Union</option></select></label><label>Related through ${input('name="field" list="queryFieldRefs" placeholder="A.FIELD"','')}</label><button>Add record</button></form>`;
  const expressionForm=`<form id="expression"><label>Expression ${input('name="text" aria-label="Expression text" placeholder="A.FIELD * 2"','')}</label><label>Type <select name="type"${disabled}><option value="number">Number</option><option value="character">Character</option></select></label><label>Length ${input('name="length" type="number" min="1" max="254"','10')}</label><label>Decimals ${input('name="decimals" type="number" min="0" max="31"','0')}</label><button>Add expression column</button></form>`;
  const distinctForms=editableSelects.map(x=>`<label><input type="checkbox" data-distinct="${n(x.SELNUM)}"${s(x.QRYDISTINCT)==='Y'?' checked':''}${disabled}>Distinct (${esc(SELECT_TYPES[n(x.SELECTTYPE)] ?? 'select')} ${n(x.SELNUM)})</label>`).join('');
  const edits=editable?`<section><h2>Field properties</h2>${fieldEdits}</section><section><h2>Records</h2>${recordForm}</section><section><h2>Expressions</h2>${expressionForm}</section><section><h2>Distinct</h2>${distinctForms}</section><datalist id="queryFieldRefs">${allRefs.map(r=>`<option value="${esc(r)}"></option>`).join('')}</datalist>`:'';
  // Criteria are edited as the specs describeQueryCriteria returns; each Apply replaces that select's WHERE (or HAVING) criteria.
  let described: Record<string,unknown>={}, describeError='';
  try { described=Object.fromEntries(editableSelects.map(x=>[String(n(x.SELNUM)),describeQueryCriteria(view,n(x.SELNUM))])); } catch (e) { describeError=e instanceof Error?e.message:String(e); }
  const criteriaEditors=editable?(describeError?`<p class="notice">${esc(describeError)}</p>`:editableSelects.flatMap(x=>[[n(x.SELNUM),'criteria'],...(n(x.SELNUM)===1?[[1,'having']]:[])] as Array<[number,string]>).map(([sel,kind])=>
    `<section class="criteria-editor" data-criteria="${kind}" data-sel="${sel}"><h2>${kind==='having'?'Having criteria':`Criteria — ${esc(SELECT_TYPES[n(editableSelects.find(x=>n(x.SELNUM)===sel)?.SELECTTYPE)] ?? 'select')} ${sel}`}</h2><table><thead><tr><th>Logical</th><th>Not</th><th>(</th><th>Field</th><th>Operator</th><th>Operand</th><th>Value</th><th>Value 2</th><th>)</th><th></th></tr></thead><tbody></tbody></table><button type="button" data-add-row>Add criterion</button><button type="button" data-apply-criteria>Apply ${kind==='having'?'having criteria':'criteria'}</button></section>`).join('')):'';
  const runtime=state.plan?`<form id="run">${state.plan.prompts.map(b=>`<label>${esc(s(b.HEADING)||s(b.BNDNAME))} <input name="prompt${n(b.BNDNUM)}" data-prompt="${n(b.BNDNUM)}" aria-label="${esc(s(b.HEADING)||s(b.BNDNAME))}" maxlength="${n(b.LENGTH)}"></label>`).join('')}<label>Row limit <input name="limit" type="number" value="500" min="1" max="10000"></label><button>Run query</button></form>`:'';
  const results=state.result?`<p>${state.result.rows.length} rows · ${state.result.ms} ms${state.result.truncated?' · More rows available; row limit reached.':''}</p>${table((state.plan?.columns??selected).map(f=>heading(f)),state.result.rows.map(row=>(state.plan?.columns??selected).map((f,i)=>String(row[state.result!.columnNames?.[i] ?? s(f.FIELDNAME)] ?? ''))))}`:'<p>Run the query to see results.</p>';
  const properties=`<form id="properties"><label>Description ${input('name="description" maxlength="30"',s(view.query.DESCR))}</label><label>Query definition <textarea name="comments"${disabled}>${esc(String(view.query.DESCRLONG ?? ''))}</textarea></label>${state.editable?'<button>Apply properties</button>':''}</form>`;
  const refs = queryReferences(view);
  const fieldName = (f: Row) => refs.field(n(f.SELNUM), n(f.FLDNUM));
  const selects = [...view.selects].sort((a, b) => n(a.SELNUM) - n(b.SELNUM));
  const text = renderQuery(name, view);
  const fields = selects.map(sel => {
    const id = n(sel.SELNUM);
    const rows = view.fields.filter(f => n(f.SELNUM) === id && n(f.COLUMNNUM) > 0).sort((a,b) => n(a.COLUMNNUM)-n(b.COLUMNNUM));
    return `<section><h2>${esc(SELECT_TYPES[n(sel.SELECTTYPE)] ?? `Select ${id}`)} ${id}</h2>${table(['Col', 'Record.Field', 'Format', 'Ord', 'Agg', 'Heading'], rows.map(f => [
      String(n(f.COLUMNNUM)), `${fieldName(f)}${label(f)?.longName ? ` — ${label(f)!.longName}` : ''}`, format(f), n(f.ORDERBYNUM) ? `${s(f.ORDERBYDIR)}${n(f.ORDERBYNUM)}` : '', queryAggregateLabel(f),
      heading(f)
    ]))}</section>`;
  }).join('');
  const tree = selects.map(sel => `<details open><summary>${esc(SELECT_TYPES[n(sel.SELECTTYPE)] ?? 'Select')} ${n(sel.SELNUM)}</summary>${view.records.filter(r => n(r.SELNUM) === n(sel.SELNUM)).map(r =>
    `<details open><summary>${esc(`${s(r.CORRNAME)} = ${s(r.RECNAME)}`)}</summary><ul>${view.fields.filter(f => n(f.SELNUM) === n(r.SELNUM) && n(f.FLDRCDNUM) === n(r.RCDNUM)).sort((a,b) => n(a.FLDNUM)-n(b.FLDNUM)).map(f => `<li>${esc(s(f.FIELDNAME))}${n(f.COLUMNNUM) > 0 ? ' ✓' : ''}</li>`).join('')}</ul></details>`).join('')}</details>`).join('');
  const criteria = selects.map(sel => {
    const id = n(sel.SELNUM);
    const rows = view.criteria.filter(c => n(c.SELNUM) === id).sort((a,b) => n(a.CRTNUM)-n(b.CRTNUM));
    return `<section><h2>${esc(SELECT_TYPES[n(sel.SELECTTYPE)] ?? 'Select')} ${id}</h2>${table(['Logical', 'Expression 1', 'Operator', 'Expression 2', 'Belongs To'],rows.map(c => {
      const condition = n(c.CONDTYPE);
      const right = refs.operand(c, 'R1');
      return [n(c.COMBTYPE) === 3 ? '' : CONNECTORS[n(c.COMBTYPE)] ?? `combine ${n(c.COMBTYPE)}`,
        '('.repeat(Math.max(0,n(c.LPARENLVL))) + (n(c.LCRTFLDNUM) ? refs.field(n(c.LCRTSELNUM),n(c.LCRTFLDNUM)) : ''),
        `${s(c.NEGATION) === 'N' ? 'not ' : ''}${CONDITIONS[condition] ?? `condition ${condition}`}`,
        (condition === 10 || condition === 11 ? `${right} and ${refs.operand(c,'R2')}` : right) + ')'.repeat(Math.max(0,n(c.RPARENLVL))),
        n(c.QRYOJSELNUM) ? refs.alias(id,n(c.QRYOJSELNUM)) : ''];
    }))}</section>`;
  }).join('');
  const prompts = table(['Number', 'Name', 'Field', 'Heading', 'Prompt Table', 'Required'], [...view.binds].sort((a,b) => n(a.BNDNUM)-n(b.BNDNUM)).map(b =>
    [String(n(b.BNDNUM)),s(b.BNDNAME),s(b.FIELDNAME),s(b.HEADING),s(b.EDITTABLE),s(b.QRYREQUIREDPROMPT)]));
  const expressions = table(['Number', 'Expression'], [...view.expressions].sort((a,b) => n(a.EXPNUM)-n(b.EXPNUM)).map(e => [String(n(e.EXPNUM)),String(e.EXPRESSIONTEXT ?? '')]));
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(name)} — Query</title>
<style nonce="${nonce}">
body{margin:0;color:var(--vscode-foreground,#ddd);background:var(--vscode-editor-background,#202020);font:13px var(--vscode-font-family,Arial)}
header{padding:12px 16px;border-bottom:1px solid var(--vscode-panel-border,#555)}header strong{font-size:16px}header span{margin-left:16px;color:var(--vscode-descriptionForeground,#aaa)}
.workspace{display:grid;grid-template-columns:minmax(180px,260px) 1fr;height:calc(100vh - 107px)}aside{padding:12px;overflow:auto;border-right:1px solid var(--vscode-panel-border,#555)}aside details details{margin:8px 0 8px 12px}summary{cursor:pointer}ul{padding-left:22px;line-height:1.8}
main{min-width:0;overflow:auto}nav{display:flex;gap:2px;flex-wrap:wrap;padding:8px;border-bottom:1px solid var(--vscode-panel-border,#555)}button{font:inherit;color:inherit;background:transparent;border:1px solid transparent;padding:6px 12px;cursor:pointer}button[aria-selected=true]{border-bottom:2px solid var(--vscode-focusBorder,#3989ff)}button:disabled{opacity:.45;cursor:default}
.content{padding:12px}section{margin-bottom:24px}h2{font-size:13px;font-weight:600}table{border-collapse:collapse;width:100%}td,th{border:1px solid var(--vscode-panel-border,#555);padding:7px 10px;text-align:left;vertical-align:top;white-space:pre-wrap}th{background:var(--vscode-sideBar-background,#292929)}pre{white-space:pre-wrap;line-height:1.6}button:focus-visible,summary:focus-visible{outline:2px solid var(--vscode-focusBorder,#3989ff)}[hidden]{display:none!important}
.toolbar{display:flex;gap:6px;padding:8px 16px}.toolbar button,form button{background:var(--vscode-button-background,#2563a1);border-radius:3px}input,select,textarea{font:inherit;color:inherit;background:var(--vscode-input-background,#303030);border:1px solid var(--vscode-input-border,#666);padding:5px}form{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:12px 0}label{display:flex;gap:6px;align-items:center}textarea{width:min(700px,90vw);height:90px}.record-field{display:flex;gap:7px;margin:8px 0}.record-field span{color:var(--vscode-descriptionForeground,#aaa);font-size:11px}#properties{align-items:flex-start;flex-direction:column}.notice{padding:8px 16px;color:var(--vscode-descriptionForeground,#bbb);border-bottom:1px solid #555}input[type=number]{width:72px}
</style></head><body><header><strong>${esc(name)}</strong><span>${esc(connection)} · ${s(view.query.OPRID) ? `Private (${esc(s(view.query.OPRID))})` : 'Public'} · ${state.editable ? (state.dirty ? 'Unsaved changes' : 'Editable') : 'Read only'}</span></header>
<div class="toolbar"><button data-action="save"${disabled}>Save</button><button data-action="saveAs"${disabled}>Save As…</button><button data-action="undo"${state.canUndo?'':' disabled'}>Undo</button><button data-action="redo"${state.canRedo?'':' disabled'}>Redo</button><button data-action="reload">Reload</button><button data-tab="results">Run…</button></div><div id="status" role="status" class="notice"${state.message?'':' hidden'}>${esc(state.message??'')}</div>${state.unsupported?`<div class="notice">${esc(state.unsupported)}</div>`:''}
<div class="workspace"><aside><strong>Query</strong>${state.editable ? `${fieldCatalog}`:tree}<button data-tab="expressions">Expressions (${view.expressions.length})</button><button data-tab="prompts">Prompts (${view.binds.length})</button></aside>
<main><nav aria-label="Query views"><button data-tab="fields" aria-selected="true">Fields</button><button data-tab="criteria" aria-selected="false">Criteria</button><button data-tab="sql">SQL</button><button data-tab="results">Results</button><button data-tab="properties">Properties</button><button data-tab="definition" aria-selected="false">Definition</button></nav>
<div class="content"><div id="fields">${fields}${edits}</div><div id="criteria" hidden>${criteria}${criteriaEditors}</div><div id="sql" hidden><pre>${esc(state.plan?.sql ?? state.unsupported ?? 'SQL is unavailable.')}</pre></div><div id="results" hidden>${runtime}${results}</div><div id="properties" hidden>${properties}</div><div id="expressions" hidden>${expressions}</div><div id="prompts" hidden>${prompts}</div><div id="definition" hidden><pre>${esc(text)}</pre></div></div></main></div>
<script nonce="${nonce}">
const api=typeof acquireVsCodeApi==='function'?acquireVsCodeApi():window.queryPreviewApi;
const send=(m)=>{document.body.setAttribute('aria-busy','true');const status=document.querySelector('#status');status.hidden=false;status.textContent='Working…';document.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=true);api?.postMessage(m);};
const switchTab=(tab)=>{document.querySelectorAll('.content>div').forEach(panel=>panel.hidden=panel.id!==tab);document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));api?.setState({...api?.getState(),tab});};
switchTab(api?.getState()?.tab ?? 'fields');
const run=document.querySelector('#run');if(run){const stored=api?.getState()?.prompts??{};run.querySelectorAll('[data-prompt]').forEach(input=>input.value=stored[input.dataset.prompt]??'');}
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>send({kind:b.dataset.action})));
const op=(op)=>send({kind:'op',op});
document.querySelectorAll('[data-select]').forEach(b=>b.addEventListener('change',()=>op({kind:'select',field:b.dataset.select,selected:b.checked})));
document.querySelectorAll('[data-short]').forEach(b=>b.addEventListener('click',()=>op({kind:'heading',field:b.dataset.short,mode:'short'})));
document.querySelectorAll('form[data-heading]').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();op({kind:'heading',field:f.dataset.heading,mode:'text',text:f.elements.text.value});}));
document.querySelectorAll('form[data-order]').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();op({kind:'order',field:f.dataset.order,position:Number(f.elements.position.value),descending:f.elements.descending.checked});}));
document.querySelectorAll('form[data-aggregate]').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();op({kind:'aggregate',field:f.dataset.aggregate,function:f.elements.function.value});}));
document.querySelectorAll('form[data-translate]').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();const eff=f.elements.effective.value;op({kind:'translate',field:f.dataset.translate,value:f.elements.value.value,effectiveDate:eff==='current'?'current':{field:eff}});}));
document.querySelectorAll('[data-distinct]').forEach(b=>b.addEventListener('change',()=>op({kind:'distinct',distinct:b.checked,select:Number(b.dataset.distinct)})));
document.querySelector('#addRecord')?.addEventListener('submit',e=>{e.preventDefault();const f=e.target.elements,record=f.record.value.trim().toUpperCase(),type=f.type.value;
  op(type==='union'?{kind:'union',record}:{kind:'join',record,type,...(type==='related'?{field:f.field.value.trim().toUpperCase()}:{})});});
document.querySelector('#expression')?.addEventListener('submit',e=>{e.preventDefault();const f=e.target.elements;op({kind:'expression',text:f.text.value,type:f.type.value,length:Number(f.namedItem('length').value),...(Number(f.decimals.value)?{decimalPositions:Number(f.decimals.value)}:{})});});
const DESCRIBED=${JSON.stringify(described).replace(/</g,'\\u003c')}, OPERATORS=${JSON.stringify(Object.keys(QUERY_OPERATORS))};
const KINDS=['none','constant','field','prompt','list','currentDate','expression','subquery'];
const cell=(html)=>{const td=document.createElement('td');td.innerHTML=html;return td;};
const addRow=(body,spec)=>{
  spec=spec||{operator:'equal'};const v=spec.value||{},kind=Object.keys(v)[0]||'none';
  const text=(o)=>o===undefined?'':kind==='list'?o.list.join(','):kind==='subquery'?JSON.stringify(o.subquery):kind==='currentDate'?'':String(Object.values(o)[0]);
  const tr=document.createElement('tr');
  tr.append(cell('<select name="logical" aria-label="Logical"><option>AND</option><option>OR</option></select>'),cell('<input type="checkbox" name="not" aria-label="Not">'),
    cell('<input type="number" name="open" min="0" max="9" aria-label="Open parentheses">'),cell('<input name="field" list="queryFieldRefs" aria-label="Field">'),
    cell('<select name="operator" aria-label="Operator">'+OPERATORS.map(o=>'<option>'+o+'</option>').join('')+'</select>'),
    cell('<select name="kind" aria-label="Operand type">'+KINDS.map(k=>'<option>'+k+'</option>').join('')+'</select>'),
    cell('<input name="value" aria-label="Value">'),cell('<input name="value2" aria-label="Second value">'),cell('<input type="number" name="close" min="0" max="9" aria-label="Close parentheses">'),
    cell('<button type="button" aria-label="Remove criterion">✕</button>'));
  const q=(n)=>tr.querySelector('[name='+n+']');
  q('logical').value=spec.logical||'AND';q('not').checked=!!spec.not;q('open').value=spec.open||0;q('field').value=spec.field||'';q('operator').value=spec.operator;q('kind').value=kind;
  q('value').value=text(spec.value);q('value2').value=spec.value2?String(spec.value2.constant??''):'';q('close').value=spec.close||0;
  tr.querySelector('button').addEventListener('click',()=>tr.remove());body.append(tr);
};
const operand=(kind,value)=>{switch(kind){case 'none':return undefined;case 'constant':return {constant:value};case 'field':return {field:value.trim().toUpperCase()};
  case 'prompt':return {prompt:value.trim()==='new'||!value.trim()?'new':Number(value)};case 'list':return {list:value.split(',').map(x=>x.trim())};case 'currentDate':return {currentDate:true};
  case 'expression':return {expression:value};case 'subquery':return {subquery:JSON.parse(value)};}};
document.querySelectorAll('[data-criteria]').forEach(section=>{
  const body=section.querySelector('tbody'),specs=(DESCRIBED[section.dataset.sel]||{})[section.dataset.criteria]||[];specs.forEach(spec=>addRow(body,spec));
  section.querySelector('[data-add-row]').addEventListener('click',()=>addRow(body));
  section.querySelector('[data-apply-criteria]').addEventListener('click',()=>{
    try{const criteria=[...body.querySelectorAll('tr')].map((tr,i)=>{const q=(n)=>tr.querySelector('[name='+n+']'),spec={operator:q('operator').value};
      if(q('field').value.trim())spec.field=q('field').value.trim().toUpperCase();if(i)spec.logical=q('logical').value;if(q('not').checked)spec.not=true;
      if(Number(q('open').value))spec.open=Number(q('open').value);if(Number(q('close').value))spec.close=Number(q('close').value);
      const value=operand(q('kind').value,q('value').value);if(value)spec.value=value;if(q('value2').value.trim())spec.value2={constant:q('value2').value};return spec;});
      const sel=Number(section.dataset.sel);op(section.dataset.criteria==='having'?{kind:'having',criteria}:{kind:'criteria',criteria,...(sel>1?{select:sel}:{})});
    }catch(err){const status=document.querySelector('#status');status.hidden=false;status.textContent='Invalid subquery JSON: '+err.message;}
  });
});
document.querySelector('#properties')?.addEventListener('submit',e=>{e.preventDefault();const f=e.target.elements;op({kind:'properties',description:f.description.value,comments:f.comments.value});});
document.querySelector('#run')?.addEventListener('submit',e=>{e.preventDefault();const values={};e.target.querySelectorAll('[data-prompt]').forEach(input=>values[input.dataset.prompt]=input.value);api?.setState({...api?.getState(),prompts:values});send({kind:'run',values,limit:Number(e.target.elements.limit.value)});});
</script></body></html>`;
}
