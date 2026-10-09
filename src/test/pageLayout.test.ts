import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPageLayout, controlShape } from '../model/pageLayout.js';
import type { PageView, Row } from '../model/uiDefinitions.js';
import { renderPageHtml } from '../editors/pageHtml.js';

const field = (over: Partial<Record<string, unknown>>): Row => ({
  FIELDNUM: 1, OCCURSLEVEL: 0, FIELDTYPE: 4, FIELDUSE: 0, LBLTYPE: 3, LBLTEXT: '', RECNAME: ' ', FIELDNAME: ' ',
  FIELDLEFT: 0, FIELDTOP: 0, FIELDRIGHT: 0, FIELDBOTTOM: 0, EDITLBLLEFT: 0, EDITLBLTOP: 0, EDITLBLRIGHT: 0, EDITLBLBOTTOM: 0,
  FIELDSIZETYPE: 0, SECUREINVISIBLE: 0, PNLFLDID: Number(over.FIELDNUM ?? 1), PNLFIELDNAME: '', ...over
});

const view = (fields: Row[]): PageView => ({ page: { PNLTYPE: 0, VERSION: 3, DESCR: 'A page' }, fields, components: [] });

test('a control keeps its stored rectangle; the shape follows FIELDTYPE', () => {
  const layout = buildPageLayout('P', view([
    field({ FIELDNUM: 1, FIELDTYPE: 4, RECNAME: 'JOB', FIELDNAME: 'EMPLID', LBLTEXT: 'Person ID',
      FIELDLEFT: 508, FIELDTOP: 4, FIELDRIGHT: 592, FIELDBOTTOM: 20, EDITLBLLEFT: 480, EDITLBLTOP: 4, EDITLBLRIGHT: 504, EDITLBLBOTTOM: 20 })
  ]));
  const c = layout.controls[0];
  assert.deepEqual(c.rect, { left: 508, top: 4, width: 84, height: 16 });
  assert.equal(c.shape, 'field');
  assert.equal(c.recordField, 'JOB.EMPLID');
  assert.deepEqual(c.label, { text: 'Person ID', rect: { left: 480, top: 4, width: 24, height: 16 } });
});

test('shapes map the main control types', () => {
  assert.equal(controlShape(4), 'field');
  assert.equal(controlShape(5), 'dropdown');
  assert.equal(controlShape(7), 'checkbox');
  assert.equal(controlShape(8), 'radio');
  assert.equal(controlShape(12), 'button');
  assert.equal(controlShape(2), 'container'); // Group Box
  assert.equal(controlShape(27), 'container'); // Scroll Area
  assert.equal(controlShape(10), 'misc'); // Scroll Bar
});

test('an auto-sized control (zero right/bottom) gets a small default size', () => {
  const [c] = buildPageLayout('P', view([field({ FIELDTYPE: 7, FIELDLEFT: 332, FIELDTOP: 4, FIELDRIGHT: 0, FIELDBOTTOM: 0 })])).controls;
  assert.equal(c.rect.width, 14);
  assert.equal(c.rect.height, 14);
  // An auto-sized edit box (as App Designer stores a fresh one) is drawn at a field's width.
  const [e] = buildPageLayout('P', view([field({ FIELDTYPE: 4, FIELDLEFT: 64, FIELDTOP: 120, FIELDRIGHT: 0, FIELDBOTTOM: 0 })])).controls;
  assert.deepEqual(e.rect, { left: 64, top: 120, width: 80, height: 18 });
});

test('a label with negative coordinates (App Designer\'s "not shown") is dropped', () => {
  const [c] = buildPageLayout('P', view([field({ LBLTEXT: 'Name', EDITLBLLEFT: -392, EDITLBLTOP: -4 })])).controls;
  assert.equal(c.label, undefined);
});

test('the surface spans the controls plus a margin', () => {
  const layout = buildPageLayout('P', view([
    field({ FIELDNUM: 1, FIELDLEFT: 10, FIELDTOP: 10, FIELDRIGHT: 110, FIELDBOTTOM: 30 }),
    field({ FIELDNUM: 2, FIELDLEFT: 800, FIELDTOP: 850, FIELDRIGHT: 900, FIELDBOTTOM: 880 })
  ]));
  assert.equal(layout.width, 912);
  assert.equal(layout.height, 892);
});

test('the HTML positions each control by id, carries its data, with a CSP and the Order grid', () => {
  const layout = buildPageLayout('P', view([
    field({ FIELDNUM: 7, PNLFLDID: 7, FIELDTYPE: 5, RECNAME: 'NAMES', FIELDNAME: 'NAME_TYPE', LBLTEXT: 'Type',
      FIELDLEFT: 20, FIELDTOP: 40, FIELDRIGHT: 120, FIELDBOTTOM: 58, EDITLBLLEFT: -1 })
  ]));
  const html = renderPageHtml(layout, '', 'NONCE');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /#c7\{left:20px;top:40px;width:100px;height:18px;/);
  assert.match(html, /class="ctl s-dropdown" id="c7"[^>]*data-target="NAMES\.NAME_TYPE"/);
  // The Order tab is a grid, one row per control.
  assert.match(html, /<table class="order-grid">/);
  assert.match(html, /<tr data-id="7"[^>]*>.*NAME_TYPE.*NAMES/s);
});

test('FIELDUSE bits mark display-only and invisible controls', () => {
  const [a] = buildPageLayout('P', view([field({ FIELDUSE: 1 })])).controls;
  assert.equal(a.displayOnly, true);
  assert.equal(a.invisible, false);
  const [b] = buildPageLayout('P', view([field({ FIELDUSE: 2 })])).controls;
  assert.equal(b.invisible, true);
  // Both bits (plus others, as on delivered pages).
  const [c] = buildPageLayout('P', view([field({ FIELDUSE: 13 })])).controls; // 0x0D
  assert.equal(c.displayOnly, true);
  assert.equal(c.invisible, false);
  const html = renderPageHtml(buildPageLayout('P', view([field({ FIELDNUM: 1, FIELDUSE: 1 }), field({ FIELDNUM: 2, FIELDUSE: 2 })])), '', 'N');
  assert.match(html, /class="ctl s-field u-display-only"/);
  assert.match(html, /class="ctl s-field u-invisible"/);
});

test('editable render adds the save toolbar, resize handles and round-trip data; read-only omits them', () => {
  const layout = buildPageLayout('P', view([field({ FIELDNUM: 2, FIELDTYPE: 4, FIELDLEFT: 10, FIELDTOP: 20, FIELDRIGHT: 90, FIELDBOTTOM: 38, LBLTEXT: 'X' })]));
  const edit = renderPageHtml(layout, 'ORDER', 'N', { editable: true });
  assert.match(edit, /id="save"/);
  assert.match(edit, /const editable = true/);
  assert.match(edit, /class="rsz"/);
  assert.match(edit, /data-id="2"[^>]*data-fl="10"[^>]*data-ft="20"[^>]*data-fr="90"[^>]*data-fb="38"/);
  const ro = renderPageHtml(layout, 'ORDER', 'N', { editable: false });
  assert.doesNotMatch(ro, /id="save"/);
  assert.match(ro, /const editable = false/);
  assert.doesNotMatch(ro, /class="rsz"/);
});

test('LBLTYPE 0 (None) shows no label even when LBLTEXT is set; types 1-3 do', () => {
  const none = buildPageLayout('P', view([field({ LBLTYPE: 0, LBLTEXT: 'Department Name', EDITLBLLEFT: 0, EDITLBLTOP: 9 })])).controls[0];
  assert.equal(none.label, undefined);
  const text = buildPageLayout('P', view([field({ LBLTYPE: 1, LBLTEXT: 'My Label', EDITLBLLEFT: 10, EDITLBLTOP: 5, EDITLBLRIGHT: 60, EDITLBLBOTTOM: 20 })])).controls[0];
  assert.equal(text.label?.text, 'My Label');
  const rft = buildPageLayout('P', view([field({ LBLTYPE: 3, LBLTEXT: 'Military Service', EDITLBLLEFT: 36, EDITLBLTOP: 52, EDITLBLRIGHT: 123, EDITLBLBOTTOM: 67 })])).controls[0];
  assert.equal(rft.label?.text, 'Military Service');
});

test('page properties come from PSPNLDEFN', () => {
  const v: PageView = { page: { PNLTYPE: 0, VERSION: 7, DESCR: 'Job Data1', DESCRLONG: 'Effective Dated Work Location', OBJECTOWNERID: 'HCR', PANELRIGHT: 984, PANELBOTTOM: 1400, STYLESHEETNAME: ' ', LASTUPDOPRID: 'PPLSOFT' }, fields: [], components: [] };
  const p = buildPageLayout('JOB_DATA1', v).properties;
  assert.equal(p.description, 'Job Data1');
  assert.equal(p.comments, 'Effective Dated Work Location');
  assert.equal(p.ownerId, 'HCR');
  assert.equal(p.pageType, 'Standard Page');
  assert.equal(p.sizeWidth, 984);
  assert.equal(p.sizeHeight, 1400);
  assert.equal(p.version, 7);
  assert.equal(p.lastUpdatedBy, 'PPLSOFT');
  // The HTML embeds them and shows a Page button.
  const html = renderPageHtml(buildPageLayout('JOB_DATA1', v), '', 'N');
  assert.match(html, /id="page-props-btn"/);
  assert.match(html, /"sizeWidth":984/);
});

test('the editable page has the Insert palette; read-only does not', () => {
  const layout = buildPageLayout('P', view([field({ FIELDNUM: 1 })]));
  const edit = renderPageHtml(layout, '', 'N', { editable: true, status: 'Saved (v9)' });
  for (const kind of ['frame', 'groupBox', 'horizontalRule', 'staticText', 'checkBox', 'dropDown', 'editBox', 'pushButton']) {
    assert.match(edit, new RegExp(`class="tool" data-kind="${kind}"`));
  }
  assert.match(edit, /"staticText":\{"shape":"label","typeName":"Static Text","bound":false,"w":128,"h":20/);
  assert.match(edit, /"editBox":\{"shape":"field","typeName":"Edit Box","bound":true/);
  assert.match(edit, /"groupBox":\{"shape":"container","typeName":"Group Box","bound":false,"w":300,"h":156/);
  assert.match(edit, /id="status">Saved \(v9\)</);
  const ro = renderPageHtml(layout, '', 'N', { editable: false });
  assert.doesNotMatch(ro, /class="tool"/);
});

test('static text with a relative (all-zero) label is drawn inside its box', () => {
  const [c] = buildPageLayout('P', view([field({ FIELDTYPE: 0, LBLTYPE: 1, LBLTEXT: 'Static Text', FIELDLEFT: 84, FIELDTOP: 376, FIELDRIGHT: 212, FIELDBOTTOM: 396 })])).controls;
  assert.deepEqual(c.label, { text: 'Static Text', rect: { left: 86, top: 379, width: 0, height: 14 } });
});

test('the surface is the page size when it has one; the editor can drag its edge', () => {
  const v: PageView = { page: { PNLTYPE: 0, VERSION: 1, PANELRIGHT: 959, PANELBOTTOM: 988, PNLUSE: 11 }, fields: [field({ FIELDLEFT: 10, FIELDTOP: 10, FIELDRIGHT: 50, FIELDBOTTOM: 30 })], components: [] };
  const layout = buildPageLayout('P', v);
  assert.equal(layout.width, 959);
  assert.equal(layout.height, 988);
  assert.equal(layout.properties.sizeCustom, true);
  assert.equal(buildPageLayout('P', { ...v, page: { ...v.page, PNLUSE: 35 } }).properties.sizeCustom, false);
  assert.match(renderPageHtml(layout, '', 'N', { editable: true }), /class="pg-edge pg-rb" data-edge="rb"/);
  assert.doesNotMatch(renderPageHtml(layout, '', 'N', { editable: false }), /class="pg-edge/);
});
