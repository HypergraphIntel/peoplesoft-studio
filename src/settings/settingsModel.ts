import * as path from 'node:path';
import type { ConnectionConfig } from '../workspace.js';
import type { EnvironmentInfo } from '../providers/provider.js';
import {
  compilerProfileIdForToolsRelease, UnsupportedCompilerProfileError, type CompilerProfileId
} from '../peoplecode/compilerProfile.js';
import { DEFAULT_MCP_PORT, MAX_MCP_PORT, MIN_MCP_PORT, mcpPortError } from '../mcp/configuration.js';

/*
 * The Settings panel's model: what the extension's configuration is, how a
 * value is validated, and how runtime state is described to the page.
 *
 * Deliberately free of the `vscode` module so it can be unit tested. VS Code
 * configuration (`contributes.configuration` in package.json) is the only
 * store for settings; nothing here persists anything.
 */

/** The configuration section every PeopleSoft Studio setting lives under. */
export const CONFIGURATION_SECTION = 'peoplesoft';

export type DecoderMode = 'auto' | 'strict' | 'raw';

/** Every key under `peoplesoft.*` that package.json contributes, with its type. */
export interface PeopleSoftStudioSettings {
  connections: ConnectionConfig[];
  'oracle.thickModeLibDir': string;
  'peoplecode.decoder': DecoderMode;
  'mcp.enabled': boolean;
  'mcp.port': number;
}

export type SettingKey = keyof PeopleSoftStudioSettings;

/** The settings the panel edits as single values; connections have their own editor. */
export type EditableSettingKey = Exclude<SettingKey, 'connections'>;

/** Where a value is written. Mirrors vscode.ConfigurationTarget. */
export type SettingScope = 'global' | 'workspace' | 'workspaceFolder';

/** Which scopes define a value, as vscode's WorkspaceConfiguration.inspect() reports it. */
export interface SettingInspection<T> {
  defaultValue?: T;
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

export type SettingSection = 'peoplecode' | 'mcp' | 'advanced';

export interface EnumOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

export type SettingControl =
  | { kind: 'enum'; options: EnumOption<string>[] }
  | { kind: 'text'; placeholder: string }
  | { kind: 'number'; min: number; max: number; placeholder: string }
  | { kind: 'boolean' };

export type SettingValue = PeopleSoftStudioSettings[EditableSettingKey];

export interface SettingDescriptor {
  key: EditableSettingKey;
  section: SettingSection;
  label: string;
  description: string;
  /** When a change takes effect, if not immediately. */
  appliesWhen?: string;
  control: SettingControl;
  /** package.json's default; the smoke test holds the two equal. */
  defaultValue: SettingValue;
}

const DECODER_OPTIONS: EnumOption<DecoderMode>[] = [
  { value: 'auto', label: 'Auto', description: 'Render source, marking any unmapped opcode inline.' },
  { value: 'strict', label: 'Strict', description: 'Refuse to render a program that contains an unmapped opcode.' },
  { value: 'raw', label: 'Raw', description: 'Show a byte/opcode listing instead of source. For decoder development.' }
];

/**
 * The editable settings, in display order. Labels and descriptions restate
 * package.json's for a reader; the keys must match it exactly.
 */
export const SETTING_DESCRIPTORS: readonly SettingDescriptor[] = [
  {
    key: 'peoplecode.decoder',
    section: 'peoplecode',
    label: 'PeopleCode decoder',
    description: 'How PeopleCode read from PSPCMPROG is rendered.',
    appliesWhen: 'Applies to connections opened after the change.',
    control: { kind: 'enum', options: DECODER_OPTIONS },
    defaultValue: 'auto'
  },
  {
    key: 'mcp.enabled',
    section: 'mcp',
    label: 'Enable MCP server',
    description: 'Run the local MCP server that gives AI clients read access to your connected PeopleSoft environments.',
    control: { kind: 'boolean' },
    defaultValue: true
  },
  {
    key: 'mcp.port',
    section: 'mcp',
    label: 'MCP server port',
    description: 'The port the MCP server listens on. It only ever binds to 127.0.0.1.',
    appliesWhen: 'A running server restarts on the new port. AI clients configured with the old URL must be reconfigured.',
    control: { kind: 'number', min: MIN_MCP_PORT, max: MAX_MCP_PORT, placeholder: String(DEFAULT_MCP_PORT) },
    defaultValue: DEFAULT_MCP_PORT
  },
  {
    key: 'oracle.thickModeLibDir',
    section: 'advanced',
    label: 'Oracle Instant Client directory',
    description: 'Path to Oracle Instant Client, for node-oracledb Thick mode. Leave empty to use Thin mode.',
    appliesWhen: 'Applies to connections opened after the change. Thick mode cannot be switched off without reloading the window.',
    control: { kind: 'text', placeholder: 'Empty: Thin mode' },
    defaultValue: ''
  }
];

export function descriptorFor(key: string): SettingDescriptor | undefined {
  return SETTING_DESCRIPTORS.find((d) => d.key === key);
}

export function isEditableSettingKey(key: unknown): key is EditableSettingKey {
  return typeof key === 'string' && descriptorFor(key) !== undefined;
}

/** Field-level validation errors, keyed by field name. Empty means valid. */
export type FieldErrors = Record<string, string>;

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validates and normalizes a value for an editable setting before it is written. */
export function validateSetting(key: EditableSettingKey, value: unknown): Validated<SettingValue> {
  switch (key) {
    case 'mcp.enabled':
      return typeof value === 'boolean'
        ? { ok: true, value }
        : { ok: false, error: 'Must be on or off.' };
    case 'mcp.port': {
      // The page sends what was typed; accept a numeric string as well as a number.
      const port = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
      const error = mcpPortError(port);
      return error ? { ok: false, error } : { ok: true, value: port as number };
    }
    case 'peoplecode.decoder': {
      if (typeof value !== 'string' || !DECODER_OPTIONS.some((o) => o.value === value)) {
        return { ok: false, error: `Decoder must be one of ${DECODER_OPTIONS.map((o) => o.value).join(', ')}.` };
      }
      return { ok: true, value: value as DecoderMode };
    }
    case 'oracle.thickModeLibDir': {
      if (typeof value !== 'string') return { ok: false, error: 'Directory must be text.' };
      const trimmed = value.trim();
      if (trimmed !== '' && !path.posix.isAbsolute(trimmed) && !path.win32.isAbsolute(trimmed)) {
        return { ok: false, error: 'Directory must be an absolute path, or empty for Thin mode.' };
      }
      return { ok: true, value: trimmed };
    }
  }
}

/**
 * The scope a write should go to: the most specific scope that already
 * defines the value, so a change edits what is in effect instead of being
 * shadowed by it. A value defined nowhere is written to user settings.
 */
export function writeScopeFor(inspection: SettingInspection<unknown> | undefined): SettingScope {
  if (inspection?.workspaceFolderValue !== undefined) return 'workspaceFolder';
  if (inspection?.workspaceValue !== undefined) return 'workspace';
  return 'global';
}

/** Where the effective value comes from, for display. */
export type SettingSource = SettingScope | 'default';

export function sourceOf(inspection: SettingInspection<unknown> | undefined): SettingSource {
  if (inspection?.workspaceFolderValue !== undefined) return 'workspaceFolder';
  if (inspection?.workspaceValue !== undefined) return 'workspace';
  if (inspection?.globalValue !== undefined) return 'global';
  return 'default';
}

// ---------------------------------------------------------------------------
// Connections

/** The fields of a connection the panel may change. The name is its identity and is not editable. */
export interface ConnectionEdit {
  connectString?: string;
  user?: string;
  path?: string;
}

const EDITABLE_FIELDS: Record<ConnectionConfig['kind'], (keyof ConnectionEdit)[]> = {
  oracle: ['connectString', 'user'],
  projectFile: ['path']
};

export function editableFields(kind: ConnectionConfig['kind']): readonly (keyof ConnectionEdit)[] {
  return EDITABLE_FIELDS[kind];
}

/**
 * Validates an edit against the connection it applies to, returning the
 * updated connection or per-field errors.
 *
 * The connect string is an Oracle easy-connect string (host[:port][/service]);
 * when it carries a port, the port must be a number in range.
 */
export function validateConnectionEdit(
  existing: ConnectionConfig,
  edit: ConnectionEdit
): { ok: true; value: ConnectionConfig } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const allowed = new Set<string>(EDITABLE_FIELDS[existing.kind]);
  for (const field of Object.keys(edit)) {
    if (!allowed.has(field)) errors[field] = `${field} does not apply to this connection.`;
  }

  const next: ConnectionConfig = { ...existing };

  if (existing.kind === 'oracle') {
    const connectString = (edit.connectString ?? existing.connectString ?? '').trim();
    const user = (edit.user ?? existing.user ?? '').trim();
    const connectError = validateConnectString(connectString);
    if (connectError) errors.connectString = connectError;
    if (user === '') errors.user = 'Database access id is required.';
    else if (/\s/.test(user)) errors.user = 'Database access id cannot contain spaces.';
    next.connectString = connectString;
    next.user = user;
  } else {
    const filePath = (edit.path ?? existing.path ?? '').trim();
    if (filePath === '') errors.path = 'Project file path is required.';
    next.path = filePath;
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: next };
}

export function validateConnectString(connectString: string): string | undefined {
  if (connectString === '') return 'Connect string is required.';
  if (/\s/.test(connectString)) return 'Connect string cannot contain spaces.';
  // Easy Connect: [//]host[:port][/service]. Descriptors and TNS aliases are
  // passed through untouched; only an explicit host:port is checked.
  const easy = /^(?:\/\/)?([^:/()]+):([^/]*)(?:\/.*)?$/.exec(connectString);
  if (easy) {
    const port = easy[2];
    if (!/^\d+$/.test(port)) return 'Port must be a number.';
    const n = Number(port);
    if (n < 1 || n > 65535) return 'Port must be between 1 and 65535.';
  }
  return undefined;
}

/** How much a connection can change, as the editors enforce it. */
export type AccessLevel = 'read-only' | 'partial';

export interface ConnectionAccess {
  level: AccessLevel;
  label: string;
  detail: string;
}

/**
 * Describes what a connection lets the user write.
 *
 * This restates the rules the editors enforce rather than adding one: see
 * PeopleSoftFileSystem.isWritable (PeopleCode from a database is read-only;
 * a provider without write capability is read-only throughout) and
 * OracleProvider.writeText (SQL definitions are the one text type it saves).
 */
export function describeAccess(kind: ConnectionConfig['kind']): ConnectionAccess {
  if (kind === 'projectFile') {
    return {
      level: 'read-only',
      label: 'Read-only',
      detail: 'Project exports are opened read-only.'
    };
  }
  return {
    level: 'partial',
    label: 'PeopleCode read-only',
    detail: 'PeopleCode write-back is not supported; PeopleCode opens read-only. SQL definitions can be saved.'
  };
}

// ---------------------------------------------------------------------------
// Release and compiler profile

/** What the panel knows about a connection's PeopleTools installation. */
export type EnvironmentView =
  | { status: 'not-connected' }
  | { status: 'not-applicable'; reason: string }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'available';
      /**
       * Where the release came from: the live connection, or the last Test
       * Connection of a connection that is not connected now.
       */
      source: 'connection' | 'test';
      /** The full release for display, e.g. "8.62.09". */
      release: string;
      toolsRelease: string;
      patchLevel?: number;
      profile: { ok: true; id: CompilerProfileId } | { ok: false; message: string };
    };

/** "8.62" + 9 -> "8.62.09", PeopleTools' own way of writing a patched release. */
export function formatRelease(info: EnvironmentInfo): string {
  return info.patchLevel === undefined
    ? info.toolsRelease
    : `${info.toolsRelease}.${String(info.patchLevel).padStart(2, '0')}`;
}

/**
 * Maps PSSTATUS to the compiler profile the release selects, through the
 * compiler's own release -> profile table. A release with no profile is
 * reported, not guessed.
 */
export function describeEnvironment(info: EnvironmentInfo, source: 'connection' | 'test' = 'connection'): EnvironmentView {
  let profile: { ok: true; id: CompilerProfileId } | { ok: false; message: string };
  try {
    profile = { ok: true, id: compilerProfileIdForToolsRelease(info.toolsRelease) };
  } catch (err) {
    if (!(err instanceof UnsupportedCompilerProfileError)) throw err;
    profile = { ok: false, message: err.message };
  }
  return {
    status: 'available',
    source,
    release: formatRelease(info),
    toolsRelease: info.toolsRelease,
    ...(info.patchLevel !== undefined ? { patchLevel: info.patchLevel } : {}),
    profile
  };
}

// ---------------------------------------------------------------------------
// Messages that leave the extension host

const MAX_ERROR_LENGTH = 300;

/**
 * Reduces an error to one line of text fit for the page.
 *
 * Provider errors name the connect string and user, never the password, but
 * the page gets the first line only and a bounded length regardless, so a
 * driver that echoes more than expected cannot spill a stack or a dump of
 * connection parameters into the UI.
 */
export function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const line = raw.trim().split('\n')[0] ?? '';
  return line.length > MAX_ERROR_LENGTH ? `${line.slice(0, MAX_ERROR_LENGTH - 1)}…` : line;
}
