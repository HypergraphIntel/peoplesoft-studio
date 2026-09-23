---
name: peoplesoft-corpus-calibration
description: Calibrate the PeopleCode encoder/decoder against HCDEV corpus evidence while preserving exact protected-baseline definitions.
---

For each actionable failure:

1. Target by stable definition_id.
2. Inspect source→bin before decoder text.
3. Locate the first binary difference.
4. Map it back to the PeopleCode construct.
5. Search the corpus for corroborating examples.
6. Inspect PSPCMNAME/reference trace only when relevant.
7. Derive the narrowest evidence-backed rule.
8. Implement it.
9. Re-run the target.
10. Run related calibration examples.
11. Run the protected 430-definition gate.
12. Repair regressions before continuing.
13. Select the next actionable failure automatically.

Never guess byte semantics merely to advance a target.
Never treat one blocked definition as a global blocker.

## Long-running work

This task may span multiple context windows.

Do not stop because the current context window is becoming full.
Before compaction/context refresh:
- save current calibration state,
- save locally blocked definitions,
- save the current target and first diff,
- save regression status,
- save the next planned action.

Resume from that persisted state after compaction and continue autonomously.
