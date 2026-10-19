/** Headless browser check of the production Build Request script; no VS Code or database writes. */
import { readFileSync, writeFileSync } from 'node:fs';

const stub = `
const messages=[];let localState={};
window.acquireVsCodeApi=()=>({postMessage(m){messages.push(m)},getState(){return localState},setState(s){localState=s}});
function receive(state,more={}){window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state,mcp:{running:true,writes:true},agent:'claude',...more}}))}
function assert(value,label){if(!value)throw new Error(label)}
function button(label){return [...document.querySelectorAll('button')].find(b=>b.textContent===label)}
function run(){try{
const base={id:'br-000000000001',title:'<img src=x onerror=alert(1)>',kind:'ae-batch',connection:'HRDMO',project:'ZZ_BR_PRJ',narrative:'Read the attached requirements.',
kinds:[{value:'ae-batch',label:'Batch App Engine',summary:'Read-only lab build'}],connections:['HRDMO'],status:'DRAFT',statusLabel:'Draft',approved:false,
approvalBlocker:'The agent has not proposed a spec yet.',attachments:[],questions:[],openQuestions:0,feedback:[],spec:null,approval:null,handoffs:[]};
receive(base);assert(!document.querySelector('img'),'title is text, not HTML');assert(button('Analyze with Claude Code'),'analyze action');
let narrative=document.querySelector('[data-fid=narrative]');narrative.focus();narrative.value='Unsaved requirement';narrative.dispatchEvent(new Event('input'));narrative.setSelectionRange(3,8);
receive({...base,title:'External title update'});narrative=document.querySelector('[data-fid=narrative]');assert(narrative.value==='Unsaved requirement','live state preserves draft');
assert(document.activeElement===narrative&&narrative.selectionStart===3&&narrative.selectionEnd===8,'focus and selection preserved');
narrative.dispatchEvent(new Event('change'));button('Analyze with Claude Code').click();
assert(messages.at(-2).type==='edit'&&messages.at(-2).edit.narrative==='Unsaved requirement'&&messages.at(-1).phase==='analyze','edit posted before handoff');
const picker=document.querySelector('select.agent');picker.value='codex';picker.dispatchEvent(new Event('change'));receive(base);
button('Analyze with Codex').click();assert(messages.at(-1).agent==='codex','chosen agent persists across updates');
const spec={revision:2,proposedAt:'2026-10-18T20:00:00Z',summary:'Create lab SQL',mappings:[],assumptions:[],testPlan:'Read back exact SQL.',stale:false,
objects:[{ref:'sql',kind:'SQL definition',name:'ZZ_BR_SQL',action:'create',purpose:'Acceptance',details:'SELECT 1 FROM PS_INSTALLATION',dependsOn:[],sources:['requirements.txt'],route:{route:'TOOLS',tools:['psft_save_text_definition']},progress:null}]};
const proposed={...base,status:'SPEC_PROPOSED',statusLabel:'Spec ready for review',spec,approvalBlocker:null,
attachments:[{id:'a-0000000001',name:'requirements.txt',size:100,extraction:'text',textLength:100}]};
receive(proposed);assert(document.body.textContent.includes('requirements.txt'),'attachment provenance visible');
button('View text').click();assert(messages.at(-1).attachmentId==='a-0000000001'&&messages.at(-1).asText,'attachment identity');
receive({...proposed,approvalBlocker:'Answer the open questions first.'});assert(button('Approve spec').disabled,'open questions block approval');
receive({...proposed,spec:{...spec,stale:true},approvalBlocker:'The request changed.'});assert(button('Approve spec').disabled&&document.body.textContent.includes('The request changed'),'stale spec visible and blocked');
receive(proposed);button('Approve spec').click();assert(messages.at(-1).type==='approve'&&messages.at(-1).specRevision===2,'approval names exact revision');
const approved={...proposed,status:'APPROVED',statusLabel:'Approved; ready to build',approved:true,approval:{at:'2026-10-18T20:01:00Z'}};
receive(approved);button('Build with Codex').click();assert(messages.at(-1).phase==='build'&&messages.at(-1).agent==='codex','build handoff');
const changeSetId='00000000-0000-4000-8000-000000000001';
receive({...approved,spec:{...spec,objects:spec.objects.map(o=>({...o,progress:{status:'STAGED',detail:'Awaiting developer review',at:'2026-10-18T20:02:00Z',changeSetId}}))}});
const open=[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Open Change Set'));open.click();assert(messages.at(-1).changeSetId===changeSetId,'staged progress opens exact review');
receive({...proposed,spec:{...spec,stale:true},approved:false,approvalBlocker:'Request changed.'});assert(!button('Build with Codex'),'withdrawn approval hides build action');
document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL';document.body.append(Object.assign(document.createElement('pre'),{textContent:error.stack}))}}
`;
writeFileSync('/tmp/psft-build-request-ui-check.html', `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--vscode-editor-background:#202020;--vscode-editor-foreground:#ddd;--vscode-input-background:#303030;--vscode-input-foreground:#eee;--vscode-button-background:#0862a3;--vscode-button-foreground:#fff;--vscode-font-family:Arial;--vscode-font-size:14px}
${readFileSync('media/buildRequest.css', 'utf8')}</style></head><body><div id="app"></div><script>${stub}</script><script>${readFileSync('media/buildRequest.js', 'utf8')}</script><script>run()</script></body></html>`);
