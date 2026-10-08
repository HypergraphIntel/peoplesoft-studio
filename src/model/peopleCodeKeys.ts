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

/**
 * PSPCMPROG's OBJECTIDs for each kind of PeopleCode, in key order -- every
 * program on HRDMO has one of these shapes:
 *
 *   1 2 12                  record, field, event (48,404)
 *   10 39 1 2 12            component, market, record, field, event (22,777)
 *   66 77 39 20 21 78 12    App Engine program, section, market, platform, effective date, step, event (12,675)
 *   9 12                    page, event (6,749)
 *   10 39 1 12              component, market, record, event (6,219)
 *   10 39 12                component, market, event (5,586)
 *   104 [105 [106]] 107 12  package, subpackages, class, OnExecute (12,218)
 *   3 4 5 12                menu, bar, item, event (8)
 *
 * A key's parts are the values in this order (an Application Class's without
 * its trailing OnExecute, as PSPROJECTITEM names it).
 */
export const PEOPLECODE_OBJECTIDS: Readonly<Partial<Record<DefinitionType, readonly number[]>>> = {
  [DefinitionType.RecordPeopleCode]: [1, 2, 12],
  [DefinitionType.ComponentRecordFieldPeopleCode]: [10, 39, 1, 2, 12],
  [DefinitionType.AppEnginePeopleCode]: [66, 77, 39, 20, 21, 78, 12],
  [DefinitionType.PagePeopleCode]: [9, 12],
  [DefinitionType.ComponentRecordPeopleCode]: [10, 39, 1, 12],
  [DefinitionType.ComponentPeopleCode]: [10, 39, 12],
  [DefinitionType.MenuPeopleCode]: [3, 4, 5, 12]
};

/** The OBJECTID1 of every Application Class program (its root package). */
export const APPLICATION_CLASS_OBJECTID = 104;

/** The PeopleCode type a PSPCMPROG / PSPCMNAME key's OBJECTIDs (zeros dropped) belong to. */
export function peopleCodeTypeOf(ids: readonly number[]): DefinitionType | undefined {
  if (ids[0] === APPLICATION_CLASS_OBJECTID && ids.at(-1) === 12) return DefinitionType.ApplicationClassPeopleCode;
  const shape = ids.join();
  for (const [type, known] of Object.entries(PEOPLECODE_OBJECTIDS)) {
    if (known?.join() === shape) return Number(type) as DefinitionType;
  }
  return undefined;
}

/** A PeopleCode definition's key parts from its PSPCMPROG values (unused slots already dropped). */
export function peopleCodeKeyFromValues(type: DefinitionType, values: readonly string[]): readonly string[] {
  return type === DefinitionType.ApplicationClassPeopleCode && values.at(-1) === 'OnExecute' ? values.slice(0, -1) : values;
}
