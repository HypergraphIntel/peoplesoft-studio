import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { portalHtml } from '../editors/portalHtml.js';
import { portalInput, portalInputForDocument, portalTargetColumns, portalToken, portalUrlChecksum, type PortalDocument } from '../model/portalDocument.js';

test('registry identity is portal-scoped; cycles and unsupported folder targets are rejected', () => {
  const folder = { portal: 'EMPLOYEE', refType: 'F', name: 'ZZ_FOLDER', parent: 'PORTAL_ROOT_OBJECT', label: 'Folder' };
  assert.equal(portalInput.parse(folder).portal, 'EMPLOYEE');
  assert.equal(portalInput.parse({ ...folder, parent: 'FOLDER_(GBL)' }).parent, 'FOLDER_(GBL)');
  assert.throws(() => portalInput.parse({ ...folder, name: ' PADDED ' }));
  assert.throws(() => portalInput.parse({ ...folder, parent: folder.name }));
  assert.throws(() => portalInput.parse({ ...folder, target: { type: 'external', url: 'https://example.invalid' } }));
  assert.throws(() => portalInput.parse({ ...folder, permissions: [{ type: 'P', name: 'PTPT1000' }, { type: 'P', name: 'PTPT1000' }] }));
});

test('component URLs and checksums match the native registration capture', () => {
  const row = portalTargetColumns({ type: 'component', node: 'HRMS', menu: 'ZZ_PCODE_LAB_MENU', component: 'ZZ_PCODE_LAB_CMP', market: 'GBL', page: '', parameters: '' });
  assert.equal(row.PORTAL_URLTEXT, 'c/ZZ_PCODE_LAB_MENU.ZZ_PCODE_LAB_CMP.GBL');
  assert.equal(row.PORTAL_URL_CHKSUM, 61312);
  assert.equal(portalUrlChecksum('c/SD.FS_SD_RECDEFN.GBL'), 18066);
  const page = portalTargetColumns({ type: 'component', node: 'HRMS', menu: 'M', component: 'C', market: 'GBL', page: 'PAGE', parameters: 'Action=U' });
  assert.equal(page.PORTAL_URLTEXT, 'c/M.C.GBL?Page=PAGE&Action=U');
});

test('opening advanced references preserves targets and public settings, and retains cascade grants', () => {
  const doc: PortalDocument = { identity: { portal: 'CUSTOMER', refType: 'C', name: 'ZZ_REF' },
    row: { PORTAL_PRNTOBJNAME: 'FOLDER', PORTAL_LABEL: 'Reference', PORTAL_SEQ_NUM: 10, PORTAL_CREF_URLT: 'USCR', PORTAL_URLTEXT: 's/ISCRIPT', PORTAL_ISPUBLIC: 2 },
    permissions: [{ PORTAL_PERMTYPE: 'P', PORTAL_PERMNAME: 'PTPT1000', PORTAL_ISCASCADE: 1 }], attributes: [], token: 'test' };
  const input = portalInputForDocument(doc);
  assert.equal(input.target, undefined); assert.equal(input.publicAccess, undefined);
  assert.deepEqual(input.permissions, [{ type: 'P', name: 'PTPT1000', cascade: true }]);
  assert.equal(portalInput.parse(input).target, undefined);
});

test('concurrency includes grants, attributes and lossless timestamps', () => {
  const row = { LASTUPDDTTM: '2026-10-14 01:02:03.000001', VERSION: 1 };
  assert.equal(portalToken(row, [], []), portalToken({ VERSION: 1, LASTUPDDTTM: row.LASTUPDDTTM }, [], []));
  assert.notEqual(portalToken(row, [], []), portalToken({ ...row, LASTUPDDTTM: '2026-10-14 01:02:03.000002' }, [], []));
  assert.notEqual(portalToken(row, [], []), portalToken(row, [{ PORTAL_PERMNAME: 'P' }], []));
  assert.notEqual(portalToken(row, [], []), portalToken(row, [], [{ PORTAL_ATTR_VAL: 'A' }]));
});

test('portal editor script parses and connection/portal captions are escaped', () => {
  const html = portalHtml('<PORTAL>', '<CONNECTION>', 'testnonce');
  assert.ok(html.includes('&lt;PORTAL&gt;')); assert.ok(html.includes('&lt;CONNECTION&gt;'));
  const script = html.match(/<script nonce="testnonce">([\s\S]*?)<\/script>/)![1];
  assert.doesNotThrow(() => new Script(script));
  assert.ok(html.includes('New Folder')); assert.ok(html.includes('New Content Reference'));
});
