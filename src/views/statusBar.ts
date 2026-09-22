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
      const editorProvider = this.workspace.getProviderByHandle(handle);

      if (!editorProvider) {
        this.connection.hide();
        this.readOnly.hide();
        return;
      }

      // If no target has been explicitly selected yet, default to the
      // connection that owns the active PeopleSoft editor.
      if (!this.workspace.selectedConnectionId) {
        this.workspace.setSelectedConnection(editorProvider.id);
      }

      // TARGET CONNECTION
      // This is independent of the connection that owns the active editor.
      const targetId = this.workspace.selectedConnectionId;
      const targetProvider = targetId
        ? this.workspace.getProvider(targetId)
        : undefined;

      if (targetProvider) {
        this.connection.text = `$(database) ${targetProvider.displayName}`;
        this.connection.tooltip =
          `Target PeopleSoft connection: ${targetProvider.displayName}`;
        this.connection.show();
      } else {
        this.connection.hide();
      }

      // ACTIVE EDITOR STATE
      // Read-only describes the document being edited, not the target.
      if (
        isPeopleCode(key.type) &&
        editorProvider.id.startsWith('oracle:')
      ) {
        this.readOnly.text = '$(lock-small) Read-Only';
        this.readOnly.tooltip =
          `PeopleCode from ${editorProvider.displayName} is read-only. ` +
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