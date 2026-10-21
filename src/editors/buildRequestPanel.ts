import { randomBytes } from 'node:crypto';
import path from 'node:path';
import * as vscode from 'vscode';
import {
  agentPrompt, approvalBlocker, buildOrder, isApproved, REQUEST_KINDS, status, STATUS_LABELS, unansweredQuestions, type BuildRequest, type RequestEdit
} from '../buildRequest/model.js';
import { routeFor } from '../buildRequest/routes.js';
import { agentLaunch } from '../buildRequest/handoff.js';
import type { BuildRequestStore } from '../buildRequest/store.js';
import { escapeHtml as esc } from './propertiesHtml.js';

/*
 * The Build Request page (docs/BUILD_REQUESTS.md): the developer describes the
 * request and attaches the business user's material, hands it to an AI agent
 * (Claude Code or Codex, through the Studio MCP), answers its questions,
 * reviews the build spec it proposes and approves it -- the only place a spec
 * can be approved -- then hands it back to build, and follows the progress.
 */

export type AgentChoice = 'claude' | 'codex' | 'clipboard';
export const AGENTS: Record<AgentChoice, string> = { claude: 'Claude Code', codex: 'Codex', clipboard: 'Copy prompt (any agent)' };

export interface BuildRequestHost {
  store: BuildRequestStore;
  extensionUri: vscode.Uri;
  connections(): string[];
  mcp(): { running: boolean; writes: boolean; url: string };
}

type Message =
  | { type: 'ready' }
  | { type: 'edit'; edit: RequestEdit }
  | { type: 'addFiles' }
  | { type: 'removeAttachment'; attachmentId: string }
  | { type: 'openAttachment'; attachmentId: string; asText: boolean }
  | { type: 'answer'; questionId: string; answer: string }
  | { type: 'approve'; specRevision: number }
  | { type: 'requestChanges'; text: string }
  | { type: 'handoff'; phase: 'analyze' | 'build'; agent: AgentChoice }
  | { type: 'openChangeSet'; changeSetId: string }
  | { type: 'revealFolder' }
  | { type: 'delete' };

export class BuildRequestPanel {
  static readonly viewType = 'psft.buildRequest';
  private static readonly open = new Map<string, BuildRequestPanel>();

  static show(host: BuildRequestHost, id: string): void {
    const existing = BuildRequestPanel.open.get(id);
    if (existing) { existing.panel.reveal(); return; }
    BuildRequestPanel.open.set(id, new BuildRequestPanel(host, id));
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private messages: Promise<void> = Promise.resolve();

  private constructor(private readonly host: BuildRequestHost, private readonly id: string) {
    this.panel = vscode.window.createWebviewPanel(BuildRequestPanel.viewType, 'Build Request', vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(host.extensionUri, 'media')] });
    this.panel.iconPath = new vscode.ThemeIcon('tools');
    const media = (f: string) => this.panel.webview.asWebviewUri(vscode.Uri.joinPath(host.extensionUri, 'media', f)).toString();
    this.panel.webview.html = renderBuildRequestHtml({ nonce: randomBytes(16).toString('base64'), cspSource: this.panel.webview.cspSource,
      script: media('buildRequest.js'), style: media('buildRequest.css') });
    const changes = host.store.onDidChange((changed) => { if (changed === id) void this.push(); });
    this.disposables.push({ dispose: () => changes.dispose() });
    // Blur/change and the following button click arrive as separate messages. Finish
    // persisting the edit before a handoff or approval reads the request it concerns.
    this.panel.webview.onDidReceiveMessage((m: Message) => {
      this.messages = this.messages.then(() => this.handle(m)).catch((error) => {
        void vscode.window.showErrorMessage(`Build request: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, undefined, this.disposables);
    this.panel.onDidDispose(() => {
      BuildRequestPanel.open.delete(id);
      for (const d of this.disposables) d.dispose();
    });
  }

  private async push(): Promise<void> {
    let r: BuildRequest;
    try { r = await this.host.store.get(this.id); } catch { this.panel.dispose(); return; }
    this.panel.title = `Build Request: ${r.title}`;
    const mcp = this.host.mcp();
    await this.panel.webview.postMessage({ type: 'state', state: viewState(r, this.host.connections(), mcp.writes), mcp,
      agent: vscode.workspace.getConfiguration('peoplesoft.buildRequests').get<AgentChoice>('agent', 'claude') });
  }

  private async handle(m: Message): Promise<void> {
    const { store } = this.host;
    switch (m.type) {
      case 'ready': return this.push();
      case 'edit': await store.edit(this.id, m.edit); return;
      case 'addFiles': {
        const files = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Attach', title: 'Attach documents to the build request' });
        for (const file of files ?? []) await store.attach(this.id, path.basename(file.fsPath), Buffer.from(await vscode.workspace.fs.readFile(file)));
        return;
      }
      case 'removeAttachment': await store.removeAttachment(this.id, m.attachmentId); return;
      case 'openAttachment': {
        const r = await store.get(this.id);
        const a = r.attachments.find((x) => x.id === m.attachmentId);
        if (!a) return;
        if (m.asText) {
          const doc = await vscode.workspace.openTextDocument({ content: await store.attachmentText(this.id, a.id) ?? '', language: 'plaintext' });
          await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        } else await vscode.env.openExternal(vscode.Uri.file(store.attachmentPath(this.id, a)));
        return;
      }
      case 'answer': await store.answer(this.id, m.questionId, m.answer); return;
      case 'approve': {
        const r = await store.get(this.id);
        const blocker = approvalBlocker(r);
        if (blocker) { void vscode.window.showWarningMessage(blocker); return; }
        const manual = r.spec!.objects.filter((o) => routeFor(o.definitionType, o.action, true).route === 'MANUAL').length;
        const pick = await vscode.window.showInformationMessage(`Approve spec revision ${r.spec!.revision} for "${r.title}"?`, {
          modal: true,
          detail: `The agent may then build the ${r.spec!.objects.filter((o) => o.action !== 'reuse').length} objects it lists on ${r.connection}` +
            `${manual ? ` (${manual} left to you as manual steps)` : ''}. Every write still passes Studio's write gates and Change Review.`
        }, 'Approve');
        if (pick === 'Approve') await store.approve(this.id, m.specRevision);
        return;
      }
      case 'requestChanges': if (m.text.trim()) await store.requestChanges(this.id, m.text); return;
      case 'handoff': return this.handoff(m.phase, m.agent);
      case 'openChangeSet': await vscode.commands.executeCommand('psft.changeReview.open', m.changeSetId); return;
      case 'revealFolder': await vscode.env.openExternal(vscode.Uri.file(store.folder(this.id))); return;
      case 'delete': {
        const r = await store.get(this.id);
        const pick = await vscode.window.showWarningMessage(`Delete build request "${r.title}" and its ${r.attachments.length} attachment(s)?`,
          { modal: true, detail: 'Nothing in PeopleSoft is changed.' }, 'Delete');
        if (pick === 'Delete') { await store.delete(this.id); this.panel.dispose(); }
        return;
      }
    }
  }

  private async handoff(phase: 'analyze' | 'build', agent: AgentChoice): Promise<void> {
    const r = await this.host.store.get(this.id);
    if (phase === 'build' && !isApproved(r)) { void vscode.window.showWarningMessage('Approve the spec before handing it over to build.'); return; }
    if (phase === 'analyze' && !r.narrative.trim() && !r.attachments.length) { void vscode.window.showWarningMessage('Describe the request or attach its documents first.'); return; }
    await vscode.workspace.getConfiguration('peoplesoft.buildRequests').update('agent', agent, vscode.ConfigurationTarget.Global);
    let mcp = this.host.mcp();
    if (!mcp.running) {
      const pick = await vscode.window.showWarningMessage('The agent reads the request through the PeopleSoft Studio MCP server, which is not running.', 'Start MCP Server', 'Continue Anyway');
      if (pick === 'Start MCP Server') await vscode.commands.executeCommand('psft.mcp.start');
      else if (pick !== 'Continue Anyway') return;
      mcp = this.host.mcp();
    }
    if (phase === 'build' && !mcp.writes) {
      void vscode.window.showWarningMessage('MCP writes are off (peoplesoft.mcp.writes), so the agent can only report every object as a manual step.', 'Open Setting')
        .then((p) => { if (p) void vscode.commands.executeCommand('workbench.action.openSettings', 'peoplesoft.mcp.writes'); });
    }
    const prompt = agentPrompt(r, phase);
    if (agent === 'clipboard') {
      await vscode.env.clipboard.writeText(prompt);
      void vscode.window.showInformationMessage('Prompt copied. Paste it into an agent connected to the PeopleSoft Studio MCP server.');
    } else {
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? this.host.store.folder(this.id);
      const launch = agentLaunch(r, phase, agent, mcp.url);
      const name = `${AGENTS[agent]}: ${r.title}`.slice(0, 60);
      if (process.platform === 'win32') {
        // VS Code quotes literal arguments for the configured Windows shell, including .cmd launchers.
        const task = new vscode.Task({ type: 'psft-build-request', request: r.id }, vscode.TaskScope.Global, name, 'PeopleSoft Studio',
          new vscode.ShellExecution(launch.command, launch.args.map(value => ({ value, quoting: vscode.ShellQuoting.Strong })), { cwd }));
        task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, focus: true, panel: vscode.TaskPanelKind.New };
        await vscode.tasks.executeTask(task);
      } else {
        const terminal = vscode.window.createTerminal({ name, cwd, shellPath: launch.command, shellArgs: launch.args, iconPath: new vscode.ThemeIcon('tools') });
        terminal.show();
      }
    }
    await this.host.store.recordHandoff(this.id, phase, agent);
  }
}

/** What the page shows: the request, its status and what blocks approval, and each spec object's build route. */
export function viewState(r: BuildRequest, connections: string[], writes: boolean) {
  const s = status(r);
  return {
    id: r.id, title: r.title, kind: r.kind, connection: r.connection, project: r.project, narrative: r.narrative,
    kinds: Object.entries(REQUEST_KINDS).map(([value, k]) => ({ value, label: k.label, summary: k.summary })),
    connections: [...new Set([...connections, ...(r.connection ? [r.connection] : [])])],
    status: s, statusLabel: STATUS_LABELS[s], approved: isApproved(r), approvalBlocker: approvalBlocker(r) ?? null,
    attachments: r.attachments, questions: r.questions, openQuestions: unansweredQuestions(r).length, feedback: r.feedback,
    spec: r.spec ? {
      revision: r.spec.revision, proposedAt: r.spec.proposedAt, summary: r.spec.summary, mappings: r.spec.mappings, assumptions: r.spec.assumptions,
      testPlan: r.spec.testPlan, stale: r.spec.basedOnInputs !== r.inputsRevision,
      objects: buildOrder(r.spec).map((o) => ({ ...o, route: routeFor(o.definitionType, o.action, writes), progress: r.progress[o.ref] ?? null }))
    } : null,
    approval: r.approval ?? null,
    handoffs: r.handoffs
  };
}

export function renderBuildRequestHtml(page: { nonce: string; cspSource: string; script: string; style: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${page.cspSource}; script-src 'nonce-${page.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${esc(page.style)}">
<title>Build Request</title>
</head>
<body>
<div id="app"></div>
<script nonce="${page.nonce}" src="${esc(page.script)}"></script>
</body>
</html>`;
}

