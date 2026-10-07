import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { Workspace } from '../workspace.js';
import { parseUri } from '../util/uri.js';
import { renderFieldHtml } from './fieldHtml.js';
import { escapeHtml } from './propertiesHtml.js';

/**
 * The field definition editor -- App Designer's Field dialog, read-only:
 * no provider can save a field yet.
 */
export class FieldEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'psft.fieldEditor';

  constructor(private readonly workspace: Workspace) {}

  static register(workspace: Workspace): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      FieldEditorProvider.viewType,
      new FieldEditorProvider(workspace),
      { supportsMultipleEditorsPerDocument: false });
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
    panel.webview.options = { enableScripts: false, localResourceRoots: [] };
    const nonce = randomBytes(16).toString('base64');
    try {
      const { handle, key } = parseUri(document.uri);
      const provider = await this.workspace.requireByHandle(handle);
      const field = provider.readField ? await provider.readField(key) : undefined;
      panel.webview.html = field
        ? renderFieldHtml(field, provider.displayName, nonce)
        : message(`Field ${key.parts[0] ?? ''} was not found in ${provider.displayName}.`, nonce);
    } catch (err) {
      panel.webview.html = message((err as Error).message, nonce);
    }
  }
}

function message(text: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}';">
<style nonce="${nonce}">body { font-family: var(--vscode-font-family); padding: 2rem; color: var(--vscode-errorForeground); }</style></head>
<body><p>${escapeHtml(text)}</p></body></html>`;
}
