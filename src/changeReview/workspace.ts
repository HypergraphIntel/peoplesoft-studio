import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { ReviewService } from './service.js';
import type { ChangeSet } from './model.js';
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export class ReviewWorkspace implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private selected?: string;
    private object?: string;
    private message = '';
    private readonly registration: vscode.Disposable;
    private readonly indicator: vscode.StatusBarItem;
    constructor(readonly service: ReviewService) {
        this.indicator = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
        this.indicator.command = 'psft.changeReview.open';
        this.indicator.tooltip = 'Open persistent Change Review and verified history';
        void this.refreshIndicator();
        this.registration = vscode.workspace.registerTextDocumentContentProvider('psft-review', {
            provideTextDocumentContent: async (uri) => { const value = await service.store.readBlob(uri.path.slice(1)); return value && typeof value === 'object' && !Array.isArray(value) && typeof value.text === 'string' ? value.text : JSON.stringify(value, null, 2); }
        });
    }
    dispose(): void { this.panel?.dispose(); this.registration.dispose(); this.indicator.dispose(); }
    private async refreshIndicator(): Promise<void> {
        try {
            const sets = await this.service.store.list();
            const pending = sets.filter(s => !['APPLIED', 'CANCELLED', 'REJECTED', 'REVERTED'].includes(s.status)).length;
            this.indicator.text = '$(git-pull-request) Review: ' + pending;
            this.indicator.show();
        }
        catch {
            this.indicator.text = '$(warning) Review storage unavailable';
            this.indicator.show();
        }
    }
    changed(): void {
        void this.refreshIndicator();
        if (this.panel)
            void this.render().catch(e => { this.message = String(e); });
    }
    async show(id?: string): Promise<void> {
        if (id)
            this.selected = id;
        if (this.panel) {
            this.panel.reveal();
            await this.render();
            return;
        }
        this.panel = vscode.window.createWebviewPanel('psft.changeReview', 'PeopleSoft Change Review', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
        this.panel.onDidDispose(() => { this.panel = undefined; });
        this.panel.webview.onDidReceiveMessage((message: unknown) => { void this.action(message).catch(async (e) => { this.message = e instanceof Error ? e.message : String(e); await this.render(); }); });
        await this.render();
    }
    async compareRevisions(): Promise<void> {
        const sets = await this.service.store.list();
        const revisions = sets.flatMap(set => set.objects.filter(c => c.application === 'VERIFIED' && !!c.verified).map(c => ({
            label: set.title + ' · ' + c.adapter + ' · ' + JSON.stringify(c.key),
            description: set.environment.label + ' · ' + set.updated,
            snapshot: c.verified!, environment: set.environment.identity, connection: set.environment.connection,
            adapter: c.adapter, key: JSON.stringify(c.key)
        })));
        const left = await vscode.window.showQuickPick(revisions, { title: 'Compare Object Revisions: first revision' });
        if (!left)
            return;
        const right = await vscode.window.showQuickPick(revisions.filter(r => r.environment === left.environment && r.connection === left.connection && r.adapter === left.adapter && r.key === left.key), { title: 'Compare Object Revisions: second revision' });
        if (!right)
            return;
        await vscode.commands.executeCommand('vscode.diff', vscode.Uri.parse('psft-review:/' + left.snapshot), vscode.Uri.parse('psft-review:/' + right.snapshot), left.label + ' ↔ ' + right.label);
    }
    private async action(raw: unknown): Promise<void> {
        if (!raw || typeof raw !== 'object')
            throw new Error('Invalid review action.');
        const m = raw as Record<string, unknown>;
        this.message = '';
        if (m.action === 'select' && typeof m.id === 'string') {
            this.selected = m.id;
            this.object = undefined;
            await this.render();
            return;
        }
        if (!this.selected || m.id !== this.selected)
            throw new Error('Select a current Change Set.');
        const set = await this.service.store.get(this.selected);
        if (m.revision !== set.revision)
            throw new Error('Review page is stale. Refresh before acting.');
        const selected = typeof m.object === 'string' ? set.objects.find(c => c.id === m.object) : undefined;
        if (m.action === 'approvePlan' || m.action === 'rejectPlan') {
            await this.service.reviewPlan(set.id, m.action === 'approvePlan' ? 'APPROVED' : 'REJECTED', set.revision);
        }
        else if (m.action === 'object') {
            if (!selected)
                throw new Error('Object not found.');
            this.object = selected.id;
        }
        else if (m.action === 'validate')
            await this.service.validate(set.id);
        else if (m.action === 'approve' || m.action === 'reject') {
            const ids = selected ? [selected.id] : set.objects.filter(c => c.review !== 'REJECTED' || m.action === 'reject').map(c => c.id);
            await this.service.review(set.id, ids, m.action === 'approve' ? 'APPROVED' : 'REJECTED', set.revision, m.destructive === true);
        }
        else if (m.action === 'apply')
            await this.service.apply(set.id);
        else if (m.action === 'cancel')
            await this.service.cancel(set.id);
        else if (m.action === 'recover')
            await this.service.recover(set.id);
        else if (m.action === 'reverse' || m.action === 'redo') {
            const next = m.action === 'redo' ? await this.service.redo(set.id) : await this.service.reverse(set.id);
            this.selected = next.id;
            this.object = undefined;
        }
        else if (m.action === 'diff') {
            if (!selected)
                throw new Error('Select an object.');
            await vscode.commands.executeCommand('vscode.diff', vscode.Uri.parse('psft-review:/' + selected.before), vscode.Uri.parse('psft-review:/' + selected.after), 'Before ↔ Proposed · ' + selected.adapter);
        }
        else if (m.action === 'export') {
            const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(set.id + '.change-review.json'), filters: { JSON: ['json'] } });
            if (uri)
                await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify({ schema: 'psft-change-report/1', changeSet: set, objects: await Promise.all(set.objects.map(c => this.service.diff(set.id, c.id))) }, null, 2)));
        }
        else
            throw new Error('Unknown review action.');
        await this.render();
    }
    private async render(): Promise<void> {
        const panel = this.panel;
        if (!panel)
            return;
        const sets = await this.service.store.list();
        let set: ChangeSet | undefined = sets.find(s => s.id === this.selected);
        if (!set) {
            set = sets[0];
            this.selected = set?.id;
        }
        const selected = set?.objects.find(c => c.id === this.object) ?? set?.objects[0];
        this.object = selected?.id;
        const diff = set && selected ? await this.service.diff(set.id, selected.id) : undefined;
        const reversal = set ? await this.service.reversalSupport(set) : { supported: false, reason: '' };
        const nonce = randomBytes(18).toString('hex');
        const button = (label: string, action: string, enabled = true, object?: string) => `<button data-action="${action}"${object ? ` data-object="${esc(object)}"` : ''}${enabled ? '' : ' disabled'}>${esc(label)}</button>`;
        const reviewable = !!set && ['READY_FOR_REVIEW', 'APPROVED'].includes(set.status);
        const list = sets.map(s => `<button class="set" data-select="${esc(s.id)}">${esc(s.title)}<small>${esc(s.environment.label)} · ${esc(s.status)} · revision ${s.revision}</small></button>`).join('');
        const objects = set?.objects.map(c => `<button class="set" data-action="object" data-object="${c.id}">${esc(c.operation)} · ${esc(c.adapter)} · ${esc(JSON.stringify(c.key))}<small>${esc(c.review)} · ${esc(c.application)}</small></button>`).join('') ?? '';
        panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>
  body{font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);padding:16px}main{display:grid;grid-template-columns:minmax(200px,23%) 1fr;gap:20px}button{cursor:pointer;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:1px solid var(--vscode-panel-border);padding:7px;margin:3px}button:disabled{opacity:.45;cursor:default}.set{display:block;width:100%;text-align:left}small{display:block;margin-top:5px}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--vscode-panel-border);padding:10px}.compare{display:grid;grid-template-columns:1fr 1fr;gap:12px}h1,h2,h3{font-weight:500}.notice{color:var(--vscode-errorForeground)}label{display:block;margin:8px}</style></head><body>
  <h1>PeopleSoft Change Review</h1><p>Proposals are staged locally. Only reviewed revisions can be applied. Writers commit independently; partial and uncertain outcomes require recovery.</p><p class="notice" role="status">${esc(this.message)}</p>
  <main><aside><h2>Change Sets & history</h2><label>Filter by title/environment/status<input id="filter" type="search" aria-label="Filter Change Sets"></label>${list || '<p>No staged Change Sets.</p>'}</aside><section>${set ? `<h2>${esc(set.title)}</h2><p>${esc(set.environment.label)} · ${esc(set.status)} · revision ${set.revision} · ${esc(set.origin)}</p>
  ${set.plan ? `<h3>Implementation approach · ${esc(set.plan.review)}</h3><pre>${esc(set.plan.text)}</pre>${button('Approve approach', 'approvePlan', ['DRAFT', 'READY_FOR_REVIEW', 'APPROVED'].includes(set.status))}${button('Reject approach', 'rejectPlan', ['DRAFT', 'READY_FOR_REVIEW', 'APPROVED'].includes(set.status))}<p>Approach approval does not approve the resulting object definitions.</p>` : ''}
  ${button('Refresh and revalidate', 'validate', ['DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'CONFLICTED', 'FAILED'].includes(set.status))}
  ${button('Approve all eligible', 'approve', reviewable)}${button('Reject all', 'reject', reviewable)}${button('Apply approved changes', 'apply', set.status === 'APPROVED')}
  ${button('Cancel', 'cancel', ['DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'APPLYING'].includes(set.status))}${button('Reconcile live state', 'recover', ['APPLYING', 'PARTIALLY_APPLIED'].includes(set.status))}
  ${button('Prepare revert', 'reverse', reversal.supported)}${button('Prepare redo of reversal', 'redo', set.status === 'REVERTED' || reversal.supported && !!set.reverses)}${button('Export report', 'export')}
  <label><input id="destructive" type="checkbox">Explicitly approve destructive deletion operations</label><p>${esc(reversal.reason)}</p><h3>Objects</h3>${objects}
  ${selected && diff ? `<h3>${esc(selected.operation)} · ${esc(JSON.stringify(selected.key))}</h3><p>${esc(selected.operation === 'CREATE' ? 'NEW OBJECT — DOES NOT EXIST IN TARGET ENVIRONMENT' : selected.operation === 'DELETE' ? 'DELETE OBJECT' : 'UPDATE OBJECT')}</p>
  ${button('Approve object', 'approve', reviewable, selected.id)}${button('Reject object', 'reject', reviewable, selected.id)}${button('Open native diff', 'diff', selected.resultKnown !== false, selected.id)}
  <p>Dependencies: ${esc(selected.dependencies.join(', ') || 'None explicitly staged; external dependency closure is not established.')}</p>
  <pre>${esc([...selected.validation, ...selected.warnings].join('\n') || 'No recorded findings. Revalidate before approval.')}</pre>
  <div class="compare"><div><h3>Before</h3><pre>${esc(JSON.stringify(diff.before, null, 2))}</pre></div><div><h3>After</h3><pre>${esc(selected.resultKnown === false ? 'UNKNOWN — interrupted or in-progress manual save' : JSON.stringify(diff.after, null, 2))}</pre></div></div>
  <h3>Semantic/property differences</h3><pre>${esc(JSON.stringify(diff.differences, null, 2))}</pre>` : ''}
  <h3>Verified history and execution journal</h3><pre>${esc(JSON.stringify({ checkpoint: set.checkpoint ?? null, journal: set.journal }, null, 2))}</pre>` : '<p>Use the MCP Change Set tools to stage a supported proposal.</p>'}</section></main>
  <script nonce="${nonce}">const vscode=acquireVsCodeApi();document.getElementById('filter')?.addEventListener('input',e=>document.querySelectorAll('[data-select]').forEach(b=>b.hidden=!b.textContent.toLowerCase().includes(e.target.value.toLowerCase())));document.querySelectorAll('[data-select]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({action:'select',id:b.dataset.select})));document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({action:b.dataset.action,id:${JSON.stringify(set?.id ?? '')},revision:${set?.revision ?? 0},object:b.dataset.object,destructive:document.getElementById('destructive')?.checked===true})));</script></body></html>`;
    }
}
