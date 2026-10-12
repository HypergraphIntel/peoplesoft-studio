import { CiEditError, validateCi, type CiBuffer, type CiDiagnostic, type CiDocument } from './ciDocument.js';
import { applyCiOperation, type CiOperation } from './ciOperations.js';

/*
 * The CI Designer's session: the document being edited, its concurrency
 * token, the component's buffer, and undo / redo of the window's edits
 * (ciOperations.ts), each applied with App Designer's rules (ciDocument.ts).
 */
export class CiSession {
  private past: CiDocument[] = [];
  private future: CiDocument[] = [];
  private saved: CiDocument;

  constructor(public doc: CiDocument, public token: string, public buffer: CiBuffer | undefined) {
    this.saved = doc;
  }

  get dirty(): boolean { return this.doc !== this.saved; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  apply(op: CiOperation): void {
    const next = applyCiOperation(this.doc, op, this.buffer, this.buffer?.actions ?? 0);
    if (next === this.doc) throw new CiEditError('Nothing changed.');
    this.past.push(this.doc);
    this.future = [];
    this.doc = next;
  }

  undo(): void { const d = this.past.pop(); if (d) { this.future.push(this.doc); this.doc = d; } }
  redo(): void { const d = this.future.pop(); if (d) { this.past.push(this.doc); this.doc = d; } }

  /** After a save or reload: the stored interface, nothing to undo. */
  reset(doc: CiDocument, token: string, buffer?: CiBuffer): void {
    this.doc = doc;
    this.saved = doc;
    this.token = token;
    if (buffer) this.buffer = buffer;
    this.past = [];
    this.future = [];
  }

  diagnostics(): CiDiagnostic[] { return validateCi(this.doc, this.buffer); }
}
