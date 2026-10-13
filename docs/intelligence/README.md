# Discovery & Intelligence Network

PeopleSoft Studio's way to record what its research learns about
PeopleSoft — page metadata, save protocols, encodings, version differences —
as structured, versioned, evidence-backed findings; and, later, to share
verified knowledge between installations safely.

The founding directive is `CUSTOMIZATION_INTEL_SERVER.md` at the repository
root. These pages are the design and the record of what exists.

## Status (2026-10-12)

| Part | Status |
|---|---|
| Local Discovery Engine (`src/intelligence/`) | **Implemented** (phase 1), unit-tested; used for this repository's research findings |
| Research hook (`tools/intelligence/discovery.mts`), save-capture adapter | **Implemented** |
| *PeopleSoft: Show Local Discoveries* (extension) | **Implemented**; exercised against the bundled extension with a stub `vscode`, not yet in a VS Code window |
| Central server, registry, verification workflow | Proposed (phases 2, 4) |
| Discovery Center UI, submission review, uploads | Proposed (phase 3) — **nothing is uploaded today** |
| Signed knowledge bundles, sync | Proposed (phase 4) |
| MCP knowledge tools | Proposed (phase 5) |
| GitHub / development automation | Proposed (phase 6) |

## Pages

| Page | What it covers |
|---|---|
| [PROGRESS.md](PROGRESS.md) | **Start here when resuming**: state, next task, blockers |
| [ARCHITECTURE.md](ARCHITECTURE.md) | What exists, the five subsystems, trust boundaries, data flow |
| [DECISIONS.md](DECISIONS.md) | Decisions with rationale and alternatives |
| [FINDING_SCHEMA.md](FINDING_SCHEMA.md) | `psft-finding/1`, identity, outcomes, versioning |
| [DISCOVERY_PROTOCOL.md](DISCOVERY_PROTOCOL.md) | How to record findings; rules of evidence; adapters |
| [VERIFICATION_MODEL.md](VERIFICATION_MODEL.md) | Statuses, independence, scope of a claim |
| [KNOWLEDGE_REGISTRY.md](KNOWLEDGE_REGISTRY.md) | Server, API v1, bundles (proposed) |
| [MCP_INTEGRATION.md](MCP_INTEGRATION.md) | Knowledge tools for agents (proposed) |
| [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md) | What may leave the machine (nothing yet), the scan, retention |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Where the server lives; local development; before going public |
| [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) | Phases 0–6 with acceptance criteria |
