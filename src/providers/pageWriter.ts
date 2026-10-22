import type { DbConnection as Connection, DbTypes } from '../db/connection.js';
import { readPageSnapshot, type PagePreviewSnapshots } from './pageSnapshot.js';
import { writeScopeRefusal } from './writeScope.js';
import { columnOrNull, presentOnly, tableColumns } from './tableColumns.js';
import { PAGE_SIZE_BITS, PAGE_SIZE_CUSTOM, PAGE_SIZE_PRESETS, pageSizeChoice } from '../model/pageLayout.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import {
  FIELD_OPTIONAL, GRID_FIELD_TYPES, GRID_ONLY, NEW_CONTROL_FIELDTYPE, RECORD_ONLY, RECORD_OPTIONAL, newControlDataRows, newControlFieldRefusal,
  newControlRows, isRecordBound, type ColumnValues, type FieldInfo, type NewControl, type NewControlDataRows
} from './pageControlTemplates.js';
import { checkPageScrolls, occursLevels, SCROLL_FIELD_TYPES, type CheckedControl, type PageProblem } from '../model/pageLevels.js';
import { pageUseRefusal } from '../model/pageUse.js';

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

/**
 * The page fails App Designer's checks (pageLevels.ts checkPageScrolls): its Message Set 15 messages, then "Invalid page.
 * Do you still want to save the page?" (46,2). App Designer saves anyway on Yes; so does savePage with `saveInvalid`.
 */
export class PageInvalidError extends PageSaveRefusedError {
  constructor(readonly problems: readonly PageProblem[]) {
    super(`${problems.map((p) => `${p.text} (${p.set},${p.num})`).join('\n')}\nWarning: Invalid page. Do you still want to save the page? (46,2)`);
    this.name = 'PageInvalidError';
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
  /**
   * Change Review restoration only: a control's complete native rows from a reviewed snapshot, inserted again under
   * their own PNLFLDID (`pnlFldId`), at the place `order` gives it. Never built from editor or agent input.
   */
  restore?: RestoredControlRows;
  /**
   * A Related Field's Related Control Field named by its PNLFLDID. The save writes that control's final FIELDNUM - 1 as
   * ASSOCFIELDNUM (ps01-ps04); absent, the stored or edited ASSOCFIELDNUM names it by its FIELDNUM before the save.
   */
  assocTarget?: number;
  /** An added or pasted grid's column count, as the save derives it (planPageSave). */
  grdColumnCount?: number;
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
  /**
   * A scroll's own Occurs Level (Scroll Bar / Grid / Scroll Area, its dialog; an added one is 1), or the level a Horizontal
   * Rule's Set to Level chose. Every other control's OCCURSLEVEL follows from the tab order (pageLevels.ts) and is
   * assigned by the save; a value sent for one is ignored.
   */
  occursLevel?: number;
  /** A Horizontal Rule's Set to Level choice (PSPNLFIELDEXT.PT_NUMFLD1, lv06; kept when Set to Level is cleared, lv11). */
  setLevel?: number;
  /** PSPNLFIELD.FIELDTYPE, for a pasted control (the page's levels need to know a pasted scroll). */
  fieldType?: number;
  /**
   * An HTML Area's Constant value (PSPNLHTMLAREA.HTMLAREA, ha03-ha05): the HTML text, or null for a Field value (the
   * row is deleted, ha05). Absent leaves the stored one.
   */
  htmlConstant?: string | null;
  /**
   * A Long Edit Box's Rich Text options (PSPTPNLRTEDITOR, le01, le03): Configuration Settings, Image Location URL, Plugin,
   * Template and Style File ids, or null when Rich Text is off (the row is deleted). Absent leaves the stored ones.
   */
  richText?: RichTextOptions | null;
  /** A Long Edit Box's label Position Left / Custom / Top (PSPNLFIELD.LABELSIZETYPE 0 / 1 / 2, le05-le07). */
  labelSizeType?: number;
  /** A Long Edit Box's Expand Field When Display Only (PSPNLFIELD.PTLEBEXPANDFIELD, le12). */
  expandField?: number;
  /** PSPNLFIELDEXT Placeholder Text (le17, le18): PLHTYPE None 0 / Static 1 / Message Catalog 2, PLACEHOLDER, PLH_MSG_SET_NBR / PLH_MSG_NBR. */
  placeholderType?: number;
  placeholder?: string;
  placeholderMsgSet?: number;
  placeholderMsgNum?: number;
  /** A control's Popup Menu (PSPNLFIELD.POPUPMENU, cbx11; a popup menu definition, ' ' none). */
  popupMenu?: string;
  /** Related Field's Related Control Field (ASSOCFIELDNUM, cbx13): the Display Control Field control's FIELDNUM - 1; 0 none. */
  assocFieldNum?: number;
  /** A Group Box's Label tab (gb11, gb16, gb17): Label Style (LABELSTYLE), Label ID (LABEL_ID) and *** Use Default Label *** (USEDEFAULTLABEL 1). */
  labelStyle?: string;
  labelId?: string;
  useDefaultLabel?: number;
  /** A Group Box's Use tab (gb18-gb20): PTHIDEFIELDS, PTCOLLAPSEDATAAREA, PTDFLTVIEWEXPANDED, PTLBLIMGCOLLAPSE / PTLBLIMGEXPAND. */
  hideFields?: number;
  collapseDataArea?: number;
  defaultExpanded?: number;
  imageCollapsed?: string;
  imageExpanded?: string;
  /** PSPNLFIELDEXT: a Group Box's Embedded Popup Help message (MESSAGE_SET_NBR / MESSAGE_NBR, gb12). */
  popupMsgSet?: number;
  popupMsgNum?: number;
  /** PSPNLFIELDEXT: a Group Box's Fluid Container Properties (gb01-gb04, gb26, gb27): GRPBOXTYPE, GRPBOXHTMLTYPE, SCROLLBARS and the
   * Header Extension PTGBRELTXTINFO / PTGBRELACTINFO / PTGBRELACTFLD (the chosen group box's FIELDNUM - 1; -1 none). */
  groupBoxType?: number;
  groupBoxHtmlType?: number;
  scrollBars?: number;
  headerTextInfo?: number;
  headerActionInfo?: number;
  headerActionItems?: number;
  /**
   * An Edit Box's dialog (eb30, eb78, eb39, eb61-eb73, eb80): Fill Character (PSPNLFIELD.DSPLFILL), Family Name / Display Name
   * (FORMATFAMILY: the bound field's, set on a rebind; DISPFMTNAME), and PSPNLFIELDEXT's Mouse Over Page Popup (PTPOPUPPNL),
   * Input Type (HTML_INPUT_TYPE), a range's Min / Max / Step (MINNUMBER / MAXNUMBER / STEPNUMBER) and Smart Prompt off
   * (PTDISABLESMARTPROM 1).
   */
  dsplFill?: string;
  formatFamily?: string;
  displayFormatName?: string;
  popupPage?: string;
  inputType?: number;
  minNumber?: string;
  maxNumber?: string;
  stepNumber?: string;
  disableSmartPrompt?: number;
}

/** The tables holding one control's rows by PNLFLDID, which a reviewed restoration re-inserts (a Tree's levels are keyed by FIELDNUM and are not). */
export const RESTORABLE_CONTROL_TABLES = ['PSPNLFIELD', 'PSPNLFIELDEXT', 'PSPNLHTMLAREA', 'PSPNLHTMLLANG', 'PSPTPNLRTEDITOR', 'PSPNLCNTRLDATA',
  'PSPNLBTNDATA', 'PSPNLACEGRDDATA', 'PSPNLACEGRDAXIS'] as const;
export type RestoredControlRows = { [T in (typeof RESTORABLE_CONTROL_TABLES)[number]]?: ColumnValues[] };

/** PSPNLFIELD.FIELDUSE 0x10: Related Field, its Related Control Field in ASSOCFIELDNUM. */
export const FIELD_USE_RELATED = 0x10;

/** PSPTPNLRTEDITOR's columns, as the Options tab names them (' ' none). */
export interface RichTextOptions {
  configSettingsId: string;
  imageLocationUrlId: string;
  pluginFileId: string;
  templateFileId: string;
  styleFileId: string;
}
const richTextKey = (r: RichTextOptions | null | undefined) => r ? [r.configSettingsId, r.imageLocationUrlId, r.pluginFileId, r.templateFileId, r.styleFileId].map((x) => (x ?? '').trim().toUpperCase() || ' ').join('|') : null;

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
  /** Save a page that fails App Designer's checks (PageInvalidError), as its "Invalid page ... save?" Yes does. */
  saveInvalid?: boolean;
  /** Execute the native writer and verify within its transaction, then roll back. Returned version/counts are hypothetical. */
  dryRun?: boolean;
  /** Full native before/after images, captured inside the preview transaction before rollback. Requires dryRun. */
  captureSnapshots?: boolean;
  /** Additional full-content/version guard, checked under the Page header lock. */
  expectedSnapshotToken?: string;
  /**
   * Change Review restoration only: PSPNLDEFN.MAXPNLFLDID after the save, at least every remaining control's PNLFLDID.
   * Lowering it (undoing an added control) needs the snapshot guard and no other definition naming a released id.
   */
  maxPnlFldId?: number;
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
  snapshots?: PagePreviewSnapshots;
}

/** A stored control's editable columns plus its FIELDNUM, read before the write. */
export interface StoredControl extends EditedControl {
  fieldNum: number;
  /** PSPNLFIELD.FIELDTYPE (for the reorder check: grids and scrolls). */
  fieldType?: number;
  /** PSPNLFIELDEXT.FFSTYLELONG (a frame's dialog rewrites a blank one, fr01) and FIELDUSETEMP2. */
  ffStyleLong?: string | null;
  fieldUseTemp2?: number;
  /** A Tree's TREECTRLID (its FIELDNUM when App Designer last saved it; 0 with no levels) and a grid's GRDCOLUMNCOUNT. */
  treeCtrlId?: number;
  grdColumnCount?: number;
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
  { col: 'GRDALLOWCOLSORT', of: (c) => Number(c.gridAllowColSort ?? 0), key: 'gridAllowColSort' },
  // A Group Box's Label and Use tabs.
  { col: 'LABELSTYLE', of: (c) => nameValue(c.labelStyle), key: 'labelStyle' },
  { col: 'LABEL_ID', of: (c) => nameValue(c.labelId), key: 'labelId' },
  { col: 'USEDEFAULTLABEL', of: (c) => Number(c.useDefaultLabel ?? 0), key: 'useDefaultLabel' },
  { col: 'PTHIDEFIELDS', of: (c) => Number(c.hideFields ?? 0), key: 'hideFields' },
  { col: 'PTCOLLAPSEDATAAREA', of: (c) => Number(c.collapseDataArea ?? 0), key: 'collapseDataArea' },
  { col: 'PTDFLTVIEWEXPANDED', of: (c) => Number(c.defaultExpanded ?? 0), key: 'defaultExpanded' },
  { col: 'PTLBLIMGCOLLAPSE', of: (c) => nameValue(c.imageCollapsed), key: 'imageCollapsed' },
  { col: 'PTLBLIMGEXPAND', of: (c) => nameValue(c.imageExpanded), key: 'imageExpanded' },
  // A control's Popup Menu and a Related Field's Related Control Field (cbx11, cbx13).
  { col: 'POPUPMENU', of: (c) => nameValue(c.popupMenu), key: 'popupMenu' },
  { col: 'ASSOCFIELDNUM', of: (c) => Number(c.assocFieldNum ?? 0), key: 'assocFieldNum' },
  // A Long Edit Box's label Position and Expand Field When Display Only (le05-le07, le12).
  { col: 'LABELSIZETYPE', of: (c) => Number(c.labelSizeType ?? 0), key: 'labelSizeType' },
  { col: 'PTLEBEXPANDFIELD', of: (c) => Number(c.expandField ?? 0), key: 'expandField' },
  // An Edit Box's Fill Character (as typed: one character, ' ' none), Family Name and Display Name (eb30, eb77, eb78).
  { col: 'DSPLFILL', of: (c) => (c.dsplFill ?? '').trim() ? c.dsplFill!.trim().slice(0, 1) : ' ', key: 'dsplFill' },
  { col: 'FORMATFAMILY', of: (c) => nameValue(c.formatFamily), key: 'formatFamily' },
  { col: 'DISPFMTNAME', of: (c) => nameValue(c.displayFormatName), key: 'displayFormatName' },
];

/**
 * Change Review: the editor fields that reproduce a surviving control's reviewed change from its native before and after
 * rows -- only columns the save writes from an editor field, and only those that differ. A Related Field's reference is
 * carried by identity (assocTarget) by the caller. The native preview must still reproduce the whole after-image.
 */
export function reviewedControlFields(before: { field: ColumnValues; ext?: ColumnValues }, after: { field: ColumnValues; ext?: ColumnValues }): Partial<EditedControl> {
  const out: Record<string, unknown> = {};
  const value = (raw: unknown, key: keyof EditedControl) => (key === 'deferProc' ? Number(raw) !== 0 : typeof raw === 'number' ? raw : String(raw ?? ''));
  const changed = (a: ColumnValues | undefined, b: ColumnValues | undefined, col: string) => !!a && !!b && String(a[col] ?? '') !== String(b[col] ?? '');
  for (const { col, key } of EDITABLE) if (key && key !== 'assocFieldNum' && changed(before.field, after.field, col)) out[key] = value(after.field[col], key);
  if (changed(before.field, after.field, 'ASSOCFIELDNUM')) out.assocFieldNum = Number(after.field.ASSOCFIELDNUM ?? 0);
  for (const { col, key } of EXT_EDITABLE) if (changed(before.ext, after.ext, col)) out[key] = value(after.ext![col], key);
  if (changed(before.ext, after.ext, 'FFSTYLELONG')) out.fluidClasses = fluidClassSlots(after.ext!.FFSTYLELONG === null ? null : String(after.ext!.FFSTYLELONG));
  if (changed(before.ext, after.ext, 'FIELDUSETEMP2')) out.fieldUseTemp2 = Number(after.ext!.FIELDUSETEMP2 ?? 0);
  return out as Partial<EditedControl>;
}

/** The stored controls' columns the save plan reads: PSPNLFIELD's, then PSPNLFIELDEXT's (FFSTYLELONG, a CLOB, apart). */
const STORED_FIELD_COLUMNS = ['PNLFLDID', 'FIELDNUM', 'FIELDTYPE', 'FIELDLEFT', 'FIELDTOP', 'FIELDRIGHT', 'FIELDBOTTOM', 'EDITLBLLEFT', 'EDITLBLTOP',
  'EDITLBLRIGHT', 'EDITLBLBOTTOM', 'FIELDSIZETYPE', 'LBLTYPE', 'LBLTEXT', 'FIELDUSE', 'SECUREINVISIBLE', 'FIELDSTYLE', 'PNLFIELDNAME', 'PTADJHIDDENFIELDS',
  'ENABLEASANCHOR', 'FIELDUSETMP', 'DSPLFORMAT', 'CONTNAME', 'GRDLBLMSGSET', 'GRDLBLMSGNUM', 'ONVALUE', 'OFFVALUE', 'LBLLOC', 'RECNAME', 'FIELDNAME',
  'DEFERPROC', 'OCCURSCOUNT1', 'GRDSHOWCOLHDG', 'GRDSHOWROWHDG', 'GRDALLOWCOLSORT', 'OCCURSLEVEL', 'POPUPMENU', 'ASSOCFIELDNUM', 'LABELSTYLE', 'LABEL_ID',
  'USEDEFAULTLABEL', 'PTHIDEFIELDS', 'PTCOLLAPSEDATAAREA', 'PTDFLTVIEWEXPANDED', 'PTLBLIMGCOLLAPSE', 'PTLBLIMGEXPAND', 'LABELSIZETYPE', 'PTLEBEXPANDFIELD',
  'DSPLFILL', 'FORMATFAMILY', 'DISPFMTNAME', 'TREECTRLID', 'GRDCOLUMNCOUNT'];
const STORED_EXT_COLUMNS = ['PLHTYPE', 'PLACEHOLDER', 'PLH_MSG_SET_NBR', 'PLH_MSG_NBR', 'MESSAGE_SET_NBR', 'MESSAGE_NBR', 'GRPBOXTYPE', 'GRPBOXHTMLTYPE',
  'SCROLLBARS', 'PTGBRELTXTINFO', 'PTGBRELACTINFO', 'PTGBRELACTFLD', 'PTPOPUPPNL', 'HTML_INPUT_TYPE', 'MINNUMBER', 'MAXNUMBER', 'STEPNUMBER',
  'PTDISABLESMARTPROM', 'PT_NUMFLD1', 'FIELDUSETEMP2'];

/** The PSPNLFIELDEXT columns a Group Box's dialog sets, written only when the editor sends them. */
const EXT_EDITABLE: Array<{ col: string; of: (c: EditedControl) => number | string; key: keyof EditedControl }> = [
  { col: 'MESSAGE_SET_NBR', of: (c) => Number(c.popupMsgSet ?? 0), key: 'popupMsgSet' },
  { col: 'MESSAGE_NBR', of: (c) => Number(c.popupMsgNum ?? 0), key: 'popupMsgNum' },
  { col: 'GRPBOXTYPE', of: (c) => Number(c.groupBoxType ?? 0), key: 'groupBoxType' },
  { col: 'GRPBOXHTMLTYPE', of: (c) => Number(c.groupBoxHtmlType ?? 0), key: 'groupBoxHtmlType' },
  { col: 'SCROLLBARS', of: (c) => Number(c.scrollBars ?? 0), key: 'scrollBars' },
  { col: 'PTGBRELTXTINFO', of: (c) => Number(c.headerTextInfo ?? 0), key: 'headerTextInfo' },
  { col: 'PTGBRELACTINFO', of: (c) => Number(c.headerActionInfo ?? 0), key: 'headerActionInfo' },
  { col: 'PTGBRELACTFLD', of: (c) => Number(c.headerActionItems ?? 0), key: 'headerActionItems' },
  // Placeholder Text (le17, le18).
  { col: 'PLHTYPE', of: (c) => Number(c.placeholderType ?? 0), key: 'placeholderType' },
  { col: 'PLACEHOLDER', of: (c) => (c.placeholder ?? '').trim() ? c.placeholder! : ' ', key: 'placeholder' },
  { col: 'PLH_MSG_SET_NBR', of: (c) => Number(c.placeholderMsgSet ?? 0), key: 'placeholderMsgSet' },
  { col: 'PLH_MSG_NBR', of: (c) => Number(c.placeholderMsgNum ?? 0), key: 'placeholderMsgNum' },
  // An Edit Box's Mouse Over Page Popup, Input Type with a range's Min / Max / Step, and Smart Prompt (eb39, eb61-eb73, eb80).
  { col: 'PTPOPUPPNL', of: (c) => nameValue(c.popupPage), key: 'popupPage' },
  { col: 'HTML_INPUT_TYPE', of: (c) => Number(c.inputType ?? 0), key: 'inputType' },
  { col: 'MINNUMBER', of: (c) => (c.minNumber ?? '').trim() || ' ', key: 'minNumber' },
  { col: 'MAXNUMBER', of: (c) => (c.maxNumber ?? '').trim() || ' ', key: 'maxNumber' },
  { col: 'STEPNUMBER', of: (c) => (c.stepNumber ?? '').trim() || ' ', key: 'stepNumber' },
  { col: 'PTDISABLESMARTPROM', of: (c) => Number(c.disableSmartPrompt ?? 0), key: 'disableSmartPrompt' },
  // A Horizontal Rule's Set to Level choice (lv06, lv12, lv13).
  { col: 'PT_NUMFLD1', of: (c) => Number(c.setLevel ?? 0), key: 'setLevel' }
];

/**
 * OK on a Group Box's dialog (gb06 on a Fluid page, gb28 on a classic one) also writes: an explicit alignment (DSPLFORMAT
 * Left 0x80000 when none of Left / Centered / Right is set), FIELDUSETMP 0x6000000, a blank FFSTYLELONG in five slots and,
 * on a Fluid page only, the Header Extension's 0s as -1.
 */
export const GROUP_BOX_ALIGN = { left: 0x80000, centered: 0x100000, right: 0x200000 } as const;
const GROUP_BOX_ALIGN_MASK = 0x380000;
const GROUP_BOX_DIALOG_USETMP = 0x6000000;
const GROUP_BOX_GEOMETRY = new Set(['FIELDLEFT', 'FIELDTOP', 'FIELDRIGHT', 'FIELDBOTTOM', 'EDITLBLLEFT', 'EDITLBLTOP', 'EDITLBLRIGHT', 'EDITLBLBOTTOM', 'FIELDSIZETYPE']);
const GROUP_BOX = 2;

/**
 * The Properties dialog's columns: OK on a frame's dialog writes its PSPNLFIELDEXT.FFSTYLELONG as App Designer's
 * five-slot ' | | | | ' (fr01), and so does a Horizontal Rule's on any page (hr01 classic, hr07 Fluid) and a Static
 * Text's, Edit Box's or HTML Area's on a Fluid page (st11, cbx12, ha01; on a classic page, st01-st09, a Static Text's does not).
 */
const DIALOG_COLUMNS = new Set(['LBLTEXT', 'FIELDSTYLE', 'FIELDUSE', 'PTADJHIDDENFIELDS', 'PNLFIELDNAME', 'ENABLEASANCHOR', 'FIELDUSETMP', 'FIELDUSETEMP2']);
const FRAME = 1;
const STATIC_TEXT = 0;
const HORIZONTAL_RULE = 23;
const EDIT_BOX = 4;
const SCROLL_BAR = 10;
const HTML_AREA = 25;
const TREE = 20;
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
  /** An HTML Area's PSPNLHTMLAREA row: its new Constant text, or null to delete it (a Field value again). */
  htmlWrites: Array<{ pnlFldId: number; html: string | null }>;
  /** A Long Edit Box's PSPTPNLRTEDITOR row: its new Rich Text options, or null to delete it (Rich Text off). */
  richTextWrites: Array<{ pnlFldId: number; richText: RichTextOptions | null }>;
  /** The control count after the save (PSPNLDEFN.FIELDCOUNT). */
  fieldCount: number;
  /** PSPNLDEFN.MAXPNLFLDID after the save. */
  maxPnlFldId: number;
  /** The high-water mark without a reviewed restoration's own value. */
  naturalMaxPnlFldId: number;
  /** The page as App Designer's checks see it, in the final tab order (each record's type is looked up by savePage). */
  checked: Array<Omit<CheckedControl, 'recType'>>;
  /** Trees whose FIELDNUM moved: their TREECTRLID and PSPNLTREECTRL rows follow it (sp-fresh, sbp-fresh, sb-delete). */
  treeRekeys: Array<{ from: number; to: number }>;
  /** Deleted trees' TREECTRLIDs: their PSPNLTREECTRL rows go with them. */
  treeDeletes: number[];
}

/**
 * The survivors in the Order tab's order, refusing an order that is not theirs. A control moved into or out of a scroll
 * takes the level of its new place, as in App Designer (lv14-lv16): planPageSave assigns the levels again.
 */
function reordered(survivors: readonly StoredControl[], order: readonly number[]): StoredControl[] {
  const byId = new Map(survivors.map((c) => [c.pnlFldId, c]));
  if (order.length !== survivors.length || new Set(order).size !== order.length || order.some((id) => !byId.has(id))) {
    throw new PageSaveRefusedError('The tab order does not list exactly the controls on the page.');
  }
  return order.map((id) => byId.get(id)!);
}

/**
 * The change plan from the stored controls to the edited ones: which rows are
 * deleted, and which columns change on each survivor (geometry / label / use,
 * and FIELDNUM when the contiguous order shifts). Pure -- the writer wraps the
 * database around it, and the tests check it without one.
 *
 * `order` is the Order tab's tab order (the survivors' PNLFLDIDs). Every
 * control's OCCURSLEVEL is assigned again from the final order (pageLevels.ts),
 * and a scroll left with nothing in it is refused, as App Designer does.
 */
/**
 * Where App Designer puts a control added to a page in the tab order -- not at the end, nor after
 * the selected control, but right after the control before it in reading order: the last of the
 * page's controls at or above-left of it, two being on one row when their tops are within 20 pixels
 * (then left to right). Of several at one spot the first in tab order counts; with none the new
 * control goes first. Fitted to every App Designer insert captured (02, 06, 07, 15-18, in01, in03,
 * eb/gb-hr/rb/le/ht-fresh, ht-field, sa/sb/sec/sub; to-a with another control selected, to-c
 * selected on the canvas, to-d one row of 24 px). Fields dropped inside a grid (stored at 0,0, gr-fresh)
 * are not covered. Returns the index in `order` (tab order, first to last) to insert at.
 */
export const TAB_ROW_BAND = 20;
export function newControlTabIndex(order: ReadonlyArray<{ fieldLeft: number; fieldTop: number; scroll?: boolean }>, added: { fieldLeft: number; fieldTop: number }): number {
  // A scroll (Scroll Area, Grid ...) starts its own region: a control dropped above its top goes before it even within the
  // row band (ps03: Static Text at top 64 before the Scroll Area at 72).
  const sameRow = (a: { fieldTop: number; scroll?: boolean }, b: { fieldTop: number; scroll?: boolean }) => !a.scroll && !b.scroll && Math.abs(a.fieldTop - b.fieldTop) <= TAB_ROW_BAND;
  // Anything higher on the page comes before, wherever it is across (ps03: a hidden field 16 px higher at the far right);
  // the row band only adds controls a little lower down and to the left (18-number-datetime: 20 px lower, left).
  const atOrBefore = (a: typeof added, b: typeof added) => a.fieldTop < b.fieldTop || (sameRow(a, b) && a.fieldLeft <= b.fieldLeft);
  const before = (a: typeof added, b: typeof added) => (sameRow(a, b) ? a.fieldLeft < b.fieldLeft : a.fieldTop < b.fieldTop);
  let best = -1;
  order.forEach((c, i) => { if (atOrBefore(c, added) && (best < 0 || before(order[best], c))) best = i; });
  return best + 1;
}

/**
 * Where App Designer puts a new scroll -- Scroll Area, Scroll Bar, Grid, Analytic Grid -- in the tab order: after the last
 * control (in tab order) whose top is at or above the scroll's bottom edge, so the controls drawn above or beside it stay
 * before it (gd-fresh: a grid drawn over a chart at its bottom right goes after it; ag-fresh: an analytic grid at the page's
 * top goes after the grid columns stored at (0, 0); lv02, lv03, sa-fresh, sb-fresh, gr-fresh).
 */
export function newScrollTabIndex(order: ReadonlyArray<{ fieldTop: number }>, added: { fieldTop: number; fieldBottom: number }): number {
  const bottom = Math.max(added.fieldBottom, added.fieldTop);
  let last = -1;
  order.forEach((c, i) => { if (c.fieldTop <= bottom) last = i; });
  return last + 1;
}

export function planPageSave(stored: readonly StoredControl[], all: readonly EditedControl[], maxPnlFldId = 0, order?: readonly number[],
  pnlName = '', fluidPage = false, highWater?: number): PagePlan {
  const restored = all.filter((c) => !!c.restore);
  const added = all.filter((c) => !c.restore && (!!c.add || !!c.copy));
  const controls = all.filter((c) => !c.add && !c.copy && !c.restore);
  const edited = new Map(controls.map((c) => [c.pnlFldId, c]));
  const storedById = new Map(stored.map((c) => [c.pnlFldId, c]));
  // A reviewed restoration re-inserts a control's own rows under its own id, at the place a complete tab order gives it.
  for (const r of restored) {
    const row = r.restore!.PSPNLFIELD;
    if (!Number.isSafeInteger(r.pnlFldId) || r.pnlFldId <= 0 || storedById.has(r.pnlFldId) || restored.filter((x) => x.pnlFldId === r.pnlFldId).length > 1
      || row?.length !== 1 || Number(row[0].PNLFLDID) !== r.pnlFldId || r.restore!.PSPNLFIELDEXT?.length !== 1) {
      throw new PageSaveRefusedError(`Restored control ${r.pnlFldId} needs its own unused id and exactly one PSPNLFIELD and PSPNLFIELDEXT row.`);
    }
    if (Number(row[0].FIELDTYPE) === TREE) throw new PageSaveRefusedError('Restoring a Tree is not supported: its levels are keyed by tab order.');
    if (Object.values(r.restore!).some((rows) => rows?.some((x) => String(x.PNLNAME ?? '').trim() !== pnlName || Number(x.PNLFLDID) !== r.pnlFldId))) {
      throw new PageSaveRefusedError(`Restored control ${r.pnlFldId} has rows of another control or page.`);
    }
  }
  if (restored.length && (added.length || !order)) throw new PageSaveRefusedError('Restored controls are placed by a complete tab order, without other added controls.');

  for (const c of controls) {
    if (!storedById.has(c.pnlFldId)) {
      throw new PageSaveRefusedError(`Control ${c.pnlFldId} is not on the stored page.`);
    }
    const refusal = pageUseRefusal(storedById.get(c.pnlFldId)?.fieldType, c.fieldUse, c.secureInvisible);
    if (refusal) throw new PageSaveRefusedError(refusal);
  }
  // MAXPNLFLDID is a high-water mark; never hand out an id at or below a stored one.
  const base = Math.max(maxPnlFldId, ...stored.map((c) => c.pnlFldId), 0);

  const deletes = stored.filter((c) => !edited.has(c.pnlFldId)).map((c) => c.pnlFldId);

  // FIELDNUM is a contiguous 1..N order: the survivors in their stored order, or
  // the Order tab's, with the deleted gaps closed.
  const inStoredOrder = stored.filter((c) => edited.has(c.pnlFldId)).sort((a, b) => a.fieldNum - b.fieldNum);
  const restoredById = new Map(restored.map((r) => [r.pnlFldId, r]));
  const survivors = order ? reordered(inStoredOrder, order.filter((id) => !restoredById.has(id))) : inStoredOrder;
  if (restored.length && (order!.length !== survivors.length + restored.length || restored.some((r) => !order!.includes(r.pnlFldId)))) {
    throw new PageSaveRefusedError('The tab order does not list exactly the controls on the page.');
  }

  // New PNLFLDIDs in request order. An added control goes where App Designer puts one: right after
  // the control before it in reading order (newControlTabIndex). A copy of a control on this page goes
  // right after its source (and its earlier copies) in tab order (c02: group box 9 at 13, its copy at
  // 14); copies from elsewhere go last.
  const fresh: Array<{ pnlFldId: number; control: EditedControl }> = added.map((control, i) => ({ pnlFldId: base + i + 1, control }));
  // A restored control takes its own id and its place in the complete tab order; its type, level and binding are its rows'.
  const back: Array<{ pnlFldId: number; control: EditedControl }> = restored.map((r) => {
    const row = r.restore!.PSPNLFIELD![0];
    return { pnlFldId: r.pnlFldId, control: { ...r, fieldType: Number(row.FIELDTYPE), occursLevel: Number(row.OCCURSLEVEL ?? 0), recName: String(row.RECNAME ?? ''),
      fieldName: String(row.FIELDNAME ?? ''), assocFieldNum: Number(row.ASSOCFIELDNUM ?? 0) } };
  });
  const final: Array<{ survivor: StoredControl } | { fresh: (typeof fresh)[number] }> = restored.length
    ? order!.map((id) => (restoredById.has(id) ? { fresh: back.find((b) => b.pnlFldId === id)! } : { survivor: storedById.get(id)! }))
    : survivors.map((s) => ({ survivor: s }));
  const placedAt = (e: (typeof final)[number]): EditedControl => ('survivor' in e ? edited.get(e.survivor.pnlFldId)! : e.fresh.control);
  const typeOf = (e: (typeof final)[number]): number => ('survivor' in e ? Number(e.survivor.fieldType ?? -1)
    : e.fresh.control.add ? NEW_CONTROL_FIELDTYPE[e.fresh.control.add.kind] : Number(e.fresh.control.fieldType ?? -1));
  const atOrigin = (e: (typeof final)[number]) => { const c = placedAt(e); return c.fieldLeft === 0 && c.fieldTop === 0 && !SCROLL_FIELD_TYPES.has(typeOf(e)); };
  for (const f of fresh) {
    const useRefusal = pageUseRefusal(f.control.add ? NEW_CONTROL_FIELDTYPE[f.control.add.kind] : f.control.fieldType, f.control.fieldUse, f.control.secureInvisible);
    if (useRefusal) throw new PageSaveRefusedError(useRefusal);
    const into = f.control.add?.intoGrid;
    if (into !== undefined) {
      // A column of a grid (gd-column, ts-fresh, ag-fresh): stored at (0, 0) with its size, right after the grid's last
      // column in tab order -- its columns are the (0, 0) controls that follow it (9,602 of HRDMO's 9,661 grids).
      let at = final.findIndex((e) => ('survivor' in e ? e.survivor.pnlFldId : e.fresh.control.pnlFldId) === into);
      if (at < 0 || !GRID_FIELD_TYPES.has(typeOf(final[at]))) throw new PageSaveRefusedError(`Control ${into} is not a grid on the page to add a column to.`);
      while (at + 1 < final.length && atOrigin(final[at + 1])) at++;
      const c = f.control;
      f.control = { ...c, fieldLeft: 0, fieldTop: 0, fieldRight: c.fieldRight ? Math.max(0, c.fieldRight - c.fieldLeft) : 0, fieldBottom: c.fieldBottom ? Math.max(0, c.fieldBottom - c.fieldTop) : 0 };
      final.splice(at + 1, 0, { fresh: f });
      continue;
    }
    if (f.control.add && GRID_ONLY.has(f.control.add.kind)) throw new PageSaveRefusedError(`A ${f.control.add.kind} goes only inside a grid, as one of its columns.`);
    if (f.control.add && SCROLL_FIELD_TYPES.has(NEW_CONTROL_FIELDTYPE[f.control.add.kind])) { final.splice(newScrollTabIndex(final.map(placedAt), f.control), 0, { fresh: f }); continue; }
    if (f.control.add) { final.splice(newControlTabIndex(final.map((e) => ({ ...placedAt(e), scroll: SCROLL_FIELD_TYPES.has(typeOf(e)) })), f.control), 0, { fresh: f }); continue; }
    const src = f.control.copy && f.control.copy.pnlName === pnlName ? f.control.copy.pnlFldId : undefined;
    let at = src === undefined ? -1 : final.findIndex((e) => 'survivor' in e && e.survivor.pnlFldId === src);
    if (at < 0) { final.push({ fresh: f }); continue; }
    while (at + 1 < final.length && 'fresh' in final[at + 1] && (final[at + 1] as { fresh: (typeof fresh)[number] }).fresh.control.copy?.pnlFldId === src) at++;
    final.splice(at + 1, 0, { fresh: f });
  }
  const newFieldNum = new Map(final.map((e, i) => ['survivor' in e ? e.survivor.pnlFldId : e.fresh.pnlFldId, i + 1]));
  const oldNumToId = new Map(stored.map((c) => [c.fieldNum, c.pnlFldId]));
  // A Related Field names its Related Control Field by FIELDNUM - 1 (ASSOCFIELDNUM). App Designer keeps it on that
  // control as deletes, inserts and reorders move it (ps01, ps03, ps04); with the control deleted the field is no
  // longer related: Related Field off, ASSOCFIELDNUM 0 (ps02). The page's checks see the renumbered references.
  const related = new Map<number, { use: number; assoc: number }>();
  for (const s of survivors) {
    const e = edited.get(s.pnlFldId)!;
    if (!(Number(e.fieldUse) & FIELD_USE_RELATED)) continue;
    const target = e.assocTarget ?? oldNumToId.get(Number(e.assocFieldNum ?? s.assocFieldNum ?? 0) + 1);
    const next = target === undefined ? undefined : newFieldNum.get(target);
    related.set(s.pnlFldId, next !== undefined ? { use: Number(e.fieldUse), assoc: next - 1 }
      : target !== undefined && (storedById.has(target) || restoredById.has(target)) ? { use: Number(e.fieldUse) & ~FIELD_USE_RELATED, assoc: 0 }
        : { use: Number(e.fieldUse), assoc: Number(e.assocFieldNum ?? s.assocFieldNum ?? 0) });
  }

  // Scroll levels: assigned again from the tab order on every save, as App Designer does (pageLevels.ts). A scroll keeps
  // its own Occurs Level (an added one 1, lv03), a Set to Level rule its choice; the rest follow.
  const levelInput = final.map((e) => {
    const c = placedAt(e), s = 'survivor' in e ? e.survivor : undefined;
    const fieldType = s ? Number(s.fieldType ?? -1) : c.add ? NEW_CONTROL_FIELDTYPE[c.add.kind] : Number(c.fieldType ?? -1);
    const occursLevel = c.occursLevel ?? s?.occursLevel ?? (c.add ? 1 : 0);
    const recName = c.add ? c.add.recName : c.recName ?? s?.recName ?? '', fieldName = c.add ? c.add.fieldName : c.fieldName ?? s?.fieldName ?? '';
    const a = c.add?.analytic;
    const id = 'survivor' in e ? e.survivor.pnlFldId : e.fresh.pnlFldId;
    return { fieldType, occursLevel: Number(occursLevel), fieldUse: related.get(id)?.use ?? Number(c.fieldUse ?? s?.fieldUse ?? 0), recName, fieldName, label: c.lblText ?? '',
      assocFieldNum: related.get(id)?.assoc ?? Number(c.assocFieldNum ?? s?.assocFieldNum ?? 0), pnlFldId: id,
      ...(a ? { analytic: { model: a.model, collection: a.collection } } : {}) };
  });
  const levels = occursLevels(levelInput);
  const levelOf = new Map(final.map((e, i) => ['survivor' in e ? e.survivor.pnlFldId : e.fresh.pnlFldId, levels[i]]));

  // A grid's GRDCOLUMNCOUNT: the (0, 0) controls right after it. A stored grid whose count follows that rule takes the new
  // count (gd-column, ts-fresh); one that does not (Fluid grids nesting group boxes) is left as stored.
  const columnsAfter = <T,>(list: readonly T[], i: number, origin: (x: T) => boolean) => { let k = 0; while (i + 1 + k < list.length && origin(list[i + 1 + k])) k++; return k; };
  const storedOrder = [...stored].sort((a, b) => a.fieldNum - b.fieldNum);
  const storedAtOrigin = (c: StoredControl) => c.fieldLeft === 0 && c.fieldTop === 0 && !SCROLL_FIELD_TYPES.has(Number(c.fieldType ?? -1));
  const gridCount = new Map<number, number>();
  final.forEach((e, i) => {
    if (!GRID_FIELD_TYPES.has(typeOf(e))) return;
    const count = columnsAfter(final, i, atOrigin);
    if ('fresh' in e) { gridCount.set(e.fresh.pnlFldId, count); return; }
    const s = e.survivor;
    if (Number(s.grdColumnCount ?? 0) === columnsAfter(storedOrder, storedOrder.indexOf(s), storedAtOrigin) && count !== Number(s.grdColumnCount ?? 0)) gridCount.set(s.pnlFldId, count);
  });
  // A Tree's TREECTRLID is its FIELDNUM, re-derived at every save with its PSPNLTREECTRL rows (tr-nodes, sp-fresh, sbp-fresh).
  const treeRekeys: Array<{ from: number; to: number }> = [];
  const treeDeletes = stored.filter((c) => !edited.has(c.pnlFldId) && Number(c.fieldType) === TREE && Number(c.treeCtrlId ?? 0) > 0).map((c) => Number(c.treeCtrlId));

  const updates: PagePlan['updates'] = [];
  const extUpdates: PagePlan['extUpdates'] = [];
  const htmlWrites: PagePlan['htmlWrites'] = [];
  const richTextWrites: PagePlan['richTextWrites'] = [];
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
    const ref = related.get(s.pnlFldId);
    if (ref) {
      for (const [col, value, was] of [['FIELDUSE', ref.use, Number(s.fieldUse)], ['ASSOCFIELDNUM', ref.assoc, Number(s.assocFieldNum ?? 0)]] as const) {
        if (value !== was) columns[col] = value; else delete columns[col];
      }
    }
    // A Group Box Header Extension names its group box by FIELDNUM - 1 too (PTGBRELACTFLD, gb26/gb27). Its renumbering is
    // not captured, so a save that would move the named control is refused rather than left pointing elsewhere.
    const headerTarget = oldNumToId.get(Number(e.headerActionItems ?? s.headerActionItems ?? 0) + 1);
    if (Number(e.headerActionItems ?? s.headerActionItems ?? 0) > 0 && headerTarget !== undefined
      && newFieldNum.get(headerTarget) !== storedById.get(headerTarget)!.fieldNum) {
      throw new PageSaveRefusedError(`Control ${s.pnlFldId}'s Group Box Header Extension names a control this save moves in tab order; that renumbering is not supported.`);
    }
    // PSPNLFIELDEXT: the Fluid tab's classes and FIELDUSETEMP2 bits; a frame's dialog (fr01), or a Static Text's on a
    // Fluid page (st11), writes a blank FFSTYLELONG in five slots.
    const ext: Record<string, number | string> = {};
    if (e.fluidClasses !== undefined && fluidClassSlots(fluidClassText(e.fluidClasses)).join('|') !== fluidClassSlots(s.ffStyleLong).join('|')) {
      for (const slot of e.fluidClasses) if (slot.trim().length > 100) throw new PageSaveRefusedError('A style class entry holds up to 100 characters.');
      ext.FFSTYLELONG = fluidClassText(e.fluidClasses);
    }
    if (e.fieldUseTemp2 !== undefined && Number(e.fieldUseTemp2) !== Number(s.fieldUseTemp2 ?? 0)) ext.FIELDUSETEMP2 = Number(e.fieldUseTemp2);
    for (const { col, of, key } of EXT_EDITABLE) if (e[key] !== undefined && of(e) !== of(s)) ext[col] = of(e);
    // An HTML Area's Constant (PSPNLHTMLAREA); its dialog's OK also writes an explicit Left (ha01: DSPLFORMAT 0x2001 -> 0x82001).
    const htmlChanged = e.htmlConstant !== undefined && (e.htmlConstant ?? null) !== (s.htmlConstant ?? null);
    if (htmlChanged) htmlWrites.push({ pnlFldId: s.pnlFldId, html: e.htmlConstant ?? null });
    if (e.richText !== undefined && richTextKey(e.richText) !== richTextKey(s.richText)) richTextWrites.push({ pnlFldId: s.pnlFldId, richText: e.richText ?? null });
    if (s.fieldType === HTML_AREA && (htmlChanged || [...Object.keys(columns), ...Object.keys(ext)].some((c) => !GROUP_BOX_GEOMETRY.has(c)))) {
      const dspl = Number(columns.DSPLFORMAT ?? s.dsplFormat ?? 0);
      if ((dspl & GROUP_BOX_ALIGN_MASK) === 0) columns.DSPLFORMAT = dspl | GROUP_BOX_ALIGN.left;
      if (fluidPage && !ext.FFSTYLELONG && !String(s.ffStyleLong ?? '').trim()) ext.FFSTYLELONG = FFSTYLELONG_EMPTY;
    }
    if (s.fieldType === GROUP_BOX && [...Object.keys(columns), ...Object.keys(ext)].some((c) => !GROUP_BOX_GEOMETRY.has(c))) {
      const dspl = Number(columns.DSPLFORMAT ?? s.dsplFormat ?? 0);
      if ((dspl & GROUP_BOX_ALIGN_MASK) === 0) columns.DSPLFORMAT = dspl | GROUP_BOX_ALIGN.left;
      const tmp = Number(columns.FIELDUSETMP ?? s.fieldUseTmp ?? 0);
      if ((tmp & GROUP_BOX_DIALOG_USETMP) !== GROUP_BOX_DIALOG_USETMP) columns.FIELDUSETMP = tmp | GROUP_BOX_DIALOG_USETMP;
      if (!ext.FFSTYLELONG && !String(s.ffStyleLong ?? '').trim()) ext.FFSTYLELONG = FFSTYLELONG_EMPTY;
      if (fluidPage) {
        for (const [col, key] of [['PTGBRELTXTINFO', 'headerTextInfo'], ['PTGBRELACTINFO', 'headerActionInfo'], ['PTGBRELACTFLD', 'headerActionItems']] as const) {
          if (ext[col] === undefined && Number(s[key] ?? 0) === 0) ext[col] = -1;
        }
      }
    }
    if ((s.fieldType === FRAME || s.fieldType === HORIZONTAL_RULE || ((s.fieldType === STATIC_TEXT || s.fieldType === EDIT_BOX || s.fieldType === HTML_AREA) && fluidPage)) && !ext.FFSTYLELONG && !String(s.ffStyleLong ?? '').trim()
      && [...Object.keys(columns), ...Object.keys(ext)].some((c) => DIALOG_COLUMNS.has(c))) ext.FFSTYLELONG = FFSTYLELONG_EMPTY;
    if (Object.keys(ext).length) extUpdates.push({ pnlFldId: s.pnlFldId, columns: ext });
    // A Scroll Bar's dialog OK (lv04) also writes an explicit Left (DSPLFORMAT 0x80000) and five blank Fluid slots, on any page.
    const level = levelOf.get(s.pnlFldId)!;
    if (level !== Number(s.occursLevel ?? 0)) columns.OCCURSLEVEL = level;
    if (s.fieldType === SCROLL_BAR && e.occursLevel !== undefined && Number(e.occursLevel) !== Number(s.occursLevel ?? 0)) {
      const dspl = Number(columns.DSPLFORMAT ?? s.dsplFormat ?? 0);
      if ((dspl & GROUP_BOX_ALIGN_MASK) === 0) columns.DSPLFORMAT = dspl | GROUP_BOX_ALIGN.left;
      if (!ext.FFSTYLELONG && !String(s.ffStyleLong ?? '').trim()) { ext.FFSTYLELONG = FFSTYLELONG_EMPTY; if (!extUpdates.some((u) => u.pnlFldId === s.pnlFldId)) extUpdates.push({ pnlFldId: s.pnlFldId, columns: ext }); }
    }
    const num = newFieldNum.get(s.pnlFldId)!;
    if (num !== s.fieldNum) columns.FIELDNUM = num;
    if (gridCount.has(s.pnlFldId)) columns.GRDCOLUMNCOUNT = gridCount.get(s.pnlFldId)!;
    if (Number(s.fieldType) === TREE && Number(s.treeCtrlId ?? 0) > 0 && Number(s.treeCtrlId) !== num) {
      columns.TREECTRLID = num;
      treeRekeys.push({ from: Number(s.treeCtrlId), to: num });
    }
    if (Object.keys(columns).length > 0) updates.push({ pnlFldId: s.pnlFldId, columns });
  }

  const finalIds = [...newFieldNum.keys()];
  const inserts = [...back, ...fresh].map((f) => ({ pnlFldId: f.pnlFldId, fieldNum: newFieldNum.get(f.pnlFldId)!,
    control: { ...f.control, occursLevel: levelOf.get(f.pnlFldId)!, ...(gridCount.has(f.pnlFldId) ? { grdColumnCount: gridCount.get(f.pnlFldId)! } : {}) } }));
  return { deletes, updates, extUpdates, inserts, htmlWrites, richTextWrites, fieldCount: controls.length + added.length + restored.length, maxPnlFldId: planHighWater(base + added.length, finalIds, highWater), naturalMaxPnlFldId: planHighWater(base + added.length, finalIds),
    checked: levelInput, treeRekeys, treeDeletes };
}

/** PSPNLDEFN.MAXPNLFLDID after a save: the high-water mark, or a reviewed restoration's own value, never below a remaining control's id. */
function planHighWater(natural: number, ids: readonly number[], explicit?: number): number {
  const top = Math.max(natural, ...ids, 0);
  if (explicit === undefined) return top;
  if (!Number.isSafeInteger(explicit) || explicit < Math.max(...ids, 0)) throw new PageSaveRefusedError('MAXPNLFLDID cannot be below a remaining control\'s id.');
  return explicit;
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

/** App Designer's scroll checks on a page (pageLevels.ts), its records' types read from PSRECDEFN: PageInvalidError when any fails. */
async function refuseInvalidPage(c: Connection, pnlName: string, checked: ReadonlyArray<Omit<CheckedControl, 'recType'>>): Promise<void> {
  const recs = [...new Set(checked.map((x) => x.recName.trim()).filter(Boolean))];
  const recType = new Map<string, number>();
  for (let i = 0; i < recs.length; i += 500) {
    const batch = recs.slice(i, i + 500);
    const rows = await select<{ R: string; T: number }>(c, `SELECT RECNAME AS R, RECTYPE AS T FROM PSRECDEFN WHERE RECNAME IN (${batch.map((_, j) => `:r${j}`).join(', ')})`,
      Object.fromEntries(batch.map((r, j) => [`r${j}`, r])));
    for (const r of rows) recType.set(String(r.R).trim(), Number(r.T));
  }
  const problems = checkPageScrolls(pnlName, checked.map((x) => ({ ...x, recType: recType.get(x.recName.trim()) ?? -1 })));
  problems.push(...await analyticGridProblems(c, pnlName, checked));
  if (problems.length) throw new PageInvalidError(problems);
}

/**
 * 15,89: an Analytic Grid holds every field of its cube collection (PSACECUBECOLMAP) among the fields after it in its scroll
 * (ag-fresh: "Field .PTACEGRIDFLD02 is a required field for the analytic grid PTACEVWRGRDREC"). A stored grid's model is read
 * from PSPNLACEGRDDATA; an added one's is the one it is added with.
 */
async function analyticGridProblems(c: Connection, pnlName: string, checked: ReadonlyArray<Omit<CheckedControl, 'recType'>>): Promise<PageProblem[]> {
  const out: PageProblem[] = [];
  const levels = occursLevels(checked);
  for (const [i, g] of checked.entries()) {
    if (g.fieldType !== 32) continue;
    let model = g.analytic?.model ?? '', collection = g.analytic?.collection ?? '';
    if (!model && g.pnlFldId !== undefined && g.pnlFldId > 0) {
      const [d] = await select<{ M: string; C: string }>(c, `SELECT ACEMODELID AS M, ACECOLLNAME AS C FROM PSPNLACEGRDDATA WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id: g.pnlFldId });
      model = String(d?.M ?? '').trim(); collection = String(d?.C ?? '').trim();
    }
    if (!model) continue;
    if (!collection) collection = String((await select<{ C: string }>(c, `SELECT MIN(ACECOLLNAME) AS C FROM PSACECUBECOLL WHERE ACEMODELID = :m`, { m: model }))[0]?.C ?? '').trim();
    const present = new Set<string>();
    for (let j = i + 1; j < checked.length && !SCROLL_FIELD_TYPES.has(checked[j].fieldType) && levels[j] >= levels[i]; j++) {
      if (levels[j] === levels[i] && checked[j].fieldName.trim()) present.add(checked[j].fieldName.trim());
    }
    for (const f of await analyticRequiredFields(c, model, collection)) {
      if (!present.has(f)) out.push({ set: 15, num: 89, text: `Field .${f} is a required field for the analytic grid ${g.recName.trim()}`, at: i });
    }
  }
  return out;
}

/** PSVERSION / PSLOCK 'PDM' and PSVERSION 'SYS', locked for the save. */
export async function counters(c: Connection, forUpdate: boolean): Promise<{ pdm: number; sys: number; lockPdm: number }> {
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

export async function savePage(c: Connection, request: PageSaveRequest, types?: DbTypes): Promise<PageSaveResult> {
  const { pnlName, operatorId } = request;
  const scope = writeScopeRefusal(pnlName);
  if (scope) throw new PageSaveRefusedError(scope);
  const opError = validateOperatorId(operatorId);
  if (opError) throw new PageSaveRefusedError(opError);
  if (request.captureSnapshots && (!request.dryRun || !types)) throw new PageSaveRefusedError('Page snapshots require a rollback preview and connected driver types.');
  if (request.expectedSnapshotToken && !types) throw new PageSaveRefusedError('Page snapshot guard requires connected driver types.');

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
    const before = request.captureSnapshots || request.expectedSnapshotToken ? await readPageSnapshot(c, types!, pnlName) : undefined;
    if (request.expectedSnapshotToken && before?.token !== request.expectedSnapshotToken) throw new PageSaveRefusedError('Native Page snapshot changed before the writer; restage and review.');

    // Named one by one against this release's tables: a column a later PeopleTools added reads as NULL (tableColumns.ts).
    const fieldCols = await tableColumns(c, 'PSPNLFIELD');
    const extCols = await tableColumns(c, 'PSPNLFIELDEXT');
    const storedRows = await select<Record<string, number | string>>(c,
      `SELECT ${[
        ...STORED_FIELD_COLUMNS.map((col) => columnOrNull(fieldCols, 'F', col)),
        ...STORED_EXT_COLUMNS.map((col) => columnOrNull(extCols, 'E', col)),
        columnOrNull(extCols, 'E', 'FFSTYLELONG', 'FFSTYLELONG', (x) => `DBMS_LOB.SUBSTR(${x}, 4000, 1)`)
      ].join(', ')}
         FROM PSPNLFIELD F LEFT JOIN PSPNLFIELDEXT E ON E.PNLNAME = F.PNLNAME AND E.PNLFLDID = F.PNLFLDID WHERE F.PNLNAME = :n`, { n: pnlName });
    // HTML Areas' Constant values (PSPNLHTMLAREA, a CLOB read as text).
    const htmlRows = await select<{ PNLFLDID: number; HTMLAREA: string | null }>(c, `SELECT PNLFLDID, HTMLAREA FROM PSPNLHTMLAREA WHERE PNLNAME = :n`, { n: pnlName });
    const htmlOf = new Map(htmlRows.map((r) => [Number(r.PNLFLDID), String(r.HTMLAREA ?? '')]));
    // Long Edit Boxes' Rich Text options (PSPTPNLRTEDITOR).
    const rteRows = await select<Record<string, string | number>>(c,
      `SELECT PNLFLDID, PTRTECFGSETTINGSID, PTRTEIMGLOCURLID, PTRTEPLUGIN, PTRTETEMPLATE, PTRTESTYLE FROM PSPTPNLRTEDITOR WHERE PNLNAME = :n`, { n: pnlName });
    const rteOf = new Map(rteRows.map((r) => [Number(r.PNLFLDID), { configSettingsId: String(r.PTRTECFGSETTINGSID ?? ''), imageLocationUrlId: String(r.PTRTEIMGLOCURLID ?? ''),
      pluginFileId: String(r.PTRTEPLUGIN ?? ''), templateFileId: String(r.PTRTETEMPLATE ?? ''), styleFileId: String(r.PTRTESTYLE ?? '') }]));
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
      htmlConstant: htmlOf.get(Number(r.PNLFLDID)) ?? null, richText: rteOf.get(Number(r.PNLFLDID)) ?? null,
      labelSizeType: Number(r.LABELSIZETYPE ?? 0), expandField: Number(r.PTLEBEXPANDFIELD ?? 0), placeholderType: Number(r.PLHTYPE ?? 0),
      placeholder: String(r.PLACEHOLDER ?? ''), placeholderMsgSet: Number(r.PLH_MSG_SET_NBR ?? 0), placeholderMsgNum: Number(r.PLH_MSG_NBR ?? 0),
      occursLevel: Number(r.OCCURSLEVEL ?? 0), popupMenu: String(r.POPUPMENU ?? ''), assocFieldNum: Number(r.ASSOCFIELDNUM ?? 0),
      labelStyle: String(r.LABELSTYLE ?? ''), labelId: String(r.LABEL_ID ?? ''), useDefaultLabel: Number(r.USEDEFAULTLABEL ?? 0),
      hideFields: Number(r.PTHIDEFIELDS ?? 0), collapseDataArea: Number(r.PTCOLLAPSEDATAAREA ?? 0), defaultExpanded: Number(r.PTDFLTVIEWEXPANDED ?? 0),
      imageCollapsed: String(r.PTLBLIMGCOLLAPSE ?? ''), imageExpanded: String(r.PTLBLIMGEXPAND ?? ''),
      popupMsgSet: Number(r.MESSAGE_SET_NBR ?? 0), popupMsgNum: Number(r.MESSAGE_NBR ?? 0), groupBoxType: Number(r.GRPBOXTYPE ?? 0),
      groupBoxHtmlType: Number(r.GRPBOXHTMLTYPE ?? 0), scrollBars: Number(r.SCROLLBARS ?? 0),
      headerTextInfo: Number(r.PTGBRELTXTINFO ?? 0), headerActionInfo: Number(r.PTGBRELACTINFO ?? 0), headerActionItems: Number(r.PTGBRELACTFLD ?? 0),
      dsplFill: String(r.DSPLFILL ?? ''), formatFamily: String(r.FORMATFAMILY ?? ''), displayFormatName: String(r.DISPFMTNAME ?? ''),
      popupPage: String(r.PTPOPUPPNL ?? ''), inputType: Number(r.HTML_INPUT_TYPE ?? 0), minNumber: String(r.MINNUMBER ?? ''),
      maxNumber: String(r.MAXNUMBER ?? ''), stepNumber: String(r.STEPNUMBER ?? ''), disableSmartPrompt: Number(r.PTDISABLESMARTPROM ?? 0), setLevel: Number(r.PT_NUMFLD1 ?? 0),
      ffStyleLong: r.FFSTYLELONG === null || r.FFSTYLELONG === undefined ? null : String(r.FFSTYLELONG),
      treeCtrlId: Number(r.TREECTRLID ?? 0), grdColumnCount: Number(r.GRDCOLUMNCOUNT ?? 0)
    }));

    // An added Subpage takes its subpage's rectangle wherever it was dropped (sbp-fresh, sb-subst), before its tab place is found.
    request = { ...request, controls: await Promise.all(request.controls.map((ctl) => placeSubpage(c, ctl))) };

    const fluidPage = request.properties?.fluidPage ?? (Number(defn.PNLUSE) & PAGE_USE_FLUID) !== 0;
    const plan = planPageSave(stored, request.controls, Number(defn.MAXPNLFLDID), request.order, pnlName, fluidPage, request.maxPnlFldId);
    const reviewed = !!(request.expectedSnapshotToken || request.captureSnapshots);
    if ((request.controls.some((x) => x.restore) || plan.maxPnlFldId !== plan.naturalMaxPnlFldId) && !reviewed) {
      throw new PageSaveRefusedError('Restoring controls or MAXPNLFLDID is only done by a reviewed snapshot-guarded save.');
    }
    // A released id (an undone added control) must not stay named elsewhere before a later add takes it again; nor may a
    // reviewed delete leave translations or configuration naming the control behind (Change Review cannot checkpoint them).
    const released = plan.maxPnlFldId < Number(defn.MAXPNLFLDID)
      ? Array.from({ length: Number(defn.MAXPNLFLDID) - plan.maxPnlFldId }, (_, i) => plan.maxPnlFldId + i + 1) : [];
    if (reviewed && (plan.deletes.length || released.length)) {
      const refs = await controlReferences(c, pnlName, [...plan.deletes, ...released]);
      if (refs.length) throw new PageSaveRefusedError(`Other definitions or translations name these controls (${refs.join(', ')}); a reviewed delete or undo cannot leave them behind.`);
    }
    // A page made secondary takes its topmost control's top as PANELTOP (u08: 20).
    const tops = request.controls.map((x) => x.fieldTop);
    const props = planPageProperties(defn, request.properties, { minTop: tops.length ? Math.min(...tops) : 0, extent: controlsExtent(request.controls) });
    if (request.properties && request.properties.description.trim().length > 30) {
      throw new PageSaveRefusedError('The page description is limited to 30 characters (PSPNLDEFN.DESCR).');
    }
    await checkPropertyNames(c, props);
    // A control's new Style must be a style class (App Designer's Style list).
    for (const u of plan.updates) {
      for (const style of [u.columns.FIELDSTYLE, u.columns.LABELSTYLE]) {
        if (typeof style !== 'string' || style === ' ') continue;
        const [{ N: n }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSSTYLECLASS WHERE STYLECLASSNAME = :v`, { v: style });
        if (!Number(n)) throw new PageSaveRefusedError(`${style} is not a style class in this database.`);
      }
      // A Group Box's collapsed / expanded label images are image definitions (App Designer's Select Image list).
      for (const image of [u.columns.PTLBLIMGCOLLAPSE, u.columns.PTLBLIMGEXPAND]) {
        if (typeof image !== 'string' || image === ' ') continue;
        const [{ N: n }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSCONTDEFN WHERE CONTNAME = :v AND CONTTYPE = 1`, { v: image });
        if (!Number(n)) throw new PageSaveRefusedError(`${image} is not an image in this database.`);
      }
      // A control's Popup Menu is a popup menu definition (MENUTYPE 1), as App Designer's list offers.
      const popup = u.columns.POPUPMENU;
      if (typeof popup === 'string' && popup !== ' ') {
        const [{ N: n }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSMENUDEFN WHERE MENUNAME = :v AND MENUTYPE = 1`, { v: popup });
        if (!Number(n)) throw new PageSaveRefusedError(`${popup} is not a popup menu in this database.`);
      }
      // A Label ID is one of the bound field's labels (PSDBFLDLABL).
      const labelId = u.columns.LABEL_ID;
      if (typeof labelId === 'string' && labelId !== ' ') {
        const ec = request.controls.find((x) => x.pnlFldId === u.pnlFldId);
        const field = nameValue(ec?.fieldName ?? stored.find((x) => x.pnlFldId === u.pnlFldId)?.fieldName);
        const [{ N: n }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSDBFLDLABL WHERE FIELDNAME = :f AND LABEL_ID = :l`, { f: field, l: labelId });
        if (!Number(n)) throw new PageSaveRefusedError(`${labelId} is not a label of field ${field}.`);
      }
    }
    // A rebound control's Record Name / Field Name must be a real record field (App Designer only lists fields on the record).
    for (const u of plan.updates) {
      if (!('RECNAME' in u.columns) && !('FIELDNAME' in u.columns)) continue;
      const ec = request.controls.find((x) => x.pnlFldId === u.pnlFldId);
      const rec = nameValue(ec?.recName), fld = nameValue(ec?.fieldName);
      if (rec === ' ') continue; // clearing the binding (an unbound control) is allowed
      // An HTML Area may sit on a record alone (ha10): the record must exist.
      if (fld === ' ' && stored.find((x) => x.pnlFldId === u.pnlFldId)?.fieldType === HTML_AREA) {
        const [{ N: r }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSRECDEFN WHERE RECNAME = :r`, { r: rec });
        if (!Number(r)) throw new PageSaveRefusedError(`${rec} is not a record in this database.`);
        continue;
      }
      const [{ N: n }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSRECFIELDDB WHERE RECNAME = :r AND FIELDNAME = :f`, { r: rec, f: fld });
      if (!Number(n)) throw new PageSaveRefusedError(`${rec}.${fld} is not a field on record ${rec}.`);
    }
    // App Designer's scroll checks (Message Set 15), unless the caller already answered "save anyway".
    if (!request.saveInvalid) await refuseInvalidPage(c, pnlName, plan.checked);
    if (plan.deletes.length === 0 && plan.updates.length === 0 && plan.inserts.length === 0 && plan.htmlWrites.length === 0 && plan.richTextWrites.length === 0 && plan.extUpdates.length === 0
      && Object.keys(props).length === 0) {
      // Nothing changed: leave the page, its version and the counters untouched.
      const snapshots: PagePreviewSnapshots | undefined = before && request.captureSnapshots ? { schema: 'page-preview/1', before, after: await readPageSnapshot(c, types!, pnlName) } : undefined;
      if (request.dryRun) await c.rollback();
      return { version: request.openedVersion, fieldCount: plan.fieldCount, updated: 0, deleted: 0, inserted: 0, ...(snapshots ? { snapshots } : {}) };
    }

    // Each added control's rows, built before anything is written so a refused field stops the save clean.
    const insertRows: ControlRows[] = [];
    for (const ins of plan.inserts) insertRows.push(await insertedControlRows(c, pnlName, ins));
    const next = await counters(c, true);

    const [{ TS: ts }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);

    for (const id of plan.deletes) {
      await expectRows(c, `DELETE FROM PSPNLFIELD WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id }, 1, `Deleting PSPNLFIELD ${id}`);
      // PSPNLFIELDEXT has one row per control, but a very old page may lack it.
      await c.execute(`DELETE FROM PSPNLFIELDEXT WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id });
      // A Constant HTML Area's text (and its translations) goes with it.
      await c.execute(`DELETE FROM PSPNLHTMLAREA WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id });
      await c.execute(`DELETE FROM PSPNLHTMLLANG WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id });
      await c.execute(`DELETE FROM PSPTPNLRTEDITOR WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id });
      // A grid's or scroll area's settings and buttons.
      await c.execute(`DELETE FROM PSPNLCNTRLDATA WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id });
      await c.execute(`DELETE FROM PSPNLBTNDATA WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id });
      // An Analytic Grid's model and axes.
      await c.execute(`DELETE FROM PSPNLACEGRDDATA WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id });
      await c.execute(`DELETE FROM PSPNLACEGRDAXIS WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id });
    }
    // A deleted Tree's levels; a Tree whose FIELDNUM moved takes its levels with it (two steps, as ids may swap).
    for (const t of plan.treeDeletes) await c.execute(`DELETE FROM PSPNLTREECTRL WHERE PNLNAME = :n AND TREECTRLID = :t`, { n: pnlName, t });
    for (const r of plan.treeRekeys) await c.execute(`UPDATE PSPNLTREECTRL SET TREECTRLID = :nt WHERE PNLNAME = :n AND TREECTRLID = :t`, { n: pnlName, t: r.from, nt: -r.to });
    for (const r of plan.treeRekeys) await c.execute(`UPDATE PSPNLTREECTRL SET TREECTRLID = :nt WHERE PNLNAME = :n AND TREECTRLID = :t`, { n: pnlName, t: -r.to, nt: r.to });

    for (const u of plan.updates) {
      const { row: present, dropped } = presentOnly(u.columns, fieldCols);
      refuseMissingSettings(dropped, u.columns, 'PSPNLFIELD');
      u.columns = present as typeof u.columns;
      if (!Object.keys(u.columns).length) continue;
      const binds: Record<string, unknown> = { n: pnlName, id: u.pnlFldId };
      const sets = Object.entries(u.columns).map(([col, value], i) => {
        if (col === 'LBLTEXT') return `${col} = ${quoteText(String(value))}`;
        binds[`v${i}`] = value;
        return `${col} = :v${i}`;
      });
      await expectRows(c, `UPDATE PSPNLFIELD SET ${sets.join(', ')} WHERE PNLNAME = :n AND PNLFLDID = :id`, binds, 1, `Updating PSPNLFIELD ${u.pnlFldId}`);
    }

    for (const u of plan.extUpdates) {
      const { row: present, dropped } = presentOnly(u.columns, extCols);
      refuseMissingSettings(dropped, u.columns, 'PSPNLFIELDEXT');
      u.columns = present as typeof u.columns;
      const cols = Object.keys(u.columns);
      if (!cols.length) continue;
      await expectRows(c, `UPDATE PSPNLFIELDEXT SET ${cols.map((col, i) => `${col} = :v${i}`).join(', ')} WHERE PNLNAME = :n AND PNLFLDID = :id`,
        { ...Object.fromEntries(cols.map((col, i) => [`v${i}`, u.columns[col]])), n: pnlName, id: u.pnlFldId }, 1, `Updating PSPNLFIELDEXT ${u.pnlFldId}`);
    }

    // An HTML Area's Constant: inserted when it becomes Constant (ha03), its text replaced (ha04), deleted for a Field value (ha05).
    for (const w of plan.htmlWrites) {
      await c.execute(`DELETE FROM PSPNLHTMLAREA WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id: w.pnlFldId });
      if (w.html !== null) await expectRows(c, `INSERT INTO PSPNLHTMLAREA (PNLNAME, PNLFLDID, HTMLAREA) VALUES (:n, :id, :h)`,
        { n: pnlName, id: w.pnlFldId, h: w.html }, 1, `Inserting PSPNLHTMLAREA ${w.pnlFldId}`);
    }

    // A Long Edit Box's Rich Text: its PSPTPNLRTEDITOR row inserted (le01), replaced, or deleted with Rich Text off (le03).
    for (const w of plan.richTextWrites) {
      await c.execute(`DELETE FROM PSPTPNLRTEDITOR WHERE PNLNAME = :n AND PNLFLDID = :id`, { n: pnlName, id: w.pnlFldId });
      if (w.richText) await insertRichText(c, pnlName, w.pnlFldId, w.richText);
    }

    for (const rows of insertRows) await insertControl(c, pnlName, rows);

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
    if (before && request.captureSnapshots) result.snapshots = { schema: 'page-preview/1', before, after: await readPageSnapshot(c, types!, pnlName) };
    if (request.dryRun) await c.rollback();
    else await c.commit();
    return result;
  } catch (err) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw err;
  }
}

/**
 * A control's rows: PSPNLFIELD and PSPNLFIELDEXT, and what goes with some kinds -- a Constant HTML Area's text
 * (PSPNLHTMLAREA), a Rich Text long edit's options (PSPTPNLRTEDITOR), a grid's or scroll area's settings and buttons
 * (PSPNLCNTRLDATA, PSPNLBTNDATA).
 */
interface ControlRows extends Partial<NewControlDataRows> { field: ColumnValues; ext: ColumnValues; html?: string; richText?: RichTextOptions; extra?: Array<{ table: string; row: ColumnValues }> }

/**
 * The definitions and translations naming a page's controls by PNLFLDID outside the Page writer's tables (language rows,
 * ActiveX/related-action widgets, analytic grid links, embedded help and application configurators), present on this database.
 */
export const CONTROL_REFERENCES: ReadonlyArray<readonly [string, string]> = [
  ['PSPNLFIELDLANG', 'PNLFLDID'], ['PSPNLBTNLANG', 'PNLFLDID'], ['PSPNLCTLDATALNG', 'PNLFLDID'], ['PSPNLACTIVEX', 'PNLFLDID'],
  ['PSPTPNLRAWIDGET', 'PNLFLDID'], ['PSPTPNLRAWIDGET', 'PTASSOCPNLFLDID'], ['PSPNLACEGRDDATA', 'PROBINSTPNLFLDID'],
  ['PS_EOCC_CONFIG_CRT', 'PNLFLDID'], ['PS_EOCC_CRT_MAP', 'PNLFLDID'], ['PS_EOEC_EMB_HELP', 'PNLFLDID'], ['PS_EOEC_EMBHLP_EXC', 'PNLFLDID'],
  ['PS_GVT_TS_FIELDS', 'PNLFLDID'], ['PS_HRTS_CONFIG_CRT', 'PNLFLDID'], ['PS_HRTS_CONFIG_FLD', 'PNLFLDID']
];
export async function controlReferences(c: Connection, pnlName: string, ids: readonly number[]): Promise<string[]> {
  if (!ids.length) return [];
  const found: string[] = [];
  for (const [table, col] of CONTROL_REFERENCES) {
    const have = await tableColumns(c, table);
    if (!have.has(col) || !have.has('PNLNAME')) continue;
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500), binds = Object.fromEntries(batch.map((id, j) => [`i${j}`, id]));
      const [{ N: n }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM ${table} WHERE PNLNAME = :n AND ${col} IN (${batch.map((_, j) => `:i${j}`).join(', ')})`, { n: pnlName, ...binds });
      if (Number(n)) { found.push(`${table}.${col}`); break; }
    }
  }
  return found;
}

async function insertControl(c: Connection, pnlName: string, rows: ControlRows): Promise<void> {
  const id = Number(rows.field.PNLFLDID);
  await insertRow(c, 'PSPNLFIELD', rows.field);
  await insertRow(c, 'PSPNLFIELDEXT', rows.ext);
  if (rows.richText) await insertRichText(c, pnlName, id, rows.richText);
  // A pasted Constant HTML Area takes its source's text.
  if (rows.html !== undefined) await expectRows(c, `INSERT INTO PSPNLHTMLAREA (PNLNAME, PNLFLDID, HTMLAREA) VALUES (:n, :id, :h)`,
    { n: pnlName, id, h: rows.html }, 1, `Inserting PSPNLHTMLAREA ${id}`);
  if (rows.controlData) await insertRow(c, 'PSPNLCNTRLDATA', rows.controlData);
  for (const b of rows.buttons ?? []) await insertRow(c, 'PSPNLBTNDATA', b);
  if (rows.aceData) await insertRow(c, 'PSPNLACEGRDDATA', rows.aceData);
  for (const a of rows.aceAxes ?? []) await insertRow(c, 'PSPNLACEGRDAXIS', a);
  for (const t of rows.treeNodes ?? []) await insertRow(c, 'PSPNLTREECTRL', t);
  for (const x of rows.extra ?? []) await insertRow(c, x.table, x.row);
}

/** An added Subpage at its subpage's own rectangle (PSPNLDEFN PANELLEFT..BOTTOM): App Designer places it there (sbp-fresh, sb-subst). */
async function placeSubpage(c: Connection, ctl: EditedControl): Promise<EditedControl> {
  if (ctl.add?.kind !== 'subpage') return ctl;
  const target = (ctl.add.subPage ?? '').trim().toUpperCase();
  const [d] = await select<Record<string, number>>(c, `SELECT PNLTYPE, PANELLEFT, PANELTOP, PANELRIGHT, PANELBOTTOM FROM PSPNLDEFN WHERE PNLNAME = :p`, { p: target });
  if (!target || !d) throw new PageSaveRefusedError(target ? `${target} is not a page in this database.` : 'A new Subpage needs its subpage.');
  if (Number(d.PNLTYPE) !== 1) throw new PageSaveRefusedError(`${target} is not a subpage (its page type is ${d.PNLTYPE}).`);
  return { ...ctl, add: { ...ctl.add, subPage: target }, fieldLeft: Number(d.PANELLEFT), fieldTop: Number(d.PANELTOP), fieldRight: Number(d.PANELRIGHT), fieldBottom: Number(d.PANELBOTTOM) };
}

/**
 * An Analytic Grid's model as App Designer's dialog fills it (ag-fresh): its cube collection (the model's first when not
 * named), the collection's record, and every dimension of the collection (PSACECUBECOLMAP ACEISCUBE N) on the Row Axis.
 */
async function resolveAnalytic(c: Connection, add: NewControl): Promise<NewControl> {
  const a = add.analytic;
  const model = (a?.model ?? '').trim().toUpperCase();
  if (!model) throw new PageSaveRefusedError('A new Analytic Grid needs its analytic model.');
  const colls = await select<{ C: string; R: string }>(c, `SELECT ACECOLLNAME AS C, RECORDNAME AS R FROM PSACECUBECOLL WHERE ACEMODELID = :m ORDER BY ACECOLLNAME`, { m: model });
  if (!colls.length) throw new PageSaveRefusedError(`${model} is not an analytic model with a cube collection in this database.`);
  const wanted = (a?.collection ?? '').trim().toUpperCase();
  const coll = wanted ? colls.find((x) => String(x.C).trim() === wanted) : colls[0];
  if (!coll) throw new PageSaveRefusedError(`${model} has no cube collection ${wanted} (${colls.map((x) => String(x.C).trim()).join(', ')}).`);
  const record = String(coll.R).trim();
  if (add.recName.trim() && add.recName.trim().toUpperCase() !== record) throw new PageSaveRefusedError(`Cube collection ${String(coll.C).trim()}'s record is ${record}, not ${add.recName.trim()}.`);
  const dims = await select<{ F: string }>(c, `SELECT FIELDNAME AS F FROM PSACECUBECOLMAP WHERE ACEMODELID = :m AND ACECOLLNAME = :c AND ACEISCUBE = 'N' ORDER BY FIELDNAME`,
    { m: model, c: coll.C });
  const axes = a?.axes ?? dims.map((d) => ({ fieldName: String(d.F).trim(), axis: 2 }));
  return { ...add, recName: record, analytic: { ...a, model, collection: String(coll.C).trim(), axes } };
}

/** The fields an Analytic Grid must hold, App Designer's 15,89 check ("Field X is a required field for the analytic grid"). */
export async function analyticRequiredFields(c: Connection, model: string, collection: string): Promise<string[]> {
  return (await select<{ F: string }>(c, `SELECT DISTINCT FIELDNAME AS F FROM PSACECUBECOLMAP WHERE ACEMODELID = :m AND ACECOLLNAME = :c ORDER BY FIELDNAME`,
    { m: model, c: collection })).map((r) => String(r.F).trim());
}

/** A stored grid's or scroll area's PSPNLCNTRLDATA and PSPNLBTNDATA rows, moved to another page / id. */
async function controlDataRows(c: Connection, from: { pnlName: string; pnlFldId: number }, to: { pnlName: string; pnlFldId: number }):
  Promise<{ controlData?: ColumnValues; buttons: ColumnValues[] }> {
  const [controlData] = await select<ColumnValues>(c, `SELECT * FROM PSPNLCNTRLDATA WHERE PNLNAME = :p AND PNLFLDID = :id`, { p: from.pnlName, id: from.pnlFldId });
  const buttons = await select<ColumnValues>(c, `SELECT * FROM PSPNLBTNDATA WHERE PNLNAME = :p AND PNLFLDID = :id ORDER BY PTBTNCLASSTYPE`, { p: from.pnlName, id: from.pnlFldId });
  const moved = (r: ColumnValues) => ({ ...r, PNLNAME: to.pnlName, PNLFLDID: to.pnlFldId });
  return { ...(controlData ? { controlData: moved(controlData) } : {}), buttons: buttons.map(moved) };
}

/** An added control's rows (App Designer's fresh row) or a pasted one's (a copy of its source's stored rows). */
async function insertedControlRows(c: Connection, pnlName: string, ins: { pnlFldId: number; fieldNum: number; control: EditedControl }):
  Promise<ControlRows> {
  const { add, copy } = ins.control;
  if (copy) {
    const source = await readControlRows(c, copy.pnlName, copy.pnlFldId);
    if (!source) throw new PageSaveRefusedError(`The copied control ${copy.pnlName} #${copy.pnlFldId} no longer exists; copy it again.`);
    const [html] = await select<{ HTMLAREA: string | null }>(c, `SELECT HTMLAREA FROM PSPNLHTMLAREA WHERE PNLNAME = :p AND PNLFLDID = :id`, { p: copy.pnlName, id: copy.pnlFldId });
    const [rte] = await select<Record<string, string>>(c,
      `SELECT PTRTECFGSETTINGSID, PTRTEIMGLOCURLID, PTRTEPLUGIN, PTRTETEMPLATE, PTRTESTYLE FROM PSPTPNLRTEDITOR WHERE PNLNAME = :p AND PNLFLDID = :id`,
      { p: copy.pnlName, id: copy.pnlFldId });
    const copied = copyControlRows(source, pnlName, ins.pnlFldId, ins.fieldNum, ins.control);
    if (GRID_FIELD_TYPES.has(Number(copied.field.FIELDTYPE))) copied.field.GRDCOLUMNCOUNT = ins.control.grdColumnCount ?? 0;
    // A Tree's levels come with it under its new FIELDNUM; an Analytic Grid's model and axes under its new id.
    let treeNodes: ColumnValues[] = [];
    if (Number(source.field.FIELDTYPE) === TREE && Number(source.field.TREECTRLID ?? 0) > 0) {
      treeNodes = (await select<ColumnValues>(c, `SELECT * FROM PSPNLTREECTRL WHERE PNLNAME = :p AND TREECTRLID = :t`, { p: copy.pnlName, t: source.field.TREECTRLID }))
        .map((r) => ({ ...r, PNLNAME: pnlName, TREECTRLID: ins.fieldNum }));
      copied.field.TREECTRLID = ins.fieldNum;
    }
    const aceRows = async (table: string) => (await select<ColumnValues>(c, `SELECT * FROM ${table} WHERE PNLNAME = :p AND PNLFLDID = :id`, { p: copy.pnlName, id: copy.pnlFldId }))
      .map((r) => ({ ...r, PNLNAME: pnlName, PNLFLDID: ins.pnlFldId }));
    const [aceData] = await aceRows('PSPNLACEGRDDATA');
    const aceAxes = await aceRows('PSPNLACEGRDAXIS');
    return { ...copied, ...(html ? { html: String(html.HTMLAREA ?? '') } : {}),
      ...(treeNodes.length ? { treeNodes } : {}), ...(aceData ? { aceData, aceAxes } : {}),
      ...(await controlDataRows(c, copy, { pnlName, pnlFldId: ins.pnlFldId })),
      ...(rte ? { richText: { configSettingsId: rte.PTRTECFGSETTINGSID, imageLocationUrlId: rte.PTRTEIMGLOCURLID, pluginFileId: rte.PTRTEPLUGIN,
        templateFileId: rte.PTRTETEMPLATE, styleFileId: rte.PTRTESTYLE } } : {}) };
  }
  if (ins.control.restore) {
    // A reviewed restoration: the control's own rows, at the tab place, level and grid column count this save assigns.
    const r = ins.control.restore, field: ColumnValues = { ...r.PSPNLFIELD![0], FIELDNUM: ins.fieldNum, OCCURSLEVEL: Number(ins.control.occursLevel ?? 0) };
    if (GRID_FIELD_TYPES.has(Number(field.FIELDTYPE))) field.GRDCOLUMNCOUNT = ins.control.grdColumnCount ?? 0;
    const extra = RESTORABLE_CONTROL_TABLES.filter((t) => t !== 'PSPNLFIELD' && t !== 'PSPNLFIELDEXT').flatMap((table) => (r[table] ?? []).map((row) => ({ table, row })));
    return { field, ext: { ...r.PSPNLFIELDEXT![0] }, extra };
  }
  if (!add) throw new PageSaveRefusedError(`Control ${ins.pnlFldId} is neither added nor pasted.`);
  let full: NewControl = { ...add, recName: add.recName.trim().toUpperCase(), fieldName: add.fieldName.trim().toUpperCase() };
  if (add.kind === 'analyticGrid') full = await resolveAnalytic(c, full);
  const field = isRecordBound(add.kind) ? await readFieldInfo(c, full.recName, full.fieldName) : undefined;
  // A control on a record alone (an HTML Area or Tree without a field, a Grid's main record, a Subpage's substitution, an
  // unbound Image or Chart that names one): the record must exist.
  const recordAlone = (FIELD_OPTIONAL.has(add.kind) || RECORD_OPTIONAL.has(add.kind) || RECORD_ONLY.has(add.kind) || add.kind === 'subpage') && full.recName && !full.fieldName;
  if (recordAlone && !(await recordExists(c, full.recName))) throw new PageSaveRefusedError(`${full.recName} is not a record in this database.`);
  if (add.kind === 'secondaryPage') {
    const target = (add.subPage ?? '').trim().toUpperCase();
    const [d] = await select<{ T: number }>(c, `SELECT PNLTYPE AS T FROM PSPNLDEFN WHERE PNLNAME = :p`, { p: target });
    if (!target || !d) throw new PageSaveRefusedError(target ? `${target} is not a page in this database.` : 'A new Secondary Page needs its page.');
    if (Number(d.T) !== 2) throw new PageSaveRefusedError(`${target} is not a secondary page (its page type is ${d.T}).`);
    full = { ...full, subPage: target };
  }
  for (const l of full.treeLevels ?? []) {
    if (!(await readFieldInfo(c, l.recName.trim().toUpperCase(), l.fieldName.trim().toUpperCase()))) throw new PageSaveRefusedError(`${l.recName}.${l.fieldName} is not a record field (a tree level).`);
  }
  if (full.treeLevels) full = { ...full, treeLevels: full.treeLevels.map((l) => ({ recName: l.recName.trim().toUpperCase(), fieldName: l.fieldName.trim().toUpperCase() })) };
  const refusal = newControlFieldRefusal(add.kind, full.recName, full.fieldName, field);
  if (refusal) throw new PageSaveRefusedError(refusal);
  const rows = { ...newControlRows(pnlName, ins.pnlFldId, ins.fieldNum, full, ins.control, field), ...newControlDataRows(pnlName, ins.pnlFldId, add.kind, full, ins.fieldNum) };
  if (GRID_FIELD_TYPES.has(Number(rows.field.FIELDTYPE))) rows.field.GRDCOLUMNCOUNT = ins.control.grdColumnCount ?? 0;
  // A Group Box's dialog settings sent with the new control (its Fluid Group Box Type: 21 Related Content for a drop zone)
  // over the captured default row, as dropping it and setting them before the save stores them.
  for (const { col, of, key } of EXT_EDITABLE) if (ins.control[key] !== undefined) rows.ext[col] = of(ins.control);
  return rows;
}

async function recordExists(c: Connection, recName: string): Promise<boolean> {
  const [{ N: n }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSRECDEFN WHERE RECNAME = :r`, { r: recName });
  return Number(n) > 0;
}

/** A Long Edit Box's PSPTPNLRTEDITOR row (le01: PNLNAME, PNLFLDID and the five ids, ' ' for none). */
async function insertRichText(c: Connection, pnlName: string, pnlFldId: number, r: RichTextOptions): Promise<void> {
  const v = (x: string | undefined) => (x ?? '').trim().toUpperCase() || ' ';
  await expectRows(c, `INSERT INTO PSPTPNLRTEDITOR (PNLNAME, PNLFLDID, PTRTECFGSETTINGSID, PTRTEIMGLOCURLID, PTRTETEMPLATE, PTRTESTYLE, PTRTEPLUGIN)
      VALUES (:n, :id, :c1, :c2, :c3, :c4, :c5)`,
    { n: pnlName, id: pnlFldId, c1: v(r.configSettingsId), c2: v(r.imageLocationUrlId), c3: v(r.templateFileId), c4: v(r.styleFileId), c5: v(r.pluginFileId) },
    1, `Inserting PSPTPNLRTEDITOR ${pnlFldId}`);
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
  const useRefusal = pageUseRefusal(n(src.FIELDTYPE), edited.fieldUse, edited.secureInvisible);
  if (useRefusal) throw new PageSaveRefusedError(useRefusal);
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
/**
 * An edit to a column this release does not have: a blank or zero is what the column would hold anyway, so it is left
 * out; anything else is a setting this PeopleTools release cannot store (Smart Prompt before 8.62), refused.
 */
function refuseMissingSettings(dropped: readonly string[], values: Record<string, unknown>, table: string): void {
  const set = dropped.filter((col) => { const v = values[col]; return !(v === null || v === 0 || (typeof v === 'string' && !v.trim())); });
  if (set.length) throw new PageSaveRefusedError(`This PeopleTools release has no ${table} ${set.join(', ')}; that setting cannot be saved here.`);
}

async function insertRow(c: Connection, table: string, full: ColumnValues): Promise<void> {
  // A column this release's table lacks is one its App Designer never writes (tableColumns.ts).
  const { row } = presentOnly(full, await tableColumns(c, table));
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

/** PSPNLFIELDEXT PARENTPNLFLDID / PAGEPNLFLDID of a control placed on a page that has no name yet (n01, XX_PG_AD). */
export const NEW_PAGE_CONTROL_PAGE_REF = '$0';

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
  /** Create it though App Designer's page checks fail (PageInvalidError), as its "save anyway" Yes does. */
  saveInvalid?: boolean;
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
/**
 * Where a new page's controls sit in tab order, as App Designer's New Page and
 * first save do. Added one by one, each goes after the one before it in reading
 * order (newControlTabIndex). A column names its grid with intoGrid and goes
 * right after that grid's last (0, 0) column instead, as planPageSave places
 * one: without this a grid created with its columns in one call keeps none of
 * them, the columns sort to the top-left as ordinary controls, and the page
 * fails App Designer's "No data for scroll" (15,19).
 */
export function placeNewPageControls(requested: readonly EditedControl[]): EditedControl[] {
  const controls: EditedControl[] = [];
  const typeOfControl = (ctl: EditedControl) => ctl.add ? NEW_CONTROL_FIELDTYPE[ctl.add.kind] : Number(ctl.fieldType ?? -1);
  const originColumn = (ctl: EditedControl) => ctl.fieldLeft === 0 && ctl.fieldTop === 0 && !SCROLL_FIELD_TYPES.has(typeOfControl(ctl));
  for (const ctl of requested) {
    const into = ctl.add?.intoGrid;
    if (into !== undefined) {
      let at = controls.findIndex((c) => c.pnlFldId === into);
      if (at < 0 || !GRID_FIELD_TYPES.has(typeOfControl(controls[at]))) {
        throw new PageSaveRefusedError(`Control ${into} is not a grid on the page to add a column to.`);
      }
      while (at + 1 < controls.length && originColumn(controls[at + 1])) at++;
      controls.splice(at + 1, 0, { ...ctl, fieldLeft: 0, fieldTop: 0,
        fieldRight: ctl.fieldRight ? Math.max(0, ctl.fieldRight - ctl.fieldLeft) : 0,
        fieldBottom: ctl.fieldBottom ? Math.max(0, ctl.fieldBottom - ctl.fieldTop) : 0 });
      continue;
    }
    if (ctl.add && GRID_ONLY.has(ctl.add.kind)) throw new PageSaveRefusedError(`A ${ctl.add.kind} goes only inside a grid, as one of its columns.`);
    // A scroll has its own rule: after the last control whose top is at or above its
    // bottom edge, so a second grid lands after the first grid's (0, 0) columns rather
    // than between the grid and the columns it owns.
    if (ctl.add && SCROLL_FIELD_TYPES.has(NEW_CONTROL_FIELDTYPE[ctl.add.kind])) { controls.splice(newScrollTabIndex(controls, ctl), 0, ctl); continue; }
    if (ctl.add) controls.splice(newControlTabIndex(controls, ctl), 0, ctl); else controls.push(ctl);
  }
  // A grid counts the (0, 0) controls that follow it (GRDCOLUMNCOUNT), as a native save does.
  return controls.map((ctl, i) => {
    if (!GRID_FIELD_TYPES.has(typeOfControl(ctl))) return ctl;
    let n = 0;
    while (i + 1 + n < controls.length && originColumn(controls[i + 1 + n])) n++;
    return { ...ctl, grdColumnCount: n };
  });
}

export async function createPage(c: Connection, request: PageCreateRequest): Promise<PageSaveResult> {
  const pnlName = request.pnlName.trim().toUpperCase();
  const { operatorId } = request;
  if (!PAGE_NAME.test(pnlName)) throw new PageSaveRefusedError(`${pnlName || '(blank)'} is not a page name (a letter, then up to 17 letters, digits or _).`);
  const scope = writeScopeRefusal(pnlName);
  if (scope) throw new PageSaveRefusedError(scope);
  const opError = validateOperatorId(operatorId);
  if (opError) throw new PageSaveRefusedError(opError);
  const controls: EditedControl[] = placeNewPageControls(request.template ? [] : request.controls ?? []);
  // Their levels, as App Designer assigns them (a new scroll at 1, the rest from the tab order), and its checks.
  const checked = controls.map((ctl) => ({ fieldType: ctl.add ? NEW_CONTROL_FIELDTYPE[ctl.add.kind] : Number(ctl.fieldType ?? -1),
    occursLevel: Number(ctl.occursLevel ?? 1), fieldUse: Number(ctl.fieldUse ?? 0), recName: ctl.add ? ctl.add.recName : ctl.recName ?? '',
    fieldName: ctl.add ? ctl.add.fieldName : ctl.fieldName ?? '', label: ctl.lblText ?? '', assocFieldNum: Number(ctl.assocFieldNum ?? 0) }));
  occursLevels(checked).forEach((level, i) => { controls[i] = { ...controls[i], occursLevel: level }; });
  if (!request.template && controls.length === 0) {
    throw new PageSaveRefusedError('Add a control to the page first: App Designer will not save a page that has none.');
  }
  try {
    if (!(await operatorExists(c, operatorId))) {
      throw new PageSaveRefusedError(`PeopleSoft operator ${operatorId} does not exist in this database (PSOPRDEFN).`);
    }
    const [{ N: taken }] = await select<{ N: number }>(c, `SELECT COUNT(*) AS N FROM PSPNLDEFN WHERE PNLNAME = :n`, { n: pnlName });
    if (Number(taken)) throw new PageSaveRefusedError(`There is already a page named ${pnlName}.`);
    if (!request.saveInvalid) await refuseInvalidPage(c, pnlName, checked);
    // A Subpage takes its subpage's own rectangle on a new page too (App Designer 8.61.15, XX_PG_AD; sbp-fresh on 8.62).
    for (const [i, ctl] of controls.entries()) controls[i] = await placeSubpage(c, ctl);

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
    const rows: ControlRows[] = [];
    for (const f of template?.fields ?? []) {
      rows.push({ field: { ...f, PNLNAME: pnlName }, ext: { ...template!.exts.find((e) => e.PNLFLDID === f.PNLFLDID)!, PNLNAME: pnlName },
        ...(await controlDataRows(c, { pnlName: request.template!.trim().toUpperCase(), pnlFldId: Number(f.PNLFLDID) }, { pnlName, pnlFldId: Number(f.PNLFLDID) })) });
    }
    // Placed before the page had a name, a new page's controls name no page: App Designer writes PARENTPNLFLDID and
    // PAGEPNLFLDID '$0' (n01 on 8.62.09, XX_PG_AD on 8.61.15); a control added to an existing page gets '<page>$0'.
    for (const [i, control] of controls.entries()) {
      const r = await insertedControlRows(c, pnlName, { pnlFldId: i + 1, fieldNum: i + 1, control });
      rows.push({ ...r, ext: { ...r.ext, PARENTPNLFLDID: NEW_PAGE_CONTROL_PAGE_REF, PAGEPNLFLDID: NEW_PAGE_CONTROL_PAGE_REF } });
    }
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
    for (const r of rows) await insertControl(c, pnlName, r);
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
