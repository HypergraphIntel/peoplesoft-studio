import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ibDocument,ibIdentity,ibServiceClassification,validateIbDocument} from '../model/ibDocument.js';
import {renderOperation,renderService} from '../model/ibDefinitions.js';
import {ibHtml} from '../editors/ibHtml.js';

test('native numeric flags separate standard services, REST consumers and REST providers',()=>{
 assert.deepEqual(ibServiceClassification(0),{serviceKind:'standard'});
 assert.deepEqual(ibServiceClassification(1),{serviceKind:'rest',restRole:'consumer'});
 assert.deepEqual(ibServiceClassification('2'),{serviceKind:'rest',restRole:'provider'});
 for(const flag of [undefined,null,'','Y',3])assert.deepEqual(ibServiceClassification(flag),{serviceKind:'unknown'});
 const standard=ibDocument('operation',['OP'],{IB_REST_SERVICE:0,IB_RESTMETHOD:'GET',IB_SERVICENAME:'SVC'},{service:[{IB_REST_SERVICE:0}]});
 assert.equal(standard.serviceKind,'standard');assert.equal(standard.restRole,undefined);
 assert.ok(validateIbDocument(standard).some(d=>d.path==='IB_RESTMETHOD'&&d.severity==='warning'));
});
test('REST operation inherits owning service kind, and disagreement is an error',()=>{
 const doc=ibDocument('operation',['OP'],{IB_REST_SERVICE:1,IB_RESTMETHOD:'GET',RTNGTYPE:'S',DEFAULTVER:'v1'}, {service:[{IB_REST_SERVICE:2}],versions:[{VERSIONNAME:'v1'}]});
 assert.equal(doc.serviceKind,'rest');assert.equal(doc.restRole,'provider');
 assert.ok(validateIbDocument(doc).some(d=>d.path==='IB_REST_SERVICE'&&d.severity==='error'));
 const missing=ibDocument('operation',['OP'],{IB_REST_SERVICE:2,IB_RESTMETHOD:'GET'},{});
 assert.equal(missing.serviceKind,'unknown');assert.ok(validateIbDocument(missing).some(d=>d.path==='IB_SERVICENAME'));
});
test('default versions and native notify handler sequence constraints are validated',()=>{
 const doc=ibDocument('operation',['OP'],{IB_REST_SERVICE:0,DEFAULTVER:'missing'}, {service:[{IB_REST_SERVICE:0}],versions:[{VERSIONNAME:'v1'}],parameters:[{VERSIONNAME:'v2'}],handlers:[{HANDLERID:'NOTF',SEQNO:0},{HANDLERID:'NOTF',SEQNO:1}]});
 assert.deepEqual(validateIbDocument(doc).map(d=>d.path),['DEFAULTVER','parameters[0].VERSIONNAME','handlers.SEQNO']);
});
test('documents have three-part identities, routings include a valid effective date',()=>{
 assert.throws(()=>ibIdentity('document',['NAME']));
 assert.throws(()=>ibIdentity('routing',['R','2026-02-30']));
 assert.throws(()=>ibIdentity('routing',['R','2026-10-14 OR 1=1']));
 assert.doesNotThrow(()=>ibIdentity('document',['PACKAGE','DOCUMENT','v1']));
 assert.doesNotThrow(()=>ibIdentity('routing',['R','2026-10-14']));
});
test('existing text views show numeric REST kinds and suppress standard-operation REST methods',()=>{
 const translates=new Map();
 assert.match(renderService('SVC',{service:{IB_REST_SERVICE:1},operations:[],translates}),/Service kind: rest \(consumer\)/);
 const view={operation:{IB_RESTMETHOD:'GET'},versions:[],parameters:[],handlers:[],routings:[],translates};
 assert.doesNotMatch(renderOperation('OP',{...view,service:{IB_REST_SERVICE:0}}),/REST method/);
 assert.match(renderOperation('OP',{...view,service:{IB_REST_SERVICE:2}}),/REST method: GET/);
});
test('IB webview escapes database connection names and uses CSP and textContent',()=>{
 const html=ibHtml('service','<script>alert(1)</script>','nonce123');
 assert.ok(!html.includes('<script>alert(1)</script>'));assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(html.includes("script-src 'nonce-nonce123'"));assert.ok(html.includes('textContent='));
 assert.ok(html.includes('Standard'));assert.ok(html.includes('Consumer'));assert.ok(html.includes('Provider'));
});

test('all six IB editors offer create, preview and save with valid scripts',()=>{
 for(const kind of ['message','document','service','operation','node','routing'] as const){
  const html=ibHtml(kind,'HRDMO','testnonce');
  assert.match(html,/New definition/);assert.match(html,/Preview changes/);assert.match(html,/type:'save'/);
  const script=html.match(/<script nonce="testnonce">([\s\S]*?)<\/script>/)![1];assert.doesNotThrow(()=>new Function(script));
 }
});
