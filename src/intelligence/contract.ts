import * as z from 'zod/v4';
import { canonicalJson, findingFingerprint, findingId, observationDigest } from './fingerprint.js';
import { findingInput, SCHEMA_ID, type FindingInput } from './schema.js';

/*
 * The client / server contract (docs/intelligence/FINDING_SCHEMA.md
 * "Contract"): the finding input as JSON Schema, and test vectors pinning
 * canonical JSON, fingerprints and digests, so the server -- written in
 * another language -- accepts what the client accepts and computes the same
 * identities. tools/intelligence/export-contract.mts writes both to
 * server/intelligence/contract/; a test fails when they drift from the code.
 */

/** The finding input as JSON Schema (draft 2020-12), with the rules zod keeps as refinements written out. */
export function findingInputJsonSchema(): Record<string, unknown> {
  const s = z.toJSONSchema(findingInput, { target: 'draft-2020-12' }) as Record<string, any>;
  // assertion.facts: 1 to 64 pairs (a refinement in schema.ts).
  const facts = s.properties.assertion.properties.facts;
  facts.minProperties = 1;
  facts.maxProperties = 64;
  return { $id: `https://peoplesoft-studio.invalid/schema/${SCHEMA_ID}/finding-input.json`, title: `${SCHEMA_ID} finding input`, ...s };
}

/** Inputs chosen to pin down canonical JSON: key order, Unicode, escapes, number forms, nesting. */
function vectorInputs(): Array<{ name: string; input: FindingInput }> {
  const base: FindingInput = {
    type: 'save-protocol',
    subject: { subsystem: 'event-mapping', objectType: 'Event Mapping configuration', tables: ['PSPTCSSRVCONF'] },
    assertion: { kind: 'row-resave', facts: { table: 'PSPTCSSRVCONF', everyRowOnSave: true, versionCounter: 'SCNFM' } },
    title: 'Every row re-saved', statement: 'Each row is deleted and re-inserted.', confidence: 'high', source: 'research-harness',
    observation: { observedAt: '2026-10-12T19:50:28.000Z', method: 'pia-capture', experimentId: 'em04', environment: { peopleToolsRelease: '8.62.09' }, observation: 'Two rows re-saved.' }
  };
  return [
    { name: 'basic', input: base },
    { name: 'facts in another order', input: { ...base, assertion: { kind: 'row-resave', facts: { versionCounter: 'SCNFM', table: 'PSPTCSSRVCONF', everyRowOnSave: true } } } },
    { name: 'object type case and padding', input: { ...base, subject: { ...base.subject, objectType: '  EVENT MAPPING Configuration ' } } },
    { name: 'numbers', input: { ...base, assertion: { kind: 'numbers', facts: { int: 3, neg: -12, zero: 0, negZero: -0, frac: 0.1, half: 1.5, big: 1e21, small: 1.5e-7, wholeFloat: 2.0, maxSafe: 9007199254740991 } } } },
    { name: 'strings and escapes', input: { ...base, assertion: { kind: 'strings', facts: { quote: 'say "x"', back: 'a\\b', tab: 'a\tb', nl: 'a\nb', ctl: 'a\u0001b', unicode: 'Größe – 名前 ✓', emoji: 'ok 👍', padded: '  trimmed  ', empty: '' } } } },
    { name: 'null and booleans', input: { ...base, assertion: { kind: 'flags', facts: { yes: true, no: false, none: null } } } },
    { name: 'another subsystem', input: { ...base, type: 'metadata-mapping', subject: { subsystem: 'page-designer', objectType: 'Page' }, assertion: { kind: 'column-mapping', facts: { property: 'Display Only', table: 'PSPNLFIELD', column: 'FIELDUSE', bit: 1 } } } }
  ];
}

export interface ContractVector {
  name: string;
  input: FindingInput;
  /** canonicalJson of the identity object hashed for the fingerprint. */
  identityCanonical: string;
  fingerprint: string;
  id: string;
  /** canonicalJson of the observation without observedAt. */
  observationCanonical: string;
  observationDigest: string;
}

export function contractVectors(): ContractVector[] {
  return vectorInputs().map(({ name, input }) => {
    const { observedAt: _t, ...observation } = input.observation;
    return {
      name, input,
      identityCanonical: canonicalJson({ v: 1, type: input.type, subsystem: input.subject.subsystem, objectType: input.subject.objectType.trim().toLowerCase(), assertion: { kind: input.assertion.kind.trim(), facts: input.assertion.facts } }),
      fingerprint: findingFingerprint(input), id: findingId(findingFingerprint(input)),
      observationCanonical: canonicalJson(observation), observationDigest: observationDigest(input.observation)
    };
  });
}
