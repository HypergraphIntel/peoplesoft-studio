import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import {
  answerCapability, DiscoveryInputError, DiscoveryStore, KnowledgeStore, PrivacyRejectedError, TRUSTED_KNOWLEDGE_KEYS,
  type CapabilityQuestion, type CapabilityResult, type Finding
} from './intelligence/index.js';
import { DiscoveryPanel, DiscoveryTree, discoverySources, TOKEN_KEY, type DiscoverySource } from './views/discoveryView.js';

/*
 * The extension's side of the Discovery & Intelligence Network
 * (docs/intelligence/PROGRESS.md): the installation's own store in the
 * extension's global storage, the Discoveries view and panel (phase 3),
 * recording a finding from JSON, and the server token in secret storage.
 * Nothing is sent unless the settings, the machine policy and VS Code's
 * telemetry allow it and the user approves the exact submission.
 */

let store: Promise<DiscoveryStore> | undefined;

let knowledge: Promise<KnowledgeStore> | undefined;

/** The installation's verified knowledge (bundles), apart from its findings. */
export function knowledgeStore(context: vscode.ExtensionContext): Promise<KnowledgeStore> {
  knowledge ??= Promise.resolve(new KnowledgeStore(vscode.Uri.joinPath(context.globalStorageUri, 'intelligence').fsPath, () => TRUSTED_KNOWLEDGE_KEYS));
  return knowledge;
}

/** The installation's discovery store (created on first use). */
export function discoveryStore(context: vscode.ExtensionContext): Promise<DiscoveryStore> {
  store ??= new DiscoveryStore(vscode.Uri.joinPath(context.globalStorageUri, 'intelligence').fsPath).open();
  return store;
}

/** What the MCP's discovery and knowledge tools read (src/mcp/discoveryTools.ts), once the extension has activated. */
export interface IntelligenceAccess {
  sources: () => Promise<DiscoverySource[]>;
  installation: () => Promise<DiscoveryStore>;
  knowledge: () => Promise<KnowledgeStore>;
  refresh: () => void;
}

let access: IntelligenceAccess | undefined;
export function intelligenceAccess(): IntelligenceAccess | undefined { return access; }

/**
 * The capability answer for a question on a connection's PeopleTools release, summarized
 * (for the Customization Strategy view and psft_customization_discover). Undefined before activation.
 */
export async function knowledgeFor(q: Omit<CapabilityQuestion, 'release'>, provider?: { databaseRelease(): Promise<{ toolsRelease: string }> }): Promise<{
  answer: CapabilityResult['answer']; release?: string; findings: Array<{ id: string; title: string; source: 'published' | 'local'; status: string }>;
} | undefined> {
  if (!access) return undefined;
  const release = provider ? (await provider.databaseRelease()).toolsRelease.trim() || undefined : undefined;
  const local: Finding[] = [];
  for (const s of await access.sources()) for (const x of await s.store.list()) { const f = await s.store.get(x.id); if (f) local.push(f); }
  const installed = await (await access.knowledge()).current();
  const r = answerCapability({ ...q, ...(release ? { release } : {}) }, local, installed?.ok ? installed.bundle : undefined);
  return { answer: r.answer, ...(r.release ? { release: r.release } : {}), findings: r.evidence.map((e) => ({ id: e.id, title: e.title, source: e.source, status: e.status })) };
}

export function registerIntelligenceCommands(context: vscode.ExtensionContext): void {
  const sources = discoverySources(() => discoveryStore(context));
  const tree = new DiscoveryTree(sources, () => knowledgeStore(context));
  access = { sources, installation: () => discoveryStore(context), knowledge: () => knowledgeStore(context), refresh: () => tree.refresh() };
  const report = async (r: { ok: boolean; reasons: string[]; bundle?: { version: number; findings: unknown[] } }, from: string) => {
    tree.refresh();
    if (r.ok && r.bundle) void vscode.window.showInformationMessage(`Knowledge bundle ${r.bundle.version} installed from ${from}: ${r.bundle.findings.length} published finding(s).`);
    else void vscode.window.showWarningMessage(`Knowledge bundle refused (${from}): ${r.reasons.join(' ')}`);
  };
  const fail = (what: string, error: unknown) => void vscode.window.showErrorMessage(`${what}: ${error instanceof Error ? error.message : String(error)}`);
  context.subscriptions.push(
    vscode.window.createTreeView('psft.discoveries', { treeDataProvider: tree }),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('peoplesoft.intelligence') || e.affectsConfiguration('telemetry')) tree.refresh(); }),
    vscode.commands.registerCommand('psft.intelligence.refreshDiscoveries', () => tree.refresh()),
    vscode.commands.registerCommand('psft.intelligence.openDiscovery', async (sourceId?: string, id?: string) => {
      try {
        const source = (await sources()).find((s) => s.id === sourceId);
        if (source && id) await DiscoveryPanel.show(context, source, id, () => tree.refresh());
      } catch (error) { fail('Discovery', error); }
    }),
    vscode.commands.registerCommand('psft.intelligence.showDiscoveries', async () => {
      try {
        const all = await Promise.all((await sources()).map(async (s) => (await s.store.list()).map((f) => ({ s, f }))));
        const flat = all.flat();
        if (!flat.length) {
          void vscode.window.showInformationMessage('No discoveries recorded yet. Research tools record them, and PeopleSoft: Record Discovery from JSON; nothing is uploaded without your review.');
          return;
        }
        const pick = await vscode.window.showQuickPick(flat.map(({ s, f }) => ({
          label: f.title, description: `${f.localStatus} · ${f.confidence} · ${f.subsystem}`, detail: `${s.label} · ${f.id} · PeopleTools ${f.observedReleases.join(', ')}`, sid: s.id, id: f.id
        })), { title: `Discoveries (${flat.length})`, matchOnDescription: true, matchOnDetail: true });
        if (pick) await vscode.commands.executeCommand('psft.intelligence.openDiscovery', pick.sid, pick.id);
      } catch (error) { fail('Discoveries', error); }
    }),
    vscode.commands.registerCommand('psft.intelligence.recordFromEditor', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { void vscode.window.showInformationMessage('Open a finding as JSON (psft-finding/1 input: docs/intelligence/FINDING_SCHEMA.md) first.'); return; }
      try {
        const r = await (await discoveryStore(context)).record({ source: 'manual', ...JSON.parse(editor.document.getText()) });
        tree.refresh();
        const open = await vscode.window.showInformationMessage(`Discovery ${r.outcome}: ${r.finding.id} (${r.finding.localStatus}). Recorded on this installation only.`, 'Open');
        if (open) await vscode.commands.executeCommand('psft.intelligence.openDiscovery', 'installation', r.finding.id);
      } catch (error) {
        if (error instanceof SyntaxError) fail('Record Discovery', new Error(`The editor does not hold JSON (${error.message}).`));
        else if (error instanceof DiscoveryInputError || error instanceof PrivacyRejectedError) fail('Record Discovery', error);
        else fail('Record Discovery', error);
      }
    }),
    vscode.commands.registerCommand('psft.intelligence.installKnowledgeFromFile', async () => {
      const [file] = await vscode.window.showOpenDialog({ title: 'Install Knowledge Bundle', filters: { 'Knowledge bundle': ['json'] }, canSelectMany: false }) ?? [];
      if (!file) return;
      try { await report(await (await knowledgeStore(context)).install(JSON.parse(await readFile(file.fsPath, 'utf8'))), 'file'); } catch (error) { fail('Install Knowledge Bundle', error); }
    }),
    vscode.commands.registerCommand('psft.intelligence.checkKnowledgeUpdates', async () => {
      // Download only, and only when chosen: knowledgeSync "manual", an HTTPS server (plain HTTP only to this machine).
      const c = vscode.workspace.getConfiguration('peoplesoft.intelligence');
      if (c.get<string>('knowledgeSync', 'off') !== 'manual') { void vscode.window.showInformationMessage('Knowledge updates are off (peoplesoft.intelligence.knowledgeSync).'); return; }
      let url: URL;
      try { url = new URL(`${c.get<string>('serverUrl', '').replace(/\/+$/, '')}/api/v1/knowledge/latest`); } catch { void vscode.window.showWarningMessage('No valid discovery server is set (peoplesoft.intelligence.serverUrl).'); return; }
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) { void vscode.window.showWarningMessage('The discovery server must use HTTPS.'); return; }
      try {
        const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (res.status === 404) { void vscode.window.showInformationMessage('The server has published no knowledge bundle yet.'); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await report(await (await knowledgeStore(context)).install(await res.json()), url.origin);
      } catch (error) { fail('Check for Knowledge Updates', error); }
    }),
    vscode.commands.registerCommand('psft.intelligence.setServerToken', async () => {
      const token = await vscode.window.showInputBox({ title: 'Discovery Server Token', prompt: 'The contributor token your discovery server issued. Kept in VS Code\'s secret storage; never written to settings or logs.', password: true, ignoreFocusOut: true });
      if (!token?.trim()) return;
      await context.secrets.store(TOKEN_KEY, token.trim());
      void vscode.window.showInformationMessage('Discovery server token saved in secret storage.');
    }),
    vscode.commands.registerCommand('psft.intelligence.clearServerToken', async () => {
      await context.secrets.delete(TOKEN_KEY);
      void vscode.window.showInformationMessage('Discovery server token removed.');
    })
  );
}
