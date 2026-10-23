import * as z from 'zod/v4';
import { DefinitionType, makeKey, type DefinitionKey } from '../model/definitions.js';
import type { ProcessView } from '../model/processDefinition.js';
import { PROCESS_FIELDS, processEdit, processValue } from '../model/processEdit.js';
import { NEW_PROCESS_DEFAULTS } from './processWriter.js';

/**
 * A process definition as a migration carries it: what the PRCSDEFN component's Process Definition and Options pages
 * edit (PROCESS_FIELDS), its components (PS_PRCSDEFNPNL) and process groups (PS_PRCSDEFNGRP). The target creates it with
 * the Add-mode row and saves those values (processWriter.ts), so every other PS_PRCSDEFN column must still hold its
 * Add-mode default in the source, and the other PRCSDEFN child tables (notification, messages, content distribution,
 * URL links, page transfer, conditions, metadata, translations) must be empty: either refuses.
 */
export interface ProcessMigrationData {
  name: string;
  processType: string;
  properties: Record<string, string>;
  components: string[];
  groups: string[];
}

export const processMigrationSchema = z.object({
  name: z.string().regex(/^[A-Z0-9_#@$]{1,12}$/), processType: z.string().min(1).max(30),
  properties: z.record(z.string(), z.string()), components: z.array(z.string().min(1).max(18)), groups: z.array(z.string().min(1).max(30)).min(1)
}).strict();

/** The PRCSDEFN child tables a migration does not carry (PNL and GRP are carried). */
export const UNCARRIED_PROCESS_TABLES = ['PS_PRCSDEFNCNTDIST', 'PS_PRCSDEFNCOND', 'PS_PRCSDEFNLANG', 'PS_PRCSDEFNMESSAGE', 'PS_PRCSDEFNMETA',
  'PS_PRCSDEFNNOTIFY', 'PS_PRCSDEFNURL', 'PS_PRCSDEFNURLKEY', 'PS_PRCSDEFNURL_LNG', 'PS_PRCSDEFNXFER'] as const;

/** Key, stamp and the columns createProcess sets from the request or the program. */
const SET_BY_CREATE = new Set(['PRCSTYPE', 'PRCSNAME', 'VERSION', 'LASTUPDOPRID', 'LASTUPDDTTM', 'LASTUPD', 'PRCSCATEGORY']);

/** The portable payload of a stored definition; `childRows` counts its rows in UNCARRIED_PROCESS_TABLES. */
export function portableProcess(view: ProcessView, childRows: Record<string, number>): ProcessMigrationData {
  const name = processValue(view.process.PRCSNAME), processType = processValue(view.process.PRCSTYPE);
  const carried = Object.entries(childRows).filter(([, n]) => n > 0).map(([table]) => table);
  if (carried.length) throw new Error(`${name}: rows in ${carried.join(', ')} are not migrated.`);
  const modeled = new Set(PROCESS_FIELDS.map(f => f.name));
  for (const [column, value] of Object.entries(view.process)) {
    if (modeled.has(column) || SET_BY_CREATE.has(column)) continue;
    const fallback = column in NEW_PROCESS_DEFAULTS ? NEW_PROCESS_DEFAULTS[column] : typeof value === 'number' ? 0 : '';
    if (String(value ?? '').trim() !== String(fallback).trim()) throw new Error(`${name}: ${column} is not carried by migration and differs from its default.`);
  }
  return { name, processType, ...processEdit(view) };
}

/** What must exist first: the Application Engine program it runs and the components it lists (GBL, as most are). */
export function processRequirements(data: ProcessMigrationData): DefinitionKey[] {
  return [...(data.processType === 'Application Engine' ? [makeKey(DefinitionType.AppEngineProgram, data.name)] : []),
    ...data.components.map(c => makeKey(DefinitionType.Component, c, 'GBL'))];
}
