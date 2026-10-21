import * as vscode from 'vscode';
import * as path from 'node:path';
import type { Workspace } from '../workspace.js';
import { DatabaseProvider } from '../providers/database.js';
import { DefinitionType, type DefinitionKey } from '../model/definitions.js';
import { SCHEME, parseUri } from '../util/uri.js';
import { lineAndColumn, type Qualification, type Validation } from './validate.js';
import { LiveValidator } from './liveValidation.js';
import { languageFeaturesOn } from './languageFeatures.js';
import { definitionExists, missingDefinitionProblems } from './definitionCheck.js';
import { WorkerValidationRunner } from './validateWorkerClient.js';

/** Validate PeopleCode's problems as diagnostics on the text they were found in (any line endings). */
function peopleCodeDiagnostics(text: string, v: Validation): vscode.Diagnostic[] {
  const normalized = text.replace(/\r\n/g, '\n');
  return v.problems.map((p) => {
    const at = lineAndColumn(normalized, p.offset);
    const start = new vscode.Position(at.line, at.column);
    const info = p.severity === 'info';
    const d = new vscode.Diagnostic(new vscode.Range(start, start.translate(0, Math.max(1, p.length ?? 1))),
      info ? p.message : `${p.message} (PeopleSoft Studio's compiler, ${v.profile}; Application Designer has the last word)`,
      info ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Warning);
    d.source = 'PeopleCode';
    if (p.code) d.code = p.code;
    return d;
  });
}

/** The record whose fields a PeopleCode program's bare names are (Record and Component Record [Field] PeopleCode). */
function ownerRecordOf(key: DefinitionKey): string | undefined {
  if (key.type === DefinitionType.RecordPeopleCode) return key.parts[0];
  if (key.type === DefinitionType.ComponentRecordPeopleCode || key.type === DefinitionType.ComponentRecordFieldPeopleCode) return key.parts[2];
  return undefined;
}

/** Editor lifecycle, environment checks and background validation shared by live and explicit validation. */
export function registerPeopleCodeValidation(context: vscode.ExtensionContext, workspace: Workspace) {
  let epoch = 0;
  const current = (doc: vscode.TextDocument, version: number, revision: number) =>
    revision === epoch && !doc.isClosed && doc.version === version && vscode.workspace.textDocuments.includes(doc);
  // Validate PeopleCode's results: as you type (liveValidation.ts) unless that is off, when they are cleared as soon as the text changes.
  const validationDiagnostics = vscode.languages.createDiagnosticCollection('psft-peoplecode-validate');
  const releaseByHandle = new Map<string, Promise<string | undefined>>();
  const releaseFor = (handle: string) => {
    let release = releaseByHandle.get(handle);
    if (!release) {
      const provider = workspace.getProviderByHandle(handle);
      if (!provider?.isConnected) return Promise.resolve(undefined);
      release = Promise.resolve(provider.readEnvironment?.()).then((e) => e?.toolsRelease, () => {
        releaseByHandle.delete(handle); return undefined;
      });
      releaseByHandle.set(handle, release);
    }
    return release;
  };
  // A record's fields (subrecords expanded) from the connection, kept a minute: bare names and RECORD.FIELD references are checked against them.
  const fieldCache = new Map<string, { at: number; fields: Promise<Set<string> | undefined> }>();
  const recordFields = (handle: string, record: string): Promise<Set<string> | undefined> => {
    const id = `${handle}|${record.toUpperCase()}`;
    const cached = fieldCache.get(id);
    if (cached && Date.now() - cached.at < 60_000) return cached.fields;
    const p = workspace.getProviderByHandle(handle);
    if (!(p instanceof DatabaseProvider) || !p.isConnected) return Promise.resolve(undefined);
    const fields = p.expandedFieldNames(record.toUpperCase())
      .then((f) => new Set(f.map((x) => x.toUpperCase())), () => {
        fieldCache.delete(id); return undefined;
      });
    fieldCache.set(id, { at: Date.now(), fields });
    return fields;
  };
  // Whether a definition exists on the connection, kept a minute: undefined when that cannot be told (no database, a failed or
  // truncated search -- names match with LIKE, so only an exact name in a complete result counts).
  const existsCache = new Map<string, { at: number; exists: Promise<boolean | undefined> }>();
  const cachedDefinitionExists = (handle: string, type: DefinitionType, name: string): Promise<boolean | undefined> => {
    const id = `${handle}|${type}|${name}`;
    const cached = existsCache.get(id);
    if (cached && Date.now() - cached.at < 60_000) return cached.exists;
    const p = workspace.getProviderByHandle(handle);
    if (!(p instanceof DatabaseProvider) || !p.isConnected) return Promise.resolve(undefined);
    const exists = definitionExists(p, type, name).then((found) => {
      if (found === undefined) existsCache.delete(id);
      return found;
    });
    existsCache.set(id, { at: Date.now(), exists });
    return exists;
  };
  // App Designer's "Field REC.FIELD not defined. (2,17)" for a reference the connection does not have (native Validate Syntax).
  const peoplecodeSetting = <T>(key: string, fallback: T) => vscode.workspace.getConfiguration('peoplesoft').get<T>(`peoplecode.${key}`) ?? fallback;
  // Settings > PeopleCode Editor: environment checks and unknown-function warnings can each be turned off.
  const checkEnvironment = () => peoplecodeSetting('checkEnvironment', true);
  const editorProblems = (v: Validation): Validation => peoplecodeSetting('unknownFunctionWarnings', true)
    ? v : { ...v, problems: v.problems.filter((p) => p.code !== 'unknown-function') };
  const referenceProblems = async (handle: string, v: Validation) => {
    const problems: Validation['problems'] = [];
    if (!checkEnvironment()) return problems;
    for (const r of v.fieldReferences ?? []) {
      const p = workspace.getProviderByHandle(handle);
      if (!(p instanceof DatabaseProvider)) break;
      const fields = await recordFields(handle, r.record);
      if (!fields || fields.has(r.field)) continue;
      problems.push({ offset: r.offset, length: r.record.length + 1 + r.field.length, code: 'field-not-defined', message: `Field ${r.record}.${r.field} not defined. (2,17)` });
    }
    // Record.X, Page.X, SQL.X ... that the connection lacks (definitionCheck.ts: a note, or App Designer's 2,68 for Image.X).
    problems.push(...(await missingDefinitionProblems(v.definitionReferences ?? [], (type, name) => cachedDefinitionExists(handle, type, name))));
    return problems;
  };
  const qualificationsByUri = new Map<string, { version: number; items: Qualification[] }>();
  const showValidation = async (doc: vscode.TextDocument, handle: string, text: string, version: number, v: Validation, revision: number, liveResult = false) => {
    const extra = await referenceProblems(handle, v);
    if (!current(doc, version, revision) || (liveResult && !liveOn())) return;
    qualificationsByUri.set(doc.uri.toString(), { version, items: v.qualifications ?? [] });
    const shown = editorProblems(v);
    const validation = { ...shown, problems: [...shown.problems, ...extra].sort((a, b) => a.offset - b.offset) };
    validationDiagnostics.set(doc.uri, peopleCodeDiagnostics(text, validation));
    return validation;
  };
  const ownerFieldsFor = async (handle: string, key: DefinitionKey) => {
    const owner = checkEnvironment() ? ownerRecordOf(key) : undefined;
    return owner ? [...((await recordFields(handle, owner)) ?? [])] : undefined;
  };
  const liveOn = () => languageFeaturesOn() && peoplecodeSetting('validateAsYouType', true);
  const live = new LiveValidator(
    new WorkerValidationRunner(path.join(context.extensionPath, 'dist', 'validateWorker.js')),
    (request, result) => {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === request.uri);
      if (doc && liveOn()) void showValidation(doc, parseUri(doc.uri).handle, request.text, request.version, result, request.contextVersion!, true);
    },
    (uri, version, request) => vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri && current(d, version, request.contextVersion!)),
    { delayMs: () => Math.min(5000, Math.max(100, peoplecodeSetting('validationDelay', 500))) });
  const validateLive = async (doc: vscode.TextDocument) => {
    if (!liveOn() || doc.uri.scheme !== SCHEME || doc.languageId !== 'psft-peoplecode') return;
    let parsed: ReturnType<typeof parseUri>;
    try { parsed = parseUri(doc.uri); } catch { return; }
    const version = doc.version, text = doc.getText(), revision = epoch;
    const release = (await releaseFor(parsed.handle)) ?? '8.62';
    const ownerFields = await ownerFieldsFor(parsed.handle, parsed.key);
    if (!liveOn() || !current(doc, version, revision)) return;
    live.schedule({ uri: doc.uri.toString(), version, text, key: parsed.key, release, contextVersion: revision, ...(ownerFields?.length ? { ownerFields } : {}) });
  };
  const manual = new WorkerValidationRunner(path.join(context.extensionPath, 'dist', 'validateWorker.js'));
  let manualRequest: { doc: vscode.TextDocument } | undefined;
  const invalidate = () => {
    epoch++;
    manual.restart();
    validationDiagnostics.clear(); qualificationsByUri.clear();
    releaseByHandle.clear(); fieldCache.clear(); existsCache.clear();
    for (const d of vscode.workspace.textDocuments) live.cancel(d.uri.toString());
    if (liveOn()) for (const d of vscode.workspace.textDocuments) void validateLive(d);
  };
  // Quick fix: write the bare field names as App Designer stores them.
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ language: 'psft-peoplecode' }, {
    provideCodeActions(document, _range, ctx) {
      const latest = qualificationsByUri.get(document.uri.toString());
      if (!latest || latest.version !== document.version || !latest.items.length) return [];
      if (!ctx.diagnostics.some((d) => d.code === 'qualify')) return [];
      const action = new vscode.CodeAction(`Qualify ${latest.items.length} field reference${latest.items.length === 1 ? '' : 's'} as Application Designer stores them`, vscode.CodeActionKind.QuickFix);
      const edit = new vscode.WorkspaceEdit();
      const normalized = document.getText().replace(/\r\n/g, '\n');
      for (const q of latest.items) {
        const a = lineAndColumn(normalized, q.offset), b = lineAndColumn(normalized, q.offset + q.length);
        edit.replace(document.uri, new vscode.Range(a.line, a.column, b.line, b.column), q.text);
      }
      action.edit = edit;
      action.isPreferred = true;
      return [action];
    }
  }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
  context.subscriptions.push(
    validationDiagnostics,
    { dispose: () => live.dispose() },
    vscode.workspace.onDidOpenTextDocument((d) => void validateLive(d)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!e.contentChanges.length) return;
      if (manualRequest?.doc === e.document) manual.restart();
      qualificationsByUri.delete(e.document.uri.toString());
      validationDiagnostics.delete(e.document.uri);
      if (liveOn()) void validateLive(e.document);
    }),
    vscode.workspace.onDidCloseTextDocument((d) => {
      if (manualRequest?.doc === d) manual.restart();
      live.cancel(d.uri.toString()); qualificationsByUri.delete(d.uri.toString()); validationDiagnostics.delete(d.uri);
    }),
    workspace.onDidChange(invalidate),
    vscode.workspace.onDidChangeConfiguration((e) => {
      const keys = ['languageServer.enabled', 'validateAsYouType', 'checkEnvironment', 'unknownFunctionWarnings'];
      if (!keys.some((k) => e.affectsConfiguration(`peoplesoft.peoplecode.${k}`))) return;
      invalidate();
    })
  );
  for (const d of vscode.workspace.textDocuments) void validateLive(d);
  context.subscriptions.push({ dispose: () => { epoch++; manual.dispose(); } });
  return {
    async validateDocument(doc: vscode.TextDocument) {
      const { handle, key } = parseUri(doc.uri);
      const version = doc.version, text = doc.getText(), revision = epoch;
      const release = await releaseFor(handle);
      const ownerFields = await ownerFieldsFor(handle, key);
      if (!current(doc, version, revision)) return;
      if (manualRequest) manual.restart();
      const request = { doc };
      manualRequest = request;
      try {
        const result = await manual.run({ uri: doc.uri.toString(), version, text, key, release: release ?? '8.62', ownerFields });
        const validation = await showValidation(doc, handle, text, version, result, revision);
        return validation ? { validation, release } : undefined;
      } catch (error) {
        if (manualRequest !== request || !current(doc, version, revision)) return;
        throw error;
      } finally { if (manualRequest === request) manualRequest = undefined; }
    }
  };
}
