/**
 * A page's scroll levels (PSPNLFIELD.OCCURSLEVEL) as App Designer assigns them (lv01-lv17 on ZZ_PCODE_LAB_LV):
 * walking the controls in tab order with a running level that starts at 0,
 *  - a Scroll Bar, Grid, Scroll Area or Analytic Grid (10 / 19 / 27 / 32) keeps its own Occurs Level -- set in its
 *    dialog, 1 when inserted (lv03, lv17) -- and the running level becomes it (lv04, lv09);
 *  - a Horizontal Rule with Set to Level (FIELDUSE 0x2) is at the level it chose, and the running level becomes
 *    that (lv06, lv08); without it, a rule is at the running level (lv05, lv11);
 *  - every other control is at the running level -- where it sits on the page plays no part (lv07: a rule drawn
 *    below the Scroll Area is still level 1), only its place in the tab order (lv14-lv16).
 * Every change (an Occurs Level, Set to Level, a reorder, an insert) assigns the levels again. The rule reproduces
 * 17354 of HRDMO's 17356 pages exactly (the other two, untouched since 2002 / 2010, have one stray control each).
 */
export const SCROLL_FIELD_TYPES: ReadonlySet<number> = new Set([10, 19, 27, 32]);
const HORIZONTAL_RULE = 23;
const SET_TO_LEVEL = 0x2;
const SUBPAGE = 11;
const SECONDARY_PAGE = 18;

export interface LevelControl {
  fieldType: number;
  /** A scroll's own Occurs Level, or a Set to Level rule's chosen level; ignored for the rest. */
  occursLevel: number;
  fieldUse: number;
}

/** True for a control whose own level sets the running level: a scroll, or a Horizontal Rule with Set to Level. */
export function setsLevel(c: LevelControl): boolean {
  return SCROLL_FIELD_TYPES.has(c.fieldType) || (c.fieldType === HORIZONTAL_RULE && (c.fieldUse & SET_TO_LEVEL) !== 0);
}

/** Each control's OCCURSLEVEL, in the order given (tab order). */
export function occursLevels(controls: readonly LevelControl[]): number[] {
  let level = 0;
  return controls.map((c) => {
    if (setsLevel(c)) level = Math.max(0, Math.round(c.occursLevel));
    return level;
  });
}

/**
 * App Designer refuses to save a scroll with nothing in it -- "No data for scroll: PAGE.Scroll Bar." (lv17): after a
 * scroll, before the next scroll or Set to Level rule, there must be a record field or a Subpage / Secondary Page
 * (every delivered scroll without a field of its own holds one). Returns the tab-order index of the first empty
 * scroll, or -1.
 */
export function emptyScroll(controls: ReadonlyArray<LevelControl & { recName: string; fieldName: string }>): number {
  for (let i = 0; i < controls.length; i++) {
    if (!SCROLL_FIELD_TYPES.has(controls[i].fieldType)) continue;
    let data = false;
    for (let j = i + 1; j < controls.length && !setsLevel(controls[j]); j++) {
      const c = controls[j];
      if ((c.recName.trim() && c.fieldName.trim()) || c.fieldType === SUBPAGE || c.fieldType === SECONDARY_PAGE) { data = true; break; }
    }
    if (!data) return i;
  }
  return -1;
}
