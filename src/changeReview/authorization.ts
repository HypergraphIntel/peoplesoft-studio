import { hash } from './model.js';
import type { Classification } from '../model/ownership.js';
import type { EffectivePolicy } from '../providers/writeGuard.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DefinitionKey } from '../model/definitions.js';
/** Only the trusted ReviewService adapter calls this after exact-hash approval. */
const applying = new AsyncLocalStorage<{
    connection: string;
    key: DefinitionKey;
    policyIdentity?: string;
    /** Definitions this reviewed write has itself created (a new field before its properties, a package root before its subpackages). */
    created: Set<string>;
}>();
const identity = (key: DefinitionKey) => key.type + '\u0000' + JSON.stringify(key.parts);
export function withReviewedWrite<T>(connection: string, key: DefinitionKey, fn: () => Promise<T>, policyIdentity?: string): Promise<T> { return applying.run({ connection, key, policyIdentity, created: new Set() }, fn); }
/** Writers call this after creating a definition; later steps of the same reviewed write then remain covered by its approval. */
export function noteReviewedCreation(connection: string, key: DefinitionKey): void { const c = applying.getStore(); if (c && c.connection === connection) c.created.add(identity(key)); }
export function createdInReviewedWrite(connection: string, key: DefinitionKey): boolean { const c = applying.getStore(); return !!c && c.connection === connection && c.created.has(identity(key)) && isReviewedWrite(connection, key); }
export function isReviewedWrite(connection: string, key: DefinitionKey, policyIdentity?: string): boolean { const c = applying.getStore(); return !!c && c.connection === connection && c.key.type === key.type && JSON.stringify(c.key.parts) === JSON.stringify(key.parts) && (policyIdentity === undefined || c.policyIdentity === policyIdentity); }
export function reviewedPolicyIdentity(policy: EffectivePolicy, classification: Classification, exists: boolean): string { return hash(JSON.parse(JSON.stringify({ policy, classification, exists }))); }
