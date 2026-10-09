import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { DefinitionKey, keyToString } from '../model/definitions.js';
import type { PageLayout } from '../model/pageLayout.js';
import type { EditedControl } from '../providers/pageWriter.js';
import { renderPageHtml } from './pageHtml.js';

export interface PagePanelOptions {
  /** The connection is Writable with an operator: the page can be edited and saved. */
  editable: boolean;
  /** Saves the edited controls; returns the page's new version. Absent when not editable. */
  save?: (controls: EditedControl[]) => Promise<{ version: number }>;
}

/** A page in App Designer's Layout view (visual, editable on a Writable connection) and Order view, one panel per page. */
export class PagePanel {
  static readonly viewType = 'psft.page';
  private static readonly open = new Map<string, vscode.WebviewPanel>();

  static show(connection: { id: string; displayName: string }, key: DefinitionKey, layout: PageLayout, orderText: string,
    options: PagePanelOptions = { editable: false }): void {
    const id = `${connection.id}\u0000${keyToString(key)}`;
    const existing = PagePanel.open.get(id);
    if (existing) {
      existing.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(PagePanel.viewType, layout.name,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, { enableScripts: true, localResourceRoots: [] });
    PagePanel.open.set(id, panel);
    panel.onDidDispose(() => PagePanel.open.delete(id));

    if (options.editable && options.save) {
      const save = options.save;
      panel.webview.onDidReceiveMessage(async (message: { type: string; controls?: EditedControl[] }) => {
        if (message.type !== 'save' || !message.controls) return;
        try {
          const { version } = await save(message.controls);
          await panel.webview.postMessage({ type: 'saved', version });
        } catch (err) {
          await panel.webview.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
    }

    panel.webview.html = renderPageHtml(layout, orderText, randomBytes(16).toString('base64'), { editable: options.editable });
  }
}
