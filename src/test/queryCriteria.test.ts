import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyQueryOp, newQueryDocument, parseQueryOp, type QueryCriterion, type QueryFieldInfo } from '../model/queryDocument.js';
import { canonicalQueryRows, planQuerySave, QUERY_TABLES, queryRows, type QueryTable } from '../model/querySavePlan.js';
import type { QueryView, Row } from '../model/queryDefinition.js';

// AAP_TBL (qcr*) and AAP_YEAR (qnm*) on HRDMO.
const metadata: Record<string,QueryFieldInfo>={
  ESTABID:{type:0,length:12,decimalPositions:0,format:0,shortName:'Estab ID',longName:'Establishment ID',editTable:'ESTAB_TBL',useEdit:16384},
  DESCR:{type:0,length:30,decimalPositions:0,format:6,shortName:'Descr',longName:'Description',editTable:'',useEdit:0},
  START_DT:{type:4,length:10,decimalPositions:0,format:0,shortName:'Start Date',longName:'Start Date',editTable:'',useEdit:0},
  FEMALE_GOAL:{type:2,length:6,decimalPositions:0,format:0,shortName:'Fem Goal',longName:'Female Goal',editTable:'',useEdit:0}
};
const viewOf=(t: Record<string,Row[]>): QueryView=>({query:t.PSQRYDEFN[0],selects:t.PSQRYSELECT,records:t.PSQRYRECORD,fields:t.PSQRYFIELD,criteria:t.PSQRYCRITERIA ?? [],expressions:t.PSQRYEXPR ?? [],binds:t.PSQRYBIND ?? []});
const snapshot=(name: string, phase: string)=>viewOf(JSON.parse(readFileSync(`src/test/fixtures/query/${name}-${phase}.json`,'utf8')).tables);
function compare(actual: QueryView, expected: QueryView, stored?: QueryView, label=''): void {
  const plan=planQuerySave(actual,{version:Number(expected.query.VERSION),operator:String(expected.query.LASTUPDOPRID),
    updatedAt:String(expected.query.LASTUPDDTTM),createdAt:String(expected.query.CREATEDTTM)},stored);
  for (const table of Object.keys(QUERY_TABLES) as QueryTable[]) assert.equal(canonicalQueryRows(queryRows(plan,table)),canonicalQueryRows(queryRows(expected,table)),`${label} ${table}`);
}

const c1: QueryCriterion={field:'ESTABID',operator:'notEqual',value:{constant:'ZZZ'}};
const c2: QueryCriterion={field:'DESCR',operator:'like',logical:'AND',value:{constant:'A%'}};
const c3: QueryCriterion={field:'ESTABID',operator:'greater',logical:'AND',value:{constant:'A'}};
const grouped=[{...c1,not:true},{...c2,logical:'OR' as const,open:1},{...c3,close:1}];
const crit: Array<[string,QueryCriterion[]]>=[
  ['qcr02-and-like',[c1,c2]],
  ['qcr03-or',[c1,{...c2,logical:'OR'}]],
  ['qcr04-greater',[c1,{...c2,logical:'OR'},c3]],
  ['qcr05-group',[c1,{...c2,logical:'OR',open:1},{...c3,close:1}]],
  ['qcr06-not',grouped],
  ['qcr07-between',[grouped[0],grouped[1],{...grouped[2],operator:'between',value2:{constant:'M'}}]],
  ['qcr08-in-list',[grouped[0],grouped[1],{...grouped[2],operator:'inList',value:{list:['A','B']}}]],
  ['qcr09-is-null',[grouped[0],{field:'DESCR',operator:'isNull',logical:'OR',open:1},{...grouped[2],operator:'inList',value:{list:['A','B']}}]],
  ['qcr10-field',[{...grouped[0],value:{field:'DESCR'}},{field:'DESCR',operator:'isNull',logical:'OR',open:1},{...grouped[2],operator:'inList',value:{list:['A','B']}}]]
];

test('native criteria captures qcr02-qcr10 replay exactly as one typed criteria operation', () => {
  for (const [name,criteria] of crit) {
    const before=snapshot(name,'before'), original=JSON.stringify(before);
    compare(applyQueryOp(before,parseQueryOp({kind:'criteria',criteria}),metadata),snapshot(name,'after'),before,name);
    assert.equal(JSON.stringify(before),original,'the source document is not mutated');
  }
});

test('native first saves qcr01 and qnm01 are reproduced from a new document', () => {
  let view=newQueryDocument('ZZ_QRY_CRIT01','JARED','AAP_TBL');
  for (const field of ['DESCR','ESTABID']) view=applyQueryOp(view,{kind:'select',field,selected:true},metadata);
  view=applyQueryOp(view,{kind:'criteria',criteria:[c1]},metadata);
  view=applyQueryOp(view,{kind:'properties',description:'Criteria calibration',comments:''},metadata);
  compare(view,snapshot('qcr01-create','after'),undefined,'qcr01');
  let numbers=newQueryDocument('ZZ_QRY_NUM01','JARED','AAP_YEAR');
  for (const field of ['ESTABID','START_DT','FEMALE_GOAL']) numbers=applyQueryOp(numbers,{kind:'select',field,selected:true},metadata);
  numbers=applyQueryOp(numbers,{kind:'criteria',criteria:[{field:'FEMALE_GOAL',operator:'greater',value:{constant:'5'}}]},metadata);
  numbers=applyQueryOp(numbers,{kind:'properties',description:'Numeric and date calibration',comments:''},metadata);
  compare(numbers,snapshot('qnm01-create','after'),undefined,'qnm01');
});

test('numeric and date constants and prompts replay qnm02-qnm04', () => {
  const goal: QueryCriterion={field:'FEMALE_GOAL',operator:'greater',value:{constant:'5'}};
  const cases: Array<[string,QueryCriterion[]]>=[
    ['qnm02-date-const',[goal,{field:'START_DT',operator:'greater',logical:'AND',value:{constant:'2000-01-01'}}]],
    ['qnm03-date-prompt',[goal,{field:'START_DT',operator:'greater',logical:'AND',value:{prompt:'new'}}]],
    ['qnm04-number-prompt',[{...goal,value:{prompt:'new'}},{field:'START_DT',operator:'greater',logical:'AND',value:{prompt:1}}]]
  ];
  for (const [name,criteria] of cases) compare(applyQueryOp(snapshot(name,'before'),{kind:'criteria',criteria},metadata),snapshot(name,'after'),snapshot(name,'before'),name);
});

test('typed criteria refuse uncalibrated and inconsistent shapes', () => {
  const base=snapshot('qnm01-create','after');
  const refuse=(criteria: QueryCriterion[], pattern: RegExp)=>assert.throws(()=>applyQueryOp(base,{kind:'criteria',criteria},metadata),pattern);
  refuse([{field:'FEMALE_GOAL',operator:'greater',value:{constant:'five'}}],/enter a number/);
  refuse([{field:'START_DT',operator:'greater',value:{constant:'01/01/2000'}}],/YYYY-MM-DD/);
  refuse([{field:'START_DT',operator:'greater',value:{constant:'2001-02-30'}}],/YYYY-MM-DD/);
  refuse([{field:'FEMALE_GOAL',operator:'between',value:{constant:'1'},value2:{constant:'2'}}],/character fields only/);
  refuse([{field:'ESTABID',operator:'between',value:{constant:'A'}}],/wrong number of operands/);
  refuse([{field:'ESTABID',operator:'isNull',value:{constant:'A'}}],/wrong number of operands/);
  refuse([{field:'ESTABID',operator:'equal',value:{list:['A']}}],/single value/);
  refuse([{field:'ESTABID',operator:'equal',value:{constant:'A'},open:1}],/parentheses/);
  refuse([{field:'ESTABID',operator:'equal',value:{prompt:9}}],/No prompt/);
  refuse([{field:'FEMALE_GOAL',operator:'equal',value:{field:'ESTABID'}}],/character fields only/);
  assert.throws(()=>parseQueryOp({kind:'criteria',criteria:[{field:'ESTABID',operator:'regexp',value:{constant:'A'}}]}));
  assert.throws(()=>applyQueryOp(snapshot('qcr05-group','after'),{kind:'constant',field:'ESTABID',value:'X'},metadata),/several criteria/);
});
