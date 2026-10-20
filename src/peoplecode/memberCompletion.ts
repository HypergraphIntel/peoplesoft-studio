import type { ApplicationClassProgram } from './applicationClassProgram.js';

/*
 * Completion of an application-class object's members after `&obj.`, `%This.`
 * and `%Super.`. This is not type inference: `&obj` must have an explicit class
 * type in the program -- a `Local/Component/Global/instance CLASS &obj`
 * declaration, or a `&obj As CLASS` parameter -- so the members offered are
 * always the real members of a known class. A class named without its package
 * is found as App Designer finds it: through the program's imports, else in its
 * own package. The provider reads the class (and its `extends` chain) and asks
 * classMembers for each: public members from outside, and inside the class
 * (%This) its own private members too, with protected members inherited.
 */

const CLASS_PATH = '[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+';

/** The application-class path (split into key parts) declared for `&varName` in `text`, or undefined. */
export function declaredClassOf(text: string, varName: string): string[] | undefined {
  const v = varName.replace(/^&/, '').replace(/[.$^|?*+()[\]{}\\]/g, '');
  if (!v) return undefined;
  const decl = new RegExp(`\\b(?:Local|Component|Global|instance)\\s+(${CLASS_PATH})\\s+&${v}\\b`, 'i').exec(text);
  const param = new RegExp(`&${v}\\s+As\\s+(${CLASS_PATH})\\b`, 'i').exec(text);
  const m = decl ?? param;
  return m ? m[1].split(':') : undefined;
}

export interface MemberCompletion {
  name: string;
  kind: 'method' | 'property' | 'constant';
  detail: string;
}

/** The public members of a parsed class, as completion items (methods, properties, constants). */
export function publicMembers(program: ApplicationClassProgram): MemberCompletion[] {
  return classMembers(program, ['public']);
}

/**
 * The members of a parsed class with one of `visibilities`, as completion
 * items. `fromInside` (%This, %Super) leaves out the constructor, which is not
 * called through an object, and instance variables, which are written &name.
 */
export function classMembers(program: ApplicationClassProgram, visibilities: readonly string[], fromInside = false): MemberCompletion[] {
  const out: MemberCompletion[] = [];
  for (const mem of program.members) {
    if (!visibilities.includes(mem.visibility)) continue;
    if (fromInside && mem.kind === 'method' && mem.name.toLowerCase() === program.className.toLowerCase()) continue;
    if (fromInside && mem.kind === 'instance') continue;
    if (mem.kind === 'method') {
      out.push({ name: mem.name, kind: 'method', detail: `method${mem.returnType ? ` Returns ${mem.returnType}` : ''}` });
    } else if (mem.kind === 'property' || mem.kind === 'instance') {
      out.push({ name: mem.name, kind: 'property', detail: mem.type ? `property ${mem.type}` : 'property' });
    } else if (mem.kind === 'constant') {
      out.push({ name: mem.name, kind: 'constant', detail: 'constant' });
    }
  }
  return out;
}

/** The qualified class a program extends, split into key parts, or undefined (none, or an unqualified name). */
export function qualifiedExtends(program: ApplicationClassProgram): string[] | undefined {
  const base = program.extendsType;
  return base && new RegExp(`^${CLASS_PATH}$`).test(base) ? base.split(':') : undefined;
}

/** The program's `import` statements: exact class paths and `PKG:*` packages, each split into key parts. */
export function importsOf(text: string): { classes: string[][]; packages: string[][] } {
  const classes: string[][] = [], packages: string[][] = [];
  for (const m of text.matchAll(/^\s*import\s+([A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)*)(:\*)?\s*;/gim)) {
    (m[2] ? packages : classes).push(m[1].split(':'));
  }
  return { classes, packages };
}

/**
 * Where a class named in a program may be, most likely first: a qualified path
 * as written; a bare name through an exact import, the `PKG:*` imports, then
 * the program's own package (`ownPackage`, the class's key parts without its name).
 */
export function classCandidates(name: string, text: string, ownPackage?: readonly string[]): string[][] {
  if (name.includes(':')) return [name.split(':')];
  const { classes, packages } = importsOf(text);
  const lower = name.toLowerCase();
  const out: string[][] = [];
  const add = (parts: string[]) => { if (!out.some((o) => o.join(':').toLowerCase() === parts.join(':').toLowerCase())) out.push(parts); };
  for (const c of classes) if (c[c.length - 1].toLowerCase() === lower) add(c);
  for (const p of packages) add([...p, name]);
  if (ownPackage?.length) add([...ownPackage, name]);
  return out;
}

/** PeopleCode's own types, never application classes. */
const BUILT_IN_TYPES = new Set(['any', 'array', 'boolean', 'date', 'datetime', 'float', 'integer', 'number', 'object', 'string', 'time',
  'record', 'row', 'rowset', 'field', 'sql', 'file', 'message', 'xmldoc', 'xmlnode', 'jsonobject', 'jsonarray', 'jsonparser', 'jsonbuilder',
  'jsonvalue', 'jsongenerator', 'api', 'apiobject', 'chart', 'grid', 'gridcolumn', 'page', 'aesection', 'crypt', 'exception', 'intbroker',
  'mcfimclient', 'packagemanager', 'pagelet', 'postreport', 'processrequest', 'query', 'response', 'request', 'session', 'tree', 'treenode']);

/** Whether a type name is one of PeopleCode's own (Rowset, Exception ...), which no application class source defines. */
export function isBuiltInType(name: string): boolean {
  return BUILT_IN_TYPES.has(name.toLowerCase());
}

/** The class `&varName` is declared as in `text` (qualified, or a bare imported name), or undefined. */
export function declaredTypeOf(text: string, varName: string): string | undefined {
  const v = varName.replace(/^&/, '').replace(/[.$^|?*+()[\]{}\\]/g, '');
  if (!v) return undefined;
  const type = '[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)*';
  const decl = new RegExp(`\\b(?:Local|Component|Global|instance)\\s+(${type})\\s+&${v}\\b`, 'i').exec(text);
  const param = new RegExp(`&${v}\\s+As\\s+(${type})\\b`, 'i').exec(text);
  const name = (decl ?? param)?.[1];
  return name && !BUILT_IN_TYPES.has(name.toLowerCase()) ? name : undefined;
}

/**
 * The members a class header declares, read from its declaration lines when
 * the class does not parse (Studio's parser stops at constructs it does not
 * model yet): methods, properties and constants up to `end-class`, with the
 * section each falls in. Used so %This still completes in such a class.
 */
export function headerMembers(text: string): Array<MemberCompletion & { visibility: string; extendsType?: string }> {
  const header = /\bclass\s+([A-Za-z_]\w*)(?:\s+extends\s+([A-Za-z_][\w:]*))?([\s\S]*?)\bend-class\b/i.exec(text);
  if (!header) return [];
  const [, className, extendsType, body] = header;
  const out: Array<MemberCompletion & { visibility: string; extendsType?: string }> = [];
  let visibility = 'public';
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\/\*[\s\S]*?\*\/|\/\+[\s\S]*?\+\//g, '').trim();
    if (/^(protected|private)\b/i.test(line)) { visibility = line.split(/\W/)[0].toLowerCase(); continue; }
    const method = /^method\s+([A-Za-z_]\w*)\s*\(/i.exec(line);
    if (method && method[1].toLowerCase() !== className.toLowerCase()) {
      const returns = /\bReturns\s+([\w:]+)/i.exec(line)?.[1];
      out.push({ name: method[1], kind: 'method', detail: `method${returns ? ` Returns ${returns}` : ''}`, visibility, ...(extendsType ? { extendsType } : {}) });
      continue;
    }
    const property = /^property\s+([\w:]+)\s+([A-Za-z_]\w*)/i.exec(line);
    if (property) { out.push({ name: property[2], kind: 'property', detail: `property ${property[1]}`, visibility }); continue; }
    const constant = /^constant\s+&([A-Za-z_]\w*)/i.exec(line);
    if (constant) out.push({ name: `&${constant[1]}`, kind: 'constant', detail: 'constant', visibility });
  }
  return out;
}

/** The base class a class header names, when the class does not parse. */
export function headerExtends(text: string): string | undefined {
  return /\bclass\s+[A-Za-z_]\w*\s+extends\s+([A-Za-z_][\w:]*)/i.exec(text)?.[1];
}
