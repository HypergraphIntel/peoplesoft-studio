import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ADAPTER_TYPES } from '../db/connection.js';
import { hash } from '../changeReview/model.js';
import { readIbLifecycle, writeIbLifecycle, previewIbLifecycleCreation, ibLifecycleInput, type IbLifecycleKey } from '../providers/ibLifecycle.js';
import { ibTransaction } from './fixtures/ibTransaction.js';

type Rows = Record<string, Record<string, unknown>[]>;
type Capture = {case:string;kind:'service'|'operation';name:string;service?:string;before:Rows;after:Rows;schema:Record<string,{name:string;dataType:string}[]>};
const captures:Capture[]=JSON.parse(readFileSync('src/test/fixtures/ib-native-8.62.09/rest-lifecycle.json','utf8'));
const keyOf=(c:Capture):IbLifecycleKey=>c.kind==='service'?{kind:'service',name:c.name}:{kind:'operation',name:c.name,service:c.service};
// A generated routing's name is random per save, natively and in the writer.
const normalize=(rows:Rows[string])=>rows.map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>k!=='LASTUPDDTTM').sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,k==='ROUTINGDEFNNAME'&&/^~GENERATED~/.test(String(v))?'~GENERATED~':v]))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
// Routing generation reads HRDMO's environment, which the captures do not: default local node, its gateway, the label.
const environment={PSMSGNODEDEFN:[{MSGNODENAME:'PSFT_HR',ACTIVE_NODE:1,LOCALDEFAULTFLG:'Y'}],PSGATEWAY:[{CONNGATEWAYID:'LOCAL',LOCAL_FLAG:'Y'}],PSMSGCATDEFN:[],PSIBSVCSETUP:[]};
const fixture=(c:Capture,rows:Rows)=>ibTransaction(c.kind,true,{name:c.name,schema:c.schema,nativeRows:{...rows,...environment,PSPROJECTITEM:[],PSPCMTXT:[],PSSQLTEXTDEFN:[],PSAPPCLASSDEFN:[{PACKAGEROOT:'PT_SES',QUALIFYPATH:':',APPCLASSID:'Init'}]}});

for(const capture of captures)test(capture.case+': typed REST lifecycle reproduces native rows, routing, markers and counters',async()=>{
    const k=keyOf(capture),f=fixture(capture,capture.before),target=fixture(capture,capture.after);
    const before=await readIbLifecycle(f.connection,ADAPTER_TYPES,k,true),after=await readIbLifecycle(target.connection,ADAPTER_TYPES,k,true);
    const request={...k,after:after.value,expectedSnapshotToken:before.token,expectedAfterHash:after.hash,operatorId:'JARED',allowDeletedBaseline:true};
    const initial=f.state();
    await writeIbLifecycle(f.connection,ADAPTER_TYPES,{...request,dryRun:true});
    assert.deepEqual(f.state(),initial,'rollback restores the complete native baseline');
    await writeIbLifecycle(f.connection,ADAPTER_TYPES,request);
    for(const [table,expected]of Object.entries(capture.after))assert.deepEqual(normalize(f.state()[table]),normalize(expected),table+' differs from native capture');
});

test('REST operation checkpoints carry routing content, not its random name, and support typed inverse/redo',async()=>{
    const capture=captures.find(c=>c.case.startsWith('ib13'))!,k=keyOf(capture),f=fixture(capture,capture.before);
    const original=await readIbLifecycle(f.connection,ADAPTER_TYPES,k,true);
    assert.ok(!JSON.stringify(original.value).match(/~GENERATED~[0-9]/),'logical checkpoint omits the generated routing name');
    assert.ok(JSON.stringify(original.value).includes('"routing"'));
    const write=async(after:typeof original.value)=>{const live=await readIbLifecycle(f.connection,ADAPTER_TYPES,k,true);return writeIbLifecycle(f.connection,ADAPTER_TYPES,{...k,after,operatorId:'JARED',expectedSnapshotToken:live.token,expectedAfterHash:hash(after),allowDeletedBaseline:true});};
    await write(null);
    const deleted=f.state();assert.equal(deleted.PSIBRTNGDEFNDEL.length,capture.before.PSIBRTNGDEFNDEL.length+1,'deletion writes the routing tombstone');
    await write(original.value);
    const restored=await readIbLifecycle(f.connection,ADAPTER_TYPES,k,true);
    assert.equal(restored.hash,original.hash,'recreation restores the logical checkpoint under a fresh routing name');
    assert.notEqual(restored.token,original.token,'the token binds the new routing name and the retained tombstone');
    assert.equal(f.state().PSIBRTNGDEFNDEL.length,deleted.PSIBRTNGDEFNDEL.length,'the old routing tombstone stays, as in ib14');
    await write(null);await write(original.value);assert.equal((await readIbLifecycle(f.connection,ADAPTER_TYPES,k,true)).hash,original.hash);
});

test('REST lifecycle creation preview matches the native checkpoint and restores counters',async()=>{
    for(const name of ['ib12','ib16']){
        const capture=captures.find(c=>c.case.startsWith(name))!,k=keyOf(capture),f=fixture(capture,capture.before),target=fixture(capture,capture.after);
        const after=await readIbLifecycle(target.connection,ADAPTER_TYPES,k),initial=f.state();
        const preview=await previewIbLifecycleCreation(f.connection,ADAPTER_TYPES,ibLifecycleInput(after.value,k),'JARED');
        assert.equal(preview.after.hash,after.hash,name+' preview reproduces the native checkpoint');
        assert.deepEqual(f.state(),initial,name+' preview rolls back rows and counters');
    }
});

test('REST lifecycle refuses credentials, extra routing rows, a foreign routing and standard operations with routings',async()=>{
    const capture=captures.find(c=>c.case.startsWith('ib13'))!,k=keyOf(capture);
    const routing=String(capture.before.PSIBRTNGDEFN.find(r=>r.IB_OPERATIONNAME===k.name)!.ROUTINGDEFNNAME);
    const variants:[string,(rows:Rows)=>void,RegExp][]=[
        ['credential',rows=>{rows.PSRTNGDFNPARM.find(r=>r.ROUTINGDEFNNAME===routing)!.IBEXTERNALPWD='secret';},/Credential-bearing routing/],
        ['manual routing',rows=>{rows.PSIBRTNGDEFN.find(r=>r.IB_OPERATIONNAME===k.name)!.ROUTINGDEFNNAME='ZZ_MANUAL';rows.PSOPRGENRTGPARM.find(r=>r.IB_OPERATIONNAME===k.name)!.ROUTINGDEFNNAME='ZZ_MANUAL';},/writer-generated routing/],
        ['second parameter',rows=>{rows.PSRTNGDFNPARM.push({...rows.PSRTNGDFNPARM.find(r=>r.ROUTINGDEFNNAME===routing)!,PARAMETERNAME:'EXTRA'});},/writer-generated routing/]
    ];
    for(const [label,mutate,error]of variants){
        const rows=structuredClone(capture.before);mutate(rows);
        const f=fixture(capture,rows);
        await assert.rejects((async()=>{const before=await readIbLifecycle(f.connection,ADAPTER_TYPES,k);await writeIbLifecycle(f.connection,ADAPTER_TYPES,{...k,after:null,expectedSnapshotToken:before.token,expectedAfterHash:hash(null),operatorId:'JARED'});})(),error,label);
    }
});
