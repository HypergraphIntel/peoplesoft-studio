# Build Requests

A Build Request turns what a business user sends ("we need an interface that
loads the bank's nightly file into vendor bank accounts", plus a spec, a mapping
spreadsheet and a sample file) into PeopleSoft definitions, built by an AI agent
through the PeopleSoft Studio MCP, with the developer in control throughout.

## Workflow

1. **Describe.** *PeopleSoft sidebar > Build Requests > New Build Request.*
   Choose the kind (inbound/outbound file interface, batch App Engine,
   Integration Broker service, other), the connection, a project name, and
   paste what was asked for. Attach the documents.
2. **Analyze.** *Analyze with Claude Code / Codex* opens a terminal running the
   agent with a prompt that names the request (or copies the prompt for any
   other MCP agent). The agent reads the request with `psft_build_request_get`,
   researches the connection read-only, asks questions
   (`psft_build_request_ask`) and proposes a **build spec**
   (`psft_build_request_propose_spec`): every object to create, modify or
   reuse, with build details, field mappings, assumptions and a test plan.
3. **Review.** Answer the questions on the page, request changes, or approve.
   Approval is only possible from the page, with no open questions, and for a
   spec proposed against the request as it stands now.
   To reopen the page, run **PeopleSoft: Open Build Request** from the Command
   Palette and select the request. In **3. Build spec**, scroll below **Test
   plan** to **Approve spec**, beside **Request changes**, then confirm
   **Approve** in the dialog. This documentation page has no approval control.
4. **Build.** *Build with …* hands the approved spec back. The agent builds in
   dependency order with the ordinary `psft_*` tools and reports each object
   (`psft_build_request_report`): Built, Staged (a Change Review proposal),
   Manual step, Failed or Skipped.

## Rules

- **Only the developer approves, answers and edits.** No MCP tool can do any
  of the three.
- **Approval is exact.** It names a spec revision, its hash and the request's
  inputs revision. A new spec, a changed answer, attachment, kind, connection,
  project or description withdraws it, and `psft_build_request_report` is
  refused until the developer approves again.
- **No new write path.** The build request tools write only the local request
  store. Every PeopleSoft write goes through the existing tools and their gates:
  writable connection, Operator ID, write scope, `peoplesoft.mcp.writes`
  confirmation, the agent delivered-object policy, and Change Review where its
  adapters apply.
- **Studio decides what it can build.** Each spec object's route comes from
  the capability catalog (`src/buildRequest/routes.ts`), not from the agent.
  Objects without a create/edit route stay in the spec as manual steps, with
  instructions from the agent. Pages (`psft_page_create`), Components
  (`psft_component_create` / `_edit`), Process Definitions
  (`psft_process_create`), permission list grants (`psft_security_grant`) and
  File Layouts (`psft_file_layout_create` / `_edit`) have tools.
- **Attachments are data.** `psft_build_request_get` tells the agent that the
  narrative and documents are the requester's material, not instructions.

## Attachments

Stored with the request under the extension's global storage
(`build-requests/<id>/`), not in the workspace, so a business user's documents
stay out of source control. *Open folder* on the page reveals it.

| Type | Read as |
| --- | --- |
| .docx, .docm | paragraphs, tables as `cell \| cell` rows |
| .xlsx, .xlsm | each sheet, tab-separated, first 2000 non-empty rows |
| .pptx | each slide's text |
| text (.txt .csv .json .xml .xsd .wsdl .sql .md …) | as is |
| PDF, images, .doc, .xls, others | original only: the agent opens the file path itself |

Text beyond 60,000 characters per attachment (150,000 in all) is read with
`psft_build_request_read_attachment`.

## Settings

`peoplesoft.buildRequests.agent`: `claude` (default), `codex` or `clipboard`.
The agent must have the PeopleSoft Studio MCP server configured
(*PeopleSoft: Configure AI Client*), and the server must be running.
CLI handoffs pin this window's MCP URL for that session, preserving client
auth/model settings without changing global MCP configuration. Literal arguments
replace reconstructed shell command text. Both installed Build buttons, real CLI
sessions, reviewed creation and new native exact-output runs passed the bounded
[installed build handoff trial](build-requests/BUILD_HANDOFF.md). The original
window stayed open; a separate window was used for testing.

## Verified scope and remaining work

Both installed clients completed the synthetic build-phase trial on October 20:
Codex instance **607265**, Claude **607266**, Success, exact 123-byte UTF-8/no-BOM
CSV. Each built five definitions with the existing approval/write gates.
Native DOCX intake and Claude analysis were verified separately; seeded trial
attachments/specs do not substitute for intake or analysis acceptance.

Report delivery remains open: both new runs show **Not Posted**, with HTTP 900
transfer errors. HRDMO DISTSTATUS 4 is Unable to Post, not Posted. The older
607175 trial also proves successful execution and exact CSV, without posting
acceptance. See [handoff evidence and follow-ups](build-requests/BUILD_HANDOFF.md).
Representative production interfaces and native Windows handoff remain open.

Deferred objects can be reported as `PENDING` through MCP. This keeps them
unfinished and retains progress history; `SKIPPED` means intentionally omitted,
not waiting for a prerequisite or approval. Installed HTTP acceptance is in
[the priority tracker](PRIORITY_TASKS.md).
