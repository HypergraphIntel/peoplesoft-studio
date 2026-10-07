/*
 * A translate value added, changed or deleted from the command line, through
 * the same OracleProvider.saveTranslate the record editor uses -- compared
 * against App Designer's (cases r37-r39).
 *
 * WRITES to the database. Refuses any database but the expected lab (HRDMO
 * by default) and any protected institutional database; the writer itself
 * refuses anything outside ZZ_PCODE_LAB.
 *
 *   npx tsx tools/corpus/save-protocol/direct-translate.ts --operator JARED --field ZZ_PCODE_LAB_C02 \
 *     --add A --effdt 1900-01-01 --long Alpha --short Alp
 *   ... --change A --effdt 1900-01-01 --long Alpha2 --short Alp2 [--status I]
 *   ... --delete A --effdt 1900-01-01
 */
import { OracleProvider } from '../../../src/providers/oracle';
import type { TranslateChange } from '../../../src/providers/translateWriter';
import { PROTECTED_DATABASE_PATTERN } from '../../../src/peoplecode/corpus/controlledCompileRunner';

function argument(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function change(): TranslateChange {
  const effectiveDate = argument('effdt') ?? '1900-01-01';
  const item = (value: string) => ({
    value, effectiveDate, status: argument('status') ?? 'A', longName: argument('long') ?? '', shortName: argument('short') ?? ''
  });
  const add = argument('add');
  const changed = argument('change');
  const deleted = argument('delete');
  if (add) return { kind: 'add', item: item(add) };
  if (changed) return { kind: 'change', item: item(changed) };
  if (deleted) return { kind: 'delete', value: deleted, effectiveDate };
  throw new Error('One of --add, --change or --delete is required.');
}

async function main(): Promise<void> {
  const expected = argument('database') ?? 'HRDMO';
  if (PROTECTED_DATABASE_PATTERN.test(expected)) throw new Error(`${expected} is a protected institutional database: refusing.`);
  const operatorId = argument('operator');
  const field = argument('field');
  if (!operatorId || !field) throw new Error('--operator and --field are required.');
  const what = change();
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
    await provider.saveTranslate(field, what, operatorId);
    console.log(JSON.stringify(await provider.readTranslates(field)));
  } finally {
    await provider.dispose();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
