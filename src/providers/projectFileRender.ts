import { ExportInstance, allRows, findScalar, firstRow, intField, strField } from './projectFileFormat.js';
import { FIELD_TYPE_LABELS, FieldType } from '../model/record.js';

/**
 * Read-only summaries for the definition types that have no editor yet.
 *
 * These render what the export actually contains, in the vocabulary App
 * Designer uses. Where a stored value's meaning is not established — the many
 * numeric flag words on a page field, for instance — the raw value is shown
 * rather than an invented interpretation, so nothing here is more confident
 * than the evidence behind it.
 */

export function renderField(instance: ExportInstance): string {
  const defn = firstRow(instance.rowsets, 'Field');
  if (!defn) return '# Field definition not carried by this export.';

  const type = intField(defn, 'eFieldType') as FieldType;
  const length = intField(defn, 'nLength');
  const decimals = intField(defn, 'nDecimalPos');

  const out = [
    `Field        ${strField(defn, 'szFieldName')}`,
    `Type         ${FIELD_TYPE_LABELS[type] ?? `Unknown (${type})`}`,
    `Length       ${decimals > 0 ? `${length}.${decimals}` : length}`,
    `Version      ${intField(defn, 'lVersion')}`,
    `Last updated ${strField(defn, 'szLastUpdDttm')} by ${strField(defn, 'szLastUpdOprId')}`
  ];

  const labels = allRows(instance.rowsets, 'DBFldLabel');
  if (labels.length > 0) {
    out.push('', `Labels (${labels.length})`);
    for (const l of labels) {
      out.push(`  ${strField(l, 'atmLabelID').padEnd(20)} ` +
        `${strField(l, 'atmLongName')}` +
        (strField(l, 'atmShortName') ? `  [short: ${strField(l, 'atmShortName')}]` : ''));
    }
  }
  return out.join('\n') + '\n';
}

export function renderComponent(instance: ExportInstance): string {
  const defn = firstRow(instance.rowsets, 'PgmDefn');
  const out = [
    `Component     ${findScalar(instance, 'szPnlGrpName')}`,
    `Search record ${findScalar(instance, 'szSearchRecName') || '(none)'}`,
    `Add search    ${findScalar(instance, 'szAddSearchRecName') || '(none)'}`
  ];
  if (defn) {
    out.push(
      `Version       ${intField(defn, 'lVersion')}`,
      `Deferred      ${intField(defn, 'bDeferProcMode') ? 'yes' : 'no'}`,
      `Navigation    ${intField(defn, 'bInclNavigation') ? 'included' : 'excluded'}`);
  }

  const pages = allRows(instance.rowsets, 'PnlMenuItem');
  out.push('', `Pages (${pages.length})`);
  for (const p of pages) {
    out.push(`  ${strField(p, 'szPnlName').padEnd(24)} ${strField(p, 'szItemLabel')}` +
      (intField(p, 'bHidden') ? '  [hidden]' : ''));
  }
  return out.join('\n') + '\n';
}

export function renderMenu(instance: ExportInstance): string {
  const defn = firstRow(instance.rowsets, 'MdmDefn');
  const out = [`Menu     ${findScalar(instance, 'szMenuName')}`];
  if (defn) out.push(`Version  ${intField(defn, 'lVersion')}`);

  const items = allRows(instance.rowsets, 'MdmItem');
  out.push('', `Items (${items.length})`);
  for (const i of items) {
    const bar = strField(i, 'szBarName');
    const label = strField(i, 'szItemLabel') || strField(i, 'szItemName');
    out.push(`  ${bar.padEnd(12)} ${label.padEnd(30)} -> ${strField(i, 'szPnlGrpName')} ` +
      `(${strField(i, 'szMarket') || 'GBL'})`);
  }
  return out.join('\n') + '\n';
}

export function renderPage(instance: ExportInstance): string {
  const defn = firstRow(instance.rowsets, 'PdmDefn');
  const out = [`Page     ${findScalar(instance, 'szPnlName')}`];
  if (defn) {
    out.push(
      `Type     ${intField(defn, 'ePnlType')}`,
      `Version  ${intField(defn, 'lVersion')}`,
      `Fields   ${intField(defn, 'nFieldCount')}`,
      `Size     ${intField(defn, 'nGridHorz')} x ${intField(defn, 'nGridVert')}`);
  }

  // The page field rows carry layout rectangles and a large number of flag
  // words whose meanings are not yet established; only the identifiers below
  // are listed, because those are unambiguous.
  const fields = allRows(instance.rowsets, 'PdmPnlFldExt');
  if (fields.length > 0) {
    out.push('', `Page fields (${fields.length})`, '',
      '  Field id                        Parent');
    for (const f of fields) {
      const id = strField(f, 'atmPagePnlFldId');
      if (!id) continue;
      out.push(`  ${id.padEnd(32)}${strField(f, 'atmParentPnlFldId')}`);
    }
  }
  out.push('', '// Page layout is not rendered yet. See docs/ROADMAP.md.');
  return out.join('\n') + '\n';
}

export function renderApplicationPackage(instance: ExportInstance): string {
  const defn = firstRow(instance.rowsets, 'ApmDefn');
  const out = [
    `Package      ${strField(defn ?? emptyRow(), 'szPackageRoot')}`,
    `Package id   ${strField(defn ?? emptyRow(), 'szPackageId')}`,
    `Path         ${strField(defn ?? emptyRow(), 'szQualifyPath')}`,
    `Level        ${intField(defn ?? emptyRow(), 'lPackageLevel')}`
  ];

  const classes = allRows(instance.rowsets, 'ApmClassDefn');
  out.push('', `Classes (${classes.length})`);
  for (const c of classes) out.push(`  ${strField(c, 'szClassId')}`);
  return out.join('\n') + '\n';
}

function emptyRow() {
  return { fields: new Map<string, string>(), rowsets: new Map() };
}
