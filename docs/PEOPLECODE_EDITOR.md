# PeopleCode editor acceptance — completed in 0.9.7 development

Completed October 20, 2026. The task was: **Validate and polish the new
PeopleCode editor features — installed acceptance for record-field and
class-member completion, large programs, connection changes and stale
diagnostics.** Every requirement has current verification below; this task is
no longer an outstanding roadmap item. The compiler and encoder rules are
unchanged.

## Changes

- Member completion continues after a partial member name, including when an
  incomplete inherited-member list is requested again. Explicitly typed classes
  without public members no longer fall back to unrelated generic suggestions.
- Class completion parses declarations rather than method implementations.
  Inheritance is prefetched; database-backed completion waits at most 250 ms
  before returning an incomplete list. Pending definition searches are reused.
- Connection changes and local definition saves invalidate the relevant
  completion caches. Failed class/field/search reads can be retried without
  keeping a failed result for the normal cache lifetime. Cancelled, closed or
  obsolete requests cannot publish late completions.
- Live and explicit validation share editor lifecycle/environment checks in
  `src/peoplecode/editorValidation.ts`. Both compile on worker threads. Edits,
  closure, settings changes and connection changes invalidate pending work;
  obsolete explicit compilation is stopped, and a replacement can run promptly.
- Typing in an old connection's document does not reconnect that environment.
  Unavailable field metadata does not become a false missing-field diagnostic.
  Release and metadata caches are cleared when connections/settings change.

## Completion audit

| Requirement | Verified evidence |
| --- | --- |
| Installed acceptance | The native runner installs a VSIX into a clean profile and activates it normally. Its extension path is asserted; the installed manifest, production bundle and validation worker remain unmodified. All 13 checks pass on VS Code 1.141.0 / Oracle HRDMO 8.62.09. |
| Record-field completion | Native lab-record and delivered JOB fields, including partial prefixes; the actual JOB.EMP popup renders EMPLID. Controlled-delay fixtures also cover slow reads, retries, cancellation, closure and cache replacement. |
| Class-member completion | Native own/private/inherited members, `%This.` and `%Super.`, imported typed objects, public/private visibility, unsaved class edits and override precedence. The actual `%This.O` popup renders Own. Incomplete inherited lists are also tested while reads are delayed. |
| Large programs | A real 593,979-character delivered EP_FUNCTIONS:WorkCenterUI class completes validation in 4,974 ms, publishes diagnostics and has no syntax/unsupported-construct problems; its completion takes 26 ms and the host heartbeat's maximum interval is 12 ms. Existing advisory unknown-function/definition notes are separate from that compiler-problem count. A separate 672,211-byte stress program is cancelled after an edit and its replacement validates successfully. |
| Connection changes | The installed host switches A → B → A, verifies that an old document does not reactivate its connection or acquire false missing-field warnings, and restores completion/diagnostics on reconnect. Fixtures independently verify replacement metadata and an 8.62 → 8.61 compiler-profile change. |
| Stale diagnostics and settings | Native latest-edit, language-server/environment/unknown-function setting changes and actual document close/reopen checks pass. Fixtures cover delayed metadata, obsolete document versions, closure, context revisions and cancellation of running explicit validation. |
| Regression and preservation | Full verify: 2,078 unit tests pass, one skipped; activation smoke and all 17 production editor fixture checks pass. The 54 HTTP MCP/editor fixtures have separate recorded passing evidence. Independent native readback confirms all three inspected programs' stored source and native fingerprints are unchanged. |

The passing [native report](../tools/lab/results/peoplecode-editor-native-2026-10-20.json)
records individual checks, timings, target release, artifact hashes, installation
integrity and database preservation. The rendered popups were also visually
inspected: [record fields](../tools/lab/results/peoplecode-editor-record-popup.png)
and [class members](../tools/lab/results/peoplecode-editor-class-popup.png).
The production bundle hash identifies the candidate tested in that report.
Later development changes and their separately installed candidates have their
own evidence below; the original running window is not automatically reloaded.

## Reproduction

`npm run verify` includes compile/typecheck, unit tests, activation smoke and
`npm run test:peoplecode-editor`. The editor fixture script uses production
providers with controlled delays, failed reads, cancellation and lifecycle
events. It is separate from native acceptance.

`npm run test:peoplecode-editor:native` requires local VS Code at
`/usr/share/code/code`, Xvfb, the existing HRDMO lab endpoint, and
`PSLAB_ACCESSID` / `PSLAB_ACCESSPSWD` in the environment. It packages and installs
an unmodified VSIX in a private profile/X display. A separate test-driver
extension invokes VS Code's real completion, diagnostics and editor APIs.
Loopback-only CDP answers only the expected native password prompt and checks
and captures the rendered suggestion widgets; it does not replace the
extension's code, providers, input model or activation entry point. Credential
values are not logged or written to the test configuration.

## Inline call preview

Supported built-in calls now show a faint complete-call preview on the editing
line, for example `CreateSQL(sqlText, bindValues);`. **Tab** accepts the preview
and selects the first argument placeholder; subsequent tabs move through the
arguments. An optional argument's placeholder includes its comma, so it can be
removed as one segment. These are curated call skeletons, not generated SQL or
guesses about local variables. Replace placeholders before validating or saving.

The preview reuses an existing closing parenthesis and semicolon, preserves
surrounding expressions, and leaves authored arguments, strings, comments and
method declarations alone. Unknown calls retain ordinary editor behavior.
Signature help remains available above the line.

**PeopleSoft Settings → PeopleCode Editor → Inline call preview** controls this
feature (`peoplesoft.peoplecode.inlineCallPreview`). It also requires the
Language Server and VS Code inline suggestions. PeopleCode enables inline
suggestions by default, while explicit user/editor overrides remain effective.

Five focused tests cover complete calls, nested expressions, closing
punctuation, authored arguments, comment/string contexts and Unicode offsets.
`npm run test:peoplecode-inline:installed` exercises the unmodified packaged
extension in a separate VS Code/Xvfb profile using only unsaved buffers and its
private clipboard; no PeopleSoft connection or save is involved. It checks
automatic rendered ghost text, physical Tab acceptance, editable argument tab
stops, and disabling the feature while preserving signature help.

All four installed checks pass. The [actual rendered preview](../tools/lab/results/peoplecode-inline-preview.png)
and [installed results](../tools/lab/results/peoplecode-inline-installed-2026-10-20.json)
record this separately from the earlier database-backed editor acceptance.

Only the existing lab record/class buffers are edited, and those edits are
discarded. The large delivered class is read as stored source and is never
edited. The temporary profile's name-prefix setting is relaxed only to open
that stored source, then restored. No Save command or database writer is used;
the final independent source/fingerprint comparisons are mandatory. The
runner terminates its entire private process group if it times out and removes
its temporary profile. It retains the result report, screenshots and tested
VSIX in the requested output directory (default `/tmp`).

## Scope and activation

The original acceptance task is complete. These results establish the listed
editor behavior on the named installed VS Code/Oracle environment; they do not
claim every PeopleCode construct, platform or release is certified. No native
App Designer compilation or scheduler execution was performed. Broader language
intelligence and compiler/platform qualification remain separate development
work, not unfinished acceptance of these editor features.

The verified 0.9.7 production bundle and validation worker are installed in the
default profile. An already running developer window still needs
**Developer: Reload Window** to activate that installation; normal activation
of the exact installed bundle has been verified in the acceptance host.
