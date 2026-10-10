/*
 * Component Properties' Internet and Fluid tabs, decoded from one App Designer
 * save per control on ZZ_PCODE_LAB_CMP (tools/corpus/save-protocol/results
 * i336-i372, x373-x377, f378-f387, h389-h398; docs/COMPONENTS.md). Each bit is the one
 * that changed when that control alone was toggled, and together they give
 * JOB_DATA.GBL's stored values exactly what App Designer shows for it (its 13
 * checked toolbar boxes are TBARBTNS 0x1FBE3's 13 bits).
 */

/** PSPNLGRPDEFN.TBARBTNS: the Internet tab's Toolbar boxes, in the dialog's order. */
export const TOOLBAR_BUTTONS: ReadonlyArray<readonly [number, string]> = [
  [0x1, 'Save'], [0x10000, 'Cancel'], [0x20000, 'Spell Check'], [0x2, 'Return to List'], [0x100, 'Next in List'],
  [0x200, 'Previous in List'], [0x4, 'Next Page in Component'], [0x8, 'Previous Page in Component'], [0x10000000, 'Hide Back Button'],
  [0x800, 'Refresh'], [0x8000, 'Notify'], [0x1000, 'View WorkList'], [0x2000, 'Next in WorkList'], [0x4000, 'Previous in WorkList'],
  // The action buttons are the Use tab's action bit x 16: Add 0x10, Update/Display 0x20, Update/Display All 0x40, Correction 0x80.
  [0x10, 'Add'], [0x20, 'Update/Display'], [0x40, 'Update/Display All'], [0x80, 'Correction']
];

/** TBARBTNS also holds the history settings the Internet and Fluid tabs share (toggling either tab's box moved the same bit). */
export const PAGE_NAVIGATION_IN_HISTORY = 0x4000000;
export const RETURN_TO_LAST_PAGE_IN_HISTORY = 0x20000000;

/** The Fluid tab's Header Toolbar Actions that are TBARBTNS bits (set: checked). */
export const HEADER_ACTION_BITS: ReadonlyArray<readonly [number, string]> = [
  [0x80000, 'Logout'], [0x40000, 'Home'], [0x100000, 'Back'], [0x800000, 'Notifications'], [0x200000, 'NavBar'], [0x1000000, 'Add To']
];

/**
 * The rest of the Header Toolbar Actions are settings the Internet tab shows too:
 * Help and New Window are the Pagebar's Help Link and New Window Link
 * (SHOWTBAR hide bits 0x4 / 0x10), Disable All Actions is Disable Toolbar
 * (SHOWTBAR 0x1 clear), and Notify is PSPNLGRPDEFNEXT.PTENABLENOTIFY.
 */
export const HEADER_ACTIONS_ORDER = ['Logout', 'Home', 'Back', 'Help', 'Notify', 'Notifications', 'NavBar', 'Add To', 'New Window'] as const;

/** The TBARBTNS bits this module names; the others are kept as stored. */
export const KNOWN_TOOLBAR_BITS = [...TOOLBAR_BUTTONS, ...HEADER_ACTION_BITS].reduce((m, [b]) => m | b, 0) |
  PAGE_NAVIGATION_IN_HISTORY | RETURN_TO_LAST_PAGE_IN_HISTORY;

/** PSPNLGRPDEFN.PNLNAVFLAGS: Multi-Page Navigation. */
export const DISPLAY_FOLDER_TABS = 0x1;
export const DISPLAY_HYPERLINKS = 0x2;

/**
 * PSPNLGRPDEFN.SHOWTBAR: 0x1 the toolbar is shown (Disable Toolbar clears it);
 * the Pagebar boxes are "hide" bits (a new component's 1 shows every link).
 */
export const SHOW_TOOLBAR = 0x1;
export const DISABLE_PAGEBAR = 0x2;
export const PAGEBAR_LINKS: ReadonlyArray<readonly [number, string]> = [
  [0x4, 'Help Link'], [0x8, 'Copy URL Link'], [0x10, 'New Window Link'], [0x20, 'Customize Page Link']
];

/** Single-valued codes, as App Designer names them. */
export const PRIMARY_ACTIONS: Readonly<Record<number, string>> = { 0: 'New', 1: 'Search' };
export const SEARCH_TYPES: Readonly<Record<number, string>> = { 0: 'Basic', 1: 'Advanced' };
export const COMPONENT_TYPES: Readonly<Record<number, string>> = { 0: 'Standard', 2: 'Master/Detail' };
/** PSPNLGRPDEFN.INCSEARCH: the Fluid tab's Search Page Type. */
export const SEARCH_PAGE_TYPES: Readonly<Record<number, string>> = { 0: 'None', 1: 'Standard', 2: 'Master/Detail' };

/** Sets or clears a bit. */
export const withBit = (value: number, bit: number, on: boolean) => (on ? value | bit : value & ~bit);
