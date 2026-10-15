import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA_MOVER_TEMPLATES, dataMoverLanguage } from '../model/dataMoverTemplates.js';

test('Data Mover templates offer export, import, replace-all, a header and an empty script', () => {
  assert.deepEqual(DATA_MOVER_TEMPLATES.map(template => template.label), [
    'Export records', 'Import records', 'Replace all records', 'Log and output header', 'Empty script'
  ]);
  assert.equal(DATA_MOVER_TEMPLATES.find(template => template.label === 'Empty script')!.content, '');
});

for (const template of DATA_MOVER_TEMPLATES.filter(template => template.content)) {
  test(`${template.label}: statements terminate and placeholders are explicit`, () => {
    const lines = template.content.trim().split('\n');
    assert.ok(lines.some(line => line.startsWith('-- Replace <path>')), 'explain placeholders');
    const statements = lines.filter(line => !line.startsWith('--'));
    assert.ok(statements.length > 0);
    for (const statement of statements) {
      assert.match(statement, /;$/, statement);
      assert.match(statement, /^(SET (LOG|OUTPUT|INPUT) <path>\/\S+|EXPORT RECNAME WHERE FIELDNAME = '<value>'|IMPORT RECNAME|REPLACE_ALL RECNAME);$/);
    }
    assert.match(template.content, /SET LOG <path>\/\S+;/);
    if (template.label === 'Export records') assert.match(template.content, /EXPORT RECNAME WHERE FIELDNAME = '<value>';/);
    if (template.label === 'Import records') assert.match(template.content, /SET INPUT <path>\/export.dat;\nIMPORT RECNAME;/);
    if (template.label === 'Replace all records') {
      assert.match(template.content, /SET INPUT <path>\/export.dat;\nREPLACE_ALL RECNAME;/);
      assert.match(template.content, /-- REPLACE_ALL deletes all existing rows/);
    }
  });
}

test('Data Mover language comes from the .dms contribution rather than a guessed id', () => {
  assert.equal(dataMoverLanguage({ contributes: { languages: [
    { id: 'unrelated', extensions: ['.sql'] },
    { id: 'extension-defined-id', extensions: ['.other', '.dms'] }
  ] } }), 'extension-defined-id');
});

test('missing or malformed language contributions fall back to plaintext', () => {
  for (const packageJSON of [undefined, null, {}, { contributes: {} }, { contributes: { languages: {} } },
    { contributes: { languages: [null, {}, { id: 'wrong', extensions: ['.sql'] }, { extensions: ['.dms'] }, { id: '', extensions: ['.dms'] }] } }]) {
    assert.equal(dataMoverLanguage(packageJSON), undefined);
  }
});
