/*
 * The signature comments App Designer writes into an Application Class's method bodies when
 * it saves the class, so a Studio save stores the source (and compiled bytes) App Designer would:
 *
 *   method getValue
 *      /+ &key as String, +/
 *      /+ &rows as Array of PKG:Row out +/
 *      /+ Returns Number +/
 *      /+ Extends/implements PKG:Base.getValue +/
 *
 * Rules, from the 8.61.15 corpus (10,108 of 10,119 method, get and set bodies; the rest are
 * comments left stale by later edits):
 *  - one line per parameter, in order: `&name as Type`, then ` out` for an out parameter,
 *    and a comma on every line but the last; then `Returns Type`; then `Extends/implements`.
 *  - get NAME: `Returns Type`; set NAME: `&NewValue as Type` (the property's type).
 *  - Types: built-in types in their canonical case (string -> String); `array of array of T`
 *    -> `Array2 of T`, a bare `array` -> `Array of Any`; a class by its full path in the
 *    package's own case (imports and wildcard imports resolved); `%metadata:` -> `%Metadata:`.
 *  - Extends/implements names the nearest ancestor (extends or implements, walking up) that
 *    declares the method publicly, or protected and abstract, with the ancestor's own casing of
 *    the method name. Private declarations, and protected ones that are not abstract, are
 *    passed over; a built-in parent class ends the walk.
 *  - The block replaces any `/+ ... +/` lines directly after the header, three spaces deeper than it.
 *    A constructor without parameters, or a method with nothing to say, gets no lines.
 */

export interface MemberDecl { name: string; params: { name: string; type: string; out: boolean }[]; returns?: string; abstract: boolean; section: 'public' | 'protected' | 'private' }
export interface PropertyDecl { name: string; type: string; abstract: boolean; section: 'public' | 'protected' | 'private' }
export interface ClassDecl { name: string; kind: 'class' | 'interface'; parent?: string; imports: string[]; methods: Map<string, MemberDecl>; properties: Map<string, PropertyDecl> }

/** Looks classes up in the database. Paths are colon-separated (PKG:SUB:Class). */
export interface SignatureResolver {
  /** The class's path in the database's own case, or undefined when there is no such class. */
  canonical(path: string): Promise<string | undefined>;
  /** The source of the class at a canonical path (stored or decoded), or undefined. */
  source(path: string): Promise<string | undefined>;
}

const BUILT_IN_TYPES = ['Any', 'AESection', 'ApiObject', 'Array', 'Boolean', 'Chart', 'Collection', 'Compound', 'Date', 'DateTime',
  'Document', 'Exception', 'Field', 'File', 'Grid', 'GridColumn', 'Integer', 'IntBroker', 'JavaObject', 'JsonArray', 'JsonBuilder',
  'JsonObject', 'JsonParser', 'Map', 'MapElement', 'Message', 'Number', 'Object', 'Page', 'Primitive', 'ProcessRequest', 'Record',
  'Request', 'Response', 'Row', 'Rowset', 'SQL', 'String', 'Time', 'XmlDoc', 'XmlNode'];
const BUILT_IN = new Map(BUILT_IN_TYPES.map((t) => [t.toLowerCase(), t]));

/** The source with comments and string literals blanked, keeping every offset. */
export function maskSource(source: string): string {
  // One left-to-right scan, so a quote inside a comment (or a comment marker inside a string)
  // cannot run away; strings are single-line, in either quote.
  return source.replace(/\/\*[\s\S]*?\*\/|<\*[\s\S]*?\*>|\/\+[\s\S]*?\+\/|^[ \t]*REM\b[^;]*;|"(?:[^"\n]|"")*"|'(?:[^'\n]|'')*'/gim,
    (m) => m.replace(/[^\n]/g, ' '));
}

const words = (s: string) => s.trim().split(/\s+/).join(' ');

export function parseClassDeclaration(source: string): ClassDecl | undefined {
  const s = maskSource(source);
  const imports = [...s.matchAll(/^\s*import\s+([^;]+);/gim)].map((m) => m[1].replace(/\s+/g, ''));
  const head = /\b(class|interface)\s+(\w+)(?:\s+(?:extends|implements)\s+([\w:%]+))?([\s\S]*?)\bend-(?:class|interface)\s*;/i.exec(s);
  if (!head) return undefined;
  const body = head[4];
  const at = (word: string) => { const m = new RegExp(`\\b${word}\\b`, 'i').exec(body); return m ? m.index : body.length; };
  const protectedAt = at('protected'), privateAt = at('private');
  const section = (offset: number): MemberDecl['section'] => offset >= privateAt ? 'private' : offset >= protectedAt ? 'protected' : 'public';
  const methods = new Map<string, MemberDecl>();
  for (const m of body.matchAll(/\bmethod\s+(\w+)\s*(?:\(([\s\S]*?)\))?\s*(?:Returns\s+([\w:%]+(?:\s+of\s+[\w:%]+)*))?\s*(abstract)?\s*;/gi)) {
    const params = (m[2] ?? '').split(',').map((p) => /^\s*(&[\w#$@]+)\s+as\s+([\s\S]+?)(\s+out)?\s*$/i.exec(p)).filter((p): p is RegExpExecArray => !!p)
      .map((p) => ({ name: p[1], type: words(p[2]), out: !!p[3] }));
    methods.set(m[1].toLowerCase(), { name: m[1], params, returns: m[3] ? words(m[3]) : undefined, abstract: !!m[4], section: section(m.index!) });
  }
  const properties = new Map<string, PropertyDecl>();
  for (const m of body.matchAll(/\bproperty\s+([\w:%]+(?:\s+of\s+[\w:%]+)*)\s+(\w+)((?:\s+(?:get|set|readonly|abstract))*)\s*;/gi)) {
    properties.set(m[2].toLowerCase(), { name: m[2], type: words(m[1]), abstract: /\babstract\b/i.test(m[3]), section: section(m.index!) });
  }
  return { name: head[2], kind: head[1].toLowerCase() as ClassDecl['kind'], parent: head[3], imports, methods, properties };
}

const packageOf = (path: string) => path.slice(0, path.lastIndexOf(':'));

/** A class name as written in the program at `path`: its canonical full path, or undefined (built-in or unknown). */
async function resolveClass(name: string, cls: ClassDecl, path: string, resolver: SignatureResolver): Promise<string | undefined> {
  if (name.includes(':')) return resolver.canonical(name);
  const lower = name.toLowerCase();
  for (const imp of cls.imports) if (imp.toLowerCase().endsWith(':' + lower)) return resolver.canonical(imp);
  for (const imp of cls.imports) if (imp.endsWith(':*')) { const found = await resolver.canonical(imp.slice(0, -1) + name); if (found) return found; }
  return resolver.canonical(packageOf(path) + ':' + name);
}

export async function signatureType(type: string, cls: ClassDecl, path: string, resolver: SignatureResolver): Promise<string> {
  const parts = type.trim().split(/\s+/);
  let dims = 0;
  while (parts.length >= 3 && /^array\d?$/i.test(parts[0]) && parts[1].toLowerCase() === 'of') { dims += Number(parts[0].slice(5) || 1); parts.splice(0, 2); }
  if (parts.length === 1 && /^array\d?$/i.test(parts[0])) { dims += Number(parts[0].slice(5) || 1); parts.splice(0, 1, 'Any'); }
  const element = parts.join(' ');
  let named: string;
  if (BUILT_IN.has(element.toLowerCase())) named = BUILT_IN.get(element.toLowerCase())!;
  else if (/^%metadata:/i.test(element)) named = '%Metadata' + element.slice(9);
  else named = (await resolveClass(element, cls, path, resolver)) ?? element;
  return dims === 0 ? named : `${dims === 1 ? 'Array' : 'Array' + dims} of ${named}`;
}

/** The nearest ancestor that declares the member publicly, or protected and abstract; with its casing of the name. */
async function declaringAncestor(member: string, cls: ClassDecl, path: string, resolver: SignatureResolver, cache: Map<string, ClassDecl | undefined>): Promise<{ path: string; name: string } | undefined> {
  const lower = member.toLowerCase();
  const seen = new Set<string>();
  let current = cls, currentPath = path;
  while (current.parent) {
    const parentPath = await resolveClass(current.parent, current, currentPath, resolver);
    if (!parentPath || seen.has(parentPath)) return undefined; // a built-in parent class, or a cycle
    seen.add(parentPath);
    if (!cache.has(parentPath)) { const src = await resolver.source(parentPath); cache.set(parentPath, src === undefined ? undefined : parseClassDeclaration(src)); }
    const parent = cache.get(parentPath);
    if (!parent) return undefined;
    const decl = parent.methods.get(lower) ?? parent.properties.get(lower);
    if (decl && (decl.section === 'public' || (decl.section === 'protected' && decl.abstract))) return { path: parentPath, name: decl.name };
    current = parent; currentPath = parentPath;
  }
  return undefined;
}

/** The comment lines (without /+ +/) App Designer writes for one method, get or set body. */
export async function signatureLines(kind: 'method' | 'get' | 'set', member: string, cls: ClassDecl, path: string, resolver: SignatureResolver,
  cache = new Map<string, ClassDecl | undefined>()): Promise<string[] | undefined> {
  const out: string[] = [];
  if (kind === 'method') {
    const m = cls.methods.get(member.toLowerCase());
    if (!m) return undefined;
    for (const [i, p] of m.params.entries()) out.push(`${p.name} as ${await signatureType(p.type, cls, path, resolver)}${p.out ? ' out' : ''}${i < m.params.length - 1 ? ',' : ''}`);
    if (m.returns) out.push(`Returns ${await signatureType(m.returns, cls, path, resolver)}`);
  } else {
    const p = cls.properties.get(member.toLowerCase());
    if (!p) return undefined;
    out.push(kind === 'get' ? `Returns ${await signatureType(p.type, cls, path, resolver)}` : `&NewValue as ${await signatureType(p.type, cls, path, resolver)}`);
  }
  const ancestor = await declaringAncestor(member, cls, path, resolver, cache);
  if (ancestor) out.push(`Extends/implements ${ancestor.path}.${ancestor.name}`);
  return out;
}

const HEADER = /^(method|get|set)\s+(\w+)\s*$/i;
const COMMENT_LINE = /^\s*\/\+.*\+\/(;?)\s*$/;

/** The class source with each body's signature comments written as App Designer writes them. */
export async function addSignatureComments(source: string, path: string, resolver: SignatureResolver): Promise<string> {
  const cls = parseClassDeclaration(source);
  if (!cls || cls.kind !== 'class') return source;
  const masked = maskSource(source).split('\n');
  const lines = source.split('\n');
  const end = masked.findIndex((l) => /\bend-class\s*;/i.test(l));
  if (end < 0) return source;
  const cache = new Map<string, ClassDecl | undefined>();
  const out = lines.slice(0, end + 1);
  for (let i = end + 1; i < lines.length; i++) {
    out.push(lines[i]);
    const header = HEADER.exec(masked[i].trim());
    if (!header) continue;
    const generated = await signatureLines(header[1].toLowerCase() as 'method' | 'get' | 'set', header[2], cls, path, resolver, cache);
    if (!generated) continue;
    // Replace the comment lines already there; a statement terminator App Designer left after the block stays.
    let j = i + 1, trailing = '';
    while (j < lines.length && COMMENT_LINE.test(lines[j])) { trailing = COMMENT_LINE.exec(lines[j])![1] || trailing; j++; }
    const indent = /^[ \t]*/.exec(lines[i])![0] + '   ';
    const block = generated.map((l) => `${indent}/+ ${l} +/`);
    if (trailing && block.length) block[block.length - 1] += trailing;
    else if (trailing) block.push(indent + trailing);
    out.push(...block);
    i = j - 1;
  }
  return out.join('\n');
}
