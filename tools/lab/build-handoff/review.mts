/** Independent review of staged synthetic creation before the delegated UI approval. No writes. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {hash,planHash,approvalHash} from '../../../src/changeReview/model.js';
import {creationRecordEdit,creationAeDocument} from '../../../src/changeReview/structuredCreation.js';
import {projectCreationItems} from '../../../src/providers/projectSnapshot.js';
import {projectItemIdentity} from '../../../src/model/projectItems.js';
import {prepareSqlText} from '../../../src/providers/sqlWriter.js';
import {diffSpec} from '../../../src/model/aeSpec.js';
import {sample} from '../request-file/sample.mjs';
const agent=process.argv[2];assert.ok(['codex','claude'].includes(agent));
const prepared=JSON.parse(await readFile('/tmp/psft-build-handoff-acceptance.json','utf8')),entry=prepared.requests.find((r:any)=>r.agent===agent);
const info=JSON.parse(await readFile('/tmp/psft-build-handoff-control.json','utf8'));
let seq=0;async function read(name:string,args:object){assert.ok(['psft_build_request_get','psft_get_change_set','psft_get_object_diff'].includes(name));const r=await fetch(info.mcpUrl,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method:'tools/call',params:{name,arguments:args}})});const t=await r.text(),b=JSON.parse(t.startsWith('{')?t:t.split('\n').find(l=>l.startsWith('data:'))!.slice(5));assert.ok(!b.error&&!b.result?.isError,b.error?.message??b.result?.content?.[0]?.text);return JSON.parse(b.result.content[0].text);}
const request=await read('psft_build_request_get',{id:entry.requestId});assert.equal(request.buildAuthorized,true);assert.equal(request.spec.hash,entry.specHash);
const ids=[...new Set(request.spec.objects.filter((o:any)=>['state','rows','export','project'].includes(o.ref)).map((o:any)=>o.progress.changeSetId))];assert.equal(ids.length,1);assert.equal(typeof ids[0],'string');
const set=await read('psft_get_change_set',{changeSetId:ids[0]});assert.equal(set.requestKey,entry.requestId);assert.equal(set.environment.connection,'oracle:HRDMO');assert.ok(['READY_FOR_REVIEW','APPLIED'].includes(set.status));assert.equal(set.plan.review,'APPROVED');assert.equal(set.plan.approvedHash,planHash(set));
const fixture=await sample(),prefix=entry.prefix,replace=(s:string)=>s.replaceAll('ZZ_RF_',prefix);
assert.deepEqual(set.objects.map((o:any)=>[o.adapter,o.key]),[['record-create',prefix+'AET'],['sql',prefix+'ROWS'],['ae-create',entry.program],['project-create',entry.project]]);
const reviewed=[];for(const o of set.objects){assert.equal(o.operation,'CREATE');assert.equal(o.application,set.status==='APPLIED'?'VERIFIED':'PENDING');assert.equal(o.review,set.status==='APPLIED'?'APPROVED':'PENDING');if(set.status==='APPLIED')assert.equal(o.approvedHash,approvalHash(set,o));assert.deepEqual(o.validation,[]);assert.equal(o.before,hash(null));const diff=await read('psft_get_object_diff',{changeSetId:set.id,objectId:o.id});assert.equal(diff.before,null);assert.equal(hash(diff.after),o.after);
 if(o.adapter==='record-create'){const edit=creationRecordEdit(diff.after,o.key);assert.equal(edit.recordType,2);assert.deepEqual(edit.fields.map(f=>f.name),['PROCESS_INSTANCE','DESCR']);assert.ok(edit.fields.every(f=>!f.isSubrecord&&!(f.useEdit&1)));}
 else if(o.adapter==='sql')assert.equal(diff.after.text,prepareSqlText(replace(fixture.sql)));
 else if(o.adapter==='ae-create')assert.deepEqual(diffSpec(creationAeDocument(diff.after,o.key),JSON.parse(replace(JSON.stringify(fixture.ae)))),[]);
 else{const expected=[{type:0,parts:[prefix+'AET']},{type:30,parts:[prefix+'ROWS','0']},{type:33,parts:[entry.program]},{type:34,parts:[entry.program,'MAIN']},{type:43,parts:[entry.program,'MAIN','GBL','default','1900-01-01','Export','OnExecute']}];assert.deepEqual(projectCreationItems(diff.after,entry.project).map(projectItemIdentity).sort(),expected.map(projectItemIdentity).sort());}
 reviewed.push({id:o.id,adapter:o.adapter,key:o.key,after:o.after,baseline:o.baselineToken});}
assert.deepEqual(set.objects[2].dependencies,[set.objects[0].id,set.objects[1].id]);assert.ok(set.objects[3].dependencies.includes(set.objects[2].id));
const report={reviewedAt:new Date().toISOString(),phase:set.status==='APPLIED'?'Independent audit after delegated UI application':'Independent review before delegated UI application',agent,requestId:entry.requestId,approvedSpecHash:entry.specHash,changeSetId:set.id,revision:set.revision,planApproved:true,objects:reviewed,passed:true};const file=`tools/lab/results/build-handoff-${agent}-${set.status==='APPLIED'?'applied-audit':'review'}-2026-10-20.json`;await writeFile(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({agent,phase:report.phase,passed:true,objects:reviewed.length,changeSetId:set.id}));
