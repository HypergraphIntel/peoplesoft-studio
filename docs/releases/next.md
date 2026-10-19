# PeopleSoft Studio 0.9.5 — unreleased

Development starts from [0.9.4](0.9.4.md), published October 18, 2026.
The 0.9.4 tag and published VSIX remain the released build.

## Integration Broker

Existing service/operation description/comments edits now stage in Change Review
on Oracle. Fixed noncredential snapshots, exact rollback previews, a precommit
after-image check and typed reversal protect the scoped header changes. Six
native rollback previews pass on HRDMO standard/REST provider/consumer shapes;
an installed developer-approved HRDMO standard service/operation apply/inverse
cycle also passed full scoped readback and checkpoint verification. Both original
states are restored. REST reviewed application remains separate. Structural
edits and creation retain legacy confirmation and cannot be silently grouped
into a Change Set.

The supported OnRequest handler, external node, manual routing and REST
provider/consumer operation workflows now accept PeopleTools 8.61.15 as well
as 8.62.09. Native 8.61.15 PIA comparisons are recorded in commit `15c6fd0`
and the discovery store. This does not enable arbitrary IB structures,
credential writes or 8.61 OAuth writes.

New REST operations receive the routing, parameters, sub-definition and
operation link PIA generates. Other corrections cover routing parameter
defaults and aliases, node description rows and handler defaults. Reconfiguring
PFC clears content-reference removal tombstones on 8.62 as well as 8.61.

## Build Requests

A page edit now finishes saving before a subsequent agent handoff or approval
reads the request. Previously, typing the narrative and immediately choosing
Analyze could make the handoff read the old, empty narrative and refuse to
start. The page continues processing after a refused action.

Production HTTP MCP/editor fixtures cover attachment intake and provenance,
the edit/handoff race, questions and answers, stale spec refusal, simulated
developer approval, build handoff/report gates and approval withdrawal after
an input changes. These are fixture checks, not native developer acceptance.
The installed workflow is tracked in
[Build Requests acceptance](../build-requests/NATIVE_ACCEPTANCE.md).

The installed 0.9.5 candidate completed a bounded HRDMO metadata trial: native
spec approval, separate SQL approach/object approval and application, then
dependency-ordered state record, SQL, App Engine and project save/readback.
The request reports Built; project checks found no missing related objects.
Subsequent developer trials verified native DOCX intake and Claude analysis
handoff through persisted handoffs and MCP-generated specs/questions. Build-phase
terminal handoff remains unverified. The App Engine was not executed.
