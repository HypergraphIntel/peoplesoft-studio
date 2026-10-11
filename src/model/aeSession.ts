import type { ActionType } from './appEngine.js';
import {
  AeEditError, changeActionType, editedText, checkName, deleteAction, deleteSection, deleteStep, findAction, findSection, findStep, findVariant,
  insertAction, insertSection, insertStep, moveStep, pasteStep, renameSection, renameStep, setApplicationLibrary,
  type ActionRef, type AeDocAction, type AeDocProgram, type AeDocStep, type AeDocument, type AeVariantKey, type StepRef
} from './aeDocument.js';
import { validateAppEngine, type AeDiagnostic } from './aeValidation.js';

/*
 * An editing session on one App Engine document, shared by the App Engine
 * Designer and the MCP tools: edits are operations (AeOp) applied by the
 * document's own functions (aeDocument.ts), so every editor makes App
 * Designer's changes; the session keeps undo / redo history and knows
 * whether the document differs from what was last read or saved.
 */

export type AeOp =
  | { kind: 'setProgram'; patch: Partial<Omit<AeDocProgram, 'version' | 'lastUpdated' | 'lastUpdatedBy' | 'library'>> }
  | { kind: 'setLibrary'; library: boolean }
  | { kind: 'setStateRecords'; records: { record: string; isDefault: boolean }[] }
  | { kind: 'setTempTables'; tables: string[] }
  | { kind: 'setSection'; section: string; patch: { type?: string; isPublic?: boolean } }
  | { kind: 'setVariant'; section: string; variant?: AeVariantKey; patch: Partial<AeVariantKey & { active: boolean; descr: string; descrlong: string | null; autoCommit: string }> }
  | { kind: 'setStep'; ref: StepRef; patch: Partial<Omit<AeDocStep, 'name' | 'actions' | 'origin'>> }
  | { kind: 'setAction'; ref: ActionRef; patch: Partial<Omit<AeDocAction, 'type' | 'origin'>> }
  | { kind: 'insertSection'; name?: string }
  | { kind: 'insertStep'; section: string; variant?: AeVariantKey; after?: string; name?: string; actions?: ActionType[] }
  | { kind: 'insertAction'; ref: StepRef; type?: ActionType }
  | { kind: 'changeActionType'; ref: ActionRef; type: ActionType }
  | { kind: 'deleteSection'; section: string; variant?: AeVariantKey }
  | { kind: 'deleteStep'; ref: StepRef }
  | { kind: 'deleteAction'; ref: ActionRef }
  | { kind: 'renameSection'; from: string; to: string }
  | { kind: 'renameStep'; ref: StepRef; to: string }
  | { kind: 'moveStep'; ref: StepRef; after?: string }
  | { kind: 'pasteStep'; step: AeDocStep; target: { section: string; variant?: AeVariantKey; after?: string } };

const clone = <T>(v: T): T => structuredClone(v);
const CODE = /^[A-Z0-9]{0,3}$/;

/** Applies one operation; throws AeEditError when it cannot be made. */
export function applyOp(doc: AeDocument, op: AeOp): AeDocument {
  switch (op.kind) {
    case 'setProgram': {
      const next = clone(doc);
      const { patch } = op;
      if (patch.descr !== undefined && patch.descr.length > 30) throw new AeEditError('A description is at most 30 characters.');
      Object.assign(next.program, patch);
      return next;
    }
    case 'setLibrary': return setApplicationLibrary(doc, op.library);
    case 'setStateRecords': {
      const next = clone(doc);
      const seen = new Set<string>();
      next.stateRecords = op.records.map((r) => ({ record: r.record.trim().toUpperCase(), isDefault: r.isDefault })).filter((r) => r.record && !seen.has(r.record) && seen.add(r.record));
      return next;
    }
    case 'setTempTables': {
      const next = clone(doc);
      next.tempTables = [...new Set(op.tables.map((t) => t.trim().toUpperCase()).filter(Boolean))].sort();
      return next;
    }
    case 'setSection': {
      const next = clone(doc);
      const s = findSection(next, op.section);
      if (op.patch.isPublic === false && s.name === 'MAIN') throw new AeEditError('MAIN is always Public.');
      Object.assign(s, op.patch);
      return next;
    }
    case 'setVariant': {
      const next = clone(doc);
      const s = findSection(next, op.section);
      const v = findVariant(s, op.variant);
      const p = op.patch;
      if (p.market !== undefined && !CODE.test(p.market)) throw new AeEditError(`Market ${p.market} is not a market code.`);
      if (p.effdt !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(p.effdt)) throw new AeEditError(`Effective date ${p.effdt} is not YYYY-MM-DD.`);
      if (p.descr !== undefined && p.descr.length > 30) throw new AeEditError('A description is at most 30 characters.');
      const key = { market: p.market ?? v.market, dbType: p.dbType ?? v.dbType, effdt: p.effdt ?? v.effdt };
      if (s.variants.some((x) => x !== v && x.market === key.market && x.dbType === key.dbType && x.effdt === key.effdt)) {
        throw new AeEditError(`Section ${s.name} already has the variant ${key.market}.${key.dbType}.${key.effdt}.`);
      }
      Object.assign(v, p);
      return next;
    }
    case 'setStep': {
      const next = clone(doc);
      const { step } = findStep(next, op.ref);
      if (op.patch.descr !== undefined && op.patch.descr.length > 30) throw new AeEditError('A description is at most 30 characters.');
      Object.assign(step, op.patch);
      return next;
    }
    case 'setAction': {
      const next = clone(doc);
      const { action } = findAction(next, op.ref);
      if (op.patch.descr !== undefined && op.patch.descr.length > 30) throw new AeEditError('A description is at most 30 characters.');
      const patch = { ...op.patch };
      // Edited SQL is stored as App Designer's editor stores it (flattened; XSLT verbatim); unchanged text stays as stored.
      if (patch.text !== undefined) patch.text = editedText(action.type, action.text, patch.text);
      Object.assign(action, patch);
      return next;
    }
    case 'insertSection': return insertSection(doc, op.name).doc;
    case 'insertStep': return insertStep(doc, op).doc;
    case 'insertAction': return insertAction(doc, { ...op.ref, ...(op.type ? { type: op.type } : {}) }).doc;
    case 'changeActionType': return changeActionType(doc, op.ref, op.type);
    case 'deleteSection': return deleteSection(doc, op.section, op.variant);
    case 'deleteStep': return deleteStep(doc, op.ref);
    case 'deleteAction': return deleteAction(doc, op.ref);
    case 'renameSection': return renameSection(doc, op.from, op.to);
    case 'renameStep': checkName(op.to, 8, 'step'); return renameStep(doc, op.ref, op.to);
    case 'moveStep': return moveStep(doc, op.ref, op.after);
    case 'pasteStep': return pasteStep(doc, op.step, op.target).doc;
  }
}

/** Where an operation leaves the selection: the node it created or renamed. */
export function selectionAfter(before: AeDocument, after: AeDocument, op: AeOp): SelectionRef | undefined {
  switch (op.kind) {
    case 'insertSection': return { section: after.sections.find((s) => !before.sections.some((b) => b.name === s.name))?.name ?? '' };
    case 'renameSection': return { section: op.to };
    case 'insertStep': case 'pasteStep': {
      const sec = op.kind === 'insertStep' ? op.section : op.target.section;
      const v = op.kind === 'insertStep' ? op.variant : op.target.variant;
      const was = new Set(findVariant(findSection(before, sec), v).steps.map((s) => s.name));
      const step = findVariant(findSection(after, sec), v).steps.find((s) => !was.has(s.name));
      return step ? { section: sec, ...(v ? { variant: v } : {}), step: step.name } : undefined;
    }
    case 'renameStep': return { ...op.ref, step: op.to };
    case 'insertAction': {
      const had = new Set(findStep(before, op.ref).step.actions.map((a) => a.type));
      const type = findStep(after, op.ref).step.actions.find((a) => !had.has(a.type))?.type;
      return type ? { ...op.ref, action: type } : undefined;
    }
    case 'changeActionType': return { ...op.ref, action: op.type };
    default: return undefined;
  }
}

export interface SelectionRef { section?: string; variant?: AeVariantKey; step?: string; action?: ActionType }

export class AeSession {
  private past: AeDocument[] = [];
  private future: AeDocument[] = [];
  private saved: string;

  constructor(public doc: AeDocument, public token: string, private readonly limit = 200) {
    this.saved = JSON.stringify(doc);
  }

  get dirty(): boolean { return JSON.stringify(this.doc) !== this.saved; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  apply(op: AeOp): AeDocument {
    const next = applyOp(this.doc, op);
    this.past.push(this.doc);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.doc = next;
    return next;
  }

  /** Replaces the document with one built elsewhere (an MCP tool's), as one undoable change. */
  replace(doc: AeDocument): void {
    this.past.push(this.doc);
    this.future = [];
    this.doc = doc;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.doc);
    this.doc = prev;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.doc);
    this.doc = next;
    return true;
  }

  /** After a save or a reload: the stored document is the new baseline; history is kept only on reload of the same text. */
  reset(doc: AeDocument, token: string): void {
    this.doc = doc;
    this.token = token;
    this.saved = JSON.stringify(doc);
    this.past = [];
    this.future = [];
  }

  diagnostics(): AeDiagnostic[] {
    return validateAppEngine(this.doc);
  }
}

export { AeEditError };
