# em09 — fluid Event Mapping save, effect on PSPTCS_PARAMS

CREF ZZ_PCODE_LAB_CMP_GBL, fluid page PT_EVMAPPING_FL.GBL (PT_EVMAP_CFG_PG),
Save with no field change. Captured 2026-10-13 (HRDMO, signed in as JARED).

Result (em09-save-before.json vs em09-save-after.json):
- PSPTCSSRVCONF: all 3 rows DELETE+REINSERT, VERSION = ++SCNFM in GRID order
  (Record/P 53->54, Rec Field 52->55, Component 51->56).
- PSVERSION/PSLOCK SCNFM 53->56, SYS 2854->2857 (one bump per row).
- PSPTCS_PARAMS: UNCHANGED (EMSVC, EMSVC2 EV_PARAM defs untouched).
- PSPTCS_MAPFLDS: UNCHANGED. PSPTCSSRVDEFN: UNCHANGED. RCSCM/RCSDM: unchanged.

Conclusion: a fluid save does NOT create or touch PSPTCS_PARAMS or PSPTCS_MAPFLDS
when the param mapping is unchanged; it only reinserts PSPTCSSRVCONF with a new
VERSION per row (++SCNFM, SYS +1 each). Confirms the em04-em07 fluid-save rules
and the writer model. (The separate edge — fluid CREATING a PSPTCS_PARAMS def for
a service that has none, like EMSVC3 — needs the classic "Assign Event Mapping"
component as a precursor, since fluid Add needs the PTPORTALREGISTRY search index
not built on HRDMO.)
