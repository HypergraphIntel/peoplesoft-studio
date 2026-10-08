import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { DefinitionKey, keyToString } from '../model/definitions.js';
import { renderImageHtml, type ImageContent } from './imageHtml.js';

/** An image, read-only, one panel per image. */
export class ImagePanel {
  static readonly viewType = 'psft.image';
  private static readonly open = new Map<string, vscode.WebviewPanel>();

  static show(connection: { id: string; displayName: string }, key: DefinitionKey, image: ImageContent): void {
    const id = `${connection.id}\u0000${keyToString(key)}`;
    let panel = ImagePanel.open.get(id);
    if (panel) {
      panel.reveal();
    } else {
      panel = vscode.window.createWebviewPanel(ImagePanel.viewType, image.name,
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, { enableScripts: false, localResourceRoots: [] });
      ImagePanel.open.set(id, panel);
      panel.onDidDispose(() => ImagePanel.open.delete(id));
    }
    panel.webview.html = renderImageHtml(image, connection.displayName, randomBytes(16).toString('base64'));
  }
}
