import * as vscode from 'vscode';
import { Workspace } from '../workspace.js';
import { isPeopleCode } from '../model/definitions.js';
import { parseUri } from '../util/uri.js';

export class StatusBar implements vscode.Disposable {
  private readonly connection: vscode.StatusBarItem;
  private readonly readOnly: vscode.StatusBarItem;
  private readonly activeEditorListener: vscode.Disposable;
  private readonly workspaceListener: vscode.Disposable;

  constructor(
    private readonly workspace: Workspace,
  ) {
    this.connection = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );

    this.connection.command = 'psft.status.selectConnection';

    this.readOnly = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
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

      // Default the selected connection to the provider that owns the
      // active editor. Once explicitly selected, it remains independent
      // of the active editor.
      if (!this.workspace.selectedConnectionId) {
        this.workspace.setSelectedConnection(provider.id);
      }

      // The connection status item represents the selected/target
      // connection, not necessarily the provider that owns this editor.
      const selectedId = this.workspace.selectedConnectionId;
      const selectedProvider = selectedId
        ? this.workspace.getProvider(selectedId)
        : undefined;

      if (selectedProvider) {
        this.connection.text =
          `$(database) ${selectedProvider.displayName}`;

        this.connection.tooltip =
          `PeopleSoft connection: ${selectedProvider.displayName}`;

        this.connection.show();
      } else {
        this.connection.hide();
      }

      // Read-only state is based on the active editor's provider,
      // independently of the selected/target connection.
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

  dispose(): void {
    this.activeEditorListener.dispose();
    this.workspaceListener.dispose();
    this.connection.dispose();
    this.readOnly.dispose();
  }
}