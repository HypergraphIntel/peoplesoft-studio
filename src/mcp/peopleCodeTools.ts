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
PC004 A Local may not re-declare a parameter of its function or method, or (in a method, get or set) a class instance variable or a property with no get/set block (stored like one: App Designer 2,39) -- use them directly, or give the Local another name.
PC005 Every Application Class used must be imported, in every program that uses it -- App Engine actions, events and other classes in the same package alike:
  - "import PKG:Class;" or "import PKG:SUB:*;" at the top, before declarations;
  - this covers create, Local/Global/Component/instance declarations, "As" parameters, extends, implements and Returns.
PC007 None(), All(), AllOrNone(), OnlyOne() and OnlyOneOrNone() take record fields, Locals and parameters -- never a class instance variable, a %This property, a property of an Application Class object or a call result (All(&res.ErrorCode) and All(RTrim(&s)) are 2,32; write &res.ErrorCode <> "" / RTrim(&s) <> "" or copy it into a Local)
PC008 SQL.Fetch and SQLExec output parameters are bound by reference: read into Locals and assign to properties or instance variables afterwards, never straight into them (SQLExec's outputs are the arguments after its :n bind values)
PC009 NumberToString takes a PeopleSoft format -- %<width>[.<decimals>] with an optional R, T, t or v -- not a printf conversion: "%04d" is taken literally and corrupts the value (2026 becomes d-ba). Use "%04", or String() when no padding is needed
  (App Designer: "Field or temporary variable name required"). Copy it into a Local first ("Local date &d = &i_checkDt; If None(&d) Then"), or for a date use IsDate(&i_checkDt).
PC006 (needs the database) Each imported class must exist and each wildcard must name a package: save an imported class before the program that imports it.
PC010 A call that returns no value used as a value (native App Designer 2,60, "Function or method does not produce a result value"). Call it as a statement, never as a condition, assignment, operand or argument. Covered: built-ins documented "Returns: None" (Error, Warning, DoSave, DoCancel, Transfer, TransferExact, EndModal, SetCursorPos, UpdateValue, ScrollFlush, CallAppEngine, RemoteCall, SetComponentChanged, CollectGarbage, CreateDirectory, RemoveDirectory, ViewContentURL*, AddJavaScript, ...) and File Open/Close/Delete/SetPosition/WriteLine/WriteString/WriteRaw/WriteBase64StringToBinary on explicitly typed Local File receivers in the same body. File-method errors terminate the program; test &file.IsOpen after opening. Gray, Hide, SetDefault, InsertRow, DeleteRow, CommitWork, ReadLine, WriteRecord and SetFileLayout DO return Booleans.
PC011 Never use a member straight off a create expression: "create Pkg:Class().Method()" is App Designer 2,47 (the expression's type stays the created class). Create the object into a Local, then call it.
PC012 A method parameter may not have the name of a property of its class that has no get/set block (it is stored like an instance variable): "method Reader(&config As ...)" with "property ... Config;" is App Designer 2,31, "Duplicate parameter name". Name the parameter differently (&cfg).
PC013 Inside its class a readonly property is assigned through its variable ("&RecordId = ..."), never through %This ("%This.RecordId = ..." is App Designer 2,46, "property cannot be changed").
PC014 A declaration naming several variables initialises none of them: "Local integer &i, &n = 0;" is App Designer 2,42, "Syntax error: expecting statement". Write "Local integer &i;" and "Local integer &n = 0;".
PC015 ParentRow is a Rowset property: the current row's parent is GetRowset().ParentRow; "GetRow().ParentRow" reads ParentRow as a record name (App Designer 2,52). A Row has ParentRowset.
PC016 Every method a class declares, unless abstract, has a "method Name ... end-method;" body. App Designer's syntax check misses a missing body; PIA stops at run time ("Method X has no body", 2,81).
PC017 A string literal holds at most 999 characters (the longest in delivered code). A longer one crashes App Designer and the application server when they load the program: split it and join the parts with | ("part one" | "part two").
PC018 True, False and Null are keywords: they cannot follow a dot. GetJavaClass("java.lang.Boolean").TRUE is App Designer 2,49 ("Dot not followed by Id"); call a method instead (Boolean.valueOf("true")).
PC019 An array of integer is never assigned CreateArrayRept / CreateArray of a number literal: "&Sizes = CreateArrayRept(0, 0);" builds an Array of Number and fails at run time (180,604, "Cannot convert type Array of Number to object type Array of Integer"); Validate Syntax accepts it. Declare array of number, or create it empty and Push integers.
PC020 The Request class has no Method property: the HTTP method is %Request.HTTPMethod ("%Request.Method" is 2,50, "Method is not a property of class Request", at run time).
PC021 A method of the class that returns a value is never called through %This as a statement on its own: "%This.Done(...);" with Done(...) Returns string is App Designer 2,45, "Invalid start of statement". Use the result: "&result = %This.Done(...);".
PC022 A method or property is never named after a PeopleCode keyword (Alias, Step, Error, For, Return, ...): App Designer reports 2,42, "Syntax error: expecting Identifier". Create, Value and Component are the only keywords delivered classes use as member names.

Also:
  - Strings are in double quotes; concatenate with |; compare with = and <>; If ... Then ... [Else ...] End-If; For &i = 1 To &n ... End-For; Evaluate ... When ... When-Other ... End-Evaluate.
  - A function from another program is declared first: "Declare Function Name PeopleCode RECORD.FIELD FieldFormula;" (functions live in FieldFormula of a FUNCLIB record).
  - Application Class layout: imports; "class Name [extends Base]" with public method / property declarations, then "private" with instance variables and private methods; "end-class;"; then the method, get and set implementations. The constructor is the method named like the class.
  - App Engine state record fields are read and set as RECORD.FIELD (e.g. MY_AET.PROCESS_INSTANCE).
  - Reading one row into a Record object -- choose by what you know of the keys (read the record's keys first; EFFDT is often one):
      &rec.SelectByKey()             every key field set, EFFDT included when it is a key. With a key unset it finds nothing (and clears the record, keys included): a lookup by ID and version on a record keyed ID, VERSION, EFFDT fails.
      &rec.SelectByKeyEffDt(&date)   every key except EFFDT set; returns the row effective as of &date (greatest EFFDT <= &date). A row dated after &date is not found -- right for "what is in force today", wrong for a specific row such as a future-dated draft.
      SQLExec("%SelectAll(:1) WHERE KEY1 = :2 AND KEY2 = :3", &rec, &k1, &k2, &rec);   a specific row by the fields that identify it (as delivered code does); test a key field afterwards to see whether a row was found -- SQLExec returns True either way.
  - SaveEdit, SavePreChange and SavePostChange run for every row of the component on each save, changed or not: a check, stamp or audit meant for edited rows tests GetRow().IsChanged (and GetRow().IsNew / IsDeleted) first, or it fires for untouched rows too.
  - Record PeopleCode fired by a method from another level (InsertRow from a level-0 button fires the child's RowInsert) resolves plain RECORD.FIELD references to that scroll's current row, not the new one: reach the row through GetRow() there.

Run psft_validate_peoplecode before psft_save_peoplecode (or before an App Engine / menu save that carries PeopleCode): it reports every problem with its line.`;

export function registerPeopleCodeTools(server: McpServer, workspace: Workspace): void {
  server.registerTool('psft_peoplecode_reference', {
    title: 'PeopleCode: rules and idioms',
    description: 'The PeopleCode rules App Designer\'s compiler enforces that Studio checks before every save (property get/set declarations, instance vs property names, Return outside functions, ' +
      're-declared locals, imports, None/All on instance variables), App Engine PeopleCode idioms (Exit, Return;), class layout, and which row read to use (SelectByKey vs SelectByKeyEffDt vs %SelectAll). Read before writing PeopleCode. Read only.',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => jsonResult({ reference: PEOPLECODE_REFERENCE }));

  server.registerTool('psft_validate_peoplecode', {
    title: 'PeopleCode: validate before saving',
    description: 'Checks PeopleCode as a save would, without saving: the rules in psft_peoplecode_reference (PC001-PC005, PC007-PC022), Studio\'s compiler, and -- with a connection -- that ' +
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
