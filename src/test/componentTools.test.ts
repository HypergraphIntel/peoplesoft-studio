import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildComponentDefinition } from '../model/componentDefinition.js';
import { applyFluid, storedFluid, storedProperties } from '../mcp/componentEdits.js';
import { planComponentSave } from '../providers/componentWriter.js';

/*
 * psft_component_create / _edit's fluid: what the agent names, over the stored
 * Fluid tab, must plan exactly the save App Designer made for that one setting
 * (f378-f387, h389-h398 on ZZ_PCODE_LAB_CMP).
 */

type Row = Record<string, string | null>;
const RESULTS = join(process.cwd(), 'tools/corpus/save-protocol/results');
const STAMP = new Set(['VERSION', 'LASTUPDDTTM', 'LASTUPDOPRID']);

function snapshot(capture: string, phase: 'before' | 'after', table: string): Row[] {
  const t = JSON.parse(readFileSync(join(RESULTS, capture, `${phase}.json`), 'utf8')).watch[table];
  if (!t) return [];
  const names: string[] = t.columns.map((c: { name: string }) => c.name);
  return (t.rows as Array<Array<string | null>>).map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]])))
    .filter((r) => !('PNLGRPNAME' in r) || r.PNLGRPNAME === 'ZZ_PCODE_LAB_CMP');
}

const decode = (capture: string, phase: 'before' | 'after') => {
  const defn = snapshot(capture, phase, 'PSPNLGRPDEFN')[0];
  const ext = snapshot(capture, phase, 'PSPNLGRPDEFNEXT')[0];
  const items = snapshot(capture, phase, 'PSPNLGROUP');
  const def = buildComponentDefinition('ZZ_PCODE_LAB_CMP', 'GBL',
    { defn, ...(ext ? { ext } : {}), items, menus: [], programs: [], scripts: snapshot(capture, phase, 'PSPNLGRPSCRIPTS') },
    { level0: { level: 0, primary: '', records: [], scrolls: [] }, pageFields: {} });
  return { defn, ext, items, def };
};

const strings = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? null : String(v)]));

test('the MCP Fluid tab: naming only what changed plans each App Designer save (f378-f387, h389-h398)', () => {
  const captures = ['f378-fluid-mode', 'f379-layout-only', 'f382-small-form-factor', 'f383-no-header', 'f384-no-side',
    'f385-component-type-master-detail', 'f386-search-page-type-master-detail', 'f387-fluid-reset-standard-confsearch',
    'h389-logout', 'h390-home', 'h391-back', 'h392-help', 'h393-notify', 'h394-notifications', 'h395-navbar', 'h396-add-to',
    'h397-new-window', 'h398-disable-all-actions'];
  for (const c of captures) {
    const before = decode(c, 'before'), after = decode(c, 'after');
    const was = storedFluid(before.def), now = storedFluid(after.def);
    // The agent's edit: the settings that differ, and the Header Toolbar Actions whose box changed.
    const edit: Record<string, unknown> = Object.fromEntries(Object.entries(now).filter(([k, v]) => k !== 'headerActions' && v !== was[k as keyof typeof was]));
    const on = (d: typeof before.def) => Object.fromEntries(d.properties.fluid.headerActions.map((h) => [h.label, h.on]));
    const actions = Object.fromEntries(Object.entries(on(after.def)).filter(([l, v]) => on(before.def)[l] !== v));
    if (Object.keys(actions).length) edit.headerActions = actions;
    assert.ok(Object.keys(edit).length, `${c}: the capture changed a Fluid tab setting`);

    const properties = { ...storedProperties(before.def), fluid: applyFluid(was, edit) };
    const items = before.def.items.map((i) => ({ pageName: i.pageName, itemName: i.itemName, itemLabel: i.itemLabel, folderTabLabel: i.folderTabLabel, hidden: i.hidden }));
    const plan = planComponentSave({ defn: before.defn, items: before.items, ...(before.ext ? { ext: before.ext } : {}), scripts: [] },
      { name: 'ZZ_PCODE_LAB_CMP', market: 'GBL', operatorId: 'JARED', openedVersion: Number(before.defn.VERSION), items, properties });

    const delta = JSON.parse(readFileSync(join(RESULTS, c, 'delta.json'), 'utf8')).watch;
    const changes = (t: string) => Object.fromEntries((delta[t]?.updated ?? []).flatMap((u: { changes: Record<string, { after: string | null }> }) =>
      Object.entries(u.changes).filter(([k]) => !STAMP.has(k)).map(([k, v]) => [k, v.after])));
    assert.deepEqual(strings(plan.defn), changes('PSPNLGRPDEFN'), `${c}: PSPNLGRPDEFN`);
    assert.deepEqual(strings(plan.ext), changes('PSPNLGRPDEFNEXT'), `${c}: PSPNLGRPDEFNEXT`);
  }
});

test('a new component\'s Fluid tab starts from App Designer\'s defaults; a partial edit keeps the rest', () => {
  const fresh = storedFluid(undefined);
  assert.deepEqual(fresh, { fluidMode: false, layoutOnly: false, smallFormFactor: false, noSystemHeader: false, noSystemSide: false,
    componentType: 0, searchPageType: 0, configurableSearch: false, headerActions: {}, disableAllActions: false });
  const edited = applyFluid({ ...fresh, searchPageType: 1, headerActions: { Home: true } }, { fluidMode: true, headerActions: { Back: false } });
  assert.deepEqual(edited, { ...fresh, fluidMode: true, searchPageType: 1, headerActions: { Home: true, Back: false } });
});
