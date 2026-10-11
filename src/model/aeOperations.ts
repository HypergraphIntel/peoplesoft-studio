import * as z from 'zod/v4';

import type { ActionType } from './appEngine.js';
import { findStep, PROGRAM_NAME_MAX, type AeDocument, type AeVariantKey } from './aeDocument.js';
import { applyOp, type AeOp } from './aeSession.js';
import { applyStepSpec, documentFromSpec, type AeActionSpec, type AeProgramSpec } from './aeSpec.js';

/*
 * The App Engine operations an agent sends (the MCP tools, mcp/appEngineTools.ts),
 * as schemas, and applied with the designer's own operations (aeSession.ts):
 * App Designer's defaults first, then the values the operation gives.
 */

const ACTION_TYPES = ['Do When', 'Do While', 'Do Select', 'PeopleCode', 'SQL', 'Call Section', 'Log Message', 'Do Until', 'XSLT'] as const;
const CODE_OF: Record<string, ActionType> = {
  'Do When': 'H', 'Do While': 'W', 'Do Select': 'D', PeopleCode: 'P', SQL: 'S', 'Call Section': 'C', 'Log Message': 'M', 'Do Until': 'N', XSLT: 'X'
};
const PLATFORM_CODES: Record<string, string> = { default: ' ', DB2: '1', Oracle: '2', Informix: '3', 'DB2/UNIX': '4', AllBase: '5', Sybase: '6', Microsoft: '7' };

const actionFields = {
  description: z.string().max(30).optional(),
  comment: z.string().optional(),
  sql: z.string().optional().describe('SQL text (Do When / Do While / Do Select / SQL / Do Until). Use meta-SQL: %Select(F1,F2) to fetch into the state record, %Bind(F) for its values, %Table(REC) for temporary tables. Stored on one line, as App Designer stores it.'),
  peopleCode: z.string().optional().describe('PeopleCode source (PeopleCode action). Compiled when saved; state record fields are RECORD.FIELD.'),
  xslt: z.string().optional(),
  reuse: z.enum(['No', 'Yes', 'Bulk Insert']).optional().describe('ReUse Statement: Yes keeps the statement compiled across loop iterations; Bulk Insert (SQL / Do Select INSERTs) batches inserts.'),
  doSelectType: z.enum(['Select/Fetch', 'Reselect', 'Restartable']).optional().describe('Do Select: Select/Fetch (one cursor, no commits inside with restart on), Reselect (re-open each row), Restartable (commits inside; key the select so done rows drop out).'),
  noRows: z.enum(['Abort', 'Section Break', 'Continue', 'Skip Step']).optional().describe('SQL: what happens when it affects no row.'),
  onReturn: z.enum(['Abort', 'Break', 'Skip Step']).optional().describe('PeopleCode: what happens when it returns False.'),
  section: z.string().optional().describe('Call Section: the section to call.'),
  program: z.string().optional().describe('Call Section: another program (its Public section); omit for this program.'),
  dynamic: z.boolean().optional().describe('Call Section: the section and program come from the state record (AE_SECTION, AE_APPLID) at run time.'),
  messageSet: z.number().int().optional(), messageNumber: z.number().int().optional(),
  parameters: z.string().optional().describe('Log Message parameters: %Bind(F) values or literals, comma separated.'),
  graphicalMapper: z.boolean().optional()
};
export const actionSpec = z.object({ type: z.enum(ACTION_TYPES), ...actionFields });
// In an operation, section / step locate the action: the Call Section target is callSection / callProgram.
const { section: _cs, program: _cp, ...actionOpBase } = actionFields;
const actionOpFields = {
  ...actionOpBase,
  callSection: z.string().optional().describe('Call Section: the section to call.'),
  callProgram: z.string().optional().describe('Call Section: another program (its Public section); omit for this program.')
};
const toActionSpec = (a: { type: AeActionSpec['type']; callSection?: string; callProgram?: string } & Record<string, unknown>): AeActionSpec => {
  const { callSection, callProgram, ...rest } = a;
  return { ...(rest as unknown as AeActionSpec), ...(callSection !== undefined ? { section: callSection } : {}), ...(callProgram !== undefined ? { program: callProgram } : {}) };
};
const stepFields = {
  description: z.string().max(30).optional(), comment: z.string().optional(),
  commitAfter: z.enum(['Default', 'Later', 'After Step']).optional(),
  frequency: z.number().int().min(0).optional().describe('With a Do Select: commit every n rows.'),
  onError: z.enum(['Abort', 'Ignore', 'Suppress']).optional(), active: z.boolean().optional()
};
const stepSpec = z.object({ name: z.string().min(1).max(8), ...stepFields, actions: z.array(actionSpec) });
const variantFields = {
  market: z.string().max(3).optional(), platform: z.enum(['default', 'DB2', 'Oracle', 'Microsoft']).optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
};
const sectionSpec = z.object({
  name: z.string().min(1).max(8), ...variantFields, active: z.boolean().optional(), description: z.string().max(30).optional(), comment: z.string().optional(),
  type: z.enum(['Prepare Only', 'Critical Updates']).optional(), public: z.boolean().optional(), autoCommit: z.boolean().optional(), steps: z.array(stepSpec)
});
const programFields = {
  description: z.string().max(30).optional(), comments: z.string().optional(), owner: z.string().optional(),
  programType: z.enum(['Standard', 'Upgrade Only', 'Import Only', 'Daemon Only', 'Transform Only']).optional(),
  disableRestart: z.boolean().optional(), applicationLibrary: z.boolean().optional(), batchOnly: z.boolean().optional(), messageSet: z.number().int().optional(),
  tempTableInstances: z.number().int().min(0).optional(), shareTablesOnline: z.boolean().optional(), useDeleteForTruncate: z.boolean().optional(),
  abortWithoutInstance: z.boolean().optional()
};
export const programSpec = z.object({
  program: z.string().min(1).max(PROGRAM_NAME_MAX), ...programFields,
  stateRecords: z.array(z.object({ record: z.string(), default: z.boolean().optional() })).optional(),
  tempTables: z.array(z.string()).optional(), sections: z.array(sectionSpec).min(1)
});

const variantSel = z.object(variantFields).optional().describe('Which variant of the section (market / platform / effective date); omit when it has one.');
const where = { section: z.string(), variant: variantSel };
export const operation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_program'), ...programFields }),
  z.object({ op: z.literal('set_state_records'), records: z.array(z.object({ record: z.string(), default: z.boolean().optional() })) }),
  z.object({ op: z.literal('set_temp_tables'), tables: z.array(z.string()) }),
  z.object({ op: z.literal('add_section'), name: z.string().max(8).optional().describe('Default: the next free SectionN.'), description: z.string().max(30).optional(),
    type: z.enum(['Prepare Only', 'Critical Updates']).optional(), public: z.boolean().optional(), autoCommit: z.boolean().optional() }),
  z.object({ op: z.literal('set_section'), ...where, set: z.object({ ...variantFields, active: z.boolean().optional(), description: z.string().max(30).optional(),
    comment: z.string().optional(), type: z.enum(['Prepare Only', 'Critical Updates']).optional(), public: z.boolean().optional(), autoCommit: z.boolean().optional() }) }),
  z.object({ op: z.literal('rename_section'), section: z.string(), to: z.string().max(8) }),
  z.object({ op: z.literal('delete_section'), ...where }),
  z.object({ op: z.literal('add_step'), ...where, after: z.string().optional().describe('The step it follows; omit to make it first.'),
    name: z.string().max(8).optional().describe('Default: the step above\'s name with its number incremented.'), ...stepFields,
    actions: z.array(actionSpec).optional().describe('Default: one SQL action, as Insert Step/Action does.') }),
  z.object({ op: z.literal('set_step'), ...where, step: z.string(), ...stepFields }),
  z.object({ op: z.literal('rename_step'), ...where, step: z.string(), to: z.string().max(8) }),
  z.object({ op: z.literal('move_step'), ...where, step: z.string(), after: z.string().nullable().describe('The step it should follow; null to make it first.') }),
  z.object({ op: z.literal('copy_step'), ...where, step: z.string(), toSection: z.string(), toVariant: variantSel, after: z.string().optional() }),
  z.object({ op: z.literal('delete_step'), ...where, step: z.string() }),
  z.object({ op: z.literal('add_action'), ...where, step: z.string(), type: z.enum(ACTION_TYPES), ...actionOpFields }),
  z.object({ op: z.literal('set_action'), ...where, step: z.string(), type: z.enum(ACTION_TYPES), ...actionOpFields }),
  z.object({ op: z.literal('change_action_type'), ...where, step: z.string(), type: z.enum(ACTION_TYPES), to: z.enum(ACTION_TYPES) }),
  z.object({ op: z.literal('delete_action'), ...where, step: z.string(), type: z.enum(ACTION_TYPES) })
]);
export type Operation = z.infer<typeof operation>;

function variantKey(v: { market?: string; platform?: string; effectiveDate?: string } | undefined, doc: AeDocument, section: string): AeVariantKey | undefined {
  if (!v || (v.market === undefined && v.platform === undefined && v.effectiveDate === undefined)) return undefined;
  const s = doc.sections.find((x) => x.name === section);
  const match = s?.variants.filter((x) => (v.market === undefined || x.market === v.market.toUpperCase()) &&
    (v.platform === undefined || x.dbType === PLATFORM_CODES[v.platform]) && (v.effectiveDate === undefined || x.effdt === v.effectiveDate));
  if (!match?.length) throw new Error(`Section ${section} has no variant ${JSON.stringify(v)}.`);
  if (match.length > 1) throw new Error(`Section ${section} has ${match.length} variants matching ${JSON.stringify(v)}; give market, platform and effective date.`);
  return { market: match[0].market, dbType: match[0].dbType, effdt: match[0].effdt };
}

/** An MCP operation applied with the designer's operations (App Designer's defaults), then its values. */
export function applyOperation(doc: AeDocument, o: Operation): AeDocument {
  const vk = 'section' in o && 'variant' in o ? variantKey(o.variant, doc, (o as { section: string }).section) : undefined;
  const ref = (step: string) => ({ section: (o as { section: string }).section, ...(vk ? { variant: vk } : {}), step });
  const prog = (fields: Partial<AeProgramSpec>) => {
    const spec = documentFromSpec({ program: doc.name, ...fields, sections: [] } as AeProgramSpec).program;
    const patch: Record<string, unknown> = {};
    const p = doc.program;
    if (fields.description !== undefined) patch.descr = spec.descr;
    if (fields.comments !== undefined) patch.descrlong = spec.descrlong;
    if (fields.owner !== undefined) patch.owner = spec.owner;
    if (fields.programType !== undefined) patch.programType = spec.programType;
    if (fields.disableRestart !== undefined) patch.disableRestart = spec.disableRestart;
    if (fields.messageSet !== undefined) patch.messageSet = spec.messageSet;
    if (fields.tempTableInstances !== undefined) patch.tempTableInstances = spec.tempTableInstances;
    let recuse = p.recuse;
    const bit = (b: number, on: boolean | undefined) => { if (on !== undefined) recuse = on ? recuse | b : recuse & ~b; };
    bit(2, fields.batchOnly); bit(4, fields.shareTablesOnline); bit(8, fields.useDeleteForTruncate); bit(1, fields.abortWithoutInstance);
    if (recuse !== p.recuse) patch.recuse = recuse;
    let next = Object.keys(patch).length ? applyOp(doc, { kind: 'setProgram', patch } as AeOp) : doc;
    if (fields.applicationLibrary !== undefined && fields.applicationLibrary !== p.library) next = applyOp(next, { kind: 'setLibrary', library: fields.applicationLibrary });
    return next;
  };
  const actionPatch = (d: AeDocument, step: string, a: AeActionSpec) => {
    const next = structuredClone(d);
    applyStepSpec(next, ref(step), { actions: [a] });
    return next;
  };
  switch (o.op) {
    case 'set_program': { const { op: _o, ...fields } = o; return prog(fields); }
    case 'set_state_records':
      return applyOp(doc, { kind: 'setStateRecords', records: o.records.map((r, i) => ({ record: r.record, isDefault: r.default ?? (i === 0 && !o.records.some((x) => x.default)) })) });
    case 'set_temp_tables': return applyOp(doc, { kind: 'setTempTables', tables: o.tables });
    case 'add_section': {
      let next = applyOp(doc, { kind: 'insertSection', ...(o.name ? { name: o.name } : {}) });
      const name = next.sections.at(-1)!.name;
      if (o.type !== undefined || o.public !== undefined) next = applyOp(next, { kind: 'setSection', section: name, patch: { ...(o.type ? { type: o.type === 'Critical Updates' ? 'C' : 'P' } : {}), ...(o.public !== undefined ? { isPublic: o.public } : {}) } });
      if (o.description !== undefined || o.autoCommit !== undefined) next = applyOp(next, { kind: 'setVariant', section: name, patch: { ...(o.description !== undefined ? { descr: o.description || ' ' } : {}), ...(o.autoCommit !== undefined ? { autoCommit: o.autoCommit ? 'Y' : 'N' } : {}) } });
      return next;
    }
    case 'set_section': {
      const s = o.set;
      let next = doc;
      if (s.type !== undefined || s.public !== undefined) next = applyOp(next, { kind: 'setSection', section: o.section, patch: { ...(s.type ? { type: s.type === 'Critical Updates' ? 'C' : 'P' } : {}), ...(s.public !== undefined ? { isPublic: s.public } : {}) } });
      const patch: Record<string, unknown> = {};
      if (s.market !== undefined) patch.market = s.market.toUpperCase();
      if (s.platform !== undefined) patch.dbType = PLATFORM_CODES[s.platform];
      if (s.effectiveDate !== undefined) patch.effdt = s.effectiveDate;
      if (s.active !== undefined) patch.active = s.active;
      if (s.description !== undefined) patch.descr = s.description || ' ';
      if (s.comment !== undefined) patch.descrlong = s.comment || null;
      if (s.autoCommit !== undefined) patch.autoCommit = s.autoCommit ? 'Y' : 'N';
      if (Object.keys(patch).length) next = applyOp(next, { kind: 'setVariant', section: o.section, ...(vk ? { variant: vk } : {}), patch } as AeOp);
      return next;
    }
    case 'rename_section': return applyOp(doc, { kind: 'renameSection', from: o.section, to: o.to });
    case 'delete_section': return applyOp(doc, { kind: 'deleteSection', section: o.section, ...(vk ? { variant: vk } : {}) });
    case 'add_step': {
      const types = o.actions ? o.actions.map((a) => CODE_OF[a.type]) : ['S' as ActionType];
      let next = applyOp(doc, { kind: 'insertStep', section: o.section, ...(vk ? { variant: vk } : {}), ...(o.after ? { after: o.after } : {}), ...(o.name ? { name: o.name } : {}), actions: types });
      const sec = next.sections.find((x) => x.name === o.section)!;
      const v = vk ? sec.variants.find((x) => x.market === vk.market && x.dbType === vk.dbType && x.effdt === vk.effdt)! : sec.variants[0];
      const before = new Set(doc.sections.find((x) => x.name === o.section)!.variants.flatMap((x) => x.steps.map((st) => st.name)));
      const name = o.name ?? v.steps.find((st) => !before.has(st.name))!.name;
      next = structuredClone(next);
      applyStepSpec(next, ref(name), { ...pick(o, ['description', 'comment', 'commitAfter', 'frequency', 'onError', 'active']), actions: o.actions ?? [] });
      return next;
    }
    case 'set_step': {
      const next = structuredClone(doc);
      applyStepSpec(next, ref(o.step), { ...pick(o, ['description', 'comment', 'commitAfter', 'frequency', 'onError', 'active']), actions: [] });
      return next;
    }
    case 'rename_step': return applyOp(doc, { kind: 'renameStep', ref: ref(o.step), to: o.to });
    case 'move_step': return applyOp(doc, { kind: 'moveStep', ref: ref(o.step), ...(o.after ? { after: o.after } : {}) });
    case 'copy_step': {
      const step = findStep(doc, ref(o.step)).step;
      const tvk = variantKey(o.toVariant, doc, o.toSection);
      return applyOp(doc, { kind: 'pasteStep', step, target: { section: o.toSection, ...(tvk ? { variant: tvk } : {}), ...(o.after ? { after: o.after } : {}) } });
    }
    case 'delete_step': return applyOp(doc, { kind: 'deleteStep', ref: ref(o.step) });
    case 'add_action': {
      const { op: _o, section: _s, variant: _v, step, ...a } = o;
      return actionPatch(applyOp(doc, { kind: 'insertAction', ref: ref(step), type: CODE_OF[a.type] }), step, toActionSpec(a));
    }
    case 'set_action': { const { op: _o, section: _s, variant: _v, step, ...a } = o; return actionPatch(doc, step, toActionSpec(a)); }
    case 'change_action_type': return applyOp(doc, { kind: 'changeActionType', ref: { ...ref(o.step), type: CODE_OF[o.type] }, type: CODE_OF[o.to] });
    case 'delete_action': return applyOp(doc, { kind: 'deleteAction', ref: { ...ref(o.step), type: CODE_OF[o.type] } });
  }
}

function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

