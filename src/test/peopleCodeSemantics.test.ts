import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPeopleCodeSemantics } from '../peoplecode/semanticCheck.js';
import { compileForSave, SaveRefusedError } from '../peoplecode/writeback/savePlan.js';
import { bindMarkerInComment } from '../providers/sqlWriter.js';

/*
 * App Designer's compiler checks that Studio's encoder does not make
 * (semanticCheck.ts): the mistakes agent-written PeopleCode made in the first
 * build request, each refused, and the legal neighbours of each accepted. The
 * whole delivered corpus passes (tools/corpus/semantic-census.mts: 0 of 35,831).
 */

const codes = (source: string, applicationClass = false) => checkPeopleCodeSemantics(source, { applicationClass }).map((p) => p.code);

test('PC001: a readonly property with a get block is refused; "get" with its block is fine', () => {
  const bad = `class Config
   property string Mode readonly;
end-class;

get Mode
   /+ Returns String +/
   Return "X";
end-get;
`;
  assert.deepEqual(codes(bad, true), ['PC001']);
  assert.match(checkPeopleCodeSemantics(bad, { applicationClass: true })[0].message, /declared "property string Mode get;"/);
  assert.deepEqual(codes(bad.replace('readonly', 'get'), true), []);
  // A get property without its block, and a plain readonly property (no block) is fine.
  assert.deepEqual(codes(`class C\n   property string A get;\nend-class;\n`, true), ['PC001']);
  assert.deepEqual(codes(`class C\n   property string A readonly;\nend-class;\n`, true), []);
});

test('PC002: an instance variable with a property\'s name is refused', () => {
  const src = `class Status
   property string Code get;
private
   instance string &Code;
end-class;

get Code
   /+ Returns String +/
   Return "A";
end-get;
`;
  assert.deepEqual(codes(src, true), ['PC002']);
  assert.deepEqual(codes(src.replace('instance string &Code', 'instance string &sCode'), true), []);
});

test('PC003: Return with a value outside a function is refused; a bare Return and returns inside functions are fine', () => {
  assert.deepEqual(codes(`If &x = 1 Then\n   Return True;\nEnd-If;\n`), ['PC003']);
  assert.deepEqual(codes(`If &x = 1 Then\n   Return False\nEnd-If;\n`), ['PC003']);
  assert.match(checkPeopleCodeSemantics('Return True;', { applicationClass: false })[0].message, /Exit\(1\)/);
  assert.deepEqual(codes(`If &x = 1 Then\n   Return;\nEnd-If;\n`), []);
  assert.deepEqual(codes(`If &x = 1 Then\n   Return\nEnd-If;\n`), []);
  assert.deepEqual(codes(`Function IsOk(&a As number) Returns boolean\n   Return &a > 0;\nEnd-Function;\n\nLocal boolean &return = IsOk(1);\n`), []);
});

test('PC004: a Local re-declaring a parameter or an instance variable is refused', () => {
  assert.deepEqual(codes(`Function F(&a As string)\n   Local string &a;\nEnd-Function;\n`), ['PC004']);
  const cls = `class W
   method Write(&line As string);
private
   instance File &f;
end-class;

method Write
   /+ &line as String +/
   Local string &line;
   Local File &f;
   Local string &other;
end-method;
`;
  assert.deepEqual(codes(cls, true), ['PC004', 'PC004']);
});

test('PC005: an Application Class used without an import from its package is refused', () => {
  const use = `Local ZZ_BNV_FILE:Writer &w = create ZZ_BNV_FILE:Writer();\n&w.Open();\n`;
  assert.deepEqual(codes(use), ['PC005']);
  assert.match(checkPeopleCodeSemantics(use, { applicationClass: false })[0].message, /import ZZ_BNV_FILE:Writer;/);
  assert.deepEqual(codes(`import ZZ_BNV_FILE:Writer;\n\n${use}`), []);
  assert.deepEqual(codes(`import ZZ_BNV_FILE:*;\n\n${use}`), []);
  assert.deepEqual(codes(`Local Writer &w = create Writer();\n`), ['PC005']);
  assert.deepEqual(codes(`import ZZ_BNV_FILE:Writer;\n\nLocal Writer &w = create Writer();\n`), []);
  // A class naming itself, built-in %metadata classes, and classes inside signature comments need no import.
  assert.deepEqual(codes(`class Fmt\n   method Copy() Returns ZZ_BNV_FILE:Fmt;\nend-class;\n\nmethod Copy\n   /+ Returns ZZ_BNV_FILE:Fmt +/\n   Return create ZZ_BNV_FILE:Fmt();\nend-method;\n`, true), []);
  assert.deepEqual(codes(`import %metadata:*;\nLocal %metadata:Key &k = create %metadata:Key(Key:Class_AppDataSet, "X");\n`), []);
});

test('PC007: None/All on an instance variable or property is refused; on a Local, parameter or field it is fine', () => {
  const cls = (body: string) => `class ContribSource
   property string TaxYear get;
   method Check(&dt As date) Returns boolean;
private
   instance date &i_checkDt;
end-class;

get TaxYear
   /+ Returns String +/
${body}
   Return "";
end-get;

method Check
   /+ &dt as Date +/
   /+ Returns Boolean +/
   Return None(&dt);
end-method;
`;
  // App Designer: "Field or temporary variable name required. (2,32)" on None(&i_checkDt).
  assert.deepEqual(codes(cls('   If None(&i_checkDt) Then\n      Return "";\n   End-If;'), true), ['PC007']);
  assert.match(checkPeopleCodeSemantics(cls('   If None(&i_checkDt) Then\n   End-If;'), { applicationClass: true })[0].message, /Field or temporary variable name required/);
  assert.deepEqual(codes(cls('   If All(%This.TaxYear, ZZ_BNV_AET.RUN_ID) Then\n   End-If;'), true), ['PC007']);
  assert.deepEqual(codes(cls('   Local date &d = &i_checkDt;\n   If None(&d) Then\n   End-If;'), true), []);
  assert.deepEqual(codes(cls('   If None(ZZ_BNV_AET.CHECK_DT) Or\n      IsDate(&i_checkDt) Then\n   End-If;'), true), []);
});

test('PC009: a printf conversion in a NumberToString format is refused; PeopleSoft suffixes are fine', () => {
  // On HRDMO, NumberToString("%04d", 2026) produced "d-ba", which went into the file as the plan year.
  assert.deepEqual(codes('&y = NumberToString("%04d", Year(%Date));'), ['PC009']);
  assert.deepEqual(codes('&m = NumberToString("%02d", &n);'), ['PC009']);
  assert.match(checkPeopleCodeSemantics('&y = NumberToString("%04d", &n);', { applicationClass: false })[0].message, /not printf/);
  // The 48 formats delivered code actually uses: widths, decimals and the R / T / t / v suffixes.
  for (const fmt of ['%04', '%02', '%4', '%3.6', '%02t', '%6.2T', '%10.2v', '%7.2Rt', '%10.2Tv', '%#011.2t', '-']) {
    assert.deepEqual(codes(`&a = NumberToString("${fmt}", &n);`), [], `${fmt} is used by delivered code`);
  }
});

test('PC008: SQL.Fetch into a property or instance variable is refused; into Locals it is fine', () => {
  const cls = (fetch: string) => `class Config
   method Load(&id As string) Returns boolean;
   property string Descr;
private
   instance string &baseClientId;
end-class;

method Load
   /+ &id as String +/
   /+ Returns Boolean +/
   Local string &a, &b;
   Local SQL &s = CreateSQL("SELECT DESCR, CLIENT FROM PS_X WHERE ID = :1", &id);
${fetch}
   Return True;
end-method;
`;
  // App Engine at run time: "SQL.Fetch: parameter 1 is neither a record object nor a name. (2,284)".
  assert.deepEqual(codes(cls('   If Not &s.Fetch(&Descr, &baseClientId) Then\n      Return False;\n   End-If;'), true), ['PC008', 'PC008']);
  assert.match(checkPeopleCodeSemantics(cls('   If Not &s.Fetch(&Descr) Then\n   End-If;'), { applicationClass: true })[0].message, /neither a record object nor a name/);
  assert.deepEqual(codes(cls('   If Not &s.Fetch(&a, &b) Then\n      Return False;\n   End-If;\n   &Descr = &a;\n   &baseClientId = &b;'), true), []);
  // A Local that shadows the name is legal, and so is a record field.
  assert.deepEqual(codes(cls('   Local string &Descr;\n   If Not &s.Fetch(&Descr, &a) Then\n   End-If;'), true), []);
  assert.deepEqual(codes(cls('   If Not &s.Fetch(ZZ_BNV_AET.ZZ_BNV_CFG_ID, &a) Then\n   End-If;'), true), []);
});

test('a save refuses a program that breaks a rule, naming the line and the fix', () => {
  assert.throws(() => compileForSave('If &x = 1 Then\n   Return True;\nEnd-If;\n', { applicationClass: false, recordName: '', fieldName: '' }, '8.62'),
    (e: unknown) => e instanceof SaveRefusedError && /line 2: Return with a value outside a function.*\(PC003\)/s.test(e.message));
});

test('any colon inside a SQL comment is detected; clean comments and real binds are not', () => {
  // SQL.ZZ_BNV_PAYCAL2 documented its seven binds in a comment and so declared fourteen;
  // SQLExec failed at run time with "Invalid SqlExec bind variable. (2,166)".
  // Message 2,166: "Bind variables must be of the form ':n' ... or ':record.field'."
  // A documented marker is counted as a real bind; a colon in prose is an invalid one.
  assert.ok(bindMarkerInComment("/* binds: :1 plan year */\nSELECT A FROM T WHERE X = :1"));
  assert.equal(bindMarkerInComment("-- bind :2 company\nSELECT A FROM T WHERE X = :1"), ':2');
  // Removing the markers was not enough on HRDMO: the prose colon still failed.
  assert.ok(bindMarkerInComment("/* binds, in order: bind 1 plan year */\nSELECT A FROM T WHERE X = :1"));
  assert.ok(bindMarkerInComment("/* runs at 12:30 daily */\nSELECT A FROM T WHERE X = :1"));
  // A colon-free comment is fine, and real binds outside comments are untouched.
  assert.equal(bindMarkerInComment("/* binds, in order -- bind 1 plan year */\nSELECT A FROM T WHERE X = :1"), undefined);
  assert.equal(bindMarkerInComment('SELECT A FROM T WHERE X = :1 AND Y = :2'), undefined);
});
