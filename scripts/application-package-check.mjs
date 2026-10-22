import {chromiumExecutable} from './chromium.mjs';
import {pathToFileURL} from 'node:url';
/** Production package panel and message boundary with controlled hosts; no native-save claim. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStub } from './vscode-stub.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
const { vscode } = createStub(), dir = mkdtempSync(path.join(tmpdir(), 'psft-package-fixture-'));
const original = Module._load;
Module._load = function(name, ...args) { return name === 'vscode' ? vscode : original.call(this, name, ...args); };
const require = createRequire(import.meta.url), sleep = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
async function check(name, fn) { await fn(); console.log(`ok ${++checks} - ${name}`); }
const until = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await sleep(5); } throw Error('Panel did not settle'); };
try {
  await build({ stdin: { contents: `export {ApplicationPackagePanel,renderApplicationPackageHtml} from './src/editors/applicationPackagePanel'; export {packageDocument,packageKey} from './src/model/appPackages';`, resolveDir: process.cwd() },
    bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], outfile: path.join(dir, 'package.cjs'), logLevel: 'silent' });
  const { ApplicationPackagePanel: Panel, packageDocument, packageKey, renderApplicationPackageHtml } = require(path.join(dir, 'package.cjs'));
  const classKey = { type: 58, parts: ['ZZ_PANEL', 'Sub', 'Leaf', 'OnExecute'] };
  const doc = packageDocument([{ key: packageKey('ZZ_PANEL') }, { key: packageKey('ZZ_PANEL', ['Sub']) }, { key: classKey }], 'ZZ_PANEL', 4);
  let writable = true, loads = 0, calls = [], release, loadGate;
  const host = { connection: { id: 'fixture', displayName: 'Controlled fixture' }, load: async () => { loads++; if(loadGate)await loadGate; return structuredClone(doc); }, writable: () => writable,
    insertPackage: async (key, version) => { calls.push(['package', key, version]); await new Promise(resolve => { release = resolve; }); },
    insertClass: async key => { calls.push(['class', key]); }, openClass: async key => { calls.push(['open', key]); } };
  await check('opening a package renders its nested classes and reuses the same tab', async () => {
    await Panel.show(host, 'ZZ_PANEL'); await Panel.show(host, 'ZZ_PANEL');
    assert.equal(vscode._panels.length, 1); assert.equal(loads, 2);
    assert.match(vscode._panels[0].webview.html, /Insert Subpackage/); assert.match(vscode._panels[0].webview.html, /Leaf/);
  });
  const panel = vscode._panels[0], send = message => panel._receive(message);
  await check('a class click opens exactly its own PeopleCode identity', async () => {
    send({ action: 'open', key: classKey }); await until(() => calls.length === 1);
    assert.deepEqual(calls.pop(), ['open', classKey]); await sleep(0);
  });
  await check('forged keys and class targets cannot create packages', async () => {
    send({ action: 'insertPackage', version: 4, key: packageKey('OTHER') });
    send({ action: 'insertPackage', version: 4, key: classKey }); await sleep(5);
    assert.deepEqual(calls, []);
  });
  await check('stale rendered versions refuse insertion before reaching the writer', async () => {
    send({ action: 'insertPackage', version: 3, key: packageKey('ZZ_PANEL') }); await sleep(5);
    assert.deepEqual(calls, []); assert.match(panel.webview.html, /Refresh the package/);
  });
  await check('duplicate clicks and refresh cannot race a pending mutation', async () => {
    send({ action: 'insertPackage', version: 4, key: packageKey('ZZ_PANEL', ['Sub']) });
    send({ action: 'insertPackage', version: 4, key: packageKey('ZZ_PANEL', ['Sub']) }); send({ action: 'refresh' });
    assert.equal(calls.length, 1); assert.deepEqual(calls[0], ['package', packageKey('ZZ_PANEL', ['Sub']), 4]);
    const before = loads; release(); await until(() => loads > before); await sleep(0); calls = [];
  });
  await check('inserting a class uses the selected subpackage without prompting for its path again', async () => {
    send({ action: 'insertClass', key: packageKey('ZZ_PANEL', ['Sub']) }); await until(() => calls.length === 1);
    assert.deepEqual(calls.pop(), ['class', packageKey('ZZ_PANEL', ['Sub'])]); await sleep(0);
  });
  await check('read-only changes are enforced at the host boundary and keep source opening available', async () => {
    writable = false; send({ action: 'insertClass', key: packageKey('ZZ_PANEL') }); await sleep(5);
    assert.deepEqual(calls, []); assert.match(panel.webview.html, /read-only or has no/);
    send({ action: 'open', key: classKey }); await until(() => calls.length === 1); assert.equal(calls.pop()[0], 'open'); await sleep(0);
  });
  await check('overlapping refreshes share one read and retain selection HTML; source clicks wait for the refresh', async () => {
    const html = panel.webview.html, before = loads;
    let ready; loadGate = new Promise(resolve => { ready = resolve; });
    const first = Panel.show(host, 'ZZ_PANEL'), second = Panel.show(host, 'ZZ_PANEL');
    send({ action: 'open', key: classKey }); await sleep(0); assert.equal(loads, before + 1); assert.deepEqual(calls, []);
    ready(); await Promise.all([first, second]); loadGate = undefined;
    await until(() => calls.length === 1); assert.deepEqual(calls.pop(), ['open', classKey]);
    assert.equal(panel.webview.html, html); await sleep(0);
  });
  await check('untrusted names, connection labels and errors are escaped and scripts require a nonce', async () => {
    const html = renderApplicationPackageHtml({ ...doc, root: '<img src=x onerror=alert(1)>' }, 'HR<script>', false, 'nonce', '<script>bad</script>');
    assert.ok(!html.includes('<img src=x')); assert.ok(!html.includes('<script>bad'));
    assert.match(html, /script-src 'nonce-nonce'/); assert.match(html, /HR&lt;script&gt;/);
  });
  if (process.argv.includes('--browser')) await check('rendered Chromium buttons send the selected class and nested package identities', async () => {
    let html = renderApplicationPackageHtml(doc, 'Controlled fixture · HRDMO layout', true, 'browser-check');
    const mock = `<script nonce="browser-check">window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.messages.push(m)});</script>`;
    const run = `<script nonce="browser-check">
try {
 const buttons=[...document.querySelectorAll('nav button')];
 const leaf=buttons.find(b=>b.textContent.includes('Leaf')); leaf.click();
 if(document.getElementById('openClass').disabled||!document.getElementById('insertClass').disabled)throw Error('class actions');
 document.getElementById('openClass').click();
 if(JSON.stringify(window.messages[0].key)!==JSON.stringify(${JSON.stringify(classKey)}))throw Error('wrong class');
 const sub=buttons.find(b=>b.textContent.includes('Sub'));sub.click();
 if(document.getElementById('insertPackage').disabled)throw Error('subpackage insertion disabled');
 document.getElementById('insertPackage').click();
 if(window.messages[1].action!=='insertPackage'||window.messages[1].version!==4||window.messages[1].key.parts[0]!=='Sub')throw Error('wrong subpackage');
 document.body.dataset.browserResult='passed';
}catch(e){document.body.dataset.browserResult='failed: '+e.message}
</script>`;
    html = html.replace('<script nonce="browser-check">', mock + '<script nonce="browser-check">').replace('</body>', run + '</body>');
    const file = path.join(dir, 'package.html'); writeFileSync(file, html);
    const artifact = path.resolve('tools/lab/results/application-package-panel.png'); mkdirSync(path.dirname(artifact), { recursive: true });
    const { stdout } = await promisify(execFile)(await chromiumExecutable(), ['--headless','--disable-crash-reporter', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-background-networking',
      '--user-data-dir=' + path.join(dir, 'chromium'), '--window-size=1200,850', '--screenshot=' + artifact, '--dump-dom', pathToFileURL(file).href], { timeout: 30000, maxBuffer: 2_000_000 });
    assert.match(stdout, /data-browser-result="passed"/);
  });
  panel.dispose(); console.log(`${checks} production package panel checks passed.`);
} finally { Module._load = original; rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 }); }
