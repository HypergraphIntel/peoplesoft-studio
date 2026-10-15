/*
 * A Page and Field Configurator sequence's criteria (PS_EOCC_CONFIG_CRT): the
 * field values on the page that decide whether the sequence applies, as the
 * configurator's Criteria grid edits them. A row names a field (record, field,
 * page field id, the (sub)page it is on), an operator (EOCC_CRITERIA_SYM,
 * PSXLATITEM) and its value text (EOCC_VALUE_MATCH, and EOCC_VALUE_MATCH2 for
 * Between), in the field's format (Helper.GetDefaultText: numbers, YYYY-MM-DD
 * dates, HH:MM:SS times); an in-list value is comma separated, as Oracle's rows
 * are ("ASG,COM,DEM,..."). The table's key includes the operator, so changing
 * it replaces the row. Rows are compact (pfcWriter reads).
 */

export type Row = Record<string, unknown>;

export const CRITERIA_OPERATORS: Readonly<Record<string, { label: string; values: 0 | 1 | 2 | 'list' }>> = {
  A: { label: 'Equals', values: 1 }, F: { label: 'Not Equals', values: 1 },
  B: { label: 'Less Than', values: 1 }, C: { label: 'Greater Than', values: 1 },
  D: { label: 'Not Greater Than', values: 1 }, E: { label: 'Not Less Than', values: 1 },
  G: { label: 'Contains No Value', values: 0 }, H: { label: 'Contains Value', values: 0 },
  I: { label: 'Between', values: 2 }, J: { label: 'Not Between', values: 2 },
  K: { label: 'In List', values: 'list' }, O: { label: 'Not in List', values: 'list' },
  L: { label: 'Begins With', values: 1 }, M: { label: 'Contains', values: 1 }, N: { label: 'Does not Contain', values: 1 }
};

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const seqOf = (r: Row) => Number(r.EOCC_SEQUENCE_NBR);

/** The row's key within its sequence (PSKEYDEFN): record, field, page field id, operator. */
export const criterionKey = (r: Row) => [s(r.RECNAME), s(r.FIELDNAME), Number(r.PNLFLDID ?? 0), s(r.EOCC_CRITERIA_SYM)].join('|');

export function criteriaOf(criteria: readonly Row[], seq: Row): Row[] {
  return criteria.filter((r) => seqOf(r) === seqOf(seq) && s(r.FIELDNAME));
}

/** Problems with a criterion's value for the field's database type (PSDBFIELD.FIELDTYPE). */
export function checkCriterion(symbol: string, dbFieldType: number, value: string, value2 = ''): string[] {
  const op = CRITERIA_OPERATORS[symbol];
  if (!op) return [`Unknown operator ${symbol}.`];
  const out: string[] = [];
  const one = (v: string, what: string) => {
    if (!v.trim()) { out.push(`${what} is required for ${op.label}.`); return; }
    if ((dbFieldType === 2 || dbFieldType === 3) && !/^-?\d+(\.\d+)?$/.test(v.trim())) out.push(`${what} must be a number.`);
    if (dbFieldType === 4 && !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) out.push(`${what} must be a date, YYYY-MM-DD.`);
    if (dbFieldType === 5 && !/^\d{2}:\d{2}(:\d{2})?$/.test(v.trim())) out.push(`${what} must be a time, HH:MM:SS.`);
  };
  if (op.values === 1) one(value, 'A value');
  if (op.values === 2) { one(value, 'The first value'); one(value2, 'The second value'); }
  if (op.values === 'list') {
    const items = value.split(',').map((x) => x.trim());
    if (!items.some(Boolean)) out.push(`${op.label} needs at least one value (comma separated).`);
    else for (const item of items.filter(Boolean)) one(item, `"${item}"`);
  }
  return out;
}

/** The row with an operator and value set (values a no-value operator does not use are cleared). */
export function withCriterionValue(r: Row, symbol: string, value: string, value2 = ''): Row {
  const op = CRITERIA_OPERATORS[symbol];
  const list = op?.values === 'list' ? value.split(',').map((x) => x.trim()).filter(Boolean).join(',') : value.trim();
  return { ...r, EOCC_CRITERIA_SYM: symbol, EOCC_VALUE_MATCH: op?.values === 0 ? '' : list, EOCC_VALUE_MATCH2: op?.values === 2 ? value2.trim() : '' };
}

/** The criteria with the row added, or replacing the row it was (by key; pass the old key when the operator changed). */
export function withCriterion(criteria: readonly Row[], row: Row, replacing?: string): Row[] {
  const seq = seqOf(row);
  const key = replacing ?? criterionKey(row);
  const at = criteria.findIndex((r) => seqOf(r) === seq && criterionKey(r) === key);
  if (at < 0) return [...criteria, row];
  return criteria.map((r, i) => (i === at ? row : r));
}

export function withoutCriterion(criteria: readonly Row[], seq: Row, key: string): Row[] {
  return criteria.filter((r) => !(seqOf(r) === seqOf(seq) && criterionKey(r) === key));
}

/** "Action In List PRO, OCM, DTA". */
export function describeCriterion(r: Row): string {
  const op = CRITERIA_OPERATORS[s(r.EOCC_CRITERIA_SYM)];
  const field = s(r.LBLTEXT) || `${s(r.RECNAME)}.${s(r.FIELDNAME)}`;
  if (!op) return `${field} ${s(r.EOCC_CRITERIA_SYM)} ${s(r.EOCC_VALUE_MATCH)}`;
  if (op.values === 0) return `${field} ${op.label.toLowerCase()}`;
  if (op.values === 2) return `${field} ${op.label.toLowerCase()} ${s(r.EOCC_VALUE_MATCH)} and ${s(r.EOCC_VALUE_MATCH2)}`;
  const value = op.values === 'list' ? s(r.EOCC_VALUE_MATCH).split(',').join(', ') : s(r.EOCC_VALUE_MATCH);
  return `${field} ${op.label.toLowerCase()} ${value}`;
}
