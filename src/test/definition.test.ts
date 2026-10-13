import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefinitionType } from '../model/definitions.js';
import { matchStoredKey, resolveReference } from '../peoplecode/definition.js';

test('a qualified application class path resolves from any segment', () => {
  const line = '   Local ZZ_PCODE_LAB:ORDERING:PARENT &x;';
  const at = line.indexOf('ORDERING') + 2; // cursor on the middle segment
  const ref = resolveReference(line, at);
  assert.ok(ref);
  assert.equal(ref!.type, DefinitionType.ApplicationClassPeopleCode);
  assert.deepEqual(ref!.parts, ['ZZ_PCODE_LAB', 'ORDERING', 'PARENT']);
  assert.equal(line.slice(ref!.start, ref!.end), 'ZZ_PCODE_LAB:ORDERING:PARENT');
});

test('an import of a specific class resolves; a wildcard import does not', () => {
  const specific = 'import ZZ_PCODE_LAB:ORDERING:PARENT;';
  assert.deepEqual(resolveReference(specific, specific.indexOf('PARENT'))!.parts,
    ['ZZ_PCODE_LAB', 'ORDERING', 'PARENT']);

  const wildcard = 'import ZZ_PCODE_LAB:ORDERING:*;';
  // Cursor on the package path of a `:*` import: no single class to go to.
  assert.equal(resolveReference(wildcard, wildcard.indexOf('ORDERING')), undefined);
});

test('a two-segment class path (package:class, no subpackage) resolves', () => {
  const line = '&h = create PT_RCF:ServiceInterface();';
  const ref = resolveReference(line, line.indexOf('ServiceInterface'));
  assert.ok(ref);
  assert.equal(ref!.type, DefinitionType.ApplicationClassPeopleCode);
  assert.deepEqual(ref!.parts, ['PT_RCF', 'ServiceInterface']);
});

test('Keyword.NAME references map to their definition type', () => {
  const cases: Array<[string, DefinitionType, string]> = [
    ['&r = CreateRecord(Record.JOB);', DefinitionType.Record, 'JOB'],
    ['&p = Page.JOB_DATA1;', DefinitionType.Page, 'JOB_DATA1'],
    ['GetLevel0()(1).GetRowset(Scroll.DEPENDENT_BENEF);', DefinitionType.Record, 'DEPENDENT_BENEF'],
    ['&c = Component.JOB_DATA;', DefinitionType.Component, 'JOB_DATA'],
    ['SQLExec(SQL.MY_SQL, &x);', DefinitionType.SqlDefinition, 'MY_SQL'],
    ['&t = GetHTMLText(HTML.PT_BANNER);', DefinitionType.HtmlDefinition, 'PT_BANNER'],
    ['&f = Field.EMPLID;', DefinitionType.Field, 'EMPLID']
  ];
  for (const [line, type, name] of cases) {
    const ref = resolveReference(line, line.indexOf(name));
    assert.ok(ref, `no ref for: ${line}`);
    assert.equal(ref!.type, type, line);
    assert.deepEqual(ref!.parts, [name], line);
  }
});

test('the dot reference resolves whether the cursor is on the keyword or the name', () => {
  const line = '&r = Record.JOB;';
  const onKeyword = resolveReference(line, line.indexOf('Record') + 2);
  const onName = resolveReference(line, line.indexOf('JOB'));
  assert.ok(onKeyword);
  assert.deepEqual(onKeyword, onName);
});

test('a method or property call is not a definition reference', () => {
  assert.equal(resolveReference('&x.DoThing();', 4), undefined);
  assert.equal(resolveReference('&rs.ActiveRowCount;', 6), undefined);
});

test('nothing resolves off the reference, or on an unknown keyword', () => {
  const line = '&r = CreateRecord(Record.JOB);';
  assert.equal(resolveReference(line, 0), undefined); // on "&r"
  assert.equal(resolveReference('&x = Rowset.Thing;', 10), undefined); // "Rowset" is not a definition keyword
});

test('matchStoredKey picks the key with the same parts, case-insensitively, and the right type', () => {
  const ref = resolveReference('import pt_rcf:serviceinterface;', 10)!;
  const stored = matchStoredKey(ref, [
    { type: DefinitionType.Record, parts: ['PT_RCF'] },
    { type: DefinitionType.ApplicationClassPeopleCode, parts: ['PT_RCF', 'ServiceInterface'] },
    { type: DefinitionType.ApplicationClassPeopleCode, parts: ['PT_RCF', 'Other'] }
  ]);
  assert.deepEqual(stored, { type: DefinitionType.ApplicationClassPeopleCode, parts: ['PT_RCF', 'ServiceInterface'] });
});

test('matchStoredKey returns undefined when nothing matches', () => {
  const ref = resolveReference('&r = CreateRecord(Record.NOPE);', 26)!;
  assert.equal(matchStoredKey(ref, [{ type: DefinitionType.Record, parts: ['JOB'] }]), undefined);
});
