import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateSync,inflateSync} from 'node:zlib';
import {buildStringDocument,flatStringElements,ibDocumentProfile} from '../model/ibDocumentSchema.js';
import {ibDeflate} from '../providers/ibWriter.js';
const evidence=JSON.parse(readFileSync('src/test/fixtures/ib-native-8.62.09/documents.json','utf8'));
for(const sample of evidence.samples)test('native PIA schema package exact: '+sample.nativeSave,()=>{
 const predicted=buildStringDocument(sample.key,sample.elements,sample.namespace,sample.language);
 assert.deepEqual(predicted,sample.schema);
 assert.equal(inflateSync(Buffer.from(sample.logicalCompressedBase64,'base64')).toString(), predicted.logicalSchema);
 assert.equal(inflateSync(deflateSync(Buffer.from(predicted.logicalSchema))).toString(),predicted.logicalSchema);
 assert.deepEqual(flatStringElements(predicted.logicalSchema),sample.elements);
});
test('no guessed document ABI for compound or different primitive shapes',()=>{
 const xml=evidence.samples[0].schema.logicalSchema;
 assert.equal(flatStringElements(xml.replace('<m_eType>3</m_eType>','<m_eType>4</m_eType>')),undefined);
 assert.equal(flatStringElements(xml.replace('<m_bIsCompound>0</m_bIsCompound>','<m_bIsCompound>1</m_bIsCompound>')),undefined);
 assert.throws(()=>buildStringDocument(['P','XMLBad','V1'],[{name:'v',length:10,required:false}],'urn:test','ENG'));
});
test('the JSON schema id is the REST Target Location at save time; 8.61 has no blank-element filter',()=>{
 // PeopleTools 8.61.15 PIA, REST Target Location set: the $id is that URL and the key, and
 // the JSON physical schema has no m_bFilterBlankElements. Every saved document on an 8.61
 // and an 8.62 database follows the target location it was saved under (ORACLE_ENDPOINT when blank).
 const sample=evidence.samples[0];
 const at='http://gateway.example:8000/PSIGW/RESTListeningConnector/PSFT_HR';
 const old=buildStringDocument(sample.key,sample.elements,sample.namespace,sample.language,ibDocumentProfile('8.61',at));
 assert.match(old.jsonSchema,/"\$id":"http:\/\/gateway\.example:8000\/PSIGW\/RESTListeningConnector\/PSFT_HR\/ZZ_IB_PACKAGE\.IBDocument\.V1\.json"/);
 const json=old.physicalSchemas.find(p=>p.name==='JSON')!.xml;
 assert.ok(!json.includes('m_bFilterBlankElements'));
 assert.equal(json,sample.schema.physicalSchemas.find((p:{name:string})=>p.name==='JSON').xml.replace('<m_bFilterBlankElements>1</m_bFilterBlankElements>',''));
 // Everything else is the 8.62.09 package.
 assert.equal(old.logicalSchema,sample.schema.logicalSchema);
 assert.equal(old.xmlSchema,sample.schema.xmlSchema);
 assert.deepEqual(old.physicalSchemas.filter(p=>p.name!=='JSON'),sample.schema.physicalSchemas.filter((p:{name:string})=>p.name!=='JSON'));
 // 8.62 with a REST Target Location keeps the filter and takes the location.
 const current=buildStringDocument(sample.key,sample.elements,sample.namespace,sample.language,ibDocumentProfile('8.62',at+'/'));
 assert.match(current.jsonSchema,/PSFT_HR\/ZZ_IB_PACKAGE\.IBDocument\.V1\.json/);
 assert.ok(current.physicalSchemas.find(p=>p.name==='JSON')!.xml.includes('<m_bFilterBlankElements>1</m_bFilterBlankElements>'));
 assert.deepEqual(buildStringDocument(sample.key,sample.elements,sample.namespace,sample.language,ibDocumentProfile('8.62','  ')),sample.schema);
});
test('document bodies compress to the bytes PIA stores',()=>{
 // PIA uses reference zlib, level 6; Node's zlib gives other bytes for the same text.
 for(const sample of evidence.samples){
  const native=Buffer.from(sample.logicalCompressedBase64,'base64');
  assert.ok(ibDeflate(Buffer.from(sample.schema.logicalSchema,'utf8')).equals(native),sample.nativeSave);
 }
});
