import * as vscode from 'vscode';
import type { ReviewService } from '../changeReview/service.js';
import type { ChangeSet } from '../changeReview/model.js';
import { completedFollowUp, reviewList } from '../changeReview/navigation.js';

type Node = { kind: 'group'; mode: 'pending' | 'history'; count: number }
    | { kind: 'set'; set: ChangeSet; completedBy?: string }
    | { kind: 'message'; label: string; error?: boolean }
    | { kind: 'more' };

/** Navigation only. Approval and application stay in the revision-bound review workspace. */
export class ChangeReviewView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.emitter.event;
    constructor(private readonly service: ReviewService) {}
    refresh(): void { this.emitter.fire(); }
    dispose(): void { this.emitter.dispose(); }
    async getChildren(node?: Node): Promise<Node[]> {
        if (node && node.kind !== 'group') return [];
        try {
            const sets = await this.service.store.list();
            if (!node) return (['pending', 'history'] as const).map(mode => ({ kind: 'group', mode, count: reviewList(sets, mode).length }));
            const list = reviewList(sets, node.mode);
            if (!list.length) return [{ kind: 'message', label: node.mode === 'pending' ? 'No pending changes' : 'No recorded history' }];
            // Pending work is never truncated. Historical entries are newest first, as returned by the store.
            return [...(node.mode === 'history' ? list.slice(0, 20) : list).map(set => ({ kind: 'set' as const, set, completedBy: completedFollowUp(set, sets)?.id })),
                ...(node.mode === 'history' && list.length > 20 ? [{ kind: 'more' as const }] : [])];
        } catch {
            return [{ kind: 'message', label: 'Review storage unavailable — open Change Review for details', error: true }];
        }
    }
    getTreeItem(node: Node): vscode.TreeItem {
        if (node.kind === 'group') {
            const item = new vscode.TreeItem(node.mode === 'pending' ? 'Pending Changes' : 'History',
                node.mode === 'pending' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
            item.id = 'review:' + node.mode;
            item.description = String(node.count);
            item.iconPath = new vscode.ThemeIcon(node.mode === 'pending' ? 'git-pull-request' : 'history');
            return item;
        }
        if (node.kind === 'set') {
            const set = node.set;
            const item = new vscode.TreeItem(set.title);
            item.id = 'review:' + set.id;
            item.description = set.environment.label + ' · ' + (node.completedBy ? 'completed via follow-up' : set.status.toLowerCase().replaceAll('_', ' '));
            item.tooltip = `${set.title}\n${set.environment.label} · ${set.status} · revision ${set.revision}\nUpdated ${set.updated}`;
            item.iconPath = new vscode.ThemeIcon(node.completedBy ? 'check' : ['FAILED', 'CONFLICTED', 'PARTIALLY_APPLIED'].includes(set.status) ? 'warning'
                : set.status === 'APPLIED' ? 'check' : set.status === 'APPLYING' ? 'sync' : 'git-pull-request');
            item.command = { command: 'psft.changeReview.open', title: 'Open Change Review', arguments: [set.id] };
            return item;
        }
        const item = new vscode.TreeItem(node.kind === 'more' ? 'Open full history…' : node.label);
        item.iconPath = new vscode.ThemeIcon(node.kind === 'message' && node.error ? 'warning' : node.kind === 'more' ? 'history' : 'info');
        if (node.kind === 'more' || node.error) item.command = { command: node.kind === 'more' ? 'psft.changeReview.history' : 'psft.changeReview.open', title: 'Open Change Review' };
        return item;
    }
}
