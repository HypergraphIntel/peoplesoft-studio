/*
 * Every writer, through the same DatabaseProvider methods the editors use, on
 * one database -- then each definition read back. Run with the same tag on
 * Oracle (HRDMO) and on the SQL Server / DB2 lab databases loaded from it
 * (load-fixture.mts), and the outputs compare: what each platform stored is
 * what Oracle stored, timestamps aside.
 *
 * WRITES. Lab databases only: HRDMO, or the local SQL Server / DB2 containers.
 *
 *   npx tsx tools/lab/writer-roundtrip.mts <oracle|mssql|db2> <TAG> <out.json>
 *
 * Environment: as load-fixture.mts; PSLAB_OPERATOR (default JARED).
 */
import { writeFileSync } from 'node:fs';
import { DatabaseProvider } from '../../src/providers/database';
import { DefinitionType, makeKey } from '../../src/model/definitions';
import { FieldType, RecordType } from '../../src/model/record';
import { insertField, setUse, type RecordEditState } from '../../src/model/recordEdit';
import { planCreateTables } from '../../src/model/recordBuild';
import { tableName as tableNameOf } from '../../src/model/recordDdl';

// ibm_db's async results wait for the event loop's next turn (src/db/db2.ts db2Call).
setInterval(() => { /* turn the loop */ }, 1).unref();

const [platform, tag, out] = process.argv.slice(2) as ['oracle' | 'mssql' | 'db2', string, string];
if (!['oracle', 'mssql', 'db2'].includes(platform) || !/^[A-Z0-9]{1,3}$/.test(tag ?? '') || !out) {
  throw new Error('usage: writer-roundtrip.mts <oracle|mssql|db2> <TAG (A-Z0-9, 1-3)> <out.json>');
}
const connection = {
  oracle: { connectString: process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo', user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! },
  mssql: { connectString: '127.0.0.1:15433/PSFT', user: 'sa', password: process.env.PSLAB_MSSQL_PASSWORD! },
  db2: { connectString: '127.0.0.1:15500/PSFT', user: 'db2inst1', password: process.env.PSLAB_DB2_PASSWORD! }
}[platform];
if (platform === 'oracle' && !/hrdmo/i.test(connection.connectString)) throw new Error('Oracle: the HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';

const p = new DatabaseProvider({ name: `LAB_${platform}`, platform, ...connection });
await p.connect();
const steps: Record<string, unknown> = {};
const n = (s: string) => `ZZ_X${tag}_${s}`;

async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    steps[name] = (await fn()) ?? null;
  } catch (e) {
    steps[name] = { error: (e as Error).message };
  }
  console.log(`${name}: ${JSON.stringify(steps[name]).slice(0, 160)}`);
}

try {
  // Project
  await step('project.create', () => p.createProject({ project: n('PRJ'), operatorId }));
  await step('project.version', () => p.readProjectVersion(n('PRJ')));

  // Fields
  await step('field.create.F1', () => p.createField({ name: n('F1'), type: FieldType.Character, length: 10, decimalPositions: 0,
    label: { id: n('F1'), longName: 'Lab field one', shortName: 'Lab F1' }, operatorId }));
  await step('field.create.F2', () => p.createField({ name: n('F2'), type: FieldType.Number, length: 5, decimalPositions: 0,
    label: { id: n('F2'), longName: 'Lab field two', shortName: 'Lab F2' }, operatorId }));
  await step('field.create.F3', () => p.createField({ name: n('F3'), type: FieldType.Character, length: 1, decimalPositions: 0,
    label: { id: n('F3'), longName: 'Lab status', shortName: 'Status' }, operatorId }));
  await step('field.read.F1', () => p.readField(makeKey(DefinitionType.Field, n('F1'))));
  await step('field.save.F1', async () => {
    const f = await p.readProperties(makeKey(DefinitionType.Field, n('F1')));
    return p.saveField({ name: n('F1'), openedVersion: Number(f?.row.VERSION), length: 12, description: 'Widened in the round trip.', operatorId });
  });
  await step('field.reread.F1', () => p.readField(makeKey(DefinitionType.Field, n('F1'))));

  // Translates
  const item = { value: 'A', effectiveDate: '1900-01-01', status: 'A', longName: 'Active', shortName: 'Act' };
  await step('xlat.add', () => p.saveTranslate(n('F3'), { kind: 'add', item }, operatorId));
  await step('xlat.change', () => p.saveTranslate(n('F3'), { kind: 'change', item: { ...item, longName: 'Active now' } }, operatorId));
  await step('xlat.add2', () => p.saveTranslate(n('F3'), { kind: 'add', item: { ...item, value: 'I', longName: 'Inactive', shortName: 'Inact' } }, operatorId));
  await step('xlat.delete', () => p.saveTranslate(n('F3'), { kind: 'delete', value: 'I', effectiveDate: '1900-01-01' }, operatorId));
  await step('xlat.read', () => p.readTranslates(n('F3')));

  // Record: create, read, build
  let edit: RecordEditState = { recname: n('R'), recordType: RecordType.Table, openedVersion: 0, isNew: true, fields: [] };
  edit = insertField(edit, n('F1'));
  edit = insertField(edit, n('F2'));
  edit = insertField(edit, n('F3'));
  edit = setUse(edit, 0, { key: true });
  await step('record.create', async () => {
    const r = await p.saveRecord({ edit, operatorId });
    return { version: r.version, plan: r.plan };
  });
  await step('record.layout', () => p.readRecordLayout(makeKey(DefinitionType.Record, n('R'))));
  await step('record.build', async () => {
    const layout = await p.readRecordLayout(makeKey(DefinitionType.Record, n('R')));
    const model = await p.readDdlModel(n('R'));
    if (!layout || !model) throw new Error('no layout or DDL model');
    const record = {
      name: n('R'), recordType: layout.recordType, sqlTableName: layout.sqlTableName ?? '',
      ...(layout.tablespace ? { tablespace: layout.tablespace } : {}),
      fields: layout.fields.map((f) => ({ name: f.name, type: f.type!, length: f.length ?? 0, decimalPositions: f.decimalPositions ?? 0,
        ...(f.format !== undefined ? { format: f.format } : {}), useEdit: f.useEdit }))
    };
    const table = tableNameOf(record);
    const before = await p.tableState(table);
    const plan = planCreateTables(record, model, 'recreate', before.exists);
    const ran = await p.executeBuild(plan.statements);
    return { script: plan.script, ran, after: await p.tableState(table) };
  });

  // SQL definition
  await step('sql.create', () => p.saveSqlDefinition({ sqlId: n('SQL'), text: 'SELECT EMPLID FROM PS_JOB', operatorId }));
  await step('sql.save', async () => {
    const opened = await p.readSqlForEdit(makeKey(DefinitionType.SqlDefinition, n('SQL')));
    return p.saveSqlDefinition({ sqlId: n('SQL'), text: 'SELECT EMPLID, EMPL_RCD\n  FROM PS_JOB\n WHERE EFFDT <= %CurrentDateIn', openedVersion: opened!.version, operatorId });
  });
  await step('sql.read', () => p.readSqlForEdit(makeKey(DefinitionType.SqlDefinition, n('SQL'))));

  // HTML
  await step('html.create', () => p.saveHtmlDefinition({ name: n('HTML'), text: '<div class="lab">Hello</div>', description: 'Lab HTML', operatorId }));
  await step('html.save', async () => {
    const opened = await p.readHtmlForEdit(makeKey(DefinitionType.HtmlDefinition, n('HTML'), '4'));
    return p.saveHtmlDefinition({ name: n('HTML'), text: '<div class="lab">Hello, %Bind(:1)</div>\n', openedVersion: opened!.version, operatorId });
  });
  await step('html.read', () => p.readHtmlForEdit(makeKey(DefinitionType.HtmlDefinition, n('HTML'), '4')));

  // Style sheet (freeform)
  await step('css.create', () => p.saveStyleSheet({ name: n('CSS'), text: '.lab { color: #333; }\n', description: 'Lab CSS', operatorId }));
  await step('css.save', async () => {
    const opened = await p.readStyleSheetForEdit(makeKey(DefinitionType.StyleSheet, n('CSS')));
    if (!opened || opened === 'classic') throw new Error('not freeform');
    return p.saveStyleSheet({ name: n('CSS'), text: '.lab { color: #222; margin: 0; }\n', openedVersion: opened.version, operatorId });
  });
  await step('css.read', () => p.readStyleSheetForEdit(makeKey(DefinitionType.StyleSheet, n('CSS'))));

  // Application Package and class; Record Field PeopleCode
  await step('package.create', () => p.createPackage({ name: n('PKG'), operatorId }));
  const classKey = makeKey(DefinitionType.ApplicationClassPeopleCode, n('PKG'), 'Greeter', 'OnExecute');
  await step('class.create', async () => {
    const r = await p.savePeopleCode(classKey, {
      source: 'class Greeter\n   method Greet(&name As string) Returns string;\nend-class;\n\nmethod Greet\n   /+ &name as String +/\n   /+ Returns String +/\n   Return "Hello, " | &name;\nend-method;\n',
      openedFingerprint: 'absent', operatorId, createClass: true
    });
    return { kind: r.kind, storedSource: r.storedSource };
  });
  await step('class.read', () => p.readText(classKey));
  const pcKey = makeKey(DefinitionType.RecordPeopleCode, n('R'), n('F1'), 'FieldChange');
  await step('recordpc.create', async () => {
    const opened = await p.readPeopleCodeForEdit(pcKey);
    const r = await p.savePeopleCode(pcKey, {
      source: 'Local string &s = ' + n('R') + '.' + n('F1') + ';\nIf None(&s) Then\n   WinMessage("Empty", 0);\nEnd-If;\n',
      openedFingerprint: opened?.fingerprint ?? 'absent', operatorId
    });
    return { kind: r.kind, storedSource: r.storedSource };
  });
  await step('recordpc.read', () => p.readText(pcKey));

  // Project items
  await step('project.save', async () => p.saveProject({
    project: n('PRJ'), operatorId, openedVersion: await p.readProjectVersion(n('PRJ')),
    add: [makeKey(DefinitionType.Record, n('R')), makeKey(DefinitionType.Field, n('F1')), makeKey(DefinitionType.SqlDefinition, n('SQL')),
      makeKey(DefinitionType.HtmlDefinition, n('HTML'), '4'), classKey, pcKey]
  }));
  await step('project.items', () => p.listProjectItems(n('PRJ')));

  // A second record, without PeopleCode: created, built, deleted, its table dropped.
  let edit2: RecordEditState = { recname: n('R2'), recordType: RecordType.Table, openedVersion: 0, isNew: true, fields: [] };
  edit2 = setUse(insertField(insertField(edit2, n('F1')), n('F2')), 0, { key: true });
  await step('record2.create', async () => (await p.saveRecord({ edit: edit2, operatorId })).version);
  await step('record2.build', async () => {
    const model = await p.readDdlModel(n('R2'));
    const layout = await p.readRecordLayout(makeKey(DefinitionType.Record, n('R2')));
    const record = { name: n('R2'), recordType: layout!.recordType, sqlTableName: '', ...(layout!.tablespace ? { tablespace: layout!.tablespace } : {}), fields: layout!.fields.map((f) => ({
      name: f.name, type: f.type!, length: f.length ?? 0, decimalPositions: f.decimalPositions ?? 0, useEdit: f.useEdit })) };
    const plan = planCreateTables(record, model!, 'recreate', (await p.tableState(tableNameOf(record))).exists);
    return { script: plan.script, ran: await p.executeBuild(plan.statements) };
  });
  await step('record2.delete', async () => {
    const layout = await p.readRecordLayout(makeKey(DefinitionType.Record, n('R2')));
    return p.deleteRecord({ recname: n('R2'), openedVersion: layout!.version, operatorId });
  });
  await step('record2.gone', async () => ({ status: await p.recordNameStatus(n('R2')), table: await p.tableState(`PS_${n('R2')}`) }));
  await step('record2.dropTable', () => p.executeBuild([`DROP TABLE PS_${n('R2')}`]));
} finally {
  await p.dispose();
}
writeFileSync(out, JSON.stringify(steps, null, 1));
console.log(`wrote ${out}`);
