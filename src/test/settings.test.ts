import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConnectionConfig } from '../workspace.js';
import type { EnvironmentInfo } from '../providers/provider.js';
import {
  describeAccess, describeEnvironment, formatRelease, safeErrorMessage, sourceOf,
  validateConnectionEdit, validateSetting, writeScopeFor,
  type PeopleSoftStudioSettings, type SettingInspection, type SettingKey, type SettingScope
} from '../settings/settingsModel.js';
import { parseWebviewMessage, type SettingsHostMessage, type SettingsState } from '../settings/settingsMessages.js';
import {
  SettingsService, type ConfigurationPort, type ConnectionEntry, type ConnectionPort, type McpPort
} from '../settings/settingsService.js';

/*
 * The Settings controller and model, against fakes of VS Code configuration
 * and the connection model. The webview wiring is covered by `npm run smoke`.
 */

// ---------------------------------------------------------------------------
// Fakes

type Scoped = Partial<Record<SettingScope, unknown>>;

class FakeConfiguration implements ConfigurationPort {
  readonly values = new Map<SettingKey, Scoped>();
  readonly writes: { key: SettingKey; value: unknown; scope: SettingScope }[] = [];
  readonly defaults: Partial<PeopleSoftStudioSettings> = {
    connections: [], 'oracle.thickModeLibDir': '', 'peoplecode.decoder': 'auto',
    'mcp.enabled': true, 'mcp.port': 7337
  };
  failNextWrite?: Error;
  private readonly listeners = new Set<(affects: (key: SettingKey) => boolean) => void>();

  set(key: SettingKey, scope: SettingScope, value: unknown): void {
    this.values.set(key, { ...this.values.get(key), [scope]: value });
  }

  /** An edit made outside the panel: settings.json or VS Code's own Settings UI. */
  external(key: SettingKey, scope: SettingScope, value: unknown): void {
    this.set(key, scope, value);
    for (const l of [...this.listeners]) l((k) => k === key);
  }

  get<K extends SettingKey>(key: K): PeopleSoftStudioSettings[K] | undefined {
    const v = this.values.get(key) ?? {};
    return (v.workspaceFolder ?? v.workspace ?? v.global ?? this.defaults[key]) as PeopleSoftStudioSettings[K];
  }

  inspect<K extends SettingKey>(key: K): SettingInspection<PeopleSoftStudioSettings[K]> {
    const v = this.values.get(key) ?? {};
    return {
      defaultValue: this.defaults[key] as PeopleSoftStudioSettings[K],
      globalValue: v.global as PeopleSoftStudioSettings[K] | undefined,
      workspaceValue: v.workspace as PeopleSoftStudioSettings[K] | undefined,
      workspaceFolderValue: v.workspaceFolder as PeopleSoftStudioSettings[K] | undefined
    };
  }

  async update<K extends SettingKey>(key: K, value: PeopleSoftStudioSettings[K], scope: SettingScope): Promise<void> {
    if (this.failNextWrite) {
      const err = this.failNextWrite;
      this.failNextWrite = undefined;
      throw err;
    }
    this.writes.push({ key, value, scope });
    this.external(key, scope, value);
  }

  onDidChange(listener: (affects: (key: SettingKey) => boolean) => void) {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  get listenerCount(): number { return this.listeners.size; }
}

const idOf = (c: ConnectionConfig) => c.kind === 'projectFile' ? `project:${c.path}` : `oracle:${c.name}`;

class FakeConnections implements ConnectionPort {
  readonly connected = new Set<string>();
  selected?: string;
  readonly environments = new Map<string, () => Promise<EnvironmentInfo>>();
  readonly calls: string[] = [];
  testResult: () => Promise<EnvironmentInfo | undefined> = async () => undefined;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly config: FakeConfiguration) {}

  list(): ConnectionEntry[] {
    return (this.config.get('connections') ?? []).map((config) => ({
      id: idOf(config), config, connected: this.connected.has(idOf(config))
    }));
  }
  selectedId() { return this.selected; }
  fire() { for (const l of [...this.listeners]) l(); }

  /** What the Connections view or the status bar does; Settings has no way to. */
  selectElsewhere(id: string): void {
    this.connected.add(id);
    this.selected = id;
    this.fire();
  }
  disconnectElsewhere(id: string): void {
    this.connected.delete(id);
    this.fire();
  }

  async add() { this.calls.push('add'); }
  async remove(config: ConnectionConfig) { this.calls.push(`remove:${config.name}`); }
  test(config: ConnectionConfig) { this.calls.push(`test:${config.name}`); return this.testResult(); }
  readEnvironment(id: string) {
    const read = this.environments.get(id);
    return read ? read() : undefined;
  }
  onDidChange(listener: () => void) {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }
}

const HCDEV: ConnectionConfig = { name: 'HCDEV', kind: 'oracle', connectString: 'hcdev.example:1521/HCDEV', user: 'SYSADM' };
const HCTST: ConnectionConfig = { name: 'HCTST', kind: 'oracle', connectString: 'hctst.example:1521/HCTST', user: 'SYSADM' };
const EXPORT: ConnectionConfig = { name: 'Export', kind: 'projectFile', path: '/tmp/project.xml' };

function setup(connections: ConnectionConfig[] = [HCDEV, HCTST, EXPORT]) {
  const config = new FakeConfiguration();
  config.set('connections', 'global', connections);
  const conns = new FakeConnections(config);
  const errors: string[] = [];
  const nativeOpened: number[] = [];
  const service = new SettingsService(config, conns, {
    showError: (m) => { errors.push(m); },
    openNativeSettings: async () => { nativeOpened.push(1); }
  });
  const states: SettingsState[] = [];
  service.onDidChangeState((s) => states.push(s));
  return { config, conns, service, errors, states, nativeOpened };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// Reading configuration

test('reads every configured connection and setting from configuration', () => {
  const { service, config } = setup();
  config.set('peoplecode.decoder', 'workspace', 'strict');
  const state = service.getState();

  assert.deepEqual(state.connections.map((c) => c.name), ['HCDEV', 'HCTST', 'Export']);
  assert.equal(state.connectionsSource, 'global');
  const decoder = state.settings.find((s) => s.key === 'peoplecode.decoder');
  assert.equal(decoder?.value, 'strict');
  assert.equal(decoder?.source, 'workspace');
  const libDir = state.settings.find((s) => s.key === 'oracle.thickModeLibDir');
  assert.equal(libDir?.value, '');
  assert.equal(libDir?.source, 'default');
});

test('connection views carry the configured fields and nothing else', () => {
  const { service, config } = setup([]);
  config.set('connections', 'global', [{ ...HCDEV, password: 'hunter2', token: 'abc' }]);
  const [view] = service.getState().connections;

  assert.equal(view.connectString, 'hcdev.example:1521/HCDEV');
  assert.equal(view.user, 'SYSADM');
  assert.equal(view.kindLabel, 'Oracle database');
  assert.ok(!JSON.stringify(view).includes('hunter2'));
  assert.ok(!JSON.stringify(view).includes('abc"'));
  assert.ok(!('password' in view));
});

test('read-only is connection metadata, not a toggle', () => {
  assert.equal(describeAccess('projectFile').level, 'read-only');
  assert.equal(describeAccess('oracle').level, 'partial');
  assert.match(describeAccess('oracle').detail, /PeopleCode write-back is not supported/);

  const { service } = setup();
  const views = service.getState().connections;
  assert.equal(views.find((c) => c.name === 'Export')?.access.label, 'Read-only');
  assert.equal(views.find((c) => c.name === 'HCDEV')?.access.label, 'PeopleCode read-only');
  assert.equal(service.getState().settings.some((s) => /read.?only/i.test(s.key)), false);
});

// ---------------------------------------------------------------------------
// Writing configuration and its scope

test('writes a setting to the scope that defines it, defaulting to user settings', async () => {
  const { service, config } = setup();

  await service.handleMessage({ type: 'updateSetting', key: 'peoplecode.decoder', value: 'raw' });
  assert.deepEqual(config.writes.at(-1), { key: 'peoplecode.decoder', value: 'raw', scope: 'global' });

  config.set('oracle.thickModeLibDir', 'workspace', '/opt/oracle');
  await service.handleMessage({ type: 'updateSetting', key: 'oracle.thickModeLibDir', value: '  /opt/ic21  ' });
  assert.deepEqual(config.writes.at(-1), { key: 'oracle.thickModeLibDir', value: '/opt/ic21', scope: 'workspace' });
});

test('writeScopeFor prefers the most specific defined scope', () => {
  assert.equal(writeScopeFor(undefined), 'global');
  assert.equal(writeScopeFor({ defaultValue: 'auto' }), 'global');
  assert.equal(writeScopeFor({ globalValue: 'a' }), 'global');
  assert.equal(writeScopeFor({ globalValue: 'a', workspaceValue: 'b' }), 'workspace');
  assert.equal(writeScopeFor({ workspaceValue: 'b', workspaceFolderValue: 'c' }), 'workspaceFolder');
  assert.equal(sourceOf({ defaultValue: 'auto' }), 'default');
  // An empty string is a defined value, not an absent one.
  assert.equal(sourceOf({ globalValue: '' }), 'global');
});

test('invalid setting values are rejected against the field and not written', async () => {
  const { service, config } = setup();
  const reply = await service.handleMessage({ type: 'updateSetting', key: 'peoplecode.decoder', value: 'verbose' });

  assert.deepEqual(reply?.type, 'validation');
  assert.match((reply as Extract<SettingsHostMessage, { type: 'validation' }>).errors.value, /Decoder must be one of auto, strict, raw/);
  assert.equal(config.writes.length, 0);

  assert.equal(validateSetting('oracle.thickModeLibDir', 'relative/dir').ok, false);
  assert.equal(validateSetting('oracle.thickModeLibDir', 'C:\\oracle\\ic21').ok, true);
  assert.deepEqual(validateSetting('oracle.thickModeLibDir', '   '), { ok: true, value: '' });
  assert.equal(validateSetting('oracle.thickModeLibDir', 42).ok, false);
});

test('MCP settings are read with their types and defaults', () => {
  const { service, config } = setup();
  let settings = service.getState().settings;
  assert.deepEqual(settings.filter((s) => s.section === 'mcp').map((s) => [s.key, s.value, s.source]),
    [['mcp.enabled', true, 'default'], ['mcp.port', 7337, 'default']]);

  config.set('mcp.enabled', 'global', false);
  config.set('mcp.port', 'workspace', 8123);
  settings = service.getState().settings;
  assert.deepEqual(settings.filter((s) => s.section === 'mcp').map((s) => [s.key, s.value, s.source]),
    [['mcp.enabled', false, 'global'], ['mcp.port', 8123, 'workspace']]);
});

test('MCP settings are validated and written as a boolean and an integer', async () => {
  const { service, config } = setup();

  await service.handleMessage({ type: 'updateSetting', key: 'mcp.enabled', value: false });
  assert.deepEqual(config.writes.at(-1), { key: 'mcp.enabled', value: false, scope: 'global' });

  // The page sends the typed text; it is stored as a number.
  await service.handleMessage({ type: 'updateSetting', key: 'mcp.port', value: ' 8123 ' });
  assert.deepEqual(config.writes.at(-1), { key: 'mcp.port', value: 8123, scope: 'global' });

  const writes = config.writes.length;
  for (const [key, value, error] of [
    ['mcp.port', '80', 'Port must be between 1024 and 65535.'],
    ['mcp.port', '70000', 'Port must be between 1024 and 65535.'],
    ['mcp.port', 'abc', 'Port must be a whole number.'],
    ['mcp.port', '8080.5', 'Port must be a whole number.'],
    ['mcp.port', '', 'Port must be a whole number.'],
    ['mcp.enabled', 'true', 'Must be on or off.']
  ] as const) {
    const reply = await service.handleMessage({ type: 'updateSetting', key, value }) as Extract<SettingsHostMessage, { type: 'validation' }>;
    assert.equal(reply.errors.value, error, `${key}=${JSON.stringify(value)}`);
  }
  assert.equal(config.writes.length, writes);
});

test('a failed configuration write is reported, not swallowed', async () => {
  const { service, config, errors } = setup();
  config.failNextWrite = new Error('Unable to write to Workspace Settings because no workspace is opened.\nstack...');
  const reply = await service.handleMessage({ type: 'updateSetting', key: 'peoplecode.decoder', value: 'raw' });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /no workspace is opened\.$/);
  assert.equal(reply?.type, 'validation');
  assert.match((reply as Extract<SettingsHostMessage, { type: 'validation' }>).errors.value, /Could not save/);
});

test('editing a connection rewrites only that entry, in its own scope', async () => {
  const { service, config } = setup([]);
  config.set('connections', 'global', [EXPORT]);
  config.set('connections', 'workspace', [HCDEV, HCTST]);

  const reply = await service.handleMessage({
    type: 'updateConnection', connectionId: 'oracle:HCTST',
    edit: { connectString: 'hctst2.example:1522/HCTST', user: 'PS' }
  });

  assert.deepEqual(reply, { type: 'validation', target: { kind: 'connection', connectionId: 'oracle:HCTST' }, errors: {} });
  const write = config.writes.at(-1);
  assert.equal(write?.scope, 'workspace');
  assert.deepEqual(write?.value, [HCDEV, { ...HCTST, connectString: 'hctst2.example:1522/HCTST', user: 'PS' }]);
  // The user-level array is untouched.
  assert.deepEqual(config.inspect('connections').globalValue, [EXPORT]);
});

test('connection edits are validated per field', async () => {
  const { service, config } = setup();
  const reply = await service.handleMessage({
    type: 'updateConnection', connectionId: 'oracle:HCDEV', edit: { connectString: 'host:15x21/SVC', user: '' }
  }) as Extract<SettingsHostMessage, { type: 'validation' }>;

  assert.deepEqual(reply.errors, { connectString: 'Port must be a number.', user: 'Database access id is required.' });
  assert.equal(config.writes.length, 0);

  assert.deepEqual(validateConnectionEdit(HCDEV, { connectString: '' }), { ok: false, errors: { connectString: 'Connect string is required.' } });
  assert.deepEqual(validateConnectionEdit(HCDEV, { connectString: 'h:70000/S' }), { ok: false, errors: { connectString: 'Port must be between 1 and 65535.' } });
  assert.equal(validateConnectionEdit(HCDEV, { connectString: 'hcdev/HCDEV' }).ok, true);
  assert.equal(validateConnectionEdit(HCDEV, { connectString: 'TNSALIAS' }).ok, true);
  assert.equal(validateConnectionEdit(HCDEV, { connectString: '//h:1521/S' }).ok, true);
  assert.deepEqual(validateConnectionEdit(EXPORT, { path: ' ' }), { ok: false, errors: { path: 'Project file path is required.' } });
  assert.deepEqual(validateConnectionEdit(EXPORT, { user: 'x' }), { ok: false, errors: { user: 'user does not apply to this connection.' } });
});

test('a connection shadowed by a more specific scope is not edited', async () => {
  const { service, config } = setup([]);
  config.set('connections', 'global', [HCDEV]);
  config.set('connections', 'workspace', []);
  // HCDEV is no longer effective (the workspace array shadows it), so it is not listed at all.
  assert.equal(service.getState().connections.length, 0);
  const reply = await service.handleMessage({ type: 'updateConnection', connectionId: 'oracle:HCDEV', edit: { user: 'PS' } });
  assert.deepEqual((reply as Extract<SettingsHostMessage, { type: 'validation' }>).errors, { form: 'That connection is no longer configured.' });
  assert.equal(config.writes.length, 0);
});

// ---------------------------------------------------------------------------
// The target connection: displayed, never chosen here

test('a selection made in the Connections view or status bar reaches subscribers', () => {
  const { conns, states } = setup();
  conns.selectElsewhere('oracle:HCDEV');
  assert.equal(states.at(-1)?.selectedConnectionId, 'oracle:HCDEV');
  assert.deepEqual(states.at(-1)?.connections.filter((c) => c.selected).map((c) => c.name), ['HCDEV']);
  assert.equal(states.at(-1)?.connections.find((c) => c.selected)?.connected, true);

  conns.selectElsewhere('oracle:HCTST');
  assert.deepEqual(states.at(-1)?.connections.filter((c) => c.selected).map((c) => c.name), ['HCTST']);
});

test('no Settings message selects, connects or disconnects', async () => {
  const { service, conns } = setup();
  conns.selectElsewhere('oracle:HCDEV');
  const before = { selected: conns.selected, connected: [...conns.connected] };

  for (const message of [
    { type: 'ready' }, { type: 'testConnection', connectionId: 'oracle:HCTST' },
    { type: 'updateConnection', connectionId: 'oracle:HCTST', edit: { user: 'PS' } },
    { type: 'updateSetting', key: 'peoplecode.decoder', value: 'raw' },
    { type: 'addConnection' }, { type: 'removeConnection', connectionId: 'oracle:HCTST' },
    { type: 'openNativeSettings' }
  ] as const) {
    await service.handleMessage(message);
  }
  assert.deepEqual({ selected: conns.selected, connected: [...conns.connected] }, before);

  // The page cannot ask for it either: the contract has no such messages.
  for (const type of ['selectConnection', 'connect', 'disconnect']) {
    assert.equal(parseWebviewMessage({ type, connectionId: 'oracle:HCTST' }), undefined, type);
  }
});

test('an unknown connection id is refused with a message', async () => {
  const { service, conns, errors } = setup();
  await service.handleMessage({ type: 'testConnection', connectionId: 'oracle:GONE' });
  assert.deepEqual(conns.calls, []);
  assert.deepEqual(errors, ['That connection is no longer configured.']);
});

test('add and remove delegate to the existing operations', async () => {
  const { service, conns, nativeOpened } = setup();
  await service.handleMessage({ type: 'addConnection' });
  await service.handleMessage({ type: 'removeConnection', connectionId: 'project:/tmp/project.xml' });
  await service.handleMessage({ type: 'openNativeSettings' });
  assert.deepEqual(conns.calls, ['add', 'remove:Export']);
  assert.equal(nativeOpened.length, 1);
});

// ---------------------------------------------------------------------------
// Release and compiler profile

test('maps PSSTATUS to a release and compiler profile through the compiler table', () => {
  assert.equal(formatRelease({ toolsRelease: '8.62', patchLevel: 9 }), '8.62.09');
  assert.equal(formatRelease({ toolsRelease: '8.61', patchLevel: 15 }), '8.61.15');
  assert.equal(formatRelease({ toolsRelease: '8.61' }), '8.61');

  assert.deepEqual(describeEnvironment({ toolsRelease: '8.62', patchLevel: 9 }), {
    status: 'available', release: '8.62.09', toolsRelease: '8.62', patchLevel: 9, profile: { ok: true, id: 'PT862' }
  });
  assert.deepEqual(describeEnvironment({ toolsRelease: '8.61', patchLevel: 15 }), {
    status: 'available', release: '8.61.15', toolsRelease: '8.61', patchLevel: 15, profile: { ok: true, id: 'PT861' }
  });

  const unknown = describeEnvironment({ toolsRelease: '8.60', patchLevel: 3 });
  assert.equal(unknown.status, 'available');
  assert.equal((unknown as { profile: { ok: boolean } }).profile.ok, false);
  assert.match((unknown as { profile: { message: string } }).profile.message, /No compiler profile for PeopleTools release "8.60"/);
});

test('the release is read from the connection, not inferred from its name', async () => {
  const { service, conns, states } = setup();
  // HCDEV is named like the 8.61 corpus but reports 8.62 here: the report wins.
  conns.connected.add('oracle:HCDEV');
  conns.selected = 'oracle:HCDEV';
  conns.environments.set('oracle:HCDEV', async () => ({ toolsRelease: '8.62', patchLevel: 9 }));

  assert.equal(service.getState().connections[0].environment.status, 'loading');
  await settle();
  const env = states.at(-1)!.connections[0].environment;
  assert.equal(env.status, 'available');
  assert.equal(env.status === 'available' && env.release, '8.62.09');
  assert.deepEqual(env.status === 'available' && env.profile, { ok: true, id: 'PT862' });
});

test('release states: not connected, project export, read failure, and reconnect', async () => {
  const { service, conns, states } = setup();
  assert.equal(service.getState().connections[0].environment.status, 'not-connected');

  conns.connected.add('project:/tmp/project.xml');
  assert.equal(service.getState().connections[2].environment.status, 'not-applicable');

  conns.connected.add('oracle:HCTST');
  conns.environments.set('oracle:HCTST', async () => { throw new Error('ORA-00942: table or view does not exist\nmore'); });
  service.getState();
  await settle();
  const failed = states.at(-1)!.connections[1].environment;
  assert.deepEqual(failed, { status: 'error', message: 'ORA-00942: table or view does not exist' });

  // Disconnecting forgets the cached state; reconnecting reads again.
  conns.disconnectElsewhere('oracle:HCTST');
  assert.equal(service.getState().connections[1].environment.status, 'not-connected');
  conns.connected.add('oracle:HCTST');
  conns.environments.set('oracle:HCTST', async () => ({ toolsRelease: '8.61', patchLevel: 15 }));
  service.getState();
  await settle();
  assert.equal(states.at(-1)!.connections[1].environment.status, 'available');
});

test('a release read that finishes after a disconnect is discarded', async () => {
  const { service, conns, states } = setup();
  let resolve!: (info: EnvironmentInfo) => void;
  conns.connected.add('oracle:HCDEV');
  conns.environments.set('oracle:HCDEV', () => new Promise((r) => { resolve = r; }));
  service.getState();

  conns.connected.delete('oracle:HCDEV');
  conns.fire();
  resolve({ toolsRelease: '8.62', patchLevel: 9 });
  await settle();
  assert.equal(states.at(-1)!.connections[0].environment.status, 'not-connected');
});

// ---------------------------------------------------------------------------
// Connection test

test('Test Connection reports testing, then the release or a safe error', async () => {
  const { service, conns, states } = setup();
  conns.testResult = async () => ({ toolsRelease: '8.62', patchLevel: 9 });
  await service.handleMessage({ type: 'testConnection', connectionId: 'oracle:HCDEV' });

  const tested = states.map((s) => s.connections[0].test?.status);
  assert.deepEqual(tested, ['testing', 'succeeded']);
  assert.deepEqual(states.at(-1)!.connections[0].test, { status: 'succeeded', release: '8.62.09' });
  // A test does not connect or select.
  assert.equal(states.at(-1)!.connections[0].connected, false);
  assert.equal(states.at(-1)!.selectedConnectionId, undefined);

  conns.testResult = async () => { throw new Error(`ORA-01017: invalid username/password; logon denied\n${'x'.repeat(50)}`); };
  await service.handleMessage({ type: 'testConnection', connectionId: 'oracle:HCDEV' });
  assert.deepEqual(states.at(-1)!.connections[0].test, { status: 'failed', message: 'ORA-01017: invalid username/password; logon denied' });
});

test('safeErrorMessage keeps one bounded line', () => {
  assert.equal(safeErrorMessage(new Error('first\nsecond')), 'first');
  assert.equal(safeErrorMessage('x'.repeat(400)).length, 300);
  assert.equal(safeErrorMessage(42), '42');
});

// ---------------------------------------------------------------------------
// External changes and lifecycle

test('an external configuration change refreshes subscribers', () => {
  const { config, states } = setup();
  config.external('peoplecode.decoder', 'global', 'strict');
  assert.equal(states.at(-1)?.settings.find((s) => s.key === 'peoplecode.decoder')?.value, 'strict');

  config.external('connections', 'global', [HCTST]);
  assert.deepEqual(states.at(-1)?.connections.map((c) => c.name), ['HCTST']);
});

test('changes outside peoplesoft.* settings do not refresh', () => {
  const { config, states } = setup();
  const count = states.length;
  (config as unknown as { listeners: Set<(a: (k: string) => boolean) => void> }).listeners
    .forEach((l) => l(() => false));
  assert.equal(states.length, count);
});

test('MCP state is surfaced and its actions delegated', async () => {
  const config = new FakeConfiguration();
  const conns = new FakeConnections(config);
  const actions: string[] = [];
  let listener: (() => void) | undefined;
  let status: 'disabled' | 'stopped' | 'running' = 'stopped';
  const mcp: McpPort = {
    state: () => ({ status, url: 'http://127.0.0.1:3901/mcp' }),
    run: async (action) => { actions.push(action); },
    onDidChange: (l) => { listener = l; return { dispose: () => { listener = undefined; } }; }
  };
  const service = new SettingsService(config, conns, { showError: () => {}, openNativeSettings: async () => {} }, mcp);
  const states: SettingsState[] = [];
  service.onDidChangeState((s) => states.push(s));

  assert.equal(service.getState().mcp?.status, 'stopped');
  status = 'disabled';
  listener?.();
  assert.equal(states.at(-1)?.mcp?.status, 'disabled');
  status = 'stopped';
  await service.handleMessage({ type: 'mcp', action: 'start' });
  status = 'running';
  listener?.();
  assert.deepEqual(actions, ['start']);
  assert.equal(states.at(-1)?.mcp?.status, 'running');

  service.dispose();
  assert.equal(listener, undefined);
});

test('dispose releases every subscription', () => {
  const { service, config, states } = setup();
  service.dispose();
  assert.equal(config.listenerCount, 0);
  const count = states.length;
  config.external('peoplecode.decoder', 'global', 'raw');
  assert.equal(states.length, count);
});

// ---------------------------------------------------------------------------
// Message contract

test('parseWebviewMessage accepts the contract and nothing else', () => {
  assert.deepEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' });
  assert.deepEqual(parseWebviewMessage({ type: 'testConnection', connectionId: 'oracle:HCDEV' }),
    { type: 'testConnection', connectionId: 'oracle:HCDEV' });
  assert.deepEqual(parseWebviewMessage({ type: 'updateSetting', key: 'peoplecode.decoder', value: 'raw' }),
    { type: 'updateSetting', key: 'peoplecode.decoder', value: 'raw' });
  assert.deepEqual(parseWebviewMessage({ type: 'updateConnection', connectionId: 'oracle:X', edit: { user: 'PS' } }),
    { type: 'updateConnection', connectionId: 'oracle:X', edit: { user: 'PS' } });
  assert.deepEqual(parseWebviewMessage({ type: 'mcp', action: 'copyUrl' }), { type: 'mcp', action: 'copyUrl' });

  for (const bad of [
    null, 'ready', 42, {}, { type: 'nope' },
    { type: 'testConnection' }, { type: 'testConnection', connectionId: '' }, { type: 'testConnection', connectionId: 7 },
    { type: 'selectConnection', connectionId: 'oracle:X' },
    // Connections have their own editor; they cannot be overwritten as a plain value.
    { type: 'updateSetting', key: 'connections', value: [] },
    { type: 'updateSetting', key: 'peoplecode.decoder' },
    { type: 'updateConnection', connectionId: 'oracle:X', edit: { name: 'Y' } },
    { type: 'updateConnection', connectionId: 'oracle:X', edit: { password: 'p' } },
    { type: 'updateConnection', connectionId: 'oracle:X', edit: { user: 1 } },
    { type: 'mcp', action: 'shell' }
  ]) {
    assert.equal(parseWebviewMessage(bad), undefined, JSON.stringify(bad));
  }
});
