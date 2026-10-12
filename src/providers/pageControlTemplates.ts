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
 * others are refused until one does. A Scroll Area (lv02, sa-fresh) and a Scroll Bar (lv03, sb-fresh) are
 * at OCCURSLEVEL 1 when inserted; the save assigns every level from the tab order (pageLevels.ts).
 *
 * Captured on ZZ_PCODE_LAB_IN (0.8.3): an Image unbound and on an image field (im-fresh, im-field), a Tree with
 * its levels (tr-fresh, tr-nodes), a Chart (ch-fresh, ch-field), a Secondary Page (sp-fresh), a Subpage plain and
 * with a record substitution (sbp-fresh, sb-subst), a Grid and its first column (gd-fresh, gd-column), a Tab
 * Separator in it (ts-fresh) and an Analytic Grid (ag-fresh). A Subpage takes its subpage's own rectangle
 * (PSPNLDEFN PANELLEFT..BOTTOM) wherever it is dropped; a Grid's and an Analytic Grid's Page Field Name is their
 * record; a Tree's TREECTRLID is its FIELDNUM (re-derived at every save, pageWriter.ts).
 */

export type NewControlKind = 'groupBox' | 'frame' | 'staticText' | 'horizontalRule' | 'editBox' | 'dropDown' | 'checkBox' | 'pushButton'
  | 'staticImage' | 'radioButton' | 'longEdit' | 'htmlArea' | 'scrollArea' | 'scrollBar'
  | 'image' | 'tree' | 'chart' | 'secondaryPage' | 'subpage' | 'grid' | 'tabSeparator' | 'analyticGrid';

/** PSDBFIELD.FIELDTYPE values per kind that a capture has shown App Designer's fresh row for. */
export const FIELD_TYPES_SEEN: Partial<Record<NewControlKind, Record<number, string>>> = {
  editBox: { 0: 'character', 2: 'number', 6: 'datetime' },
  dropDown: { 0: 'character' },
  checkBox: { 0: 'character' },
  pushButton: { 0: 'character' },
  radioButton: { 0: 'character' },
  longEdit: { 1: 'long character' },
  htmlArea: { 1: 'long character' },
  image: { 8: 'image', 9: 'image reference' },
  chart: { 0: 'character' },
  tree: { 0: 'character' }
};

/** Kinds placed on a record whose field is optional: an HTML Area may name only the record (ht-fresh) or a field too (ht-field). */
export const FIELD_OPTIONAL: ReadonlySet<NewControlKind> = new Set<NewControlKind>(['htmlArea', 'tree']);
/** Kinds App Designer saves with no record at all, or a record and field (im-fresh / im-field, ch-fresh / ch-field). */
export const RECORD_OPTIONAL: ReadonlySet<NewControlKind> = new Set<NewControlKind>(['image', 'chart']);
/** Kinds placed on a record alone -- a grid's main record (gd-fresh, ag-fresh). */
export const RECORD_ONLY: ReadonlySet<NewControlKind> = new Set<NewControlKind>(['grid', 'analyticGrid']);
/** Kinds that show another page: a Secondary Page (Page) and a Subpage (Subpage, with an optional record substitution). */
export const PAGE_REFERENCE: ReadonlySet<NewControlKind> = new Set<NewControlKind>(['secondaryPage', 'subpage']);
/** Kinds that only go inside a grid, as one of its columns (a Tab Separator: App Designer refuses it elsewhere). */
export const GRID_ONLY: ReadonlySet<NewControlKind> = new Set<NewControlKind>(['tabSeparator']);
/** A Grid's and an Analytic Grid's FIELDTYPEs: the controls after them at (0, 0) are their columns (GRDCOLUMNCOUNT). */
export const GRID_FIELD_TYPES: ReadonlySet<number> = new Set([19, 32]);
const FIELD_TYPE_NAMES: Record<number, string> = {
  0: 'character', 1: 'long character', 2: 'number', 3: 'signed number', 4: 'date', 5: 'time', 6: 'datetime', 8: 'image', 9: 'image reference'
};

/** A control the Layout editor added, in what it chose; the rest is the template. */
export interface NewControl {
  kind: NewControlKind;
  /** The record field it is bound to (blank for a Group Box). */
  recName: string;
  fieldName: string;
  /** A Secondary Page's or Subpage's page (SUBPNLNAME). */
  subPage?: string;
  /** A Tree's levels below its root (PSPNLTREECTRL): each a record field, a child of the one before. */
  treeLevels?: Array<{ recName: string; fieldName: string }>;
  /** An Analytic Grid's model, cube collection and axes (PSPNLACEGRDDATA / PSPNLACEGRDAXIS). */
  analytic?: AnalyticGridSettings;
  /** A column of this grid (its PNLFLDID, or the negative id of a grid added in the same save). */
  intoGrid?: number;
}

/** PSPNLACEGRDDATA.ACEGRIDAXISTYPE / PSPNLACEGRDAXIS.ACEGRIDAXISTYPE: the Analytic Grid dialog's axes. */
export const ANALYTIC_AXES: Readonly<Record<number, string>> = { 0: 'Slicer Axis', 1: 'Column Axis', 2: 'Row Axis' };

export interface AnalyticGridSettings {
  model: string;
  collection: string;
  /** Non-Dimensional Fields: 0 Slicer, 1 Column (the default), 2 Row. */
  nonDimensionalAxis?: number;
  /** The dimensional fields' axes; by default every dimension of the collection on the Row Axis (ag-fresh). */
  axes?: Array<{ fieldName: string; axis: number }>;
  /** Freeze Column Mode (ACEGRIDFRZCOLMODE). */
  freezeColumns?: boolean;
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
  /** PSPNLFIELD.OCCURSLEVEL: the scroll-nesting level at the drop point (0 outside any scroll). */
  occursLevel?: number;
}

export type ColumnValues = Record<string, number | string | null>;

/** FIELDTYPE per kind. */
export const NEW_CONTROL_FIELDTYPE: Record<NewControlKind, number> = {
  staticText: 0, frame: 1, groupBox: 2, staticImage: 3, editBox: 4, dropDown: 5, longEdit: 6, checkBox: 7,
  radioButton: 8, pushButton: 12, horizontalRule: 23, htmlArea: 25, scrollBar: 10, scrollArea: 27,
  image: 9, tree: 20, chart: 30, secondaryPage: 18, subpage: 11, grid: 19, tabSeparator: 24, analyticGrid: 32
};

/** FIELDUSE App Designer sets on a fresh control, where it is not 0 (a Static Image is display-only, in01). */
export const NEW_CONTROL_FIELDUSE: Partial<Record<NewControlKind, number>> = { staticImage: 1, scrollBar: 2, secondaryPage: 2, grid: 4096, analyticGrid: 1 };

/** Whether the kind is placed on a record field. */
export const isRecordBound = (kind: NewControlKind): boolean => kind in FIELD_TYPES_SEEN;
/** Whether the kind names a record (bound to a field, or a grid's main record). */
export const namesRecord = (kind: NewControlKind): boolean => isRecordBound(kind) || RECORD_ONLY.has(kind);

/** Kinds whose fresh label keeps the field's text but, unlike an Edit Box, no LABEL_ID (App Designer leaves it blank, rb-fresh). */
const BLANK_LABEL_ID: ReadonlySet<NewControlKind> = new Set<NewControlKind>(['radioButton']);

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
  pushButton: { width: 24, height: 22, fieldSizeType: 3, lblType: 1, lblText: '' },
  // Static Image and HTML Area: App Designer drops a 4 x 4 box (in01, ht-fresh, ht-field). A Static Image's alt-label
  // type is 6 (None), text "Static Image"; an HTML Area has no label (type 0).
  staticImage: { width: 4, height: 4, fieldSizeType: 0, lblType: 6, lblText: 'Static Image' },
  htmlArea: { width: 4, height: 4, fieldSizeType: 0, lblType: 0, lblText: '' },
  // Radio Button and Long Edit Box are auto-sized from the field, like an Edit Box (rb-fresh, le-fresh).
  radioButton: { width: 0, height: 0, fieldSizeType: 0, lblType: 1, lblText: '' },
  longEdit: { width: 0, height: 0, fieldSizeType: 0, lblType: 3, lblText: '' },
  // A Scroll Area is drawn (sa-fresh: 360 x 200); a Scroll Bar dropped with a click is 17 x 4 (lv03) and invisible.
  scrollArea: { width: 360, height: 200, fieldSizeType: 0, lblType: 1, lblText: 'Scroll Area' },
  scrollBar: { width: 17, height: 4, fieldSizeType: 0, lblType: 0, lblText: 'Scroll Bar' },
  // Image, Tree and Chart dropped with a click are 4 x 4 (im-fresh, tr-fresh, ch-fresh); a Secondary Page is a 24 x 22
  // button-sized marker (sp-fresh); a Subpage takes its subpage's rectangle (sbp-fresh, sb-subst -- 0 here, set by the
  // save). A Grid and an Analytic Grid are drawn (gd-fresh 380 x 108, ag-fresh 280 x 92); a Tab Separator is a 28 x 15
  // grid column (ts-fresh).
  image: { width: 4, height: 4, fieldSizeType: 0, lblType: 1, lblText: 'Image' },
  tree: { width: 4, height: 4, fieldSizeType: 0, lblType: 0, lblText: 'Tree' },
  chart: { width: 4, height: 4, fieldSizeType: 0, lblType: 1, lblText: 'Chart' },
  secondaryPage: { width: 24, height: 22, fieldSizeType: 3, lblType: 1, lblText: '' },
  subpage: { width: 0, height: 0, fieldSizeType: 0, lblType: 1, lblText: '' },
  grid: { width: 380, height: 108, fieldSizeType: 0, lblType: 0, lblText: 'Grid' },
  tabSeparator: { width: 28, height: 15, fieldSizeType: 0, lblType: 0, lblText: 'Tab Separator' },
  analyticGrid: { width: 280, height: 92, fieldSizeType: 0, lblType: 1, lblText: 'Analytic Grid' }
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

/** A fresh grid's even-row style (gd-fresh, ag-fresh). */
const GRID_EVEN_ROW_STYLE = 'Grid Even Row Style (default)';

/** PSPNLFIELD columns that differ by kind, as captured. */
const FIELD_BY_KIND: Record<NewControlKind, ColumnValues> = {
  editBox: { DSPLFORMAT: 2097160, LBLLOC: 1, PBDISPLAYTYPE: 0 },
  dropDown: { DSPLFORMAT: 2228224, LBLLOC: 1, PBDISPLAYTYPE: 0 },
  checkBox: { DSPLFORMAT: 524289, LBLLOC: 1, PBDISPLAYTYPE: 0, ONVALUE: 'Y', OFFVALUE: 'N' },
  pushButton: { DSPLFORMAT: 540672, LBLLOC: 0, PBDISPLAYTYPE: 2 },
  groupBox: { DSPLFORMAT: 1, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  frame: { DSPLFORMAT: 1, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  staticText: { DSPLFORMAT: 16385, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  horizontalRule: { DSPLFORMAT: 0, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  staticImage: { DSPLFORMAT: 8193, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  radioButton: { DSPLFORMAT: 1, LBLLOC: 1, PBDISPLAYTYPE: 0, ONVALUE: 'Y' },
  longEdit: { DSPLFORMAT: 2097152, LBLLOC: 1, PBDISPLAYTYPE: 0 },
  // On a field (ht-field); 8193 with only a record (ht-fresh) -- see newControlRows.
  htmlArea: { DSPLFORMAT: 532481, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  scrollArea: { DSPLFORMAT: 0, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  scrollBar: { DSPLFORMAT: 0, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  // Unbound (im-fresh, ch-fresh) and with no tree levels (tr-fresh); bound -- the dialog's OK -- see newControlRows.
  image: { DSPLFORMAT: 8193, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  tree: { DSPLFORMAT: 0, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  chart: { DSPLFORMAT: 8193, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  secondaryPage: { DSPLFORMAT: 524288, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  subpage: { DSPLFORMAT: 1, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  grid: { DSPLFORMAT: 131072, LBLLOC: 0, PBDISPLAYTYPE: 0, GRDSHOWCOLHDG: 1, GRDSHOWROWHDG: 1, GRDEVENROWSTYLE: GRID_EVEN_ROW_STYLE, GRDALLOWCOLSORT: 1, SHOWTABCNTLBTN: 1 },
  tabSeparator: { DSPLFORMAT: 0, LBLLOC: 0, PBDISPLAYTYPE: 0 },
  analyticGrid: { DSPLFORMAT: 0, LBLLOC: 0, PBDISPLAYTYPE: 0, GRDSHOWCOLHDG: 1, GRDSHOWROWHDG: 1, GRDEVENROWSTYLE: GRID_EVEN_ROW_STYLE }
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
function extByKind(kind: NewControlKind, field: FieldInfo | undefined, add?: NewControl): ColumnValues {
  if (kind === 'staticText') return { PTDISABLESMARTPROM: 0, FFSTYLELONG: null };
  // A Secondary Page (sp-fresh), and an Image or Tree through its dialog (im-field, tr-nodes), get five blank Fluid slots;
  // a Chart has no Fluid tab (ch-field).
  if (kind === 'secondaryPage' || (kind === 'image' && !!add?.fieldName.trim()) || (kind === 'tree' && treeDialogued(add))) {
    return { PTDISABLESMARTPROM: 0, FFSTYLELONG: FFSTYLELONG_SLOTS };
  }
  if (kind === 'image' || kind === 'chart' || kind === 'tree') return { PTDISABLESMARTPROM: 0, FFSTYLELONG: ' ' };
  // The five-slot FFSTYLELONG rides on a text field -- character (02, rb-fresh) or long character (le-fresh);
  // a number / datetime Edit Box (18) gets ' '. Smart-prompt is turned off only on a character Edit Box.
  const textField = isRecordBound(kind) && (field?.fieldType === 0 || field?.fieldType === 1);
  return { PTDISABLESMARTPROM: field?.fieldType === 0 && kind === 'editBox' ? 1 : 0, FFSTYLELONG: textField ? ' | | | | ' : ' ' };
}

const FFSTYLELONG_SLOTS = ' | | | | ';
/** A Tree whose dialog set a root field or levels: its row is the dialog's (tr-nodes). */
const treeDialogued = (add?: NewControl) => !!add && (!!add.fieldName.trim() || !!add.treeLevels?.length);

/** Why a field cannot carry this kind of new control, or undefined when it can. */
export function newControlFieldRefusal(kind: NewControlKind, recName: string, fieldName: string, field: FieldInfo | undefined): string | undefined {
  if (RECORD_ONLY.has(kind)) return recName.trim() ? undefined : `A new ${kind} needs its record.`;
  if (!isRecordBound(kind)) return undefined;
  if (RECORD_OPTIONAL.has(kind) && !fieldName.trim()) return undefined; // unbound, as App Designer saves one (im-fresh, ch-fresh)
  if (FIELD_OPTIONAL.has(kind)) {
    if (!recName.trim()) return `A new ${kind} needs a record.`;
    if (!fieldName.trim()) return undefined; // the record alone, as App Designer's fresh HTML Area (ht-fresh)
  }
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
  const k = add.kind;
  // Image, Chart and Tree on their record alone (or nothing) keep their type's label; on a field an Image or Chart takes
  // the field's label (im-field, ch-field) -- a Tree keeps "Tree" (tr-nodes).
  const onField = !!add.fieldName.trim();
  const bound = isRecordBound(k) && (onField || !(RECORD_OPTIONAL.has(k) || k === 'tree')) && k !== 'tree';
  const button = k === 'pushButton';
  // A record-bound control (other than a button) takes its field's default label unless the editor typed one.
  // A Radio Button keeps the field's text but no LABEL_ID (rb-fresh).
  const labelId = bound && !button && !BLANK_LABEL_ID.has(k) ? blank(field?.labelId ?? '') : ' ';
  const lblText = placed.lblText.trim() ? placed.lblText
    : bound && !button ? blank(field?.labelText ?? '')
    : blank(NEW_CONTROL_SIZE[k].lblText);
  // Through their dialogs: an Image on a field (im-field), a Chart on a field (ch-field), a Tree with a root field or
  // levels (tr-nodes) -- the dialog's OK adds an explicit Left (0x80000).
  const byDialog: ColumnValues =
    k === 'image' && onField ? { DSPLFORMAT: 548865 }
      : k === 'chart' && onField ? { DSPLFORMAT: 532481 }
        : k === 'tree' && treeDialogued(add) ? { DSPLFORMAT: 524288, MULTIRECTREE: add.treeLevels?.length ? 1 : 0, NODECOUNT: add.treeLevels?.length ?? 0, TREECTRLID: fieldNum }
          : {};
  // A Grid's and an Analytic Grid's Page Field Name is their record (gd-fresh, ag-fresh); a Subpage's and both grids'
  // occurs offsets are their height (sbp-fresh, gd-fresh, ag-fresh).
  const grid = k === 'grid' || k === 'analyticGrid';
  const height = Math.max(0, placed.fieldBottom - placed.fieldTop);
  const extra: ColumnValues = {
    ...(grid ? { PNLFIELDNAME: blank(add.recName.trim().slice(0, 18)) } : {}),
    ...(grid || k === 'subpage' ? { OCCURSOFFSET1: height, OCCURSOFFSET2: height, OCCURSOFFSET3: height } : {}),
    ...(PAGE_REFERENCE.has(k) ? { SUBPNLNAME: blank(add.subPage ?? '') } : {})
  };
  return {
    field: {
      PNLNAME: pnlName, PNLFLDID: pnlFldId, FIELDNUM: fieldNum, ...FIELD_COMMON, ...FIELD_BY_KIND[add.kind],
      ...(add.kind === 'htmlArea' && !add.fieldName.trim() ? { DSPLFORMAT: 8193 } : {}), ...byDialog, ...extra,
      FIELDTYPE: NEW_CONTROL_FIELDTYPE[add.kind], OCCURSLEVEL: Math.max(0, Math.round(placed.occursLevel ?? 0)),
      FIELDLEFT: placed.fieldLeft, FIELDTOP: placed.fieldTop, FIELDRIGHT: placed.fieldRight, FIELDBOTTOM: placed.fieldBottom,
      FIELDSIZETYPE: placed.fieldSizeType, LBLTYPE: placed.lblType, LABEL_ID: labelId, LBLTEXT: lblText,
      FIELDUSE: placed.fieldUse, SECUREINVISIBLE: placed.secureInvisible,
      RECNAME: blank(add.recName), FIELDNAME: isRecordBound(k) && onField ? blank(add.fieldName) : ' '
    },
    ext: { PNLNAME: pnlName, PNLFLDID: pnlFldId, ...EXT_COMMON, ...extByKind(add.kind, field, add), PARENTPNLFLDID: `${pnlName}$0`, PAGEPNLFLDID: `${pnlName}$0` }
  };
}

/**
 * A Scroll Area's own rows besides PSPNLFIELD / PSPNLFIELDEXT, as App Designer writes a fresh one (lv02 and sa-fresh,
 * identical): PSPNLCNTRLDATA (its header, body, footer and navigation-bar settings) and two PSPNLBTNDATA buttons (class 3
 * shown 'O', class 5 hidden 'X'; labels from Message Catalog 126/1 and 126/2). Without them App Designer cannot load the
 * page ("Page not found", 15,14). A fresh Scroll Bar has neither; a Grid has its own PSPNLCNTRLDATA (not inserted yet).
 */
const SCROLL_AREA_CONTROL_DATA: ColumnValues = {
  PTFINDSTRING: 'O', PTHDGSHOW: 'X', PTHDGROWACTBTNS: 'X', PTHDGROWACTALGN: 3, PTHDGNAVBARBTNS: 'X', PTHDGNAVBARALGN: 3, PTBAREASTYLENAME: ' ',
  PTBAREAROWACTALGN: 0, PTBAREAHIDEROWSEP: 'O', PTBAREASHWGRDLINES: 'O', PTFTGSHOW: 'O', PTFTGSTYLENAME: ' ', PTFTGSHOWROWACT: 'O', PTFTGROWACTALGN: 1,
  PTFTGSHOWNAVBAR: 'O', PTFTGNAVBARALGN: 3, PTSEPSTARTOFFSET: 0, PTSEPOCCURSOFFSET: 0, PTBTNSTARTOFFSET: 0, PTBTNOCCURSOFFSET: 0, ALLOWMULTIROWINS: 0,
  PTGRDLAYOUT: 0, PTGRDSCROLLBAR: 2, GRIDROWS: 0, PTSMRYDFLTTOTITLE: 0, PTSMRYLBLTYPE: 0, PTSMRYMSGSET: 0, PTSMRYMSGNUM: 0, PTSMRYDSPLFORMAT: 0,
  PTSUMMARYATTRIBUTE: ' '
};
const SCROLL_AREA_BUTTON: ColumnValues = {
  PTBTNFIELDTYPE: 19, PTBTNLBLTYPE: 1, CONTNAME: ' ', CONTNAMEOVER: ' ', CONTNAMEDISABLE: ' ', LBLTYPE: 7, LBLTEXT: ' ', MSGSET: 126, MSGNUM: 1,
  PTBTNLBLTYPE2: 7, PTBTNLBLTEXT2: ' ', PTBTNMSGSET2: 126, PTBTNMSGNUM2: 2
};

/**
 * A new control's own rows besides PSPNLFIELD / PSPNLFIELDEXT: a Scroll Area's PSPNLCNTRLDATA and buttons; a Grid's
 * PSPNLCNTRLDATA -- the scroll area's but header row-action buttons shown and 15 rows, and no buttons until App Designer
 * next loads and saves the page (gd-fresh, ag-fresh); an Analytic Grid's, with grid lines off, its PSPNLACEGRDDATA and
 * PSPNLACEGRDAXIS rows (ag-fresh); a Tree's levels (PSPNLTREECTRL, tr-nodes: each level the child of the one before, its
 * TREECTRLID the tree's FIELDNUM).
 */
export interface NewControlDataRows {
  controlData?: ColumnValues;
  buttons: ColumnValues[];
  aceData?: ColumnValues;
  aceAxes?: ColumnValues[];
  treeNodes?: ColumnValues[];
}

export function newControlDataRows(pnlName: string, pnlFldId: number, kind: NewControlKind, add?: NewControl, fieldNum = 0): NewControlDataRows {
  if (kind === 'grid' || kind === 'analyticGrid') {
    const controlData = { PNLNAME: pnlName, PNLFLDID: pnlFldId, ...SCROLL_AREA_CONTROL_DATA, PTHDGROWACTBTNS: 'O', GRIDROWS: 15,
      ...(kind === 'analyticGrid' ? { PTBAREASHWGRDLINES: 'X' } : {}) };
    if (kind === 'grid') return { controlData, buttons: [] };
    const a = add?.analytic;
    return {
      controlData, buttons: [],
      aceData: { PNLNAME: pnlName, PNLFLDID: pnlFldId, ACEMODELID: blank(a?.model ?? ''), ACECOLLNAME: blank(a?.collection ?? ''), RECORDNAME: blank(add?.recName ?? ''),
        PROBINSTPNLFLDID: 0, ACEGRIDDISPLSLICER: 1, ACESLCDFTVIEWEXPAN: 1, ACEGRIDAXISTYPE: a?.nonDimensionalAxis ?? 1, ACEGRIDFRZCOLMODE: a?.freezeColumns ? 1 : 0,
        ACEGRIDMAXROWCOUNT: 0, ACEGRIDNODRAGDROP: 0 },
      aceAxes: (a?.axes ?? []).map((x) => ({ PNLNAME: pnlName, PNLFLDID: pnlFldId, FIELDNAME: x.fieldName, ACEGRIDAXISTYPE: x.axis }))
    };
  }
  if (kind === 'tree' && add?.treeLevels?.length) {
    const levels = add.treeLevels;
    return { buttons: [], treeNodes: levels.map((l, i) => ({ PNLNAME: pnlName, TREECTRLID: fieldNum, TREELVLNUM: i + 1, PARENTNODENUM: 1, NODENUM: 1,
      TREELEAF: i === levels.length - 1 ? 1 : 0, RECNAME: l.recName, FIELDNAME: l.fieldName })) };
  }
  if (kind !== 'scrollArea') return { buttons: [] };
  return {
    controlData: { PNLNAME: pnlName, PNLFLDID: pnlFldId, ...SCROLL_AREA_CONTROL_DATA },
    buttons: [{ PNLNAME: pnlName, PNLFLDID: pnlFldId, PTBTNCLASSTYPE: 3, PTVISIBLE: 'O', ...SCROLL_AREA_BUTTON },
      { PNLNAME: pnlName, PNLFLDID: pnlFldId, PTBTNCLASSTYPE: 5, PTVISIBLE: 'X', ...SCROLL_AREA_BUTTON }]
  };
}
