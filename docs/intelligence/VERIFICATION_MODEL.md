# Verification model

What a finding's status means, who may change it, and why counting
submissions never verifies anything. Local states are implemented; registry
states are proposed (phases 2 and 4).

## Five separate dimensions

| Dimension | Values | Decided by |
|---|---|---|
| Evidence confidence | low · medium · high | The author, per record (never drops on merge) |
| Verification status | below | Local engine (first two), registry review (the rest) |
| Publication approval | not published · published · revoked | Registry reviewers |
| Compatibility | releases observed · verified on · known incompatible · untested | Observations, then review |
| Source trust | the contributing installation's standing | Registry (phase 4+) |

None implies another: a high-confidence observation is still *observed*; a
verified finding may be unpublished; a published one says exactly which
releases it holds on.

## Lifecycle

| Status | Meaning | Who | Phase |
|---|---|---|---|
| **observed** | One run shows it | Local engine | 1 — implemented |
| **reproduced** | ≥ 2 distinct runs show it (different `runId` or experiment; identical evidence does not count) | Local engine | 1 — implemented |
| **corroborated** | Supported by an *independent* method or source: another method (e.g. delivered source + capture), another installation, another release | Registry | 2 |
| **verified** | A reviewer checked it against stated acceptance criteria on named releases | Registry review | 4 |
| **published** | Approved for distribution in a signed bundle | Registry review | 4 |

Side states (registry): **rejected** (does not hold), **superseded** (a
finding with more precise facts replaces it), **conflicting** (evidence
disagrees — both kept, both flagged), **withdrawn** (by its contributor),
**revoked** (published, then pulled; bundles carry revocations).

## Independence, not counting

Ten submissions from one faulty experiment are one piece of evidence. The
registry corroborates only on independent support:

- a different research method (the method field),
- a different experiment (not a re-run of the same case),
- a different installation (pseudonymous, phase 2),
- a different release (a compatibility fact, not corroboration by itself).

And never on Studio's own output repeating the rule it was built from
(DISCOVERY_PROTOCOL.md rule 3).

## Scope of a verified claim

A verified finding verifies its assertion, on its releases — nothing more.
A verified column mapping does not verify a Page Designer save; a verified
save protocol does not make a writer safe on another release; and no
verification grants write permission (MCP_INTEGRATION.md).
