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
  assert.throws(() => compileQuerySql(view,{...context,fields:{ESTABID:{type:4}}}),/character/);
});
