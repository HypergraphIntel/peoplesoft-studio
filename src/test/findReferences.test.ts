import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { ProjectFileProvider } from '../providers/projectFile.js';
import { DefinitionType } from '../model/definitions.js';
import { findPeopleCodeReferences, occurrences } from '../peoplecode/findReferences.js';
import { translateSql } from '../db/sqlTranslate.js';

const FIXTURE = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'sample-project.xml');

test('an identifier matches as a whole word, case-insensitively; other text as a substring', () => {
  const text = 'Local Record &JOB = CreateRecord(Record.JOB);\n   &x = JOB_DATA.EMPLID;\nWarning ("job done");';
  assert.deepEqual(occurrences(text, 'job').map((o) => [o.line, o.column]), [[0, 40], [2, 10]], 'JOB, not JOB_DATA or &JOB');
  assert.deepEqual(occurrences(text, 'Record.JOB').map((o) => o.line), [0]);
  assert.deepEqual(occurrences(text, '&job').map((o) => [o.line, o.column]), [[0, 13]]);
  assert.deepEqual(occurrences(text, 'job done').map((o) => o.line), [2], 'text that is not an identifier matches anywhere');
  assert.equal(occurrences(text, 'JOB_DATA')[0].context, '&x = JOB_DATA.EMPLID;');
  assert.deepEqual(occurrences(text, '   '), []);
});

test('a project export is scanned program by program', async () => {
  const p = new ProjectFileProvider(FIXTURE, 'fixture');
  await p.connect();
  const r = await findPeopleCodeReferences(p, '%response');
  assert.equal(r.truncated, false);
  assert.ok(r.scanned >= 2, `scanned ${r.scanned}`);
  assert.equal(r.programs, 1);
  assert.deepEqual(r.hits.map((h) => [h.key.type, h.key.parts.join('.'), h.line]), [[DefinitionType.RecordPeopleCode, 'WEBLIB_DEMO.ISCRIPT1.FieldFormula', 3]]);
  assert.deepEqual((await findPeopleCodeReferences(p, 'Render')).hits.map((h) => h.key.parts.join('.')), ['DEMO_PACK.Layout.Engine']);
  assert.equal((await findPeopleCodeReferences(p, 'NoSuchSymbol')).hits.length, 0);
});

test("the database search's SQL is one every platform takes", () => {
  const sql = `SELECT DISTINCT OBJECTID1, OBJECTVALUE1 FROM PSPCMTXT WHERE UPPER(PCTEXT) LIKE :p ESCAPE '\\'
    ORDER BY OBJECTVALUE1 FETCH FIRST :lim ROWS ONLY`;
  for (const platform of ['mssql', 'db2'] as const) {
    const t = translateSql(sql, platform, { p: '%\\_X%', lim: 201 });
    assert.match(t.sql, /LIKE (@p|\?) ESCAPE '\\'/, platform);
  }
});
