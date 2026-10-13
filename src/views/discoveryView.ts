import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  decideUpload, DiscoveryStore, policyFileLocations, previewSubmission, type Finding, type FindingSummary, type KnowledgeStore, type MachinePolicy,
  type UploadDecision, type UploadMode
} from '../intelligence/index.js';
import { escapeHtml as esc } from '../editors/propertiesHtml.js';
import { submitFinding } from '../intelligenceClient.js';

/*
 * The Discovery Center (docs/intelligence, phase 3): the Discoveries view
 * lists this installation's findings and the workspace's research store
 * (tools/intelligence/store); a finding opens in a panel with its claim,
 * evidence, submission history and the submission review -- the exact
 * payloads, what was removed and why, whether submitting is allowed and
 * where to. Nothing is sent unless decideUpload() allows it (settings,
 * machine policy, telemetry) and the user approves that submission.
 */

const TOKEN_KEY = 'psft.intelligence.serverToken';

export interface DiscoverySource {
  id: string;
  label: string;
  store: DiscoveryStore;
  /** The installation's own store: findings can be removed from it. */
  own: boolean;
}

type Node =
  | { kind: 'status'; decision: UploadDecision }
  | { kind: 'knowledge'; label: string; detail: string; tooltip: string; ok: boolean }
  | { kind: 'source'; source: DiscoverySource; count: number }
  | { kind: 'finding'; source: DiscoverySource; summary: FindingSummary }
  | { kind: 'empty'; text: string };

/** Submission permission as of now: settings, VS Code telemetry, the machine policy (fail closed when unreadable). */
export function currentUploadDecision(): UploadDecision {
  const c = vscode.workspace.getConfiguration('peoplesoft.intelligence');
  let policy: MachinePolicy | undefined;
  let policyError: string | undefined;
  for (const file of policyFileLocations(process.platform, process.env)) {
    if (!existsSync(file)) continue;
    try { policy = JSON.parse(readFileSync(file, 'utf8')) as MachinePolicy; } catch (error) { policyError = `${path.basename(file)}: ${(error as Error).message}`; }
  }
  return decideUpload({
    uploadMode: c.get<UploadMode>('uploadMode', 'off'), serverUrl: c.get<string>('serverUrl', ''),
    telemetryLevel: vscode.workspace.getConfiguration('telemetry').get<string>('telemetryLevel', 'all'),
    ...(policy ? { policy } : {}), ...(policyError ? { policyError } : {})
  });
}

export class DiscoveryTree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly sources: () => Promise<DiscoverySource[]>, private readonly knowledge?: () => Promise<KnowledgeStore>) {}

  refresh(): void { this.changed.fire(); }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      const out: Node[] = [{ kind: 'status', decision: currentUploadDecision() }];
      if (this.knowledge) {
        const k = await (await this.knowledge()).current().catch((e: Error) => ({ ok: false, reasons: [e.message] }));
        out.push(!k
          ? { kind: 'knowledge', label: 'Installed Knowledge: none', detail: 'no verified bundle installed', tooltip: 'Knowledge bundles are signed, verified before use, and data only. This build trusts no signing key yet.', ok: false }
          : k.ok && 'bundle' in k && k.bundle
            ? { kind: 'knowledge', label: `Installed Knowledge: v${k.bundle.version}`, detail: `${k.bundle.findings.length} published · expires ${k.bundle.expiresAt.slice(0, 10)}`, tooltip: `Verified bundle ${k.bundle.version}: ${k.bundle.findings.length} published finding(s), ${k.bundle.revoked.length} revoked.`, ok: true }
            : { kind: 'knowledge', label: 'Installed Knowledge: not trusted', detail: k.reasons[0] ?? '', tooltip: `The installed bundle is not used:\n${k.reasons.map((r) => `• ${r}`).join('\n')}`, ok: false });
      }
      for (const source of await this.sources()) out.push({ kind: 'source', source, count: (await source.store.list()).length });
      return out;
    }
    if (node.kind === 'source') {
      const all = await node.source.store.list();
      return all.length ? all.map((summary) => ({ kind: 'finding' as const, source: node.source, summary }))
        : [{ kind: 'empty', text: node.source.own ? 'None recorded on this installation yet' : 'None recorded' }];
    }
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'status': {
        const item = new vscode.TreeItem(node.decision.allowed ? 'Submissions: manual review' : 'Submissions: off');
        item.description = node.decision.allowed ? node.decision.serverUrl : node.decision.reasons[0];
        item.tooltip = node.decision.allowed
          ? `Each submission is shown to you, exactly, before it is sent to ${node.decision.serverUrl}.`
          : `Nothing is sent from this machine:\n${node.decision.reasons.map((r) => `• ${r}`).join('\n')}`;
        item.iconPath = new vscode.ThemeIcon(node.decision.allowed ? 'cloud-upload' : 'shield');
        item.command = { command: 'workbench.action.openSettings', title: 'Settings', arguments: ['peoplesoft.intelligence'] };
        return item;
      }
      case 'knowledge': {
        const item = new vscode.TreeItem(node.label);
        item.description = node.detail;
        item.tooltip = node.tooltip;
        item.iconPath = new vscode.ThemeIcon(node.ok ? 'verified' : 'unverified');
        return item;
      }
      case 'source': {
        const item = new vscode.TreeItem(node.source.label, vscode.TreeItemCollapsibleState.Expanded);
        item.description = `${node.count}`;
        item.iconPath = new vscode.ThemeIcon(node.source.own ? 'device-desktop' : 'repo');
        item.id = `source:${node.source.id}`;
        return item;
      }
      case 'finding': {
        const s = node.summary;
        const item = new vscode.TreeItem(s.title);
        item.id = `finding:${node.source.id}:${s.id}`;
        item.description = `${s.localStatus} · ${s.confidence} · ${s.observedReleases.join(', ')}`;
        item.tooltip = `${s.title}\n${s.subsystem} · ${s.type} · ${s.objectType}\n${s.observations} observation(s) · ${s.privacy}\n${s.id}`;
        item.iconPath = new vscode.ThemeIcon(s.localStatus === 'reproduced' ? 'pass' : 'circle-large-outline');
        item.contextValue = node.source.own ? 'psft.discovery.own' : 'psft.discovery';
        item.command = { command: 'psft.intelligence.openDiscovery', title: 'Open', arguments: [node.source.id, s.id] };
        return item;
      }
      case 'empty': {
        const item = new vscode.TreeItem(node.text);
        item.iconPath = new vscode.ThemeIcon('info');
        return item;
      }
    }
  }
}

interface PanelState {
  source: DiscoverySource;
  finding: Finding;
  keepProvenance: boolean;
  results: string[];
}

export class DiscoveryPanel {
  private static readonly open = new Map<string, { panel: vscode.WebviewPanel; state: PanelState }>();

  static async show(context: vscode.ExtensionContext, source: DiscoverySource, id: string, onChange: () => void): Promise<void> {
    const key = `${source.id}\u0000${id}`;
    const existing = DiscoveryPanel.open.get(key);
    if (existing) { existing.panel.reveal(); return; }
    const finding = await source.store.get(id);
    if (!finding) throw new Error(`No finding ${id} in ${source.label}.`);
    const panel = vscode.window.createWebviewPanel('psft.discovery', finding.title.slice(0, 60), vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
    const state: PanelState = { source, finding, keepProvenance: false, results: [] };
    DiscoveryPanel.open.set(key, { panel, state });
    panel.onDidDispose(() => DiscoveryPanel.open.delete(key));
    panel.webview.onDidReceiveMessage(async (m: { type: string; keep?: boolean }) => {
      try {
        if (m.type === 'keepProvenance') state.keepProvenance = !!m.keep;
        else if (m.type === 'submit') await DiscoveryPanel.submit(context, state);
        else if (m.type === 'remove' && source.own) {
          if (await vscode.window.showWarningMessage(`Remove "${finding.title}" from this installation?`, { modal: true, detail: 'It is deleted from this installation\'s discovery store. Anything already submitted stays on the server.' }, 'Remove') === 'Remove') {
            await source.store.remove(finding.id);
            onChange();
            panel.dispose();
            return;
          }
        }
      } catch (error) {
        state.results.push(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      await DiscoveryPanel.render(panel, state);
      onChange();
    });
    await DiscoveryPanel.render(panel, state);
  }

  private static async submit(context: vscode.ExtensionContext, state: PanelState): Promise<void> {
    const decision = currentUploadDecision();
    if (!decision.allowed || !decision.serverUrl) { state.results.push(`Not sent: ${decision.reasons.join(' ')}`); return; }
    const preview = previewSubmission(state.finding, { keepProvenance: state.keepProvenance });
    if (preview.blocked.length) { state.results.push(`Not sent: ${preview.blocked.join('; ')}`); return; }
    const token = await context.secrets.get(TOKEN_KEY);
    if (!token) {
      const set = await vscode.window.showWarningMessage('No discovery server token is set.', 'Set Token…');
      if (set) await vscode.commands.executeCommand('psft.intelligence.setServerToken');
      return;
    }
    const origin = new URL(decision.serverUrl).origin;
    const answer = await vscode.window.showWarningMessage(
      `Send ${preview.payloads.length} submission(s) of "${state.finding.title}" to ${origin}?`,
      { modal: true, detail: `Exactly the payload${preview.payloads.length === 1 ? '' : 's'} shown in the review leave${preview.payloads.length === 1 ? 's' : ''} this machine.${preview.removed.length ? ` ${preview.removed.length} field(s) were removed first.` : ''} Nothing else is sent.` },
      'Send');
    if (answer !== 'Send') { state.results.push('Cancelled: nothing was sent.'); return; }
    for (const [i, payload] of preview.payloads.entries()) {
      const r = await submitFinding(decision.serverUrl, token, payload);
      const at = new Date().toISOString();
      if (r.ok) {
        state.results.push(`Observation ${i + 1}: ${r.outcome} as ${r.remoteId} (${r.status}).`);
        await state.source.store.appendSubmission({ findingId: state.finding.id, observation: i + 1, at, server: origin, outcome: r.outcome, remoteId: r.remoteId, remoteStatus: r.status });
      } else {
        state.results.push(`Observation ${i + 1}: not accepted — ${r.httpStatus ? `HTTP ${r.httpStatus}, ` : ''}${r.error}`);
        await state.source.store.appendSubmission({ findingId: state.finding.id, observation: i + 1, at, server: origin, outcome: 'failed', error: `${r.httpStatus ?? ''} ${r.error}`.trim().slice(0, 300) });
      }
    }
  }

  private static async render(panel: vscode.WebviewPanel, state: PanelState): Promise<void> {
    const f = state.finding;
    const decision = currentUploadDecision();
    const preview = previewSubmission(f, { keepProvenance: state.keepProvenance });
    const history = await state.source.store.submissions(f.id);
    const nonce = randomBytes(16).toString('base64');
    const canSubmit = decision.allowed && preview.blocked.length === 0;
    const rows = (pairs: Array<[string, unknown]>) => pairs.filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(typeof v === 'string' ? v : JSON.stringify(v))}</td></tr>`).join('');
    const observations = f.observations.map((o, i) => `
      <div class="card"><h3>Observation ${i + 1} · ${esc(o.method)} · PeopleTools ${esc(o.environment.peopleToolsRelease)}</h3>
      <p>${esc(o.observation)}</p>
      <table>${rows([['Observed', o.observedAt], ['Experiment', o.experimentId], ['Run', o.runId], ['Tool', o.environment.tool], ['Application release', o.environment.appRelease],
        ['Expected', o.expected], ['Actual', o.actual], ['Digest', o.digest.slice(0, 16)]])}</table>
      ${o.delta ? `<table class="delta"><tr><th>Table</th><th>Inserted</th><th>Deleted</th><th>Updated</th></tr>${o.delta.tables.map((t) => `<tr><td>${esc(t.table)}</td><td>${t.inserted}</td><td>${t.deleted}</td><td>${t.updated}</td></tr>`).join('')}</table>
        ${o.delta.counters ? `<p class="muted">Counters: ${esc(Object.entries(o.delta.counters).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', '))}</p>` : ''}` : ''}
      ${o.testResults?.length ? `<ul>${o.testResults.map((t) => `<li>${esc(t.outcome)} — ${esc(t.name)}</li>`).join('')}</ul>` : ''}
      ${o.evidence?.length ? `<p class="muted">Evidence: ${esc(o.evidence.map((e) => `${e.kind} ${e.ref}`).join(' · '))}</p>` : ''}</div>`).join('');
    panel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:0 16px 24px;max-width:1100px}
h1{font-size:1.3em;margin:14px 0 4px}h2{font-size:1.1em;margin:22px 0 6px;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:4px}h3{font-size:1em;margin:0 0 6px}
.muted{color:var(--vscode-descriptionForeground)}.card{border:1px solid var(--vscode-panel-border);padding:8px 10px;margin:8px 0}
table{border-collapse:collapse;margin:4px 0}th,td{text-align:left;padding:2px 10px 2px 0;vertical-align:top}th{font-weight:600;color:var(--vscode-descriptionForeground)}
table.delta td,table.delta th{border-bottom:1px solid var(--vscode-panel-border)}
pre{background:var(--vscode-textCodeBlock-background);padding:8px;overflow:auto;max-height:420px}
.bad{color:var(--vscode-errorForeground)}.ok{color:var(--vscode-testing-iconPassed,inherit)}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:4px 12px;cursor:pointer;margin-right:8px}
button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}button:disabled{opacity:.5;cursor:default}
</style><title>${esc(f.title)}</title></head><body>
<h1>${esc(f.title)}</h1>
<div class="muted">${esc(f.id)} · ${esc(f.type)} · ${esc(f.subject.subsystem)} · ${esc(f.subject.objectType)} · ${esc(state.source.label)}</div>
<table>${rows([['Local status', `${f.localStatus} (observed / reproduced are local; verification is the registry's)`], ['Confidence', f.confidence],
  ['PeopleTools', f.compatibility.observedReleases.join(', ')], ['Known incompatible', f.compatibility.knownIncompatible.join(', ')],
  ['Privacy', f.privacy.classification], ['Tables', f.subject.tables?.join(', ')], ['Recorded', `${f.provenance.createdAt} by ${f.provenance.source}`]])}</table>
<p>${esc(f.statement)}</p>
<h2>Claim</h2><table>${rows([['kind', f.assertion.kind], ...Object.entries(f.assertion.facts).map(([k, v]) => [k, v] as [string, unknown])])}</table>
<h2>Evidence (${f.observations.length})</h2>${observations}
<h2>Submission history</h2>${history.length ? `<table>${history.map((h) => `<tr><td>${esc(h.at)}</td><td>obs. ${h.observation}</td><td>${esc(h.server)}</td><td>${esc(h.outcome)}${h.remoteId ? ` → ${esc(h.remoteId)} (${esc(h.remoteStatus ?? '')})` : ''}${h.error ? ` — ${esc(h.error)}` : ''}</td></tr>`).join('')}</table>` : '<p class="muted">Never submitted.</p>'}
<h2>Submission review</h2>
${decision.allowed ? `<p class="ok">Submissions are allowed to <b>${esc(decision.serverUrl ?? '')}</b>, each approved by you.</p>` : `<p class="bad">Nothing can be sent from this machine:</p><ul>${decision.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`}
<label><input type="checkbox" id="keep" ${state.keepProvenance ? 'checked' : ''}> Share lab provenance (experiment and run IDs, capture cases, repository paths, the application release)</label>
${preview.removed.length ? `<p>Removed before sending:</p><ul>${preview.removed.map((r) => `<li>Observation ${r.observation}: <code>${esc(r.path)}</code> — ${esc(r.reason)}</li>`).join('')}</ul>` : '<p class="muted">Nothing removed.</p>'}
${preview.blocked.length ? `<p class="bad">Blocked:</p><ul>${preview.blocked.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
<p>Exactly what would leave this machine — ${preview.payloads.length} request(s), one per observation:</p>
<pre>${esc(JSON.stringify(preview.payloads, null, 2))}</pre>
<p><button id="submit" ${canSubmit ? '' : 'disabled'}>Submit…</button>${state.source.own ? '<button id="remove" class="secondary">Remove from this installation…</button>' : ''}</p>
${state.results.length ? `<div class="card">${state.results.map((r) => `<div>${esc(r)}</div>`).join('')}</div>` : ''}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.getElementById('keep').addEventListener('change', (e) => vscode.postMessage({ type: 'keepProvenance', keep: e.target.checked }));
document.getElementById('submit').addEventListener('click', () => vscode.postMessage({ type: 'submit' }));
const rm = document.getElementById('remove'); if (rm) rm.addEventListener('click', () => vscode.postMessage({ type: 'remove' }));
</script></body></html>`;
  }
}

/** The installation's store and the workspace's research stores. */
export function discoverySources(installation: () => Promise<DiscoveryStore>): () => Promise<DiscoverySource[]> {
  const research = new Map<string, DiscoverySource>();
  return async () => {
    const out: DiscoverySource[] = [{ id: 'installation', label: 'This Installation', store: await installation(), own: true }];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const root = path.join(folder.uri.fsPath, 'tools', 'intelligence', 'store');
      if (!existsSync(path.join(root, 'STORE.json'))) continue;
      const id = `research:${folder.uri.toString()}`;
      if (!research.has(id)) research.set(id, { id, label: `Workspace Research (${folder.name})`, store: await new DiscoveryStore(root).open(), own: false });
      out.push(research.get(id)!);
    }
    return out;
  };
}

export { TOKEN_KEY };
