import type { DefinitionKey } from '../model/definitions.js';
import type { Validation } from './validate.js';

/*
 * Validate PeopleCode as you type: each PeopleCode editor's text is compiled
 * with Studio's compiler (validate.ts) a moment after typing stops, off the
 * extension host's thread (validateWorker.ts) -- a 600 KB application class
 * takes about four seconds. Only the latest text of a document counts: a
 * result for text that has since changed is dropped, and a worker still busy
 * with stale text after a while is restarted rather than waited for.
 */

export interface ValidationRequest {
  uri: string;
  /** The document version the text is from. */
  version: number;
  text: string;
  key: DefinitionKey;
  /** The connection's PeopleTools release, e.g. "8.62" (it picks the compiler profile). */
  release: string;
  /** The program record's fields, when known: bare names among them are qualified as App Designer qualifies them. */
  ownerFields?: string[];
}

export interface ValidationRunner {
  run(request: ValidationRequest): Promise<Validation>;
  /** Abandons whatever is running (its promise rejects) so the next run starts at once. */
  restart(): void;
  dispose(): void;
}

export interface LiveValidationOptions {
  /** Quiet time after the last change before compiling. */
  delayMs?: number;
  /** A run for text that has changed is abandoned after this long. */
  staleAfterMs?: number;
}

export class LiveValidator {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly queued = new Map<string, ValidationRequest>();
  private running: { request: ValidationRequest; started: number } | undefined;
  private staleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly delayMs: number;
  private readonly staleAfterMs: number;
  private disposed = false;

  constructor(
    private readonly runner: ValidationRunner,
    /** Receives a result for the text it was computed from; it is only called when that text is still the document's. */
    private readonly publish: (request: ValidationRequest, result: Validation) => void,
    /** Whether a document still has this version (a newer edit makes a result stale). */
    private readonly isCurrent: (uri: string, version: number) => boolean,
    options: LiveValidationOptions = {}
  ) {
    this.delayMs = options.delayMs ?? 500;
    this.staleAfterMs = options.staleAfterMs ?? 1500;
  }

  /** A document's text changed (or opened): compile it once typing pauses. */
  schedule(request: ValidationRequest): void {
    if (this.disposed) return;
    const pending = this.timers.get(request.uri);
    if (pending) clearTimeout(pending);
    this.timers.set(request.uri, setTimeout(() => {
      this.timers.delete(request.uri);
      this.queued.set(request.uri, request);
      this.next();
    }, this.delayMs));
    // A run for this document's older text is now wasted: give it a little longer, then restart the worker.
    if (this.running?.request.uri === request.uri && this.running.request.version !== request.version && !this.staleTimer) {
      const wait = Math.max(0, this.staleAfterMs - (Date.now() - this.running.started));
      this.staleTimer = setTimeout(() => {
        this.staleTimer = undefined;
        const r = this.running;
        if (r && !this.isCurrent(r.request.uri, r.request.version)) this.runner.restart();
      }, wait);
    }
  }

  /** The document closed: forget it. */
  cancel(uri: string): void {
    const pending = this.timers.get(uri);
    if (pending) clearTimeout(pending);
    this.timers.delete(uri);
    this.queued.delete(uri);
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.queued.clear();
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.runner.dispose();
  }

  private next(): void {
    if (this.running || this.disposed) return;
    const first = this.queued.entries().next();
    if (first.done) return;
    const [uri, request] = first.value;
    this.queued.delete(uri);
    if (!this.isCurrent(uri, request.version)) { this.next(); return; }
    this.running = { request, started: Date.now() };
    this.runner.run(request).then(
      (result) => { if (!this.disposed && this.isCurrent(uri, request.version)) this.publish(request, result); },
      () => { /* abandoned for newer text, or the worker failed: the next run reports */ }
    ).finally(() => {
      this.running = undefined;
      if (this.staleTimer) { clearTimeout(this.staleTimer); this.staleTimer = undefined; }
      this.next();
    });
  }
}
