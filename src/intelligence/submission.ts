import { scanFinding } from './privacy.js';
import { findingInput, type Finding, type FindingInput, type Observation } from './schema.js';

/*
 * What would leave this machine (docs/intelligence/SECURITY_PRIVACY.md
 * "Submission review"): a finding as the payloads the server takes -- one
 * per observation, each the allowlisted finding input -- with lab
 * provenance stripped unless the user keeps it, and every removal listed
 * with its reason. Pure: it builds and checks payloads; sending them is the
 * extension's (intelligenceClient.ts), after the user has seen exactly
 * these.
 */

export interface Removal {
  /** Which observation (1-based) and field. */
  observation: number;
  path: string;
  reason: string;
}

export interface SubmissionPreview {
  findingId: string;
  /** Exactly what each request body would be. */
  payloads: FindingInput[];
  removed: Removal[];
  /** Problems that block the submission (a payload failing the schema or the privacy scan after projection). */
  blocked: string[];
}

export interface ProjectionOptions {
  /** Keep experiment and run IDs, capture cases, repository paths and the application release (default: strip them). */
  keepProvenance?: boolean;
}

const PROVENANCE_REASON = 'lab provenance (internal): kept only when you choose to share it';

function projectObservation(o: Finding['observations'][number], index: number, keep: boolean, removed: Removal[]): Observation {
  const { digest: _digest, ...rest } = o;
  const out: Observation = JSON.parse(JSON.stringify(rest));
  if (keep) return out;
  const drop = (path: string, test: boolean, apply: () => void) => {
    if (!test) return;
    apply();
    removed.push({ observation: index, path, reason: PROVENANCE_REASON });
  };
  drop('experimentId', out.experimentId !== undefined, () => { delete out.experimentId; });
  drop('runId', out.runId !== undefined, () => { delete out.runId; });
  drop('environment.appRelease', out.environment.appRelease !== undefined, () => { delete out.environment.appRelease; });
  if (out.evidence) {
    const kept = out.evidence.filter((e) => e.kind !== 'capture-case' && e.kind !== 'repo-path');
    drop(`evidence (${out.evidence.length - kept.length} capture case / repository path reference(s))`, kept.length !== out.evidence.length, () => {
      if (kept.length) out.evidence = kept; else delete out.evidence;
    });
  }
  return out;
}

export function previewSubmission(f: Finding, options: ProjectionOptions = {}): SubmissionPreview {
  const removed: Removal[] = [];
  const blocked: string[] = [];
  const base = {
    type: f.type, subject: f.subject, assertion: f.assertion, title: f.title, statement: f.statement, confidence: f.confidence,
    ...(f.compatibility.knownIncompatible.length ? { knownIncompatible: f.compatibility.knownIncompatible } : {}),
    source: f.provenance.source
  };
  const payloads = f.observations.map((o, i) => {
    const payload: FindingInput = JSON.parse(JSON.stringify({ ...base, observation: projectObservation(o, i + 1, !!options.keepProvenance, removed) }));
    // The projection is re-checked as the server will check it: the allowlist, then the privacy scan.
    const parsed = findingInput.safeParse(payload);
    if (!parsed.success) blocked.push(`Observation ${i + 1}: ${parsed.error.issues.slice(0, 3).map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
    else for (const v of scanFinding(parsed.data)) blocked.push(`Observation ${i + 1}: ${v.path} (${v.rule})`);
    return payload;
  });
  return { findingId: f.id, payloads, removed, blocked };
}
