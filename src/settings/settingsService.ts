import type { ConnectionConfig } from '../workspace.js';
import type { EnvironmentInfo } from '../providers/provider.js';
import {
  describeAccess, describeEnvironment, editableFields, formatRelease, safeErrorMessage,
  SETTING_DESCRIPTORS, sourceOf, validateConnectionEdit, validateSetting, writeScopeFor,
  type ConnectionEdit, type EditableSettingKey, type EnvironmentView, type PeopleSoftStudioSettings,
  type SettingInspection, type SettingKey, type SettingScope
} from './settingsModel.js';
import type {
  ConnectionTestView, ConnectionView, McpAction, McpView, SettingsHostMessage,
  SettingsState, SettingsWebviewMessage, SettingView
} from './settingsMessages.js';

/*
 * The Settings controller: reads configuration, validates and writes it,
 * describes runtime connection state, and tells subscribers when any of it
 * changes.
 *
 * It reaches VS Code and the rest of the extension only through the ports
 * below, so it holds no `vscode` import and is tested against fakes. The
 * adapters that bind the ports to the real Workspace and configuration live
 * in settingsAdapters.ts.
 */

export interface Disposable {
  dispose(): void;
}

/** `peoplesoft.*` configuration, as vscode.WorkspaceConfiguration exposes it. */
export interface ConfigurationPort {
  get<K extends SettingKey>(key: K): PeopleSoftStudioSettings[K] | undefined;
  inspect<K extends SettingKey>(key: K): SettingInspection<PeopleSoftStudioSettings[K]> | undefined;
  update<K extends SettingKey>(key: K, value: PeopleSoftStudioSettings[K], scope: SettingScope): Promise<void>;
  /** Fires on any configuration change, with a predicate for the keys it affected. */
  onDidChange(listener: (affects: (key: SettingKey) => boolean) => void): Disposable;
}

export interface ConnectionEntry {
  id: string;
  config: ConnectionConfig;
  connected: boolean;
}

/**
 * The connection model, as Settings may use it. Selection and connection
 * state are read here, never changed: the working connection is chosen in
 * the Connections view and the status bar. Add and remove are the existing
 * commands.
 */
export interface ConnectionPort {
  list(): ConnectionEntry[];
  /** The workspace's selectedConnectionId, read-only. */
  selectedId(): string | undefined;
  add(): Promise<void>;
  remove(config: ConnectionConfig): Promise<void>;
  /** Connects a throwaway provider; resolves to its PSSTATUS where it has one. */
  test(config: ConnectionConfig): Promise<EnvironmentInfo | undefined>;
  /** The live provider's PSSTATUS, or undefined when the provider has no database behind it. */
  readEnvironment(id: string): Promise<EnvironmentInfo> | undefined;
  onDidChange(listener: () => void): Disposable;
}

export interface McpPort {
  state(): McpView;
  run(action: McpAction): Promise<void>;
  onDidChange(listener: () => void): Disposable;
}

export interface UiPort {
  showError(message: string): void;
  openNativeSettings(): Promise<void>;
}

const KIND_LABELS: Record<ConnectionConfig['kind'], string> = {
  oracle: 'Oracle database',
  projectFile: 'Project export'
};

const SCOPE_LABELS: Record<SettingScope, string> = {
  global: 'user',
  workspace: 'workspace',
  workspaceFolder: 'workspace folder'
};

export class SettingsService implements Disposable {
  private readonly listeners = new Set<(state: SettingsState) => void>();
  private readonly subscriptions: Disposable[] = [];

  /** PSSTATUS per connected connection id. Runtime state, cleared on disconnect. */
  private readonly environments = new Map<string, EnvironmentView>();
  /** The last Test Connection result per connection id. */
  private readonly tests = new Map<string, ConnectionTestView>();

  constructor(
    private readonly config: ConfigurationPort,
    private readonly connections: ConnectionPort,
    private readonly ui: UiPort,
    private readonly mcp?: McpPort
  ) {
    this.subscriptions.push(
      config.onDidChange((affects) => {
        if (SETTING_KEYS.some(affects)) this.notify();
      }),
      connections.onDidChange(() => this.notify())
    );
    if (mcp) this.subscriptions.push(mcp.onDidChange(() => this.notify()));
  }

  /** Subscribes to state changes. The listener is not called with the current state. */
  onDidChangeState(listener: (state: SettingsState) => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  getState(): SettingsState {
    const entries = this.connections.list();
    const selectedId = this.connections.selectedId();
    this.prune(entries);

    return {
      connections: entries.map((entry) => this.connectionView(entry, selectedId)),
      ...(selectedId !== undefined ? { selectedConnectionId: selectedId } : {}),
      connectionsSource: sourceOf(this.config.inspect('connections')),
      settings: SETTING_DESCRIPTORS.map((d): SettingView => ({
        key: d.key,
        section: d.section,
        label: d.label,
        description: d.description,
        ...(d.appliesWhen !== undefined ? { appliesWhen: d.appliesWhen } : {}),
        control: d.control,
        value: this.config.get(d.key) ?? d.defaultValue,
        source: sourceOf(this.config.inspect(d.key))
      })),
      ...(this.mcp ? { mcp: this.mcp.state() } : {})
    };
  }

  /**
   * Acts on a message from the page. Returns the reply for that page alone
   * (form validation); state changes reach every subscriber through
   * onDidChangeState.
   */
  async handleMessage(message: SettingsWebviewMessage): Promise<SettingsHostMessage | undefined> {
    switch (message.type) {
      case 'ready':
        return { type: 'state', state: this.getState() };
      case 'updateSetting':
        return this.updateSetting(message.key, message.value);
      case 'updateConnection':
        return this.updateConnection(message.connectionId, message.edit);
      case 'addConnection':
        await this.connections.add();
        return undefined;
      case 'openNativeSettings':
        await this.ui.openNativeSettings();
        return undefined;
      case 'mcp':
        if (this.mcp) await this.mcp.run(message.action);
        return undefined;
    }

    const entry = this.find(message.connectionId);
    if (!entry) {
      this.ui.showError('That connection is no longer configured.');
      this.notify();
      return undefined;
    }

    switch (message.type) {
      case 'removeConnection':
        await this.connections.remove(entry.config);
        return undefined;
      case 'testConnection':
        await this.testConnection(entry);
        return undefined;
    }
  }

  dispose(): void {
    for (const s of this.subscriptions) s.dispose();
    this.subscriptions.length = 0;
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------

  private notify(): void {
    if (this.listeners.size === 0) return;
    const state = this.getState();
    for (const listener of [...this.listeners]) listener(state);
  }

  private find(id: string): ConnectionEntry | undefined {
    return this.connections.list().find((e) => e.id === id);
  }

  private connectionView(entry: ConnectionEntry, selectedId: string | undefined): ConnectionView {
    const { config } = entry;
    const test = this.tests.get(entry.id);
    return {
      id: entry.id,
      name: config.name,
      kind: config.kind,
      kindLabel: KIND_LABELS[config.kind] ?? config.kind,
      // Copied field by field: whatever else is in the settings object stays out of the page.
      ...(config.kind === 'oracle'
        ? { connectString: config.connectString ?? '', user: config.user ?? '' }
        : { path: config.path ?? '' }),
      connected: entry.connected,
      selected: entry.id === selectedId,
      access: describeAccess(config.kind),
      environment: this.environmentOf(entry),
      ...(test ? { test } : {}),
      editableFields: editableFields(config.kind)
    };
  }

  /** The connection's release, starting the PSSTATUS read the first time it is asked for. */
  private environmentOf(entry: ConnectionEntry): EnvironmentView {
    if (!entry.connected) return { status: 'not-connected' };

    const known = this.environments.get(entry.id);
    if (known) return known;

    const read = this.connections.readEnvironment(entry.id);
    if (!read) {
      const view: EnvironmentView = {
        status: 'not-applicable',
        reason: 'A project export does not record its PeopleTools release.'
      };
      this.environments.set(entry.id, view);
      return view;
    }

    const loading: EnvironmentView = { status: 'loading' };
    this.environments.set(entry.id, loading);
    read.then(
      (info) => this.settleEnvironment(entry.id, loading, describeEnvironment(info)),
      (err) => this.settleEnvironment(entry.id, loading, { status: 'error', message: safeErrorMessage(err) }));
    return loading;
  }

  private settleEnvironment(id: string, pending: EnvironmentView, view: EnvironmentView): void {
    // A disconnect (or reconnect) since the read began made it stale.
    if (this.environments.get(id) !== pending) return;
    this.environments.set(id, view);
    this.notify();
  }

  /** Forgets runtime state for connections that disconnected or were removed. */
  private prune(entries: readonly ConnectionEntry[]): void {
    const connected = new Set(entries.filter((e) => e.connected).map((e) => e.id));
    const configured = new Set(entries.map((e) => e.id));
    for (const id of [...this.environments.keys()]) {
      if (!connected.has(id)) this.environments.delete(id);
    }
    for (const id of [...this.tests.keys()]) {
      if (!configured.has(id)) this.tests.delete(id);
    }
  }

  private async updateSetting(key: EditableSettingKey, value: unknown): Promise<SettingsHostMessage> {
    const target = { kind: 'setting' as const, key };
    const validated = validateSetting(key, value);
    if (!validated.ok) return { type: 'validation', target, errors: { value: validated.error } };

    const scope = writeScopeFor(this.config.inspect(key));
    try {
      await this.config.update(key, validated.value, scope);
    } catch (err) {
      const message = `Could not save ${key} to ${SCOPE_LABELS[scope]} settings: ${safeErrorMessage(err)}`;
      this.ui.showError(message);
      return { type: 'validation', target, errors: { value: message } };
    }
    return { type: 'validation', target, errors: {} };
  }

  /**
   * Rewrites one connection in the scope `peoplesoft.connections` is defined
   * in. The array is replaced whole -- VS Code does not merge arrays across
   * scopes -- with only the matching entry changed.
   */
  private async updateConnection(id: string, edit: ConnectionEdit): Promise<SettingsHostMessage | undefined> {
    const target = { kind: 'connection' as const, connectionId: id };
    const entry = this.find(id);
    if (!entry) {
      return { type: 'validation', target, errors: { form: 'That connection is no longer configured.' } };
    }

    const validated = validateConnectionEdit(entry.config, edit);
    if (!validated.ok) return { type: 'validation', target, errors: validated.errors };

    const inspection = this.config.inspect('connections');
    const scope = writeScopeFor(inspection);
    const current = valueAt(inspection, scope) ?? [];
    const index = current.findIndex((c) => c.name === entry.config.name && c.kind === entry.config.kind);
    if (index < 0) {
      return {
        type: 'validation', target,
        errors: { form: `"${entry.config.name}" is not defined in ${SCOPE_LABELS[scope]} settings; edit it in settings.json.` }
      };
    }

    const next = [...current];
    next[index] = validated.value;
    try {
      await this.config.update('connections', next, scope);
    } catch (err) {
      const message = `Could not save connection "${entry.config.name}": ${safeErrorMessage(err)}`;
      this.ui.showError(message);
      return { type: 'validation', target, errors: { form: message } };
    }
    return { type: 'validation', target, errors: {} };
  }

  private async testConnection(entry: ConnectionEntry): Promise<void> {
    this.tests.set(entry.id, { status: 'testing' });
    this.notify();
    let result: ConnectionTestView;
    try {
      const info = await this.connections.test(entry.config);
      result = info
        ? { status: 'succeeded', release: formatRelease(info) }
        : { status: 'succeeded' };
    } catch (err) {
      result = { status: 'failed', message: safeErrorMessage(err) };
    }
    this.tests.set(entry.id, result);
    this.notify();
  }
}

const SETTING_KEYS: readonly SettingKey[] = ['connections', ...SETTING_DESCRIPTORS.map((d) => d.key)];

function valueAt<T>(inspection: SettingInspection<T> | undefined, scope: SettingScope): T | undefined {
  switch (scope) {
    case 'workspaceFolder': return inspection?.workspaceFolderValue;
    case 'workspace': return inspection?.workspaceValue;
    case 'global': return inspection?.globalValue;
  }
}
