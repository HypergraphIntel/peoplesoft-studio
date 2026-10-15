import { writeFileSync } from 'node:fs';
import { dropZoneHtml } from '../../src/editors/dropZoneHtml.js';
const stub = `
const messages=[]; window.confirm=()=>true;
window.acquireVsCodeApi=()=>({postMessage(m){messages.push(m);if(m.type==='ready')setTimeout(run,0)}});
function receive(data){window.dispatchEvent(new MessageEvent('message',{data}))}
function assert(v,label){if(!v)throw new Error(label)}
function run(){try{
const $=id=>document.getElementById(id);
const state={type:'state',component:'JOB_DATA_FL',market:'GBL',connection:'Fixture',editable:true,owners:[{portal:'EMPLOYEE',cref:'JOB'}],zones:[{page:'JOB_PAGE',container:'SUB_CONTAINER',fieldName:'0.REC.FIELD.12',label:'<Drop zone>',tabOrder:12,subpage:'ZZ_OLD'}]};
receive(state);
assert($('zones').querySelectorAll('tr').length===1,'zone rendered');
assert($('zones').textContent.includes('<Drop zone>')&&!$('zones').querySelector('drop'),'labels rendered as text');
assert($('save').disabled,'unchanged save disabled');
const input=$('zones').querySelector('input');input.value='zz_new';input.dispatchEvent(new Event('input'));
assert(!$('save').disabled,'edited save enabled');$('preview').click();
assert(messages.at(-1).type==='preview'&&messages.at(-1).assignments[0].subpage==='ZZ_NEW','preview identity and normalized subpage');
assert(input.disabled&&$('save').disabled,'busy controls');
receive({type:'notice',message:'Error: simulated conflict'});
assert(input.value==='zz_new'&&!input.disabled,'errors preserve edits');
input.value='';input.dispatchEvent(new Event('input'));$('save').click();
assert(messages.at(-1).assignments[0].subpage==='','clear assignment');
receive({...state,editable:false});assert($('zones').querySelector('input').disabled&&$('save').disabled,'read only');
$('zones').querySelector('button').click();assert(messages.at(-1).type==='open'&&messages.at(-1).page==='JOB_PAGE','page navigation');
receive({...state,zones:[]});assert($('summary').textContent.includes('No available drop zones'),'empty state');
receive(state);document.body.dataset.testResult='PASS';
}catch(e){document.body.dataset.testResult='FAIL';document.body.append(Object.assign(document.createElement('p'),{textContent:e.message}))}}
`;
writeFileSync('/tmp/psft-drop-zone-ui-check.html',dropZoneHtml('uitest').replace('<script nonce="uitest">','<script nonce="uitest">'+stub+'</script><script nonce="uitest">'));
