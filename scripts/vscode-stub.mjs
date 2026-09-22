/**
 * Enough of the `vscode` module to activate the bundled extension in plain Node.
 *
 * This is not a simulation of VS Code. It exists so `npm run smoke` can catch
 * the failures that otherwise only appear after packaging and installing: a
 * command that throws at registration, a contribution declared in package.json
 * with no matching registration, a bad import in the bundle. Anything needing
 * real editor behaviour belongs in a manual test pass instead.
 */

import { URI } from 'vscode-uri';

export function createStub() {
  const registered = {
    commands: new Set(),
    treeViews: new Set(),
    fileSystems: new Set(),
    customEditors: new Set(),
    disposables: []
  };

  class Disposable {
    constructor(fn) { this._fn = fn; }
    dispose() { this._fn?.(); }
    static from(...items) { return new Disposable(() => items.forEach((i) => i.dispose?.())); }
  }

  class EventEmitter {
    constructor() { this._listeners = []; }
    get event() {
      return (listener, _this, disposables) => {
        this._listeners.push(listener);
        const d = new Disposable(() => {
          const i = this._listeners.indexOf(listener);
          if (i >= 0) this._listeners.splice(i, 1);
        });
        disposables?.push(d);
        return d;
      };
    }
    fire(value) { for (const l of [...this._listeners]) l(value); }
    dispose() { this._listeners.length = 0; }
  }

  // The real implementation VS Code's `vscode.Uri` is built on, not a stand-in.
  // A hand-written parser round-trips URIs that this one mangles -- lowercasing
  // the authority, not re-encoding its slashes -- which once let a broken URI
  // encoding pass the smoke test and fail in the editor.
  const Uri = URI;

  class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }

  class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } }
  class ThemeColor { constructor(id) { this.id = id; } }
  class MarkdownString { constructor(value) { this.value = value; } }

  class CompletionItem {
    constructor(label, kind) {
      this.label = label;
      this.kind = kind;
    }
  }
  class SnippetString {
    constructor(value) {
      this.value = value;
    }
  }

  class Hover {
    constructor(contents, range) {
      this.contents = contents;
      this.range = range;
    }
  }

  class DocumentSymbol {
    constructor(name, detail, kind, range, selectionRange) {
      this.name = name;
      this.detail = detail;
      this.kind = kind;
      this.range = range;
      this.selectionRange = selectionRange;
      this.children = [];
    }
  }

  class Range {
    constructor(startLine, startChar, endLine, endChar) {
      this.start = { line: startLine, character: startChar };
      this.end = { line: endLine, character: endChar };
    }
  }

  class FileSystemError extends Error {
    static NoPermissions(m) { return new FileSystemError(m); }
    static FileNotFound(m) { return new FileSystemError(m); }
  }

  // Settings live in memory so `update` round-trips within a smoke run.
  const settings = new Map();

  const vscode = {
    Disposable, EventEmitter, Uri, TreeItem, ThemeIcon, ThemeColor,
    MarkdownString, FileSystemError, CompletionItem, SnippetString, Hover,
    DocumentSymbol, Range,

    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
    FilePermission: { Readonly: 1 },
    FileChangeType: { Changed: 1, Created: 2, Deleted: 3 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },

    CompletionItemKind: {
      Text: 0,
      Method: 1,
      Function: 2,
      Constructor: 3,
      Field: 4,
      Variable: 5,
      Class: 6,
      Interface: 7,
      Module: 8,
      Property: 9,
      Unit: 10,
      Value: 11,
      Enum: 12,
      Keyword: 13,
      Snippet: 14,
      Color: 15,
      File: 16,
      Reference: 17,
      Folder: 18,
      EnumMember: 19,
      Constant: 20,
      Struct: 21,
      Event: 22,
      Operator: 23,
      TypeParameter: 24
    },
    SymbolKind: {
      File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5,
      Property: 6, Field: 7, Constructor: 8, Enum: 9, Interface: 10,
      Function: 11, Variable: 12, Constant: 13, String: 14, Number: 15,
      Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20,
      EnumMember: 21, Struct: 22, Event: 23, Operator: 24, TypeParameter: 25
    },
    commands: {
      registerCommand(id, handler) {
        if (registered.commands.has(id)) {
          throw new Error(`Command registered twice: ${id}`);
        }
        registered.commands.add(id);
        vscode._handlers.set(id, handler);
        return new Disposable(() => registered.commands.delete(id));
      },
      executeCommand(id, ...args) {
        const h = vscode._handlers.get(id);
        if (!h) throw new Error(`No such command: ${id}`);
        return h(...args);
      }
    },
    _handlers: new Map(),

    window: {
      registerTreeDataProvider(id, provider) {
        registered.treeViews.add(id);
        vscode._trees.set(id, provider);
        return new Disposable(() => registered.treeViews.delete(id));
      },
      registerCustomEditorProvider(viewType) {
        registered.customEditors.add(viewType);
        return new Disposable(() => registered.customEditors.delete(viewType));
      },
      showErrorMessage: async (m) => { vscode._messages.push(['error', m]); },
      showWarningMessage: async (m) => { vscode._messages.push(['warn', m]); },
      showInformationMessage: async (m) => { vscode._messages.push(['info', m]); },
      showInputBox: async () => undefined,
      showQuickPick: async () => undefined,
      showOpenDialog: async () => undefined,
      withProgress: async (_opts, task) => task({ report() {} }, { isCancellationRequested: false }),
      showTextDocument: async (doc) => ({ document: doc })
    },
    _trees: new Map(),
    _messages: [],

    workspace: {
      getConfiguration(section) {
        return {
          get: (key, fallback) => settings.get(`${section}.${key}`) ?? fallback,
          update: async (key, value) => { settings.set(`${section}.${key}`, value); }
        };
      },
      registerFileSystemProvider(scheme, provider) {
        registered.fileSystems.add(scheme);
        vscode._fs.set(scheme, provider);
        return new Disposable(() => registered.fileSystems.delete(scheme));
      },
      onDidChangeConfiguration: () => new Disposable(() => {}),
      openTextDocument: async (uri) => ({ uri })
    },
    languages: {
      registerCompletionItemProvider(_selector, _provider, ..._triggerCharacters) {
        return new Disposable(() => {});
      },
      registerHoverProvider(_selector, _provider) {
        return new Disposable(() => {});
      },
      registerDocumentSymbolProvider(_selector, _provider) {
        return new Disposable(() => {});
      }
    },
    _fs: new Map()
  };

  return { vscode, registered, settings };
}
