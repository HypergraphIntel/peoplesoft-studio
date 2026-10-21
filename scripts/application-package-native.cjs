/** Actual installed commands, rendered package tree, class creation and normal VS Code saves. Unique HRDMO lab scope only. */
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.run = async function () {
  const input = JSON.parse(fs.readFileSync(process.env.PSFT_EDITOR_INPUT, 'utf8'));
  const { DatabaseProvider } = require(path.join(input.root, 'dist-test/providers/database.js'));
  const { openDatabase } = require(path.join(input.root, 'dist-test/db/open.js'));
  const { parseUri } = require(path.join(input.root, 'dist-test/util/uri.js'));
  const config = { name: 'Independent package readback', platform: 'oracle', connectString: input.connection.connectString,
    user: process.env.PSLAB_ACCESSID, password: process.env.PSLAB_ACCESSPSWD };
  assert.match(config.connectString, /hrdmo/i);
  const reader = new DatabaseProvider(config), pool = await openDatabase('oracle', config), c = await pool.getConnection();
  const root = 'ZZ_AP_UI_' + randomBytes(4).toString('hex').toUpperCase();
  const results = { checkedAt: new Date().toISOString(), vscode: vscode.version, root, checks: [], cleanupVerified: false };
  let ui, owned = false, completed = false;
  const checkpoint = operation => fs.writeFileSync(process.env.PSFT_EDITOR_RESULT + '.progress', JSON.stringify({ operation, passed: results.checks.length }));
  const check = async (name, fn) => { checkpoint(name); await fn(); results.checks.push({ name, passed: true }); console.log('PASS ' + name); };
  const until = async (fn, timeout = 20000) => { const start = Date.now(); while (Date.now() - start < timeout) { const value = await fn(); if (value) return value; await sleep(70); } throw Error('Timed out: ' + JSON.parse(fs.readFileSync(process.env.PSFT_EDITOR_RESULT + '.progress')).operation); };
  const answer = (title, value) => until(() => ui.answerInput(title, value));
  const tree = (action, name) => ui.packageTree(root, action, name);
  const read = () => reader.readApplicationPackage(root);
  try {
    await reader.connect(); assert.equal(await reader.packageExists(root), false); owned = true;
    results.environment = await reader.readEnvironment();
    const extension = vscode.extensions.getExtension('JaredNorris.peoplesoft-studio'); assert.ok(extension);
    assert.equal(extension.extensionPath, input.candidate); await extension.activate();
    ui = await require('./peoplecode-editor-cdp.cjs').connectWorkbench(input.cdpUrl);
    await check('installed extension connects to HRDMO', async () => {
      let settled = false;
      const pending = vscode.commands.executeCommand('psft.connect', input.connection).finally(() => { settled = true; });
      await until(async () => {
        if (settled) return true;
        await ui.answerPassword(`Password for ${input.connection.user}@${input.connection.connectString}`, process.env.PSLAB_ACCESSPSWD);
        return settled;
      }); await pending;
    });
    await check('New Definition creates an empty Application Package and opens its tree', async () => {
      const pending = vscode.commands.executeCommand('psft.newDefinition');
      await answer('New Definition', 'Application Package');
      await answer(`New Application Package on ${input.connection.name}`, root);
      await pending;
      const state = await until(() => tree()); assert.ok(state.text.includes('Empty package'));
      assert.equal((await read()).tree.children.length, 0);
    });
    await check('rendered Insert Subpackage creates an empty child and nested child', async () => {
      await tree('insertPackage'); await answer(`Insert Subpackage in ${root}`, 'Sub');
      await until(async () => (await read()).tree.children.some(n => n.name === 'Sub'));
      await until(async () => (await tree())?.keys.some(k => k.parts[0] === 'Sub'));
      await tree('select', 'Sub'); await tree('insertPackage'); await answer(`Insert Subpackage in ${root}:Sub`, 'Nested');
      await until(async () => (await read()).tree.children[0].children.some(n => n.name === 'Nested'));
      await until(async () => (await tree())?.keys.some(k => k.parts[0] === 'Nested'));
    });
    const key = { type: 58, parts: [root, 'Sub', 'Nested', 'Leaf', 'OnExecute'] };
    await check('Insert Class opens a declaration; normal PeopleCode save creates it under the selected subpackage', async () => {
      await tree('select', 'Nested'); await tree('insertClass');
      await answer(`New class in ${root}:Sub:Nested`, 'Leaf');
      const doc = await until(() => vscode.window.activeTextEditor?.document.languageId === 'psft-peoplecode' && vscode.window.activeTextEditor.document);
      assert.deepEqual(parseUri(doc.uri).key, key); assert.equal(doc.getText(), 'class Leaf\nend-class;\n');
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
        'class Leaf\n   method Value() Returns string;\nend-class;\n\nmethod Value\n   Return "ready";\nend-method;\n');
      assert.equal(await vscode.workspace.applyEdit(edit), true); assert.equal(await doc.save(), true);
      const stored = await reader.readPeopleCodeForEdit(key); assert.ok(stored.text.includes('Return "ready";'));
      assert.deepEqual((await read()).tree.children[0].children[0].children[0].key, key);
    });
    await check('Open Definition accepts the search root key and rendered Open PeopleCode opens the saved class', async () => {
      await vscode.commands.executeCommand('psft.openDefinition', `oracle:${input.connection.name}`, { type: 57, parts: [root] });
      await until(async () => (await tree())?.keys.some(k => k.type === 58));
      await until(async () => (await tree('select', 'Leaf'))?.path === [root, 'Sub', 'Nested', 'Leaf'].join(':'));
      await tree('openClass');
      await until(() => vscode.window.activeTextEditor?.document.languageId === 'psft-peoplecode');
      assert.deepEqual(parseUri(vscode.window.activeTextEditor.document.uri).key, key);
      assert.ok(vscode.window.activeTextEditor.document.getText().includes('Return "ready";'));
      await vscode.commands.executeCommand('psft.openDefinition', `oracle:${input.connection.name}`, { type: 57, parts: ['Nested', root, 'Sub'] });
      await until(() => tree()); await ui.screenshot(path.join(input.artifactDirectory, 'application-package-installed.png'));
    });
    await check('switching the connection to read-only disables package edits', async () => {
      const conf = vscode.workspace.getConfiguration('peoplesoft');
      await conf.update('connections', [{ ...input.connection, peoplecodeAccess: 'read-only' }], vscode.ConfigurationTarget.Global);
      await until(async () => (await tree())?.text.includes('Read-only'));
    });
    completed = true;
  } catch (error) {
    results.error = error.stack ?? String(error);
    results.packageAtFailure = await read().catch(() => undefined);
    await ui?.screenshot(path.join(input.artifactDirectory, 'application-package-installed-failure.png')).catch(() => {});
    throw error;
  }
  finally {
    ui?.close();
    try {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      if (owned) {
        for (const table of ['PSPCMTXT', 'PSPCMNAME', 'PSPCMPROG', 'PSPCMPROGDEL']) await c.execute(`DELETE FROM ${table} WHERE OBJECTID1 = 104 AND OBJECTVALUE1 = :r`, { r: root });
        await c.execute('DELETE FROM PSAPPCLASSDEFN WHERE PACKAGEROOT = :r', { r: root });
        await c.execute('DELETE FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r', { r: root }); await c.commit();
        assert.equal(await reader.packageExists(root), false); assert.equal(await reader.hasPeopleCode({ type: 58, parts: [root, 'Sub', 'Nested', 'Leaf', 'OnExecute'] }), false);
        results.cleanupVerified = true;
      }
    } finally {
      await reader.dispose(); await c.close(); await pool.close();
      results.passed = completed && results.cleanupVerified; fs.writeFileSync(process.env.PSFT_EDITOR_RESULT, JSON.stringify(results, null, 2));
    }
  }
};
