# Customization Intelligence

Who owns a definition, and what may happen to it. This is phase 1 of the
Customization Intelligence design (CUSTOMIZATION_INTELLIGENCE.md,
CUSTOMIZATION_STRATEGY_PANEL.md): ownership classified from evidence, and a
delivered-object policy every write passes. Capability discovery (Event
Mapping, Drop Zones, Page and Field Configurator, AE plug-ins), plans and the
customization registry are later phases; the Customization Strategy view and
the Customization Plan editor still show them as previews.

## Ownership

| Ownership | Meaning |
|---|---|
| Delivered | Oracle's, never saved locally |
| Delivered, modified | Oracle's, saved locally since |
| Partner (bolt-on) | A bolt-on vendor's |
| Custom | The organization's own |
| Unknown | The evidence does not decide |

Every classification carries a confidence (high, medium, low) and the
evidence it rests on, shown in the Customization Strategy view (Object
Identity) and returned by `psft_object_classify`.

### Evidence, strongest first

1. **A delivered baseline** of the database's application release: every
   definition a vanilla demo database of that release holds, saved by Oracle's
   operator. A definition in it is Oracle's -- Delivered when its stamp is
   still PPLSOFT, Delivered, modified when it is not. One not in it is the
   organization's (Custom) or, with a bolt-on prefix, a vendor's (Partner).
2. **The definition's stamp** (LASTUPDOPRID; a PeopleCode program's own).
   Oracle delivers everything saved by PPLSOFT -- on HRDMO all 52,775 records,
   17,342 pages and 119,290 PeopleCode programs are -- and a local save
   restamps it.
3. **An Oracle-delivered project** listing it: a project stamped PPLSOFT and
   not named with a configured prefix. Weak: such projects list about a sixth
   of what Oracle delivers (8,282 of 52,792 records on HRDMO), and anyone
   signed in as PPLSOFT stamps a project so -- HRDMO's lab project
   ZZ_PCODE_LAB_G is one.
4. **The naming prefixes** (`peoplesoft.customization.namingPrefixes`).
   Supporting evidence, never proof on its own: Oracle itself delivers `ZZ_`
   records (ZZ_DMNDCRS_SRC, ZZ_DSTNCT_DEPT and more on HRDMO).

The rules (`src/model/ownership.ts`, tested in `src/test/ownership.test.ts`):

| Baseline | Stamp | Also | Ownership |
|---|---|---|---|
| holds it | PPLSOFT | | Delivered, high |
| holds it | local | | Delivered, modified, high |
| lacks it | any | bolt-on prefix | Partner, high |
| lacks it | any | organization prefix | Custom, high |
| lacks it | PPLSOFT | | Delivered, medium (a later Oracle update than the baseline) |
| lacks it | local | | Custom, medium |
| none | PPLSOFT | in an Oracle project | Delivered, high |
| none | PPLSOFT | bolt-on prefix | Partner, low |
| none | PPLSOFT | | Delivered, medium |
| none | local | in an Oracle project | Delivered, modified, low |
| none | local | bolt-on prefix | Partner, medium |
| none | local | organization prefix | Custom, medium |
| none | local | nothing else | Unknown, low |

A PeopleCode program not stored yet is judged by the definition it belongs to
(a record, component, page, menu, App Engine program, Component Interface):
adding PeopleCode to a delivered record changes a delivered definition. A new
definition of any other kind has no owner yet and is not judged.

## Naming prefixes are a list

Organizations buy PeopleSoft bolt-ons that carry their own prefixes, so the
prefixes are a list, each with who owns definitions named with it:

```json
"peoplesoft.customization.namingPrefixes": [
  { "prefix": "ZZ_",  "owner": "organization", "name": "Acme Corp" },
  { "prefix": "XYZ_", "owner": "partner",      "name": "XYZ Bolt-On Suite" }
]
```

The longest matching prefix wins (`XYZ_HR_` over `XYZ_`). While the list is
empty, 0.8.4's single `organizationPrefix` (deprecated) is read, and failing
that the write-scope prefix `peoplesoft.writeNamePrefix` counts as the
organization's.

## The delivered-object policies

Every save, rename and delete of an existing definition passes one guard, at
the `DatabaseProvider` write methods (`src/providers/writeGuard.ts`), so no
editor, designer or MCP tool can take another path around it;
`tools/lab/customization-e2e.mts` proves every write method reaches the guard
before it writes anything. The guard knows who is writing: every MCP tool
call runs tagged as an AI agent's (`src/mcp/agentOrigin.ts`), everything else
is a person's. Each has its own policy:

| Setting | Applies to | Default |
|---|---|---|
| `peoplesoft.customization.deliveredObjectPolicy` | your writes, in the editors and designers | `allowWithAudit` |
| `peoplesoft.customization.agentDeliveredObjectPolicy` | an AI agent's writes, through the MCP | `requireApproval` |

The defaults put the friction where the risk is. PeopleSoft shops edit
delivered definitions routinely, and without a baseline a site whose
developers sign in as PPLSOFT would see its own definitions flagged: prompting
people on every such save teaches them to click through it. So your own
writes go through and are recorded. An agent's are asked, even when MCP writes
are `allow` -- the one thing that stops an agent from quietly changing a
delivered record or program.

What each policy does:

| Ownership | block | requireApproval | allowWithAudit |
|---|---|---|---|
| Delivered, Delivered modified, Partner | refused | asked | written, recorded |
| Unknown | asked (never refused: nothing proves it delivered) | asked | written, recorded |
| Custom | written | written | written |

Asked: VS Code shows the ownership and its evidence (and, for an agent, that
an AI agent wants the write); **Approve** covers that one write, **Approve for
This Session** that definition until VS Code restarts -- an approval for your
writes does not cover an agent's, nor the other way round. An agent cannot
answer it: for an agent's write the MCP's own write approval (level 1) comes
first, the delivered-object approval (level 2) after it, both in VS Code.
Every refusal, approval, decline and recorded write is in the audit log
(*PeopleSoft: Show Customization Audit Log*, a JSON line each with who wrote,
and the *PeopleSoft Customization* output).

Dry runs (Preview Save) and new definitions (a create, a Save As) are not
judged.

## Delivered baselines

*PeopleSoft: Capture Delivered Baseline...* (the Customization Strategy
view's menu) reads, from a connection you name, every definition saved by
PPLSOFT -- records, fields, pages, components, menus, App Engine programs,
SQL, HTML, style sheets, Component Interfaces, messages, message channels and
every PeopleCode program -- and keeps it in the extension's storage as
`<application release>_PT<tools release>.json.gz` (HRDMO, HRMS 9.20 on
PeopleTools 8.62: about 365,000 definitions, 1.75 MB, 36 seconds). A baseline
applies to databases of the same application release (PSRELEASE's latest
RELEASELABEL), the same tools release preferred.

**A baseline is only as vanilla as its database.** Capture it from an
untouched PUM image of the release you develop on: anything saved there while
signed in as PPLSOFT is taken as Oracle's. HRDMO itself has two lab records
(ZZ_PCODE_LAB, ZZ_PCODE_LAB_P) and nine fields saved that way, so a baseline
from it counts them as delivered.

Sites whose developers sign in as PPLSOFT should capture a baseline: without
one their own definitions look delivered. The Customization Strategy view
offers *Capture Delivered Baseline…* whenever the open definition was
classified without one.

## MCP

| Tool | What it does |
|---|---|
| `psft_customization_get_policy` | The effective prefixes, strategy and both delivered-object policies |
| `psft_object_classify` | Ownership, confidence and evidence of a definition, and what the agent policy would do with a write to it |

## Proof

- `src/test/ownership.test.ts`: every rule above, the prefix list, the policy.
- `tools/lab/customization-e2e.mts` on HRDMO (read only): delivered records,
  pages, components and PeopleCode; a new event judged by its record; lab
  definitions with and without prefixes; a bolt-on prefix; a baseline
  captured from HRDMO and applied; every DatabaseProvider write reaching the
  guard first, a person's write told from an agent's, PSVERSION unchanged --
  41 of 41.
- `src/test/ownership.test.ts` also proves the origin survives awaits and
  interleaved calls, and that an MCP tool's callback runs as an agent's.
