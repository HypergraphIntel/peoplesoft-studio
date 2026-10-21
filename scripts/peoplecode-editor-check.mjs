/** Production editor providers with controlled connection delays/errors. Not native acceptance. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStub } from './vscode-stub.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'psft-editor-fixture-'));
const { vscode, settings } = createStub();
vscode.CompletionList = class { constructor(items, isIncomplete = false) { this.items = items; this.isIncomplete = isIncomplete; } };
const original = Module._load;
Module._load = function (name, ...args) { return name === 'vscode' ? vscode : original.call(this, name, ...args); };
const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
let checks = 0;
async function check(name, action) { await action(); checks++; console.log(`ok ${checks} - ${name}`); }
try {
  await build({ stdin: { contents: `export { registerPeopleCodeValidation } from './src/peoplecode/editorValidation'; export { registerPeopleCodeCompletion } from './src/peoplecode/completion'; export { DatabaseProvider } from './src/providers/database'; export { toUri } from './src/util/uri';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode', 'oracledb', 'ibm_db'], outfile: path.join(dir, 'editor.cjs'), logLevel: 'silent' });
  const { registerPeopleCodeCompletion, registerPeopleCodeValidation, DatabaseProvider, toUri } = require(path.join(dir, 'editor.cjs'));
  const changed = new vscode.EventEmitter();
  const events = {};
  for (const name of ['onDidOpenTextDocument', 'onDidChangeTextDocument', 'onDidSaveTextDocument', 'onDidCloseTextDocument']) {
    events[name] = new vscode.EventEmitter(); vscode.workspace[name] = events[name].event;
  }
  events.active = new vscode.EventEmitter(); vscode.window.onDidChangeActiveTextEditor = events.active.event;
  let completion;
  vscode.languages.registerCompletionItemProvider = (_selector, provider) => { completion = provider; return { dispose() {} }; };
  const context = { subscriptions: [], extensionPath: process.cwd() };
  let provider;
  const workspace = { getProviderByHandle: () => provider, onDidChange: changed.event };
  const database = (overrides = {}) => Object.assign(Object.create(DatabaseProvider.prototype), {
    pool: {}, readEnvironment: async () => ({ toolsRelease: '8.62' }), expandedFieldNames: async () => [], readText: async () => '', search: async () => [], ...overrides
  });
  const document = (text, type = 58) => {
    const doc = { uri: toUri('fixture', { type, parts: type === 58 ? ['FIXTURE', 'Child', 'OnExecute'] : ['ZZ_R', 'ZZ_F', 'FieldChange'] }), languageId: 'psft-peoplecode', version: 1,
      getText: () => text, lineAt: (line) => ({ text: text.split('\n')[typeof line === 'number' ? line : line.line] }),
      set: (value) => { text = value; doc.version++; } };
    vscode.workspace.textDocuments = [doc]; return doc;
  };
  const complete = (doc, triggerCharacter, token = { isCancellationRequested: false }) => {
    const lines = doc.getText().split('\n');
    return completion.provideCompletionItems(doc, { line: lines.length - 1, character: lines.at(-1).length }, token, { triggerKind: triggerCharacter ? 1 : 2, triggerCharacter });
  };
  const names = (result) => (Array.isArray(result) ? result : result?.items ?? []).map((i) => i.label);
  registerPeopleCodeCompletion(context, workspace);
  await check('CreateSQL completion has editable arguments while existing statement snippets retain their terminators', async () => {
    const result=await complete(document('')),items=Array.isArray(result)?result:result.items;
    assert.match(items.find(i=>i.label==='CreateSQL').insertText.value,/CreateSQL\(\$\{1:sqlText\}/);
    assert.ok(items.find(i=>i.label==='MessageBox').insertText.value.endsWith(';'));
  });
  await check('incomplete inherited completion remains a member list after typing', async () => {
    const read = deferred(); provider = database({ readText: () => read.promise });
    const doc = document('class Child extends FIXTURE:Parent\n method Own();\nend-class;\n%This.');
    const initial = await complete(doc, '.'); assert.ok(names(initial).includes('Own')); assert.equal(initial.isIncomplete, true);
    read.resolve('class Parent\n method ParentMember();\nend-class;'); await sleep(5);
    doc.set(doc.getText() + 'P');
    const items = names(await complete(doc)); assert.ok(items.includes('ParentMember')); assert.ok(!items.includes('MessageBox'));
  });
  await check('record fields remain available with a typed member prefix', async () => {
    provider = database({ expandedFieldNames: async () => ['DESCR', 'FIELD_A'] });
    assert.ok(names(await complete(document('ZZ_REC.D', 8))).includes('DESCR'));
  });
  await check('a reconnected provider cannot reuse the old record field cache', async () => {
    provider = database({ expandedFieldNames: async () => ['OLD_FIELD'] });
    const doc = document('ZZ_OTHER.', 8); assert.ok(names(await complete(doc, '.')).includes('OLD_FIELD'));
    provider = database({ expandedFieldNames: async () => ['NEW_FIELD'] }); changed.fire();
    const found = names(await complete(doc, '.')); assert.ok(found.includes('NEW_FIELD')); assert.ok(!found.includes('OLD_FIELD'));
  });
  await check('slow record completion returns an incomplete list promptly', async () => {
    const read = deferred(); provider = database({ expandedFieldNames: () => read.promise });
    const doc = document('ZZ_SLOW.', 8);
    const result = await Promise.race([complete(doc, '.'), sleep(700).then(() => 'timed out')]);
    read.resolve(['READY']); assert.notEqual(result, 'timed out'); assert.equal(result.isIncomplete, true);
  });
  await check('completion drops results after the document changes', async () => {
    const read = deferred(); provider = database({ expandedFieldNames: () => read.promise });
    const doc = document('ZZ_STALE.', 8); const result = complete(doc, '.'); doc.set('Local string &s;'); read.resolve(['STALE_FIELD']);
    assert.deepEqual(names(await result), []);
  });
  await check('cancelled and closed-document completion requests cannot publish late fields', async () => {
    for (const close of [false, true]) {
      const read = deferred(); provider = database({ expandedFieldNames: () => read.promise });
      const doc = document('ZZ_CANCEL.', 8); const token = { isCancellationRequested: false };
      const result = complete(doc, '.', token);
      if (close) doc.isClosed = true; else token.isCancellationRequested = true;
      read.resolve(['LATE_FIELD']); assert.deepEqual(names(await result), []);
    }
  });
  await check('failed record reads can recover on the next completion', async () => {
    let fail = true; provider = database({ expandedFieldNames: async () => { if (fail) throw new Error('offline'); return ['RECOVERED']; } });
    const doc = document('ZZ_RETRY.', 8); await complete(doc, '.'); fail = false;
    assert.ok(names(await complete(doc, '.')).includes('RECOVERED'));
  });
  await check('an explicitly typed class with no public members has no generic suggestions', async () => {
    provider = database({ readText: async () => 'class Empty\nprivate\n method Hidden();\nend-class;' });
    assert.deepEqual(names(await complete(document('Local FIXTURE:Empty &obj;\n&obj.', 8), '.')), []);
  });
  await check('a slow definition search is reused when its incomplete list is requested again', async () => {
    const read = deferred(); let calls = 0;
    provider = database({ search: () => { calls++; return read.promise; } });
    const doc = document('Page.ZZ_', 8);
    const first = await complete(doc); assert.equal(first.isIncomplete, true);
    read.resolve([{ key: { parts: ['ZZ_PAGE'] }, description: 'Test page' }]); await sleep(5);
    assert.ok(names(await complete(doc)).includes('ZZ_PAGE')); assert.equal(calls, 1);
  });
  await check('failed class reads can recover without a connection reset', async () => {
    let fail = true; provider = database({ readText: async () => { if (fail) throw new Error('offline'); return 'class Retry\n method Recovered();\nend-class;'; } });
    const doc = document('Local FIXTURE:Retry &obj;\n&obj.', 8); await complete(doc, '.'); fail = false;
    assert.ok(names(await complete(doc, '.')).includes('Recovered'));
  });
  await check('completion is disabled by the language server setting', async () => {
    settings.set('peoplesoft.peoplecode.languageServer.enabled', false);
    assert.deepEqual(names(await complete(document('%This.'), '.')), []);
    settings.set('peoplesoft.peoplecode.languageServer.enabled', true);
  });
  settings.set('peoplesoft.peoplecode.validateAsYouType', false);
  vscode.workspace.textDocuments = [];
  const validation = registerPeopleCodeValidation(context, workspace);
  const diagnostics = (doc) => vscode._diagnostics.get('psft-peoplecode-validate').get(doc.uri) ?? [];
  const waitFor = async (condition) => { const start = Date.now(); while (!condition()) { assert.ok(Date.now() - start < 5000, 'timed out'); await sleep(5); } };
  await check('unavailable field metadata does not invent missing-field diagnostics, and a retry recovers', async () => {
    let fail = true;
    provider = database({ expandedFieldNames: async (record) => { if (record === 'ZZ_R') return []; if (fail) throw new Error('offline'); return ['DESCR']; } });
    changed.fire();
    const doc = document('ZZ_REC.DESCR = "ok";', 8);
    await validation.validateDocument(doc);
    assert.ok(!diagnostics(doc).some((d) => d.code === 'field-not-defined'));
    fail = false;
    await validation.validateDocument(doc);
    assert.deepEqual(diagnostics(doc), []);
  });
  await check('closed documents cannot publish delayed environment diagnostics', async () => {
    const read = deferred(); let waiting = false;
    provider = database({ expandedFieldNames: async (record) => { if (record === 'ZZ_R') return []; waiting = true; return read.promise; } }); changed.fire();
    const doc = document('ZZ_DELAY.DESCR = "ok";', 8);
    const pending = validation.validateDocument(doc); await waitFor(() => waiting);
    doc.isClosed = true; vscode.workspace.textDocuments = []; events.onDidCloseTextDocument.fire(doc); read.resolve([]);
    assert.equal(await pending, undefined); assert.deepEqual(diagnostics(doc), []);
  });
  await check('turning environment checks off invalidates an in-flight result for unchanged text', async () => {
    const read = deferred(); let waiting = false;
    provider = database({ expandedFieldNames: async (record) => { if (record === 'ZZ_R') return []; waiting = true; return read.promise; } }); changed.fire();
    const doc = document('ZZ_SETTINGS.DESCR = "ok";', 8);
    const pending = validation.validateDocument(doc); await waitFor(() => waiting);
    await vscode.workspace.getConfiguration('peoplesoft').update('peoplecode.checkEnvironment', false);
    read.resolve([]); assert.equal(await pending, undefined); assert.deepEqual(diagnostics(doc), []);
    assert.ok(await validation.validateDocument(doc)); assert.deepEqual(diagnostics(doc), []);
    await vscode.workspace.getConfiguration('peoplesoft').update('peoplecode.checkEnvironment', true);
  });
  await check('a replacement connection invalidates delayed validation and reads the new release', async () => {
    const read = deferred(); let waiting = false;
    provider = database({ expandedFieldNames: async (record) => { if (record === 'ZZ_R') return []; waiting = true; return read.promise; } }); changed.fire();
    const doc = document('ZZ_CONNECT.DESCR = "ok";', 8);
    const pending = validation.validateDocument(doc); await waitFor(() => waiting);
    provider = database({ readEnvironment: async () => ({ toolsRelease: '8.61' }), expandedFieldNames: async () => ['DESCR'] }); changed.fire();
    read.resolve([]); assert.equal(await pending, undefined);
    const result = await validation.validateDocument(doc); assert.equal(result.validation.profile, 'PT861'); assert.deepEqual(diagnostics(doc), []);
  });
  await check('metadata preparation cannot validate old text under a newer document version', async () => {
    const read = deferred();
    provider = database({ expandedFieldNames: () => read.promise }); changed.fire();
    const doc = document('Local number &n = ;', 8);
    const pending = validation.validateDocument(doc); await sleep(5); doc.set('Local number &n = 1;'); read.resolve([]);
    assert.equal(await pending, undefined); assert.ok(await validation.validateDocument(doc)); assert.deepEqual(diagnostics(doc), []);
  });
  await check('editing abandons a large explicit validation and the replacement can validate', async () => {
    provider = database(); changed.fire();
    const doc = document('class Child\n method Run();\nend-class;\nmethod Run\n Local number &n = 0;\n' + ' &n = &n + 1;\n'.repeat(48000) + 'end-method;');
    const pending = validation.validateDocument(doc);
    await sleep(100); doc.set('class Child\n method Run();\nend-class;\nmethod Run\nend-method;');
    events.onDidChangeTextDocument.fire({ document: doc, contentChanges: [{}] });
    const result = await Promise.race([pending, sleep(2000).then(() => 'timed out')]);
    assert.equal(result, undefined); assert.ok(await validation.validateDocument(doc)); assert.deepEqual(diagnostics(doc), []);
  });
  for (const d of context.subscriptions.reverse()) d.dispose?.();
  console.log(`${checks} production editor fixture checks passed.`);
} finally { Module._load = original; rmSync(dir, { recursive: true, force: true }); }
