import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTER_TYPES,type DbConnection } from '../db/connection.js';
import { readTextDefinitionState,textDefinitionData,type TextDefinitionKind } from '../providers/textDefinitionWriter.js';
function fixture(kind:TextDefinitionKind){
    const rows:Record<string,Record<string,unknown>[]>={PSSQLDEL:kind==='sql'?[{SQLID:'ZZ_TEXT',SQLTYPE:'0',VERSION:10}]:[],PSCONTDEL:kind==='sql'?[]:[{CONTNAME:'ZZ_TEXT',CONTTYPE:kind==='html'?4:9,ALTCONTNUM:1,VERSION:11}],PSSTYLSHEETDEL:kind==='stylesheet'?[{STYLESHEETNAME:'ZZ_TEXT',VERSION:12}]:[]};
    const counts:Record<string,number>={};
    const c={execute:async(sql:string)=>{assert.ok(sql.startsWith('SELECT'),'A snapshot must never mutate.');const table=/FROM (\w+)/.exec(sql)![1];return {rows:sql.includes('COUNT(*)')?[{N:sql.includes("SQLTYPE<>'0'")?counts[table+':other']??0:counts[table]??0}]:structuredClone(rows[table]??[])};}} as unknown as DbConnection;
    return {rows,counts,c};
}
test('complete text payloads preserve SQL metadata and reject lossy, forged or noncanonical proposals',()=>{
    const sql={name:'ZZ_TEXT',text:'SELECT 1 FROM DUAL',description:' Leading text',definition:'é😀'.repeat(6000),ownerId:' PPT'};
    assert.deepEqual(textDefinitionData('sql','ZZ_TEXT',sql),sql);
    for(const value of [{text:sql.text},{...sql,name:'OTHER'},{...sql,extra:true},{...sql,text:'SELECT 1\nFROM DUAL'},{...sql,ownerId:'TOOLONG'}])assert.throws(()=>textDefinitionData('sql','ZZ_TEXT',value));
    const html={name:'ZZ_TEXT',text:'<div>é😀</div>\r\n',description:'HTML'};
    assert.deepEqual(textDefinitionData('html','ZZ_TEXT',html),html);
    for(const value of [{...html,text:'x\0'},{...html,description:' leading'},{...html,text:'x\ny'},{...html,ownerId:'PPT'}])assert.throws(()=>textDefinitionData('html','ZZ_TEXT',value));
});
for(const kind of ['sql','html','stylesheet'] as const){
    test(kind+' deleted checkpoints require explicit restoration and fingerprint every native marker',async()=>{
        const f=fixture(kind);await assert.rejects(readTextDefinitionState(f.c,ADAPTER_TYPES,kind,'ZZ_TEXT'),/explicit reviewed restoration/);
        const a=await readTextDefinitionState(f.c,ADAPTER_TYPES,kind,'ZZ_TEXT',true);assert.equal(a.value,null);assert.equal(a.deleted,true);
        const rows=kind==='sql'?f.rows.PSSQLDEL:f.rows.PSCONTDEL;rows[0].VERSION=100;
        const b=await readTextDefinitionState(f.c,ADAPTER_TYPES,kind,'ZZ_TEXT',true);assert.notEqual(a.token,b.token);
        f.counts[kind==='sql'?'PSSQLDEFN':'PSCONTDEFN']=1;
        await assert.rejects(readTextDefinitionState(f.c,ADAPTER_TYPES,kind,'ZZ_TEXT',true),/mixed live\/deleted/);
    });
}
test('wrong SQL types, alternate content, missing paired CSS markers and orphan translations are never absence',async()=>{
    const sql=fixture('sql');sql.rows.PSSQLDEL[0].SQLTYPE='2';await assert.rejects(readTextDefinitionState(sql.c,ADAPTER_TYPES,'sql','ZZ_TEXT',true),/Uncalibrated SQL/);
    const other=fixture('sql');other.counts['PSSQLTEXTDEFN:other']=1;await assert.rejects(readTextDefinitionState(other.c,ADAPTER_TYPES,'sql','ZZ_TEXT',true),/another SQL type/);
    const html=fixture('html');html.rows.PSCONTDEL[0].ALTCONTNUM=2;await assert.rejects(readTextDefinitionState(html.c,ADAPTER_TYPES,'html','ZZ_TEXT',true),/Uncalibrated content/);
    const css=fixture('stylesheet');css.rows.PSSTYLSHEETDEL=[];await assert.rejects(readTextDefinitionState(css.c,ADAPTER_TYPES,'stylesheet','ZZ_TEXT',true),/Uncalibrated content/);
    const lang=fixture('stylesheet');lang.counts.PSSTYLEDFNLANG=1;await assert.rejects(readTextDefinitionState(lang.c,ADAPTER_TYPES,'stylesheet','ZZ_TEXT',true),/translations/);
});
