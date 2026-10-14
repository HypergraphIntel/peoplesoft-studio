import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { serviceKind, serviceRole, type Row, type ServiceKind } from './ibDefinitions.js';

export const ibKind = z.enum(['message', 'document', 'service', 'operation', 'node', 'routing']);
export type IbKind = z.infer<typeof ibKind>;
export const IB_TITLES: Record<IbKind, string> = {
  message: 'Message Definitions', document: 'Document Definitions', service: 'Services',
  operation: 'Service Operations', node: 'Nodes', routing: 'Routings'
};
export interface IbSummary { key: string[]; name: string; description: string; serviceKind?: ServiceKind; restRole?: 'consumer' | 'provider'; }
export interface IbDocument {
  kind: IbKind;
  key: string[];
  properties: Row;
  sections: Record<string, Row[]>;
  serviceKind?: ServiceKind;
  restRole?: 'consumer' | 'provider';
  token: string;
}
export interface IbDiagnostic { severity: 'error' | 'warning'; path: string; message: string; }
export function ibIdentity(kind: IbKind, key: readonly string[]): string {
  const count = kind === 'document' ? 3 : kind === 'routing' ? 2 : 1;
  if (key.length !== count || key.some(v => !v.trim() || v.length > 100 || /[\x00-\x1f]/.test(v))) throw new Error(`${kind} requires ${count} nonempty key part(s).`);
  if (kind === 'routing' && (!/^\d{4}-\d{2}-\d{2}$/.test(key[1]) || new Date(key[1]).toISOString().slice(0, 10) !== key[1])) throw new Error('Routing effective date must be a valid YYYY-MM-DD date.');
  return JSON.stringify([kind, ...key]);
}
export function ibServiceClassification(value: unknown) {
  return { serviceKind: serviceKind(value), ...(serviceRole(value) ? { restRole: serviceRole(value) } : {}) };
}
export function ibDocument(kind: IbKind, key: string[], properties: Row, sections: Record<string, Row[]>): IbDocument {
  ibIdentity(kind, key);
  const service = kind === 'service' ? properties : sections.service?.[0];
  const classification = kind === 'service' || kind === 'operation' || kind === 'routing' ? ibServiceClassification(service?.IB_REST_SERVICE) : {};
  const data = { kind, key, properties, sections, ...classification };
  return { ...data, token: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
}
const str = (v: unknown) => String(v ?? '').trim();
/** Structural checks only. The reader adds database existence checks separately. */
export function validateIbDocument(doc: IbDocument): IbDiagnostic[] {
  const diagnostics: IbDiagnostic[] = [];
  const error = (path: string, message: string) => diagnostics.push({ severity: 'error', path, message });
  const warning = (path: string, message: string) => diagnostics.push({ severity: 'warning', path, message });
  const p = doc.properties;
  if (['service', 'operation', 'routing'].includes(doc.kind) && doc.serviceKind === 'unknown') warning('serviceKind', 'The owning service is missing or its kind flag is unsupported.');
  if (doc.kind === 'operation') {
    const versions = doc.sections.versions ?? [];
    if (str(p.DEFAULTVER) && !versions.some(v => str(v.VERSIONNAME) === str(p.DEFAULTVER))) error('DEFAULTVER', 'Default operation version is missing.');
    const service = doc.sections.service?.[0];
    if (!service) error('IB_SERVICENAME', 'Owning service is missing.');
    else if (str(service.IB_REST_SERVICE) !== str(p.IB_REST_SERVICE)) error('IB_REST_SERVICE', 'Operation and owning service have different service-kind flags.');
    if (doc.serviceKind === 'rest') {
      if (!['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH'].includes(str(p.IB_RESTMETHOD))) error('IB_RESTMETHOD', 'REST operation requires a supported HTTP method.');
      if (str(p.RTNGTYPE) !== 'S') warning('RTNGTYPE', 'REST operation is not stored as synchronous.');
    } else if (doc.serviceKind === 'standard' && str(p.IB_RESTMETHOD)) warning('IB_RESTMETHOD', 'Standard service operation has a stored HTTP method; it does not make the service REST.');
    for (const [i, parameter] of (doc.sections.parameters ?? []).entries()) {
      if (!versions.some(v => str(v.VERSIONNAME) === str(parameter.VERSIONNAME))) error(`parameters[${i}].VERSIONNAME`, 'Parameter belongs to a missing operation version.');
    }
    const notify = (doc.sections.handlers ?? []).filter(h => str(h.HANDLERID) === 'NOTF').map(h => Number(h.SEQNO));
    if (notify.some(n => n === 0) && notify.some(n => n !== 0)) error('handlers.SEQNO', 'Notify handler sequences must be either all blank (0) or all nonblank.');
    if (notify.every(n => n !== 0) && new Set(notify).size !== notify.length) error('handlers.SEQNO', 'Nonblank notify handler sequences must be unique.');
  }
  if (doc.kind === 'message' && str(p.DEFAULTVER) && !(doc.sections.versions ?? []).some(v => str(v.APMSGVER) === str(p.DEFAULTVER))) error('DEFAULTVER', 'Default message version is missing.');
  return diagnostics;
}
