import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { parseWebviewMessage, type SettingsHostMessage } from './settingsMessages.js';
import { safeErrorMessage } from './settingsModel.js';
import type { SettingsService } from './settingsService.js';

/**
 * The PeopleSoft Studio Settings editor.
 *
 * A panel rather than a side-bar webview: the connection list, edit forms and
 * per-setting descriptions need an editor's width. The page is a renderer for
 * SettingsService state and holds none of its own beyond unsaved form input.
 *
 * State is never interpolated into the HTML. The page loads empty, says
 * `ready`, and receives everything by postMessage.
 */
export class SettingsPanel {
  static readonly viewType = 'psft.settings';
  private static current?: SettingsPanel;

  private readonly disposables: vscode.Disposable[] = [];

  static show(service: SettingsService, extensionUri: vscode.Uri): void {
    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      'PeopleSoft Studio Settings',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      SettingsPanel.options(extensionUri));
    SettingsPanel.current = new SettingsPanel(panel, service, extensionUri);
  }

  /** Restores a panel VS Code kept across a window reload. */
  static revive(panel: vscode.WebviewPanel, service: SettingsService, extensionUri: vscode.Uri): void {
    SettingsPanel.current?.panel.dispose();
    panel.webview.options = SettingsPanel.options(extensionUri);
    SettingsPanel.current = new SettingsPanel(panel, service, extensionUri);
  }

  private static options(extensionUri: vscode.Uri): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      enableScripts: true,
      // The page re-requests state when it is shown again, so it need not be kept alive.
      retainContextWhenHidden: false,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
    };
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly service: SettingsService,
    private readonly extensionUri: vscode.Uri
  ) {
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'resources', 'tools.svg');
    panel.webview.html = this.render();

    this.disposables.push(
      service.onDidChangeState((state) => this.post({ type: 'state', state })),
      panel.webview.onDidReceiveMessage((raw) => void this.onMessage(raw)),
      panel.onDidDispose(() => this.dispose())
    );
  }

  private async onMessage(raw: unknown): Promise<void> {
    const message = parseWebviewMessage(raw);
    if (!message) {
      console.warn('PeopleSoft Studio Settings: ignored a malformed message from the page.');
      return;
    }
    try {
      const reply = await this.service.handleMessage(message);
      if (reply) this.post(reply);
    } catch (err) {
      void vscode.window.showErrorMessage(`PeopleSoft Studio Settings: ${safeErrorMessage(err)}`);
      // Whatever the page assumed optimistically, put it back in step.
      if (message.type === 'selectConnection') {
        this.post({ type: 'selectionResult', connectionId: message.connectionId, selected: false });
      }
      this.post({ type: 'state', state: this.service.getState() });
    }
  }

  private post(message: SettingsHostMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    if (SettingsPanel.current === this) SettingsPanel.current = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  private render(): string {
    const webview = this.panel.webview;
    const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', file));
    const nonce = createNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${media('settings.css')}">
<title>PeopleSoft Studio Settings</title>
</head>
<body>
  <header class="page-header">
    <div>
      <h1>PeopleSoft Studio Settings</h1>
      <p class="description">Configure your PeopleSoft development environment.</p>
    </div>
    <button type="button" class="link" id="open-native-settings">Open VS Code Settings</button>
  </header>
  <nav class="toc" id="toc" aria-label="Sections"></nav>
  <main id="root"><p class="description">Loading…</p></main>
  <script nonce="${nonce}" src="${media('settings.js')}"></script>
</body>
</html>`;
  }
}

function createNonce(): string {
  return randomBytes(18).toString('base64');
}
