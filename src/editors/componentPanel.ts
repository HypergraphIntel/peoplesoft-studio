import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { DefinitionKey, keyToString } from '../model/definitions.js';
import type { ComponentDefinition } from '../model/componentDefinition.js';
import type { ComponentItemEdit, ComponentPropertyEdits } from '../providers/componentWriter.js';
import { gridRow, renderComponentHtml } from './componentHtml.js';

export interface ComponentPanelOptions {
  /** View Definition on a page row: opens the page. */
  openPage: (page: string) => Promise<void>;
  /** View PeopleCode: the component's, or a record's when one is chosen. */
  viewPeopleCode: (record?: string) => Promise<void>;
  /** Present when the component can be edited. */
  edit?: {
    /** Insert > Page into Component: asks for a page not yet in the component; its row, or undefined when cancelled. */
    choosePage: (inComponent: string[]) => Promise<{ pageName: string; itemLabel: string; deferred: boolean } | undefined>;
    /** Saves; returns the component as stored now. */
    save: (items: ComponentItemEdit[], properties: ComponentPropertyEdits) => Promise<ComponentDefinition>;
  };
}

/** A component in App Designer's component window (Definition, Structure, Component Properties), one panel per component. */
export class ComponentPanel {
  static readonly viewType = 'psft.component';
  private static readonly open = new Map<string, vscode.WebviewPanel>();

  static show(connection: { id: string; displayName: string }, key: DefinitionKey, definition: ComponentDefinition, options: ComponentPanelOptions): void {
    const id = `${connection.id}\u0000${keyToString(key)}`;
    const existing = ComponentPanel.open.get(id);
    if (existing) {
      existing.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(ComponentPanel.viewType, `${definition.name}.${definition.market}`,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, { enableScripts: true, localResourceRoots: [] });
    ComponentPanel.open.set(id, panel);
    panel.onDidDispose(() => ComponentPanel.open.delete(id));
    const editable = !!options.edit;
    const render = (def: ComponentDefinition, status?: string) => {
      panel.webview.html = renderComponentHtml(def, randomBytes(16).toString('base64'), { editable, ...(status ? { status } : {}) });
    };
    panel.webview.onDidReceiveMessage(async (message: { type?: string; page?: unknown; record?: unknown; pages?: unknown; items?: unknown; properties?: unknown }) => {
      try {
        if (message.type === 'viewPeopleCode') {
          const record = typeof message.record === 'string' && /^[A-Z0-9_#$@]{1,15}$/i.test(message.record) ? message.record : undefined;
          await options.viewPeopleCode(record);
        } else if (message.type === 'openPage' && typeof message.page === 'string' && /^[A-Z0-9_#$@]{1,18}$/i.test(message.page)) {
          await options.openPage(message.page);
        } else if (message.type === 'insertPage' && options.edit) {
          const inComponent = Array.isArray(message.pages) ? message.pages.map(String) : [];
          const chosen = await options.edit.choosePage(inComponent);
          if (chosen) {
            const row = gridRow({ num: inComponent.length + 1, pageName: chosen.pageName, itemName: chosen.pageName, hidden: false,
              itemLabel: chosen.itemLabel, folderTabLabel: '', deferred: chosen.deferred }, true);
            await panel.webview.postMessage({ type: 'pageInserted', row });
          }
        } else if (message.type === 'save' && options.edit && Array.isArray(message.items) && message.properties && typeof message.properties === 'object') {
          const saved = await options.edit.save(message.items as ComponentItemEdit[], message.properties as ComponentPropertyEdits);
          render(saved, `Saved (v${saved.properties.general.version})`);
        }
      } catch (err) {
        await panel.webview.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    });
    render(definition);
  }
}
