# Preferred design decisions

Recorded from the user's direction on October 14, 2026. These are preferred
architectural directions for the [proposal](PROPOSAL.md), not claims of
implemented features. Technical contracts remain subject to the repository
investigation tracked in [PROGRESS.md](PROGRESS.md).

## 1. Checkpoints and dependency-aware reversal

Use checkpoints rather than treating Undo as restoring database rows.
PeopleSoft objects have relationships: reversing a record definition can affect
pages, SQL tables and processes. The intended model is Git-style revisions for
PeopleSoft objects, with actual database state verified before restoration.

Design implications:

- Preserve immutable, integrity-verifiable object revisions and checkpoints,
  scoped to the connection and verified target environment.
- Capture relevant relationships and verified application results with each
  checkpoint; investigate how dependency coverage and unknown references are
  represented rather than assuming complete dependency closure.
- Re-read live objects before reversal and compare against the expected applied
  revisions. Detect drift, missing dependencies and cross-environment mismatches.
- Prepare dependency-aware reverse Change Sets for developer review and approval;
  apply them through the normal validated writers and verify persisted results.
- Distinguish metadata reversal from physical database changes. Restoring a
  record definition does not establish that its SQL table or application data
  can be safely restored.
- Preserve explicit unsupported, partial and conflicted outcomes. A checkpoint
  does not imply multi-object atomicity or guarantee reversibility.
- Treat redo as a newly staged forward change validated against current state.

Milestones: define checkpoint/revision contracts during architecture and the
Change Set foundation; implement checkpoints/journaling with safe application;
prove dependency-aware reversal and redo in the history milestone.

## 2. Eventual Change Set timeline in the workspace

Add a navigable timeline to the persistent workspace, connecting Change Sets,
object revisions and verified application history. Support browsing by object
and environment, identifying the current verified revision and captured
baseline, comparing retained revisions, and preparing reviewed reversals.

Illustrative presentation supplied by the user:

```text
Object Change History
HCDEV

Revision 4 — Current
  Applied
  Added audit functionality · Oct 14, 2026
Revision 3
  Modified page layout · Oct 12, 2026
Revision 2
  Added employee status fields · Oct 10, 2026
Revision 1 — Baseline
  Original definition captured · Oct 9, 2026
```

**Illustration only: these environments, revisions, dates and changes are not
actual repository history or verified database events.** A displayed baseline
means a captured starting revision; it does not by itself prove Oracle-delivered
ownership or pristine environment state. Historical “Current” must be checked
against live state before restoration; the UI must disclose drift or unverified
freshness rather than imply the database still matches the last Studio save.

Plan the revision relationships and indexing early. Deliver the timeline with
history capabilities once durable, verified history is available; do not show
mock entries as real application history.

## Future extension points

The intended outcome is a controlled development environment with an
AI-assisted staging area, semantic change review and auditable revisions.
Checkpoint and revision contracts should leave room for:

- Comparing HCDEV with HCTST or other explicitly selected environments.
- Promoting Change Sets between environments.
- Exporting deployment packages.
- Reviewing AI-generated customizations before promotion.

These are future capabilities, not existing support or acceptance claims.
Cross-environment promotion must use target-specific discovery, baseline/drift
checks, dependency validation and approval; source-environment approval cannot
be assumed to authorize a different target.
