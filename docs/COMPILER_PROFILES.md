# Compiler profiles

Cycle 184 made the PeopleTools compile context a first-class object, the
`CompilerProfile` (`src/peoplecode/compilerProfile.ts`).

This was a refactor only. No modeled behavior changed:
- the HCDEV corpus (PT861) is byte-for-byte unchanged;
- the 8.62.09 lab comparison (PT862) is byte-for-byte unchanged.

> PT861, PT862 and PT863 currently share the same modeled syntax, byte-layout
> and reference-allocation behavior. The first-class distinction currently
> supplies release context and the correct metadata universe; future
> controlled evidence may add explicit profile deltas.

## Terms

| Term | Meaning | Where |
|---|---|---|
| PeopleTools release family | `PSSTATUS.TOOLSREL`, e.g. `8.61`. It selects the profile and is the `#ToolsRel` value. | `CompilerProfile.toolsRelease` |
| patch | `PSSTATUS.PTPATCHREL`, e.g. `9`. Informational; no modeled behavior depends on it. | `CompilerProfile.patchLevel` |
| compiler profile | The release family plus the compile context and any evidence-backed behavior deltas. | `compilerProfile.ts` |
| lab release | One concrete installation (`8.61.15`, `8.62.09`): client hashes, paths, Wine prefix. Not a compiler concept. | `PEOPLETOOLS_RELEASES` / `LabReleaseConfig` in `corpus/controlledCompileRunner.ts` |
| metadata universe | The Application Class definitions a program is typed against (HCDEV's, HRDMO's, a test's). | `CompilerProfile.applicationClassTypeMetadata` |

## The profile

```ts
interface CompilerProfile {
  id: 'PT861' | 'PT862' | 'PT863';
  toolsRelease: string;            // '8.61' | '8.62' | '8.63'
  patchLevel?: number;
  applicationClassTypeMetadata?: ApplicationClassTypeMetadataProvider;
  syntax: { deltas: CompilerSyntaxDelta[] };                       // [] today
  byteLayout: { deltas: CompilerByteLayoutDelta[] };               // [] today
  referenceAllocation: { deltas: CompilerReferenceAllocationDelta[] }; // [] today
}
```

**Construction.** Profiles are built only through the factories:
`createPt861CompilerProfile(options)`, `createPt862CompilerProfile(options)`,
`createPt863CompilerProfile(options)`, or `COMPILER_PROFILES[id](options)`.
- `options` carries the patch level and the metadata universe for that
  instance.
- Profiles are frozen.
- Metadata is never global: two profile instances with different
  universes do not affect each other.
- Source-visible declarations still take precedence over metadata.

**Selection by release.** `compilerProfileIdForToolsRelease` /
`compilerProfileForToolsRelease` read an explicit table (`8.61` -> PT861,
`8.62` -> PT862, `8.63` -> PT863).
- Any other value, including a patch-qualified `8.62.09`, throws
  `UnsupportedCompilerProfileError`.
- There is no string-order guessing and no fallback to PT861.

**Deltas.** Each family's `deltas` list is typed and empty today: the
delta types are `never`.
- A future difference is added as a typed union member carrying its
  evidence, not as a boolean switch.
- Every 8.62 finding so far was release-neutral:
  - H2: an end-of-body close bug;
  - 28943: a parser gap;
  - 4601 / 4602 / 18249 / 18256: release context;
  - 23497: metadata universe.

## Encoder API

`EncodeProgramContext.profile` is the one owner of the release and the
metadata universe. `resolveCompileContext` runs first in
`encodeProgramArtifacts`:
- With a profile, `conditionalCompilation` is `{ toolsRelease:
  profile.toolsRelease }` and `applicationClassTypeMetadata` is the
  profile's.
- A caller that also passes either option with a different value gets a
  `CompilerProfileConflictError`. Agreeing values are accepted.
- Resolution is idempotent.
- `conditionalCompilation` is `@deprecated`. It is still honored when no
  profile is given, as is a bare `applicationClassTypeMetadata`. Frozen
  research scripts use that legacy path.

**No default profile.** `encode(source)` assumes no release, exactly as
before Cycle 184: a `#If #ToolsRel` directive does not encode without
one. PT861 is what the HCDEV harness selects explicitly. For a program
without directives or metadata, `encode(source)` and `encode(source, {
profile: PT861 })` are identical.

## Who selects a profile

| Caller | Profile |
|---|---|
| HCDEV harness (`corpus-runner.ts`, `validator.ts`, taxonomy) | `snapshotCompilerProfile(db, snapshotApplicationClassTypeMetadata(db))`: the snapshot's recorded release (HCDEV -> 8.61 -> PT861) with its classes. Live runs: none. |
| Research library (`research/lib/harnessContext.ts`) | `harnessCompilerProfile(ctx)`; `encodeAsHarness` accepts `extra.profile` or translates legacy overrides to one profile. |
| Controlled compile (`controlledCompile.ts`, `compare-controlled-compile.ts`) | `compilerProfileOfCapture(results.lab, metadata)`: the capture's own `toolsRelease`. `expectedProfileId` turns a mismatch into an error; `--release` applies to `--predict` only. |
| Lab tools (`PSLAB_RELEASE`) | `compilerProfileForLabRelease(releaseProfile(PSLAB_RELEASE))`: `8.61.15` -> PT861, `8.62.09` -> PT862. The configured id must match the config's own TOOLSREL. |
| `compare-delivered.ts` | `compilerProfileForToolsRelease(lab TOOLSREL, { patchLevel, applicationClassTypeMetadata: <the lab's 12,270 classes> })` |

## PT863 evidence (2026-11-24)

The home lab (HRDMO) was upgraded from 8.62.09 to 8.63.05 on 2026-11-22.
The upgrade recompiled 963 programs; the other ~118,500 still hold the
8.62.09 bulk compile of 2026-05-08. There is no 8.63 App Designer client
in the lab, so the evidence is the database's own 8.63 output, compared
read-only by `tools/corpus/controlled-compile/compare-lab-native.ts`
(report: `results/8.63.05/native-comparison.json`).

| Population | Profile | Exact (bytes + PSPCMNAME) |
|---|---|---|
| 963 programs compiled by 8.63.05 | PT863 | 927 (96.3%) |
| the same 963 | PT862 | 927 (the same set) |
| 3,000-program sample of the 8.62.09 compile | PT862 | 2,969 (99.0%) |

- Every exact program's 37-byte header matches; the header differences
  in the misses are only the length fields of a body that differs.
- No result depends on the release: PT862 and PT863 give the identical
  exact set (4 programs use `#ToolsRel`; their verdicts do not change).
- None of the 36 misses is in the HCDEV snapshot. Their families all
  occur in the 8.61 corpus and are encoder gaps, not release deltas:
  - 10 encode errors: `(create X()).Method()`; `ComponentLife
    %metadata:...` declarations; `JsonBuilder` / `JavaObject` /
    `ProcessRequest` as Function parameter or return types; and
    expression parse gaps in Application Class headers and assignments;
  - missing `PACKAGE.*` rows for `import %metadata:...` (e.g.
    `%metadata:Webhook:Ptibwebhdrprp` stores `PACKAGE.PTIBWEBHDRPRP`)
    and missing `FIELD.*` rows;
  - PSPCMNAME rows in a different order (5);
  - a comment inside a property type, and a blank line before a Function,
    dropped;
  - byte-only differences with identical decoded text (about 8).

So PT863 was added with no deltas. The lab-release table
(`PEOPLETOOLS_RELEASES`) has no `8.63.05` entry yet: it needs the 8.63
client's hashes, and the SMOKE / H / G controlled fixtures have not been
compiled on 8.63.

## Adding a release (e.g. PT864)

1. Run the controlled comparison on that release:
   - the SMOKE / H / G fixtures;
   - `compare-delivered.ts --all` against a lab of that release.
2. Classify every difference before touching the encoder:
   - parser;
   - metadata / type resolution;
   - preprocessor / release context;
   - reference allocation;
   - byte layout.
3. Add the profile: an id, a factory, a row in the release table, and the
   lab release's `compilerProfileId`.
4. Add only the evidence-backed deltas, as typed entries, each with its
   controlled evidence and a test.
5. Re-run the HCDEV PT861 gate and every earlier release's comparison:
   older profiles must not move.
