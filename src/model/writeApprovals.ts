import { randomUUID } from 'node:crypto';
import { WriteApprovalTimeoutError } from '../providers/writeGuard.js';

export type ApprovalState = 'PENDING' | 'APPROVED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';
export interface WriteApprovalRequest {
  id: string; title: string; detail: string; choices: string[];
  state: ApprovalState; createdAt: string; finishedAt?: string;
}

/** In-memory decisions for live requests only. History is display-only, never authorization. */
export class WriteApprovals {
  private readonly entries: WriteApprovalRequest[] = [];
  private readonly pending = new Map<string, (choice?: string) => void>();
  private readonly listeners = new Set<() => void>();
  list(): WriteApprovalRequest[] { return this.entries.map(r => ({ ...r, choices: [...r.choices] })); }
  onChange(listener: () => void): { dispose(): void } { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; }
  private changed(): void { for (const listener of this.listeners) listener(); }
  request(input: { title: string; detail: string; choices: string[] }, signal: AbortSignal): Promise<string | undefined> {
    if (signal.aborted) return Promise.resolve(undefined);
    if (!input.choices.length || new Set(input.choices).size !== input.choices.length) throw Error('Approval choices must be nonempty and unique.');
    const entry: WriteApprovalRequest = { ...input, choices: [...input.choices], id: randomUUID(), state: 'PENDING', createdAt: new Date().toISOString() };
    this.entries.unshift(entry);
    return new Promise(resolve => {
      const finish = (state: ApprovalState, choice?: string) => {
        if (entry.state !== 'PENDING') return;
        entry.state = state; entry.finishedAt = new Date().toISOString();
        this.pending.delete(entry.id); signal.removeEventListener('abort', abort);
        // Bound completed history without dropping live requests.
        const old = new Set(this.entries.filter(r => r.state !== 'PENDING').slice(100));
        for (let i = this.entries.length - 1; i >= 0; i--) if (old.has(this.entries[i])) this.entries.splice(i, 1);
        this.changed(); resolve(choice);
      };
      const abort = () => finish(signal.reason instanceof WriteApprovalTimeoutError ? 'EXPIRED' : 'CANCELLED');
      this.pending.set(entry.id, choice => finish(choice === undefined ? 'DECLINED' : 'APPROVED', choice));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort(); else this.changed();
    });
  }
  decide(id: string, choice?: string): boolean {
    const entry = this.entries.find(r => r.id === id), finish = this.pending.get(id);
    if (!entry || !finish || entry.state !== 'PENDING' || choice !== undefined && !entry.choices.includes(choice)) return false;
    finish(choice); return true;
  }
  dispose(): void { for (const entry of this.entries) if (entry.state === 'PENDING') this.decide(entry.id); this.listeners.clear(); }
}
