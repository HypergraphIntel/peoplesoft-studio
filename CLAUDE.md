# Autonomous corpus calibration

## Completion behavior

Do not stop after fixing one or several definitions.

A blocker affecting one definition is not a project-level blocker.

If the current definition cannot be advanced after exhausting available evidence:

1. Record the definition_id, construct, first diff, evidence searched, and missing evidence.
2. Mark that definition locally blocked.
3. Immediately select the next actionable failure family.
4. Continue autonomously.
5. Revisit locally blocked definitions when later calibration supplies new evidence.

Unsupported syntax is a research task, not a stopping condition.

Before declaring a definition blocked:
- search the HCDEV corpus for additional examples,
- search related syntax variants,
- inspect stored PSPCMPROG,
- inspect PSPCMNAME/reference traces when relevant,
- inspect existing encoder/decoder rules and tests,
- attempt to distinguish competing interpretations from corpus evidence.

Progress is not completion. Do not stop merely because:
- a first diff moved,
- a local target became exact,
- tests passed,
- a new unsupported construct appeared,
- or one failure family was completed.

After a successful fix:
1. rerun the target,
2. run relevant regression targets,
3. run the protected 430-definition gate,
4. repair any EXACT -> non-EXACT regression,
5. select the next actionable corpus failure,
6. continue.

Only stop the overall task when:
- the requested completion condition is satisfied,
- all remaining failures are independently blocked after evidence exhaustion,
- the user explicitly interrupts,
- or a system/resource limit prevents further work.

## Long-running execution

This task is expected to span many targets and possibly multiple context windows.

Do not return control to the user after ordinary progress updates.

Before context compaction or loss of working context:
1. Update `.claude/corpus-progress.md`.
2. Record the current definition_id and failure family.
3. Record the current first diff.
4. Record locally blocked definitions and why they are blocked.
5. Record the protected-baseline status.
6. Record the exact next action.

After context recovery, read `.claude/corpus-progress.md` and resume automatically.

A local blocker is not a global blocker.
