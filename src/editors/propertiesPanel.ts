import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { DefinitionKey, keyToString } from '../model/definitions.js';
import type { DefinitionProperties } from '../model/properties.js';
import { renderPropertiesHtml } from './propertiesHtml.js';

/**
 * A definition's Properties, read-only, one panel per definition: asking
 * again for a definition already shown brings its panel forward with the
 * values read afresh.
 */
export class PropertiesPanel {
  static readonly viewType = 'psft.properties';
  private static readonly open = new Map<string, vscode.WebviewPanel>();

  static show(
    extensionUri: vscode.Uri,
    connection: { id: string; displayName: string },
    key: DefinitionKey,
    props: DefinitionProperties
  ): void {
    const id = `${connection.id}\u0000${keyToString(key)}`;
    const nonce = randomBytes(16).toString('base64');
    let panel = PropertiesPanel.open.get(id);
    if (panel) {
      panel.reveal();
    } else {
      panel = vscode.window.createWebviewPanel(
        PropertiesPanel.viewType,
        `${props.name} Properties`,
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        { enableScripts: false, localResourceRoots: [] });
      panel.iconPath = vscode.Uri.joinPath(extensionUri, 'resources', 'document.svg');
      PropertiesPanel.open.set(id, panel);
      panel.onDidDispose(() => PropertiesPanel.open.delete(id));
    }
    panel.webview.html = renderPropertiesHtml(props, connection.displayName, nonce);
  }
}
