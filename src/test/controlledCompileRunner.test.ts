import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertLabDatabase,
  buildPsideArguments,
  decodePsideLog,
  readPsideLog
} from '../peoplecode/corpus/controlledCompileRunner.js';
import { listProjectPrograms, replaceProgramSource } from '../peoplecode/corpus/projectFile.js';
import {
  checkLabCompile,
  synthesizeResults,
  type ExperimentPack
} from '../peoplecode/corpus/controlledCompile.js';

/*
 * Cycle 175: the unattended controlled-compile runner's pure parts.
 * The log fixtures are the 8.61.15 client's own -LF output (Wine, no
 * lab database yet): UTF-16LE, no BOM, CRLF.
 */
const utf16 = (text: string): Buffer => Buffer.from(text, 'utf16le');

const signon = { databaseType: 'ORACLE', database: 'PCLAB', operatorId: 'LABDEV', operatorPassword: 'lab-only' };

test('institutional databases are refused; lab names pass', () => {
  for (const name of ['HCDEV', 'hctst', 'HCPRDSRV', 'FSTST', 'HCPAY']) assert.throws(() => assertLabDatabase(name), /institutional/);
  assert.doesNotThrow(() => assertLabDatabase('PCLAB'));
  assert.throws(() => assertLabDatabase('PCLAB; DROP'), /Invalid database name/);
  assert.throws(() => buildPsideArguments({ kind: 'compile-all' }, { ...signon, database: 'HCDEV' }, 'x.log'), /institutional/);
});

test('one headless action per process: hide, quiet, no splash or sound, signon, action, log last', () => {
  assert.deepEqual(
    buildPsideArguments({ kind: 'compile-project', project: 'ZZ_PCODE_LAB', projectArgument: 'inline' }, signon, 'C:\\lab\\c.log'),
    ['-HIDE', '-QUIET', '-SS', 'NO', '-SN', 'NO', '-CT', 'ORACLE', '-CD', 'PCLAB', '-CO', 'LABDEV', '-CP', 'lab-only', '-CMPPRJPC', 'ZZ_PCODE_LAB', '-LF', 'C:\\lab\\c.log']);
  assert.deepEqual(
    buildPsideArguments({ kind: 'compile-project', project: 'ZZ_PCODE_LAB', projectArgument: 'pjm' }, signon, 'l').slice(14, 17),
    ['-PJM', 'ZZ_PCODE_LAB', '-CMPPRJPC']);
  assert.deepEqual(
    buildPsideArguments({ kind: 'copy-from-file', project: 'ZZ_PCODE_LAB', directory: 'Z:\\p' }, signon, 'l').slice(14, 18),
    ['-PJFF', 'ZZ_PCODE_LAB', '-FP', 'Z:\\p']);
  assert.throws(() => buildPsideArguments({ kind: 'compile-project', project: 'zz lab', projectArgument: 'inline' }, signon, 'l'), /Invalid project name/);
  assert.throws(() => buildPsideArguments({ kind: 'compile-all' }, { ...signon, operatorPassword: 'a\nb' }, 'l'), /line break/);
});

test('pside logs: UTF-16LE without BOM, signon failure and the ORA code', () => {
  const noListener = utf16('System Error : File: SQL Access ManagerSQL error. Stmt #: 2  Error Position: 0  Return: 12541 - ORA-12541: TNS:no listener \r\nSystem Error : Invalid User ID and password for signon.\r\n');
  const report = readPsideLog(noListener);
  assert.equal(report.signonFailed, true);
  assert.equal(report.sqlLibraryMissing, false);
  assert.deepEqual(report.oracleErrors, ['ORA-12541']);
  assert.equal(report.lines.length, 2);

  const badConnectId = readPsideLog(utf16('System Error : Invalid Connect ID or password for signon -- see your security administrator.\r\n'));
  assert.equal(badConnectId.signonFailed, true);
  assert.deepEqual(badConnectId.oracleErrors, []);

  const noClient = readPsideLog(utf16('System Error : Missing or invalid version of SQL library PSORA64\r\nSystem Error : Invalid User ID and password for signon.\r\n'));
  assert.equal(noClient.sqlLibraryMissing, true);

  assert.equal(decodePsideLog(Buffer.concat([Buffer.from([0xff, 0xfe]), utf16('Total 3 items processed.')])), 'Total 3 items processed.');
  assert.equal(readPsideLog(Buffer.from('Total 3 items processed.\r\n', 'utf8')).itemsProcessed, 3);
  assert.deepEqual(readPsideLog(Buffer.alloc(0)).lines, []);
});

const projectXml = (text: string, blob: string, objectValue2: string) => `<?xml version='1.0'?>
  <instance class="PCM">
    <rowset name="PcmProg" size="2240" count="1">
      <row>
        <eObjectID_0>104</eObjectID_0>
        <szObjectValue_0>ZZ_PCODE_LAB</szObjectValue_0>
        <eObjectID_1>105</eObjectID_1>
        <szObjectValue_1>ORDERING</szObjectValue_1>
        <eObjectID_2>107</eObjectID_2>
        <szObjectValue_2>${objectValue2}</szObjectValue_2>
        <eObjectID_3>12</eObjectID_3>
        <szObjectValue_3>OnExecute</szObjectValue_3>
        <eObjectID_4>0</eObjectID_4>
        <szObjectValue_4></szObjectValue_4>
        <eObjectID_5>0</eObjectID_5>
        <szObjectValue_5></szObjectValue_5>
        <eObjectID_6>0</eObjectID_6>
        <szObjectValue_6></szObjectValue_6>
      </row>
    </rowset>
    <peoplecode_text>${text}</peoplecode_text>
    <peoplecode_blob>${blob}</peoplecode_blob>
  </instance>
`;

test('project files: list programs; replace one source, keep the blob and the CRLF convention', () => {
  const xml = projectXml('class H1\r\nend-class;\r\n', 'QUJD', 'H1') + projectXml('class H2\r\nend-class;\r\n', 'REVG', 'H2');
  const programs = listProjectPrograms(xml);
  assert.deepEqual(programs.map(p => p.key.objectValues[2]), ['H1', 'H2']);
  assert.equal(programs[0].source, 'class H1\r\nend-class;\r\n');

  const key = { objectIds: [104, 105, 107, 12, 0, 0, 0], objectValues: ['ZZ_PCODE_LAB', 'ORDERING', 'H1', 'OnExecute', ' ', ' ', ' '] };
  const edited = replaceProgramSource(xml, key, 'method Run\n   Local string &s = "a<b & c";\nend-method;\n');
  const after = listProjectPrograms(edited);
  assert.equal(after[0].source, 'method Run\r\n   Local string &s = "a<b & c";\r\nend-method;\r\n');
  assert.match(edited, /&quot;a&lt;b &amp; c&quot;/);
  assert.equal(after[0].blob, 'QUJD');
  assert.equal(after[1].source, programs[1].source);
  assert.throws(() => replaceProgramSource(xml, { ...key, objectValues: ['ZZ_PCODE_LAB', 'ORDERING', 'H9', 'OnExecute'] }, 'x'), /found 0/);
});

test('a capture counts only if the lab compiled the experiment source', () => {
  const pack = JSON.parse(readFileSync(resolve(__dirname, '../../tools/corpus/controlled-compile/experiments.json'), 'utf8')) as ExperimentPack;
  const results = synthesizeResults({ ...pack, experiments: pack.experiments.filter(e => e.id === 'H4' || e.id === 'H5') });
  const h4 = results.definitions.find(d => d.experimentId === 'H4')!;
  const h5 = results.definitions.find(d => d.experimentId === 'H5')!;
  const source = pack.experiments.find(e => e.id === 'H4')!.source;

  assert.deepEqual(checkLabCompile(h4, source), { ok: true, reasons: [] });
  assert.match(checkLabCompile(h4, source, { sentinelProgramHex: h4.programHex }).reasons.join(), /sentinel/);
  assert.equal(checkLabCompile(h4, source, { sentinelProgramHex: h5.programHex }).ok, true);
  assert.match(checkLabCompile({ ...h4, source: h5.source }, source).reasons.join(), /PSPCMTXT source differs/);
  assert.match(checkLabCompile({ ...h4, programHex: h5.programHex, names: h5.names }, source).reasons.join(), /does not decode to the experiment source/);
  assert.match(checkLabCompile({ ...h4, programHex: '' }, source).reasons.join(), /no PSPCMPROG rows/);
  assert.match(checkLabCompile({ ...h4, compiledAt: '2026-10-05T10:00:00.000000' }, source, { compileStartedAt: '2026-10-05T10:00:01.000000' }).reasons.join(), /predates/);
  assert.equal(checkLabCompile({ ...h4, compiledAt: '2026-10-05T10:00:02.000000' }, source, { compileStartedAt: '2026-10-05T10:00:01.000000' }).ok, true);
});
