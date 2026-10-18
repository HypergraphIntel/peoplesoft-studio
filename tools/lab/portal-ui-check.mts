/** Generate a self-checking browser fixture for the actual webview script. */
import { writeFileSync } from 'node:fs';
import { portalHtml } from '../../src/editors/portalHtml.js';
const nonce = 'portaluitest';
const check = `
window.acquireVsCodeApi=()=>({postMessage(m){
 if(m.type==='ready')setTimeout(run,0);
 if(m.type==='save'){window.saved=m.input;}
}});
function receive(data){window.dispatchEvent(new MessageEvent('message',{data}));}
function assert(value,label){if(!value)throw new Error(label);}
function run(){try{
 const $=id=>document.getElementById(id);
 receive({type:'tree',writable:true,rows:[
 {PORTAL_REFTYPE:'F',PORTAL_OBJNAME:'PORTAL_ROOT_OBJECT',PORTAL_PRNTOBJNAME:' ',PORTAL_LABEL:'Root'},
 {PORTAL_REFTYPE:'F',PORTAL_OBJNAME:'ZZ_FOLDER',PORTAL_PRNTOBJNAME:'PORTAL_ROOT_OBJECT',PORTAL_LABEL:'Folder'},
 {PORTAL_REFTYPE:'C',PORTAL_OBJNAME:'ZZ_REF',PORTAL_PRNTOBJNAME:'ZZ_FOLDER',PORTAL_LABEL:'Reference'}]});
 receive({type:'entry',creating:true,editable:true,input:{portal:'EMPLOYEE',refType:'C',name:'',parent:'ZZ_FOLDER',label:'',description:'',sequence:0,owner:'',access:'author',permissions:[]}});
 assert($('tree').querySelectorAll('details').length===2,'nested folder tree');
 assert([...$('tree').querySelectorAll('button')].some(b=>b.textContent==='Reference'),'expanded ancestor reveals reference');
 assert(!$('editor').hidden&&!$('save').disabled,'editable new-entry form');
 $('name').value='ZZ_NEW';$('label').value='New Reference';$('targetType').value='external';$('targetType').dispatchEvent(new Event('change',{bubbles:true}));
 assert(!$('external').hidden&&$('component').hidden,'external URL controls');
 $('url').value='https://example.invalid/ui';$('addGrant').click();
 $('grants').querySelector('input[type=text]').value='PTPT1000';
 $('editor').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 assert($('properties').disabled,'saving disables editable fields');
 assert(window.saved.name==='ZZ_NEW'&&window.saved.parent==='ZZ_FOLDER','save identity and parent');
 assert(window.saved.target.type==='external'&&window.saved.target.url==='https://example.invalid/ui','save target');
 assert(window.saved.permissions[0].name==='PTPT1000','save security');
 receive({type:'error',text:'Test refusal'});assert(!$('save').disabled&&$('status').textContent==='Test refusal','error recovery preserves form');
 receive({type:'entry',creating:false,editable:false,input:{portal:'EMPLOYEE',refType:'F',name:'PORTAL_ROOT_OBJECT',parent:'',label:'Root',sequence:0,permissions:[]}});
 assert($('save').disabled&&$('properties').disabled,'root protection');
 document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL: '+error.message;}}
`;
const html = portalHtml('EMPLOYEE', 'UI Test', nonce).replace(`<script nonce="${nonce}">`, `<script nonce="${nonce}">${check}</script><script nonce="${nonce}">`);
writeFileSync('/tmp/psft-portal-ui-check.html', html);
