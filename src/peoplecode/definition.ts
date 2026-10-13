import { DefinitionType, type DefinitionKey } from '../model/definitions.js';

/*
 * Go to Definition for PeopleCode, the textual part (no VS Code, no database):
 * which definition a reference on a line points at. Two kinds are recognised,
 * neither needing the program to parse or compile:
 *
 *   - a qualified application class path, `PKG:SUB:CLASS` (as written in an
 *     import, an `extends`/`implements`, a `create`, or a type annotation) ->
 *     the Application Class PeopleCode of that class;
 *   - a definition reference, `Keyword.NAME` (`Record.JOB`, `Page.JOB_DATA1`,
 *     `Scroll.DERIVED`, `SQL.X`, `HTML.X`, ...) -> that definition.
 *
 * The provider ({@link registerPeopleCodeDefinition}) confirms the target
 * exists in the connection before offering a jump, and opens the stored key.
 */

/** A reference found on a line: the target's type and key parts, and the span that was matched. */
export interface ResolvedReference {
  type: DefinitionType;
  /** Key parts as written; the provider supplies the stored casing. */
  parts: string[];
  /** 0-based [start, end) of the reference text on the line. */
  start: number;
  end: number;
}

/** `Keyword.NAME` object references map a keyword to the definition type it names. Scroll names a record. */
const KEYWORD_TYPE: ReadonlyMap<string, DefinitionType> = new Map([
  ['record', DefinitionType.Record],
  ['scroll', DefinitionType.Record],
  ['field', DefinitionType.Field],
  ['page', DefinitionType.Page],
  ['component', DefinitionType.Component],
  ['menu', DefinitionType.Menu],
  ['sql', DefinitionType.SqlDefinition],
  ['image', DefinitionType.Image],
  ['html', DefinitionType.HtmlDefinition]
]);

// A colon path of identifiers: an application class reference. No spaces, two or more segments.
const CLASS_PATH = /[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+/g;
// Keyword.NAME, tolerating spaces around the dot as PeopleCode does.
const KEYWORD_REF = /\b([A-Za-z]+)\s*\.\s*([A-Za-z0-9_#$@]+)/g;

/** The definition type a `Keyword.NAME` keyword names (Record, Page, SQL, ...), or undefined if it is not one. */
export function definitionKeywordType(keyword: string): DefinitionType | undefined {
  return KEYWORD_TYPE.get(keyword.toLowerCase());
}

/**
 * A definition-reference being typed at the end of `prefix` (the text before the cursor):
 * the bareword keyword and the partial name after the dot, e.g. "Record.PAR" -> {keyword:"Record",
 * partial:"PAR"}. A `&variable.` or `%System.` receiver is not one (those take members, not names).
 */
export function definitionReferencePrefix(prefix: string): { keyword: string; partial: string } | undefined {
  const m = /(?:^|[^%&A-Za-z0-9_])([A-Za-z]+)\s*\.\s*([A-Za-z0-9_#$@]*)$/.exec(prefix);
  return m ? { keyword: m[1], partial: m[2] } : undefined;
}

const within = (character: number, start: number, end: number) => character >= start && character <= end;

/** Resolve the reference under `character` on `line`, or undefined if there is none there. */
export function resolveReference(line: string, character: number): ResolvedReference | undefined {
  // Application class paths first: they carry colons, which the keyword form never does.
  for (const m of line.matchAll(CLASS_PATH)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (!within(character, start, end)) continue;
    // `import PKG:SUB:*` names a package, not a class: the `*` is not part of the match, so skip it.
    if (line[end] === ':' && line[end + 1] === '*') return undefined;
    return { type: DefinitionType.ApplicationClassPeopleCode, parts: m[0].split(':'), start, end };
  }
  for (const m of line.matchAll(KEYWORD_REF)) {
    const type = KEYWORD_TYPE.get(m[1].toLowerCase());
    if (type === undefined) continue;
    const start = m.index!;
    const end = start + m[0].length;
    if (!within(character, start, end)) continue;
    return { type, parts: [m[2]], start, end };
  }
  return undefined;
}

// Declare Function <name> PeopleCode <REC>.<FIELD> <EVENT>;  -- an external PeopleCode function.
const DECLARE_FUNCTION = /\bDeclare\s+Function\s+([A-Za-z_][A-Za-z0-9_]*)\s+PeopleCode\s+([A-Za-z0-9_#$@]+)\s*\.\s*([A-Za-z0-9_#$@]+)\s+([A-Za-z]+)/gi;

/**
 * The Record PeopleCode a function is declared against, by scanning the program for its
 * `Declare Function <name> PeopleCode <REC>.<FIELD> <EVENT>` -- so Go to Definition on a call to
 * such a function reaches the FieldFormula (or other event) that holds it. Undefined if `funcName`
 * is not declared this way in `text`.
 */
export function resolveDeclaredFunction(text: string, funcName: string): { type: DefinitionType; parts: string[] } | undefined {
  const want = funcName.toLowerCase();
  for (const m of text.matchAll(DECLARE_FUNCTION)) {
    if (m[1].toLowerCase() === want) {
      return { type: DefinitionType.RecordPeopleCode, parts: [m[2], m[3], m[4]] };
    }
  }
  return undefined;
}

/** The stored key matching `ref` among `keys` (same parts, case-insensitively), or undefined. */
export function matchStoredKey(ref: { type: DefinitionType; parts: string[] }, keys: readonly DefinitionKey[]): DefinitionKey | undefined {
  return keys.find((k) =>
    k.type === ref.type &&
    k.parts.length === ref.parts.length &&
    k.parts.every((p, i) => p.toUpperCase() === ref.parts[i].toUpperCase()));
}
