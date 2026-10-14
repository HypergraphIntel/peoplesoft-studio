import type { AdminKind } from '../model/administration.js';

export const ADMIN_TITLES = { message: 'Message Catalog', text: 'Text Catalog', url: 'URL Definitions' } as const;
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function administrationHtml(kind: AdminKind, connection: string, nonce: string): string {
  const fields = kind === 'message'
    ? [['set','Message Set','number'],['number','Message Number','number'],['setDescription','Set Description','text'],['setShortDescription','Short Description','text'],
      ['severity','Severity','severity'],['text','Message Text','textarea'],['explanation','Explanation','textarea']]
    : kind === 'url' ? [['id','URL ID','text'],['description','Description','text'],['url','URL','text'],['owner','Owner ID','text'],['comments','Comments','textarea']]
    : [['owner','Owner ID','text'],['subId','Sub-ID','text'],['id','Text ID','text'],['effectiveDate','Effective Date','date'],
      ...Array.from({length:6},(_,i)=>['key'+i,'Context Key '+(i+1),'text']),['language','Language Code (blank = base)','text'],
      ['description','Text ID Description','text'],['usage','Usage Code','text'],['systemData','System Data','checkbox'],['text','Text','textarea']];
  const form = fields.map(([name,label,type]) => `<label>${label}${type === 'textarea' ? `<textarea id="${name}" rows="${name === 'text' ? 6 : 4}"></textarea>`
    : type === 'severity' ? '<select id="severity"><option value="M">Message</option><option value="W">Warning</option><option value="E">Error</option><option value="C">Cancel</option></select>'
    : `<input id="${name}" type="${type}">`}</label>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px;margin:0}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:6px 12px;cursor:pointer}
button:disabled{opacity:.5;cursor:default}input,textarea,select{box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:5px;width:100%}
input[type=checkbox]{width:auto}label{display:block;margin:8px 0}textarea{resize:vertical}
.layout{display:grid;grid-template-columns:minmax(230px,1fr) minmax(300px,2fr);gap:20px}.search{display:flex;gap:6px}.search input{min-width:0}
#results button{display:block;width:100%;text-align:left;background:transparent;color:var(--vscode-foreground);border-bottom:1px solid var(--vscode-panel-border);padding:8px}
#results small{display:block;color:var(--vscode-descriptionForeground);overflow-wrap:anywhere}
#related{white-space:pre-wrap;overflow-wrap:anywhere}#status{min-height:1.4em;color:var(--vscode-descriptionForeground)}#results{max-height:65vh;overflow:auto}
@media(max-width:700px){.layout{grid-template-columns:1fr}}.actions{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
</style></head><body><h2>${ADMIN_TITLES[kind]}</h2><p>${escape(connection)}</p>
<div id="status" role="status"></div><div class="layout"><section><form id="searchForm" class="search"><input id="query" aria-label="Search catalog" placeholder="Search ID or description"><button>Search</button></form>
<div class="actions"><button id="previous">Previous</button><button id="next">Next</button></div><div id="results"></div></section>
<section><div class="actions"><button id="new">New Entry</button><button id="reload">Reload Entry</button>${kind === 'text' ? '<button id="translate">Add / Open Translation</button><select id="configuration" aria-label="Text Catalog configuration"><option value="">Choose owner / sub-ID</option></select>' : ''}</div>
<form id="editor"><fieldset id="formFields" style="border:0;padding:0">${form}</fieldset><button id="save" type="submit" disabled>Save</button></form><h3>Related language / protocol rows</h3><pre id="related"></pre></section></div>
<script nonce="${nonce}">
const api=acquireVsCodeApi(),kind=${JSON.stringify(kind)},fields=${JSON.stringify(fields.map(f=>f[0]))};
let dirty=false,offset=0,current=null,writable=false,busy=false;
const byId=id=>document.getElementById(id),status=text=>byId('status').textContent=text;
function input(){const data={};for(const id of fields){const el=byId(id);data[id]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;}
 if(kind==='text'){data.keys=Array.from({length:6},(_,i)=>data['key'+i]);for(let i=0;i<6;i++)delete data['key'+i];}return data;}
function controls(){byId('save').disabled=!writable||busy;byId('new').disabled=busy;byId('reload').disabled=!current||busy;byId('formFields').disabled=busy||!writable;if(kind==='text'){byId('translate').disabled=!current||!writable||busy;byId('configuration').disabled=!!current||busy||!!byId('language').value;}}
function fill(data,existing,editable){writable=editable;for(const id of fields){const el=byId(id);const value=id.startsWith('key')?data.keys?.[Number(id.slice(3))]:data[id];
 if(el.type==='checkbox')el.checked=!!value;else el.value=value??'';
 const identity=kind==='message'?['set','number']:kind==='url'?['id']:['owner','subId','id','effectiveDate','language',...Array.from({length:6},(_,i)=>'key'+i)];
 el.disabled=(existing||(kind==='text'&&data.language))&&identity.includes(id);if(kind==='text'&&(existing||data.language)&&['description','usage'].includes(id))el.disabled=true;if(kind==='text'&&data.language&&id==='systemData')el.disabled=true;
 if(kind==='message'&&!existing&&data.setDescription){byId('setDescription').disabled=true;byId('setShortDescription').disabled=true;}
 }dirty=false;controls();}
const send=(type,extra={})=>api.postMessage({type,dirty,...extra});
byId('editor').addEventListener('input',()=>{dirty=true;send('dirty');});
byId('editor').onsubmit=e=>{e.preventDefault();busy=true;controls();send('save',{input:input()});};
byId('new').onclick=()=>send('new');byId('reload').onclick=()=>send('load',{key:current});
if(kind==='text')byId('translate').onclick=()=>send('translate');
byId('searchForm').onsubmit=e=>{e.preventDefault();offset=0;send('search',{query:byId('query').value,offset});};
byId('previous').onclick=()=>{offset=Math.max(0,offset-100);send('search',{query:byId('query').value,offset});};
byId('next').onclick=()=>{offset+=100;send('search',{query:byId('query').value,offset});};
window.addEventListener('message',e=>{const m=e.data;busy=false;
 if(m.type==='list'){byId('results').replaceChildren();for(const row of m.items){const b=document.createElement('button'),description=document.createElement('small');b.textContent=row.label;description.textContent=row.description;b.append(description);b.onclick=()=>send('load',{key:row.key});byId('results').append(b);}
 byId('previous').disabled=offset===0;byId('next').disabled=!m.more;status(m.items.length+' entries'+(m.more?' · more available':''));}
 if(m.type==='entry'){current=m.key;fill(m.input,!!m.key,m.editable);byId('related').textContent=JSON.stringify(m.related??[],null,2);status(m.notice??(m.editable?'Ready':'Read only'));}
 if(m.type==='choices'&&kind==='text'){for(const item of m.configurations){const option=document.createElement('option');option.value=JSON.stringify([item.owner,item.subId]);option.textContent=item.owner+' / '+item.subId+' — '+item.description;byId('configuration').append(option);}
 byId('configuration').onchange=()=>{if(byId('configuration').value){const [owner,subId]=JSON.parse(byId('configuration').value);byId('owner').value=owner;byId('subId').value=subId;dirty=true;send('dirty');}};}
 if(m.type==='error')status(m.message);controls();});
send('ready');
</script></body></html>`;
}
