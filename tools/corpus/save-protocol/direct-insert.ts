/*
 * A native project insert from the command line, through the same
 * OracleProvider.saveProject the Insert Into Project command uses --
 * compared against App Designer's insert (case p01).
 *
 * WRITES to the database. Refuses any database but the expected lab
 * (HRDMO by default), any protected institutional database, and any
 * project outside ZZ_PCODE_LAB%.
 *
 *   npx tsx tools/corpus/save-protocol/direct-insert.ts --operator JARED \
 *     --project ZZ_PCODE_LAB_01 --type 2 --key ZZ_PCODE_LAB_C03
 *
 * --key is the definition key's parts joined by '.' (--type is its
 * DefinitionType). --opened-version N presents N as the project VERSION the
 * change was made against, as a staged save does. Connection: PSLAB_ACCESSID / PSLAB_ACCESSPSWD,
 * PSLAB_AUDIT_CONNECT (default 127.0.0.1:15210/hrdmo).
 */
import { OracleProvider } from '../../../src/providers/oracle';
import { makeKey } from '../../../src/model/definitions';
import { PROTECTED_DATABASE_PATTERN } from '../../../src/peoplecode/corpus/controlledCompileRunner';
import { isScratchName } from '../../../src/peoplecode/corpus/labSafety';

function argument(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const expected = argument('database') ?? 'HRDMO';
  if (PROTECTED_DATABASE_PATTERN.test(expected)) throw new Error(`${expected} is a protected institutional database: refusing.`);
  const operatorId = argument('operator');
  const project = argument('project');
  const type = Number(argument('type'));
  const parts = argument('key')?.split('.');
  if (!operatorId || !project || !Number.isInteger(type) || !parts) {
    throw new Error('--operator, --project, --type and --key are required.');
  }
  if (!isScratchName(project)) throw new Error(`${project} is outside ZZ_PCODE_LAB: this lab tool writes scratch projects only.`);
  const key = makeKey(type, ...parts);

  const user = process.env.PSLAB_ACCESSID;
  const password = process.env.PSLAB_ACCESSPSWD;
  if (!user || !password) throw new Error('PSLAB_ACCESSID and PSLAB_ACCESSPSWD must be set.');
  const provider = new OracleProvider({
    name: expected, user, password, connectString: process.env.PSLAB_AUDIT_CONNECT ?? '127.0.0.1:15210/hrdmo'
  });
  await provider.connect();
  try {
    const identity = await (provider as unknown as {
      withConnection<T>(fn: (c: import('oracledb').Connection) => Promise<T>): Promise<T>
    }).withConnection(async (c) => {
      const r = await c.execute<{ DB: string }>(`SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS DB FROM DUAL`);
      return String(r.rows?.[0]?.DB ?? '').trim();
    });
    if (PROTECTED_DATABASE_PATTERN.test(identity)) throw new Error(`Connected to ${identity}, a protected institutional database: refusing.`);
    if (identity.toUpperCase() !== expected.toUpperCase()) throw new Error(`Connected to ${identity}, not ${expected}: refusing.`);

    const opened = argument('opened-version');
    const result = await provider.saveProject({
      project, operatorId, add: [key], ...(opened !== undefined ? { openedVersion: Number(opened) } : {})
    });
    console.log(JSON.stringify(result, null, 1));
    console.log('Inserted, verified in the transaction and again after COMMIT.');
  } finally {
    await provider.dispose();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
