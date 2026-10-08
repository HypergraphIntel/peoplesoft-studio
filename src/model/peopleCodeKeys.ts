import { DefinitionType, type DefinitionKey } from './definitions.js';
import { unpackPeopleCodeKey } from './appEngine.js';

/**
 * A PeopleCode definition's PSPCMPROG key parts. PSPROJECTITEM holds at most
 * four values, so two kinds of PeopleCode pack parts into one there (HRDMO's
 * project items):
 *
 *   App Engine (43): section (8), market (3), platform (9) and effective
 *     date in the second value (model/appEngine.ts unpackPeopleCodeKey)
 *   Component record field (48): field (18) and event in the fourth --
 *     "SAVE_PB           FieldChange"
 *
 * PSPROJECTITEM names an Application Class by its package path and class
 * alone -- a class has one program -- while PSPCMPROG keys that program with
 * a trailing 'OnExecute', the event slot record and component PeopleCode use
 * (confirmed on OU_JET_PACK.Layout.ComponentRegistry).
 */
export function pcmProgKeyParts(key: DefinitionKey): readonly string[] {
  switch (key.type) {
    case DefinitionType.ApplicationClassPeopleCode:
      return key.parts.at(-1) === 'OnExecute' ? key.parts : [...key.parts, 'OnExecute'];
    case DefinitionType.AppEnginePeopleCode:
      return unpackPeopleCodeKey(key.parts);
    case DefinitionType.ComponentRecordFieldPeopleCode:
      return key.parts.length === 4 && key.parts[3].length > 18
        ? [...key.parts.slice(0, 3), key.parts[3].slice(0, 18).trim(), key.parts[3].slice(18).trim()]
        : key.parts;
    default:
      return key.parts;
  }
}
