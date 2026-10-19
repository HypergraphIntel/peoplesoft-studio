import { maskNonCode, parseApplicationClassSource } from './applicationClassProgram.js';

/*
 * The checks App Designer's compiler makes that PeopleSoft Studio's encoder does
 * not: the encoder reproduces PeopleTools' bytes for valid programs (30,205 of
 * 30,209), but it was built to encode, so it accepts some programs App Designer
 * refuses. Each rule below holds for every delivered program in the HCDEV
 * snapshot (35,831 programs, 1,510 Application Classes; census in
 * docs/PEOPLECODE_RULES.md) and was broken by agent-written code:
 *
 *   PC001  a property's declaration and its get / set blocks disagree
 *          (readonly or plain with a get block; get without one; ...)
 *   PC002  an instance variable has a property's name
 *   PC003  Return with a value outside a function, method, get or set
 *          (event and App Engine PeopleCode cannot return a value; bare Return; is fine)
 *   PC004  a Local re-declares a parameter of its function or method, or an instance variable
 *   PC005  an Application Class is used with nothing imported from its package
 *   PC007  None / All / AllOrNone / OnlyOne / OnlyOneOrNone given a class instance
 *          variable or %This property (they take record fields, Locals and parameters)
 *   PC008  SQL.Fetch given a property or class instance variable as an output
 *          parameter (Fetch binds them by reference; fetch into Locals and assign)
 *   PC009  NumberToString given a printf conversion ("%04d"): the format is
 *          %<width>[.<decimals>][R T t v], and a stray letter corrupts the result
 *   PC010  a call that returns no value used as one (native 2,60): a listed
 *          built-in function, or a File method on a directly typed Local File
 *
 * Whether an imported class or package exists needs the database
 * (DatabaseProvider.peopleCodeImportProblems).
 */

export interface SemanticProblem { code: string; offset: number; message: string }

/** maskNonCode, and the compiler's /+ ... +/ signature comments too (they name classes but are not code). */
function mask(source: string, preserveStringDelimiters = false): string {
  return maskNonCode(source, preserveStringDelimiters).replace(/\/\+[\s\S]*?\+\//g, (m) => m.replace(/[^\n]/g, ' '));
}

const BLOCK_END = /^(end-if|else|end-evaluate|when|when-other|end-for|end-while|until|end-repeat|end-try|catch|end-function|end-method|end-get|end-set)\b/i;

/**
 * PC010's built-in functions that return nothing. Each one is documented "Returns:
 * None" in the PeopleTools 8.63 PeopleCode Language Reference AND is called at least
 * three times in the HCDEV snapshot without once being used as a value. Neither test
 * alone suffices: Gray, Hide, SetDefault, InsertRow and CommitWork are also never
 * used as values, but Oracle documents an (optional) Boolean for them -- and native
 * App Designer accepts &b = CommitWork(). Extend only with both kinds of evidence.
 */
const VOID_BUILTINS = new Set([
  'addjavascript', 'addmetatag', 'amortize', 'callappengine', 'collectgarbage', 'copyfromjavaarray',
  'createdirectory', 'discardrow', 'docancel', 'dosave', 'endmessage', 'endmodal', 'error', 'remotecall',
  'removedirectory', 'scrollflush', 'setcomponentchanged', 'setcursorpos', 'setsavewarningfilter',
  'setsearchdialogbehavior', 'settracesql', 'settransferattributes', 'startwork', 'stopfetching',
  'transfer', 'transferexact', 'updatevalue', 'viewcontenturl', 'viewcontenturlclassic',
  'viewcontenturlfluid', 'viewcontenturlmodeless', 'warning'
]);

/** PC010's File methods documented "Returns: None" (PeopleCode API Reference 8.63). ReadLine,
 *  WriteRecord, WriteRowset and SetFileLayout return Boolean and are not listed. */
const VOID_FILE_METHODS = ['Close', 'Delete', 'Open', 'SetPosition', 'WriteBase64StringToBinary', 'WriteLine', 'WriteRaw', 'WriteString'];

/** The masked text since the last ';' ends where a value is consumed. A keyword must not
 *  follow '-' (End-If, End-Evaluate), and Not / '(' may stack before the call. */
const VALUE_POSITION = /(?:(?<![\w-])(?:if|while|until|when|return|and|or|not|to|step|evaluate)\s+|[=<>+\-*/|,(]\s*)(?:not\s+|\(\s*)*$/i;

interface Body { kind: 'function' | 'method' | 'get' | 'set'; name: string; start: number; params: string[] }

/** Function, method, get and set bodies (offsets into the masked text). */
function bodies(m: string, isClass: boolean): Array<Body & { end: number }> {
  const out: Array<Body & { end: number }> = [];
  const classEnd = isClass ? (/\bend-class\b/i.exec(m)?.index ?? -1) : -1;
  const re = /(?<![\w&%.:-])(declare\s+function|end-function|end-method|end-get|end-set|function|method|get|set)\b/gi;
  let open: Body | undefined;
  for (let t = re.exec(m); t; t = re.exec(m)) {
    const word = t[1].toLowerCase().replace(/\s+/g, ' ');
    if (word === 'declare function') continue;
    if (word.startsWith('end-')) {
      if (open && word === `end-${open.kind}`) { out.push({ ...open, end: t.index }); open = undefined; }
      continue;
    }
    if (open) continue;
    const isMember = word === 'method' || word === 'get' || word === 'set';
    if (isMember && (!isClass || t.index < classEnd)) continue;
    const rest = m.slice(t.index + t[0].length);
    const name = /^\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(rest)?.[1];
    if (!name) continue;
    // A method / get / set implementation has no ';' on its header line; a get/set word elsewhere is an expression.
    const header = rest.slice(0, rest.search(/\n|$/));
    if (isMember && /;/.test(header)) continue;
    const params = word === 'function' ? [...(/^\s+\w+\s*\(([^)]*)\)/.exec(rest)?.[1] ?? '').matchAll(/&[A-Za-z0-9_#]+/g)].map((p) => p[0].toLowerCase()) : [];
    open = { kind: word as Body['kind'], name, start: t.index, params };
  }
  return out;
}

export function checkPeopleCodeSemantics(source: string, opts: { applicationClass: boolean }): SemanticProblem[] {
  const problems: SemanticProblem[] = [];
  const m = mask(source);
  const add = (code: string, offset: number, message: string) => problems.push({ code, offset, message });
  const parsed = opts.applicationClass ? parseApplicationClassSource(source) : undefined;
  const ownClass = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(m)?.[1]?.toUpperCase();

  // PC001 / PC002: properties and their get / set blocks; instance names.
  if (parsed) {
    const impl = (kind: 'get' | 'set', name: string) => parsed.implementations.find((i) => i.kind === kind && i.name.toLowerCase() === name.toLowerCase());
    const props = parsed.members.filter((x) => x.kind === 'property');
    for (const p of props) {
      if (p.kind !== 'property') continue;
      const g = impl('get', p.name), s = impl('set', p.name);
      const decl = `property ${p.type} ${p.name}`;
      if ((p.mode === 'readonly' || p.mode === 'plain') && g) {
        add('PC001', g.sourceIndex, `Property ${p.name} is declared ${p.mode === 'readonly' ? 'readonly' : 'without get'} but has a get block. A property with a get block is declared "${decl} get;" (add "set" if it has a set block); "readonly" is for a property with no get block.`);
      }
      if ((p.mode === 'readonly' || p.mode === 'plain') && s) add('PC001', s.sourceIndex, `Property ${p.name} has a set block but is not declared "get set".`);
      if (parsed.unitKind === 'class' && (p.mode === 'get' || p.mode === 'get-set') && !g) add('PC001', p.sourceIndex, `Property ${p.name} is declared "get" but the class has no "get ${p.name} ... end-get;" block.`);
      if (parsed.unitKind === 'class' && p.mode === 'get-set' && !s) add('PC001', p.sourceIndex, `Property ${p.name} is declared "get set" but the class has no "set ${p.name} ... end-set;" block.`);
      if (p.mode === 'get' && s) add('PC001', s.sourceIndex, `Property ${p.name} has a set block but is declared "get" only; declare it "${decl} get set;".`);
    }
    for (const i of parsed.implementations) {
      if (i.kind === 'method') continue;
      if (!props.some((p) => p.name.toLowerCase() === i.name.toLowerCase())) add('PC001', i.sourceIndex, `"${i.kind} ${i.name}" implements no declared property ${i.name}.`);
    }
    const propNames = new Set(props.map((p) => p.name.toLowerCase()));
    for (const x of parsed.members) {
      if (x.kind === 'instance' && propNames.has(x.name.replace(/^&/, '').toLowerCase())) {
        add('PC002', x.sourceIndex, `Instance variable &${x.name.replace(/^&/, '')} has the same name as property ${x.name.replace(/^&/, '')}; instance variables and properties must have different names.`);
      }
    }
  }

  // PC003 / PC004: Return values outside bodies; Locals re-declaring parameters or instance variables.
  const found = bodies(m, opts.applicationClass);
  const inside = (o: number) => found.find((b) => o > b.start && o < b.end);
  for (const r of m.matchAll(/(?<![\w&%.])return\b(?!s)/gi)) {
    if (inside(r.index!)) continue;
    const after = m.slice(r.index! + r[0].length).replace(/^\s+/, '');
    if (!after || after.startsWith(';') || BLOCK_END.test(after)) continue;
    add('PC003', r.index!, opts.applicationClass
      ? 'Return with a value outside a method, get or set block.'
      : 'Return with a value outside a function: event and App Engine PeopleCode cannot return a value. End the program with a bare "Return;", '
        + 'in App Engine PeopleCode use Exit(1) (the action\'s On Return setting decides what it does), or put the logic in a Function that returns the value.');
  }
  const instanceNames = new Set((parsed?.members ?? []).filter((x) => x.kind === 'instance').map((x) => `&${x.name.replace(/^&/, '')}`.toLowerCase()));
  for (const b of found) {
    let params = b.params;
    if (parsed && b.kind === 'method') params = (parsed.members.find((x) => x.kind === 'method' && x.name.toLowerCase() === b.name.toLowerCase()) as { parameters?: Array<{ name: string }> } | undefined)
      ?.parameters?.map((p) => p.name.toLowerCase()) ?? [];
    if (parsed && b.kind === 'set') params = ['&newvalue'];
    const text = m.slice(b.start, b.end);
    for (const d of text.matchAll(/\blocal\s+[%A-Za-z][A-Za-z0-9_:]*\s+(&[A-Za-z0-9_#]+(?:\s*,\s*&[A-Za-z0-9_#]+)*)/gi)) {
      for (const v of d[1].split(',').map((x) => x.trim())) {
        const at = b.start + d.index!;
        if (params.includes(v.toLowerCase())) add('PC004', at, `Local ${v} re-declares a parameter of ${b.kind} ${b.name}; use the parameter, or give the local another name.`);
        else if (b.kind !== 'function' && instanceNames.has(v.toLowerCase())) add('PC004', at, `Local ${v} in ${b.kind} ${b.name} re-declares the instance variable ${v}; use the instance variable, or give the local another name.`);
      }
    }
  }

  // PC005: classes used with nothing imported from their package.
  const imports = [...m.matchAll(/\bimport\s+([%A-Za-z0-9_]+(?::[A-Za-z0-9_*]+)+)\s*;/gi)].map((x) => x[1].toUpperCase());
  const code = m.replace(/\bimport\s+[^;]*;/gi, (x) => ' '.repeat(x.length));
  const reported = new Set<string>();
  for (const q of code.matchAll(/\b(?:create|as|local|global|component|instance|extends|implements|returns)\s+([A-Za-z][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+)\b/gi)) {
    const path = q[1].toUpperCase(), parts = path.split(':');
    if (parts[parts.length - 1] === ownClass || reported.has(path)) continue;
    if (imports.some((i) => i.split(':')[0] === parts[0])) continue;
    reported.add(path);
    add('PC005', q.index! + q[0].length - q[1].length, `${q[1]} is used but nothing from package ${parts[0]} is imported; add "import ${q[1]};" (or "import ${parts.slice(0, -1).join(':')}:*;") at the top.`);
  }
  for (const c of code.matchAll(/\bcreate\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi)) {
    const name = c[1].toUpperCase();
    if (name === ownClass || reported.has(name)) continue;
    if (imports.some((i) => i.endsWith(`:${name}`) || i.endsWith(':*'))) continue;
    reported.add(name);
    add('PC005', c.index! + c[0].indexOf(c[1]), `create ${c[1]}(...) names a class that is not imported; add "import <package>:${c[1]};" at the top (or use its full name and import it).`);
  }
  // PC007: the field-list functions on an instance variable or property (no delivered class does it; 273 have instance strings or dates).
  if (parsed) {
    for (const f of m.matchAll(/(?<![\w&%.:])(none|all|allornone|onlyone|onlyoneornone)\s*\(([^()]*)\)/gi)) {
      let at = f.index! + f[0].indexOf('(') + 1;
      for (const raw of f[2].split(',')) {
        const arg = raw.trim(), lower = arg.toLowerCase();
        const offset = at + raw.indexOf(arg);
        at += raw.length + 1;
        const body = found.find((b) => offset > b.start && offset < b.end);
        const locals = body ? [...m.slice(body.start, offset).matchAll(/\blocal\s+[%A-Za-z][\w:]*\s+(&[\w#]+(?:\s*,\s*&[\w#]+)*)/gi)]
          .flatMap((d) => d[1].split(',').map((v) => v.trim().toLowerCase())) : [];
        const methodParams = body?.kind === 'method' ? ((parsed.members.find((x) => x.kind === 'method' && x.name.toLowerCase() === body.name.toLowerCase()) as
          { parameters?: Array<{ name: string }> } | undefined)?.parameters ?? []).map((p) => p.name.toLowerCase()) : [];
        const shadowed = locals.includes(lower) || !!body?.params.includes(lower) || methodParams.includes(lower);
        if (instanceNames.has(lower) && !shadowed) {
          add('PC007', offset, `${f[1]}(${arg}): ${arg} is an instance variable; App Designer refuses it ("Field or temporary variable name required"). ${f[1]}() takes record fields, Locals and parameters: copy it into a Local first (Local date &d = ${arg}; If ${f[1]}(&d) Then ...), or for a date test IsDate(${arg}).`);
        } else if (/^%this\.[a-z_]\w*$/.test(lower)) {
          add('PC007', offset, `${f[1]}(${arg}): App Designer refuses a property here ("Field or temporary variable name required"); ${f[1]}() takes record fields, Locals and parameters. Copy the property into a Local first.`);
        }
      }
    }
  }
  // PC008: SQL.Fetch output parameters are bound by reference, so a property (reached
  // through a getter) and a class instance variable cannot be one. Proved live:
  // ZZ_BNV_FILE:Config.Load fetched into properties and App Engine abended with
  // "SQL.Fetch: parameter 1 is neither a record object nor a name. (2,284)".
  if (parsed) {
    const propNamesForFetch = new Set(parsed.members.filter((x) => x.kind === 'property').map((x) => `&${x.name.replace(/^&/, '')}`.toLowerCase()));
    for (const f of m.matchAll(/(?<![\w&%.:])&[\w#]+\s*\.\s*fetch\s*\(([^()]*)\)/gi)) {
      let at = f.index! + f[0].indexOf('(') + 1;
      for (const raw of f[1].split(',')) {
        const arg = raw.trim(), lower = arg.toLowerCase();
        const offset = at + raw.indexOf(arg);
        at += raw.length + 1;
        if (!arg) continue;
        const body = found.find((b) => offset > b.start && offset < b.end);
        const locals = body ? [...m.slice(body.start, offset).matchAll(/\blocal\s+[%A-Za-z][\w:]*\s+(&[\w#]+(?:\s*,\s*&[\w#]+)*)/gi)]
          .flatMap((d) => d[1].split(',').map((v) => v.trim().toLowerCase())) : [];
        if (locals.includes(lower) || !!body?.params.includes(lower)) continue;
        const what = instanceNames.has(lower) ? 'a class instance variable'
          : propNamesForFetch.has(lower) || /^%this\.[a-z_]\w*$/.test(lower) ? 'a property' : '';
        if (!what) continue;
        add('PC008', offset, `Fetch(${arg}): ${arg} is ${what}; SQL.Fetch binds its output parameters by reference and refuses one at run time ("SQL.Fetch: parameter 1 is neither a record object nor a name"). Fetch into Locals and assign afterwards (Local string &v; ... .Fetch(&v); ${arg} = &v;).`);
      }
    }
  }
  // PC009: NumberToString's format is PeopleSoft's, not printf. Its suffix letters are
  // R, T, t and v (rounding / thousands / value); a printf conversion such as "%04d"
  // is taken literally and corrupts the result -- "%04d" on 2026 produced "d-ba" on
  // HRDMO, which then went into the file as the plan year. Census of the snapshot: 48
  // distinct literal formats across 80 delivered programs, suffixes only t, T, v, Rt,
  // Tv, Rv, and not one format contains a "d".
  // maskNonCode blanks string literals but preserves every offset, so find the call on
  // the masked text and read the literal back out of the original source.
  for (const f of m.matchAll(/\bnumbertostring\s*\(/gi)) {
    let q = f.index! + f[0].length;
    while (q < source.length && /\s/.test(source[q]!)) q++;
    if (source[q] !== '"') continue;
    let j = q + 1;
    while (j < source.length && source[j] !== '"') j++;
    const fmt = source.slice(q + 1, j), sfx = /^%[#*0-9.]*([A-Za-z]*)$/.exec(fmt)?.[1];
    if (sfx && /[^RTtv]/.test(sfx)) {
      add('PC009', q, `NumberToString("${fmt}", ...): ${JSON.stringify(sfx)} is not a NumberToString format suffix. The format is %<width>[.<decimals>] with an optional R, T, t or v -- it is not printf, so a conversion letter like "d" is taken literally and corrupts the result ("%04d" on 2026 gives "d-ba"). Write "${fmt.replace(/[A-Za-z]+$/, '')}" for a zero-padded number, or String() when no padding is needed.`);
    }
  }
  // PC010: native App Designer rejects a call that returns nothing used as a value
  // with 2,60 -- ZZ_RF_EXPORT's If Not &out.WriteLine, then (validated unsaved)
  // &v = CollectGarbage() and If &out.Close(). CommitWork, documented Boolean, passed.
  // A preceding When = "literal" needs its literal token retained; masking it
  // entirely would make the following standalone call look like a RHS.
  const expressions = mask(source, true);
  // Direct conditions, assignments, operators, loop bounds and argument positions
  // consume a result. Standalone statements (including after Then, Else or a loop
  // header) are legal. Comments/strings are masked, preserving diagnostic offsets.
  const consumesValue = (offset: number) => VALUE_POSITION.test(expressions.slice(m.lastIndexOf(';', offset) + 1, offset));
  // Built-in functions: only the user's own Function / Declare Function / method
  // of the same name can shadow one, and a call through an object (.Name) is a method.
  const ownFunctions = new Set([...m.matchAll(/\b(?:function|method)\s+([A-Za-z_]\w*)/gi)].map((d) => d[1].toLowerCase()));
  for (const call of m.matchAll(/(?<![\w&%.:#])([A-Za-z_]\w*)\s*\(/g)) {
    const name = call[1].toLowerCase();
    if (!VOID_BUILTINS.has(name) || ownFunctions.has(name) || !consumesValue(call.index!)) continue;
    add('PC010', call.index!, `${call[1]} returns no result value (App Designer 2,60); call it as a statement, not a condition, assignment, operand or argument.`);
  }
  // File methods: resolve only explicitly typed Locals in the same body. Do not
  // infer a File from its name, an object receiver or a Local in a different
  // function, and leave an imported/custom File class alone. This is not a
  // general type checker.
  if (ownClass !== 'FILE' && !imports.some((p) => p.endsWith(':FILE') || p.endsWith(':*'))) {
    const localTypes = new Map<Body | undefined, Map<string, string>>();
    for (const d of m.matchAll(/\blocal\s+([%A-Za-z][\w:]*)\s+(&[\w#]+(?:\s*,\s*&[\w#]+)*)/gi)) {
      const scope = inside(d.index!);
      let types = localTypes.get(scope);
      if (!types) { types = new Map(); localTypes.set(scope, types); }
      for (const v of d[2].split(',').map((x) => x.trim().toLowerCase())) {
        const type = d[1].toLowerCase();
        types.set(v, types.has(v) && types.get(v) !== type ? 'unknown' : type);
      }
    }
    for (const call of m.matchAll(/(?<![\w&%.:])(&[\w#]+)\s*\.\s*([A-Za-z_]\w*)\s*\(/g)) {
      const method = VOID_FILE_METHODS.find((x) => x.toLowerCase() === call[2].toLowerCase());
      if (!method || localTypes.get(inside(call.index!))?.get(call[1].toLowerCase()) !== 'file' || !consumesValue(call.index!)) continue;
      add('PC010', call.index!, `${call[1]}.${method} returns no result value (App Designer 2,60); call it as a statement, not a condition, assignment or argument. File-method errors terminate the PeopleCode program; check &file.IsOpen after opening instead.`);
    }
  }
  return problems.sort((a, b) => a.offset - b.offset);
}

/** The problems as one message, each with its line number. */
export function describeSemanticProblems(source: string, problems: SemanticProblem[]): string {
  return problems.map((p) => `line ${source.slice(0, p.offset).split('\n').length}: ${p.message} (${p.code})`).join('\n');
}

/** Imports by kind, for the database check: explicit classes and wildcard packages. */
export function peopleCodeImports(source: string): Array<{ path: string; wildcard: boolean; offset: number }> {
  return [...mask(source).matchAll(/\bimport\s+([A-Za-z0-9_]+(?::[A-Za-z0-9_*]+)+)\s*;/gi)].map((x) => ({
    path: x[1], wildcard: x[1].endsWith(':*'), offset: x.index! + x[0].indexOf(x[1])
  }));
}
