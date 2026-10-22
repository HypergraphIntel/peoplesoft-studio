import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyQueryOp, describeQueryCriteria, newQueryDocument, parseQueryOp, type QueryCriterion, type QueryFieldInfo, type QueryOp, type QueryRecordInfo } from '../model/queryDocument.js';
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

// HRDMO records for the join captures; useEdit 1 marks keys, ESTABID prompts ESTAB_TBL.
const info=(type: number, longName: string, useEdit=0, editTable='', length=type===4?10:30): QueryFieldInfo=>({type,length,decimalPositions:0,format:0,shortName:longName,longName,editTable,useEdit});
const records: Record<string,QueryRecordInfo>={
  AAP_YEAR:{fields:{ESTABID:info(0,'Establishment ID',16385,'ESTAB_TBL',12),START_DT:info(4,'Start Date',1),FEMALE_GOAL:info(2,'Female Goal',0,'',6)}},
  AAP_TBL:{fields:{ESTABID:info(0,'Establishment ID',16385,'ESTAB_TBL',12),DESCR:info(0,'Description'),AAP_RESPONSIBLE_ID:info(0,'Person Responsible')}},
  ESTAB_TBL:{fields:{ESTABID:info(0,'Establishment ID',1,'',12),EFFDT:info(4,'Effective Date',1),EFF_STATUS:info(0,'Status'),DESCR:info(0,'Description')}}
};
test('native joins qjn01-qjn04 replay: standard, criteria after a join, left outer and related effective-dated', () => {
  const base=records.AAP_YEAR.fields, op=(view: QueryView, o: QueryOp)=>applyQueryOp(view,o,base,records);
  let joined=newQueryDocument('ZZ_QRY_JOIN01','JARED','AAP_YEAR');
  for (const o of [{kind:'select',field:'ESTABID',selected:true},{kind:'select',field:'FEMALE_GOAL',selected:true},{kind:'join',record:'AAP_TBL',type:'standard'},
    {kind:'select',field:'B.DESCR',selected:true},{kind:'properties',description:'Join calibration',comments:''}] as QueryOp[]) joined=op(joined,o);
  compare(joined,snapshot('qjn01-standard-join','after'),undefined,'qjn01');
  compare(op(snapshot('qjn02-criterion-after-join','before'),{kind:'criteria',criteria:[{field:'ESTABID',operator:'equal',value:{field:'B.ESTABID'}},
    {field:'B.DESCR',operator:'like',logical:'AND',value:{constant:'A%'}}]}),snapshot('qjn02-criterion-after-join','after'),snapshot('qjn02-criterion-after-join','before'),'qjn02');
  let outer=newQueryDocument('ZZ_QRY_JOIN02','JARED','AAP_YEAR');
  for (const o of [{kind:'select',field:'ESTABID',selected:true},{kind:'join',record:'AAP_TBL',type:'leftOuter'},{kind:'select',field:'B.ESTABID',selected:true},
    {kind:'properties',description:'Outer join calibration',comments:''}] as QueryOp[]) outer=op(outer,o);
  compare(outer,snapshot('qjn03-left-outer','after'),undefined,'qjn03');
  let related=op(snapshot('qjn04-related-join','before'),{kind:'join',record:'ESTAB_TBL',type:'related',field:'A.ESTABID'});
  related=op(related,{kind:'select',field:'C.DESCR',selected:true});
  compare(related,snapshot('qjn04-related-join','after'),snapshot('qjn04-related-join','before'),'qjn04');
  // The ON criterion stays with its join when the WHERE criteria are replaced.
  const replaced=op(snapshot('qjn04-related-join','after'),{kind:'criteria',criteria:[{field:'C.EFFDT',operator:'effectiveDate',value:{currentDate:true}},{field:'B.DESCR',operator:'isNotNull',logical:'AND'}]});
  assert.deepEqual(replaced.criteria.map(c=>[c.CRTNUM,c.QRYOJSELNUM,c.CONDTYPE,c.COMBTYPE]),[[1,'2','2','3'],[2,0,20,1],[3,0,17,1]]);
  assert.throws(()=>op(snapshot('qjn01-standard-join','after'),{kind:'join',record:'ESTAB_TBL',type:'standard'}),/effective-dated/);
  assert.throws(()=>op(snapshot('qjn01-standard-join','after'),{kind:'join',record:'AAP_TBL',type:'related',field:'B.DESCR'}),/related \(prompt\) record/);
});

// Aggregates, HAVING, DISTINCT (qag), expressions (qex), subqueries (qsq), unions (qun), translates and base effective dating (qxl).
const estab: Record<string,QueryFieldInfo>={ESTABID:info(0,'Establishment ID',1,'',12),EFFDT:info(4,'Effective Date',1),EFF_STATUS:info(0,'Status',0,'',1),DESCR:info(0,'Description')};
const all: Record<string,QueryRecordInfo>={...records,ESTAB_TBL:{fields:estab}};
const build=(name: string, record: string, ops: QueryOp[], dated=false)=>{
  const base=all[record].fields;
  return ops.reduce((v,o)=>applyQueryOp(v,o,base,all),newQueryDocument(name,'JARED',record,dated?base:undefined));
};
const step=(name: string, o: QueryOp)=>{ const before=snapshot(name,'before'); compare(applyQueryOp(before,o,records.AAP_YEAR.fields,all),snapshot(name,'after'),before,name); };
test('native aggregates, HAVING and DISTINCT replay qag01-qag05', () => {
  compare(build('ZZ_QRY_AGG01','AAP_YEAR',[{kind:'select',field:'ESTABID',selected:true},{kind:'select',field:'FEMALE_GOAL',selected:true},
    {kind:'aggregate',field:'FEMALE_GOAL',function:'sum'},{kind:'properties',description:'Aggregate calibration',comments:''}]),snapshot('qag01-sum','after'),undefined,'qag01');
  step('qag02-average',{kind:'aggregate',field:'FEMALE_GOAL',function:'average'});
  step('qag03-having',{kind:'having',criteria:[{field:'FEMALE_GOAL',operator:'greater',value:{constant:'1'}}]});
  step('qag04-distinct',{kind:'distinct',distinct:true});
  step('qag05-where-and-having',{kind:'criteria',criteria:[{field:'ESTABID',operator:'equal',value:{constant:'KU001'}}]});
  const agg=snapshot('qag05-where-and-having','after');
  assert.throws(()=>applyQueryOp(agg,{kind:'having',criteria:[{field:'ESTABID',operator:'equal',value:{constant:'A'}}]},records.AAP_YEAR.fields,all),/aggregated field/);
  assert.throws(()=>applyQueryOp(agg,{kind:'aggregate',field:'FEMALE_GOAL',function:'none'},records.AAP_YEAR.fields,all),/HAVING criterion uses/);
});
test('native date aggregate replays qag06: Max on START_DT; a WHERE criterion on it is refused', () => {
  const view=build('ZZ_QRY_STUDIO_DTAGG','AAP_YEAR',[{kind:'select',field:'ESTABID',selected:true},{kind:'select',field:'START_DT',selected:true},
    {kind:'aggregate',field:'START_DT',function:'max'},{kind:'properties',description:'Date aggregate calibration',comments:''}]);
  compare(view,snapshot('qag06-date-max','after'),undefined,'qag06');
  assert.throws(()=>applyQueryOp(view,{kind:'aggregate',field:'START_DT',function:'sum'},records.AAP_YEAR.fields,all),/dates: min and max/);
  assert.throws(()=>applyQueryOp(view,{kind:'criteria',criteria:[{field:'START_DT',operator:'greater',value:{constant:'2000-01-01'}}]},records.AAP_YEAR.fields,all),/aggregated field/);
  assert.throws(()=>applyQueryOp(view,{kind:'having',criteria:[{field:'START_DT',operator:'greater',value:{constant:'2000-01-01'}}]},records.AAP_YEAR.fields,all),/date aggregates/);
  const dated=applyQueryOp(applyQueryOp(view,{kind:'aggregate',field:'START_DT',function:'none'},records.AAP_YEAR.fields,all),
    {kind:'criteria',criteria:[{field:'START_DT',operator:'greater',value:{constant:'2000-01-01'}}]},records.AAP_YEAR.fields,all);
  assert.throws(()=>applyQueryOp(dated,{kind:'aggregate',field:'START_DT',function:'max'},records.AAP_YEAR.fields,all),/WHERE criterion uses this field/);
});
test('native HAVING OR replays qhv01: COMBTYPE 5', () => {
  const before=snapshot('qhv01-having-or','before'), after=snapshot('qhv01-having-or','after');
  const having: QueryCriterion[]=[{field:'FEMALE_GOAL',operator:'notLess',value:{constant:'0'}},{field:'FEMALE_GOAL',operator:'equal',logical:'OR',value:{constant:'0'}}];
  compare(applyQueryOp(before,{kind:'having',criteria:having},records.AAP_YEAR.fields,all),after,before,'qhv01');
  assert.deepEqual(describeQueryCriteria(after).having,having);
});
test('native expressions replay qex01-qex03', () => {
  compare(build('ZZ_QRY_EXPR01','AAP_YEAR',[{kind:'select',field:'ESTABID',selected:true},{kind:'expression',text:'A.FEMALE_GOAL * 2',type:'number',length:7},
    {kind:'properties',description:'Expression calibration',comments:''}]),snapshot('qex01-expression-column','after'),undefined,'qex01');
  step('qex02-second-expression',{kind:'expression',text:'A.FEMALE_GOAL + 100',type:'number',length:5});
  step('qex03-expression-criterion',{kind:'criteria',criteria:[{field:'FEMALE_GOAL',operator:'greater',value:{expression:'5 * 2'}}]});
  const view=snapshot('qex03-expression-criterion','after');
  for (const text of ['1; DELETE FROM PSOPRDEFN','A.FEMALE_GOAL -- x','A.FEMALE_GOAL /* x */',':1','\'open']) assert.throws(()=>applyQueryOp(view,{kind:'expression',text,type:'number',length:5},records.AAP_YEAR.fields,all),/cannot contain|Unbalanced/);
  // A quoted reference is not a field.
  const quoted=applyQueryOp(view,{kind:'expression',text:"'A.X' || A.ESTABID",type:'character',length:20},records.AAP_YEAR.fields,all);
  assert.equal(quoted.expressions.at(-1)!.EXPRESSIONTEXT,"'A.X' ||  :%1.1");
});
test('native subqueries replay qsq01-qsq02', () => {
  const inSub: QueryCriterion={field:'ESTABID',operator:'inList',value:{subquery:{record:'AAP_TBL',field:'ESTABID'}}};
  compare(build('ZZ_QRY_SUB01','AAP_YEAR',[{kind:'select',field:'ESTABID',selected:true},{kind:'criteria',criteria:[inSub]},
    {kind:'properties',description:'Subquery calibration',comments:''}]),snapshot('qsq01-in-subquery','after'),undefined,'qsq01');
  step('qsq02-exists',{kind:'criteria',criteria:[inSub,{operator:'exists',logical:'AND',value:{subquery:{record:'AAP_TBL',field:'ESTABID',
    criteria:[{field:'ESTABID',operator:'equal',value:{field:'A.ESTABID'}}]}}}]});
  const view=snapshot('qsq02-exists','after');
  assert.throws(()=>applyQueryOp(view,{kind:'criteria',criteria:[{field:'ESTABID',operator:'equal',value:{subquery:{record:'AAP_TBL',field:'ESTABID'}}}]},records.AAP_YEAR.fields,all),/in list, not in list, exists/);
  assert.throws(()=>applyQueryOp(view,{kind:'criteria',criteria:[{operator:'exists',value:{subquery:{record:'ESTAB_TBL',field:'ESTABID'}}}]},records.AAP_YEAR.fields,all),/effective-dated/);
  assert.throws(()=>applyQueryOp(view,{kind:'union',record:'AAP_TBL'},records.AAP_YEAR.fields,all),/subqueries/);
  // Removing the subquery criteria removes their selects, records and fields.
  const exists=applyQueryOp(view,{kind:'criteria',criteria:[]},records.AAP_YEAR.fields,all);
  assert.deepEqual([exists.selects.length,exists.records.length,exists.fields.map(f=>[f.QRYFLDNAME,f.USECOUNT])],[1,1,[['A.ESTABID',0]]]);
});
test('native union replays qun01', () => {
  compare(build('ZZ_QRY_UNION01','AAP_TBL',[{kind:'select',field:'ESTABID',selected:true},{kind:'union',record:'AAP_YEAR'},{kind:'select',field:'B.ESTABID',selected:true},
    {kind:'properties',description:'Union calibration',comments:''}]),snapshot('qun01-union','after'),undefined,'qun01');
  assert.throws(()=>applyQueryOp(snapshot('qun01-union','after'),{kind:'union',record:'ESTAB_TBL'},records.AAP_TBL.fields,all),/effective-dated/);
});
test('native translates and base effective dating replay qxl01-qxl02', () => {
  compare(build('ZZ_QRY_XLAT01','ESTAB_TBL',[{kind:'select',field:'ESTABID',selected:true},{kind:'select',field:'EFF_STATUS',selected:true},
    {kind:'translate',field:'EFF_STATUS',value:'long',effectiveDate:{field:'EFFDT'}},{kind:'properties',description:'Translate calibration',comments:''}],true),snapshot('qxl01-translate','after'),undefined,'qxl01');
  const before=snapshot('qxl02-short-current','before');
  compare(applyQueryOp(before,{kind:'translate',field:'EFF_STATUS',value:'short',effectiveDate:'current'},estab,all),snapshot('qxl02-short-current','after'),before,'qxl02');
  assert.throws(()=>applyQueryOp(before,{kind:'translate',field:'ESTABID',value:'short'},estab,all),/translate field/);
  assert.throws(()=>applyQueryOp(before,{kind:'select',field:'EFF_STATUS',selected:false},estab,all),/translate or aggregate/);
});
test('native effective-date operators replay qed01-qed06: the EFFDT criterion changes operator in place', () => {
  const cases: Array<[string,QueryCriterion]>=[['qed01-effdt-ge',{field:'EFFDT',operator:'effectiveDateNotLess',value:{currentDate:true}}],
    ['qed02-effdt-lt',{field:'EFFDT',operator:'effectiveDateLess',value:{currentDate:true}}],['qed03-effdt-gt',{field:'EFFDT',operator:'effectiveDateGreater',value:{currentDate:true}}],
    ['qed04-effdt-first',{field:'EFFDT',operator:'firstEffectiveDate'}],['qed05-effdt-last',{field:'EFFDT',operator:'lastEffectiveDate'}],
    ['qed06-effdt-le-restore',{field:'EFFDT',operator:'effectiveDate',value:{currentDate:true}}]];
  for (const [name,criterion] of cases) {
    const before=snapshot(name,'before'), after=snapshot(name,'after');
    compare(applyQueryOp(before,{kind:'criteria',criteria:[criterion]},estab,all),after,before,name);
    assert.deepEqual(describeQueryCriteria(after).criteria,[criterion],name);
  }
  const before=snapshot('qed01-effdt-ge','before');
  assert.throws(()=>applyQueryOp(before,{kind:'criteria',criteria:[{field:'EFFDT',operator:'firstEffectiveDate',value:{currentDate:true}}]},estab,all),/current date|operands/);
  assert.throws(()=>applyQueryOp(before,{kind:'criteria',criteria:[{field:'EFFDT',operator:'effectiveDateLess',value:{constant:'2020-01-01'}}]},estab,all),/current date/);
  assert.throws(()=>applyQueryOp(before,{kind:'criteria',criteria:[{field:'ESTABID',operator:'lastEffectiveDate'}]},estab,all),/EFFDT/);
});
test('every native capture round-trips: its described criteria replace themselves exactly', () => {
  const metaOf=(view: QueryView)=>all[String(view.records[0].RECNAME)].fields;
  for (const name of ['qcr10-field','qnm04-number-prompt','qjn02-criterion-after-join','qjn04-related-join','qag05-where-and-having','qex03-expression-criterion','qsq02-exists','qxl01-translate','qun01-union']) {
    const view=snapshot(name,'after'), {criteria,having}=describeQueryCriteria(view);
    let again=applyQueryOp(view,{kind:'criteria',criteria},name.startsWith('qcr')?metadata:metaOf(view),all);
    if (having.length) again=applyQueryOp(again,{kind:'having',criteria:having},metaOf(view),all);
    compare(again,view,view,name);
  }
});
