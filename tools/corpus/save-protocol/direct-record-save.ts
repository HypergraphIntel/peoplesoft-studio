/*
 * A native record save from the command line, through the same
 * OracleProvider.saveRecord the record editor uses -- compared against App
 * Designer's record saves (cases r01-r07).
 *
 * WRITES to the database. Refuses any database but the expected lab
 * (HRDMO by default) and any protected institutional database; the writer
 * itself refuses anything outside ZZ_PCODE_LAB.
 *
 *   npx tsx tools/corpus/save-protocol/direct-record-save.ts --operator JARED \
 *     --record ZZ_PCODE_LAB_T --ops 'move:1:0'
 *
 * --ops is a comma-separated list applied in order to the stored record
 * (positions 0-based): move:FROM:TO, insert:FIELD[:AT], remove:AT,
 * use:AT:NAME=1|0... (UseChange names; desc / list as short forms),
 * required:AT:1|0, edit:AT:none|prompt|promptNoEdit|yesNo[:TABLE],
 * default:AT:none | default:AT:constant:VALUE | default:AT:RECORD:FIELD,
 * label:AT[:LABEL_ID], page:AT:VALUE, prop:NAME:VALUE (Record Properties). Connection: PSLAB_ACCESSID /
 * PSLAB_ACCESSPSWD, PSLAB_AUDIT_CONNECT (default 127.0.0.1:15210/hrdmo).
 */
import { OracleProvider } from '../../../src/providers/oracle';
import { DefinitionType, makeKey } from '../../../src/model/definitions';
import { insertField, moveField, removeField, setDefault, setEdits, setLabel, setPageControl, setRecordProperties, setUse, type EditType, type RecordEditState } from '../../../src/model/recordEdit';
import { PROTECTED_DATABASE_PATTERN } from '../../../src/peoplecode/corpus/controlledCompileRunner';

function argument(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function apply(state: RecordEditState, op: string): RecordEditState {
  const [verb, ...args] = op.split(':');
  switch (verb) {
    case 'move': return moveField(state, Number(args[0]), Number(args[1]));
    case 'insert': return insertField(state, args[0], args[1] === undefined ? state.fields.length : Number(args[1]));
    case 'remove': return removeField(state, Number(args[0]));
    case 'use': {
      // use:AT:name=1:name=0 with UseChange names (key, dupOrder, descending, searchKey, listBox,
      // fromSearch, throughSearch, auditAdd, auditChange, auditDelete, systemMaintained); desc / list as short forms.
      const alias: Record<string, string> = { desc: 'descending', list: 'listBox' };
      const change = Object.fromEntries(args.slice(1).map((a) => a.split('=')).map(([k, v]) => [alias[k] ?? k, v === '1']));
      return setUse(state, Number(args[0]), change);
    }
    case 'required': return setEdits(state, Number(args[0]), { required: args[1] === '1' });
    case 'edit': return setEdits(state, Number(args[0]), { edit: args[1] as EditType, promptTable: args[2] ?? '' });
    case 'default':
      return setDefault(state, Number(args[0]), args[1] === 'none' ? null
        : args[1] === 'constant' ? { constant: args[2] ?? '' } : { record: args[1], field: args[2] ?? '' });
    case 'label': return setLabel(state, Number(args[0]), args[1] ?? '');
    case 'page': return setPageControl(state, Number(args[0]), Number(args[1]));
    case 'prop': {
      // prop:NAME:VALUE -- a Record Property (toolsTable / managed take 1 / 0).
      const [name, ...rest] = args;
      const value = rest.join(':');
      return setRecordProperties(state, { [name]: name === 'toolsTable' || name === 'managed' ? value === '1' : value });
    }
    default: throw new Error(`Unknown op ${op}`);
  }
}

async function main(): Promise<void> {
  const expected = argument('database') ?? 'HRDMO';
  if (PROTECTED_DATABASE_PATTERN.test(expected)) throw new Error(`${expected} is a protected institutional database: refusing.`);
  const operatorId = argument('operator');
  const recname = argument('record');
  const ops = argument('ops');
  if (!operatorId || !recname || !ops) throw new Error('--operator, --record and --ops are required.');

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

    const layout = await provider.readRecordLayout(makeKey(DefinitionType.Record, recname));
    if (!layout) throw new Error(`No record ${recname}.`);
    let edit: RecordEditState = {
      recname, recordType: layout.recordType, openedVersion: layout.version,
      fields: layout.fields.map((f) => ({ name: f.name, useEdit: f.useEdit, isNew: false }))
    };
    for (const op of ops.split(',')) edit = apply(edit, op.trim());
    console.log('fields:', edit.fields.map((f) => `${f.name}${f.isNew ? '*' : ''}(${f.useEdit.toString(16)})`).join(' '));
    const result = await provider.saveRecord({ edit, operatorId });
    console.log(JSON.stringify({ version: result.version, lastupddttm: result.lastupddttm, removed: result.plan.removed, bumpPgm: result.plan.bumpPgm, indexCount: result.plan.indexCount }));
    console.log('Saved, verified in the transaction and again after COMMIT.');
  } finally {
    await provider.dispose();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
