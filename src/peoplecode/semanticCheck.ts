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
 *   PC004  a Local re-declares a parameter of its function or method, an instance variable, a stored property (native 2,39) or a class constant (2,66)
 *   PC005  an Application Class is used with nothing imported from its package
 *   PC007  None / All / AllOrNone / OnlyOne / OnlyOneOrNone given a class instance
 *          variable, a %This property, a property of an Application Class object
 *          or a call result such as RTrim(&s) (they take record fields, Locals and parameters)
 *   PC008  SQL.Fetch given a property or class instance variable as an output
 *          parameter (Fetch binds them by reference; fetch into Locals and assign)
 *   PC009  NumberToString given a printf conversion ("%04d"): the format is
 *          %<width>[.<decimals>][R T t v], and a stray letter corrupts the result
 *   PC010  a call that returns no value used as one (native 2,60): a listed
 *          built-in function, or a File method on a directly typed Local File
 *   PC011  a member used straight off a create expression (create X().Method())
 *   PC012  a method parameter named after a stored property (native 2,31) or an instance variable of its class
 *   PC013  a readonly property assigned through %This instead of its &variable (native 2,46)
 *   PC014  a declaration naming several variables with an initialiser (Local integer &i, &n = 0;) (native 2,42)
 *   PC015  .ParentRow on a Row (GetRow().ParentRow): it is a Rowset property (native 2,52)
 *   PC016  a class method declared without a body (run time 2,81; App Designer's syntax check misses it)
 *   PC017  a string literal longer than 999 characters (loading the program crashes App Designer and the app server)
 *   PC018  True, False or Null after a dot (Boolean.TRUE): they are keywords, not names (native 2,49)
 *   PC019  an array of integer given CreateArrayRept / CreateArray of a number literal (run time 180,604; Validate Syntax misses it)
 *   PC020  %Request.Method: the Request class has no Method property; it is HTTPMethod (native 2,50)
 *   PC021  a value-returning method of the class called through %This as a statement on its own (native 2,45)
 *   PC022  a method or property named after a PeopleCode keyword (Alias, Step, Error, ...) (native 2,42)
 *
 * Whether an imported class or package exists needs the database
 * (DatabaseProvider.peopleCodeImportProblems).
 */

export interface SemanticProblem { code: string; offset: number; message: string }

/** maskNonCode, and the compiler's /+ ... +/ signature comments too (they name classes but are not code). */
/** The source with comments and string contents blanked, offsets preserved. */
export function mask(source: string, preserveStringDelimiters = false): string {
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
    // PC013: a readonly property is assigned inside its class through its variable (&Name = ...); assigning it
    // through %This is App Designer's 2,46 "property cannot be changed" -- a lab class's %This.Id = ... failed in
    // PIA (demo lab, 2026-10-26). Delivered classes assign readonly properties as &Name
    // 1,156 times and never through %This. A %This.Name = after an operator, "(", "," or a condition keyword is a
    // comparison on a continued line (PSXP_RPTDEFNMANAGER:DataSourceDefn's "If Not (%This.Type = "QRY" Or" ...).
    const readonly = new Set(props.filter((p) => p.kind === 'property' && p.mode === 'readonly').map((p) => p.name.replace(/^&/, '').toLowerCase()));
    for (const a of m.matchAll(/%this\.([A-Za-z_]\w*)\s*=(?!=)/gi)) {
      if (!readonly.has(a[1].toLowerCase())) continue;
      const before = m.slice(0, a.index!).trimEnd();
      if (/[(,=<>|+\-*/]$/.test(before) || /\b(?:or|and|not|if|when|until|while|return|to|step)$/i.test(before)) continue;
      add('PC013', a.index!, `%This.${a[1]} = ...: ${a[1]} is a readonly property, and App Designer refuses an assignment through %This (2,46, "property cannot be changed"). Inside the class assign it through its variable: &${a[1]} = ...`);
    }
    // PC016: every method a class declares (other than an abstract one) needs a "method Name ... end-method" body.
    // App Designer's Validate Syntax accepts the class without it, but at run time PIA stops with "Method Line has
    // no body (2,81)" -- a lab class saved without its last method on the demo lab (2026-10-27). Every concrete method of
    // the 1,510 classes in the 8.61 lab snapshot has a body.
    if (parsed.unitKind === 'class') {
      for (const x of parsed.members) {
        if (x.kind !== 'method' || x.abstract) continue;
        if (!parsed.implementations.some((i) => i.kind === 'method' && i.name.toLowerCase() === x.name.toLowerCase())) {
          add('PC016', x.sourceIndex, `Method ${x.name} is declared but has no "method ${x.name} ... end-method;" body. App Designer's syntax check accepts this, but the class stops at run time ("Method ${x.name} has no body", 2,81). Add the body, or declare the method abstract.`);
        }
      }
    }
    // PC021: a method of the class that returns a value cannot be called through %This as a statement on its own.
    // App Designer refuses it with 2,45 "Invalid start of statement" (a lab class's "%This.Done(...);" with
    // Done(...) Returns string, 8.61 lab, 2026-11-03); Studio's checks and the encoder accepted it, and PIA then
    // failed to compile the class. Delivered classes in the 8.61 lab snapshot always use such a result.
    if (parsed.unitKind === 'class') {
      const returning = new Set(parsed.members.filter((x) => x.kind === 'method' && x.returnType).map((x) => x.name.toLowerCase()));
      for (const c of m.matchAll(/%this\s*\.\s*([A-Za-z_]\w*)\s*\(/gi)) {
        if (!returning.has(c[1].toLowerCase())) continue;
        const before = m.slice(0, c.index!).trimEnd();
        const lastLine = before.slice(before.lastIndexOf('\n') + 1);
        const startsStatement = before.endsWith(';') || /\b(?:then|else|repeat|try|end-try)$/i.test(before)
          || /^\s*(?:method\s+\w+|catch\s+\w+\s+&\w+|for\s.*|while\s.*|when\b.*|when-other)\s*$/i.test(lastLine);
        if (!startsStatement) continue;
        let depth = 0, i = c.index! + c[0].length - 1;
        for (; i < m.length; i++) {
          if (m[i] === '(') depth++;
          else if (m[i] === ')' && --depth === 0) break;
        }
        if (!/^\s*;/.test(m.slice(i + 1))) continue;
        add('PC021', c.index!, `%This.${c[1]}(...) returns a value, so it cannot be a statement on its own: App Designer refuses it (2,45, "Invalid start of statement"). Use the result, e.g. "&result = %This.${c[1]}(...);".`);
      }
    }
    // PC022: a method or property named after a PeopleCode keyword. App Designer refused "method Alias(&rec As string)"
    // with 2,42 "Syntax error: expecting Identifier" (a lab class, 8.61 lab, 2026-11-03), and a property named Error
    // earlier. Delivered classes use only Create, Value and Component of the keywords as member names (1,510 classes in
    // the 8.61 lab snapshot), so those three stay allowed and every other keyword is refused.
    if (parsed.unitKind === 'class') {
      const reserved = new Set(['alias', 'and', 'as', 'break', 'catch', 'componentlife', 'constant', 'else', 'error', 'evaluate', 'exit', 'false', 'for', 'function', 'global', 'if', 'import', 'library', 'local', 'not', 'null', 'or', 'panelgroup', 'ref', 'repeat', 'return', 'returns', 'step', 'then', 'throw', 'to', 'true', 'try', 'until', 'warning', 'when', 'while']);
      for (const x of parsed.members) {
        if ((x.kind === 'method' || x.kind === 'property') && reserved.has(x.name.toLowerCase())) {
          add('PC022', x.sourceIndex, `${x.kind === 'method' ? 'Method' : 'Property'} ${x.name} is named after a PeopleCode keyword: App Designer refuses it (2,42, "Syntax error: expecting Identifier"). Rename it (e.g. Template${x.name}).`);
        }
      }
    }
    // PC012: a stored property (no get / set block) is held like an instance variable, so a method parameter of the
    // same name is App Designer's 2,31 "Duplicate parameter name" -- a lab class's constructor (&config) with
    // property Config failed in PIA (demo lab, 2026-10-26). None of the 1,640 delivered classes in
    // the 8.61 lab snapshot does it; 13 name a parameter after a get / set property, which is allowed.
    // An instance variable itself is refused the same way: a handler with `instance number &record;` and
    // `method Who(&emplid As string, &record As number, ...)` saved and decoded cleanly but PIA reported
    // "Class ... was not found" (180,74) and App Designer 2,31 "Duplicate parameter name" (8.61 lab, 2026-10-31). None of the 1,493 delivered classes
    // (518 with instance variables) names a parameter after one.
    const stored = new Set(props.filter((p) => !impl('get', p.name) && !impl('set', p.name)).map((p) => p.name.replace(/^&/, '').toLowerCase()));
    const instances = new Set(parsed.members.filter((x) => x.kind === 'instance').map((x) => x.name.replace(/^&/, '').toLowerCase()));
    for (const x of parsed.members) {
      if (x.kind !== 'method') continue;
      for (const a of x.parameters) {
        const bare = a.name.replace(/^&/, '');
        if (stored.has(bare.toLowerCase())) add('PC012', x.sourceIndex, `Method ${x.name}'s parameter &${bare} has the name of property ${bare}, which has no get / set block and is stored like an instance variable: App Designer refuses it (2,31, "Duplicate parameter name"). Rename the parameter (e.g. &new${bare[0].toUpperCase()}${bare.slice(1)}).`);
        else if (instances.has(bare.toLowerCase())) add('PC012', x.sourceIndex, `Method ${x.name}'s parameter &${bare} has the name of instance variable &${bare}: App Designer refuses it (2,31, "Duplicate parameter name"), and at run time PIA reports the class as not found (180,74). Rename the parameter (e.g. &new${bare[0].toUpperCase()}${bare.slice(1)}).`);
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
  // A readonly property with no get block is stored as an instance variable, so a Local of its name is App Designer's
  // 2,39 "Duplicate temporary variable declaration" (a lab class, 8.61 lab, 2026-10-30). The 1,492 delivered classes in
  // the 8.61 lab snapshot hold 1,193 such properties and never declare a Local of their name.
  // A writable property with no get / set block is stored the same way: `Local string &problem;` beside
  // `property string Problem;` compiled nowhere at run time (2,39, 8.61 lab, 2026-11-02) until the Local was renamed.
  // The one delivered class that does it (PSRF_REPORT_CREATE:CreateReport, 17 such Locals) is left as an old exception.
  const hasAccessor = (name: string) => (parsed?.implementations ?? []).some((i) => (i.kind === 'get' || i.kind === 'set') && i.name.toLowerCase() === name.toLowerCase());
  const storedNames = new Map((parsed?.members ?? []).filter((x) => x.kind === 'property' && (x.mode === 'readonly' || !hasAccessor(x.name)))
    .map((x) => [`&${x.name.replace(/^&/, '')}`.toLowerCase(), x.name.replace(/^&/, '')]));
  // A class constant shares the name space too: a Local of its name is App Designer's 2,66 "Constant used in
  // inappropriate context" (a lab class, 8.61 lab, 2026-10-30: Local object &service with Constant &SERVICE). The 83
  // delivered classes with constants in the 8.61 lab snapshot never declare a Local of a constant's name.
  const constantNames = new Map((parsed?.members ?? []).filter((x) => x.kind === 'constant')
    .map((x) => [`&${x.name.replace(/^&/, '')}`.toLowerCase(), x.name]));
  // Method parameters and instance variables share the constant's name space as well: "method Build(... &signals ...)"
  // beside Constant &SIGNALS is App Designer's 2,66 "Constant used in inappropriate context" (a lab class, 8.61 lab,
  // 2026-11-03), and so is "instance array of string &ops" beside Constant &OPS (fixed there by renaming the constant).
  if (parsed) {
    for (const x of parsed.members) {
      const names = x.kind === 'method' ? x.parameters.map((p) => p.name) : x.kind === 'instance' ? [x.name] : [];
      for (const n of names) {
        const v = `&${n.replace(/^&/, '')}`;
        if (constantNames.has(v.toLowerCase())) add('PC004', x.sourceIndex, `${x.kind === 'method' ? `Parameter ${v} of method ${x.name}` : `Instance variable ${v}`} has the name of class constant ${constantNames.get(v.toLowerCase())} (names ignore case): App Designer refuses it (2,66, "Constant used in inappropriate context"). Rename one of them.`);
      }
    }
  }
  for (const b of found) {
    let params = b.params;
    if (parsed && b.kind === 'method') params = (parsed.members.find((x) => x.kind === 'method' && x.name.toLowerCase() === b.name.toLowerCase()) as { parameters?: Array<{ name: string }> } | undefined)
      ?.parameters?.map((p) => p.name.toLowerCase()) ?? [];
    if (parsed && b.kind === 'set') params = ['&newvalue'];
    const text = m.slice(b.start, b.end);
    // The type may be an array type ("Local array of string &cats"): a one-word pattern missed those declarations.
    for (const d of text.matchAll(/\blocal\s+(?:array\s+of\s+)*[%A-Za-z][A-Za-z0-9_:]*\s+(&[A-Za-z0-9_#]+(?:\s*,\s*&[A-Za-z0-9_#]+)*)/gi)) {
      for (const v of d[1].split(',').map((x) => x.trim())) {
        const at = b.start + d.index!;
        if (params.includes(v.toLowerCase())) add('PC004', at, `Local ${v} re-declares a parameter of ${b.kind} ${b.name}; use the parameter, or give the local another name.`);
        else if (b.kind !== 'function' && instanceNames.has(v.toLowerCase())) add('PC004', at, `Local ${v} in ${b.kind} ${b.name} re-declares the instance variable ${v}; use the instance variable, or give the local another name.`);
        else if (b.kind !== 'function' && constantNames.has(v.toLowerCase())) add('PC004', at, `Local ${v} in ${b.kind} ${b.name} has the name of class constant ${constantNames.get(v.toLowerCase())} (names ignore case): App Designer refuses it (2,66, "Constant used in inappropriate context"). Give the local another name.`);
        else if (b.kind !== 'function' && storedNames.has(v.toLowerCase())) add('PC004', at, `Local ${v} in ${b.kind} ${b.name} has the name of stored property ${storedNames.get(v.toLowerCase())}, which is stored like an instance variable: App Designer refuses it (2,39, "Duplicate temporary variable declaration"). Give the local another name.`);
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
  // PC007 on another object's property: refused when the receiver is declared as an Application Class. A lab
  // FieldChange on the demo lab stopped at run time (2026-10-26) on "If All(&res.ErrorCode)" with &res an Application Class
  // object: "Field or temporary variable name required. (2,32)". Delivered programs pass a
  // member to these functions 2,6xx times, every receiver a Field, Record, Rowset, XmlNode or ApiObject (.Value,
  // Label, PortalURI ...); none on an Application Class.
  const appClassVars = new Set<string>();
  const appClassType = (t: string) => t.includes(':') || imports.some((i) => !i.endsWith(':*') && i.endsWith(`:${t.toUpperCase()}`));
  for (const d of m.matchAll(/\b(?:local|global|component|instance)\s+([A-Za-z_][\w:]*)\s+(&[\w#]+(?:\s*(?:=[^,;]*)?,\s*&[\w#]+)*)/gi)) {
    if (appClassType(d[1])) for (const v of d[2].matchAll(/&[\w#]+/g)) appClassVars.add(v[0].toLowerCase());
  }
  for (const d of m.matchAll(/(&[\w#]+)\s+as\s+([A-Za-z_][\w:]*)/gi)) if (appClassType(d[2])) appClassVars.add(d[1].toLowerCase());
  for (const f of m.matchAll(/(?<![\w&%.:])(none|all|allornone|onlyone|onlyoneornone)\s*\(([^()]*)\)/gi)) {
    let at = f.index! + f[0].indexOf('(') + 1;
    for (const raw of f[2].split(',')) {
      const arg = raw.trim(), offset = at + raw.indexOf(arg);
      at += raw.length + 1;
      const r = /^(&[\w#]+)\s*\.\s*[A-Za-z_]\w*$/.exec(arg);
      if (r && appClassVars.has(r[1].toLowerCase()))
        add('PC007', offset, `${f[1]}(${arg}): ${r[1]} is an Application Class object, and App Designer refuses its property here ("Field or temporary variable name required", 2,32). ${f[1]}() takes record fields, Locals and parameters: copy the property into a Local first, or compare it (${arg} <> "").`);
    }
  }
  // PC007 on a call result: App Designer refused "If All(RTrim(&role)) And" in a lab class on the demo lab (2026-10-27,
  // "Field or temporary variable name required", 2,32). Of 33,389 arguments to these functions in the 8.61 lab
  // snapshot none is a call result; 54 are @(...) references and two a parenthesised property chain ending .Value.
  for (const f of m.matchAll(/(?<![\w&%.:])(none|all|allornone|onlyone|onlyoneornone)\s*\(/gi)) {
    const open = f.index! + f[0].length;
    let depth = 1, j = open, argStart = open;
    const args: Array<[number, string]> = [];
    for (; j < m.length && depth > 0; j++) {
      const ch = m[j];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if ((ch === ',' && depth === 1) || depth === 0) { args.push([argStart, m.slice(argStart, j)]); argStart = j + 1; }
    }
    for (const [at, raw] of args) {
      let arg = raw.trim();
      while (/^\(.*\)$/s.test(arg)) arg = arg.slice(1, -1).trim();
      if (arg.startsWith('@') || !/\)$/.test(arg)) continue;
      const shown = source.slice(at + raw.indexOf(raw.trim()), at + raw.indexOf(raw.trim()) + raw.trim().length);
      add('PC007', at + raw.indexOf(raw.trim()), `${f[1]}(${shown}): App Designer refuses a call result here ("Field or temporary variable name required", 2,32); ${f[1]}() takes record fields, Locals and parameters. Compare the value instead (${shown} <> "") or assign it to a Local first.`);
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
    // SQLExec's outputs -- the arguments after its :n bind values -- are bound the same way. Proved live:
    // a lab class read a setting into an instance variable and PIA stopped with
    // "SqlExec: parameter 2 is neither a record object nor a name. (2,284)". Only a literal SQL statement is
    // checked (its highest :n is the bind count).
    // A get / set property's name used as &name is a Local of that name (CAFNUI_CORE:OBJECT:CompareSession).
    const storedPropNames = new Set(parsed.members.filter((x) => x.kind === 'property' && !parsed.implementations.some((i) => i.kind !== 'method' && i.name.toLowerCase() === x.name.toLowerCase()))
      .map((x) => `&${x.name.replace(/^&/, '')}`.toLowerCase()));
    const quoted = mask(source, true);
    for (const f of quoted.matchAll(/(?<![\w&%.:])sqlexec\s*\(/gi)) {
      const args: Array<{ text: string; offset: number }> = [];
      let depth = 1, i = f.index! + f[0].length, start = i;
      for (; i < quoted.length && depth; i++) {
        const ch = quoted[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if ((ch === ',' && depth === 1) || depth === 0) {
          const raw = quoted.slice(start, i);
          args.push({ text: raw.trim(), offset: start + raw.length - raw.trimStart().length });
          start = i + 1;
        }
      }
      const first = args[0];
      if (!first || source[first.offset] !== '"') continue;
      const literal = source.slice(first.offset, first.offset + first.text.length);
      const binds = Math.max(0, ...[...literal.matchAll(/:(\d+)/g)].map((b) => Number(b[1])));
      for (const out of args.slice(1 + binds)) {
        const lower = out.text.toLowerCase();
        const body = found.find((b) => out.offset > b.start && out.offset < b.end);
        const locals = body ? [...m.slice(body.start, out.offset).matchAll(/\blocal\s+[%A-Za-z][\w:]*\s+(&[\w#]+(?:\s*,\s*&[\w#]+)*)/gi)]
          .flatMap((d) => d[1].split(',').map((v) => v.trim().toLowerCase())) : [];
        if (locals.includes(lower) || !!body?.params.includes(lower)) continue;
        const what = instanceNames.has(lower) ? 'a class instance variable'
          : storedPropNames.has(lower) || /^%this\.[a-z_]\w*$/.test(lower) ? 'a property' : '';
        if (!what) continue;
        add('PC008', out.offset, `SQLExec output ${out.text} is ${what}; SQLExec binds its outputs by reference and refuses one at run time ("SqlExec: parameter n is neither a record object nor a name", 2,284). Read into Locals and assign afterwards (Local string &v; SQLExec(..., &v); ${out.text} = &v;).`);
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
  // PC011: PeopleCode applies no member access to a create expression; its type stays the created class.
  // A lab FieldChange's "&p = create PKG:Factory().Create(&cfg);" stopped the demo lab's component at run time
  // (2026-10-26): "Assignment left hand side of type PKG:Product is not compatible with right hand side of type
  // PKG:Factory. (2,47)". None of the 5,612 create expressions in the 8.61 lab snapshot does it.
  for (const c of m.matchAll(/\bcreate\s+([A-Za-z_]\w*(?::[A-Za-z_]\w*)*)\s*\(/gi)) {
    let i = c.index! + c[0].length, depth = 1;
    while (i < m.length && depth) { if (m[i] === '(') depth++; else if (m[i] === ')') depth--; i++; }
    if (depth || !/^\s*\./.test(m.slice(i))) continue;
    add('PC011', c.index!, `create ${c[1]}(...).<member>: PeopleCode applies no member access to a create expression -- its type stays ${c[1]} (App Designer 2,47, "Assignment left hand side ... is not compatible with right hand side"). Create the object into a Local first, then call it: Local ${c[1]} &o = create ${c[1]}(...); ... &o.<member>`);
  }
  // PC014: a declaration that names several variables cannot initialise any of them. App Designer refused a lab
  // RowInsert's "Local integer &i, &latest = 0;" on the demo lab (2026-10-27, "Syntax error: expecting statement", 2,42).
  // The 8.61 lab snapshot initialises a declaration 13,032 times, always one variable per statement.
  for (const d of m.matchAll(/(?<![\w&%.:-])(local|global|component)\s+[A-Za-z_][\w:]*\s+(?=&)/gi)) {
    let i = d.index! + d[0].length, depth = 0, names = 1, init = false;
    for (; i < m.length; i++) {
      const ch = m[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (depth === 0 && ch === ',') names++;
      else if (depth === 0 && ch === '=') init = true;
      else if (depth === 0 && ch === ';') break;
    }
    if (names > 1 && init) {
      add('PC014', d.index!, `${source.slice(d.index!, i + 1).replace(/\s+/g, ' ')}: a declaration naming several variables cannot initialise any of them (App Designer 2,42, "Syntax error: expecting statement"). Declare the initialised variable on its own: Local integer &i; Local integer &n = 0;`);
    }
  }
  // PC015: ParentRow is a Rowset property; a Row has ParentRowset. On a Row, ".ParentRow" names a record, so App
  // Designer refused a lab RowDelete's "GetRow().ParentRow.GetRecord(...)" on the demo lab (2026-10-27, "GetRecord is not
  // a method of class Record", 2,52). The 8.61 lab snapshot writes GetRow().ParentRowset 46 times, GetRow().ParentRow never.
  const rowVars = new Set<string>();
  for (const d of m.matchAll(/(?<![\w&%.:-])(?:local|global|component)\s+row\s+(&[\w#]+(?:\s*,\s*&[\w#]+)*)/gi)) {
    for (const v of d[1].matchAll(/&[\w#]+/g)) rowVars.add(v[0].toLowerCase());
  }
  for (const p of m.matchAll(/(getrow\s*\(\s*\)|&[\w#]+)\s*\.\s*parentrow\b(?!set)/gi)) {
    if (!/^getrow/i.test(p[1]) && !rowVars.has(p[1].toLowerCase())) continue;
    add('PC015', p.index!, `${p[1]}.ParentRow: a Row has no ParentRow property, so PeopleCode reads ParentRow as a record name (App Designer 2,52, "... is not a method of class Record"). The parent row of the current row is GetRowset().ParentRow (or ${p[1]}.ParentRowset.ParentRow).`);
  }
  // PC017: a string literal of more than 999 characters. The 8.61 lab snapshot's longest of 3,382 literals over
  // 250 characters is 999 (several at 995-999, none above). A 1,744-character certificate saved by Studio on
  // the test lab (2026-10-30) crashed App Designer when it opened the class, and the application server when it ran.
  const delimited = mask(source, true);
  for (let i = 0; i < delimited.length; i++) {
    if (delimited[i] !== '"') continue;
    let j = i + 1, length = 0;
    while (j < source.length) {
      if (source[j] === '"' && source[j + 1] === '"') { j += 2; length++; continue; }
      if (source[j] === '"') break;
      j++; length++;
    }
    if (length > 999) {
      add('PC017', i, `A string literal of ${length} characters: PeopleSoft reads at most 999 (the longest in delivered code); a longer one crashes App Designer and the application server when they load the program. Split it into parts of at most 999 characters and join them with |.`);
    }
    i = j;
  }
  // PC018: True, False and Null are keywords, so a member access cannot name them: App Designer refuses
  // GetJavaClass("java.lang.Boolean").TRUE with "Dot not followed by Id. (2,49)" (test lab, 2026-10-30), and the
  // application server, compiling the program Studio saved, stopped the page with the same error. The 8.61 lab
  // snapshot never writes one.
  for (const k of m.matchAll(/([\w)\]])\s*\.\s*(true|false|null)\b/gi)) {
    add('PC018', k.index! + k[1].length, `.${k[2]}: ${k[2]} is a PeopleCode keyword, so it cannot follow a dot (App Designer 2,49, "Dot not followed by Id"). For a Java constant such as Boolean.TRUE, call a method instead (Boolean.valueOf("true")) or avoid the boolean.`);
  }
  // PC019: a number literal makes CreateArrayRept / CreateArray build an Array of Number, which cannot be stored in an
  // array of integer: "Cannot convert type Array of Number to object type Array of Integer" (180,604) at run time,
  // after App Designer's Validate Syntax accepted it (8.61 lab: a Local on 2026-10-30, a readonly property on
  // 2026-10-31). One delivered program declares an array of integer at all, and never this way.
  const integerArrays = new Set<string>();
  for (const d of m.matchAll(/\b(?:local|global|component|instance)\s+array\s+of\s+integer\s+(&[\w#]+(?:\s*(?:=[^,;]*)?,\s*&[\w#]+)*)/gi)) {
    for (const v of d[1].matchAll(/&[\w#]+/g)) integerArrays.add(v[0].toLowerCase());
  }
  for (const d of m.matchAll(/\bproperty\s+array\s+of\s+integer\s+([A-Za-z_]\w*)/gi)) integerArrays.add('&' + d[1].toLowerCase());
  const numberArray = /\s*=\s*CreateArray(?:Rept)?\s*\(\s*[-+]?\d/iy;
  for (const v of m.matchAll(/&[\w#]+/g)) {
    if (!integerArrays.has(v[0].toLowerCase())) continue;
    numberArray.lastIndex = v.index! + v[0].length;
    if (numberArray.test(m)) add('PC019', v.index!, `${v[0]} is an array of integer, but a number literal makes CreateArrayRept / CreateArray build an Array of Number: the assignment fails at run time ("Cannot convert type Array of Number to object type Array of Integer", 180,604) although Validate Syntax accepts it. Declare it array of number, or build it empty and Push integer values.`);
  }
  // PC020: the Request class has no Method property -- the HTTP method is HTTPMethod. "%Request.Method" passed
  // Studio's checks and saved, then the application server refused the class: "Method is not a property of class
  // Request. (2,50)" (8.61 lab, 2026-10-31). The 8.61 lab snapshot reads 44 distinct %Request members in 302
  // programs, HTTPMethod among them, Method never.
  for (const r of m.matchAll(/%Request\s*\.\s*(Method)\b(?!\s*\()/gi)) {
    add('PC020', r.index!, `%Request.${r[1]}: the Request class has no Method property (2,50, "Method is not a property of class Request"); the HTTP method is %Request.HTTPMethod.`);
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
