import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { DefinitionKey, keyToString } from '../model/definitions.js';
import type { PageLayout } from '../model/pageLayout.js';
import { renderPageHtml } from './pageHtml.js';

/** A page in App Designer's Layout view (visual) and Order view (text), read-only, one panel per page. */
export class PagePanel {
  static readonly viewType = 'psft.page';
  private static readonly open = new Map<string, vscode.WebviewPanel>();

  static show(connection: { id: string; displayName: string }, key: DefinitionKey, layout: PageLayout, orderText: string): void {
    const id = `${connection.id}\u0000${keyToString(key)}`;
    let panel = PagePanel.open.get(id);
    if (panel) {
      panel.reveal();
    } else {
      panel = vscode.window.createWebviewPanel(PagePanel.viewType, layout.name,
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, { enableScripts: true, localResourceRoots: [] });
      PagePanel.open.set(id, panel);
      panel.onDidDispose(() => PagePanel.open.delete(id));
    }
    panel.webview.html = renderPageHtml(layout, orderText, randomBytes(16).toString('base64'));
  }
}
