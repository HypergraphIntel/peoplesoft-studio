export function pfcHtml(nonce: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><title>Page and Field Configurator</title>
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;max-width:1200px}h1{font-size:24px}h2{font-size:18px}p{line-height:1.5}.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}button,select{padding:7px 12px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;cursor:pointer}button:disabled,select:disabled{opacity:.5;cursor:default}table{border-collapse:collapse;width:100%}td,th{padding:10px;text-align:left;border-bottom:1px solid var(--vscode-panel-border)}section{border:1px solid var(--vscode-panel-border);padding:16px;margin:16px 0}small{opacity:.75}pre{white-space:pre-wrap}#notice{color:var(--vscode-foreground)}
</style></head><body><h1>Page and Field Configurator</h1><p id="context">Loading…</p>
<p>Configure fields without changing delivered definitions. Saving generates the configuration’s Event Mapping.</p>
<div class="toolbar"><label>Configuration <select id="kind"><option value="STD">Standard</option><option value="MASK">Masking</option></select></label><button id="preview" disabled>Preview changes</button><button id="save" disabled>Save</button><button id="reload">Reload / Revert</button></div>
<p id="access"></p><h2 id="description"></h2><div class="toolbar"><button id="header" disabled>Set description</button><button id="active" disabled>Deactivate configuration</button><button id="addSequence" disabled>Add sequence</button></div>
<div class="toolbar"><button id="applyLevel" disabled>Apply level</button><button id="headerTarget" disabled>Applies to…</button></div><p id="who"></p>
<p id="mapping"></p><div id="sequences"></div><pre id="notice" role="status" aria-live="polite"></pre>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi(), el=id=>document.getElementById(id);let state,busy=true;
function controls(){document.querySelectorAll('button,select').forEach(b=>{b.disabled=busy||(!state?.editable&&!['reload','kind'].includes(b.id))});el('save').disabled=el('preview').disabled=busy||!state?.editable||!state?.dirty;}
function send(type,extra={}){busy=true;controls();vscode.postMessage({type,...extra});}
for(const id of ['preview','save','reload','header','active','addSequence','applyLevel'])el(id).onclick=()=>send(id);
el('headerTarget').onclick=()=>send('target',{index:-1});
el('kind').onchange=()=>send('switch',{configType:el('kind').value});
function text(tag,value){const n=document.createElement(tag);n.textContent=value;return n;}
function button(label,type,index){const b=text('button',label);b.onclick=()=>send(type,{index});return b;}
window.addEventListener('message',event=>{const m=event.data;if(m.type!=='state')return;state=m;busy=false;el('kind').value=m.configType;
el('context').textContent=m.component+'.'+m.market+' · '+m.connection+(m.dirty?' · Unsaved changes':'');
el('access').textContent=m.editable?'':'Read only. Editing requires an Oracle Writable connection with an Operator ID.';
el('description').textContent=m.configuration.header.DESCR||'New configuration — set a description';
el('active').textContent=(m.configuration.header.EFF_STATUS||'A')==='I'?'Activate configuration':'Deactivate configuration';
el('applyLevel').textContent=m.headerLevel?'Set who per sequence':'Set who for the whole configuration';el('headerTarget').hidden=!m.headerLevel;
el('who').textContent=m.headerLevel?'Applies to: '+m.headerTarget+' (every sequence)':'Who it applies to is set on each sequence.';
el('mapping').textContent=m.contentReferences.length?m.contentReferences.map(c=>c.cref+': '+c.mappingRows+' mapped events'+(c.inSync?' · in sync':' · needs regeneration')).join(' | '):'No registered content reference. Register this component and save again to apply its configuration.';
el('notice').textContent=m.message;el('sequences').replaceChildren();
if(!m.configuration.sequences.length)el('sequences').append(text('p','Add a sequence, then select fields from the component’s page catalog.'));
m.configuration.sequences.forEach((s,index)=>{const box=document.createElement('section');box.append(text('h2','Sequence '+s.EOCC_SEQUENCE_NBR+(s.DESCR?' · '+s.DESCR:'')));
const bar=document.createElement('div');bar.className='toolbar';bar.append(button((s.STATUS||'A')==='I'?'Activate sequence':'Deactivate sequence','sequenceActive',index),button('Add field','addField',index),button('Add criterion','addCriterion',index),button('Page rules…','pageRules',index));if(!m.headerLevel)bar.append(button('Applies to…','target',index));box.append(bar);
const criteria=m.configuration.criteria.filter(r=>Number(r.EOCC_SEQUENCE_NBR)===Number(s.EOCC_SEQUENCE_NBR));const pages=m.configuration.pages.filter(r=>Number(r.EOCC_SEQUENCE_NBR)===Number(s.EOCC_SEQUENCE_NBR));
box.append(text('small',(m.headerLevel?'':'Applies to: '+m.sequenceTargets[index]+' · ')+(criteria.length?'Applies when all criteria hold':'No criteria: applies whenever the page is used')+(m.pageRules[index].length?' · Pages: '+m.pageRules[index].join('; '):' · No page rules')));
const crit=m.criteriaRows.filter(c=>Number(c.sequence)===Number(s.EOCC_SEQUENCE_NBR));if(crit.length){const list=document.createElement('ul');crit.forEach(c=>{const li=text('li',c.text+' ');li.append(button('Edit','editCriterion',c.index),button('Remove','removeCriterion',c.index));list.append(li)});box.append(list);}
const table=document.createElement('table'),head=document.createElement('tr');for(const title of ['Field','Page','Settings','Actions'])head.append(text('th',title));const thead=document.createElement('thead');thead.append(head);table.append(thead);const body=document.createElement('tbody');
m.fields.filter(f=>Number(f.sequence)===Number(s.EOCC_SEQUENCE_NBR)&&!f.blank).forEach(f=>{const row=document.createElement('tr'),name=text('td',f.label||f.name);name.append(document.createElement('br'),text('small',f.name));const actions=document.createElement('td');actions.append(button('Edit','editField',f.index),button('Remove','removeField',f.index));row.append(name,text('td',f.page||''),text('td',f.settings),actions);body.append(row)});table.append(body);box.append(table);el('sequences').append(box)});controls();});
controls();vscode.postMessage({type:'ready'});
</script></body></html>`;
}
