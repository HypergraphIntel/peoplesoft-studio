import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyQueryOp, newQueryDocument, copyQueryDocument, parseQueryOp, type QueryFieldInfo, type QueryOp } from '../model/queryDocument.js';
import { canonicalQueryRows, planQuerySave, QUERY_TABLES, queryRows, type QueryTable } from '../model/querySavePlan.js';
import type { QueryView, Row } from '../model/queryDefinition.js';

const metadata: Record<string,QueryFieldInfo>={
  ESTABID:{type:0,length:12,decimalPositions:0,format:0,shortName:'Estab ID',longName:'Establishment ID',editTable:'ESTAB_TBL',useEdit:16384},
  DESCR:{type:0,length:30,decimalPositions:0,format:6,shortName:'Descr',longName:'Description',editTable:'',useEdit:0}
};
function viewOf(t: Record<string,Row[]>): QueryView {
  return {query:t.PSQRYDEFN[0],selects:t.PSQRYSELECT,records:t.PSQRYRECORD,fields:t.PSQRYFIELD,criteria:t.PSQRYCRITERIA ?? [],expressions:t.PSQRYEXPR ?? [],binds:t.PSQRYBIND ?? []};
}
function snapshot(name: string, phase: string): QueryView {
  return viewOf(JSON.parse(readFileSync(`src/test/fixtures/query/${name}-${phase}.json`,'utf8')).tables);
}
function stampAndCompare(source: QueryView, expected: QueryView, stored?: QueryView): void {
  const actual=planQuerySave(source,{version:Number(expected.query.VERSION),operator:String(expected.query.LASTUPDOPRID),
    updatedAt:String(expected.query.LASTUPDDTTM),createdAt:String(expected.query.CREATEDTTM)},stored);
  for (const table of Object.keys(QUERY_TABLES) as QueryTable[]) {
    assert.equal(canonicalQueryRows(queryRows(actual,table)),canonicalQueryRows(queryRows(expected,table)),table);
  }
}

test('new query row plan reproduces the native first-save capture, every column', () => {
  const cap=JSON.parse(readFileSync('src/test/fixtures/query/qry01-create.json','utf8'));
  const expected=viewOf(Object.fromEntries(Object.entries(cap.otherTables).map(([table,d])=>[table,(d as {inserted:Row[]}).inserted])));
  let view=newQueryDocument('ZZ_QRY_LAB01','JARED','AAP_TBL');
  view=applyQueryOp(view,{kind:'select',field:'ESTABID',selected:true},metadata);
  view=applyQueryOp(view,{kind:'constant',field:'ESTABID',value:''},metadata);
  stampAndCompare(view,expected);
});

test('captured heading change is reproduced without mutating the source document', () => {
  const cap=JSON.parse(readFileSync('src/test/fixtures/query/qry02-heading.json','utf8'));
  const tables=(phase:'deleted'|'inserted')=>viewOf(Object.fromEntries(Object.entries(cap.otherTables).map(([table,d])=>[table,(d as Record<string,Row[]>)[phase]])));
  const before=tables('deleted');
  const original=JSON.stringify(before);
  stampAndCompare(applyQueryOp(before,{kind:'heading',field:'ESTABID',mode:'text',text:'Lab Establishment'},metadata),tables('inserted'),before);
  assert.equal(JSON.stringify(before),original);
});

test('native property and structure captures replay exactly as query document operations', () => {
  const cases: Array<[string,QueryOp]>=[
    ['qry03-order',{kind:'order',field:'ESTABID',position:1,descending:true}],
    ['qry08-prompt',{kind:'prompt',field:'ESTABID'}],
    ['qry09-add-field',{kind:'select',field:'DESCR',selected:true}],
    ['qry10-no-criteria',{kind:'clearCriteria'}],
    ['qry12-unselect-first',{kind:'select',field:'ESTABID',selected:false}],
    ['qry13-text-prompt',{kind:'prompt',field:'DESCR'}],
    ['qry14-properties-saved',{kind:'properties',description:'Query lab description',comments:'Definition lab comments'}]
  ];
  for (const [name,op] of cases) {
    const before=snapshot(name,'before');
    stampAndCompare(applyQueryOp(before,op,metadata),snapshot(name,'after'),before);
  }
});

test('public Save As resets the key and creation stamps as the native copy does', () => {
  const before=snapshot('qry10-no-criteria','after');
  stampAndCompare(copyQueryDocument(before,'ZZ_QRY_LAB02',''),snapshot('qry11-public-copy','after'));
});

test('webview operations cannot replace raw rows, change ownership or coerce string booleans', () => {
  assert.throws(()=>parseQueryOp({kind:'select',field:'ESTABID',selected:'false'}));
  assert.throws(()=>parseQueryOp({kind:'properties',description:'x',comments:'',OPRID:'OTHER'}));
  assert.throws(()=>parseQueryOp({kind:'replaceRows',rows:[]}));
});
