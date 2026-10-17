import { DefinitionKey, DefinitionType, displayName } from './definitions.js';
import { projectItemIdentity } from './projectItems.js';

/*
 * The related definitions a project needs for its members to work in a target
 * database: what App Designer's Insert Related Definitions brings along, plus the
 * SQL objects and messages the members' own code calls.
 *
 * A build put ZZ_BENEFITS and ZZ_BNV_RUN_CMP into ZZ_BENEFITS as single items. The
 * developer then had to add 42 more by hand -- the program's 14 sections, 16 SQL
 * statements and 10 PeopleCode programs, and the component's PostBuild and
 * FieldChange -- and even then the 7 SQL objects the code calls (SQL.ZZ_BNV_*), the
 * translate values of its fields, its message set, its content references and the
 * folder holding them were still missing. A program migrated without its sections arrives as a header with
 * no logic; one without its SQL objects fails at run time in the target.
 */

export interface RelatedLookup {
  /** An App Engine program's sections, statement SQL IDs (SQLTYPE 1), PeopleCode keys and all its SQL and PeopleCode text. */
  appEngine(program: string): Promise<{ sections: string[]; statementSqlIds: string[]; peopleCode: DefinitionKey[]; text: string } | undefined>;
  /** A component's PeopleCode keys (component, component record, component record field) and its pages. */
  component(name: string, market: string): Promise<{ peopleCode: DefinitionKey[]; pages: string[] } | undefined>;
  /** A page's PeopleCode keys. */
  pagePeopleCode(page: string): Promise<DefinitionKey[]>;
  /** A record's PeopleCode keys. */
  recordPeopleCode(record: string): Promise<DefinitionKey[]>;
  /** A field's translate values. */
  translateValues(field: string): Promise<{ value: string; effdt: string }[]>;
  /** An application class's source. */
  classSource(path: string[]): Promise<string | undefined>;
  /** A standalone SQL object (SQLTYPE 0); delivered when Oracle last updated it. Undefined when there is none. */
  sqlObject(id: string): Promise<{ delivered: boolean } | undefined>;
  /**
   * The content references that open a component, each with the custom folders above it,
   * nearest first: a target without them cannot place the reference.
   */
  contentReferences(component: string, market: string): Promise<{ portal: string; refType: string; name: string; folders?: string[] }[]>;
}

export interface RelatedDefinition {
  key: DefinitionKey;
  /** Which member needs it, and why. */
  reason: string;
  /** False when Studio cannot add it to a project yet; `note` says what to do instead. */
  addable: boolean;
  note?: string;
}

// Compared as project rows, so a packed key from a listing matches the unpacked one the closure builds.
const id = projectItemIdentity;

/** SQL.NAME in PeopleCode and %SQL(NAME) in App Engine SQL. */
export function sqlReferences(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = new Set<string>();
  for (const m of code.matchAll(/\bSQL\.(\w+)/g)) out.add(m[1]!.toUpperCase());
  for (const m of code.matchAll(/%SQL\s*\(\s*(\w+)/gi)) out.add(m[1]!.toUpperCase());
  return [...out].sort();
}

/** The Message Catalog entries MessageBox calls name: set and number. */
export function messageReferences(text: string): Array<{ set: number; number: number }> {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const seen = new Map<string, { set: number; number: number }>();
  for (const m of code.matchAll(/\bMessageBox\s*\(\s*\d+\s*,\s*"[^"]*"\s*,\s*(\d+)\s*,\s*(\d+)/gi)) {
    seen.set(`${m[1]},${m[2]}`, { set: Number(m[1]), number: Number(m[2]) });
  }
  return [...seen.values()].sort((a, b) => a.set - b.set || a.number - b.number);
}

/**
 * Every definition the members need that is not itself a member. Members are the
 * definitions passed in; a related definition already among them is left out.
 */
export async function relatedDefinitions(members: readonly DefinitionKey[], lookup: RelatedLookup): Promise<RelatedDefinition[]> {
  const have = new Set(members.map(id));
  const out = new Map<string, RelatedDefinition>();
  const add = (r: RelatedDefinition) => {
    const k = id(r.key);
    if (!have.has(k) && !out.has(k)) out.set(k, r);
  };
  const code: Array<{ owner: string; text: string }> = [];

  for (const m of members) {
    const owner = displayName(m);
    switch (m.type) {
      case DefinitionType.AppEngineProgram: {
        const ae = await lookup.appEngine(m.parts[0]!);
        if (!ae) break;
        for (const s of ae.sections) add({ key: { type: DefinitionType.AppEngineSection, parts: [m.parts[0]!, s] }, reason: `${owner}: section ${s}`, addable: true });
        for (const s of ae.statementSqlIds) add({ key: { type: DefinitionType.SqlDefinition, parts: [s, '1'] }, reason: `${owner}: SQL statement ${s.trim()}`, addable: true });
        for (const p of ae.peopleCode) add({ key: p, reason: `${owner}: PeopleCode`, addable: true });
        code.push({ owner, text: ae.text });
        break;
      }
      case DefinitionType.Component: {
        const market = m.parts[1] || 'GBL';
        const cmp = await lookup.component(m.parts[0]!, market);
        if (!cmp) break;
        for (const p of cmp.peopleCode) add({ key: p, reason: `${owner}: component PeopleCode`, addable: true });
        for (const pg of cmp.pages) add({ key: { type: DefinitionType.Page, parts: [pg] }, reason: `${owner}: page ${pg}`, addable: true });
        for (const r of await lookup.contentReferences(m.parts[0]!, market)) {
          add({ key: { type: DefinitionType.PortalRegistry, parts: [r.portal, r.refType, r.name] }, reason: `${owner}: content reference ${r.name} in ${r.portal}`, addable: true });
          for (const f of r.folders ?? []) {
            add({ key: { type: DefinitionType.PortalRegistry, parts: [r.portal, 'F', f] }, reason: `${owner}: folder ${f} holds content reference ${r.name}`, addable: true });
          }
        }
        break;
      }
      case DefinitionType.Page:
        for (const p of await lookup.pagePeopleCode(m.parts[0]!)) add({ key: p, reason: `${owner}: page PeopleCode`, addable: true });
        break;
      case DefinitionType.Record:
        for (const p of await lookup.recordPeopleCode(m.parts[0]!)) add({ key: p, reason: `${owner}: record PeopleCode`, addable: true });
        break;
      case DefinitionType.Field:
        for (const x of await lookup.translateValues(m.parts[0]!)) {
          add({ key: { type: DefinitionType.TranslateValue, parts: [m.parts[0]!, x.value, x.effdt] }, reason: `${owner}: translate value ${x.value.trim()}`, addable: true });
        }
        break;
      case DefinitionType.ApplicationClassPeopleCode: {
        const path = m.parts.at(-1) === 'OnExecute' ? m.parts.slice(0, -1) : [...m.parts];
        const src = await lookup.classSource(path);
        if (src) code.push({ owner, text: src });
        break;
      }
    }
  }

  // What the members' code calls by name.
  for (const { owner, text } of code) {
    for (const sql of sqlReferences(text)) {
      // A delivered SQL object is already in every target; only the project's own are carried.
      const found = await lookup.sqlObject(sql);
      if (!found || found.delivered) continue;
      add({ key: { type: DefinitionType.SqlDefinition, parts: [sql, '0'] }, reason: `${owner}: calls SQL.${sql}`, addable: true });
    }
    for (const msg of messageReferences(text)) {
      add({ key: { type: DefinitionType.MessageCatalog, parts: [String(msg.set), String(msg.number)] }, reason: `${owner}: MessageBox ${msg.set},${msg.number}`, addable: true });
    }
  }
  return [...out.values()];
}
