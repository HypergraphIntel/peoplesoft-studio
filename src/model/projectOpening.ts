import { DefinitionKey, displayName, typeLabel } from './definitions.js';

/** Only the provider's explicit missing-definition errors, never database/permission failures. */
export function isMissingProjectDefinition(error: unknown): boolean {
  return error instanceof Error && error.name === 'ProviderError' && (
    /^No .+ named .+\.$/.test(error.message) ||
    /^No PeopleCode program found for .+\.$/.test(error.message) ||
    /^.+ has no section .+\.$/.test(error.message) ||
    error.message === 'Integration Broker definition not found.'
  );
}

/** A plural type label in the singular: Queries -> Query, Application Classes -> Application Class, Pages -> Page. */
export function singularLabel(label: string): string {
  if (/ies$/.test(label)) return label.replace(/ies$/, 'y');
  if (/(ss|x|ch|sh)es$/.test(label)) return label.replace(/es$/, '');
  if (/s$/.test(label) && !/ss$/.test(label)) return label.replace(/s$/, '');
  return label;
}

export function missingProjectDefinitionMessage(key: DefinitionKey, connection: string, project: string): string {
  return `${singularLabel(typeLabel(key.type))} ${displayName(key)} no longer exists in ${connection}. ` +
    `It is still listed in project ${project}. You can remove it from the project in Application Designer.`;
}
