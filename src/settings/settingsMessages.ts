import type {
  ConnectionAccess, ConnectionEdit, EditableSettingKey, EnvironmentView,
  FieldErrors, SettingControl, SettingSection, SettingSource, SettingValue
} from './settingsModel.js';
import { editableFields, isEditableSettingKey } from './settingsModel.js';

/*
 * The contract between the extension host and the Settings webview.
 *
 * Settings manages and inspects connections; it does not choose the working
 * one. Nothing here selects, connects or disconnects: that belongs to the
 * Connections view and the status bar, and the page only displays the result.
 *
 * The page receives a complete SettingsState and renders it; it never derives
 * state of its own. Every message the page sends is checked by
 * parseWebviewMessage before it is acted on: the page is a separate process
 * and its messages are input, not trusted calls.
 */

// ---------------------------------------------------------------------------
// Host -> webview

export interface SettingView {
  key: EditableSettingKey;
  section: SettingSection;
  label: string;
  description: string;
  appliesWhen?: string;
  control: SettingControl;
  value: SettingValue;
  /** Where the effective value is defined; edits are written there. */
  source: SettingSource;
}

export type ConnectionTestView =
  | { status: 'testing' }
  | { status: 'succeeded'; release?: string }
  | { status: 'failed'; message: string };

/**
 * A configured connection, as the page may see it. Built field by field from
 * the configuration: there is no password field to leak, and nothing from
 * SecretStorage is ever read into it.
 */
export interface ConnectionView {
  id: string;
  name: string;
  kind: 'oracle' | 'projectFile';
  kindLabel: string;
  connectString?: string;
  user?: string;
  path?: string;
  connected: boolean;
  /**
   * Whether this is the workspace's selectedConnectionId. Informational: the
   * target is chosen in the Connections view or the status bar, never here.
   */
  selected: boolean;
  access: ConnectionAccess;
  environment: EnvironmentView;
  test?: ConnectionTestView;
  editableFields: readonly (keyof ConnectionEdit)[];
}

export interface McpView {
  status: 'disabled' | 'stopped' | 'starting' | 'running' | 'error';
  url: string;
  error?: string;
}

export interface SettingsState {
  connections: ConnectionView[];
  /** The workspace's selectedConnectionId, which may name a connection no longer configured. */
  selectedConnectionId?: string;
  /** Where `peoplesoft.connections` is defined; connection edits are written there. */
  connectionsSource: SettingSource;
  settings: SettingView[];
  mcp?: McpView;
}

export type ValidationTarget =
  | { kind: 'setting'; key: EditableSettingKey }
  | { kind: 'connection'; connectionId: string };

export type SettingsHostMessage =
  | { type: 'state'; state: SettingsState }
  /** Errors for one form; an empty `errors` clears the form's previous errors. */
  | { type: 'validation'; target: ValidationTarget; errors: FieldErrors };

// ---------------------------------------------------------------------------
// Webview -> host

export type McpAction = 'start' | 'stop' | 'restart' | 'configureClient' | 'copyUrl';
const MCP_ACTIONS: readonly McpAction[] = ['start', 'stop', 'restart', 'configureClient', 'copyUrl'];

export type SettingsWebviewMessage =
  | { type: 'ready' }
  | { type: 'updateSetting'; key: EditableSettingKey; value: unknown }
  | { type: 'testConnection'; connectionId: string }
  | { type: 'updateConnection'; connectionId: string; edit: ConnectionEdit }
  | { type: 'addConnection' }
  | { type: 'removeConnection'; connectionId: string }
  | { type: 'openNativeSettings' }
  | { type: 'mcp'; action: McpAction };

const CONNECTION_FIELDS: ReadonlySet<string> = new Set([
  ...editableFields('oracle'), ...editableFields('projectFile')
]);

/** Narrows an untrusted message from the page to the contract, or undefined. */
export function parseWebviewMessage(raw: unknown): SettingsWebviewMessage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  const connectionId = typeof m.connectionId === 'string' && m.connectionId !== ''
    ? m.connectionId : undefined;

  switch (m.type) {
    case 'ready':
    case 'addConnection':
    case 'openNativeSettings':
      return { type: m.type };

    case 'updateSetting':
      return isEditableSettingKey(m.key) && 'value' in m
        ? { type: 'updateSetting', key: m.key, value: m.value }
        : undefined;

    case 'testConnection':
    case 'removeConnection':
      return connectionId ? { type: m.type, connectionId } : undefined;

    case 'updateConnection': {
      if (!connectionId || typeof m.edit !== 'object' || m.edit === null) return undefined;
      const edit: ConnectionEdit = {};
      for (const [field, value] of Object.entries(m.edit as Record<string, unknown>)) {
        if (!CONNECTION_FIELDS.has(field) || typeof value !== 'string') return undefined;
        edit[field as keyof ConnectionEdit] = value;
      }
      return { type: 'updateConnection', connectionId, edit };
    }

    case 'mcp':
      return MCP_ACTIONS.includes(m.action as McpAction)
        ? { type: 'mcp', action: m.action as McpAction }
        : undefined;

    default:
      return undefined;
  }
}
