/*
 * A record deleted from the command line, through the same
 * OracleProvider.deleteRecord the Delete Record command uses -- compared
 * against App Designer's (case r40).
 *
 * WRITES to the database. Refuses any database but the expected lab (HRDMO
 * by default) and any protected institutional database; the writer itself
 * refuses anything outside ZZ_PCODE_LAB and any record still in use.
 *
 *   npx tsx tools/corpus/save-protocol/direct-record-delete.ts --operator JARED --record ZZ_PCODE_LAB_R4 --confirm ZZ_PCODE_LAB_R4
 */
import { OracleProvider } from '../../../src/providers/oracle';
import { DefinitionType, makeKey } from '../../../src/model/definitions';
import { PROTECTED_DATABASE_PATTERN } from '../../../src/peoplecode/corpus/controlledCompileRunner';

function argument(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const expected = argument('database') ?? 'HRDMO';
  if (PROTECTED_DATABASE_PATTERN.test(expected)) throw new Error(`${expected} is a protected institutional database: refusing.`);
  const operatorId = argument('operator');
  const recname = argument('record');
  if (!operatorId || !recname) throw new Error('--operator and --record are required.');
  if (argument('confirm') !== recname) throw new Error(`Deleting is permanent: repeat the record name with --confirm ${recname}.`);
  const user = process.env.PSLAB_ACCESSID;
  const password = process.env.PSLAB_ACCESSPSWD;
  if (!user || !password) throw new Error('PSLAB_ACCESSID and PSLAB_ACCESSPSWD must be set.');
  const provider = new OracleProvider({ name: expected, user, password, connectString: process.env.PSLAB_AUDIT_CONNECT ?? '127.0.0.1:15210/hrdmo' });
  await provider.connect();
  try {
    const identity = await (provider as unknown as {
      withConnection<T>(fn: (c: import('oracledb').Connection) => Promise<T>): Promise<T>
    }).withConnection(async (c) => String((await c.execute<{ DB: string }>(`SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS DB FROM DUAL`)).rows?.[0]?.DB ?? '').trim());
    if (PROTECTED_DATABASE_PATTERN.test(identity)) throw new Error(`Connected to ${identity}, a protected institutional database: refusing.`);
    if (identity.toUpperCase() !== expected.toUpperCase()) throw new Error(`Connected to ${identity}, not ${expected}: refusing.`);
    const layout = await provider.readRecordLayout(makeKey(DefinitionType.Record, recname));
    if (!layout) throw new Error(`No record ${recname}.`);
    console.log(JSON.stringify(await provider.deleteRecord({ recname, openedVersion: layout.version, operatorId })));
    console.log('Deleted, checked in the transaction and again after COMMIT.');
  } finally {
    await provider.dispose();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
