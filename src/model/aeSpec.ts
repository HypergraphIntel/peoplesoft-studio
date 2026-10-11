import { ACTION_LABELS, ACTION_ORDER, type ActionType } from './appEngine.js';
import {
  AeEditError, editedText, findStep, insertAction, insertSection, insertStep, newProgram, newVariant, RECUSE, type AeDocAction, type AeDocument
} from './aeDocument.js';

/*
 * An App Engine program as an agent reads and writes it: App Designer's
 * labels instead of codes, defaults left out. specFromDocument shows a
 * program; documentFromSpec builds one with App Designer's own operations
 * and defaults (aeDocument.ts), then the values the spec gives; diffSpec
 * says how a stored program differs from a spec (verification).
 */

export interface AeActionSpec {
  type: 'Do When' | 'Do While' | 'Do Select' | 'PeopleCode' | 'SQL' | 'Call Section' | 'Log Message' | 'Do Until' | 'XSLT';
  description?: string;
  comment?: string;
  /** SQL text (Do When / Do While / Do Select / SQL / Do Until), stored as App Designer stores it (one line). */
  sql?: string;
  peopleCode?: string;
  xslt?: string;
  reuse?: 'No' | 'Yes' | 'Bulk Insert';
  doSelectType?: 'Select/Fetch' | 'Reselect' | 'Restartable';
  /** SQL: the step's No Rows. */
  noRows?: 'Abort' | 'Section Break' | 'Continue' | 'Skip Step';
  /** PeopleCode: the step's On Return. */
  onReturn?: 'Abort' | 'Break' | 'Skip Step';
  /** Call Section. */
  section?: string;
  /** Call Section: another program (omit for this one). */
  program?: string;
  dynamic?: boolean;
  /** Log Message. */
  messageSet?: number;
  messageNumber?: number;
  parameters?: string;
  /** XSLT. */
  graphicalMapper?: boolean;
}

export interface AeStepSpec {
  name: string;
  description?: string;
  comment?: string;
  commitAfter?: 'Default' | 'Later' | 'After Step';
  frequency?: number;
  onError?: 'Abort' | 'Ignore' | 'Suppress';
  active?: boolean;
  actions: AeActionSpec[];
}

export interface AeSectionSpec {
  name: string;
  market?: string;
  platform?: 'default' | 'DB2' | 'Oracle' | 'Microsoft' | string;
  effectiveDate?: string;
  active?: boolean;
  description?: string;
  comment?: string;
  type?: 'Prepare Only' | 'Critical Updates';
  public?: boolean;
  autoCommit?: boolean;
  steps: AeStepSpec[];
}

export interface AeProgramSpec {
  program: string;
  description?: string;
  comments?: string;
  owner?: string;
  programType?: 'Standard' | 'Upgrade Only' | 'Import Only' | 'Daemon Only' | 'Transform Only';
  disableRestart?: boolean;
  applicationLibrary?: boolean;
  batchOnly?: boolean;
  messageSet?: number;
  stateRecords?: { record: string; default?: boolean }[];
  tempTables?: string[];
  tempTableInstances?: number;
  shareTablesOnline?: boolean;
  useDeleteForTruncate?: boolean;
  /** Runtime: Abort when no temporary table instance is free (else Continue). */
  abortWithoutInstance?: boolean;
  sections: AeSectionSpec[];
}

const TYPES = Object.fromEntries(Object.entries(ACTION_LABELS).map(([k, v]) => [v, k])) as Record<string, ActionType>;
const PROGRAM_TYPES = ['Standard', 'Upgrade Only', 'Import Only', 'Daemon Only', 'Transform Only'];
const PLATFORMS: Record<string, string> = { default: ' ', DB2: '1', Oracle: '2', Informix: '3', 'DB2/UNIX': '4', AllBase: '5', Sybase: '6', Microsoft: '7' };
const PLATFORM_NAMES = Object.fromEntries(Object.entries(PLATFORMS).map(([k, v]) => [v, k]));
const COMMIT: Record<string, string> = { Default: 'D', Later: 'N', 'After Step': 'Y' };
const ON_ERROR: Record<string, string> = { Abort: 'A', Ignore: 'I', Suppress: 'S', Break: 'B' };
const NO_ROWS: Record<string, string> = { Abort: 'A', 'Section Break': 'B', Continue: 'C', 'Skip Step': 'S' };
const ON_RETURN: Record<string, string> = { Abort: 'A', Break: 'B', 'Skip Step': 'S' };
const REUSE: Record<string, string> = { No: 'N', Yes: 'Y', 'Bulk Insert': 'I' };
const DST: Record<string, string> = { 'Select/Fetch': 'F', Reselect: 'R', Restartable: 'Y' };
const inv = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));
const code = (m: Record<string, string>, label: string, what: string) => {
  const c = m[label];
  if (c === undefined) throw new AeEditError(`${what} ${JSON.stringify(label)} is not one of ${Object.keys(m).join(', ')}.`);
  return c;
};
const clean = (s: string | null | undefined) => (s ?? '').trim();

// ---------------------------------------------------------------------------

export function specFromDocument(doc: AeDocument, options: { includeText?: boolean } = {}): AeProgramSpec {
  const withText = options.includeText !== false;
  const p = doc.program;
  const spec: AeProgramSpec = {
    program: doc.name,
    ...(clean(p.descr) ? { description: clean(p.descr) } : {}),
    ...(p.descrlong ? { comments: p.descrlong } : {}),
    ...(clean(p.owner) ? { owner: clean(p.owner) } : {}),
    programType: (PROGRAM_TYPES[Number(p.programType)] ?? p.programType) as AeProgramSpec['programType'],
    disableRestart: p.disableRestart, applicationLibrary: p.library, batchOnly: (p.recuse & RECUSE.batchOnly) !== 0,
    messageSet: p.messageSet,
    stateRecords: doc.stateRecords.map((s) => ({ record: s.record, default: s.isDefault })),
    tempTables: doc.tempTables,
    ...(doc.tempTables.length || p.tempTableInstances ? {
      tempTableInstances: p.tempTableInstances, shareTablesOnline: (p.recuse & RECUSE.shareOnline) !== 0,
      useDeleteForTruncate: (p.recuse & RECUSE.useDelete) !== 0, abortWithoutInstance: (p.recuse & RECUSE.runtimeAbort) !== 0
    } : {}),
    sections: []
  };
  for (const s of doc.sections) for (const v of s.variants) {
    spec.sections.push({
      name: s.name, market: v.market, platform: PLATFORM_NAMES[v.dbType] ?? v.dbType, effectiveDate: v.effdt, active: v.active,
      ...(clean(v.descr) ? { description: clean(v.descr) } : {}), ...(v.descrlong ? { comment: v.descrlong } : {}),
      type: s.type === 'C' ? 'Critical Updates' : 'Prepare Only', public: s.isPublic, autoCommit: v.autoCommit === 'Y',
      steps: v.steps.map((st) => ({
        name: st.name, ...(clean(st.descr) ? { description: clean(st.descr) } : {}), ...(st.descrlong ? { comment: st.descrlong } : {}),
        commitAfter: inv(COMMIT)[st.commitAfter] as AeStepSpec['commitAfter'], ...(st.commitFrequency ? { frequency: st.commitFrequency } : {}),
        onError: inv(ON_ERROR)[st.onError] as AeStepSpec['onError'], active: st.active,
        actions: st.actions.map((a) => actionSpec(doc, st, a, withText))
      }))
    });
  }
  return spec;
}

function actionSpec(doc: AeDocument, st: AeDocument['sections'][number]['variants'][number]['steps'][number], a: AeDocAction, withText: boolean): AeActionSpec {
  const out: AeActionSpec = { type: ACTION_LABELS[a.type] as AeActionSpec['type'] };
  if (clean(a.descr) && clean(a.descr) !== `${ACTION_LABELS[a.type]} description`) out.description = clean(a.descr);
  if (a.descrlong) out.comment = a.descrlong;
  if (['H', 'W', 'D', 'S', 'N'].includes(a.type)) {
    out.reuse = inv(REUSE)[a.reuse] as AeActionSpec['reuse'];
    if (withText && a.text) out.sql = a.text;
  }
  if (a.type === 'D') out.doSelectType = inv(DST)[a.doSelectType] as AeActionSpec['doSelectType'];
  if (a.type === 'S') out.noRows = inv(NO_ROWS)[st.onNoRows] as AeActionSpec['noRows'];
  if (a.type === 'P') { out.onReturn = inv(ON_RETURN)[st.onReturn] as AeActionSpec['onReturn']; if (withText && a.peopleCode) out.peopleCode = a.peopleCode; }
  if (a.type === 'C') {
    out.dynamic = st.dynamic;
    if (!st.dynamic) {
      out.section = clean(st.doSection);
      if (clean(st.doProgram) && clean(st.doProgram) !== doc.name) out.program = clean(st.doProgram);
    }
  }
  if (a.type === 'M') { out.messageSet = st.messageSet; out.messageNumber = st.messageNumber; if (clean(st.messageParms)) out.parameters = clean(st.messageParms); }
  if (a.type === 'X') { out.graphicalMapper = a.reuse !== 'I'; if (withText && a.text) out.xslt = a.text; }
  return out;
}

/**
 * A new program built from a spec: App Designer's new program, its sections,
 * steps and actions inserted as App Designer inserts them, then the spec's
 * values. SQL is stored as App Designer stores edited SQL.
 */
export function documentFromSpec(spec: AeProgramSpec): AeDocument {
  let doc = newProgram(spec.program);
  doc.sections = [];
  const p = doc.program;
  if (spec.description !== undefined) p.descr = spec.description || ' ';
  if (spec.comments !== undefined) p.descrlong = spec.comments || null;
  if (spec.owner !== undefined) p.owner = spec.owner || ' ';
  if (spec.programType !== undefined) {
    const i = PROGRAM_TYPES.indexOf(spec.programType);
    if (i < 0) throw new AeEditError(`Program Type ${spec.programType} is not one of ${PROGRAM_TYPES.join(', ')}.`);
    p.programType = String(i);
  }
  if (spec.disableRestart !== undefined) p.disableRestart = spec.disableRestart;
  if (spec.applicationLibrary !== undefined) p.library = spec.applicationLibrary;
  if (spec.messageSet !== undefined) p.messageSet = spec.messageSet;
  if (spec.tempTableInstances !== undefined) p.tempTableInstances = spec.tempTableInstances;
  const bit = (b: number, on: boolean | undefined) => { if (on !== undefined) p.recuse = on ? p.recuse | b : p.recuse & ~b; };
  bit(RECUSE.batchOnly, spec.batchOnly);
  bit(RECUSE.shareOnline, spec.shareTablesOnline);
  bit(RECUSE.useDelete, spec.useDeleteForTruncate);
  bit(RECUSE.runtimeAbort, spec.abortWithoutInstance);
  if (spec.stateRecords) {
    doc.stateRecords = spec.stateRecords.map((s, i) => ({ record: s.record.toUpperCase(), isDefault: s.default ?? (i === 0 && !spec.stateRecords!.some((x) => x.default)) }));
  }
  if (spec.tempTables) doc.tempTables = [...new Set(spec.tempTables.map((t) => t.toUpperCase()))].sort();

  for (const sec of spec.sections) {
    const existing = doc.sections.find((s) => s.name === sec.name);
    if (!existing) {
      doc = insertSection(doc, sec.name).doc;
      // insertSection's variant is GBL / default / 1900-01-01; a spec may name another.
      doc.sections.at(-1)!.variants = [];
    }
    const s = doc.sections.find((x) => x.name === sec.name)!;
    const v = newVariant(sec.name);
    if (sec.market !== undefined) v.market = sec.market.toUpperCase();
    if (sec.platform !== undefined) {
      const d = PLATFORMS[sec.platform];
      if (d === undefined) throw new AeEditError(`Platform ${sec.platform} is not one of ${Object.keys(PLATFORMS).join(', ')}.`);
      v.dbType = d;
    }
    if (sec.effectiveDate !== undefined) v.effdt = sec.effectiveDate;
    if (sec.active !== undefined) v.active = sec.active;
    if (sec.description !== undefined) v.descr = sec.description || ' ';
    if (sec.comment !== undefined) v.descrlong = sec.comment || null;
    if (sec.autoCommit !== undefined) v.autoCommit = sec.autoCommit ? 'Y' : 'N';
    if (sec.type !== undefined) s.type = sec.type === 'Critical Updates' ? 'C' : 'P';
    s.isPublic = sec.public ?? (sec.name === 'MAIN' ? true : s.isPublic);
    if (s.variants.some((x) => x.market === v.market && x.dbType === v.dbType && x.effdt === v.effdt)) {
      throw new AeEditError(`Section ${sec.name} is given twice for ${v.market} / ${v.dbType} / ${v.effdt}.`);
    }
    s.variants.push(v);
    const vk = { market: v.market, dbType: v.dbType, effdt: v.effdt };
    let after: string | undefined;
    for (const stSpec of sec.steps) {
      doc = insertStep(doc, { section: sec.name, variant: vk, ...(after ? { after } : {}), name: stSpec.name, actions: [] }).doc;
      after = stSpec.name;
      for (const aSpec of [...stSpec.actions].sort((x, y) => ACTION_ORDER.indexOf(TYPES[x.type]) - ACTION_ORDER.indexOf(TYPES[y.type]))) {
        const type = TYPES[aSpec.type];
        if (!type) throw new AeEditError(`Action type ${JSON.stringify(aSpec.type)} is not one of ${Object.keys(TYPES).join(', ')}.`);
        doc = insertAction(doc, { section: sec.name, variant: vk, step: stSpec.name, type }).doc;
      }
      applyStepSpec(doc, { section: sec.name, variant: vk, step: stSpec.name }, stSpec);
    }
  }
  return doc;
}

/** Sets a step's and its actions' values from a spec (the actions already there). */
export function applyStepSpec(doc: AeDocument, ref: { section: string; variant?: { market: string; dbType: string; effdt: string }; step: string }, spec: Omit<AeStepSpec, 'name'>): void {
  const { step } = findStep(doc, ref);
  if (spec.description !== undefined) step.descr = spec.description || ' ';
  if (spec.comment !== undefined) step.descrlong = spec.comment || null;
  if (spec.commitAfter !== undefined) step.commitAfter = code(COMMIT, spec.commitAfter, 'Commit After');
  if (spec.frequency !== undefined) step.commitFrequency = spec.frequency;
  if (spec.onError !== undefined) step.onError = code(ON_ERROR, spec.onError, 'On Error');
  if (spec.active !== undefined) step.active = spec.active;
  for (const aSpec of spec.actions) {
    const type = TYPES[aSpec.type];
    const a = step.actions.find((x) => x.type === type);
    if (!a) throw new AeEditError(`Step ${ref.step} has no ${aSpec.type} action.`);
    if (aSpec.description !== undefined) a.descr = aSpec.description || ' ';
    if (aSpec.comment !== undefined) a.descrlong = aSpec.comment || null;
    if (aSpec.reuse !== undefined) a.reuse = code(REUSE, aSpec.reuse, 'ReUse Statement');
    if (aSpec.doSelectType !== undefined) a.doSelectType = code(DST, aSpec.doSelectType, 'Do Select Type');
    if (aSpec.sql !== undefined) a.text = editedText(type, a.text, aSpec.sql);
    if (aSpec.xslt !== undefined) a.text = editedText('X', a.text, aSpec.xslt);
    if (aSpec.peopleCode !== undefined) a.peopleCode = aSpec.peopleCode;
    if (aSpec.graphicalMapper !== undefined) a.reuse = aSpec.graphicalMapper ? 'N' : 'I';
    if (aSpec.noRows !== undefined) step.onNoRows = code(NO_ROWS, aSpec.noRows, 'No Rows');
    if (aSpec.onReturn !== undefined) step.onReturn = code(ON_RETURN, aSpec.onReturn, 'On Return');
    if (type === 'C') {
      if (aSpec.dynamic) { step.dynamic = true; step.doSection = ' '; step.doProgram = ' '; } else {
        if (aSpec.dynamic === false) step.dynamic = false;
        if (aSpec.section !== undefined) step.doSection = aSpec.section || ' ';
        if (aSpec.program !== undefined) step.doProgram = aSpec.program.toUpperCase() || doc.name;
      }
    }
    if (type === 'M') {
      if (aSpec.messageSet !== undefined) step.messageSet = aSpec.messageSet;
      if (aSpec.messageNumber !== undefined) step.messageNumber = aSpec.messageNumber;
      if (aSpec.parameters !== undefined) step.messageParms = aSpec.parameters || ' ';
    }
  }
}

/** Where a stored program differs from a spec (only what the spec states is compared). */
export function diffSpec(doc: AeDocument, spec: AeProgramSpec): string[] {
  const out: string[] = [];
  const have = specFromDocument(doc);
  const cmp = (path: string, want: unknown, got: unknown) => {
    if (want === undefined) return;
    if (JSON.stringify(want) !== JSON.stringify(got)) out.push(`${path}: ${JSON.stringify(want)} expected, ${JSON.stringify(got)} stored`);
  };
  for (const k of ['description', 'comments', 'owner', 'programType', 'disableRestart', 'applicationLibrary', 'batchOnly', 'messageSet', 'tempTableInstances',
    'shareTablesOnline', 'useDeleteForTruncate', 'abortWithoutInstance'] as const) cmp(k, spec[k], have[k]);
  if (spec.stateRecords) cmp('stateRecords', spec.stateRecords.map((s) => s.record.toUpperCase()).sort(), (have.stateRecords ?? []).map((s) => s.record).sort());
  if (spec.tempTables) cmp('tempTables', spec.tempTables.map((t) => t.toUpperCase()).sort(), have.tempTables);
  for (const sec of spec.sections) {
    const hs = have.sections.find((x) => x.name === sec.name && (sec.market === undefined || x.market === sec.market.toUpperCase()) &&
      (sec.platform === undefined || x.platform === sec.platform) && (sec.effectiveDate === undefined || x.effectiveDate === sec.effectiveDate));
    if (!hs) { out.push(`section ${sec.name}: missing`); continue; }
    for (const k of ['description', 'comment', 'type', 'public', 'autoCommit', 'active'] as const) cmp(`${sec.name}.${k}`, sec[k], hs[k]);
    cmp(`${sec.name} steps`, sec.steps.map((s) => s.name), hs.steps.map((s) => s.name));
    for (const st of sec.steps) {
      const hst = hs.steps.find((x) => x.name === st.name);
      if (!hst) continue;
      for (const k of ['description', 'comment', 'commitAfter', 'frequency', 'onError', 'active'] as const) cmp(`${sec.name}.${st.name}.${k}`, st[k], hst[k]);
      cmp(`${sec.name}.${st.name} actions`, [...st.actions.map((a) => a.type)].sort(), [...hst.actions.map((a) => a.type)].sort());
      for (const a of st.actions) {
        const ha = hst.actions.find((x) => x.type === a.type);
        if (!ha) continue;
        for (const k of Object.keys(a) as (keyof AeActionSpec)[]) {
          if (k === 'type') continue;
          // SQL as given or as an edit stores it (flattening is not idempotent on stored text).
          const want = k === 'sql' && a.sql !== undefined && a.sql !== ha.sql ? editedText(TYPES[a.type], undefined, a.sql) : a[k];
          cmp(`${sec.name}.${st.name}.${a.type}.${k}`, k === 'peopleCode' ? String(want).replace(/\r\n/g, '\n').trimEnd() : want,
            k === 'peopleCode' ? String(ha[k] ?? '').replace(/\r\n/g, '\n').trimEnd() : ha[k]);
        }
      }
    }
  }
  return out;
}
