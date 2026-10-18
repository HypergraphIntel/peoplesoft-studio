import { escapeHtml } from './propertiesHtml.js';
export function portalHtml(portal: string, connection: string, nonce: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body { color:var(--vscode-foreground); background:var(--vscode-editor-background); font-family:var(--vscode-font-family); padding:16px; }
header,.actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; } h1 { font-size:20px; }
main { display:grid; grid-template-columns:minmax(260px, 35%) 1fr; gap:24px; }
nav { overflow:auto; max-height:80vh; } ul { list-style:none; padding-left:18px; } nav > ul { padding-left:0; }
button { color:var(--vscode-button-foreground); background:var(--vscode-button-background); border:0; padding:6px 10px; cursor:pointer; }
button:disabled { opacity:.5; cursor:default; } .entry { background:transparent; color:inherit; text-align:left; }
.entry:hover,.entry[aria-current=true] { background:var(--vscode-list-hoverBackground); }
summary { cursor:pointer; } pre { white-space:pre-wrap; overflow-wrap:anywhere; } #status,.hint { color:var(--vscode-descriptionForeground); }
label { display:block; margin:10px 0; } input,select,textarea { box-sizing:border-box; padding:6px; color:var(--vscode-input-foreground); background:var(--vscode-input-background); border:1px solid var(--vscode-input-border,transparent); }
label input:not([type=checkbox]),label select,label textarea { display:block; width:100%; margin-top:4px; } fieldset { border:1px solid var(--vscode-panel-border); margin:12px 0; padding:12px; }
.fields { display:grid; grid-template-columns:1fr 1fr; gap:0 16px; } .grant { display:flex; gap:8px; align-items:center; margin:6px 0; } .grant input[type=text] { min-width:80px; flex:1; } .grant label { margin:0; } [hidden] { display:none!important; }
@media(max-width:700px) { main,.fields { grid-template-columns:1fr; } }
</style></head><body><header><h1>${escapeHtml(portal)} — Structure &amp; Content</h1><button id="refresh">Refresh</button></header>
<p>${escapeHtml(connection)}</p><div class="actions"><button id="newFolder" disabled>New Folder</button><button id="newCref" disabled>New Content Reference</button></div>
<p id="status" role="status">Loading portal…</p><main><nav aria-label="Portal structure" id="tree"></nav><section aria-label="Entry editor">
<p id="empty">Select an entry to edit it, or create a folder or content reference.</p>
<form id="editor" hidden><fieldset id="properties"><legend id="title">Properties</legend>
<div class="fields"><label>Name<input id="name" maxlength="30" required></label><label>Label<input id="label" maxlength="30" required></label></div>
<label>Parent folder<select id="parent"></select></label><div class="fields"><label>Sequence<input id="sequence" type="number" min="0" max="2147483647" required></label><label>Owner ID<input id="owner" maxlength="4"></label></div>
<label>Description<textarea id="description" maxlength="254" rows="3"></textarea></label>
<label>Access<select id="access"><option value="">Keep current setting</option><option value="author">Author Access and its security</option><option value="permissions">Its security only</option><option value="public">Public</option></select></label>
<div id="targetSection"><label>Content target<select id="targetType"><option value="keep">Keep current target</option><option value="component">PeopleSoft Component</option><option value="external">External URL</option></select></label>
<div id="component" hidden><div class="fields"><label>Content provider node<input id="node" maxlength="30"></label><label>Menu<input id="menu" maxlength="30"></label><label>Component<input id="componentName" maxlength="30"></label><label>Market<input id="market" maxlength="3" value="GBL"></label></div><label>Page (optional)<input id="page" maxlength="30"></label><label>Additional URL parameters<input id="parameters" maxlength="2000" placeholder="Action=U"></label></div>
<label id="external" hidden>URL<input id="url" type="url" maxlength="4000" placeholder="https://"></label></div>
<fieldset><legend>Security</legend><p class="hint">Permission lists and roles assigned to this entry. Cascade passes a folder grant to its children. Component references use permission lists.</p><div id="grants"></div><button type="button" id="addGrant">Add Grant</button></fieldset>
</fieldset><button type="submit" id="save">Save</button><span id="dirty" class="hint"></span></form>
<details id="stored"><summary>Stored entry details</summary><pre id="detail"></pre></details></section></main>
<script nonce="${nonce}">
const api=acquireVsCodeApi(), $=id=>document.getElementById(id), str=v=>String(v??'').trim();
let rows=[],input,selected,dirty=false,busy=false,entryEditable=false,canWrite=false;const expanded=new Set(['PORTAL_ROOT_OBJECT']);
function change(){dirty=true;$('dirty').textContent='Unsaved changes';api.postMessage({type:'dirty'});}
function controls(){$('properties').disabled=busy||!entryEditable;$('save').disabled=busy||!entryEditable;$('newFolder').disabled=$('newCref').disabled=busy||!canWrite;$('refresh').disabled=busy;}
function post(m){if(busy)return;busy=true;controls();api.postMessage({...m,dirty});}
$('editor').addEventListener('input',change);$('editor').addEventListener('change',change);
$('refresh').onclick=()=>post({type:'refresh'});
for(const [id,refType] of [['newFolder','F'],['newCref','C']])$(id).onclick=()=>post({type:'new',refType,parent:selected?.refType==='F'?selected.name:input?.parent||'PORTAL_ROOT_OBJECT'});
function targetVisibility(){const type=$('targetType').value;$('component').hidden=type!=='component';$('external').hidden=type!=='external';}
$('targetType').onchange=targetVisibility;
function grant(p={type:'P',name:'',cascade:false}){
 const d=document.createElement('div');d.className='grant';const type=document.createElement('select');type.setAttribute('aria-label','Grant type');
 for(const [v,label] of [['P','Permission List'],['R','Role']]){const o=document.createElement('option');o.value=v;o.textContent=label;type.append(o);}type.value=p.type;
 const name=document.createElement('input');name.type='text';name.maxLength=30;name.required=true;name.value=p.name;name.setAttribute('aria-label','Permission list or role name');
 const label=document.createElement('label'),cascade=document.createElement('input');cascade.type='checkbox';cascade.checked=p.cascade;cascade.disabled=input?.refType!=='F';label.append(cascade,' Cascade');
 const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.onclick=()=>{d.remove();change();};d.append(type,name,label,remove);$('grants').append(d);
}
$('addGrant').onclick=()=>{grant();change();};
$('editor').onsubmit=e=>{e.preventDefault();if(busy)return;const value={...input,name:$('name').value,parent:$('parent').value,label:$('label').value,description:$('description').value,sequence:Number($('sequence').value),owner:$('owner').value,
 permissions:[...$('grants').children].map(d=>({type:d.querySelector('select').value,name:d.querySelector('input[type=text]').value,cascade:d.querySelector('input[type=checkbox]').checked}))};
 if($('access').value!=='')value.access=$('access').value;else delete value.access;
 const type=$('targetType').value;
 if(input.refType==='C'&&type!=='keep')value.target=type==='external'?{type,url:$('url').value}:{type,node:$('node').value,menu:$('menu').value,component:$('componentName').value,market:$('market').value,page:$('page').value,parameters:$('parameters').value};else delete value.target;
 $('status').textContent='Saving…';post({type:'save',input:value});};
function renderTree(){
 $('tree').replaceChildren();const folders=new Set(rows.filter(r=>str(r.PORTAL_REFTYPE)==='F').map(r=>str(r.PORTAL_OBJNAME))),children=new Map();
 for(const r of rows){const parent=str(r.PORTAL_PRNTOBJNAME),key=folders.has(parent)?parent:'';if(!children.has(key))children.set(key,[]);children.get(key).push(r);}
 function branch(items,ancestors=new Set()) {const ul=document.createElement('ul');for(const r of items){const name=str(r.PORTAL_OBJNAME),refType=str(r.PORTAL_REFTYPE),key=JSON.stringify([refType,name]);if(ancestors.has(key))continue;
 const li=document.createElement('li'),button=document.createElement('button');button.className='entry';button.textContent=str(r.PORTAL_LABEL)||str(r.LINK_LABEL)||name;button.title=name;
 if(selected?.name===name&&selected?.refType===refType)button.setAttribute('aria-current','true');
 button.onclick=()=>post({type:'select',refType,name});
 if(refType==='F'){const d=document.createElement('details'),summary=document.createElement('summary');summary.append(button);d.append(summary);let loaded=false;
 const populate=()=>{if(!loaded){loaded=true;d.append(branch(children.get(name)||[],new Set([...ancestors,key])));}};
 d.addEventListener('toggle',()=>{if(d.open){expanded.add(name);populate();}else expanded.delete(name);});
 if(expanded.has(name)){populate();d.open=true;}li.append(d);}else li.append(button);ul.append(li);}return ul;}
 $('tree').append(branch(children.get('')||[]));
}
window.addEventListener('message',({data:m})=>{
 if(['entry','error','cancel','status'].includes(m.type)){busy=false;controls();}
 if(m.type==='error'||m.type==='status')$('status').textContent=m.text;
 if(m.type==='detail')$('detail').textContent=m.text;
 if(m.type==='tree'){rows=m.rows;canWrite=!!m.writable;controls();renderTree();$('status').textContent=rows.length+' entries in this portal.';}
 if(m.type!=='entry')return;
 input=m.input;dirty=false;$('dirty').textContent='';$('detail').textContent='';$('editor').hidden=!input;$('empty').hidden=!!input;if(!input){selected=undefined;return;}
 selected=m.creating?undefined:{refType:input.refType,name:input.name};
 const ancestors=new Set();let parent=input.parent;while(parent&&!ancestors.has(parent)){ancestors.add(parent);expanded.add(parent);parent=str(rows.find(r=>str(r.PORTAL_REFTYPE)==='F'&&str(r.PORTAL_OBJNAME)===parent)?.PORTAL_PRNTOBJNAME);}renderTree();
 $('title').textContent=(m.creating?'New ':'')+(input.refType==='F'?'Folder':'Content Reference');
 entryEditable=!!m.editable;controls();$('name').readOnly=!m.creating;
 for(const field of ['name','label','description','sequence','owner'])$(field).value=input[field]??'';
 $('parent').replaceChildren();for(const r of rows.filter(r=>str(r.PORTAL_REFTYPE)==='F'&&!(input.refType==='F'&&str(r.PORTAL_OBJNAME)===input.name))){const o=document.createElement('option');o.value=str(r.PORTAL_OBJNAME);o.textContent=(str(r.PORTAL_LABEL)||o.value)+' ('+o.value+')';$('parent').append(o);}$('parent').value=input.parent;
 $('access').value=input.access??'';
 $('targetSection').hidden=input.refType==='F';$('targetType').value=m.creating?'component':'keep';$('targetType').options[0].disabled=m.creating;
 for(const id of ['node','menu','componentName','page','parameters','url'])$(id).value='';$('market').value='GBL';targetVisibility();
 $('grants').replaceChildren();for(const p of input.permissions||[])grant(p);
 $('status').textContent=m.editable?'':input.name==='PORTAL_ROOT_OBJECT'?'Select a folder to edit, or create an entry under the root.':'Set this connection to Writable and configure an Operator ID to save.';
});api.postMessage({type:'ready'});
</script></body></html>`;
}
