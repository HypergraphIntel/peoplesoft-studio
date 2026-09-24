# Proven Encoder / Decoder Rules

This file captures established corpus behavior that should not be casually
generalized or removed.

The repository root `AGENTS.md` is authoritative.

## Regression baseline

Current protected baseline:

```text
430 definitions
430 EXACT
0 failures
```

An exact protected definition must remain exact.

## Record / field provenance

Reference identity is context-sensitive.

Do not use a global same-name RECORD or FIELD cache.

Known context dimensions include:

- control group;
- target variable;
- declared Record variable;
- row shorthand;
- explicit `Record.REC.FIELD` chains;
- CreateRecord;
- GetRecord.

### CreateRecord

CreateRecord reuse has been observed to depend on:

```text
target variable
record name
control group
```

Do not broaden reuse globally.

### Explicit Record chains

The special reuse rule applies to true chains such as:

```peoplecode
Record.REC.FIELD.Value
```

It must not automatically apply to bare:

```peoplecode
Record.REC
```

including forms such as:

```peoplecode
CreateRecord(Record.REC)
GetRecord(Record.REC)
```

Bare Record references must preserve the previously calibrated helper behavior.

## Application Class provenance

Different PACKAGE dependencies may exist for:

- import;
- runtime `create`;
- method invocation.

These are not universally interchangeable.

Behavior may differ between:

- declaration phase;
- late top-level executable declarations;
- Function-local variables.

Do not globally reuse runtime-create dependencies for method calls.

## Control-group sensitivity

Many caches are control-group-sensitive.

Conceptual keys may resemble:

```text
controlGroup:recordName
controlGroup:variableName:fieldName
controlGroup:targetVariable:recordName
```

Do not remove control-group dimensions without corpus evidence.

## EOF semicolon behavior

Known top-level EOF exceptions include:

```text
If
Evaluate
assignment
```

Do not generalize to all statements.

For example, `Return True` without a semicolon is not automatically legal.

## Function / loop headers

Known calibrated behavior includes explicit semicolon handling for:

- Function headers;
- While headers;
- For headers.

Preserve these rules unless contrary corpus evidence exists.

## Comments

Ordinary block comments and disabled code are not the same construct.

Disabled PeopleCode:

```peoplecode
<*
  ...
*>
```

is opaque and must not be parsed internally as active PeopleCode.

Trailing/same-line block comments may use a distinct comment opcode.

## Blank-line preservation

Some blank-line structure is represented explicitly in PSPCMPROG.

Known contexts can use repeated `0x4F` markers.

Do not collapse all whitespace blindly.

## Imports / section boundaries

Import grouping and Local-section boundaries are sensitive to declaration type
and placement.

Do not add generic section markers without checking established cases.

## Decoder formatting

The decoder cannot necessarily recover every original formatting decision.

Examples:

- indentation width;
- some capitalization;
- line wrapping;
- alignment.

Do not sacrifice binary roundtrip correctness to reproduce one sample's cosmetic
formatting.

## Qualifier casing

Do not globally normalize all qualifier casing.

Broad casing changes have caused regressions.

Use narrow mappings only when supported by corpus evidence.

## Helper preservation

A helper becoming unused after a patch may indicate that new code bypassed
calibrated behavior.

Before deleting an apparently unused helper:

1. identify what behavior it encoded;
2. determine why the new path bypasses it;
3. route new behavior through it if possible;
4. run the regression gate.

Compiler reverse-engineering accumulates knowledge in code structure.
