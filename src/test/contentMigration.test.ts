import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DbConnection } from '../db/connection.js';
import { htmlChunks } from '../providers/htmlWriter.js';
import { readContentMigration } from '../providers/contentMigration.js';

function fixture(kind: 'html' | 'stylesheet') {
  const header: Record<string, unknown> = { CONTNAME: 'ZZ_TEXT', ALTCONTNUM: 1, CONTFMT: ' ', VERSION: 12, CONTTYPE: kind === 'html' ? 4 : 9,
    CONTSTYLE: 0, DESCR: kind === 'html' ? 'Description' : ' ', URL: ' ', COMPALG: 0, AUXFLAGMASK: 0, OBJECTOWNERID: ' ', STAMP: '2026-10-20T12:00:00.000000', LASTUPDOPRID: 'JARED' };
  const sheet: Record<string, unknown> = { STYLESHEETNAME: 'ZZ_TEXT', VERSION: 44, STYLESHEETTYPE: 2, PARENTSTYLENAME: ' ', DESCR: 'CSS description', NUMSTYLECLASS: 0, OBJECTOWNERID: ' ', STAMP: header.STAMP, LASTUPDOPRID: 'JARED' };
  const text = '/* ' + 'é😀'.repeat(11000) + ' */\r\n';
  const rows = htmlChunks(text).map((CONTDATA, SEQNUM) => ({ CONTDATA, SEQNUM, ALTCONTNUM: 1, CONTTYPE: header.CONTTYPE }));
  let extras = 0;
  const statements: string[] = [];
  const c = { execute: async (sql: string) => {
    statements.push(sql);
    if (sql.includes('COUNT(*)')) return { rows: [{ N: extras }] };
    if (sql.includes('FROM PSSTYLSHEETDEFN')) return { rows: [{ ...sheet }] };
    if (sql.includes('FROM PSCONTDEFN')) return { rows: [{ ...header }] };
    if (sql.includes('FROM PSCONTENT')) return { rows: rows.map(r => ({ ...r, CONTDATA: Buffer.from(r.CONTDATA) })) };
    throw new Error(sql);
  } } as unknown as DbConnection;
  return { c, header, sheet, rows, text, statements, extra: () => { extras++; } };
}

test('complete HTML/CSS migration reads all native chunks and detects unchanged-version metadata/text edits', async () => {
  for (const kind of ['html', 'stylesheet'] as const) {
    const f = fixture(kind), read = (await readContentMigration(f.c, 'ZZ_TEXT', kind, true))!;
    assert.equal(read.data.text, f.text);
    assert.equal(read.version, kind === 'html' ? 12 : 44);
    f.rows[0].CONTDATA.writeUInt16LE(65, 10);
    const changed = (await readContentMigration(f.c, 'ZZ_TEXT', kind))!;
    assert.notEqual(read.token, changed.token);
    assert.equal(read.version, changed.version);
    assert.ok(f.statements.some(s => s.includes('PSCONTENT') && s.endsWith('FOR UPDATE')));
  }
});

test('content migration refuses metadata loss, alternate content, classic stylesheets and malformed bytes', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.header.OBJECTOWNERID = 'PPT'; },
    (f: ReturnType<typeof fixture>) => { f.header.URL = 'https://example.com'; },
    (f: ReturnType<typeof fixture>) => { f.header.AUXFLAGMASK = 1; },
    (f: ReturnType<typeof fixture>) => { f.rows[0].ALTCONTNUM = 2; },
    (f: ReturnType<typeof fixture>) => { f.rows[0].SEQNUM = 99; },
    (f: ReturnType<typeof fixture>) => { f.rows.at(-1)!.CONTDATA = Buffer.from('invalid'); },
    (f: ReturnType<typeof fixture>) => { f.extra(); },
  ]) {
    const f = fixture('html'); mutate(f);
    await assert.rejects(readContentMigration(f.c, 'ZZ_TEXT', 'html'), /migration|requires another/);
  }
  const css = fixture('stylesheet'); css.sheet.STYLESHEETTYPE = 0;
  await assert.rejects(readContentMigration(css.c, 'ZZ_TEXT', 'stylesheet'), /migration requires/);
});
