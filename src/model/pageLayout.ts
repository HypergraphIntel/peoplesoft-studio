import { PAGE_FIELD_TYPES, PAGE_TYPES, type PageView, type Row } from './uiDefinitions.js';

/*
 * A page's controls positioned as App Designer's Layout view shows them, from
 * the stored geometry in PSPNLFIELD: every control's rectangle
 * (FIELDLEFT/TOP/RIGHT/BOTTOM, in pixels) and its label's rectangle
 * (EDITLBL*). Read-only -- the visual surface the Page panel draws.
 */

const str = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => Number(v ?? 0);

export interface Rect { left: number; top: number; width: number; height: number }

/** Broad shape a control is drawn as, from its FIELDTYPE. */
export type ControlShape = 'field' | 'dropdown' | 'checkbox' | 'radio' | 'button' | 'label' | 'image' | 'container' | 'rule' | 'misc';

/** The editable PSPNLFIELD columns of a control, as stored (what the editor round-trips to pageWriter). */
export interface ControlColumns {
  fieldLeft: number;
  fieldTop: number;
  fieldRight: number;
  fieldBottom: number;
  editLblLeft: number;
  editLblTop: number;
  editLblRight: number;
  editLblBottom: number;
  fieldSizeType: number;
  lblType: number;
  lblText: string;
  fieldUse: number;
  secureInvisible: number;
  /** The Properties dialog's columns (a frame's: fr02, fr04, fr07): FIELDSTYLE, PTADJHIDDENFIELDS, ENABLEASANCHOR. */
  fieldStyle: string;
  adjustHidden: number;
  anchor: number;
  /** The Fluid tab (fr08-fr20): PSPNLFIELD.FIELDUSETMP; PSPNLFIELDEXT FFSTYLELONG (five slots) and FIELDUSETEMP2. */
  fieldUseTmp: number;
  ffStyleLong: string;
  fieldUseTemp2: number;
  /** Type-specific captured columns: DSPLFORMAT (alignment/explanation/scale/size/display options), CONTNAME (Image ID),
   * GRDLBLMSGSET/NUM (message-catalog label), ONVALUE/OFFVALUE (check box / radio), LBLLOC (label location). */
  dsplFormat: number;
  contName: string;
  grdLblMsgSet: number;
  grdLblMsgNum: number;
  onValue: string;
  offValue: string;
  lblLoc: number;
  /** A Scroll Bar / Grid / Scroll Area's Occurs Count (OCCURSCOUNT1; 0 = unlimited). */
  occursCount1: number;
  /** A Grid's display options: Show Column Headings (GRDSHOWCOLHDG), Show Row Numbers (GRDSHOWROWHDG), Allow Column Sorting (GRDALLOWCOLSORT). */
  gridShowColHdg: number;
  gridShowRowHdg: number;
  gridAllowColSort: number;
}

export interface PageControl {
  num: number;
  /** PSPNLFIELD.PNLFLDID -- the stable control id the writer keys by. */
  pnlFldId: number;
  level: number;
  type: number;
  typeName: string;
  shape: ControlShape;
  rect: Rect;
  /** The stored editable columns, for round-tripping edits. */
  columns: ControlColumns;
  /** The label's rectangle, when it has a shown label within the page. */
  label?: { text: string; rect: Rect };
  /** "RECNAME.FIELDNAME", a subpage, or what the control points at. */
  target: string;
  recordField: string;
  /** PSPNLFIELD.RECNAME / FIELDNAME, for the Order grid. */
  recName: string;
  fieldName: string;
  /** PSPNLFIELD.DEFERPROC: Allow Deferred Processing. */
  deferProc: boolean;
  /** PSPNLFIELD.ASSOCFIELDNUM: the control field a related-display field is tied to (0 when none). */
  controlFieldNum: number;
  /** PSPNLFIELD.FIELDUSE, the use bit-mask, shown raw. */
  use: number;
  /** FIELDUSE 0x01: the control is display-only (proven in docs/PAGE_SAVE.md 09). */
  displayOnly: boolean;
  /** FIELDUSE 0x02: the control is invisible. */
  invisible: boolean;
  pageFieldName: string;
}

/** FIELDUSE bits, proven against App Designer saves (docs/PAGE_SAVE.md 09-property). */
export const FIELD_USE_DISPLAY_ONLY = 0x01;
export const FIELD_USE_INVISIBLE = 0x02;

/** A page's own properties, as App Designer's Page Properties dialog shows them. */
export interface PageProperties {
  /** PSPNLDEFN.DESCR -- the page description. */
  description: string;
  /** PSPNLDEFN.DESCRLONG -- the Comments. */
  comments: string;
  /** PSPNLDEFN.OBJECTOWNERID -- the Owner ID. */
  ownerId: string;
  /** PSPNLDEFN.PNLTYPE, named. */
  pageType: string;
  /** PSPNLDEFN.PANELRIGHT / PANELBOTTOM -- the page size. */
  sizeWidth: number;
  sizeHeight: number;
  /** PSPNLDEFN.PNLUSE; its low byte is the Page Size choice (PAGE_SIZE_CUSTOM = Custom). */
  pnlUse: number;
  /** The Page Size choice is Custom (the size is the one dragged / typed). */
  sizeCustom: boolean;
  /** PSPNLDEFN.STYLESHEETNAME / FFSTYLESHEETNAME (blank: default). */
  styleSheet: string;
  fluidStyleSheet: string;
  /** PSPNLDEFN.PNLTYPE (PAGE_TYPES). */
  pnlType: number;
  /** PSPNLDEFN.PNLSTYLE -- the Use tab's Page Background (a style class; blank: default). */
  background: string;
  /** PSPNLDEFN.DEFERPROC -- Allow Deferred Processing. */
  deferProc: boolean;
  /** PSPNLDEFN.POPUPMENU -- the Use tab's Popup Menu (blank: none). */
  popupMenu: string;
  /** PNLUSE 0x4000 -- Fluid Page (u13 / u14; every Layout Page and _FL / _SCF page carries it). */
  fluidPage: boolean;
  /** PNLUSE 0x100 -- Adjust Layout for Hidden Fields (u04). */
  adjustLayout: boolean;
  /** A secondary page's OK & Cancel buttons / Close Box (PNLUSE 0x01 / 0x02 clear; u09, u10) and Disable Display in Modal Window (0x2000; u11). */
  okCancel: boolean;
  closeBox: boolean;
  disableModal: boolean;
  /**
   * The Fluid tab: Style Classes and the form-factor overrides (f01-f05):
   * FFSTYLEDESKTOP; Small FFSTYLEPHONE, Medium FFSTYLEMEDIUM, Large
   * FFSTYLETABLET, Extra Large FFSTYLEEXLARGE.
   */
  fluid: { styleClasses: string; small: string; medium: string; large: string; extraLarge: string };
  /** PNLUSETEMP 0x01 -- Suppress System-Specific Style Classes (f06). */
  suppressClasses: boolean;
  lastUpdated: string;
  lastUpdatedBy: string;
  version: number;
}

/**
 * PNLUSE's low byte is the Use tab's Page Size choice: 0x03 plus one size bit
 * (0x04 782x452, 0x20 570x330, 0x40 760x330, 0x80 984 wide ...) or 0x08 for
 * Custom -- 6,982 delivered pages carry 11, at 6,259 different sizes. Choosing
 * Custom and dragging the page edge in App Designer (14-props-use) set PNLUSE
 * 32 -> 11 and PANELRIGHT / PANELBOTTOM to the dragged size.
 */
export const PAGE_SIZE_CUSTOM = 0x0b;

/**
 * PNLUSE's Page Size bits: 0x04-0x80 of the low byte and 0x200 / 0x400 /
 * 0x800 (0x100 is Adjust Layout for Hidden Fields). 0x01 / 0x02 are a page's
 * no OK & Cancel / no Close Box, set on every standard page.
 */
export const PAGE_SIZE_BITS = 0xefc;
export const PAGE_SIZE_AUTO = 0x10;

/**
 * App Designer's Page Size list for a standard page (s01-s08 on
 * ZZ_PCODE_LAB_NP2): each choice's size bit and the size it stores.
 * 640x480 stores 0 x 0 (App Designer shows 632 x 326). The "Var" choices
 * store their width less 8 and the page's current height less 8 (s06: 498 ->
 * 490, s07: 490 -> 482). Custom keeps the size.
 */
export const PAGE_SIZE_PRESETS: ReadonlyArray<{ key: string; label: string; bit: number; width: number; height: number | 'var'; shown?: [number, number] }> = [
  { key: '640x480', label: '640x480 Windows screen', bit: 0x000, width: 0, height: 0, shown: [632, 326] },
  { key: '800x600', label: '800x600 Windows screen', bit: 0x004, width: 782, height: 452 },
  { key: '800x600-portal', label: '800x600 page inside portal', bit: 0x020, width: 570, height: 330 },
  { key: '800x600-noportal', label: '800x600 page without portal', bit: 0x040, width: 760, height: 330 },
  { key: '1024x768-portal', label: '1024x768 page inside portal', bit: 0x800, width: 760, height: 498 },
  { key: '1024x768-noportal', label: '1024x768 page without portal', bit: 0x080, width: 984, height: 498 },
  { key: '240xvar', label: '240xVar portal home page comp.', bit: 0x200, width: 210, height: 'var' },
  { key: '490xvar', label: '490xVar portal home page comp.', bit: 0x400, width: 460, height: 'var' }
];

/** The Page Size choice PNLUSE holds: a preset's key, 'custom', 'auto', or undefined (bits no capture shows). */
export function pageSizeChoice(pnlUse: number): string | undefined {
  const bits = pnlUse & PAGE_SIZE_BITS;
  if (bits === (PAGE_SIZE_CUSTOM & PAGE_SIZE_BITS)) return 'custom';
  if (bits === PAGE_SIZE_AUTO) return 'auto';
  return PAGE_SIZE_PRESETS.find((p) => p.bit === bits)?.key;
}

export interface PageLayout {
  name: string;
  description: string;
  pageType: string;
  version: number;
  /** The drawing surface: the page size when it has one (as App Designer draws it), else the controls' extent plus a margin. */
  width: number;
  height: number;
  controls: PageControl[];
  /** The page's own properties (the Page Properties dialog). */
  properties: PageProperties;
}

/** FIELDTYPE -> the shape the control is drawn as. */
export function controlShape(type: number): ControlShape {
  switch (type) {
    case 4: case 6: return 'field'; // Edit Box, Long Edit Box
    case 5: return 'dropdown';
    case 7: return 'checkbox';
    case 8: return 'radio';
    case 12: case 13: case 14: case 15: case 16: case 17: case 21: case 26: case 29: return 'button';
    case 0: return 'label'; // Static Text
    case 3: case 9: return 'image';
    case 23: return 'rule'; // Horizontal Rule
    case 1: case 2: case 11: case 18: case 19: case 20: case 24: case 25: case 27: case 30: return 'container';
    default: return 'misc'; // Scroll Bar (10) and anything new
  }
}

/**
 * A control's rectangle. An auto-sized one (RIGHT/BOTTOM 0, as App Designer
 * stores a freshly dropped control and sizes it from the field) gets a stand-in:
 * an edit box or drop-down a typical field width, anything else a small square.
 */
function rectOf(f: Row, shape: ControlShape): Rect {
  const left = num(f.FIELDLEFT);
  const top = num(f.FIELDTOP);
  const right = num(f.FIELDRIGHT);
  const bottom = num(f.FIELDBOTTOM);
  const wide = shape === 'field' || shape === 'dropdown';
  return {
    left, top,
    width: right > left ? right - left : wide ? 80 : 14,
    height: bottom > top ? bottom - top : wide ? 18 : 14
  };
}

/**
 * A control's shown label, positioned as App Designer draws it, or undefined
 * when none. LBLTYPE 0 (None) and negative EDITLBL (App Designer's "not shown")
 * draw nothing. A button's label is its caption, drawn on the button, not a
 * separate label. When EDITLBL is all zero the label is not stored absolutely
 * but drawn relative to the control -- a container's caption at its top-left,
 * static text inside its box, a check box / radio label to its right,
 * otherwise just above -- and drawing it
 * at (0,0) is what piled labels in the corner. A stored EDITLBL rectangle is
 * used as-is.
 */
function labelOf(f: Row, rect: Rect, shape: ControlShape): { text: string; rect: Rect } | undefined {
  const text = labelText(f);
  if (!text || shape === 'button') return undefined;
  const left = num(f.EDITLBLLEFT), top = num(f.EDITLBLTOP), right = num(f.EDITLBLRIGHT), bottom = num(f.EDITLBLBOTTOM);
  if (left < 0 || top < 0) return undefined;
  if (left === 0 && top === 0 && right === 0 && bottom === 0) {
    // Not stored absolutely: place relative to the control.
    // Static text is its own label, drawn inside its box.
    const r = shape === 'container' ? { left: rect.left + 5, top: rect.top + 1 }
      : shape === 'label' ? { left: rect.left + 2, top: rect.top + 3 }
      : shape === 'checkbox' || shape === 'radio' ? { left: rect.left + rect.width + 4, top: rect.top + 1 }
      : { left: rect.left, top: rect.top - 15 };
    return { text, rect: { ...r, width: 0, height: 14 } };
  }
  return { text, rect: { left, top, width: right > left ? right - left : 0, height: bottom > top ? bottom - top : 14 } };
}

/**
 * A page field's shown label text, or '' when no label is shown. LBLTYPE 0 is
 * "None" -- App Designer shows no label even though LBLTEXT still holds the
 * field's underlying text, so those are not drawn (they otherwise pile up at
 * their stray EDITLBL coordinates). Types 1 Text, 2 RFT Short, 3 RFT Long show
 * LBLTEXT. A subpage with no label text is drawn with its subpage's name
 * (App Designer's layout shows EMPL_SRCH1_SBP in the box of ZZ_JOB_DATA1's
 * blank-labelled subpage).
 */
function labelText(f: Row): string {
  const text = num(f.LBLTYPE) === 0 ? '' : str(f.LBLTEXT);
  return text || (num(f.FIELDTYPE) === 11 ? str(f.SUBPNLNAME) : '');
}

/** What the control points at, for the inspector: its record field, subpage, process ... */
function targetOf(f: Row): string {
  const rec = str(f.RECNAME);
  const field = str(f.FIELDNAME);
  const parts: string[] = [];
  if (rec || field) parts.push(field ? `${rec}.${field}` : rec);
  if (str(f.SUBPNLNAME)) parts.push(`subpage ${str(f.SUBPNLNAME)}`);
  if (str(f.PRCSNAME)) parts.push(`process ${str(f.PRCSTYPE)} ${str(f.PRCSNAME)}`.replace(/\s+/g, ' '));
  return parts.join('  ');
}

export function buildPageLayout(name: string, view: PageView): PageLayout {
  const p = view.page;
  const controls: PageControl[] = [...view.fields]
    .sort((a, b) => num(a.FIELDNUM) - num(b.FIELDNUM))
    .map((f): PageControl => {
      const shape = controlShape(num(f.FIELDTYPE));
      const rect = rectOf(f, shape);
      const label = labelOf(f, rect, shape);
      const rec = str(f.RECNAME);
      const field = str(f.FIELDNAME);
      return {
        num: num(f.FIELDNUM),
        pnlFldId: num(f.PNLFLDID),
        level: num(f.OCCURSLEVEL),
        type: num(f.FIELDTYPE),
        typeName: PAGE_FIELD_TYPES[num(f.FIELDTYPE)] ?? `Type ${num(f.FIELDTYPE)}`,
        shape,
        rect,
        columns: {
          fieldLeft: num(f.FIELDLEFT), fieldTop: num(f.FIELDTOP), fieldRight: num(f.FIELDRIGHT), fieldBottom: num(f.FIELDBOTTOM),
          editLblLeft: num(f.EDITLBLLEFT), editLblTop: num(f.EDITLBLTOP), editLblRight: num(f.EDITLBLRIGHT), editLblBottom: num(f.EDITLBLBOTTOM),
          fieldSizeType: num(f.FIELDSIZETYPE), lblType: num(f.LBLTYPE), lblText: str(f.LBLTEXT), fieldUse: num(f.FIELDUSE), secureInvisible: num(f.SECUREINVISIBLE),
          fieldStyle: str(f.FIELDSTYLE), adjustHidden: num(f.PTADJHIDDENFIELDS), anchor: num(f.ENABLEASANCHOR),
          fieldUseTmp: num(f.FIELDUSETMP), ffStyleLong: String(f.EXT_FFSTYLELONG ?? ''), fieldUseTemp2: num(f.EXT_FIELDUSETEMP2),
          dsplFormat: num(f.DSPLFORMAT), contName: str(f.CONTNAME), grdLblMsgSet: num(f.GRDLBLMSGSET), grdLblMsgNum: num(f.GRDLBLMSGNUM),
          onValue: str(f.ONVALUE), offValue: str(f.OFFVALUE), lblLoc: num(f.LBLLOC),
          occursCount1: num(f.OCCURSCOUNT1), gridShowColHdg: num(f.GRDSHOWCOLHDG), gridShowRowHdg: num(f.GRDSHOWROWHDG), gridAllowColSort: num(f.GRDALLOWCOLSORT)
        },
        ...(label ? { label } : {}),
        target: targetOf(f),
        recordField: field ? `${rec}.${field}` : rec,
        recName: rec,
        fieldName: field,
        deferProc: num(f.DEFERPROC) !== 0,
        controlFieldNum: num(f.ASSOCFIELDNUM),
        use: num(f.FIELDUSE),
        displayOnly: (num(f.FIELDUSE) & FIELD_USE_DISPLAY_ONLY) !== 0,
        invisible: (num(f.FIELDUSE) & FIELD_USE_INVISIBLE) !== 0,
        pageFieldName: str(f.PNLFIELDNAME)
      };
    });

  // The surface is the controls' extent (labels included) plus a margin, with a sensible minimum.
  let maxRight = 200;
  let maxBottom = 120;
  for (const c of controls) {
    maxRight = Math.max(maxRight, c.rect.left + c.rect.width, c.label ? c.label.rect.left + c.label.rect.width : 0);
    maxBottom = Math.max(maxBottom, c.rect.top + c.rect.height, c.label ? c.label.rect.top + c.label.rect.height : 0);
  }

  const pageType = PAGE_TYPES[num(p.PNLTYPE)] ?? `Type ${num(p.PNLTYPE)}`;
  const sized = num(p.PANELRIGHT) > 0 && num(p.PANELBOTTOM) > 0;
  // 640x480 Windows screen stores 0 x 0; App Designer draws it 632 x 326 (s01).
  const shown = !sized && num(p.PNLTYPE) === 0 && (num(p.PNLUSE) & 0x03) === 0x03 ? PAGE_SIZE_PRESETS.find((x) => x.key === pageSizeChoice(num(p.PNLUSE)))?.shown : undefined;
  return {
    name,
    description: str(p.DESCR),
    pageType,
    version: num(p.VERSION),
    width: sized ? num(p.PANELRIGHT) : shown ? shown[0] : maxRight + 12,
    height: sized ? num(p.PANELBOTTOM) : shown ? shown[1] : maxBottom + 12,
    controls,
    properties: {
      description: str(p.DESCR),
      comments: str(p.DESCRLONG),
      ownerId: str(p.OBJECTOWNERID),
      pageType,
      sizeWidth: num(p.PANELRIGHT),
      sizeHeight: num(p.PANELBOTTOM),
      pnlUse: num(p.PNLUSE),
      // The size bits (0x04-0x80) say Custom (0x08); 0x01 / 0x02 are a secondary page's buttons.
      sizeCustom: pageSizeChoice(num(p.PNLUSE)) === 'custom',
      styleSheet: str(p.STYLESHEETNAME),
      fluidStyleSheet: str(p.FFSTYLESHEETNAME),
      pnlType: num(p.PNLTYPE),
      background: str(p.PNLSTYLE),
      deferProc: num(p.DEFERPROC) !== 0,
      popupMenu: str(p.POPUPMENU),
      fluidPage: (num(p.PNLUSE) & 0x4000) !== 0,
      adjustLayout: (num(p.PNLUSE) & 0x100) !== 0,
      okCancel: (num(p.PNLUSE) & 0x01) === 0,
      closeBox: (num(p.PNLUSE) & 0x02) === 0,
      disableModal: (num(p.PNLUSE) & 0x2000) !== 0,
      suppressClasses: (num(p.PNLUSETEMP) & 0x01) !== 0,
      fluid: { styleClasses: str(p.FFSTYLEDESKTOP), small: str(p.FFSTYLEPHONE), medium: str(p.FFSTYLEMEDIUM), large: str(p.FFSTYLETABLET), extraLarge: str(p.FFSTYLEEXLARGE) },
      lastUpdated: str(p.LASTUPD) || str(p.LASTUPDDTTM),
      lastUpdatedBy: str(p.LASTUPDOPRID),
      version: num(p.VERSION)
    }
  };
}
