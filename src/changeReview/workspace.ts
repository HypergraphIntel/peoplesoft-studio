import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { ReviewService } from './service.js';
import { canonical, type ChangeSet } from './model.js';
import type { ObjectTimeline } from './timeline.js';
import { renderPageComparison, PAGE_REVIEW_CSS, PAGE_REVIEW_SCRIPT } from './pageVisual.js';
import { completedFollowUp, reviewList, type ReviewList } from './navigation.js';
const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export class ReviewWorkspace implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private selected?: string;
    private object?: string;
    private listMode: ReviewList = 'all';
    private message = '';
    private renderVersion = 0;
    private timelineCheck?: ObjectTimeline;
    private pageHistoryComparison?: { historyHash: string; revisionId: string };
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
            const pending = reviewList(sets, 'pending').length;
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
    async show(id?: string, mode: ReviewList = 'all', object?: string): Promise<void> {
        this.listMode = id ? 'all' : mode;
        if (id) {
            this.selected = id;
            this.object = object;
        } else if (mode !== 'all') {
            this.selected = undefined;
            this.object = undefined;
        }
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
            adapter: c.adapter, key: canonical(c.key)
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
        if (m.action === 'listMode' && ['all', 'pending', 'history'].includes(String(m.mode))) {
            this.listMode = m.mode as ReviewList;
            this.selected = undefined;
            this.object = undefined;
            await this.render();
            return;
        }
        if (m.action === 'select' && typeof m.id === 'string') {
            this.listMode = 'all';
            this.selected = m.id;
            this.object = typeof m.object === 'string' ? m.object : undefined;
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
        else if (m.action === 'timelineLive') {
            if (!selected) throw new Error('Select an object.');
            this.timelineCheck = await this.service.objectTimeline(set.id, selected.id, true);
        }
        else if (m.action === 'timelineCompare') {
            if (!selected || typeof m.timelineRevision !== 'string') throw new Error('Select a retained revision.');
            const timeline = await this.service.objectTimeline(set.id, selected.id);
            const revision = timeline.revisions.find(r => r.id === m.timelineRevision);
            if (!revision) throw new Error('Revision is not in this object and environment history.');
            if (selected.adapter === 'page') this.pageHistoryComparison = { historyHash: timeline.historyHash, revisionId: revision.id };
            else await vscode.commands.executeCommand('vscode.diff', vscode.Uri.parse('psft-review:/' + timeline.baseline.snapshot), vscode.Uri.parse('psft-review:/' + revision.snapshot), 'First retained baseline ↔ ' + revision.title);
        }
        else if (m.action === 'validate')
            await this.service.validate(set.id);
        else if (m.action === 'approve' || m.action === 'reject') {
            const ids = selected ? [selected.id] : set.objects.filter(c => c.review !== 'REJECTED' || m.action === 'reject').map(c => c.id);
            await this.service.review(set.id, ids, m.action === 'approve' ? 'APPROVED' : 'REJECTED', set.revision, m.destructive === true);
        }
        else if (m.action === 'apply' || m.action === 'applyOne')
            await this.service.apply(set.id, m.action === 'applyOne');
        else if (m.action === 'cancel')
            await this.service.cancel(set.id);
        else if (m.action === 'recover')
            await this.service.recover(set.id);
        else if (m.action === 'remaining') {
            const next = await this.service.prepareRemaining(set.id);
            this.selected = next.id;
            this.object = undefined;
        }
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
        const version = ++this.renderVersion;
        const selection = this.selected, object = this.object, mode = this.listMode;
        const sets = await this.service.store.list();
        // A background refresh may finish after navigation selected another set.
        if (version !== this.renderVersion || this.panel !== panel) return;
        const visibleSets = reviewList(sets, mode);
        let set: ChangeSet | undefined = visibleSets.find(s => s.id === selection);
        if (!set) {
            set = visibleSets[0];
            this.selected = set?.id;
        }
        const selected = set?.objects.find(c => c.id === object) ?? set?.objects[0];
        this.object = selected?.id;
        const diff = set && selected ? await this.service.diff(set.id, selected.id) : undefined;
        const timeline = set && selected ? await this.service.objectTimeline(set.id, selected.id) : undefined;
        const pageRevision = timeline?.historyHash === this.pageHistoryComparison?.historyHash ? timeline?.revisions.find(r => r.id === this.pageHistoryComparison?.revisionId) : undefined;
        const pageHistory = timeline && selected?.adapter === 'page' && pageRevision
            ? renderPageComparison(await this.service.store.readBlob(timeline.baseline.snapshot), await this.service.store.readBlob(pageRevision.snapshot), 'history-', 'Recorded history: first retained baseline ↔ ' + pageRevision.title) : '';
        if (timeline && this.timelineCheck?.historyHash === timeline.historyHash) timeline.live = this.timelineCheck.live;
        const reversal = set ? await this.service.reversalSupport(set) : { supported: false, reason: '' };
        const completed = set ? completedFollowUp(set, sets) : undefined;
        const remaining = set ? this.service.remainingSupport(set) : { supported: false, reason: '' };
        const nonce = randomBytes(18).toString('hex');
        const button = (label: string, action: string, enabled = true, object?: string) => `<button data-action="${action}"${object ? ` data-object="${esc(object)}"` : ''}${enabled ? '' : ' disabled'}>${esc(label)}</button>`;
        const reviewable = !!set && ['READY_FOR_REVIEW', 'APPROVED'].includes(set.status);
        const canPause = set?.status === 'APPROVED' && set.objects.filter(c => c.review === 'APPROVED').length > 1;
        const showPause = !!set && !set.reverses && set.objects.length > 1 && ['DRAFT', 'VALIDATING', 'READY_FOR_REVIEW', 'APPROVED', 'CONFLICTED', 'FAILED'].includes(set.status);
        const pauseHelp = canPause ? 'Stops after the first verified object. Remaining work needs a fresh proposal and approval.'
            : reviewable ? 'Approve at least two objects to enable this action.' : 'Validate the proposal, then approve at least two objects to enable this action.';
        const list = visibleSets.map(s => `<button class="set" aria-current="${s.id === set?.id}" data-select="${esc(s.id)}">${esc(s.title)}<small>${esc(s.environment.label)} · ${esc(completedFollowUp(s, sets) ? 'COMPLETED VIA FOLLOW-UP' : s.status)} · revision ${s.revision}</small></button>`).join('');
        const objects = set?.objects.map(c => `<button class="set" aria-current="${c.id === selected?.id}" data-action="object" data-object="${c.id}">${esc(c.operation)} · ${esc(c.adapter)} · ${esc(JSON.stringify(c.key))}<small>${esc(c.review)} · ${esc(c.application)}</small></button>`).join('') ?? '';
        const historyLink = (setId: string, objectId: string, label: string) => `<button data-select="${esc(setId)}" data-select-object="${esc(objectId)}">${esc(label)}</button>`;
        const timelineHtml = timeline && selected ? `<h3>Object revision timeline</h3><p>${esc(timeline.environment.label)} · ${esc(timeline.adapter)} · ${esc(JSON.stringify(timeline.key))}</p>
          <p>Retained local observations only; external changes may be missing. Baseline means the before-state of the first retained proposal, not the original delivered definition.</p>
          ${button('Check live revision', 'timelineLive', true, selected.id)}<p role="status">${esc(timeline.live.status)}${timeline.live.checkedAt ? ' · checked ' + esc(timeline.live.checkedAt) : ' · live state has not been checked'}${timeline.live.reason ? ' · ' + esc(timeline.live.reason) : ''}</p>
          <ol reversed>${[...timeline.revisions].reverse().map(r => `<li><strong>${esc(r.title)}</strong> · ${esc(r.operation)} · ${esc(r.origin)} · ${esc(r.status)}<small>Readback verified ${esc(r.at)}${timeline.live.status === 'MATCHES_RECORDED' && timeline.live.matched === r.id ? ' · Live matched at the check above' : ''}${r.continuity === 'GAP' ? ' · GAP: preceding retained content/token does not match this checkpoint' : ''}${r.reverses ? ' · Reverses Change Set ' + esc(r.reverses) : ''}</small>${historyLink(r.changeSetId, r.objectId, 'Open recorded change')}<button data-action="timelineCompare" data-object="${esc(selected.id)}" data-timeline-revision="${esc(r.id)}">Compare with baseline</button></li>`).join('')}
          <li><strong>First retained baseline</strong><small>Proposal created ${esc(timeline.baseline.at)}${timeline.live.status === 'MATCHES_RECORDED' && timeline.live.matched === 'baseline' ? ' · Live matched at the check above' : ''}</small>${historyLink(timeline.baseline.changeSetId, timeline.baseline.objectId, 'Open baseline proposal')}</li></ol>
          <h4>Other proposals and uncertain outcomes</h4>${timeline.proposals.length ? timeline.proposals.map(p => `<p>${historyLink(p.changeSetId, p.objectId, p.title)} · ${esc(p.status)} · ${esc(p.review)} · ${esc(p.application)}${p.resultKnown ? '' : ' · After-state unknown'}</p>`).join('') : '<p>None recorded.</p>'}` : '';
        // Diff/timeline reads can also finish after a newer render has started.
        if (version !== this.renderVersion || this.panel !== panel) return;
        panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>
  body{font-family:var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);padding:16px}main{display:grid;grid-template-columns:minmax(180px,23%) minmax(0,1fr);gap:20px}button{cursor:pointer;color:var(--vscode-button-secondaryForeground,var(--vscode-editor-foreground));background:var(--vscode-button-secondaryBackground,transparent);border:1px solid var(--vscode-panel-border);padding:7px;margin:3px}button:disabled{opacity:.45;cursor:default}.set{display:block;box-sizing:border-box;width:calc(100% - 6px);overflow-wrap:anywhere;text-align:left;background:transparent;color:var(--vscode-editor-foreground);border-color:transparent;border-radius:3px}.set[aria-current="true"]{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground);border-color:var(--vscode-focusBorder)}button:hover:enabled{background:var(--vscode-button-secondaryHoverBackground)}button:focus-visible,summary:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}button[data-action="apply"],body[data-review-status="READY_FOR_REVIEW"] .review-actions>button[data-action="approve"]{color:var(--vscode-button-foreground);background:var(--vscode-button-background)}small{display:block;margin-top:5px}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--vscode-panel-border);padding:10px}.compare{display:grid;grid-template-columns:1fr 1fr;gap:12px}h1,h2,h3{font-weight:500}.review-actions{display:flex;gap:6px;align-items:start;flex-wrap:wrap}.review-more{border:1px solid var(--vscode-panel-border);padding:8px;margin:3px}.review-more summary{cursor:pointer}.review-more>div{display:flex;flex-direction:column;max-width:340px}.review-more p{margin:4px}nav button[aria-pressed="true"]{outline:1px solid var(--vscode-focusBorder)}.notice{color:var(--vscode-errorForeground)}label{display:block;margin:8px}${PAGE_REVIEW_CSS}@media(max-width:760px){main{grid-template-columns:1fr}aside{max-height:240px;overflow:auto}.compare{grid-template-columns:1fr}}</style></head><body data-review-status="${esc(set?.status)}">
  <h1>PeopleSoft Change Review</h1><p>Proposals are staged locally. Only reviewed revisions can be applied. Writers commit independently; partial and uncertain outcomes require recovery.</p><p class="notice" role="status">${esc(this.message)}</p>
  <main><aside><h2>Change Sets & history</h2><nav aria-label="Change Set list">${(['all', 'pending', 'history'] as const).map(mode => `<button data-list-mode="${mode}" aria-pressed="${this.listMode === mode}">${mode === 'all' ? 'All' : mode === 'pending' ? 'Pending' : 'History'}</button>`).join('')}</nav><label>Filter by title/environment/status<input id="filter" type="search" aria-label="Filter Change Sets"></label>${list || '<p>No changes in this view.</p>'}</aside><section>${set ? `<h2>${esc(set.title)}</h2><p>${esc(set.environment.label)} · ${esc(set.status)} · revision ${set.revision} · ${esc(set.origin)}</p>
  ${set.continuation ? `<h3>Continuation of a partial application</h3>${historyLink(set.continuation.changeSetId, '', 'Open original partial application')}<p>The original partial record is retained. This proposal writes only the remaining objects, after fresh review.</p><h4>Already verified prerequisites — excluded from writes</h4>${set.continuation.prerequisites.map(p => `<p>${esc(p.adapter)} · ${esc(JSON.stringify(p.key))} · pinned to its verified content and native token ${historyLink(p.changeSetId, p.objectId, 'Open verified prerequisite')}</p>`).join('') || '<p>None recorded.</p>'}` : ''}
  ${sets.filter(s => s.continuation?.changeSetId === set.id).map(s => `<p>Remaining-work follow-up: ${historyLink(s.id, '', s.title)} · ${esc(s.status)}</p>`).join('')}
  ${set.plan ? `<h3>Implementation approach · ${esc(set.plan.review)}</h3><pre>${esc(set.plan.text)}</pre>${['DRAFT', 'READY_FOR_REVIEW', 'APPROVED'].includes(set.status) ? button(set.plan.review === 'APPROVED' ? 'Approach approved' : 'Approve approach', 'approvePlan', set.plan.review !== 'APPROVED') + button(set.plan.review === 'REJECTED' ? 'Approach rejected' : 'Reject approach', 'rejectPlan', set.plan.review !== 'REJECTED') : ''}<p>Approach approval does not approve the resulting object definitions.</p>` : ''}
  ${completed ? `<p>Remaining work completed in ${historyLink(completed.id, '', completed.title)}. This original partial application is retained in history.</p>` : ''}
  <div class="review-actions" aria-label="Change Set actions">
  ${set.objects.length && ['DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'CONFLICTED', 'FAILED'].includes(set.status) ? button('Refresh and revalidate', 'validate') : ''}
  ${reviewable ? button('Approve all eligible', 'approve') : ''}${set.status === 'APPROVED' ? button('Apply approved changes', 'apply') : ''}
  ${!completed && ['APPLYING', 'PARTIALLY_APPLIED'].includes(set.status) ? button('Reconcile live state', 'recover') : ''}
  ${!completed && set.status === 'PARTIALLY_APPLIED' ? button('Prepare remaining work', 'remaining', remaining.supported) + `<p>${esc(remaining.reason)}</p>` : ''}
  <details class="review-more"><summary>More actions</summary><div>
  ${reviewable ? button('Reject all', 'reject') : ''}
  ${showPause ? button('Apply one object, then pause', 'applyOne', canPause) + `<p>${esc(pauseHelp)}</p>` : ''}
  ${set.status === 'APPLIED' ? button('Prepare revert', 'reverse', reversal.supported) + `<p>${esc(reversal.reason)}</p>` : ''}
  ${set.status === 'REVERTED' || reversal.supported && !!set.reverses ? button('Prepare redo of reversal', 'redo') : ''}
  ${button('Export report', 'export')}
  ${['DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'APPLYING'].includes(set.status) || set.status === 'CONFLICTED' && set.objects.every(c => c.application === 'PENDING') ? button('Cancel Change Set', 'cancel') : ''}
  </div></details></div>
  ${set.objects.some(c => c.operation === 'DELETE') ? '<label><input id="destructive" type="checkbox">Explicitly approve destructive deletion operations</label>' : ''}<h3>Objects</h3>${objects}
  ${selected && diff ? `<h3>${esc(selected.operation)} · ${esc(JSON.stringify(selected.key))}</h3><p>${esc(selected.operation === 'CREATE' ? (selected.application === 'VERIFIED' ? 'CREATE OBJECT — READBACK VERIFIED AT APPLICATION' : 'NEW OBJECT — ABSENT IN CAPTURED BASELINE') : selected.operation === 'DELETE' ? 'DELETE OBJECT' : 'UPDATE OBJECT')}</p>
  ${reviewable ? button('Approve object', 'approve', true, selected.id) + button('Reject object', 'reject', true, selected.id) : ''}${button('Open native diff', 'diff', selected.resultKnown !== false, selected.id)}
  <p>Dependencies: ${esc(selected.dependencies.join(', ') || 'None explicitly staged; external dependency closure is not established.')}</p>
  <pre>${esc([...selected.validation, ...selected.warnings].join('\n') || 'No recorded findings. Revalidate before approval.')}</pre>
  ${selected.adapter === 'page' ? renderPageComparison(diff.before, diff.after, 'proposal-', 'Selected change: before ↔ after', selected.resultKnown !== false) : ''}
  <details${selected.adapter === 'page' ? '' : ' open'}><summary>Exact native before/after snapshots</summary><div class="compare"><div><h3>Before</h3><pre>${esc(JSON.stringify(diff.before, null, 2))}</pre></div><div><h3>After</h3><pre>${esc(selected.resultKnown === false ? 'UNKNOWN — interrupted or in-progress manual save' : JSON.stringify(diff.after, null, 2))}</pre></div></div></details>
  <h3>Semantic/property differences</h3><pre>${esc(JSON.stringify(diff.differences, null, 2))}</pre>` : ''}
  ${timelineHtml}${pageHistory}<details><summary>Verified history and execution journal</summary><pre>${esc(JSON.stringify({ checkpoint: set.checkpoint ?? null, journal: set.journal }, null, 2))}</pre></details>` : '<p>Use the MCP Change Set tools to stage a supported proposal.</p>'}</section></main>
  <script nonce="${nonce}">const vscode=acquireVsCodeApi();${PAGE_REVIEW_SCRIPT}document.querySelectorAll('[data-list-mode]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({action:'listMode',mode:b.dataset.listMode})));document.getElementById('filter')?.addEventListener('input',e=>document.querySelectorAll('aside [data-select]').forEach(b=>b.hidden=!b.textContent.toLowerCase().includes(e.target.value.toLowerCase())));document.querySelectorAll('[data-select]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({action:'select',id:b.dataset.select,object:b.dataset.selectObject})));document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({action:b.dataset.action,id:${JSON.stringify(set?.id ?? '')},revision:${set?.revision ?? 0},object:b.dataset.object,timelineRevision:b.dataset.timelineRevision,destructive:document.getElementById('destructive')?.checked===true})));</script></body></html>`;
    }
}
