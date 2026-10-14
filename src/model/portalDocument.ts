import { createHash } from 'node:crypto';
import * as z from 'zod/v4';

// Native menu names include parentheses; keys are bound values, not SQL identifiers.
const name = z.string().min(1).max(30).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value), 'Use an unpadded name without control characters');
export const portalIdentity = z.object({ portal: name, refType: z.enum(['F', 'C']), name });
export const portalTarget = z.discriminatedUnion('type', [
  z.object({ type: z.literal('component'), node: name, menu: name, component: name, market: z.string().min(1).max(3).default('GBL'),
    page: z.string().max(30).default(''), parameters: z.string().max(2000).default('') }).strict(),
  z.object({ type: z.literal('external'), url: z.string().min(1).max(4000).refine(v => /^https?:\/\//i.test(v), 'Use an HTTP or HTTPS URL') }).strict()
]);
export const portalInputFields = portalIdentity.extend({
  parent: name, label: z.string().min(1).max(30).refine(s => !!s.trim(), 'Label is required'), description: z.string().max(254).default(''),
  sequence: z.number().int().min(0).max(2147483647).default(0), owner: z.string().max(4).default(''),
  publicAccess: z.boolean().optional().describe('Omit on edit to preserve the stored public-access setting.'),
  target: portalTarget.optional().describe('Required for a new content reference. Omit on edit to preserve its current target.'),
  permissions: z.array(z.object({ type: z.enum(['P', 'R']), name: z.string().min(1).max(30), cascade: z.boolean().default(false) }).strict()).max(1000).optional()
    .describe('Permission lists (P) and roles (R) assigned to this entry; cascade applies to folders. Omit to preserve them; an empty array removes them. Ancestor permissions are separate.')
}).strict();
export const portalInput = portalInputFields.superRefine((v, ctx) => {
  if (v.refType === 'F' && v.target) ctx.addIssue({ code: 'custom', message: 'Folders do not have a content target.', path: ['target'] });
  if (v.refType === 'F' && v.name === v.parent) ctx.addIssue({ code: 'custom', message: 'A folder cannot be its own parent.', path: ['parent'] });
  if (v.permissions && new Set(v.permissions.map(p => p.type + ':' + p.name)).size !== v.permissions.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate security grants.', path: ['permissions'] });
});
export type PortalInput = z.infer<typeof portalInput>;
export type PortalIdentity = z.infer<typeof portalIdentity>;
export type PortalRow = Record<string, unknown>;
export interface PortalDocument { identity: PortalIdentity; row: PortalRow; permissions: PortalRow[]; attributes: PortalRow[]; token: string }
export const portalKey = (id: PortalIdentity) => [id.portal, id.refType, id.name];
export function portalToken(row: PortalRow, permissions: PortalRow[], attributes: PortalRow[]): string {
  return createHash('sha256').update(JSON.stringify({ row, permissions, attributes }, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)).digest('hex');
}
/** Sum of one-based character positions times character value: 17,243/17,243 HRDMO URLs. */
export function portalUrlChecksum(url: string): number {
  let sum = 0;
  for (let i = 0; i < url.length; i++) sum += (i + 1) * url.charCodeAt(i);
  return sum;
}
export function portalTargetColumns(target: z.infer<typeof portalTarget>): PortalRow {
  if (target.type === 'external') return { PORTAL_CREF_URLT: 'UEXT', PORTAL_CNTPRV_NAM: ' ', PORTAL_URI_SEG1: ' ', PORTAL_URI_SEG2: ' ', PORTAL_URI_SEG3: ' ', PORTAL_URI_SEG4: ' ', PORTAL_URLTEXT: target.url, PORTAL_URL_CHKSUM: portalUrlChecksum(target.url) };
  const query = [target.page ? 'Page=' + target.page : '', target.parameters].filter(Boolean).join('&');
  const url = `c/${target.menu}.${target.component}.${target.market}${query ? '?' + query : ''}`;
  return { PORTAL_CREF_URLT: 'UPGE', PORTAL_CNTPRV_NAM: target.node, PORTAL_URI_SEG1: target.menu, PORTAL_URI_SEG2: target.component,
    PORTAL_URI_SEG3: target.market, PORTAL_URI_SEG4: ' ', PORTAL_URLTEXT: url, PORTAL_URL_CHKSUM: portalUrlChecksum(url) };
}
export function portalInputForDocument(doc: PortalDocument): PortalInput {
  const s = (column: string) => String(doc.row[column] ?? '').trim();
  // The target is intentionally omitted: opening and saving an advanced reference must preserve it.
  return { ...doc.identity, parent: s('PORTAL_PRNTOBJNAME'), label: s('PORTAL_LABEL'), description: s('DESCR254'),
    sequence: Number(doc.row.PORTAL_SEQ_NUM), owner: s('OBJECTOWNERID'),
    permissions: doc.permissions.map(p => ({ cascade: Number(p.PORTAL_ISCASCADE) === 1, type: String(p.PORTAL_PERMTYPE).trim() as 'P' | 'R', name: String(p.PORTAL_PERMNAME).trim() })) };
}
