import { buildComponentStructure, type StructureField } from './componentStructure.js';
import type { CiRecordField, CiSource } from './ciDocument.js';

/**
 * What App Designer reads from a component to make or edit a Component
 * Interface on it, as plain data: the component's search records and
 * actions, its pages (and, for a Fluid component, the system side and header
 * pages after them: ci04), every page's PSPNLFIELD rows, and the records'
 * types and fields. DatabaseProvider.readCiSourceData reads it; the tests
 * keep it as fixtures (results/ciNN/ci-source.json).
 */
export interface CiSourceData {
  component: string;
  market: string;
  searchRecord: string;
  addSearchRecord: string;
  actions: number;
  pages: string[];
  systemPages: string[];
  pageFields: Record<string, StructureField[]>;
  recordTypes: Record<string, number>;
  recordFields: Record<string, CiRecordField[]>;
  /** Record Properties' System ID and Row Timestamp fields (' ' when none), which a synchronizable interface's records need. */
  recordSyncFields?: Record<string, [string, string]>;
}

export function ciSourceFromData(d: CiSourceData): CiSource {
  const structure = buildComponentStructure([...d.pages, ...d.systemPages], d.searchRecord, (p) => d.pageFields[p],
    (r) => d.recordTypes[r] ?? -1, new Set(d.systemPages));
  return {
    component: d.component, market: d.market, searchRecord: d.searchRecord, addSearchRecord: d.addSearchRecord, actions: d.actions, structure,
    recordType: (r) => d.recordTypes[r] ?? -1, recordFields: (r) => d.recordFields[r],
    ...(d.recordSyncFields ? { recordSyncFields: (r: string) => d.recordSyncFields![r] } : {})
  };
}
