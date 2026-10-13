import { typeLabel, type DefinitionType } from '../model/definitions.js';
import { FIELD_TYPE_LABELS, type FieldType } from '../model/record.js';
import type { FieldDefinition } from '../model/fieldDefinition.js';

/*
 * The Markdown shown when hovering a PeopleCode reference that resolves to a
 * definition in the connection. Kept free of VS Code so it can be tested:
 * a field shows its type, size and label; any other definition shows its type,
 * description and when it was last changed.
 */

/** Hover for a field: its PeopleSoft type, length (with decimals when it has them), and default label. */
export function fieldHoverMarkdown(f: FieldDefinition): string {
  const type = FIELD_TYPE_LABELS[f.type as FieldType] ?? `Type ${f.type}`;
  const size = f.length ? `, length ${f.length}${f.decimalPositions ? ` (${f.decimalPositions} decimal${f.decimalPositions === 1 ? '' : 's'})` : ''}` : '';
  const label = f.labels.find((l) => l.isDefault) ?? f.labels[0];
  let md = `**${f.name}** — ${type}${size}`;
  if (label?.longName) md += `\n\n${label.longName}`;
  if (f.description) md += `\n\n${f.description}`;
  return md;
}

export interface DefinitionHover {
  displayName: string;
  type: DefinitionType;
  description?: string;
  /** Preformatted date text, e.g. 2026-10-13. */
  lastUpdated?: string;
  lastUpdatedBy?: string;
}

/** Hover for any definition: its name, type label, description, and who last changed it. */
export function definitionHoverMarkdown(d: DefinitionHover): string {
  let md = `**${d.displayName}** — ${typeLabel(d.type)}`;
  if (d.description) md += `\n\n${d.description}`;
  if (d.lastUpdated) md += `\n\n_Last updated ${d.lastUpdated}${d.lastUpdatedBy ? ` by ${d.lastUpdatedBy}` : ''}_`;
  return md;
}
