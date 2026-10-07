import { FieldType } from './record.js';

/*
 * A field definition as App Designer's Field dialog shows it: type and
 * length, its labels, its format. Read-only. Free of the `vscode` module.
 */

export interface FieldLabel {
  id: string;
  longName: string;
  shortName: string;
  /** Absent when the source does not say (a project export may not). */
  isDefault?: boolean;
}

export interface FieldDefinition {
  name: string;
  type: FieldType;
  length: number;
  decimalPositions: number;
  labels: FieldLabel[];
  /** PSDBFIELD.FORMAT; absent when the source does not carry it. */
  format?: number;
  formatFamily?: string;
  displayName?: string;
  defaultCenturyYear?: number;
  notUsed?: boolean;
  /** PSDBFIELD.AUXFLAGMASK, shown as stored: which bit is which is not established. */
  auxFlagMask?: number;
  version?: number;
  lastUpdated?: string;
  lastUpdatedBy?: string;
}

/**
 * Character format types, only those established on HRDMO: 0 is what App
 * Designer shows as Uppercase (ZZ_PCODE_LAB_C02), 1 Name (NAME), 6 Mixed
 * Case (DESCR), 14 Custom (the only format whose fields carry a format
 * family, e.g. PHONE / POSTAL). Other codes are shown as stored.
 */
export const CHARACTER_FORMAT_LABELS: Readonly<Record<number, string>> = {
  0: 'Uppercase',
  1: 'Name',
  6: 'Mixed Case',
  14: 'Custom'
};

export function formatTypeLabel(format: number | undefined): string {
  if (format === undefined) return '';
  return CHARACTER_FORMAT_LABELS[format] ?? `Format ${format} (stored value)`;
}
