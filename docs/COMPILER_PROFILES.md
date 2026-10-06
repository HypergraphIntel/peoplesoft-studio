# Compiler profiles

Cycle 184 made the PeopleTools compile context a first-class object, the
`CompilerProfile` (`src/peoplecode/compilerProfile.ts`).

This was a refactor only. No modeled behavior changed:
- the HCDEV corpus (PT861) is byte-for-byte unchanged;
- the 8.62.09 lab comparison (PT862) is byte-for-byte unchanged.

> PT861 and PT862 currently share the same modeled syntax, byte-layout and
> reference-allocation behavior. The first-class distinction currently
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
  id: 'PT861' | 'PT862';
  toolsRelease: string;            // '8.61' | '8.62'
  patchLevel?: number;
  applicationClassTypeMetadata?: ApplicationClassTypeMetadataProvider;
  syntax: { deltas: CompilerSyntaxDelta[] };                       // [] today
  byteLayout: { deltas: CompilerByteLayoutDelta[] };               // [] today
  referenceAllocation: { deltas: CompilerReferenceAllocationDelta[] }; // [] today
}
```

**Construction.** Profiles are built only through the factories:
`createPt861CompilerProfile(options)`, `createPt862CompilerProfile(options)`,
or `COMPILER_PROFILES[id](options)`.
- `options` carries the patch level and the metadata universe for that
  instance.
- Profiles are frozen.
- Metadata is never global: two profile instances with different
  universes do not affect each other.
- Source-visible declarations still take precedence over metadata.

**Selection by release.** `compilerProfileIdForToolsRelease` /
`compilerProfileForToolsRelease` read an explicit table (`8.61` -> PT861,
`8.62` -> PT862).
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

## Adding a release (e.g. PT863)

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
