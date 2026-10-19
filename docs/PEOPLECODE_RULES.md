# PeopleCode rules checked before saving

Studio's PeopleCode encoder reproduces PeopleTools' bytes for valid programs,
but it was built to encode, not to judge. It accepted programs that App Designer
refuses, and the first build request's agent-written code showed which ones.
These checks now run before every PeopleCode save: the PeopleCode editor,
`psft_save_peoplecode`, App Engine saves and menu saves. A save that breaks a
rule is refused with each problem's line and the fix.
`psft_validate_peoplecode` runs the same checks without saving.

Implementation: `src/peoplecode/semanticCheck.ts` (PC001-PC005, PC007-PC010) and
`DatabaseProvider.peopleCodeImportProblems` (PC006).

## Rules

| Code | Refused | Fix |
|---|---|---|
| PC001 | A property declared `readonly` or plain (no `get`) that has a `get` block. A `get`/`get set` property with no block. A `set` block on a property that is not `get set`. A get/set block with no matching property. | Declare `property string Name get;` when there is a `get Name ... end-get;` block. `readonly` is only for a stored property without one. |
| PC002 | An instance variable with a property's name (`property string Status get;` plus `instance string &Status;`). | Rename the instance variable, e.g. `&sStatus`. |
| PC003 | `Return <value>` outside a Function, method, get or set. This covers event, Record, Component, Page, Menu and App Engine PeopleCode. | End early with a bare `Return;`. In App Engine, `Exit(1)` hands control to the action's On Return setting. To produce a value, write a Function that returns it. |
| PC004 | A `Local` that re-declares a parameter of its function or method, or (in a method, get or set) a class instance variable. | Use the parameter or instance variable directly, or choose another name. |
| PC005 | An Application Class used (`create`, a declaration, `As`, `extends`, `implements`, `Returns`) with nothing imported from its package. This applies in every program, including other classes in the same package. | Add `import PKG:Class;` or `import PKG:*;` at the top. |
| PC006 | An imported class that does not exist, or a wildcard that names no package. This needs the database. | Save the imported class before the program that imports it. |
| PC007 | `None`, `All`, `AllOrNone`, `OnlyOne` or `OnlyOneOrNone` given a class instance variable or a `%This` property. App Designer says "Field or temporary variable name required". | Copy the value into a Local first (`Local date &d = &i_checkDt; If None(&d) Then`), or for a date use `IsDate(&i_checkDt)`. |
| PC009 | `NumberToString` given a printf conversion, e.g. `NumberToString("%04d", &n)`. The format is PeopleSoft's `%<width>[.<decimals>]` with an optional `R`, `T`, `t` or `v`; a conversion letter is taken literally. At run time `"%04d"` on 2026 gives `d-ba`. | Drop the conversion letter (`"%04"`, `"%02"`), or use `String(&n)` when no padding is needed. |
| PC008 | `SQL.Fetch` given a property or a class instance variable as an output parameter. Fetch binds its outputs by reference; a property is reached through a getter, so there is no variable to write into. At run time: `SQL.Fetch: parameter 1 is neither a record object nor a name. (2,284)`. | Fetch into `Local` variables and assign afterwards (`Local string &a; ... .Fetch(&a); &Descr = &a;`). |
| PC010 | A call that returns nothing used directly as a condition, assignment, operator operand, loop bound, `Return` value or argument: one of 32 built-in functions documented "Returns: None" (`Error`, `Warning`, `DoSave`, `Transfer`, `SetCursorPos`, `UpdateValue`, `CallAppEngine`, `CollectGarbage`, ...; list in `semanticCheck.ts`), or `Open`, `Close`, `Delete`, `SetPosition`, `WriteLine`, `WriteString`, `WriteRaw` or `WriteBase64StringToBinary` on a known `Local File` receiver. Native App Designer reports 2,60, "Function or method does not produce a result value." | Call it as a statement: `&file.WriteLine(&line);`, `DoSave();`. File-method errors abort execution; there is no Boolean result to inspect, so test `&file.IsOpen` after opening. |

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
