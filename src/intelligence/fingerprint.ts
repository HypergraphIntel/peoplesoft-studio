import { createHash } from 'node:crypto';
import type { Assertion, FindingInput, Observation } from './schema.js';

/*
 * Deterministic identity (docs/intelligence/FINDING_SCHEMA.md "Identity").
 *
 * A finding's fingerprint is SHA-256 over the canonical JSON of what the
 * claim is -- its type, subsystem, object type and assertion -- and nothing
 * else: not the title or statement (prose may be reworded), not the release
 * (the same claim seen on another release is the same finding, its
 * compatibility widened), not the evidence. An observation's digest is
 * SHA-256 over its canonical content but the time it was recorded: the same
 * evidence recorded twice is one observation.
 */

/** JSON with object keys sorted at every level, strings trimmed, undefined dropped: equal values, equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function canonical(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('A finding holds finite numbers only.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = canonical(v);
    }
    return out;
  }
  throw new Error(`A finding cannot hold a ${typeof value}.`);
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The assertion as compared: kind and fact keys as given, the order of facts irrelevant. */
export function canonicalAssertion(a: Assertion): unknown {
  return { kind: a.kind.trim(), facts: a.facts };
}

export function findingFingerprint(input: Pick<FindingInput, 'type' | 'subject' | 'assertion'>): string {
  return sha256(canonicalJson({
    v: 1,
    type: input.type,
    subsystem: input.subject.subsystem,
    objectType: input.subject.objectType.trim().toLowerCase(),
    assertion: canonicalAssertion(input.assertion)
  }));
}

/** `f-` and the fingerprint's first 24 hex digits (96 bits): short, stable, collision-safe at this scale. */
export const findingId = (fingerprint: string) => `f-${fingerprint.slice(0, 24)}`;

export function observationDigest(o: Observation): string {
  const { observedAt: _when, ...content } = o;
  return sha256(canonicalJson(content));
}
