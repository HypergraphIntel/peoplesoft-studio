/*
 * Who a Page and Field Configurator configuration applies to, as its page
 * edits it (EOCC_CONFIGURE: EOCC_CONFIG_HDR / EOCC_CONFIG_SEQ EOCC_APPLY_TO
 * FieldChange, EOCC_APPLY_LVL FieldChange). With the header's apply level H
 * the header says it for every sequence; with S each sequence says it for
 * itself. Apply To:
 *
 * - A, everyone but the excluded roles and the excluded users;
 * - R, one role (ROLENAME) but the excluded users;
 * - S, the included roles but the excluded users;
 * - U, the selected users.
 *
 * Changing it replaces only the lists that Apply To uses; the others stay as
 * they are, as the page only hides them. Rows are compact (pfcWriter reads):
 * a value equal to its record default is absent (Apply To A, apply level H).
 */

export type Row = Record<string, unknown>;
export type ApplyTo = 'A' | 'R' | 'S' | 'U';

export interface PfcTarget {
  applyTo: ApplyTo;
  /** The single role (R). */
  role?: string;
  /** Included roles (S). */
  roles: string[];
  /** Excluded roles (A). */
  excludedRoles: string[];
  /** Selected users (U). */
  users: string[];
  /** Excluded users (A, R, S). */
  excludedUsers: string[];
}

export const APPLY_TO_LABELS: Readonly<Record<ApplyTo, string>> = {
  A: 'Everyone, but excluded roles and users', R: 'A single role, but excluded users', S: 'Specific roles, but excluded users', U: 'Selected users'
};

/** The configuration rows these rules read and write (a pfcWriter compact configuration). */
export interface TargetedConfiguration {
  header: Row;
  sequences: Row[];
  seqUsers?: Row[];
  seqExcludedUsers?: Row[];
  seqRoles?: Row[];
  seqExcludedRoles?: Row[];
  users?: Row[];
  excludedUsers?: Row[];
  roles?: Row[];
  excludedRoles?: Row[];
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const seqOf = (r: Row) => Number(r.EOCC_SEQUENCE_NBR);

/** Whether the header says who for every sequence (EOCC_APPLY_LVL H, the default) or each sequence says it (S). */
export const headerLevel = (c: TargetedConfiguration) => (s(c.header.EOCC_APPLY_LVL) || 'H') === 'H';

type Lists = { users: keyof TargetedConfiguration; excludedUsers: keyof TargetedConfiguration; roles: keyof TargetedConfiguration; excludedRoles: keyof TargetedConfiguration };
const SEQUENCE_LISTS: Lists = { users: 'seqUsers', excludedUsers: 'seqExcludedUsers', roles: 'seqRoles', excludedRoles: 'seqExcludedRoles' };
const HEADER_LISTS: Lists = { users: 'users', excludedUsers: 'excludedUsers', roles: 'roles', excludedRoles: 'excludedRoles' };

/** Who the header (no sequence) or a sequence applies to. */
export function targetOf(c: TargetedConfiguration, seq?: Row): PfcTarget {
  const owner = seq ?? c.header;
  const lists = seq ? SEQUENCE_LISTS : HEADER_LISTS;
  const mine = (key: keyof Lists, field: 'OPRID' | 'ROLENAME') =>
    ((c[lists[key]] as Row[] | undefined) ?? []).filter((r) => !seq || seqOf(r) === seqOf(seq)).map((r) => s(r[field])).filter(Boolean);
  const applyTo = (s(owner.EOCC_APPLY_TO) || 'A') as ApplyTo;
  return {
    applyTo, ...(s(owner.ROLENAME) ? { role: s(owner.ROLENAME) } : {}),
    roles: mine('roles', 'ROLENAME'), excludedRoles: mine('excludedRoles', 'ROLENAME'), users: mine('users', 'OPRID'), excludedUsers: mine('excludedUsers', 'OPRID')
  };
}

/** The lists an Apply To uses. */
export function listsUsed(applyTo: ApplyTo): Array<keyof Lists> {
  switch (applyTo) {
    case 'A': return ['excludedRoles', 'excludedUsers'];
    case 'R': return ['excludedUsers'];
    case 'S': return ['roles', 'excludedUsers'];
    case 'U': return ['users'];
  }
}

/** Problems with a target: a single role named, no duplicates. */
export function checkTarget(t: PfcTarget): string[] {
  const out: string[] = [];
  if (t.applyTo === 'R' && !t.role?.trim()) out.push('Choose the role it applies to.');
  for (const key of listsUsed(t.applyTo)) if (new Set(t[key]).size !== t[key].length) out.push(`The ${key} list names one twice.`);
  return out;
}

/** The configuration with the header's (no sequence) or a sequence's target set: Apply To, the role, and the lists it uses. */
export function withTarget<C extends TargetedConfiguration>(c: C, seq: Row | undefined, t: PfcTarget): C {
  const lists = seq ? SEQUENCE_LISTS : HEADER_LISTS;
  const out = { ...c } as C;
  const owner = { ...(seq ?? c.header), EOCC_APPLY_TO: t.applyTo, ROLENAME: t.applyTo === 'R' ? (t.role ?? '').trim() : '' };
  if (seq) out.sequences = c.sequences.map((r) => (seqOf(r) === seqOf(seq) ? owner : r));
  else out.header = owner;
  const keys = seq ? { SEQUENCE_NBR: Number(seq.SEQUENCE_NBR), EOCC_SEQUENCE_NBR: seqOf(seq) } : {};
  for (const key of listsUsed(t.applyTo)) {
    const field = key === 'roles' || key === 'excludedRoles' ? 'ROLENAME' : 'OPRID';
    const table = lists[key];
    const others = ((c[table] as Row[] | undefined) ?? []).filter((r) => seq && seqOf(r) !== seqOf(seq));
    (out as Record<string, unknown>)[table] = [...others, ...t[key].map((v) => ({ ...keys, [field]: v.trim() }))];
  }
  return out;
}

/** The configuration with its apply level: H, the header for every sequence; S, each sequence. */
export function withApplyLevel<C extends TargetedConfiguration>(c: C, level: 'H' | 'S'): C {
  return { ...c, header: { ...c.header, EOCC_APPLY_LVL: level } };
}

/** "Everyone except …", "Role X except …", in a line. */
export function describeTarget(t: PfcTarget): string {
  const list = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more` : xs.join(', '));
  const except = (roles: string[], users: string[]) => {
    const parts = [roles.length ? `roles ${list(roles)}` : '', users.length ? `users ${list(users)}` : ''].filter(Boolean);
    return parts.length ? `, except ${parts.join(' and ')}` : '';
  };
  switch (t.applyTo) {
    case 'A': return `Everyone${except(t.excludedRoles, t.excludedUsers)}`;
    case 'R': return `Role ${t.role || '(none chosen)'}${except([], t.excludedUsers)}`;
    case 'S': return t.roles.length ? `Roles ${list(t.roles)}${except([], t.excludedUsers)}` : 'Specific roles: none listed (no one)';
    case 'U': return t.users.length ? `Users ${list(t.users)}` : 'Selected users: none listed (no one)';
  }
}
