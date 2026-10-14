import { createHash } from 'node:crypto';
import * as z from 'zod/v4';

export const ADMIN_KINDS = ['message', 'text', 'url'] as const;
export type AdminKind = typeof ADMIN_KINDS[number];
export type AdminRow = Record<string, string | number | null>;
export interface AdminDocument {
  kind: AdminKind;
  key: string[];
  row: AdminRow;
  related: AdminRow[];
  parent?: AdminRow;
  token: string;
}
export interface AdminSummary { key: string[]; label: string; description: string }
export const adminKind = z.enum(ADMIN_KINDS);
const string = z.string();
const date = string.regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}, 'Invalid effective date');
export const messageInput = z.object({
  set: z.number().int().min(20000).max(32767), number: z.number().int().min(1).max(32767),
  setDescription: string.max(30), setShortDescription: string.max(10),
  text: string.min(1).max(100).refine(value => !!value.trim(), 'Message text is required'), severity: z.enum(['M', 'W', 'E', 'C']), explanation: string
}).strict();
export const urlInput = z.object({
  id: string.min(1).max(30).refine(value => value.trim() === value && !/[\r\n]/.test(value), 'Invalid URL ID'), description: string.max(30),
  url: string.min(1).max(254), owner: string.max(4), comments: string
}).strict();
export const textInput = z.object({
  owner: string.min(1).max(4), subId: string.max(4), id: string.min(1).max(18), effectiveDate: date,
  keys: z.array(string.max(30)).length(6), language: string.max(3),
  text: string.max(8095), description: string.max(254), usage: string.max(4), systemData: z.boolean()
}).strict();
export type AdminInput = z.infer<typeof messageInput> | z.infer<typeof urlInput> | z.infer<typeof textInput>;

export function validateAdminInput(kind: AdminKind, input: unknown): AdminInput {
  return kind === 'message' ? messageInput.parse(input) : kind === 'url' ? urlInput.parse(input) : textInput.parse(input);
}
export function adminInputKey(kind: AdminKind, input: AdminInput): string[] {
  if (kind === 'message') { const m = messageInput.parse(input); return [String(m.set), String(m.number)]; }
  if (kind === 'url') return [urlInput.parse(input).id];
  const t = textInput.parse(input); return [t.owner, t.subId, t.id, t.effectiveDate, ...t.keys, t.language];
}
export function adminToken(kind: AdminKind, key: readonly string[], row: AdminRow, related: AdminRow[], parent?: AdminRow): string {
  return createHash('sha256').update(JSON.stringify({ kind, key, row, related, parent }, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)).digest('hex');
}
export const adminIdentity = (kind: AdminKind, key: readonly string[]) => JSON.stringify([kind, key]);

/** The protocol groups come from PSURLDEFN.URL FieldChange, HRDMO 8.62.09. */
export function urlProtocol(value: string): string {
  const url = value.toLowerCase();
  if (url.startsWith('cloud:')) return urlProtocol(url.slice(6));
  if (url.startsWith('record:')) return 'RECOR';
  if (/^ftps?:/.test(url)) return 'FTPS';
  if (url.startsWith('sftp:')) return 'SFTP';
  if (url.startsWith('https:')) return 'HTTPS';
  if (url.startsWith('http:')) return 'HTTP';
  return '';
}

export function inputForAdminDocument(doc: AdminDocument): AdminInput {
  const r = doc.row, p = doc.parent;
  const s = (value: unknown) => String(value ?? '').trimEnd();
  if (doc.kind === 'message') return {
    set: Number(doc.key[0]), number: Number(doc.key[1]), setDescription: s(p?.DESCR), setShortDescription: s(p?.DESCRSHORT),
    text: String(r.MESSAGE_TEXT ?? ''), severity: s(r.MSG_SEVERITY) as 'M', explanation: String(r.DESCRLONG ?? '')
  };
  if (doc.kind === 'url') return { id: doc.key[0], description: s(r.DESCR), url: String(r.URL ?? ''), owner: s(r.OBJECTOWNERID), comments: String(r.COMMENTS ?? '') };
  return { owner: doc.key[0], subId: doc.key[1], id: doc.key[2], effectiveDate: doc.key[3], keys: doc.key.slice(4, 10),
    language: doc.key[10] ?? '', text: String(r.HR_SSTEXT_TEXT ?? ''), description: s(p?.DESCR254_MIXED),
    usage: s(p?.HR_SSTEXT_USAGE), systemData: s(r.SYSTEM_DATA_FLG ?? p?.SYSTEM_DATA_FLG) === 'Y' };
}

/** Match the existing Text Catalog FieldEdit's exact allowed tag strings. */
export function invalidTextTags(text: string, allowed: ReadonlySet<string>): string[] {
  return [...new Set([...text.matchAll(/<[^>]*>/g)].map(match => match[0]).filter(tag => !allowed.has(tag)))];
}
