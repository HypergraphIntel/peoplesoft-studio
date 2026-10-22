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
  assert.throws(() => compileQuerySql({...view,records:[...view.records,...view.records]},context),/join shape|record metadata|aliases must be unique/);
  assert.throws(() => compileQuerySql({...view,fields:view.fields.map(f=>({...f,TTLTYPE:9}))},context),/aggregate/i);
  assert.throws(() => compileQuerySql({...view,fields:view.fields.map(f=>({...f,XLATTYPE:2,XLATEXPRTYPE:3}))},context),/translate/i);
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

test('join SQL matches Windows Query for qjn01-qjn04', () => {
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').replace(/, /g, ',').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
  const year = {record:'AAP_YEAR',table:'PS_AAP_YEAR',recordType:0,querySecurityRecord:'',fields:{ESTABID:{type:0},START_DT:{type:4},FEMALE_GOAL:{type:2}},keys:['ESTABID','START_DT']};
  const joined = {AAP_TBL:{record:'AAP_TBL',table:'PS_AAP_TBL',recordType:0,querySecurityRecord:'',fields:{ESTABID:{type:0},DESCR:{type:0},AAP_RESPONSIBLE_ID:{type:0}},keys:['ESTABID']},
    ESTAB_TBL:{record:'ESTAB_TBL',table:'PS_ESTAB_TBL',recordType:0,querySecurityRecord:'',fields:{ESTABID:{type:0},EFFDT:{type:4},DESCR:{type:0}},keys:['ESTABID','EFFDT']}};
  const ctx: QuerySqlContext = {...year, joined};
  const cases: Array<[string,string]> = [
    ['qjn01-standard-join',"SELECT A.ESTABID, A.FEMALE_GOAL, B.DESCR FROM PS_AAP_YEAR A, PS_AAP_TBL B WHERE ( A.ESTABID = B.ESTABID)"],
    ['qjn02-criterion-after-join',"SELECT A.ESTABID, A.FEMALE_GOAL, B.DESCR FROM PS_AAP_YEAR A, PS_AAP_TBL B WHERE ( A.ESTABID = B.ESTABID AND B.DESCR LIKE 'A%')"],
    ['qjn03-left-outer',"SELECT A.ESTABID, B.ESTABID FROM (PS_AAP_YEAR A LEFT OUTER JOIN  PS_AAP_TBL B ON  A.ESTABID = B.ESTABID )"],
    ['qjn04-related-join',"SELECT A.ESTABID, B.ESTABID, C.DESCR FROM (PS_AAP_YEAR A LEFT OUTER JOIN  PS_AAP_TBL B ON  A.ESTABID = B.ESTABID ), PS_ESTAB_TBL C WHERE ( C.ESTABID = A.ESTABID AND ( C.EFFDT = (SELECT MAX(C_ED.EFFDT) FROM PS_ESTAB_TBL C_ED WHERE C.ESTABID = C_ED.ESTABID AND C_ED.EFFDT <= SYSDATE) ))"]
  ];
  for (const [name,sql] of cases) assert.equal(normalize(compileQuerySql(snapshot(name),ctx).sql),normalize(sql),name);
  assert.throws(() => compileQuerySql(snapshot('qjn04-related-join'),{...ctx,joined:{...joined,ESTAB_TBL:{...joined.ESTAB_TBL,keys:['SETID','ESTABID','EFFDT']}}}),/keyed by the joining field/);
  assert.throws(() => compileQuerySql(snapshot('qjn01-standard-join'),{...ctx,joined:{...joined,AAP_TBL:{...joined.AAP_TBL,querySecurityRecord:'SEC_VW'}}}),/row security/);
});

// Windows Query's SQL tab for ZZ_QRY_AGG01, _EXPR01, _SUB01, _UNION01 and _XLAT01 after each native save.
test('aggregate, expression, subquery, union and translate SQL matches Windows Query', () => {
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').replace(/, /g, ',').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
  const aapTbl = {record:'AAP_TBL',table:'PS_AAP_TBL',recordType:0,querySecurityRecord:'',fields:{ESTABID:{type:0},DESCR:{type:0}},keys:['ESTABID']};
  const year: QuerySqlContext = {record:'AAP_YEAR',table:'PS_AAP_YEAR',recordType:0,querySecurityRecord:'',fields:{ESTABID:{type:0},START_DT:{type:4},FEMALE_GOAL:{type:2}},keys:['ESTABID','START_DT'],
    joined:{AAP_TBL:aapTbl}};
  const estab: QuerySqlContext = {record:'ESTAB_TBL',table:'PS_ESTAB_TBL',recordType:0,querySecurityRecord:'',fields:{ESTABID:{type:0},EFFDT:{type:4},EFF_STATUS:{type:0}},keys:['ESTABID','EFFDT']};
  const effective = "A.EFFDT = (SELECT MAX(A_ED.EFFDT) FROM PS_ESTAB_TBL A_ED WHERE A.ESTABID = A_ED.ESTABID AND A_ED.EFFDT <= SYSDATE)";
  const cases: Array<[string,QuerySqlContext,string]> = [
    ['qag01-sum',year,"SELECT A.ESTABID, SUM( A.FEMALE_GOAL) FROM PS_AAP_YEAR A GROUP BY  A.ESTABID"],
    ['qag04-distinct',year,"SELECT DISTINCT A.ESTABID, AVG( A.FEMALE_GOAL) FROM PS_AAP_YEAR A GROUP BY  A.ESTABID HAVING ( AVG( A.FEMALE_GOAL) > 1)"],
    ['qag05-where-and-having',year,"SELECT DISTINCT A.ESTABID, AVG( A.FEMALE_GOAL) FROM PS_AAP_YEAR A WHERE ( A.ESTABID = 'KU001') GROUP BY  A.ESTABID HAVING ( AVG( A.FEMALE_GOAL) > 1)"],
    ['qag06-date-max',year,"SELECT A.ESTABID, MAX( TO_CHAR(A.START_DT,'YYYY-MM-DD')) FROM PS_AAP_YEAR A GROUP BY  A.ESTABID"],
    ['qex04-expression-column-criterion',year,"SELECT A.ESTABID,  A.FEMALE_GOAL * 2,  A.FEMALE_GOAL + 100 FROM PS_AAP_YEAR A WHERE ( A.FEMALE_GOAL >= 0 * 2 AND  A.FEMALE_GOAL * 2 = 0)"],
    ['qhv01-having-or',year,"SELECT DISTINCT A.ESTABID, AVG( A.FEMALE_GOAL) FROM PS_AAP_YEAR A WHERE ( A.ESTABID LIKE '%') GROUP BY  A.ESTABID HAVING ( AVG( A.FEMALE_GOAL) >= 0 OR AVG( A.FEMALE_GOAL) = 0)"],
    ['qex03-expression-criterion',year,"SELECT A.ESTABID,  A.FEMALE_GOAL * 2,  A.FEMALE_GOAL + 100 FROM PS_AAP_YEAR A WHERE ( A.FEMALE_GOAL > 5 * 2)"],
    ['qsq01-in-subquery',year,"SELECT A.ESTABID FROM PS_AAP_YEAR A WHERE ( A.ESTABID IN (SELECT B.ESTABID FROM PS_AAP_TBL B))"],
    ['qsq02-exists',year,"SELECT A.ESTABID FROM PS_AAP_YEAR A WHERE ( A.ESTABID IN (SELECT B.ESTABID FROM PS_AAP_TBL B) AND EXISTS (SELECT C.ESTABID FROM PS_AAP_TBL C WHERE C.ESTABID = A.ESTABID))"],
    ['qun01-union',{...aapTbl,joined:{AAP_YEAR:year}},"SELECT A.ESTABID FROM PS_AAP_TBL A UNION SELECT B.ESTABID FROM PS_AAP_YEAR B"],
    ['qxl01-translate',estab,"SELECT A.ESTABID,  A2X.XLATLONGNAME FROM PS_ESTAB_TBL A LEFT OUTER JOIN PSXLATITEM A2X ON A2X.FIELDNAME='EFF_STATUS' AND A2X.FIELDVALUE=A.EFF_STATUS AND A2X.EFF_STATUS = 'A' "
      +"WHERE ( (A2X.EFFDT = (SELECT MAX(EFFDT) FROM PSXLATITEM TB WHERE TB.FIELDNAME=A2X.FIELDNAME AND TB.FIELDVALUE=A2X.FIELDVALUE AND  TB.EFF_STATUS = 'A' AND TB.EFFDT <=  A.EFFDT) OR A2X.EFFDT is NULL) AND "+effective+")"],
    ['qxl02-short-current',estab,"SELECT A.ESTABID,  A2X.XLATSHORTNAME FROM PS_ESTAB_TBL A LEFT OUTER JOIN ( SELECT * FROM PSXLATITEM TA WHERE TA.FIELDNAME='EFF_STATUS' AND TA.EFF_STATUS = 'A' AND TA.EFFDT = "
      +"(SELECT MAX(EFFDT) FROM PSXLATITEM TB WHERE TB.FIELDNAME='EFF_STATUS' AND TA.FIELDVALUE=TB.FIELDVALUE AND  TB.EFF_STATUS = 'A' AND TB.EFFDT <= TO_DATE(TO_CHAR(SYSDATE,'YYYY-MM-DD'),'YYYY-MM-DD'))) A2X "
      +"ON A2X.FIELDVALUE = A.EFF_STATUS AND A2X.FIELDNAME='EFF_STATUS' WHERE ( "+effective+")"]
  ];
  for (const [name,ctx,sql] of cases) assert.equal(normalize(compileQuerySql(snapshot(name),ctx).sql),normalize(sql),name);
  // Windows Query's SQL tab with the translated column unselected (not saved): the base record's effective date alone.
  const plain = snapshot('qxl01-translate');
  plain.fields = plain.fields.map(f => String(f.FIELDNAME) === 'EFF_STATUS' ? {...f,COLUMNNUM:0,XLATTYPE:1,XLATEXPRTYPE:6,XLATFLDNUM:0} : f);
  assert.equal(normalize(compileQuerySql(plain,estab).sql),normalize("SELECT A.ESTABID FROM PS_ESTAB_TBL A WHERE ( "+effective+")"));
  const expr = snapshot('qex03-expression-criterion');
  assert.throws(() => compileQuerySql({...expr,expressions:expr.expressions.map(e => Number(e.EXPNUM) === 1 ? {...e,EXPRESSIONTEXT:' :%1.2; DROP TABLE X'} : e)},year),/expression/);
  const sub = snapshot('qsq02-exists');
  assert.throws(() => compileQuerySql({...sub,criteria:sub.criteria.filter(c => Number(c.SELNUM) !== 1 || Number(c.CRTNUM) !== 2)},year),/not used|criterion/);
  assert.throws(() => compileQuerySql({...snapshot('qun01-union'),fields:snapshot('qun01-union').fields.map(f => Number(f.SELNUM) === 2 ? {...f,COLUMNNUM:0} : f)},{...aapTbl,joined:{AAP_YEAR:year}}),/output field/);
});

// ZZ_QRY_STUDIO_XLAT2 (ESTAB_TBL, short translation as of the current date) saved by Windows Query with each effective-date
// operator; the WHERE clause is the SQL tab's.
test('effective-date operators match Windows Query: MAX/MIN against SYSDATE, First/Last unbounded (qed01-qed05)', () => {
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').replace(/, /g, ',').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
  const estab: QuerySqlContext = {record:'ESTAB_TBL',table:'PS_ESTAB_TBL',recordType:0,querySecurityRecord:'',fields:{ESTABID:{type:0},EFFDT:{type:4},EFF_STATUS:{type:0}},keys:['ESTABID','EFFDT']};
  const where = (aggregate: string, bound: string) => `WHERE ( A.EFFDT = (SELECT ${aggregate}(A_ED.EFFDT) FROM PS_ESTAB_TBL A_ED WHERE A.ESTABID = A_ED.ESTABID${bound ? ` AND A_ED.EFFDT ${bound} SYSDATE` : ''}))`;
  const cases: Array<[string,string,string]> = [['qed01-effdt-ge','MIN','>='],['qed02-effdt-lt','MAX','<'],['qed03-effdt-gt','MIN','>'],['qed04-effdt-first','MIN',''],['qed05-effdt-last','MAX','']];
  for (const [name,aggregate,bound] of cases) {
    const sql = normalize(compileQuerySql(snapshot(name),estab).sql);
    assert.ok(sql.startsWith('SELECT A.ESTABID,A2X.XLATSHORTNAME FROM PS_ESTAB_TBL A LEFT OUTER JOIN'),name);
    assert.ok(sql.endsWith(normalize(where(aggregate,bound))),`${name}: ${sql}`);
  }
  // A bounded operator carries the Current Date operand (EXPRTYPE 6); First / Last none.
  const first = snapshot('qed04-effdt-first');
  assert.throws(() => compileQuerySql({...first,criteria:first.criteria.map(c => ({...c,EXPRTYPE:'6'}))},estab),/Effective dating/);
  const ge = snapshot('qed01-effdt-ge');
  assert.throws(() => compileQuerySql({...ge,criteria:ge.criteria.map(c => ({...c,EXPRTYPE:'0'}))},estab),/Effective dating/);
});

// Windows Query's SQL tab for the delivered HRDMO queries QA_QI_CNTRTACTLS (CONTRACT, security EMPLMT_SRCH_QRY) and
// QA_Q_DB_FY2000 (DEPT_BUDGET, security DEPT_SRCH_QRY), opened as operator JARED.
test('row-security SQL matches Windows Query: the security record joins on its shared keys, then OPRID, then the criteria (qrs01, qrs02)', () => {
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').replace(/, /g, ',').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
  const fields = (list: string) => Object.fromEntries(list.split(' ').map(f => { const [name, type] = f.split(':'); return [name, { type: Number(type) }]; }));
  const contract: QuerySqlContext = { record: 'CONTRACT', table: 'PS_CONTRACT', recordType: 0, querySecurityRecord: 'EMPLMT_SRCH_QRY', operatorId: 'JARED',
    fields: fields('EMPLID:0 EMPL_RCD:2 HP_CONTRACT_NUM:2 EFFDT:4 HP_WORKDAYS:2 HP_USE_HOL_SCHD:0'), keys: ['EMPLID', 'EMPL_RCD', 'HP_CONTRACT_NUM', 'EFFDT'],
    security: { table: 'PS_EMPLMT_SRCH_QRY', keys: ['OPRID', 'EMPLID', 'EMPL_RCD'] } };
  const budget: QuerySqlContext = { record: 'DEPT_BUDGET', table: 'PS_DEPT_BUDGET', recordType: 0, querySecurityRecord: 'DEPT_SRCH_QRY', operatorId: 'JARED',
    fields: fields('SETID:0 DEPTID:0 FISCAL_YEAR:2 EMPLID:0 EMPL_RCD:2 EFFDT:4 BUDGET_LEVEL_INDC:0 OVERALL_BDGT_CAP:2'), keys: ['SETID', 'DEPTID', 'FISCAL_YEAR', 'EFFDT'],
    security: { table: 'PS_DEPT_SRCH_QRY', keys: ['SETID', 'OPRID', 'DEPTID'] } };
  assert.equal(normalize(compileQuerySql(snapshot('qrs01-contract-security'), contract).sql), normalize(
    "SELECT A.EMPLID, A.EMPL_RCD, TO_CHAR(A.EFFDT,'YYYY-MM-DD'), A.HP_WORKDAYS, A.HP_USE_HOL_SCHD FROM PS_CONTRACT A, PS_EMPLMT_SRCH_QRY A1 "
    + "WHERE ( A.EMPLID = A1.EMPLID AND A.EMPL_RCD = A1.EMPL_RCD AND A1.OPRID = 'JARED' AND ( A.EMPLID LIKE 'QIE%' )) ORDER BY 1, 2, 3"));
  assert.equal(normalize(compileQuerySql(snapshot('qrs02-dept-security'), budget).sql), normalize(
    "SELECT A.DEPTID, A.FISCAL_YEAR, TO_CHAR(A.EFFDT,'YYYY-MM-DD'), A.BUDGET_LEVEL_INDC, A.OVERALL_BDGT_CAP FROM PS_DEPT_BUDGET A, PS_DEPT_SRCH_QRY A1 "
    + "WHERE ( A.SETID = A1.SETID AND A.DEPTID = A1.DEPTID AND A1.OPRID = 'JARED' AND ( A.DEPTID = 'QBD01' AND A.FISCAL_YEAR = 2000 AND A.BUDGET_LEVEL_INDC = 'D' ))"));
  // Without the security record or the operator, nothing is compiled.
  assert.throws(() => compileQuerySql(snapshot('qrs01-contract-security'), { ...contract, security: undefined }), /row security/);
  assert.throws(() => compileQuerySql(snapshot('qrs01-contract-security'), { ...contract, operatorId: '' }), /row security/);
  assert.throws(() => compileQuerySql(snapshot('qrs01-contract-security'), { ...contract, security: { table: 'PS_X', keys: ['OPRCLASS', 'EMPLID'] } }), /keyed by OPRID/);
});
