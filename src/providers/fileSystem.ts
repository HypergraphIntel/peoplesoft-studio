import * as vscode from 'vscode';
import { Workspace } from '../workspace.js';
import { parseUri, SCHEME } from '../util/uri.js';
import { DefinitionKey, displayName, isPeopleCode } from '../model/definitions.js';
import { OracleProvider } from './oracle.js';
import { SaveRefusedError } from '../peoplecode/writeback/savePlan.js';
import type { PeopleCodeSaveResult } from './peopleCodeWriter.js';

/** Where a PeopleCode save's report (with the rows it replaced) is kept. */
export type SaveReportSink = (key: DefinitionKey, connection: string, result: PeopleCodeSaveResult) => Promise<void>;

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
  /** The concurrency token of each writable PeopleCode document, taken when it was read. */
  private readonly fingerprints = new Map<string, string>();
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  constructor(private readonly workspace: Workspace, private readonly saveReports?: SaveReportSink) {}

  static register(workspace: Workspace, saveReports?: SaveReportSink): vscode.Disposable {
    const fs = new PeopleSoftFileSystem(workspace, saveReports);
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
    const { handle, key } = parseUri(uri);
    const provider = this.workspace.getProviderByHandle(handle);
    if (!provider?.capabilities.write) return false;
    // PeopleCode from a database is writable only where the native writer
    // may save it (a writable connection, a scratch definition, a supported
    // program type); elsewhere marking the document read-only says so before
    // the user types into it, rather than failing at save time.
    if (isPeopleCode(key.type) && provider.id.startsWith('oracle:')) {
      return this.workspace.isPeopleCodeWritable(provider.id, key);
    }
    return true;
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const cached = this.cache.get(uri.toString());
    if (cached) return cached.content;
    return this.load(uri);
  }

  private async load(uri: vscode.Uri): Promise<Uint8Array> {
    const { handle, key } = parseUri(uri);
    const provider = await this.workspace.requireByHandle(handle);
    let text: string | undefined;
    // Editable PeopleCode opens as its stored source (PSPCMTXT, as App
    // Designer shows it), with the token a save must present.
    if (provider instanceof OracleProvider && isPeopleCode(key.type) && this.workspace.isPeopleCodeWritable(provider.id, key)) {
      const edit = await provider.readPeopleCodeForEdit(key);
      if (edit) {
        text = edit.text;
        this.fingerprints.set(uri.toString(), edit.fingerprint);
      }
    }
    text ??= await provider.readText(key);
    const content = Buffer.from(text, 'utf8');
    this.cache.set(uri.toString(), { content, mtime: Date.now() });
    return content;
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const { handle, key } = parseUri(uri);
    const provider = await this.workspace.requireByHandle(handle);
    if (provider instanceof OracleProvider && isPeopleCode(key.type)) {
      await this.savePeopleCode(uri, provider, key, Buffer.from(content).toString('utf8'));
      return;
    }
    await provider.writeText(key, Buffer.from(content).toString('utf8'));
    this.cache.set(uri.toString(), { content, mtime: Date.now() });
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  /**
   * A native PeopleCode save (peopleCodeWriter.ts). Every refusal reaches
   * the user as the save's error, with the writer's reason; nothing is
   * written unless the whole transaction verifies.
   */
  private async savePeopleCode(uri: vscode.Uri, provider: OracleProvider, key: DefinitionKey, source: string): Promise<void> {
    const refuse = (message: string): never => { throw vscode.FileSystemError.NoPermissions(message); };
    const config = this.workspace.configFor(provider.id);
    if (!config || !this.workspace.isPeopleCodeWritable(provider.id, key)) {
      refuse(`${displayName(key)} is read-only on ${provider.displayName}.`);
    }
    if (config!.peoplecodeSaveMode === 'save-only') {
      refuse('Save mode is "Save only", which is not available: App Designer compiles before every save and never stores ' +
        'uncompiled source. Set Save mode to "Compile and save" in PeopleSoft Studio Settings.');
    }
    const operatorId = config!.peoplesoftOperatorId?.trim();
    if (!operatorId) refuse(`Set the PeopleSoft Operator ID for ${provider.displayName} in PeopleSoft Studio Settings before saving PeopleCode.`);
    const openedFingerprint = this.fingerprints.get(uri.toString());
    if (!openedFingerprint) refuse('This PeopleCode was not opened for editing. Close and reopen it, then reapply your edit.');

    let result: PeopleCodeSaveResult;
    try {
      result = await provider.savePeopleCode(key, { source, openedFingerprint: openedFingerprint!, operatorId: operatorId! });
    } catch (error) {
      if (error instanceof SaveRefusedError) refuse(error.message);
      throw vscode.FileSystemError.Unavailable(`Saving ${displayName(key)} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.saveReports?.(key, provider.id, result!).catch((error) =>
      console.error('PeopleSoft Studio: could not write the save report:', error));

    // What is stored now: the source as saved (LF, final newline), or nothing.
    this.fingerprints.set(uri.toString(), result!.fingerprint);
    this.cache.set(uri.toString(), { content: Buffer.from(result!.storedSource, 'utf8'), mtime: Date.now() });
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  /** Invalidates a cached definition so the next read hits the environment. */
  invalidate(uri: vscode.Uri): void {
    this.cache.delete(uri.toString());
    this.fingerprints.delete(uri.toString());
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
