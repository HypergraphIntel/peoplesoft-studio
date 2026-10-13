import { createPublicKey, createHash, verify as cryptoVerify } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as z from 'zod/v4';
import { canonicalJson } from './fingerprint.js';
import { assertion, FINDING_TYPES, subject, toolsRelease } from './schema.js';

/*
 * Knowledge bundles on the client (docs/intelligence/KNOWLEDGE_REGISTRY.md,
 * DECISIONS D8): a bundle is trusted only after its envelope and bundle
 * match the strict schema, its key is one the extension trusts, its Ed25519
 * signature verifies over the bundle's canonical JSON (the form the
 * fingerprints use, shared with the server), it has not expired, and it is
 * newer than the installed one (no rollback). A bundle is data: published
 * claims and revocations. Nothing in it is executed, and nothing in it
 * changes a write gate, an approval or a writer. Installed bundles live
 * beside, never inside, the local discovery store.
 */

export const BUNDLE_FORMAT = 'psft-knowledge/1';
export const ENVELOPE_FORMAT = 'psft-knowledge-envelope/1';

const knowledgeFinding = z.strictObject({
  id: z.string().regex(/^f-[0-9a-f]{24}$/),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  type: z.enum(FINDING_TYPES),
  subject,
  assertion,
  title: z.string().min(1).max(200),
  statement: z.string().min(1).max(4000),
  verifiedReleases: z.array(toolsRelease).min(1).max(50),
  knownIncompatible: z.array(toolsRelease).max(50),
  publishedAt: z.iso.datetime({ offset: true })
});

export const knowledgeBundle = z.strictObject({
  format: z.literal(BUNDLE_FORMAT),
  version: z.number().int().positive(),
  issuedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  findings: z.array(knowledgeFinding).max(10000),
  revoked: z.array(z.string().regex(/^f-[0-9a-f]{24}$/)).max(10000)
});

export const knowledgeEnvelope = z.strictObject({
  format: z.literal(ENVELOPE_FORMAT),
  keyId: z.string().regex(/^[0-9a-f]{16}$/),
  signature: z.string().max(200),
  bundle: z.unknown()
});

export type KnowledgeBundle = z.infer<typeof knowledgeBundle>;
export type KnowledgeFinding = KnowledgeBundle['findings'][number];

/** A trusted signing key: its raw Ed25519 public key, base64. */
export interface TrustedKey { keyId: string; publicKey: string }

export interface VerifyResult {
  ok: boolean;
  bundle?: KnowledgeBundle;
  reasons: string[];
}

/** The key id: the first 16 hex digits of SHA-256 over the raw public key (as the server computes it). */
export function keyIdOf(publicKeyBase64: string): string {
  return createHash('sha256').update(Buffer.from(publicKeyBase64, 'base64')).digest('hex').slice(0, 16);
}

function ed25519Key(publicKeyBase64: string) {
  const raw = Buffer.from(publicKeyBase64, 'base64');
  if (raw.length !== 32) throw new Error('An Ed25519 public key is 32 bytes.');
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
}

/** Every check a bundle must pass before it is used; every failure listed. */
export function verifyEnvelope(raw: unknown, trusted: readonly TrustedKey[], options: { now?: Date; installedVersion?: number } = {}): VerifyResult {
  const reasons: string[] = [];
  const env = knowledgeEnvelope.safeParse(raw);
  if (!env.success) return { ok: false, reasons: [`Not a ${ENVELOPE_FORMAT} envelope (${env.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('; ')}).`] };
  const bundle = knowledgeBundle.safeParse(env.data.bundle);
  if (!bundle.success) reasons.push(`The bundle does not match ${BUNDLE_FORMAT} (${bundle.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('; ')}).`);
  const key = trusted.find((k) => k.keyId === env.data.keyId && keyIdOf(k.publicKey) === k.keyId);
  if (!key) reasons.push(`Signed by key ${env.data.keyId}, which this extension does not trust.`);
  else {
    let good = false;
    try {
      good = cryptoVerify(null, Buffer.from(canonicalJson(env.data.bundle), 'utf8'), ed25519Key(key.publicKey), Buffer.from(env.data.signature, 'base64'));
    } catch { good = false; }
    if (!good) reasons.push('The signature does not verify: the bundle was altered or not signed by that key.');
  }
  if (bundle.success) {
    const now = options.now ?? new Date();
    if (Date.parse(bundle.data.expiresAt) <= now.getTime()) reasons.push(`The bundle expired on ${bundle.data.expiresAt}.`);
    if (Date.parse(bundle.data.issuedAt) > now.getTime() + 5 * 60_000) reasons.push('The bundle is issued in the future.');
    if (options.installedVersion !== undefined && bundle.data.version <= options.installedVersion) {
      reasons.push(`Version ${bundle.data.version} is not newer than the installed ${options.installedVersion} (rollback refused).`);
    }
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, bundle: bundle.data!, reasons: [] };
}

/**
 * The installed knowledge: one verified envelope, kept apart from the
 * discovery store, verified again whenever it is read.
 */
export class KnowledgeStore {
  private readonly file: string;

  constructor(readonly root: string, private readonly trusted: () => readonly TrustedKey[]) {
    this.file = path.join(root, 'knowledge', 'bundle.json');
  }

  private async raw(): Promise<unknown | undefined> {
    try { return JSON.parse(await readFile(this.file, 'utf8')); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  /** The installed bundle, re-verified (expired or no longer trusted: none). */
  async current(now = new Date()): Promise<VerifyResult | undefined> {
    const raw = await this.raw();
    return raw === undefined ? undefined : verifyEnvelope(raw, this.trusted(), { now });
  }

  /** Verifies and installs an envelope; refused (nothing written) unless every check passes. */
  async install(envelope: unknown, now = new Date()): Promise<VerifyResult> {
    const installed = await this.raw();
    const installedVersion = installed === undefined ? undefined : knowledgeBundle.safeParse((installed as { bundle?: unknown }).bundle).data?.version;
    const r = verifyEnvelope(envelope, this.trusted(), { now, ...(installedVersion !== undefined ? { installedVersion } : {}) });
    if (!r.ok) return r;
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    await writeFile(tmp, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    await rename(tmp, this.file);
    return r;
  }
}
