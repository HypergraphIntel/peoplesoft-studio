import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { copyProgram, PROGRAM_NAME_MAX, type AeDocument } from '../model/aeDocument.js';
import { applyOperation, operation, programSpec } from '../model/aeOperations.js';
import { validateAppEngine, validateAppEngineReferences, type AeDiagnostic } from '../model/aeValidation.js';
import { checkSqlTypes, checkSqlCallSites } from '../model/sqlTypeCheck.js';
import { ACTION_LABELS } from '../model/appEngine.js';
import { dependencies, executionFlow, explainProgram } from '../model/aeSemantics.js';
import { diffSpec, documentFromSpec, specFromDocument, type AeProgramSpec } from '../model/aeSpec.js';
import { compileForSave, prepareSourceForSave } from '../peoplecode/writeback/savePlan.js';
import { DatabaseProvider } from '../providers/database.js';
import { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { approve, DESTRUCTIVE, GATES, READ_ONLY, WRITE, writable, type McpWriteHost } from './writeTools.js';

/*
 * App Engine programs through the MCP (docs/APP_ENGINE.md,
 * docs/APP_ENGINE_SEMANTICS.md). The same model the App Engine Designer
 * uses: programs read as documents (model/aeDocument.ts), shown and built
 * as specs (aeSpec.ts), changed by the designer's operations (aeSession.ts),
 * checked by its validator, explained by its flow analysis, and saved by its
 * writer (providers/appEngineWriter.ts) -- App Designer's rows, proven
 * against App Designer's own saves. Nothing here runs a program.
 */

async function databaseProvider(workspace: Workspace, connection: string): Promise<DatabaseProvider> {
  const p = await requireProvider(workspace, connection);
  if (!(p instanceof DatabaseProvider)) throw new Error(`${p.displayName} is a project export; App Engine programs are read from a database connection.`);
  if (!p.isConnected) throw new Error(`${p.displayName} is not connected.`);
  return p;
}

/** Validation with the database's answers and every PeopleCode action compiled. */
export async function deepValidate(p: DatabaseProvider, doc: AeDocument): Promise<AeDiagnostic[]> {
  const out = [...validateAppEngine(doc), ...await validateAppEngineReferences(doc, p.appEngineReferenceLookup())];
  const release = (await p.readEnvironment()).toolsRelease;
  for (const s of doc.sections) for (const v of s.variants) for (const st of v.steps) {
    const a = st.actions.find((x) => x.type === 'P');
    if (!a?.peopleCode?.trim()) continue;
    try { compileForSave(prepareSourceForSave(a.peopleCode), { applicationClass: false, recordName: '', fieldName: '' }, release); } catch (e) {
      out.push({ severity: 'error', code: 'peoplecode-compile', path: `${s.name}.${v.market}.${st.name}.PeopleCode`, message: e instanceof Error ? e.message : String(e),
        at: { section: s.name, variant: v, step: st.name, action: 'P' } });
    }
  }
  await sqlTypeDiagnostics(p, doc, out);
  return out;
}

/*
 * The SQL of every action checked against the record / field catalogue: fields
 * that are on no state record, INSERT lists of unequal length, a column written
 * from another type, and CreateSQL / SQLExec passing the wrong number of binds.
 * None of this is caught at save time otherwise -- each one abends at run time.
 */
async function sqlTypeDiagnostics(p: DatabaseProvider, doc: AeDocument, out: AeDiagnostic[]): Promise<void> {
  const stateRecords = doc.stateRecords.map((r: { record: string }) => r.record);
  const texts: Array<{ path: string; at: AeDiagnostic['at']; sql?: string; peopleCode?: string }> = [];
  for (const s of doc.sections) for (const v of s.variants) for (const st of v.steps) for (const a of st.actions) {
    const at = { section: s.name, variant: v, step: st.name, action: a.type };
    if (a.text?.trim()) texts.push({ path: `${s.name}.${st.name}.${ACTION_LABELS[a.type] ?? a.type}`, at, sql: a.text });
    if (a.peopleCode?.trim()) texts.push({ path: `${s.name}.${st.name}.PeopleCode`, at, peopleCode: a.peopleCode });
  }
  if (!texts.length) return;

  let catalog;
  try { catalog = await p.sqlCatalog(stateRecords.concat(recordsNamed(texts.map((t) => t.sql ?? '').join('\n')))); }
  catch { return; }  // the catalogue is a convenience: never fail a save because it could not be read
  const stateFields = new Set<string>();
  for (const r of stateRecords) for (const f of catalog.record(r) ?? []) stateFields.add(f);

  const sqlIds = [...new Set(texts.flatMap((t) => [...(t.peopleCode ?? '').matchAll(/\bSQL\.(\w+)/g)].map((m) => m[1]!)))];
  let shapes = new Map<string, { binds: number; columns: number }>();
  try { shapes = await p.sqlDefinitionShapes(sqlIds); } catch { /* leave the call-site check off */ }

  for (const t of texts) {
    const problems = t.sql
      ? checkSqlTypes(t.sql, { stateFields, catalog })
      : checkSqlCallSites(t.peopleCode!, (id) => shapes.get(id.toUpperCase()));
    for (const pr of problems) out.push({ severity: pr.severity, code: pr.code, path: t.path, message: pr.message, at: t.at });
  }
}

/** The records a statement names as PS_<RECORD>, so their fields can be catalogued too. */
function recordsNamed(sql: string): string[] {
  return [...sql.matchAll(/\bPS_(\w+)/g)].map((m) => m[1]!.toUpperCase());
}

const brief = (ds: AeDiagnostic[]) => ({
  errors: ds.filter((d) => d.severity === 'error').map((d) => `${d.path}: ${d.message}`),
  warnings: ds.filter((d) => d.severity === 'warning').map((d) => `${d.path}: ${d.message}`),
  notes: ds.filter((d) => d.severity === 'info').map((d) => `${d.path}: ${d.message}`)
});

export const AE_REFERENCE = `App Engine runtime, in brief (docs/APP_ENGINE_SEMANTICS.md):
- A program runs MAIN's steps in order; an Application Library has no MAIN (other programs call its Public sections).
- A step's actions run in a fixed order: Do When, Do While, Do Select, PeopleCode, SQL or Call Section, Log Message, Do Until. A step has at most one of each, never both SQL and Call Section; XSLT only in Transform programs.
- Do When: the step runs only if its SELECT returns a row. Do While: loops while it does. Do Until: loops until it does (tested after the actions). Do Select: for each row (fetched into the state record by %Select) runs the rest of the step.
- Every Do When / Do While / Do Until SELECT must land its column in the state record with %Select(field), or call a %Sql() that does: %Select(TEMP_FLD) SELECT 'X' FROM PS_INSTALLATION WHERE %Bind(FIELD) = 'VALUE'. Without it the program abends at run time -- ABENDED at Step <section>.<step> (Do When) -- RC = ? -- with no SQL error; the statement shows in the .AET step trace and never in the SQL trace. Add a 1-character work field (TEMP_FLD) to the state record as the landing place. Of 4,285 delivered Do When / While / Until actions, 4,255 use %Select and 30 use %Sql(); none has neither.
- Do Select types: Select/Fetch (one cursor; no commits inside while restart is on), Reselect (re-open per row; the step must change the data), Restartable (may commit inside; key the select so done rows drop out).
- SQL: INSERT/UPDATE/DELETE, or SELECT with %Select (first row into the state record). No Rows: Abort / Section Break / Continue / Skip Step.
- PeopleCode: OnExecute; returning False triggers On Return (Abort / Break / Skip Step). State record fields are RECORD.FIELD.
- In a PeopleCode action with On Return Break, log a Warning- or Message-severity entry before Exit(1), never an Error or Cancel one: an Error-severity MessageBox aborts the run, so the Break never happens. Use On Return Abort when stopping is the intent.
- State records (names end AET; one default) carry values between actions: %Bind(FIELD) reads them, %Select(FIELD) fills them. A table state record (with PROCESS_INSTANCE) survives restart; a Derived/Work one does not.
- Run control: MAIN's first step usually %Select(...)s from the run control record WHERE OPRID = %Bind(OPRID) AND RUN_CNTL_ID = %Bind(RUN_CNTL_ID).
- A save checks SQL against the record / field catalogue: %Bind and %Select fields must be on a state record, an INSERT column list and its SELECT list must be the same length and compatible types (char/long one family, number/signed one family, date / time / datetime distinct), %Select must name as many fields as the SELECT returns, and CreateSQL must pass exactly the definition's bind count (SQLExec may add the selected columns as outputs).
- Commits: Commit After Default follows the section's Auto Commit; After Step; Later. Frequency (Do Select steps) commits every n rows. Restart (unless Disable Restart) resumes after the last commit.
- Temporary tables (RECTYPE 7): Instance Count copies; %Table(REC) names this run's instance.
- Design: set-based SQL (INSERT ... SELECT into a temporary table, then UPDATE) beats row-by-row; for row rules use a Restartable Do Select + PeopleCode + SQL in one step with a commit Frequency.
PeopleSoft Studio does not run programs.`;

export function registerAppEngineTools(server: McpServer, workspace: Workspace, host: McpWriteHost | undefined): void {
  const read = async (connection: string, program: string) => {
    const p = await databaseProvider(workspace, connection);
    const name = program.trim().toUpperCase();
    const r = await p.readAppEngineDocument(name);
    if (!r) throw new Error(`There is no App Engine program ${name} on ${p.displayName}.`);
    return { p, name, ...r };
  };

  server.registerTool('psft_ae_reference', {
    title: 'App Engine: how programs run',
    description: 'A compact reference to Application Engine runtime semantics and design choices (actions, loops, state records, commits, restart, temporary tables) -- read it before designing or changing a program.',
    inputSchema: z.object({}),
    annotations: READ_ONLY
  }, async () => ({ content: [{ type: 'text' as const, text: AE_REFERENCE }] }));

  server.registerTool('psft_ae_get', {
    title: 'App Engine: get a program',
    description: 'An App Engine program as a spec: program properties, state records, temporary tables, each section variant (market / platform / effective date) ' +
      'with its steps and actions -- SQL, PeopleCode, Call Section targets, messages -- in App Designer\'s terms, plus its concurrency token and validation. ' +
      'Find programs with psft_search_definitions (type 33). Pass the token to psft_ae_edit as expectedToken.',
    inputSchema: z.object({ connection: z.string().min(1), program: z.string().min(1), includeText: z.boolean().optional().describe('Include SQL / PeopleCode text (default true).'),
      section: z.string().optional().describe('Only this section.') }),
    annotations: READ_ONLY
  }, async ({ connection, program, includeText, section }) => {
    const { p, doc, token } = await read(connection, program);
    const spec = specFromDocument(doc, { includeText: includeText !== false });
    if (section) spec.sections = spec.sections.filter((s) => s.name === section);
    return jsonResult({ connection: p.displayName, token, spec, validation: brief(validateAppEngine(doc)) });
  });

  server.registerTool('psft_ae_explain', {
    title: 'App Engine: explain a program',
    description: 'What an App Engine program does when it runs, step by step in the runtime\'s order; the sections reachable from MAIN and the calls between them ' +
      '(external, dynamic, recursive); its dependencies -- state records, temporary tables, tables read and written, programs called, messages, meta-SQL, bind fields.',
    inputSchema: z.object({ connection: z.string().min(1), program: z.string().min(1) }),
    annotations: READ_ONLY
  }, async ({ connection, program }) => {
    const { doc } = await read(connection, program);
    return jsonResult({ explanation: explainProgram(doc), flow: executionFlow(doc), dependencies: dependencies(doc) });
  });

  server.registerTool('psft_ae_validate', {
    title: 'App Engine: validate a program',
    description: 'Validates an App Engine program -- or the program as proposed operations (psft_ae_edit\'s) would leave it, without saving: structure ' +
      '(names, MAIN, action combinations, codes), App Designer\'s Edit Validation warnings, references (state records, temporary tables, called ' +
      'programs and sections, Message Catalog, %Bind fields) and PeopleCode compiled. Errors block a save; warnings do not.',
    inputSchema: z.object({ connection: z.string().min(1), program: z.string().min(1), operations: z.array(operation).optional() }),
    annotations: READ_ONLY
  }, async ({ connection, program, operations }) => {
    const { p, doc } = await read(connection, program);
    let next = doc;
    for (const o of operations ?? []) next = applyOperation(next, o);
    return jsonResult({ validation: brief(await deepValidate(p, next)) });
  });

  server.registerTool('psft_ae_compare', {
    title: 'App Engine: compare two programs',
    description: 'How two App Engine programs differ (or a program and a spec): properties, sections, steps, actions and their text.',
    inputSchema: z.object({ connection: z.string().min(1), program: z.string().min(1), other: z.string().optional(), spec: programSpec.optional() }),
    annotations: READ_ONLY
  }, async ({ connection, program, other, spec }) => {
    const a = await read(connection, program);
    const target = spec ?? (other ? { ...specFromDocument((await read(connection, other)).doc), program: a.name } : undefined);
    if (!target) throw new Error('Give another program or a spec.');
    return jsonResult({ differences: diffSpec(a.doc, target as AeProgramSpec), reverse: other ? diffSpec((await read(connection, other)).doc, { ...specFromDocument(a.doc), program: other }) : undefined });
  });

  server.registerTool('psft_ae_verify', {
    title: 'App Engine: verify a saved program',
    description: 'Reads a program back from the database and checks it against a spec (only what the spec states) and the validator, including references and PeopleCode compiled.',
    inputSchema: z.object({ connection: z.string().min(1), spec: programSpec }),
    annotations: READ_ONLY
  }, async ({ connection, spec }) => {
    const { p, doc, token } = await read(connection, spec.program);
    const differences = diffSpec(doc, spec as AeProgramSpec);
    return jsonResult({ token, matches: differences.length === 0, differences, validation: brief(await deepValidate(p, doc)) });
  });

  if (!host) return;
  const key = (name: string): DefinitionKey => ({ type: DefinitionType.AppEngineProgram, parts: [name] });
  const saveDoc = async (gate: Awaited<ReturnType<typeof writable>>, doc: AeDocument, token: string, dryRun: boolean, action: string) => {
    const diagnostics = await deepValidate(gate.provider, doc);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if(errors.length)return jsonResult({saved:false,reason:'validation errors',validation:brief(diagnostics),diagnostics:errors,explanation:explainProgram(doc)});
    const preview = await gate.provider.saveAppEngineDocument({ doc, openedToken: token, operatorId: gate.operatorId, dryRun: true });
    const planned = { changes: preview.plan.summary, counters: preview.plan.increments, statements: preview.plan.statements.length };
    if (dryRun || errors.length || preview.plan.empty) {
      return jsonResult({ saved: false, reason: dryRun ? 'dry run' : errors.length ? 'validation errors' : 'nothing to save', planned, validation: brief(diagnostics),
        explanation: explainProgram(doc) });
    }
    await approve(host, gate, key(doc.name), action,
      `${preview.plan.summary.changes.slice(0, 20).join('\n')}${preview.plan.summary.sqlChanged.length ? `\nSQL: ${preview.plan.summary.sqlChanged.join(', ')}` : ''}` +
      `${preview.plan.summary.peopleCodeChanged.length ? `\nPeopleCode: ${preview.plan.summary.peopleCodeChanged.join(', ')}` : ''}` +
      `${preview.plan.summary.tombstones.length ? `\nDeleted: ${preview.plan.summary.tombstones.join(', ')}` : ''}`);
    const result = await gate.provider.saveAppEngineDocument({ doc, openedToken: token, operatorId: gate.operatorId });
    host.saved(gate.provider.id, key(doc.name));
    // Verify: what is stored now is the document.
    const stored = await gate.provider.readAppEngineDocument(doc.name);
    const differences = stored ? diffSpec(stored.doc, specFromDocument(doc)) : ['the program is not stored'];
    return jsonResult({ saved: result.written, token: stored?.token, planned, verification: differences.length ? differences : 'stored program matches', validation: brief(diagnostics) });
  };

  server.registerTool('psft_ae_create', {
    title: 'App Engine: create a program',
    description: 'Creates an App Engine program from a spec (as psft_ae_get returns one): program properties, state records, temporary tables, sections with ' +
      'their steps and actions, SQL and PeopleCode. Built with App Designer\'s own defaults, validated (references and PeopleCode compiled), saved as App ' +
      'Designer saves, then read back and compared. dryRun returns the plan, validation and an explanation without writing. Read psft_ae_reference first. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), spec: programSpec, dryRun: z.boolean().optional() }),
    annotations: WRITE
  }, async ({ connection, spec, dryRun }) => {
    const name = spec.program.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, name);
    if (await gate.provider.readAppEngineDocument(name)) throw new Error(`An App Engine program named ${name} already exists; use psft_ae_edit.`);
    const doc = documentFromSpec({ ...(spec as AeProgramSpec), program: name });
    return saveDoc(gate, doc, 'absent', !!dryRun, `create App Engine program ${name}`);
  });

  server.registerTool('psft_ae_edit', {
    title: 'App Engine: edit a program',
    description: 'Applies operations to an App Engine program and saves it as App Designer does, changing only what the operations name: program ' +
      'properties, state records, temporary tables; add / set / rename / delete sections (a variant by market, platform, effective date); add / set / rename / ' +
      'move / copy / delete steps; add / set / change type / delete actions with their SQL, PeopleCode, Call Section, message and options. Renames move ' +
      'SQL and PeopleCode as App Designer does. expectedToken (from psft_ae_get) refuses the edit if the program changed since; dryRun previews. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), program: z.string().min(1), operations: z.array(operation).min(1),
      expectedToken: z.string().optional(), dryRun: z.boolean().optional() }),
    annotations: WRITE
  }, async ({ connection, program, operations, expectedToken, dryRun }) => {
    const name = program.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, name);
    const current = await gate.provider.readAppEngineDocument(name);
    if (!current) throw new Error(`There is no App Engine program ${name}; use psft_ae_create.`);
    if (expectedToken && expectedToken !== current.token) throw new Error(`${name} changed since it was read (token ${current.token}); read it again with psft_ae_get.`);
    let doc = current.doc;
    for (const [i, o] of operations.entries()) {
      try { doc = applyOperation(doc, o); } catch (e) { throw new Error(`Operation ${i + 1} (${o.op}): ${e instanceof Error ? e.message : String(e)}`); }
    }
    return saveDoc(gate, doc, current.token, !!dryRun, `edit App Engine program ${name} (${operations.length} change${operations.length === 1 ? '' : 's'})`);
  });

  server.registerTool('psft_ae_copy', {
    title: 'App Engine: copy a program (Save As)',
    description: 'Saves a copy of an App Engine program under a new name, with its SQL and PeopleCode, as App Designer\'s Save As does. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), program: z.string().min(1), to: z.string().min(1).max(PROGRAM_NAME_MAX), dryRun: z.boolean().optional() }),
    annotations: WRITE
  }, async ({ connection, program, to, dryRun }) => {
    const target = to.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, target);
    const { doc } = await read(connection, program);
    if (await gate.provider.readAppEngineDocument(target)) throw new Error(`An App Engine program named ${target} already exists.`);
    return saveDoc(gate, copyProgram(doc, target), 'absent', !!dryRun, `copy App Engine program ${doc.name} to ${target}`);
  });

  server.registerTool('psft_ae_rename', {
    title: 'App Engine: rename a program',
    description: 'Renames an App Engine program, its SQL and PeopleCode with it, as App Designer\'s Rename does (the old name is recorded as deleted). ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), program: z.string().min(1), to: z.string().min(1).max(PROGRAM_NAME_MAX), expectedToken: z.string().optional() }),
    annotations: DESTRUCTIVE
  }, async ({ connection, program, to, expectedToken }) => {
    const target = to.trim().toUpperCase();
    const { name, token } = await read(connection, program);
    const gate = await writable(workspace, host, connection, name);
    await writable(workspace, host, connection, target);
    if (expectedToken && expectedToken !== token) throw new Error(`${name} changed since it was read.`);
    await approve(host, gate, key(name), `rename App Engine program ${name} to ${target}`, `${name} becomes ${target}; its SQL and PeopleCode move with it.`);
    await gate.provider.renameAppEngineProgram(name, target, token, gate.operatorId);
    host.saved(gate.provider.id, key(name));
    return jsonResult({ renamed: { from: name, to: target }, token: (await gate.provider.readAppEngineDocument(target))?.token });
  });

  server.registerTool('psft_ae_delete', {
    title: 'App Engine: delete a program',
    description: 'Deletes an App Engine program with its SQL and PeopleCode, as App Designer\'s Delete does. Cannot be undone from here. ' + GATES,
    inputSchema: z.object({ connection: z.string().min(1), program: z.string().min(1), expectedToken: z.string().min(1).describe('From psft_ae_get: the program as you last read it.') }),
    annotations: DESTRUCTIVE
  }, async ({ connection, program, expectedToken }) => {
    const { name, token, doc } = await read(connection, program);
    const gate = await writable(workspace, host, connection, name);
    if (expectedToken !== token) throw new Error(`${name} changed since it was read.`);
    await approve(host, gate, key(name), `DELETE App Engine program ${name}`, `${name} (${doc.sections.length} sections) and its SQL and PeopleCode are deleted.`);
    await gate.provider.deleteAppEngineProgram(name, token, gate.operatorId);
    host.saved(gate.provider.id, key(name));
    return jsonResult({ deleted: name });
  });


}
