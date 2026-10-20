import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { DefinitionType } from '../model/definitions.js';
import { definitionExists, missingDefinitionProblems } from '../peoplecode/definitionCheck.js';
import { lineAndColumn, validatePeopleCode } from '../peoplecode/validate.js';
import { DatabaseProvider } from '../providers/database.js';
import { Workspace } from '../workspace.js';
import { jsonResult, keyFromInput, requireProvider } from './tools.js';

/*
 * PeopleCode for agents: the rules App Designer's compiler enforces and
 * Studio now checks before every save (peoplecode/semanticCheck.ts), the
 * idioms agent-written code got wrong, and a read-only validation an agent
 * runs before saving.
 */

export const PEOPLECODE_REFERENCE = `PeopleCode rules Studio enforces before every save, as App Designer does (each holds for all 35,831 delivered programs of an HCM database):

PC001 Properties and their get/set blocks agree.
  - "property string Name get;" needs a "get Name ... end-get;" block (it returns the value).
  - "property string Name get set;" needs both a get block and a "set Name ... end-set;" block (the new value is &NewValue).
  - "readonly" is for a property WITHOUT a get block (stored, assigned inside the class): never "readonly" with a get block.
  - A get/set block must implement a declared property.
PC002 An instance variable may not have a property's name: "property string Status get;" and "instance string &Status;" clash -- name the instance &sStatus (or similar).
PC003 Return with a value only inside a Function, method, get or set. Record, Component, Page, Menu and App Engine PeopleCode cannot return a value:
  - end the program early with a bare "Return;";
  - App Engine: "Exit(1);" ends the action and the step's On Return setting (Abort / Break / Skip Step) decides what follows; "Exit(0);" or reaching the end continues. A Do When / Do While is an SQL action, not PeopleCode;
  - put logic that produces a value in a Function and call it.
PC004 A Local may not re-declare a parameter of its function or method, or (in a method, get or set) a class instance variable -- use them directly.
PC005 Every Application Class used must be imported, in every program that uses it -- App Engine actions, events and other classes in the same package alike:
  - "import PKG:Class;" or "import PKG:SUB:*;" at the top, before declarations;
  - this covers create, Local/Global/Component/instance declarations, "As" parameters, extends, implements and Returns.
PC007 None(), All(), AllOrNone(), OnlyOne() and OnlyOneOrNone() take record fields, Locals and parameters -- never a class instance variable or a %This property
PC008 SQL.Fetch output parameters are bound by reference: fetch into Locals and assign to properties or instance variables afterwards, never fetch straight into them
PC009 NumberToString takes a PeopleSoft format -- %<width>[.<decimals>] with an optional R, T, t or v -- not a printf conversion: "%04d" is taken literally and corrupts the value (2026 becomes d-ba). Use "%04", or String() when no padding is needed
  (App Designer: "Field or temporary variable name required"). Copy it into a Local first ("Local date &d = &i_checkDt; If None(&d) Then"), or for a date use IsDate(&i_checkDt).
PC006 (needs the database) Each imported class must exist and each wildcard must name a package: save an imported class before the program that imports it.
PC010 A call that returns no value used as a value (native App Designer 2,60, "Function or method does not produce a result value"). Call it as a statement, never as a condition, assignment, operand or argument. Covered: built-ins documented "Returns: None" (Error, Warning, DoSave, DoCancel, Transfer, TransferExact, EndModal, SetCursorPos, UpdateValue, ScrollFlush, CallAppEngine, RemoteCall, SetComponentChanged, CollectGarbage, CreateDirectory, RemoveDirectory, ViewContentURL*, AddJavaScript, ...) and File Open/Close/Delete/SetPosition/WriteLine/WriteString/WriteRaw/WriteBase64StringToBinary on explicitly typed Local File receivers in the same body. File-method errors terminate the program; test &file.IsOpen after opening. Gray, Hide, SetDefault, InsertRow, DeleteRow, CommitWork, ReadLine, WriteRecord and SetFileLayout DO return Booleans.

Also:
  - Strings are in double quotes; concatenate with |; compare with = and <>; If ... Then ... [Else ...] End-If; For &i = 1 To &n ... End-For; Evaluate ... When ... When-Other ... End-Evaluate.
  - A function from another program is declared first: "Declare Function Name PeopleCode RECORD.FIELD FieldFormula;" (functions live in FieldFormula of a FUNCLIB record).
  - Application Class layout: imports; "class Name [extends Base]" with public method / property declarations, then "private" with instance variables and private methods; "end-class;"; then the method, get and set implementations. The constructor is the method named like the class.
  - App Engine state record fields are read and set as RECORD.FIELD (e.g. MY_AET.PROCESS_INSTANCE).

Run psft_validate_peoplecode before psft_save_peoplecode (or before an App Engine / menu save that carries PeopleCode): it reports every problem with its line.`;

export function registerPeopleCodeTools(server: McpServer, workspace: Workspace): void {
  server.registerTool('psft_peoplecode_reference', {
    title: 'PeopleCode: rules and idioms',
    description: 'The PeopleCode rules App Designer\'s compiler enforces that Studio checks before every save (property get/set declarations, instance vs property names, Return outside functions, ' +
      're-declared locals, imports, None/All on instance variables), App Engine PeopleCode idioms (Exit, Return;), and class layout. Read before writing PeopleCode. Read only.',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => jsonResult({ reference: PEOPLECODE_REFERENCE }));

  server.registerTool('psft_validate_peoplecode', {
    title: 'PeopleCode: validate before saving',
    description: 'Checks PeopleCode as a save would, without saving: the rules in psft_peoplecode_reference (PC001-PC005, PC007-PC010), Studio\'s compiler, and -- with a connection -- that ' +
      'every imported class and package exists (PC006) and every RECORD.FIELD reference is a field (App Designer 2,17). In Record and Component Record PeopleCode, bare field names of the program\'s record are qualified as App Designer stores them and returned as qualifiedSource -- save that. Undeclared function calls are reported (2,15). Key as psft_save_peoplecode takes it (type and parts); App Engine action PeopleCode is type 43, an ' +
      'Application Class 58. Returns each problem with its line and column; valid is true only when there are none. Read only.',
    inputSchema: z.object({
      connection: z.string().optional().describe('For the release\'s compiler and the import check; without one, PeopleTools 8.62 and no import check.'),
      type: z.number().int(), parts: z.array(z.string()).min(1), source: z.string()
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ connection, type, parts, source }) => {
    const key = keyFromInput(type, parts);
    const text = source.replace(/\r\n/g, '\n');
    let release = '8.62';
    let provider: DatabaseProvider | undefined;
    if (connection) {
      const p = await requireProvider(workspace, connection);
      if (p instanceof DatabaseProvider && p.isConnected) { provider = p; release = (await p.databaseRelease()).toolsRelease.trim() || release; }
    }
    // Record and Component Record (Field) PeopleCode: bare names of the program's record are qualified as App Designer stores them.
    const owner = type === DefinitionType.RecordPeopleCode ? key.parts[0]
      : type === DefinitionType.ComponentRecordPeopleCode || type === DefinitionType.ComponentRecordFieldPeopleCode ? key.parts[2] : undefined;
    const ownerFields = provider && owner ? await provider.expandedFieldNames(owner.toUpperCase()) : undefined;
    const compiled = validatePeopleCode(text, key, release, ownerFields?.length ? { ownerFields } : {});
    const imports = provider ? await provider.peopleCodeImportProblems(text) : [];
    // App Designer's "Field REC.FIELD not defined. (2,17)" for references the database does not have.
    const references: typeof compiled.problems = [];
    if (provider) {
      const known = new Map<string, Set<string>>();
      for (const r of compiled.fieldReferences ?? []) {
        if (!known.has(r.record)) known.set(r.record, new Set((await provider.expandedFieldNames(r.record)).map((f) => f.toUpperCase())));
        if (!known.get(r.record)!.has(r.field)) references.push({ offset: r.offset, code: 'field-not-defined', message: `Field ${r.record}.${r.field} not defined. (2,17)` });
      }
      // Record.X, Page.X, SQL.X ... the database lacks: a note (App Designer compiles them), App Designer's 2,68 for Image.X.
      references.push(...(await missingDefinitionProblems(compiled.definitionReferences ?? [], (t, name) => definitionExists(provider!, t, name))));
    }
    const qualifications = compiled.qualifications ?? [];
    let qualifiedSource: string | undefined;
    if (qualifications.length) {
      qualifiedSource = text;
      for (const q of [...qualifications].sort((a, b) => b.offset - a.offset)) qualifiedSource = qualifiedSource.slice(0, q.offset) + q.text + qualifiedSource.slice(q.offset + q.length);
    }
    const problems = [...compiled.problems, ...references, ...imports.map((p) => ({ offset: p.offset, message: `${p.message} (${p.code})` }))]
      .sort((a, b) => a.offset - b.offset)
      .map((p) => { const at = lineAndColumn(text, p.offset); return { line: at.line + 1, column: at.column + 1, severity: 'severity' in p && p.severity === 'info' ? 'info' : 'error', message: p.message }; });
    // A missing-definition note does not make a program invalid: App Designer compiles it.
    const notes = new Set(references.filter((r) => r.code === 'definition-not-found' && r.severity === 'info').map((r) => r.message));
    return jsonResult({
      valid: problems.every((p) => p.severity === 'info' && notes.has(p.message)), profile: compiled.profile, importsChecked: !!provider, kind: key.type === DefinitionType.ApplicationClassPeopleCode ? 'Application Class' : 'program', problems,
      ...(qualifiedSource ? { qualifiedSource, note: 'Studio saves field references qualified, as Application Designer stores them: save qualifiedSource.' } : {})
    });
  });
}
