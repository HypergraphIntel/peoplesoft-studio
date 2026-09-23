# PeopleSoft Studio — Codex Instructions

## Core rule
HCDEV corpus evidence is authoritative. Do not infer PeopleCode encoding rules from generic assumptions when corpus evidence is available.

## Validation hierarchy
1. source→bin EXACT = encoder correctness
2. roundtrip EXACT = decoder semantic correctness
3. decode SOURCE MATCH = literal/canonical source reconstruction

## Regression discipline
- Never accept an EXACT -> non-EXACT regression.
- Protected baseline is 430 definitions.
- After every encoder change:
  1. run the targeted definition
  2. run known regression IDs if applicable
  3. run the protected baseline
- Do not run the full 30k corpus until targeted and protected validation pass.

## Current commands
- npm run corpus:harness -- --definition-id <ID> --verbose --trace-refs
- npm run corpus:verify -- --limit 430
- npm run typecheck

## Encoder calibration rules
- Make one evidence-backed rule at a time.
- Prefer narrow structural rules over broad heuristics.
- Preserve all previously calibrated behavior.
- Do not modify the decoder when source→bin is not exact.
- When source→bin is exact but roundtrip is not, investigate decoder semantics.
- When source→bin and roundtrip are exact but decode source differs, treat it as decoder text reconstruction only.

## Source lineage
Always modify the current encoder/decoder, never an older calibration artifact.

Current encoder:
src/.../encoder.ts

Current decoder:
src/.../decoder.ts

## Corpus workflow
When a definition fails:
1. inspect first source→bin diff
2. inspect stored/generated body bytes
3. inspect reference trace if the diff is reference-related
4. inspect PSPCMNAME ordering if needed
5. identify the source construct at the first diff
6. make the narrowest evidence-backed change
7. rerun the same definition
8. rerun regressions
9. rerun protected baseline

## Important calibrated behavior
- repeated GetRowset(Scroll.X) may reuse SCROLL dependency within the proven control-group context
- Rowset selector `.Visible`, `.IsNew`, `.IsDeleted`, `.IsChanged` are inline row properties
- Rowset selector `.RECORD` is a compiled RECORD dependency
- same-line comments after Then/Else use inline comment opcode 0x4E
- Function metadata second directory field is signature-slot offset, not function ordinal
- blank-line multiplicity before End-If is significant