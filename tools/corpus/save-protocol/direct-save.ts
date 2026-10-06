/*
 * Cycle 185: a native PeopleCode save from the command line, through the
 * same OracleProvider.savePeopleCode the editor uses -- for the direct-save
 * matrix that is compared against App Designer's saves.
 *
 * WRITES to the database. Refuses any database but the expected lab
 * (HRDMO by default) and any protected institutional database; the writer
 * itself refuses anything outside ZZ_PCODE_LAB.
 *
 *   npx tsx tools/corpus/save-protocol/direct-save.ts --operator JARED \
 *     --record ZZ_PCODE_LAB.ZZ_PCODE_LAB_C01.FieldChange --source 'Local number &n = 1;'
 *   npx tsx tools/corpus/save-protocol/direct-save.ts --operator JARED \
 *     --class ZZ_PCODE_LAB:SUPPORT:SmokeTest --source-file /path/to/source.pcode
 *
 * --source '' saves an empty program (a delete). Connection: PSLAB_ACCESSID /
 * PSLAB_ACCESSPSWD, PSLAB_AUDIT_CONNECT (default 127.0.0.1:15210/hrdmo).
 */
import { readFileSync } from 'node:fs';

import { OracleProvider } from '../../../src/providers/oracle';
import { DefinitionType, makeKey, type DefinitionKey } from '../../../src/model/definitions';
import { PROTECTED_DATABASE_PATTERN } from '../../../src/peoplecode/corpus/controlledCompileRunner';

function argument(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const expected = argument('database') ?? 'HRDMO';
  if (PROTECTED_DATABASE_PATTERN.test(expected)) throw new Error(`${expected} is a protected institutional database: refusing.`);
  const operatorId = argument('operator');
  if (!operatorId) throw new Error('--operator is required.');

  let key: DefinitionKey;
  const record = argument('record');
  const cls = argument('class');
  if (record) key = makeKey(DefinitionType.RecordPeopleCode, ...record.split('.'));
  else if (cls) key = makeKey(DefinitionType.ApplicationClassPeopleCode, ...cls.split(':'));
  else throw new Error('--record REC.FIELD.EVENT or --class PKG:...:CLASS is required.');

  const sourceFile = argument('source-file');
  const source = sourceFile !== undefined ? readFileSync(sourceFile, 'utf8') : argument('source');
  if (source === undefined) throw new Error('--source or --source-file is required.');

  const user = process.env.PSLAB_ACCESSID;
  const password = process.env.PSLAB_ACCESSPSWD;
  if (!user || !password) throw new Error('PSLAB_ACCESSID and PSLAB_ACCESSPSWD must be set.');
  const provider = new OracleProvider({
    name: expected, user, password, connectString: process.env.PSLAB_AUDIT_CONNECT ?? '127.0.0.1:15210/hrdmo'
  });
  await provider.connect();
  try {
    // The database must be the one named; checked before anything is read for writing.
    const identity = await (provider as unknown as {
      withConnection<T>(fn: (c: import('oracledb').Connection) => Promise<T>): Promise<T>
    }).withConnection(async (c) => {
      const r = await c.execute<{ DB: string }>(`SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS DB FROM DUAL`);
      return String(r.rows?.[0]?.DB ?? '').trim();
    });
    if (PROTECTED_DATABASE_PATTERN.test(identity)) throw new Error(`Connected to ${identity}, a protected institutional database: refusing.`);
    if (identity.toUpperCase() !== expected.toUpperCase()) throw new Error(`Connected to ${identity}, not ${expected}: refusing.`);

    const opened = (await provider.readPeopleCodeForEdit(key)) ?? { text: '', fingerprint: 'absent' };
    console.log(`opened ${key.parts.join('.')} (fingerprint ${opened.fingerprint.slice(0, 12)}...)`);
    // --fingerprint simulates an editor that opened an older version.
    const token = argument('fingerprint') ?? opened.fingerprint;
    const result = await provider.savePeopleCode(key, { source, openedFingerprint: token, operatorId });
    console.log(JSON.stringify({
      kind: result.kind, version: result.version, lastupddttm: result.lastupddttm,
      fingerprint: result.fingerprint.slice(0, 12), storedSource: result.storedSource,
      replaced: { text: result.before.text.length, program: result.before.program.length, names: result.before.names.length }
    }, null, 1));
    console.log('Saved, verified in the transaction and again after COMMIT.');
  } finally {
    await provider.dispose();
  }
}

main().catch((error) => {
  console.error(`${error?.name ?? 'Error'}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
