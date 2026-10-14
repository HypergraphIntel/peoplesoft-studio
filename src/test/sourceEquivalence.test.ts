import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sameLexicalSource} from '../peoplecode/writeback/sourceEquivalence.js';
import {compileForSave,prepareSourceForSave} from '../peoplecode/writeback/savePlan.js';
test('AE quote and statement formatting is accepted only with full lexical equality and exact compiled roundtrip',()=>{
 const target={applicationClass:false,recordName:'',fieldName:''};
 for(const source of ['Local string &x; &x = \'Y\';','If True Then ZZ_TEST_AET.IF_FLAG = "Y"; End-If;']){
  assert.doesNotThrow(()=>compileForSave(prepareSourceForSave(source),target,'8.62'));
 }
 assert(sameLexicalSource("&x = 'O''Brien';",'&x = "O\'Brien";'));
 assert(!sameLexicalSource('&x = "Y";','&x = "y";'));
 assert(!sameLexicalSource('&x = 1.0;','&x = 1;'));
 assert(!sameLexicalSource('/* keep */ &x = 1;','/* lost */ &x = 1;'));
 assert(!sameLexicalSource('If True Then &x = 1; End-If;','&x = 1;'));
 assert(!sameLexicalSource('rem disabled;',''));
 assert(!sameLexicalSource('&x = @;','&x = 1;'));
});

test('single-quote/same-line AE source produces exactly the native PeopleTools 8.62.09 program and names',async()=>{
 const {readFileSync}=await import('node:fs');
 const capture=JSON.parse(readFileSync('src/test/fixtures/ae-compiler-format.json','utf8'));
 const compiled=compileForSave(prepareSourceForSave(capture.requestedSource),{applicationClass:false,recordName:'',fieldName:''},'8.62');
 assert.deepEqual(compiled.program,Buffer.from(capture.programHex,'hex'));
 assert.equal(compiled.names.length,capture.names.length);
 for(const [i,row] of compiled.names.entries()){
  const native=capture.names[i];
  assert.equal(row.namenum,Number(native.NAMENUM));
  assert.equal(row.recname,native.RECNAME);assert.equal(row.refname,native.REFNAME);
 }
});
