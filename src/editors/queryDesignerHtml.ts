import { randomBytes } from 'node:crypto';
import { escapeHtml as esc } from './propertiesHtml.js';
import { queryAggregateLabel, queryReferences, renderQuery, SELECT_TYPES, CONDITIONS, CONNECTORS, type QueryView, type Row } from '../model/queryDefinition.js';
import type { QuerySqlPlan } from '../model/querySql.js';
import type { FieldDefinition } from '../model/fieldDefinition.js';
import { FIELD_TYPE_LABELS, FieldType } from '../model/record.js';

export type QueryFieldMetadata = Pick<FieldDefinition, 'type' | 'length' | 'decimalPositions' | 'labels'> & {shortName?:string;longName?:string};

export interface QueryDesignerState {
  editable?: boolean; dirty?: boolean; plan?: QuerySqlPlan; unsupported?: string; message?: string;
  result?: {sql:string;rows:Array<Record<string,unknown>>;truncated:boolean;maxRows:number;ms:number};
  canUndo?: boolean; canRedo?: boolean;
}
/** Windows Query grids with host-owned operations and SQL execution. */
export function renderQueryDesigner(name: string, connection: string, view: QueryView, metadata: Record<string, QueryFieldMetadata> = {}, state: QueryDesignerState = {}): string {
  const nonce = randomBytes(16).toString('base64');
  const s = (v: unknown) => String(v ?? '').trim();
  const n = (v: unknown) => Number(v ?? 0);
  const label = (f: Row) => {const m=metadata[s(f.FIELDNAME)];return m?.shortName!==undefined?{shortName:m.shortName,longName:m.longName??''}:m?.labels.find(l=>l.isDefault)??m?.labels[0];};
  const heading=(f:Row)=>s(f.HEADING)||(n(f.HDGTYPE)===3?label(f)?.shortName??'RFT Short':n(f.HDGTYPE)===4?label(f)?.longName??'RFT Long':'');
  const format = (f: Row) => {
    const m = metadata[s(f.FIELDNAME)];
    if (!m) return '';
    return m.type === FieldType.Character ? `Char${m.length}` : `${FIELD_TYPE_LABELS[m.type] ?? `Type ${m.type}`} ${m.length}${m.decimalPositions ? `.${m.decimalPositions}` : ''}`;
  };
  const table = (heads: string[], rows: string[][]) => `<table><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const disabled=state.editable?'':' disabled';
  const input=(attrs:string,value:unknown)=>`<input ${attrs} value="${esc(String(value ?? ''))}"${disabled}>`;
  const options=(values:Array<[string,string]>)=>values.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('');
  const catalog=Object.entries(metadata).filter(([,m])=>m.type===0);
  const fieldOptions=options(view.fields.map(f=>[s(f.FIELDNAME),s(f.FIELDNAME)]));
  const fieldCatalog=catalog.map(([name,m])=>`<label class="record-field"><input type="checkbox" data-select="${esc(name)}"${view.fields.some(f=>s(f.FIELDNAME)===name && n(f.COLUMNNUM)>0)?' checked':''}${disabled}>${esc(name)} <span>${esc(m.longName ?? m.labels.find(l=>l.isDefault)?.longName ?? m.labels[0]?.longName ?? '')}</span></label>`).join('');
  const selected=view.fields.filter(f=>n(f.COLUMNNUM)>0).sort((a,b)=>n(a.COLUMNNUM)-n(b.COLUMNNUM));
  const edits=state.editable?`<section><h2>Field properties</h2>${selected.map(f=>`<form data-heading="${esc(s(f.FIELDNAME))}"><strong>${esc(s(f.FIELDNAME))}</strong> <label>Heading ${input('name="text"',s(f.HEADING)||label(f)?.shortName||'')}</label> <button>Apply heading</button><button type="button" data-short="${esc(s(f.FIELDNAME))}">RFT Short</button></form><form data-order="${esc(s(f.FIELDNAME))}"><label>Order By position ${input('name="position" type="number" min="0"',n(f.ORDERBYNUM))}</label><label><input name="descending" type="checkbox"${s(f.ORDERBYDIR)==='D'?' checked':''}>Descending</label><button>Apply order</button></form>`).join('')}</section>`:'';
  const currentCriterion=view.criteria[0];
  const currentField=s(view.fields.find(f=>n(f.FLDNUM)===n(currentCriterion?.LCRTFLDNUM))?.FIELDNAME);
  const currentExpression=String(view.expressions.find(e=>n(e.EXPNUM)===n(currentCriterion?.R1CRTEXPNUM))?.EXPRESSIONTEXT ?? '');
  const currentMode=n(currentCriterion?.EXPRTYPE)===8 ? currentExpression.replace(/^:/,'') : 'constant';
  const criterionEditor=state.editable?`<section><h2>Equal-to criterion</h2><form id="criterion"><label>Field <select name="field" aria-label="Criterion field">${fieldOptions}</select></label><label>Value type <select name="mode" aria-label="Value type"><option value="constant">Constant</option><option value="prompt">New runtime prompt</option>${view.binds.map(b=>`<option value="${n(b.BNDNUM)}">Prompt ${n(b.BNDNUM)} — ${esc(s(b.HEADING))}</option>`).join('')}</select></label><label>Constant ${input('name="value" aria-label="Constant"',currentMode==='constant'?currentExpression:'')}</label><button>Apply criterion</button><button type="button" id="clearCriteria">Remove criterion</button></form></section>`:'';
  const runtime=state.plan?`<form id="run">${state.plan.prompts.map(b=>`<label>${esc(s(b.HEADING)||s(b.BNDNAME))} <input name="prompt${n(b.BNDNUM)}" data-prompt="${n(b.BNDNUM)}" aria-label="${esc(s(b.HEADING)||s(b.BNDNAME))}" maxlength="${n(b.LENGTH)}"></label>`).join('')}<label>Row limit <input name="limit" type="number" value="500" min="1" max="10000"></label><button>Run query</button></form>`:'';
  const results=state.result?`<p>${state.result.rows.length} rows · ${state.result.ms} ms${state.result.truncated?' · More rows available; row limit reached.':''}</p>${table((state.plan?.columns??selected).map(f=>heading(f)),state.result.rows.map(row=>(state.plan?.columns??selected).map(f=>String(row[s(f.FIELDNAME)] ?? ''))))}`:'<p>Run the query to see results.</p>';
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
<div class="workspace"><aside><strong>Query</strong>${state.editable ? `<details open><summary>A = ${esc(s(view.records[0]?.RECNAME))}</summary>${fieldCatalog}</details>`:tree}<button data-tab="expressions">Expressions (${view.expressions.length})</button><button data-tab="prompts">Prompts (${view.binds.length})</button></aside>
<main><nav aria-label="Query views"><button data-tab="fields" aria-selected="true">Fields</button><button data-tab="criteria" aria-selected="false">Criteria</button><button data-tab="sql">SQL</button><button data-tab="results">Results</button><button data-tab="properties">Properties</button><button data-tab="definition" aria-selected="false">Definition</button></nav>
<div class="content"><div id="fields">${fields}${edits}</div><div id="criteria" hidden>${criteria}${criterionEditor}</div><div id="sql" hidden><pre>${esc(state.plan?.sql ?? state.unsupported ?? 'SQL is unavailable.')}</pre></div><div id="results" hidden>${runtime}${results}</div><div id="properties" hidden>${properties}</div><div id="expressions" hidden>${expressions}</div><div id="prompts" hidden>${prompts}</div><div id="definition" hidden><pre>${esc(text)}</pre></div></div></main></div>
<script nonce="${nonce}">
const api=typeof acquireVsCodeApi==='function'?acquireVsCodeApi():window.queryPreviewApi;
const send=(m)=>{document.body.setAttribute('aria-busy','true');const status=document.querySelector('#status');status.hidden=false;status.textContent='Working…';document.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=true);api?.postMessage(m);};
const switchTab=(tab)=>{document.querySelectorAll('.content>div').forEach(panel=>panel.hidden=panel.id!==tab);document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));api?.setState({...api?.getState(),tab});};
switchTab(api?.getState()?.tab ?? 'fields');
const criterion=document.querySelector('#criterion');if(criterion){criterion.elements.field.value=${JSON.stringify(currentField).replace(/</g,'\\u003c')}||criterion.elements.field.value;criterion.elements.mode.value=${JSON.stringify(currentMode).replace(/</g,'\\u003c')};}
const run=document.querySelector('#run');if(run){const stored=api?.getState()?.prompts??{};run.querySelectorAll('[data-prompt]').forEach(input=>input.value=stored[input.dataset.prompt]??'');}
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>send({kind:b.dataset.action})));
const op=(op)=>send({kind:'op',op});
document.querySelectorAll('[data-select]').forEach(b=>b.addEventListener('change',()=>op({kind:'select',field:b.dataset.select,selected:b.checked})));
document.querySelectorAll('[data-short]').forEach(b=>b.addEventListener('click',()=>op({kind:'heading',field:b.dataset.short,mode:'short'})));
document.querySelectorAll('form[data-heading]').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();op({kind:'heading',field:f.dataset.heading,mode:'text',text:f.elements.text.value});}));
document.querySelectorAll('form[data-order]').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();op({kind:'order',field:f.dataset.order,position:Number(f.elements.position.value),descending:f.elements.descending.checked});}));
document.querySelector('#criterion')?.addEventListener('submit',e=>{e.preventDefault();const f=e.target.elements,mode=f.mode.value;op(mode==='constant'?{kind:'constant',field:f.field.value,value:f.value.value}:mode==='prompt'?{kind:'prompt',field:f.field.value}:{kind:'prompt',field:f.field.value,promptNumber:Number(mode)});});
document.querySelector('#clearCriteria')?.addEventListener('click',()=>op({kind:'clearCriteria'}));
document.querySelector('#properties')?.addEventListener('submit',e=>{e.preventDefault();const f=e.target.elements;op({kind:'properties',description:f.description.value,comments:f.comments.value});});
document.querySelector('#run')?.addEventListener('submit',e=>{e.preventDefault();const values={};e.target.querySelectorAll('[data-prompt]').forEach(input=>values[input.dataset.prompt]=input.value);api?.setState({...api?.getState(),prompts:values});send({kind:'run',values,limit:Number(e.target.elements.limit.value)});});
</script></body></html>`;
}
