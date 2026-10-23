import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeKey, DefinitionType } from '../model/definitions.js';
import { documentFromSpec } from '../model/aeSpec.js';
import { exportMigrationPackage, parseMigrationPackage, assetRequirements, type MigrationPackageReader } from '../migrationPackage.js';
import { portableProcess, UNCARRIED_PROCESS_TABLES } from '../providers/processMigration.js';
import type { ProcessView } from '../model/processDefinition.js';
import type { FileLayoutDocument } from '../model/fileLayoutDocument.js';

/* Process definitions and File Layouts in a promotion (V15-2): what ZZ_BENELIG_PROJ holds besides its pages and AE. */

const view = (over: Record<string, unknown> = {}): ProcessView => ({
  process: { PRCSTYPE: 'Application Engine', PRCSNAME: 'ZZ_PRC', DESCR: 'Benefits file', DESCRLONG: '', PRCSPRIORITY: '5', RUNLOCATION: '2', APIAWARE: '1', LOGRQST: '1',
    PRCSCATEGORY: 'Default', SERVERNAME: ' ', RECURNAME: ' ', PARMLISTTYPE: '0', PARMLIST: ' ', CMDLINETYPE: '0', CMDLINE: ' ', WORKINGDIRTYPE: '0', WORKINGDIR: ' ',
    OUTDESTTYPE: '0', OUTDESTFORMAT: ' ', OUTDESTSRC: '3', OUTDEST: ' ', RESTARTENABLED: '1', RECVRYPRCSTYPE: ' ', RECVRYPRCSNAME: ' ', RETRYCOUNT: 0,
    MAXCONCURRENT: 0, TIMEOUTMINUTES: 0, RETENTIONDAYS: 0, SQRRTFLAG: '0', FILEDEPEND: '0', PT_PRCS_EN_GEN_RUN: 'N', VERSION: 7, LASTUPDOPRID: 'JARED', LASTUPD: '2026-10-23 04:55:00', ...over },
  components: [{ PNLGRPNAME: 'ZZ_PRC_CMP' }], groups: [{ PRCSGRP: 'ZZ_PRC' }], translates: new Map()
});
const none = Object.fromEntries(UNCARRIED_PROCESS_TABLES.map(t => [t, 0]));

test('a process definition migrates its modeled properties, components and groups; anything else refuses', () => {
  const data = portableProcess(view(), none);
  assert.deepEqual([data.processType, data.name, data.components, data.groups], ['Application Engine', 'ZZ_PRC', ['ZZ_PRC_CMP'], ['ZZ_PRC']]);
  assert.equal(data.properties.DESCR, 'Benefits file');
  assert.equal(data.properties.RESTARTENABLED, '1');
  assert.equal('VERSION' in data.properties || 'LASTUPDOPRID' in data.properties, false);
  assert.throws(() => portableProcess(view(), { ...none, PS_PRCSDEFNNOTIFY: 1 }), /PS_PRCSDEFNNOTIFY are not migrated/);
  assert.throws(() => portableProcess(view({ PT_PRCS_EN_GEN_RUN: 'Y' }), none), /PT_PRCS_EN_GEN_RUN is not carried/);
});

const layout: FileLayoutDocument = { name: 'ZZ_FL', v: { FLDFORMAT: 1, DESCR: 'Benefits', DESCRLONG: null },
  segments: [{ name: 'ROW', parent: ' ', v: { RECNAME_FILE: ' ' }, fields: [{ name: 'EMPLID', v: { FLDFIELDTYPE: 0, FLDLENGTH: 11 } }] }] };

test('a project with a process definition, File Layout and AE step SQL exports one asset each, ordered by requirement', async () => {
  const sqlId = 'ZZ_PRC      MAIN    STEP01  S';
  const reader: MigrationPackageReader = {
    listProjectItems: async () => [makeKey(DefinitionType.ProcessDefinition, 'Application Engine', 'ZZ_PRC'), makeKey(DefinitionType.FileLayout, 'ZZ_FL'),
      makeKey(DefinitionType.AppEngineProgram, 'ZZ_PRC'), makeKey(DefinitionType.SqlDefinition, sqlId, '1')].map(key => ({ key })),
    readEnvironment: async () => ({ toolsRelease: '8.62' }),
    readTranslates: async () => [],
    readProcessForMigration: async (t: string, n: string) => t === 'Application Engine' && n === 'ZZ_PRC' ? { data: { ...portableProcess(view(), none), components: [] }, token: 'p' } : undefined,
    readFileLayoutForMigration: async (n: string) => n === 'ZZ_FL' ? { data: layout, token: 'f' } : undefined,
    readAppEngineDocument: async () => ({ token: 'a', doc: documentFromSpec({ program: 'ZZ_PRC', sections: [{ name: 'MAIN', steps: [{ name: 'STEP01', actions: [{ type: 'SQL', sql: 'UPDATE PS_INSTALLATION SET DUMMY = 1' }] }] }] }) })
  } as unknown as MigrationPackageReader;
  const pkg = await exportMigrationPackage(reader, 'ZZ_PRJ');
  assert.deepEqual(pkg.assets.map(a => a.kind).sort(), ['ae', 'filelayout', 'process']);
  assert.equal(pkg.members.length, 4, 'the step SQL stays a project member, carried by its program');
  const process = pkg.assets.find(a => a.kind === 'process')!;
  assert.deepEqual(process.key.parts, ['Application Engine', 'ZZ_PRC']);
  assert.deepEqual(assetRequirements(process).map(k => k.type), [DefinitionType.AppEngineProgram]);
  assert.deepEqual(pkg.requirements, [], 'the program it runs is in the package');
  const tampered = JSON.parse(JSON.stringify(pkg));
  tampered.assets.find((a: { kind: string }) => a.kind === 'process').key.parts[1] = 'ZZ_OTHER';
  assert.throws(() => parseMigrationPackage(JSON.stringify(tampered)));
});
