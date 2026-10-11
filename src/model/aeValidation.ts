import { ACTION_LABELS, ACTION_ORDER, PEOPLECODE_PLATFORM, type ActionType } from './appEngine.js';
import {
  DESCR_MAX, NAME_PATTERN, PROGRAM_NAME_MAX, SECTION_NAME_MAX, STEP_NAME_MAX, TEXT_ACTIONS,
  type AeDocAction, type AeDocStep, type AeDocVariant, type AeDocument
} from './aeDocument.js';

/*
 * Validation of an App Engine document before it is saved, and on demand.
 *
 *   error    the definition is structurally wrong (App Designer could not
 *            have produced it, or the runtime cannot run it); a save is
 *            refused
 *   warning  App Designer's own Edit Validation warnings (docs/APP_ENGINE.md
 *            "Native checks"), and runtime problems the definition invites
 *   info     worth knowing
 *
 * Each diagnostic names its object as App Designer does in its output
 * window -- section.market.platform.effdt.step.action -- and, where one is
 * safe, a fix the editor can offer. Validation never changes the document.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface AeDiagnostic {
  severity: Severity;
  /** Stable identifier of the rule. */
  code: string;
  /** "MAIN.GBL.default.1900-01-01.Step01.SQL", "program", "program.stateRecords". */
  path: string;
  message: string;
  /** Where the problem is, for the editor's selection. */
  at?: { section?: string; variant?: { market: string; dbType: string; effdt: string }; step?: string; action?: ActionType; property?: string };
  /** A safe correction, described. */
  fix?: string;
}

const CODES = {
  onError: ['A', 'I', 'S', 'B'], commitAfter: ['D', 'N', 'Y'], onNoRows: ['A', 'B', 'C', 'S'], onReturn: ['A', 'B', 'S'],
  doSelectType: ['F', 'R', 'Y'], sectionType: ['P', 'C'], autoCommit: ['Y', 'N', 'M'], programType: ['0', '1', '2', '3', '4']
};
const REUSE: Readonly<Record<ActionType, string[]>> = {
  H: ['N', 'Y'], W: ['N', 'Y'], D: ['N', 'Y', 'I'], S: ['N', 'Y', 'I'], N: ['N', 'Y'], X: ['N', 'I'], P: ['N'], C: ['N'], M: ['N']
};

export function variantPath(section: string, v: { market: string; dbType: string; effdt: string }): string {
  return `${section}.${v.market}.${PEOPLECODE_PLATFORM[v.dbType] ?? v.dbType}.${v.effdt}`;
}

export function validateAppEngine(doc: AeDocument): AeDiagnostic[] {
  const out: AeDiagnostic[] = [];
  const add = (d: AeDiagnostic) => out.push(d);
  const p = doc.program;

  // ---- program
  if (!doc.name || doc.name.length > PROGRAM_NAME_MAX || !NAME_PATTERN.test(doc.name)) {
    add({ severity: 'error', code: 'program-name', path: 'program', message: `The program name must be 1 to ${PROGRAM_NAME_MAX} letters, digits or _ # @ $ (${JSON.stringify(doc.name)}).` });
  }
  if (p.descr.length > DESCR_MAX) add({ severity: 'error', code: 'descr-length', path: 'program', message: `The description is longer than ${DESCR_MAX} characters.`, at: { property: 'descr' } });
  if (!CODES.programType.includes(p.programType)) add({ severity: 'error', code: 'program-type', path: 'program', message: `Program Type ${p.programType} is not one App Designer offers (0-4).` });
  if (p.recuse < 0 || p.recuse > 15) add({ severity: 'error', code: 'recuse', path: 'program', message: `RECUSE ${p.recuse} has bits App Designer does not set.` });
  if (p.tempTableInstances < 0) add({ severity: 'error', code: 'instances', path: 'program', message: 'Instance Count cannot be negative.' });
  const defaults = doc.stateRecords.filter((s) => s.isDefault).length;
  if (doc.stateRecords.length && defaults !== 1) {
    add({ severity: 'error', code: 'state-default', path: 'program.stateRecords', message: `Exactly one state record must be the default (${defaults} are).`, fix: 'Make the first state record the default.' });
  }
  const dupState = dup(doc.stateRecords.map((s) => s.record));
  if (dupState.length) add({ severity: 'error', code: 'state-duplicate', path: 'program.stateRecords', message: `State record listed twice: ${dupState.join(', ')}.` });
  for (const s of doc.stateRecords) {
    if (!s.record.endsWith('AET')) add({ severity: 'warning', code: 'state-name', path: 'program.stateRecords', message: `${s.record} does not end in AET; App Designer lists only *AET records as state records.` });
  }
  const dupTemp = dup(doc.tempTables);
  if (dupTemp.length) add({ severity: 'error', code: 'temp-duplicate', path: 'program.tempTables', message: `Temporary table listed twice: ${dupTemp.join(', ')}.` });
  if (doc.tempTables.length && p.tempTableInstances === 0) {
    add({ severity: 'info', code: 'temp-instances', path: 'program', message: 'Temporary tables are listed but Instance Count is 0: batch runs share the base tables (or the PeopleTools global instance count applies).' });
  }

  // ---- sections
  const names = doc.sections.map((s) => s.name);
  for (const n of dup(names)) add({ severity: 'error', code: 'section-duplicate', path: n, message: `Section ${n} is defined twice.` });
  const main = doc.sections.find((s) => s.name === 'MAIN');
  if (!main && !p.library) add({ severity: 'error', code: 'main-missing', path: 'program', message: 'A program that is not an Application Library needs a MAIN section (its entry point).', fix: 'Add a MAIN section, or mark the program an Application Library.' });
  if (main && p.library) add({ severity: 'warning', code: 'library-main', path: 'MAIN', message: 'An Application Library has no entry point; App Designer renames MAIN when Application Library is checked.' });
  if (main && !main.isPublic) add({ severity: 'error', code: 'main-private', path: 'MAIN', message: 'MAIN is always Public (App Designer disables its Access box).', fix: 'Make MAIN Public.' });
  if (!doc.sections.length) add({ severity: 'error', code: 'no-sections', path: 'program', message: 'The program has no sections.' });

  for (const s of doc.sections) {
    if (!s.name || s.name.length > SECTION_NAME_MAX || !NAME_PATTERN.test(s.name)) {
      add({ severity: 'error', code: 'section-name', path: s.name, message: `Section name ${JSON.stringify(s.name)} must be 1 to ${SECTION_NAME_MAX} letters, digits or _ # @ $.` });
    }
    if (!CODES.sectionType.includes(s.type)) add({ severity: 'error', code: 'section-type', path: s.name, message: `Section Type ${s.type} is not P or C.` });
    if (!s.variants.length) add({ severity: 'error', code: 'section-variants', path: s.name, message: `Section ${s.name} has no market / platform / effective date variant.` });
    for (const k of dup(s.variants.map((v) => `${v.market}|${v.dbType}|${v.effdt}`))) {
      add({ severity: 'error', code: 'variant-duplicate', path: s.name, message: `Section ${s.name} has the variant ${k.replace(/\|/g, '.')} twice.` });
    }
    for (const v of s.variants) validateVariant(doc, s.name, v, add);
  }

  // ---- references inside the program
  const local = new Set(names);
  for (const s of doc.sections) for (const v of s.variants) for (const st of v.steps) {
    if (!st.actions.some((a) => a.type === 'C') || st.dynamic) continue;
    const path = `${variantPath(s.name, v)}.${st.name}.Call Section`;
    const at = { section: s.name, variant: v, step: st.name, action: 'C' as const };
    const target = st.doSection.trim();
    const program = st.doProgram.trim();
    if (!target) {
      add({ severity: 'warning', code: 'call-empty', path, message: 'Call Section names no section.', at });
    } else if (!program || program === doc.name) {
      if (!local.has(target)) add({ severity: 'error', code: 'call-missing', path, message: `Call Section calls ${target}, which is not a section of ${doc.name}.`, at });
      else if (target === s.name) add({ severity: 'warning', code: 'call-self', path, message: `Section ${s.name} calls itself; it recurses unless a Do action ends it.`, at });
    }
  }
  return out;
}

function validateVariant(doc: AeDocument, section: string, v: AeDocVariant, add: (d: AeDiagnostic) => void): void {
  const vp = variantPath(section, v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.effdt)) add({ severity: 'error', code: 'effdt', path: vp, message: `Effective date ${v.effdt} is not a date.` });
  if (!PEOPLECODE_PLATFORM[v.dbType] && v.dbType !== '5') add({ severity: 'error', code: 'platform', path: vp, message: `Platform ${v.dbType} is unknown.` });
  else if (!['', ' ', '1', '2', '7'].includes(v.dbType)) add({ severity: 'warning', code: 'platform-legacy', path: vp, message: `Platform ${v.dbType} is not one App Designer 8.62 offers (default, DB2, Microsoft, Oracle).` });
  if (!CODES.autoCommit.includes(v.autoCommit)) add({ severity: 'error', code: 'auto-commit', path: vp, message: `Auto Commit ${v.autoCommit} is not Y or N.` });
  if (v.descr.length > DESCR_MAX) add({ severity: 'error', code: 'descr-length', path: vp, message: `The description is longer than ${DESCR_MAX} characters.` });
  for (const n of dup(v.steps.map((s) => s.name))) add({ severity: 'error', code: 'step-duplicate', path: `${vp}.${n}`, message: `Step ${n} is defined twice in ${section}.` });
  for (const st of v.steps) validateStep(doc, section, v, st, add);
}

function validateStep(doc: AeDocument, section: string, v: AeDocVariant, st: AeDocStep, add: (d: AeDiagnostic) => void): void {
  const sp = `${variantPath(section, v)}.${st.name}`;
  const at = { section, variant: v, step: st.name };
  if (!st.name || st.name.length > STEP_NAME_MAX || !NAME_PATTERN.test(st.name)) {
    add({ severity: 'error', code: 'step-name', path: sp, message: `Step name ${JSON.stringify(st.name)} must be 1 to ${STEP_NAME_MAX} letters, digits or _ # @ $.`, at });
  }
  if (st.descr.length > DESCR_MAX) add({ severity: 'error', code: 'descr-length', path: sp, message: `The description is longer than ${DESCR_MAX} characters.`, at });
  if (!CODES.onError.includes(st.onError)) add({ severity: 'error', code: 'on-error', path: sp, message: `On Error ${st.onError} is not A, I or S.`, at });
  else if (st.onError === 'B') add({ severity: 'warning', code: 'on-error-break', path: sp, message: 'On Error Break is not offered by App Designer 8.62.', at });
  if (!CODES.commitAfter.includes(st.commitAfter)) add({ severity: 'error', code: 'commit-after', path: sp, message: `Commit After ${st.commitAfter} is not D, N or Y.`, at });
  if (st.commitFrequency < 0) add({ severity: 'error', code: 'frequency', path: sp, message: 'Frequency cannot be negative.', at });
  const types = st.actions.map((a) => a.type);
  for (const t of dup(types)) add({ severity: 'error', code: 'action-duplicate', path: sp, message: `Step ${st.name} has two ${ACTION_LABELS[t as ActionType]} actions.`, at });
  if (types.includes('S') && types.includes('C')) add({ severity: 'error', code: 'sql-and-call', path: sp, message: 'A step cannot have both SQL and Call Section actions.', at });
  for (const t of types) if (!ACTION_ORDER.includes(t)) add({ severity: 'error', code: 'action-type', path: sp, message: `Unknown action type ${t}.`, at });
  if (!st.actions.length) add({ severity: 'warning', code: 'no-actions', path: sp, message: `No actions in step ${sp}.`, at });
  if (st.commitFrequency > 0 && !types.includes('D')) {
    add({ severity: 'info', code: 'frequency-unused', path: sp, message: 'Frequency applies only to a step with a Do Select (App Designer disables it here).', at });
  }
  if (types.includes('P') && !CODES.onReturn.includes(st.onReturn)) add({ severity: 'error', code: 'on-return', path: sp, message: `On Return ${st.onReturn} is not A, B or S.`, at });
  if (types.includes('S') && !CODES.onNoRows.includes(st.onNoRows)) add({ severity: 'error', code: 'no-rows', path: sp, message: `No Rows ${st.onNoRows} is not A, B, C or S.`, at });
  if (types.includes('M')) {
    if (!st.messageSet || !st.messageNumber) add({ severity: 'warning', code: 'message-empty', path: `${sp}.Log Message`, message: 'Log Message names no Message Catalog entry (set and number).', at: { ...at, action: 'M' } });
    if (st.messageParms === undefined) add({ severity: 'error', code: 'message-row', path: `${sp}.Log Message`, message: 'A Log Message action has no parameters row (PSAESTEPMSGDEFN).', at: { ...at, action: 'M' }, fix: 'Give it empty parameters.' });
  }
  if (types.includes('X') && doc.program.programType !== '4') {
    add({ severity: 'warning', code: 'xslt-standard', path: `${sp}.XSLT`, message: 'XSLT actions run only in Transform Only programs; App Designer offers them there alone.', at: { ...at, action: 'X' } });
  }
  if (types.includes('X') && types.length > 1) add({ severity: 'warning', code: 'xslt-alone', path: sp, message: 'Every delivered step with an XSLT action has no other action.', at });
  for (const a of st.actions) validateAction(sp, at, a, add);
  // Commit inside a Select/Fetch loop with restart enabled (docs/APP_ENGINE_SEMANTICS.md).
  const dsel = st.actions.find((a) => a.type === 'D');
  if (dsel && dsel.doSelectType === 'F' && !doc.program.disableRestart && (st.commitAfter === 'Y' || st.commitFrequency > 0)) {
    add({ severity: 'warning', code: 'select-fetch-commit', path: `${sp}.Do Select`, at: { ...at, action: 'D' },
      message: 'This step commits inside a Select/Fetch Do Select while restart is enabled: Application Engine does not commit inside a Select/Fetch loop when restart is on. Use Restartable (and key the select so processed rows drop out) or Disable Restart.' });
  }
}

function validateAction(sp: string, at: object, a: AeDocAction, add: (d: AeDiagnostic) => void): void {
  const ap = `${sp}.${ACTION_LABELS[a.type] ?? a.type}`;
  const where = { ...at, action: a.type };
  if (a.descr.length > DESCR_MAX) add({ severity: 'error', code: 'descr-length', path: ap, message: `The description is longer than ${DESCR_MAX} characters.`, at: where });
  if (!REUSE[a.type]?.includes(a.reuse)) {
    add({ severity: 'error', code: 'reuse', path: ap, at: where, message: a.type === 'X' ? `Graphical Mapper ${a.reuse} is not N (Yes) or I (No).` : `ReUse Statement ${a.reuse} is not offered for ${ACTION_LABELS[a.type]} (${REUSE[a.type]?.join(', ')}).` });
  }
  if (a.type === 'D' && !CODES.doSelectType.includes(a.doSelectType)) add({ severity: 'error', code: 'do-select-type', path: ap, message: `Do Select Type ${a.doSelectType} is not F, R or Y.`, at: where });
  if (TEXT_ACTIONS.includes(a.type) && (a.text ?? '').trim() === '') {
    add({ severity: 'warning', code: 'no-text', path: ap, at: where, message: `No ${a.type === 'X' ? 'XSLT' : 'SQL'} defined for ${ap}.` });
  }
  if (a.type === 'P' && (a.peopleCode ?? '').trim() === '') add({ severity: 'warning', code: 'no-peoplecode', path: ap, message: `No PeopleCode defined for ${ap}.`, at: where });
  if (a.type === 'D' && a.text) {
    if (!/%select\s*\(/i.test(a.text) && !/^\s*%selectinit/i.test(a.text)) {
      add({ severity: 'warning', code: 'do-select-into', path: ap, at: where, message: 'A Do Select usually begins %Select(field, ...) so each fetched row lands in the state record; without it the loop only counts rows.' });
    }
  }
  if ((a.type === 'H' || a.type === 'W' || a.type === 'N') && a.text && !/^\s*(%select\s*\([^)]*\)\s*)?select\b/i.test(a.text)) {
    add({ severity: 'warning', code: 'do-not-select', path: ap, at: where, message: `${ACTION_LABELS[a.type]} runs a SELECT: it continues while (or until) the SELECT returns a row.` });
  }
  if (a.type === 'S' && a.text && /^\s*select\b/i.test(a.text)) {
    add({ severity: 'info', code: 'sql-select', path: ap, at: where, message: 'An SQL action that is a SELECT must use %Select(...) to put its one row into the state record; its other rows are ignored.' });
  }
  if (a.type === 'S' && a.reuse === 'I' && a.text && !/^\s*insert\b/i.test(a.text)) {
    add({ severity: 'warning', code: 'bulk-insert-not-insert', path: ap, at: where, message: 'ReUse Bulk Insert applies to INSERT statements.' });
  }
}

function dup<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const out = new Set<T>();
  for (const v of values) (seen.has(v) ? out : seen).add(v);
  return [...out];
}

// ---------------------------------------------------------------------------
// References outside the document

/** What reference validation asks the database. */
export interface AeReferenceLookup {
  /** PSRECDEFN.RECTYPE of a record, undefined when there is none. */
  recordType(record: string): Promise<number | undefined>;
  /** The fields of a record (PSRECFIELDDB), undefined when there is no record. */
  recordFields(record: string): Promise<string[] | undefined>;
  /** Another program's sections with their Access, undefined when there is no program. */
  programSections(program: string): Promise<{ name: string; isPublic: boolean }[] | undefined>;
  /** Whether a Message Catalog entry exists. */
  messageExists(set: number, number: number): Promise<boolean>;
}

/** The %Bind / %Select field names an SQL text uses (the state-record side of its binds). */
export function bindFields(text: string): string[] {
  const out = new Set<string>();
  const re = /%(Bind|Select|SelectInit)\s*\(([^)]*)\)/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    for (const raw of m[2].split(',')) {
      const part = raw.trim().replace(/^(NoQuotes|NoWrap|StaticBind|Static)\s*,?\s*/i, '');
      const field = /^(?:[A-Za-z0-9_#@$]+\.)?([A-Za-z][A-Za-z0-9_#@$]*)$/.exec(part)?.[1];
      if (field && !/^(NOQUOTES|NOWRAP|STATIC|STATICBIND)$/i.test(field)) out.add(field.toUpperCase());
    }
  }
  return [...out];
}

export async function validateAppEngineReferences(doc: AeDocument, lookup: AeReferenceLookup): Promise<AeDiagnostic[]> {
  const out: AeDiagnostic[] = [];
  const stateFields = new Set<string>();
  for (const s of doc.stateRecords) {
    const type = await lookup.recordType(s.record);
    if (type === undefined) { out.push({ severity: 'error', code: 'state-missing', path: 'program.stateRecords', message: `State record ${s.record} does not exist.` }); continue; }
    if (type !== 0 && type !== 2) out.push({ severity: 'warning', code: 'state-type', path: 'program.stateRecords', message: `State record ${s.record} is neither a table nor a Derived/Work record (RECTYPE ${type}).` });
    const fields = (await lookup.recordFields(s.record)) ?? [];
    fields.forEach((f) => stateFields.add(f.toUpperCase()));
    if (type === 0 && !fields.includes('PROCESS_INSTANCE')) {
      out.push({ severity: 'warning', code: 'state-process-instance', path: 'program.stateRecords', message: `State record ${s.record} is a table without PROCESS_INSTANCE: restart cannot find this run's row.` });
    }
  }
  for (const t of doc.tempTables) {
    const type = await lookup.recordType(t);
    if (type === undefined) out.push({ severity: 'error', code: 'temp-missing', path: 'program.tempTables', message: `Temporary table ${t} does not exist.` });
    else if (type !== 7) out.push({ severity: 'error', code: 'temp-type', path: 'program.tempTables', message: `${t} is not a Temporary Table record (RECTYPE ${type}); App Designer lists only RECTYPE 7.` });
  }
  const programs = new Map<string, { name: string; isPublic: boolean }[] | undefined>();
  for (const s of doc.sections) for (const v of s.variants) for (const st of v.steps) {
    const sp = `${variantPath(s.name, v)}.${st.name}`;
    const at = { section: s.name, variant: v, step: st.name };
    if (st.actions.some((a) => a.type === 'C') && !st.dynamic) {
      const program = st.doProgram.trim();
      const target = st.doSection.trim();
      if (program && program !== doc.name && target) {
        if (!programs.has(program)) programs.set(program, await lookup.programSections(program));
        const sections = programs.get(program);
        const sec = sections?.find((x) => x.name === target);
        if (!sections) out.push({ severity: 'error', code: 'call-program-missing', path: `${sp}.Call Section`, message: `Call Section calls program ${program}, which does not exist.`, at: { ...at, action: 'C' } });
        else if (!sec) out.push({ severity: 'error', code: 'call-section-missing', path: `${sp}.Call Section`, message: `${program} has no section ${target}.`, at: { ...at, action: 'C' } });
        else if (!sec.isPublic) out.push({ severity: 'error', code: 'call-private', path: `${sp}.Call Section`, message: `${program}.${target} is Private; another program can call only Public sections.`, at: { ...at, action: 'C' } });
      }
    }
    if (st.actions.some((a) => a.type === 'M') && st.messageSet && st.messageNumber && !(await lookup.messageExists(st.messageSet, st.messageNumber))) {
      out.push({ severity: 'warning', code: 'message-missing', path: `${sp}.Log Message`, message: `Message ${st.messageSet}, ${st.messageNumber} is not in the Message Catalog.`, at: { ...at, action: 'M' } });
    }
    if (!doc.stateRecords.length) continue;
    for (const a of st.actions) {
      if (!a.text || a.type === 'X') continue;
      for (const f of bindFields(a.text)) {
        if (!stateFields.has(f)) {
          out.push({ severity: 'warning', code: 'bind-field', path: `${sp}.${ACTION_LABELS[a.type]}`, at: { ...at, action: a.type },
            message: `%Bind / %Select names ${f}, which no state record of the program has.` });
        }
      }
    }
  }
  return out;
}
