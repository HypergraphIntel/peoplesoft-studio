/*
 * The App Engine writer on the HRDMO lab, one operation per run, through the
 * DatabaseProvider methods the designer and the MCP tools use -- bracket each
 * with tools/lab/ae-capture.mts and compare with App Designer's capture of
 * the same edit (docs/APP_ENGINE.md).
 *
 * WRITES. HRDMO only, ZZ_AE_* programs only.
 *
 *   npx tsx tools/lab/ae-writer.mts <PROGRAM> <op> [args...]
 *
 * ops: create | descr TEXT | step SECTION AFTER | action SECTION STEP TYPE | sql SECTION STEP TYPE TEXT |
 *      pc SECTION STEP SOURCE | rename-step SECTION FROM TO | section | rename-section FROM TO |
 *      delete-section NAME | market SECTION MARKET | state REC | temp REC | msg SECTION STEP SET NUM PARMS |
 *      call SECTION STEP TARGET [PROGRAM] | delete-action SECTION STEP TYPE | delete-step SECTION STEP |
 *      copy TO | rename TO | delete | show | validate
 *
 * Environment: PSLAB_ACCESSID / PSLAB_ACCESSPSWD, PSLAB_ORACLE (default 127.0.0.1:15210/hrdmo), PSLAB_OPERATOR (default JARED).
 */
import { DatabaseProvider } from '../../src/providers/database';
import {
  copyProgram, deleteAction, deleteSection, deleteStep, findStep, insertAction, insertSection, insertStep, newProgram, renameSection,
  renameStep, type AeDocument
} from '../../src/model/aeDocument';
import { validateAppEngine, validateAppEngineReferences } from '../../src/model/aeValidation';
import type { ActionType } from '../../src/model/appEngine';

const [program, op, ...args] = process.argv.slice(2);
if (!/^ZZ_AE_/.test(program ?? '') || !op) throw new Error('usage: ae-writer.mts ZZ_AE_<name> <op> [args...]');
const connectString = process.env.PSLAB_ORACLE ?? '127.0.0.1:15210/hrdmo';
if (!/hrdmo/i.test(connectString)) throw new Error('HRDMO lab only.');
const operatorId = process.env.PSLAB_OPERATOR ?? 'JARED';

const p = new DatabaseProvider({ name: 'LAB', platform: 'oracle', connectString, user: process.env.PSLAB_ACCESSID!, password: process.env.PSLAB_ACCESSPSWD! });
await p.connect();
try {
  const opened = await p.readAppEngineDocument(program);
  const doc = opened?.doc;
  const token = opened?.token ?? 'absent';
  const need = () => { if (!doc) throw new Error(`No program ${program}.`); return doc; };
  const edit = (f: (d: AeDocument) => AeDocument) => f(need());
  const step = (d: AeDocument, section: string, name: string) => findStep(d, { section, step: name }).step;
  let next: AeDocument | undefined;
  switch (op) {
    case 'create': next = newProgram(program); break;
    case 'descr': next = edit((d) => ({ ...d, program: { ...d.program, descr: args[0] } })); break;
    case 'step': next = edit((d) => insertStep(d, { section: args[0], ...(args[1] ? { after: args[1] } : {}) }).doc); break;
    case 'action': next = edit((d) => insertAction(d, { section: args[0], step: args[1], ...(args[2] ? { type: args[2] as ActionType } : {}) }).doc); break;
    case 'sql': next = edit((d) => { const x = structuredClone(d); step(x, args[0], args[1]).actions.find((a) => a.type === args[2])!.text = args[3]; return x; }); break;
    case 'pc': next = edit((d) => { const x = structuredClone(d); step(x, args[0], args[1]).actions.find((a) => a.type === 'P')!.peopleCode = args[2].replace(/\\n/g, '\n'); return x; }); break;
    case 'rename-step': next = edit((d) => renameStep(d, { section: args[0], step: args[1] }, args[2])); break;
    case 'section': next = edit((d) => insertSection(d).doc); break;
    case 'rename-section': next = edit((d) => renameSection(d, args[0], args[1])); break;
    case 'delete-section': next = edit((d) => deleteSection(d, args[0])); break;
    case 'market': next = edit((d) => { const x = structuredClone(d); x.sections.find((s) => s.name === args[0])!.variants[0].market = args[1]; return x; }); break;
    case 'state': next = edit((d) => ({ ...d, stateRecords: [...d.stateRecords, { record: args[0], isDefault: d.stateRecords.length === 0 }] })); break;
    case 'temp': next = edit((d) => ({ ...d, tempTables: [...d.tempTables, args[0]] })); break;
    case 'msg': next = edit((d) => { const x = structuredClone(d); Object.assign(step(x, args[0], args[1]), { messageSet: Number(args[2]), messageNumber: Number(args[3]), messageParms: args[4] ?? ' ' }); return x; }); break;
    case 'call': next = edit((d) => { const x = structuredClone(d); Object.assign(step(x, args[0], args[1]), { doSection: args[2], doProgram: args[3] ?? program, dynamic: false }); return x; }); break;
    case 'delete-action': next = edit((d) => deleteAction(d, { section: args[0], step: args[1], type: args[2] as ActionType })); break;
    case 'delete-step': next = edit((d) => deleteStep(d, { section: args[0], step: args[1] })); break;
    case 'copy': {
      const copy = copyProgram(need(), args[0]);
      const r = await p.saveAppEngineDocument({ doc: copy, openedToken: 'absent', operatorId });
      console.log(JSON.stringify({ copied: args[0], increments: r.plan.increments }));
      break;
    }
    case 'rename': {
      const r = await p.renameAppEngineProgram(program, args[0], token, operatorId);
      console.log(JSON.stringify({ renamed: args[0], counters: r.plan.counters }));
      break;
    }
    case 'delete': await p.deleteAppEngineProgram(program, token, operatorId); console.log(JSON.stringify({ deleted: program })); break;
    case 'show': console.log(JSON.stringify(need(), null, 1)); break;
    case 'validate': {
      const d = need();
      console.log(JSON.stringify([...validateAppEngine(d), ...await validateAppEngineReferences(d, p.appEngineReferenceLookup())], null, 1));
      break;
    }
    default: throw new Error(`Unknown op ${op}.`);
  }
  if (next) {
    const r = await p.saveAppEngineDocument({ doc: next, openedToken: token, operatorId });
    console.log(JSON.stringify({ written: r.written, increments: r.plan.increments, statements: r.plan.statements.length, summary: r.plan.summary }));
  }
} finally {
  await p.dispose();
}
