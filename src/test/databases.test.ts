import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMssqlConnectString } from '../db/mssql.js';
import { db2ConnectionString, parseDb2ConnectString } from '../db/db2.js';
import { isDatabaseKind } from '../db/open.js';
import { Serial } from '../db/connection.js';
import { namedBinds } from '../db/sqlTranslate.js';
import { validateConnectString } from '../settings/settingsModel.js';
import { columnType, createTableScript, ddlPlatformFor, type DdlModel, type DdlRecord } from '../model/recordDdl.js';
import { planCreateTables, scriptStatements } from '../model/recordBuild.js';
import { FieldType, RecordType, UseEdit } from '../model/record.js';

test('SQL Server connect strings: host[\\instance][:port]/database', () => {
  assert.deepEqual(parseMssqlConnectString('sqlhost:1433/HCM92'), { server: 'sqlhost', port: 1433, database: 'HCM92' });
  assert.deepEqual(parseMssqlConnectString('sqlhost\\PSFT/HCM92'), { server: 'sqlhost', instanceName: 'PSFT', database: 'HCM92' });
  assert.deepEqual(parseMssqlConnectString('sqlhost\\PSFT:14330/HCM92'), { server: 'sqlhost', instanceName: 'PSFT', port: 14330, database: 'HCM92' });
  assert.throws(() => parseMssqlConnectString('sqlhost:1433'), /host\[\\instance\]\[:port\]\/database/);
});

test('DB2 connect strings: host[:port]/database, as a CLI connection string', () => {
  assert.deepEqual(parseDb2ConnectString('db2host:50000/HCM92'), { host: 'db2host', port: 50000, database: 'HCM92' });
  assert.deepEqual(parseDb2ConnectString('db2host/DSNLOC1'), { host: 'db2host', port: 50000, database: 'DSNLOC1' });
  assert.equal(db2ConnectionString({ host: 'h', port: 1, database: 'D' }, 'u', 'p;w{d}', 'PSFT'),
    'DATABASE=D;HOSTNAME=h;PORT=1;PROTOCOL=TCPIP;UID=u;PWD={p;w{d}}};CURRENTSCHEMA=PSFT;');
});

test('the connect string is checked as its platform writes it', () => {
  assert.equal(validateConnectString('sqlhost:1433/HCM92', 'mssql'), undefined);
  assert.equal(validateConnectString('sqlhost\\PSFT/HCM92', 'mssql'), undefined);
  assert.match(validateConnectString('sqlhost:1433', 'mssql') ?? '', /host\[\\instance\]/);
  assert.match(validateConnectString('db2host:99999/D', 'db2') ?? '', /Port/);
  assert.equal(validateConnectString('db2host/D', 'db2'), undefined);
  // Oracle accepts a TNS alias as before.
  assert.equal(validateConnectString('HRDMO', 'oracle'), undefined);
});

test('database kinds', () => {
  assert.ok(['oracle', 'mssql', 'db2'].every(isDatabaseKind));
  assert.ok(!isDatabaseKind('projectFile'));
});

test('a connection\'s calls run one at a time, in order, past a failure', async () => {
  const serial = new Serial();
  const log: string[] = [];
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const a = serial.run(async () => { await wait(20); log.push('a'); });
  const b = serial.run(async () => { log.push('b'); throw new Error('b failed'); });
  const c = serial.run(async () => { log.push('c'); return 3; });
  await a;
  await assert.rejects(b, /b failed/);
  assert.equal(await c, 3);
  assert.deepEqual(log, ['a', 'b', 'c']);
});

test('positional binds are named by the statement\'s variables in order', () => {
  assert.deepEqual(namedBinds('SELECT * FROM T WHERE A = :b0 AND B = :b1', ['x', 2]), { b0: 'x', b1: 2 });
  assert.throws(() => namedBinds('SELECT 1 FROM T WHERE A = :a', [1, 2]), /2 positional binds for 1/);
});

const field = (name: string, type: FieldType, length: number, useEdit = 0, decimalPositions = 0) =>
  ({ name, type, length, decimalPositions, useEdit });

const RECORD: DdlRecord = {
  name: 'ZZ_LAB', recordType: RecordType.Table, sqlTableName: '',
  fields: [
    field('EMPLID', FieldType.Character, 11, UseEdit.Key),
    field('DESCRLONG', FieldType.LongCharacter, 0),
    field('AMOUNT', FieldType.SignedNumber, 12, 0, 2),
    field('EFFDT', FieldType.Date, 10, UseEdit.Key | UseEdit.Required),
    field('LASTUPDDTTM', FieldType.DateTime, 26)
  ]
};

test('SQL Server columns and script (PSDDLMODEL platform 7)', () => {
  assert.equal(columnType(field('A', FieldType.Character, 30), 'mssql'), 'NVARCHAR(30)');
  assert.equal(columnType(field('A', FieldType.LongCharacter, 254), 'mssql'), 'NVARCHAR(MAX)');
  assert.equal(columnType({ ...field('A', FieldType.LongCharacter, 0), format: 7 }, 'mssql'), 'VARBINARY(MAX)');
  assert.equal(columnType(field('A', FieldType.Time, 15), 'mssql'), 'DATETIME');
  const model: DdlModel = {
    platform: 'mssql', table: 'CREATE TABLE [TBNAME] ([TBCOLLIST]);', index: 'CREATE [UNIQUE] [CLUSTER] INDEX [IDXNAME] ON [TBNAME] ([IDXCOLLIST]);',
    tableParms: {}, indexParms: {}
  };
  const script = createTableScript(RECORD, model);
  assert.equal(script, [
    'CREATE TABLE PS_ZZ_LAB (EMPLID NVARCHAR(11) NOT NULL,',
    '   AMOUNT DECIMAL(10, 2) NOT NULL,',
    '   EFFDT DATE NOT NULL,',
    '   LASTUPDDTTM DATETIME,',
    '   DESCRLONG NVARCHAR(MAX))',
    'go',
    'CREATE UNIQUE CLUSTERED INDEX PS_ZZ_LAB ON PS_ZZ_LAB (EMPLID,',
    '   EFFDT)',
    'go',
    ''
  ].join('\n'));
  const plan = planCreateTables(RECORD, model, 'recreate', true);
  assert.equal(plan.statements[0], 'DROP TABLE PS_ZZ_LAB');
  assert.equal(plan.statements.length, 3);
  assert.ok(!plan.statements.some((s) => /\bgo\b/.test(s)));
});

test('DB2 LUW columns and script (PSDDLMODEL platform 4)', () => {
  assert.equal(columnType(field('A', FieldType.Character, 30), 'db2'), 'VARGRAPHIC(30)');
  assert.equal(columnType(field('A', FieldType.Character, 30), 'db2zos'), 'VARCHAR(30)');
  assert.equal(columnType(field('A', FieldType.Time, 15), 'db2'), 'TIME');
  assert.equal(columnType(field('A', FieldType.DateTime, 26), 'db2'), 'TIMESTAMP');
  const model: DdlModel = {
    platform: 'db2',
    table: 'CREATE TABLE [TBNAME] ([TBCOLLIST]) IN [TBSPCNAME] INDEX IN [TBSPCNAME]IDX [DBXLOBTBSPCNAME] NOT LOGGED INITIALLY;',
    index: 'CREATE [UNIQUE] INDEX [IDXNAME] ON [TBNAME] ([IDXCOLLIST]);', tableParms: {}, indexParms: {}
  };
  // With a table space of its own: the model as it is.
  const spaced = createTableScript({ ...RECORD, tablespace: 'HRAPP' }, model);
  assert.match(spaced, /\) IN HRAPP INDEX IN HRAPPIDX NOT LOGGED\n? ?INITIALLY;/);
  // Without one: the database's default.
  const plain = createTableScript(RECORD, model);
  assert.match(plain, /DESCRLONG DBCLOB\(100M\)\) NOT LOGGED INITIALLY;\n/);
  assert.deepEqual(scriptStatements(plain, 'db2').map((s) => s.split(' ').slice(0, 3).join(' ')),
    ['CREATE TABLE PS_ZZ_LAB', 'CREATE UNIQUE INDEX']);
  assert.equal(planCreateTables(RECORD, model, 'recreate', true).statements[0], 'DROP TABLE PS_ZZ_LAB');
});

test('PSDDLMODEL platform IDs', () => {
  assert.deepEqual([2, 7, 4, 1].map(ddlPlatformFor), ['oracle', 'mssql', 'db2', 'db2zos']);
});
