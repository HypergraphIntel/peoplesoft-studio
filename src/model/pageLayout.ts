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

export interface PageLayout {
  name: string;
  description: string;
  pageType: string;
  version: number;
  /** The drawing surface, the controls' extent plus a margin. */
  width: number;
  height: number;
  controls: PageControl[];
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

/** A control's rectangle, giving an auto-sized one (RIGHT/BOTTOM 0 or inverted) a small default. */
function rectOf(f: Row): Rect {
  const left = num(f.FIELDLEFT);
  const top = num(f.FIELDTOP);
  const right = num(f.FIELDRIGHT);
  const bottom = num(f.FIELDBOTTOM);
  return {
    left, top,
    width: right > left ? right - left : 14,
    height: bottom > top ? bottom - top : 14
  };
}

/**
 * A control's shown label, positioned as App Designer draws it, or undefined
 * when none. LBLTYPE 0 (None) and negative EDITLBL (App Designer's "not shown")
 * draw nothing. A button's label is its caption, drawn on the button, not a
 * separate label. When EDITLBL is all zero the label is not stored absolutely
 * but drawn relative to the control -- a container's caption at its top-left, a
 * check box / radio label to its right, otherwise just above -- and drawing it
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
    const r = shape === 'container' ? { left: rect.left + 5, top: rect.top + 1 }
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
 * LBLTEXT.
 */
function labelText(f: Row): string {
  return num(f.LBLTYPE) === 0 ? '' : str(f.LBLTEXT);
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
      const rect = rectOf(f);
      const shape = controlShape(num(f.FIELDTYPE));
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
          fieldSizeType: num(f.FIELDSIZETYPE), lblType: num(f.LBLTYPE), lblText: str(f.LBLTEXT), fieldUse: num(f.FIELDUSE), secureInvisible: num(f.SECUREINVISIBLE)
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

  return {
    name,
    description: str(p.DESCR),
    pageType: PAGE_TYPES[num(p.PNLTYPE)] ?? `Type ${num(p.PNLTYPE)}`,
    version: num(p.VERSION),
    width: maxRight + 12,
    height: maxBottom + 12,
    controls
  };
}
