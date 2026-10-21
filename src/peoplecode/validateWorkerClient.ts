import { Worker } from 'node:worker_threads';
import type { Validation } from './validate.js';
import type { ValidationRequest, ValidationRunner } from './liveValidation.js';

/** Runs validations one at a time on a worker thread (validateWorker.ts), started when first needed. */
export class WorkerValidationRunner implements ValidationRunner {
  private worker: Worker | undefined;
  private sequence = 0;
  private readonly pending = new Map<number, { resolve: (v: Validation) => void; reject: (e: Error) => void }>();

  constructor(private readonly script: string) {}

  run(request: ValidationRequest): Promise<Validation> {
    const worker = this.ensure();
    const id = ++this.sequence;
    return new Promise<Validation>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // A run in progress holds the process open; an idle thread never does.
      worker.ref();
      worker.postMessage({ id, request });
    });
  }

  restart(): void {
    this.stop(new Error('Validation restarted for newer text.'));
  }

  dispose(): void {
    this.stop(new Error('Validation stopped.'));
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.script);
    worker.on('message', (message: { id: number; result?: Validation; error?: string }) => {
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (!this.pending.size) worker.unref();
      if (message.result) waiting.resolve(message.result);
      else waiting.reject(new Error(message.error ?? 'Validation failed.'));
    });
    worker.on('error', (error) => { if (this.worker === worker) this.stop(error); });
    worker.on('exit', () => { if (this.worker === worker) this.stop(new Error('The validation thread stopped.')); });
    worker.unref();
    this.worker = worker;
    return worker;
  }

  private stop(reason: Error): void {
    const worker = this.worker;
    this.worker = undefined;
    for (const waiting of this.pending.values()) waiting.reject(reason);
    this.pending.clear();
    void worker?.terminate();
  }
}
