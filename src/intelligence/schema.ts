import * as z from 'zod/v4';

/*
 * The finding schema, version 1 (docs/intelligence/FINDING_SCHEMA.md).
 *
 * A finding is one technical claim about PeopleSoft -- its identity a
 * structured assertion -- with the observations that support it. The schema
 * is an allowlist: every object is strict (unknown keys are rejected), text
 * is bounded, and nothing in it can hold a PeopleSoft definition, source,
 * row data, a connection or a credential (privacy.ts scans the text too).
 * Nothing here is executable: findings are data, never instructions.
 */

export const SCHEMA_ID = 'psft-finding/1';
export const SCHEMA_VERSION = 1;

/** What kind of claim it is. */
export const FINDING_TYPES = [
  'metadata-mapping',      // a property / control / setting and the column(s) that store it
  'save-protocol',         // what a native save writes: rows, counters, tombstones, order
  'serialization',         // a byte- or text-level layout
  'bytecode-pattern',      // a PeopleCode program encoding
  'version-difference',    // behavior that differs between PeopleTools releases
  'object-relationship',   // an undocumented reference between definitions
  'roundtrip-comparison',  // a Studio write compared with the native tool's
  'compile-difference',    // compiler or validator behavior
  'behavior'               // an observed runtime or tool behavior
] as const;

/** The PeopleSoft Studio subsystem the finding informs. */
export const SUBSYSTEMS = [
  'page-designer', 'component', 'record', 'field', 'menu', 'app-engine', 'peoplecode', 'application-class',
  'component-interface', 'message-channel', 'integration-broker', 'project', 'sql', 'html', 'style-sheet',
  'customization', 'event-mapping', 'portal-registry', 'security', 'build', 'other'
] as const;

export const RESEARCH_METHODS = [
  'save-capture',          // before / after sweep of a native save (tools/corpus/save-protocol)
  'controlled-compile',    // the controlled compile lab
  'corpus-harness',        // the PeopleCode corpus harness
  'live-e2e',              // a Studio writer exercised on a lab database
  'pia-capture',           // a PeopleSoft PIA page's save swept
  'unit-replay',           // a writer's plan replayed against captures
  'source-inspection',     // reading delivered PeopleCode / SQL / view text
  'manual-inspection'      // a person's examination
] as const;

export const SOURCES = ['research-harness', 'manual', 'extension', 'mcp-agent'] as const;
export const CONFIDENCE = ['low', 'medium', 'high'] as const;
export const LOCAL_STATUSES = ['observed', 'reproduced'] as const;
export const PRIVACY_CLASSES = ['public-technical', 'internal'] as const;
export const APP_FAMILIES = ['HCM', 'FSCM', 'CS', 'ELM', 'CRM', 'IH', 'PeopleTools', 'other'] as const;

const name = (max: number) => z.string().trim().min(1).max(max);
/** A PeopleTools release, as PSSTATUS.TOOLSREL gives it: 8.62, 8.62.09. */
export const toolsRelease = z.string().regex(/^\d\.\d{2}(\.\d{2})?$/, 'a PeopleTools release such as 8.62 or 8.62.09');
/** A PeopleTools-style identifier: a table, field, counter, setting (letters, digits, _ # @ $ and dots). */
const ident = z.string().regex(/^[A-Za-z][A-Za-z0-9_#@$.:-]{0,63}$/, 'an identifier (letters, digits, _ # @ $ . : -; at most 64)');
const factValue = z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()]);

/**
 * The claim itself, structured: what the fingerprint is computed from. `kind`
 * names the assertion's shape (e.g. `table-write`, `column-mapping`,
 * `counter-step`), `facts` its key / value pairs.
 */
export const assertion = z.strictObject({
  kind: ident,
  facts: z.record(ident, factValue).refine((f) => Object.keys(f).length >= 1 && Object.keys(f).length <= 64, 'between 1 and 64 facts')
});

export const subject = z.strictObject({
  subsystem: z.enum(SUBSYSTEMS),
  /** The PeopleSoft object type (Record, Page, Event Mapping configuration...). */
  objectType: name(64),
  /** PeopleTools tables the finding concerns (no data: names only). */
  tables: z.array(ident).max(64).optional(),
  /** Properties, fields or columns concerned. */
  properties: z.array(ident).max(64).optional()
});

/** Counts only: what a capture changed, never the rows. */
export const sanitizedDelta = z.strictObject({
  tables: z.array(z.strictObject({
    table: ident,
    inserted: z.number().int().min(0),
    deleted: z.number().int().min(0),
    updated: z.number().int().min(0)
  })).max(200),
  /** PSVERSION counter moves (CHDM, SCNFM, SYS ...). */
  counters: z.record(ident, z.number().int()).optional()
});

export const evidenceRef = z.strictObject({
  kind: z.enum(['repo-path', 'capture-case', 'test', 'doc', 'commit']),
  /** Repository-relative (never absolute), a capture case name, a test name, a commit hash. */
  ref: z.string().min(1).max(300)
});

export const environment = z.strictObject({
  peopleToolsRelease: toolsRelease,
  /** The application release label (PSRELEASE), e.g. "HRMS 9.20.00.000". */
  appRelease: z.string().max(64).optional(),
  appFamily: z.enum(APP_FAMILIES).optional(),
  platform: z.enum(['oracle', 'mssql', 'db2']).optional(),
  /** The tool exercised: "App Designer", "PIA", "PeopleSoft Studio 0.8.4". */
  tool: z.string().max(64).optional()
});

export const observation = z.strictObject({
  observedAt: z.iso.datetime({ offset: true }),
  method: z.enum(RESEARCH_METHODS),
  /** The experiment, test or capture case it came from. */
  experimentId: z.string().max(120).optional(),
  /** One run of that experiment; a second run with another runId reproduces it. */
  runId: z.string().max(120).optional(),
  environment,
  observation: z.string().trim().min(1).max(4000),
  expected: z.string().max(2000).optional(),
  actual: z.string().max(2000).optional(),
  reproduction: z.array(z.string().max(500)).max(30).optional(),
  delta: sanitizedDelta.optional(),
  testResults: z.array(z.strictObject({ name: z.string().max(200), outcome: z.enum(['pass', 'fail', 'skip']) })).max(100).optional(),
  evidence: z.array(evidenceRef).max(50).optional()
});

/** What a caller gives to record a finding (store.ts fills identity, status and digests). */
export const findingInput = z.strictObject({
  type: z.enum(FINDING_TYPES),
  subject,
  assertion,
  title: z.string().trim().min(1).max(200),
  statement: z.string().trim().min(1).max(4000),
  confidence: z.enum(CONFIDENCE),
  /** Releases the claim is known not to hold on. */
  knownIncompatible: z.array(toolsRelease).max(20).optional(),
  source: z.enum(SOURCES),
  observation
});

export type FindingInput = z.infer<typeof findingInput>;
export type Observation = z.infer<typeof observation>;
export type Assertion = z.infer<typeof assertion>;
export type SanitizedDelta = z.infer<typeof sanitizedDelta>;

/** A stored observation: its digest identifies the evidence (duplicates are detected on it). */
export interface StoredObservation extends Observation {
  digest: string;
}

/** A finding as the local store keeps it. */
export interface Finding {
  schema: typeof SCHEMA_ID;
  /** Derived from the fingerprint: `f-` and its first 24 hex digits. */
  id: string;
  /** SHA-256 over the canonical identity (fingerprint.ts). */
  fingerprint: string;
  type: FindingInput['type'];
  subject: FindingInput['subject'];
  assertion: Assertion;
  title: string;
  statement: string;
  confidence: FindingInput['confidence'];
  compatibility: {
    /** Releases observed (from the observations), sorted. */
    observedReleases: string[];
    knownIncompatible: string[];
  };
  /** Local evidence only: observed, or reproduced by a second distinct run. Corroborated, verified and published are the registry's (VERIFICATION_MODEL.md). */
  localStatus: typeof LOCAL_STATUSES[number];
  observations: StoredObservation[];
  privacy: {
    classification: typeof PRIVACY_CLASSES[number];
    /** Never true locally in phase 1: approving a submission is the review's (SECURITY_PRIVACY.md). */
    approvedForSubmission: false;
  };
  provenance: {
    source: FindingInput['source'];
    createdAt: string;
    updatedAt: string;
    /** The schema version that wrote it. */
    schemaVersion: typeof SCHEMA_VERSION;
  };
}
