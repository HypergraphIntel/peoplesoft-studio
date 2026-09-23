# Debugging Checklist

Use this checklist for every new failure.

## Identity

- What is the stable `definition_id`?
- What is the seven-part PeopleSoft key?
- Is the displayed offset being used only as metadata?

Target with:

```bash
npm run corpus:harness -- --definition-id <ID> --verbose
```

## Validation state

1. Did decode succeed?
2. Does decoded source match normalized PSPCMTXT?
3. Did source encoding succeed?
4. Is source-to-binary exact?
5. Did roundtrip encoding succeed?
6. Is roundtrip exact?

## First binary difference

Record:

- absolute first differing offset;
- body-relative offset if applicable;
- stored hex window;
- generated hex window.

Ask:

- is the mismatch in the program header?
- executable body?
- directory/metadata?
- a reference operand?

## Reference mismatches

If bytes resemble:

```text
21 xx xx
```

treat the operand as a PSPCMNAME/reference index candidate.

Run:

```bash
npm run corpus:harness --   --definition-id <ID>   --verbose   --trace-refs
```

Compare:

- which reference was allocated;
- when it was allocated;
- control group;
- source offset;
- sequence/index;
- reference kind;
- which reference was actually used.

Questions:

1. Was the expected row never allocated?
2. Was an older row incorrectly reused?
3. Was a duplicate row required?
4. Did a control-group transition occur?
5. Did variable/receiver provenance change?
6. Did a generalized cache choose the wrong row?

## Grammar / opcode mismatches

Ask:

1. What source construct begins near the failing source offset?
2. Is the parser consuming too much or too little?
3. Is a semicolon implicit or explicit?
4. Is there a section/body delimiter before the statement?
5. Are blank lines represented as opcodes?
6. Is a comment opaque or parsed?
7. Is this top-level, Function-local, or nested control flow?

## Patch design

Before editing:

- identify the narrow context;
- identify existing helpers that already model adjacent behavior;
- avoid new global reuse rules;
- avoid deleting calibrated logic;
- avoid speculative decoder formatting changes.

## Validation after patch

Run in this order:

```bash
npm run corpus:harness -- --definition-id <ID>
npm run corpus:work
npm run corpus:verify -- --limit 430
tsc -p .
npm test
```

Stop immediately if a protected definition regresses.

## Inventory safety

If a multi-chunk inventory script is currently running:

- do not deploy corpus-tooling changes into the live working tree;
- allow the inventory campaign to finish first;
- then apply changes and verify the protected baseline.

A later chunk can start a fresh process and otherwise mix harness versions.
