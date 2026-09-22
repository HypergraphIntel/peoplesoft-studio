import * as vscode from 'vscode';

/** Keywords and statements that appear at statement starts. */
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
  'Throw',
  'Declare',
];

/** Common built-in functions (add more as you go). */
const BUILTIN_FUNCTIONS: { label: string; detail?: string; insert?: string }[] = [
  { label: 'MessageBox', detail: 'Display a message', insert: 'MessageBox(${1:style}, ${2:title}, ${3:msgset}, ${4:msgnum}, ${5:default}, ${6:params});' },
  { label: 'WinMessage', detail: 'Simple message dialog', insert: 'WinMessage(${1:text});' },
  { label: 'Error', detail: 'Raise an error', insert: 'Error ${1:msg};' },
  { label: 'Warning', detail: 'Raise a warning', insert: 'Warning ${1:msg};' },
  { label: 'GetLevel0', detail: 'Return the level-0 rowset' },
  { label: 'CreateRowset', detail: 'Create a standalone rowset' },
  { label: 'CreateRecord', detail: 'Create a standalone record' },
  { label: 'CreateArray', detail: 'Create an array' },
  { label: 'CreateException', detail: 'Create an exception object' },
  { label: 'GetSQL', detail: 'Open a SQL object' },
  { label: 'Exec', detail: 'Execute a SQL statement' },
  { label: 'SQLExec', detail: 'Execute SQL and fetch one row' },
  { label: 'FetchSQL', detail: 'Fetch the next row from a SQL object' },
  { label: 'Close', detail: 'Close a SQL / file / etc.' },
  { label: 'IsNull', detail: 'Test for null' },
  { label: 'All', detail: 'True if every argument is non-null' },
  { label: 'None', detail: 'True if every argument is null' },
  { label: 'Len', detail: 'String or array length' },
  { label: 'Substring', detail: 'Extract a substring' },
  { label: 'Upper', detail: 'Upper-case a string' },
  { label: 'Lower', detail: 'Lower-case a string' },
  { label: 'NumberToString', detail: 'Convert number to string' },
  { label: 'String', detail: 'Convert value to string' },
  { label: 'Value', detail: 'Convert string to number' },
  { label: 'Date', detail: 'Construct a date' },
  { label: 'DateTime', detail: 'Construct a datetime' },
  { label: 'Time', detail: 'Construct a time' },
  { label: 'Abs', detail: 'Absolute value' },
  { label: 'Mod', detail: 'Modulo' },
  { label: 'Round', detail: 'Round a number' },
  { label: 'Truncate', detail: 'Truncate a number' },
  { label: 'Rem', detail: 'Remainder' },
  { label: 'Hash', detail: 'Hash a string' },
  { label: 'GenerateGUID', detail: 'Generate a GUID' },
  { label: 'GetUserId', detail: 'Current operator ID' },
  { label: 'GetSetId', detail: 'Resolve SetID' },
  { label: 'PanelGroupChanged', detail: 'Has the component been changed?' },
  { label: 'DoSave', detail: 'Save the component' },
  { label: 'DoSaveNow', detail: 'Save immediately' },
  { label: 'Transfer', detail: 'Transfer to another component' },
  { label: 'TransferPage', detail: 'Transfer to another page' },
  { label: 'SetNextPage', detail: 'Set the next page' },
  { label: 'EndModal', detail: 'Close a modal component' },
  { label: 'IsMenuItemAuthorized', detail: 'Security check' },
  { label: 'RevalidatePassword', detail: 'Force password re-entry' },
];

/** Common system variables. */
const SYSTEM_VARS: string[] = [
  '%Component', '%Menu', '%Page', '%Mode',
  '%OperatorId', '%EmployeeId', '%UserId',
  '%ClientType', '%Language', '%Market',
  '%AsOfDate', '%Date', '%DateTime', '%Time',
  '%Session', '%Portal', '%Node',
  '%This', '%Parent',
  '%Request', '%Response',
  '%FilePath', '%ServerTimeZone',
];

/** A few very common object members (after a "."). Expand later. */
const COMMON_MEMBERS: { label: string; isMethod: boolean; detail?: string }[] = [
  { label: 'GetRow', isMethod: true, detail: 'Rowset.GetRow(n)' },
  { label: 'GetRowset', isMethod: true, detail: 'Row.GetRowset(scroll)' },
  { label: 'GetRecord', isMethod: true, detail: 'Row.GetRecord(recname)' },
  { label: 'GetField', isMethod: true, detail: 'Record.GetField(fieldname)' },
  { label: 'ActiveRowCount', isMethod: false },
  { label: 'CurrentRowNumber', isMethod: false },
  { label: 'IsChanged', isMethod: false },
  { label: 'IsDeleted', isMethod: false },
  { label: 'IsNew', isMethod: false },
  { label: 'Name', isMethod: false },
  { label: 'Value', isMethod: false },
  { label: 'DisplayName', isMethod: false },
  { label: 'Enabled', isMethod: false },
  { label: 'Visible', isMethod: false },
  { label: 'Label', isMethod: false },
  { label: 'Flush', isMethod: true },
  { label: 'Select', isMethod: true },
  { label: 'InsertRow', isMethod: true },
  { label: 'DeleteRow', isMethod: true },
  { label: 'Sort', isMethod: true },
  { label: 'Fill', isMethod: true },
  { label: 'CopyTo', isMethod: true },
  { label: 'CopyFieldsTo', isMethod: true },
];

export function registerPeopleCodeCompletion(context: vscode.ExtensionContext): void {
  const provider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position, _token, completionContext) {
      const linePrefix = document
        .lineAt(position)
        .text
        .slice(0, position.character);

      // After a dot → member completion
      if (/\.\s*$/.test(linePrefix) || completionContext.triggerCharacter === '.') {
        return COMMON_MEMBERS.map((m) => {
          const kind = m.isMethod
            ? vscode.CompletionItemKind.Method
            : vscode.CompletionItemKind.Property;
          const item = new vscode.CompletionItem(m.label, kind);
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
        if (fn.insert) {
          item.insertText = new vscode.SnippetString(fn.insert);
        }
        item.sortText = `2_${fn.label}`;
        items.push(item);
      }

      for (const v of SYSTEM_VARS) {
        const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.Variable);
        item.detail = 'System variable';
        item.sortText = `3_${v}`;
        items.push(item);
      }

      // Lightweight local-variable harvest from the current document
      const text = document.getText();
      const seen = new Set<string>();
      const re = /&[A-Za-z][A-Za-z0-9_]*/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        const name = match[0];
        if (!seen.has(name)) {
          seen.add(name);
          const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
          item.detail = 'Local / component variable';
          item.sortText = `4_${name}`;
          items.push(item);
        }
      }

      return items;
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'psft-peoplecode' },
      provider,
      '.',  // trigger on dot
      '&',  // trigger on ampersand (variables)
      '%'   // trigger on percent (system vars)
    )
  );
}