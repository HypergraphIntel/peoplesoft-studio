/** Self-checking fixture using the production security webview script. */
import { writeFileSync, readFileSync } from 'node:fs';
import { securityHtml } from '../../src/editors/securityHtml.js';
const fixture = JSON.parse(readFileSync('src/test/fixtures/security-8.62.09/oauth-native.json','utf8'));
const doc = { kind:'oauth', key:['ZZ_STUDIO_OAUTH_01','CU'], properties:fixture.after, audiences:['https://audience.example.invalid'], roles:['Lab role'], token:'test' };
const stub = `
const messages=[];window.confirm=()=>true;
window.acquireVsCodeApi=()=>({postMessage(m){messages.push(m);if(m.type==='list')setTimeout(run,0)}});
function receive(data){window.dispatchEvent(new MessageEvent('message',{data}))}
function assert(v,label){if(!v)throw new Error(label)}
function run(){try{
const $=id=>document.getElementById(id);
receive({type:'list',items:[{key:${JSON.stringify(doc.key)},label:'Lab application',description:'CUSTOM'}],more:false,choices:[]});
assert($('items').querySelectorAll('button').length===1,'search result rendered');
$('items').querySelector('button').click();assert(messages.at(-1).type==='get','open uses full key');
receive({type:'entry',document:${JSON.stringify(doc)},diagnostics:[],editable:true});
assert($('detail').textContent.includes('Lab role'),'related roles shown');
assert(!$('detail').textContent.includes('PTCLIENT_SECRET'),'secret absent');
$('edit-PTSCOPE_URL').value='studio.ui.preview';$('edit-PTSCOPE_URL').dispatchEvent(new Event('input'));
assert(messages.at(-1).type==='dirty','dirty event');
[...$('detail').querySelectorAll('button')].find(b=>b.textContent==='Preview changes').click();
assert(messages.at(-1).dryRun===true&&messages.at(-1).changes.PTSCOPE_URL==='studio.ui.preview','preview payload');
assert($('edit-PTSCOPE_URL').disabled,'busy editing disabled');
receive({type:'error',message:'Simulated refusal'});
assert(!$('edit-PTSCOPE_URL').disabled&&$('edit-PTSCOPE_URL').value==='studio.ui.preview','error keeps edits and recovers');
receive({type:'entry',document:${JSON.stringify(doc)},diagnostics:[],editable:false});
assert(!$('detail').querySelector('input'),'read-only configuration has no editing controls');
document.body.dataset.testResult='PASS';document.body.append(Object.assign(document.createElement('p'),{textContent:'PASS: search, identity, roles, secret exclusion, dirty state, preview, busy state, error recovery, read-only controls'}));
}catch(e){document.body.dataset.testResult='FAIL';document.body.append(Object.assign(document.createElement('p'),{textContent:e.message}))}}
`;
writeFileSync('/tmp/psft-security-ui-check.html',securityHtml('oauth','UI verification','securitytest').replace('<script nonce="securitytest">','<script nonce="securitytest">'+stub+'</script><script nonce="securitytest">'));
