import type { DbConnection as Connection } from '../db/connection.js';
import { writeScopeRefusal } from './writeScope.js';
import { PAGE_SIZE_BITS, PAGE_SIZE_CUSTOM, PAGE_SIZE_PRESETS, pageSizeChoice } from '../model/pageLayout.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { newControlFieldRefusal, newControlRows, isRecordBound, type ColumnValues, type FieldInfo, type NewControl } from './pageControlTemplates.js';

/*
 * Saving a page's layout, as App Designer does (docs/PAGE_SAVE.md, cases
 * 01-19 on ZZ_PCODE_LAB_PG): changes to existing controls -- move, resize,
 * label, use -- deleting controls, adding controls from App Designer's
 * captured default rows (pageControlTemplates.ts), and the page's
 * Description and Comments (PSPNLDEFN.DESCR / DESCRLONG, 19-props-descr).
 *
 *   PSVERSION / PSLOCK  'PDM' + 1; PSVERSION 'SYS' + 1
 *   PSPNLDEFN           VERSION = the new PDM, FIELDCOUNT = control count,
 *                       LASTUPDDTTM / LASTUPDOPRID the save's. MAXPNLFLDID
 *                       grows by the controls added (02-add-edit), never shrinks.
 *   PSPNLFIELD          per changed control, only the changed columns
 *                       (move: FIELDLEFT/TOP + the label EDITLBL*; resize:
 *                       FIELDRIGHT/BOTTOM + FIELDSIZETYPE; label: LBLTYPE/
 *                       LBLTEXT; use: FIELDUSE + SECUREINVISIBLE); FIELDNUM
 *                       where the contiguous order changed. A deleted control's
 *                       PSPNLFIELD and PSPNLFIELDEXT rows are removed.
 *                       An added control is a whole new row, PNLFLDID
 *                       MAXPNLFLDID + 1 on, numbered after the survivors.
 *   PSPNLFIELDEXT       inserted with an added control, removed with a deleted
 *                       one (its own columns are not edited here).
 *
 * A deleted PNLFLDID is never reused (MAXPNLFLDID stays). PNLNAME must be in
 * the write scope.
 */

export class PageSaveRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageSaveRefusedError';
  }
}

/** The editable columns of one control, as the Layout editor sets them. */
export interface EditedControl {
  /** PSPNLFIELD.PNLFLDID of an existing control; a placeholder (ignored) on an added one. */
  pnlFldId: number;
  /** Present on a control the editor added: what it is and the record field it is placed on. */
  add?: NewControl;
  /** Present on a pasted control: the stored control it is a copy of (this page's or another's; c01, c02). */
  copy?: { pnlName: string; pnlFldId: number };
  fieldLeft: number;
  fieldTop: number;
  fieldRight: number;
  fieldBottom: number;
  editLblLeft: number;
  editLblTop: number;
  editLblRight: number;
  editLblBottom: number;
  /** PSPNLFIELD.FIELDSIZETYPE: 0 auto, 2 custom (set when resized). */
  fieldSizeType: number;
  /** PSPNLFIELD.LBLTYPE / LBLTEXT. */
  lblType: number;
  lblText: string;
  /** PSPNLFIELD.FIELDUSE bit-mask (0x01 Display Only, 0x02 Invisible). */
  fieldUse: number;
  /** PSPNLFIELD.SECUREINVISIBLE (set with the Invisible bit). */
  secureInvisible: number;
  /** A control's Properties dialog (a frame's: fr02, fr04, fr06, fr07); absent leaves the stored value. */
  /** PSPNLFIELD.FIELDSTYLE: the Label tab's Style (a style class; '' default). */
  fieldStyle?: string;
  /** PSPNLFIELD.PNLFIELDNAME: the General tab's Page Field Name. */
  pageFieldName?: string;
  /** PSPNLFIELD.PTADJHIDDENFIELDS: Adjust Layout for Hidden Fields (0 / 1). */
  adjustHidden?: number;
  /** PSPNLFIELD.ENABLEASANCHOR: Enable as Page Anchor (0 / 1). */
  anchor?: number;
  /** The Fluid tab (fr13-fr20): PSPNLFIELD.FIELDUSETMP bits (FLUID_USETMP). */
  fieldUseTmp?: number;
  /** The Fluid tab's Style Classes and Small / Medium / Large / Extra Large overrides (PSPNLFIELDEXT.FFSTYLELONG, fr08-fr12). */
  fluidClasses?: string[];
  /** The Fluid tab (fr15, fr17, fr19): PSPNLFIELDEXT.FIELDUSETEMP2 bits (FLUID_USETEMP2). */
  fieldUseTemp2?: number;
  /**
   * PSPNLFIELD.DSPLFORMAT: a type-specific bit-mask the editor computes
   * (Static Text alignment/explanation st05-st08, Static Image scale/size
   * si07-si12, Edit Box display options). Sent whole, written when changed.
   */
  dsplFormat?: number;
  /** PSPNLFIELD.CONTNAME: a Static Image's Image ID (si01). */
  contName?: string;
  /** PSPNLFIELD.GRDLBLMSGSET / GRDLBLMSGNUM: a Message-Catalog label's set / number (st02, st03). */
  grdLblMsgSet?: number;
  grdLblMsgNum?: number;
  /** PSPNLFIELD.ONVALUE / OFFVALUE: a Check Box / Radio's field values. */
  onValue?: string;
  offValue?: string;
  /** PSPNLFIELD.LBLLOC: a control's Label Location (Left / Right / Top / Bottom). */
  lblLoc?: number;
  /** PSPNLFIELD.RECNAME / FIELDNAME: the record field a bound control is on, when the editor rebinds a stored control. */
  recName?: string;
  fieldName?: string;
  /** PSPNLFIELD.DEFERPROC: Allow Deferred Processing (default 1); sent when the editor toggles it on a stored control. */
  deferProc?: boolean;
  /** A Scroll Bar / Grid / Scroll Area's Occurs Count (PSPNLFIELD.OCCURSCOUNT1; 0 = unlimited). */
  occursCount1?: number;
  /** A Grid's display options: GRDSHOWCOLHDG (Show Column Headings), GRDSHOWROWHDG (Show Row Numbers), GRDALLOWCOLSORT (Allow Column Sorting). */
  gridShowColHdg?: number;
  gridShowRowHdg?: number;
  gridAllowColSort?: number;
  /** PSPNLFIELD.OCCURSLEVEL for an added / pasted control: the scroll level at the drop point (0 outside any scroll). */
  occursLevel?: number;
}

/** A control's Fluid tab bits in PSPNLFIELD.FIELDUSETMP (fr13, fr14, fr16, fr18, fr20). */
export const FLUID_USETMP = { suppressClasses: 0x400000, suppressSmall: 0x40000000, suppressLarge: 0x20000000, labelAfter: 0x2000000, structureBasic: 0x4000000 } as const;
/** ... and in PSPNLFIELDEXT.FIELDUSETEMP2 (fr15, fr17, fr19). */
export const FLUID_USETEMP2 = { suppressMedium: 0x10, suppressExtraLarge: 0x80, labelsInGridCells: 0x02 } as const;

/**
 * PSPNLFIELDEXT.FFSTYLELONG: Style Classes | Small | Medium | Large | Extra
 * Large, an empty slot ' ' (fr08: ' | | | | ' -> 'zz-fc| | | | '), classes as
 * typed. Stored text is parsed loosely (delivered rows hold
 * 'ps_apps_content| | ||').
 */
export function fluidClassSlots(ffStyleLong: string | null | undefined): string[] {
  const slots = String(ffStyleLong ?? '').split('|').map((x) => x.trim());
  return [0, 1, 2, 3, 4].map((i) => slots[i] ?? '');
}
export const fluidClassText = (slots: readonly string[]) => [0, 1, 2, 3, 4].map((i) => (slots[i] ?? '').trim() || ' ').join('|');

/** FIELDUSE bits a frame's dialog sets (fr03, fr05). */
export const FIELD_USE_HIDE_BORDER = 0x4000000;
export const FIELD_USE_MULTI_CURRENCY = 0x20;

export interface PageSaveRequest {
  pnlName: string;
  /** PSPNLDEFN.VERSION when the page was opened; the save is refused if it moved. */
  openedVersion: number;
  operatorId: string;
  /** The surviving controls, then any added ones (those carry `add`). */
  controls: EditedControl[];
  /** The page's own properties as edited (General tab); absent leaves them as stored. */
  properties?: EditedPageProperties;
  /** The Order tab's tab order: the surviving controls' PNLFLDIDs, first to last. Absent keeps the stored order. */
  order?: number[];
}

/**
 * Page Properties the editor may change: DESCR and DESCRLONG (19-props-descr),
 * the page size (14-props-use), and the captured General / Use settings
 * (g01, u01-u05). An absent optional one is left as stored.
 */
export interface EditedPageProperties {
  description: string;
  comments: string;
  /** The page size (PANELRIGHT / PANELBOTTOM), as dragged or typed; absent leaves it. */
  sizeWidth?: number;
  sizeHeight?: number;
  /** OBJECTOWNERID (g01); '' = none. */
  ownerId?: string;
  /** STYLESHEETNAME (u01); '' = the default style. */
  styleSheet?: string;
  /** PNLSTYLE, the Page Background style class (u02); '' = the default style. */
  background?: string;
  /** DEFERPROC, Allow Deferred Processing (u03). */
  deferProc?: boolean;
  /** PNLUSE 0x100, Adjust Layout for Hidden Fields (u04). */
  adjustLayout?: boolean;
  /** POPUPMENU (u05); '' = none. */
  popupMenu?: string;
  /** A standard page's Page Size choice: a PAGE_SIZE_PRESETS key or 'custom' (s01-s08). */
  pageSize?: string;
  /** PNLTYPE (PAGE_TYPES 0-11; u08, u12, t01-t11, r01-r06). */
  pageType?: number;
  /**
   * The drawn content's rectangle, for a page made Subpage or Popup Page
   * (Auto-size). App Designer measures it (label text included); the editor
   * sends what it draws. Absent: the controls' own extent.
   */
  autoSizeExtent?: { left: number; top: number; right: number; bottom: number };
  /** A secondary page's OK & Cancel buttons and Close Box (PNLUSE 0x01 / 0x02 clear; u09, u10). */
  okCancel?: boolean;
  closeBox?: boolean;
  /** A secondary page's Disable Display in Modal Window When Not Launched by DoModal (PNLUSE 0x2000; u11). */
  disableModal?: boolean;
  /** Fluid Page (PNLUSE 0x4000; u13, u14). */
  fluidPage?: boolean;
  /** The Fluid tab's Style Classes and form-factor overrides (f01-f05), as typed; '' = none. */
  fluid?: { styleClasses?: string; small?: string; medium?: string; large?: string; extraLarge?: string };
  /** Suppress System-Specific Style Classes (PNLUSETEMP 0x01; f06). */
  suppressClasses?: boolean;
}

/** The Fluid tab's columns (f01-f05: Style Classes is FFSTYLEDESKTOP, Large is FFSTYLETABLET). */
export const FLUID_STYLE_COLUMNS = { styleClasses: 'FFSTYLEDESKTOP', small: 'FFSTYLEPHONE', medium: 'FFSTYLEMEDIUM', large: 'FFSTYLETABLET', extraLarge: 'FFSTYLEEXLARGE' } as const;
export const PAGE_USE_FLUID = 0x4000;
/** PNLUSETEMP 0x01: Suppress System-Specific Style Classes (f06: 0 -> 1; delivered pages carry 1, 2, 4, 26). */
export const PAGE_USETEMP_SUPPRESS_CLASSES = 0x01;

/** PNLUSE 0x100: Adjust Layout for Hidden Fields (u04-page-adjust-layout: 11 -> 267). */
export const PAGE_USE_ADJUST_LAYOUT = 0x100;
/**
 * PNLUSE's low byte: 0x01 no OK & Cancel buttons, 0x02 no Close Box (set on
 * every standard page; u09 16 -> 17, u10 17 -> 19), then one Page Size bit:
 * 0x08 Custom, 0x10 a secondary page's own size (u08), 0x20 570x330 (u12) ...
 */
export const PAGE_USE_NO_OK_CANCEL = 0x01;
export const PAGE_USE_NO_CLOSE_BOX = 0x02;
export const PAGE_USE_DISABLE_MODAL = 0x2000;
const STANDARD_PAGE = 0, SECONDARY_PAGE = 2;
/** Subpage and Popup Page: Page Size Auto-size (0x10), the page rectangle the content's (t01, r03, r05). */
const AUTO_SIZE_TYPES = new Set([1, 3]);
/** Header, Side 1, Footer, Layout, Search, Prompt, Master&Detail Target, Side 2: Fluid, 800x600 inside portal (t04, r02). */
const FLUID_TYPES = new Set([4, 5, 6, 7, 8, 9, 10, 11]);

/**
 * The PSPNLDEFN property columns that change, as App Designer writes them
 * (19-props-descr): DESCR blank is ' ' (NOT NULL); DESCRLONG, a nullable CLOB,
 * is NULL when empty (as a new page's is). A new size is PANELRIGHT /
 * PANELBOTTOM with the Page Size choice made Custom: PNLUSE's low byte 11,
 * its other bits kept (14-props-use: 32 -> 11).
 */
export function planPageProperties(stored: { DESCR?: unknown; DESCRLONG?: unknown; PANELRIGHT?: unknown; PANELBOTTOM?: unknown; PNLUSE?: unknown;
  OBJECTOWNERID?: unknown; STYLESHEETNAME?: unknown; PNLSTYLE?: unknown; DEFERPROC?: unknown; POPUPMENU?: unknown; PNLTYPE?: unknown; PANELTOP?: unknown; PANELLEFT?: unknown;
  PNLUSETEMP?: unknown; FFSTYLEDESKTOP?: unknown; FFSTYLEPHONE?: unknown; FFSTYLEMEDIUM?: unknown; FFSTYLETABLET?: unknown; FFSTYLEEXLARGE?: unknown },
  edited: EditedPageProperties | undefined, context: { minTop?: number; extent?: { left: number; top: number; right: number; bottom: number } } = {}):
  Record<string, string | number | null> {
  if (!edited) return {};
  const columns: Record<string, string | number | null> = {};
  // A name column: blank is ' ' (NOT NULL), as App Designer leaves an unset one.
  const name = (col: string, value: string | undefined, current: unknown) => {
    if (value === undefined) return;
    const v = value.trim().toUpperCase() || ' ';
    if (v !== (String(current ?? '').trim() || ' ')) columns[col] = v;
  };
  name('OBJECTOWNERID', edited.ownerId, stored.OBJECTOWNERID);
  name('STYLESHEETNAME', edited.styleSheet, stored.STYLESHEETNAME);
  name('PNLSTYLE', edited.background, stored.PNLSTYLE);
  name('POPUPMENU', edited.popupMenu, stored.POPUPMENU);
  if (edited.deferProc !== undefined && (edited.deferProc ? 1 : 0) !== Number(stored.DEFERPROC ?? 0)) columns.DEFERPROC = edited.deferProc ? 1 : 0;
  // The Fluid tab's style classes: kept as typed (f01 'zz-sc'), blank ' ', up to 100 characters.
  for (const [k, col] of Object.entries(FLUID_STYLE_COLUMNS) as Array<[keyof typeof FLUID_STYLE_COLUMNS, string]>) {
    const value = edited.fluid?.[k];
    if (value === undefined) continue;
    const v = value.trim();
    if (v.length > 100) throw new PageSaveRefusedError(`${col} holds up to 100 characters.`);
    if (/[\u0000-\u001f]/.test(v)) throw new PageSaveRefusedError(`Style classes are written on one line (${col}).`);
    if ((v || ' ') !== (String((stored as Record<string, unknown>)[col] ?? '').trim() || ' ')) columns[col] = v || ' ';
  }
  if (edited.suppressClasses !== undefined) {
    const temp = Number(stored.PNLUSETEMP ?? 0);
    const next = edited.suppressClasses ? temp | PAGE_USETEMP_SUPPRESS_CLASSES : temp & ~PAGE_USETEMP_SUPPRESS_CLASSES;
    if (next !== temp) columns.PNLUSETEMP = next;
  }

  // PNLTYPE, PNLUSE and the page rectangle, as the Use tab sets them together.
  const was = { type: Number(stored.PNLTYPE ?? 0), use: Number(stored.PNLUSE ?? 0), top: Number(stored.PANELTOP ?? 0),
    left: Number(stored.PANELLEFT ?? 0), right: Number(stored.PANELRIGHT ?? 0), bottom: Number(stored.PANELBOTTOM ?? 0) };
  const now = { ...was };
  if (edited.pageType !== undefined && edited.pageType !== was.type) {
    // What the new type sets depends on the type alone, whatever it was (t01-t11, r01-r06, u08, u12).
    // Other PNLUSE bits stay; Fluid Page is never turned off by a type change.
    const t = edited.pageType;
    const portal = () => { now.left = 0; now.top = 0; now.right = 570; now.bottom = 330; };
    if (t === STANDARD_PAGE) {
      // No buttons / Close Box (0x03), 800x600 page inside portal (0x20) at 570 x 330 (u12, r04, r06).
      now.use = (now.use & ~(0xff | PAGE_SIZE_BITS)) | 0x23; portal();
    } else if (t === SECONDARY_PAGE) {
      // u08: Auto-size (0x10) with OK & Cancel and Close Box shown; PANELTOP the topmost control's top.
      now.use = (now.use & ~(0xff | PAGE_SIZE_BITS)) | 0x10;
      now.top = context.minTop ?? 0;
    } else if (AUTO_SIZE_TYPES.has(t)) {
      // Auto-size (0x10), no buttons (0x03); the page rectangle is the content's (App Designer measures it).
      now.use = (now.use & ~(0xff | PAGE_SIZE_BITS)) | 0x13;
      const e = edited.autoSizeExtent ?? context.extent;
      if (e && !AUTO_SIZE_TYPES.has(was.type)) { now.left = Math.round(e.left); now.top = Math.round(e.top); now.right = Math.round(e.right); now.bottom = Math.round(e.bottom); }
    } else if (FLUID_TYPES.has(t)) {
      // Fluid Page on, 800x600 page inside portal at 570 x 330 (t04, r02).
      now.use = ((now.use | PAGE_USE_FLUID) & ~(0xff | PAGE_SIZE_BITS)) | 0x23; portal();
    } else {
      throw new PageSaveRefusedError(`Page type ${t} is not one App Designer offers.`);
    }
    now.type = t;
  }
  // A standard page's Page Size choice (s01-s08): its size bit, no buttons (0x03), and the size it stores.
  if (edited.pageSize !== undefined && edited.pageSize !== pageSizeChoice(now.use)) {
    if (now.type !== STANDARD_PAGE) throw new PageSaveRefusedError('The Page Size list is a standard page\'s; this page type sets its own size.');
    if (edited.pageSize === 'custom') {
      now.use = (now.use & ~PAGE_SIZE_BITS) | (PAGE_SIZE_CUSTOM & PAGE_SIZE_BITS) | 0x03;
      // From 640x480 (0 x 0 stored), Custom starts at the size App Designer shows for it.
      if (!now.right || !now.bottom) { now.right = 632; now.bottom = 326; }
    } else {
      const preset = PAGE_SIZE_PRESETS.find((p) => p.key === edited.pageSize);
      if (!preset) throw new PageSaveRefusedError(`${edited.pageSize} is not a Page Size App Designer offers.`);
      now.use = (now.use & ~PAGE_SIZE_BITS) | preset.bit | 0x03;
      now.right = preset.width;
      now.bottom = preset.height === 'var' ? (now.bottom || 326) - 8 : preset.height;
    }
  }
  const bit = (on: boolean, b: number) => { now.use = on ? now.use | b : now.use & ~b; };
  if (edited.adjustLayout !== undefined) bit(edited.adjustLayout, PAGE_USE_ADJUST_LAYOUT);
  if (edited.fluidPage !== undefined) bit(edited.fluidPage, PAGE_USE_FLUID);
  if (now.type === SECONDARY_PAGE) {
    // App Designer offers these on a secondary page only.
    if (edited.okCancel !== undefined) bit(!edited.okCancel, PAGE_USE_NO_OK_CANCEL);
    if (edited.closeBox !== undefined) bit(!edited.closeBox, PAGE_USE_NO_CLOSE_BOX);
    if (edited.disableModal !== undefined) bit(edited.disableModal, PAGE_USE_DISABLE_MODAL);
  }
  if (edited.sizeWidth !== undefined && edited.sizeHeight !== undefined) {
    const w = Math.round(edited.sizeWidth), h = Math.round(edited.sizeHeight);
    if (w !== now.right || h !== now.bottom) {
      if (!(w > 0 && h > 0)) throw new PageSaveRefusedError(`The page size must be positive (${w} x ${h}).`);
      now.right = w; now.bottom = h;
      // Custom (0x08) replaces the size choice; a standard page has no buttons / Close Box (14-props-use: 32 -> 11).
      now.use = (now.use & ~PAGE_SIZE_BITS) | (PAGE_SIZE_CUSTOM & PAGE_SIZE_BITS) | (now.type === SECONDARY_PAGE ? 0 : 0x03);
    }
  }
  if (now.type !== was.type) columns.PNLTYPE = now.type;
  if (now.top !== was.top) columns.PANELTOP = now.top;
  if (now.left !== was.left) columns.PANELLEFT = now.left;
  if (now.right !== was.right) columns.PANELRIGHT = now.right;
  if (now.bottom !== was.bottom) columns.PANELBOTTOM = now.bottom;
  if (now.use !== was.use) columns.PNLUSE = now.use;
  const descr = edited.description.trim() ? edited.description.trimEnd() : ' ';
  if (descr.trim() !== String(stored.DESCR ?? '').trim()) columns.DESCR = descr;
  const comments = edited.comments.trim() ? edited.comments.trimEnd() : null;
  if ((comments ?? '') !== String(stored.DESCRLONG ?? '').trimEnd()) columns.DESCRLONG = comments;
  return columns;
}

export interface PageSaveResult {
  version: number;
  fieldCount: number;
  updated: number;
  deleted: number;
  inserted: number;
}

/** A stored control's editable columns plus its FIELDNUM, read before the write. */
export interface StoredControl extends EditedControl {
  fieldNum: number;
  /** PSPNLFIELD.FIELDTYPE (for the reorder check: grids and scrolls). */
  fieldType?: number;
  /** PSPNLFIELDEXT.FFSTYLELONG (a frame's dialog rewrites a blank one, fr01) and FIELDUSETEMP2. */
  ffStyleLong?: string | null;
  fieldUseTemp2?: number;
}

/** The columns of PSPNLFIELD this step may change, and how a control's value is read for each. */
const nameValue = (v: string | undefined) => (v ?? '').trim().toUpperCase() || ' ';
const EDITABLE: Array<{ col: string; of: (c: EditedControl) => number | string; key?: keyof EditedControl }> = [
  { col: 'FIELDLEFT', of: (c) => c.fieldLeft },
  { col: 'FIELDTOP', of: (c) => c.fieldTop },
  { col: 'FIELDRIGHT', of: (c) => c.fieldRight },
  { col: 'FIELDBOTTOM', of: (c) => c.fieldBottom },
  { col: 'EDITLBLLEFT', of: (c) => c.editLblLeft },
  { col: 'EDITLBLTOP', of: (c) => c.editLblTop },
  { col: 'EDITLBLRIGHT', of: (c) => c.editLblRight },
  { col: 'EDITLBLBOTTOM', of: (c) => c.editLblBottom },
  { col: 'FIELDSIZETYPE', of: (c) => c.fieldSizeType },
  { col: 'LBLTYPE', of: (c) => c.lblType },
  // PeopleSoft stores a blank label as ' ' (Oracle reads '' as NULL); the editor sends it trimmed.
  { col: 'LBLTEXT', of: (c) => (c.lblText.trim() ? c.lblText : ' ') },
  { col: 'FIELDUSE', of: (c) => c.fieldUse },
  { col: 'SECUREINVISIBLE', of: (c) => c.secureInvisible },
  // A control's Properties dialog: written only when the editor sends them.
  { col: 'FIELDSTYLE', of: (c) => nameValue(c.fieldStyle), key: 'fieldStyle' },
  { col: 'PNLFIELDNAME', of: (c) => nameValue(c.pageFieldName), key: 'pageFieldName' },
  { col: 'PTADJHIDDENFIELDS', of: (c) => Number(c.adjustHidden ?? 0), key: 'adjustHidden' },
  { col: 'ENABLEASANCHOR', of: (c) => Number(c.anchor ?? 0), key: 'anchor' },
  { col: 'FIELDUSETMP', of: (c) => Number(c.fieldUseTmp ?? 0), key: 'fieldUseTmp' },
  { col: 'DSPLFORMAT', of: (c) => Number(c.dsplFormat ?? 0), key: 'dsplFormat' },
  { col: 'CONTNAME', of: (c) => nameValue(c.contName), key: 'contName' },
  { col: 'GRDLBLMSGSET', of: (c) => Number(c.grdLblMsgSet ?? 0), key: 'grdLblMsgSet' },
  { col: 'GRDLBLMSGNUM', of: (c) => Number(c.grdLblMsgNum ?? 0), key: 'grdLblMsgNum' },
  { col: 'ONVALUE', of: (c) => (c.onValue?.trim() ? c.onValue : ' '), key: 'onValue' },
  { col: 'OFFVALUE', of: (c) => (c.offValue?.trim() ? c.offValue : ' '), key: 'offValue' },
  { col: 'LBLLOC', of: (c) => Number(c.lblLoc ?? 0), key: 'lblLoc' },
  // Rebinding a stored control's record field (App Designer's Record Name / Field Name) and Allow Deferred Processing.
  { col: 'RECNAME', of: (c) => nameValue(c.recName), key: 'recName' },
  { col: 'FIELDNAME', of: (c) => nameValue(c.fieldName), key: 'fieldName' },
  { col: 'DEFERPROC', of: (c) => Number(c.deferProc ? 1 : 0), key: 'deferProc' },
  // Scroll Bar / Grid / Scroll Area Occurs Count and the Grid display-option flags (the Options tab).
  { col: 'OCCURSCOUNT1', of: (c) => Number(c.occursCount1 ?? 0), key: 'occursCount1' },
  { col: 'GRDSHOWCOLHDG', of: (c) => Number(c.gridShowColHdg ?? 0), key: 'gridShowColHdg' },
  { col: 'GRDSHOWROWHDG', of: (c) => Number(c.gridShowRowHdg ?? 0), key: 'gridShowRowHdg' },
  { col: 'GRDALLOWCOLSORT', of: (c) => Number(c.gridAllowColSort ?? 0), key: 'gridAllowColSort' }
];

/** The Properties dialog's columns: OK on a frame's dialog writes its PSPNLFIELDEXT.FFSTYLELONG as App Designer's five-slot ' | | | | ' (fr01). */
const DIALOG_COLUMNS = new Set(['LBLTEXT', 'FIELDSTYLE', 'FIELDUSE', 'PTADJHIDDENFIELDS', 'PNLFIELDNAME', 'ENABLEASANCHOR', 'FIELDUSETMP', 'FIELDUSETEMP2']);
const FRAME = 1;
export const FFSTYLELONG_EMPTY = ' | | | | ';

export interface PagePlan {
  /** PNLFLDIDs whose PSPNLFIELD / PSPNLFIELDEXT rows are removed. */
  deletes: number[];
  /** Per surviving control: the columns that changed (name -> new value), including FIELDNUM when its order moved. */
  updates: Array<{ pnlFldId: number; columns: Record<string, number | string> }>;
  /** Per surviving control: PSPNLFIELDEXT columns that change with it (a frame's FFSTYLELONG, fr01). */
  extUpdates: Array<{ pnlFldId: number; columns: Record<string, number | string> }>;
  /** Added and pasted controls: their new PNLFLDID and FIELDNUM, and what the editor set. */
  inserts: Array<{ pnlFldId: number; fieldNum: number; control: EditedControl }>;
  /** The control count after the save (PSPNLDEFN.FIELDCOUNT). */
  fieldCount: number;
  /** PSPNLDEFN.MAXPNLFLDID after the save. */
  maxPnlFldId: number;
}

/** Grid, Scroll Bar and Scroll Area: the controls after one are on its level. */
const SCROLL_TYPES = new Set([10, 19, 27]);

/** The survivors in the Order tab's order, refusing an order that is not theirs or that moves a control across a grid or scroll. */
function reordered(survivors: readonly StoredControl[], order: readonly number[]): StoredControl[] {
  const byId = new Map(survivors.map((c) => [c.pnlFldId, c]));
  if (order.length !== survivors.length || new Set(order).size !== order.length || order.some((id) => !byId.has(id))) {
    throw new PageSaveRefusedError('The tab order does not list exactly the controls on the page.');
  }
  const next = order.map((id) => byId.get(id)!);
  // Each control's governing scroll: the nearest grid / scroll before it.
  const owners = (list: readonly StoredControl[]) => {
    const out = new Map<number, number>();
    let owner = 0;
    for (const c of list) { out.set(c.pnlFldId, owner); if (SCROLL_TYPES.has(Number(c.fieldType))) owner = c.pnlFldId; }
    return out;
  };
  const before = owners(survivors), after = owners(next);
  const moved = next.find((c) => before.get(c.pnlFldId) !== after.get(c.pnlFldId));
  if (moved) {
    throw new PageSaveRefusedError(`Control ${moved.pnlFldId} would move into or out of a grid or scroll area, which changes its level; ` +
      'that move is not supported yet (keep it on the same side of the grid / scroll in the Order tab).');
  }
  return next;
}

/**
 * The change plan from the stored controls to the edited ones: which rows are
 * deleted, and which columns change on each survivor (geometry / label / use,
 * and FIELDNUM when the contiguous order shifts). Pure -- the writer wraps the
 * database around it, and the tests check it without one.
 *
 * `order` is the Order tab's tab order (the survivors' PNLFLDIDs). A move
 * that changes which grid or scroll a control follows would change its
 * OCCURSLEVEL as well, which no capture shows yet: refused.
 */
export function planPageSave(stored: readonly StoredControl[], all: readonly EditedControl[], maxPnlFldId = 0, order?: readonly number[],
  pnlName = ''): PagePlan {
  const added = all.filter((c) => !!c.add || !!c.copy);
  const controls = all.filter((c) => !c.add && !c.copy);
  const edited = new Map(controls.map((c) => [c.pnlFldId, c]));
  const storedById = new Map(stored.map((c) => [c.pnlFldId, c]));

  for (const c of controls) {
    if (!storedById.has(c.pnlFldId)) {
      throw new PageSaveRefusedError(`Control ${c.pnlFldId} is not on the stored page.`);
    }
  }
  // MAXPNLFLDID is a high-water mark; never hand out an id at or below a stored one.
  const base = Math.max(maxPnlFldId, ...stored.map((c) => c.pnlFldId), 0);

  const deletes = stored.filter((c) => !edited.has(c.pnlFldId)).map((c) => c.pnlFldId);

  // FIELDNUM is a contiguous 1..N order: the survivors in their stored order, or
  // the Order tab's, with the deleted gaps closed.
  const inStoredOrder = stored.filter((c) => edited.has(c.pnlFldId)).sort((a, b) => a.fieldNum - b.fieldNum);
  const survivors = order ? reordered(inStoredOrder, order) : inStoredOrder;

  // New PNLFLDIDs in request order. A copy of a control on this page goes right after its source
  // (and its earlier copies) in tab order (c02: group box 9 at 13, its copy at 14); added controls
  // and copies from elsewhere go last.
  const fresh = added.map((control, i) => ({ pnlFldId: base + i + 1, control }));
  const final: Array<{ survivor: StoredControl } | { fresh: (typeof fresh)[number] }> = survivors.map((s) => ({ survivor: s }));
  for (const f of fresh) {
    const src = f.control.copy && f.control.copy.pnlName === pnlName ? f.control.copy.pnlFldId : undefined;
    let at = src === undefined ? -1 : final.findIndex((e) => 'survivor' in e && e.survivor.pnlFldId === src);
    if (at < 0) { final.push({ fresh: f }); continue; }
    while (at + 1 < final.length && 'fresh' in final[at + 1] && (final[at + 1] as { fresh: (typeof fresh)[number] }).fresh.control.copy?.pnlFldId === src) at++;
    final.splice(at + 1, 0, { fresh: f });
  }
  const newFieldNum = new Map(final.map((e, i) => ['survivor' in e ? e.survivor.pnlFldId : e.fresh.pnlFldId, i + 1]));

  const updates: PagePlan['updates'] = [];
  const extUpdates: PagePlan['extUpdates'] = [];
  // A changed Page Field Name: letters, digits and _ (delivered names such as 1OF10 start with a digit), not another control's.
  // Names already stored are left alone (delivered pages repeat some).
  const nameOf = (c: EditedControl) => (c.pageFieldName !== undefined ? nameValue(c.pageFieldName) : nameValue(storedById.get(c.pnlFldId)?.pageFieldName));
  for (const c of controls) {
    const name = nameOf(c), was = nameValue(storedById.get(c.pnlFldId)?.pageFieldName);
    if (c.pageFieldName === undefined || name === was || name === ' ') continue;
    if (!/^[A-Z0-9_]{1,18}$/.test(name)) throw new PageSaveRefusedError(`${name} is not a page field name (up to 18 letters, digits or _).`);
    if (controls.some((o) => o !== c && nameOf(o) === name)) throw new PageSaveRefusedError(`Another control on the page is already named ${name}.`);
  }
  for (const s of survivors) {
    const e = edited.get(s.pnlFldId)!;
    const columns: Record<string, number | string> = {};
    for (const { col, of, key } of EDITABLE) {
      if (key && e[key] === undefined) continue;
      if (of(e) !== of(s)) columns[col] = of(e);
    }
    // PSPNLFIELDEXT: the Fluid tab's classes and FIELDUSETEMP2 bits; a frame's dialog writes a blank FFSTYLELONG in five slots (fr01).
    const ext: Record<string, number | string> = {};
    if (e.fluidClasses !== undefined && fluidClassSlots(fluidClassText(e.fluidClasses)).join('|') !== fluidClassSlots(s.ffStyleLong).join('|')) {
      for (const slot of e.fluidClasses) if (slot.trim().length > 100) throw new PageSaveRefusedError('A style class entry holds up to 100 characters.');
      ext.FFSTYLELONG = fluidClassText(e.fluidClasses);
    }
    if (e.fieldUseTemp2 !== undefined && Number(e.fieldUseTemp2) !== Number(s.fieldUseTemp2 ?? 0)) ext.FIELDUSETEMP2 = Number(e.fieldUseTemp2);
    if (s.fieldType === FRAME && !ext.FFSTYLELONG && !String(s.ffStyleLong ?? '').trim()
      && [...Object.keys(columns), ...Object.keys(ext)].some((c) => DIALOG_COLUMNS.has(c))) ext.FFSTYLELONG = FFSTYLELONG_EMPTY;
    if (Object.keys(ext).length) extUpdates.push({ pnlFldId: s.pnlFldId, columns: ext });
    const num = newFieldNum.get(s.pnlFldId)!;
    if (num !== s.fieldNum) columns.FIELDNUM = num;
    if (Object.keys(columns).length > 0) updates.push({ pnlFldId: s.pnlFldId, columns });
  }

  const inserts = fresh.map((f) => ({ pnlFldId: f.pnlFldId, fieldNum: newFieldNum.get(f.pnlFldId)!, control: f.control }));
  return { deletes, updates, extUpdates, inserts, fieldCount: controls.length + added.length, maxPnlFldId: base + added.length };
}

/**
 * The controls' extent, for a page made Auto-size without the editor's drawn
 * one: their rectangles (an auto-sized control drawn as the editor draws it,
 * 80 x 18) and any stored label rectangle.
 */
export function controlsExtent(controls: readonly EditedControl[]): { left: number; top: number; right: number; bottom: number } | undefined {
  if (!controls.length) return undefined;
  const rects = controls.flatMap((c) => {
    const right = c.fieldRight > c.fieldLeft ? c.fieldRight : c.fieldLeft + 80, bottom = c.fieldBottom > c.fieldTop ? c.fieldBottom : c.fieldTop + 18;
    const out = [{ l: c.fieldLeft, t: c.fieldTop, r: right, b: bottom }];
    if (c.editLblLeft > 0 && c.editLblTop > 0 && c.editLblRight > c.editLblLeft) out.push({ l: c.editLblLeft, t: c.editLblTop, r: c.editLblRight, b: Math.max(c.editLblBottom, c.editLblTop + 14) });
    return out;
  });
  return { left: Math.min(...rects.map((r) => r.l)), top: Math.min(...rects.map((r) => r.t)), right: Math.max(...rects.map((r) => r.r)), bottom: Math.max(...rects.map((r) => r.b)) };
}

/** A changed owner ID, style sheet, background class or popup menu must exist, as App Designer's lists offer only those. */
async function checkPropertyNames(c: Connection, props: Record<string, string | number | null>): Promise<void> {
  const checks: Array<[string, string, string]> = [
    ['OBJECTOWNERID', `SELECT COUNT(*) AS N FROM PSXLATITEM WHERE FIELDNAME = 'OBJECTOWNERID' AND FIELDVALUE = :v`, 'an owner ID'],
    ['STYLESHEETNAME', `SELECT COUNT(*) AS N FROM PSSTYLSHEETDEFN WHERE STYLESHEETNAME = :v`, 'a style sheet'],
    ['PNLSTYLE', `SELECT COUNT(*) AS N FROM PSSTYLECLASS WHERE STYLECLASSNAME = :v`, 'a style class'],
    ['POPUPMENU', `SELECT COUNT(*) AS N FROM PSMENUDEFN WHERE MENUNAME = :v AND MENUTYPE = 1`, 'a popup menu']
  ];
  for (const [col, sql, what] of checks) {
    const v = props[col];
    if (typeof v !== 'string' || v === ' ') continue;
    const [{ N: n }] = await select<{ N: number }>(c, sql, { v });
    if (!Number(n)) throw new PageSaveRefusedError(`${v} is not ${what} in this database.`);
  }
}

/** PSVERSION / PSLOCK 'PDM' and PSVERSION 'SYS', locked for the save. */
async function counters(c: Connection, forUpdate: boolean): Promise<{ pdm: number; sys: number; lockPdm: number }> {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const v = await select<{ T: string; V: number }>(c,
    `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN ('PDM', 'SYS')${lock}`);
  const l = await select<{ V: number }>(c, `SELECT VERSION AS V FROM PSLOCK WHERE OBJECTTYPENAME = 'PDM'${lock}`);
  const get = (t: string) => v.find((r) => String(r.T).trim() === t)?.V;
  const pdm = get('PDM');
  const sys = get('SYS');
  if (pdm === undefined || sys === undefined || l.length !== 1) {
    throw new PageSaveRefusedError('PSVERSION PDM / SYS or PSLOCK PDM is missing; refusing to write.');
  }
  return { pdm: Number(pdm), sys: Number(sys), lockPdm: Number(l[0].V) };
}

const quoteText = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function savePage(c: Connection, request: PageSaveRequest): Promise<PageSaveResult> {
  const { pnlName, operatorId } = request;
  const scope = writeScopeRefusal(pnlName);
  if (scope) throw new PageSaveRefusedError(scope);
  const opError = validateOperatorId(operatorId);
  if (opError) throw new PageSaveRefusedError(opError);

  try {
    if (!(await operatorExists(c, operatorId))) {
      throw new PageSaveRefusedError(`PeopleSoft operator ${operatorId} does not exist in this database (PSOPRDEFN).`);
    }

    const [defn] = await select<{ VERSION: number; MAXPNLFLDID: number; DESCR: string; DESCRLONG: string | null; PANELRIGHT: number; PANELBOTTOM: number; PNLUSE: number;
      OBJECTOWNERID: string; STYLESHEETNAME: string; PNLSTYLE: string; DEFERPROC: number; POPUPMENU: string; PNLTYPE: number; PANELTOP: number; PANELLEFT: number;
      PNLUSETEMP: number; FFSTYLEDESKTOP: string; FFSTYLEPHONE: string; FFSTYLEMEDIUM: string; FFSTYLETABLET: string; FFSTYLEEXLARGE: string }>(c,
      `SELECT VERSION, MAXPNLFLDID, DESCR, DESCRLONG, PANELRIGHT, PANELBOTTOM, PNLUSE, OBJECTOWNERID, STYLESHEETNAME, PNLSTYLE, DEFERPROC, POPUPMENU, PNLTYPE, PANELTOP, PANELLEFT,
              PNLUSETEMP, FFSTYLEDESKTOP, FFSTYLEPHONE, FFSTYLEMEDIUM, FFSTYLETABLET, FFSTYLEEXLARGE
         FROM PSPNLDEFN WHERE PNLNAME = :n FOR UPDATE`, { n: pnlName });
    if (!defn) throw new PageSaveRefusedError(`No page named ${pnlName}.`);
    if (Number(defn.VERSION) !== request.openedVersion) {
      throw new PageSaveRefusedError(`${pnlName} changed since it was opened (version ${defn.VERSION}, opened ${request.openedVersion}); reopen it.`);
    }

    const storedRows = await select<Record<string, number | string>>(c,
      `SELECT F.PNLFLDID, F.FIELDNUM, F.FIELDTYPE, F.FIELDLEFT, F.FIELDTOP, F.FIELDRIGHT, F.FIELDBOTTOM, F.EDITLBLLEFT, F.EDITLBLTOP, F.EDITLBLRIGHT, F.EDITLBLBOTTOM,
              F.FIELDSIZETYPE, F.LBLTYPE, F.LBLTEXT, F.FIELDUSE, F.SECUREINVISIBLE, F.FIELDSTYLE, F.PNLFIELDNAME, F.PTADJHIDDENFIELDS, F.ENABLEASANCHOR,
              F.FIELDUSETMP, F.DSPLFORMAT, F.CONTNAME, F.GRDLBLMSGSET, F.GRDLBLMSGNUM, F.ONVALUE, F.OFFVALUE, F.LBLLOC, F.RECNAME, F.FIELDNAME, F.DEFERPROC,
              F.OCCURSCOUNT1, F.GRDSHOWCOLHDG, F.GRDSHOWROWHDG, F.GRDALLOWCOLSORT,
              DBMS_LOB.SUBSTR(E.FFSTYLELONG, 4000, 1) AS FFSTYLELONG, E.FIELDUSETEMP2
         FROM PSPNLFIELD F LEFT JOIN PSPNLFIELDEXT E ON E.PNLNAME = F.PNLNAME AND E.PNLFLDID = F.PNLFLDID WHERE F.PNLNAME = :n`, { n: pnlName });
    const stored: StoredControl[] = storedRows.map((r) => ({
      pnlFldId: Number(r.PNLFLDID), fieldNum: Number(r.FIELDNUM), fieldType: Number(r.FIELDTYPE),
      fieldLeft: Number(r.FIELDLEFT), fieldTop: Number(r.FIELDTOP), fieldRight: Number(r.FIELDRIGHT), fieldBottom: Number(r.FIELDBOTTOM),
      editLblLeft: Number(r.EDITLBLLEFT), editLblTop: Number(r.EDITLBLTOP), editLblRight: Number(r.EDITLBLRIGHT), editLblBottom: Number(r.EDITLBLBOTTOM),
      fieldSizeType: Number(r.FIELDSIZETYPE), lblType: Number(r.LBLTYPE), lblText: String(r.LBLTEXT ?? ''),
      fieldUse: Number(r.FIELDUSE), secureInvisible: Number(r.SECUREINVISIBLE),
      fieldStyle: String(r.FIELDSTYLE ?? ''), pageFieldName: String(r.PNLFIELDNAME ?? ''), adjustHidden: Number(r.PTADJHIDDENFIELDS ?? 0),
      anchor: Number(r.ENABLEASANCHOR ?? 0), fieldUseTmp: Number(r.FIELDUSETMP ?? 0), fieldUseTemp2: Number(r.FIELDUSETEMP2 ?? 0),
      dsplFormat: Number(r.DSPLFORMAT ?? 0), contName: String(r.CONTNAME ?? ''), grdLblMsgSet: Number(r.GRDLBLMSGSET ?? 0), grdLblMsgNum: Number(r.GRDLBLMSGNUM ?? 0),
      onValue: String(r.ONVALUE ?? ''), offValue: String(r.OFFVALUE ?? ''), lblLoc: Number(r.LBLLOC ?? 0),
      recName: String(r.RECNAME ?? ''), fieldName: String(r.FIELDNAME ?? ''), deferProc: Number(r.DEFERPROC ?? 0) !== 0,
      occursCount1: Number(r.OCCURSCOUNT1 ?? 0), gridShowColHdg: Number(r.GRDSHOWCOLHDG ?? 0), gridShowRowHdg: Number(r.GRDSHOWROWHDG ?? 0), gridAllowColSort: Number(r.GRDALLOWCOLSORT ?? 0),
      ffStyleLong: r.FFSTYLELONG === null || r.FFSTYLELONG === undefined ? null : String(r.FFSTYLELONG)
    }));

    const plan = planPageSave(stored, request.controls, Number(defn.MAXPNLFLDID), request.order, pnlName);
    // A page made secondary takes its topmost control's top as PANELTOP (u08: 20).
    const tops = request.controls.map((x) => x.fieldTop);
    const props = planPageProperties(defn, request.properties, { minTop: tops.length ? Math.min(...tops) : 0, extent: controlsExtent(request.controls) });
    if (request.properties && request.properties.description.trim().length > 30) {
      throw new PageSaveRefusedError('The page description is limited to 30 characters (PSPNLDEFN.DESCR).');
    }
    await checkPropertyNames(c, props);
    // A control's new Style must be a style class (App Designer's Style list).
    for (const u of plan.updates) {
      const style = u.columns.FIELDSTYLE;
      if (typeof style !== 'string' || style === ' ') continue;
      const [{ N: n }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSSTYLECLASS WHERE STYLECLASSNAME = :v`, { v: style });
      if (!Number(n)) throw new PageSaveRefusedError(`${style} is not a style class in this database.`);
    }
    // A rebound control's Record Name / Field Name must be a real record field (App Designer only lists fields on the record).
    for (const u of plan.updates) {
      if (!('RECNAME' in u.columns) && !('FIELDNAME' in u.columns)) continue;
      const ec = request.controls.find((x) => x.pnlFldId === u.pnlFldId);
      const rec = nameValue(ec?.recName), fld = nameValue(ec?.fieldName);
      if (rec === ' ') continue; // clearing the binding (an unbound control) is allowed
      const [{ N: n }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSRECFIELDDB WHERE RECNAME = :r AND FIELDNAME = :f`, { r: rec, f: fld });
      if (!Number(n)) throw new PageSaveRefusedError(`${rec}.${fld} is not a field on record ${rec}.`);
    }
    if (plan.deletes.length === 0 && plan.updates.length === 0 && plan.inserts.length === 0 && Object.keys(props).length === 0) {
      // Nothing changed: leave the page, its version and the counters untouched.
      return { version: request.openedVersion, fieldCount: plan.fieldCount, updated: 0, deleted: 0, inserted: 0 };
    }

    // Each added control's rows, built before anything is written so a refused field stops the save clean.
    const insertRows: Array<{ field: ColumnValues; ext: ColumnValues }> = [];
    for (const ins of plan.inserts) insertRows.push(await insertedControlRows(c, pnlName, ins));
    const next = await counters(c, true);

    const [{ TS: ts }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);

    for (const id of plan.deletes) {
      await expectRows(c, `DELETE FROM PSPNLFIELD WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id }, 1, `Deleting PSPNLFIELD ${id}`);
      // PSPNLFIELDEXT has one row per control, but a very old page may lack it.
      await c.execute(`DELETE FROM PSPNLFIELDEXT WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id });
    }

    for (const u of plan.updates) {
      const binds: Record<string, unknown> = { n: pnlName, id: u.pnlFldId };
      const sets = Object.entries(u.columns).map(([col, value], i) => {
        if (col === 'LBLTEXT') return `${col} = ${quoteText(String(value))}`;
        binds[`v${i}`] = value;
        return `${col} = :v${i}`;
      });
      await expectRows(c, `UPDATE PSPNLFIELD SET ${sets.join(', ')} WHERE PNLNAME = :n AND PNLFLDID = :id`, binds, 1, `Updating PSPNLFIELD ${u.pnlFldId}`);
    }

    for (const u of plan.extUpdates) {
      const cols = Object.keys(u.columns);
      await expectRows(c, `UPDATE PSPNLFIELDEXT SET ${cols.map((col, i) => `${col} = :v${i}`).join(', ')} WHERE PNLNAME = :n AND PNLFLDID = :id`,
        { ...Object.fromEntries(cols.map((col, i) => [`v${i}`, u.columns[col]])), n: pnlName, id: u.pnlFldId }, 1, `Updating PSPNLFIELDEXT ${u.pnlFldId}`);
    }

    for (const rows of insertRows) {
      await insertRow(c, 'PSPNLFIELD', rows.field);
      await insertRow(c, 'PSPNLFIELDEXT', rows.ext);
    }

    const propSets = Object.keys(props).map((col) => `, ${col} = :p_${col}`).join('');
    const propBinds = Object.fromEntries(Object.entries(props).map(([col, v]) => [`p_${col}`, v]));
    await expectRows(c,
      `UPDATE PSPNLDEFN SET VERSION = :v, FIELDCOUNT = :fc, MAXPNLFLDID = :mx, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), LASTUPDOPRID = :op${propSets}
        WHERE PNLNAME = :n`,
      { v: next.pdm + 1, fc: plan.fieldCount, mx: plan.maxPnlFldId, ts, op: operatorId, n: pnlName, ...propBinds }, 1, 'Updating PSPNLDEFN');

    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'PDM'`, { v: next.pdm + 1 }, 1, 'Updating PSVERSION PDM');
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: next.sys + 1 }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'PDM'`, { v: next.lockPdm + 1 }, 1, 'Updating PSLOCK PDM');

    const result: PageSaveResult = {
      version: next.pdm + 1, fieldCount: plan.fieldCount, updated: plan.updates.length, deleted: plan.deletes.length, inserted: plan.inserts.length
    };
    await verifyPageSave(c, request, result, plan.inserts.map((i) => i.pnlFldId));
    await c.commit();
    return result;
  } catch (err) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw err;
  }
}

/** A record field's type, length and default label, or undefined when the record has no such field. */
/** An added control's rows (App Designer's fresh row) or a pasted one's (a copy of its source's stored rows). */
async function insertedControlRows(c: Connection, pnlName: string, ins: { pnlFldId: number; fieldNum: number; control: EditedControl }):
  Promise<{ field: ColumnValues; ext: ColumnValues }> {
  const { add, copy } = ins.control;
  if (copy) {
    const source = await readControlRows(c, copy.pnlName, copy.pnlFldId);
    if (!source) throw new PageSaveRefusedError(`The copied control ${copy.pnlName} #${copy.pnlFldId} no longer exists; copy it again.`);
    return copyControlRows(source, pnlName, ins.pnlFldId, ins.fieldNum, ins.control);
  }
  if (!add) throw new PageSaveRefusedError(`Control ${ins.pnlFldId} is neither added nor pasted.`);
  const field = isRecordBound(add.kind) ? await readFieldInfo(c, add.recName.trim(), add.fieldName.trim()) : undefined;
  const refusal = newControlFieldRefusal(add.kind, add.recName, add.fieldName, field);
  if (refusal) throw new PageSaveRefusedError(refusal);
  return newControlRows(pnlName, ins.pnlFldId, ins.fieldNum,
    { kind: add.kind, recName: add.recName.trim(), fieldName: add.fieldName.trim() }, ins.control, field);
}

/** A stored control's PSPNLFIELD and PSPNLFIELDEXT rows, every column. */
async function readControlRows(c: Connection, pnlName: string, pnlFldId: number): Promise<{ field: ColumnValues; ext: ColumnValues } | undefined> {
  const [field] = await select<ColumnValues>(c, `SELECT * FROM PSPNLFIELD WHERE PNLNAME = :p AND PNLFLDID = :id`, { p: pnlName, id: pnlFldId });
  if (!field) return undefined;
  const [ext] = await select<ColumnValues>(c, `SELECT * FROM PSPNLFIELDEXT WHERE PNLNAME = :p AND PNLFLDID = :id`, { p: pnlName, id: pnlFldId });
  if (!ext) throw new PageSaveRefusedError(`${pnlName} control ${pnlFldId} has no PSPNLFIELDEXT row to copy.`);
  return { field, ext };
}

/**
 * A pasted control's rows, as App Designer's paste writes them (c01, c02,
 * and n01's paste onto a new page): every column of the source's rows, with
 * the new PNLNAME / PNLFLDID / FIELDNUM, and FIELDLEFT / TOP / RIGHT /
 * BOTTOM all moved by the paste offset -- an auto-sized control's 0 RIGHT
 * included (c01: 0 -> 4). The label rectangle, label and use are the
 * editor's (a hidden, negative label rectangle is not moved, c01).
 * PARENTPNLFLDID / PAGEPNLFLDID name the page the control is on
 * ("<page>$0"; n01's paste onto a not yet named page wrote "$0").
 */
export function copyControlRows(source: { field: ColumnValues; ext: ColumnValues }, pnlName: string, pnlFldId: number, fieldNum: number,
  edited: EditedControl): { field: ColumnValues; ext: ColumnValues } {
  const n = (v: unknown) => Number(v ?? 0);
  const src = source.field;
  const dx = edited.fieldLeft - n(src.FIELDLEFT), dy = edited.fieldTop - n(src.FIELDTOP);
  // The editor keeps an auto-sized 0 at 0; App Designer moves it too. A resized copy keeps the editor's size.
  const corner = (col: 'FIELDRIGHT' | 'FIELDBOTTOM', d: number, sent: number) =>
    sent === (n(src[col]) ? n(src[col]) + d : 0) ? n(src[col]) + d : sent;
  const field: ColumnValues = {
    ...src, PNLNAME: pnlName, PNLFLDID: pnlFldId, FIELDNUM: fieldNum,
    ...(edited.occursLevel !== undefined ? { OCCURSLEVEL: Math.max(0, Math.round(edited.occursLevel)) } : {}),
    FIELDLEFT: edited.fieldLeft, FIELDTOP: edited.fieldTop,
    FIELDRIGHT: corner('FIELDRIGHT', dx, edited.fieldRight), FIELDBOTTOM: corner('FIELDBOTTOM', dy, edited.fieldBottom),
    EDITLBLLEFT: edited.editLblLeft, EDITLBLTOP: edited.editLblTop, EDITLBLRIGHT: edited.editLblRight, EDITLBLBOTTOM: edited.editLblBottom,
    FIELDSIZETYPE: edited.fieldSizeType, LBLTYPE: edited.lblType, LBLTEXT: edited.lblText.trim() ? edited.lblText : ' ',
    FIELDUSE: edited.fieldUse, SECUREINVISIBLE: edited.secureInvisible
  };
  const from = `${String(src.PNLNAME ?? '').trim()}$0`;
  const page = (v: unknown) => (String(v ?? '') === from ? `${pnlName}$0` : v);
  const ext: ColumnValues = { ...source.ext, PNLNAME: pnlName, PNLFLDID: pnlFldId,
    PARENTPNLFLDID: page(source.ext.PARENTPNLFLDID) as ColumnValues[string], PAGEPNLFLDID: page(source.ext.PAGEPNLFLDID) as ColumnValues[string] };
  return { field, ext };
}

async function readFieldInfo(c: Connection, recName: string, fieldName: string): Promise<FieldInfo | undefined> {
  // PSRECFIELDDB lists a record's fields with its subrecords' expanded; PSRECFIELD covers records it omits.
  const [f] = await select<{ FIELDTYPE: number; LENGTH: number }>(c,
    `SELECT D.FIELDTYPE, D.LENGTH FROM PSDBFIELD D
      WHERE D.FIELDNAME = :f
        AND (EXISTS (SELECT 1 FROM PSRECFIELD R WHERE R.RECNAME = :r AND R.FIELDNAME = D.FIELDNAME)
          OR EXISTS (SELECT 1 FROM PSRECFIELDDB R WHERE R.RECNAME = :r AND R.FIELDNAME = D.FIELDNAME))`, { f: fieldName, r: recName });
  if (!f) return undefined;
  const [l] = await select<{ LABEL_ID: string; LONGNAME: string }>(c,
    `SELECT LABEL_ID, LONGNAME FROM PSDBFLDLABL WHERE FIELDNAME = :f AND DEFAULT_LABEL = 1`, { f: fieldName });
  return { fieldType: Number(f.FIELDTYPE), length: Number(f.LENGTH), labelId: String(l?.LABEL_ID ?? ' '), labelText: String(l?.LONGNAME ?? fieldName) };
}

/** One whole row, every column bound. */
async function insertRow(c: Connection, table: string, row: ColumnValues): Promise<void> {
  const cols = Object.keys(row);
  const binds = Object.fromEntries(cols.map((col, i) => [`b${i}`, row[col]]));
  await expectRows(c, `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `:b${i}`).join(', ')})`,
    binds, 1, `Inserting ${table} ${row.PNLFLDID}`);
}

/**
 * App Designer's New Page row (n01-page-new: File > New > Page, one control
 * added, saved): 570 x 330 at Page Size 0x20 without 0x03 (PNLUSE 32, as on
 * 01-create), grid 4 x 4, Allow Deferred Processing on, every name blank.
 */
export const NEW_PAGE: ColumnValues = {
  PNLTYPE: 0, GRIDHORZ: 4, GRIDVERT: 4, HELPCONTEXTNUM: 0, PANELTOP: 0, PANELLEFT: 0, PANELRIGHT: 570, PANELBOTTOM: 330,
  PNLSTYLE: ' ', STYLESHEETNAME: ' ', FFSTYLESHEETNAME: ' ', PNLUSE: 32, DEFERPROC: 1, DESCR: ' ', POPUPMENU: ' ', OBJECTOWNERID: ' ',
  FFSTYLEDESKTOP: ' ', FFSTYLEPHONE: ' ', FFSTYLETABLET: ' ', PNLUSETEMP: 0, FFSTYLEMEDIUM: ' ', FFSTYLEEXLARGE: ' ', DESCRLONG: null
};

/**
 * PSPNLDEFN.LICENSE_CODE is App Designer's own value, set once when a page is
 * created and kept by every later save. It is not derivable from the page
 * (pages created together share one), so a page the writer creates carries
 * ' ', as GPES_JOB_EMPLS does on HRDMO.
 */
export const NEW_PAGE_LICENSE_CODE = ' ';

export interface PageCreateRequest {
  pnlName: string;
  operatorId: string;
  /**
   * A Layout Page (PNLTYPE 7) to copy, as New Page Fluid does (n02-page-new-fluid):
   * its rows verbatim but for the page's name, version, stamp, PNLTYPE 0 and Owner ID ' '.
   */
  template?: string;
  /** Without a template: the page's controls (added or pasted); at least one, as App Designer will not save an empty page. */
  controls?: EditedControl[];
  /** Without a template: the Page Properties set before the first save. */
  properties?: EditedPageProperties;
}

export const PAGE_NAME = /^[A-Z][A-Z0-9_#@$]{0,17}$/;

/** Plans a new page's rows (pure: the caller supplies the template's rows and each control's built rows). */
export function planNewPage(pnlName: string, version: number, operatorId: string, template: { defn: ColumnValues } | undefined,
  controlCount: number, properties?: EditedPageProperties, minTop = 0): ColumnValues {
  if (template) {
    return { ...template.defn, PNLNAME: pnlName, VERSION: version, PNLTYPE: 0, LICENSE_CODE: NEW_PAGE_LICENSE_CODE,
      LASTUPDOPRID: operatorId, OBJECTOWNERID: ' ' };
  }
  const defn: ColumnValues = { PNLNAME: pnlName, VERSION: version, FIELDCOUNT: controlCount, MAXPNLFLDID: controlCount, ...NEW_PAGE,
    LICENSE_CODE: NEW_PAGE_LICENSE_CODE, LASTUPDOPRID: operatorId };
  if (properties) Object.assign(defn, planPageProperties(defn, properties, { minTop }));
  return defn;
}

/**
 * Creates a page as App Designer's first save of a new one does: PSPNLDEFN
 * and each control's PSPNLFIELD / PSPNLFIELDEXT, `PDM` +1 (PSVERSION and
 * PSLOCK) and `SYS` +1 (n01, n02). Refused when the name is taken or out of
 * the write scope, or (no template) when the page has no control.
 */
export async function createPage(c: Connection, request: PageCreateRequest): Promise<PageSaveResult> {
  const pnlName = request.pnlName.trim().toUpperCase();
  const { operatorId } = request;
  if (!PAGE_NAME.test(pnlName)) throw new PageSaveRefusedError(`${pnlName || '(blank)'} is not a page name (a letter, then up to 17 letters, digits or _).`);
  const scope = writeScopeRefusal(pnlName);
  if (scope) throw new PageSaveRefusedError(scope);
  const opError = validateOperatorId(operatorId);
  if (opError) throw new PageSaveRefusedError(opError);
  const controls = request.template ? [] : request.controls ?? [];
  if (!request.template && controls.length === 0) {
    throw new PageSaveRefusedError('Add a control to the page first: App Designer will not save a page that has none.');
  }
  try {
    if (!(await operatorExists(c, operatorId))) {
      throw new PageSaveRefusedError(`PeopleSoft operator ${operatorId} does not exist in this database (PSOPRDEFN).`);
    }
    const [{ N: taken }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSPNLDEFN WHERE PNLNAME = :n`, { n: pnlName });
    if (Number(taken)) throw new PageSaveRefusedError(`There is already a page named ${pnlName}.`);

    let template: { defn: ColumnValues; fields: ColumnValues[]; exts: ColumnValues[] } | undefined;
    if (request.template) {
      const name = request.template.trim().toUpperCase();
      // DESCRLONG is a CLOB: read as text, not a LOB handle (LASTUPDDTTM is the save's own).
      const [row] = await select<ColumnValues>(c,
        `SELECT D.*, DBMS_LOB.SUBSTR(D.DESCRLONG, 4000, 1) AS DESCRLONG_TEXT FROM PSPNLDEFN D WHERE D.PNLNAME = :n`, { n: name });
      if (!row || Number(row.PNLTYPE) !== 7) throw new PageSaveRefusedError(`${name} is not a Layout Page.`);
      const { DESCRLONG_TEXT, LASTUPDDTTM: _stamp, ...defn } = row;
      defn.DESCRLONG = DESCRLONG_TEXT ?? null;
      template = { defn, fields: await select<ColumnValues>(c, `SELECT * FROM PSPNLFIELD WHERE PNLNAME = :n ORDER BY PNLFLDID`, { n: name }),
        exts: await select<ColumnValues>(c, `SELECT * FROM PSPNLFIELDEXT WHERE PNLNAME = :n ORDER BY PNLFLDID`, { n: name }) };
    }
    // The controls' rows, built before anything is written: PNLFLDID and FIELDNUM 1..N in the editor's order.
    const rows: Array<{ field: ColumnValues; ext: ColumnValues }> = template
      ? template.fields.map((f) => ({ field: { ...f, PNLNAME: pnlName }, ext: { ...template!.exts.find((e) => e.PNLFLDID === f.PNLFLDID)!, PNLNAME: pnlName } }))
      : [];
    for (const [i, control] of controls.entries()) rows.push(await insertedControlRows(c, pnlName, { pnlFldId: i + 1, fieldNum: i + 1, control }));
    if (template && rows.some((r) => !r.ext.PNLFLDID)) throw new PageSaveRefusedError(`${request.template} has a control without a PSPNLFIELDEXT row.`);
    if (request.properties && request.properties.description.trim().length > 30) {
      throw new PageSaveRefusedError('The page description is limited to 30 characters (PSPNLDEFN.DESCR).');
    }

    const next = await counters(c, true);
    const [{ TS: ts }] = await select<{ TS: string }>(c, `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);
    const tops = controls.map((x) => x.fieldTop);
    const defn = planNewPage(pnlName, next.pdm + 1, operatorId, template, rows.length, request.properties, tops.length ? Math.min(...tops) : 0);
    await checkPropertyNames(c, defn);
    delete defn.LASTUPDDTTM;
    const cols = Object.keys(defn);
    await expectRows(c, `INSERT INTO PSPNLDEFN (${cols.join(', ')}, LASTUPDDTTM) VALUES (${cols.map((_, i) => `:b${i}`).join(', ')}, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}))`,
      { ...Object.fromEntries(cols.map((col, i) => [`b${i}`, defn[col]])), ts }, 1, `Inserting PSPNLDEFN ${pnlName}`);
    for (const r of rows) {
      await insertRow(c, 'PSPNLFIELD', r.field);
      await insertRow(c, 'PSPNLFIELDEXT', r.ext);
    }
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'PDM'`, { v: next.pdm + 1 }, 1, 'Updating PSVERSION PDM');
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: next.sys + 1 }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'PDM'`, { v: next.lockPdm + 1 }, 1, 'Updating PSLOCK PDM');

    const result: PageSaveResult = { version: next.pdm + 1, fieldCount: rows.length, updated: 0, deleted: 0, inserted: rows.length };
    await verifyPageSave(c, { pnlName, openedVersion: 0, operatorId, controls: [] }, result, rows.map((r) => Number(r.field.PNLFLDID)));
    await c.commit();
    return result;
  } catch (err) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw err;
  }
}

/** The committed page is what the save intended: version, field count, the added controls present, no deleted one left. */
export async function verifyPageSave(c: Connection, request: PageSaveRequest, result: PageSaveResult, insertedIds: readonly number[] = []): Promise<void> {
  const [defn] = await select<{ VERSION: number; FIELDCOUNT: number }>(c,
    `SELECT VERSION, FIELDCOUNT FROM PSPNLDEFN WHERE PNLNAME = :n`, { n: request.pnlName });
  if (!defn || Number(defn.VERSION) !== result.version || Number(defn.FIELDCOUNT) !== result.fieldCount) {
    throw new PageSaveRefusedError(`${request.pnlName} did not land as planned (version ${defn?.VERSION}, count ${defn?.FIELDCOUNT}); rolled back.`);
  }
  const [{ N: n }] = await select<{ N: number }>(c,
    `SELECT COUNT(*) AS N FROM PSPNLFIELD WHERE PNLNAME = :n`, { n: request.pnlName });
  if (Number(n) !== result.fieldCount) {
    throw new PageSaveRefusedError(`${request.pnlName} has ${n} controls after the save, expected ${result.fieldCount}; rolled back.`);
  }
  for (const id of insertedIds) {
    const [{ N: m }] = await select<{ N: number }>(c,
      `SELECT COUNT(*) AS N FROM PSPNLFIELDEXT WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: request.pnlName, id });
    if (Number(m) !== 1) throw new PageSaveRefusedError(`Added control ${id} did not land on ${request.pnlName}; rolled back.`);
  }
}
