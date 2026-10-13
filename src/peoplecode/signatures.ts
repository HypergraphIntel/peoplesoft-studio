/*
 * Signature help for common PeopleCode built-in functions: the parameter list
 * shown while a call is being typed. The function table is curated (not every
 * built-in), and finding which call and which parameter the cursor is in
 * (signatureContextAt) is pure text work, so both are tested without VS Code.
 */

export interface BuiltinSignature {
  /** The whole signature, e.g. "CreateRecord(Record.NAME)". */
  label: string;
  /** Parameter spans as they read in the label, in order. */
  parameters: string[];
  /** One-line description. */
  doc: string;
}

export const BUILTIN_SIGNATURES: Readonly<Record<string, BuiltinSignature>> = {
  createrecord: { label: 'CreateRecord(Record.RECORD)', parameters: ['Record.RECORD'], doc: 'A standalone Record object for the named record.' },
  getrecord: { label: 'GetRecord(Record.RECORD)', parameters: ['Record.RECORD'], doc: 'The record from the current context (row), optionally a named one.' },
  getfield: { label: 'GetField(Field.FIELD)', parameters: ['Field.FIELD'], doc: 'A field from the current record context.' },
  createsql: { label: 'CreateSQL(sqlText [, bindValues])', parameters: ['sqlText', 'bindValues'], doc: 'An open SQL object; binds may follow the statement.' },
  sqlexec: { label: 'SQLExec(sqlText [, bindValues] [, outputFields])', parameters: ['sqlText', 'bindValues', 'outputFields'], doc: 'Run one SQL statement; first row of output returned by reference.' },
  getrowset: { label: 'GetRowset([Scroll.RECORD])', parameters: ['Scroll.RECORD'], doc: 'A rowset from the component buffer, optionally a child scroll.' },
  createrowset: { label: 'CreateRowset(Record.RECORD [, args])', parameters: ['Record.RECORD', 'args'], doc: 'A standalone rowset built on the named record.' },
  msgget: { label: 'MsgGet(setNumber, messageNumber, defaultText [, args])', parameters: ['setNumber', 'messageNumber', 'defaultText', 'args'], doc: 'A message from the message catalog, with substitutions.' },
  msggettext: { label: 'MsgGetText(setNumber, messageNumber, defaultText [, args])', parameters: ['setNumber', 'messageNumber', 'defaultText', 'args'], doc: 'Catalog message text without the message-set prefix.' },
  error: { label: 'Error(messageText)', parameters: ['messageText'], doc: 'Stop processing with an error on the current field or row.' },
  warning: { label: 'Warning(messageText)', parameters: ['messageText'], doc: 'Issue a warning; processing may continue.' },
  messagebox: { label: 'MessageBox(style, title, setNumber, messageNumber, defaultText [, args])', parameters: ['style', 'title', 'setNumber', 'messageNumber', 'defaultText', 'args'], doc: 'Show a catalog message in a box.' },
  fetchvalue: { label: 'FetchValue([Scroll.RECORD, level,] Record.FIELD, row)', parameters: ['scroll', 'level', 'Record.FIELD', 'row'], doc: 'A single field value from a scroll level and row.' },
  all: { label: 'All(&field1 [, &field2, ...])', parameters: ['&field1', '...'], doc: 'True when every field passed has a value.' },
  none: { label: 'None(&field1 [, &field2, ...])', parameters: ['&field1', '...'], doc: 'True when none of the fields passed has a value.' },
  string: { label: 'String(value)', parameters: ['value'], doc: 'The value converted to a string.' },
  value: { label: 'Value(string)', parameters: ['string'], doc: 'The string converted to a number.' },
  substring: { label: 'Substring(source, start, length)', parameters: ['source', 'start', 'length'], doc: 'A substring, 1-based start.' },
  len: { label: 'Len(string)', parameters: ['string'], doc: 'The number of characters in the string.' },
  exact: { label: 'Exact(string1, string2)', parameters: ['string1', 'string2'], doc: 'True when the two strings match exactly (case-sensitive).' },
  round: { label: 'Round(number, places)', parameters: ['number', 'places'], doc: 'The number rounded to the given decimal places.' },
  addtodate: { label: 'AddToDate(date, years, months, days)', parameters: ['date', 'years', 'months', 'days'], doc: 'A date shifted by the given amounts.' },
  transfer: { label: 'Transfer(newInstance, MenuName.MENU, BarName.BAR, ItemName.ITEM, Page.PAGE, action [, keys])', parameters: ['newInstance', 'MenuName.MENU', 'BarName.BAR', 'ItemName.ITEM', 'Page.PAGE', 'action', 'keys'], doc: 'Transfer to another component/page.' },
  domodal: { label: 'DoModal(Page.PAGE, title, xpos, ypos [, scrollnum, row])', parameters: ['Page.PAGE', 'title', 'xpos', 'ypos', 'scrollnum', 'row'], doc: 'Open a secondary page modally.' },
  createprocessrequest: { label: 'CreateProcessRequest([processType, processName])', parameters: ['processType', 'processName'], doc: 'A ProcessRequest object to schedule a process.' }
};

export interface SignatureContext {
  /** Lower-cased function name the cursor is inside the call of. */
  name: string;
  /** 0-based index of the parameter the cursor is in (by commas at this call's depth). */
  activeParameter: number;
}

const IDENT_END = /[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The innermost call the cursor sits inside on `line` up to `character`: its function name and the
 * active parameter. Scans left, balancing parentheses, and reads the identifier before the open
 * paren. Undefined if the cursor is not inside a call.
 */
export function signatureContextAt(line: string, character: number): SignatureContext | undefined {
  const text = line.slice(0, character);
  let depth = 0;
  let commas = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        const before = text.slice(0, i);
        const m = IDENT_END.exec(before);
        if (!m) return undefined;
        return { name: m[0].toLowerCase(), activeParameter: commas };
      }
      depth--;
    } else if (ch === ',' && depth === 0) commas++;
  }
  return undefined;
}
