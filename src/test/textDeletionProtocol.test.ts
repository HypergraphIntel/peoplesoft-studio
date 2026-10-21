/** Native Windows App Designer evidence; future deletion writers must match these gates. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
interface Delta { database:string; peopleToolsRelease:string; nonLabRowsOmitted:boolean; markers:{before:{scn:string};after:{scn:string}};
    summary:{psversion:Record<string,{delta:number;after:number}>;pslock:Record<string,{delta:number}>;incomplete:unknown[]};
    watch:Record<string,{inserted:Record<string,string>[];deleted:Record<string,string>[];updated:unknown[]}>;otherTables:Record<string,unknown> }
function capture(name:string):Delta {
    const d=JSON.parse(readFileSync(path.resolve('tools/corpus/save-protocol/results',name,'delta.json'),'utf8')) as Delta;
    assert.equal(d.database,'HRDMO');assert.match(d.peopleToolsRelease,/^8\.62/);
    assert.ok(BigInt(d.markers.after.scn)>BigInt(d.markers.before.scn));
    assert.deepEqual(d.summary.incomplete,[]);assert.equal(d.nonLabRowsOmitted,true);assert.deepEqual(d.otherTables,{});
    return d;
}
function counters(d:Delta, names:string[]) {
    assert.deepEqual(Object.keys(d.summary.psversion).sort(),[...names,'SYS'].sort());
    assert.deepEqual(Object.keys(d.summary.pslock).sort(),[...names].sort());
    for(const n of [...names,'SYS'])assert.equal(d.summary.psversion[n].delta,1,n);
    for(const n of names)assert.equal(d.summary.pslock[n].delta,1,n);
}
for(const [kind,id,tables,cache] of [
    ['sql','DSQ7',['PSSQLDEFN','PSSQLDESCR','PSSQLTEXTDEFN','PSSQLHASH'],['SRM']],
    ['html','DHT7',['PSCONTDEFN','PSCONTENT'],['CRM']],
    ['css','DCS7',['PSSTYLSHEETDEFN','PSCONTDEFN','PSCONTENT'],['CRM','SSM']]
] as const) {
    test('native '+kind+' deletion removes only its complete text scope and writes calibrated tombstones/counters',()=>{
        const d=capture({sql:'td01-native-sql-delete',html:'td02-native-html-delete',css:'td03-native-css-delete'}[kind]);
        counters(d,[...cache]);const name='ZZ_PCODE_LAB_'+id;
        for(const table of tables){assert.equal(d.watch[table].deleted.length,1,table);assert.equal(d.watch[table].inserted.length,0,table);assert.equal(Object.values(d.watch[table].deleted[0]).includes(name),true,table);}
        if(kind==='sql')assert.deepEqual(d.watch.PSSQLDEL.inserted,[{SQLID:name,SQLTYPE:'0',VERSION:String(d.summary.psversion.SRM.after)}]);
        else assert.deepEqual(d.watch.PSCONTDEL.inserted,[{CONTNAME:name,CONTTYPE:kind==='html'?'4':'9',ALTCONTNUM:'1',VERSION:String(d.summary.psversion.CRM.after)}]);
        if(kind==='css')assert.deepEqual(d.watch.PSSTYLSHEETDEL.inserted,[{STYLESHEETNAME:name,VERSION:String(d.summary.psversion.SSM.after)}]);
    });
    test('native '+kind+' recreation clears matching tombstones and follows the native save counters',()=>{
        const d=capture({sql:'td04-native-sql-recreate',html:'td05-native-html-recreate',css:'td06-native-css-recreate'}[kind]);
        counters(d,kind==='css'?['SSM']:[...cache]);
        for(const table of tables){assert.equal(d.watch[table].inserted.length,1,table);assert.equal(d.watch[table].deleted.length,0,table);}
        for(const marker of kind==='sql'?['PSSQLDEL']:kind==='html'?['PSCONTDEL']:['PSCONTDEL','PSSTYLSHEETDEL']){assert.equal(d.watch[marker].deleted.length,1,marker);assert.equal(d.watch[marker].inserted.length,0,marker);}
        if(kind==='css'){assert.equal(d.watch.PSSTYLSHEETDEFN.inserted[0].STYLESHEETTYPE,'2');assert.equal(d.watch.PSCONTDEFN.inserted[0].CONTTYPE,'9');}
    });
}
