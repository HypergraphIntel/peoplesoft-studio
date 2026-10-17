import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { adminInputKey, adminToken, inputForAdminDocument, validateAdminInput, urlProtocol, invalidTextTags, type AdminDocument } from '../model/administration.js';
import { administrationHtml } from '../editors/administrationHtml.js';
import { messageSetDescriptions } from '../providers/administrationWriter.js';

test('message validation respects the custom range, severity and PeopleTools field lengths', () => {
  const valid = { set: 20000, number: 1, setDescription: 'Custom', setShortDescription: '', severity: 'M', text: 'Hello %1', explanation: '' };
  assert.deepEqual(adminInputKey('message', validateAdminInput('message', valid)), ['20000', '1']);
  for (const change of [{ set: 19999 }, { number: 32768 }, { text: 'x'.repeat(101) }, { text: ' ' }, { severity: 'Q' }]) {
    assert.throws(() => validateAdminInput('message', { ...valid, ...change }));
  }
});

test('Text Catalog identities include all six context keys and the exact language/date', () => {
  const value = { owner: 'HCR', subId: '', id: 'ZZ_TEXT', effectiveDate: '2026-10-14', keys: ['A','B','C','D','E','F'],
    language: 'FRA', text: 'Bonjour', description: '', usage: '', systemData: true };
  assert.deepEqual(adminInputKey('text', validateAdminInput('text', value)), ['HCR','','ZZ_TEXT','2026-10-14','A','B','C','D','E','F','FRA']);
  assert.throws(() => validateAdminInput('text', { ...value, effectiveDate: '2026-02-30' }));
  assert.throws(() => validateAdminInput('text', { ...value, keys: [] }));
  assert.throws(() => validateAdminInput('text', { ...value, text: 'x'.repeat(8096) }));
});

test('URL property protocol groups follow the delivered FieldChange mapping', () => {
  assert.equal(urlProtocol('ftp://host'), 'FTPS');
  assert.equal(urlProtocol('ftps://host'), 'FTPS');
  assert.equal(urlProtocol('cloud:https://host'), 'HTTPS');
  assert.equal(urlProtocol('sftp://host'), 'SFTP');
  assert.equal(urlProtocol('record://REC'), 'RECOR');
  assert.equal(urlProtocol('C:/files'), '');
});

test('catalog tokens detect related language and parent changes without depending on object property order', () => {
  const token = adminToken('message', ['20000','1'], { MESSAGE_TEXT:'A', MSG_SEVERITY:'M' }, [], { VERSION:1 });
  assert.equal(token, adminToken('message', ['20000','1'], { MSG_SEVERITY:'M', MESSAGE_TEXT:'A' }, [], { VERSION:1 }));
  assert.notEqual(token, adminToken('message', ['20000','1'], { MSG_SEVERITY:'M', MESSAGE_TEXT:'A' }, [], { VERSION:2 }));
  assert.notEqual(token, adminToken('message', ['20000','1'], { MSG_SEVERITY:'M', MESSAGE_TEXT:'A' }, [{ LANGUAGE_CD:'FRA', MESSAGE_TEXT:'B' }], { VERSION:1 }));
});

test('opening a message preserves literal trailing spaces and long-text whitespace', () => {
  const doc: AdminDocument = { kind:'message', key:['20000','1'], row:{ MESSAGE_TEXT:'Hello  ',MSG_SEVERITY:'W',DESCRLONG:'\nExplain  \n' }, related:[],token:'test' };
  const input = inputForAdminDocument(doc);
  assert.ok('severity' in input);
  assert.equal(input.text, 'Hello  ');
  if ('explanation' in input) assert.equal(input.explanation,'\nExplain  \n');
});

test('Text Catalog tags are matched exactly as the native allowed-tag list', () => {
  assert.deepEqual(invalidTextTags('<b>Text</b> <script>bad</script>', new Set(['<b>','</b>'])), ['<script>','</script>']);
});

test('all administration editors have searchable forms, readonly/busy controls and syntactically valid CSP scripts', () => {
  for (const kind of ['message','text','url'] as const) {
    const html = administrationHtml(kind, 'HRDMO <script>bad</script>', 'testnonce');
    assert.ok(html.includes('HRDMO &lt;script&gt;bad&lt;/script&gt;'));
    assert.ok(html.includes("script-src 'nonce-testnonce'"));
    assert.ok(html.includes('id="formFields"'));
    assert.ok(html.includes('id="previous"'));
    assert.ok(html.includes('id="save"'));
    const script = /<script nonce="testnonce">([\s\S]*?)<\/script>/.exec(html)![1];
    assert.doesNotThrow(() => new Script(script));
    assert.ok(!script.includes('innerHTML'), 'database values use textContent, never HTML');
  }
});

test('blank message set descriptions keep the stored ones, on an edit as well as a new sibling', () => {
  const stored = { descr: 'Vendor Benefit Interface', short: 'Vendor' };
  // Editing message 25500,9 with blank set descriptions blanked the set on HRDMO.
  assert.deepEqual(messageSetDescriptions({ setDescription: '', setShortDescription: '' }, stored), stored);
  assert.deepEqual(messageSetDescriptions({ setDescription: '   ' }, stored), stored);
  // Supplied descriptions still change them; a missing short one is derived from the long one.
  assert.deepEqual(messageSetDescriptions({ setDescription: 'New name', setShortDescription: 'Short' }, stored), { descr: 'New name', short: 'Short' });
  assert.deepEqual(messageSetDescriptions({ setDescription: 'Benefits Interfaces', setShortDescription: '' }, stored), { descr: 'Benefits Interfaces', short: 'Benefits I' });
  // A brand new set with nothing supplied stays blank.
  assert.deepEqual(messageSetDescriptions({ setDescription: '' }, undefined), { descr: '', short: '' });
});
