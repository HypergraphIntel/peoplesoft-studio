import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateSync,inflateSync} from 'node:zlib';
import {buildStringDocument,flatStringElements} from '../model/ibDocumentSchema.js';
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
