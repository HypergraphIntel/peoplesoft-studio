/** VS Code's real extension-test runner. Read-only HRDMO; edits are discarded, never saved. */
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
exports.run = async function () {
  const input = JSON.parse(fs.readFileSync(process.env.PSFT_EDITOR_INPUT, 'utf8'));
  const results = { vscode: vscode.version, checks: [], databaseUnchanged: false };
  const { DatabaseProvider } = require(path.join(input.root, 'dist-test/providers/database.js'));
  const reader = new DatabaseProvider({ name: 'Editor acceptance readback', platform: 'oracle', connectString: input.connection.connectString,
    user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD });
  const key = { type: 8, parts: ['ZZ_PCODE_LAB_R2', 'ZZ_PCODE_LAB_MCP1', 'FieldChange'] };
  const classKey = { type: 58, parts: ['ZZ_PCODE_LAB', 'ORDERING', 'CHILD', 'OnExecute'] };
  const largeKey = { type: 58, parts: ['EP_FUNCTIONS', 'WorkCenterUI', 'OnExecute'] };
  const keys = [key, classKey, largeKey];
  const providerId = `oracle:${input.connection.name}`;
  const uri = (key) => vscode.Uri.parse(`psft://${createHash('sha256').update(providerId).digest('hex').slice(0,16)}/${encodeURIComponent(`${key.type}:${key.parts.join('.')}`)}/acceptance.peoplecode`);
  const checkpoint = (operation) => fs.writeFileSync(process.env.PSFT_EDITOR_RESULT + '.progress', JSON.stringify({ operation, passed: results.checks.length }));
  const check = async (name, action) => { checkpoint(name); const start = Date.now(); await action(); results.checks.push({ name, ms: Date.now() - start }); console.log(`PASS ${name}`); };
  const until = async (condition, timeout = 15000) => { const start = Date.now(); while (!condition()) { assert.ok(Date.now() - start < timeout, 'timed out waiting for editor result'); await sleep(30); } };
  const replace = async (doc, text) => { const edit = new vscode.WorkspaceEdit(); edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text); assert.equal(await vscode.workspace.applyEdit(edit), true); };
  const completion = async (doc, offset = doc.getText().length) => vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, doc.positionAt(offset));
  const names = (list) => (list?.items ?? []).map((i) => typeof i.label === 'string' ? i.label : i.label.label);
  const config = vscode.workspace.getConfiguration('peoplesoft');
  const update = async (key, value) => { await config.update(`peoplecode.${key}`, value, vscode.ConfigurationTarget.Global); await until(() => vscode.workspace.getConfiguration('peoplesoft').get(`peoplecode.${key}`) === value); await sleep(50); };
  const problems = (doc) => vscode.languages.getDiagnostics(doc.uri).filter((d) => d.source === 'PeopleCode');
  const documents = [];
  let before;
  let completed = false;
  let ui;
  const connect = async (connection) => {
    checkpoint(`connect ${connection.name}`);
    let settled = false, answered = false;
    const pending = vscode.commands.executeCommand('psft.connect', connection).finally(() => { settled = true; });
    const started = Date.now();
    while (!settled && Date.now() - started < 30000) {
      if (!answered) answered = await ui.answerPassword(`Password for ${connection.user}@${connection.connectString}`, process.env.PSLAB_ACCESSPSWD);
      await sleep(50);
    }
    assert.ok(settled, 'the native connection command did not complete'); await pending;
  };
  try {
    checkpoint('independent reader connect');
    await reader.connect();
    results.target = { environment: 'HRDMO', ...(await reader.readEnvironment()) };
    checkpoint('independent source baselines');
    before = await Promise.all(keys.map((k) => reader.readPeopleCodeForEdit(k)));
    assert.ok(before.every(Boolean), 'the existing lab programs and large delivered class are required');
    const extension = vscode.extensions.getExtension('JaredNorris.peoplesoft-studio'); assert.ok(extension);
    results.extensionId = extension.id;
    assert.equal(extension.extensionPath, input.candidate, 'acceptance must activate the unmodified installed candidate');
    assert.equal(extension.packageJSON.main, './dist/extension.js'); await extension.activate();
    ui = await require('./peoplecode-editor-cdp.cjs').connectWorkbench(input.cdpUrl);
    await connect(input.connection);
    const doc = await vscode.workspace.openTextDocument(uri(key)); documents.push(doc); await vscode.window.showTextDocument(doc);
    const cls = await vscode.workspace.openTextDocument(uri(classKey)); documents.push(cls); await vscode.window.showTextDocument(cls);
    await check('real record-field completion, including a typed prefix', async () => {
      await replace(doc, 'ZZ_PCODE_LAB_R2.'); assert.ok(names(await completion(doc)).includes('ZZ_PCODE_LAB_MCP1'));
      await replace(doc, 'ZZ_PCODE_LAB_R2.ZZ_'); assert.ok(names(await completion(doc)).includes('ZZ_PCODE_LAB_MCP1'));
      await replace(doc, 'JOB.EMP'); assert.ok(names(await completion(doc)).includes('EMPLID'));
    });
    await check('built-in function catalog is registered with VS Code', async () => {
      await replace(doc, 'CreateSQL'); assert.ok(names(await completion(doc)).includes('CreateSQL'));
    });
    const header = 'import ZZ_PCODE_LAB:ORDERING:BASECLS;\nclass CHILD extends ZZ_PCODE_LAB:ORDERING:BASECLS\n method Own();\nprivate\n method Secret();\nend-class;\n';
    await check('class own/private/inherited members and %Super', async () => {
      await replace(cls, header + '%This.');
      let list;
      for (let i=0;i<12;i++) { list = await completion(cls); if (!list.isIncomplete) break; await sleep(100); }
      const found = names(list); assert.ok(found.includes('Own')); assert.ok(found.includes('Secret'));
      assert.ok(list.items.some((i) => /inherited/.test(i.detail ?? '')), 'expected a live base-class member');
      const inherited = list.items.find((i) => /inherited/.test(i.detail ?? '')); const name = typeof inherited.label === 'string' ? inherited.label : inherited.label.label;
      await replace(cls, header + `%This.${name.slice(0,1)}`); assert.ok(names(await completion(cls)).includes(name));
      await replace(cls, header + '%Super.'); const base = names(await completion(cls)); assert.ok(base.includes(name)); assert.ok(!base.includes('Secret'));
    });
    await check('typed object members respect imports, visibility and unsaved class edits', async () => {
      const typed = 'import ZZ_PCODE_LAB:ORDERING:CHILD;\nLocal CHILD &obj;\n&obj.';
      await replace(cls, header + '/* unsaved member implementations */');
      await replace(doc, typed);
      let list;
      for (let i = 0; i < 12; i++) { list = await completion(doc); if (!list.isIncomplete) break; await sleep(100); }
      assert.ok(names(list).includes('Own')); assert.ok(names(list).includes('Describe'));
      assert.ok(!names(list).includes('Secret'));
      await replace(cls, header.replace('method Own();', 'method Renamed();'));
      const changed = names(await completion(doc)); assert.ok(changed.includes('Renamed')); assert.ok(!changed.includes('Own'));
      const override = header.replace('method Own();', 'method Own();\n method Describe() Returns string;');
      await replace(cls, override + '%This.Des');
      const own = (await completion(cls)).items.filter((i) => i.label === 'Describe');
      assert.equal(own.length, 1); assert.ok(!/inherited/.test(own[0].detail));
    });
    await check('record-field and class-member suggestion popups render in the installed workbench', async () => {
      const record = await vscode.window.showTextDocument(doc);
      await replace(doc, 'JOB.EMP'); const end = doc.positionAt(doc.getText().length);
      record.selection = new vscode.Selection(end, end); record.revealRange(new vscode.Range(end, end));
      await vscode.commands.executeCommand('editor.action.triggerSuggest');
      await ui.suggestion('EMPLID', path.join(input.artifactDirectory, 'peoplecode-editor-record-popup.png'));
      const editor = await vscode.window.showTextDocument(cls);
      await replace(cls, header + '%This.O'); const at = cls.positionAt(cls.getText().length);
      editor.selection = new vscode.Selection(at, at); editor.revealRange(new vscode.Range(at, at));
      await vscode.commands.executeCommand('editor.action.triggerSuggest');
      await ui.suggestion('Own', path.join(input.artifactDirectory, 'peoplecode-editor-class-popup.png'));
      results.screenshots = ['peoplecode-editor-record-popup.png', 'peoplecode-editor-class-popup.png'];
    });
    await check('600 KB class completion reads declarations promptly', async () => {
      await replace(cls, header + '/*' + 'large class body '.repeat(40000) + '*/\n%This.');
      const start = Date.now(); const list = await completion(cls); const ms = Date.now() - start;
      assert.ok(names(list).includes('Own')); assert.ok(ms < 700, `completion took ${ms} ms`); results.largeCompletionMs = ms;
    });
    await check('the language server switch disables and restores completion', async () => {
      await update('languageServer.enabled', false); await replace(cls, header + '%This.O'); const disabled = await completion(cls); assert.ok(!disabled.items.some((i) => i.label === 'Own' && i.detail === 'method'), JSON.stringify(disabled.items.filter((i) => i.label === 'Own')));
      await update('languageServer.enabled', true); assert.ok(names(await completion(cls)).includes('Own'));
    });
    await check('diagnostics follow the newest edit and settings', async () => {
      await vscode.window.showTextDocument(doc); await update('validateAsYouType', true); await update('checkEnvironment', true);
      await replace(doc, 'ZZ_PCODE_LAB_R2.ZZ_NO_SUCH_FIELD = "x";');
      await until(() => problems(doc).some((d) => d.code === 'field-not-defined'));
      await replace(doc, 'Local string &s = "ok";'); await until(() => problems(doc).length === 0); await sleep(400); assert.deepEqual(problems(doc), []);
      await replace(doc, 'Local string &s = ;'); await until(() => problems(doc).length > 0);
      await update('languageServer.enabled', false); await sleep(400); assert.deepEqual(problems(doc), []);
      await update('languageServer.enabled', true); await until(() => problems(doc).length > 0);
      await replace(doc, 'Local string &s = "ok";'); await until(() => problems(doc).length === 0); await sleep(400); assert.deepEqual(problems(doc), []);
    });
    await check('environment-check and unknown-function settings update existing diagnostics', async () => {
      await replace(doc, 'ZZ_PCODE_LAB_R2.ZZ_NO_SUCH_FIELD = "x";');
      await until(() => problems(doc).some((d) => d.code === 'field-not-defined'));
      await update('checkEnvironment', false); await sleep(400); assert.ok(!problems(doc).some((d) => d.code === 'field-not-defined'));
      await update('checkEnvironment', true); await until(() => problems(doc).some((d) => d.code === 'field-not-defined'));
      await replace(doc, 'ZZ_NoSuchFunctionForEditorAcceptance();');
      await until(() => problems(doc).some((d) => d.code === 'unknown-function'));
      await update('unknownFunctionWarnings', false); await sleep(400); assert.ok(!problems(doc).some((d) => d.code === 'unknown-function'));
      await update('unknownFunctionWarnings', true); await until(() => problems(doc).some((d) => d.code === 'unknown-function'));
      await replace(doc, 'Local string &s = "ok";');
    });
    await check('connection switching does not reactivate the old document connection', async () => {
      const other = { ...input.connection, name: input.connection.name + ' B' };
      await replace(doc, 'ZZ_PCODE_LAB_R2.'); await connect(other);
      assert.ok(!names(await completion(doc)).includes('ZZ_PCODE_LAB_MCP1'));
      await replace(doc, 'ZZ_PCODE_LAB_R2.ZZ_NO_SUCH_FIELD = "x";');
      await sleep(500); assert.ok(!problems(doc).some((d) => d.code === 'field-not-defined'));
      await connect(input.connection);
      await until(() => problems(doc).some((d) => d.code === 'field-not-defined'));
      await replace(doc, 'ZZ_PCODE_LAB_R2.');
      assert.ok(names(await completion(doc)).includes('ZZ_PCODE_LAB_MCP1'));
    });
    await check('a real large delivered class completes validation without blocking the host', async () => {
      await update('validateAsYouType', false); await update('checkEnvironment', false);
      // Read the stored source, without saving or editing it. Restore the lab prefix immediately after opening.
      await vscode.workspace.getConfiguration('peoplesoft').update('writeNamePrefix', '', vscode.ConfigurationTarget.Global); await sleep(100);
      const delivered = await vscode.workspace.openTextDocument(uri(largeKey)); documents.push(delivered);
      await vscode.workspace.getConfiguration('peoplesoft').update('writeNamePrefix', 'ZZ_', vscode.ConfigurationTarget.Global); await sleep(100);
      await vscode.window.showTextDocument(delivered);
      const text = delivered.getText(); assert.ok(text.length > 500000, 'expected representative large delivered source');
      assert.equal(text, before[2].text, 'validate the independent stored source, not reconstructed text');
      // Exercise this large class's real public declarations through a typed object, without editing delivered code.
      await replace(doc, 'import EP_FUNCTIONS:WorkCenterUI;\nLocal WorkCenterUI &large;\n&large.');
      const start = Date.now(); const list = await completion(doc);
      assert.ok(list.items.some((i) => i.kind === vscode.CompletionItemKind.Method));
      results.deliveredCompletionMs = Date.now() - start;
      let ticks = 0, maximum = 0, previous = Date.now(), published = false;
      const watch = vscode.languages.onDidChangeDiagnostics((e) => { if (e.uris.some((u) => u.toString() === delivered.uri.toString())) published = true; });
      const timer = setInterval(() => { const now = Date.now(); maximum = Math.max(maximum, now - previous); previous = now; ticks++; }, 10);
      const validateStart = Date.now();
      try {
        await vscode.commands.executeCommand('psft.peoplecode.validate'); await until(() => published);
      } finally { clearInterval(timer); watch.dispose(); }
      const errors = problems(delivered).filter((d) => !['unknown-function', 'definition-not-found'].includes(d.code));
      assert.deepEqual(errors, [], 'delivered class should complete compiler validation');
      assert.ok(ticks > 1); assert.ok(maximum < 300, `large delivered validation stalled host for ${maximum} ms`);
      results.delivered = { key: largeKey, characters: text.length, validationMs: Date.now() - validateStart,
        heartbeatMs: maximum, diagnosticsPublished: published, compilerProblems: errors.length };
      await update('checkEnvironment', true);
    });
    await check('large explicit validation is responsive and abandoned after an edit', async () => {
      await update('validateAsYouType', false);
      const source = header + 'method Own\n Local number &n = 0;\n' + ' &n = &n + 1;\n'.repeat(48000) + 'end-method;\nmethod Secret\nend-method;\n';
      await replace(cls, source); await vscode.window.showTextDocument(cls);
      let previous = Date.now(), maximum = 0, ticks = 0;
      const timer = setInterval(() => { const now = Date.now(); maximum = Math.max(maximum, now - previous); previous = now; ticks++; }, 10);
      const pending = vscode.commands.executeCommand('psft.peoplecode.validate');
      try {
        await sleep(200);
        await replace(cls, 'class CHILD\n method Own();\nend-class;\nmethod Own\nend-method;\n');
        await Promise.race([pending, sleep(3000).then(() => { throw new Error('obsolete explicit validation did not cancel'); })]);
        await vscode.commands.executeCommand('psft.peoplecode.validate');
      } finally { clearInterval(timer); }
      assert.ok(ticks > 1); assert.ok(maximum < 300, `extension-host heartbeat stalled ${maximum} ms`);
      assert.deepEqual(problems(cls), [], 'the replacement program should compile successfully');
      results.largeValidationHeartbeatMs = maximum; results.largeValidationBytes = Buffer.byteLength(source);
    });
    await check('closing and reopening an editor clears obsolete diagnostics', async () => {
      // Open through the workbench command: extension document-open APIs retain model references beyond tab closure.
      const closeUri = uri(key).with({ path: uri(key).path.replace('acceptance.peoplecode', 'closure.peoplecode') });
      await vscode.commands.executeCommand('vscode.open', closeUri, { preview: false });
      const closing = vscode.window.activeTextEditor.document; documents.push(closing);
      assert.equal(closing.uri.toString(), closeUri.toString());
      await replace(closing, 'Local string &s = ;');
      await vscode.commands.executeCommand('psft.peoplecode.validate');
      assert.ok(problems(closing).length > 0);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      assert.equal(closing.isDirty, false);
      const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((tab) =>
        tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === closeUri.toString());
      assert.ok(tabs.length > 0, 'the test editor must be visible before closure');
      assert.equal(await vscode.window.tabGroups.close(tabs, true), true);
      await until(() => closing.isClosed); await sleep(400); assert.deepEqual(problems(closing), []);
      await vscode.commands.executeCommand('vscode.open', closeUri, { preview: false });
      const reopened = vscode.window.activeTextEditor.document; documents.push(reopened);
      assert.notEqual(reopened, closing);
      await vscode.commands.executeCommand('psft.peoplecode.validate');
      assert.deepEqual(problems(reopened), []);
    });
    completed = true;
  } catch (error) {
    results.failure = { message: error.message, stack: error.stack };
    fs.writeFileSync(process.env.PSFT_EDITOR_RESULT, JSON.stringify(results, null, 2));
    throw error;
  } finally {
    // Revert discards unsaved buffers; no Save command or writer is invoked.
    for (const doc of documents) { if (!doc.isClosed) { checkpoint(`cleanup ${doc.uri.path.split('/').at(-1)}`); await vscode.window.showTextDocument(doc); await vscode.commands.executeCommand('workbench.action.files.revert'); } }
    if (before) {
      checkpoint('independent native readback');
      const after = await Promise.all(keys.map((k) => reader.readPeopleCodeForEdit(k)));
      results.databaseUnchanged = after.every((value, i) => value?.fingerprint === before[i].fingerprint && value?.text === before[i].text);
    }
    await reader.dispose();
    ui?.close();
    results.passed = completed && results.databaseUnchanged;
    fs.writeFileSync(process.env.PSFT_EDITOR_RESULT, JSON.stringify(results, null, 2));
  }
  assert.equal(results.databaseUnchanged, true, 'native source/binary fingerprints changed');
};
