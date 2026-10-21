import * as vscode from 'vscode';
import { definitionKeywordType, definitionReferencePrefix } from './definition.js';
import { DefinitionType, displayName } from '../model/definitions.js';
import { parseUri } from '../util/uri.js';
import type { Workspace } from '../workspace.js';
import type { DefinitionProvider } from '../providers/provider.js';
import { parseApplicationClassSource } from './applicationClassProgram.js';
import { classCandidates, classDeclarationSource, classMembers, declaredTypeOf, headerExtends, headerMembers, isBuiltInType, type MemberCompletion } from './memberCompletion.js';
import { BUILTIN_FUNCTION_NAMES } from './builtinFunctions.js';
import { DEFINITION_KEYWORDS } from './validate.js';
import { DatabaseProvider } from '../providers/database.js';
import { gated, languageFeaturesOn } from './languageFeatures.js';
import { INLINE_CALL_SNIPPETS } from './inlineCalls.js';

const KEYWORDS: string[] = [
  'If', 'Then', 'Else', 'End-If',
  'For', 'To', 'Step', 'End-For',
  'While', 'End-While',
  'Repeat', 'Until',
  'Evaluate', 'When', 'When-Other', 'End-Evaluate',
  'Break', 'Continue', 'Exit', 'Return',
  'Local', 'Global', 'Component',
  'Function', 'End-Function',
  'Method', 'End-Method',
  'Class', 'End-Class',
  'Import', 'As',
  'Try', 'Catch', 'End-Try',
  'Throw', 'Declare', 'Library', 'Alias',
  'Error', 'Warning',
  'True', 'False', 'Null',
  'And', 'Or', 'Not',
  'private', 'protected', 'instance', 'property',
  'get', 'set', 'abstract', 'interface', 'end-interface',
  'out', 'Value', 'Ref',
  'create', 'of', 'Returns',
];

/** label, optional detail, optional snippet insertText */
const BUILTIN_FUNCTIONS: { label: string; detail?: string; insert?: string }[] = [
  // Messaging / catalog
  { label: 'MessageBox', detail: 'Message dialog', insert: 'MessageBox(${1:style}, ${2:title}, ${3:msgset}, ${4:msgnum}, ${5:default}${6:, params});' },
  { label: 'WinMessage', detail: 'Simple message', insert: 'WinMessage(${1:text});' },
  { label: 'MsgGet', detail: 'Message catalog string', insert: 'MsgGet(${1:msgset}, ${2:msgnum}, ${3:default})' },
  { label: 'MsgGetText', detail: 'Message catalog text', insert: 'MsgGetText(${1:msgset}, ${2:msgnum}, ${3:default})' },
  { label: 'MsgGetExplainText', detail: 'Message explain text' },
  { label: 'Error', detail: 'Abort with error', insert: 'Error ${1:msg};' },
  { label: 'Warning', detail: 'Warning, continue', insert: 'Warning ${1:msg};' },

  // Buffer / objects
  { label: 'GetLevel0', detail: 'Component level-0 rowset' },
  { label: 'CreateRowset', detail: 'Standalone rowset', insert: 'CreateRowset(Record.${1:RECNAME})' },
  { label: 'CreateRecord', detail: 'Standalone record', insert: 'CreateRecord(Record.${1:RECNAME})' },
  { label: 'CreateArray', detail: 'Create array' },
  { label: 'CreateArrayAny', detail: 'Create Any array' },
  { label: 'CreateArrayRept', detail: 'Create array repeated' },
  { label: 'CreateException', detail: 'Create Exception object' },
  { label: 'CreateObject', detail: 'Create external/PeopleCode object', insert: 'CreateObject("${1:class}")' },
  { label: 'CreateObjectArray', detail: 'Create object array' },
  { label: 'CreateProcessRequest', detail: 'Process request object' },
  { label: 'CreateSOAPDoc', detail: 'SOAP document' },
  { label: 'CreateXmlDoc', detail: 'XmlDoc', insert: 'CreateXmlDoc(${1:""})' },
  { label: 'CreateDocument', detail: 'Documents module document' },
  { label: 'CreateDocumentKey', detail: 'Documents module key' },

  // SQL
  { label: 'GetSQL', detail: 'Open SQL definition', insert: 'GetSQL(SQL.${1:SQLNAME})' },
  { label: 'SQLExec', detail: 'Exec SQL, one row', insert: 'SQLExec("${1:SELECT ...}"${2:, binds})' },
  { label: 'Exec', detail: 'OS command' },
  { label: 'Close', detail: 'Close SQL/file/etc.' },
  { label: 'FetchSQL', detail: 'Fetch next SQL row' },
  { label: 'StoreSQL', detail: 'Store SQL definition' },
  { label: 'DeleteSQL', detail: 'Delete SQL definition' },

  // Strings / encoding
  { label: 'IsNull', detail: 'Null test' },
  { label: 'All', detail: 'All non-null/non-blank' },
  { label: 'None', detail: 'All null/blank' },
  { label: 'Len', detail: 'Length' },
  { label: 'Substring', detail: 'Substring', insert: 'Substring(${1:str}, ${2:start}, ${3:length})' },
  { label: 'Left', detail: 'Left n chars' },
  { label: 'Right', detail: 'Right n chars' },
  { label: 'Upper', detail: 'Uppercase' },
  { label: 'Lower', detail: 'Lowercase' },
  { label: 'Proper', detail: 'Proper case' },
  { label: 'LTrim', detail: 'Trim left' },
  { label: 'RTrim', detail: 'Trim right' },
  { label: 'Substitute', detail: 'Replace substring' },
  { label: 'Find', detail: 'Find substring' },
  { label: 'FindExact', detail: 'Find exact' },
  { label: 'Replace', detail: 'Replace' },
  { label: 'Rept', detail: 'Repeat string' },
  { label: 'String', detail: 'To string' },
  { label: 'Value', detail: 'To number' },
  { label: 'NumberToString', detail: 'Number to string' },
  { label: 'Char', detail: 'Char from codepoint' },
  { label: 'Code', detail: 'Codepoint from char' },
  { label: 'Quote', detail: 'Quote / escape for PeopleCode string' },
  { label: 'Exact', detail: 'Exact string compare' },
  { label: 'EscapeHTML', detail: 'HTML escape' },
  { label: 'EscapeJavascriptString', detail: 'JS string escape' },
  { label: 'JsonEscape', detail: 'JSON escape' },
  { label: 'Unencode', detail: 'URL / HTML unencode' },
  { label: 'EncodeURL', detail: 'URL encode' },
  { label: 'EncodeURLForQueryString', detail: 'Query-string encode' },
  { label: 'Hash', detail: 'Hash string' },
  { label: 'GenerateGUID', detail: 'GUID' },
  { label: 'GetHTMLText', detail: 'HTML definition text', insert: 'GetHTMLText(HTML.${1:NAME})' },
  { label: 'Split', detail: 'Split string to array' },

  // Numbers / dates
  { label: 'Abs', detail: 'Absolute value' },
  { label: 'Mod', detail: 'Modulo' },
  { label: 'Rem', detail: 'Remainder' },
  { label: 'Round', detail: 'Round' },
  { label: 'Truncate', detail: 'Truncate' },
  { label: 'Integer', detail: 'Integer part' },
  { label: 'Rand', detail: 'Random' },
  { label: 'Date', detail: 'Construct date' },
  { label: 'DateTime', detail: 'DateTime helpers' },
  { label: 'DateTimeValue', detail: 'Parse datetime' },
  { label: 'DateValue', detail: 'Parse date' },
  { label: 'Time', detail: 'Construct time' },
  { label: 'TimeValue', detail: 'Parse time' },
  { label: 'Year', detail: 'Year of date' },
  { label: 'Month', detail: 'Month of date' },
  { label: 'Day', detail: 'Day of date' },
  { label: 'Hour', detail: 'Hour' },
  { label: 'Minute', detail: 'Minute' },
  { label: 'Second', detail: 'Second' },
  { label: 'Weekday', detail: 'Weekday' },
  { label: 'Date3', detail: 'Date from Y,M,D' },
  { label: 'Days', detail: 'Day count' },
  { label: 'AddToDate', detail: 'Add to date' },
  { label: 'AddToDateTime', detail: 'Add to datetime' },
  { label: 'FormatDateTime', detail: 'Format datetime' },

  // Component / nav / security
  { label: 'DoSave', detail: 'Save component' },
  { label: 'DoSaveNow', detail: 'Save immediately' },
  { label: 'Transfer', detail: 'Transfer to component' },
  { label: 'TransferPage', detail: 'Transfer page' },
  { label: 'TransferExact', detail: 'Transfer exact keys' },
  { label: 'TransferModeless', detail: 'Modeless transfer' },
  { label: 'SetNextPage', detail: 'Next page' },
  { label: 'EndModal', detail: 'End modal component' },
  { label: 'EndModalComponent', detail: 'End modal component' },
  { label: 'IsMenuItemAuthorized', detail: 'Security check' },
  { label: 'RevalidatePassword', detail: 'Re-auth' },
  { label: 'ViewPage', detail: 'View page' },
  { label: 'DoModal', detail: 'Modal component' },
  { label: 'DoModalComponent', detail: 'Modal component' },
  { label: 'PanelGroupChanged', detail: 'Buffer changed?' },
  { label: 'SetCursorPos', detail: 'Set cursor field' },
  { label: 'SetLanguage', detail: 'Set language' },

  // Files / bulk
  { label: 'GetFile', detail: 'Open file' },
  { label: 'FileExists', detail: 'File exists?' },
  { label: 'GetTempFileName', detail: 'Temp file name' },

  // Misc common
  { label: 'GetUserId', detail: 'Current user id' },
  { label: 'GetSetId', detail: 'Resolve SetID' },
  { label: 'GetNextNumber', detail: 'Next number' },
  { label: 'GetNextNumberWithGapsCommit', detail: 'Next number w/ gaps' },
  { label: 'ActiveRowCount', detail: 'Often a Rowset property; also used in expressions' },
  { label: 'CurrentRowNumber', detail: 'Current row number' },
  { label: 'PriorValue', detail: 'Prior field value' },
  { label: 'SetReEdit', detail: 'Force re-edit' },
  { label: 'Gray', detail: 'Disable field' },
  { label: 'Ungray', detail: 'Enable field' },
  { label: 'Hide', detail: 'Hide field/page' },
  { label: 'Unhide', detail: 'Show field/page' },
  { label: 'SetDisplayFormat', detail: 'Display format' },
  { label: 'Repaint', detail: 'Repaint' },
  { label: 'Refresh', detail: 'Refresh' },
  { label: 'SortScroll', detail: 'Sort scroll' },
  { label: 'ScrollSelect', detail: 'Scroll select' },
  { label: 'ScrollSelectNew', detail: 'Scroll select new' },
  { label: 'RowScroll', detail: 'Flush scroll' },
  { label: 'InsertRow', detail: 'Insert row' },
  { label: 'DeleteRow', detail: 'Delete row' },
  { label: 'FetchValue', detail: 'Fetch buffer value' },
  { label: 'UpdateValue', detail: 'Update buffer value' },
  { label: 'DiscardRow', detail: 'Discard row' },
  { label: 'IsRowNew', detail: 'Row new?' },
  { label: 'StopFetching', detail: 'Stop select fetch' },
  { label: 'RemoteCall', detail: 'Remote call' },
  { label: 'ScheduleProcess', detail: 'Schedule process' },
  { label: 'TriggerBusinessEvent', detail: 'Workflow event' },
  { label: 'GenerateTree', detail: 'Generate tree' },
  { label: 'GetCwd', detail: 'Current working directory' },
  { label: 'Exact', detail: 'Exact compare' },
];

const SYSTEM_VARS: string[] = [
  '%Component', '%Menu', '%Page', '%Mode',
  '%OperatorId', '%EmployeeId', '%UserId',
  '%ClientType', '%Language', '%Market',
  '%AsOfDate', '%Date', '%DateTime', '%Time',
  '%Session', '%Portal', '%Node',
  '%This', '%Parent',
  '%Request', '%Response',
  '%FilePath', '%ServerTimeZone',
  '%ProcessProfile', '%EmailAddress',
  '%BPName', '%RunningTransformAppEngine',
  '%CompIntfcName', '%Transaction',
];

type Member = { label: string; isMethod: boolean; detail?: string };

const MEMBERS_ROWSET: Member[] = [
  { label: 'GetRow', isMethod: true, detail: 'GetRow(index) → Row' },
  { label: 'ActiveRowCount', isMethod: false },
  { label: 'CurrentRowNumber', isMethod: false },
  { label: 'InsertRow', isMethod: true },
  { label: 'DeleteRow', isMethod: true },
  { label: 'Flush', isMethod: true },
  { label: 'FlushAll', isMethod: true },
  { label: 'Select', isMethod: true, detail: 'Select(where…)' },
  { label: 'SelectNew', isMethod: true },
  { label: 'Fill', isMethod: true },
  { label: 'Sort', isMethod: true },
  { label: 'CopyTo', isMethod: true },
  { label: 'DataChanged', isMethod: false },
  { label: 'DBRecordName', isMethod: false },
  { label: 'IsTree', isMethod: false },
  { label: 'ParentRowset', isMethod: false },
  { label: 'ParentRow', isMethod: false },
];

const MEMBERS_ROW: Member[] = [
  { label: 'GetRecord', isMethod: true, detail: 'GetRecord(Record.NAME)' },
  { label: 'GetRowset', isMethod: true, detail: 'GetRowset(Scroll.NAME)' },
  { label: 'RowNumber', isMethod: false },
  { label: 'ParentRowset', isMethod: false },
  { label: 'IsChanged', isMethod: false },
  { label: 'IsDeleted', isMethod: false },
  { label: 'IsNew', isMethod: false },
  { label: 'IsEditError', isMethod: false },
  { label: 'Delete', isMethod: true },
  { label: 'CopyTo', isMethod: true },
];

const MEMBERS_RECORD: Member[] = [
  { label: 'GetField', isMethod: true, detail: 'GetField(Field.NAME)' },
  { label: 'CopyFieldsTo', isMethod: true },
  { label: 'CopyChangedFieldsTo', isMethod: true },
  { label: 'SelectByKey', isMethod: true },
  { label: 'SelectByKeyEffDt', isMethod: true },
  { label: 'Insert', isMethod: true },
  { label: 'Update', isMethod: true },
  { label: 'Delete', isMethod: true },
  { label: 'Save', isMethod: true },
  { label: 'IsChanged', isMethod: false },
  { label: 'IsDeleted', isMethod: false },
  { label: 'IsNew', isMethod: false },
  { label: 'Name', isMethod: false },
  { label: 'FieldCount', isMethod: false },
  { label: 'DBName', isMethod: false },
];

const MEMBERS_FIELD: Member[] = [
  { label: 'Value', isMethod: false },
  { label: 'DisplayName', isMethod: false },
  { label: 'Name', isMethod: false },
  { label: 'Enabled', isMethod: false },
  { label: 'Visible', isMethod: false },
  { label: 'Label', isMethod: false },
  { label: 'LongTranslateValue', isMethod: false },
  { label: 'ShortTranslateValue', isMethod: false },
  { label: 'IsChanged', isMethod: false },
  { label: 'IsEmpty', isMethod: false },
  { label: 'IsEditError', isMethod: false },
  { label: 'SetCursorPos', isMethod: true },
  { label: 'SetDefault', isMethod: true },
  { label: 'SetReadOnly', isMethod: true },
  { label: 'SetFluid', isMethod: true },
  { label: 'Style', isMethod: false },
  { label: 'Type', isMethod: false },
  { label: 'OriginalValue', isMethod: false },
];

const MEMBERS_SQL: Member[] = [
  { label: 'Execute', isMethod: true },
  { label: 'Fetch', isMethod: true },
  { label: 'Close', isMethod: true },
  { label: 'Open', isMethod: true },
  { label: 'BulkDeleteRows', isMethod: true },
  { label: 'BulkInsertRows', isMethod: true },
  { label: 'BulkUpdateRows', isMethod: true },
];

const MEMBERS_REQUEST: Member[] = [
  { label: 'GetParameter', isMethod: true, detail: 'GetParameter(name)' },
  { label: 'GetParameters', isMethod: true },
  { label: 'GetCookie', isMethod: true },
  { label: 'GetCookieNames', isMethod: true },
  { label: 'GetHeader', isMethod: true },
  { label: 'GetHeaderNames', isMethod: true },
  { label: 'GetContentBody', isMethod: true },
  { label: 'Method', isMethod: false },
  { label: 'RequestURI', isMethod: false },
  { label: 'QueryString', isMethod: false },
  { label: 'AuthTokenDomain', isMethod: false },
  { label: 'PathInfo', isMethod: false },
];

const MEMBERS_RESPONSE: Member[] = [
  { label: 'Write', isMethod: true },
  { label: 'WriteLine', isMethod: true },
  { label: 'SetContentType', isMethod: true },
  { label: 'SetHeader', isMethod: true },
  { label: 'SetCookie', isMethod: true },
  { label: 'RedirectURL', isMethod: true },
  { label: 'GetCookieNames', isMethod: true },
  { label: 'GetCookie', isMethod: true },
];

const MEMBERS_ARRAY: Member[] = [
  { label: 'Len', isMethod: false },
  { label: 'Push', isMethod: true },
  { label: 'Pop', isMethod: true },
  { label: 'Shift', isMethod: true },
  { label: 'Unshift', isMethod: true },
  { label: 'Find', isMethod: true },
  { label: 'Sort', isMethod: true },
  { label: 'Join', isMethod: true },
  { label: 'Get', isMethod: true },
  { label: 'Replace', isMethod: true },
  { label: 'Subarray', isMethod: true },
];

/** Generic fallback when we can’t guess the type. */
const MEMBERS_COMMON: Member[] = [
  ...MEMBERS_ROWSET.slice(0, 8),
  ...MEMBERS_RECORD.slice(0, 6),
  ...MEMBERS_FIELD.slice(0, 8),
];

function membersForReceiver(receiver: string): Member[] {
  const r = receiver.replace(/\s+/g, '');
  const lower = r.toLowerCase();

  if (lower === '%request' || lower.endsWith('request')) return MEMBERS_REQUEST;
  if (lower === '%response' || lower.endsWith('response')) return MEMBERS_RESPONSE;

  // Heuristic name patterns used in real PeopleCode
  if (/rowset|rs\b|level|scroll/i.test(r) || lower.startsWith('&rs')) return MEMBERS_ROWSET;
  if (/^&row/i.test(r) || /row$/i.test(r)) return MEMBERS_ROW;
  if (/^&rec/i.test(r) || /record$/i.test(r) || lower.startsWith('&rec')) return MEMBERS_RECORD;
  if (/^&fld/i.test(r) || /field$/i.test(r) || lower.startsWith('&field')) return MEMBERS_FIELD;
  if (/^&sql/i.test(r) || /sql$/i.test(r)) return MEMBERS_SQL;
  if (/^&arr/i.test(r) || /array$/i.test(r) || lower.startsWith('&a')) return MEMBERS_ARRAY;

  return MEMBERS_COMMON;
}

function harvestLocals(document: vscode.TextDocument): string[] {
  const text = document.getText();
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /&[A-Za-z][A-Za-z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!seen.has(m[0])) {
      seen.add(m[0]);
      out.push(m[0]);
    }
  }
  return out;
}

/** Function Foo( / method Bar( / method Bar Returns */
function harvestDeclarations(document: vscode.TextDocument): { name: string; kind: 'function' | 'method' }[] {
  const text = document.getText();
  const out: { name: string; kind: 'function' | 'method' }[] = [];
  const seen = new Set<string>();
  const re = /\b(Function|method)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const kind = m[1].toLowerCase() === 'function' ? 'function' : 'method';
    const name = m[2];
    const key = `${kind}:${name.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ name, kind });
    }
  }
  return out;
}

function linePrefix(document: vscode.TextDocument, position: vscode.Position): string {
  return document.lineAt(position).text.slice(0, position.character);
}

/** Receiver before a trailing dot, e.g. "&rs." or "%Request." or "GetLevel0()." */
function receiverBeforeDot(prefix: string): string | undefined {
  const m = prefix.match(/([%&A-Za-z0-9_\)\]]+)\s*\.\s*[A-Za-z0-9_&]*$/);
  return m?.[1];
}

/** The class package a PeopleCode document belongs to: an application class's key parts without its name (and event). */
function ownPackageOf(document: vscode.TextDocument): string[] | undefined {
  try {
    const { key } = parseUri(document.uri);
    if (key.type !== DefinitionType.ApplicationClassPeopleCode) return undefined;
    const parts = key.parts.filter((p) => p !== 'OnExecute');
    return parts.slice(0, -1);
  } catch { return undefined; }
}

type ParsedClass = ReturnType<typeof parseApplicationClassSource>;
type ClassRead = { parts: string[]; source: string; program: ParsedClass } | null;

/*
 * Application classes read for completion, kept five minutes per connection --
 * a class that is not there too, since a bare name is tried in several
 * packages. A class's members rarely change while one is typing, and
 * completion must not wait on the database (which validation as you type
 * also uses) every time `%This.` is typed.
 */
const CLASS_TTL_MS = 5 * 60_000;
const MISS_TTL_MS = 30_000;
const classCache = new Map<string, { at: number; provider: DefinitionProvider; read: Promise<ClassRead> }>();

/** An application class open in an editor on this connection: its current text, saved or not, wins over the database. */
function openClassText(handle: string, parts: string[]): string | undefined {
  const want = parts.join(':').toLowerCase();
  for (const d of vscode.workspace.textDocuments) {
    if (d.uri.scheme !== 'psft' || d.languageId !== 'psft-peoplecode') continue;
    try {
      const { handle: h, key } = parseUri(d.uri);
      if (h === handle && key.type === DefinitionType.ApplicationClassPeopleCode
        && key.parts.filter((p) => p !== 'OnExecute').join(':').toLowerCase() === want) return d.getText();
    } catch { /* not a definition document */ }
  }
  return undefined;
}

function parsedClass(parts: string[], source: string): ClassRead {
  let program: ParsedClass;
  try { program = parseApplicationClassSource(classDeclarationSource(source)); } catch { program = undefined; }
  return program || /\bclass\s/i.test(source) ? { parts, source, program } : null;
}

function readClass(provider: DefinitionProvider, handle: string, parts: string[]): Promise<ClassRead> {
  const open = openClassText(handle, parts);
  if (open !== undefined) return Promise.resolve(parsedClass(parts, open));
  const id = `${handle}|${parts.join(':').toLowerCase()}`;
  const cached = classCache.get(id);
  if (cached?.provider === provider && Date.now() - cached.at < CLASS_TTL_MS) return cached.read;
  const entry = { at: Date.now(), provider, read: Promise.resolve<ClassRead>(null) };
  entry.read = provider.readText({ type: DefinitionType.ApplicationClassPeopleCode, parts })
    .then((source) => parsedClass(parts, source), () => {
      if (classCache.get(id) === entry) classCache.delete(id);
      return null;
    })
    .then((found) => {
      // A miss may only mean the connection was not ready: keep it 30 seconds, not five minutes.
      if (!found) entry.at = Date.now() - CLASS_TTL_MS + MISS_TTL_MS;
      return found;
    });
  classCache.set(id, entry);
  return entry.read;
}

/** The members along a class's `extends` chain, from the first readable of `candidates` up, each with the class it comes from. */
async function chainMembers(provider: DefinitionProvider, handle: string, candidates: string[][], visibilities: string[], inside: boolean):
  Promise<Array<{ from: string; members: MemberCompletion[] }>> {
  const out: Array<{ from: string; members: MemberCompletion[] }> = [];
  const seen = new Set<string>();
  let next: string[][] | undefined = candidates;
  for (let depth = 0; next && depth < 8; depth++) {
    let found: ClassRead = null;
    for (const parts of next) {
      if (seen.has(parts.join(':').toLowerCase())) continue;
      found = await readClass(provider, handle, parts);
      if (found) break;
    }
    if (!found) break; // the class (or a parent) is not readable here
    seen.add(found.parts.join(':').toLowerCase());
    out.push({
      from: found.parts.join(':'),
      members: found.program ? classMembers(found.program, visibilities, inside)
        : headerMembers(found.source).filter((m) => visibilities.includes(m.visibility))
    });
    const base: string | undefined = found.program ? found.program.extendsType : headerExtends(found.source);
    next = base && !isBuiltInType(base) ? classCandidates(base, found.source, found.parts.slice(0, -1)) : undefined;
  }
  return out;
}

/** The class being edited (parsed, or read from its header lines when Studio's parser does not model it) and its base class. */
function currentClass(text: string): { program: ParsedClass; base?: string } {
  let program: ParsedClass;
  try { program = parseApplicationClassSource(classDeclarationSource(text)); } catch { program = undefined; }
  const base = program ? program.extendsType : headerExtends(text);
  return { program, ...(base && !isBuiltInType(base) ? { base } : {}) };
}

/** Reads an application class's `extends` chain ahead of `%This.` (on open), so completion finds it cached. */
export function prefetchClassChain(document: vscode.TextDocument, workspace: Workspace): void {
  if (!languageFeaturesOn() || document.languageId !== 'psft-peoplecode' || document.uri.scheme !== 'psft') return;
  let handle: string;
  try { handle = parseUri(document.uri).handle; } catch { return; }
  const provider = workspace.getProviderByHandle(handle);
  const own = ownPackageOf(document);
  if (!provider?.isConnected || own === undefined) return;
  const text = document.getText();
  const { base } = currentClass(text);
  if (base) void chainMembers(provider, handle, classCandidates(base, text, own), ['public', 'protected'], true);
}

/** How long completion waits for classes still being read before showing what it has. */
const CHAIN_WAIT_MS = 250;

/** A slow database must not hold the suggestion list open indefinitely. */
async function completionRead<T>(read: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([read, new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), CHAIN_WAIT_MS); })]); }
  finally { clearTimeout(timer); }
}

/**
 * Members of an application class, as completion items: after `&obj.` the
 * public members of the class `&obj` is declared as; after `%This.` the
 * current class's own members (private ones too) and the public and protected
 * members it inherits; after `%Super.` the base class's public and protected
 * members. The `extends` chain is followed through each class's imports. A
 * class still being read after a moment is left out and the list marked
 * incomplete, so it joins on the next keystroke.
 */
async function completeClassMembers(document: vscode.TextDocument, workspace: Workspace, receiver: string): Promise<vscode.CompletionItem[] | vscode.CompletionList> {
  // The connection, when the document has one: it supplies other classes (a base class, &obj's class); the class itself needs none.
  let handle: string | undefined;
  try { handle = parseUri(document.uri).handle; } catch { handle = undefined; }
  const provider = handle ? workspace.getProviderByHandle(handle) : undefined;
  const text = document.getText();
  const lower = receiver.toLowerCase();
  const inside = lower === '%this' || lower === '%super';
  const own = ownPackageOf(document);

  const items: vscode.CompletionItem[] = [];
  const seenNames = new Set<string>();
  const kindOf = { method: vscode.CompletionItemKind.Method, property: vscode.CompletionItemKind.Property, constant: vscode.CompletionItemKind.Constant };
  const add = (members: MemberCompletion[], inherited: boolean, from?: string) => {
    for (const m of members) {
      if (seenNames.has(m.name.toLowerCase())) continue; // a subclass override wins over the parent's
      seenNames.add(m.name.toLowerCase());
      const item = new vscode.CompletionItem(m.name, kindOf[m.kind]);
      item.detail = inherited ? `${m.detail} (inherited${from ? ` from ${from}` : ''})` : m.detail;
      item.sortText = `0_${m.name}`;
      items.push(item);
    }
  };

  let start: { candidates: string[][]; visibilities: string[]; inherited: boolean };
  if (inside) {
    const { program, base } = currentClass(text);
    if (lower === '%this') add(program ? classMembers(program, ['public', 'protected', 'private'], true) : headerMembers(text), false);
    if (!base) return items;
    start = { candidates: classCandidates(base, text, own), visibilities: ['public', 'protected'], inherited: lower === '%this' };
  } else {
    const type = declaredTypeOf(text, receiver);
    if (!type) return [];
    start = { candidates: classCandidates(type, text, own), visibilities: ['public'], inherited: false };
  }
  if (!provider || !handle) return items;

  const chain = chainMembers(provider, handle, start.candidates, start.visibilities, inside);
  const ready = await completionRead(chain);
  if (!ready) return new vscode.CompletionList(items, true); // the rest join as more is typed
  for (const c of ready) add(c.members, start.inherited, c.from);
  return items;
}

/** A record's fields (subrecords expanded) from the document's connection, kept a minute; empty when it has none or is not a record. */
const recordFieldCache = new Map<string, { at: number; provider: DefinitionProvider; fields: Promise<string[]> }>();
function recordFieldsFor(document: vscode.TextDocument, workspace: Workspace, record: string): Promise<string[]> {
  let handle: string;
  try { handle = parseUri(document.uri).handle; } catch { return Promise.resolve([]); }
  const provider = workspace.getProviderByHandle(handle);
  if (!(provider instanceof DatabaseProvider)) return Promise.resolve([]);
  const id = `${handle}|${record.toUpperCase()}`;
  const cached = recordFieldCache.get(id);
  if (cached?.provider === provider && Date.now() - cached.at < 60_000) return cached.fields;
  const entry = { at: Date.now(), provider, fields: Promise.resolve<string[]>([]) };
  const fields = provider.expandedFieldNames(record.toUpperCase()).catch(() => {
    if (recordFieldCache.get(id) === entry) recordFieldCache.delete(id);
    return [] as string[];
  });
  entry.fields = fields;
  recordFieldCache.set(id, entry);
  return fields;
}

/** The definitions of `type` whose name starts with `partial`, as completion items, from the document's connection. */
const definitionNameCache = new Map<string, { at: number; provider: DefinitionProvider; read: Promise<vscode.CompletionItem[]> }>();
async function completeDefinitionNames(document: vscode.TextDocument, workspace: Workspace,
  type: import('../model/definitions.js').DefinitionType, partial: string): Promise<vscode.CompletionItem[]> {
  let handle: string;
  try { handle = parseUri(document.uri).handle; } catch { return []; }
  const provider = workspace.getProviderByHandle(handle);
  if (!provider) return [];
  const id = `${handle}|${type}|${partial.toUpperCase()}`;
  const cached = definitionNameCache.get(id);
  if (cached?.provider === provider && Date.now() - cached.at < 30_000) return cached.read;
  const entry = { at: Date.now(), provider, read: Promise.resolve<vscode.CompletionItem[]>([]) };
  entry.read = provider.search({ type, namePattern: partial ? `${partial}%` : '%', limit: 100 }).then((summaries) => summaries.map((s) => {
    const name = s.key.parts[0];
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Reference);
    item.detail = s.description ?? displayName(s.key);
    item.sortText = `0_${name}`;
    return item;
  }), () => {
    if (definitionNameCache.get(id) === entry) definitionNameCache.delete(id);
    return [];
  });
  definitionNameCache.set(id, entry);
  return entry.read;
}

export function registerPeopleCodeCompletion(context: vscode.ExtensionContext, workspace: Workspace): void {
  const provider: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position, _token, completionContext) {
      const prefix = linePrefix(document, position);

      // `Record.`, `Page.`, `SQL.` ... (a bareword definition keyword, not a &variable): the
      // definitions of that type in the connection, queried live and refined as the name is typed.
      const defRef = definitionReferencePrefix(prefix);
      const defType = defRef ? definitionKeywordType(defRef.keyword) : undefined;
      if (defRef && defType !== undefined && document.uri.scheme === 'psft') {
        const names = await completionRead(completeDefinitionNames(document, workspace, defType, defRef.partial));
        return new vscode.CompletionList(names ?? [], true); // incomplete: re-query as more of the name is typed
      }

      const afterDot =
        completionContext.triggerCharacter === '.' || /\.\s*[A-Za-z0-9_&]*$/.test(prefix);

      if (afterDot) {
        const receiver = receiverBeforeDot(prefix) ?? '';

        // `&obj.` where &obj has an explicit application-class type: that class's real members; `%This.` and
        // `%Super.` in a class: its own and inherited members. Never the generic guesses below.
        const lowerReceiver = receiver.toLowerCase();
        if (lowerReceiver === '%this' || lowerReceiver === '%super') {
          return document.uri.scheme === 'psft' || lowerReceiver === '%this' ? completeClassMembers(document, workspace, receiver) : [];
        }
        if (receiver.startsWith('&') && document.uri.scheme === 'psft' && declaredTypeOf(document.getText(), receiver)) {
          return completeClassMembers(document, workspace, receiver);
        }

        // `RECORD.`: that record's fields, from the connection (a name that is no record falls through).
        if (/^[A-Za-z][A-Za-z0-9_#$@]*$/.test(receiver) && !DEFINITION_KEYWORDS.has(receiver.toUpperCase()) && document.uri.scheme === 'psft') {
          const fields = await completionRead(recordFieldsFor(document, workspace, receiver));
          if (!fields) return new vscode.CompletionList([], true);
          if (fields.length) {
            return fields.map((f) => {
              const item = new vscode.CompletionItem(f, vscode.CompletionItemKind.Field);
              item.detail = `Field of ${receiver.toUpperCase()}`;
              item.sortText = `0_${f}`;
              return item;
            });
          }
        }

        const members = membersForReceiver(receiver);
        return members.map((m) => {
          const item = new vscode.CompletionItem(
            m.label,
            m.isMethod ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Property
          );
          item.detail = m.detail;
          item.sortText = `0_${m.label}`;
          return item;
        });
      }

      const items: vscode.CompletionItem[] = [];

      for (const kw of KEYWORDS) {
        const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
        item.sortText = `1_${kw}`;
        items.push(item);
      }

      // Every built-in App Designer compiles (the HCDEV census): the documented ones with their snippets.
      const documented = new Set<string>();
      for (const fn of BUILTIN_FUNCTIONS) {
        const item = new vscode.CompletionItem(fn.label, vscode.CompletionItemKind.Function);
        item.detail = fn.detail;
        if (fn.insert) item.insertText = new vscode.SnippetString(fn.insert);
        item.sortText = `2_${fn.label}`;
        items.push(item);
        documented.add(fn.label.toLowerCase());
      }
      for (const name of BUILTIN_FUNCTION_NAMES) {
        if (documented.has(name.toLowerCase())) continue;
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
        item.detail = 'PeopleTools built-in function';
        const call=INLINE_CALL_SNIPPETS[name.toLowerCase()];
        if(call)item.insertText=new vscode.SnippetString(call);
        item.sortText = `2_${name}`;
        items.push(item);
      }

      for (const v of SYSTEM_VARS) {
        const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.Variable);
        item.detail = 'System variable';
        item.sortText = `3_${v}`;
        items.push(item);
      }

      for (const name of harvestLocals(document)) {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
        item.detail = 'Variable in this document';
        item.sortText = `4_${name}`;
        items.push(item);
      }

      for (const decl of harvestDeclarations(document)) {
        const item = new vscode.CompletionItem(
          decl.name,
          decl.kind === 'function' ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Method
        );
        item.detail = decl.kind === 'function' ? 'Function in this document' : 'Method in this document';
        item.sortText = `5_${decl.name}`;
        items.push(item);
      }

      return items;
    },
  };

  // Read each class's inheritance as soon as its editor opens or is shown, and again when its text changes (an
  // edited `extends` or import), so `%This.` finds it read. Reads are cached, so a repeat costs nothing.
  for (const d of vscode.workspace.textDocuments) prefetchClassChain(d, workspace);
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => prefetchClassChain(d, workspace)),
    vscode.window.onDidChangeActiveTextEditor((e) => { if (e) prefetchClassChain(e.document, workspace); }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme !== 'psft' || ownPackageOf(e.document) === undefined) return;
      const id = e.document.uri.toString();
      clearTimeout(pending.get(id));
      pending.set(id, setTimeout(() => { pending.delete(id); prefetchClassChain(e.document, workspace); }, 750));
    }),
    vscode.workspace.onDidSaveTextDocument((d) => {
      if (d.uri.scheme === 'psft') { recordFieldCache.clear(); definitionNameCache.clear(); }
      // A class saved here changes what the database holds: forget its cached read.
      try {
        const { handle, key } = parseUri(d.uri);
        if (key.type === DefinitionType.ApplicationClassPeopleCode) {
          classCache.delete(`${handle}|${key.parts.filter((p) => p !== 'OnExecute').join(':').toLowerCase()}`);
        }
      } catch { /* not a definition document */ }
    }),
    vscode.workspace.onDidCloseTextDocument((d) => { const id = d.uri.toString(); clearTimeout(pending.get(id)); pending.delete(id); }),
    workspace.onDidChange(() => {
      classCache.clear(); recordFieldCache.clear(); definitionNameCache.clear();
      for (const d of vscode.workspace.textDocuments) prefetchClassChain(d, workspace);
    }),
    { dispose: () => { for (const timer of pending.values()) clearTimeout(timer); pending.clear(); classCache.clear(); recordFieldCache.clear(); definitionNameCache.clear(); } }
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'psft-peoplecode' },
      gated({
        async provideCompletionItems(document, position, token, completionContext) {
          const version = document.version;
          let handle: string | undefined;
          try { handle = parseUri(document.uri).handle; } catch { /* local source */ }
          const connection = handle ? workspace.getProviderByHandle(handle) : undefined;
          if (token.isCancellationRequested) return [];
          const result = await provider.provideCompletionItems!(document, position, token, completionContext);
          if (token.isCancellationRequested || document.isClosed || document.version !== version || !languageFeaturesOn()
            || (connection && !connection.isConnected)
            || (handle && workspace.getProviderByHandle(handle) !== connection)) return [];
          return result;
        }
      } satisfies vscode.CompletionItemProvider),
      '.',
      '&',
      '%'
    )
  );
}
