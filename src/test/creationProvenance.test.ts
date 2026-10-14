import {test} from 'node:test';
import assert from 'node:assert/strict';
import {creationKey,recordCreation,setCreationStore,witnessedCreation,type CreationReceipt} from '../providers/creationProvenance.js';
import {classifyOwnership,decideWrite} from '../model/ownership.js';
test('verified creation survives renewal but does not classify replaced definitions or another database as Custom',async()=>{
 const rows=new Map<string,CreationReceipt>();
 setCreationStore({find:async(scope,key)=>rows.get(creationKey(scope,key)),put:async r=>{rows.set(creationKey(r.scope,r.key),r);}});
 try{
  const key={type:2,parts:['OU_NEW']},stamp={version:2,operator:'JARED',updated:'2026-10-14 12:00:00.123456'};
  await recordCreation('HRDMO',key,stamp);
  const receipt=await witnessedCreation('HRDMO',key,stamp);assert(receipt);
  const classification=classifyOwnership({exists:true,operator:'JARED',studioCreation:{createdAt:receipt.createdAt}});
  assert.equal(classification.ownership,'CUSTOM');assert.equal(decideWrite(classification,'requireApproval').action,'allow');
  assert.equal(await witnessedCreation('other',key,stamp),undefined);
  assert.equal(await witnessedCreation('HRDMO',key,{...stamp,version:3}),undefined);
  assert.equal(await witnessedCreation('HRDMO',key,{...stamp,updated:'2026-10-14 12:00:00.654321'}),undefined);
  await recordCreation('HRDMO',key,{...stamp,version:3},receipt);
  assert.equal((await witnessedCreation('HRDMO',key,{...stamp,version:3}))?.createdAt,receipt.createdAt);
  assert.equal(classifyOwnership({exists:true,operator:'JARED',studioCreation:{createdAt:receipt.createdAt},baseline:{label:'vanilla',contains:true}}).ownership,'DELIVERED_MODIFIED');
  assert.equal(classifyOwnership({exists:true,operator:'JARED'}).ownership,'UNKNOWN');
 }finally{setCreationStore(undefined);}
});
