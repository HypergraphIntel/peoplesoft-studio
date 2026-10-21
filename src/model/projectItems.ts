import {pcmProgKeyParts} from './peopleCodeKeys.js';
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
  DefinitionType.Record, DefinitionType.Field, DefinitionType.Page, DefinitionType.Menu, DefinitionType.Query,
  DefinitionType.Component, DefinitionType.RecordPeopleCode, DefinitionType.AppEngineProgram, DefinitionType.AppEngineSection, DefinitionType.AppEnginePeopleCode,
  DefinitionType.HtmlDefinition, DefinitionType.SqlDefinition, DefinitionType.ApplicationPackage,
  DefinitionType.ApplicationClassPeopleCode, DefinitionType.StyleSheet, DefinitionType.MessageChannel, DefinitionType.UrlDefinition,
  DefinitionType.TranslateValue, DefinitionType.ProcessDefinition, DefinitionType.PagePeopleCode, DefinitionType.ComponentPeopleCode,
  DefinitionType.ComponentRecordPeopleCode, DefinitionType.ComponentRecordFieldPeopleCode, DefinitionType.PortalRegistry,
  DefinitionType.MessageCatalog
]);

export function canInsertIntoProject(type: DefinitionType): boolean {
  return INSERTABLE_TYPES.has(type);
}


const single = (objectType: number, objectId: number) => (key: DefinitionKey): ProjectItem =>
  ({ objectType, objectIds: [objectId], objectValues: [name(key)] });

function name(key: DefinitionKey): string {
  const n = key.parts[0]?.trim();
  if (!n) throw new ProjectSaveRefusedError(`${typeLabel(key.type)} key has no name.`);
  return n;
}

const LAYOUTS: Readonly<Partial<Record<DefinitionType, (key: DefinitionKey) => ProjectItem>>> = {
  // HRDMO: all 310 matched Query members use IDs 30/25; 309 have the ordinary insertion defaults (Oct 20 native evidence).
  [DefinitionType.Query]: key => {
    if (key.parts.length > 2 || (key.parts[1]??'').length > 30) throw new ProjectSaveRefusedError('A Query project key is name and optional private owner.');
    return {objectType:10,objectIds:[30,25],objectValues:[name(key),(key.parts[1]??'').trim()||' ']};
  },
  // HRDMO project URL members: OBJECTTYPE 56 / OBJECTID 103 (docs/URLS_NODES.md).
  [DefinitionType.UrlDefinition]: single(56, 103),
  [DefinitionType.Record]: single(0, 1),
  // A field listed under a record carries the record as a second part; the item is the field.
  [DefinitionType.Field]: single(2, 6),
  [DefinitionType.Page]: single(5, 9),
  [DefinitionType.Menu]: single(6, 3),
  [DefinitionType.AppEngineProgram]: single(33, 66),
  // HRDMO: all 970 section project members have IDs 66/77; they cover every variant.
  [DefinitionType.AppEngineSection]: key=>{
    if(key.parts.length!==2)throw new ProjectSaveRefusedError('An AE section project key is program, section.');
    return {objectType:34,objectIds:[66,77],objectValues:[name(key),key.parts[1]]};
  },
  // All 1,047 AE PeopleCode members use four slots. Slot 2 packs section/market/platform/date.
  [DefinitionType.AppEnginePeopleCode]: key=>{
    const parts=pcmProgKeyParts(key);
    if(parts.length!==7 || parts[1].length>8 || parts[2].length>3 || parts[3].length>9 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[4]) || parts[6]!=='OnExecute')throw new ProjectSaveRefusedError('An AE PeopleCode key needs program, section, market, platform, effective date, step, OnExecute.');
    return {objectType:43,objectIds:[66,77,78,12],objectValues:[name(key),parts[1].padEnd(8)+parts[2].padEnd(3)+parts[3].padEnd(9)+parts[4],parts[5],parts[6]]};
  },
  // App Designer's Insert into Project: OBJECTID1 61 (CHNLNAME), the default statuses [chn16].
  [DefinitionType.MessageChannel]: single(36, 61),
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
    ({ objectType: DefinitionType.SqlDefinition, objectIds: [65, 81], objectValues: [name(key), key.parts[1] ?? '0'] }),
  // Searched, a package is keyed by its root; as a project item, by
  // PACKAGEID, PACKAGEROOT and QUALIFYPATH ('.' for a root).
  [DefinitionType.ApplicationPackage]: (key) => {
    const values = key.parts.length >= 3 ? key.parts.slice(0, 3) : [name(key), name(key), '.'];
    return { objectType: 57, objectIds: [104, 116, 117], objectValues: values };
  },
  /*
   * The definitions App Designer's Insert Related Definitions brings along, and that a
   * build left out of ZZ_BENEFITS until the developer added them by hand. Each layout is
   * the only one HRDMO's delivered projects use for its type (counts below), and the
   * component PeopleCode and process definition layouts are also the rows App Designer
   * wrote into ZZ_BENEFITS itself.
   */
  // Delivered projects carry two layouts (48/49/50 with the set description in 880 rows,
  // 48/49 in 414). App Designer 8.62 writes the second: Insert > Definitions into Project,
  // set 25500 into ZZ_BENEFITS, saved as version 113 -- set and number unpadded, slots 3
  // and 4 blank, the default statuses. A listed key may carry the description; it is dropped.
  [DefinitionType.MessageCatalog]: (key) => {
    const [set, number] = key.parts.map((p) => p.trim());
    if (!/^\d+$/.test(set ?? '') || !/^\d+$/.test(number ?? '')) {
      throw new ProjectSaveRefusedError('A Message Catalog project key is message set number, message number.');
    }
    return { objectType: 25, objectIds: [48, 49], objectValues: [String(Number(set)), String(Number(number))] };
  },
  // 9,596 rows: FIELDNAME, FIELDVALUE, EFFDT.
  [DefinitionType.TranslateValue]: (key) => {
    if (key.parts.length !== 3 || !/^\d{4}-\d{2}-\d{2}$/.test(key.parts[2] ?? '')) {
      throw new ProjectSaveRefusedError('A translate value project key is field, value, effective date (YYYY-MM-DD).');
    }
    return { objectType: 4, objectIds: [6, 22, 21], objectValues: [name(key), key.parts[1]!, key.parts[2]!] };
  },
  // 308 rows: PRCSTYPE, PRCSNAME.
  [DefinitionType.ProcessDefinition]: (key) => {
    if (key.parts.length !== 2) throw new ProjectSaveRefusedError('A process definition project key is process type, process name.');
    return { objectType: 20, objectIds: [29, 28], objectValues: [name(key), key.parts[1]!] };
  },
  // 1,781 rows: page, event.
  [DefinitionType.PagePeopleCode]: (key) => {
    if (key.parts.length !== 2) throw new ProjectSaveRefusedError('A page PeopleCode project key is page, event.');
    return { objectType: 44, objectIds: [9, 12], objectValues: [name(key), key.parts[1]!] };
  },
  // 888 rows: component, market, event.
  [DefinitionType.ComponentPeopleCode]: (key) => {
    if (key.parts.length !== 3) throw new ProjectSaveRefusedError('A component PeopleCode project key is component, market, event.');
    return { objectType: 46, objectIds: [10, 39, 12], objectValues: [name(key), key.parts[1]!, key.parts[2]!] };
  },
  // 488 rows: component, market, record, event.
  [DefinitionType.ComponentRecordPeopleCode]: (key) => {
    if (key.parts.length !== 4) throw new ProjectSaveRefusedError('A component record PeopleCode project key is component, market, record, event.');
    return { objectType: 47, objectIds: [10, 39, 1, 12], objectValues: [name(key), key.parts[1]!, key.parts[2]!, key.parts[3]!] };
  },
  // 2,651 rows: component, market, record, then field and event packed into one slot --
  // the field padded to 18, every one of them, because the item has only four key slots.
  [DefinitionType.ComponentRecordFieldPeopleCode]: (raw) => {
    // A listing or search gives the key packed, as stored: field and event in one 18-padded slot.
    const key = raw.parts.length === 4 && raw.parts[3]!.length > 18
      ? { ...raw, parts: [...raw.parts.slice(0, 3), raw.parts[3]!.slice(0, 18).trim(), raw.parts[3]!.slice(18).trim()] } : raw;
    if (key.parts.length !== 5 || key.parts[3]!.trim().length > 18) {
      throw new ProjectSaveRefusedError('A component record field PeopleCode project key is component, market, record, field (at most 18), event.');
    }
    return { objectType: 48, objectIds: [10, 39, 1, 2],
      objectValues: [name(key), key.parts[1]!, key.parts[2]!, key.parts[3]!.trim().padEnd(18) + key.parts[4]!] };
  },
  // 7,358 rows: portal, C (content reference) or F (folder), object name.
  [DefinitionType.PortalRegistry]: (key) => {
    if (key.parts.length !== 3 || !['C', 'F'].includes(key.parts[1]!)) {
      throw new ProjectSaveRefusedError('A portal registry project key is portal, C or F, object name.');
    }
    return { objectType: 55, objectIds: [99, 100, 101], objectValues: [name(key), key.parts[1]!, key.parts[2]!] };
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
  if (item.objectValues.some((v,i) => v.trim() === '' && !(key.type===DefinitionType.Query && i===1 && v===' '))) {
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

/**
 * A definition's identity as a project item: the row it becomes. Keys for the same
 * definition arrive packed (from a listing or search) or unpacked (from a tool or the
 * closure); comparing their rows treats them as the same item.
 */
export function projectItemIdentity(key: DefinitionKey): string {
  try {
    const i = projectItemFor(key);
    return `${i.objectType}|${i.objectValues.map((v) => v.trim()).join('|')}`;
  } catch {
    return `?${key.type}|${key.parts.map((p) => p.trim()).join('|')}`;
  }
}
