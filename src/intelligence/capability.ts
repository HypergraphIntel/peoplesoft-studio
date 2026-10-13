import type { KnowledgeBundle, KnowledgeFinding } from './knowledge.js';
import type { Finding } from './schema.js';

/*
 * What PeopleSoft Studio knows about a capability, for an agent
 * (docs/intelligence/MCP_INTEGRATION.md): the findings matching a question,
 * from verified knowledge (an installed, verified bundle) and from local
 * findings, judged for one PeopleTools release, as one of
 *
 *   VERIFIED     published knowledge verified on this release
 *   UNSUPPORTED  a finding names this release as one it does not hold on
 *   CONFLICTING  both of the above
 *   UNVERIFIED   only local findings (observed / reproduced) match
 *   UNKNOWN      nothing matches
 *
 * with every finding behind the answer and its scope. Pure. An answer is
 * information about evidence: it never grants or widens a write -- the MCP's
 * write gates and the delivered-object policy decide writes, as before --
 * and it verifies the claim it names, not the workflow around it.
 */

export type CapabilityAnswer = 'VERIFIED' | 'UNVERIFIED' | 'UNSUPPORTED' | 'UNKNOWN' | 'CONFLICTING';

export interface CapabilityQuestion {
  subsystem?: string;
  objectType?: string;
  /** A PeopleTools table the claim concerns. */
  table?: string;
  /** The assertion kind (column-mapping, save-protocol rows...). */
  kind?: string;
  /** Words in the title, statement or facts. */
  text?: string;
  /** The release to judge for (a connection's PSSTATUS.TOOLSREL); without it, applicability is not judged. */
  release?: string;
}

export interface CapabilityEvidence {
  id: string;
  title: string;
  source: 'published' | 'local';
  /** published, or the local status (observed / reproduced). */
  status: string;
  type: string;
  subsystem: string;
  assertion: { kind: string; facts: Record<string, unknown> };
  verifiedReleases: string[];
  observedReleases: string[];
  knownIncompatible: string[];
  /** For the asked release: verified on it, known not to hold, only observed on it, or not established. */
  onRelease?: 'verified' | 'incompatible' | 'observed' | 'not-established';
}

export interface CapabilityResult {
  answer: CapabilityAnswer;
  release?: string;
  evidence: CapabilityEvidence[];
  notes: string[];
}

export const KNOWLEDGE_NEVER_GRANTS =
  'Knowledge informs; it never grants a write. Writes still need a Writable connection, an Operator ID, the write scope, the delivered-object policy and approval. ' +
  'A verified claim covers what it states only -- a verified mapping is not a verified save workflow.';

const releaseMatches = (have: string, asked: string) => have === asked || have.startsWith(`${asked}.`) || asked.startsWith(`${have}.`);

function matches(q: CapabilityQuestion, f: { title: string; statement: string; type: string; subject: { subsystem: string; objectType: string; tables?: string[] }; assertion: { kind: string; facts: Record<string, unknown> } }): boolean {
  if (q.subsystem && f.subject.subsystem !== q.subsystem) return false;
  if (q.objectType && f.subject.objectType.toLowerCase() !== q.objectType.trim().toLowerCase()) return false;
  if (q.kind && f.assertion.kind !== q.kind) return false;
  if (q.table) {
    const t = q.table.trim().toUpperCase();
    const inFacts = Object.values(f.assertion.facts).some((v) => typeof v === 'string' && v.toUpperCase() === t);
    if (!(f.subject.tables ?? []).some((x) => x.toUpperCase() === t) && !inFacts) return false;
  }
  if (q.text) {
    const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = `${f.title} ${f.statement} ${JSON.stringify(f.assertion)}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

function fromPublished(k: KnowledgeFinding, release?: string): CapabilityEvidence {
  const incompatible = !!release && k.knownIncompatible.some((r) => releaseMatches(r, release));
  const verified = !!release && k.verifiedReleases.some((r) => releaseMatches(r, release));
  return {
    id: k.id, title: k.title, source: 'published', status: 'published', type: k.type, subsystem: k.subject.subsystem, assertion: k.assertion,
    verifiedReleases: k.verifiedReleases, observedReleases: [], knownIncompatible: k.knownIncompatible,
    ...(release ? { onRelease: incompatible ? 'incompatible' as const : verified ? 'verified' as const : 'not-established' as const } : {})
  };
}

function fromLocal(f: Finding, release?: string): CapabilityEvidence {
  const incompatible = !!release && f.compatibility.knownIncompatible.some((r) => releaseMatches(r, release));
  const observed = !!release && f.compatibility.observedReleases.some((r) => releaseMatches(r, release));
  return {
    id: f.id, title: f.title, source: 'local', status: f.localStatus, type: f.type, subsystem: f.subject.subsystem, assertion: f.assertion,
    verifiedReleases: [], observedReleases: f.compatibility.observedReleases, knownIncompatible: f.compatibility.knownIncompatible,
    ...(release ? { onRelease: incompatible ? 'incompatible' as const : observed ? 'observed' as const : 'not-established' as const } : {})
  };
}

export function answerCapability(q: CapabilityQuestion, local: readonly Finding[], bundle?: KnowledgeBundle): CapabilityResult {
  const revoked = new Set(bundle?.revoked ?? []);
  const published = (bundle?.findings ?? []).filter((k) => !revoked.has(k.id) && matches(q, k)).map((k) => fromPublished(k, q.release));
  const publishedIds = new Set(published.map((p) => p.id));
  // A local finding that is also published is reported once, as published.
  const localOnly = local.filter((f) => !publishedIds.has(f.id) && !revoked.has(f.id) && matches(q, f)).map((f) => fromLocal(f, q.release));
  const evidence = [...published, ...localOnly];
  const notes = [KNOWLEDGE_NEVER_GRANTS];
  if (!bundle) notes.push('No verified knowledge bundle is installed: only local findings were consulted.');
  if (local.some((f) => revoked.has(f.id) && matches(q, f))) notes.push('A matching local finding was revoked by published knowledge and is not counted.');
  if (!q.release) notes.push('No release given: applicability was not judged (give the connection, or a release).');
  let answer: CapabilityAnswer;
  if (!evidence.length) answer = 'UNKNOWN';
  else if (!q.release) answer = published.length ? 'VERIFIED' : 'UNVERIFIED';
  else {
    const verified = published.some((e) => e.onRelease === 'verified');
    const incompatible = evidence.some((e) => e.onRelease === 'incompatible');
    answer = verified && incompatible ? 'CONFLICTING' : verified ? 'VERIFIED' : incompatible ? 'UNSUPPORTED' : 'UNVERIFIED';
    if (answer === 'UNVERIFIED' && published.length) notes.push(`Published knowledge matches, but none is verified on ${q.release}.`);
  }
  if (!q.release && published.length) notes.push('VERIFIED here means published for some release: check verifiedReleases against yours.');
  return { answer, ...(q.release ? { release: q.release } : {}), evidence, notes };
}
