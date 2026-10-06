/**
 * Activates the packaged bundle against a stub `vscode` module.
 *
 * Run after every build. It answers the question that otherwise costs a full
 * package-install-reload cycle: does the extension come up, and does what it
 * declares in package.json match what it actually registers?
 */
import { createRequire } from 'node:module';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { createStub } from './vscode-stub.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const { vscode, registered, settings } = createStub();

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
  extensionUri: vscode.Uri.file(root),
  extension: { id: `${manifest.publisher}.${manifest.name}`, packageJSON: manifest },
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

// Status-bar connection picker must open a Quick Pick containing every
// configured PeopleSoft connection.
settings.set('peoplesoft.connections', [
  {
    name: 'HCDEV',
    kind: 'oracle',
    connectString: 'hcdev.example:1521/HCDEV',
    user: 'SYSADM'
  },
  {
    name: 'HCTST',
    kind: 'oracle',
    connectString: 'hctst.example:1521/HCTST',
    user: 'SYSADM'
  }
]);

vscode._quickPicks.length = 0;

// Cancel the picker so the smoke test does not attempt a real connection.
vscode._quickPickResult = undefined;

await vscode.commands.executeCommand('psft.status.selectConnection');

const statusPicker = vscode._quickPicks.at(-1);

check(
  statusPicker !== undefined,
  'psft.status.selectConnection did not open a Quick Pick'
);

check(
  statusPicker?.options?.title === 'Select PeopleSoft Connection',
  'status connection picker has the wrong title'
);

check(
  statusPicker?.items?.length === 2,
  'status connection picker did not include all configured connections'
);

check(
  statusPicker?.items?.[0]?.label === 'HCDEV',
  'status connection picker did not include HCDEV'
);

check(
  statusPicker?.items?.[1]?.label === 'HCTST',
  'status connection picker did not include HCTST'
);

check(
  statusPicker?.items?.every(
    (item) => item.description === 'Not connected'
  ),
  'disconnected connections were not identified as Not connected'
);

// With no configured connections, the command should report that state
// instead of opening an empty picker.
settings.set('peoplesoft.connections', []);
vscode._messages.length = 0;
vscode._quickPicks.length = 0;

await vscode.commands.executeCommand('psft.status.selectConnection');

check(
  vscode._quickPicks.length === 0,
  'status connection picker opened with no configured connections'
);

check(
  vscode._messages.some(
    ([type, message]) =>
      type === 'info' &&
      message === 'No PeopleSoft connections are configured.'
  ),
  'status connection picker did not report that no connections are configured'
);

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

// ---------------------------------------------------------------------------
// Settings panel. The page is played by this script through the stub panel:
// `_receive` is a message from the page, `webview.posted` what the extension
// sent it. Project-export connections stand in for databases because they
// connect without one.

const flush = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate, what) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return true;
    await flush();
  }
  failures.push(`timed out waiting for ${what}`);
  return false;
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'psft-smoke-'));
try {
  const fixture = path.join(root, 'src', 'test', 'fixtures', 'sample-project.xml');
  const devPath = path.join(scratch, 'dev.xml');
  const tstPath = path.join(scratch, 'tst.xml');
  copyFileSync(fixture, devPath);
  copyFileSync(fixture, tstPath);
  const devId = `project:${devPath}`;
  const tstId = `project:${tstPath}`;
  const SECRET = 'smoke-secret-do-not-render';

  settings.set('peoplesoft.connections', [
    { name: 'HCDEV', kind: 'projectFile', path: devPath },
    { name: 'HCTST', kind: 'projectFile', path: tstPath },
    { name: 'ORA', kind: 'oracle', connectString: 'ora.example:1521/ORA', user: 'SYSADM' }
  ]);
  await context.secrets.store('peoplesoft.password.ORA', SECRET);
  vscode._fireConfigurationChange(['peoplesoft.connections']);

  check(registered.webviewSerializers.has('psft.settings'),
    'the Settings panel serializer was not registered');

  const panelCount = vscode._panels.length;
  await vscode.commands.executeCommand('psft.settings.open');
  const panel = vscode._panels.at(-1);
  check(vscode._panels.length === panelCount + 1 && panel?.viewType === 'psft.settings',
    'psft.settings.open did not open the Settings panel');

  // Security: a strict CSP, a nonce on the one script, nothing remote, and no
  // configuration interpolated into the HTML.
  const html = panel.webview.html;
  const nonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1];
  check(/default-src 'none'/.test(html), 'Settings CSP does not default to none');
  check(nonce !== undefined && html.includes(`<script nonce="${nonce}"`),
    'Settings script is not nonce-bound to the CSP');
  check(!/unsafe-(inline|eval)/.test(html), 'Settings CSP allows unsafe-inline or unsafe-eval');
  check(!/https?:\/\//.test(html), 'Settings HTML references a remote resource');
  check(!html.includes('HCDEV') && !html.includes('ora.example'),
    'Settings HTML interpolates connection values instead of posting them');

  // A second open reveals the same panel.
  await vscode.commands.executeCommand('psft.settings.open');
  check(vscode._panels.length === panelCount + 1 && vscode._revealed.includes('psft.settings'),
    'reopening Settings created a second panel instead of revealing the first');

  const stateMessages = () => panel.webview.posted.filter((m) => m.type === 'state');
  const lastState = () => stateMessages().at(-1)?.state;

  panel._receive({ type: 'ready' });
  await until(() => lastState() !== undefined, 'the initial Settings state');
  let state = lastState();
  check(state?.connections?.length === 3, 'Settings state does not list every configured connection');
  check(state?.connections?.every((c) => !c.selected), 'Settings reported a selection before one was made');
  const ora = state?.connections?.find((c) => c.name === 'ORA');
  check(ora?.connectString === 'ora.example:1521/ORA' && ora?.user === 'SYSADM',
    'Settings state is missing Oracle connection fields');
  check(ora?.access?.label === 'PeopleCode read-only', 'Oracle connection is not described as PeopleCode read-only');
  check(state?.connections?.find((c) => c.name === 'HCDEV')?.access?.level === 'read-only',
    'project export connection is not described as read-only');

  // Every setting the panel edits is a contributed key, shown at package.json's default.
  const contributed = manifest.contributes.configuration.properties;
  for (const setting of state?.settings ?? []) {
    const declared = contributed[`peoplesoft.${setting.key}`];
    check(declared !== undefined, `Settings edits peoplesoft.${setting.key}, which package.json does not contribute`);
    check(declared?.default === setting.value && setting.source === 'default',
      `peoplesoft.${setting.key} shows ${JSON.stringify(setting.value)}, but package.json's default is ${JSON.stringify(declared?.default)}`);
  }
  check(contributed['peoplesoft.mcp.enabled']?.default === true && contributed['peoplesoft.mcp.port']?.default === 7337,
    'MCP defaults are not enabled / 7337');
  check(state?.mcp?.url === 'http://127.0.0.1:7337/mcp', `MCP URL does not use the default port: ${state?.mcp?.url}`);

  // The status bar describes the target connection while a psft editor is active.
  const statusItem = vscode._statusBarItems.find((i) => i.command === 'psft.status.selectConnection');
  const handle = createHash('sha256').update(devId, 'utf8').digest('hex').slice(0, 16);
  vscode.window.activeTextEditor = {
    document: { uri: vscode.Uri.parse(`psft://${handle}/${encodeURIComponent('0:DEMO')}/DEMO.psrecord`) }
  };

  // Settings shows the target but cannot choose it: a selection request from
  // the page is not part of the contract and changes nothing.
  panel._receive({ type: 'selectConnection', connectionId: devId });
  await flush();
  check(lastState()?.selectedConnectionId === undefined && !statusItem?.visible,
    'a selectConnection message from the Settings page changed the target');

  // The status-bar picker selects HCDEV (connecting it) -> Settings and the status bar follow.
  const pick = async (index) => {
    vscode._quickPickResult = index;
    await vscode.commands.executeCommand('psft.status.selectConnection');
    vscode._quickPickResult = undefined;
  };
  await pick(0);
  await until(() => lastState()?.selectedConnectionId === devId, 'Settings to follow the HCDEV selection');
  state = lastState();
  check(state?.connections?.find((c) => c.id === devId)?.selected &&
    state.connections.find((c) => c.id === devId)?.connected,
    'Settings does not show HCDEV as the connected target');
  check(statusItem?.visible && statusItem.text === '$(database) HCDEV',
    `status bar does not show HCDEV (shows "${statusItem?.text}")`);

  // ... then HCTST.
  await pick(1);
  await until(() => lastState()?.selectedConnectionId === tstId, 'Settings to follow the HCTST selection');
  check(statusItem?.text === '$(database) HCTST',
    `status bar did not update to HCTST (shows "${statusItem?.text}")`);
  check(lastState()?.connections?.find((c) => c.id === tstId)?.environment?.status === 'not-applicable',
    'a project export was given a PeopleTools release');

  await pick(0);
  await until(() => lastState()?.selectedConnectionId === devId, 'Settings to follow the return to HCDEV');

  // Connecting from the Connections view, with no connected target, makes
  // that connection the target -- Settings must not report "none" while a
  // connection is up. A disconnected target falls back to one still up.
  const [devConfig, tstConfig] = settings.get('peoplesoft.connections');
  await vscode.commands.executeCommand('psft.disconnect', devConfig);
  await until(() => lastState()?.selectedConnectionId === tstId, 'the target to fall back to HCTST');
  await vscode.commands.executeCommand('psft.disconnect', tstConfig);
  await until(() => lastState()?.connections?.every((c) => !c.connected), 'both connections to disconnect');
  check(lastState()?.selectedConnectionId === undefined,
    'the target still names a connection after every connection disconnected');
  await vscode.commands.executeCommand('psft.connect', tstConfig);
  await until(() => lastState()?.connections?.find((c) => c.id === tstId)?.connected, 'HCTST to connect from the Connections view');
  check(lastState()?.selectedConnectionId === tstId &&
    lastState()?.connections?.find((c) => c.selected)?.name === 'HCTST',
    'connecting HCTST from the Connections view did not make it the target');
  await vscode.commands.executeCommand('psft.connect', devConfig);
  await until(() => lastState()?.connections?.find((c) => c.id === devId)?.connected, 'HCDEV to connect');
  check(lastState()?.selectedConnectionId === tstId,
    'connecting a second connection displaced the existing target');
  await pick(0);
  await until(() => lastState()?.selectedConnectionId === devId, 'the picker to restore HCDEV');

  // The side-bar Settings view summarizes the same target.
  const settingsTree = vscode._trees.get('psft.settings');
  const rows = settingsTree ? settingsTree.getChildren(undefined) : [];
  check(rows[0]?.label === 'HCDEV', 'the Settings view does not show the target connection');
  check(rows.every((r) => settingsTree.getTreeItem(r).command?.command === 'psft.settings.open'),
    'a Settings view row does not open the Settings panel');

  // An edit made outside the panel (settings.json, VS Code's Settings UI).
  const before = stateMessages().length;
  settings.set('peoplesoft.oracle.thickModeLibDir', '/opt/ic21');
  vscode._fireConfigurationChange(['peoplesoft.oracle.thickModeLibDir']);
  check(stateMessages().length > before &&
    lastState()?.settings?.find((s) => s.key === 'oracle.thickModeLibDir')?.value === '/opt/ic21',
    'an external configuration change did not refresh the Settings panel');

  // The default decoder reaches connections without their own.
  settings.set('peoplesoft.peoplecode.decoder', 'strict');
  vscode._fireConfigurationChange(['peoplesoft.peoplecode.decoder']);
  check(JSON.stringify(lastState()?.connections?.find((c) => c.name === 'ORA')?.decoder) ===
    JSON.stringify({ value: 'strict', inherited: true }),
    'a connection without its own decoder does not follow peoplesoft.peoplecode.decoder');

  // Validation is reported against the field, and nothing is written.
  const validations = () => panel.webview.posted.filter((m) => m.type === 'validation');
  const updates = vscode._configurationUpdates.length;
  panel._receive({ type: 'updateSetting', key: 'oracle.thickModeLibDir', value: 'relative/dir' });
  await until(() => validations().length > 0, 'an Instant Client directory validation reply');
  check(validations().at(-1)?.errors?.value !== undefined && vscode._configurationUpdates.length === updates,
    'a relative Instant Client directory was not rejected with a field error');

  panel._receive({ type: 'updateSetting', key: 'oracle.thickModeLibDir', value: '/opt/ic23' });
  await until(() => vscode._configurationUpdates.length > updates, 'the Instant Client directory write');
  const write = vscode._configurationUpdates.at(-1);
  check(write?.key === 'peoplesoft.oracle.thickModeLibDir' && write.value === '/opt/ic23' &&
    write.target === vscode.ConfigurationTarget.Global,
    'a valid Instant Client directory was not written to user settings');

  // The decoder is chosen per connection and stored on it.
  panel._receive({ type: 'setConnectionDecoder', connectionId: 'oracle:ORA', decoder: 'raw' });
  await until(() => settings.get('peoplesoft.connections')?.find((c) => c.name === 'ORA')?.decoder === 'raw',
    'the ORA decoder write');
  check(settings.get('peoplesoft.peoplecode.decoder') === 'strict' &&
    settings.get('peoplesoft.connections')?.filter((c) => c.decoder !== undefined).length === 1,
    'setting ORA\'s decoder changed the default or another connection');
  panel._receive({ type: 'setConnectionDecoder', connectionId: devId, decoder: 'raw' });
  await until(() => validations().at(-1)?.target?.connectionId === devId, 'the project-export decoder refusal');
  check(validations().at(-1)?.errors?.decoder !== undefined, 'a project export accepted a decoder');

  // MCP: the port is written as an integer, out-of-range ports are refused, the toggle as a boolean.
  panel._receive({ type: 'updateSetting', key: 'mcp.port', value: '80' });
  await until(() => validations().at(-1)?.target?.key === 'mcp.port', 'an MCP port validation reply');
  check(validations().at(-1)?.errors?.value === 'Port must be between 1024 and 65535.',
    'a privileged MCP port was not refused');
  const mcpWrites = vscode._configurationUpdates.length;
  panel._receive({ type: 'updateSetting', key: 'mcp.port', value: '8123' });
  panel._receive({ type: 'updateSetting', key: 'mcp.enabled', value: false });
  await until(() => vscode._configurationUpdates.length >= mcpWrites + 2, 'the MCP setting writes');
  check(JSON.stringify(vscode._configurationUpdates.slice(mcpWrites).map((u) => [u.key, u.value])) ===
    JSON.stringify([['peoplesoft.mcp.port', 8123], ['peoplesoft.mcp.enabled', false]]),
    'MCP port and enabled were not written as 8123 and false');

  const port = 'ora.example:abc/ORA';
  panel._receive({ type: 'updateConnection', connectionId: 'oracle:ORA', edit: { connectString: port, user: 'SYSADM' } });
  await until(() => validations().at(-1)?.target?.connectionId === 'oracle:ORA', 'a connection validation reply');
  check(validations().at(-1)?.errors?.connectString === 'Port must be a number.',
    'a non-numeric port was not reported against the connect string');

  panel._receive({ type: 'updateConnection', connectionId: 'oracle:ORA', edit: { connectString: 'ora2.example:1522/ORA', user: 'PS' } });
  await until(() => validations().at(-1)?.target?.connectionId === 'oracle:ORA' &&
    Object.keys(validations().at(-1).errors).length === 0, 'the ORA connection edit');
  const saved = settings.get('peoplesoft.connections');
  check(saved?.length === 3 && saved[2].connectString === 'ora2.example:1522/ORA' && saved[0].path === devPath,
    'editing ORA did not rewrite only ORA');
  check(saved?.[2]?.decoder === 'raw', 'editing ORA dropped its decoder');

  // Malformed messages are ignored: connections cannot be overwritten as a plain setting.
  const posted = panel.webview.posted.length;
  panel._receive({ type: 'updateSetting', key: 'connections', value: [] });
  panel._receive({ type: 'disconnect', connectionId: devId });
  await flush();
  check(panel.webview.posted.length === posted && settings.get('peoplesoft.connections')?.length === 3,
    'a malformed Settings message was acted on');

  // Test Connection runs against a throwaway provider.
  panel._receive({ type: 'testConnection', connectionId: tstId });
  await until(() => lastState()?.connections?.find((c) => c.id === tstId)?.test?.status === 'succeeded',
    'the HCTST connection test');

  // The VS Code Settings link is filtered to this extension.
  let nativeQuery;
  vscode._handlers.set('workbench.action.openSettings', (query) => { nativeQuery = query; });
  panel._receive({ type: 'openNativeSettings' });
  await until(() => nativeQuery !== undefined, 'the native settings command');
  check(nativeQuery === `@ext:${manifest.publisher}.${manifest.name}`,
    `native settings opened with the wrong filter: ${nativeQuery}`);

  // Nothing from SecretStorage, and no password field, ever reaches the page.
  const everything = JSON.stringify(panel.webview.posted);
  check(!everything.includes(SECRET), 'a stored password was sent to the Settings page');
  check(!/"password"/i.test(everything), 'a password field was sent to the Settings page');

  // Closing the panel drops its listeners; reopening starts from current state.
  panel.dispose();
  check(panel._listenerCount() === 0, 'the closed Settings panel still listens for messages');
  const afterClose = panel.webview.posted.length;
  vscode._fireConfigurationChange(['peoplesoft.peoplecode.decoder']);
  check(panel.webview.posted.length === afterClose, 'a closed Settings panel was still sent state');

  await vscode.commands.executeCommand('psft.settings.open');
  const reopened = vscode._panels.at(-1);
  check(reopened !== panel, 'reopening Settings after closing it did not create a panel');
  reopened._receive({ type: 'ready' });
  await until(() => reopened.webview.posted.some((m) => m.type === 'state'), 'state for the reopened panel');
  const fresh = reopened.webview.posted.find((m) => m.type === 'state')?.state;
  check(fresh?.selectedConnectionId === devId &&
    fresh.connections.find((c) => c.name === 'ORA')?.decoder?.value === 'raw',
    'the reopened Settings panel shows stale state');
  reopened.dispose();
  vscode.window.activeTextEditor = undefined;
} catch (err) {
  failures.push(`Settings smoke test threw: ${err.stack}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
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
