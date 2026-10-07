import { DefinitionKey, DefinitionType } from '../model/definitions.js';
import { hasProperties } from '../model/properties.js';

/**
 * A definition node's contextValue: "definition", then ".properties" when it
 * has a Properties panel, then ".recordField" for a field listed under its
 * record (key FIELD, RECORD), which has Record Field PeopleCode, or ".record"
 * for a record.
 * package.json's menus match on these parts.
 */
export function definitionContextValue(key: DefinitionKey): string {
  return 'definition' +
    (hasProperties(key.type) ? '.properties' : '') +
    (key.type === DefinitionType.Field && key.parts.length >= 2 ? '.recordField' : '') +
    (key.type === DefinitionType.Record ? '.record' : '');
}
