import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildComponentStructure, referencedPages, type StructureField, type StructureScroll } from '../model/componentStructure.js';
import { buildComponentDefinition } from '../model/componentDefinition.js';
import { renderComponentHtml } from '../editors/componentHtml.js';

/* App Designer's component window, matched against JOB_DATA.GBL on HRDMO (docs/COMPONENTS.md). */

let n = 0;
const f = (over: Partial<StructureField>): StructureField => ({
  FIELDNUM: ++n, FIELDTYPE: 4, OCCURSLEVEL: 0, RECNAME: ' ', FIELDNAME: 'F', SUBPNLNAME: ' ', FIELDUSE: 0, ...over
});
const TYPES: Record<string, number> = {
  JOB: 0, JOB_JR: 0, PER_ORG_ASGN: 0, PER_ORG_ASGN_VW: 1, PERSON: 0, DERIVED_HR: 2, DERIVED_JR: 2, COMPENSATION: 0, EXCH_RT_WRK: 2, EXCH_RT_WSBR: 3, CNT: 0
};
const typeOf = (r: string) => TYPES[r] ?? -1;
const names = (s: StructureScroll) => s.records.map((r) => r.name);
const build = (pages: Record<string, StructureField[]>, order: string[], search = 'SRCH') =>
  buildComponentStructure(order, search, (p) => pages[p], typeOf);

test('level 0, a scroll and its primary record; related displays are left out', () => {
  const s = build({
    P1: [f({ RECNAME: 'DERIVED_HR' }), f({ RECNAME: 'PERSON', FIELDUSE: 0x13 }), f({ FIELDTYPE: 27, OCCURSLEVEL: 1 }),
      f({ OCCURSLEVEL: 1, RECNAME: 'DERIVED_HR' }), f({ OCCURSLEVEL: 1, RECNAME: 'JOB' }),
      f({ FIELDTYPE: 19, OCCURSLEVEL: 2, RECNAME: 'COMPENSATION', FIELDNAME: ' ' }), f({ OCCURSLEVEL: 2, RECNAME: 'EXCH_RT_WRK' })]
  }, ['P1']);
  assert.deepEqual(names(s.level0), ['DERIVED_HR']);
  const job = s.level0.scrolls[0];
  assert.equal(job.primary, 'JOB'); // first non-derived record, listed first
  assert.deepEqual(names(job), ['JOB', 'DERIVED_HR']);
  assert.equal(job.scrolls[0].primary, 'COMPENSATION'); // the grid names it
  assert.deepEqual(names(job.scrolls[0]), ['EXCH_RT_WRK']);
});

test('the same primary record on two pages is one scroll', () => {
  const s = build({
    P1: [f({ FIELDTYPE: 10, OCCURSLEVEL: 1 }), f({ OCCURSLEVEL: 1, RECNAME: 'JOB' })],
    P2: [f({ FIELDTYPE: 27, OCCURSLEVEL: 1 }), f({ OCCURSLEVEL: 1, RECNAME: 'JOB' }), f({ OCCURSLEVEL: 1, RECNAME: 'DERIVED_HR' })]
  }, ['P1', 'P2']);
  assert.equal(s.level0.scrolls.length, 1);
  assert.deepEqual(names(s.level0.scrolls[0]), ['JOB', 'DERIVED_HR']);
});

test('subpage substitution: onto a non-derived record, or a subrecord subpage onto any record', () => {
  const s = build({
    P1: [f({ FIELDTYPE: 11, RECNAME: 'PER_ORG_ASGN', SUBPNLNAME: 'SBP' }), f({ FIELDTYPE: 11, RECNAME: 'EXCH_RT_WRK', SUBPNLNAME: 'SBR_SBP' }),
      f({ FIELDTYPE: 11, RECNAME: 'DERIVED_HR', SUBPNLNAME: 'KEEP_SBP' })],
    SBP: [f({ RECNAME: 'PER_ORG_ASGN_VW' }), f({ RECNAME: 'DERIVED_JR' })],
    SBR_SBP: [f({ RECNAME: 'EXCH_RT_WSBR' })],
    KEEP_SBP: [f({ RECNAME: 'CNT' })] // placed on a derived record: not substituted
  }, ['P1']);
  assert.deepEqual(names(s.level0), ['PER_ORG_ASGN', 'DERIVED_JR', 'EXCH_RT_WRK', 'CNT']);
});

test('a subpage placed on a record that is primary elsewhere goes, with its level, to that scroll (JOB_JR)', () => {
  const s = build({
    P1: [f({ FIELDTYPE: 27, OCCURSLEVEL: 1 }), f({ OCCURSLEVEL: 1, RECNAME: 'JOB' }),
      f({ FIELDTYPE: 10, OCCURSLEVEL: 2 }), f({ OCCURSLEVEL: 2, RECNAME: 'JOB_JR' })],
    P2: [f({ FIELDTYPE: 10, OCCURSLEVEL: 1 }), f({ OCCURSLEVEL: 1, RECNAME: 'JOB' }),
      f({ FIELDTYPE: 11, OCCURSLEVEL: 1, RECNAME: 'JOB_JR', SUBPNLNAME: 'JR_SBP' })],
    JR_SBP: [f({ RECNAME: 'JOB_JR' }), f({ RECNAME: 'DERIVED_JR' })]
  }, ['P1', 'P2']);
  const job = s.level0.scrolls[0];
  assert.deepEqual(names(job), ['JOB']);
  assert.deepEqual(names(job.scrolls[0]), ['JOB_JR', 'DERIVED_JR']);
  // A subpage whose record is only inside its own scroll stays put (JOB_CNT_WRK on CONTRACT_DATA).
  const t = build({
    P1: [f({ FIELDTYPE: 11, RECNAME: 'CNT', SUBPNLNAME: 'CNT_SBP' })],
    CNT_SBP: [f({ RECNAME: 'DERIVED_HR' }), f({ FIELDTYPE: 27, OCCURSLEVEL: 1 }), f({ OCCURSLEVEL: 1, RECNAME: 'CNT' })]
  }, ['P1']);
  assert.deepEqual(names(t.level0), ['DERIVED_HR']);
  assert.deepEqual(names(t.level0.scrolls[0]), ['CNT']);
});

test('pages a walk reaches are subpages and secondary pages', () => {
  assert.deepEqual(referencedPages([{ FIELDTYPE: 11, SUBPNLNAME: 'A' }, { FIELDTYPE: 18, SUBPNLNAME: 'B ' }, { FIELDTYPE: 4, SUBPNLNAME: ' ' }, { FIELDTYPE: 11, SUBPNLNAME: 'A' }]), ['A', 'B']);
});

test('Definition grid and Component Properties as JOB_DATA.GBL shows them', () => {
  const def = buildComponentDefinition('JOB_DATA', 'GBL', {
    defn: { DESCR: 'Job Data', DESCRLONG: 'Maintain Job History', OBJECTOWNERID: 'HCR', LASTUPD: '2021-03-05 09:27:17', LASTUPDOPRID: 'PPLSOFT', VERSION: 246,
      ACTIONS: 14, SEARCHRECNAME: 'EMPLMT_SRCH_ALL', ADDSRCHRECNAME: 'EMPLMT_SRCH_ALL', SEARCHPNLNAME: 'PERSONAL_DATA1', LOADLOC: 0, SAVELOC: 0,
      DISABLESAVE: 0, INCLNAVIGATION: 1, FORCESEARCH: 0, PRIMARYACTION: 1, DFLTACTION: 1, DFLTSRCHTYPE: 1, ALLOWACTMODESEL: 1, DEFERPROC: 1,
      ADDLINKMSGSET: 124, ADDLINKMSGNUM: 62, SRCHLINKMSGSET: 124, SRCHLINKMSGNUM: 63, SRCHTEXTMSGSET: 124, SRCHTEXTMSGNUM: 50, SHOWTBAR: 1, TBARBTNS: 130019, PNLNAVFLAGS: 11 },
    ext: { PTCTXSEARCHRECNAME: ' ', PTRTSRCHLINKMSGSET: 0, PTKEYWDSRCHMSGSET: 0, PTSF_SRCCAT_NAME: 'HC_HR_JOB_DATA' },
    items: [{ SUBITEMNUM: 2, PNLNAME: 'JOB_DATA_JOBCODE', ITEMNAME: 'JOB_DATA_JOBCODE', ITEMLABEL: '&Job Information', FOLDERTABLABEL: ' ', HIDDEN: 0, PAGEDEFERPROC: 0 },
      { SUBITEMNUM: 1, PNLNAME: 'JOB_DATA1', ITEMNAME: 'JOB_DATA1', ITEMLABEL: '&Work Location', FOLDERTABLABEL: ' ', HIDDEN: 0, PAGEDEFERPROC: 0 },
      { SUBITEMNUM: 11, PNLNAME: 'JOB_DATA1_WRK', ITEMNAME: 'JOB_DATA1_WRK', ITEMLABEL: 'Job Data1 &Wrk', FOLDERTABLABEL: ' ', HIDDEN: 1, PAGEDEFERPROC: 1 }],
    menus: [{ MENUNAME: 'ADMINISTER_WORKFORCE_(GBL)', BARNAME: 'USE', ITEMNAME: 'JOB_DATA' }],
    programs: [{ OBJECTID3: 1, OBJECTVALUE3: 'JOB', OBJECTID4: 12, OBJECTVALUE4: 'RowInit' }, { OBJECTID3: 1, OBJECTVALUE3: 'DERIVED_HR_NP', OBJECTID4: 2, OBJECTVALUE4: 'X', OBJECTID5: 12, OBJECTVALUE5: 'FieldEdit' }, { OBJECTID3: 12, OBJECTVALUE3: 'PreBuild', OBJECTID4: 0 }]
  }, { level0: { level: 0, primary: '', records: [], scrolls: [] }, pageFields: {} });
  assert.deepEqual(def.items.map((i) => [i.num, i.pageName, i.hidden, i.deferred]), [[1, 'JOB_DATA1', false, false], [2, 'JOB_DATA_JOBCODE', false, false], [11, 'JOB_DATA1_WRK', true, true]]);
  const u = def.properties.use, i = def.properties.internet;
  assert.equal(u.addSearchRecord, ''); // the search record again: App Designer shows it blank
  assert.deepEqual(u.actions, { add: false, updateDisplay: true, updateDisplayAll: true, correction: true });
  assert.deepEqual(u.build, { label: 'Default (application server)' });
  assert.deepEqual(i.realtimeLink, { set: 124, number: 63, default: true });
  assert.deepEqual(i.keywordLink, { set: 124, number: 433, default: true });
  assert.equal(i.deferred, true);
  assert.deepEqual(def.peopleCodeRecords, ['JOB']); // record-level only, as App Designer marks them
  assert.deepEqual(def.peopleCodeEvents, ['PreBuild']);
  const html = renderComponentHtml(def, 'N');
  assert.match(html, /<tr data-page="JOB_DATA1" tabindex="0"><td class="n">1<\/td>/);
  assert.match(html, /data-a="view">View Definition/);
  assert.match(html, /disabled title="Read-only[^"]*">Delete/);
  assert.doesNotMatch(html, /Register Component/);
});

test('View PeopleCode: the component\'s programs, objects and events as App Designer lists them', async () => {
  const { componentPrograms, peopleCodeObjects, eventsFor, componentPeopleCodeKey, bufferRecords } = await import('../model/componentPeopleCode.js');
  const programs = componentPrograms([
    { OBJECTID3: 12, OBJECTVALUE3: 'PostBuild', OBJECTID4: 0, OBJECTVALUE4: ' ', OBJECTID5: 0, OBJECTVALUE5: ' ' },
    { OBJECTID3: 1, OBJECTVALUE3: 'DERIVED_GL', OBJECTID4: 12, OBJECTVALUE4: 'RowInit', OBJECTID5: 0, OBJECTVALUE5: ' ' },
    { OBJECTID3: 1, OBJECTVALUE3: 'DERIVED_GL', OBJECTID4: 2, OBJECTVALUE4: 'GL_DEL_COMBO_PB', OBJECTID5: 12, OBJECTVALUE5: 'FieldChange' },
    { OBJECTID3: 1, OBJECTVALUE3: 'DERIVED_HR_NP', OBJECTID4: 2, OBJECTVALUE4: 'X', OBJECTID5: 12, OBJECTVALUE5: 'FieldEdit' }
  ]);
  assert.deepEqual(programs, [{ event: 'PostBuild' }, { record: 'DERIVED_GL', event: 'RowInit' },
    { record: 'DERIVED_GL', field: 'GL_DEL_COMBO_PB', event: 'FieldChange' }, { record: 'DERIVED_HR_NP', field: 'X', event: 'FieldEdit' }]);
  const objects = peopleCodeObjects('JOB_DATA', bufferRecords({ searchRecord: { name: 'EMPLMT_SRCH_ALL' },
    level0: { records: [{ name: 'DERIVED_GL' }], scrolls: [{ records: [{ name: 'JOB' }], scrolls: [] }] } }), programs);
  assert.deepEqual(objects.map((o) => [o.label, o.withCode]), [
    ['JOB_DATA (component)', ['PostBuild']], ['EMPLMT_SRCH_ALL (record)', []], ['DERIVED_GL (record)', ['RowInit']],
    ['DERIVED_GL.GL_DEL_COMBO_PB (field)', ['FieldChange']], ['JOB (record)', []],
    ['DERIVED_HR_NP (record)', []], ['DERIVED_HR_NP.X (field)', ['FieldEdit']] // a record with field code only, outside the buffer list
  ]);
  // App Designer's order: with no code, run order (ZZ_PCODE_LAB_CMP); events with a program first (JOB_DATA, DERIVED_GL, GL_DEL_COMBO_PB).
  assert.deepEqual(eventsFor({}), ['PreBuild', 'PostBuild', 'SavePreChange', 'SavePostChange', 'Workflow']);
  assert.deepEqual(eventsFor({ withCode: ['SavePreChange', 'PreBuild', 'PostBuild', 'SavePostChange'] }),
    ['PostBuild', 'PreBuild', 'SavePostChange', 'SavePreChange', 'Workflow']);
  assert.deepEqual(eventsFor({ record: 'DERIVED_GL', withCode: ['RowInit'] }),
    ['RowInit', 'RowInsert', 'RowDelete', 'RowSelect', 'SaveEdit', 'SavePostChange', 'SavePreChange', 'SearchInit', 'SearchSave']);
  assert.deepEqual(eventsFor({ record: 'DERIVED_GL', field: 'GL_DEL_COMBO_PB', withCode: ['FieldDefault', 'FieldChange'] }),
    ['FieldChange', 'FieldDefault', 'FieldEdit', 'PrePopup']);
  assert.equal(eventsFor({ record: 'R' }).length, 9);
  assert.deepEqual(eventsFor({ record: 'R', field: 'F' }), ['FieldChange', 'FieldDefault', 'FieldEdit', 'PrePopup']);
  assert.deepEqual(componentPeopleCodeKey('JOB_DATA', 'GBL', { record: 'DERIVED_GL', field: 'GL_DEL_COMBO_PB' }, 'FieldChange'),
    { type: 48, parts: ['JOB_DATA', 'GBL', 'DERIVED_GL', 'GL_DEL_COMBO_PB', 'FieldChange'] });
  assert.deepEqual(componentPeopleCodeKey('JOB_DATA', 'GBL', { record: 'DERIVED_GL' }, 'RowInit'), { type: 47, parts: ['JOB_DATA', 'GBL', 'DERIVED_GL', 'RowInit'] });
  assert.deepEqual(componentPeopleCodeKey('JOB_DATA', 'GBL', {}, 'PostBuild'), { type: 46, parts: ['JOB_DATA', 'GBL', 'PostBuild'] });
});

test('a component is not saved without a search record', async () => {
  const { componentSaveRefusal } = await import('../model/componentDefinition.js');
  assert.match(componentSaveRefusal({ name: 'ZZ_PCODE_LAB_CMP', searchRecord: ' ' })!, /no search record\. Add one in Component Properties > Use/);
  assert.equal(componentSaveRefusal({ name: 'ZZ_PCODE_LAB_CMP', searchRecord: 'ZZ_PCODE_LAB_R1' }), undefined);
});

test('the editable component panel: inputs, Insert Page, Save, Cut / Copy / Paste / Delete; read-only has none', async () => {
  const { gridRow } = await import('../editors/componentHtml.js');
  const item = { num: 1, pageName: 'ZZ_PCODE_LAB_PG', itemName: 'ZZ_PCODE_LAB_PG', hidden: true, itemLabel: 'Zz Pcode Lab Pg', folderTabLabel: '', deferred: true };
  const edit = gridRow(item, true);
  assert.match(edit, /draggable="true"/);
  assert.match(edit, /<input type="checkbox" class="hidden" checked/);
  assert.match(edit, /class="label" maxlength="30" value="Zz Pcode Lab Pg"/);
  assert.doesNotMatch(gridRow(item, false), /<input/);
  const def = buildComponentDefinition('ZZ_PCODE_LAB_CMP', 'GBL', {
    defn: { DESCR: 'Lab Component', SEARCHRECNAME: 'ZZ_PCODE_LAB_R1', ADDSRCHRECNAME: 'ZZ_PCODE_LAB_R1', ACTIONS: 2, VERSION: 335, INCLNAVIGATION: 1 },
    items: [{ SUBITEMNUM: 1, PNLNAME: 'ZZ_PCODE_LAB_PG', ITEMNAME: 'ZZ_PCODE_LAB_PG', ITEMLABEL: 'Zz Pcode Lab Pg', FOLDERTABLABEL: ' ', HIDDEN: 0, PAGEDEFERPROC: 1 }],
    menus: [], programs: []
  }, { level0: { level: 0, primary: '', records: [], scrolls: [] }, pageFields: {} });
  const html = renderComponentHtml(def, 'N', { editable: true, status: 'Saved (v335)' });
  for (const id of ['insert-page', 'save', 'p-search', 'p-descr', 'p-comments', 'p-add', 'p-nosave']) assert.match(html, new RegExp(`id="${id}"`));
  for (const a of ['cut', 'copy', 'paste', 'delete']) assert.match(html, new RegExp(`data-a="${a}"`));
  assert.match(html, /id="status">Saved \(v335\)</);
  assert.match(html, /Add a search record \(Component Properties > Use\) before saving/);
  const ro = renderComponentHtml(def, 'N');
  assert.doesNotMatch(ro, /id="save"|id="insert-page"|data-a="cut"/);
});

test('Internet and Fluid tabs decode as App Designer shows them (JOB_DATA.GBL, and ZZ_PCODE_LAB_CMP after h398)', () => {
  const tabs = (defn: Record<string, unknown>, ext: Record<string, unknown>) => buildComponentDefinition('C', 'GBL',
    { defn: { SEARCHRECNAME: 'R', ADDSRCHRECNAME: 'R', ...defn }, ext, items: [], menus: [], programs: [] },
    { level0: { level: 0, primary: '', records: [], scrolls: [] }, pageFields: {} }).properties;
  const on = (list: Array<{ label: string; on: boolean }>) => list.filter((x) => x.on).map((x) => x.label);

  // JOB_DATA's Component Properties dialog (screenshots).
  const job = tabs({ TBARBTNS: 130019, PNLNAVFLAGS: 11, SHOWTBAR: 1, PRIMARYACTION: 1, DFLTSRCHTYPE: 1, COMP_TYPE: 0, INCSEARCH: 0 },
    { PTENABLENOTIFY: 0, PTS_ENABLECONFSRCH: 0 });
  assert.deepEqual(on(job.internet.toolbar), ['Save', 'Cancel', 'Return to List', 'Next in List', 'Previous in List', 'Refresh', 'Notify',
    'View WorkList', 'Next in WorkList', 'Previous in WorkList', 'Update/Display', 'Update/Display All', 'Correction']);
  assert.equal(job.internet.showToolbar, true);
  assert.deepEqual([job.internet.folderTabs, job.internet.hyperlinks, job.internet.pageNavigationInHistory, job.internet.returnToLastPageInHistory], [true, true, false, false]);
  assert.deepEqual(on(job.internet.pagebar), ['Help Link', 'Copy URL Link', 'New Window Link', 'Customize Page Link']);
  assert.equal(job.internet.disablePagebar, false);
  assert.deepEqual([job.internet.primaryAction, job.internet.defaultSearchType], [{ label: 'Search' }, { label: 'Advanced' }]);
  assert.deepEqual(on(job.fluid.headerActions), ['Help', 'New Window']);
  assert.equal(job.fluid.disableAllActions, false);
  assert.deepEqual([job.fluid.componentType, job.fluid.searchPageType], [{ label: 'Standard' }, { label: 'None' }]);

  // ZZ_PCODE_LAB_CMP after the last capture (h398): Disable All Actions, Help / Notify / New Window left checked.
  const zz = tabs({ TBARBTNS: 2080, SHOWTBAR: 42, PNLNAVFLAGS: 0, FLUIDMODE: 1, INCSEARCH: 1, COMP_TYPE: 0 }, { PTENABLENOTIFY: 1, PTS_ENABLECONFSRCH: 1 });
  assert.deepEqual(on(zz.fluid.headerActions), ['Help', 'Notify', 'New Window']);
  assert.equal(zz.fluid.disableAllActions, true);
  assert.equal(zz.internet.showToolbar, false); // the same bit as Disable Toolbar
  assert.deepEqual(on(zz.internet.toolbar), ['Refresh', 'Update/Display']);
  // Save is shown unchecked while Disable Saving Page is on (ZZ_PCODE_LAB_CMP v407: bit 0x1 set, DISABLESAVE 1).
  const v407 = tabs({ TBARBTNS: 559137, SHOWTBAR: 35, DISABLESAVE: 1 }, {});
  assert.deepEqual(on(v407.internet.toolbar), ['Refresh', 'Notify', 'Update/Display']);
  assert.deepEqual([zz.fluid.fluidMode, zz.fluid.configurableSearch, zz.fluid.searchPageType], [true, true, { label: 'Standard' }]);
  assert.equal(tabs({ COMP_TYPE: 2, INCSEARCH: 2 }, {}).fluid.componentType.hasOwnProperty('label'), true);
  assert.deepEqual(tabs({ COMP_TYPE: 2, INCSEARCH: 2 }, {}).fluid.searchPageType, { label: 'Master/Detail' });
});

test('the editable Internet / Fluid / Style tabs: App Designer\'s boxes as inputs, shared boxes linked, Style hidden in Fluid Mode', () => {
  const def = (fluid: number) => buildComponentDefinition('C', 'GBL', {
    defn: { SEARCHRECNAME: 'R', ADDSRCHRECNAME: 'R', ACTIONS: 2, TBARBTNS: 2080, SHOWTBAR: 35, FLUIDMODE: fluid, PNLGRPUSE: 1, VERSION: 1 },
    ext: { PTENABLENOTIFY: 0 }, items: [], menus: [],
    programs: [], scripts: [{ PTSCRIPTTYPE: 'CSS', PTSCRIPTNAME: 'ACE_SS1', PTSCRIPTCATG: 'DEV', SEQNO: 0 }, { PTSCRIPTTYPE: 'JS', PTSCRIPTNAME: 'BEN_ATTACH', PTSCRIPTCATG: 'DEV', SEQNO: 0 }]
  }, { level0: { level: 0, primary: '', records: [], scrolls: [] }, pageFields: {} });
  const html = renderComponentHtml(def(0), 'N', { editable: true });
  assert.match(html, /id="tb-2048" checked/); // Refresh
  assert.match(html, /id="i-navhist"[^>]*data-sync="navhist"/);
  assert.match(html, /id="f-navhist"[^>]*data-sync="navhist"/);
  assert.match(html, /id="pb-4" checked data-sync="help"/);
  assert.match(html, /id="ha-Help" checked data-sync="help"/);
  assert.match(html, /id="i-notoolbar" data-sync="notoolbar"/);
  assert.match(html, /<ul class="objlist" id="st-css"><li tabindex="0">ACE_SS1<\/li><\/ul>/);
  assert.match(html, /id="s-classic" checked/);
  assert.doesNotMatch(html, /class="ptab gone" data-p="style"/);
  assert.match(renderComponentHtml(def(1), 'N', { editable: true }), /class="ptab gone" data-p="style"/);
  const ro = renderComponentHtml(def(0), 'N');
  assert.doesNotMatch(ro, /id="tb-2048"/);
  assert.match(ro, /Classic Plus/);
});

test('the Component PeopleCode editor\'s object list: each buffer record with its fields (ZZ_PCODE_LAB_CMP)', async () => {
  const { peopleCodeObjects, eventsFor } = await import('../model/componentPeopleCode.js');
  // A table's fields are all of them, a Derived/Work record's only those on the pages (ZZ_PCODE_LAB shows ZZ_PCODE_LAB_C01 alone).
  const objects = peopleCodeObjects('ZZ_PCODE_LAB_CMP.GBL', ['ZZ_PCODE_LAB_R1', 'ZZ_PCODE_LAB'], [{ event: 'PreBuild' }],
    { ZZ_PCODE_LAB_R1: ['ZZ_PCODE_LAB_KEY', 'ZZ_PCODE_LAB_C01'], ZZ_PCODE_LAB: ['ZZ_PCODE_LAB_C01'] });
  assert.deepEqual(objects.map((o) => o.label), ['ZZ_PCODE_LAB_CMP.GBL (component)', 'ZZ_PCODE_LAB_R1 (record)',
    'ZZ_PCODE_LAB_R1.ZZ_PCODE_LAB_KEY (field)', 'ZZ_PCODE_LAB_R1.ZZ_PCODE_LAB_C01 (field)', 'ZZ_PCODE_LAB (record)', 'ZZ_PCODE_LAB.ZZ_PCODE_LAB_C01 (field)']);
  // Opening the component opens its first event: one with a program, else PreBuild.
  assert.equal(eventsFor(objects[0])[0], 'PreBuild');
  assert.equal(eventsFor({ ...objects[0], withCode: ['SavePreChange'] })[0], 'SavePreChange');
  assert.equal(eventsFor(objects[1])[0], 'RowInit');
});
