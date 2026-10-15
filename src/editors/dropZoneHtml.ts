export function dropZoneHtml(nonce: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Drop Zones</title>
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px}h1{font-size:24px}p{line-height:1.5}.toolbar{display:flex;gap:8px;margin:20px 0}button{cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:7px 12px}button:disabled{opacity:.5;cursor:default}input{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:6px;width:180px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid var(--vscode-panel-border);vertical-align:top}small{display:block;opacity:.75;margin-top:5px}pre{white-space:pre-wrap}#context{opacity:.8}.link{background:transparent;color:var(--vscode-textLink-foreground);padding:0}
</style></head><body><h1>Drop Zones</h1><p id="context">Loading configuration…</p>
<p>Insert custom subpages into the component’s available drop zones. Clearing a subpage removes its assignment.</p>
<div class="toolbar"><button id="preview" disabled>Preview changes</button><button id="save" disabled>Save</button><button id="reload">Reload / Revert</button></div>
<p id="summary"></p><p id="access"></p><table><thead><tr><th>Page</th><th>Drop zone</th><th>Tab order</th><th>Custom subpage</th></tr></thead><tbody id="zones"></tbody></table><pre id="notice" role="status"></pre>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();let state, edits=[], busy=false;
const el=id=>document.getElementById(id);
function changed(){return state&&edits.some((a,i)=>a.subpage!==(state.zones[i].subpage||''));}
function controls(){el('save').disabled=el('preview').disabled=busy||!state?.editable||!changed();el('reload').disabled=busy;document.querySelectorAll('input').forEach(i=>i.disabled=busy||!state?.editable);}
function send(type){busy=true;controls();vscode.postMessage({type,assignments:edits});}
el('save').onclick=()=>send('save');el('preview').onclick=()=>send('preview');el('reload').onclick=()=>{if(changed()&&!confirm('Discard unsaved subpage assignments?'))return;send('reload');};
function text(tag,value){const node=document.createElement(tag);node.textContent=value;return node;}
function pageButton(name){const b=text('button',name);b.className='link';b.onclick=()=>vscode.postMessage({type:'open',page:name});return b;}
window.addEventListener('message',event=>{const m=event.data;busy=false;if(m.type==='notice'){el('notice').textContent=m.message;controls();return;}if(m.type!=='state')return;state=m;edits=m.zones.map(z=>({page:z.page,fieldName:z.fieldName,subpage:z.subpage||''}));
el('context').textContent=m.component+'.'+m.market+' · '+m.connection;
el('summary').textContent=m.zones.length?m.zones.length+' drop zones · '+m.zones.filter(z=>z.subpage).length+' configured · Stored under: '+m.owners.map(o=>o.portal+'/'+o.cref).join(', '):'No available drop zones on this component’s pages, subpages or secondary pages.';
el('access').textContent=m.editable?'':'Read only. Saving requires a Writable connection with an Operator ID.';
el('notice').textContent=m.message;el('zones').replaceChildren();m.zones.forEach((z,i)=>{const row=document.createElement('tr');const page=document.createElement('td');page.append(pageButton(z.page));if(z.container!==z.page)page.append(text('small','Defined on '+z.container));const label=text('td',z.label);label.append(text('small',z.fieldName));const td=document.createElement('td');const input=document.createElement('input');input.value=z.subpage||'';input.maxLength=18;input.setAttribute('aria-label','Subpage for '+z.label+' on '+z.page);input.placeholder='No subpage';input.oninput=()=>{edits[i].subpage=input.value.trim().toUpperCase();controls();};td.append(input);if(z.subpage)td.append(text('small','Stored: '+z.subpage),pageButton(z.subpage));row.append(page,label,text('td',String(z.tabOrder)),td);el('zones').append(row);});controls();});
vscode.postMessage({type:'ready'});
</script></body></html>`;
}
