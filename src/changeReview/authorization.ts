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
}>();
export function withReviewedWrite<T>(connection: string, key: DefinitionKey, fn: () => Promise<T>, policyIdentity?: string): Promise<T> { return applying.run({ connection, key, policyIdentity }, fn); }
export function isReviewedWrite(connection: string, key: DefinitionKey, policyIdentity?: string): boolean { const c = applying.getStore(); return !!c && c.connection === connection && c.key.type === key.type && JSON.stringify(c.key.parts) === JSON.stringify(key.parts) && (policyIdentity === undefined || c.policyIdentity === policyIdentity); }
export function reviewedPolicyIdentity(policy: EffectivePolicy, classification: Classification, exists: boolean): string { return hash(JSON.parse(JSON.stringify({ policy, classification, exists }))); }
