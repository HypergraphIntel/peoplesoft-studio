# Corpus Classifications

The classification is a diagnostic category, not permission to patch a
particular subsystem automatically.

Always inspect the actual failure.

## EXACT

The strongest successful state.

Typical expectations:

```text
source -> binary exact
roundtrip exact
```

Protect this result from regression.

## ENCODE_ERROR

The original PeopleCode source could not be encoded.

Common causes:

- unsupported grammar;
- incorrect statement parser;
- missing terminator rule;
- unsupported declaration form;
- unsupported comment/disabled-code construct.

Start with the reported source offset and surrounding source.

## DECODE_ERROR

Stored PSPCMPROG could not be decoded.

Investigate:

- unknown opcode;
- incorrect operand length;
- directory/header handling;
- PSPCMNAME resolution.

Do not alter the encoder merely because decode fails.

## DECODE_SOURCE_MISMATCH

The decoder succeeds but normalized output differs from stored PSPCMTXT.

Determine whether the difference is:

- semantic;
- identifier/reference rendering;
- casing;
- whitespace/formatting.

Cosmetic formatting has lower priority than binary exactness.

## SOURCE_BODY_MISMATCH

Encoding succeeds, but generated executable bytes differ from PeopleTools.

Inspect the first differing byte.

Likely areas:

- opcode selection;
- statement/section boundary;
- comment opcode;
- blank-line markers;
- operator structure.

## SOURCE_REFERENCE_MISMATCH

Executable structure is largely correct, but PSPCMNAME/reference identity differs.

Use:

```bash
--trace-refs
```

Inspect `ALLOC` and `USE` events.

## ROUNDTRIP_ERROR

Decoded source cannot be re-encoded.

This usually means the decoder emitted a source form outside the encoder's
supported grammar or failed to preserve required information.

## ROUNDTRIP_BODY_MISMATCH

Decoded source re-encodes, but body bytes differ.

Investigate decoder semantic reconstruction before changing source formatting.

## ROUNDTRIP_REFERENCE_MISMATCH

Roundtrip body behavior is compatible, but PSPCMNAME/reference provenance differs.

Use reference tracing and compare allocation sequence.

## UNKNOWN_MISMATCH

Encoding/decoding completed but the current diagnostics could not narrow the
binary mismatch further.

Start with:

1. first differing byte;
2. stored/generated hex windows;
3. whether the difference contains opcode `0x21`;
4. PSPCMNAME indices used by stored and generated binaries;
5. reference trace if applicable.

Do not treat `UNKNOWN_MISMATCH` as a reason for a broad speculative patch.
