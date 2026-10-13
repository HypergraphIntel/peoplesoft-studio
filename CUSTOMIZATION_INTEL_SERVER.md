# PeopleSoft Studio — Discovery & Intelligence Network
## Architecture, Persistent Knowledge, Implementation Planning, and Development Directive

### 1. Mission

We are introducing a major new capability into **PeopleSoft Studio**: a centralized Discovery & Intelligence Network that allows PeopleSoft Studio installations to contribute verified technical discoveries about PeopleSoft internals, share accumulated knowledge, and systematically improve future versions of the extension.

This is a long-term architectural initiative and should become a foundational part of PeopleSoft Studio.

**Your assignment is to:**

1. Ingest and understand the requirements in this document.
2. Inspect the existing PeopleSoft Studio repository, MCP server, extension architecture, test infrastructure, and existing research documentation.
3. Identify existing components that can be reused.
4. Create comprehensive, persistent architecture and implementation documents within the repository.
5. Develop a phased implementation roadmap with measurable acceptance criteria.
6. Begin implementing the first phase immediately.
7. Maintain persistent progress, decisions, unresolved questions, and implementation state so future agent sessions can resume without losing context.
8. Execute appropriate tests and report exactly what has been implemented and verified.

Do not stop after producing documentation. Proceed with implementation of the initial infrastructure.

Do not replace existing implementations without understanding their purpose. Preserve currently working capabilities and respect existing repository conventions.

---

# 2. Product Vision

PeopleSoft Studio is evolving into an alternative development environment for PeopleSoft, providing capabilities traditionally available through PeopleSoft Application Designer.

We are already researching and implementing:

- Page Designer and visual control editing.
- Page control serialization and database metadata mappings.
- Application Engine definitions and editing.
- PeopleCode decoding and analysis.
- PeopleSoft object metadata and dependencies.
- Record, Field, Component, and related object definitions.
- PeopleTools-version-specific behavior.
- MCP capabilities for AI-assisted development.
- Configuration-driven customization using Event Mapping, Page and Field Configurator, and Drop Zones.
- Automated validation against real PeopleSoft environments.

Much of this work involves difficult technical research, controlled experiments, database comparisons, decoding, and reverse engineering.

These discoveries should not remain isolated within one development session, individual machine, or organization.

We need a mechanism to capture discoveries as structured evidence and eventually make verified findings available to other PeopleSoft Studio installations.

## Fundamental Principle

**Every PeopleSoft Studio installation can potentially contribute to a shared understanding of PeopleSoft, but findings must be securely collected, independently verified, version-scoped, and explicitly approved before being treated as authoritative.**

This system must support continual product improvement without creating security, privacy, licensing, or supply-chain risks.

---

# 3. Architectural Direction

Design the network around five independent subsystems.

## A. Local Discovery Engine

Runs within the existing PeopleSoft Studio extension and/or its supporting backend.

Responsibilities:

- Capture discoveries arising from controlled development and metadata research.
- Record technical observations and evidence.
- Associate discoveries with PeopleTools versions.
- Persist discoveries locally.
- Identify duplicate observations.
- Record the originating research method.
- Track local verification status.
- Allow manual creation and submission of findings.
- Provide explicit review and redaction before uploading.
- Operate without any Internet connection.

Investigate how existing research tools and test harnesses can publish findings to this subsystem without invasive rewrites.

Examples of discoveries include:

- Page control metadata mappings.
- New control property behavior.
- Scroll nesting and OCCURSLEVEL behavior.
- Page serialization differences.
- PeopleCode bytecode patterns.
- Application Engine action metadata.
- Differences between PeopleTools releases.
- Previously undocumented object relationships.
- Native Application Designer round-trip comparison results.
- Compilation or validation differences.
- Unexpected behavior discovered during controlled experiments.

Do not confuse speculative observations with confirmed technical facts.

## B. Central Intelligence Server

A standalone network service that can receive, organize, and evaluate submitted findings.

Preferred initial architecture:

- Python.
- FastAPI.
- PostgreSQL.
- Versioned REST API.
- Background validation workers when necessary.
- Optional artifact storage for approved, sanitized evidence.
- Authenticated HTTPS communication.

Investigate whether a standalone service should live in this repository, a separate repository, or a modular workspace.

Document the tradeoffs and choose a maintainable structure.

**Do not assume the new server must be hosted within the existing PeopleSoft Hypergraph Intelligence application.** It should have an independent lifecycle, security boundary, and deployment model, even if development patterns can be reused.

Initial server capabilities should include:

- Authenticated finding submission.
- Finding retrieval.
- Content deduplication.
- Validation-state tracking.
- Evidence storage.
- PeopleTools compatibility metadata.
- Administrative review.
- Versioned knowledge publication.
- Audit logging.
- API schema documentation.

Design for future community participation without unnecessarily complicating the MVP.

## C. Verification and Knowledge Registry

The central server must distinguish observations from verified knowledge.

Use an explicit lifecycle:

1. **Observed** — Initial technical observation.
2. **Reproduced** — Repeated under controlled conditions.
3. **Corroborated** — Supported by independent tests or evidence.
4. **Verified** — Confirmed against defined acceptance criteria and compatible PeopleTools versions.
5. **Published** — Approved for distribution as authoritative knowledge.

Also support:

- Rejected findings.
- Superseded findings.
- Conflicting findings.
- Withdrawn findings.
- Revoked published knowledge.

Verification status must not be based solely on the number of submissions.

For instance, ten reports generated from the same faulty test should not automatically establish a fact.

Store provenance, verification method, supporting evidence, reviewer identity, and version applicability.

Distinguish the following concepts:

- Evidence confidence.
- Verification status.
- Publication approval.
- Compatibility.
- Source trust.

The MCP server must ultimately be able to consume this information and accurately inform an AI agent which operations are verified.

## D. Knowledge Distribution

PeopleSoft Studio installations should be capable of retrieving approved knowledge.

However, we must separate two different types of updates.

**Knowledge updates:**

- Metadata mappings.
- Compatibility rules.
- Verified behavioral descriptions.
- Declarative validation requirements.
- Version-specific constraints.
- Documentation and capability descriptions.

**Executable software updates:**

- Extension code.
- MCP implementation changes.
- New parsers and serializers.
- New native modules.
- Database writers.
- Executable scripts.

Knowledge updates may eventually be delivered independently through a signed, versioned distribution mechanism.

Executable changes must continue through the normal source-control, testing, approval, and extension release process.

Do not build a remote-code-execution mechanism disguised as knowledge synchronization.

Remote findings are untrusted data, not instructions for an agent to execute.

## E. GitHub and Development Agent Integration

Future verified findings should be able to generate structured engineering work.

Examples:

- GitHub issues.
- Reproducible regression tests.
- Metadata mapping fixtures.
- Compatibility test cases.
- Proposed implementation tasks.
- Pull requests created by authorized development workflows.

The ultimate development cycle should become:

Discovery → Evidence → Validation → Verification → Engineering Task → Implementation → Regression Testing → Release.

Integrate with the existing GitHub development workflow without granting unnecessary privileges.

Initial implementation should not automatically merge, publish, deploy, or execute arbitrary contributor content.

---

# 4. Discovery Data Model

Develop a typed, versioned schema for discovery submissions.

At minimum, account for:

**Identity and classification**

- Schema version.
- Finding identifier.
- Finding type.
- Discovery category.
- Affected PeopleSoft object type.
- Affected Studio subsystem.
- Human-readable description.
- Deterministic content fingerprint.

**Compatibility**

- PeopleTools version.
- PeopleSoft application family.
- Applicable object types.
- Known compatible versions.
- Known incompatible versions.
- Unknown or untested versions.

**Evidence**

- Research method.
- Observation.
- Expected behavior.
- Actual behavior.
- Reproduction steps.
- Sanitized metadata differences.
- Test results.
- Evidence references.
- Environment and tool versions.

**Provenance**

- Submission timestamp.
- Client version.
- Optional pseudonymous installation identifier.
- Originating experiment or test identifier.
- Source classification.
- Privacy classification.

**Verification**

- Initial observation state.
- Reproduction results.
- Independent corroboration.
- Verification history.
- Reviewer decisions.
- Publication history.

**Privacy**

- Redaction status.
- Allowed submission categories.
- Explicit user approval.
- Data classification.
- Evidence sensitivity.

Do not collect unnecessary information.

Avoid uploading raw PeopleSoft definitions, proprietary PeopleCode, SQL containing institutional data, employee records, connection strings, credentials, access tokens, internal hostnames, or unredacted diagnostic files.

Use deny-by-default data collection.

Submission schemas should be explicitly allowlisted instead of uploading arbitrary serialized objects.

---

# 5. API Contract

Design a versioned REST interface.

An initial candidate:

```text
POST /api/v1/findings
GET  /api/v1/findings/{id}

POST /api/v1/validation-results

GET  /api/v1/knowledge/latest
GET  /api/v1/knowledge/versions
GET  /api/v1/knowledge/compatibility

GET  /api/v1/discoveries/pending
```

These are conceptual interfaces, not immutable requirements.

Define:

- Request and response schemas.
- Authentication and authorization.
- Pagination.
- Idempotent submission.
- Deduplication semantics.
- Error handling.
- Request size limits.
- Rate limiting.
- API compatibility.
- Version negotiation.
- Auditability.
- Retention and deletion.

Administrative endpoints must be protected separately from public knowledge retrieval.

Plan cryptographic signing for published knowledge bundles, including key management, signature verification, expiration, rollback, and revocation behavior.

For the MVP, prioritize the submission and local persistence contracts over a fully automated publication service.

---

# 6. VS Code Discovery Center

Introduce a **Discovery Center** within PeopleSoft Studio.

Before implementing, inspect existing Activity Bar containers, TreeViews, Webviews, commands, settings, and UI conventions.

Reuse the existing design system rather than creating inconsistent interfaces.

The planned Discovery Center should include:

### Discovery Overview

- Local findings.
- Pending submissions.
- Verification status.
- Published findings.
- Server connection status.
- Current knowledge version.
- Compatible PeopleTools knowledge availability.

### Discovery Details

For an individual finding, display:

- Discovery type.
- Technical description.
- PeopleTools version.
- Evidence.
- Reproduction method.
- Confidence.
- Verification status.
- Submission history.
- Privacy classification.

### Submission Review

Before upload:

- Show the exact structured payload.
- Identify fields removed through redaction.
- Explain what data will leave the machine.
- Require approval unless an administrator has explicitly enabled an approved submission policy.
- Allow the user to cancel without side effects.

### Settings

Investigate settings such as:

```json
{
  "peoplesoftStudio.intelligence.enabled": false,
  "peoplesoftStudio.intelligence.serverUrl": "",
  "peoplesoftStudio.intelligence.uploadMode": "manual",
  "peoplesoftStudio.intelligence.knowledgeSync": false,
  "peoplesoftStudio.intelligence.captureLocalDiscoveries": true
}
```

These settings are proposals. Reconcile naming and configuration with existing repository conventions.

Any institution-level policy must be enforced, not merely documented.

Use VS Code SecretStorage for applicable credentials.

Respect user and organizational telemetry preferences.

No remote data sharing should occur by default.

---

# 7. MCP Integration

The MCP server must ultimately be able to query locally available, verified knowledge.

Potential MCP tools:

```text
studio_discovery_list
studio_discovery_get
studio_discovery_record
studio_knowledge_search
studio_knowledge_capability
studio_knowledge_compatibility
studio_knowledge_evidence
```

Names are conceptual and must be reconciled with existing MCP naming conventions.

The MCP server should be able to answer questions such as:

- Is a particular Page Designer write operation verified?
- Which PeopleTools versions support a known metadata mapping?
- What experimental evidence supports an Application Engine serialization rule?
- Is this customization approach verified, or only theoretically possible?
- What regression tests are required before editing this object?
- Has another environment identified a conflicting behavior?

The MCP must distinguish:

**Verified capability:** Supported by applicable, accepted technical evidence.

**Unverified possibility:** Hypothesized or observed but not adequately tested.

**Unsupported:** Known not to work under defined conditions.

**Unknown:** Insufficient information.

**Conflicting:** Available evidence disagrees.

A verified mapping must not imply that an entire editing workflow is verified.

For example, a verified Page control database property mapping does not automatically prove a complete Page Designer save and compile operation is safe.

Likewise, verified knowledge must not automatically grant write permission.

Existing read-only restrictions, approval policies, and write-operation gates remain authoritative.

MCP responses should include provenance and exact applicability, not simply return an unqualified boolean.

---

# 8. Automated Discovery from Existing Research

Inspect the repository for existing controlled research and comparison infrastructure.

In particular, investigate whether we already have:

- Native Application Designer comparison utilities.
- Database before-and-after snapshots.
- Page control serialization tests.
- Page Designer save and reload tests.
- PeopleCode decoder test fixtures.
- Application Engine object inspection.
- Object metadata comparison logic.
- PeopleTools version detection.
- Controlled compilation harnesses.
- Research ledgers.
- Existing persistent experiment records.

Determine which of these can produce structured findings.

The goal is not to recreate the research infrastructure.

The goal is to add a small discovery adapter layer so experiments can produce standardized observations.

Example:

A controlled experiment changes one Page control attribute in Application Designer.

The research harness captures the database delta.

The discovery adapter generates a structured finding containing:

- The control property.
- The metadata affected.
- The PeopleTools version.
- The sanitized before/after delta.
- The experiment identifier.
- The reproducibility status.

That discovery should be reviewable, persistable, and eventually eligible for submission.

Do not infer a verified rule from a single database delta.

---

# 9. Security and Privacy Requirements

Treat this as a potentially Internet-facing software supply-chain system.

The following requirements are mandatory:

1. Outbound uploads are disabled by default.
2. Submission content uses an explicit field allowlist.
3. Raw source code and database exports are never uploaded automatically.
4. Credentials and connection details are excluded.
5. Institutional data is protected.
6. Administrative actions require separate authorization.
7. Server-side input is untrusted.
8. Knowledge payloads cannot contain executable instructions.
9. Published bundles require integrity and authenticity verification before trusted use.
10. All upload, verification, and publication decisions are auditable.
11. Upload failure must not interfere with normal PeopleSoft Studio operation.
12. Knowledge synchronization must not silently weaken existing edit or write restrictions.
13. No server-controlled arbitrary code execution.
14. Never execute uploaded tests directly in a privileged environment.
15. Design isolation for future automated evidence testing.
16. Ensure authentication tokens are never logged.
17. Provide explicit documentation of what can leave the local environment.

Also establish data retention, deletion, and contributor withdrawal policies before enabling community submissions.

---

# 10. Persistent Documentation Requirements

This work must survive agent context resets, interrupted development sessions, and future contributors.

Inspect existing repository documentation conventions first.

Create or update an appropriate persistent documentation structure, potentially:

```text
docs/intelligence/
    README.md
    ARCHITECTURE.md
    DISCOVERY_PROTOCOL.md
    FINDING_SCHEMA.md
    VERIFICATION_MODEL.md
    KNOWLEDGE_REGISTRY.md
    MCP_INTEGRATION.md
    SECURITY_PRIVACY.md
    DEPLOYMENT.md
    IMPLEMENTATION_ROADMAP.md
    DECISIONS.md
    PROGRESS.md
```

Also update the repository's existing agent handoff, memory, or project-progress documentation so that a future coding agent can discover this initiative without requiring the original prompt.

The documentation must distinguish:

- Existing functionality.
- Proposed architecture.
- Implemented functionality.
- Verified functionality.
- Blocked functionality.
- Open design decisions.
- Future roadmap items.

Avoid describing planned features as implemented.

Whenever an architectural decision is made, record the rationale and alternatives.

Whenever a phase is completed, update progress and acceptance evidence.

Never allow the only copy of essential discoveries or design decisions to exist in chat history.

---

# 11. Implementation Roadmap

Organize development into phases.

## Phase 0 — Repository Reconnaissance and Architecture

Inspect the codebase.

Document:

- Current extension architecture.
- MCP implementation.
- Existing research storage.
- Existing database access patterns.
- Test infrastructure.
- Dependency and build conventions.
- Applicable trust boundaries.
- Components suitable for reuse.

Produce a realistic architecture based on the actual repository.

Do not assume components exist until inspected.

## Phase 1 — Local Discovery Foundation

Implement:

- Typed discovery schemas.
- Schema versioning.
- Local persistent discovery store.
- Finding identification and deduplication.
- Basic privacy classification.
- Controlled finding creation.
- Discovery listing and retrieval.
- Unit tests.
- A simple mechanism for research harnesses to record findings.

This is the primary immediate implementation target.

Prefer implementation that works completely offline.

## Phase 2 — Intelligence Server MVP

Implement:

- Standalone FastAPI service.
- PostgreSQL persistence.
- Authenticated submissions.
- Finding retrieval.
- Duplicate detection.
- Basic verification states.
- API tests.
- Local development deployment configuration.
- Clear security and deployment instructions.

Do not deploy a public Internet-facing service without a separate deployment and security review.

## Phase 3 — VS Code Discovery Center

Implement:

- Discovery navigation.
- Finding details.
- Submission preview.
- Privacy review.
- Opt-in controls.
- Server connectivity.
- Upload results.
- Graceful offline behavior.

## Phase 4 — Verification and Knowledge Distribution

Implement:

- Verification workflow.
- Evidence provenance.
- Version-specific compatibility rules.
- Reviewed publication.
- Signed knowledge bundles.
- Client verification.
- Controlled synchronization.
- Revocation and rollback.

## Phase 5 — MCP Knowledge Integration

Implement:

- Verified knowledge lookup.
- Capability confidence reporting.
- Version-scoped recommendations.
- Evidence and provenance retrieval.
- Integration with customization planning.
- Integration with Page Designer and Application Engine planning.

## Phase 6 — Development Automation

Implement:

- GitHub issue generation.
- Regression fixture generation.
- Agent-readable engineering tasks.
- Controlled coding-agent workflows.
- Pull-request preparation.
- Existing CI integration.

This phase must maintain human review and normal release controls.

---

# 12. Immediate Implementation Instructions

After repository reconnaissance and documentation, begin Phase 1.

Do not attempt to implement all six phases in a single pass.

Prioritize a stable foundation over prematurely creating a large distributed system.

Suggested initial implementation order:

1. Identify existing TypeScript model and persistence conventions.
2. Design the discovery schema and validation rules.
3. Implement the local discovery store.
4. Implement deterministic finding fingerprints.
5. Implement create/list/get operations.
6. Implement duplicate-submission handling.
7. Implement safe privacy classification.
8. Add integration hooks for existing research harnesses.
9. Add focused tests.
10. Update architecture and progress documentation.

If the existing extension architecture suggests a better order, explain and document the change.

Do not introduce a mandatory new database dependency into the VS Code extension.

Do not require a running central server to use Studio.

Avoid unnecessary runtime dependencies.

---

# 13. Definition of Done for the Initial Milestone

The first development milestone is complete when:

- A discovery can be created through a supported local API.
- Its schema is validated.
- It receives a deterministic fingerprint.
- It is persisted across extension restarts.
- Duplicate discoveries are handled predictably.
- Findings can be listed and retrieved.
- Private or unsupported fields are rejected by the submission schema.
- Findings retain the relevant PeopleTools version and evidence metadata.
- The implementation works without network connectivity.
- Automated tests cover the core functionality.
- Persistent documentation accurately reflects implementation state.
- Existing extension functionality remains operational.

Report all unverified aspects explicitly.

---

# 14. Relationship to Existing Development

This initiative must not derail ongoing PeopleSoft Studio work.

We are continuing to build Application Designer-equivalent functionality.

Page Designer, Application Engines, PeopleCode decoding, metadata manipulation, and MCP integration remain primary product capabilities.

The Discovery & Intelligence Network is supporting infrastructure.

Where possible, implement small, reusable abstractions and integrate them incrementally.

Do not undertake unrelated refactoring.

Do not change stable page serialization, PeopleCode decoding, or existing MCP functionality merely to accommodate the new subsystem.

Treat already verified work as valuable evidence, but import historical findings only when sufficient supporting material exists.

---

# 15. Git and Development Practices

Follow existing repository development conventions.

Before making changes:

- Inspect the current branch.
- Check for uncommitted changes.
- Identify relevant baseline tests.
- Avoid overwriting unrelated work.

During implementation:

- Make focused changes.
- Add tests with new functionality.
- Keep documentation current.
- Avoid generated-file churn.
- Do not fabricate validation results.
- Keep commits logically scoped.

At the end of the milestone:

- Run relevant tests.
- Report passing and failing results.
- Document limitations.
- Update persistent progress.
- Create an implementation checkpoint according to repository conventions.

Do not push, publish, deploy, or create external services unless authorized by the existing workflow.

---

# 16. Required Agent Session Handoff

Maintain a durable handoff document containing:

**Current state**
- What exists.
- What is implemented.
- What has been verified.
- What remains incomplete.

**Architecture**
- Major components.
- Data flow.
- Trust boundaries.
- Storage choices.
- Design decisions.

**Implementation details**
- Key files.
- Public interfaces.
- Schema versions.
- Test commands.
- Dependencies.

**Resume instructions**
- Immediate next task.
- Relevant code locations.
- Known blockers.
- Acceptance criteria.
- Work that must not be repeated.

Make this discoverable from the repository's existing agent guidance.

---

# 17. Agent Execution Directive

Proceed autonomously within the existing development and security constraints.

Your execution sequence is:

**STEP A — Inspect**
Read relevant repository code, architecture, documentation, and test infrastructure.

**STEP B — Architect**
Formulate the actual Discovery & Intelligence Network architecture, adapting this specification where necessary.

**STEP C — Persist**
Create comprehensive documentation and a durable implementation roadmap.

**STEP D — Implement**
Begin building the Phase 1 local discovery infrastructure.

**STEP E — Validate**
Execute appropriate tests and verify persistence, fingerprinting, schema validation, and offline operation.

**STEP F — Checkpoint**
Update the handoff documentation and record the exact implementation state.

**STEP G — Report**
Provide a concise development summary containing:

- Architectural decisions made.
- Documentation created.
- Code implemented.
- Tests executed and results.
- Current phase and milestone completion.
- Outstanding issues.
- Exact next implementation steps.

Do not present an implementation plan as completed functionality.

Do not stop at the planning stage unless an actual technical blocker prevents progress.

**Long-term objective:** PeopleSoft Studio should become a development environment that continuously accumulates trustworthy, version-specific technical knowledge from controlled research and approved community contributions, uses that knowledge to improve its MCP-assisted development capabilities, and converts verified discoveries into systematically tested future releases.

Begin now.