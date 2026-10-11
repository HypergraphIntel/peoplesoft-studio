/*
 * Pages, components and menus, as the PeopleTools tables hold them (HRDMO,
 * PeopleTools 8.62; docs/PAGES_COMPONENTS_MENUS.md), and their read-only
 * text views. Codes are App Designer's where the evidence names them --
 * PSXLATITEM, the Default Page Control names App Designer showed (record
 * fields' DEFGUICONTROL shares PSPNLFIELD.FIELDTYPE's numbers), or the
 * columns only one kind of control fills -- and are shown raw otherwise.
 */

export type Row = Record<string, unknown>;

const str = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => Number(v ?? 0);
/** LASTUPDDTTM as the provider reads it (LASTUPD, TO_CHAR'd), else as stored. */
const stamp = (r: Row) => str(r.LASTUPD) || str(r.LASTUPDDTTM);

/**
 * PSPNLFIELD.FIELDTYPE. "confirmed": App Designer's name (the page control
 * names it showed for 4, 5, 7, 8, 9); otherwise the evidence in
 * docs/PAGES_COMPONENTS_MENUS.md.
 */
export const PAGE_FIELD_TYPES: Readonly<Record<number, string>> = {
  0: 'Static Text',
  1: 'Frame',
  2: 'Group Box',
  3: 'Static Image',
  4: 'Edit Box',
  5: 'Drop Down List',
  6: 'Long Edit Box',
  7: 'Check Box',
  8: 'Radio Button',
  9: 'Image',
  10: 'Scroll Bar',
  11: 'Subpage',
  12: 'Push Button (PeopleCode Command)',
  13: 'Push Button (Scroll Action)',
  14: 'Push Button (Toolbar Action)',
  15: 'Push Button (External Link)',
  16: 'Push Button (Internal Link)',
  17: 'Push Button (Process)',
  18: 'Secondary Page',
  19: 'Grid',
  20: 'Tree',
  21: 'Push Button (Secondary Page)',
  23: 'Horizontal Rule',
  24: 'Tab Separator',
  25: 'HTML Area',
  26: 'Push Button (Prompt Action)',
  27: 'Scroll Area',
  29: 'Push Button (Page Anchor)',
  30: 'Chart'
};

/** PSPNLDEFN.PNLTYPE: 0-3 from how pages are used; 4-11 from the delivered pages' names. */
export const PAGE_TYPES: Readonly<Record<number, string>> = {
  0: 'Standard Page', 1: 'Subpage', 2: 'Secondary Page', 3: 'Popup Page', 4: 'Header Page', 5: 'Side Page 1',
  6: 'Footer Page', 7: 'Layout Page', 8: 'Search Page', 9: 'Prompt Page', 10: 'Master&Detail Target Page', 11: 'Side Page 2'
};

/** PSPNLFIELD.LBLTYPE: PSXLATITEM names 0-3. */
export const LABEL_TYPES: Readonly<Record<number, string>> = { 0: 'None', 1: 'Text', 2: 'RFT Short', 3: 'RFT Long' };

/** PSPNLGRPDEFN.ACTIONS bits (JOB_DATA 14, USERMAINT 3, PROCESSMONITOR 2). */
export const COMPONENT_ACTIONS: readonly [number, string][] = [[1, 'Add'], [2, 'Update/Display'], [4, 'Update/Display All'], [8, 'Correction']];

/** PSMENUDEFN.MENUTYPE. */
export const MENU_TYPES: Readonly<Record<number, string>> = { 0: 'Standard', 1: 'Popup' };

/** PSMENUITEM.ITEMTYPE: 5 names a component; 8 is labelled "Separator"; 9 has Menu PeopleCode; 12 transfers. */
export const MENU_ITEM_TYPES: Readonly<Record<number, string>> = { 5: 'Component', 8: 'Separator', 9: 'PeopleCode', 12: 'Transfer' };

const named = (map: Readonly<Record<number, string>>, code: number) => map[code] ?? `Type ${code}`;

export interface PageView {
  page: Row;
  fields: Row[];
  /** The components holding the page: PNLGRPNAME, MARKET, ITEMLABEL. */
  components: Row[];
}

/** A page field's label as shown: its text, else the message-catalog / record-field label it stands for. */
function fieldLabel(f: Row): string {
  const text = str(f.LBLTEXT);
  if (text) return text;
  const type = num(f.LBLTYPE);
  if (type === 0 || type === 1) return '';
  return `(${LABEL_TYPES[type] ?? `label type ${type}`})`;
}

/** What a control points at: its record field, subpage, link, process or scroll / toolbar action. */
function fieldTarget(f: Row): string {
  const type = num(f.FIELDTYPE);
  const rec = str(f.RECNAME);
  const field = str(f.FIELDNAME);
  const parts: string[] = [];
  if (rec || field) parts.push(field ? `${rec}.${field}` : rec);
  if (str(f.SUBPNLNAME)) parts.push(`-> ${str(f.SUBPNLNAME)}`);
  if (type === 15 && str(f.URL_ID)) parts.push(`URL ${str(f.URL_ID)}`);
  if (type === 16) {
    const target = [str(f.GOTOPORTALNAME), str(f.GOTONODENAME), str(f.GOTOMENUNAME), str(f.GOTOPNLGRPNAME) + (str(f.GOTOMKTNAME) ? `.${str(f.GOTOMKTNAME)}` : ''), str(f.GOTOPNLNAME)]
      .filter(Boolean).join(' / ');
    if (target) parts.push(`-> ${target}`);
  }
  if (type === 17 && str(f.PRCSNAME)) parts.push(`process ${str(f.PRCSTYPE)} ${str(f.PRCSNAME)}`.replace(/\s+/g, ' '));
  if (type === 13 && num(f.SCROLLACTION)) parts.push(`scroll action ${num(f.SCROLLACTION)}`);
  if (type === 14 && num(f.TOOLACTION)) parts.push(`toolbar action ${num(f.TOOLACTION)}`);
  if ((type === 19 || type === 10 || type === 27) && num(f.OCCURSCOUNT1)) parts.push(`occurs ${num(f.OCCURSCOUNT1)}`);
  return parts.join('  ');
}

/** A page in App Designer's Order view: each field by FIELDNUM with its level, type, label and target. */
export function renderPage(name: string, view: PageView): string {
  const p = view.page;
  const out: string[] = [];
  out.push(`Page ${name}${str(p.DESCR) ? ` -- ${str(p.DESCR)}` : ''}`);
  out.push(`  Type: ${named(PAGE_TYPES, num(p.PNLTYPE))}   Fields: ${view.fields.length}   Version: ${num(p.VERSION)}`);
  const style = [str(p.STYLESHEETNAME) && `Style sheet: ${str(p.STYLESHEETNAME)}`, str(p.FFSTYLESHEETNAME) && `Freeform style sheet: ${str(p.FFSTYLESHEETNAME)}`].filter(Boolean);
  if (style.length) out.push(`  ${style.join('   ')}`);
  out.push(`  Owner ID: ${str(p.OBJECTOWNERID) || '(none)'}   Last updated: ${stamp(p)} by ${str(p.LASTUPDOPRID)}`);
  if (view.components.length) {
    out.push(`  In components: ${view.components.map((c) => `${str(c.PNLGRPNAME)}.${str(c.MARKET)}${str(c.ITEMLABEL) ? ` ("${str(c.ITEMLABEL)}")` : ''}`).join(', ')}`);
  }
  out.push('');
  const rows = [...view.fields].sort((a, b) => num(a.FIELDNUM) - num(b.FIELDNUM)).map((f) => [
    String(num(f.FIELDNUM)), String(num(f.OCCURSLEVEL)), named(PAGE_FIELD_TYPES, num(f.FIELDTYPE)), fieldLabel(f), fieldTarget(f), str(f.PNLFIELDNAME)
  ]);
  const head = ['Num', 'Lvl', 'Type', 'Label', 'Record.Field / Target', 'Page Field Name'];
  const widths = head.map((h, i) => Math.min(Math.max(h.length, ...rows.map((r) => r[i].length)), i === 3 ? 34 : i === 4 ? 44 : 40));
  const line = (cells: string[]) => cells.map((c, i) => (i < 2 ? c.padStart(widths[i]) : c.length > widths[i] ? c.slice(0, widths[i] - 1) + '…' : c.padEnd(widths[i])))
    .join('  ').trimEnd();
  out.push('  ' + line(head));
  for (const r of rows) out.push('  ' + line(r));
  return out.join('\n') + '\n';
}

export interface ComponentView {
  component: Row;
  pages: Row[];
  /** Where the component is registered on menus: MENUNAME, BARNAME, ITEMNAME, ITEMLABEL. */
  menus: Row[];
}

const yesNo = (v: unknown) => (num(v) ? 'Yes' : 'No');

/** A component: its search records, actions and settings, then its pages in order. */
export function renderComponent(name: string, market: string, view: ComponentView): string {
  const c = view.component;
  const out: string[] = [];
  out.push(`Component ${name}.${market}${str(c.DESCR) ? ` -- ${str(c.DESCR)}` : ''}`);
  out.push(`  Search record: ${str(c.SEARCHRECNAME) || '(none)'}   Add search record: ${str(c.ADDSRCHRECNAME) || '(none)'}` +
    `${str(c.SEARCHPNLNAME) ? `   Search page: ${str(c.SEARCHPNLNAME)}` : ''}`);
  const actions = COMPONENT_ACTIONS.filter(([bit]) => (num(c.ACTIONS) & bit) !== 0).map(([, l]) => l);
  out.push(`  Actions: ${actions.join(', ') || '(none)'}`);
  out.push(`  Disable Saving Page: ${yesNo(c.DISABLESAVE)}   Force Search Processing: ${yesNo(c.FORCESEARCH)}   Include in Navigation: ${yesNo(c.INCLNAVIGATION)}` +
    `   Allow Action Mode Selection: ${yesNo(c.ALLOWACTMODESEL)}   Fluid: ${yesNo(c.FLUIDMODE)}`);
  out.push(`  Owner ID: ${str(c.OBJECTOWNERID) || '(none)'}   Version: ${num(c.VERSION)}   Last updated: ${stamp(c)} by ${str(c.LASTUPDOPRID)}`);
  if (view.menus.length) {
    out.push(`  On menus: ${view.menus.map((m) => `${str(m.MENUNAME)}.${str(m.BARNAME)}.${str(m.ITEMNAME)}`).join(', ')}`);
  }
  out.push('', `  Pages (${view.pages.length})`);
  for (const p of [...view.pages].sort((a, b) => num(a.SUBITEMNUM) - num(b.SUBITEMNUM))) {
    const tab = str(p.FOLDERTABLABEL);
    out.push(`    ${str(p.PNLNAME).padEnd(20)} ${str(p.ITEMNAME).padEnd(20)} ${str(p.ITEMLABEL)}${tab && tab !== str(p.ITEMLABEL) ? `  (tab: ${tab})` : ''}` +
      `${num(p.HIDDEN) ? '  [hidden]' : ''}`);
  }
  return out.join('\n') + '\n';
}

export interface MenuView {
  menu: Row;
  items: Row[];
}

/** A menu: its bars, and each bar's items in order. */
export function renderMenu(name: string, view: MenuView): string {
  const m = view.menu;
  const out: string[] = [];
  out.push(`Menu ${name}${str(m.DESCR) ? ` -- ${str(m.DESCR)}` : ''}`);
  out.push(`  Type: ${named(MENU_TYPES, num(m.MENUTYPE))}   Label: ${str(m.MENULABEL) || '(none)'}   Group: ${str(m.MENUGROUP) || '(none)'}` +
    `   Version: ${num(m.VERSION)}`);
  out.push(`  Owner ID: ${str(m.OBJECTOWNERID) || '(none)'}   Last updated: ${stamp(m)} by ${str(m.LASTUPDOPRID)}`);
  const bars = new Map<string, Row[]>();
  for (const i of [...view.items].sort((a, b) => num(a.ITEMNUM) - num(b.ITEMNUM))) bars.set(str(i.BARNAME), [...(bars.get(str(i.BARNAME)) ?? []), i]);
  for (const [bar, items] of bars) {
    const label = str(items.find((i) => str(i.BARLABEL))?.BARLABEL);
    out.push('', `  Bar ${bar}${label ? ` "${label}"` : ''}`);
    for (const i of items) {
      const type = num(i.ITEMTYPE);
      if (type === 8) { out.push('    ----'); continue; }
      const target = type === 5 || type === 12
        ? `-> ${str(i.PNLGRPNAME)}${str(i.MARKET) ? `.${str(i.MARKET)}` : ''}${str(i.SEARCHRECNAME) ? `  (search record ${str(i.SEARCHRECNAME)})` : ''}` : '';
      out.push(`    ${str(i.ITEMNAME).padEnd(20)} ${named(MENU_ITEM_TYPES, type).padEnd(10)} ${str(i.ITEMLABEL).padEnd(32)} ${target}`.trimEnd());
    }
  }
  return out.join('\n') + '\n';
}
