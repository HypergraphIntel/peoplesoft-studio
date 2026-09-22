import * as vscode from 'vscode';
import { Workspace } from '../workspace.js';
import { isPeopleCode } from '../model/definitions.js';
import { parseUri } from '../util/uri.js';

export class StatusBar implements vscode.Disposable {
  private readonly connection: vscode.StatusBarItem;
  private readonly readOnly: vscode.StatusBarItem;
  private readonly activeEditorListener: vscode.Disposable;
  private readonly workspaceListener: vscode.Disposable;
  private _selectedConnectionId?: string;

  
  constructor(
    private readonly workspace: Workspace,
    // private readonly selectConnection: () => Promise<void>,
  ) {
    

    this.connection = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );

    this.connection.command = 'psft.status.selectConnection';

    this.readOnly = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );

    this.activeEditorListener =
      vscode.window.onDidChangeActiveTextEditor(
        () => this.update(),
        this
      );

    this.workspaceListener =
      workspace.onDidChange(
        () => this.update(),
        this
    );

    this.update();

    this.connection.command = 'psft.status.selectConnection';

    workspace.onDidChange(
      () => this.update(),
      this,
      []
    );
  }

  public update(): void {
    const editor = vscode.window.activeTextEditor;

    if (!editor || editor.document.uri.scheme !== 'psft') {
      this.connection.hide();
      this.readOnly.hide();
      return;
    }

    try {
      const { handle, key } = parseUri(editor.document.uri);
      const provider = this.workspace.getProviderByHandle(handle);

      if (!provider) {
        this.connection.hide();
        this.readOnly.hide();
        return;
      }

      this.connection.text = `$(database) ${provider.displayName}`;
      this.connection.tooltip = `PeopleSoft connection: ${provider.displayName}`;
      this.connection.show();

      if (isPeopleCode(key.type) && provider.id.startsWith('oracle:')) {
        this.readOnly.text = '$(lock-small) Read-Only';
        this.readOnly.tooltip =
          'PeopleCode write-back is not currently supported.';
        this.readOnly.show();
      } else {
        this.readOnly.hide();
      }
    } catch {
      this.connection.hide();
      this.readOnly.hide();
    }
  }

  get selectedConnectionId(): string | undefined {
    return this._selectedConnectionId;
  }

  setSelectedConnection(id: string): void {
      this._selectedConnectionId = id;
     // this._onDidChange.fire();
  }
  
  dispose(): void {
    this.activeEditorListener.dispose();
    this.workspaceListener.dispose();
    this.connection.dispose();
    this.readOnly.dispose();
  }
}