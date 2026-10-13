import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { findingFingerprint, findingId, observationDigest } from './fingerprint.js';
import { classify, PrivacyRejectedError, scanFinding } from './privacy.js';
import { findingInput, SCHEMA_ID, SCHEMA_VERSION, type Finding, type FindingInput, type StoredObservation } from './schema.js';

/*
 * The local discovery store (docs/intelligence/ARCHITECTURE.md "Local
 * Discovery Engine"): findings as JSON files, one per finding, named by its
 * ID, under a root directory -- the extension's global storage, or a
 * research harness's own (tools/intelligence). No database, no network.
 *
 * record() validates the input against the allowlisted schema, refuses it on
 * a privacy violation, and then either creates the finding, adds the
 * observation to the finding with the same fingerprint (widening its
 * compatibility), or -- the same evidence recorded again -- changes nothing
 * and says so. Files are written whole to a temporary name and renamed, so a
 * reader never sees half a finding; writes to one finding are serialized in
 * this process (two processes writing the same store may lose an
 * observation: one writer per store, ARCHITECTURE.md).
 */

export const STORE_FORMAT = 'psft-discovery-store/1';

export class DiscoveryInputError extends Error {
  constructor(readonly issues: Array<{ path: string; message: string }>) {
    super(`The finding does not match ${SCHEMA_ID}: ${issues.slice(0, 6).map((i) => `${i.path}: ${i.message}`).join('; ')}${issues.length > 6 ? ` and ${issues.length - 6} more` : ''}.`);
    this.name = 'DiscoveryInputError';
  }
}

export type RecordOutcome = 'created' | 'merged' | 'duplicate';

export interface RecordResult {
  outcome: RecordOutcome;
  finding: Finding;
}

export interface FindingSummary {
  id: string;
  type: Finding['type'];
  subsystem: Finding['subject']['subsystem'];
  objectType: string;
  title: string;
  localStatus: Finding['localStatus'];
  confidence: Finding['confidence'];
  observations: number;
  observedReleases: string[];
  privacy: Finding['privacy']['classification'];
  updatedAt: string;
}

export interface ListFilter {
  subsystem?: Finding['subject']['subsystem'];
  type?: Finding['type'];
  /** Findings observed on this release. */
  release?: string;
  /** Title, statement or assertion text containing it (case-insensitive). */
  text?: string;
}

export interface SubmissionRecord {
  findingId: string;
  /** 1-based observation the payload carried. */
  observation: number;
  at: string;
  /** The server's origin (scheme, host, port). */
  server: string;
  outcome: 'created' | 'merged' | 'duplicate' | 'failed';
  remoteId?: string;
  remoteStatus?: string;
  /** For a failure: the HTTP status and the server's problem title (never a value it refused). */
  error?: string;
}

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const;

export class DiscoveryStore {
  private readonly dir: string;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(readonly root: string, private readonly now: () => Date = () => new Date()) {
    this.dir = path.join(root, 'findings');
  }

  /** Creates the store's directory and its marker when missing. */
  async open(): Promise<this> {
    await mkdir(this.dir, { recursive: true });
    const marker = path.join(this.root, 'STORE.json');
    try {
      const m = JSON.parse(await readFile(marker, 'utf8')) as { format?: string };
      if (m.format !== STORE_FORMAT) throw new Error(`${marker} is not a ${STORE_FORMAT} store (format ${m.format ?? 'missing'}).`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await atomicWrite(marker, `${JSON.stringify({ format: STORE_FORMAT, schema: SCHEMA_ID, createdAt: this.now().toISOString() }, null, 2)}\n`);
    }
    return this;
  }

  /** Validates, privacy-scans, fingerprints and stores a finding (see the module comment). */
  async record(raw: unknown): Promise<RecordResult> {
    const parsed = findingInput.safeParse(raw);
    if (!parsed.success) {
      throw new DiscoveryInputError(parsed.error.issues.map((i) => ({ path: `$${i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('')}`, message: i.message })));
    }
    const input = parsed.data;
    const violations = scanFinding(input);
    if (violations.length) throw new PrivacyRejectedError(violations);
    const fingerprint = findingFingerprint(input);
    const id = findingId(fingerprint);
    return this.serialized(id, async () => {
      const existing = await this.get(id);
      const obs: StoredObservation = { ...input.observation, digest: observationDigest(input.observation) };
      const at = this.now().toISOString();
      if (!existing) {
        const finding = build(input, fingerprint, id, [obs], at, at);
        await this.write(finding);
        return { outcome: 'created' as const, finding };
      }
      if (existing.fingerprint !== fingerprint) throw new Error(`${id} holds another finding (fingerprint ${existing.fingerprint.slice(0, 12)}…); refusing to merge.`);
      if (existing.observations.some((o) => o.digest === obs.digest)) return { outcome: 'duplicate' as const, finding: existing };
      const merged: Finding = {
        ...build(input, fingerprint, id, [...existing.observations, obs], existing.provenance.createdAt, at),
        // The first record's words stand; a later one adds evidence, not a rewrite.
        title: existing.title, statement: existing.statement, subject: existing.subject, provenance: { ...existing.provenance, updatedAt: at },
        confidence: CONFIDENCE_RANK[input.confidence] > CONFIDENCE_RANK[existing.confidence] ? input.confidence : existing.confidence
      };
      merged.compatibility.knownIncompatible = [...new Set([...existing.compatibility.knownIncompatible, ...merged.compatibility.knownIncompatible])].sort();
      await this.write(merged);
      return { outcome: 'merged' as const, finding: merged };
    });
  }

  async get(id: string): Promise<Finding | undefined> {
    if (!/^f-[0-9a-f]{24}$/.test(id)) return undefined;
    try {
      const f = JSON.parse(await readFile(path.join(this.dir, `${id}.json`), 'utf8')) as Finding;
      if (f.schema !== SCHEMA_ID) throw new Error(`${id} is ${f.schema}, not ${SCHEMA_ID}.`);
      return f;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async list(filter: ListFilter = {}): Promise<FindingSummary[]> {
    let names: string[];
    try { names = await readdir(this.dir); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const out: FindingSummary[] = [];
    const text = filter.text?.toLowerCase();
    for (const n of names.filter((x) => /^f-[0-9a-f]{24}\.json$/.test(x)).sort()) {
      const f = await this.get(n.slice(0, -5));
      if (!f) continue;
      if (filter.subsystem && f.subject.subsystem !== filter.subsystem) continue;
      if (filter.type && f.type !== filter.type) continue;
      if (filter.release && !f.compatibility.observedReleases.some((r) => r === filter.release || r.startsWith(`${filter.release}.`))) continue;
      if (text && ![f.title, f.statement, JSON.stringify(f.assertion)].some((s) => s.toLowerCase().includes(text))) continue;
      out.push({
        id: f.id, type: f.type, subsystem: f.subject.subsystem, objectType: f.subject.objectType, title: f.title, localStatus: f.localStatus,
        confidence: f.confidence, observations: f.observations.length, observedReleases: f.compatibility.observedReleases,
        privacy: f.privacy.classification, updatedAt: f.provenance.updatedAt
      });
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id.localeCompare(b.id)));
  }

  /**
   * The submission history: one line per request sent -- the finding, which
   * observation, when, to which server (its origin), the outcome and the
   * server's id. Never a payload or a token.
   */
  async appendSubmission(entry: SubmissionRecord): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await appendFile(path.join(this.root, 'submissions.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
  }

  async submissions(findingId?: string): Promise<SubmissionRecord[]> {
    let text: string;
    try { text = await readFile(path.join(this.root, 'submissions.jsonl'), 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as SubmissionRecord).filter((r) => !findingId || r.findingId === findingId);
  }

  /** Withdraws a finding from this store (the contributor's own copy). */
  async remove(id: string): Promise<boolean> {
    if (!(await this.get(id))) return false;
    await this.serialized(id, () => rm(path.join(this.dir, `${id}.json`)));
    return true;
  }

  private async write(f: Finding): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await atomicWrite(path.join(this.dir, `${f.id}.json`), `${JSON.stringify(f, null, 2)}\n`);
  }

  private serialized<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(id, next.catch(() => undefined));
    return next;
  }
}

function build(input: FindingInput, fingerprint: string, id: string, observations: StoredObservation[], createdAt: string, updatedAt: string): Finding {
  const runs = new Set(observations.map((o) => o.runId ? `${o.experimentId ?? ''}|${o.runId}` : o.digest));
  return {
    schema: SCHEMA_ID, id, fingerprint, type: input.type, subject: input.subject, assertion: input.assertion,
    title: input.title, statement: input.statement, confidence: input.confidence,
    compatibility: {
      observedReleases: [...new Set(observations.map((o) => o.environment.peopleToolsRelease))].sort(),
      knownIncompatible: [...new Set(input.knownIncompatible ?? [])].sort()
    },
    // Reproduced: a second distinct run. Never more than that here -- corroboration and verification are the registry's.
    localStatus: runs.size >= 2 ? 'reproduced' : 'observed',
    observations,
    privacy: { classification: classify(observations), approvedForSubmission: false },
    provenance: { source: input.source, createdAt, updatedAt, schemaVersion: SCHEMA_VERSION }
  };
}

async function atomicWrite(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, text, 'utf8');
  try {
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}
