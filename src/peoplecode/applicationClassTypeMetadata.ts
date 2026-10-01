/*
 * Application Class TYPE metadata: the declared types of other classes'
 * members, for dependency identities a program's own source cannot name.
 *
 * `&tree.mNodesCol.getItem(&i)` calls `getItem` on the value of property
 * `mNodesCol`; PeopleTools stores a PACKAGE row for the property's declared
 * class (definition 28731: PACKAGE COLLECTION), a class written nowhere in
 * the calling program -- only in the declaration of `mNodesCol` inside the
 * receiver's class (or an ancestor of it). A provider answers exactly that
 * question: given a class and a member, what type does the member declare?
 *
 * The provider is optional and side-effect free. It never allocates and
 * never guesses: a member that cannot be found, a type that cannot be
 * resolved to exactly one class, or a class that is not available all
 * answer `undefined`, and the encoder keeps its conservative behavior.
 *
 * This module is pure (no I/O): callers feed it class definitions (path +
 * source), e.g. from the local corpus snapshot.
 */
import { parseApplicationClassSource } from './applicationClassProgram.js';

/** A class path: package components then the class name, e.g. `['PTWIDGETS', 'TreeControl']`. */
export type ApplicationClassPath = readonly string[];

/** What a member's declared type resolves to. */
export type ApplicationClassMemberType =
  /** An Application Class available to the provider. */
  | { kind: 'class'; path: ApplicationClassPath }
  /**
   * An array (`depth` times `array of`) whose element is an available
   * Application Class: the value is an array; an element reached by
   * `depth` index groups is of the class.
   */
  | { kind: 'array'; element: ApplicationClassPath; depth: number }
  /**
   * Not an Application Class: a primitive, built-in object, or an array of
   * those (or an untyped array), as written.
   */
  | { kind: 'other'; type: string };

export interface ApplicationClassTypeMetadataProvider {
  /** Declared type of property / instance `member` of the class or of its nearest ancestor declaring it. */
  memberType(classPath: ApplicationClassPath, member: string): ApplicationClassMemberType | undefined;
  /** Declared return type of method `method` of the class or of its nearest ancestor declaring it. */
  methodReturnType(classPath: ApplicationClassPath, method: string): ApplicationClassMemberType | undefined;
  /** The class's parent (`extends`), when the class and its parent are available (`%Super`). */
  superclassOf(classPath: ApplicationClassPath): ApplicationClassPath | undefined;
}

export interface ApplicationClassTypeMetadataOptions {
  /**
   * PeopleTools built-in object type names win over a same-named imported
   * class: 29585 imports `G3FORM:TAGS:Rowset` and declares methods
   * `Returns Rowset`, and its compiled type-path names hold no
   * G3FORM:TAGS:Rowset -- the built-in Rowset. Supplied by the caller
   * (the encoder's built-in registry), so this module keeps no list.
   */
  isBuiltinType?: (name: string) => boolean;
}

export interface ApplicationClassDefinition {
  /** The class's own path (package components, class name). */
  path: ApplicationClassPath;
  /** The class's PeopleCode source. */
  source: string;
}

interface IndexedClass {
  path: ApplicationClassPath;
  extendsType?: ApplicationClassPath | 'unresolved';
  /** lowercased member name -> declared type as written */
  members: Map<string, string>;
  /** lowercased method name -> declared return type as written ('' when none) */
  methods: Map<string, string>;
  /** the declaring class's imports, for resolving its own type names */
  namedImports: Map<string, string[]>;
  wildcardPackages: string[][];
}

export const canonicalClassKey = (path: ApplicationClassPath): string =>
  path.map(component => component.toUpperCase()).join(':');

/**
 * Build a provider over a fixed set of class definitions. A definition is
 * parsed on the first lookup that reaches its class.
 */
export function createApplicationClassTypeMetadataProvider(
  definitions: Iterable<ApplicationClassDefinition>,
  options: ApplicationClassTypeMetadataOptions = {}
): ApplicationClassTypeMetadataProvider {
  const sources = new Map<string, ApplicationClassDefinition>();
  const classNames = new Set<string>();
  for (const definition of definitions) {
    sources.set(canonicalClassKey(definition.path), definition);
    classNames.add(definition.path[definition.path.length - 1].toUpperCase());
  }
  const parsed = new Map<string, IndexedClass | null>();

  /* A type name as written in `owner`'s source -> a class path, a non-class type, or undefined. */
  const resolveType = (owner: IndexedClass, written: string): ApplicationClassMemberType | undefined => {
    const type = written.replace(/\s+/g, ' ').trim();
    if (type === '') return { kind: 'other', type };
    if (/^array\b/i.test(type)) {
      /* Cycle 109: an array of an available class keeps its element; an unresolvable element answers undefined. */
      const array = /^((?:array\s+of\s+)+)(.+)$/i.exec(type);
      if (array === null || /^array$/i.test(array[2].trim())) return { kind: 'other', type };
      const element = resolveType(owner, array[2]);
      if (element === undefined) return undefined;
      if (element.kind !== 'class') return { kind: 'other', type };
      return { kind: 'array', element: element.path, depth: (array[1].match(/array/gi) ?? []).length };
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(type) && options.isBuiltinType?.(type) === true) return { kind: 'other', type };
    const available = (path: string[]) => sources.get(canonicalClassKey(path))?.path;
    if (type.includes(':')) {
      const path = available(type.split(':').map(component => component.trim()));
      return path === undefined ? undefined : { kind: 'class', path };
    }
    const named = owner.namedImports.get(type.toUpperCase());
    if (named !== undefined) {
      const path = available(named);
      return path === undefined ? undefined : { kind: 'class', path };
    }
    /* A short name: exactly one available class in the owner's package or a wildcard-imported one. */
    const candidates = [...new Set(
      [owner.path.slice(0, -1), ...owner.wildcardPackages]
        .map(packagePath => canonicalClassKey([...packagePath, type]))
        .filter(key => sources.has(key))
    )];
    if (candidates.length === 1) return { kind: 'class', path: sources.get(candidates[0])!.path };
    if (candidates.length > 1) return undefined;
    /* No reachable class of that name and no class of that name anywhere: a primitive / built-in type. */
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(type) && !classNames.has(type.toUpperCase())) return { kind: 'other', type };
    return undefined;
  };

  const index = (key: string): IndexedClass | undefined => {
    if (parsed.has(key)) return parsed.get(key) ?? undefined;
    parsed.set(key, null);
    const definition = sources.get(key);
    if (definition === undefined) return undefined;
    let program: ReturnType<typeof parseApplicationClassSource> | undefined;
    try {
      program = parseApplicationClassSource(definition.source);
    } catch {
      program = undefined;
    }
    if (!program) return undefined;
    const namedImports = new Map<string, string[]>();
    const wildcardPackages: string[][] = [];
    const prefix = definition.source.slice(0, program.unitStart).replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of prefix.matchAll(/\bimport\s+([%A-Za-z0-9_:\s*]+?)\s*;/gi)) {
      const components = m[1].replace(/\s+/g, '').split(':');
      if (components[components.length - 1] === '*') wildcardPackages.push(components.slice(0, -1));
      else namedImports.set(components[components.length - 1].toUpperCase(), components);
    }
    const members = new Map<string, string>();
    const methods = new Map<string, string>();
    for (const member of program.members) {
      if (member.kind === 'property' || member.kind === 'instance') members.set(member.name.replace(/^&/, '').toLowerCase(), member.type);
      else if (member.kind === 'method') methods.set(member.name.toLowerCase(), member.returnType ?? '');
    }
    for (const statement of program.statements) {
      if (statement.kind === 'instance-statement') {
        for (const name of statement.names) members.set(name.replace(/^&/, '').toLowerCase(), statement.type);
      }
    }
    const entry: IndexedClass = { path: definition.path, members, methods, namedImports, wildcardPackages };
    parsed.set(key, entry);
    if (program.extendsType !== undefined) {
      const resolved = resolveType(entry, program.extendsType);
      entry.extendsType = resolved?.kind === 'class' ? resolved.path : 'unresolved';
    }
    return entry;
  };

  const lookup = (
    classPath: ApplicationClassPath,
    name: string,
    table: 'members' | 'methods'
  ): ApplicationClassMemberType | undefined => {
    const seen = new Set<string>();
    let key: string | undefined = canonicalClassKey(classPath);
    while (key !== undefined && !seen.has(key)) {
      seen.add(key);
      const entry = index(key);
      if (entry === undefined) return undefined;
      const written = entry[table].get(name.toLowerCase());
      if (written !== undefined) return resolveType(entry, written);
      if (entry.extendsType === undefined || entry.extendsType === 'unresolved') return undefined;
      key = canonicalClassKey(entry.extendsType);
    }
    return undefined;
  };

  return {
    memberType: (classPath, member) => lookup(classPath, member.replace(/^&/, ''), 'members'),
    methodReturnType: (classPath, method) => lookup(classPath, method, 'methods'),
    superclassOf: classPath => {
      const parent = index(canonicalClassKey(classPath))?.extendsType;
      return parent === undefined || parent === 'unresolved' ? undefined : sources.get(canonicalClassKey(parent))?.path;
    }
  };
}
