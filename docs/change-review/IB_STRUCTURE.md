# Integration Broker structural review

Development scope in 0.9.6, built on [header review](IB_HEADERS.md). The same
`ib-service` and `ib-operation` adapters, fixed noncredential checkpoints
(2 service tables, 16 operation tables), scoped tokens, approval hashes and
precommit after-image guard now also carry a bounded set of structural edits to
**existing** definitions on Oracle. Implementation:
`src/changeReview/ibStructure.ts`; staging: `src/mcp/ibHeaderReview.ts`.

## How a structural proposal is formed

1. `psft_ib_save` with a full `psft_ib_get.input` that changes more than the
   description/comments runs the calibrated writer as a rollback preview with
   checkpoint capture. The writer's own after-image is the proposal; nothing in
   Studio computes it.
2. The before/after difference must be inside the contract below. Otherwise the
   edit keeps the legacy per-write confirmation, and grouping it into a Change
   Set is refused with the specific reason.
3. A writer input is re-derived from the two checkpoints alone (the live input
   with only the changed cells and added rows applied), and a second rollback
   preview must reproduce the after-image hash exactly. Validation and approved
   application use that same derivation; application commits only when the
   precommit after-image equals the approved one.

## Contract

| Table | Allowed |
| --- | --- |
| PSSERVICE | DESCR, DESCRLONG, OBJECTOWNERID, IB_NAMESPACE, PTIBAPPLNAME, PTIB_APPSRVGRP |
| PSOPERATION | Writer-editable columns except IB_SERVICENAME (move), RTNGTYPE, IB_RESTMETHOD, IB_ALIASNAME, MSGNAME/IB_MSGVERSION |
| PSOPRVERDFN | Non-key columns of existing versions; no new versions |
| PSOPRVERDFNPARM | Non-key columns of existing parameters except MSGNAME/IB_MSGVERSION; no new parameters |
| PSOPRHDLR | Existing handlers except HANDLERTYPE/HANDLERID; add only ApplicationClass `REQUESTHDLR` on `RQST` |
| PSOPERATIONAC | Existing implementation rows; a new row only with that new handler |
| All other checkpoint tables | Unchanged (routings, PSIBOPRROOT, PSOPRGENRTGPARM, PSSERVICEOPR, AE/CI/DMS handlers, REST URI/content/queue rows) |

No row is removed and no key changes: IB child deletion is not calibrated.
Refused columns are those whose effects reach routings, aliases or REST
identity outside the checkpoint scope. The handler addition is the one PIA
captured on 8.61.15 and 8.62.09 (see [INTEGRATION_BROKER.md](../INTEGRATION_BROKER.md));
the referenced class must already exist live.

**Reversal.** Edits that only change existing rows reverse by a fresh typed
inverse, validated and approved like any proposal. A Change Set that added a
handler cannot be reversed: the adapter's `reversalRefusal` hook stops both
`reversalSupport` and `reverse` before any proposal is created, and recommends a
separate reviewed deactivation (`ACTIVE_FLAG` `I`) instead. No raw row replay.

## Verification

- `src/test/reviewIbStructure.test.ts`: real-writer statements in the
  transactional fixture for staged/applied/reversed service and operation
  structure, the handler addition and its refused inverse, and refusals for
  alias, message binding, handler type/event, child removal, routing, version
  and other-handler changes. `changeReview.test.ts` covers the service hook.
- Production HTTP/UI fixtures (Node 20 and Node 26, 54 checks): each kind stages
  the writer preview without persistence and applies it exactly through the
  trusted UI; the service reverses by typed inverse; the operation's added
  handler refuses reversal; out-of-contract alias edits refuse grouping and keep
  legacy confirmation.
- Native HRDMO rollback previews, `tools/lab/ib-structure-native-preview.mts`
  (October 19): ZZ_IB_STD owner/namespace; ZZ_IB_STDOP owner, version
  description and existing REQUESTHDLR activation/description; REST provider
  ZZ_IB_API_5736828_G OnRequest handler addition (PT_SES:Init); ZZ_IB_STDOP
  alias change refused by the contract. Each re-derived input reproduced the
  native after-image exactly, and the scoped token, content hash and
  SRVM/OPRM/OPRVM/OPRHM/SYS counters were unchanged after rollback. No native
  commit or review approval occurred.

- Installed HRDMO acceptance (October 19, runtime bundle SHA-256 `602c9992…`,
  developer approval in the trusted review workspace):
  - ZZ_IB_STDOP standard operation: Change Set `a86ebb85-f99f-4df0-be0a-400949bd3af6`
    applied owner `PPT`, version v1 description and existing REQUESTHDLR
    activation (`I` -> `A`) and description. The staged diff held only those
    cells; the object VERIFIED at snapshot `08437ebc…`, token `d4877a93…`, live
    timeline MATCHES_RECORDED, and readback showed the native version counters
    advanced (operation 20 -> 21, version row 19 -> 20, handler 2 -> 6) with
    the service untouched. The separately approved typed inverse
    `2d37cf05-71ca-4346-9215-dac670516efc` restored the original snapshot
    `df3178ef…` under fresh token `45cd9293…`; the original is REVERTED with
    a REVERSED_BY_VERIFIED_CHANGE_SET journal entry.
  - ZZ_IB_API_5736828_G REST provider: Change Set
    `0cb5ff8b-512b-4350-9151-531b9a9a2686` added the ApplicationClass
    REQUESTHDLR/RQST handler (PT_SES:Init.OnRequest, blank PSOPERATIONAC
    QUALIFYPATH as PIA stores a root class; the writer maps `:` to blank). The
    new handler took the operation's description, as in PIA. VERIFIED at
    `30262b1f…`, token `c1bcedcd…`, MATCHES_RECORDED. `psft_prepare_revert`
    refused up front ("IB child deletion is not calibrated. Deactivate the
    handler ... No partial reverse proposal created") and no reverse set
    exists. The handler stays on this lab operation by developer decision.

8.61 structural previews/application, REST consumer handlers and credential
freshness are not certified.
