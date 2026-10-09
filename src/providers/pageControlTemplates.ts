/*
 * The full PSPNLFIELD and PSPNLFIELDEXT rows App Designer (8.62.09) writes
 * when a control is dropped on a page, captured on ZZ_PCODE_LAB_PG
 * (tools/corpus/save-protocol/results): 02-add-edit (Edit Box), 06-types
 * (Drop-Down List Box, Check Box, Push Button), 07-groupbox (Group Box),
 * 15-static-text, 16-frame, 17-hrule and 18-number-datetime (Edit Boxes on a
 * number and a datetime field). A new control is one of these rows with the
 * page, id, order, position, label and record field filled in.
 *
 * DSPLFORMAT varies across delivered controls (Edit Boxes carry 298 values,
 * after years of property edits), but a fresh one is the same per kind: the
 * Edit Box value is identical on character (02), number and datetime (18)
 * fields. Two PSPNLFIELDEXT columns follow the field's type: on a character
 * field FFSTYLELONG is ' | | | | ' and an Edit Box sets PTDISABLESMARTPROM
 * (smart prompt is character typeahead); otherwise ' ' and 0. Record-bound
 * controls are only added on the field types a capture covers (FIELD_TYPES_SEEN);
 * others are refused until one does.
 */

export type NewControlKind = 'groupBox' | 'frame' | 'staticText' | 'horizontalRule' | 'editBox' | 'dropDown' | 'checkBox' | 'pushButton';

/** PSDBFIELD.FIELDTYPE values per kind that a capture has shown App Designer's fresh row for. */
export const FIELD_TYPES_SEEN: Partial<Record<NewControlKind, Record<number, string>>> = {
  editBox: { 0: 'character', 2: 'number', 6: 'datetime' },
  dropDown: { 0: 'character' },
  checkBox: { 0: 'character' },
  pushButton: { 0: 'character' }
};
const FIELD_TYPE_NAMES: Record<number, string> = {
  0: 'character', 1: 'long character', 2: 'number', 3: 'signed number', 4: 'date', 5: 'time', 6: 'datetime', 8: 'image', 9: 'image reference'
};

/** A control the Layout editor added, in what it chose; the rest is the template. */
export interface NewControl {
  kind: NewControlKind;
  /** The record field it is bound to (blank for a Group Box). */
  recName: string;
  fieldName: string;
}

/** The field a record-bound control is placed on, read before the insert. */
export interface FieldInfo {
  /** PSDBFIELD.FIELDTYPE (0 = character) and LENGTH. */
  fieldType: number;
  length: number;
  /** The field's default label (PSDBFLDLABL DEFAULT_LABEL = 1): LABEL_ID and LONGNAME. */
  labelId: string;
  labelText: string;
}

/** The placement and label the editor set on the new control. */
export interface NewControlPlacement {
  fieldLeft: number;
  fieldTop: number;
  fieldRight: number;
  fieldBottom: number;
  fieldSizeType: number;
  lblType: number;
  /** Blank: the field's default label (record-bound) or the template's text. */
  lblText: string;
  fieldUse: number;
  secureInvisible: number;
}

export type ColumnValues = Record<string, number | string | null>;

/** FIELDTYPE per kind. */
export const NEW_CONTROL_FIELDTYPE: Record<NewControlKind, number> = {
  staticText: 0, frame: 1, groupBox: 2, editBox: 4, dropDown: 5, checkBox: 7, pushButton: 12, horizontalRule: 23
};

/** Whether the kind is placed on a record field. */
export const isRecordBound = (kind: NewControlKind): boolean => kind in FIELD_TYPES_SEEN;

/** The size App Designer gives a fresh control (0,0 = auto-sized from the field). */
export const NEW_CONTROL_SIZE: Record<NewControlKind, { width: number; height: number; fieldSizeType: number; lblType: number; lblText: string }> = {
  groupBox: { width: 300, height: 156, fieldSizeType: 0, lblType: 1, lblText: 'Group Box' },
  // Frame and rule sizes are the ones drawn in 16 / 17; static text is App Designer's default box.
  frame: { width: 300, height: 156, fieldSizeType: 0, lblType: 0, lblText: 'Frame' },
  staticText: { width: 128, height: 20, fieldSizeType: 0, lblType: 1, lblText: 'Static Text' },
  horizontalRule: { width: 300, height: 2, fieldSizeType: 0, lblType: 0, lblText: '' },
  editBox: { width: 0, height: 0, fieldSizeType: 0, lblType: 3, lblText: '' },
  dropDown: { width: 0, height: 0, fieldSizeType: 0, lblType: 3, lblText: '' },
  checkBox: { width: 0, height: 0, fieldSizeType: 0, lblType: 3, lblText: '' },
  pushButton: { width: 24, height: 22, fieldSizeType: 3, lblType: 1, lblText: '' }
};

/** PSPNLFIELD columns every captured insert shares (02-add-edit's Edit Box, less what varies by kind). */
const FIELD_COMMON: ColumnValues = {
  PNLFIELDNAME: ' ', EDITSIZE: 0, EDITLBLLEFT: 0, EDITLBLTOP: 0, EDITLBLRIGHT: 0, EDITLBLBOTTOM: 0, DSPLFILL: ' ',
  LBLPADSIZE: 0, USEDEFAULTLABEL: 1, FIELDUSETMP: 0, DEFERPROC: 1, OCCURSLEVEL: 0, ONVALUE: ' ', OFFVALUE: ' ',
  ASSOCFIELDNUM: 0, OCCURSCOUNT1: 1, OCCURSOFFSET1: 20, OCCURSCOUNT2: 1, OCCURSOFFSET2: 20, OCCURSCOUNT3: 1, OCCURSOFFSET3: 20,
  SUBPNLNAME: ' ', SUBPNLVER: 0, FIELDSTYLE: ' ', LABELSTYLE: ' ', LABELSIZETYPE: 0, PRCSTYPE: ' ', PRCSNAME: ' ',
  PROMPTFIELD: ' ', FORMATFAMILY: ' ', DISPFMTNAME: ' ', POPUPMENU: ' ', TREECTRLID: 0, TREECTRLTYPE: 0, MULTIRECTREE: 0,
  NODECOUNT: 0, GRDCOLUMNCOUNT: 0, GRDSHOWCOLHDG: 0, GRDSHOWROWHDG: 0, GRDODDROWSTYLE: ' ', GRDEVENROWSTYLE: ' ',
  GRDACTIVETABSTYLE: ' ', GRDINACTIVETABSTYL: ' ', GRDNAVBARSTYLE: ' ', GRDLABELSTYLE: ' ', GRDLBLMSGSET: 0, GRDLBLMSGNUM: 0,
  GRDLBLALIGN: 0, GRDACTTYPE: 0, GRDALLOWCOLSORT: 0, TABENABLE: 0, OPENNEWWINDOW: 0, URLDYNAMIC: 0, URL_ID: ' ',
  GOTOPORTALNAME: ' ', GOTONODENAME: ' ', GOTOMENUNAME: ' ', GOTOPNLGRPNAME: ' ', GOTOMKTNAME: ' ', GOTOPNLNAME: ' ',
  GOTOPNLACTION: 0, SRCHBYPNLDATA: 0, SCROLLACTION: 0, TOOLACTION: 0, CONTNAME: ' ', CONTNAMEOVER: ' ', CONTNAMEDISABLE: ' ',
  PTLBLIMGCOLLAPSE: ' ', PTLBLIMGEXPAND: ' ', PTADJHIDDENFIELDS: 0, PTCOLLAPSEDATAAREA: 0, PTDFLTVIEWEXPANDED: 0,
  PTHIDEFIELDS: 0, SHOWCOLHIDEROWS: 0, PTLEBEXPANDFIELD: 0, SHOWTABCNTLBTN: 0, SELINDICATORTYPE: 0, ENABLEASANCHOR: 0,
  URLENCODEDBYAPP: 0
};

/** PSPNLFIELD columns that differ by kind, as captured. */
const FIELD_BY_KIND: Record<NewControlKind, ColumnValues> = {
  editBox: { DSPLFORMAT: 2097160, LBLLOC: 1, PBDISPLAYTYPE: 0 },
  dropDown: { DSPLFORMAT: 2228224, LBLLOC: 1, PBDISPLAYTYPE: 0 },
  checkBox: { DSPLFORMAT: 524289, LBLLOC: 1, PBDISPLAYTYPE: 0, ONVALUE: 'Y', OFFVALUE: 'N' },
  pushButton: { DSPLFORMAT: 540672, LBLLOC: 0, PBDISPLAYTYPE: 2 },
  groupBox: { DSPLFORMAT: 1, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  frame: { DSPLFORMAT: 1, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  staticText: { DSPLFORMAT: 16385, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  horizontalRule: { DSPLFORMAT: 0, LBLLOC: 0, PBDISPLAYTYPE: 0 }
};

/** PSPNLFIELDEXT, as captured; PARENTPNLFLDID / PAGEPNLFLDID are "<page>$0" for a classic page's controls. */
const EXT_COMMON: ColumnValues = {
  PTMODALHEIGHT: 0, PTMODALWIDTH: 0, PTPOPUPPNL: ' ', MESSAGE_SET_NBR: 0, MESSAGE_NBR: 0, PT_RELACTDEFAULTJS: ' ',
  PT_NUMFLD1: 0, GRPBOXTYPE: 0, GRPBOXHTMLTYPE: 0, HTML_INPUT_TYPE: 0, PLHTYPE: 0, PLACEHOLDER: ' ', PLH_MSG_SET_NBR: 0,
  PLH_MSG_NBR: 0, SCROLLBARS: 0, MINNUMBER: ' ', MAXNUMBER: ' ', STEPNUMBER: ' ', PTWIDGETSNGACTMNU: 0, PTDSPLINRELACTMNU: 0,
  PTSHOWWIDGET: 0, PTASSOCWIDGET: 0, FIELDUSETEMP2: 0, PTGBRELTXTINFO: 0, PTGBRELACTINFO: 0, PTGBRELACTFLD: 0,
  PTFRMTOVERRIDE: 0, PTDISABLESMARTSEL: 0
};

/** PTDISABLESMARTPROM and FFSTYLELONG: by the bound field's type (see above); static text's FFSTYLELONG is NULL (15). */
function extByKind(kind: NewControlKind, field: FieldInfo | undefined): ColumnValues {
  if (kind === 'staticText') return { PTDISABLESMARTPROM: 0, FFSTYLELONG: null };
  const character = isRecordBound(kind) && field?.fieldType === 0;
  return { PTDISABLESMARTPROM: character && kind === 'editBox' ? 1 : 0, FFSTYLELONG: character ? ' | | | | ' : ' ' };
}

/** Why a field cannot carry this kind of new control, or undefined when it can. */
export function newControlFieldRefusal(kind: NewControlKind, recName: string, fieldName: string, field: FieldInfo | undefined): string | undefined {
  if (!isRecordBound(kind)) return undefined;
  if (!recName.trim() || !fieldName.trim()) return `A new ${kind} needs a record field.`;
  if (!field) return `${recName}.${fieldName} is not a field of record ${recName}.`;
  const seen = FIELD_TYPES_SEEN[kind] ?? {};
  if (!(field.fieldType in seen)) {
    const type = FIELD_TYPE_NAMES[field.fieldType] ?? `type ${field.fieldType}`;
    return `${recName}.${fieldName} is a ${type} field; a new ${kind} is only added on ${Object.values(seen).join(', ')} fields so far (the types a captured App Designer save covers).`;
  }
  if (kind === 'checkBox' && field.length !== 1) return `A Check Box needs a one-character field; ${recName}.${fieldName} is ${field.length} long.`;
  return undefined;
}

const blank = (s: string) => (s.trim() ? s : ' ');

/** The PSPNLFIELD and PSPNLFIELDEXT rows of a new control, as App Designer writes them. */
export function newControlRows(pnlName: string, pnlFldId: number, fieldNum: number, add: NewControl,
  placed: NewControlPlacement, field: FieldInfo | undefined): { field: ColumnValues; ext: ColumnValues } {
  const bound = isRecordBound(add.kind);
  const button = add.kind === 'pushButton';
  // A record-bound control (other than a button) takes its field's default label unless the editor typed one.
  const labelId = bound && !button ? blank(field?.labelId ?? '') : ' ';
  const lblText = placed.lblText.trim() ? placed.lblText
    : bound && !button ? blank(field?.labelText ?? '')
    : blank(NEW_CONTROL_SIZE[add.kind].lblText);
  return {
    field: {
      PNLNAME: pnlName, PNLFLDID: pnlFldId, FIELDNUM: fieldNum, ...FIELD_COMMON, ...FIELD_BY_KIND[add.kind],
      FIELDTYPE: NEW_CONTROL_FIELDTYPE[add.kind],
      FIELDLEFT: placed.fieldLeft, FIELDTOP: placed.fieldTop, FIELDRIGHT: placed.fieldRight, FIELDBOTTOM: placed.fieldBottom,
      FIELDSIZETYPE: placed.fieldSizeType, LBLTYPE: placed.lblType, LABEL_ID: labelId, LBLTEXT: lblText,
      FIELDUSE: placed.fieldUse, SECUREINVISIBLE: placed.secureInvisible,
      RECNAME: blank(add.recName), FIELDNAME: bound ? blank(add.fieldName) : ' '
    },
    ext: { PNLNAME: pnlName, PNLFLDID: pnlFldId, ...EXT_COMMON, ...extByKind(add.kind, field), PARENTPNLFLDID: `${pnlName}$0`, PAGEPNLFLDID: `${pnlName}$0` }
  };
}
