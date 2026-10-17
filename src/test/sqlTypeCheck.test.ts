import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSqlTypes, checkSqlCallSites, bindMarkerCount, selectList, selectTargets, type SqlCatalog } from '../model/sqlTypeCheck.js';

/*
 * SQL against the record / field catalogue. Each case is a mistake agent-written
 * SQL made on HRDMO and that nothing caught until App Engine abended at run time.
 */

const TYPES: Record<string, { type: number; length: number; decimals: number }> = {
  EMPLID: { type: 0, length: 11, decimals: 0 },
  ZZ_PLAN_YEAR: { type: 0, length: 4, decimals: 0 },
  RUN_ID: { type: 0, length: 10, decimals: 0 },
  COMPANY: { type: 0, length: 3, decimals: 0 },
  EFFDT: { type: 4, length: 10, decimals: 0 },
  BIRTHDATE: { type: 4, length: 10, decimals: 0 },
  CHECK_DT: { type: 4, length: 10, decimals: 0 },
  BALANCE_YEAR: { type: 2, length: 4, decimals: 0 },
  ZZ_AMOUNT: { type: 3, length: 15, decimals: 2 },
  DESCRLONG: { type: 1, length: 0, decimals: 0 }
};
const BIO = new Set(['EMPLID', 'ZZ_PLAN_YEAR', 'EFFDT', 'BIRTHDATE', 'COMPANY']);
const catalog: SqlCatalog = { field: (n) => TYPES[n], record: (r) => (r === 'ZZ_BNV_BIO' ? BIO : undefined) };
const stateFields = new Set(['ZZ_PLAN_YEAR', 'EFFDT', 'COMPANY', 'CHECK_DT', 'RUN_ID', 'BALANCE_YEAR', 'EMPLID']);
const codes = (sql: string) => checkSqlTypes(sql, { stateFields, catalog }).map((p) => p.code);

test('an INSERT whose column list and SELECT list differ in length is refused', () => {
  assert.deepEqual(codes('INSERT INTO PS_ZZ_BNV_BIO (EMPLID, ZZ_PLAN_YEAR, EFFDT) SELECT A.EMPLID, %Bind(ZZ_PLAN_YEAR) FROM PS_X A'), ['sql-insert-arity']);
  assert.deepEqual(codes('INSERT INTO PS_ZZ_BNV_BIO (EMPLID, ZZ_PLAN_YEAR, EFFDT) SELECT A.EMPLID, %Bind(ZZ_PLAN_YEAR), %Bind(EFFDT) FROM PS_X A'), []);
});

test('a column written from another type family is refused; char/long and number/signed are one family', () => {
  // A date column fed a character field: Oracle ORA-00932, or a silent mess.
  assert.deepEqual(codes('INSERT INTO PS_ZZ_BNV_BIO (EMPLID, BIRTHDATE) SELECT A.EMPLID, %Bind(RUN_ID) FROM PS_X A'), ['sql-type-mismatch']);
  // number and signed number are interchangeable, as delivered code treats them.
  assert.deepEqual(codes('INSERT INTO PS_ZZ_BNV_BIO (EMPLID, EFFDT) SELECT A.EMPLID, A.EFFDT FROM PS_X A'), []);
});

test('a %Bind or %Select naming a field on no state record is refused', () => {
  assert.deepEqual(codes("SELECT 'X' FROM PS_INSTALLATION WHERE %Bind(NOT_A_FIELD) = 'Y'"), ['sql-bind-unknown']);
  assert.deepEqual(codes("SELECT 'X' FROM PS_INSTALLATION WHERE %Bind(ZZ_BNV_AET.ZZ_PLAN_YEAR) = 'Y'"), []);
  // A field named only inside a comment is not a reference.
  assert.deepEqual(codes("/* %Bind(NOT_A_FIELD) is documented here */ SELECT 'X' FROM PS_INSTALLATION WHERE %Bind(COMPANY) = 'Y'"), []);
});

test('%Select must name as many fields as the SELECT returns', () => {
  assert.deepEqual(codes('%Select(RUN_ID, CHECK_DT) SELECT A.RUN_ID FROM PS_PAY_CALENDAR A'), ['sql-select-arity']);
  assert.deepEqual(codes('%Select(RUN_ID, CHECK_DT) SELECT A.RUN_ID, A.CHECK_DT FROM PS_PAY_CALENDAR A'), []);
});

test('CreateSQL passes binds only; SQLExec may also carry the outputs', () => {
  const shape = (id: string) => (id === 'ZZ_BNV_PAYCAL2' ? { binds: 7, columns: 2 } : undefined);
  assert.deepEqual(checkSqlCallSites('&s = CreateSQL(SQL.ZZ_BNV_PAYCAL2, &a, &b, &c, &d, &e, &f, &g);', shape), []);
  assert.deepEqual(checkSqlCallSites('&s = CreateSQL(SQL.ZZ_BNV_PAYCAL2, &a, &b);', shape).map((p) => p.code), ['sql-call-arity']);
  // SQLExec takes binds, then the selected columns as outputs: 7 to 9 arguments.
  assert.deepEqual(checkSqlCallSites('SQLExec(SQL.ZZ_BNV_PAYCAL2, &a, &b, &c, &d, &e, &f, &g, &o1, &o2);', shape), []);
  assert.deepEqual(checkSqlCallSites('SQLExec(SQL.ZZ_BNV_PAYCAL2, &a, &b, &c, &d, &e, &f, &g, &o1, &o2, &o3);', shape).map((p) => p.code), ['sql-call-arity']);
  // An unknown definition is left alone rather than guessed at.
  assert.deepEqual(checkSqlCallSites('&s = CreateSQL(SQL.SOMETHING_ELSE, &a);', shape), []);
});

test('the parsing helpers read binds, select lists and %Select targets', () => {
  // A marker inside a comment is not a bind: that mistake is caught by sqlWriter.
  assert.equal(bindMarkerCount('/* binds :9 */ SELECT A FROM T WHERE X = :1 AND Y = :2 AND Z = :2'), 2);
  assert.deepEqual(selectList('SELECT A.X, F(A.Y, A.Z), A.W FROM T A')?.length, 3);
  assert.deepEqual(selectTargets('%Select(RUN_ID, CHECK_DT) SELECT A FROM T'), ['RUN_ID', 'CHECK_DT']);
  assert.equal(selectTargets('SELECT A FROM T'), undefined);
});
