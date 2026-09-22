import * as vscode from 'vscode';

/** Keyword / statement docs. Keys are matched case-insensitively. */
const KEYWORDS: Record<string, string> = {
  'If': 'Conditional branch. `If <condition> Then … End-If;`',
  'Then': 'Starts the body of an `If` or `When` clause.',
  'Else': 'Alternate branch of an `If`.',
  'End-If': 'Closes an `If` block.',
  'For': 'Counted loop. `For &i = 1 To n [Step s] … End-For;`',
  'To': 'Upper bound of a `For` loop.',
  'Step': 'Optional step of a `For` loop (can be negative).',
  'End-For': 'Closes a `For` loop.',
  'While': 'Condition loop. `While <condition> … End-While;`',
  'End-While': 'Closes a `While` loop.',
  'Repeat': 'Post-test loop. `Repeat … Until <condition>;`',
  'Until': 'Exit condition of a `Repeat` loop.',
  'Evaluate': 'Multi-way branch on an expression. `Evaluate <expr> … End-Evaluate;`',
  'When': 'One case of an `Evaluate`.',
  'When-Other': 'Default case of an `Evaluate`.',
  'End-Evaluate': 'Closes an `Evaluate` block.',
  'Break': 'Exit the innermost loop or `Evaluate`.',
  'Continue': 'Skip to the next iteration of the innermost loop.',
  'Exit': 'Leave the current PeopleCode program.',
  'Return': 'Return from a function or method (optionally with a value).',
  'Local': 'Declare a variable scoped to the current program.',
  'Global': 'Declare a variable with process-wide lifetime.',
  'Component': 'Declare a variable scoped to the component buffer.',
  'Function': 'Declare a function. `Function Name([params]) [Returns type]; … End-Function;`',
  'End-Function': 'Closes a `Function` body.',
  'Method': 'Declare a method on an Application Class.',
  'End-Method': 'Closes a `Method` body.',
  'Class': 'Start an Application Class definition.',
  'End-Class': 'Closes a `Class` definition.',
  'Import': 'Import an Application Package or class.',
  'As': 'Type annotation on a variable, parameter, or property.',
  'Try': 'Start a try/catch block.',
  'Catch': 'Handle an exception. `Catch Exception &e`',
  'End-Try': 'Closes a `Try` block.',
  'Throw': 'Raise an exception.',
  'Declare': 'Declare an external (DLL) function.',
  'Library': 'DLL name in a `Declare Function … Library "…"` statement.',
  'Alias': 'Optional real export name for a DLL function.',
  'Error': 'Stop processing and show an error message.',
  'Warning': 'Show a warning; processing continues.',
  'True': 'Boolean true.',
  'False': 'Boolean false.',
  'Null': 'Null object / empty reference.',
  'And': 'Logical AND.',
  'Or': 'Logical OR.',
  'Not': 'Logical NOT.',
  'private': 'Application Class member visibility.',
  'protected': 'Application Class member visibility.',
  'instance': 'Instance variable on an Application Class.',
  'property': 'Application Class property.',
  'get': 'Property getter.',
  'set': 'Property setter.',
  'abstract': 'Abstract method or interface member.',
  'interface': 'Application Class interface.',
  'end-interface': 'Closes an interface.',
  'out': 'Output (by-reference) parameter modifier.',
  'Value': 'Pass-by-value for a DLL parameter.',
  'Ref': 'Pass-by-reference for a DLL parameter.',
};

/** Built-in functions: short signature + description. */
const BUILTINS: Record<string, string> = {
  'MessageBox':
    '```peoplecode\nMessageBox(style, title, msgset, msgnum, default [, params])\n```\nDisplay a message dialog. Returns the button the user chose.',
  'WinMessage':
    '```peoplecode\nWinMessage(text [, style])\n```\nSimple message dialog.',
  'MsgGet':
    '```peoplecode\nMsgGet(msgset, msgnum, default [, params])\n```\nReturn a message catalog string (no dialog).',
  'MsgGetText':
    '```peoplecode\nMsgGetText(msgset, msgnum, default [, params])\n```\nReturn message catalog text only.',
  'Error':
    '```peoplecode\nError msg\n```\nAbort with an error (also a keyword form).',
  'Warning':
    '```peoplecode\nWarning msg\n```\nWarn and continue (also a keyword form).',
  'GetLevel0':
    '```peoplecode\nGetLevel0() Returns Rowset\n```\nLevel-0 rowset of the component buffer.',
  'CreateRowset':
    '```peoplecode\nCreateRowset(Record.recname [, …]) Returns Rowset\n```\nStandalone rowset.',
  'CreateRecord':
    '```peoplecode\nCreateRecord(Record.recname) Returns Record\n```\nStandalone record.',
  'CreateArray':
    '```peoplecode\nCreateArray() / CreateArrayAny() / CreateArrayRept(…)\n```\nCreate an array.',
  'CreateException':
    '```peoplecode\nCreateException(msgset, msgnum, default [, params]) Returns Exception\n```',
  'GetSQL':
    '```peoplecode\nGetSQL(SQL.sqlname [, binds…]) Returns SQL\n```\nOpen a SQL definition.',
  'SQLExec':
    '```peoplecode\nSQLExec(sql [, in-binds…] [, out-vars…])\n```\nRun SQL and fetch at most one row.',
  'Exec':
    '```peoplecode\nExec(command_str [, boolean])\n```\nRun an OS command.',
  'IsNull':
    '```peoplecode\nIsNull(value) Returns boolean\n```',
  'All':
    '```peoplecode\nAll(a, b, …) Returns boolean\n```\nTrue if every argument is non-null / non-blank.',
  'None':
    '```peoplecode\nNone(a, b, …) Returns boolean\n```\nTrue if every argument is null / blank.',
  'Len':
    '```peoplecode\nLen(string | array) Returns number\n```',
  'Substring':
    '```peoplecode\nSubstring(str, start [, length]) Returns string\n```',
  'Upper': '```peoplecode\nUpper(str) Returns string\n```',
  'Lower': '```peoplecode\nLower(str) Returns string\n```',
  'String': '```peoplecode\nString(value) Returns string\n```',
  'Value': '```peoplecode\nValue(str) Returns number\n```',
  'NumberToString': '```peoplecode\nNumberToString(n) Returns string\n```',
  'Quote': '```peoplecode\nQuote(str) Returns string\n```\nWrap in quotes and escape embedded quotes.',
  'JsonEscape':
    '```peoplecode\nJsonEscape(str) Returns string\n```\nEscape a string for JSON.',
  'GetHTMLText':
    '```peoplecode\nGetHTMLText(HTML.htmlname [, params…]) Returns string\n```',
  'GetUserId': '```peoplecode\nGetUserId() Returns string\n```',
  'GetSetId':
    '```peoplecode\nGetSetId(field, value, setCntrlField, setCntrlValue) Returns string\n```',
  'DoSave': '```peoplecode\nDoSave()\n```\nSave the component (deferred).',
  'DoSaveNow': '```peoplecode\nDoSaveNow()\n```\nSave the component immediately.',
  'Transfer':
    '```peoplecode\nTransfer(new_instance, menu, bar, item, page, action, keylist…)\n```',
  'TransferPage': '```peoplecode\nTransferPage(page)\n```',
  'SetNextPage': '```peoplecode\nSetNextPage(page)\n```',
  'EndModal': '```peoplecode\nEndModal(returnvalue)\n```',
  'GenerateGUID': '```peoplecode\nGenerateGUID() Returns string\n```',
  'Hash': '```peoplecode\nHash(str) Returns string\n```',
  'Rem': '```peoplecode\nRem(a, b) Returns number\n```\nRemainder.',
  'Mod': '```peoplecode\nMod(a, b) Returns number\n```',
  'Abs': '```peoplecode\nAbs(n) Returns number\n```',
  'Round': '```peoplecode\nRound(n, precision) Returns number\n```',
  'Truncate': '```peoplecode\nTruncate(n, precision) Returns number\n```',
  'Date': '```peoplecode\nDate(year, month, day) Returns date\n```',
  'DateTime': '```peoplecode\nDateTimeValue(str) / DateTime6(…)\n```',
  'Time': '```peoplecode\nTime(hour, minute, second) Returns time\n```',
  'CreateObject':
    '```peoplecode\nCreateObject(class_name [, args…]) Returns object\n```',
  'GetField':
    'Often `Record.GetField(Field.fieldname)` — return a Field object from a record.',
  'GetRecord':
    'Often `Row.GetRecord(Record.recname)` — return a Record from a row.',
  'GetRowset':
    'Often `Row.GetRowset(Scroll.recname)` — child rowset.',
  'GetRow':
    '```peoplecode\nRowset.GetRow(index) Returns Row\n```',
};

/** System variables. */
const SYSTEM_VARS: Record<string, string> = {
  '%Component': 'Current component name.',
  '%Menu': 'Current menu name.',
  '%Page': 'Current page name.',
  '%Mode': 'Component mode: `"A"` add, `"U"` update, `"L"` update/display all, etc.',
  '%OperatorId': 'Signed-on operator ID.',
  '%EmployeeId': 'Employee ID of the signed-on user (when applicable).',
  '%UserId': 'User ID (often same as operator).',
  '%ClientType': 'Client type (Windows, Web, …).',
  '%Language': 'Session language code.',
  '%Market': 'Market of the current component.',
  '%AsOfDate': 'As-of date for effective-dated processing.',
  '%Date': 'Current date on the app server.',
  '%DateTime': 'Current datetime on the app server.',
  '%Time': 'Current time on the app server.',
  '%Session': 'Session object.',
  '%Portal': 'Current portal name.',
  '%Node': 'Current node name.',
  '%This': 'Current Application Class instance (in methods).',
  '%Parent': 'Parent object in some component-interface / row contexts.',
  '%Request': 'Request object (iScripts / web).',
  '%Response': 'Response object (iScripts / web).',
  '%FilePath': 'File path context when running file-related operations.',
  '%ServerTimeZone': 'Application server time zone.',
  '%ProcessProfile': 'Process scheduler profile.',
  '%EmailAddress': 'Email address of the current user (when available).',
  '%BPName': 'Business process name (workflow).',
  '%RunningTransformAppEngine': 'True when running inside a transform AE.',
};

const RECORD_FIELD_RE = /^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/;

function wordRangeAt(document: vscode.TextDocument, position: vscode.Position): vscode.Range | undefined {
  // Include % and & and dots so %Mode, &foo, Record.FIELD hover as one token.
  return document.getWordRangeAtPosition(position, /[%&A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)?/);
}

function lookup(word: string): string | undefined {
  if (!word) return undefined;

  if (word.startsWith('%')) {
    return SYSTEM_VARS[word] ?? SYSTEM_VARS[word.toUpperCase()] ??
      `System variable \`${word}\`.`;
  }

  if (RECORD_FIELD_RE.test(word)) {
    const [rec, fld] = word.split('.');
    return `Record field reference **${rec}.${fld}**.\n\n_Live field metadata is not resolved yet._`;
  }

  const key = Object.keys(KEYWORDS).find((k) => k.toLowerCase() === word.toLowerCase());
  if (key) return KEYWORDS[key];

  const fn = Object.keys(BUILTINS).find((k) => k.toLowerCase() === word.toLowerCase());
  if (fn) return BUILTINS[fn];

  if (word.startsWith('&')) {
    return `PeopleCode variable \`${word}\`.`;
  }

  return undefined;
}

export function registerPeopleCodeHover(context: vscode.ExtensionContext): void {
  const provider: vscode.HoverProvider = {
    provideHover(document, position) {
      const range = wordRangeAt(document, position);
      if (!range) return undefined;

      const word = document.getText(range);
      const md = lookup(word);
      if (!md) return undefined;

      const contents = new vscode.MarkdownString(md);
      contents.isTrusted = false;
      //contents.supportFencedCodeBlocks = true;
      return new vscode.Hover(contents, range);
    },
  };

  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ language: 'psft-peoplecode' }, provider)
  );
}