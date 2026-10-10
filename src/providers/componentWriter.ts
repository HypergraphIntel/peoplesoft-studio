import type { DbConnection as Connection } from '../db/connection.js';
import { writeScopeRefusal } from './writeScope.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { componentSaveRefusal } from '../model/componentDefinition.js';
import {
  DISABLE_PAGEBAR, DISPLAY_FOLDER_TABS, DISPLAY_HYPERLINKS, HEADER_ACTION_BITS, PAGEBAR_LINKS, PAGE_NAVIGATION_IN_HISTORY,
  RETURN_TO_LAST_PAGE_IN_HISTORY, SHOW_TOOLBAR, TOOLBAR_BUTTONS, withBit
} from '../model/componentFlags.js';

/*
 * Saving a component as App Designer does, reproduced from nine controlled
 * App Designer saves of ZZ_PCODE_LAB_CMP on HRDMO
 * (tools/corpus/save-protocol/results/c01-c08b, docs/COMPONENTS.md):
 *
 *   PSVERSION / PSLOCK 'PGM' + 1 and PSVERSION 'SYS' + 1 on every save; on a
 *                       save of an existing component also PSVERSION / PSLOCK
 *                       'MDM' + 1 (c02-c08b; not on create, c01).
 *   PSPNLGRPDEFN        VERSION = the new PGM, LASTUPDDTTM / LASTUPDOPRID; the
 *                       changed properties (DESCR, DESCRLONG c07; ACTIONS c08a;
 *                       DISABLESAVE c08b ...). A new component is App
 *                       Designer's default row (c01).
 *   PSPNLGROUP          one row per page item, keyed by page (PNLNAME): an
 *                       inserted page (c02), changed labels (c03) / Hidden
 *                       (c04), SUBITEMNUM 1..N in the grid's order (c05, and
 *                       renumbered after a delete, c06).
 *
 * Two properties carry toolbar bits with them (TBARBTNS): checking Add sets
 * 0x10 (the Add button, c08a); checking Disable Saving Page clears 0x1 (the
 * Save button, c08b); unchecking does the reverse.
 *
 * App Designer deletes and re-inserts every row on a save; the writer updates
 * in place and leaves the same rows. A component without a search record is
 * never saved (componentSaveRefusal).
 */

export class ComponentSaveRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComponentSaveRefusedError';
  }
}

/** A Definition-grid row as edited. */
export interface ComponentItemEdit {
  pageName: string;
  itemName: string;
  itemLabel: string;
  folderTabLabel: string;
  hidden: boolean;
}

/** The Component Properties the editor sets. */
export interface ComponentPropertyEdits {
  description: string;
  comments: string;
  searchRecord: string;
  /** Blank: the search record (App Designer stores it so). */
  addSearchRecord: string;
  detailPage: string;
  forceSearch: boolean;
  actions: { add: boolean; updateDisplay: boolean; updateDisplayAll: boolean; correction: boolean };
  disableSave: boolean;
  includeInNavigation: boolean;
  /** The Internet tab, decoded (componentFlags.ts); absent leaves it as stored. */
  internet?: ComponentInternetEdits;
  /** The Fluid tab, decoded; absent leaves it as stored. */
  fluid?: ComponentFluidEdits;
  /** The Style tab's Component lists and Classic Plus; absent leaves them as stored. */
  style?: { classicPlus: boolean; styleSheets: string[]; javaScripts: string[] };
}

/** Internet tab edits. Toolbar and pagebar boxes by their dialog labels; a box not named is left as stored. */
export interface ComponentInternetEdits {
  primaryAction: number;
  defaultSearchType: number;
  allowActionModeSelection: boolean;
  deferred: boolean;
  expertEntry: boolean;
  wsrpCompliant: boolean;
  disableToolbar: boolean;
  toolbar: Record<string, boolean>;
  folderTabs: boolean;
  hyperlinks: boolean;
  pageNavigationInHistory: boolean;
  returnToLastPageInHistory: boolean;
  pagebar: Record<string, boolean>;
  disablePagebar: boolean;
}

/** Fluid tab edits. Header Toolbar Actions by label; Help, New Window and Disable All Actions are the Internet tab's settings too. */
export interface ComponentFluidEdits {
  fluidMode: boolean;
  layoutOnly: boolean;
  smallFormFactor: boolean;
  noSystemHeader: boolean;
  noSystemSide: boolean;
  componentType: number;
  searchPageType: number;
  configurableSearch: boolean;
  headerActions: Record<string, boolean>;
  disableAllActions: boolean;
}

export interface ComponentSaveRequest {
  name: string;
  market: string;
  /** PSPNLGRPDEFN.VERSION when opened; absent creates the component (refused if it exists). */
  openedVersion?: number;
  operatorId: string;
  /** The pages in grid order. */
  items: ComponentItemEdit[];
  properties: ComponentPropertyEdits;
}

export interface ComponentSaveResult {
  version: number;
  created: boolean;
}

type Value = number | string | null;

/** App Designer's new component row (c01), before its name, description, search records and actions. */
const NEW_COMPONENT: Readonly<Record<string, Value>> = {
  SEARCHPNLNAME: ' ', LOADLOC: 0, SAVELOC: 0, DISABLESAVE: 0, OBJECTOWNERID: ' ', PRIMARYACTION: 1, DFLTACTION: 1,
  DFLTSRCHTYPE: 0, DEFERPROC: 1, EXPENTRYPROC: 0, REQSECURESSL: 0, INCLNAVIGATION: 1, FORCESEARCH: 0, ALLOWACTMODESEL: 1,
  PNLNAVFLAGS: 3, TBARBTNS: 29225763, SHOWTBAR: 1, ADDLINKMSGSET: 124, ADDLINKMSGNUM: 62, SRCHLINKMSGSET: 124,
  SRCHLINKMSGNUM: 63, SRCHTEXTMSGSET: 124, SRCHTEXTMSGNUM: 50, WSRPCOMPLIANT: 0, FLUIDMODE: 0, LAYOUTMODE: 0,
  INCFOOTER: 0, INCSIDE: 0, INCHEADER: 0, INCSEARCH: 0, SMALLFFOPT: 0, COMP_TYPE: 0, PNLGRPUSE: 0
};

/** App Designer's first PSPNLGRPDEFNEXT row for a component (i340), before what the save sets. */
const NEW_EXTENSION: Readonly<Record<string, Value>> = {
  PTCTXSEARCHRECNAME: ' ', PTSF_SRCCAT_NAME: ' ', PTSF_SRCH_CRITERIA: ' ', PTKEYWDSRCHMSGSET: 0, PTKEYWDSRCHMSGNUM: 0,
  PTRTSRCHLINKMSGSET: 0, PTRTSRCHLINKMSGNUM: 0, PTPG_PGRIDNAME: ' ', PTPG_VIEWNAME: ' ', PTENABLENOTIFY: 0, PTS_ENABLECONFSRCH: 0
};

const TOOLBAR_SAVE = 0x1;
const TOOLBAR_ADD = 0x10;

/** The Item Label App Designer gives an inserted page: its name in title case ("ZZ_PCODE_LAB_PG2" -> "Zz Pcode Lab Pg2", c01 / c02). */
export function defaultItemLabel(pageName: string): string {
  return pageName.trim().split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

const blank = (s: string) => (s.trim() ? s.trim() : ' ');
const str = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => Number(v ?? 0);

/** Why the request cannot be saved as it stands, before anything is read. */
export function componentRequestRefusal(request: ComponentSaveRequest): string | undefined {
  const search = componentSaveRefusal({ name: request.name, searchRecord: request.properties.searchRecord });
  if (search) return search;
  if (!/^[A-Z0-9_#$@]{1,18}$/.test(request.name)) return `${request.name} is not a component name.`;
  if (request.properties.description.trim().length > 30) return 'The description is at most 30 characters.';
  const pages = request.items.map((i) => i.pageName.trim().toUpperCase());
  const dup = pages.find((p, i) => pages.indexOf(p) !== i);
  if (dup) return `${dup} is in the component twice; a page is in a component once.`;
  for (const [what, list] of [['style sheet', request.properties.style?.styleSheets], ['JavaScript object', request.properties.style?.javaScripts]] as const) {
    const names = (list ?? []).map((n) => n.trim().toUpperCase());
    const twice = names.find((n, i) => names.indexOf(n) !== i);
    if (twice) return `The ${what} ${twice} is listed twice.`;
  }
  for (const i of request.items) {
    if (!i.pageName.trim()) return 'A page item has no page.';
    if (!i.itemName.trim()) return `${i.pageName} has no item name.`;
  }
  return undefined;
}

export interface ComponentPlan {
  /** PSPNLGRPDEFN columns to set (an update), or the whole row (a create), less VERSION and the stamp. */
  defn: Record<string, Value>;
  /** PSPNLGRPDEFNEXT columns to set (Notify, Configurable Search); the row is created when there is none. */
  ext: Record<string, Value>;
  /** Style lists that changed: their PSPNLGRPSCRIPTS rows (category DEV) are rewritten, SEQNO 0, 10, 20 ... (s400-s405). */
  scripts: Array<{ type: 'CSS' | 'JS'; names: string[] }>;
  /** PSPNLGROUP rows by page: removed, added (whole rows less the key), changed columns. */
  deletes: string[];
  inserts: Array<Record<string, Value>>;
  updates: Array<{ pageName: string; columns: Record<string, Value> }>;
}

/** The change from the stored component (absent when new) to the edited one. Pure. */
export function planComponentSave(stored: { defn: Record<string, unknown>; items: Array<Record<string, unknown>>; ext?: Record<string, unknown>;
  scripts?: Array<Record<string, unknown>> } | undefined,
  request: ComponentSaveRequest): ComponentPlan {
  const p = request.properties;
  const actions = (p.actions.add ? 1 : 0) | (p.actions.updateDisplay ? 2 : 0) | (p.actions.updateDisplayAll ? 4 : 0) | (p.actions.correction ? 8 : 0);
  const search = p.searchRecord.trim().toUpperCase();
  const wanted: Record<string, Value> = {
    DESCR: blank(p.description), DESCRLONG: p.comments.trim() ? p.comments.replace(/\r?\n/g, '\r\n') : null,
    SEARCHRECNAME: search, ADDSRCHRECNAME: p.addSearchRecord.trim() ? p.addSearchRecord.trim().toUpperCase() : search,
    SEARCHPNLNAME: blank(p.detailPage.toUpperCase()), FORCESEARCH: p.forceSearch ? 1 : 0, ACTIONS: actions,
    DISABLESAVE: p.disableSave ? 1 : 0, INCLNAVIGATION: p.includeInNavigation ? 1 : 0
  };
  const oldActions = stored ? num(stored.defn.ACTIONS) : 0;
  const oldDisable = stored ? num(stored.defn.DISABLESAVE) !== 0 : false;
  let toolbar = stored ? num(stored.defn.TBARBTNS) : num(NEW_COMPONENT.TBARBTNS);
  // Without the Internet tab's boxes, the Use tab's Add and Disable Saving Page carry their toolbar bits as App Designer does (c08a / c08b);
  // with them (the editor applies the same rules as the boxes change), the boxes are what is saved.
  if (!p.internet) {
    if (stored) {
      if ((actions & 1) !== (oldActions & 1)) toolbar = actions & 1 ? toolbar | TOOLBAR_ADD : toolbar & ~TOOLBAR_ADD;
      if (p.disableSave !== oldDisable) toolbar = p.disableSave ? toolbar & ~TOOLBAR_SAVE : toolbar | TOOLBAR_SAVE;
    } else {
      if (actions & 1) toolbar |= TOOLBAR_ADD;
      if (p.disableSave) toolbar &= ~TOOLBAR_SAVE;
    }
  }
  let showToolbar = stored ? num(stored.defn.SHOWTBAR) : num(NEW_COMPONENT.SHOWTBAR);
  let navigation = stored ? num(stored.defn.PNLNAVFLAGS) : num(NEW_COMPONENT.PNLNAVFLAGS);
  const ext: Record<string, Value> = {};
  if (p.internet) {
    const i = p.internet;
    for (const [bit, label] of TOOLBAR_BUTTONS) if (label in i.toolbar) toolbar = withBit(toolbar, bit, i.toolbar[label]);
    toolbar = withBit(toolbar, PAGE_NAVIGATION_IN_HISTORY, i.pageNavigationInHistory);
    toolbar = withBit(toolbar, RETURN_TO_LAST_PAGE_IN_HISTORY, i.returnToLastPageInHistory);
    navigation = withBit(withBit(navigation, DISPLAY_FOLDER_TABS, i.folderTabs), DISPLAY_HYPERLINKS, i.hyperlinks);
    for (const [bit, label] of PAGEBAR_LINKS) if (label in i.pagebar) showToolbar = withBit(showToolbar, bit, !i.pagebar[label]);
    showToolbar = withBit(withBit(showToolbar, DISABLE_PAGEBAR, i.disablePagebar), SHOW_TOOLBAR, !i.disableToolbar);
    Object.assign(wanted, {
      PRIMARYACTION: i.primaryAction, DFLTSRCHTYPE: i.defaultSearchType, ALLOWACTMODESEL: i.allowActionModeSelection ? 1 : 0,
      DEFERPROC: i.deferred ? 1 : 0, EXPENTRYPROC: i.expertEntry ? 1 : 0, WSRPCOMPLIANT: i.wsrpCompliant ? 1 : 0
    });
  }
  if (p.fluid) {
    const f = p.fluid;
    for (const [bit, label] of HEADER_ACTION_BITS) if (label in f.headerActions) toolbar = withBit(toolbar, bit, f.headerActions[label]);
    // Help and New Window are the Pagebar links' hide bits; Disable All Actions is Disable Toolbar; Notify is the extension row's.
    if ('Help' in f.headerActions) showToolbar = withBit(showToolbar, 0x4, !f.headerActions.Help);
    if ('New Window' in f.headerActions) showToolbar = withBit(showToolbar, 0x10, !f.headerActions['New Window']);
    showToolbar = withBit(showToolbar, SHOW_TOOLBAR, !f.disableAllActions);
    Object.assign(wanted, {
      FLUIDMODE: f.fluidMode ? 1 : 0, LAYOUTMODE: f.layoutOnly ? 1 : 0, SMALLFFOPT: f.smallFormFactor ? 1 : 0,
      INCHEADER: f.noSystemHeader ? 1 : 0, INCSIDE: f.noSystemSide ? 1 : 0, COMP_TYPE: f.componentType, INCSEARCH: f.searchPageType
    });
    const extWanted: Record<string, number> = { PTS_ENABLECONFSRCH: f.configurableSearch ? 1 : 0 };
    if ('Notify' in f.headerActions) extWanted.PTENABLENOTIFY = f.headerActions.Notify ? 1 : 0;
    // Turning Fluid Mode off clears the fluid-only Notify and Configurable Search, as App Designer does (s399).
    if (!f.fluidMode) { extWanted.PTS_ENABLECONFSRCH = 0; extWanted.PTENABLENOTIFY = 0; }
    for (const [col, v] of Object.entries(extWanted)) if (num(stored?.ext?.[col]) !== v) ext[col] = v;
  }

  // Theme Selection > Classic Plus is PNLGRPUSE 0x1 (s406).
  if (p.style) wanted.PNLGRPUSE = withBit(stored ? num(stored.defn.PNLGRPUSE) : num(NEW_COMPONENT.PNLGRPUSE), 0x1, p.style.classicPlus);
  let defn: Record<string, Value>;
  if (!stored) {
    defn = { ...NEW_COMPONENT, ...wanted, TBARBTNS: toolbar, SHOWTBAR: showToolbar, PNLNAVFLAGS: navigation };
  } else {
    defn = {};
    const same = (col: string, v: Value) => {
      const old = stored.defn[col];
      return v === null ? old === null || old === undefined || str(old) === '' : typeof v === 'number' ? num(old) === v : str(old) === str(v);
    };
    for (const [col, v] of Object.entries(wanted)) if (!same(col, v)) defn[col] = v;
    if (toolbar !== num(stored.defn.TBARBTNS)) defn.TBARBTNS = toolbar;
    if (showToolbar !== num(stored.defn.SHOWTBAR)) defn.SHOWTBAR = showToolbar;
    if (navigation !== num(stored.defn.PNLNAVFLAGS)) defn.PNLNAVFLAGS = navigation;
  }

  const scripts: ComponentPlan['scripts'] = [];
  if (p.style) {
    const was = (type: string) => (stored?.scripts ?? []).filter((r) => str(r.PTSCRIPTTYPE) === type && str(r.PTSCRIPTCATG) === 'DEV')
      .sort((a, b) => num(a.SEQNO) - num(b.SEQNO)).map((r) => str(r.PTSCRIPTNAME));
    for (const [type, names] of [['CSS', p.style.styleSheets], ['JS', p.style.javaScripts]] as const) {
      const now = names.map((n) => n.trim().toUpperCase()).filter(Boolean);
      if (now.join('|') !== was(type).join('|')) scripts.push({ type, names: now });
    }
  }

  const old = new Map((stored?.items ?? []).map((r) => [str(r.PNLNAME), r]));
  const keep = new Set(request.items.map((i) => i.pageName.trim().toUpperCase()));
  const deletes = [...old.keys()].filter((p) => !keep.has(p));
  const inserts: ComponentPlan['inserts'] = [];
  const updates: ComponentPlan['updates'] = [];
  request.items.forEach((i, n) => {
    const page = i.pageName.trim().toUpperCase();
    const row: Record<string, Value> = {
      SUBITEMNUM: n + 1, ITEMNAME: i.itemName.trim().toUpperCase(), ITEMLABEL: blank(i.itemLabel),
      FOLDERTABLABEL: blank(i.folderTabLabel), HIDDEN: i.hidden ? 1 : 0
    };
    const was = old.get(page);
    if (!was) { inserts.push({ PNLNAME: page, ...row }); return; }
    const columns: Record<string, Value> = {};
    for (const [col, v] of Object.entries(row)) {
      if (typeof v === 'number' ? num(was[col]) !== v : str(was[col]) !== str(v)) columns[col] = v;
    }
    if (Object.keys(columns).length) updates.push({ pageName: page, columns });
  });
  return { defn, ext, scripts, deletes, inserts, updates };
}

const isEmptyPlan = (p: ComponentPlan) => !Object.keys(p.defn).length && !Object.keys(p.ext).length && !p.scripts.length && !p.deletes.length && !p.inserts.length && !p.updates.length;

async function counters(c: Connection, withMenus: boolean): Promise<Record<string, { v: number; lock?: number }>> {
  const types = withMenus ? ['PGM', 'SYS', 'MDM'] : ['PGM', 'SYS'];
  const v = await select<{ T: string; V: number }>(c,
    `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN (${types.map((t) => `'${t}'`).join(', ')}) FOR UPDATE`);
  const l = await select<{ T: string; V: number }>(c,
    `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSLOCK WHERE OBJECTTYPENAME IN (${types.filter((t) => t !== 'SYS').map((t) => `'${t}'`).join(', ')}) FOR UPDATE`);
  const out: Record<string, { v: number; lock?: number }> = {};
  for (const t of types) {
    const row = v.find((r) => String(r.T).trim() === t);
    if (!row) throw new ComponentSaveRefusedError(`PSVERSION ${t} is missing; refusing to write.`);
    const lock = l.find((r) => String(r.T).trim() === t);
    if (t !== 'SYS' && !lock) throw new ComponentSaveRefusedError(`PSLOCK ${t} is missing; refusing to write.`);
    out[t] = { v: Number(row.V), ...(lock ? { lock: Number(lock.V) } : {}) };
  }
  return out;
}

async function exists(c: Connection, sql: string, binds: Record<string, unknown>): Promise<boolean> {
  return (await select<{ N: number }>(c, sql, binds))[0]?.N > 0;
}

export async function saveComponent(c: Connection, request: ComponentSaveRequest): Promise<ComponentSaveResult> {
  const name = request.name.trim().toUpperCase(), market = (request.market || 'GBL').trim().toUpperCase();
  const req = { ...request, name, market };
  const refusal = componentRequestRefusal(req) ?? writeScopeRefusal(name) ?? validateOperatorId(request.operatorId);
  if (refusal) throw new ComponentSaveRefusedError(refusal);

  try {
    if (!(await operatorExists(c, request.operatorId))) {
      throw new ComponentSaveRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
    }
    const [defn] = await select<Record<string, unknown>>(c,
      `SELECT * FROM PSPNLGRPDEFN WHERE PNLGRPNAME = :n AND MARKET = :m FOR UPDATE`, { n: name, m: market });
    const create = request.openedVersion === undefined;
    if (create && defn) throw new ComponentSaveRefusedError(`${name}.${market} already exists.`);
    if (!create && !defn) throw new ComponentSaveRefusedError(`No component named ${name}.${market}.`);
    if (!create && Number(defn!.VERSION) !== request.openedVersion) {
      throw new ComponentSaveRefusedError(`${name}.${market} changed since it was opened (version ${defn!.VERSION}, opened ${request.openedVersion}); reopen it.`);
    }

    // What the component names must exist.
    const p = req.properties;
    for (const rec of [p.searchRecord, p.addSearchRecord].map((r) => r.trim().toUpperCase()).filter(Boolean)) {
      if (!(await exists(c, `SELECT COUNT(*) AS N FROM PSRECDEFN WHERE RECNAME = :r`, { r: rec }))) {
        throw new ComponentSaveRefusedError(`There is no record named ${rec}.`);
      }
    }
    for (const page of [...req.items.map((i) => i.pageName), p.detailPage].map((x) => x.trim().toUpperCase()).filter(Boolean)) {
      if (!(await exists(c, `SELECT COUNT(*) AS N FROM PSPNLDEFN WHERE PNLNAME = :p`, { p: page }))) {
        throw new ComponentSaveRefusedError(`There is no page named ${page}.`);
      }
    }

    const items = create ? [] : await select<Record<string, unknown>>(c,
      `SELECT * FROM PSPNLGROUP WHERE PNLGRPNAME = :n AND MARKET = :m`, { n: name, m: market });
    const [extRow] = create ? [] : await select<Record<string, unknown>>(c,
      `SELECT * FROM PSPNLGRPDEFNEXT WHERE PNLGRPNAME = :n AND MARKET = :m FOR UPDATE`, { n: name, m: market });
    const scriptRows = create ? [] : await select<Record<string, unknown>>(c,
      `SELECT * FROM PSPNLGRPSCRIPTS WHERE PNLGRPNAME = :n AND MARKET = :m`, { n: name, m: market });
    const plan = planComponentSave(create ? undefined : { defn: defn!, items, ...(extRow ? { ext: extRow } : {}), scripts: scriptRows }, req);
    // A style sheet object is a freeform style sheet, a JavaScript object an HTML definition (the lists App Designer offers).
    for (const list of plan.scripts) {
      for (const n of list.names) {
        const found = list.type === 'CSS'
          ? await exists(c, `SELECT COUNT(*) AS N FROM PSSTYLSHEETDEFN WHERE STYLESHEETNAME = :s AND STYLESHEETTYPE = 2`, { s: n })
          : await exists(c, `SELECT COUNT(*) AS N FROM PSCONTDEFN WHERE CONTNAME = :s AND CONTTYPE = 4 AND ALTCONTNUM = 1`, { s: n });
        if (!found) throw new ComponentSaveRefusedError(list.type === 'CSS' ? `There is no freeform style sheet named ${n}.` : `There is no HTML definition named ${n}.`);
      }
    }
    if (!create && isEmptyPlan(plan)) return { version: request.openedVersion!, created: false };

    const next = await counters(c, !create);
    const version = next.PGM.v + 1;
    const [{ TS: ts }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);

    const stamp = { VERSION: version, LASTUPDOPRID: request.operatorId };
    if (create) {
      const row: Record<string, Value> = { PNLGRPNAME: name, MARKET: market, ...plan.defn, ...stamp };
      const cols = Object.keys(row);
      await expectRows(c,
        `INSERT INTO PSPNLGRPDEFN (${cols.join(', ')}, LASTUPDDTTM) VALUES (${cols.map((_, i) => `:b${i}`).join(', ')}, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}))`,
        { ...Object.fromEntries(cols.map((col, i) => [`b${i}`, row[col]])), ts }, 1, 'Inserting PSPNLGRPDEFN');
    } else {
      const set: Record<string, Value> = { ...plan.defn, ...stamp };
      const cols = Object.keys(set);
      await expectRows(c,
        `UPDATE PSPNLGRPDEFN SET ${cols.map((col, i) => `${col} = :b${i}`).join(', ')}, LASTUPDDTTM = TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT})
          WHERE PNLGRPNAME = :n AND MARKET = :m`,
        { ...Object.fromEntries(cols.map((col, i) => [`b${i}`, set[col]])), ts, n: name, m: market }, 1, 'Updating PSPNLGRPDEFN');
    }

    if (Object.keys(plan.ext).length) {
      if (extRow) {
        const cols = Object.keys(plan.ext);
        await expectRows(c, `UPDATE PSPNLGRPDEFNEXT SET ${cols.map((col, i) => `${col} = :b${i}`).join(', ')} WHERE PNLGRPNAME = :n AND MARKET = :m`,
          { ...Object.fromEntries(cols.map((col, i) => [`b${i}`, plan.ext[col]])), n: name, m: market }, 1, 'Updating PSPNLGRPDEFNEXT');
      } else {
        // App Designer's new extension row (i340): blanks and zeros, with what the save sets.
        const row: Record<string, Value> = { PNLGRPNAME: name, MARKET: market, ...NEW_EXTENSION, ...plan.ext };
        const cols = Object.keys(row);
        await expectRows(c, `INSERT INTO PSPNLGRPDEFNEXT (${cols.join(', ')}) VALUES (${cols.map((_, i) => `:b${i}`).join(', ')})`,
          Object.fromEntries(cols.map((col, i) => [`b${i}`, row[col]])), 1, 'Inserting PSPNLGRPDEFNEXT');
      }
    }

    for (const list of plan.scripts) {
      await c.execute(`DELETE FROM PSPNLGRPSCRIPTS WHERE PNLGRPNAME = :n AND MARKET = :m AND PTSCRIPTTYPE = :t AND PTSCRIPTCATG = 'DEV'`,
        { n: name, m: market, t: list.type });
      for (const [i, script] of list.names.entries()) {
        await expectRows(c, `INSERT INTO PSPNLGRPSCRIPTS (PNLGRPNAME, MARKET, PTSCRIPTTYPE, PTSCRIPTNAME, PTSCRIPTCATG, SEQNO) VALUES (:n, :m, :t, :s, 'DEV', :q)`,
          { n: name, m: market, t: list.type, s: script, q: i * 10 }, 1, `Inserting ${list.type} ${script}`);
      }
    }

    for (const page of plan.deletes) {
      await expectRows(c, `DELETE FROM PSPNLGROUP WHERE PNLGRPNAME = :n AND MARKET = :m AND PNLNAME = :p`, { n: name, m: market, p: page }, 1, `Removing ${page}`);
    }
    for (const u of plan.updates) {
      const set = Object.entries(u.columns);
      await expectRows(c,
        `UPDATE PSPNLGROUP SET ${set.map(([col], i) => `${col} = :b${i}`).join(', ')} WHERE PNLGRPNAME = :n AND MARKET = :m AND PNLNAME = :p`,
        { ...Object.fromEntries(set.map(([, v], i) => [`b${i}`, v])), n: name, m: market, p: u.pageName }, 1, `Updating ${u.pageName}`);
    }
    for (const row of plan.inserts) {
      const full: Record<string, Value> = { PNLGRPNAME: name, MARKET: market, ...row };
      const cols = Object.keys(full);
      await expectRows(c, `INSERT INTO PSPNLGROUP (${cols.join(', ')}) VALUES (${cols.map((_, i) => `:b${i}`).join(', ')})`,
        Object.fromEntries(cols.map((col, i) => [`b${i}`, full[col]])), 1, `Inserting ${row.PNLNAME}`);
    }

    for (const [t, cur] of Object.entries(next)) {
      await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = :t`, { v: cur.v + 1, t }, 1, `Updating PSVERSION ${t}`);
      if (cur.lock !== undefined) await expectRows(c, `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = :t`, { v: cur.lock + 1, t }, 1, `Updating PSLOCK ${t}`);
    }

    await verifyComponentSave(c, name, market, version, req.items.length);
    await c.commit();
    return { version, created: create };
  } catch (err) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw err;
  }
}

/** The component landed as planned: its version and its pages, numbered 1..N. */
export async function verifyComponentSave(c: Connection, name: string, market: string, version: number, pages: number): Promise<void> {
  const [d] = await select<{ VERSION: number }>(c, `SELECT VERSION FROM PSPNLGRPDEFN WHERE PNLGRPNAME = :n AND MARKET = :m`, { n: name, m: market });
  const rows = await select<{ SUBITEMNUM: number }>(c, `SELECT SUBITEMNUM FROM PSPNLGROUP WHERE PNLGRPNAME = :n AND MARKET = :m ORDER BY SUBITEMNUM`, { n: name, m: market });
  if (!d || Number(d.VERSION) !== version || rows.length !== pages || rows.some((r, i) => Number(r.SUBITEMNUM) !== i + 1)) {
    throw new ComponentSaveRefusedError(`${name}.${market} did not land as planned; rolled back.`);
  }
}
