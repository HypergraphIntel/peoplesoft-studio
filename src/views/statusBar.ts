import * as vscode from 'vscode';
import { Workspace } from '../workspace.js';
import { isPeopleCode } from '../model/definitions.js';
import { parseUri } from '../util/uri.js';

export class StatusBar implements vscode.Disposable {
  private readonly connection: vscode.StatusBarItem;
  private readonly readOnly: vscode.StatusBarItem;

  constructor(private readonly workspace: Workspace) {
    this.connection = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );

    this.readOnly = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

    this.connection.command = 'psft.status.selectConnection';

    this.update();

    //vscode.window.onDidChangeActiveTextEditor(
    //  () => this.update(),
    //  this,
    //  []
    //);

    workspace.onDidChange(
      () => this.update(),
      this,
      []
    );
  }

  private update(): void {
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

  dispose(): void {
    this.connection.dispose();
    this.readOnly.dispose();
  }
}