/**
 * The App Designer project export format.
 *
 * An export is not a PeopleTools table dump. It is a serialization of App
 * Designer's own C++ object model, and looks like this:
 *
 * ```xml
 * <instance class="PJM">
 *   <rowset name="PjmDefn" size="2872" count="1">
 *     <row>
 *       <szProjectName>OU_CUSTOM_LANDINGPAGE_JN</szProjectName>
 *       <lpPit> POINTER
 *         <rowset name="PjmPit" count="73">
 *           <row><eObjectType>8</eObjectType><szObjectValue_0>WEBLIB_OU_LP</szObjectValue_0>...</row>
 * ```
 *
 * Field names carry a Hungarian prefix describing their C++ storage: `sz` for
 * string, `n`/`l` for integers, `e` for enum, `b` for boolean, `f` for flags,
 * `lp` for pointer, `atm` for atom. A `lp*` element holds the literal text
 * `POINTER` followed by the nested rowset it points at, or the text
 * `custom field` when the payload is written elsewhere in the file.
 *
 * The file is a sequence of `<instance>` blocks: one `PJM` holding the project
 * manifest, then one per exported definition, identified by a class code:
 *
 *   PJM  project      RDM  record       FIELD field      PCM  PeopleCode
 *   PDM  page         CRM  component    MDM   menu       APM  app package
 *   PGM  program
 *
 * A `PCM` instance carries its program as plain source in a `peoplecode_text`
 * element beside the rowset — not the tokenized form the database stores. That
 * is what makes a project export the accurate source for PeopleCode.
 */

export type InstanceClass =
  | 'PJM' | 'RDM' | 'FIELD' | 'PCM' | 'PDM' | 'CRM' | 'MDM' | 'APM' | 'PGM';

export interface ExportRow {
  /** Scalar fields of the row, keyed by their element name including prefix. */
  readonly fields: ReadonlyMap<string, string>;
  /** Nested rowsets reached through `lp*` pointer elements, keyed by rowset name. */
  readonly rowsets: ReadonlyMap<string, ExportRow[]>;
}

export interface ExportInstance {
  readonly cls: string;
  readonly rowsets: ReadonlyMap<string, ExportRow[]>;
  /** Plain PeopleCode source, present on PCM instances. */
  readonly peopleCodeText?: string;
}

/** Reads `szObjectValue_0..n` from a row, in index order, trailing blanks dropped. */
export function objectValues(row: ExportRow, limit = 7): string[] {
  const parts: string[] = [];
  for (let i = 0; i < limit; i++) {
    parts.push((row.fields.get(`szObjectValue_${i}`) ?? '').trim());
  }
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

export function intField(row: ExportRow, name: string, fallback = 0): number {
  const raw = row.fields.get(name);
  if (raw === undefined) return fallback;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : fallback;
}

export function strField(row: ExportRow, name: string): string {
  return (row.fields.get(name) ?? '').trim();
}

export function firstRow(
  rowsets: ReadonlyMap<string, ExportRow[]>, name: string
): ExportRow | undefined {
  return rowsets.get(name)?.[0];
}

/** Every row of `name`, searched through nested rowsets as well as the top level. */
export function allRows(
  rowsets: ReadonlyMap<string, ExportRow[]>, name: string
): ExportRow[] {
  const out: ExportRow[] = [];
  const walk = (sets: ReadonlyMap<string, ExportRow[]>) => {
    for (const [setName, rows] of sets) {
      if (setName === name) out.push(...rows);
      for (const row of rows) walk(row.rowsets);
    }
  };
  walk(rowsets);
  return out;
}
