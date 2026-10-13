import type { FindingInput, StoredObservation } from './schema.js';

/*
 * Deny-by-default privacy (docs/intelligence/SECURITY_PRIVACY.md).
 *
 * The schema already admits only technical fields (no definitions, source,
 * row data, connections). This scan rejects a finding whose text carries
 * what a technical claim never needs: absolute file paths, URLs, host names,
 * IP addresses, connect strings, e-mail addresses, credentials and long
 * opaque tokens. A violation names the field and the rule, never the value,
 * so a rejected secret is not echoed into a log.
 *
 * classify() is the basic classification: "internal" when the finding
 * carries lab-specific provenance (experiment and run identifiers, capture
 * cases, repository paths, the application release) that a submission
 * review must look at first; "public-technical" otherwise.
 */

export interface PrivacyViolation {
  /** JSON path of the field. */
  path: string;
  rule: string;
}

export class PrivacyRejectedError extends Error {
  constructor(readonly violations: PrivacyViolation[]) {
    super(`The finding was refused: ${violations.slice(0, 6).map((v) => `${v.path} (${v.rule})`).join('; ')}${violations.length > 6 ? ` and ${violations.length - 6} more` : ''}.`);
    this.name = 'PrivacyRejectedError';
  }
}

const TLDS = 'com|net|org|edu|gov|mil|int|io|co|us|uk|ca|au|de|fr|in|cn|jp|local|localdomain|internal|intra|lan|corp|home|cloud|biz|info|me|dev|app|xyz|online|site|tech';

const RULES: Array<{ rule: string; test: (s: string) => boolean }> = [
  { rule: 'URL', test: (s) => /\b[a-z][a-z0-9+.-]*:\/\/\S+/i.test(s) },
  { rule: 'e-mail address', test: (s) => /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/.test(s) },
  { rule: 'absolute file path', test: (s) => /(^|[\s"'(=,])(\/(home|Users|root|etc|var|tmp|opt|mnt|srv|usr|private)\/|~\/|[A-Za-z]:[\\/]|\\\\[A-Za-z0-9])/.test(s) },
  { rule: 'IP address', test: hasIpAddress },
  { rule: 'connect string', test: (s) => /\b[A-Za-z0-9.-]+:\d{2,5}\/[A-Za-z0-9_.]+/.test(s) || /\(DESCRIPTION\s*=/i.test(s) },
  // Lower-case top-level domains only: PeopleSoft's dotted names (JOB.CO, RECORD.FIELD) are upper case.
  { rule: 'host name', test: (s) => new RegExp(`\\b[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.(${TLDS})\\b`).test(s) },
  { rule: 'credential', test: (s) => /\b(password|passwd|pwd|pswd|secret|token|api[_-]?key|access[_-]?key|accesspswd|bearer|authorization)\b\s*[:=]/i.test(s) || /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/.test(s) },
  { rule: 'opaque token', test: (s) => /[A-Za-z0-9+/_=-]{64,}/.test(s) }
];

function hasIpAddress(s: string): boolean {
  for (const m of s.matchAll(/(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g)) {
    // A release label (9.20.00.000) pads with zeros; an address does not.
    if (m.slice(1, 5).every((o) => Number(o) <= 255 && !(o.length > 1 && o.startsWith('0')))) return true;
  }
  return /\b([0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/i.test(s);
}

/** Every string in the value, with its JSON path. */
function* strings(value: unknown, path: string): Generator<[string, string]> {
  if (typeof value === 'string') yield [path, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* strings(v, `${path}[${i}]`);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      yield [`${path}.${k}#key`, k];
      yield* strings(v, `${path}.${k}`);
    }
  }
}

/** The violations in a finding's input; empty when it may be recorded. */
export function scanFinding(input: FindingInput): PrivacyViolation[] {
  const out: PrivacyViolation[] = [];
  for (const [path, text] of strings(input, '$')) {
    // A commit hash is a reference, not a token.
    if (/\.evidence\[\d+\]\.ref$/.test(path) && /^[0-9a-f]{7,40}$/.test(text)) continue;
    for (const r of RULES) if (r.test(text)) out.push({ path: path.replace(/#key$/, ' (key)'), rule: r.rule });
  }
  for (const [i, e] of (input.observation.evidence ?? []).entries()) {
    if (e.kind === 'repo-path' && (/^[\\/]/.test(e.ref) || /(^|[\\/])\.\.([\\/]|$)/.test(e.ref) || /^[A-Za-z]:/.test(e.ref))) {
      out.push({ path: `$.observation.evidence[${i}].ref`, rule: 'repository paths are relative, inside the repository' });
    }
  }
  return dedupe(out);
}

function dedupe(v: PrivacyViolation[]): PrivacyViolation[] {
  const seen = new Set<string>();
  return v.filter((x) => { const k = `${x.path}|${x.rule}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function classify(observations: readonly StoredObservation[]): 'public-technical' | 'internal' {
  return observations.some((o) => o.experimentId || o.runId || o.environment.appRelease || (o.evidence ?? []).some((e) => e.kind === 'capture-case' || e.kind === 'repo-path'))
    ? 'internal' : 'public-technical';
}
