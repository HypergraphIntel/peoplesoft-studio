/*
 * Editing a Page and Field Configurator sequence's field rows
 * (PS_EOCC_CONFIG_FLD) as the configurator's Fields grid does: what a row's
 * Standard settings are, setting them, and adding or removing a field.
 * Rows are by column name, compact as pfcWriter's reads give them (a value
 * equal to its default left out; blanks as ''). A sequence with no field keeps
 * one blank row, as the page leaves it [pfc02]; adding to it fills that row
 * (EOCC_CONFIG_WRK.EOCC_ADD_PB). The table's key is the sequence, record,
 * field, level and related-display control -- not the page field id -- so one
 * record field placed twice is one row.
 */

export type Row = Record<string, unknown>;

/** A field's Standard (STD) settings. */
export interface PfcFieldSettings {
  hidden: boolean;
  /** Display only (EOCC_DISABLED). */
  displayOnly: boolean;
  required: boolean;
  /** The label shown instead of the page's (EOCC_LBL_OVERRIDE with LBLTEXT). */
  label?: string;
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

export const isBlankFieldRow = (r: Row) => !s(r.RECNAME) && !s(r.FIELDNAME);
const inSequence = (r: Row, seq: number) => Number(r.EOCC_SEQUENCE_NBR ?? 1) === seq;

/** The row's key within its sequence: record, field, level, related-display control. */
export const fieldRowKey = (r: Row) => [s(r.RECNAME), s(r.FIELDNAME), Number(r.OCCURSLEVEL ?? 0), s(r.RECNAME1), s(r.FIELDNAME1)].join('|');

export function fieldSettingsOf(r: Row): PfcFieldSettings {
  return {
    // Compact rows leave out a default: EOCC_VISIBLE_FLAG Y, EOCC_IS_REQUIRED N, EOCC_DISABLED N.
    hidden: s(r.EOCC_VISIBLE_FLAG) === 'N',
    displayOnly: s(r.EOCC_DISABLED) === 'Y',
    required: s(r.EOCC_IS_REQUIRED) === 'Y',
    ...(s(r.EOCC_LBL_OVERRIDE) === 'Y' ? { label: s(r.LBLTEXT) } : {})
  };
}

/** Conflicts the settings would make (a hidden field cannot be required or display only to the user). */
export function checkFieldSettings(x: PfcFieldSettings): string[] {
  const out: string[] = [];
  if (x.hidden && x.required) out.push('A hidden field cannot be required: the user could not enter it.');
  if (x.hidden && x.displayOnly) out.push('A hidden field is not shown; display only has no effect.');
  if (x.label !== undefined && !x.label.trim()) out.push('A replacement label cannot be blank.');
  if (x.label !== undefined && x.label.length > 100) out.push('A label is at most 100 characters.');
  return out;
}

/** The row with the settings applied; pageLabel is the page's own label, restored when the replacement is taken away. */
export function withFieldSettings(r: Row, x: PfcFieldSettings, pageLabel?: string): Row {
  const out: Row = { ...r, EOCC_VISIBLE_FLAG: x.hidden ? 'N' : 'Y', EOCC_DISABLED: x.displayOnly ? 'Y' : 'N', EOCC_IS_REQUIRED: x.required ? 'Y' : 'N' };
  if (x.label !== undefined) { out.EOCC_LBL_OVERRIDE = 'Y'; out.LBLTEXT = x.label.trim(); }
  else if (s(r.EOCC_LBL_OVERRIDE) === 'Y') { out.EOCC_LBL_OVERRIDE = 'N'; if (pageLabel !== undefined) out.LBLTEXT = pageLabel; }
  return out;
}

export function describeFieldSettings(x: PfcFieldSettings): string {
  const parts = [x.hidden ? 'hidden' : '', x.displayOnly ? 'display only' : '', x.required ? 'required' : '', x.label !== undefined ? `labelled "${x.label}"` : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : 'no change';
}

/** The fields with the row added to (or replacing the same field in) its sequence; a sequence's blank row is filled first. */
export function withFieldRow(fields: readonly Row[], row: Row): Row[] {
  const seq = Number(row.EOCC_SEQUENCE_NBR);
  const key = fieldRowKey(row);
  const same = fields.findIndex((r) => inSequence(r, seq) && !isBlankFieldRow(r) && fieldRowKey(r) === key);
  if (same >= 0) return fields.map((r, i) => (i === same ? row : r));
  const blank = fields.findIndex((r) => inSequence(r, seq) && isBlankFieldRow(r));
  if (blank >= 0) return fields.map((r, i) => (i === blank ? row : r));
  return [...fields, row];
}

/** The fields without that field in the sequence; a sequence left with none keeps a blank row, as the page does. */
export function withoutFieldRow(fields: readonly Row[], sequence: Row, key: string): Row[] {
  const seq = Number(sequence.EOCC_SEQUENCE_NBR);
  const out = fields.filter((r) => !(inSequence(r, seq) && !isBlankFieldRow(r) && fieldRowKey(r) === key));
  if (!out.some((r) => inSequence(r, seq))) out.push({ SEQUENCE_NBR: Number(sequence.SEQUENCE_NBR), EOCC_SEQUENCE_NBR: seq });
  return out;
}

/** The mask profile a masked field row uses; undefined when the row is not masked. */
export function maskOf(r: Row): string | undefined {
  return s(r.EOCC_MASK_FLAG) === 'Y' ? s(r.EOCC_MASK_ID) || undefined : undefined;
}

/**
 * The profile the configurator's Add gives a field (EOCC_MASK_WRK.EOCC_ADD_PB): its field group's, else the default
 * profile (DEFAULT_FLG Y).
 */
export function defaultMaskFor(field: string, profiles: ReadonlyArray<{ id: string; isDefault: boolean }>, fieldDefaults: Readonly<Record<string, string>>): string | undefined {
  return fieldDefaults[field] || profiles.find((p) => p.isDefault)?.id;
}

/** The row masked with the profile (EOCC_MASK_FLAG Y, the profile in EOCC_MASK_ID, EOCC_PROF_STATUS D as Oracle's rows have it), or unmasked. */
export function withMask(r: Row, maskId: string | undefined): Row {
  return maskId ? { ...r, EOCC_MASK_FLAG: 'Y', EOCC_MASK_ID: maskId, EOCC_PROF_STATUS: 'D' } : { ...r, EOCC_MASK_FLAG: 'N' };
}
