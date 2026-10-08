/*
 * A native freeform style sheet save from the command line, through the same
 * DatabaseProvider.saveStyleSheet the editor uses -- compared against App
 * Designer's (cases s01-s04). Without --create it saves an existing one.
 *
 * WRITES to the database. Refuses any database but the expected lab (HRDMO
 * by default) and any protected institutional database; the writer itself
 * refuses anything outside ZZ_PCODE_LAB.
 *
 *   npx tsx tools/corpus/save-protocol/direct-stylesheet-save.ts --operator JARED --sheet ZZ_PCODE_LAB_CSS3 --text '.x { color: red; }' [--repeat N] [--create]
 */
import { DatabaseProvider } from '../../../src/providers/database';
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
  const name = argument('sheet');
  const text = argument('text')?.replace(/\\n/g, '\n').repeat(Number(argument('repeat') ?? 1));
  if (!operatorId || !name || text === undefined) throw new Error('--operator, --sheet and --text are required.');
  const user = process.env.PSLAB_ACCESSID;
  const password = process.env.PSLAB_ACCESSPSWD;
  if (!user || !password) throw new Error('PSLAB_ACCESSID and PSLAB_ACCESSPSWD must be set.');
  const provider = new DatabaseProvider({ name: expected, platform: 'oracle', user, password, connectString: process.env.PSLAB_AUDIT_CONNECT ?? '127.0.0.1:15210/hrdmo' });
  await provider.connect();
  try {
    const identity = await (provider as unknown as {
      withConnection<T>(fn: (c: import('oracledb').Connection) => Promise<T>): Promise<T>
    }).withConnection(async (c) => String((await c.execute<{ DB: string }>(`SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS DB FROM DUAL`)).rows?.[0]?.DB ?? '').trim());
    if (PROTECTED_DATABASE_PATTERN.test(identity)) throw new Error(`Connected to ${identity}, a protected institutional database: refusing.`);
    if (identity.toUpperCase() !== expected.toUpperCase()) throw new Error(`Connected to ${identity}, not ${expected}: refusing.`);
    const opened = await provider.readStyleSheetForEdit(makeKey(DefinitionType.StyleSheet, name));
    if (opened === 'classic') throw new Error(`${name} is not a freeform style sheet.`);
    if (process.argv.includes('--create') === Boolean(opened)) throw new Error(opened ? `${name} exists: drop --create.` : `No style sheet ${name}: add --create.`);
    const result = await provider.saveStyleSheet({ name, text, operatorId, ...(opened ? { openedVersion: opened.version } : {}) });
    console.log(JSON.stringify(result));
    console.log('Saved, verified in the transaction and again after COMMIT.');
  } finally {
    await provider.dispose();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
