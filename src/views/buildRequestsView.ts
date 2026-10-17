import * as vscode from 'vscode';
import { REQUEST_KINDS, status, STATUS_LABELS, type BuildRequest } from '../buildRequest/model.js';
import type { BuildRequestStore } from '../buildRequest/store.js';
import { BuildRequestPanel, type BuildRequestHost } from '../editors/buildRequestPanel.js';

/*
 * The Build Requests pane: every request with its status, newest first; New
 * Build Request starts one, choosing an entry opens its page.
 */

const ICONS: Record<ReturnType<typeof status>, string> = {
  DRAFT: 'edit', QUESTIONS: 'question', SPEC_PROPOSED: 'checklist', CHANGES_REQUESTED: 'comment-discussion', SPEC_STALE: 'warning',
  APPROVED: 'pass', BUILDING: 'loading~spin', BUILT: 'pass-filled'
};

class BuildRequestsView implements vscode.TreeDataProvider<BuildRequest> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(private readonly store: BuildRequestStore) {}
  refresh(): void { this.changed.fire(); }
  getChildren(node?: BuildRequest): Promise<BuildRequest[]> | BuildRequest[] { return node ? [] : this.store.list(); }
  getTreeItem(r: BuildRequest): vscode.TreeItem {
    const s = status(r);
    const item = new vscode.TreeItem(r.title, vscode.TreeItemCollapsibleState.None);
    item.id = r.id;
    item.description = STATUS_LABELS[s];
    item.iconPath = new vscode.ThemeIcon(ICONS[s]);
    item.tooltip = `${REQUEST_KINDS[r.kind].label}${r.connection ? ` · ${r.connection}` : ''}\n${STATUS_LABELS[s]}\n${r.attachments.length} attachment(s) · updated ${new Date(r.updatedAt).toLocaleString()}`;
    item.contextValue = 'buildRequest';
    item.command = { command: 'psft.buildRequest.open', title: 'Open Build Request', arguments: [r.id] };
    return item;
  }
}

export function registerBuildRequests(context: vscode.ExtensionContext, host: BuildRequestHost): void {
  const view = new BuildRequestsView(host.store);
  const changes = host.store.onDidChange(() => view.refresh());
  context.subscriptions.push(
    { dispose: () => changes.dispose() },
    vscode.window.registerTreeDataProvider('psft.buildRequests', view),
    vscode.commands.registerCommand('psft.buildRequest.new', async () => {
      const kind = await vscode.window.showQuickPick(Object.entries(REQUEST_KINDS).map(([value, k]) => ({ label: k.label, detail: k.summary, value })),
        { title: 'New Build Request', placeHolder: 'What kind of thing is being asked for?' });
      if (!kind) return;
      const title = await vscode.window.showInputBox({ title: 'New Build Request', prompt: 'A short name for the request', placeHolder: 'e.g. Vendor bank file load', validateInput: (v) => v.trim() ? undefined : 'Give it a name.' });
      if (!title) return;
      const connections = host.connections();
      const r = await host.store.create({ title: title.trim(), kind: kind.value as BuildRequest['kind'], ...(connections.length === 1 ? { connection: connections[0] } : {}) });
      BuildRequestPanel.show(host, r.id);
    }),
    vscode.commands.registerCommand('psft.buildRequest.open', async (id?: unknown) => {
      if (typeof id === 'string') { BuildRequestPanel.show(host, id); return; }
      const requests = await host.store.list();
      if (!requests.length) { await vscode.commands.executeCommand('psft.buildRequest.new'); return; }
      const pick = await vscode.window.showQuickPick(requests.map((r) => ({ label: r.title, description: STATUS_LABELS[status(r)], detail: REQUEST_KINDS[r.kind].label, id: r.id })),
        { title: 'Open Build Request' });
      if (pick) BuildRequestPanel.show(host, pick.id);
    }),
    vscode.commands.registerCommand('psft.buildRequest.delete', async (node?: BuildRequest) => {
      if (!node?.id) return;
      const pick = await vscode.window.showWarningMessage(`Delete build request "${node.title}" and its ${node.attachments.length} attachment(s)?`,
        { modal: true, detail: 'Nothing in PeopleSoft is changed.' }, 'Delete');
      if (pick === 'Delete') await host.store.delete(node.id);
    }),
    vscode.commands.registerCommand('psft.buildRequest.refresh', () => view.refresh())
  );
}
