import * as vscode from 'vscode';
import { DefinitionProvider, EnvironmentInfo } from './providers/provider.js';
import { OracleProvider } from './providers/oracle.js';
import { ProjectFileProvider } from './providers/projectFile.js';
import { connectionHandle } from './util/handle.js';
import { DefinitionKey, DefinitionType } from './model/definitions.js';
import { isScratchName } from './peoplecode/corpus/labSafety.js';

export interface ConnectionConfig {
  name: string;
  kind: 'oracle' | 'projectFile';
  connectString?: string;
  user?: string;
  path?: string;
  /**
   * How this connection renders PeopleCode from PSPCMPROG. Absent: the
   * `peoplesoft.peoplecode.decoder` default.
   */
  decoder?: 'auto' | 'strict' | 'raw';
  /**
   * Whether PeopleCode may be saved back to this database. Absent:
   * read-only. Nothing saves PeopleCode yet (docs/PEOPLECODE_WRITEBACK.md);
   * this is the per-connection authorization the save path will require.
   */
  peoplecodeAccess?: 'read-only' | 'writable';
  /** What a PeopleCode save writes. Absent: compile-and-save. */
  peoplecodeSaveMode?: 'save-only' | 'compile-and-save';
  /**
   * The PeopleSoft operator (PSOPRDEFN.OPRID) PeopleCode saves are recorded
   * as (PSPCMPROG.LASTUPDOPRID). Required for a writable connection: the
   * database access id is not a PeopleSoft operator.
   */
  peoplesoftOperatorId?: string;
}

/**
 * Owns the set of configured environments and their live providers.
 *
 * Connections are declared in settings; passwords live in the OS secret store
 * via SecretStorage and are never written to settings.json, which is routinely
 * committed to source control.
 */
export class Workspace implements vscode.Disposable {
  private readonly providers = new Map<string, DefinitionProvider>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private _selectedConnectionId: string | undefined;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  get connections(): ConnectionConfig[] {
    return vscode.workspace.getConfiguration('peoplesoft').get<ConnectionConfig[]>('connections', []);
  }

  get selectedConnectionId(): string | undefined {
    return this._selectedConnectionId;
  }

  setSelectedConnection(id: string): void {
    this._selectedConnectionId = id;
    this._onDidChange.fire();
  }

  getProvider(id: string): DefinitionProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * The connected provider whose id hashes to `handle`, if any.
   *
   * URIs carry a hash rather than the id itself; see util/uri.ts.
   */
  getProviderByHandle(handle: string): DefinitionProvider | undefined {
    for (const [id, provider] of this.providers) {
      if (connectionHandle(id) === handle) return provider;
    }
    return undefined;
  }

  /** Resolves a provider for a URI handle, connecting on demand. */
  async requireByHandle(handle: string): Promise<DefinitionProvider> {
    const existing = this.getProviderByHandle(handle);
    if (existing?.isConnected) return existing;

    const config = this.connections.find((c) => connectionHandle(providerId(c)) === handle);
    if (!config) {
      throw new Error(
        'This definition belongs to a PeopleSoft connection that is no longer ' +
        'configured. Reconnect the environment, or close this editor.');
    }
    return this.connect(config);
  }

  get activeProviders(): DefinitionProvider[] {
    return [...this.providers.values()];
  }

  /** Resolves a provider for a URI authority, connecting on demand. */
  async require(id: string): Promise<DefinitionProvider> {
    const existing = this.providers.get(id);
    if (existing?.isConnected) return existing;

    const config = this.connections.find((c) => providerId(c) === id);
    if (!config) throw new Error(`No PeopleSoft connection is configured with id ${id}.`);
    return this.connect(config);
  }

  async connect(config: ConnectionConfig): Promise<DefinitionProvider> {
    const id = providerId(config);
    const existing = this.providers.get(id);
    if (existing?.isConnected) return existing;

    const provider = await this.create(config);
    try {
      await provider.connect();
    } catch (err) {
      // A password rejected by the database must not stay in the secret store,
      // or every later attempt reuses it and the user is never asked again.
      if (config.kind === 'oracle' && isCredentialFailure(err)) {
        await this.forgetPassword(config.name);
      }
      throw err;
    }
    // One connection is active at a time: activating this one deactivates
    // the rest, only now that it has connected -- a failed connect leaves the
    // active one alone. It becomes the target.
    for (const [otherId, other] of [...this.providers]) {
      if (otherId === id) continue;
      this.providers.delete(otherId);
      await other.dispose().catch((error) =>
        console.warn(`PeopleSoft Studio: disconnecting ${other.displayName} failed:`, error));
    }
    this.providers.set(id, provider);
    this._selectedConnectionId = id;
    this._onDidChange.fire();
    return provider;
  }

  /**
   * Proves a connection works without making it live: a throwaway provider
   * connects (which probes the database), reads PSSTATUS where there is one,
   * and is disposed. The live provider, if any, is left alone.
   */
  async testConnection(config: ConnectionConfig): Promise<EnvironmentInfo | undefined> {
    const provider = await this.create(config);
    try {
      await provider.connect();
      return await provider.readEnvironment?.();
    } catch (err) {
      // Same rule as connect(): a rejected password must not be reused.
      if (config.kind === 'oracle' && isCredentialFailure(err)) {
        await this.forgetPassword(config.name);
      }
      throw err;
    } finally {
      await provider.dispose();
    }
  }

  private async create(config: ConnectionConfig): Promise<DefinitionProvider> {
    if (config.kind === 'projectFile') {
      if (!config.path) throw new Error(`Connection "${config.name}" has no project file path.`);
      return new ProjectFileProvider(config.path, config.name);
    }

    if (!config.connectString || !config.user) {
      throw new Error(`Connection "${config.name}" is missing a connect string or user.`);
    }

    const secretKey = `peoplesoft.password.${config.name}`;
    let password = await this.secrets.get(secretKey);
    if (password === undefined) {
      const entered = await vscode.window.showInputBox({
        title: `Password for ${config.user}@${config.connectString}`,
        password: true,
        ignoreFocusOut: true
      });
      if (entered === undefined) throw new Error('Connection cancelled.');
      password = entered;
      await this.secrets.store(secretKey, password);
    }

    const settings = vscode.workspace.getConfiguration('peoplesoft');
    return new OracleProvider({
      name: config.name,
      connectString: config.connectString,
      user: config.user,
      password,
      thickModeLibDir: settings.get<string>('oracle.thickModeLibDir') || undefined,
      decoderMode: config.decoder ?? settings.get<'auto' | 'strict' | 'raw'>('peoplecode.decoder', 'auto')
    });
  }

  async disconnect(id: string): Promise<void> {
    const provider = this.providers.get(id);
    if (!provider) return;
    await provider.dispose();
    this.providers.delete(id);
    // A disconnected target is no target: fall back to a connection that is
    // still up, or to none.
    if (this._selectedConnectionId === id) {
      this._selectedConnectionId =
        this.activeProviders.find((p) => p.isConnected)?.id;
    }
    this._onDidChange.fire();
  }


  /**
   * Whether PeopleCode under `key` may be edited and saved on this
   * connection: an Oracle connection set to writable, a scratch definition,
   * and a program type the native writer supports (Record Field PeopleCode,
   * Application Class). Everything else stays read-only.
   */
  isPeopleCodeWritable(id: string, key: DefinitionKey): boolean {
    const config = this.configFor(id);
    return config?.kind === 'oracle' &&
      config.peoplecodeAccess === 'writable' &&
      (key.type === DefinitionType.RecordPeopleCode || key.type === DefinitionType.ApplicationClassPeopleCode) &&
      isScratchName(key.parts[0]);
  }

  /** The configured connection behind a provider id. */
  configFor(id: string): ConnectionConfig | undefined {
    return this.connections.find((c) => providerId(c) === id);
  }

  /**
   * Whether a PeopleSoft operator exists in the connection's database
   * (PSOPRDEFN), read-only. Uses the live connection when there is one,
   * otherwise a throwaway one (which may ask for the password).
   */
  async verifyOperator(config: ConnectionConfig, operatorId: string): Promise<boolean> {
    const live = this.providers.get(providerId(config));
    if (live?.isConnected && live instanceof OracleProvider) return live.operatorExists(operatorId);
    const provider = await this.create(config);
    try {
      await provider.connect();
      if (!(provider instanceof OracleProvider)) return false;
      return await provider.operatorExists(operatorId);
    } finally {
      await provider.dispose();
    }
  }

  async forgetPassword(name: string): Promise<void> {
    await this.secrets.delete(`peoplesoft.password.${name}`);
  }

  dispose(): void {
    for (const p of this.providers.values()) void p.dispose();
    this.providers.clear();
    this._onDidChange.dispose();
  }

}

/** ORA-01017 is Oracle's "invalid username/password"; NJS-506 wraps it in Thin mode. */
function isCredentialFailure(err: unknown): boolean {
  const message = (err as { message?: string })?.message ?? '';
  const cause = ((err as { cause?: { message?: string } })?.cause?.message) ?? '';
  return /ORA-01017|invalid username\/password|ORA-28000|account is locked/i
    .test(`${message} ${cause}`);
}

export function providerId(config: ConnectionConfig): string {
  return config.kind === 'projectFile' ? `project:${config.path}` : `oracle:${config.name}`;
}
