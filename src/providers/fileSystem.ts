import * as vscode from 'vscode';
import { Workspace } from '../workspace.js';
import { parseUri, SCHEME } from '../util/uri.js';
import { isPeopleCode } from '../model/definitions.js';

/**
 * Exposes PeopleSoft definitions as a virtual file system.
 *
 * Registering as an FS provider rather than a text-document content provider is
 * what makes definitions editable: content providers are read-only by design.
 * Text is cached per URI so that a dirty editor is not clobbered by a
 * background stat, and so a save can be diffed against what was read.
 */
export class PeopleSoftFileSystem implements vscode.FileSystemProvider {
  private readonly cache = new Map<string, { content: Uint8Array; mtime: number }>();
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  constructor(private readonly workspace: Workspace) {}

  static register(workspace: Workspace): vscode.Disposable {
    const fs = new PeopleSoftFileSystem(workspace);
    return vscode.workspace.registerFileSystemProvider(SCHEME, fs, {
      isCaseSensitive: false,
      // Definitions are not files on disk; nothing else can change them
      // underneath us within a session.
      isReadonly: false
    });
  }

  watch(): vscode.Disposable {
    // Definitions change only through this extension or App Designer; there is
    // no cheap change feed to subscribe to, so watching is a no-op.
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const cached = this.cache.get(uri.toString());
    const content = cached?.content ?? (await this.load(uri));
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: cached?.mtime ?? Date.now(),
      size: content.byteLength,
      permissions: (await this.isWritable(uri)) ? undefined : vscode.FilePermission.Readonly
    };
  }

  private async isWritable(uri: vscode.Uri): Promise<boolean> {
    const { connectionId, key } = parseUri(uri);
    const provider = this.workspace.getProvider(connectionId);
    if (!provider?.capabilities.write) return false;
    // PeopleCode cannot be written back to the database yet; marking the
    // document read-only says so before the user types into it, rather than
    // failing at save time with unsaved work on screen.
    if (isPeopleCode(key.type) && connectionId.startsWith('oracle:')) return false;
    return true;
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const cached = this.cache.get(uri.toString());
    if (cached) return cached.content;
    return this.load(uri);
  }

  private async load(uri: vscode.Uri): Promise<Uint8Array> {
    const { connectionId, key } = parseUri(uri);
    const provider = await this.workspace.require(connectionId);
    const text = await provider.readText(key);
    const content = Buffer.from(text, 'utf8');
    this.cache.set(uri.toString(), { content, mtime: Date.now() });
    return content;
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const { connectionId, key } = parseUri(uri);
    const provider = await this.workspace.require(connectionId);
    await provider.writeText(key, Buffer.from(content).toString('utf8'));
    this.cache.set(uri.toString(), { content, mtime: Date.now() });
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  /** Invalidates a cached definition so the next read hits the environment. */
  invalidate(uri: vscode.Uri): void {
    this.cache.delete(uri.toString());
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  readDirectory(): [string, vscode.FileType][] {
    // Browsing happens through the tree views, which understand definition
    // types; the flat URI space has no directories to enumerate.
    return [];
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('PeopleSoft definitions have no directories.');
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(
      'Deleting definitions is not supported. Use App Designer, which also removes dependent objects.');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions(
      'Renaming a definition rewrites every reference to it; use App Designer.');
  }
}
