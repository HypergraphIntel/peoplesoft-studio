import { DefinitionKey, DefinitionType, displayName, typeLabel } from './definitions.js';

/*
 * A definition as a PSPROJECTITEM row: what App Designer's Insert Current
 * Definition into Project (F7) writes. docs/PROJECT_INSERT.md.
 *
 * OBJECTTYPE and the OBJECTID of each key slot are not guessed. Each layout
 * below is one HRDMO's own PSPROJECTITEM rows use (8.62.09, counted over
 * every delivered project), and case p01 (a field inserted by App Designer)
 * fixed the remaining columns. A field's OBJECTID in a project item is 6,
 * not the 2 PeopleCode keys use for it: the IDs belong to the project item
 * layout, not to the definition. Types not listed are refused.
 */

export class ProjectSaveRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectSaveRefusedError';
  }
}

export interface ProjectItem {
  objectType: number;
  /** One per key slot used, in order; unused slots are written 0 / ' '. */
  objectIds: number[];
  objectValues: string[];
}

/** The status columns App Designer gives an inserted item (case p01), also the corpus's most common row. */
export const PROJECT_ITEM_DEFAULTS = {
  NODETYPE: 0,
  SOURCESTATUS: 0,
  TARGETSTATUS: 0,
  UPGRADEACTION: 0,
  TAKEACTION: 1,
  COPYDONE: 0
} as const;

/** The key slots PSPROJECTITEM has on HRDMO; a longer key cannot be stored. */
export const MIN_PROJECT_ITEM_SLOTS = 4;

/** The definition types that can be inserted into a project. */
export const INSERTABLE_TYPES: ReadonlySet<DefinitionType> = new Set([
  DefinitionType.Record, DefinitionType.Field, DefinitionType.Page, DefinitionType.Menu,
  DefinitionType.Component, DefinitionType.RecordPeopleCode, DefinitionType.AppEngineProgram,
  DefinitionType.HtmlDefinition, DefinitionType.SqlDefinition, DefinitionType.ApplicationPackage,
  DefinitionType.ApplicationClassPeopleCode, DefinitionType.StyleSheet
]);

export function canInsertIntoProject(type: DefinitionType): boolean {
  return INSERTABLE_TYPES.has(type);
}

/** PSPROJECTITEM.OBJECTTYPE for a SQL definition; this extension keys SQL as its own type. */
const SQL_OBJECTTYPE = 30;

const single = (objectType: number, objectId: number) => (key: DefinitionKey): ProjectItem =>
  ({ objectType, objectIds: [objectId], objectValues: [name(key)] });

function name(key: DefinitionKey): string {
  const n = key.parts[0]?.trim();
  if (!n) throw new ProjectSaveRefusedError(`${typeLabel(key.type)} key has no name.`);
  return n;
}

const LAYOUTS: Readonly<Partial<Record<DefinitionType, (key: DefinitionKey) => ProjectItem>>> = {
  [DefinitionType.Record]: single(0, 1),
  // A field listed under a record carries the record as a second part; the item is the field.
  [DefinitionType.Field]: single(2, 6),
  [DefinitionType.Page]: single(5, 9),
  [DefinitionType.Menu]: single(6, 3),
  [DefinitionType.AppEngineProgram]: single(33, 66),
  [DefinitionType.Component]: (key) =>
    ({ objectType: 7, objectIds: [10, 39], objectValues: [name(key), key.parts[1] || 'GBL'] }),
  [DefinitionType.RecordPeopleCode]: (key) => {
    if (key.parts.length !== 3) {
      throw new ProjectSaveRefusedError(`${displayName(key)} is not a record.field.event key.`);
    }
    return { objectType: 8, objectIds: [1, 2, 12], objectValues: [...key.parts] };
  },
  // 295 style sheet items on HRDMO: OBJECTID1 94 (STYLESHEETNAME), the rest blank.
  [DefinitionType.StyleSheet]: (key) => ({ objectType: 50, objectIds: [94], objectValues: [name(key)] }),
  [DefinitionType.HtmlDefinition]: (key) => {
    if (!key.parts[1]) throw new ProjectSaveRefusedError(`${displayName(key)} has no content type.`);
    return { objectType: 51, objectIds: [90, 95], objectValues: [name(key), key.parts[1]] };
  },
  // SQLTYPE 0, the SQL definitions this extension opens.
  [DefinitionType.SqlDefinition]: (key) =>
    ({ objectType: SQL_OBJECTTYPE, objectIds: [65, 81], objectValues: [name(key), '0'] }),
  // Searched, a package is keyed by its root; as a project item, by
  // PACKAGEID, PACKAGEROOT and QUALIFYPATH ('.' for a root).
  [DefinitionType.ApplicationPackage]: (key) => {
    const values = key.parts.length >= 3 ? key.parts.slice(0, 3) : [name(key), name(key), '.'];
    return { objectType: 57, objectIds: [104, 116, 117], objectValues: values };
  },
  // root[:sub[:sub]]:class; project items carry no OnExecute event.
  [DefinitionType.ApplicationClassPeopleCode]: (key) => {
    const path = key.parts.at(-1) === 'OnExecute' ? key.parts.slice(0, -1) : [...key.parts];
    if (path.length < 2 || path.length > 4) {
      throw new ProjectSaveRefusedError(`${displayName(key)} is not a package:class path of 2 to 4 parts.`);
    }
    const subs = [105, 106].slice(0, path.length - 2);
    return { objectType: 58, objectIds: [104, ...subs, 107], objectValues: path };
  }
};

/** The PSPROJECTITEM row for a definition, or refused with the reason. */
export function projectItemFor(key: DefinitionKey): ProjectItem {
  const layout = LAYOUTS[key.type];
  if (!layout) {
    throw new ProjectSaveRefusedError(`${typeLabel(key.type)} cannot be inserted into a project yet.`);
  }
  const item = layout(key);
  if (item.objectValues.some((v) => v.trim() === '')) {
    throw new ProjectSaveRefusedError(`${displayName(key)} has a blank key part.`);
  }
  return item;
}

/** The item's key columns padded to the table's slots: OBJECTID1..n / OBJECTVALUE1..n. */
export function itemKeyColumns(item: ProjectItem, slots: number): Record<string, string | number> {
  if (item.objectIds.length > slots) {
    throw new ProjectSaveRefusedError(`This database's PSPROJECTITEM has ${slots} key slots; the item needs ${item.objectIds.length}.`);
  }
  const out: Record<string, string | number> = {};
  for (let n = 1; n <= slots; n++) {
    out[`OBJECTID${n}`] = item.objectIds[n - 1] ?? 0;
    out[`OBJECTVALUE${n}`] = item.objectValues[n - 1] ?? ' ';
  }
  return out;
}

/** "ZZ_PCODE_LAB_C02 (Fields)", for messages. */
export function describeItem(key: DefinitionKey): string {
  return `${displayName(key)} (${typeLabel(key.type)})`;
}
