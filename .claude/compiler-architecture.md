# PeopleCode Compiler -- Current Architecture (HEAD `1a606d0`, Cycle 123)

This document describes what the encoder / decoder **do now**, verified
against the code and the LOCAL SNAPSHOT corpus. It supersedes the
chronological notes in `corpus-progress.md` where they disagree (see
"Stale assumptions"). Code is authority; line numbers are approximate.

Corpus at Cycle 123 HEAD: TOTAL 30,209 / EXACT 29,656 / NONEXACT 553 (Cycle 124:
EXACT 29,681 / NONEXACT 528; Cycle 125: EXACT 29,707 / NONEXACT 502; Cycle 126:
EXACT 29,715 / NONEXACT 494; Cycle 127: EXACT 29,718 / NONEXACT 491; Cycle 128:
EXACT 29,719 / NONEXACT 490; Cycle 129: EXACT 29,720 / NONEXACT 489; Cycle 130:
EXACT 29,721 / NONEXACT 488 -- all decoder only; Cycle 131 encoder: EXACT
29,754 / NONEXACT 455; Cycle 132: EXACT 29,764 / NONEXACT 445; Cycle 133:
EXACT 29,774 / NONEXACT 435; Cycle 134: EXACT 29,781 / NONEXACT 428;
Cycle 135: EXACT 29,809 / NONEXACT 400; Cycle 136: EXACT 29,820 / NONEXACT
389; Cycle 137: EXACT 29,821 / NONEXACT 388; Cycle 138: EXACT 29,822 /
NONEXACT 387; Cycle 139: EXACT 29,825 / NONEXACT 384; Cycle 140:
EXACT 29,832 / NONEXACT 377; Cycle 141: EXACT 29,843 / NONEXACT 366;
Cycle 142: EXACT 29,846 / NONEXACT 363; Cycle 143: EXACT
29,849 / NONEXACT 360; Cycle 144: EXACT 29,857 / NONEXACT 352; Cycle 145:
EXACT 29,862 / NONEXACT 347; Cycle 146: EXACT 29,871 / NONEXACT 338; Cycle 147:
EXACT 29,891 / NONEXACT 318; Cycle 148: EXACT 29,895 / NONEXACT 314;
Cycle 149: EXACT 29,902 / NONEXACT 307; Cycle 150: EXACT 29,920 /
NONEXACT 289; Cycle 151: EXACT 29,924 / NONEXACT 285; Cycle 152: EXACT
29,929 / NONEXACT 280; Cycle 153: EXACT 29,952 / NONEXACT 257;
Cycle 154: EXACT 29,962 / NONEXACT 247; Cycle 155: EXACT 29,975 /
NONEXACT 234; Cycle 156: EXACT 29,986 / NONEXACT 223; Cycle 157: EXACT
29,997 / NONEXACT 212; Cycle 158: EXACT 30,005 / NONEXACT 204;
Cycle 159: EXACT 30,011 / NONEXACT 198, no encode failure; Cycle 160:
EXACT 30,019 / NONEXACT 190; Cycle 161: EXACT 30,027 / NONEXACT 182;
Cycle 162: EXACT 30,034 / NONEXACT 175; Cycle 163: EXACT 30,043 /
NONEXACT 166; Cycle 164: EXACT 30,047 / NONEXACT 162; forward-exact =
EXACT); forward-exact
(program bytes equal) 29,721; protected 430/430; fallback 70 (13525 in,
EXACT); ROUNDTRIP_ONLY 0.

---

## 1. Pipeline

`encodeProgramArtifacts(source, context)` -- `src/peoplecode/encoder.ts`:

1. **Conditional compilation** (`conditionalCompilation.ts`,
   `preprocessConditionalCompilation`) when the context supplies a Tools
   release (the corpus layer does: `tools/corpus/snapshot/toolsRelease.ts`,
   8.61 for HCDEV). A lexical scanner (strings, `/* */`, `<* *>`, `/+ +/`,
   REM skipped) masks every directive region -- keyword + dead branch text
   + attached `;` + rest of line -- as spaces, offsets preserved, and maps
   region start -> its records (0x75 / 0x76 / 0x77 / 0x78, 0x15). The
   masked source is encoded recursively; every region must be emitted or
   the program is unsupported. No release -> legacy behaviour.
2. **Application Class detection**:
   - legacy `parseApplicationClassProgram` + `encodeApplicationClassProgram`
     (returns no references) -- reached by exactly **one** corpus program
     (29632);
   - `encodeApplicationClassProgramV2` -- every other App Class program:
     header parse (`parseApplicationClassSource`, `applicationClassProgram.ts`),
     directory / symbol hash table, then one fragment per method / get /
     set body plus a leading import fragment, each via
     `encodeFragmentInternal` with a shared session context (section 6).
3. **Ordinary programs**: `parseFunctionMetadata` (Function signatures for
   the trailer), `encodeOrdinaryProgramFragment` -> `encodeFragmentInternal`
   (with the external-metadata fallback, section 8), then header +
   statements + 0x07 + Function metadata trailer.
4. `encodeFragmentInternal` (1314 .. 13906) is the whole statement /
   expression compiler: lexical helpers (`space()` -- whitespace, and
   conditional-region emission at the first crossing), statement dispatch,
   expression grammar, receiver semantics, reference allocation
   (`nextReference` + the scope pools), byte chunks.

Decoder: `decoder.ts` `decodeProgram` -> tokens (opcode, text, nameNum) and
rendered text (`format.ts` opcode formats + many contextual newline /
spacing rules). Harness: `tools/corpus/validator.ts` -- decode stored ->
`sourcesMatch` (`corpus/sourceNormalize.ts`), encode source -> compare
bytes, re-encode decoded text -> roundtrip.

## 2. Parser

- **Statement dispatch** (`statement()`, ~6500): empty statement `;`
  (Cycle 114), block comment, keywords (import / Declare / Function / Local
  / Global / PanelGroup / ComponentLife / Component / Constant / Return /
  If / While / For / Repeat / Evaluate / try / throw / Break / Exit / Error
  / Warning ...), `&`/`@`/`%` variable-led statements (assignment or
  call chain via `primary()`), `Record.` chains, `REC.FIELD` chains,
  call-result property assignment, bare call statements, and (Cycle 116) a
  statement-leading group followed by `.` / `[` (`groupedExpressionStatementFollows`).
  A group with no postfix step is not a statement.
- **Expression grammar** (Cycle 117): `booleanExpression` = Or of
  `andExpression` = And of `booleanUnary` = `Not booleanUnary |
  comparisonExpression`; `comparisonExpression` = `expression [op
  expression]` (+ `Not =`); `expression` = `castPrimary (arith-op
  castPrimary)*` (flat arithmetic); `castPrimary` = `primary (As type)*`;
  `primary` = literals / `-` / `@` / `%sys` / `(` booleanExpression `)` /
  `create` / names / references, followed by the postfix loop (`.member`,
  calls, `[index]`, `(index)`). 0x41 / 0x42 wrap every And / Or chain.
  **No left-operand lookahead remains in the grouping path**; the When
  selector and `Local boolean &b = (...)` still call
  `parenthesized(booleanExpression)` directly.
- Source-shape regex lookaheads (`/^.../.test(source.slice(pos))`) remain
  in **62** places (statement classification, CreateRecord / CreateRowset /
  GetLevel0 assignment shapes, SetDefault runs, Record.X chains ...);
  `baseVariableName !== undefined` gates semantics in 12 places.

## 3. Receiver semantics

Per `primary()` call: `baseVariableName`, `activeApplicationClassReceiver`
(class + reuse flags), `pendingArrayElement` (Cycle 109),
`expectedReferenceMember` ('record' | 'field' | undefined: what the next
bare member binds as), `chainSemantics` ({valueType, binding,
provenance}), `fieldMemberFromGetRecord`, `fieldMemberFromRowShorthand`
(Cycle 119), `rootIsUndeclaredVariable` (Cycle 121).

- Declared variable types: `recordVariables`, `rowVariables`,
  `rowsetVariables`, `chainSemanticsDeclaredRow/RowsetVariables`,
  `recordArrayVariables`, `applicationClassVariables` /
  `applicationClassArrayVariables` / `functionApplicationClassVariables`.
  Populated by Local / Global / Component / PanelGroup (Cycle 121) /
  typed parameters (`registerTypedParameter`) / App Class header
  propagation (Cycle 120: `applicationClassDeclaredBuiltinVariables`;
  Cycle 109: `applicationClassDeclaredVariables`).
- **Bare member binding** (`&r.FIELD`, `&row.REC.FIELD`): needs
  `expectedReferenceMember` and (`bareMemberBindingEligible` = binding
  dependency-bound or selector provenance, or an existing row of that name)
  **and, in ordinary programs, a declared root** (`declaredVariableNames`,
  a raw-source scan of every declaration keyword + Function parameters;
  Cycle 121). An undeclared root is late-bound: its members are inline 0x0A
  names. This is what the formerly parked `GetRow(n).X.Y` 0x4A / 0x0A
  family was (no opcode rule).
- **Metadata** (Cycle 107+): `consultTypeMetadata` (`member` /
  `method-result`) on the provider; `class` results become the receiver,
  `array` results a pending element, `other` results with type `Record`
  (Cycle 118, property steps only) enter the Record state
  (`expectedReferenceMember = 'field'`, declared dependency-bound).
  Diagnostics-only mode returns nothing.
- `schemaBoundVariables` (undeclared `= CreateRowset(Record.X)` targets)
  still give a `schema` chain state, but the Cycle 121 gate overrides
  binding for undeclared roots in ordinary programs.

## 4. Reference kinds and lifetimes (current)

| Kind | Ordinary identity / lifetime | App Class identity / lifetime | Opens on |
|---|---|---|---|
| App Class PACKAGE | **leaf class name** per allocation unit (`classRowsByUnit`, Cycle 94 + 122); a same-leaf named import opens none | one row per **leaf class name** per program (`applicationClassProgramRows`, Cycle 108); own class via self row (Cycle 82) | type use (decl, param, Returns, create, cast, method call), named import |
| built-in PACKAGE (`PACKAGE.RECORD` ...) | per built-in **run** (`builtinUnit`, Cycle 103): leading section run (Functions continue it), else per top-level statement / Function header / body statement | method-wide (`functionDepth` key) + class-wide session | declaration of a registered type in an allowed context (`BUILTIN_TYPE_REGISTRY`); Component / Returns arrays (Cycle 122) |
| wildcard import blank PACKAGE | first wildcard of the program only (`claimedWildcardImportMetadata`); every wildcard under the fallback | first wildcard of the compilation unit (`claimWildcardImportMetadata`) | import `P:*` |
| RECORD | per allocation unit (`recordRowsByUnit`, Cycle 95) + control-group pools for shorthand | per record name, whole program: method-wide scope + session (Cycle 71 explicit, Cycle 119 shorthand) | `Record.X`, shorthand `.REC`, CreateRecord / GetRecord args |
| FIELD | per allocation unit, by field name (`unitScopedRows.field`, Cycle 96) | per field name, whole program: field scope + session (Cycles 65, 118, 119, 120) | `Field.X`, bare member of a Record value |
| SCROLL | per allocation unit (`unitScopedRows.scroll`) | method-wide + session | `Scroll.X` |
| RECORD.FIELD | per allocation unit (`unitScopedRows['record-field']`) | method-wide | `REC.FIELD` source chains |
| Declare Function | program-wide, by record.field (or the owner row) | (as ordinary) | `Declare Function ... PeopleCode REC.FIELD` |

**Allocation unit (ordinary)**: the leading declaration section through
the first initialized Local / first executable statement; each top-level
statement (control structure = one); each Function header after the
leading section (Cycle 111; the first Function shares it); each Function
body statement; a conditional-compilation block ends the leading section's
unit (Cycle 122, one-program evidence).

**PSPCMNAME vs EXACT**: the harness EXACT verdict compares program bytes
and the roundtrip; it does not compare PSPCMNAME. 44 forward-exact
programs have a non-exact reference list (32 App Class, 10 fallback, 20
generated a strict prefix of stored -- trailing rows never referenced);
13525 is one (its compensating wildcard blank stands where
POPULATIONMANAGER belongs). `cycle123-reference-debt-census.ts`.

Cycle 134 -- operand form of a bare chain member: a reference operand
(0x4A) when the value before it is statically typed Row / Record
(`chainSemantics.binding` dependency-bound, or `expectedReferenceMember`
from a typed step), an inline name (0x0A) when the chain is late-bound --
an undeclared ordinary root, or a root declared only `any` (any program
kind) -- even when a reference row of that name already exists
(`hasExistingExpectedReference` no longer binds a late-bound root).
Typed steps added: `GetCurrEffRow()` -> Row, `.ParentRecord` -> Record;
an App Class `Global array of Record` reaches method bodies.
Cycle 135: an App Class Rowset -- header `instance` / `property` /
`Global` / `Component` (Cycle 120's outside-declared built-ins) or a
property the type-metadata provider declares `Rowset` -- is a declared
Rowset in every method body (`chainSemanticsDeclaredRowsetVariables`;
shadowed by a body Local / differently typed parameter); the chain
transitions and the existing allocator do the rest. Header Row
declarations change no program: not modeled. Every reference-list change
validated with `cycle135-reference-delta.ts`.

Cycle 136 -- `create` and its class row: in ordinary and App Class
programs alike the create uses its class row after its constructor
arguments (App Class: `ensureRuntimeCreateReference` after the argument
list), unless the statement's own `Local <Class> &v =` declaration typed
it first (`cycle136-create-package-order-census.ts`).

Cycle 137 -- App Class catch: `catch <Class> &e` allocates nothing by
itself; &e is a receiver (as in ordinary programs, Cycle 111), so a method
call on it uses the class row in the class-wide session. A named import of
the class stores its row regardless; built-in `catch Exception` never does
(`cycle137-appclass-package-provenance-census.ts`).

Cycle 138 -- App Class reference SESSION: the class-wide session (every
kind) ends at a conditional-compilation directive outside the method
bodies (pre-class, header, top-level declarations, between
implementations); the rows after it open again (`referenceSessionAt` in
`encodeApplicationClassProgramV2`). Body directives do not end it. A
method's parameter types resolve in their header declaration's session
(`applicationClassParameterTypeSession`). Five programs without a
directive (29797 29883 30170 30179 30192) store per-implementation /
per-statement repeats with no source-visible trigger -- parked
(`cycle138-package-session-census.ts`).

Cycle 139 -- App Class implementation header comment: a `/* ... */` that
ends a `method` / `get` / `set` implementation's header line is the
header's (`ApplicationClassImplementation.headerComments`), written as an
inline 0x4E between the name and the header's 0x2D. 0x6D is only the
`/+ ... +/` signature annotation after the 0x2D
(`cycle139-implementation-header-comment-census.ts`).

Cycle 140 -- an untyped `array` in an App Class class-header type is the
keyword 0x40 (`encodeApplicationClassTypeBytes`) and its descriptor is
`array of any` (`encodeTypeDescriptor`: 0x100004). Between two
implementations only the blank lines after the gap's last directive are
0x4F markers (`emitLayoutRange(..., implementationGap)`)
(`cycle140-array-keyword-directive-gap-census.ts`).

Cycle 141 -- ordinary leading declaration section: blank lines between
its declarations are 0x4F (Constant included); it closes ONCE (0x2D) --
plain Local run, generic declarations and App Class Locals together --
whichever closer fires first (REM, block comment, <* *>, executable
statement); a /* */ comment that closes the import section restarts a
following plain Local run; the closers look past REM / <* *> for a
following declaration (`cycle141-marker-ownership-census.ts`).

Cycle 142 -- App Class type-path NAMES (name table): root upper-cased,
each sub-package in the program's first spelling of that package path
(`firstPackageSpellings` / `canonicalTypePathName`), leaf as declared.
Statement bytes keep the declaration's own spelling; reference identity
stays the case-insensitive leaf (`cycle142-type-path-case-census.ts`).

Cycle 143 -- REM comment boundary: `rem` / `remark` (case-insensitive)
not preceded by an identifier character and followed by a non-identifier
character, in the ordinary encoder (`^(?:REM|remark)\b`) and the App Class
scanners alike (`isRemCommentStart`); the comment runs through its `;`
(`cycle143-rem-lexical-census.ts`).

Cycle 144 -- ordinary App Class rows: an `As <Class>` cast types its value
and uses the class row only when its parenthesized result receives a
method call (`castPrimary`); a Function header's `As array of <Class>` /
`Returns array of <Class>` uses the class in the header's unit like the
scalar forms (`cycle144-ordinary-package-provenance-census.ts`).

Cycle 145 -- ordinary: a method call on a receiver declared with a
`%metadata` system class uses no row (declarations / creates do); after a
Function definition, declaration-only top-level Locals before executable
code are one allocation unit (Function-body Locals stay one unit each)
(`cycle145-metadata-local-run-census.ts`).

Cycle 146 -- owner row (harness input): `REC.FIELD` from OBJECTID 1 / 2,
blank where the key has none (`REC.` / `.`), Application Classes
positional. `ParentRow` / `ParentRowset` navigation keeps the chain's
binding even where the member is written inline; a single member ending
a bare `GetRecord()` chain is a FIELD reference unless a Record property
(`cycle146-record-field-provenance-census.ts`).

Cycle 147 -- the owner slot binds the first record/field reference only
when the owner row is written: an Application Class method fragment's
suppressed slot binds nothing, whatever `bindOwnerReference` says
(`cycle147-fragment-owner-binding-census.ts`).

Cycle 148 -- an indexed `array of Record` element is a Record receiver in
every declaration scope: ordinary Local (Cycle 45), App Class header /
Global (Cycle 134) and now ordinary Global; its bare member is a FIELD
row, the bare array (`&x.Len`) stays inline
(`cycle148-record-array-element-census.ts`). FIELD.X and REC.X are
independent identities (2,516 EXACT programs hold both): the receiver,
not the name, picks the form. Quoted (`MenuName."X"`, per control group)
and unquoted (`MenuName.X`) spellings of one name share a stored row
within one top-level statement (7 programs)
(`cycle148-quoted-unquoted-reference-census.ts`).

Cycle 149 -- in an ordinary program a quoted (`MenuName."X"`, 0x48) and
an unquoted (`MenuName.X`, 0x21) spelling of one reference are ONE row per
allocation unit, identity KIND.NAME (MENUNAME, BARNAME, ITEMNAME, PAGE
evidenced): the quoted path consults and registers the unit-scoped
`record-field` pool; the first use in the unit, either spelling, creates
the row, each use keeps its own operand opcode. Rows never share across
units (805, 9670, 11344). The quoted control-group cache stays for
quoted-to-quoted reuse (no corpus occurrence separates it from the unit)
(`cycle149-quoted-symbolic-row-census.ts`; trace events carry
`allocationUnit`).

Cycle 150 -- off a Row value (`GetLevel0()(n)`, `GetRow(..)`, a Row
variable, a previous shorthand), a member followed by `(` that is not a
Row method (GetRecord, GetRowset, CopyTo, GetNextEffRow, GetPriorEffRow;
case-insensitive) is the child rowset by scroll name indexed to a row:
`GetLevel0()(1).GB_GROUP_TBL (&r).GB_WHERE_TBL (&r2)`. In an ordinary
program it binds a SCROLL row (0x4A) with the unit lifetime -- never a
same-name RECORD row (`cycle150-row-scroll-shorthand-census.ts`). App
Class bodies keep the earlier behavior (reuse of an existing SCROLL row
only).

Cycle 151 -- ordinary Function parameters are declared in their Function
(`shadowFunctionParameter` / `restoreFunctionParameterShadows`): at the
header a parameter name leaves the program-wide declaration sets (Record,
Row, Rowset, record array, the ChainSemantics Row / Rowset sets, class
variables); a typed parameter then registers its own type (now including
`As array of Record`, a record array); at End-Function the outer
memberships return. An untyped parameter is late-bound in its body even
over an outer typed variable (11513, 13657, 13658); a typed one does not
leak into later code (18134). Function-body Locals stay program-wide (no
corpus case needs otherwise) (`cycle151-function-parameter-shadow-census.ts`).

Cycle 152 -- an `As array of Record` Function parameter requests the
PACKAGE.RECORD built-in row in the header's built-in unit
('function-parameter' context; one per unit, shared with the header's
other Record types and `Returns array of Record`; a first Function shares
the leading section's row) -- Record only, other element types
unevidenced (`cycle152-function-array-type-census.ts`). `PanelGroup array
of <type>` parses as the Component array form (`51 40 array 40 of 40
<type>`, element built-in row in the 'component' context) and a
`PanelGroup array of Record` is a record array.

Cycle 153 (syntax) -- a subscript holds one or more comma-separated
indexes: `&a [i, j]` is ONE subscript `4C <i> 03 <j> 4D` (the ordinary
comma; no count byte), each index stepping one array level
(`cycle153-multi-index-subscript-census.ts`: 79 sites, all two indexes).
A try statement may have several catch clauses (each `66 <type> <var>`),
and the last catch-body statement may omit `;` before end-try (no
terminator written).

Cycle 154 (syntax) -- terminator elision: each block-body loop names the
keywords before which its last statement may omit `;` (stored writes no
terminator): If (Else, End-If, REM), Else (End-If, REM), For (End-For),
While, Repeat, When / When-Other, catch (end-try, catch), try (catch),
Function; a bare Return before a block keyword (`BLOCK_CLOSING_KEYWORD`)
takes no value. A block comment between a statement and its `;` is an
inline 0x4E in the If, When and For bodies. Expression comments
(`commentsBeforeContinuation` / `commentsAfterOperator`): a block comment
between an operand and a continuing operator / comparison / assignment
`=` / comma, or right after an operator / comma, is an inline 0x4E at its
position; any other comment still ends the expression. REM after a
boolean operator inside a condition is not modeled (13895 16592 28753).

Cycle 155 -- Function directory type descriptors: built-in objects
(`BUILTIN_FUNCTION_TYPE_IDS`, 0x80000 + subtype) gain Message 0x0e,
CubeCollection 0x33, Document 0x3f, DocumentKey 0x40, Primitive 0x41,
Compound 0x42, CompositeQuery 0x48; Function-only scalars
(`FUNCTION_PRIMITIVE_TYPE_IDS`) are date 0x02, time 0x0a and the
late-bound object 0x0d (not established for App Class signatures). The
registry's Function contexts: CubeCollection / CompositeQuery parameter +
return, Document parameter, DocumentKey return (every object-type header
occurrence stores its PACKAGE row; time / object none)
(`cycle155-function-type-descriptor-census.ts`).

Cycle 156 (syntax) -- a direct postfix `(...)` selector after a call
result is permitted in chains rooted at an `&variable`, a bare call or
`%This` (`allowDirectPostfixCall`); literals stay non-callable. A REM
between And / Or and the right operand is 0x24 expression trivia (its own
`;` is part of the comment) -- `booleanUnary` accepts it like a block
comment (`cycle156-postfix-selector-rem-census.ts`).

Cycle 157 (syntax) -- `<* ... *>` is one 0x55 token in every placement
and its delimiters nest (`disabledCommentEnd` in applicationClassProgram.ts,
shared by every scanner). It is a body item of every body (now While,
Repeat, try, catch too), a selector comment between Evaluate and its
first When (an Evaluate may have no When when all are disabled), a
comment between And / Or and the operand, and `<*` is never the `<`
operator (`cycle157-nested-comment-census.ts`).

Cycle 158 (syntax) -- a try may have no catch clause (`65 try <body> 67
end-try`; the try loop accepts end-try, blank line -> 0x4F); `**` is one
arithmetic operator token 0x46 (matched before `*`), rendered by the
decoder tight on both sides; precedence / associativity unproven (every
corpus site is a parenthesized `a ** b`) (`cycle158-try-power-census.ts`).

Cycle 159 (syntax) -- the last encode failures: `$` / `#` anywhere after
the `&` of a variable, a trailing `#` on a Function definition name, `#`
inside a member name (stored literally); inline 0x4E comments in a Local
declaration (after the type, after a comma, before `;`) and in a
Function parameter list (the directory scan reads the masked source); a
comment before the `;` of a dotted method-call statement; a trailing
comma in a parameter list (`cycle159-special-identifier-census.ts`).
DECODE_SOURCE_MISMATCH is now mostly snapshot source fidelity: 66 of 71
have a non-Latin-1 character in the stored program (`’` `“` `‘` U+200B)
that the snapshot's source text holds as `¿` / a backtick.

Cycle 160 (semantics) -- App Class header members typed with the built-in
`Exception` are declaration dependencies (header order); a built-in
extends / implements type (`extends Exception`) is not. An App Class `As`
cast opens its class row only when its result receives a method call
(the ordinary Cycle 144 rule). `FreeFormStyleName` is a Row / Rowset
property (`BUILTIN_OBJECT_PROPERTIES.record`). `%This.<ownMethod>(...)`
whose own header declares `Returns Record` / `Returns Row` is a Record /
Row value (`applicationClassOwnMethodReturnTypes`); a metadata-declared
`Row` property is a Row (beside Cycle 118 Record / Cycle 135 Rowset).
Repeated named imports of one leaf store one row in every App Class
program, but deduping them for classes with an inherited `%This` call
breaks 28729 (a compensating absent-metadata row) -- parked
(`cycle160-appclass-package-census.ts`).

Cycle 161 (semantics) -- an Application Class program has one row per
REC.FIELD identity (no stored App Class list repeats one), so a static
REC.FIELD in a body reuses the session's Declare Function row of that
target (`ApplicationClassReferenceSession.lookupDeclareFunctionTarget`);
ordinary programs keep unit-scoped static rows beside the program-wide
Declare Function row. A Row declared outside the body (header instance /
property, Global / Component) joins `rowVariables` in every body (shadowed
by parameters and Locals); an App Class method parameter `As array of
Record` joins `recordArrayVariables` (`cycle161-appclass-record-tail-census.ts`).

Cycle 162 (semantics) -- an App Class program has one COMPONENT row per
name: `componentReference()` keys App Class bodies method-wide and
consults the type session (ordinary programs keep control-group rows).
A `Local Message` variable (`messageVariables`) roots a bound chain
(declared provenance), so GetRowset / GetRow / GetRecord carry binding to
a bare record / field member (`cycle162-component-message-census.ts`).

Cycle 163 -- layout: the App Class header visibility scan ignores
`&Public`-style variables; `arrayElementTypes()` looks ahead for `of`
without consuming whitespace; an instance-statement records a trailing
comma (`03` before `15`). A definition flagged
`applicationClassDefinition` whose source declares no class compiles as
an App Class program with the self-only directory
(`encodeClasslessApplicationClassProgram`). Semantics: an ordinary
Function's Local types end at End-Function (`functionScopeSnapshot`); the
Cycle 121 declared-name test stays program-wide
(`cycle163-downstream-census.ts`).

Cycle 164 -- the declaration-dependency filter tells the relationship
(extends / implements) apart by position (`relationshipTypes`), not by
type string; `globalDeclaration` opens the class row of `Global array of
<Class>`; the comparison continuation lookahead excludes `<*`
(`cycle164-ordering-census.ts`).

## 5. Declarations and scope

Sources: Local, Global, Component, ComponentLife, PanelGroup (= Component,
Cycle 121), instance / property (App Class header), method parameters,
Function parameters, imports. Ordinary programs have one flat variable
namespace per encode: declarations are not scoped to the Function they
appear in (an untyped Function parameter of the same name as a top-level
`Local Record` keeps the Record type -- 11513, where stored keeps the
members inline; parked: needs scope-aware declarations). App Class bodies:
header / Global / Component declarations propagate into every fragment; a
body Local of another type or a parameter shadows them (Cycles 109, 120).

## 6. Application Class fragment model

Every body fragment receives: `applicationClassReferenceSession`,
`applicationClassTypeReferenceSession` (class-wide identity lookups,
wildcard claim), `applicationClassProgramRows` (Cycle 108 class rows),
`applicationClassSelfPath`, `applicationClassOwnPropertyTypes` (class types
only), `applicationClassDeclaredVariables` (class types),
`applicationClassDeclaredBuiltinVariables` (built-in types),
`applicationClassSelfMethodDependency`, `methodParameters`,
`builtinObjectDeclarationsHaveMethodWideLifetime` and
`recordDependenciesHaveMethodWideLifetime` (true), the metadata provider,
comment-opcode list and layout / blank-line suppression flags.

## 7. Metadata provider

`applicationClassTypeMetadata.ts` -- indexes every snapshot App Class
source: members, methods, named / wildcard imports, `extends`. Lookups
walk ancestors; built-in type names win over same-named classes (Cycle
107). Answers `class` / `array` (of class) / `other` (type text) /
undefined (class absent or member / ancestor missing -- not
distinguished).

## 8. Fallback

`encodeOrdinaryProgramFragment`: if a call's receiver class is external
metadata the provider cannot resolve (`unresolvedReceiverCalls > 0`), the
program is re-encoded with `externalMetadataWildcardClaims: true`, read in
exactly one place (each wildcard import claims a blank row). 70 programs
(24 EXACT): triggers -- receiver class absent from the snapshot 58, absent
+ member missing 5, member / ancestor missing on a present class 3, no
provider miss 4 (`cycle123-fallback-trigger-census.ts`). The "first
wildcard only" rule under the fallback still loses 13525 (+6 forward-exact
13517 15038 15039 15609 15697 15795, -1 13525; 21 lists, all closer by
reference distance 72 -> 38) -- it remains parked.

## 9. Newline / comment model

There is no single newline state machine. Blank-line markers (0x4F),
section closes (0x2D) and comment placement (0x24 standalone / 0x4E
inline, `blockCommentByPlacement`, `consumeCommentOpcode`) are emitted by
per-construct statement-list loops, each with its own blank-run handling:
top-level loop (~24 sites; declaration-section closes, leading Local run,
reference-gated deferred markers `pendingReferenceGroupBoundaries`), If
(11), Evaluate (13), For (7), Function (7), While (5), Repeat (4), try (4),
And / Or operands (1 each), App Class wrapper layout (`emitMarkers`,
`emitCompilationUnitPrefix`, layout comments). Shared helpers:
`emitBlankLineMarkers`, `deferReferenceGatedMarkers`, `emitBoundary`,
`captureTrailingTrivia`, `blankLinesAfterStandaloneComment` (Cycle 131:
the blank lines after a standalone 0x24 comment are 0x4F markers wherever
the comment sits -- For body first item, Evaluate selector gap, boolean
operand, after an If / Else statement with no `;`). Cycle 113 / 115 / 119
rules live inside these loops. Cycle 133: a comment before a statement's /
declaration's `;` is written before its 0x15 (`4E 15`; after the `;`,
`15 4E`) -- the App Class wrapper's class-header members included
(`emitMemberTerminators`); in a roundtrip (validator `commentOpcodes`) a
comment directly before a declaration terminator and the comments of a
shared fragment range take the decoder's opcodes, and a layout gap counts
its blank lines after the terminators it writes. Decoder: format flags + contextual rules (e.g. Cycle 120 `15 4E 15`
-> `; /* c */;`).

Function metadata type descriptors (trailer record return kind, parameter
slots): scalar codes, `depth * 0x100000` per `array of` level, built-in
objects 0x80000 + subtype, Application Class types 0x80000 + (0x100 +
the class name's character offset in the trailer name run) -- a sum
(Cycle 132: `functionTypeId` ORed it and lost bit 8;
`cycle132-trailer-type-census.ts`, 3,761 / 3,761).

## 10. Decoder boundary

0x51 is always the `PanelGroup` keyword (Cycle 124; 402 / 402 occurrences,
`cycle124-panelgroup-occurrence-census.ts`). A `;` (0x15) directly after a
token that would end its line stays on that line (Cycle 125, one rule
for every token but the 0x4E inline comment: Then, Else, try, When-Other,
`;`, 0x24 comment / REM statement, doc comment, directives;
`cycle125-empty-statement-census.ts`). The source normalizer's `Then` / `;`
join is now redundant for decoded text.

Comment opcodes and lines: 0x24 (standalone comment / REM; only
whitespace before it on its source line) and 0x6D (doc comment) end their
line. 0x4E (inline; code before it on its line) takes over the line ending
of the token it follows (Cycle 126, `cycle126-inline-comment-census.ts`):
the line ends after the comment exactly when that token has NEWLINE_AFTER
(`;`, Then, Else, And, Or, When-Other); otherwise the code goes on on the
comment's line (`If /* c */&x`, `f(&a, /* c */&b)`, `"X" /* c */ And`),
an operand tight against `*/`, keywords / operators with their own space.
0x2D / 0x4F after a comment still supply their own line breaks; a 0x4E
before a statement's own `;` (definition 55's `0 4E 15`) keeps its rule.

Spacing after `]` (Cycle 127, `cycle127-index-spacing-census.ts`): `]`
writes no space of its own; the next token decides -- tight before `.`
`;` `)` `,` (NO_SPACE_BEFORE), `[` (its `]` / `)` exception) and `(`
(no SPACE_BEFORE), spaced before operators / keywords (SPACE_BEFORE).
10,974 sites, 0 contradictions.

0x6E at an opcode position is always `Continue` (Cycle 128,
`cycle128-continue-census.ts`: 313 / 313 paired with a source `Continue`);
a following 0x15 is the source's own `;`, not part of the keyword
(`Then Continue End-If;` stores `1F 6E 1A 15`, 16759). The encoder emits
it directly; it is not in the shared OPCODES table.

0x48 quoted qualified references (`Qualifier."name"`; RECORD unquoted):
a PSPCMNAME row with a qualifier and a blank name (REFNAME ' ') joins to
the bare qualifier in the name table and renders as an empty quoted name,
`BarName.""` (Cycle 129, `cycle129-quoted-reference-census.ts`: 1,025
sites, 5 blank-name rows, all source `Qualifier.""`). Only known quoted
qualifiers; unknown bare names and failed lookups stay unknown.

Body / trailer boundary (Cycle 130, `cycle130-trailer-boundary-census.ts`):
the header's uint32 at offset 5 is statements.length + 1, so the 0x07
separator sits at 36 + header[5] (a 0x07 in all 30,209 programs) and the
trailer (declaration names, 16-byte records, slots) follows it, empty
when nothing is declared. The decoder ends the body there; the strict
`2D 07` / relaxed predecessor scans only serve buffers without a real
header. A final statement may lack its `;` (`sourceDisplay()` 18105).

The forward-exact decoder-only frontier is empty (EXACT = forward-exact =
29,721). What remains in DECODE_SOURCE_MISMATCH: 66 snapshot
source-encoding artefacts and 29858 (App Class, not forward-exact, a 0x50
number literal it cannot read).

## 11. Taxonomy semantics (`cycle73-nonexact-taxonomy.ts`)

Precedence: harness classification UNSUPPORTED_SYNTAX / ENCODE_ERROR /
DECODE_SOURCE_MISMATCH (DECODER_BARE_IDENTIFIER if the message mentions
bare identifiers) first; then ROUNDTRIP_ONLY (forward-exact, roundtrip
not); then the reference comparison (owner row excluded):
REFERENCE_COMPLETE_DOWNSTREAM (references exact), STRUCTURAL_ORDERING
(same multiset), else REFERENCE_ACTIVE_<generated kind at the first
divergence>. So the decoder categories hide reference-exact programs (62
of them, not forward-exact; 65 more are forward-exact), and the
REFERENCE_ACTIVE_* names are **symptom buckets** (the generated row kind at
the first divergence, the stored kind varies), not mechanisms.

## 12. Parked / open mechanisms

- Snapshot source encoding artefacts: 65 DECODE_SOURCE_MISMATCH programs
  whose source has `¿` (or a backtick) where the stored program has the
  real character -- unfixable without a correct source capture.
- External class metadata (fallback 70, metadata-blocked 7).
- Untyped Function parameter shadowing (11513).
- Wildcard first-only rule (13525).
- Legacy App Class path (29632).

## 13. Stale assumptions (corrected by Cycle 123)

- "0x51 is a zero-width marker before introducer-less object types" --
  wrong: always PanelGroup (decoder fixed in Cycle 124).
- "The 47 missing-0x4F COMPLETE_DOWNSTREAM programs are one family" --
  the stored-0x4F divergences are 44 + 1 hidden: 34 after a standalone
  comment / disabled-code run, 5 before Constant / instance / method, 4
  marker order (0x4F vs 0x2D), 1 other ordinary, 1 other App Class.
- "EXACT implies PSPCMNAME exact" -- wrong (44 forward-exact programs).
- `GetRow(n).X.Y` 0x4A / 0x0A needed a record catalog -- wrong (Cycle 121:
  undeclared roots are late-bound).
- Cycle 119's generated-side census counts were off by one NAMENUM (fixed
  in Cycle 121; stored-side findings stand).

## 14. Research tooling

Use `tools/corpus/research/lib/harnessContext.ts` for every new tool (the
harness owner, metadata provider, Tools release, decoder mode, taxonomy
reference keys; `RESEARCH_ENCODER_MODULE` for observational variants).
- `cycle123-frontier-census.ts` -- corpus sweep (`--compare` proves a
  change semantic-neutral) + per-NONEXACT evidence;
- `cycle123-frontier-report.ts` -- current classification of all NONEXACT;
- `cycle123-fallback-trigger-census.ts`, `cycle123-panelgroup-opcode-census.ts`,
  `cycle123-reference-debt-census.ts`;
- `cycle102-package-mechanism-census.ts` + `cycle122-ordinary-package-actionable-census.ts` (PACKAGE);
- `cycle113-complete-downstream-census.ts` (older COMPLETE_DOWNSTREAM shapes);
- `cycle73-nonexact-taxonomy.ts` (production taxonomy).
