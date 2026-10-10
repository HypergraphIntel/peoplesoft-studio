import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { componentRequestRefusal, defaultItemLabel, planComponentSave, type ComponentSaveRequest } from '../providers/componentWriter.js';

/*
 * The component writer's plan replays App Designer's nine captured saves of
 * ZZ_PCODE_LAB_CMP (tools/corpus/save-protocol/results/c01-c08b): from the
 * component as each save found it, the request for what it left must change
 * exactly the columns and rows App Designer changed.
 */

type Row = Record<string, string | null>;
const CASES = ['c01-create', 'c02-insert-page', 'c03-item-label', 'c04-hidden', 'c05-reorder', 'c06-delete-page', 'c07-general', 'c08a-use-add', 'c08b-use-disable-save'];
const delta = (c: string) => {
  const watch = JSON.parse(readFileSync(join(process.cwd(), 'tools/corpus/save-protocol/results', c, 'delta.json'), 'utf8')).watch;
  // A table the save did not touch has no entry.
  for (const t of ['PSPNLGRPDEFN', 'PSPNLGROUP']) watch[t] ??= { inserted: [], deleted: [], updated: [] };
  return watch;
};
const STAMP = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);
const strings = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? null : String(v)]));

function requestFor(defn: Row, items: Map<string, Row>): ComponentSaveRequest {
  const a = Number(defn.ACTIONS), search = String(defn.SEARCHRECNAME).trim();
  return {
    name: 'ZZ_PCODE_LAB_CMP', market: 'GBL', operatorId: 'JARED',
    items: [...items.values()].sort((x, y) => Number(x.SUBITEMNUM) - Number(y.SUBITEMNUM)).map((r) => ({
      pageName: String(r.PNLNAME), itemName: String(r.ITEMNAME), itemLabel: String(r.ITEMLABEL).trim(),
      folderTabLabel: String(r.FOLDERTABLABEL).trim(), hidden: r.HIDDEN === '1'
    })),
    properties: {
      description: String(defn.DESCR).trim(), comments: defn.DESCRLONG ?? '', searchRecord: search,
      addSearchRecord: String(defn.ADDSRCHRECNAME).trim() === search ? '' : String(defn.ADDSRCHRECNAME).trim(),
      detailPage: String(defn.SEARCHPNLNAME).trim(), forceSearch: defn.FORCESEARCH === '1',
      actions: { add: (a & 1) !== 0, updateDisplay: (a & 2) !== 0, updateDisplayAll: (a & 4) !== 0, correction: (a & 8) !== 0 },
      disableSave: defn.DISABLESAVE === '1', includeInNavigation: defn.INCLNAVIGATION === '1'
    }
  };
}

test('the plan reproduces each of App Designer\'s component saves (c01-c08b)', () => {
  let defn: Row | undefined;
  const items = new Map<string, Row>();
  for (const c of CASES) {
    const d = delta(c);
    // App Designer's effect, applied to a copy: what the save left.
    const afterDefn: Row = d.PSPNLGRPDEFN.inserted[0] ? { ...d.PSPNLGRPDEFN.inserted[0] } : { ...defn! };
    for (const u of d.PSPNLGRPDEFN.updated) for (const [k, v] of Object.entries(u.changes as Record<string, { after: string | null }>)) afterDefn[k] = v.after;
    const afterItems = new Map([...items].map(([k, v]) => [k, { ...v }]));
    for (const r of d.PSPNLGROUP.deleted) afterItems.delete(r.PNLNAME);
    for (const r of d.PSPNLGROUP.inserted) afterItems.set(r.PNLNAME, { ...r });
    for (const u of d.PSPNLGROUP.updated) for (const [k, v] of Object.entries(u.changes as Record<string, { after: string }>)) afterItems.get(u.key.PNLNAME)![k] = v.after;

    const plan = planComponentSave(defn ? { defn, items: [...items.values()] } : undefined, requestFor(afterDefn, afterItems));
    if (!defn) {
      const want = Object.fromEntries(Object.entries(afterDefn).filter(([k]) => !STAMP.has(k) && k !== 'PNLGRPNAME' && k !== 'MARKET'));
      assert.deepEqual(strings(plan.defn), want, `${c}: the new component row`);
    } else {
      const want = Object.fromEntries(d.PSPNLGRPDEFN.updated.flatMap((u: { changes: Record<string, { after: string | null }> }) =>
        Object.entries(u.changes).filter(([k]) => !STAMP.has(k)).map(([k, v]) => [k, v.after])));
      assert.deepEqual(strings(plan.defn), want, `${c}: PSPNLGRPDEFN columns`);
    }
    assert.deepEqual(plan.deletes, d.PSPNLGROUP.deleted.map((r: Row) => r.PNLNAME), `${c}: removed pages`);
    assert.deepEqual(plan.inserts.map(strings), d.PSPNLGROUP.inserted.map((r: Row) => { const { PNLGRPNAME: _g, MARKET: _m, ...rest } = r; return rest; }), `${c}: added pages`);
    // Compared as a set: the order rows are updated in does not matter.
    const byPage = (x: [string, unknown], y: [string, unknown]) => x[0].localeCompare(y[0]);
    assert.deepEqual(plan.updates.map((u): [string, unknown] => [u.pageName, strings(u.columns)]).sort(byPage),
      d.PSPNLGROUP.updated.map((u: { key: Row; changes: Record<string, { after: string }> }): [string, unknown] =>
        [String(u.key.PNLNAME), Object.fromEntries(Object.entries(u.changes).map(([k, v]) => [k, v.after]))]).sort(byPage),
      `${c}: changed pages`);
    defn = afterDefn;
    items.clear();
    for (const [k, v] of afterItems) items.set(k, v);
  }
});

test('an inserted page is labelled as App Designer labels it', () => {
  assert.equal(defaultItemLabel('ZZ_PCODE_LAB_PG'), 'Zz Pcode Lab Pg');
  assert.equal(defaultItemLabel('ZZ_PCODE_LAB_PG2'), 'Zz Pcode Lab Pg2');
});

test('a component without a search record, or with a page twice, is refused before anything is read', () => {
  const base = requestFor({ ACTIONS: '2', SEARCHRECNAME: 'ZZ_PCODE_LAB_R1', ADDSRCHRECNAME: 'ZZ_PCODE_LAB_R1', DESCR: 'X', DESCRLONG: null,
    SEARCHPNLNAME: ' ', FORCESEARCH: '0', DISABLESAVE: '0', INCLNAVIGATION: '1' },
  new Map([['P', { PNLNAME: 'P', ITEMNAME: 'P', ITEMLABEL: 'P', FOLDERTABLABEL: ' ', HIDDEN: '0', SUBITEMNUM: '1' }]]));
  assert.equal(componentRequestRefusal(base), undefined);
  assert.match(componentRequestRefusal({ ...base, properties: { ...base.properties, searchRecord: '' } })!, /no search record\. Add one in Component Properties > Use/);
  assert.match(componentRequestRefusal({ ...base, items: [...base.items, base.items[0]] })!, /is in the component twice/);
});

test('the Internet, Fluid and Style tabs: the plan reproduces each one-control App Designer save (i336-s406)', async () => {
  const { buildComponentDefinition } = await import('../model/componentDefinition.js');
  // Every save of ZZ_PCODE_LAB_CMP in order, App Designer's and the writer's, to rebuild what each found.
  const sequence = ['c01-create', 'c02-insert-page', 'c03-item-label', 'c04-hidden', 'c05-reorder', 'c06-delete-page', 'c07-general',
    'c08a-use-add', 'c08b-use-disable-save', 'w01-writer-insert-page', 'w02-writer-ui-edit',
    ...Array.from({ length: 37 }, (_, i) => `i${336 + i}`),
    'x373-hyperlinks', 'x374-page-nav-history', 'x375-toolbar-on', 'x376-toolbar-add', 'x377-toolbar-update-display',
    'f378-fluid-mode', 'f379-layout-only', 'f380-fluid-page-nav-history', 'f381-fluid-return-last-page', 'f382-small-form-factor',
    'f383-no-header', 'f384-no-side', 'f385-component-type-master-detail', 'f386-search-page-type-master-detail',
    'f387-fluid-reset-standard-confsearch', 'h388-initial-save', 'h389-logout', 'h390-home', 'h391-back', 'h392-help', 'h393-notify',
    'h394-notifications', 'h395-navbar', 'h396-add-to', 'h397-new-window', 'h398-disable-all-actions',
    's399-fluid-off', 's400-css-add', 's401-css-add-second', 's402-css-move-up', 's403-css-delete', 's404-js-add', 's405-js-add-second', 's406-classic-plus'];
  // i340 changed the real-time search link, which the editor does not set. i352 checked Save while Disable Saving Page
  // was on: App Designer stored the bit, but shows Save unchecked from then on (and its next save, i353, cleared it),
  // so the box's state cannot be decoded from what i352 left.
  const notEdited = new Set(['i340', 'i352']);
  let defn: Row = {};
  let ext: Row | undefined;
  let scripts: Row[] = [];
  const items = new Map<string, Row>();
  let checked = 0;
  for (const c of sequence) {
    const d = delta(c);
    d.PSPNLGRPDEFNEXT ??= { inserted: [], deleted: [], updated: [] };
    const afterDefn: Row = d.PSPNLGRPDEFN.inserted[0] ? { ...d.PSPNLGRPDEFN.inserted[0] } : { ...defn };
    for (const u of d.PSPNLGRPDEFN.updated) for (const [k, v] of Object.entries(u.changes as Record<string, { after: string | null }>)) afterDefn[k] = v.after;
    let afterExt: Row | undefined = d.PSPNLGRPDEFNEXT.inserted[0] ? { ...d.PSPNLGRPDEFNEXT.inserted[0] } : ext ? { ...ext } : undefined;
    for (const u of d.PSPNLGRPDEFNEXT.updated) for (const [k, v] of Object.entries(u.changes as Record<string, { after: string | null }>)) afterExt![k] = v.after;
    d.PSPNLGRPSCRIPTS ??= { inserted: [], deleted: [], updated: [] };
    const same = (a: Row, b: Row) => a.PTSCRIPTTYPE === b.PTSCRIPTTYPE && a.PTSCRIPTNAME === b.PTSCRIPTNAME && a.SEQNO === b.SEQNO;
    const afterScripts = [...scripts.filter((r) => !d.PSPNLGRPSCRIPTS.deleted.some((x: Row) => same(r, x))), ...d.PSPNLGRPSCRIPTS.inserted];
    const listOf = (rows: Row[], type: string) => rows.filter((r) => r.PTSCRIPTTYPE === type && r.PTSCRIPTCATG === 'DEV')
      .sort((a, b) => Number(a.SEQNO) - Number(b.SEQNO)).map((r) => String(r.PTSCRIPTNAME));
    const afterItems = new Map([...items].map(([k, v]) => [k, { ...v }]));
    for (const r of d.PSPNLGROUP.deleted) afterItems.delete(r.PNLNAME);
    for (const r of d.PSPNLGROUP.inserted) afterItems.set(r.PNLNAME, { ...r });
    for (const u of d.PSPNLGROUP.updated) for (const [k, v] of Object.entries(u.changes as Record<string, { after: string }>)) afterItems.get(u.key.PNLNAME)![k] = v.after;

    if (/^[ixfhs]\d/.test(c) && !notEdited.has(c)) {
      // What the save left, decoded as the panel decodes it, becomes the edit.
      const p = buildComponentDefinition('ZZ_PCODE_LAB_CMP', 'GBL', { defn: afterDefn, ...(afterExt ? { ext: afterExt } : {}), items: [], menus: [], programs: [], scripts: afterScripts },
        { level0: { level: 0, primary: '', records: [], scrolls: [] } }).properties;
      const n = p.internet, f = p.fluid;
      const code = (choice: { label: string } | { code: number }, labels: Record<number, string>) =>
        'code' in choice ? choice.code : Number(Object.entries(labels).find(([, l]) => l === choice.label)![0]);
      const flags = await import('../model/componentFlags.js');
      const request = requestFor(afterDefn, afterItems);
      request.properties.internet = {
        primaryAction: code(n.primaryAction, flags.PRIMARY_ACTIONS), defaultSearchType: code(n.defaultSearchType, flags.SEARCH_TYPES),
        allowActionModeSelection: n.allowActionModeSelection, deferred: n.deferred, expertEntry: n.expertEntry, wsrpCompliant: n.wsrpCompliant,
        disableToolbar: !n.showToolbar, toolbar: Object.fromEntries(n.toolbar.map((t) => [t.label, t.on])),
        folderTabs: n.folderTabs, hyperlinks: n.hyperlinks, pageNavigationInHistory: n.pageNavigationInHistory,
        returnToLastPageInHistory: n.returnToLastPageInHistory, pagebar: Object.fromEntries(n.pagebar.map((t) => [t.label, t.on])), disablePagebar: n.disablePagebar
      };
      request.properties.fluid = {
        fluidMode: f.fluidMode, layoutOnly: f.layoutOnly, smallFormFactor: f.smallFormFactor, noSystemHeader: f.noSystemHeader, noSystemSide: f.noSystemSide,
        componentType: code(f.componentType, flags.COMPONENT_TYPES), searchPageType: code(f.searchPageType, flags.SEARCH_PAGE_TYPES),
        configurableSearch: f.configurableSearch, headerActions: Object.fromEntries(f.headerActions.map((h) => [h.label, h.on])), disableAllActions: f.disableAllActions
      };
      request.properties.style = { classicPlus: p.style.classicPlus, styleSheets: p.style.styleSheets, javaScripts: p.style.javaScripts };
      const plan = planComponentSave({ defn, items: [...items.values()], ...(ext ? { ext } : {}), scripts }, request);
      // App Designer rewrites every script row on a save; what must match is each list as it ends up.
      for (const type of ['CSS', 'JS'] as const) {
        const written = plan.scripts.find((x) => x.type === type)?.names ?? listOf(scripts, type);
        assert.deepEqual(written, listOf(afterScripts, type), `${c}: ${type} list`);
      }
      const want = Object.fromEntries(d.PSPNLGRPDEFN.updated.flatMap((u: { changes: Record<string, { after: string | null }> }) =>
        Object.entries(u.changes).filter(([k]) => !STAMP.has(k)).map(([k, v]) => [k, v.after])));
      assert.deepEqual(strings(plan.defn), want, `${c}: PSPNLGRPDEFN columns`);
      const wantExt = Object.fromEntries(d.PSPNLGRPDEFNEXT.updated.flatMap((u: { changes: Record<string, { after: string | null }> }) =>
        Object.entries(u.changes).map(([k, v]) => [k, v.after])));
      assert.deepEqual(strings(plan.ext), wantExt, `${c}: PSPNLGRPDEFNEXT columns`);
      checked++;
    }
    defn = afterDefn; ext = afterExt; scripts = afterScripts;
    items.clear();
    for (const [k, v] of afterItems) items.set(k, v);
  }
  assert.equal(checked, 69);
});
