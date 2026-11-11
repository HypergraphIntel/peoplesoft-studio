# App Designer captures, HRDMO 8.62.09, 2026-11-11

Read-only snapshots (`capture.mts`) taken before and after App Designer actions on lab objects.

**Subpackage deletion** (`ZZ_SUBPKG_LAB`):
- p0 → p1: new package with Gone, Keep and Keep:Deep in one save. APM +1, SYS +1, PSLOCK APM +1.
- p1 → p1b: Delete Gone (before saving). PBM +1, PSLOCK PBM +1, SYS +1.
- p1b → p2: Save. Gone's row is removed and the remaining rows move to the new APM with the save's timestamp. APM +1, PSLOCK APM +1, SYS +1. No PSPACKAGEDEL row.
- p2 → p3: the same for the level-2 Keep:Deep.
- p3 → p4: Keep:Kid and Other added in one save (one APM bump).
- p4 → p5: Delete Keep (App Designer asks "and all its children"), then Other, then one Save. PBM +2, SYS +3 in total, APM +1.

**Web library LICENSE_CODE** (`WEBLIB_ZZ_LIC`, Derived/Work, ISCRIPT1 and ISCRIPT2):
- w0 → w1: the first FieldFormula on ISCRIPT1 gets a 44-character LICENSE_CODE.
- w1 → w2: the program on ISCRIPT2 gets the same value.
- w2 → w3: an update to ISCRIPT1 keeps the value, and deleting ISCRIPT2 writes PSPCMPROGDEL.
- w4 → w5: with every program deleted, a new ISCRIPT1 program gets the same value again.

Across HCDEV 8.61.15 and HRDMO 8.62.09, all 158 web library programs licensed on both databases carry identical values, so the value is a fixed function of the record name.
