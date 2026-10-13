import type { ApplicationClassProgram } from './applicationClassProgram.js';

/*
 * Completion of an application-class object's members after `&obj.`. This is
 * not type inference: it only fires when `&obj` has an explicit class type in
 * the program -- a `Local/Component/Global/instance PKG:SUB:CLASS &obj`
 * declaration, or a `&obj As PKG:SUB:CLASS` parameter -- so the members offered
 * are always the real public members of a known class. The provider reads the
 * class (and its qualified `extends` chain) and asks publicMembers for each.
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
  const out: MemberCompletion[] = [];
  for (const mem of program.members) {
    if (mem.visibility !== 'public') continue;
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
