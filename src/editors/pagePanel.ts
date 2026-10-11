import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { DefinitionKey, keyToString } from '../model/definitions.js';
import type { PageLayout } from '../model/pageLayout.js';
import type { EditedControl, EditedPageProperties } from '../providers/pageWriter.js';
import { renderPageHtml, type PagePropertyChoices } from './pageHtml.js';

export interface PagePanelOptions {
  /** The connection is Writable with an operator: the page can be edited and saved. */
  editable: boolean;
  /** The Page Properties lists. */
  choices?: PagePropertyChoices;
  /** The toolbar's opening status (a new page: what to do before its first Save). */
  status?: string;
  /** View PeopleCode: opens the page's PeopleCode (Activate). */
  viewPeopleCode?: () => Promise<void>;
  /**
   * Saves the edited controls; returns the page's new version, and the page re-read when the
   * save added controls (they then need their new PNLFLDIDs). Absent when not editable.
   */
  save?: (controls: EditedControl[], properties?: EditedPageProperties, order?: number[]) => Promise<{ version: number; layout?: PageLayout }>;
}

/** A page in App Designer's Layout view (visual, editable on a Writable connection) and Order view, one panel per page. */
export class PagePanel {
  static readonly viewType = 'psft.page';
  private static readonly open = new Map<string, vscode.WebviewPanel>();
  /**
   * Copy / Paste between the page windows of a connection (a pasted control is
   * a copy of the stored one, read from that database at Save): the copied
   * controls as the editor describes them, by connection.
   */
  private static readonly clipboards = new Map<string, unknown[]>();
  private static readonly connectionOf = new Map<vscode.WebviewPanel, string>();

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
    PagePanel.connectionOf.set(panel, connection.id);
    panel.onDidDispose(() => { PagePanel.open.delete(id); PagePanel.connectionOf.delete(panel); });

    panel.webview.onDidReceiveMessage(async (message: { type: string; items?: unknown[] }) => {
      if (message.type === 'ready') {
        await panel.webview.postMessage({ type: 'clipboard', items: PagePanel.clipboards.get(connection.id) ?? [] });
      } else if (message.type === 'copy' && Array.isArray(message.items)) {
        PagePanel.clipboards.set(connection.id, message.items);
        for (const [other, conn] of PagePanel.connectionOf) {
          if (conn === connection.id) await other.webview.postMessage({ type: 'clipboard', items: message.items });
        }
      }
    });

    if (options.viewPeopleCode) {
      const view = options.viewPeopleCode;
      panel.webview.onDidReceiveMessage(async (message: { type: string }) => { if (message.type === 'viewPeopleCode') await view(); });
    }
    if (options.editable && options.save) {
      const save = options.save;
      panel.webview.onDidReceiveMessage(async (message: { type: string; controls?: EditedControl[]; properties?: EditedPageProperties; order?: number[] }) => {
        if (message.type !== 'save' || !message.controls) return;
        try {
          const { version, layout: saved } = await save(message.controls, message.properties, message.order);
          if (saved) {
            panel.webview.html = renderPageHtml(saved, '', randomBytes(16).toString('base64'), { editable: true, status: `Saved (v${version})`, ...(options.choices ? { choices: options.choices } : {}) });
          } else {
            await panel.webview.postMessage({ type: 'saved', version });
          }
        } catch (err) {
          await panel.webview.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
    }

    panel.webview.html = renderPageHtml(layout, orderText, randomBytes(16).toString('base64'), { editable: options.editable,
      ...(options.status ? { status: options.status } : {}), ...(options.choices ? { choices: options.choices } : {}) });
  }
}
