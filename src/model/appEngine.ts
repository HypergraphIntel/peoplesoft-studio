/*
 * App Engine programs, as the PeopleTools tables hold them (HRDMO,
 * PeopleTools 8.62; docs/APP_ENGINE.md):
 *
 *   PSAEAPPLDEFN      the program: one row
 *   PSAEAPPLSTATE     its state records (one AE_DEFAULT_STATE 'Y')
 *   PSAEAPPLTEMPTBL   its temporary tables
 *   PSAESECTDEFN      a section: one row per name (type, access)
 *   PSAESECTDTLDEFN   a section variant: MARKET / DBTYPE / EFFDT (description,
 *                     status, auto commit); 169 of HRDMO's 11,247 sections have
 *                     more than one
 *   PSAESTEPDEFN      a step of a variant, ordered by AE_SEQ_NUM (1..n without
 *                     gaps in all 11,540 variants)
 *   PSAESTMTDEFN      an action of a step, keyed by its type: a step holds at
 *                     most one of each, never both SQL and Call Section, and
 *                     XSLT alone (every HRDMO step)
 *   PSAESTEPMSGDEFN   a Log Message action's parameters
 *
 * An action's text is an SQL definition: SQLID = the program padded to 12,
 * the section to 8, the step to 8, then the action type (39,027 of 39,027),
 * SQLTYPE 1 (6 for XSLT), the text row keyed by the variant's MARKET / DBTYPE
 * / EFFDT, cut into 14,000-character rows by SEQNUM. A PeopleCode action is
 * the program keyed 66 program / 77 section / 39 market / 20 platform
 * ('default' when blank) / 21 effective date / 78 step / 12 'OnExecute'.
 */

/** App Designer's order of a step's actions (PeopleBooks; every HRDMO step's set fits it). */
export const ACTION_ORDER = ['H', 'W', 'D', 'P', 'S', 'C', 'X', 'M', 'N'] as const;
export type ActionType = (typeof ACTION_ORDER)[number];

/** PSXLATITEM AE_STMT_TYPE. */
export const ACTION_LABELS: Readonly<Record<ActionType, string>> = {
  H: 'Do When', W: 'Do While', D: 'Do Select', P: 'PeopleCode', S: 'SQL', C: 'Call Section', X: 'XSLT', M: 'Log Message', N: 'Do Until'
};

/**
 * Code labels. From PSXLATITEM where the database has them; the rest
 * (marked in docs/APP_ENGINE.md) are App Designer's names for the values,
 * not yet confirmed against its dialogs.
 */
export const LABELS = {
  /** PSXLATITEM AE_SECTION_TYPE. */
  sectionType: { P: 'Preparation Only', C: 'Critical Updates' } as Record<string, string>,
  /** AE_PUBLIC_SW: the section's Access. */
  access: { Y: 'Public', N: 'Private' } as Record<string, string>,
  /** PSXLATITEM AE_AUTO_COMMIT. */
  autoCommit: { N: 'No Auto Commit', Y: 'After Step', M: 'Conditionally' } as Record<string, string>,
  /** PSXLATITEM AE_ACTIVE_STATUS / EFF_STATUS. */
  status: { A: 'Active', I: 'Inactive' } as Record<string, string>,
  /** PSXLATITEM AE_ABEND_ACTION: the step's On Error. */
  onError: { A: 'Abort', B: 'Break', I: 'Ignore', S: 'Suppress' } as Record<string, string>,
  /** PSXLATITEM AE_COMMIT_AFTER. */
  commit: { D: 'Default', Y: 'After Step', N: 'Later' } as Record<string, string>,
  /** AE_ON_NOROWS: an SQL action's On No Rows (letters as On Error's). */
  onNoRows: { A: 'Abort', B: 'Break', C: 'Continue', S: 'Skip Step' } as Record<string, string>,
  /** AE_PC_ON_FALSE: a PeopleCode action's On Return. */
  onReturn: { A: 'Abort', B: 'Break', S: 'Skip Step' } as Record<string, string>,
  /** PSXLATITEM AE_DO_SELECT_TYPE (F, R); Y is Restartable. */
  doSelectType: { F: 'Select/Fetch', R: 'Re-Select', Y: 'Restartable' } as Record<string, string>,
  /** PSXLATITEM AE_REUSE_STMT (N, Y, S); I is Bulk Insert. */
  reuse: { N: 'No', Y: 'Yes', I: 'Bulk Insert', S: 'Save Stmt' } as Record<string, string>,
  /** AEPROGTYPE. */
  programType: { 0: 'Standard', 1: 'Upgrade Only', 2: 'Import Only', 3: 'Daemon Only', 4: 'Transform Only' } as Record<string, string>,
  /** DBTYPE as App Designer's Platform; ' ' is Default. PSXLATITEM DBTYPE names the others. */
  platform: { ' ': 'Default', 1: 'DB2', 2: 'Oracle', 3: 'Informix', 4: 'DB2/UNIX', 5: 'AllBase', 6: 'Sybase', 7: 'Microsoft' } as Record<string, string>
};

/** PSPCMPROG OBJECTVALUE4 for a DBTYPE, as HRDMO's App Engine PeopleCode stores it. */
export const PEOPLECODE_PLATFORM: Readonly<Record<string, string>> = {
  ' ': 'default', 1: 'DB2', 2: 'ORACLE', 3: 'INFORMIX', 4: 'DB2UNIX', 6: 'SYBASE', 7: 'MICROSFT'
};

export type Row = Record<string, unknown>;

/** The rows a program is built from (columns as the tables name them). */
export interface AppEngineRows {
  program: Row;
  states: Row[];
  tempTables: Row[];
  sections: Row[];
  variants: Row[];
  steps: Row[];
  actions: Row[];
  messages: Row[];
  /** SQL text rows: SQLID, MARKET, DBTYPE, EFFDT (YYYY-MM-DD), SEQNUM, SQLTEXT. */
  sqlText: Row[];
  /** The Message Catalog entries Log Message actions name: MESSAGE_SET_NBR, MESSAGE_NBR, MESSAGE_TEXT. */
  messageCatalog?: Row[];
}

export interface AeAction {
  type: ActionType;
  description: string;
  /** SQL-based actions: the SQL definition and its text for this variant. */
  sqlId?: string;
  text?: string;
  reuse: string;
  doSelectType: string;
  /** A Log Message action's parameters. */
  messageParms?: string;
}

export interface AeStep {
  name: string;
  seq: number;
  description: string;
  active: boolean;
  onError: string;
  commit: string;
  commitFrequency: number;
  onNoRows: string;
  onReturn: string;
  /** Call Section: the section, its program (blank: this one), and whether it is dynamic. */
  call?: { section: string; program: string; dynamic: boolean };
  message?: { set: number; number: number; text?: string };
  actions: AeAction[];
}

export interface AeVariant {
  market: string;
  dbType: string;
  /** YYYY-MM-DD. */
  effdt: string;
  active: boolean;
  description: string;
  autoCommit: string;
  steps: AeStep[];
}

export interface AeSection {
  name: string;
  type: string;
  isPublic: boolean;
  variants: AeVariant[];
}

export interface AppEngineProgram {
  name: string;
  description: string;
  programType: string;
  disableRestart: boolean;
  library: boolean;
  messageSet: number;
  tempTableInstances: number;
  owner: string;
  lastUpdated: string;
  lastUpdatedBy: string;
  stateRecords: { record: string; isDefault: boolean }[];
  tempTables: string[];
  sections: AeSection[];
}

const str = (v: unknown) => String(v ?? '').trim();
const raw = (v: unknown) => String(v ?? '');
const num = (v: unknown) => Number(v ?? 0);
/** An EFFDT as YYYY-MM-DD, from a Date (read at local midnight) or a string. */
export function dateKey(v: unknown): string {
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return str(v).slice(0, 10);
}
/** DBTYPE as stored: ' ' for Default, else its digit. */
const dbType = (v: unknown) => raw(v) === '' ? ' ' : raw(v).trim() || ' ';

/** An action's SQL definition ID (39,027 of 39,027 on HRDMO). */
export function actionSqlId(program: string, section: string, step: string, type: ActionType): string {
  return program.padEnd(12) + section.padEnd(8) + step.padEnd(8) + type;
}

/**
 * A PeopleCode action's PSPCMPROG key: program, section, market, platform,
 * effective date, step, OnExecute. Undefined for a platform no stored
 * PeopleCode names (AllBase, DBTYPE 5: two HRDMO programs have such sections,
 * and no PSPCMPROG row has an AllBase platform).
 */
export function peopleCodeKeyParts(program: string, section: string, variant: { market: string; dbType: string; effdt: string }, step: string): string[] | undefined {
  const platform = PEOPLECODE_PLATFORM[variant.dbType];
  return platform ? [program, section, variant.market, platform, variant.effdt, step, 'OnExecute'] : undefined;
}

/**
 * A PeopleCode action's key as PSPROJECTITEM holds it (OBJECTTYPE 43): the
 * program, then the section (8 characters), market (3), platform (9) and
 * effective date in one value -- "MAIN    GBLdefault  1900-01-01" -- then
 * the step and event; as the seven PSPCMPROG parts. A key already in seven
 * parts is returned as it is.
 */
export function unpackPeopleCodeKey(parts: readonly string[]): readonly string[] {
  if (parts.length !== 4 || parts[1].length <= 8) return parts;
  const packed = parts[1].padEnd(30);
  return [parts[0], packed.slice(0, 8).trim(), packed.slice(8, 11).trim(), packed.slice(11, 20).trim(), packed.slice(20, 30).trim(), parts[2], parts[3]];
}

const variantKey = (r: Row) => `${str(r.AE_SECTION)}|${str(r.MARKET)}|${dbType(r.DBTYPE)}|${dateKey(r.EFFDT)}`;

export function buildAppEngine(rows: AppEngineRows): AppEngineProgram {
  const p = rows.program;
  const name = str(p.AE_APPLID);
  const text = new Map<string, string>();
  const chunks = [...rows.sqlText].sort((a, b) => num(a.SEQNUM) - num(b.SEQNUM));
  for (const r of chunks) {
    const k = `${raw(r.SQLID)}|${str(r.MARKET)}|${dbType(r.DBTYPE)}|${dateKey(r.EFFDT)}`;
    text.set(k, (text.get(k) ?? '') + raw(r.SQLTEXT));
  }
  const catalog = new Map((rows.messageCatalog ?? []).map((m) => [`${num(m.MESSAGE_SET_NBR)}/${num(m.MESSAGE_NBR)}`, str(m.MESSAGE_TEXT)]));
  const messages = new Map(rows.messages.map((m) => [`${variantKey(m)}|${str(m.AE_STEP)}`, raw(m.AE_MESSAGE_PARMS).trim()]));
  const actionsOf = new Map<string, AeAction[]>();
  for (const a of rows.actions) {
    const type = str(a.AE_STMT_TYPE) as ActionType;
    const key = `${variantKey(a)}|${str(a.AE_STEP)}`;
    const sqlId = raw(a.SQLID).trim() ? raw(a.SQLID) : undefined;
    const action: AeAction = {
      type, description: str(a.DESCR), reuse: raw(a.AE_REUSE_STMT).trim() || 'N', doSelectType: raw(a.AE_DO_SELECT_TYPE).trim(),
      ...(sqlId ? { sqlId: sqlId.trimEnd(), text: text.get(`${sqlId}|${str(a.MARKET)}|${dbType(a.DBTYPE)}|${dateKey(a.EFFDT)}`) ?? '' } : {}),
      ...(type === 'M' ? { messageParms: messages.get(key) ?? '' } : {})
    };
    actionsOf.set(key, [...(actionsOf.get(key) ?? []), action]);
  }
  const stepsOf = new Map<string, AeStep[]>();
  for (const s of [...rows.steps].sort((a, b) => num(a.AE_SEQ_NUM) - num(b.AE_SEQ_NUM))) {
    const key = variantKey(s);
    const actions = (actionsOf.get(`${key}|${str(s.AE_STEP)}`) ?? [])
      .sort((a, b) => ACTION_ORDER.indexOf(a.type) - ACTION_ORDER.indexOf(b.type));
    const callSection = str(s.AE_DO_SECTION);
    const step: AeStep = {
      name: str(s.AE_STEP), seq: num(s.AE_SEQ_NUM), description: str(s.DESCR), active: str(s.AE_ACTIVE_STATUS) !== 'I',
      onError: str(s.AE_ABEND_ACTION), commit: str(s.AE_COMMIT_AFTER), commitFrequency: num(s.AE_COMMIT_FREQ),
      onNoRows: str(s.AE_ON_NOROWS), onReturn: str(s.AE_PC_ON_FALSE),
      ...(actions.some((a) => a.type === 'C') ? { call: { section: callSection, program: str(s.AE_DO_APPL_ID), dynamic: str(s.AE_DYNAMIC_DO) === 'Y' } } : {}),
      ...(actions.some((a) => a.type === 'M') ? {
        message: {
          set: num(s.MESSAGE_SET_NBR), number: num(s.MESSAGE_NBR),
          ...(catalog.has(`${num(s.MESSAGE_SET_NBR)}/${num(s.MESSAGE_NBR)}`) ? { text: catalog.get(`${num(s.MESSAGE_SET_NBR)}/${num(s.MESSAGE_NBR)}`) } : {})
        }
      } : {}),
      actions
    };
    stepsOf.set(key, [...(stepsOf.get(key) ?? []), step]);
  }
  const variantsOf = new Map<string, AeVariant[]>();
  for (const v of rows.variants) {
    const variant: AeVariant = {
      market: str(v.MARKET), dbType: dbType(v.DBTYPE), effdt: dateKey(v.EFFDT), active: str(v.EFF_STATUS) !== 'I',
      description: str(v.DESCR), autoCommit: str(v.AE_AUTO_COMMIT), steps: stepsOf.get(variantKey(v)) ?? []
    };
    const section = str(v.AE_SECTION);
    variantsOf.set(section, [...(variantsOf.get(section) ?? []), variant]);
  }
  // MAIN first, as App Designer lists it; then the others by name.
  const sections = [...rows.sections].sort((a, b) =>
    (str(a.AE_SECTION) === 'MAIN' ? -1 : str(b.AE_SECTION) === 'MAIN' ? 1 : str(a.AE_SECTION).localeCompare(str(b.AE_SECTION))))
    .map((s) => ({
      name: str(s.AE_SECTION), type: str(s.AE_SECTION_TYPE), isPublic: str(s.AE_PUBLIC_SW) === 'Y',
      variants: (variantsOf.get(str(s.AE_SECTION)) ?? []).sort((a, b) =>
        a.market.localeCompare(b.market) || a.dbType.localeCompare(b.dbType) || a.effdt.localeCompare(b.effdt))
    }));
  return {
    name, description: str(p.DESCR), programType: str(p.AEPROGTYPE), disableRestart: str(p.AE_DISABLE_RESTART) === 'Y',
    library: str(p.AE_APPLLIBRARY) === 'Y', messageSet: num(p.MESSAGE_SET_NBR), tempTableInstances: num(p.TEMPTBLINSTANCES),
    owner: str(p.OBJECTOWNERID), lastUpdated: str(p.LASTUPDDTTM instanceof Date ? p.LASTUPDDTTM.toISOString() : p.LASTUPDDTTM),
    lastUpdatedBy: str(p.LASTUPDOPRID),
    stateRecords: rows.states.map((r) => ({ record: str(r.AE_STATE_RECNAME), isDefault: str(r.AE_DEFAULT_STATE) === 'Y' }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.record.localeCompare(b.record)),
    tempTables: rows.tempTables.map((r) => str(r.RECNAME)).sort(),
    sections
  };
}

const label = (map: Record<string, string>, code: string) => map[code] ?? (code ? `${code} (stored value)` : '');

/**
 * The program as text, in App Designer's Program Flow order: each section,
 * its steps in sequence, each step's actions in action order, with SQL and
 * PeopleCode inline. `peopleCode(section, variant, step)` gives a PeopleCode
 * action's source (undefined when it cannot be read).
 */
export function renderAppEngine(program: AppEngineProgram,
  peopleCode: (section: AeSection, variant: AeVariant, step: AeStep) => string | undefined = () => undefined,
  onlySection?: string): string {
  if (onlySection !== undefined) {
    const section = program.sections.find((s) => s.name === onlySection);
    if (!section) throw new Error(`${program.name} has no section ${onlySection}.`);
    program = { ...program, sections: [section] };
  }
  const out: string[] = [];
  const indent = (text: string, by: string) => text.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n').map((l) => by + l);
  out.push(`App Engine Program ${program.name}${program.description ? ` -- ${program.description}` : ''}`);
  out.push(`  Type: ${label(LABELS.programType, program.programType)}   Disable Restart: ${program.disableRestart ? 'Yes' : 'No'}` +
    `   Application Library: ${program.library ? 'Yes' : 'No'}   Message Set: ${program.messageSet}`);
  out.push(`  State records: ${program.stateRecords.map((s) => s.record + (s.isDefault ? ' (default)' : '')).join(', ') || '(none)'}`);
  if (program.tempTables.length) out.push(`  Temp tables: ${program.tempTables.join(', ')} (instances: ${program.tempTableInstances})`);
  out.push(`  Owner ID: ${program.owner || '(none)'}   Last updated: ${program.lastUpdated} by ${program.lastUpdatedBy}`);
  for (const section of program.sections) {
    for (const v of section.variants) {
      out.push('');
      out.push(`Section ${section.name}  [Market ${v.market}, Platform ${label(LABELS.platform, v.dbType)}, Effective ${v.effdt}]` +
        `${v.active ? '' : ' INACTIVE'}${v.description ? ` -- ${v.description}` : ''}`);
      out.push(`  ${label(LABELS.access, section.isPublic ? 'Y' : 'N')}, ${label(LABELS.sectionType, section.type)}, Auto Commit: ${label(LABELS.autoCommit, v.autoCommit)}`);
      for (const step of v.steps) {
        out.push('');
        out.push(`  Step ${step.name} (${step.seq})${step.active ? '' : ' INACTIVE'}${step.description ? ` -- ${step.description}` : ''}`);
        out.push(`    On Error: ${label(LABELS.onError, step.onError)}   Commit: ${label(LABELS.commit, step.commit)}` +
          `${step.commitFrequency ? `   Frequency: ${step.commitFrequency}` : ''}`);
        for (const a of step.actions) {
          const options: string[] = [];
          if (a.type === 'D') options.push(`Do Select Type: ${label(LABELS.doSelectType, a.doSelectType)}`);
          if (['S', 'D', 'H', 'W', 'N'].includes(a.type)) options.push(`ReUse Statement: ${label(LABELS.reuse, a.reuse)}`);
          if (a.type === 'S') options.push(`No Rows: ${label(LABELS.onNoRows, step.onNoRows)}`);
          if (a.type === 'P') options.push(`On Return: ${label(LABELS.onReturn, step.onReturn)}`);
          out.push(`    ${ACTION_LABELS[a.type]}${options.length ? `  (${options.join(', ')})` : ''}${a.description ? ` -- ${a.description}` : ''}`);
          if (a.type === 'C' && step.call) {
            out.push(`      ${step.call.program ? `${step.call.program}.` : ''}${step.call.section || '(none)'}${step.call.dynamic ? ' (Dynamic)' : ''}`);
          } else if (a.type === 'M' && step.message) {
            out.push(`      Message ${step.message.set}, ${step.message.number}${step.message.text !== undefined ? `: "${step.message.text}"` : ''}` +
              `${a.messageParms ? `  Parameters: ${a.messageParms}` : ''}`);
          } else if (a.type === 'P') {
            const source = peopleCode(section, v, step);
            out.push(...(source === undefined ? ['      (PeopleCode not read)'] : source.trim() ? indent(source, '      ') : ['      (empty)']));
          } else if (a.text !== undefined) {
            out.push(...(a.text.trim() ? indent(a.text, '      ') : ['      (no text)']));
          }
        }
      }
    }
  }
  return out.join('\n') + '\n';
}
