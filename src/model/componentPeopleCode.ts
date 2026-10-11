import { DefinitionType, type DefinitionKey } from './definitions.js';
import type { Row } from './uiDefinitions.js';

/*
 * App Designer's Component PeopleCode editor: an object list (the component,
 * every record in its buffer and each record's fields) and the object's
 * events. The events are App Designer's lists -- also every event the
 * component programs on HRDMO use -- in its order: those with a program
 * first (its bold ones, alphabetically: JOB_DATA's PostBuild, PreBuild,
 * SavePostChange, SavePreChange), then the rest in this order (a component
 * with none lists PreBuild, PostBuild, SavePreChange, SavePostChange,
 * Workflow). Opening an object opens its first event.
 *
 *   component         PreBuild, PostBuild, SavePreChange, SavePostChange, Workflow
 *   component record  RowInit, RowInsert, RowDelete, RowSelect, SaveEdit, SavePostChange,
 *                     SavePreChange, SearchInit, SearchSave
 *   component field   FieldChange, FieldDefault, FieldEdit, PrePopup
 *
 * A program's key is its PSPCMPROG values in order (peopleCodeKeys.ts):
 * component, market[, record[, field]], event.
 */

export const COMPONENT_EVENTS = ['PreBuild', 'PostBuild', 'SavePreChange', 'SavePostChange', 'Workflow'] as const;
export const COMPONENT_RECORD_EVENTS = ['RowInit', 'RowInsert', 'RowDelete', 'RowSelect', 'SaveEdit', 'SavePostChange', 'SavePreChange', 'SearchInit', 'SearchSave'] as const;
export const COMPONENT_FIELD_EVENTS = ['FieldChange', 'FieldDefault', 'FieldEdit', 'PrePopup'] as const;

/** One stored component program. */
export interface ComponentProgram {
  record?: string;
  field?: string;
  event: string;
}

/** The component's programs from its PSPCMPROG keys (OBJECTID1 10): OBJECTID3..5 / OBJECTVALUE3..5. */
export function componentPrograms(rows: readonly Row[]): ComponentProgram[] {
  const s = (v: unknown) => String(v ?? '').trim();
  const out: ComponentProgram[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id3 = Number(r.OBJECTID3), id4 = Number(r.OBJECTID4), id5 = Number(r.OBJECTID5);
    const p: ComponentProgram | undefined =
      id3 === 12 ? { event: s(r.OBJECTVALUE3) }
      : id3 === 1 && id4 === 12 ? { record: s(r.OBJECTVALUE3), event: s(r.OBJECTVALUE4) }
      : id3 === 1 && id4 === 2 && id5 === 12 ? { record: s(r.OBJECTVALUE3), field: s(r.OBJECTVALUE4), event: s(r.OBJECTVALUE5) }
      : undefined;
    if (!p) continue;
    const k = `${p.record ?? ''}.${p.field ?? ''}.${p.event}`;
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  return out;
}

/** An object in the left list: the component, a record, or a record's field. */
export interface PeopleCodeObject {
  label: string;
  record?: string;
  field?: string;
  /** Events with a program. */
  withCode: string[];
}

/**
 * The objects View PeopleCode offers, in App Designer's terms: the component;
 * every record in the component buffer (and any other record that has
 * component PeopleCode); and each field that has component PeopleCode, after
 * its record. Objects with code come with the events that have it.
 */
export function peopleCodeObjects(componentName: string, bufferRecords: readonly string[], programs: readonly ComponentProgram[],
  recordFields: Readonly<Record<string, readonly string[]>> = {}): PeopleCodeObject[] {
  const events = (record?: string, field?: string) =>
    programs.filter((p) => p.record === record && p.field === field).map((p) => p.event);
  const records = [...new Set([...bufferRecords, ...programs.filter((p) => p.record).map((p) => p.record!)])];
  const out: PeopleCodeObject[] = [{ label: `${componentName} (component)`, withCode: events(undefined, undefined) }];
  for (const r of records) {
    out.push({ label: `${r} (record)`, record: r, withCode: events(r, undefined) });
    // Each of the record's fields (as App Designer lists them), and any other field that has component PeopleCode.
    const fields = [...new Set([...(recordFields[r] ?? []), ...programs.filter((p) => p.record === r && p.field).map((p) => p.field!)])];
    for (const f of fields) out.push({ label: `${r}.${f} (field)`, record: r, field: f, withCode: events(r, f) });
  }
  return out;
}

/** The events an object takes, in App Designer's order (those with a program first, alphabetically, then the rest). */
export function eventsFor(object: Pick<PeopleCodeObject, 'record' | 'field'> & { withCode?: readonly string[] }): readonly string[] {
  const all: readonly string[] = object.field ? COMPONENT_FIELD_EVENTS : object.record ? COMPONENT_RECORD_EVENTS : COMPONENT_EVENTS;
  const code = all.filter((e) => object.withCode?.includes(e)).sort();
  return [...code, ...all.filter((e) => !code.includes(e))];
}

/** The definition key of an object's program for an event. */
export function componentPeopleCodeKey(component: string, market: string, object: Pick<PeopleCodeObject, 'record' | 'field'>, event: string): DefinitionKey {
  if (object.field && object.record) return { type: DefinitionType.ComponentRecordFieldPeopleCode, parts: [component, market, object.record, object.field, event] };
  if (object.record) return { type: DefinitionType.ComponentRecordPeopleCode, parts: [component, market, object.record, event] };
  return { type: DefinitionType.ComponentPeopleCode, parts: [component, market, event] };
}

/** Every record in a Structure (search record, each scroll's records), in tree order. */
export function bufferRecords(structure: { searchRecord?: { name: string }; level0: ScrollLike }): string[] {
  const out: string[] = [];
  const add = (r: string) => { if (r && !out.includes(r)) out.push(r); };
  if (structure.searchRecord) add(structure.searchRecord.name);
  const walk = (s: ScrollLike) => { for (const r of s.records) add(r.name); s.scrolls.forEach(walk); };
  walk(structure.level0);
  return out;
}
interface ScrollLike { records: { name: string }[]; scrolls: ScrollLike[] }
