import * as vscode from 'vscode';
import { DefinitionProvider } from './providers/provider.js';
import { OracleProvider } from './providers/oracle.js';
import { ProjectFileProvider } from './providers/projectFile.js';

export interface ConnectionConfig {
  name: string;
  kind: 'oracle' | 'projectFile';
  connectString?: string;
  user?: string;
  path?: string;
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

  constructor(private readonly secrets: vscode.SecretStorage) {}

  get connections(): ConnectionConfig[] {
    return vscode.workspace.getConfiguration('peoplesoft').get<ConnectionConfig[]>('connections', []);
  }

  getProvider(id: string): DefinitionProvider | undefined {
    return this.providers.get(id);
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
    await provider.connect();
    this.providers.set(id, provider);
    this._onDidChange.fire();
    return provider;
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
      decoderMode: settings.get<'auto' | 'strict' | 'raw'>('peoplecode.decoder', 'auto')
    });
  }

  async disconnect(id: string): Promise<void> {
    const provider = this.providers.get(id);
    if (!provider) return;
    await provider.dispose();
    this.providers.delete(id);
    this._onDidChange.fire();
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

export function providerId(config: ConnectionConfig): string {
  return config.kind === 'projectFile' ? `project:${config.path}` : `oracle:${config.name}`;
}
