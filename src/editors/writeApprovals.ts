import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { WriteApprovals } from '../model/writeApprovals.js';
import { escapeHtml as esc } from './propertiesHtml.js';

/** Persistent visible surface, bound to each live approval ID; expired cards cannot authorize writes. */
export class WriteApprovalWorkspace implements vscode.Disposable {
  private readonly queue = new WriteApprovals();
  private panel?: vscode.WebviewPanel;
  private readonly bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 91);
  private readonly subscriptions: vscode.Disposable[] = [];
  constructor() {
    this.bar.command = 'psft.mcp.approvals';
    this.subscriptions.push(vscode.commands.registerCommand('psft.mcp.approvals', () => this.show()), this.queue.onChange(() => this.render()));
    this.render(); this.bar.show();
  }
  prompt(request: { title: string; detail: string; choices: string[] }, signal: AbortSignal): Promise<string | undefined> {
    const answer = this.queue.request(request, signal);
    if (!signal.aborted) this.show(true);
    return answer;
  }
  private show(preserveFocus = false): void {
    if (this.panel) { this.panel.reveal(vscode.ViewColumn.Beside, preserveFocus); return; }
    this.panel = vscode.window.createWebviewPanel('psft.writeApprovals', 'AI Write Approvals', { viewColumn: vscode.ViewColumn.Beside, preserveFocus }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const m = message as Record<string, unknown>;
      if (typeof m.id === 'string' && (m.choice === undefined || typeof m.choice === 'string')) this.queue.decide(m.id, m.choice);
    }, undefined, this.subscriptions);
    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.render();
  }
  private render(): void {
    const entries = this.queue.list(), pending = entries.filter(r => r.state === 'PENDING').length;
    this.bar.text = `$(shield) AI approvals${pending ? ` (${pending})` : ''}`;
    this.bar.tooltip = pending ? `${pending} AI writes await your decision. Click to review.` : 'Review AI write approval outcomes. Expired requests require a fresh tool retry.';
    if (!this.panel) return;
    const nonce = randomBytes(16).toString('base64');
    this.panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">
body{font-family:var(--vscode-font-family);padding:20px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}article{border:1px solid var(--vscode-panel-border);padding:16px;margin:16px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{margin:4px;padding:6px 12px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0}small{color:var(--vscode-descriptionForeground)}</style></head><body>
<h1>AI Write Approvals</h1><p>${pending} pending. Closing this page does not approve or decline a request.</p><p>Requests expire after 60 seconds or when the agent cancels. An expired or cancelled request writes nothing; retry the original tool to request fresh approval.</p><p>Approval permits the requested save. Check the agent's result to see whether the save succeeded.</p>
${entries.length ? entries.map(r => `<article data-id="${esc(r.id)}"><strong>${esc(r.state)}</strong><h2>${esc(r.title)}</h2><small>${esc(r.createdAt)}</small><pre>${esc(r.detail)}</pre>${r.state === 'PENDING' ? r.choices.map(c => `<button disabled data-choice="${esc(c)}">${esc(c)}</button>`).join('') + '<button disabled data-decline>Decline</button>' : '<p>No further action is possible for this request.</p>'}</article>`).join('') : '<p>No requests in this window yet.</p>'}
<script nonce="${nonce}">const vscode=acquireVsCodeApi();document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;vscode.postMessage({id:b.closest('article').dataset.id,...(b.hasAttribute('data-choice')?{choice:b.dataset.choice}:{})});});document.querySelectorAll('button').forEach(b=>b.disabled=false);</script></body></html>`;
  }
  dispose(): void { this.queue.dispose(); this.panel?.dispose(); this.bar.dispose(); for (const subscription of this.subscriptions) subscription.dispose(); }
}
