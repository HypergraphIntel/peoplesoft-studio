import { mask } from './semanticCheck.js';
import { KNOWN_BUILTIN_FUNCTIONS } from './builtinFunctions.js';

/*
 * App Designer's "Unknown function. (2,15)": a call to a name that is neither
 * a PeopleTools built-in nor a function this program declares (Function,
 * Declare Function) nor a method it defines. Native Validate Syntax on
 * ZZ_PCODE_LAB_R2.ZZ_PCODE_LAB_MCP1.FieldChange, 2026-10-19.
 *
 * Studio's compiler stores calls by name and so does not catch this; the
 * built-ins known here are every function called undeclared somewhere in
 * the 35,831 programs of the HCDEV snapshot (all accepted by App Designer)
 * plus those Studio documents (builtinFunctions.ts). A real built-in no HCM
 * program calls would be reported too, so this is a Validate warning only:
 * it never blocks a save (semanticCheck.ts holds the rules that do).
 */

/** Words written before a parenthesis that are statements or operators, not calls. */
const NOT_CALLS = new Set([
  'if', 'while', 'for', 'until', 'when', 'evaluate', 'not', 'and', 'or', 'return', 'then', 'else', 'to', 'step',
  'break', 'exit', 'repeat', 'throw', 'catch', 'try', 'of', 'as', 'out', 'value', 'create', 'import', 'class',
  'method', 'function', 'get', 'set', 'property', 'returns', 'extends', 'implements', 'instance', 'constant',
  'local', 'global', 'component', 'declare', 'library', 'peoplecode', 'readonly', 'abstract', 'interface',
  'private', 'protected', 'end-if', 'end-for', 'end-while', 'end-evaluate', 'end-try', 'end-method',
  'end-function', 'end-get', 'end-set', 'end-class', 'end-interface', 'when-other', 'super'
]);

export interface FunctionCall {
  name: string;
  offset: number;
}

/** Calls of plain names in a program (not methods, not class constructors), with the functions and methods it declares. */
export function functionCalls(source: string): { calls: FunctionCall[]; declared: Set<string> } {
  const m = mask(source);
  const declared = new Set([...m.matchAll(/\b(?:function|method)\s+([A-Za-z_]\w*)/gi)].map((d) => d[1].toLowerCase()));
  const calls: FunctionCall[] = [];
  for (const call of m.matchAll(/(?<![\w&%.:#$@-])([A-Za-z_][\w]*)\s*\(/g)) {
    const name = call[1];
    const lower = name.toLowerCase();
    if (NOT_CALLS.has(lower)) continue;
    // "create Name(": a class constructor by its imported short name.
    if (/\bcreate\s+$/i.test(m.slice(Math.max(0, call.index! - 12), call.index!))) continue;
    calls.push({ name, offset: call.index! });
  }
  return { calls, declared };
}

export interface UnknownFunction {
  offset: number;
  name: string;
  message: string;
}

/** The calls App Designer would refuse as unknown functions. */
export function unknownFunctions(source: string, known: ReadonlySet<string> = KNOWN_BUILTIN_FUNCTIONS): UnknownFunction[] {
  const { calls, declared } = functionCalls(source);
  return calls.filter((c) => !declared.has(c.name.toLowerCase()) && !known.has(c.name.toLowerCase()))
    .map((c) => ({ offset: c.offset, name: c.name, message: `Unknown function ${c.name}: not declared in this program and not a PeopleTools built-in Studio knows (App Designer 2,15 "Unknown function").` }));
}
