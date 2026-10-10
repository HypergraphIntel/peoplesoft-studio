import { COMPONENT_ACTIONS, type Row } from './uiDefinitions.js';
import type { ComponentStructure } from './componentStructure.js';
import { componentPrograms, type ComponentProgram } from './componentPeopleCode.js';
import {
  COMPONENT_TYPES, DISABLE_PAGEBAR, DISPLAY_FOLDER_TABS, DISPLAY_HYPERLINKS, PAGEBAR_LINKS, PAGE_NAVIGATION_IN_HISTORY, PRIMARY_ACTIONS,
  RETURN_TO_LAST_PAGE_IN_HISTORY, SEARCH_PAGE_TYPES, SEARCH_TYPES, SHOW_TOOLBAR, TOOLBAR_BUTTONS, HEADER_ACTION_BITS, HEADER_ACTIONS_ORDER
} from './componentFlags.js';

/*
 * A component as App Designer's component window shows it: the Definition
 * grid (PSPNLGROUP, one row per page item), the Structure tab
 * (componentStructure.ts) and Component Properties (PSPNLGRPDEFN,
 * PSPNLGRPDEFNEXT). Read-only.
 *
 * Each property is mapped to the dialog where App Designer's Component
 * Properties for JOB_DATA.GBL on HRDMO shows the stored value
 * (docs/COMPONENTS.md). The toolbar (TBARBTNS), page-bar and multi-page
 * navigation (PNLNAVFLAGS) and PNLGRPUSE are bit-masks whose bits are not
 * yet tied to their check boxes: they are shown as stored until controlled
 * App Designer saves decode them.
 */

const str = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => Number(v ?? 0);
const yes = (v: unknown) => num(v) !== 0;

/** A Definition-grid row. */
export interface ComponentItem {
  /** PSPNLGROUP.SUBITEMNUM: the order. */
  num: number;
  pageName: string;
  itemName: string;
  hidden: boolean;
  itemLabel: string;
  folderTabLabel: string;
  /** Allow Deferred Processing: the page's own PSPNLDEFN.DEFERPROC (as App Designer's grid shows it). */
  deferred: boolean;
}

/** A labelled value, or a stored code whose meaning is not established. */
export type Choice = { label: string } | { code: number };

export interface MessageRef { set: number; number: number; default?: boolean }

export interface ComponentProperties {
  general: { description: string; comments: string; ownerId: string; lastUpdated: string; lastUpdatedBy: string; version: number };
  use: {
    searchRecord: string;
    /** ADDSRCHRECNAME; App Designer shows it blank when it is the search record. */
    addSearchRecord: string;
    forceSearch: boolean;
    detailPage: string;
    contextSearchRecord: string;
    actions: { add: boolean; updateDisplay: boolean; updateDisplayAll: boolean; correction: boolean };
    disableSave: boolean;
    includeInNavigation: boolean;
    build: Choice;
    save: Choice;
  };
  internet: {
    primaryAction: Choice;
    defaultSearchAction: Choice;
    defaultSearchType: Choice;
    allowActionModeSelection: boolean;
    addLink: MessageRef;
    findLink: MessageRef;
    realtimeLink: MessageRef;
    keywordLink: MessageRef;
    instructions: MessageRef;
    deferred: boolean;
    expertEntry: boolean;
    wsrpCompliant: boolean;
    showToolbar: boolean;
    /** The Toolbar boxes (TBARBTNS), in the dialog's order. */
    toolbar: Array<{ label: string; bit: number; on: boolean }>;
    /** Multi-Page Navigation (PNLNAVFLAGS; the history boxes are TBARBTNS bits, shared with the Fluid tab). */
    folderTabs: boolean;
    hyperlinks: boolean;
    pageNavigationInHistory: boolean;
    returnToLastPageInHistory: boolean;
    /** The Pagebar (SHOWTBAR hide bits). */
    pagebar: Array<{ label: string; bit: number; on: boolean }>;
    disablePagebar: boolean;
    /** As stored, for the writer (bits not named are kept). */
    toolbarButtons: number;
    navigationFlags: number;
    showToolbarFlags: number;
    searchCategory: string;
  };
  fluid: {
    fluidMode: boolean; layoutOnly: boolean; smallFormFactor: boolean;
    /** INCHEADER / INCSIDE: set when the No System Header / Side Page box is checked. */
    noSystemHeader: boolean; noSystemSide: boolean;
    componentType: Choice; searchPageType: Choice;
    /** PSPNLGRPDEFNEXT.PTS_ENABLECONFSRCH. */
    configurableSearch: boolean;
    /** Header Toolbar Actions in the dialog's order (componentFlags.ts says where each is stored). */
    headerActions: Array<{ label: string; on: boolean }>;
    /** Disable All Actions: the toolbar not shown (SHOWTBAR 0x1 clear), as the Internet tab's Disable Toolbar. */
    disableAllActions: boolean;
    usage: number;
  };
  /**
   * The Style tab (shown only when Fluid Mode is off): PSPNLGRPSCRIPTS rows, PTSCRIPTTYPE CSS (freeform style
   * sheets) or JS (HTML definitions), in SEQNO order per type; PTSCRIPTCATG DEV are the Component lists, any
   * other category the Custom ones. Classic Plus is PNLGRPUSE 0x1 (s406).
   */
  style: { classicPlus: boolean; styleSheets: string[]; javaScripts: string[]; customStyleSheets: string[]; customJavaScripts: string[] };
}

export interface ComponentDefinition {
  name: string;
  market: string;
  items: ComponentItem[];
  properties: ComponentProperties;
  structure: ComponentStructure;
  /** Records with record-level component PeopleCode (App Designer marks them in the Structure tab). */
  peopleCodeRecords: string[];
  /** The component's own PeopleCode events (PreBuild, SavePreChange ...). */
  peopleCodeEvents: string[];
  /** Every component program: component, record and record-field PeopleCode (View PeopleCode). */
  programs: ComponentProgram[];
  /** Menus the component is registered on. */
  menus: string[];
}

/** LOADLOC / SAVELOC: 0 is "Default (application server)" (JOB_DATA); other codes are shown as stored. */
const location = (v: unknown): Choice => (num(v) === 0 ? { label: 'Default (application server)' } : { code: num(v) });
const choice = (v: unknown, labels: Record<number, string>): Choice => (labels[num(v)] !== undefined ? { label: labels[num(v)] } : { code: num(v) });

export interface ComponentRows {
  defn: Row;
  ext?: Row;
  /** PSPNLGROUP rows, each with the page's DEFERPROC as PAGEDEFERPROC. */
  items: Row[];
  menus: Row[];
  /** PSPCMPROG keys of the component's programs: OBJECTID3..5 / OBJECTVALUE3..5. */
  programs: Row[];
  /** PSPNLGRPSCRIPTS rows (the Style tab). */
  scripts?: Row[];
}

export function buildComponentDefinition(name: string, market: string, rows: ComponentRows, structure: ComponentStructure): ComponentDefinition {
  const d = rows.defn, x = rows.ext ?? {};
  const actions = num(d.ACTIONS);
  const has = (label: string) => (actions & (COMPONENT_ACTIONS.find(([, l]) => l === label)?.[0] ?? 0)) !== 0;
  const msg = (set: unknown, n: unknown): MessageRef => ({ set: num(set), number: num(n) });
  // Real-time and keyword search links stored 0 / 0 show App Designer's defaults (JOB_DATA: 124/63 and 124/433).
  const realtime = num(x.PTRTSRCHLINKMSGSET) ? msg(x.PTRTSRCHLINKMSGSET, x.PTRTSRCHLINKMSGNUM)
    : { ...msg(d.SRCHLINKMSGSET, d.SRCHLINKMSGNUM), default: true };
  const keyword = num(x.PTKEYWDSRCHMSGSET) ? msg(x.PTKEYWDSRCHMSGSET, x.PTKEYWDSRCHMSGNUM) : { set: 124, number: 433, default: true };
  const search = str(d.SEARCHRECNAME), addSearch = str(d.ADDSRCHRECNAME);
  const programs = componentPrograms(rows.programs);

  return {
    name, market,
    items: [...rows.items].sort((a, b) => num(a.SUBITEMNUM) - num(b.SUBITEMNUM)).map((r) => ({
      num: num(r.SUBITEMNUM), pageName: str(r.PNLNAME), itemName: str(r.ITEMNAME), hidden: yes(r.HIDDEN),
      itemLabel: str(r.ITEMLABEL), folderTabLabel: str(r.FOLDERTABLABEL), deferred: yes(r.PAGEDEFERPROC)
    })),
    properties: {
      general: {
        description: str(d.DESCR), comments: str(d.DESCRLONG), ownerId: str(d.OBJECTOWNERID),
        lastUpdated: str(d.LASTUPD) || str(d.LASTUPDDTTM), lastUpdatedBy: str(d.LASTUPDOPRID), version: num(d.VERSION)
      },
      use: {
        searchRecord: search, addSearchRecord: addSearch === search ? '' : addSearch, forceSearch: yes(d.FORCESEARCH),
        detailPage: str(d.SEARCHPNLNAME), contextSearchRecord: str(x.PTCTXSEARCHRECNAME),
        actions: { add: has('Add'), updateDisplay: has('Update/Display'), updateDisplayAll: has('Update/Display All'), correction: has('Correction') },
        disableSave: yes(d.DISABLESAVE), includeInNavigation: yes(d.INCLNAVIGATION),
        build: location(d.LOADLOC), save: location(d.SAVELOC)
      },
      internet: {
        primaryAction: choice(d.PRIMARYACTION, PRIMARY_ACTIONS),
        defaultSearchAction: choice(d.DFLTACTION, { 1: 'Update/Display' }),
        defaultSearchType: choice(d.DFLTSRCHTYPE, SEARCH_TYPES),
        allowActionModeSelection: yes(d.ALLOWACTMODESEL),
        addLink: msg(d.ADDLINKMSGSET, d.ADDLINKMSGNUM), findLink: msg(d.SRCHLINKMSGSET, d.SRCHLINKMSGNUM),
        realtimeLink: realtime, keywordLink: keyword, instructions: msg(d.SRCHTEXTMSGSET, d.SRCHTEXTMSGNUM),
        deferred: yes(d.DEFERPROC), expertEntry: yes(d.EXPENTRYPROC), wsrpCompliant: yes(d.WSRPCOMPLIANT),
        showToolbar: (num(d.SHOWTBAR) & SHOW_TOOLBAR) !== 0,
        // App Designer shows Save unchecked while Disable Saving Page is on, whatever the bit, and its next save clears the bit (i352 / i353, w03).
        toolbar: TOOLBAR_BUTTONS.map(([bit, label]) => ({ label, bit, on: (num(d.TBARBTNS) & bit) !== 0 && !(bit === 0x1 && yes(d.DISABLESAVE)) })),
        folderTabs: (num(d.PNLNAVFLAGS) & DISPLAY_FOLDER_TABS) !== 0, hyperlinks: (num(d.PNLNAVFLAGS) & DISPLAY_HYPERLINKS) !== 0,
        pageNavigationInHistory: (num(d.TBARBTNS) & PAGE_NAVIGATION_IN_HISTORY) !== 0,
        returnToLastPageInHistory: (num(d.TBARBTNS) & RETURN_TO_LAST_PAGE_IN_HISTORY) !== 0,
        pagebar: PAGEBAR_LINKS.map(([bit, label]) => ({ label, bit, on: (num(d.SHOWTBAR) & bit) === 0 })),
        disablePagebar: (num(d.SHOWTBAR) & DISABLE_PAGEBAR) !== 0,
        toolbarButtons: num(d.TBARBTNS), navigationFlags: num(d.PNLNAVFLAGS), showToolbarFlags: num(d.SHOWTBAR),
        searchCategory: str(x.PTSF_SRCCAT_NAME)
      },
      fluid: {
        fluidMode: yes(d.FLUIDMODE), layoutOnly: yes(d.LAYOUTMODE), smallFormFactor: yes(d.SMALLFFOPT),
        noSystemHeader: yes(d.INCHEADER), noSystemSide: yes(d.INCSIDE),
        componentType: choice(d.COMP_TYPE, COMPONENT_TYPES), searchPageType: choice(d.INCSEARCH, SEARCH_PAGE_TYPES),
        configurableSearch: yes(x.PTS_ENABLECONFSRCH), usage: num(d.PNLGRPUSE),
        headerActions: HEADER_ACTIONS_ORDER.map((label) => {
          const bit = HEADER_ACTION_BITS.find(([, l]) => l === label)?.[0];
          const on = bit !== undefined ? (num(d.TBARBTNS) & bit) !== 0
            : label === 'Help' ? (num(d.SHOWTBAR) & 0x4) === 0
            : label === 'New Window' ? (num(d.SHOWTBAR) & 0x10) === 0
            : yes(x.PTENABLENOTIFY);
          return { label, on };
        }),
        disableAllActions: (num(d.SHOWTBAR) & SHOW_TOOLBAR) === 0
      },
      style: (() => {
        const scripts = [...(rows.scripts ?? [])].filter((r) => str(r.PTSCRIPTNAME)).sort((a, b) => num(a.SEQNO) - num(b.SEQNO));
        const list = (type: string, dev: boolean) => scripts.filter((r) => str(r.PTSCRIPTTYPE) === type && (str(r.PTSCRIPTCATG) === 'DEV') === dev)
          .map((r) => str(r.PTSCRIPTNAME));
        return { classicPlus: (num(d.PNLGRPUSE) & 0x1) !== 0, styleSheets: list('CSS', true), javaScripts: list('JS', true),
          customStyleSheets: list('CSS', false), customJavaScripts: list('JS', false) };
      })()
    },
    structure,
    // App Designer marks records with record-level component PeopleCode (not those with field PeopleCode only).
    peopleCodeRecords: [...new Set(programs.filter((p) => p.record && !p.field).map((p) => p.record!))],
    peopleCodeEvents: programs.filter((p) => !p.record).map((p) => p.event),
    programs,
    menus: rows.menus.map((m) => `${str(m.MENUNAME)}.${str(m.BARNAME)}.${str(m.ITEMNAME)}`)
  };
}

/**
 * Why a component cannot be saved, or undefined when it can. App Designer
 * does not save a component without a search record (Component Properties >
 * Use), and neither does PeopleSoft Studio: the component writer refuses with
 * this message before anything is written.
 */
export function componentSaveRefusal(component: { name: string; searchRecord: string }): string | undefined {
  if (!component.searchRecord.trim()) {
    return `${component.name} has no search record. Add one in Component Properties > Use before saving; a component cannot be saved without it.`;
  }
  return undefined;
}
