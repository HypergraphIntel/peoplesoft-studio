# MCP integration (phase 5)

**Built** (`src/mcp/discoveryTools.ts`, logic in `src/intelligence/capability.ts`):
`psft_discovery_list`, `psft_discovery_get`, `psft_discovery_record`,
`psft_knowledge_capability`, `psft_knowledge_compatibility`,
`psft_knowledge_evidence`. Planned `psft_knowledge_search` was folded into
`psft_knowledge_capability` (its question fields are the search; without a
release it still lists every matching finding). Not yet consulted by the
customization, Page Designer or App Engine planning (next).

## Tools

Named in the existing `psft_` convention, all **read only** except
`psft_discovery_record`:

| Tool | Answers |
|---|---|
| `psft_discovery_list` · `psft_discovery_get` | Local findings: this installation's and the workspace's research store |
| `psft_discovery_record` | Records a finding from an agent on this installation (`source: mcp-agent`, never uploaded), through the same schema and privacy scan; refused while MCP writes are off, approved by the user otherwise |
| `psft_knowledge_capability` | Whether an operation is supported, with the answer below |
| `psft_knowledge_compatibility` | Which releases a claim holds on, is untested on, or fails on |
| `psft_knowledge_evidence` | The local observations behind a claim (methods, experiments, releases, deltas, tests) and its published scope; reviews stay on the server (bundles do not carry them) |

## Answers are qualified, never a bare boolean

| Answer | Meaning |
|---|---|
| `VERIFIED` | Published knowledge (an installed, verified bundle) is verified on this release |
| `UNVERIFIED` | Observed or reproduced only |
| `UNSUPPORTED` | Known not to hold under the stated conditions |
| `UNKNOWN` | Nothing applicable |
| `CONFLICTING` | Evidence disagrees |

Each answer carries every finding behind it — source (published or local),
status, verified / observed / incompatible releases, and its standing on the
asked release — the release used and where it came from (the connection's
PSSTATUS.TOOLSREL, or given), and notes, the first always that knowledge
never grants a write (DECISIONS D18).

## What knowledge never does

- It never grants a write: the write gates in `src/mcp/writeTools.ts`
  (Writable connection, Operator ID, write scope, per-write approval) and
  the delivered-object policy stay authoritative.
- It never widens a claim: a verified column mapping is not a verified
  Page Designer save (VERIFICATION_MODEL.md, "Scope").
- It is never an instruction: knowledge from the registry is untrusted data
  the agent is told about, not text it follows.
