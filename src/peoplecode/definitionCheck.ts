import { DefinitionType } from '../model/definitions.js';
import type { DefinitionReference, PeopleCodeProblem } from './validate.js';

/*
 * Definition references (Record.X, Page.X, SQL.X ...) the connection does not
 * have. Native probes on HRDMO 8.62.09 (Validate Syntax, 2026-10-20) found App
 * Designer compiles these without checking: missing Record, Page, Component,
 * Field, Scroll, SQL, HTML, BarName and ItemName references gave no message.
 * Only Image.X, and a menu passed to IsMenuItemAuthorized, drew App Designer's
 * warning "No definition of IMAGE.X found. (2,68)". So a missing definition is
 * an Information note, and a warning only where App Designer warns.
 */

/** The definition a `Keyword.NAME` reference names; keywords without a searchable type (BarName, ItemName ...) are not checked. */
export const DEFINITION_KEYWORD_TYPES: ReadonlyMap<string, { type: DefinitionType; label: string }> = new Map([
  ['RECORD', { type: DefinitionType.Record, label: 'record' }],
  ['SCROLL', { type: DefinitionType.Record, label: 'record' }],
  ['FIELD', { type: DefinitionType.Field, label: 'field' }],
  ['PAGE', { type: DefinitionType.Page, label: 'page' }],
  ['PANEL', { type: DefinitionType.Page, label: 'page' }],
  ['COMPONENT', { type: DefinitionType.Component, label: 'component' }],
  ['PANELGROUP', { type: DefinitionType.Component, label: 'component' }],
  ['MENUNAME', { type: DefinitionType.Menu, label: 'menu' }],
  ['SQL', { type: DefinitionType.SqlDefinition, label: 'SQL definition' }],
  ['IMAGE', { type: DefinitionType.Image, label: 'image' }],
  ['HTML', { type: DefinitionType.HtmlDefinition, label: 'HTML definition' }],
  ['STYLESHEET', { type: DefinitionType.StyleSheet, label: 'style sheet' }],
  ['COMPINTFC', { type: DefinitionType.ComponentInterface, label: 'component interface' }],
  ['FILELAYOUT', { type: DefinitionType.FileLayout, label: 'file layout' }],
  ['MESSAGE', { type: DefinitionType.IbMessage, label: 'message' }],
  ['OPERATION', { type: DefinitionType.IbServiceOperation, label: 'service operation' }],
  ['NODE', { type: DefinitionType.MessageNode, label: 'node' }],
  ['URL', { type: DefinitionType.UrlDefinition, label: 'URL definition' }]
]);

interface Searchable {
  search(query: { type: DefinitionType; namePattern: string; limit: number }): Promise<ReadonlyArray<{ key: { parts: readonly string[] } }>>;
}

/**
 * Whether `name` exists as a `type` definition: undefined when that cannot be
 * told (the type is not searchable, the search failed, or it was truncated --
 * names match with LIKE, so only an exact name in a complete result counts).
 */
export async function definitionExists(provider: Searchable, type: DefinitionType, name: string): Promise<boolean | undefined> {
  const limit = 200;
  try {
    const found = await provider.search({ type, namePattern: name, limit });
    if (found.some((f) => f.key.parts[0]?.toUpperCase() === name.toUpperCase())) return true;
    return found.length < limit ? false : undefined;
  } catch {
    return undefined;
  }
}

/** The program's definition references the connection lacks, as problems. */
export async function missingDefinitionProblems(references: readonly DefinitionReference[],
  exists: (type: DefinitionType, name: string) => Promise<boolean | undefined>): Promise<PeopleCodeProblem[]> {
  const problems: PeopleCodeProblem[] = [];
  for (const d of references) {
    const target = DEFINITION_KEYWORD_TYPES.get(d.keyword);
    if (!target || (await exists(target.type, d.name)) !== false) continue;
    problems.push(d.keyword === 'IMAGE'
      ? { offset: d.offset, length: d.length, code: 'definition-not-found', message: `No definition of IMAGE.${d.name} found. (2,68)` }
      : { offset: d.offset, length: d.length, code: 'definition-not-found', severity: 'info',
        message: `No ${target.label} ${d.name} in this database. Application Designer compiles the reference without checking it.` });
  }
  return problems;
}
