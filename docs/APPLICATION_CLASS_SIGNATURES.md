# Application Class signatures

## Signature comments (source)

App Designer writes signature comments into every method, get and set body
when it saves a class; Studio's PeopleCode save does the same
(`src/model/appClassSignatures.ts`, called from `savePeopleCode`):

```
method Describe
   /+ &count as Integer, +/
   /+ &names as Array of String out +/
   /+ Returns String +/
   /+ Extends/implements PKG:Base.Describe +/
```

- One line per parameter in order (`&name as Type`, ` out`, a comma on all
  but the last), then `Returns Type`, then `Extends/implements`. A get body
  gets `Returns Type`, a set body `&NewValue as Type`.
- Types: built-ins in canonical case; `array of array of T` becomes
  `Array2 of T` and a bare `array` `Array of Any`; classes by full path in the
  package's own case (imports and wildcard imports resolved through
  PSAPPCLASSDEFN); `%metadata:` becomes `%Metadata:`.
- `Extends/implements` names the nearest ancestor (extends or implements)
  declaring the member publicly, or protected and abstract, with that
  ancestor's casing of the name. Private and protected non-abstract
  declarations are passed over; a built-in parent class ends the walk.
  Parents are read from PSPCMTXT, or decoded from PSPCMPROG when a delivered
  class has no stored text.
- The block replaces any comment lines directly after the header, three spaces
  deeper than the header. Commented-out code is left alone.

Evidence: run over the 8.61.15 corpus snapshot (with 62 parents decoded from
the database), the generator returns 1,382 of 1,387 class sources unchanged;
the other five carry comments left stale by later edits or a package name
cased differently in the source. On HRDMO, App Designer opened a class Studio
had saved with these comments and re-saved it to identical compiled bytes and
name rows.

On October 18, 2026 the current source writer was also exercised directly on
HRDMO 8.62.09: signature lines were removed from an existing lab class's input,
then regenerated during a committed save. Readback matched the original
stored source, compiled bytes and reference rows exactly. The normal save
versions and stamps advanced; this check did not execute the class at runtime.

# Application Class primitive signatures — 2026-09-22

Read-only SYSADM evidence replaces the encoder's hard-coded String → String
method trailer. No database definitions were edited or compiled.

## Established structure

For a public concrete method, the 16-byte directory record contains four
little-endian uint32 values:

| Byte | Observed value |
| --- | --- |
| 0 | Method name's UTF-16 code-unit offset in the name directory |
| 4 | Starting index in the four-byte dispatch-slot table |
| 8 | Parameter count |
| 12 | Return descriptor, or `0x07` without a Returns clause |

Parameters occupy slots in declaration order, followed by one `0x00000007`
slot, even for a zero-parameter method. String is `0x01`, Boolean `0x05`, and
Integer `0x11`. Ordinary method parameter slots contain these plain IDs;
they do **not** use Function's `0xC0000000 | typeId` representation.

For the existing single-method class, the header word at byte 21 becomes
`parameterCount + 1`. The record count at byte 29 remains 2 (self + method).
The name-directory byte length is independent of the number of primitive
parameters. Statement length still includes the final directory separator.
The self record is retained for the already-supported non-inherited class;
this does not generalize inheritance, interfaces or properties.

## Evidence and regression coverage

PSPCMTXT was searched for the 80 shortest sources containing `end-class`,
then the 100 shortest Application Package sources containing integer,
boolean, date, time/datetime parameter or integer/boolean return spellings.
Every selected definition was correlated using all seven OBJECTID and
OBJECTVALUE pairs. Complete CLOB/BLOB chunks were read in PROGSEQ order;
all PSPCMNAME columns were retained, including blank owner rows.

An exploratory audit matched 164 public concrete primitive-only method
signatures across these samples. This count includes repeated definitions
between the two samples and equivalent classes in different packages;
it is not a count of independent controlled experiments. Observed Date,
Number, DateTime and out-parameter descriptors are not newly enabled here.

Twelve selected complete captures are checked in at
`src/test/fixtures/applicationClassSignatures.ts`, including:

- ZZ_CORPUS.Utilities.TestClass: one String parameter, no return.
- PTAF_MONITOR.ADHOC_OBJECTS.saveButtonLogicBase: zero parameters, no return.
- CAF_API.OBJECT.Action: two String parameters, no return.
- ZZ_JET_PACK.Arbiter.AppPackClass: String/Integer parameters.
- PA_ROLLOVER.Rollover: String/Integer/String parameters.
- PTAF_EMC.LAYOUT_ELEMENTS.grid and endGrid: Boolean parameter, String return.
- GP_ABS_CS_TMPL.TMPL.absTmplDataSaveEx and absTmplInvalidIndexEx:
  Integer returns, nonzero method slot offsets.
- PTAF_UI.GenericUIController: two parameters, Boolean return.
- GP_FRML_TYPEAHEAD_EDITOR.EditorUserPreferences: zero parameters, String return.
- ZZ_CORPUS.TestClass: the existing complete String → String program.

Tests compare generated method records/slots with the original buffers,
decode their declarations, and preserve all generated `0x6D` annotations,
including commas. These are **section goldens**, not full-program encoding
claims for unsupported method bodies. The existing ZZ_CORPUS program also
has byte-exact full-program tests from saved source and from decoded source.
No existing golden was changed or removed.

The Application Class source parser now reads primitive parameter lists and
an optional return clause. Its method-body recognizer remains narrow; the
requested integer Local/If/Return body is not enabled by these section tests.
The metadata helper supports zero parameters/no return independently of that
body restriction. Method implementations requiring no signature annotation
remain outside the existing program recognizer.

## PSPCMNAME discrepancy

The currently saved ZZ_CORPUS.TestClass source is still the old String →
String program with `Local ... &obj`, create/call, and `Return "Hi"`.
Its 626-byte binary is unchanged from the earlier read. Its current names are:

| NAMENUM | RECNAME | REFNAME | PACKAGEROOT | QUALIFYPATH | APPCLASSMETHOD |
| --- | --- | --- | --- | --- | --- |
| 1 | blank | blank | blank | blank | blank |
| 2 | PACKAGE | TESTCLASS | ZZ_CORPUS | Utilities | blank |

This contradicts the earlier owner-only assumption. The complete raw row
values are retained in the fixture. Other captures also contain PACKAGE rows,
including SQL/Record variables and imported/created classes. No general
Application Class dependency-allocation rule is established by this change.
The encoder's existing `references: []` result is therefore a **known artifact
mismatch**, not a passing PSPCMNAME golden. Do not apply event-program
allocation rules to fill the gap.

## Remaining calibration boundaries

The requested exact String/Integer/Boolean → Integer class is not present at
either ZZ_CORPUS.TestClass or ZZ_CORPUS.Utilities.TestClass in this connection.
A full-program golden for that body still requires the exact requested class
saved in the connected environment, preserving App Designer's annotations.
The checked-in captures provide section evidence, not substitute bytes for it.

Property directory ordering cannot be assumed to follow source order:
ADSM.ADSKey declares Name then Value and stores that order, whereas
ADSM.ADSGroupMember declares RecordName then FieldName and stores FieldName
then RecordName. PTADSSUMREPT.RelevantDataSet likewise declares AdsName then
Derivation and stores Derivation then AdsName. These observations do not
establish a general ordering algorithm. Multi-method ordering also needs
care: BEN_DEPDOC_EVT_HNDLR.threadDescr's method directory follows implementation
order while its dispatch offsets track a different order.

**Requires new App Designer calibration fixtures:** capture the same small
non-inherited class containing only `property string Name;` and
`property string Value;`, then reverse just those two declarations and
capture again. Also capture the existing ZZ_CORPUS class with only its
import, only its class-typed Local, then Local + create, to isolate which
constructs allocate the observed PACKAGE row. Preserve every name column.
These controlled differences are needed before general property/dependency
encoding; do not invent an ordering or deduplication rule.

The named DOCX calibration tracker was not found in the checkout or supplied
attachments. This document records the checkpoint and unresolved boundaries.

## Reproduce a complete capture

```sh
node scripts/capture-peoplecode.mjs /tmp/appclass.json ZZ_CORPUS TestClass OnExecute
```

The script uses PS_CONNECT_STRING, PS_USER and PS_PASSWORD, issues SELECTs
only, resolves all object ID/value pairs from PSPCMTXT, and fails if the
values select more than one definition. Output includes exact source,
complete chunk hex, compilation metadata and all raw name rows.
