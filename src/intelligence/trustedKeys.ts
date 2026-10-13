import type { TrustedKey } from './knowledge.js';

/*
 * The knowledge-bundle signing keys this build trusts
 * (docs/intelligence/KNOWLEDGE_REGISTRY.md "Knowledge bundles"). A key is
 * added -- or rotated out -- only in a release, never by a bundle, a setting
 * or a server. None is trusted yet: no production signing key has been
 * generated (it is generated offline by the project owner with
 * `python -m app.admin generate-key`), so every bundle is refused.
 */
export const TRUSTED_KNOWLEDGE_KEYS: readonly TrustedKey[] = [];
