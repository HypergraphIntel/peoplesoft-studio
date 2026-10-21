/** Actual HRDMO Windows App Designer / Query captures, not simulated writer behavior. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
interface Delta {database:string;peopleToolsRelease:string;nonLabRowsOmitted:boolean;otherTables:Record<string,unknown>;markers:{before:{scn:string};after:{scn:string}};
 summary:{incomplete:unknown[];psversion:Record<string,{delta:number;after:number}>;pslock:Record<string,{delta:number}>};
 watch:Record<string,{inserted:Record<string,string>[];deleted:Record<string,string>[];updated:unknown[]}>}
const project='ZZ_PCODE_LAB_DPR8';
function capture(name:string,cache:string):Delta{
 const d=JSON.parse(readFileSync(path.resolve('tools/corpus/save-protocol/results',name,'delta.json'),'utf8')) as Delta;
 assert.equal(d.database,'HRDMO');assert.match(d.peopleToolsRelease,/^8\.62/);assert.equal(d.nonLabRowsOmitted,true);assert.deepEqual(d.otherTables,{});assert.deepEqual(d.summary.incomplete,[]);
 assert.ok(BigInt(d.markers.after.scn)>BigInt(d.markers.before.scn));
 for(const phase of ['before','after']){
  const s=JSON.parse(readFileSync(path.resolve('tools/corpus/save-protocol/results',name,phase+'.json'),'utf8'));
  const columns=s.watch.PSPROJECTDEFN.columns.map((c:{name:string})=>c.name);
  assert.ok(!columns.includes('TGTOPRID')&&!columns.includes('TGTOPRACCT'),'Project account columns must never be retained.');
 }
 assert.deepEqual(Object.keys(d.summary.psversion).sort(),[cache,'SYS'].sort());assert.deepEqual(Object.keys(d.summary.pslock),[cache]);
 for(const n of [cache,'SYS'])assert.equal(d.summary.psversion[n].delta,1);assert.equal(d.summary.pslock[cache].delta,1);
 return d;
}
function changed(d:Delta,tables:string[]){assert.deepEqual(Object.keys(d.watch).sort(),[...tables,'PSVERSION','PSLOCK'].sort());}
test('native project deletion removes only its header/members and writes the new PJM marker; contained Queries survive',()=>{
 const d=capture('qp01-native-project-delete','PJM');changed(d,['PSPROJECTDEFN','PSPROJECTITEM','PSPROJECTDEL']);
 assert.equal(d.watch.PSPROJECTDEFN.deleted.length,1);assert.equal(d.watch.PSPROJECTDEFN.deleted[0].PROJECTNAME,project);
 assert.equal(d.watch.PSPROJECTITEM.deleted.length,2);for(const r of d.watch.PSPROJECTITEM.deleted){assert.equal(r.PROJECTNAME,project);assert.equal(r.OBJECTTYPE,'10');}
 assert.deepEqual(d.watch.PSPROJECTDEL.inserted,[{PROJECTNAME:project,VERSION:String(d.summary.psversion.PJM.after)}]);
});
test('native project recreation clears its deletion marker and creates only a fresh header with calibrated counters',()=>{
 const d=capture('qp02-native-project-recreate','PJM');changed(d,['PSPROJECTDEFN','PSPROJECTDEL']);assert.equal(d.watch.PSPROJECTDEFN.inserted.length,1);
 assert.equal(d.watch.PSPROJECTDEFN.inserted[0].PROJECTNAME,project);assert.equal(d.watch.PSPROJECTDEFN.inserted[0].VERSION,String(d.summary.psversion.PJM.after));
 assert.equal(d.watch.PSPROJECTDEL.deleted.length,1);assert.equal(d.watch.PSPROJECTDEL.deleted[0].PROJECTNAME,project);
});
const all=['PSQRYDEFN','PSQRYSELECT','PSQRYRECORD','PSQRYFIELD','PSQRYCRITERIA','PSQRYEXPR','PSQRYBIND'];
for(const [owner,name,remove,restore,deletedTables] of [
 [' ','ZZ_PCODE_LAB_DQP8','qp03-native-public-query-delete','qp04-native-public-query-recreate',all.slice(0,4)],
 ['JARED','ZZ_PCODE_LAB_DQJ8','qp05-native-private-query-delete','qp06-native-private-query-recreate',all]
] as const){
 test('native '+(owner===' '?'public':'private')+' Query deletion removes its complete populated scope and writes an owner-specific QDM tombstone',()=>{
  const d=capture(remove,'QDM');changed(d,[...deletedTables,'PSQRYDEL']);
  for(const t of deletedTables){assert.equal(d.watch[t].deleted.length,1,t);assert.equal(d.watch[t].inserted.length,0,t);assert.equal(d.watch[t].deleted[0].QRYNAME,name);assert.equal(d.watch[t].deleted[0].OPRID,owner);}
  assert.deepEqual(d.watch.PSQRYDEL.inserted,[{OPRID:owner,QRYNAME:name,VERSION:String(d.summary.psversion.QDM.after)}]);
 });
 test('native '+(owner===' '?'public':'private')+' Query recreation clears only its marker and restores all seven table families',()=>{
  const d=capture(restore,'QDM');changed(d,[...all,'PSQRYDEL']);
  for(const t of all){assert.equal(d.watch[t].inserted.length,1,t);assert.equal(d.watch[t].deleted.length,0,t);assert.equal(d.watch[t].inserted[0].QRYNAME,name);assert.equal(d.watch[t].inserted[0].OPRID,owner);}
  assert.equal(d.watch.PSQRYDEFN.inserted[0].VERSION,String(d.summary.psversion.QDM.after));assert.equal(d.watch.PSQRYDEL.deleted.length,1);assert.equal(d.watch.PSQRYDEL.deleted[0].OPRID,owner);assert.equal(d.watch.PSQRYDEL.deleted[0].QRYNAME,name);
 });
}
