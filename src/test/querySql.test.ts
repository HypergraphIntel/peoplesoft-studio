import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bindQueryPrompts, compileQuerySql, type QuerySqlContext } from '../model/querySql.js';
import type { QueryView, Row } from '../model/queryDefinition.js';

const context: QuerySqlContext = {record:'AAP_TBL',table:'PS_AAP_TBL',recordType:0,querySecurityRecord:'',fields:{ESTABID:{type:0},DESCR:{type:0}}};
function snapshot(caseName: string): QueryView {
  const capture = JSON.parse(readFileSync(`src/test/fixtures/query/${caseName}-after.json`,'utf8')) as {tables:Record<string,Row[]>};
  const t = capture.tables;
  return {query:t.PSQRYDEFN[0],selects:t.PSQRYSELECT,records:t.PSQRYRECORD,fields:t.PSQRYFIELD,criteria:t.PSQRYCRITERIA,expressions:t.PSQRYEXPR,binds:t.PSQRYBIND};
}

test('native prompt SQL is reproduced, and prompt values stay separate from SQL', () => {
  const view = snapshot('qry08-prompt');
  const expected = JSON.parse(readFileSync('src/test/fixtures/query/qry08-native-run.json','utf8')) as {sql:string};
  const plan = compileQuerySql(view,context);
  assert.equal(plan.sql,expected.sql);
  assert.deepEqual(bindQueryPrompts(plan,{'1':'ku001'}),{'1':'KU001'});
  assert.deepEqual(bindQueryPrompts(plan,{'1':"x' or 1=1"}),{'1':"X' OR 1=1"});
  assert.equal(plan.sql,expected.sql);
  assert.throws(() => bindQueryPrompts(plan,{'1':''}),/Blank runtime/);
});

test('native two-column SQL and ordering are reproduced; unused saved prompts are not requested', () => {
  const view = snapshot('qry10-no-criteria');
  const plan = compileQuerySql(view,context);
  assert.equal(plan.sql,'SELECT A.ESTABID,A.DESCR\nFROM PS_AAP_TBL A\nORDER BY 1 DESC');
  assert.equal(view.binds.length,1);
  assert.deepEqual(plan.prompts,[]);
  assert.deepEqual(bindQueryPrompts(plan,{}),{});
});

test('unsupported security, aggregate, join and date shapes produce no partial SQL', () => {
  const view = snapshot('qry08-prompt');
  assert.throws(() => compileQuerySql(view,{...context,querySecurityRecord:'SECURITY_VW'}),/row security/);
  assert.throws(() => compileQuerySql({...view,records:[...view.records,...view.records]},context),/Joins/);
  assert.throws(() => compileQuerySql({...view,fields:view.fields.map(f=>({...f,TTLTYPE:3}))},context),/Aggregate/);
  assert.throws(() => compileQuerySql(view,{...context,fields:{ESTABID:{type:3}}}),/character, number and date/);
});

// Windows Query's SQL tab for each native save (qcr05-qcr10, qnm02, qnm04), whitespace normalized.
test('criteria, number and date SQL matches what Windows Query shows for the native saves', () => {
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').replace(/, /g, ',').trim();
  const years: QuerySqlContext = {record:'AAP_YEAR',table:'PS_AAP_YEAR',recordType:0,querySecurityRecord:'',fields:{ESTABID:{type:0},START_DT:{type:4},FEMALE_GOAL:{type:2}}};
  const head = "SELECT A.DESCR, A.ESTABID FROM PS_AAP_TBL A WHERE ( ";
  const cases: Array<[string,QuerySqlContext,string]> = [
    ['qcr05-group',context,head+"A.ESTABID <> 'ZZZ' OR ( A.DESCR LIKE 'A%' AND A.ESTABID > 'A'))"],
    ['qcr06-not',context,head+"NOT A.ESTABID <> 'ZZZ' OR ( A.DESCR LIKE 'A%' AND A.ESTABID > 'A'))"],
    ['qcr07-between',context,head+"NOT A.ESTABID <> 'ZZZ' OR ( A.DESCR LIKE 'A%' AND A.ESTABID BETWEEN 'A' AND 'M'))"],
    ['qcr08-in-list',context,head+"NOT A.ESTABID <> 'ZZZ' OR ( A.DESCR LIKE 'A%' AND A.ESTABID IN ('A','B')))"],
    ['qcr09-is-null',context,head+"NOT A.ESTABID <> 'ZZZ' OR ( A.DESCR IS NULL AND A.ESTABID IN ('A','B')))"],
    ['qcr10-field',context,head+"NOT A.ESTABID <> A.DESCR OR ( A.DESCR IS NULL AND A.ESTABID IN ('A','B')))"],
    ['qnm02-date-const',years,"SELECT A.ESTABID, TO_CHAR(A.START_DT,'YYYY-MM-DD'), A.FEMALE_GOAL FROM PS_AAP_YEAR A WHERE ( A.FEMALE_GOAL > 5 AND A.START_DT > TO_DATE('2000-01-01','YYYY-MM-DD'))"],
    ['qnm04-number-prompt',years,"SELECT A.ESTABID, TO_CHAR(A.START_DT,'YYYY-MM-DD'), A.FEMALE_GOAL FROM PS_AAP_YEAR A WHERE ( A.FEMALE_GOAL > :2 AND A.START_DT > TO_DATE(:1,'YYYY-MM-DD'))"]
  ];
  for (const [name,ctx,sql] of cases) assert.equal(normalize(compileQuerySql(snapshot(name),ctx).sql),normalize(sql),name);
  const plan = compileQuerySql(snapshot('qnm04-number-prompt'),years);
  assert.deepEqual(plan.prompts.map(p => String(p.BNDNAME)), ['BIND2','BIND1']);
  assert.deepEqual(bindQueryPrompts(plan,{'1':'2000-01-01','2':'5'}),{'1':'2000-01-01','2':'5'});
  assert.throws(() => bindQueryPrompts(plan,{'1':'01/01/2000','2':'5'}),/YYYY-MM-DD/);
  assert.throws(() => bindQueryPrompts(plan,{'1':'2000-01-01','2':'5 or 1=1'}),/whole number/);
});
