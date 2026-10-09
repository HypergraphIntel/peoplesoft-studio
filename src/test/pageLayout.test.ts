import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPageLayout, controlShape } from '../model/pageLayout.js';
import type { PageView, Row } from '../model/uiDefinitions.js';
import { renderPageHtml } from '../editors/pageHtml.js';

const field = (over: Partial<Record<string, unknown>>): Row => ({
  FIELDNUM: 1, OCCURSLEVEL: 0, FIELDTYPE: 4, FIELDUSE: 0, LBLTYPE: 3, LBLTEXT: '', RECNAME: ' ', FIELDNAME: ' ',
  FIELDLEFT: 0, FIELDTOP: 0, FIELDRIGHT: 0, FIELDBOTTOM: 0, EDITLBLLEFT: 0, EDITLBLTOP: 0, EDITLBLRIGHT: 0, EDITLBLBOTTOM: 0,
  PNLFIELDNAME: '', ...over
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

test('the HTML positions each control by id and carries its data, with a CSP and the Order text', () => {
  const layout = buildPageLayout('P', view([
    field({ FIELDNUM: 7, FIELDTYPE: 5, RECNAME: 'NAMES', FIELDNAME: 'NAME_TYPE', LBLTEXT: 'Type',
      FIELDLEFT: 20, FIELDTOP: 40, FIELDRIGHT: 120, FIELDBOTTOM: 58, EDITLBLLEFT: -1 })
  ]));
  const html = renderPageHtml(layout, 'ORDER VIEW TEXT', 'NONCE');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /#c7\{left:20px;top:40px;width:100px;height:18px;/);
  assert.match(html, /class="ctl s-dropdown" id="c7"[^>]*data-target="NAMES\.NAME_TYPE"/);
  assert.match(html, /ORDER VIEW TEXT/);
});
