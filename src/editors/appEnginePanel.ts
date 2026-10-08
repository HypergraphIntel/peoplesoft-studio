import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { DefinitionKey, keyToString } from '../model/definitions.js';
import type { AeSection, AeStep, AeVariant, AppEngineProgram } from '../model/appEngine.js';
import { renderAppEngineHtml } from './appEngineHtml.js';

/** An App Engine program in App Designer's Definition and Program Flow views, read-only, one panel per program. */
export class AppEnginePanel {
  static readonly viewType = 'psft.appEngine';
  private static readonly open = new Map<string, vscode.WebviewPanel>();

  static show(connection: { id: string; displayName: string }, key: DefinitionKey, program: AppEngineProgram,
    peopleCode: (s: AeSection, v: AeVariant, st: AeStep) => string | undefined): void {
    const id = `${connection.id}\u0000${keyToString(key)}`;
    let panel = AppEnginePanel.open.get(id);
    if (panel) {
      panel.reveal();
    } else {
      const title = key.parts[1] ? `${program.name}.${key.parts[1]}` : program.name;
      panel = vscode.window.createWebviewPanel(AppEnginePanel.viewType, title,
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, { enableScripts: true, localResourceRoots: [] });
      AppEnginePanel.open.set(id, panel);
      panel.onDidDispose(() => AppEnginePanel.open.delete(id));
    }
    panel.webview.html = renderAppEngineHtml(program, connection.displayName, randomBytes(16).toString('base64'), peopleCode);
  }
}
