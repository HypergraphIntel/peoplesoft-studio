import * as vscode from 'vscode';

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
  const m = prefix.match(/([%&A-Za-z0-9_\)\]]+)\s*\.\s*$/);
  return m?.[1];
}

export function registerPeopleCodeCompletion(context: vscode.ExtensionContext): void {
  const provider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position, _token, completionContext) {
      const prefix = linePrefix(document, position);
      const afterDot =
        completionContext.triggerCharacter === '.' || /\.\s*$/.test(prefix);

      if (afterDot) {
        const receiver = receiverBeforeDot(prefix) ?? '';
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

      for (const fn of BUILTIN_FUNCTIONS) {
        const item = new vscode.CompletionItem(fn.label, vscode.CompletionItemKind.Function);
        item.detail = fn.detail;
        if (fn.insert) item.insertText = new vscode.SnippetString(fn.insert);
        item.sortText = `2_${fn.label}`;
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

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'psft-peoplecode' },
      provider,
      '.',
      '&',
      '%'
    )
  );
}