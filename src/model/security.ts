import { createHash } from 'node:crypto';

export type SecurityKind = 'oauth' | 'saml';
export type SecurityRow = Record<string, string | number | null>;
export interface SecurityDocument {
  kind: SecurityKind;
  key: string[];
  properties: SecurityRow;
  audiences: string[];
  roles: string[];
  token: string;
}
export interface SecurityList { items: { key: string[]; label: string; description: string }[]; more: boolean }
export interface SecurityChoices { field: string; code: string; label: string }
export const OAUTH_COLUMNS = ['PTAPP_NAME', 'PTAUTHSERVER', 'PTCLIENT_ID', 'PTSECTYPE', 'PTSCOPE', 'PTISS',
  'PTTOKENTYPEAT', 'PTTENANT', 'PTAUDIENCE1', 'PTAUDIENCE2', 'PTAUTHFLOW', 'PTIB_EXTNAME', 'PTSTATE',
  'PTREFRESH', 'PTTOKENURL', 'PTSCOPE_URL', 'PTJWTEXP'] as const;
export const SAML_COLUMNS = ['CERTALIAS', 'PTISSUER', 'PTSUBJECTNAME', 'PTQUALIFIERNAME', 'PTMAPPSFTUSERID',
  'ACTIVE_FLAG', 'DESCR254', 'LASTUPDOPRID', 'LASTUPDDTTM'] as const;
export const SECURITY_TITLES: Record<SecurityKind, string> = { oauth: 'OAuth2 Service Applications', saml: 'SAML' };
export const SAML_BOUNDARY = 'SAML 2.0 browser sign-on provider configuration requires PeopleTools 8.63 and is not implemented in Studio. The mappings below are the older inbound web-service SAML setup, not browser SSO.';
export function securityKey(kind: SecurityKind, key: string[]): void {
  const lengths = kind === 'oauth' ? [100, 2] : [50, 30, 114, 30];
  if (key.length !== lengths.length || key.some((v, i) => typeof v !== 'string' || (kind === 'oauth' && !v.trim()) || v.length > lengths[i])) throw new Error('Invalid ' + kind + ' key.');
}
export function securityToken(properties: SecurityRow, audiences: string[], roles: string[]): string {
  return createHash('sha256').update(JSON.stringify({ properties, audiences, roles })).digest('hex');
}
export function securityDiagnostics(doc: SecurityDocument): string[] {
  const p = doc.properties, messages: string[] = [];
  if (doc.kind === 'saml') {
    if (!String(p.PTMAPPSFTUSERID ?? '').trim()) messages.push('No mapped PeopleSoft user.');
    return messages;
  }
  if (!String(p.PTCLIENT_ID ?? '').trim() && p.PTSECTYPE !== 'R') messages.push('Client ID is empty.');
  if (!String(p.PTTOKENURL ?? '').trim()) messages.push('No explicit token endpoint; provider-specific behavior may apply.');
  if (p.PTSECTYPE === 'C' && (p.PTREFRESH !== '1' || p.PTSCOPE !== 'N')) messages.push('Email Client Only expects Refresh Token enabled and scope parameter None.');
  if (p.PTAUTHFLOW === '2L' && !String(p.PTIB_EXTNAME ?? '').trim()) messages.push('Assertion grant has no certificate alias.');
  return messages;
}

export const OAUTH_EDIT_FIELDS = ['PTCLIENT_ID', 'PTISS', 'PTTOKENURL', 'PTSCOPE_URL'] as const;
export function oauthEditable(doc: SecurityDocument): boolean {
  return doc.kind === 'oauth' && doc.properties.PTAUTHSERVER === 'CU' && doc.properties.PTSECTYPE === 'CO' && doc.properties.PTAUTHFLOW === 'CC';
}
export function validateOAuthChanges(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected OAuth property changes.');
  const changes: Record<string, string> = {};
  for (const [key, input] of Object.entries(value)) {
    if (!(OAUTH_EDIT_FIELDS as readonly string[]).includes(key)) throw new Error('OAuth property is not calibrated for editing: ' + key);
    if (typeof input !== 'string' || !input.trim() || input.length > (key === 'PTCLIENT_ID' ? 100 : 254)) throw new Error('Invalid ' + key + '.');
    if (key === 'PTTOKENURL') { let url: URL; try { url = new URL(input); } catch { throw new Error('Token endpoint must be an HTTPS URL.'); } if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Token endpoint must be HTTPS without credentials or fragments.'); }
    changes[key] = input;
  }
  if (!Object.keys(changes).length) throw new Error('No OAuth properties supplied.');
  return changes;
}
