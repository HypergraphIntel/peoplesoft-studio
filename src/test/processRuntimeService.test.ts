import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {RuntimeStore} from '../processRuntime/store.js';
import {ProcessRuntimeService,type RuntimeHost} from '../processRuntime/service.js';
import type {ProcessRuntimeClient,RuntimeRun} from '../processRuntime/protocol.js';
const run:RuntimeRun={instance:42,process:'ZZ_RUNTIME',processType:'Application Engine',runControl:'ONCE',operator:'JARED',server:'PSUNX',runStatus:'Success',distributionStatus:'Posted',requested:'now',scheduled:'now',started:'now',ended:'now',contentIds:[100]};
async function setup(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'psft-runtime-test-'));const store=new RuntimeStore(directory);
 const state={token:'baseline',identity:'environment',posts:0,clock:1000,allow:true,lost:false};
 const client={discover:async()=>({}),processes:async()=>['ZZ_RUNTIME'],servers:async()=>['PSUNX'],schedule:async()=>{state.posts++;if(state.lost)throw Error('Lost reply');return 42;},get:async(instance:number)=>({...run,instance}),find:async()=>[{...run,instance:40},run],reports:async()=>[]} as unknown as ProcessRuntimeClient;
 const host:RuntimeHost={session:async()=>({endpoint:'https://example.com/PSIGW/PeopleSoftServiceListeningConnector',operator:'JARED',client,metadata:async()=>({endpoint:'',operatorId:'JARED',runControls:[]}),baseline:async()=>({token:state.token,identity:state.identity,description:'Runtime test',control:{id:'ONCE'},lastInstance:40}),assertCanSubmit:async()=>{if(!state.allow)throw Error('Readonly or dirty');}})};
 const service=new ProcessRuntimeService(store,host,()=>state.clock),prepare=()=>service.prepare('HRDMO',{process:'ZZ_RUNTIME',runControl:'ONCE',server:'PSUNX'});
 return {store,state,service,prepare,cleanup:()=>rm(directory,{recursive:true,force:true}),directory};
}
test('preparation is durable and native submission requires exact one-use confirmation',async()=>{const x=await setup();try{
 const p=await x.prepare();assert.equal(x.state.posts,0);assert.equal((await x.store.get(p.id)).state,'PREPARED');
 await assert.rejects(()=>x.service.submit(p.id,'stale',async()=>true),/stale/);assert.equal(x.state.posts,0);
 const done=await x.service.submit(p.id,p.confirmationHash,async view=>{assert.deepEqual(view.request,p.request);return true;});assert.equal(done.state,'SUBMITTED');assert.equal(done.instance,42);assert.equal(x.state.posts,1);
 await assert.rejects(()=>x.service.submit(p.id,p.confirmationHash,async()=>true),/already been used/);assert.equal(x.state.posts,1);
 const status=await x.service.status(p.id);assert.equal(status.run?.runStatus,'Success');
 assert.ok(!(await readFile(path.join(x.directory,p.id+'.json'),'utf8')).includes('password'));
}finally{await x.cleanup();}});
test('declined and expired confirmations never submit',async()=>{const x=await setup();try{
 const p=await x.prepare();assert.equal((await x.service.submit(p.id,p.confirmationHash,async()=>false)).state,'CANCELLED');
 const expired=await x.prepare();x.state.clock+=6*60000;await assert.rejects(()=>x.service.submit(expired.id,expired.confirmationHash,async()=>true),/expired/);
 const late=await x.prepare();await assert.rejects(()=>x.service.submit(late.id,late.confirmationHash,async()=>{x.state.clock+=6*60000;return true;}),/expired/);assert.equal(x.state.posts,0);
}finally{await x.cleanup();}});
test('changed native baseline and late dirty/readonly gates refuse after approval',async()=>{const x=await setup();try{
 const p=await x.prepare();await assert.rejects(()=>x.service.submit(p.id,p.confirmationHash,async()=>{x.state.token='external change';return true;}),/changed after preview/);assert.equal((await x.store.get(p.id)).state,'INVALIDATED');
 const q=await x.prepare();await assert.rejects(()=>x.service.submit(q.id,q.confirmationHash,async()=>{x.state.allow=false;return true;}),/Readonly or dirty/);assert.equal(x.state.posts,0);
}finally{await x.cleanup();}});
test('concurrent clicks cannot share confirmation or race a live runtime writer lock',async()=>{const x=await setup();try{
 const p=await x.prepare();let release!:()=>void,entered!:()=>void;const arrived=new Promise<void>(r=>entered=r),approval=new Promise<void>(r=>release=r);
 const first=x.service.submit(p.id,p.confirmationHash,async()=>{entered();await approval;return true;});await arrived;
 await assert.rejects(()=>x.service.submit(p.id,p.confirmationHash,async()=>true),/active/);release();await first;assert.equal(x.state.posts,1);
}finally{await x.cleanup();}});
test('lost response is durable UNCERTAIN; reopening never replays and reconciliation rejects old instances',async()=>{const x=await setup();try{
 const p=await x.prepare();x.state.lost=true;assert.equal((await x.service.submit(p.id,p.confirmationHash,async()=>true)).state,'UNCERTAIN');
 await assert.rejects(()=>x.service.submit(p.id,p.confirmationHash,async()=>true),/already been used/);assert.equal(x.state.posts,1);
 assert.deepEqual((await x.service.candidates(p.id)).map(r=>r.instance),[42]);await assert.rejects(()=>x.service.reconcile(p.id,40),/identity differs/);
 const done=await x.service.reconcile(p.id,42);assert.equal(done.state,'SUBMITTED');assert.equal(done.instance,42);assert.equal(x.state.posts,1);
}finally{await x.cleanup();}});
