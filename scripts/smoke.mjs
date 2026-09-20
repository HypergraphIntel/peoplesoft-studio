/**
 * Activates the packaged bundle against a stub `vscode` module.
 *
 * Run after every build. It answers the question that otherwise costs a full
 * package-install-reload cycle: does the extension come up, and does what it
 * declares in package.json match what it actually registers?
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { createStub } from './vscode-stub.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const { vscode, registered } = createStub();

// The bundle does `require('vscode')`, which only the extension host provides.
// Intercept that one specifier and let everything else resolve normally.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const require = createRequire(import.meta.url);
const bundlePath = path.join(root, manifest.main);

let extension;
try {
  extension = require(bundlePath);
} catch (err) {
  console.error(`✗ the bundle could not be loaded: ${err.message}`);
  process.exit(1);
}

check(typeof extension.activate === 'function', 'the bundle exports no activate()');
check(typeof extension.deactivate === 'function', 'the bundle exports no deactivate()');

const context = {
  subscriptions: [],
  secrets: {
    _store: new Map(),
    async get(k) { return this._store.get(k); },
    async store(k, v) { this._store.set(k, v); },
    async delete(k) { this._store.delete(k); }
  },
  extensionPath: root,
  globalState: { get: () => undefined, update: async () => {} },
  workspaceState: { get: () => undefined, update: async () => {} }
};

try {
  extension.activate(context);
} catch (err) {
  console.error(`✗ activate() threw: ${err.stack}`);
  process.exit(1);
}

// Every command the manifest advertises must exist, or the palette entry fails
// with "command not found" once installed.
const declared = (manifest.contributes.commands ?? []).map((c) => c.command);
for (const id of declared) {
  check(registered.commands.has(id), `command declared but never registered: ${id}`);
}
for (const id of registered.commands) {
  check(declared.includes(id), `command registered but missing from package.json: ${id}`);
}

// Same for views: a contributed view with no provider renders permanently empty.
const declaredViews = Object.values(manifest.contributes.views ?? {})
  .flat().map((v) => v.id);
for (const id of declaredViews) {
  check(registered.treeViews.has(id), `view declared but no data provider registered: ${id}`);
}

const declaredEditors = (manifest.contributes.customEditors ?? []).map((e) => e.viewType);
for (const vt of declaredEditors) {
  check(registered.customEditors.has(vt), `custom editor declared but not registered: ${vt}`);
}

check(registered.fileSystems.has('psft'), 'the psft:// file system provider was not registered');
check(context.subscriptions.length > 0, 'activate() registered nothing for disposal');

// The trees must render with no connection configured rather than throwing,
// since that is the state on a fresh install.
for (const [id, provider] of vscode._trees) {
  try {
    const children = await provider.getChildren(undefined);
    check(Array.isArray(children), `${id}.getChildren() did not return an array`);
    for (const child of children) provider.getTreeItem(child);
  } catch (err) {
    failures.push(`${id} threw while rendering an empty workspace: ${err.message}`);
  }
}

// Counts are taken before disposal: disposing a registration removes it from
// the stub's sets, which would otherwise report an empty summary.
const summary = {
  commands: registered.commands.size,
  views: registered.treeViews.size,
  customEditors: registered.customEditors.size
};

try {
  extension.deactivate();
  for (const d of context.subscriptions) d.dispose?.();
} catch (err) {
  failures.push(`deactivate() threw: ${err.message}`);
}

if (failures.length > 0) {
  console.error('✗ smoke test failed:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `✓ activated: ${summary.commands} commands, ${summary.views} views, ` +
  `${summary.customEditors} custom editor(s), psft:// registered`);
