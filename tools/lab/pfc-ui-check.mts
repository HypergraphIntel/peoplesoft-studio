import { writeFileSync } from 'node:fs';
import { pfcHtml } from '../../src/editors/pfcHtml.js';
const stub = `
const messages=[];window.acquireVsCodeApi=()=>({postMessage(m){messages.push(m);if(m.type==='ready')setTimeout(run,0)}});
function receive(data){window.dispatchEvent(new MessageEvent('message',{data}))}
function assert(v,label){if(!v)throw new Error(label)}
function run(){try{
const $=id=>document.getElementById(id);
const state={type:'state',component:'JOB',market:'GBL',connection:'Fixture',editable:true,dirty:false,configType:'STD',configuration:{header:{DESCR:'<Config>'},sequences:[{EOCC_SEQUENCE_NBR:1,SEQUENCE_NBR:1}],criteria:[{EOCC_SEQUENCE_NBR:1}],pages:[],fields:[]},contentReferences:[{cref:'JOB',mappingRows:3,inSync:true}],fields:[{index:0,sequence:1,name:'REC.FIELD',label:'<Field>',page:'PAGE',settings:'required',blank:false}],message:'',
headerLevel:true,headerTarget:'everyone',sequenceTargets:['everyone'],pageRules:[[]],criteriaRows:[{index:0,sequence:1,text:'<Criterion>'}]};
receive(state);assert($('sequences').querySelectorAll('tbody tr').length===1,'field rendered');assert($('description').textContent==='<Config>'&&!document.querySelector('config'),'safe text');assert($('save').disabled,'unchanged save disabled');
receive({...state,dirty:true});assert(!$('save').disabled,'dirty save enabled');$('preview').click();assert(messages.at(-1).type==='preview'&&$('kind').disabled,'preview busy');
receive({...state,dirty:true,message:'Error: conflict'});assert(!$('save').disabled&&$('notice').textContent==='Error: conflict','error preserves draft');
$('sequences').querySelector('tbody button').click();assert(messages.at(-1).type==='editField'&&messages.at(-1).index===0,'field identity');
receive({...state,editable:false});assert($('sequences').querySelector('button').disabled&&$('header').disabled&&!$('kind').disabled,'read only');
$('kind').value='MASK';$('kind').dispatchEvent(new Event('change'));assert(messages.at(-1).type==='switch'&&messages.at(-1).configType==='MASK','mask switch');
receive({...state,configuration:{...state.configuration,sequences:[]},contentReferences:[]});assert($('sequences').textContent.includes('Add a sequence')&&$('mapping').textContent.includes('No registered'),'empty state');
receive({...state,exists:true,mapsOnSave:true});assert($('map').hidden,'8.62: the save maps, no map action');
receive({...state,exists:true,mapsOnSave:false,contentReferences:[{cref:'JOB',mappingRows:0,inSync:false}]});assert(!$('map').hidden&&!$('map').disabled&&$('mapping').textContent.includes('not mapped')&&$('intro').textContent.includes('does not map'),'8.61: map action offered');
$('map').click();assert(messages.at(-1).type==='map','map message');
receive({...state,exists:true,mapsOnSave:false,dirty:true});assert($('map').disabled,'unsaved changes: save before mapping');
receive({...state,exists:false,mapsOnSave:false});assert($('map').hidden,'nothing saved to map');
receive(state);document.body.dataset.testResult='PASS';
}catch(e){document.body.dataset.testResult='FAIL';document.body.append(Object.assign(document.createElement('p'),{textContent:e.message}))}}
`;
writeFileSync('/tmp/psft-pfc-ui-check.html',pfcHtml('uitest').replace('<script nonce="uitest">','<script nonce="uitest">'+stub+'</script><script nonce="uitest">'));
