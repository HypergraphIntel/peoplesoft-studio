# PeopleCode rules checked before saving

Studio's PeopleCode encoder reproduces PeopleTools' bytes for valid programs,
but it was built to encode, not to judge. It accepted programs that App Designer
refuses, and the first build request's agent-written code showed which ones.
These checks now run before every PeopleCode save: the PeopleCode editor,
`psft_save_peoplecode`, App Engine saves and menu saves. A save that breaks a
rule is refused with each problem's line and the fix.
`psft_validate_peoplecode` runs the same checks without saving.

Implementation: `src/peoplecode/semanticCheck.ts` (PC001-PC005, PC007-PC022) and
`DatabaseProvider.peopleCodeImportProblems` (PC006).

## Rules

| Code | Refused | Fix |
|---|---|---|
| PC001 | A property declared `readonly` or plain (no `get`) that has a `get` block. A `get`/`get set` property with no block. A `set` block on a property that is not `get set`. A get/set block with no matching property. | Declare `property string Name get;` when there is a `get Name ... end-get;` block. `readonly` is only for a stored property without one. |
| PC002 | An instance variable with a property's name (`property string Status get;` plus `instance string &Status;`). | Rename the instance variable, e.g. `&sStatus`. |
| PC003 | `Return <value>` outside a Function, method, get or set. This covers event, Record, Component, Page, Menu and App Engine PeopleCode. | End early with a bare `Return;`. In App Engine, `Exit(1)` hands control to the action's On Return setting. To produce a value, write a Function that returns it. |
| PC004 | A `Local` that re-declares a parameter of its function or method, or (in a method, get or set) a class instance variable or a property with no get / set block, readonly or not (`Local string &problem;` beside `property string Problem;` also gave 2,39, 8.61 lab, 2026-11-02): such a property is stored like an instance variable, so App Designer reports 2,39, "Duplicate temporary variable declaration" (8.61 lab, 2026-10-30, `Local string &stage;` with `property string Stage readonly;`). The 1,492 delivered classes in the 8.61 lab snapshot hold 1,193 such properties and never do it; 19 Locals share the name of a plain (writable) property, which is accepted. A class constant counts too, whatever the case: `Local object &service;` with `Constant &SERVICE` is 2,66, "Constant used in inappropriate context" (8.61 lab, 2026-10-30; the 83 delivered classes with constants never do it). Also any name that matches a class Constant ignoring case, whether a Local (array types included), a method parameter or an instance variable: App Designer reports 2,66, "Constant used in inappropriate context" (`method Build(... &signals ...)` beside `Constant &SIGNALS`, 8.61 lab, 2026-11-03). None of the 35,831 programs in the 8.61 lab snapshot does any of these. | Use the parameter or instance variable directly, or choose another name. |
| PC005 | An Application Class used (`create`, a declaration, `As`, `extends`, `implements`, `Returns`) with nothing imported from its package. This applies in every program, including other classes in the same package. | Add `import PKG:Class;` or `import PKG:*;` at the top. |
| PC006 | An imported class that does not exist, or a wildcard that names no package. This needs the database. | Save the imported class before the program that imports it. |
| PC007 | `None`, `All`, `AllOrNone`, `OnlyOne` or `OnlyOneOrNone` given a class instance variable, a `%This` property, or a property of an object declared as an Application Class (`All(&res.ErrorCode)` with `&res` a `PKG:Result`; found at run time in the demo lab, 2026-10-26, 2,32). Delivered code passes members to these functions about 2,600 times, always on a Field, Record, Rowset, XmlNode or ApiObject, never on an Application Class object. Also a call result: `All(RTrim(&role))` (demo lab, 2026-10-27, 2,32); of 33,389 arguments to these functions in the 8.61 lab snapshot none is a call result (54 are `@(...)` references, two a parenthesised property chain ending `.Value`). App Designer says "Field or temporary variable name required". | Compare instead (`RTrim(&role) <> ""`), or copy the value into a Local first (`Local date &d = &i_checkDt; If None(&d) Then`), or for a date use `IsDate(&i_checkDt)`. |
| PC009 | `NumberToString` given a printf conversion, e.g. `NumberToString("%04d", &n)`. The format is PeopleSoft's `%<width>[.<decimals>]` with an optional `R`, `T`, `t` or `v`; a conversion letter is taken literally. At run time `"%04d"` on 2026 gives `d-ba`. | Drop the conversion letter (`"%04"`, `"%02"`), or use `String(&n)` when no padding is needed. |
| PC008 | `SQL.Fetch` given a property or a class instance variable as an output parameter, or `SQLExec` given one as an output (an argument after its `:n` bind values; found at run time in the demo lab 2026-10-26, "SqlExec: parameter 2 is neither a record object nor a name"). Fetch binds its outputs by reference; a property is reached through a getter, so there is no variable to write into. At run time: `SQL.Fetch: parameter 1 is neither a record object nor a name. (2,284)`. | Fetch into `Local` variables and assign afterwards (`Local string &a; ... .Fetch(&a); &Descr = &a;`). |
| PC010 | A call that returns nothing used directly as a condition, assignment, operator operand, loop bound, `Return` value or argument: one of 32 built-in functions documented "Returns: None" (`Error`, `Warning`, `DoSave`, `Transfer`, `SetCursorPos`, `UpdateValue`, `CallAppEngine`, `CollectGarbage`, ...; list in `semanticCheck.ts`), or `Open`, `Close`, `Delete`, `SetPosition`, `WriteLine`, `WriteString`, `WriteRaw` or `WriteBase64StringToBinary` on a known `Local File` receiver. Native App Designer reports 2,60, "Function or method does not produce a result value." | Call it as a statement: `&file.WriteLine(&line);`, `DoSave();`. File-method errors abort execution; there is no Boolean result to inspect, so test `&file.IsOpen` after opening. |
| PC011 | A member used straight off a `create` expression, e.g. `&p = create PKG:Factory().Create(&cfg);`. PeopleCode applies no member access to it: the expression's type stays the created class, so App Designer reports 2,47, "Assignment left hand side of type ... is not compatible with right hand side of type PKG:Factory". Found at run time in the demo lab (2026-10-26); none of the 5,612 `create` expressions in the 8.61 lab snapshot does it. | Create the object into a Local first, then call the member: `Local PKG:Factory &f = create PKG:Factory(); &p = &f.Create(&cfg);`. |
| PC012 | A method parameter named after a property of the same class that has no get/set block, e.g. `method Reader(&config As PKG:Config);` with `property PKG:Config Config;`. A stored property is held like an instance variable, so App Designer reports 2,31, "Duplicate parameter name". Found at run time in the demo lab (2026-10-26). None of the 1,640 delivered classes does it; 13 name a parameter after a get/set property, which is allowed. A parameter named after an instance variable (`instance number &record;` with `method Who(&emplid As string, &record As number)`) is refused too: the class saved and decoded cleanly, but PIA reported "Class ... was not found" (180,74) and App Designer reported 2,31 "Duplicate parameter name" (8.61 lab, 2026-10-31); none of the 1,493 delivered classes in the 8.61 lab snapshot (518 with instance variables) does it. | Name the parameter differently (`&cfg`, `&newStatus`). |
| PC013 | A readonly property assigned inside its class through `%This` (`%This.RecordId = UuidGen();`). App Designer reports 2,46, "property cannot be changed" (found at run time in the demo lab, 2026-10-26). Delivered classes assign readonly properties through their variable 1,156 times and never through `%This`. | Assign it through its variable: `&RecordId = UuidGen();`. Reading it through `%This` is fine. |
| PC014 | A declaration naming several variables with an initialiser (`Local integer &i, &latest = 0;`). App Designer reports 2,42, "Syntax error: expecting statement" (found at run time in the demo lab, 2026-10-27). The 8.61 lab snapshot initialises a declaration 13,032 times, always one variable per statement. | Declare the initialised variable on its own: `Local integer &i;` then `Local integer &latest = 0;`. |
| PC015 | `.ParentRow` on a Row (`GetRow().ParentRow.GetRecord(...)`): ParentRow is a Rowset property, so PeopleCode reads it as a record name. App Designer reports 2,52, "GetRecord is not a method of class Record" (found at run time in the demo lab, 2026-10-27). The 8.61 lab snapshot writes `GetRow().ParentRowset` 46 times and `GetRow().ParentRow` never. | `GetRowset().ParentRow`, or `&row.ParentRowset.ParentRow`. |
| PC016 | A class method declared without a body. App Designer's Validate Syntax accepts the class, but PIA stops at run time with "Method Line has no body" (2,81) (found in the demo lab, 2026-10-27, a class saved without its last method). Every concrete method of the 1,510 classes in the 8.61 lab snapshot has a body. | Add the `method Name ... end-method;` body, or declare the method `abstract`. |
| PC017 | A string literal longer than 999 characters. 999 is the longest literal in delivered code (of 3,382 literals over 250 characters in the 8.61 lab snapshot); a longer one crashes App Designer and the application server when they load the program. | Split the literal into parts of at most 999 characters and join them with `|`. |
| PC018 | `True`, `False` or `Null` after a dot (`GetJavaClass("java.lang.Boolean").TRUE`). They are PeopleCode keywords; App Designer reports 2,49, "Dot not followed by Id". | Call a method instead (`Boolean.valueOf("true")`), or avoid the boolean. |
| PC019 | An `array of integer` (Local, instance or property) assigned `CreateArrayRept` or `CreateArray` of a number literal, e.g. `&Sizes = CreateArrayRept(0, 0);` with `property array of integer Sizes readonly;`. A number literal builds an Array of Number, so the assignment fails at run time: "Cannot convert type Array of Number to object type Array of Integer" (180,604). Validate Syntax accepts it (8.61 lab: a Local 2026-10-30, a readonly property 2026-10-31). One delivered program in the 8.61 lab snapshot declares an array of integer at all, never this way. | Declare `array of number`, or create it empty and `Push` integer values. |
| PC020 | `%Request.Method` (an iScript checking for POST). The Request class has no Method property: Studio saved the class, then the application server refused it, "Method is not a property of class Request. (2,50)", and every program importing the class failed to load ("Class ... was not found", 180,74) (8.61 lab, 2026-10-31). The 8.61 lab snapshot reads 44 distinct `%Request` members in 302 programs; the HTTP method is read as `HTTPMethod`, never `Method`. | `%Request.HTTPMethod`. |
| PC021 | A method of the class that returns a value, called through `%This` as a statement on its own (`%This.Done("DENY", &text, "");` with `method Done(...) Returns string`). App Designer reports 2,45, "Invalid start of statement"; Studio's checks and encoder accepted the class, and PIA then failed to compile it (8.61 lab, 2026-11-03). None of the 1,510 delivered classes in the 8.61 lab snapshot does it. | Use the result: `&result = %This.Done(...);`. |
| PC022 | A method or property named after a PeopleCode keyword (`method Alias(&rec As string)`). App Designer reports 2,42, "Syntax error: expecting Identifier"; Studio's checks and encoder accepted the class, and PIA then failed to compile it (8.61 lab, 2026-11-03). A property named `Error` was refused earlier. Of the keywords, delivered classes use only `Create`, `Value` and `Component` as member names (1,510 classes in the 8.61 lab snapshot), so those stay allowed. | Rename the member (`TemplateAlias`, `AddStep`, `ErrorMsg`). |

## Reading one row (guidance, not a rule)

Served by `psft_peoplecode_reference`. Found on the demo lab, 2026-10-27: a lab class looked a row up by ID and version
with `SelectByKey()` on a record keyed ID, VERSION, EFFDT, and found nothing.

| Call | Needs | Finds |
|---|---|---|
| `&rec.SelectByKey()` | every key set, EFFDT included when it is a key | that exact row; with a key unset, nothing (and the record is cleared, keys included) |
| `&rec.SelectByKeyEffDt(&date)` | every key except EFFDT | the row in force on `&date` (greatest EFFDT <= `&date`); a row dated later is not found |
| `SQLExec("%SelectAll(:1) WHERE ...", &rec, ..., &rec)` | the fields that identify the row | that row by any fields; check a key field afterwards, since SQLExec returns True either way (7 delivered programs use this form) |

Two more found on the demo lab, 2026-10-27 (also served by `psft_peoplecode_reference`):

- SaveEdit, SavePreChange and SavePostChange run for every row of the component on each save. A check, stamp or
  audit meant for edited rows tests `GetRow().IsChanged` (and `IsNew` / `IsDeleted`) first; 26 delivered save
  programs do. Without it, a Draft-only check refused the save because an untouched Retired version was in the page.
- RowInsert fired by `InsertRow` from another level (a level-0 button inserting into a level-1 scroll) resolves
  plain `RECORD.FIELD` references to the scroll's current row, not the inserted one; reach the row through
  `GetRow()` (20 delivered RowInsert programs do).

## Evidence

PC001-PC009 were broken by agent-written code on HRDMO (ZZ_BENEFITS) and
refused there by App Designer. Each rule also holds for
every delivered program in the local HCDEV snapshot: 35,831 programs, of which
1,510 are Application Classes. To re-run that check:

```bash
npx tsx tools/corpus/semantic-census.ts   # expects 0 flagged
```

Notes from the census:

- **PC010** comes from the October 19 native App Designer validation of
  `ZZ_RF_EXPORT.MAIN.Export`, corroborated by Oracle's
  [WriteLine contract](https://docs.oracle.com/en/applications/peoplesoft/peopletools/8.63/peoplecode-api-reference/writeline.html)
  and [file-error handling](https://docs.oracle.com/en/applications/peoplesoft/peopletools/8.63/peoplecode-api-reference/file-layout-error-processing.html).
  Its focused read-only HCDEV census covers all 413 programs containing
  WriteLine: zero flagged. The guard resolves explicit Locals within the same
  function/event body, preserves literal tokens in preceding `When` headers,
  and leaves unknown receivers or imported/custom File types outside scope.
  Valid statement calls and methods that return values, such as ReadLine,
  remain accepted. No encoding rule was changed.
  **Generalized the same day.** Native App Designer (HRDMO, unsaved buffer, Validate
  Syntax, nothing saved) also rejects `&v = CollectGarbage();` and
  `If &out.Close() Then` with 2,60, and accepts `&b = CommitWork();`. A built-in is
  listed only when Oracle's 8.63 Language Reference says "Returns: None" **and** the
  HCDEV snapshot calls it at least three times, never as a value. Corpus absence
  alone is not enough: Gray (8,853 calls), UnGray, SetDefault, Hide, UnHide,
  InsertRow, DeleteRow, HideScroll, SortScroll and CommitWork are never used as
  values in HCDEV either, yet are documented with an (optional) Boolean result.
  The File methods come from the 8.63 API Reference the same way (ReadLine,
  WriteRecord, WriteRowset and SetFileLayout return Boolean). Census: about
  11,200 listed built-in calls and 2,300 File method calls in 250 programs with
  a `Local File`; 0 of 35,831 programs flagged. A keyword after `-` (`End-If`)
  never makes the next call a value.

- **PC003.** The census ignores a bare `Return` that sits just before a block
  end (`End-If`, `Else`, `end-method`, ...) with no `;` after it. That form is
  legal.
- **PC005 and PC006.** Classes named only inside `/+ ... +/` signature comments
  need no import. The same goes for a class naming itself and for `%` built-in
  classes. Checked on HRDMO, 400 delivered programs gave no PC006 misses.
- **PC009's boundary came from the corpus, not from intuition.** A trailing
  letter is not wrong by itself: delivered code uses `%02t`, `%6.2T`, `%10.2v`,
  `%7.2Rt`, `%10.2Tv` and `%10.2Rv`. Across the 80 delivered programs that call
  `NumberToString`, 48 distinct literal formats appear, the only suffix letters
  are `R`, `T`, `t` and `v`, and **no format contains a `d`**. The rule flags a
  suffix outside that set. Census: 0 of 80 flagged.

- **PC008 was found at run time, not by App Designer.** The class saved and
  compiled; App Engine abended inside `ZZ_BNV_FILE:Config.Load` with
  `SQL.Fetch: parameter 1 is neither a record object nor a name. (2,284)`,
  where parameter 1 was the property `&Descr`. The same restriction stops
  `None()` taking a class instance variable (PC007), so the two are one family:
  arguments bound by reference take record fields, Locals and parameters. A
  Local or parameter that shadows the name is not flagged.

- **PC007 is limited to instance variables.** `None()` and `All()` on a Local or
  a parameter are legal. Delivered code does this in 124 programs with a Local
  date and 18 with a date parameter, including Application Class methods such
  as `GPS_HR_CORE:JobData.GetBDADate`. In contrast, 273 delivered classes
  declare instance string or date variables, and none of them passes one to a
  field-list function.
