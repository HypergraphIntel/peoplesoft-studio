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

/** A control as the page checks see it, in tab order. */
export interface CheckedControl extends LevelControl {
  recName: string;
  fieldName: string;
  /** The record's PSRECDEFN.RECTYPE (2 Derived/Work); -1 when unknown. */
  recType: number;
  /** LBLTEXT, which App Designer names a scroll by ("Scroll Bar"). */
  label: string;
  /** ASSOCFIELDNUM: a related display's control field, as its FIELDNUM - 1 (0: the first control). */
  assocFieldNum?: number;
}

/** One problem App Designer's save reports (Message Set 15), before "Invalid page. Do you still want to save?" (46,2). */
export interface PageProblem {
  set: number;
  num: number;
  text: string;
  /** The tab-order index of the control it names. */
  at: number;
}

const DERIVED_WORK = 2;
const RELATED_DISPLAY = 0x10;

/**
 * App Designer's scroll checks on save (lv05-lv17 and e1-e5 on ZZ_PCODE_LAB_LV). Each is reported as a Message Set 15
 * message, then App Designer asks "Invalid page. Do you still want to save the page?" (46,2) -- Yes saves anyway:
 *  - 15,19 No data for scroll: a scroll with no record field (or Subpage / Secondary Page) after it before the next scroll
 *    or Set to Level rule (lv17; every delivered scroll without a field of its own holds a subpage).
 *  - 15,18 Invalid field level: a scroll more than one level below the running level (e4: a level-3 scroll bar in a
 *    level-1 scroll).
 *  - 15,22 More than one data record in scroll: a field of a second record that is not Derived/Work in one scroll (e1, e2;
 *    a Derived/Work record's fields are allowed, lv18; related displays, FIELDUSE 0x10, are not data). The scroll's primary
 *    record is its first. Level 0 holds any number of records. A Set to Level rule returns to the scroll open at that level.
 *  - 15,17 Invalid related display: a related display whose control field is not before it, or is in another scroll (App
 *    Designer's message; its Related Control Field list offers only control fields before the related field).
 * `pnlName` names the page in the messages, as App Designer does.
 */
export function checkPageScrolls(pnlName: string, controls: readonly CheckedControl[]): PageProblem[] {
  const problems: PageProblem[] = [];
  const isField = (c: CheckedControl) => !!(c.recName.trim() && c.fieldName.trim());
  const scrollName = (c: CheckedControl) => `${pnlName}.${c.label.trim() || 'Scroll'}`;
  // 15,19: each scroll's run up to the next scroll or Set to Level rule.
  for (let i = 0; i < controls.length; i++) {
    if (!SCROLL_FIELD_TYPES.has(controls[i].fieldType)) continue;
    let data = false;
    for (let j = i + 1; j < controls.length && !setsLevel(controls[j]); j++) {
      const c = controls[j];
      if (isField(c) || c.fieldType === SUBPAGE || c.fieldType === SECONDARY_PAGE) { data = true; break; }
    }
    if (!data) problems.push({ set: 15, num: 19, text: `No data for scroll: ${scrollName(controls[i])}.`, at: i });
  }
  // 15,18 and 15,22.
  const { scrolls, scrollOf } = pageScrolls(controls);
  for (const s of scrolls) if (s.level > (s.parent >= 0 ? scrolls.find((x) => x.at === s.parent)!.level : 0) + 1) {
    problems.push({ set: 15, num: 18, text: `Invalid field level: ${scrollName(controls[s.at])}.`, at: s.at });
  }
  const extra = scrolls.flatMap((s) => s.extraRecords).sort((a, b) => a - b)[0];
  if (extra !== undefined) {
    const c = controls[extra];
    problems.push({ set: 15, num: 22, text: `More than one data record in scroll -- make fields from non-primary record related display: ${c.recName.trim()}.${c.fieldName.trim()}.`, at: extra });
  }
  // 15,17: a related display after its control field, in the same scroll.
  controls.forEach((c, i) => {
    if (!(c.fieldUse & RELATED_DISPLAY) || !isField(c)) return;
    const control = c.assocFieldNum ?? 0; // the control field's FIELDNUM - 1: its tab-order index (0 is the first control)
    if (control >= i || scrollOf[control] !== scrollOf[i]) {
      problems.push({ set: 15, num: 17, text: `Invalid related display -- not after control or related to field outside scroll: ${c.recName.trim()}.${c.fieldName.trim()}`, at: i });
    }
  });
  return problems.sort((a, b) => a.at - b.at);
}

/** A scroll on a page: the control that starts it, its level, the scroll it sits in, its primary record. */
export interface PageScroll {
  /** The scroll control's tab-order index. */
  at: number;
  level: number;
  /** The enclosing scroll's index (`at`), or -1 at level 0. */
  parent: number;
  /** Its first record that is not Derived/Work (the rowset's record, as the component's Structure tab names it); '' none. */
  primary: string;
  /** Fields of another data record in it (App Designer's 15,22), by tab-order index. */
  extraRecords: number[];
}

/**
 * Which scroll each control is in: the controls in tab order with their levels (occursLevels); a scroll closes the
 * scrolls open at its level or deeper, a Set to Level rule those deeper than its level -- the controls at that level
 * after it are in the scroll open there again (ZZ_PCODE_LAB_LV: ZZ_R_L1_A.ZZ_KEY0 after the rule is in the Scroll Area).
 * `scrollOf[i]` is the index of control i's scroll, -1 at level 0 (or at a level no scroll is open at).
 */
export function pageScrolls(controls: readonly CheckedControl[]): { scrolls: PageScroll[]; scrollOf: number[]; levels: number[] } {
  const levels = occursLevels(controls);
  const scrolls: PageScroll[] = [];
  const open: PageScroll[] = [];
  const scrollOf: number[] = [];
  controls.forEach((c, i) => {
    const level = levels[i];
    if (SCROLL_FIELD_TYPES.has(c.fieldType)) {
      while (open.length && open[open.length - 1].level >= level) open.pop();
      const s: PageScroll = { at: i, level, parent: open.length ? open[open.length - 1].at : -1, primary: '', extraRecords: [] };
      scrolls.push(s); open.push(s);
    } else if (setsLevel(c)) {
      while (open.length && open[open.length - 1].level > level) open.pop();
    }
    const owner = open.length && open[open.length - 1].level === level ? open[open.length - 1] : undefined;
    scrollOf[i] = owner ? owner.at : -1;
    if (!owner || SCROLL_FIELD_TYPES.has(c.fieldType) || !(c.recName.trim() && c.fieldName.trim()) || (c.fieldUse & RELATED_DISPLAY) || c.recType === DERIVED_WORK) return;
    const rec = c.recName.trim();
    if (!owner.primary) owner.primary = rec;
    else if (owner.primary !== rec) owner.extraRecords.push(i);
  });
  return { scrolls, scrollOf, levels };
}

/** The first empty scroll's tab-order index (15,19), or -1. */
export function emptyScroll(controls: ReadonlyArray<LevelControl & { recName: string; fieldName: string }>): number {
  const p = checkPageScrolls('', controls.map((c) => ({ ...c, recType: -1, label: '' }))).find((x) => x.num === 19);
  return p ? p.at : -1;
}
