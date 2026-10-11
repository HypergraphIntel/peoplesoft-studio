import { ACTION_ORDER, PEOPLECODE_PLATFORM, actionSqlId, dateKey, type ActionType, type AppEngineRows, type Row } from './appEngine.js';

/*
 * An App Engine program as an editable document: every column of every row
 * the program is stored in (docs/APP_ENGINE.md), typed, so that a document
 * read and saved unchanged writes nothing, and an edit writes only what it
 * changed. The App Engine Designer, the MCP tools and the writer
 * (providers/appEngineWriter.ts) share it.
 *
 * Operations (insertSection, insertStep, insertAction, changeActionType,
 * delete*, rename*, moveStep, pasteStep, setApplicationLibrary) reproduce
 * App Designer's: its names, defaults and side effects, each proven by a
 * controlled save (the case in brackets). They return a new document.
 *
 * Nodes loaded from the database carry `origin`, their stored identity, so a
 * save can tell a rename (old key tombstoned, SQL and PeopleCode moved) from
 * a delete and an insert.
 */

export const PROGRAM_NAME_MAX = 12;
export const SECTION_NAME_MAX = 8;
export const STEP_NAME_MAX = 8;
export const DESCR_MAX = 30;
export const SQL_ROW_CHARS = 14000;

/** Actions whose content is an SQL definition (SQLTYPE 1), and XSLT's (6). */
export const SQL_ACTIONS: readonly ActionType[] = ['H', 'W', 'D', 'S', 'N'];
export const TEXT_ACTIONS: readonly ActionType[] = [...SQL_ACTIONS, 'X'];
export const sqlTypeOf = (type: ActionType): '1' | '6' | undefined => (type === 'X' ? '6' : SQL_ACTIONS.includes(type) ? '1' : undefined);

/** PSAEAPPLDEFN.RECUSE bits [ap06-ap09]. */
export const RECUSE = { runtimeAbort: 0x1, batchOnly: 0x2, shareOnline: 0x4, useDelete: 0x8 } as const;

export interface AeVariantKey { market: string; dbType: string; effdt: string }

export interface AeDocProgram {
  descr: string;
  descrlong: string | null;
  owner: string;
  /** AEPROGTYPE: 0 Standard, 1 Upgrade Only, 2 Import Only, 3 Daemon Only, 4 Transform Only. */
  programType: string;
  disableRestart: boolean;
  library: boolean;
  /** RECUSE bits (RECUSE). */
  recuse: number;
  messageSet: number;
  tempTableInstances: number;
  /** Columns no dialog writes, kept as stored. */
  inRootElement: string; inMsgName: string; inMsgVersion: string;
  outRootElement: string; outMsgName: string; outMsgVersion: string;
  dateOverride: string;
  /** YYYY-MM-DD or null. */
  asOfDate: string | null;
  licenseCode: string;
  /** The stored stamp, read-only (the save sets them). */
  version?: number;
  lastUpdated?: string;
  lastUpdatedBy?: string;
}

export interface AeDocAction {
  type: ActionType;
  descr: string;
  descrlong: string | null;
  /** AE_REUSE_STMT; on XSLT the Graphical Mapper (N = Yes, I = No). */
  reuse: string;
  /** AE_DO_SELECT_TYPE: F / R / Y on Do Select; F on P, C, M; blank otherwise. */
  doSelectType: string;
  /** SQL or XSLT text as stored (undefined: none). */
  text?: string;
  /** PeopleCode source (undefined: none). */
  peopleCode?: string;
  origin?: ActionType;
}

export interface AeDocStep {
  name: string;
  descr: string;
  descrlong: string | null;
  active: boolean;
  /** AE_ABEND_ACTION A / I / S (B). */
  onError: string;
  /** AE_COMMIT_AFTER D / N / Y. */
  commitAfter: string;
  commitFrequency: number;
  /** AE_ON_NOROWS A / B / C / S: the SQL action's No Rows. */
  onNoRows: string;
  /** AE_PC_ON_FALSE A / B / S, blank with no PeopleCode action. */
  onReturn: string;
  /** Call Section. */
  doSection: string;
  doProgram: string;
  dynamic: boolean;
  /** Log Message. */
  messageSet: number;
  messageNumber: number;
  /** PSAESTEPMSGDEFN.AE_MESSAGE_PARMS; undefined: no row. */
  messageParms?: string;
  /** Kept as stored. */
  messageSetField: string;
  messageNumberField: string;
  loggingSql: string;
  actions: AeDocAction[];
  origin?: string;
}

export interface AeDocVariant extends AeVariantKey {
  active: boolean;
  descr: string;
  descrlong: string | null;
  /** AE_AUTO_COMMIT Y / N. */
  autoCommit: string;
  steps: AeDocStep[];
  origin?: AeVariantKey;
}

export interface AeDocSection {
  name: string;
  /** AE_SECTION_TYPE P / C. */
  type: string;
  isPublic: boolean;
  variants: AeDocVariant[];
  origin?: string;
  /** The stored stamp, read-only. */
  version?: number;
}

export interface AeDocument {
  name: string;
  program: AeDocProgram;
  stateRecords: { record: string; isDefault: boolean }[];
  tempTables: string[];
  /** PSAEAPPLLANG rows, kept as stored. */
  languages: { language: string; descr: string; descrlong: string | null }[];
  sections: AeDocSection[];
  /** The program as stored when the document was read (undefined: a new program). */
  origin?: string;
  /** Set on a copy (Save As) or rename of another program: its SQL is written as moved (ENABLEEFFDT N) [ae13, ae14]. */
  copiedFrom?: string;
}

// ---------------------------------------------------------------------------
// Reading

const str = (v: unknown) => String(v ?? '').trim();
/** A character value as stored, blank as ' ' (PeopleTools never stores ''). */
const raw = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => Number(v ?? 0);
const lob = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const dbType = (v: unknown) => (raw(v).trim() === '' ? ' ' : raw(v).trim());
const variantKeyOf = (r: Row) => `${str(r.AE_SECTION)}|${str(r.MARKET)}|${dbType(r.DBTYPE)}|${dateKey(r.EFFDT)}`;

/**
 * The document of a program's stored rows (AppEngineRows read with every
 * column) and its PeopleCode sources, by peopleCodeKeyParts joined with '|'.
 */
export function documentFromRows(rows: AppEngineRows, peopleCode: ReadonlyMap<string, string> = new Map()): AeDocument {
  const p = rows.program;
  const name = str(p.AE_APPLID);
  const text = new Map<string, string>();
  for (const r of [...rows.sqlText].sort((a, b) => num(a.SEQNUM) - num(b.SEQNUM))) {
    const k = `${raw(r.SQLID)}|${str(r.MARKET)}|${dbType(r.DBTYPE)}|${dateKey(r.EFFDT)}`;
    text.set(k, (text.get(k) ?? '') + raw(r.SQLTEXT));
  }
  const messages = new Map(rows.messages.map((m) => [`${variantKeyOf(m)}|${str(m.AE_STEP)}`, raw(m.AE_MESSAGE_PARMS)]));
  const actionsOf = new Map<string, AeDocAction[]>();
  for (const a of rows.actions) {
    const type = str(a.AE_STMT_TYPE) as ActionType;
    const stepKey = `${variantKeyOf(a)}|${str(a.AE_STEP)}`;
    const sqlId = raw(a.SQLID);
    const t = sqlId.trim() ? text.get(`${sqlId}|${str(a.MARKET)}|${dbType(a.DBTYPE)}|${dateKey(a.EFFDT)}`) : undefined;
    const pcParts = type === 'P' ? peopleCodeKey(name, str(a.AE_SECTION), { market: str(a.MARKET), dbType: dbType(a.DBTYPE), effdt: dateKey(a.EFFDT) }, str(a.AE_STEP)) : undefined;
    const pc = pcParts ? peopleCode.get(pcParts.join('|')) : undefined;
    actionsOf.set(stepKey, [...(actionsOf.get(stepKey) ?? []), {
      type, descr: raw(a.DESCR), descrlong: lob(a.DESCRLONG), reuse: raw(a.AE_REUSE_STMT) || 'N', doSelectType: raw(a.AE_DO_SELECT_TYPE) || ' ',
      ...(t !== undefined ? { text: t } : {}), ...(pc !== undefined ? { peopleCode: pc } : {}), origin: type
    }]);
  }
  const stepsOf = new Map<string, AeDocStep[]>();
  for (const s of [...rows.steps].sort((a, b) => num(a.AE_SEQ_NUM) - num(b.AE_SEQ_NUM))) {
    const key = variantKeyOf(s);
    const stepKey = `${key}|${str(s.AE_STEP)}`;
    const step: AeDocStep = {
      name: str(s.AE_STEP), descr: raw(s.DESCR), descrlong: lob(s.DESCRLONG), active: str(s.AE_ACTIVE_STATUS) !== 'I',
      onError: raw(s.AE_ABEND_ACTION), commitAfter: raw(s.AE_COMMIT_AFTER), commitFrequency: num(s.AE_COMMIT_FREQ),
      onNoRows: raw(s.AE_ON_NOROWS), onReturn: raw(s.AE_PC_ON_FALSE), doSection: raw(s.AE_DO_SECTION), doProgram: raw(s.AE_DO_APPL_ID),
      dynamic: str(s.AE_DYNAMIC_DO) === 'Y', messageSet: num(s.MESSAGE_SET_NBR), messageNumber: num(s.MESSAGE_NBR),
      ...(messages.has(stepKey) ? { messageParms: messages.get(stepKey) } : {}),
      messageSetField: raw(s.AE_MESSAGE_SET_FLD), messageNumberField: raw(s.AE_MESSAGE_NBR_FLD), loggingSql: raw(s.PTAE_LOGGING_SQL),
      actions: (actionsOf.get(stepKey) ?? []).sort((a, b) => ACTION_ORDER.indexOf(a.type) - ACTION_ORDER.indexOf(b.type)),
      origin: str(s.AE_STEP)
    };
    stepsOf.set(key, [...(stepsOf.get(key) ?? []), step]);
  }
  const variantsOf = new Map<string, AeDocVariant[]>();
  for (const v of rows.variants) {
    const vk = { market: str(v.MARKET), dbType: dbType(v.DBTYPE), effdt: dateKey(v.EFFDT) };
    const section = str(v.AE_SECTION);
    variantsOf.set(section, [...(variantsOf.get(section) ?? []), {
      ...vk, active: str(v.EFF_STATUS) !== 'I', descr: raw(v.DESCR), descrlong: lob(v.DESCRLONG), autoCommit: raw(v.AE_AUTO_COMMIT),
      steps: stepsOf.get(variantKeyOf(v)) ?? [], origin: { ...vk }
    }]);
  }
  return {
    name,
    origin: name,
    program: {
      descr: raw(p.DESCR), descrlong: lob(p.DESCRLONG), owner: raw(p.OBJECTOWNERID), programType: str(p.AEPROGTYPE) || '0',
      disableRestart: str(p.AE_DISABLE_RESTART) === 'Y', library: str(p.AE_APPLLIBRARY) === 'Y', recuse: num(p.RECUSE),
      messageSet: num(p.MESSAGE_SET_NBR), tempTableInstances: num(p.TEMPTBLINSTANCES),
      inRootElement: raw(p.INROOTELEMENT), inMsgName: raw(p.INMSGNAME), inMsgVersion: raw(p.INMSGVERSION),
      outRootElement: raw(p.OUTROOTELEMENT), outMsgName: raw(p.OUTMSGNAME), outMsgVersion: raw(p.OUTMSGVERSION),
      dateOverride: raw(p.AE_DATE_OVERRIDE), asOfDate: p.ASOF_DT === null || p.ASOF_DT === undefined ? null : dateKey(p.ASOF_DT),
      licenseCode: raw(p.LICENSE_CODE), version: num(p.VERSION),
      lastUpdated: p.LASTUPDDTTM instanceof Date ? p.LASTUPDDTTM.toISOString() : str(p.LASTUPDDTTM), lastUpdatedBy: str(p.LASTUPDOPRID)
    },
    stateRecords: rows.states.map((r) => ({ record: str(r.AE_STATE_RECNAME), isDefault: str(r.AE_DEFAULT_STATE) === 'Y' }))
      .sort((a, b) => a.record.localeCompare(b.record)),
    tempTables: rows.tempTables.map((r) => str(r.RECNAME)).sort(),
    languages: (rows.languages ?? []).map((r) => ({ language: str(r.LANGUAGE_CD), descr: raw(r.DESCR), descrlong: lob(r.DESCRLONG) })),
    sections: sortSections(rows.sections.map((s) => ({
      name: str(s.AE_SECTION), type: raw(s.AE_SECTION_TYPE), isPublic: str(s.AE_PUBLIC_SW) === 'Y', origin: str(s.AE_SECTION), version: num(s.VERSION),
      variants: (variantsOf.get(str(s.AE_SECTION)) ?? []).sort(compareVariants)
    })))
  };
}

/** MAIN first, then by name, as App Designer lists sections on load. */
export function sortSections<T extends { name: string }>(sections: T[]): T[] {
  return [...sections].sort((a, b) => (a.name === 'MAIN' ? -1 : b.name === 'MAIN' ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function compareVariants(a: AeVariantKey, b: AeVariantKey): number {
  return a.market.localeCompare(b.market) || a.dbType.localeCompare(b.dbType) || a.effdt.localeCompare(b.effdt);
}

/** A PeopleCode action's PSPCMPROG key parts (undefined for a platform no PeopleCode names, AllBase). */
export function peopleCodeKey(program: string, section: string, v: AeVariantKey, step: string): string[] | undefined {
  const platform = PEOPLECODE_PLATFORM[v.dbType];
  return platform ? [program, section, v.market, platform, v.effdt, step, 'OnExecute'] : undefined;
}

// ---------------------------------------------------------------------------
// Rows

/** The rows a document is stored as, keyed and complete, without VERSION / LASTUPD stamps. */
export interface AeDesiredRows {
  program: Row;
  states: Row[];
  tempTables: Row[];
  languages: Row[];
  sections: Row[];
  variants: Row[];
  steps: Row[];
  actions: Row[];
  messages: Row[];
  /** One per action with text, by its variant. */
  texts: { sqlId: string; sqlType: '1' | '6'; market: string; dbType: string; effdt: string; text: string; section: string; origin?: string }[];
  /** One per PeopleCode action with source. */
  peopleCode: { parts: string[]; source: string; section: string; origin?: string[] }[];
}

const blank = (v: string | undefined) => (v === undefined || v === '' ? ' ' : v);

export function rowsFromDocument(doc: AeDocument): AeDesiredRows {
  const name = doc.name;
  const p = doc.program;
  const out: AeDesiredRows = {
    program: {
      AE_APPLID: name, INROOTELEMENT: blank(p.inRootElement), INMSGNAME: blank(p.inMsgName), INMSGVERSION: blank(p.inMsgVersion),
      OUTROOTELEMENT: blank(p.outRootElement), OUTMSGNAME: blank(p.outMsgName), OUTMSGVERSION: blank(p.outMsgVersion),
      DESCR: blank(p.descr), AE_DATE_OVERRIDE: blank(p.dateOverride || 'N'), ASOF_DT: p.asOfDate, MESSAGE_SET_NBR: p.messageSet,
      AE_APPLLIBRARY: p.library ? 'Y' : 'N', AE_DISABLE_RESTART: p.disableRestart ? 'Y' : 'N', OBJECTOWNERID: blank(p.owner),
      AEPROGTYPE: p.programType || '0', TEMPTBLINSTANCES: p.tempTableInstances, RECUSE: p.recuse, LICENSE_CODE: blank(p.licenseCode),
      DESCRLONG: p.descrlong
    },
    states: doc.stateRecords.map((s) => ({ AE_APPLID: name, AE_STATE_RECNAME: s.record, AE_DEFAULT_STATE: s.isDefault ? 'Y' : 'N' })),
    tempTables: doc.tempTables.map((t) => ({ AE_APPLID: name, RECNAME: t })),
    languages: doc.languages.map((l) => ({ AE_APPLID: name, LANGUAGE_CD: l.language, DESCR: blank(l.descr), DESCRLONG: l.descrlong })),
    sections: [], variants: [], steps: [], actions: [], messages: [], texts: [], peopleCode: []
  };
  for (const s of doc.sections) {
    out.sections.push({ AE_APPLID: name, AE_SECTION: s.name, AE_SECTION_TYPE: blank(s.type || 'P'), AE_PUBLIC_SW: s.isPublic ? 'Y' : 'N' });
    for (const v of s.variants) {
      const vk = { AE_APPLID: name, AE_SECTION: s.name, MARKET: v.market, DBTYPE: v.dbType, EFFDT: v.effdt };
      out.variants.push({ ...vk, EFF_STATUS: v.active ? 'A' : 'I', DESCR: blank(v.descr), AE_AUTO_COMMIT: blank(v.autoCommit || 'N'), DESCRLONG: v.descrlong });
      v.steps.forEach((st, i) => {
        out.steps.push({
          ...vk, AE_STEP: st.name, AE_SEQ_NUM: i + 1, AE_ACTIVE_STATUS: st.active ? 'A' : 'I', AE_ABEND_ACTION: blank(st.onError),
          AE_COMMIT_AFTER: blank(st.commitAfter), AE_DO_SECTION: blank(st.doSection), AE_DO_APPL_ID: blank(st.doProgram),
          AE_DYNAMIC_DO: st.dynamic ? 'Y' : 'N', AE_PC_ON_FALSE: blank(st.onReturn), AE_ON_NOROWS: blank(st.onNoRows), DESCR: blank(st.descr),
          MESSAGE_SET_NBR: st.messageSet, MESSAGE_NBR: st.messageNumber, AE_MESSAGE_SET_FLD: blank(st.messageSetField),
          AE_MESSAGE_NBR_FLD: blank(st.messageNumberField), AE_COMMIT_FREQ: st.commitFrequency, PTAE_LOGGING_SQL: blank(st.loggingSql || 'N'),
          DESCRLONG: st.descrlong
        });
        if (st.messageParms !== undefined) out.messages.push({ ...vk, AE_STEP: st.name, AE_MESSAGE_PARMS: blank(st.messageParms) });
        for (const a of st.actions) {
          const sqlType = sqlTypeOf(a.type);
          const sqlId = sqlType ? actionSqlId(name, s.name, st.name, a.type) : ' ';
          out.actions.push({
            ...vk, AE_STEP: st.name, AE_STMT_TYPE: a.type, AE_REUSE_STMT: blank(a.reuse || 'N'), AE_DO_SELECT_TYPE: blank(a.doSelectType),
            SQLID: sqlId, DESCR: blank(a.descr), DESCRLONG: a.descrlong
          });
          const originSqlId = sqlType && s.origin && st.origin && a.origin === a.type && doc.origin
            ? actionSqlId(doc.origin, s.origin, st.origin, a.type) : undefined;
          if (sqlType && a.text !== undefined && a.text !== '') {
            out.texts.push({ sqlId, sqlType, market: v.market, dbType: v.dbType, effdt: v.effdt, text: a.text, section: s.name,
              ...(originSqlId ? { origin: originSqlId } : {}) });
          }
          if (a.type === 'P' && a.peopleCode !== undefined && a.peopleCode.trim() !== '') {
            const parts = peopleCodeKey(name, s.name, v, st.name);
            const originParts = s.origin && st.origin && v.origin && a.origin === 'P' && doc.origin
              ? peopleCodeKey(doc.origin, s.origin, v.origin, st.origin) : undefined;
            if (parts) out.peopleCode.push({ parts, source: a.peopleCode, section: s.name, ...(originParts ? { origin: originParts } : {}) });
          }
        }
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// SQL text as App Designer stores it [aa02-aa10]

/**
 * App Engine SQL as App Designer's SQL editor saves it: one line. Each line
 * has its runs of spaces outside '...' literals collapsed to one; lines are
 * joined with one space; tabs become spaces (after the collapse, literals
 * too); trailing whitespace goes. Leading whitespace stays.
 */
export function flattenAeSql(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let inQuote = false;
  const out: string[] = [];
  for (const line of lines) {
    let result = '';
    let spaces = false;
    for (const ch of line) {
      if (inQuote) {
        result += ch;
        if (ch === "'") inQuote = false;
        continue;
      }
      if (ch === ' ') {
        if (!spaces) result += ' ';
        spaces = true;
        continue;
      }
      spaces = false;
      result += ch;
      if (ch === "'") inQuote = true;
    }
    out.push(result);
  }
  return out.join(' ').replace(/\t/g, ' ').replace(/\s+$/, '');
}

/** Text for an action as App Designer stores it: SQL flattened, XSLT verbatim [ax43]. */
export function storedActionText(type: ActionType, text: string): string {
  return type === 'X' ? text : flattenAeSql(text);
}

/**
 * App Engine SQL laid out for reading: a line break before each clause
 * keyword outside literals, as App Designer's SQL editor shows it (its
 * stored form is one line). Display only: flattenAeSql of an unedited
 * display gives back what flattenAeSql of the stored text gives.
 */
export function formatAeSql(text: string): string {
  const keywords = /^(SELECT|FROM|WHERE|AND|OR|ORDER BY|GROUP BY|HAVING|UNION ALL|UNION|MINUS|INTERSECT|SET|VALUES|INNER JOIN|LEFT OUTER JOIN|RIGHT OUTER JOIN|LEFT JOIN|RIGHT JOIN|JOIN|ON|INTO)\b/i;
  let out = '';
  let inQuote = false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) { out += ch; if (ch === "'") inQuote = false; continue; }
    if (ch === "'") { inQuote = true; out += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ' ' && depth === 0 && out.length > 0 && keywords.test(text.slice(i + 1))) {
      out = out.replace(/ +$/, '') + '\n';
      while (text[i + 1] === ' ') i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * The text an edit stores: unchanged text as it was; SQL as App Designer's
 * editor saves what it holds (flattened) -- and an edit that only re-lays out
 * the stored text (its flattened form equals the stored text's) changes
 * nothing; XSLT verbatim.
 */
export function editedText(type: ActionType, stored: string | undefined, edited: string): string {
  if (stored !== undefined && edited === stored) return stored;
  if (type === 'X') return edited;
  const flat = flattenAeSql(edited);
  if (stored !== undefined && (flat === stored || flat === flattenAeSql(formatAeSql(stored)) || flat === flattenAeSql(stored))) return stored;
  return flat;
}

/** PSSQLTEXTDEFN rows: 14,000-character slices. */
export function splitSqlText(text: string): string[] {
  const rows: string[] = [];
  for (let i = 0; i < text.length; i += SQL_ROW_CHARS) rows.push(text.slice(i, i + SQL_ROW_CHARS));
  return rows.length ? rows : [''];
}

// ---------------------------------------------------------------------------
// Names

/** The name after `base`: its trailing number plus one, keeping the width (Step01 -> Step02, Init -> Init2). */
export function nextName(base: string, taken: ReadonlySet<string>, max: number): string {
  const m = /^(.*?)(\d*)$/.exec(base)!;
  const stem = m[1];
  const digits = m[2];
  let n = digits ? Number(digits) + 1 : 2;
  for (;; n++) {
    const suffix = digits ? String(n).padStart(digits.length, '0') : String(n);
    const candidate = (stem.slice(0, Math.max(1, max - suffix.length)) + suffix).slice(0, max);
    if (!taken.has(candidate)) return candidate;
  }
}

/** The next free SectionN [ae10, ap05]. */
export function nextSectionName(doc: AeDocument): string {
  const taken = new Set(doc.sections.map((s) => s.name));
  for (let n = 1; ; n++) if (!taken.has(`Section${n}`)) return `Section${n}`;
}

export const NAME_PATTERN = /^[A-Za-z0-9_#@$]+$/;

// ---------------------------------------------------------------------------
// Defaults [ae01, ae10, aa01, ax08-ax17, ax27]

export const ACTION_DESCRIPTIONS: Readonly<Record<ActionType, string>> = {
  H: 'Do When description', W: 'Do While description', D: 'Do Select description', P: 'PeopleCode description',
  S: 'SQL description', C: 'Call Section description', X: 'XSLT description', M: 'Log Message description', N: 'Do Until description'
};

export function newProgram(name: string): AeDocument {
  return {
    name,
    program: {
      descr: ' ', descrlong: null, owner: ' ', programType: '0', disableRestart: false, library: false, recuse: 0, messageSet: 0,
      tempTableInstances: 0, inRootElement: ' ', inMsgName: ' ', inMsgVersion: ' ', outRootElement: ' ', outMsgName: ' ', outMsgVersion: ' ',
      dateOverride: 'N', asOfDate: null, licenseCode: ' '
    },
    stateRecords: [], tempTables: [], languages: [],
    sections: [{ name: 'MAIN', type: 'P', isPublic: true, variants: [newVariant('MAIN', [newStep('Step01')])] }]
  };
}

export function newVariant(section: string, steps: AeDocStep[] = []): AeDocVariant {
  return { market: 'GBL', dbType: ' ', effdt: '1900-01-01', active: true, descr: `${section} description`, descrlong: null, autoCommit: 'N', steps };
}

export function newStep(name: string, actions: AeDocAction[] = []): AeDocStep {
  return {
    name, descr: `${name} description`, descrlong: null, active: true, onError: 'A', commitAfter: 'D', commitFrequency: 0, onNoRows: 'C',
    onReturn: ' ', doSection: ' ', doProgram: ' ', dynamic: false, messageSet: 0, messageNumber: 0, messageSetField: ' ', messageNumberField: ' ',
    loggingSql: 'N', actions
  };
}

export function newAction(type: ActionType): AeDocAction {
  return { type, descr: ACTION_DESCRIPTIONS[type], descrlong: null, reuse: 'N', doSelectType: ['D', 'P', 'C', 'M'].includes(type) ? 'F' : ' ' };
}

/**
 * The step-level settings an action brings with it: PeopleCode's On Return
 * (A on Insert Action [ax14], S when a type is changed to PeopleCode
 * [ax31]), Log Message's parameters row, Call Section's program [ax27].
 */
function attachAction(step: AeDocStep, program: string, type: ActionType, via: 'insert' | 'change'): void {
  if (type === 'P') step.onReturn = via === 'insert' ? 'A' : 'S';
  if (type === 'M' && step.messageParms === undefined) step.messageParms = ' ';
  if (type === 'C' && (step.doProgram ?? ' ').trim() === '' && !step.dynamic) step.doProgram = program;
}

/** What removing an action does to its step: PeopleCode's On Return goes blank [ad01], Log Message's row goes. */
function detachAction(step: AeDocStep, type: ActionType): void {
  if (type === 'P') step.onReturn = ' ';
  if (type === 'M') delete step.messageParms;
}

// ---------------------------------------------------------------------------
// Addressing

export interface StepRef { section: string; variant?: AeVariantKey; step: string }
export interface ActionRef extends StepRef { type: ActionType }

const clone = <T>(v: T): T => structuredClone(v);

export class AeEditError extends Error {
  constructor(message: string) { super(message); this.name = 'AeEditError'; }
}

export function findSection(doc: AeDocument, name: string): AeDocSection {
  const s = doc.sections.find((x) => x.name === name);
  if (!s) throw new AeEditError(`${doc.name} has no section ${name}.`);
  return s;
}

/** A section's variant: the one named, or its only one. */
export function findVariant(section: AeDocSection, key?: AeVariantKey): AeDocVariant {
  if (!key) {
    if (section.variants.length === 1) return section.variants[0];
    throw new AeEditError(`Section ${section.name} has ${section.variants.length} variants; name one (market, platform, effective date).`);
  }
  const v = section.variants.find((x) => x.market === key.market && x.dbType === key.dbType && x.effdt === key.effdt);
  if (!v) throw new AeEditError(`Section ${section.name} has no variant ${key.market}.${key.dbType}.${key.effdt}.`);
  return v;
}

export function findStep(doc: AeDocument, ref: StepRef): { section: AeDocSection; variant: AeDocVariant; step: AeDocStep; index: number } {
  const section = findSection(doc, ref.section);
  const variant = findVariant(section, ref.variant);
  const index = variant.steps.findIndex((s) => s.name === ref.step);
  if (index < 0) throw new AeEditError(`${ref.section} has no step ${ref.step}.`);
  return { section, variant, step: variant.steps[index], index };
}

export function findAction(doc: AeDocument, ref: ActionRef): { step: AeDocStep; action: AeDocAction } {
  const { step } = findStep(doc, ref);
  const action = step.actions.find((a) => a.type === ref.type);
  if (!action) throw new AeEditError(`Step ${ref.section}.${ref.step} has no ${ref.type} action.`);
  return { step, action };
}

// ---------------------------------------------------------------------------
// Operations

/** Insert Section: the next free SectionN, Private, Prepare Only, one GBL variant, no steps [ae10]. */
export function insertSection(doc: AeDocument, name?: string): { doc: AeDocument; section: string } {
  const next = clone(doc);
  const section = name ?? nextSectionName(next);
  checkName(section, SECTION_NAME_MAX, 'section');
  if (next.sections.some((s) => s.name === section)) throw new AeEditError(`${doc.name} already has a section ${section}.`);
  next.sections.push({ name: section, type: 'P', isPublic: section === 'MAIN', variants: [newVariant(section)] });
  return { doc: next, section };
}

/**
 * Insert Step/Action: a step after `after` (or first), named after the step
 * above it, with an SQL action unless `actions` says otherwise [aa01, ao01].
 */
export function insertStep(doc: AeDocument, ref: { section: string; variant?: AeVariantKey; after?: string; name?: string; actions?: ActionType[] }):
  { doc: AeDocument; step: string } {
  const next = clone(doc);
  const section = findSection(next, ref.section);
  const variant = findVariant(section, ref.variant);
  const index = ref.after === undefined ? -1 : variant.steps.findIndex((s) => s.name === ref.after);
  if (ref.after !== undefined && index < 0) throw new AeEditError(`${ref.section} has no step ${ref.after}.`);
  const taken = new Set(variant.steps.map((s) => s.name));
  const name = ref.name ?? nextName(index >= 0 ? variant.steps[index].name : 'Step00', taken, STEP_NAME_MAX);
  checkName(name, STEP_NAME_MAX, 'step');
  if (taken.has(name)) throw new AeEditError(`${ref.section} already has a step ${name}.`);
  const step = newStep(name);
  for (const type of ref.actions ?? ['S']) addAction(step, next.name, type, 'insert');
  variant.steps.splice(index + 1, 0, step);
  return { doc: next, step: name };
}

/** The types App Designer's Insert Action may add to a step, in its order [ax08-ax17]. */
export function insertableTypes(step: AeDocStep, programType: string): ActionType[] {
  const has = new Set(step.actions.map((a) => a.type));
  return ACTION_ORDER.filter((t) => !has.has(t) && !(t === 'C' && has.has('S')) && !(t === 'S' && has.has('C')) && (t !== 'X' || programType === '4'));
}

function addAction(step: AeDocStep, program: string, type: ActionType, via: 'insert' | 'change'): void {
  if (step.actions.some((a) => a.type === type)) throw new AeEditError(`Step ${step.name} already has a ${type} action.`);
  if ((type === 'C' && step.actions.some((a) => a.type === 'S')) || (type === 'S' && step.actions.some((a) => a.type === 'C'))) {
    throw new AeEditError(`Step ${step.name} cannot have both SQL and Call Section actions.`);
  }
  step.actions.push(newAction(type));
  step.actions.sort((a, b) => ACTION_ORDER.indexOf(a.type) - ACTION_ORDER.indexOf(b.type));
  attachAction(step, program, type, via);
}

/** Insert Action: the type named, or the first one the step can take [ax08]. */
export function insertAction(doc: AeDocument, ref: StepRef & { type?: ActionType }): { doc: AeDocument; type: ActionType } {
  const next = clone(doc);
  const { step } = findStep(next, ref);
  const type = ref.type ?? insertableTypes(step, next.program.programType)[0];
  if (!type) throw new AeEditError(`Step ${ref.step} has every action it can take.`);
  addAction(step, next.name, type, 'insert');
  return { doc: next, type };
}

/** Changing an action's type: the old action goes, a new one with the type's defaults comes [ax27, ax31]. */
export function changeActionType(doc: AeDocument, ref: ActionRef, type: ActionType): AeDocument {
  if (ref.type === type) return doc;
  const next = clone(doc);
  const { step } = findStep(next, ref);
  const i = step.actions.findIndex((a) => a.type === ref.type);
  if (i < 0) throw new AeEditError(`Step ${ref.step} has no ${ref.type} action.`);
  const [removed] = step.actions.splice(i, 1);
  detachAction(step, removed.type);
  try {
    addAction(step, next.name, type, 'change');
  } catch (e) {
    throw e instanceof AeEditError ? e : new AeEditError(String(e));
  }
  return next;
}

export function deleteAction(doc: AeDocument, ref: ActionRef): AeDocument {
  const next = clone(doc);
  const { step } = findStep(next, ref);
  const i = step.actions.findIndex((a) => a.type === ref.type);
  if (i < 0) throw new AeEditError(`Step ${ref.step} has no ${ref.type} action.`);
  step.actions.splice(i, 1);
  detachAction(step, ref.type);
  return next;
}

export function deleteStep(doc: AeDocument, ref: StepRef): AeDocument {
  const next = clone(doc);
  const { variant, index } = findStep(next, ref);
  variant.steps.splice(index, 1);
  return next;
}

/** Deletes a section (or one variant of it). MAIN cannot be deleted. */
export function deleteSection(doc: AeDocument, name: string, variant?: AeVariantKey): AeDocument {
  if (name === 'MAIN' && !variant) throw new AeEditError('MAIN cannot be deleted.');
  const next = clone(doc);
  const section = findSection(next, name);
  if (variant && section.variants.length > 1) {
    const v = findVariant(section, variant);
    section.variants.splice(section.variants.indexOf(v), 1);
    return next;
  }
  if (name === 'MAIN') throw new AeEditError('MAIN cannot be deleted.');
  next.sections.splice(next.sections.indexOf(section), 1);
  return next;
}

export function renameSection(doc: AeDocument, from: string, to: string): AeDocument {
  if (from === to) return doc;
  checkName(to, SECTION_NAME_MAX, 'section');
  const next = clone(doc);
  if (next.sections.some((s) => s.name === to)) throw new AeEditError(`${doc.name} already has a section ${to}.`);
  // Call Section steps naming the old name are left as they are (App
  // Designer's behaviour here is not captured); validation reports them.
  findSection(next, from).name = to;
  return next;
}

export function renameStep(doc: AeDocument, ref: StepRef, to: string): AeDocument {
  if (ref.step === to) return doc;
  checkName(to, STEP_NAME_MAX, 'step');
  const next = clone(doc);
  const { variant, step } = findStep(next, ref);
  if (variant.steps.some((s) => s.name === to)) throw new AeEditError(`${ref.section} already has a step ${to}.`);
  step.name = to;
  return next;
}

/** Moves a step to another position (Cut / Paste after the target, or first): only AE_SEQ_NUM changes [ao02]. */
export function moveStep(doc: AeDocument, ref: StepRef, after: string | undefined): AeDocument {
  const next = clone(doc);
  const { variant, index } = findStep(next, ref);
  const [step] = variant.steps.splice(index, 1);
  const at = after === undefined ? 0 : variant.steps.findIndex((s) => s.name === after) + 1;
  if (after !== undefined && at === 0) throw new AeEditError(`${ref.section} has no step ${after}.`);
  variant.steps.splice(at, 0, step);
  return next;
}

/**
 * Paste of a copied step after `after` in a section: the copy verbatim, its
 * SQL and PeopleCode included, renamed when its name is taken (Init -> Init3)
 * [ao03].
 */
export function pasteStep(doc: AeDocument, copied: AeDocStep, target: { section: string; variant?: AeVariantKey; after?: string }): { doc: AeDocument; step: string } {
  const next = clone(doc);
  const section = findSection(next, target.section);
  const variant = findVariant(section, target.variant);
  const taken = new Set(variant.steps.map((s) => s.name));
  const name = taken.has(copied.name) ? nextName(copied.name, taken, STEP_NAME_MAX) : copied.name;
  const step: AeDocStep = { ...clone(copied), name };
  delete step.origin;
  for (const a of step.actions) delete a.origin;
  const at = target.after === undefined ? variant.steps.length : variant.steps.findIndex((s) => s.name === target.after) + 1;
  variant.steps.splice(at, 0, step);
  return { doc: next, step: name };
}

/**
 * Application Library on: MAIN is renamed to the next free SectionN [ap05].
 * Off: a new, empty, Public MAIN is added when there is none [ap19].
 */
export function setApplicationLibrary(doc: AeDocument, library: boolean): AeDocument {
  let next = clone(doc);
  next.program.library = library;
  if (library && next.sections.some((s) => s.name === 'MAIN')) {
    next = renameSection(next, 'MAIN', nextSectionName(next));
  } else if (!library && !next.sections.some((s) => s.name === 'MAIN')) {
    next.sections.push({ name: 'MAIN', type: 'P', isPublic: true, variants: [newVariant('MAIN')] });
  }
  return next;
}

/** Copies a program under a new name (Save As [ae13]): every row, SQL and PeopleCode; a new identity. */
export function copyProgram(doc: AeDocument, name: string): AeDocument {
  checkName(name, PROGRAM_NAME_MAX, 'program');
  const next = clone(doc);
  next.name = name;
  next.copiedFrom = doc.name;
  delete next.origin;
  next.program.licenseCode = ' ';
  delete next.program.version;
  for (const s of next.sections) {
    delete s.origin; delete s.version;
    for (const v of s.variants) {
      delete v.origin;
      for (const st of v.steps) {
        delete st.origin;
        for (const a of st.actions) delete a.origin;
        if (st.doProgram === doc.name) st.doProgram = name;
      }
    }
  }
  return next;
}

export function checkName(name: string, max: number, what: string): void {
  if (!name || name.length > max) throw new AeEditError(`A ${what} name is 1 to ${max} characters: ${JSON.stringify(name)}.`);
  if (!NAME_PATTERN.test(name)) throw new AeEditError(`A ${what} name is letters, digits and _ # @ $: ${JSON.stringify(name)}.`);
}
