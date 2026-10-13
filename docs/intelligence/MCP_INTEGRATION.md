# MCP integration — proposed (phase 5)

**Nothing on this page is built.** The MCP today (`src/mcp/`) has no
discovery or knowledge tools.

## Tools

Named in the existing `psft_` convention, all **read only** except
`psft_discovery_record`:

| Tool | Answers |
|---|---|
| `psft_discovery_list` · `psft_discovery_get` | The installation's local findings |
| `psft_discovery_record` | Records a finding from an agent (`source: mcp-agent`), through the same schema and privacy scan; approved by the user like any MCP write |
| `psft_knowledge_search` | Findings and published knowledge matching a subsystem, object type, table or text |
| `psft_knowledge_capability` | Whether an operation is supported, with the answer below |
| `psft_knowledge_compatibility` | Which releases a claim holds on, is untested on, or fails on |
| `psft_knowledge_evidence` | The observations, methods and reviews behind a claim |

## Answers are qualified, never a bare boolean

| Answer | Meaning |
|---|---|
| `VERIFIED` | Published or verified knowledge applies, on this release |
| `UNVERIFIED` | Observed or reproduced only |
| `UNSUPPORTED` | Known not to hold under the stated conditions |
| `UNKNOWN` | Nothing applicable |
| `CONFLICTING` | Evidence disagrees |

Each answer carries the finding ids, statuses, the releases it applies to,
the connection's own release (from `readRelease`), and the evidence methods.

## What knowledge never does

- It never grants a write: the write gates in `src/mcp/writeTools.ts`
  (Writable connection, Operator ID, write scope, per-write approval) and
  the delivered-object policy stay authoritative.
- It never widens a claim: a verified column mapping is not a verified
  Page Designer save (VERIFICATION_MODEL.md, "Scope").
- It is never an instruction: knowledge from the registry is untrusted data
  the agent is told about, not text it follows.
