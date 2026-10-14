/*
 * Who owns a definition, from evidence (docs/CUSTOMIZATION.md): Oracle
 * (DELIVERED, or DELIVERED_MODIFIED once re-saved locally), a bolt-on vendor
 * (PARTNER), the organization (CUSTOM) -- or UNKNOWN when the evidence does
 * not decide. And what the delivered-object policy makes of a write to it.
 * Pure: the evidence is read elsewhere (DatabaseProvider.classifyDefinition).
 *
 * The evidence, strongest first:
 * - a delivered baseline -- the definitions of a vanilla demo database of the
 *   same application release -- that holds the definition, or does not;
 * - the definition's stamp: Oracle delivers every definition saved by
 *   PPLSOFT (on HRDMO all 52,775 records, 17,342 pages and 119,290 PeopleCode
 *   programs are), and a local save restamps it;
 * - an Oracle-delivered project (stamped PPLSOFT, not named with a configured
 *   prefix) listing it -- weak, positive evidence only: they list about a
 *   sixth of what Oracle delivers, and anyone signed in as PPLSOFT stamps a
 *   project so (HRDMO's lab project ZZ_PCODE_LAB_G is);
 * - the naming prefixes: the organization's, and each bolt-on vendor's. A
 *   convention, never proof on its own -- Oracle itself delivers ZZ_ records
 *   (ZZ_DMNDCRS_SRC, ZZ_DSTNCT_DEPT ... on HRDMO).
 */

/** Oracle's delivery operator: what every delivered definition's LASTUPDOPRID is until it is saved locally. */
export const DELIVERY_OPERATOR = 'PPLSOFT';

export type Ownership = 'DELIVERED' | 'DELIVERED_MODIFIED' | 'PARTNER' | 'CUSTOM' | 'UNKNOWN';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface NamingPrefix {
  prefix: string;
  /** organization: the site's own definitions; partner: a bolt-on vendor's. */
  owner: 'organization' | 'partner';
  /** The organization or vendor, for the evidence. */
  name?: string;
}

export interface OwnershipEvidence {
  /** Whether the definition is stored at all (a new one has no owner yet). */
  exists: boolean;
  /** Version/stamp-matched receipt of a verified Studio creation. */
  studioCreation?: {createdAt:string};
  version?:number;
  /** LASTUPDOPRID and LASTUPDDTTM of the definition (its program's, for PeopleCode). */
  operator?: string;
  updated?: string;
  /** An Oracle-delivered project (LASTUPDOPRID PPLSOFT) listing it. */
  deliveredProject?: string;
  /** A delivered baseline of this database's application release: whether it holds the definition. */
  baseline?: { label: string; contains: boolean };
  /** The configured prefix the name starts with (the longest). */
  prefix?: NamingPrefix;
}

export interface Classification {
  ownership: Ownership;
  confidence: Confidence;
  /** Why, in the order it was weighed. */
  evidence: string[];
}

/** The configured prefix a name starts with: the longest, so XYZ_HR_ wins over XYZ_. */
export function matchPrefix(name: string, prefixes: readonly NamingPrefix[]): NamingPrefix | undefined {
  const n = name.trim().toUpperCase();
  return [...prefixes]
    .filter((p) => p.prefix.trim() && n.startsWith(p.prefix.trim().toUpperCase()))
    .sort((a, b) => b.prefix.trim().length - a.prefix.trim().length)[0];
}

/** Settings entries made safe: trimmed, uppercased, blanks and duplicates dropped; the 0.8.4 single prefix as a fallback. */
export function normalizePrefixes(list: unknown, legacyOrganizationPrefix = ''): NamingPrefix[] {
  const out: NamingPrefix[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(list) ? list : []) {
    const raw = typeof e === 'string' ? { prefix: e } : (e ?? {}) as Partial<NamingPrefix>;
    const prefix = String(raw.prefix ?? '').trim().toUpperCase();
    if (!prefix || seen.has(prefix)) continue;
    seen.add(prefix);
    out.push({ prefix, owner: raw.owner === 'partner' ? 'partner' : 'organization', ...(raw.name ? { name: String(raw.name) } : {}) });
  }
  const legacy = legacyOrganizationPrefix.trim().toUpperCase();
  if (!out.length && legacy) out.push({ prefix: legacy, owner: 'organization' });
  return out;
}

const who = (p: NamingPrefix) => `${p.owner === 'partner' ? 'bolt-on' : 'organization'} prefix ${p.prefix}${p.name ? ` (${p.name})` : ''}`;

export function classifyOwnership(e: OwnershipEvidence): Classification {
  if (!e.exists) return { ownership: 'UNKNOWN', confidence: 'HIGH', evidence: ['Not stored: a new definition has no owner yet.'] };
  const ev: string[] = [];
  const oracle = (e.operator ?? '').trim().toUpperCase() === DELIVERY_OPERATOR;
  const stamp = e.operator ? `last saved by ${e.operator.trim()}${e.updated ? ` on ${e.updated}` : ''}` : 'no save stamp';
  const result = (ownership: Ownership, confidence: Confidence): Classification => ({ ownership, confidence, evidence: ev });

  if (e.baseline) {
    ev.push(`${e.baseline.contains ? 'In' : 'Not in'} the delivered baseline ${e.baseline.label}.`);
    ev.push(oracle ? `Stamped ${DELIVERY_OPERATOR} (${stamp}).` : `Saved locally: ${stamp}.`);
    if (e.baseline.contains) return result(oracle ? 'DELIVERED' : 'DELIVERED_MODIFIED', 'HIGH');
    if (e.prefix) ev.push(`Its name has the ${who(e.prefix)}.`);
    if (e.prefix?.owner === 'partner') return result('PARTNER', 'HIGH');
    if (e.prefix?.owner === 'organization') return result('CUSTOM', 'HIGH');
    // Stamped by Oracle but not in the baseline: delivered by a later update than the baseline's.
    if(e.studioCreation){ev.push(`Studio verified creation on ${e.studioCreation.createdAt}; its version and stamp still match.`);return result('CUSTOM','HIGH');}
    if (oracle) return result('DELIVERED', 'MEDIUM');
    return result('CUSTOM', 'MEDIUM');
  }

  if(e.studioCreation && e.prefix?.owner!=='partner'){
    ev.push(`Studio verified creation on ${e.studioCreation.createdAt}; its stored version and save stamp still match the receipt.`);
    return result('CUSTOM','HIGH');
  }

  ev.push('No delivered baseline for this release: ownership rests on the stamp, projects and prefixes.');
  if (e.deliveredProject) ev.push(`Listed in the Oracle-delivered project ${e.deliveredProject}.`);
  if (e.prefix) ev.push(`Its name has the ${who(e.prefix)}.`);
  if (oracle) {
    ev.push(`Stamped ${DELIVERY_OPERATOR} (${stamp}): never saved locally.`);
    // A bolt-on can be installed under Oracle's operator; its prefix says whose it is, weakly.
    if (e.prefix?.owner === 'partner' && !e.deliveredProject) return result('PARTNER', 'LOW');
    return result('DELIVERED', e.deliveredProject ? 'HIGH' : 'MEDIUM');
  }
  ev.push(`Saved locally: ${stamp}.`);
  // Saved locally, listed by a project stamped PPLSOFT: likely Oracle's, re-saved; weak, so asked rather than assumed custom.
  if (e.deliveredProject) return result('DELIVERED_MODIFIED', 'LOW');
  if (e.prefix?.owner === 'partner') return result('PARTNER', 'MEDIUM');
  if (e.prefix?.owner === 'organization') return result('CUSTOM', 'MEDIUM');
  ev.push('Nothing says whether Oracle, a vendor or the organization made it.');
  return result('UNKNOWN', 'LOW');
}

export type DeliveredObjectPolicy = 'block' | 'requireApproval' | 'allowWithAudit';

export interface WriteDecision {
  /** allow: write; ask: the user must approve this write; audit: write and record it; refuse: do not write. */
  action: 'allow' | 'ask' | 'audit' | 'refuse';
  reason: string;
}

const OWNED_BY_OTHERS: ReadonlySet<Ownership> = new Set(['DELIVERED', 'DELIVERED_MODIFIED', 'PARTNER']);

/**
 * What the delivered-object policy makes of a write. Oracle's and vendors'
 * definitions follow the policy; the organization's are written as before;
 * an UNKNOWN owner never bypasses it -- under block it is asked, not refused,
 * since nothing proves it delivered.
 */
export function decideWrite(c: Classification, policy: DeliveredObjectPolicy, exists = true): WriteDecision {
  if (!exists) return { action: 'allow', reason: 'A new definition.' };
  const owner = c.ownership === 'PARTNER' ? 'a bolt-on vendor\'s definition' : c.ownership === 'UNKNOWN' ? 'a definition of unknown ownership' : 'an Oracle-delivered definition';
  if (c.ownership === 'CUSTOM') return { action: 'allow', reason: 'The organization\'s own definition.' };
  if (OWNED_BY_OTHERS.has(c.ownership)) {
    if (policy === 'block') return { action: 'refuse', reason: `It is ${owner}, and the delivered-object policy blocks direct edits.` };
    if (policy === 'requireApproval') return { action: 'ask', reason: `It is ${owner}: the delivered-object policy requires your approval.` };
    return { action: 'audit', reason: `It is ${owner}: allowed, and recorded.` };
  }
  // UNKNOWN
  if (policy === 'allowWithAudit') return { action: 'audit', reason: `It is ${owner}: allowed, and recorded.` };
  return { action: 'ask', reason: `It is ${owner}, which could be delivered: approve this write to go ahead.` };
}

export const OWNERSHIP_LABELS: Readonly<Record<Ownership, string>> = {
  DELIVERED: 'Delivered', DELIVERED_MODIFIED: 'Delivered, modified', PARTNER: 'Partner (bolt-on)', CUSTOM: 'Custom', UNKNOWN: 'Unknown'
};
