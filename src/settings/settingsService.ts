import type { ConnectionConfig } from '../workspace.js';
import type { EnvironmentInfo } from '../providers/provider.js';
import {
  DECODER_OPTIONS, effectiveDecoder, validateDecoder,
  PEOPLECODE_ACCESS_OPTIONS, PEOPLECODE_SAVE_MODE_OPTIONS, peoplecodeWriteSettings, validateConnectionOption,
  type ConnectionOption,
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
  /** Whether a PeopleSoft operator exists in the connection's database (PSOPRDEFN), read-only. */
  verifyOperator(config: ConnectionConfig, operatorId: string): Promise<boolean>;
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
  /** A modal confirmation; resolves true only if the user chose `action`. */
  confirm(message: string, detail: string, action: string): Promise<boolean>;
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
  /** The release the last successful Test Connection read, shown while not connected. */
  private readonly testedEnvironments = new Map<string, EnvironmentView>();

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
      decoderOptions: DECODER_OPTIONS,
      defaultDecoder: this.defaultDecoder(),
      peoplecodeAccessOptions: PEOPLECODE_ACCESS_OPTIONS,
      peoplecodeSaveModeOptions: PEOPLECODE_SAVE_MODE_OPTIONS,
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
      case 'setConnectionOption':
        return this.setConnectionOption(message.connectionId, message.option, message.value);
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
      access: describeAccess(config),
      environment: this.environmentOf(entry),
      ...(config.kind === 'oracle'
        ? { decoder: effectiveDecoder(config, this.defaultDecoder()), peoplecodeWrite: peoplecodeWriteSettings(config) }
        : {}),
      ...(test ? { test } : {}),
      editableFields: editableFields(config.kind)
    };
  }

  /** The connection's release, starting the PSSTATUS read the first time it is asked for. */
  private environmentOf(entry: ConnectionEntry): EnvironmentView {
    if (!entry.connected) return this.testedEnvironments.get(entry.id) ?? { status: 'not-connected' };

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
      if (!configured.has(id)) this.forgetTest(id);
    }
  }

  private forgetTest(id: string): void {
    this.tests.delete(id);
    this.testedEnvironments.delete(id);
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

  /** `peoplesoft.peoplecode.decoder`, the decoder for connections without their own. */
  private defaultDecoder() {
    return validateDecoder(this.config.get('peoplecode.decoder')).ok
      ? this.config.get('peoplecode.decoder')!
      : 'auto';
  }

  private async updateConnection(id: string, edit: ConnectionEdit): Promise<SettingsHostMessage | undefined> {
    const target = { kind: 'connection' as const, connectionId: id };
    const entry = this.find(id);
    if (!entry) {
      return { type: 'validation', target, errors: { form: 'That connection is no longer configured.' } };
    }

    const validated = validateConnectionEdit(entry.config, edit);
    if (!validated.ok) return { type: 'validation', target, errors: validated.errors };

    const error = await this.writeConnection(entry, validated.value);
    if (error) return { type: 'validation', target, errors: { form: error } };
    // Earlier test results describe the connection as it was.
    this.forgetTest(id);
    this.notify();
    return { type: 'validation', target, errors: {} };
  }

  /**
   * Sets one per-connection option, leaving the rest of the connection's
   * configuration alone. Making PeopleCode writable is confirmed first, in a
   * modal naming the database: it is the permission a save will check.
   */
  private async setConnectionOption(id: string, option: ConnectionOption, value: string): Promise<SettingsHostMessage> {
    const target = { kind: 'connectionOption' as const, connectionId: id, option };
    const refuse = (error: string): SettingsHostMessage => ({ type: 'validation', target, errors: { [option]: error } });

    const entry = this.find(id);
    if (!entry) return refuse('That connection is no longer configured.');
    if (entry.config.kind !== 'oracle') return refuse('Only database connections have PeopleCode options.');
    const validated = validateConnectionOption(option, value);
    if (!validated.ok) return refuse(validated.error);

    // The operator a save records must exist in that database: checked
    // before it is stored, and again before writes are allowed.
    const operatorFor = option === 'peoplesoftOperatorId' ? validated.value
      : option === 'peoplecodeAccess' && validated.value === 'writable' ? peoplecodeWriteSettings(entry.config).operatorId
      : undefined;
    if (operatorFor !== undefined) {
      if (operatorFor === '') return refuse('Set the PeopleSoft Operator ID first: writes are recorded as that operator (LASTUPDOPRID).');
      let exists: boolean;
      try {
        exists = await this.connections.verifyOperator(entry.config, operatorFor);
      } catch (err) {
        return refuse(`Could not check operator ${operatorFor}: ${safeErrorMessage(err)}`);
      }
      if (!exists) return refuse(`PeopleSoft operator ${operatorFor} does not exist in ${entry.config.name} (PSOPRDEFN).`);
    }

    if (option === 'peoplecodeAccess' && validated.value === 'writable' &&
        peoplecodeWriteSettings(entry.config).access !== 'writable') {
      const { name, user, connectString } = entry.config;
      const confirmed = await this.ui.confirm(
        `Allow PeopleCode writes to ${name}?`,
        `${user}@${connectString}\n\nPeopleCode saved in the editor will be written natively to this database ` +
        `as operator ${peoplecodeWriteSettings(entry.config).operatorId}: ZZ_PCODE_LAB definitions only, for now.`,
        'Allow Writes');
      if (!confirmed) {
        // Put the page's dropdown back.
        this.notify();
        return { type: 'validation', target, errors: {} };
      }
    }

    const error = await this.writeConnection(entry, { ...entry.config, [option]: validated.value });
    if (error) return { type: 'validation', target, errors: { [option]: error } };
    // Don't wait on the configuration event to show the saved option.
    this.notify();
    return { type: 'validation', target, errors: {} };
  }

  /**
   * Rewrites one connection in the scope `peoplesoft.connections` is defined
   * in. The array is replaced whole -- VS Code does not merge arrays across
   * scopes -- with only the matching entry changed. Returns an error message,
   * or undefined once written.
   */
  private async writeConnection(entry: ConnectionEntry, next: ConnectionConfig): Promise<string | undefined> {
    const inspection = this.config.inspect('connections');
    const scope = writeScopeFor(inspection);
    const current = valueAt(inspection, scope) ?? [];
    const index = current.findIndex((c) => c.name === entry.config.name && c.kind === entry.config.kind);
    if (index < 0) {
      return `"${entry.config.name}" is not defined in ${SCOPE_LABELS[scope]} settings; edit it in settings.json.`;
    }

    const all = [...current];
    all[index] = next;
    try {
      await this.config.update('connections', all, scope);
    } catch (err) {
      const message = `Could not save connection "${entry.config.name}": ${safeErrorMessage(err)}`;
      this.ui.showError(message);
      return message;
    }
    return undefined;
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
      if (info) this.testedEnvironments.set(entry.id, describeEnvironment(info, 'test'));
    } catch (err) {
      result = { status: 'failed', message: safeErrorMessage(err) };
      this.testedEnvironments.delete(entry.id);
    }
    this.tests.set(entry.id, result);
    this.notify();
  }
}

const SETTING_KEYS: readonly SettingKey[] = ['connections', 'peoplecode.decoder', ...SETTING_DESCRIPTORS.map((d) => d.key)];

function valueAt<T>(inspection: SettingInspection<T> | undefined, scope: SettingScope): T | undefined {
  switch (scope) {
    case 'workspaceFolder': return inspection?.workspaceFolderValue;
    case 'workspace': return inspection?.workspaceValue;
    case 'global': return inspection?.globalValue;
  }
}
