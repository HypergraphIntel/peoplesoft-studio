import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ADAPTER_TYPES } from '../db/connection.js';
import { readIbLifecycle, writeIbLifecycle, previewIbLifecycleCreation, ibLifecycleInput, type IbLifecycleKey } from '../providers/ibLifecycle.js';
import { ibTransaction } from './fixtures/ibTransaction.js';

type Rows = Record<string, Record<string, unknown>[]>;
type Capture = {case:string;kind:'service'|'operation';before:Rows;after:Rows;schema:Record<string,{name:string;dataType:string}[]>};
const captures:Capture[]=JSON.parse(readFileSync('src/test/fixtures/ib-native-8.62.09/definition-lifecycle.json','utf8'));
const normalize=(rows:Rows[string])=>rows.map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>k!=='LASTUPDDTTM'))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
for(const capture of captures)test(capture.case+': typed lifecycle reproduces native rows, parent stamp, markers and counters',async()=>{
    const k:IbLifecycleKey=capture.kind==='service'?{kind:'service',name:'ZZ_PCODE_LAB_IBE'}:{kind:'operation',name:'ZZ_PCODE_LAB_IBO',service:'ZZ_PCODE_LAB_IBS'};
    const fixture=(nativeRows:Rows)=>ibTransaction(k.kind,true,{name:k.name,schema:capture.schema,nativeRows:{...nativeRows,PSPROJECTITEM:[],PSPCMTXT:[],PSSQLTEXTDEFN:[],PSAPPCLASSDEFN:[{PACKAGEROOT:'PT_IB_INTROSPECTION',QUALIFYPATH:':',APPCLASSID:'Introspection'}]}});
    const f=fixture(capture.before),target=fixture(capture.after);
    const before=await readIbLifecycle(f.connection,ADAPTER_TYPES,k,true),after=await readIbLifecycle(target.connection,ADAPTER_TYPES,k,true);
    const request={...k,after:after.value,expectedSnapshotToken:before.token,expectedAfterHash:after.hash,operatorId:'JARED',allowDeletedBaseline:true};
    const initial=f.state();
    await writeIbLifecycle(f.connection,ADAPTER_TYPES,{...request,dryRun:true});
    assert.deepEqual(f.state(),initial,'rollback restores the complete native baseline');
    await writeIbLifecycle(f.connection,ADAPTER_TYPES,request);
    for(const [table,expected]of Object.entries(capture.after))assert.deepEqual(normalize(f.state()[table]),normalize(expected),table+' differs from native capture');
});

for(const kind of ['service','operation'] as const)test(kind+': complete checkpoints support fresh typed inverse/redo and reject stale parent/marker tokens',async()=>{
    const capture=captures.find(c=>c.kind===kind&&c.case.includes('delete'))!;
    const k:IbLifecycleKey={kind,name:kind==='service'?'ZZ_PCODE_LAB_IBE':'ZZ_PCODE_LAB_IBO',...(kind==='operation'?{service:'ZZ_PCODE_LAB_IBS'}:{})};
    const f=ibTransaction(kind,true,{name:k.name,schema:capture.schema,nativeRows:{...capture.before,PSPROJECTITEM:[],PSPCMTXT:[],PSSQLTEXTDEFN:[],PSAPPCLASSDEFN:[{PACKAGEROOT:'PT_IB_INTROSPECTION',QUALIFYPATH:':',APPCLASSID:'Introspection'}]}});
    const original=await readIbLifecycle(f.connection,ADAPTER_TYPES,k,true);
    const write=async(after:typeof original.value,token?:string)=>{const live=await readIbLifecycle(f.connection,ADAPTER_TYPES,k,true);return writeIbLifecycle(f.connection,ADAPTER_TYPES,{...k,after,operatorId:'JARED',expectedSnapshotToken:token??live.token,expectedAfterHash:(await import('../changeReview/model.js')).hash(after),allowDeletedBaseline:true});};
    await write(null);const deleted=await readIbLifecycle(f.connection,ADAPTER_TYPES,k,true);
    await assert.rejects(readIbLifecycle(f.connection,ADAPTER_TYPES,k),/reviewed restoration/);
    await write(original.value);assert.equal((await readIbLifecycle(f.connection,ADAPTER_TYPES,k,true)).hash,original.hash);
    await write(null);assert.notEqual((await readIbLifecycle(f.connection,ADAPTER_TYPES,k,true)).token,deleted.token,'new deletion binds fresh native markers');
    await assert.rejects(write(original.value,deleted.token),/baseline changed/);
    await write(original.value);
    const live=await readIbLifecycle(f.connection,ADAPTER_TYPES,k,true);
    f.editCommitted(rows=>{rows.PSSERVICE.find(r=>r.IB_SERVICENAME===(k.service??k.name))!.VERSION=999;});
    await assert.rejects(write(null,live.token),/baseline changed/);
});

test('service deletion refuses credentials, source/project references, unsupported child rows, release and after-image mismatch',async()=>{
    const capture=captures[0],k:IbLifecycleKey={kind:'service',name:'ZZ_PCODE_LAB_IBE'};
    for(const issue of ['credentials','source','project','child','release','after']as const){
        const f=ibTransaction('service',true,{name:k.name,schema:capture.schema,release:issue==='release'?'8.61.15':'8.62.09',nativeRows:{...capture.before,PSPROJECTITEM:[],PSPCMTXT:[],PSSQLTEXTDEFN:[]}});
        if(issue==='release'){await assert.rejects(readIbLifecycle(f.connection,ADAPTER_TYPES,k),/8.62.09/);continue;}
        f.editCommitted(rows=>{
            if(issue==='credentials')rows.PSSERVICE.find(r=>r.IB_SERVICENAME===k.name)!.IBEXTERNALPWD='never-selected';
            if(issue==='source')rows.PSPCMTXT.push({PCTEXT:'Service.'+k.name});
            if(issue==='project')rows.PSPROJECTITEM.push({OBJECTTYPE:79,OBJECTVALUE1:k.name});
            if(issue==='child')rows.PSSERVICEUDDI.push({IB_SERVICENAME:k.name});
        });
        const initial=f.state();
        await assert.rejects((async()=>{const before=await readIbLifecycle(f.connection,ADAPTER_TYPES,k);assert.ok(!JSON.stringify(before).includes('never-selected'));await writeIbLifecycle(f.connection,ADAPTER_TYPES,{...k,after:null,expectedSnapshotToken:before.token,expectedAfterHash:issue==='after'?'wrong':(await import('../changeReview/model.js')).hash(null),operatorId:'JARED'});})(),/credential|source|project|wider|after-image/i);
        assert.deepEqual(f.state(),initial);assert.equal(f.counts().commits,0);
    }
});

test('fresh native typed creation preview includes complete defaults and restores counters under rollback',async()=>{
    const capture=captures[1],k:IbLifecycleKey={kind:'service',name:'ZZ_PCODE_LAB_IBE'};
    const nativeRows=structuredClone(capture.before);nativeRows.PSSERVICEDEL=[];
    const f=ibTransaction('service',true,{name:k.name,schema:capture.schema,nativeRows});
    const target=ibTransaction('service',true,{name:k.name,schema:capture.schema,nativeRows:capture.after});
    const after=await readIbLifecycle(target.connection,ADAPTER_TYPES,k),initial=f.state();
    const preview=await previewIbLifecycleCreation(f.connection,ADAPTER_TYPES,ibLifecycleInput(after.value,k),'JARED');
    assert.equal(preview.before.value,null);assert.equal(preview.after.hash,after.hash);assert.deepEqual(f.state(),initial);
});
