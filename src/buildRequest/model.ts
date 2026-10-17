import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { DefinitionType as D } from '../model/definitions.js';
import type { ExtractionMethod } from './extract.js';

/*
 * Build Requests (docs/BUILD_REQUESTS.md): a developer gathers what a business
 * user sent -- documents, spreadsheets, sample files, notes -- and an AI agent
 * turns it into PeopleSoft definitions through the Studio MCP.
 *
 * The lifecycle is a gate, not a suggestion: the agent analyzes the request
 * and proposes a build spec (every object it means to create or change);
 * only the developer approves it, in VS Code, and only an approved spec that
 * still matches the request's inputs authorizes building. Changing the
 * request (its text, attachments, answers) or the spec withdraws approval.
 * Building itself still passes every existing write gate and Change Review.
 */

export const SCHEMA = 'psft-build-request/1';

export const REQUEST_KINDS = {
  'ae-inbound-file': { label: 'Inbound file interface (App Engine)', summary: 'Load a file from another system into PeopleSoft.' },
  'ae-outbound-file': { label: 'Outbound file interface (App Engine)', summary: 'Extract PeopleSoft data to a file for another system.' },
  'ae-batch': { label: 'Batch process (App Engine)', summary: 'A scheduled or on-demand App Engine that processes PeopleSoft data.' },
  'ib-integration': { label: 'Integration Broker service', summary: 'A real-time or asynchronous web service / message integration.' },
  other: { label: 'Other', summary: 'Anything else; the agent proposes the objects.' }
} as const;
export type RequestKind = keyof typeof REQUEST_KINDS;

export interface TypicalObject { type: D | null; kind: string; purpose: string }

/**
 * The objects a request of each kind usually needs: a checklist for the
 * agent's analysis, not a prescription. Whether Studio can build each one is
 * decided from the capability catalog, never from this list.
 */
export const TYPICAL_OBJECTS: Record<RequestKind, TypicalObject[]> = {
  'ae-inbound-file': [
    { type: D.Field, kind: 'Field', purpose: 'New fields the file brings that no existing field fits (reuse delivered fields first).' },
    { type: D.Record, kind: 'Record', purpose: 'A staging table for the loaded rows; often an error/audit table.' },
    { type: D.Record, kind: 'Record', purpose: 'A run control record (OPRID, RUN_CNTL_ID and the run parameters).' },
    { type: D.Component, kind: 'Setup component', purpose: 'Maintains the configuration records online (vendor-assigned values, code mappings): configuration is entered through component pages by the people who own it, never INSERTed. Pages for the setup record and each mapping grid, with the menu, content reference and security to reach them.' },
    { type: D.FileLayout, kind: 'File Layout', purpose: 'The inbound file\'s format, mapped to the staging record.' },
    { type: D.AppEngineProgram, kind: 'App Engine program', purpose: 'Read the file, validate, load staging, apply to target tables, report errors.' },
    { type: D.SqlDefinition, kind: 'SQL definition', purpose: 'Reusable SQL for the program\'s steps.' },
    { type: D.ApplicationPackage, kind: 'Application package', purpose: 'Shared logic (validation, mapping) callable from AE PeopleCode.' },
    { type: D.MessageCatalog, kind: 'Message catalog', purpose: 'Error and status messages.' },
    { type: D.ProcessDefinition, kind: 'Process definition', purpose: 'Run the program from Process Scheduler.' },
    { type: D.Page, kind: 'Page', purpose: 'The run control page.' },
    { type: D.Component, kind: 'Component', purpose: 'The run control component.' },
    { type: D.Menu, kind: 'Menu', purpose: 'Menu registration for the run control component.' },
    { type: D.PortalRegistry, kind: 'Portal content reference', purpose: 'Navigation to the run control.' },
    { type: D.PermissionList, kind: 'Permission list access', purpose: 'Security for the run control and process.' },
    { type: D.Project, kind: 'Project', purpose: 'Every object and the related definitions it needs, for migration: add them with psft_add_to_project (includeRelated, the default) and run psft_project_related before reporting the project built -- an App Engine program added alone migrates as a header with no sections, SQL or PeopleCode, and one without the SQL objects its code calls fails at run time in the target. Menus, Portal Registry structures, and permission lists and roles go in only where Settings > Project Contents includes them; psft_add_to_project reports the rest as excluded.' }
  ],
  'ae-outbound-file': [
    { type: D.Record, kind: 'Record', purpose: 'A run control record; optionally a work/extract table.' },
    { type: D.Component, kind: 'Setup component', purpose: 'Maintains the configuration records online (vendor-assigned values, code mappings): configuration is entered through component pages by the people who own it, never INSERTed. Pages for the setup record and each mapping grid, with the menu, content reference and security to reach them.' },
    { type: D.FileLayout, kind: 'File Layout', purpose: 'The outbound file\'s format.' },
    { type: D.AppEngineProgram, kind: 'App Engine program', purpose: 'Select the data, write the file, track what was sent.' },
    { type: D.SqlDefinition, kind: 'SQL definition', purpose: 'The extract SQL.' },
    { type: D.ApplicationPackage, kind: 'Application package', purpose: 'Formatting and mapping logic.' },
    { type: D.MessageCatalog, kind: 'Message catalog', purpose: 'Error and status messages.' },
    { type: D.ProcessDefinition, kind: 'Process definition', purpose: 'Run the program from Process Scheduler.' },
    { type: D.Page, kind: 'Page', purpose: 'The run control page.' },
    { type: D.Component, kind: 'Component', purpose: 'The run control component.' },
    { type: D.Menu, kind: 'Menu', purpose: 'Menu registration.' },
    { type: D.PortalRegistry, kind: 'Portal content reference', purpose: 'Navigation to the run control.' },
    { type: D.PermissionList, kind: 'Permission list access', purpose: 'Security for the run control and process.' },
    { type: D.Project, kind: 'Project', purpose: 'Every object and the related definitions it needs, for migration: add them with psft_add_to_project (includeRelated, the default) and run psft_project_related before reporting the project built -- an App Engine program added alone migrates as a header with no sections, SQL or PeopleCode, and one without the SQL objects its code calls fails at run time in the target. Menus, Portal Registry structures, and permission lists and roles go in only where Settings > Project Contents includes them; psft_add_to_project reports the rest as excluded.' }
  ],
  'ae-batch': [
    { type: D.Record, kind: 'Record', purpose: 'Run control, temporary and result tables.' },
    { type: D.AppEngineProgram, kind: 'App Engine program', purpose: 'The processing logic.' },
    { type: D.SqlDefinition, kind: 'SQL definition', purpose: 'Reusable SQL.' },
    { type: D.MessageCatalog, kind: 'Message catalog', purpose: 'Messages.' },
    { type: D.ProcessDefinition, kind: 'Process definition', purpose: 'Process Scheduler definition.' },
    { type: D.Page, kind: 'Page', purpose: 'The run control page.' },
    { type: D.Component, kind: 'Component', purpose: 'The run control component.' },
    { type: D.Project, kind: 'Project', purpose: 'Every object and the related definitions it needs, for migration: add them with psft_add_to_project (includeRelated, the default) and run psft_project_related before reporting the project built -- an App Engine program added alone migrates as a header with no sections, SQL or PeopleCode, and one without the SQL objects its code calls fails at run time in the target. Menus, Portal Registry structures, and permission lists and roles go in only where Settings > Project Contents includes them; psft_add_to_project reports the rest as excluded.' }
  ],
  'ib-integration': [
    { type: D.IbDocument, kind: 'Document definition', purpose: 'The payload schema, when a document (not a record message) fits.' },
    { type: D.IbMessage, kind: 'Message', purpose: 'The request/response messages.' },
    { type: D.IbService, kind: 'Service', purpose: 'The service.' },
    { type: D.IbServiceOperation, kind: 'Service operation', purpose: 'The operation, its version and handlers.' },
    { type: D.ApplicationPackage, kind: 'Application package', purpose: 'The handler classes.' },
    { type: D.IbRouting, kind: 'Routing', purpose: 'Routings between the nodes.' },
    { type: D.MessageNode, kind: 'Node', purpose: 'The external system\'s node, if it does not exist.' },
    { type: D.PermissionList, kind: 'Permission list access', purpose: 'Service operation security.' },
    { type: D.Project, kind: 'Project', purpose: 'Every object and the related definitions it needs, for migration: add them with psft_add_to_project (includeRelated, the default) and run psft_project_related before reporting the project built -- an App Engine program added alone migrates as a header with no sections, SQL or PeopleCode, and one without the SQL objects its code calls fails at run time in the target. Menus, Portal Registry structures, and permission lists and roles go in only where Settings > Project Contents includes them; psft_add_to_project reports the rest as excluded.' }
  ],
  other: []
};

export interface Attachment {
  id: string;
  name: string;
  size: number;
  sha256: string;
  addedAt: string;
  /** Where its text came from, or 'none' with why. */
  extraction: ExtractionMethod | 'none';
  extractionNote?: string;
  textLength?: number;
}

export interface Question { id: string; text: string; why?: string; askedAt: string; answer?: string; answeredAt?: string }
export interface Feedback { id: string; text: string; at: string; specRevision: number }

export const OBJECT_STATUSES = ['PENDING', 'BUILT', 'STAGED', 'MANUAL', 'FAILED', 'SKIPPED'] as const;
export type ObjectStatus = typeof OBJECT_STATUSES[number];
/** An object needs no more work from the agent: built and read back, staged for review, or handed to the developer. */
export const DONE_STATUSES: readonly ObjectStatus[] = ['BUILT', 'STAGED', 'MANUAL', 'SKIPPED'];

const ref = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/, 'A ref is 1-64 letters, digits, _ . or -.');

export const specObject = z.object({
  ref: ref.describe('Unique within the spec; progress reports name it.'),
  definitionType: z.number().int().nullable().describe('The DefinitionType code (psft_list_definition_types), or null for something that is not a definition (security, configuration data).'),
  kind: z.string().min(1).max(80).describe('What it is, in words: Record, File Layout, App Engine program...'),
  name: z.string().min(1).max(254).describe('The definition name, following the organization prefix.'),
  action: z.enum(['create', 'modify', 'reuse']).describe('reuse: an existing definition the build depends on but does not change.'),
  purpose: z.string().min(1).max(2000),
  details: z.string().max(40000).default('').describe('Markdown: fields and keys, sections/steps, layout segments, SQL, PeopleCode outline -- enough to review and to build from.'),
  dependsOn: z.array(ref).default([]).describe('Refs that must exist first.'),
  sources: z.array(z.string().max(200)).default([]).describe('Which attachments or answers this comes from (attachment names, question ids).')
}).strict();

export const buildSpec = z.object({
  summary: z.string().min(1).max(8000).describe('What will be built and how it works, for the developer.'),
  objects: z.array(specObject).min(1).max(200),
  mappings: z.array(z.object({
    source: z.string().min(1).max(300), target: z.string().min(1).max(300), rule: z.string().max(2000).default('')
  }).strict()).max(2000).default([]).describe('Source-to-target field mappings, with any transformation rule.'),
  assumptions: z.array(z.string().min(1).max(2000)).max(100).default([]).describe('Every decision the documents did not settle.'),
  testPlan: z.string().max(20000).default('').describe('How the developer can prove it works: test files, expected results.')
}).strict();
export type BuildSpec = z.infer<typeof buildSpec>;
export type SpecObject = z.infer<typeof specObject>;

export interface Spec extends BuildSpec {
  revision: number;
  proposedAt: string;
  /** The request's inputsRevision the agent saw. */
  basedOnInputs: number;
  hash: string;
}

export interface Progress { status: ObjectStatus; detail: string; at: string; changeSetId?: string; history: Array<{ status: ObjectStatus; detail: string; at: string }> }

export interface BuildRequest {
  schema: typeof SCHEMA;
  id: string;
  title: string;
  kind: RequestKind;
  connection: string;
  project: string;
  narrative: string;
  attachments: Attachment[];
  questions: Question[];
  feedback: Feedback[];
  /** Bumped by every change to what the agent analyzes: text, attachments, kind, connection, answers. */
  inputsRevision: number;
  spec?: Spec;
  approval?: { specRevision: number; specHash: string; inputsRevision: number; at: string };
  progress: Record<string, Progress>;
  /** The developer asked the agent for an analysis or a build, and when. */
  handoffs: Array<{ phase: 'analyze' | 'build'; agent: string; at: string }>;
  createdAt: string;
  updatedAt: string;
}

export type RequestStatus = 'DRAFT' | 'QUESTIONS' | 'SPEC_PROPOSED' | 'CHANGES_REQUESTED' | 'SPEC_STALE' | 'APPROVED' | 'BUILDING' | 'BUILT';

export const STATUS_LABELS: Record<RequestStatus, string> = {
  DRAFT: 'Draft', QUESTIONS: 'Questions to answer', SPEC_PROPOSED: 'Spec ready for review', CHANGES_REQUESTED: 'Changes requested',
  SPEC_STALE: 'Request changed; spec needs revising', APPROVED: 'Approved; ready to build', BUILDING: 'Building', BUILT: 'Built'
};

export function newRequest(id: string, now: string, init: Partial<Pick<BuildRequest, 'title' | 'kind' | 'connection' | 'project' | 'narrative'>> = {}): BuildRequest {
  return {
    schema: SCHEMA, id, title: init.title ?? 'New build request', kind: init.kind ?? 'ae-inbound-file', connection: init.connection ?? '',
    project: init.project ?? '', narrative: init.narrative ?? '', attachments: [], questions: [], feedback: [], inputsRevision: 1,
    progress: {}, handoffs: [], createdAt: now, updatedAt: now
  };
}

export function specHash(spec: BuildSpec): string {
  return createHash('sha256').update(JSON.stringify(spec)).digest('hex');
}

/** Approval holds only for the exact spec revision and the inputs it was proposed against. */
export function isApproved(r: BuildRequest): boolean {
  const a = r.approval, s = r.spec;
  return !!a && !!s && a.specRevision === s.revision && a.specHash === s.hash && a.inputsRevision === r.inputsRevision && s.basedOnInputs === r.inputsRevision;
}

export function unansweredQuestions(r: BuildRequest): Question[] {
  return r.questions.filter((q) => !q.answer?.trim());
}

export function status(r: BuildRequest): RequestStatus {
  if (isApproved(r)) {
    const objects = r.spec!.objects.filter((o) => o.action !== 'reuse');
    const states = objects.map((o) => r.progress[o.ref]?.status ?? 'PENDING');
    if (states.length && states.every((s) => DONE_STATUSES.includes(s))) return 'BUILT';
    return states.some((s) => s !== 'PENDING') ? 'BUILDING' : 'APPROVED';
  }
  if (unansweredQuestions(r).length) return 'QUESTIONS';
  if (!r.spec) return 'DRAFT';
  if (r.spec.basedOnInputs !== r.inputsRevision) return 'SPEC_STALE';
  if (r.feedback.some((f) => f.specRevision === r.spec!.revision)) return 'CHANGES_REQUESTED';
  return 'SPEC_PROPOSED';
}

/** Why the developer cannot approve the current spec, or undefined when they can. */
export function approvalBlocker(r: BuildRequest): string | undefined {
  if (!r.spec) return 'The agent has not proposed a spec yet.';
  if (isApproved(r)) return 'The spec is already approved.';
  if (unansweredQuestions(r).length) return 'Answer the open questions first; the agent then revises the spec.';
  if (r.spec.basedOnInputs !== r.inputsRevision) return 'The request changed after this spec was proposed; ask the agent to revise it.';
  if (!r.connection) return 'Choose the connection to build on.';
  return undefined;
}

/** Checks a proposed spec's internal consistency beyond its schema: unique refs, known dependencies, no cycles. */
export function checkSpec(spec: BuildSpec): string[] {
  const problems: string[] = [];
  const refs = new Set<string>();
  for (const o of spec.objects) {
    if (refs.has(o.ref)) problems.push(`Duplicate ref ${o.ref}.`);
    refs.add(o.ref);
  }
  for (const o of spec.objects) {
    for (const d of o.dependsOn) if (!refs.has(d)) problems.push(`${o.ref} depends on unknown ref ${d}.`);
  }
  const byRef = new Map(spec.objects.map((o) => [o.ref, o]));
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (r: string, trail: string[]): void => {
    if (state.get(r) === 'done') return;
    if (state.get(r) === 'visiting') { problems.push(`Dependency cycle: ${[...trail, r].join(' -> ')}.`); return; }
    state.set(r, 'visiting');
    for (const d of byRef.get(r)?.dependsOn ?? []) if (byRef.has(d)) visit(d, [...trail, r]);
    state.set(r, 'done');
  };
  for (const o of spec.objects) visit(o.ref, []);
  return [...new Set(problems)];
}

/** The spec's objects in an order that builds dependencies first (stable otherwise). */
export function buildOrder(spec: BuildSpec): SpecObject[] {
  const byRef = new Map(spec.objects.map((o) => [o.ref, o]));
  const out: SpecObject[] = [], seen = new Set<string>();
  const visit = (o: SpecObject): void => {
    if (seen.has(o.ref)) return;
    seen.add(o.ref);
    for (const d of o.dependsOn) { const dep = byRef.get(d); if (dep) visit(dep); }
    out.push(o);
  };
  spec.objects.forEach(visit);
  return out;
}

export const DEVELOPER_EDITABLE = ['title', 'kind', 'connection', 'project', 'narrative'] as const;
/** Fields whose change alters what the agent analyzes (the title is a label only). */
const INPUT_FIELDS = new Set(['kind', 'connection', 'project', 'narrative']);

export type RequestEdit = Partial<Pick<BuildRequest, typeof DEVELOPER_EDITABLE[number]>>;

/** Applies a developer's edit; input changes bump inputsRevision, which withdraws any approval. */
export function applyEdit(r: BuildRequest, edit: RequestEdit): boolean {
  let changed = false, inputs = false;
  for (const key of DEVELOPER_EDITABLE) {
    const value = edit[key];
    if (value === undefined || value === r[key]) continue;
    if (key === 'kind' && !(value in REQUEST_KINDS)) throw new Error(`Unknown request kind ${value}.`);
    (r as unknown as Record<string, unknown>)[key] = key === 'project' ? String(value).toUpperCase().trim() : value;
    changed = true;
    if (INPUT_FIELDS.has(key)) inputs = true;
  }
  if (inputs) r.inputsRevision++;
  return changed;
}

/** Text for the developer to paste into, or the extension to start, an agent session. */
export function agentPrompt(r: BuildRequest, phase: 'analyze' | 'build'): string {
  return phase === 'analyze'
    ? `Analyze PeopleSoft Studio build request ${r.id}: call the psft_build_request_get MCP tool with id ${r.id} and follow its workflow. Ask questions and propose a build spec; do not change PeopleSoft until the developer approves the spec.`
    : `Build PeopleSoft Studio build request ${r.id}: call the psft_build_request_get MCP tool with id ${r.id}, confirm buildAuthorized is true, and follow its build workflow, reporting each object with psft_build_request_report.`;
}
