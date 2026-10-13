# Progress and handoff

**Read this first when resuming the Discovery & Intelligence Network.**
Last updated 2026-10-13 (phase 5). The founding directive: `CUSTOMIZATION_INTEL_SERVER.md`
(repository root).

## Current state

- **Phase 0 (reconnaissance, architecture): done.** ARCHITECTURE.md; DECISIONS.md D1–D12.
- **Phase 1 (local discovery foundation): done.** Evidence below.
- **Phase 2 (server MVP): done, local only.** Evidence below.
- **Phase 3 (Discovery Center): done** but for a run in a real VS Code
  window. Evidence below.
- **Phase 4 (verification, distribution): done** but for a production
  signing key (none is trusted: every bundle is refused). Evidence below.
- **Phase 5 (MCP and planning): done** — six tools; the Customization
  Strategy view shows *Studio Knowledge* for the active designer's subsystem
  and the Event Mapping answer; `psft_customization_discover` includes it.
- **Phase 6 (development automation): started, dry run only** —
  `tools/intelligence/engineering-task.mts` writes an issue body and a
  regression fixture from a finding and prints the `gh` command; it files
  nothing. First fixture: `src/test/discovery-f-e3a3f17f095c20582322485d.test.ts`.
- **Nothing leaves by default.** Submissions need four gates (D13) and the
  user's approval of the exact payloads. The server has run only on localhost.

## Phase 1 evidence

| Criterion | Evidence |
|---|---|
| Created through a supported local API | `DiscoveryStore.record()`; `tools/intelligence/discovery.mts` — 4 findings in `tools/intelligence/store` |
| Schema validated | Strict zod schema; tests |
| Deterministic fingerprint | `fingerprint.ts`; tests; the Python server computes the same (vectors) |
| Persists across restarts | File store; restart test; the bundled extension's command read a store (stub `vscode`) |
| Duplicates predictable | `created` / `merged` / `duplicate`; tests; CLI |
| Listed and retrieved | `list()` / `get()`; tests; CLI |
| Private / unsupported fields rejected | Strict schema + privacy scan; tests (values never echoed) |
| PeopleTools version and evidence kept | Required release; compatibility; evidence refs; adapter test on em04 |
| Offline | No network module (tested) |
| Tests | `src/test/intelligence.test.ts` — 11 tests (incl. contract drift, submission preview, upload gates) |
| Existing functionality | `npm test`: 1639 tests, 1638 pass, 0 fail, 1 pre-existing skip; smoke 64 commands, 8 views |

## Phase 2 evidence

| Criterion | Evidence |
|---|---|
| Standalone FastAPI service | `server/intelligence/app/` (FastAPI 0.143, SQLAlchemy 2.1, psycopg 3.3, jsonschema 4.26) |
| PostgreSQL persistence | `compose.yaml` (PostgreSQL 16, 127.0.0.1:55432); JSONB columns |
| Authenticated submissions | Bearer tokens (hashed), roles; 401/403 tests |
| Retrieval | `GET /findings/{id}`; evidence visibility per D12 |
| Duplicate detection | Same outcomes as the local store; vector IDs; concurrency test (1 created, 11 merged) |
| Basic verification states | observed / reproduced computed; others reserved for review |
| API tests | `pytest`: 39 pass on PostgreSQL; 38 pass + 1 skipped (concurrency) on SQLite |
| Local deployment configuration | compose + README; run with uvicorn on localhost: the 4 repository findings got the local IDs and statuses |
| Security / deployment docs | DEPLOYMENT.md (review required before exposure), SECURITY_PRIVACY.md |

## Phase 3 evidence

| Criterion | Evidence |
|---|---|
| Discovery navigation | *Discoveries* view: status row, This Installation, Workspace Research (tree read through the bundle: 4 + 4 findings) |
| Finding details | Panel: claim, facts, evidence (deltas, tests, refs), history |
| Submission preview / privacy review | `previewSubmission()` (test); panel shows exact payloads (3 for f-e3a3…), 6 removals with reasons, blocking problems |
| Opt-in controls, policy enforced | `decideUpload()` (test: every gate, every reason); settings application-scoped; machine policy file fails closed |
| Server connectivity, upload results | `src/intelligenceClient.ts`; bundled extension → local server: declined = nothing sent; approved = created, merged, merged; server shows reproduced, no experiment IDs |
| Graceful offline / failures | Failures reported and recorded, never thrown out of the panel; nothing retries silently |
| Secrets | Token in SecretStorage; history and audit never contain it (checked) |

## Phase 4 evidence

| Criterion | Evidence |
|---|---|
| Verification workflow | `app/review.py` (pure tests: independence, criteria, releases, roles, illegal moves); `POST /reviews` (workflow test) |
| Evidence provenance | Reviews stored with reviewer, criteria, rationale, releases; audit |
| Version-specific compatibility | `verifiedReleases` ⊆ observed releases; `GET /knowledge/compatibility?release=` |
| Reviewed publication | admin-only publish / revoke (403 for a reviewer, tested) |
| Signed bundles | `app/bundle.py`, `generate-key` (0600), `build-bundle`; tampered bundle fails (Python and TS tests) |
| Client verification | `src/intelligence/knowledge.ts`: verifies the Python-signed `contract/bundle-vector.json`; refuses tampering, untrusted keys, expiry, rollback, unknown fields |
| Controlled synchronization | `knowledgeSync` off/manual; live: server published bundle 1 for a real finding, the bundled extension downloaded and refused it (untrusted key), nothing installed |
| Revocation and rollback | Revoked ids carried in the next bundle (test); versions must increase |
| Withdrawal | `DELETE /contributors/me` (test: observations gone, finding withdrawn, token revoked) |
| Tests | pytest 44 on PostgreSQL, 43 + 1 skipped on SQLite; `npm test` intelligence 12 |

## Phase 5 evidence

| Criterion | Evidence |
|---|---|
| Verified knowledge lookup | `psft_knowledge_capability` over the installed verified bundle + local findings |
| Capability confidence reporting | Five answers, D18; test with the server-signed bundle: VERIFIED on 8.62.09 and 8.62, UNVERIFIED on 8.60 and with local findings only, CONFLICTING, UNSUPPORTED, UNKNOWN, revocation |
| Version-scoped | The connection's PSSTATUS.TOOLSREL (`releaseFrom`), or a given release |
| Evidence and provenance | `psft_knowledge_evidence`, `psft_knowledge_compatibility` |
| Gates unchanged | Answers carry no permission (tested); no tool touches a writer; recording needs MCP writes on and the user's approval |

**Not verified:** the MCP tools from a real MCP client; the Discovery Center and *Show Discoveries* in a real VS Code window; the
CI workflow has not run on GitHub (nothing pushed); concurrent writers on
one *local* store across processes (documented limit, D1); the server under
load or behind TLS.

## Key files

| File | Role |
|---|---|
| `src/intelligence/{schema,fingerprint,privacy,store,contract,index}.ts`, `adapters/saveCapture.ts` | Local engine |
| `src/intelligenceCommands.ts` | Extension store; commands (open, show, record from JSON, token) |
| `src/views/discoveryView.ts` | *Discoveries* tree, finding panel, submission review, `currentUploadDecision()` |
| `src/intelligenceClient.ts` | Upload client (fetch; no tokens in errors) |
| `src/intelligence/{submission,policy}.ts` | `previewSubmission()`, `decideUpload()` (pure) |
| `src/intelligence/{knowledge,trustedKeys}.ts` | Bundle verification, `KnowledgeStore`; trusted keys (none yet) |
| `server/intelligence/app/{review,bundle}.py` | Review rules; bundle build, sign, verify |
| `src/intelligence/capability.ts`, `src/mcp/discoveryTools.ts` | Capability answers; the six MCP tools |
| `server/intelligence/contract/bundle-vector.json` | A server-signed bundle the extension must verify (test key, private half discarded) |
| `tools/intelligence/discovery.mts` | CLI: record, capture, list, get |
| `tools/intelligence/export-contract.mts` | Writes `server/intelligence/contract/` |
| `tools/intelligence/store/` | The repository's research findings (commit them) |
| `server/intelligence/app/{main,canonical,privacy,contract,db,auth,admin}.py` | Server |
| `server/intelligence/tests/` | Contract, privacy, API tests |
| `.github/workflows/intelligence-server.yml` | Server CI (SQLite + PostgreSQL) |

Commands: `npm run typecheck`; `npm test`; `npm run compile && npm run smoke`;
`npx tsx tools/intelligence/export-contract.mts` after changing the schema or
fingerprint; server: see `server/intelligence/README.md`.

## Recorded findings (tools/intelligence/store)

192 findings, 977 observations, each checked against its capture rows before recording (2026-10-13; `--expect-counters` refuses a capture whose counter steps differ). Tests re-derive every capture-backed observation and check every counter-step observation against its claim.

| Subsystem | ID | Claim | Status | Obs. |
|---|---|---|---|---|
| app-engine | f-16cd3559dbd1cbacc0bd8c1b | App Designer opens an App Engine program PeopleSoft Studio created and saves an edit of it changing only that edit, filling LICENSE_CODE | observed | 1 |
| app-engine | f-1c1a9d9f3727c2c253ef70c9 | Changing only an App Engine program's properties moves AEM and SYS by 1, not AES | reproduced | 18 |
| app-engine | f-1df2296199d258b85b90f32f | Editing only an App Engine action's SQL text moves SRM and SYS by 1, not AEM | reproduced | 9 |
| app-engine | f-32eb4c415debde9f5f2b8840 | Deleting App Engine actions or a section tombstones their PeopleCode in PSPCMPROGDEL at the new PCM, SQL in PSSQLDEL at the new SRM, and a section in PSAESECTDEL at the new AES | reproduced | 3 |
| app-engine | f-345656b01a15e8c89db1e4c5 | PeopleSoft Studio's App Engine writer reproduces App Designer's rows for 85 of 88 captured saves; the 3 others differ only in PSSQLHASH.MARKET | observed | 1 |
| app-engine | f-40babbc79f39efd83f68859c | After an App Engine section's market is re-keyed, App Designer leaves PSSQLHASH.MARKET unchanged until a later save | reproduced | 3 |
| app-engine | f-7813ad82caab6c1204716fa1 | Renaming an App Engine program tombstones the old name in PSAEAPPLDEL at the new AEM | observed | 1 |
| app-engine | f-9f82873fd798d79a6f5df946 | Editing only an App Engine action's PeopleCode moves PCM and SYS by 1 | reproduced | 2 |
| app-engine | f-aca484c980b5bbc3045596c1 | Changing an App Engine section, step or action moves AEM, AES and SYS by 1 | reproduced | 51 |
| app-engine | f-d3a388ee70c25792a50ca764 | Deleting an App Engine program moves AEM, AES, SRM and PCM by 2 and SYS by 1, and leaves tombstones at the final counters | observed | 1 |
| app-engine | f-d477c0ab70e48a7736224355 | Saving a new App Engine program moves AEM by 1 and stamps PSAEAPPLDEFN.VERSION with it | reproduced | 2 |
| application-class | f-0955875d330562f340b9c23e | Adding an application class rewrites every PSPACKAGEDEFN row of its root package with VERSION = the new APM | reproduced | 3 |
| application-class | f-25040e230f523de62ee3f1d6 | Creating an application class in one save moves APM and PCM by 1 and SYS by 1 | reproduced | 2 |
| application-class | f-6ba6f6aadec5d928c6042e3f | An application class's program is PSPCMPROG 104 (root) / 105 (subpackage) / 107 (class) / 12 OnExecute; a class's QUALIFYPATH is ':' in the root, else its subpackage path | reproduced | 3 |
| application-class | f-f7f2f20852253b5e6cf6ef0f | Creating an application package writes one PSPACKAGEDEFN row (PACKAGEROOT = its name, QUALIFYPATH '.', PACKAGELEVEL 0, VERSION = new APM) and moves APM and SYS by 1 | observed | 1 |
| component | f-3cacac9b191a0225654a8f3d | Saving an existing component moves PGM and MDM by 1 (PSVERSION and PSLOCK) and SYS by 1; PSPNLGRPDEFN.VERSION is the new PGM | reproduced | 78 |
| component | f-510fe8f23a5e77342c8859e0 | Creating a component moves PGM by 1 and SYS by 1, not MDM | observed | 1 |
| component | f-64ec2d6391192f12f64cad1a | An App Designer component save deletes and re-inserts the component's PSPNLGRPDEFN, PSPNLGROUP, PSPNLGRPDEFNEXT and PSPNLGRPSCRIPTS rows | reproduced | 6 |
| component | f-6acf5819cedc01ac096ddc83 | A component save that changes Fluid Mode or Small Form Factor also moves PRSM by 1 | reproduced | 4 |
| component | f-d26798fcd3f9779bfc1d21d6 | Component style sheets and JavaScript objects are numbered SEQNO 0, 10, 20 ... per PTSCRIPTTYPE, PTSCRIPTCATG DEV | reproduced | 4 |
| component-interface | f-05f121f074b6a7576e29a858 | File > Rename of a Component Interface moves BCM, CLM, MPM, PCM, PJM and SYS by 1 each | observed | 1 |
| component-interface | f-7ad3b8980b1c7ae6b464ca59 | File > Delete of a Component Interface moves BCM, CLM and SYS by 1 (PCM too with PeopleCode) | observed | 1 |
| component-interface | f-ad78da26c297d545dbc06cd9 | App Designer opens a Component Interface PeopleSoft Studio's writer made and saves an edit of it changing only that edit | observed | 1 |
| component-interface | f-cac4dc5f446f39d9dbbb8026 | Taking a standard method away from a Component Interface also moves CLM | observed | 1 |
| component-interface | f-e914dad1753456f91f7828a2 | Editing only a Component Interface's methods PeopleCode moves PCM and SYS by 1 | observed | 1 |
| component-interface | f-fedefefdb30a40a90ea77a36 | Creating a Component Interface or changing its properties, items or synchronization moves BCM and SYS by 1 | reproduced | 22 |
| event-mapping | f-5731b0851774a312b6aa05af | PTCS_ISCOMPSERVICE level codes: C Component, R Page, P Record, F Record Field (PSXLATITEM's labels mislead) | observed | 1 |
| event-mapping | f-7e8ece79e395dbb863bc93e5 | Defining a related content service moves RCSDM by 1 in PSVERSION but by 2 in PSLOCK | observed | 1 |
| event-mapping | f-ad18a114ff35fcdc4d8920ef | PeopleSoft Studio's Event Mapping writer writes what the Configure Event Mapping page writes | observed | 1 |
| event-mapping | f-e3a3f17f095c20582322485d | The fluid Configure Event Mapping page re-saves every row on Save | reproduced | 3 |
| field | f-1d79752a8a48303988b8c2ab | Deleting a field's last translate value leaves a PSXLATDEFNDEL row at that save's XTM; adding a value again deletes it | reproduced | 2 |
| field | f-633064c7628c8b8f0fd8dd36 | A new translate value takes SYNCID from PSSYSTEMID.PTNEXTSYSTEMID, advanced by 1; rewritten values keep theirs | reproduced | 3 |
| field | f-80ff5e4273d52649f898bf83 | Creating a field moves RDM by 1 (PSVERSION and PSLOCK) and SYS by 1; PSDBFIELD.VERSION is the new RDM | reproduced | 2 |
| field | f-9e12dd246b7e7619702dd929 | Saving a field sets VERSION on each record holding it to the field's new RDM, without restamping | observed | 1 |
| field | f-e10dc0f6587024ea43dd7abf | A translate value save moves XTM and PDM by 1 (PSVERSION and PSLOCK) and SYS by 1; PSXLATDEFN.VERSION is the new XTM | reproduced | 5 |
| field | f-e4fc9115d38500fbd986c268 | Saving a changed field moves RDM and PDM by 1 (PSVERSION and PSLOCK) and SYS by 1; PSDBFIELD.VERSION is the new RDM | reproduced | 2 |
| field | f-e7c1a3192f3c6684f68e2935 | Creating a Character field of length 1-4 writes a PSXLATDEFNDEL row at the new XTM and moves XTM and PDM by 1 | reproduced | 2 |
| html | f-b8776d69c6d610f49325fded | An HTML definition's text is PSCONTENT.CONTDATA in UTF-16LE without BOM, 32,000-byte rows from SEQNUM 0, CRLF, one NUL terminator at the end | reproduced | 2 |
| html | f-d20e461de84d3a5911bb529d | An HTML definition save stamps PSCONTDEFN.VERSION with CRM, which moves in PSVERSION and PSLOCK with SYS | reproduced | 2 |
| menu | f-17af9b7e2bf6ed8affa19fd4 | A menu's Menu Group separator is PSMENUDEFN.GROUPSEP | observed | 1 |
| menu | f-2485f61a61fab9e7ed10364d | File > Delete of a menu moves CLM, MDM and SYS by 1 | observed | 1 |
| menu | f-511aad19c0b23469a567f007 | A menu group's order or separator is saved into every menu of the group, each taking the new MDM as VERSION, none restamped | reproduced | 3 |
| menu | f-57c2d414907ef3a230842be1 | A menu's Menu installed is PSMENUDEFN.INSTALLED | reproduced | 3 |
| menu | f-6be47b7e2ae3c56a70dc07c4 | File > Rename of a menu moves TSTM, ACM, CLM, MDM, PCM, PJM, SYS and TSM by 1 each | reproduced | 2 |
| menu | f-747bf896569263b485e2c14c | Deleting or cutting a menu item (not a separator) or bar moves CLM by 1, with MDM and SYS | reproduced | 4 |
| menu | f-79c2f48c47bc70d84de97fae | A menu's Menu Group Order is PSMENUDEFN.GROUPORDER | observed | 1 |
| menu | f-d2ebb48c4ecbd05fdb1d9433 | App Designer opens a menu PeopleSoft Studio's writer made and saves an edit of it changing only that edit | observed | 1 |
| menu | f-e67b210fbd5513c963df1387 | A menu definition save moves MDM and SYS by 1 | reproduced | 32 |
| menu | f-ee56e64b0456e64d337abd06 | Renaming a menu item or bar moves CLM and MDM by 2, PCM by 1, SYS by 2 | reproduced | 3 |
| menu | f-fa22f24f6a25576eab01a161 | A menu's Menu Group is PSMENUDEFN.MENUGROUP | observed | 1 |
| menu | f-fafae98d016ada8a134677e2 | Editing only a menu item's ItemSelected PeopleCode moves PCM and SYS by 1; the menu row is not touched | reproduced | 3 |
| message-channel | f-13baaf5f7d94524fb24f7c28 | A message channel save moves CHDM by 1 and SYS by 1; PSCHNLDEFN.VERSION is the new CHDM | reproduced | 14 |
| message-channel | f-63084706f407d6e694a0b917 | Deleting a message channel writes PSCHNLDEL at the new CHDM and removes its partition rows | observed | 1 |
| message-channel | f-c945e4793142f596bfb4a88f | App Designer opens a message channel PeopleSoft Studio's writer made and saves an edit of it changing only that edit | observed | 1 |
| message-channel | f-e652e5d38577cf3f511c6456 | Renaming a message channel re-keys its rows in place and moves CHDM, MSDM, PJM and SYS by 1, references or not | reproduced | 2 |
| other | f-76b320392022a312cd7d7562 | PSADSTRACKING.PTKEYHASH is SHA-1 over UTF-16LE '( NAME = value )' text, keys sorted by name, base64 | observed | 1 |
| page-designer | f-00050251f7aa77dedbda7a85 | An edit box's Size Average / Maximum / Custom is PSPNLFIELD.FIELDSIZETYPE 0 / 1 / 2 | reproduced | 3 |
| page-designer | f-01842e5f24a54d6dc6b9ddfd | A secondary page's OK & Cancel off, Close Box off and Disable Display in Modal Window are PSPNLDEFN.PNLUSE 0x1, 0x2 and 0x2000 | reproduced | 3 |
| page-designer | f-01d389c151f95ca8d7e4ef4c | A group box's Fluid Gestures is PSPNLFIELDEXT.FIELDUSETEMP2 0x40 | observed | 1 |
| page-designer | f-0325b4465014e9c7e16a802d | A page's Popup Menu is PSPNLDEFN.POPUPMENU | observed | 1 |
| page-designer | f-0a2b843879abf6c142e63b3b | PSPNLFIELD.FIELDNUM stays a contiguous 1..N order: App Designer renumbers existing controls when controls are added or deleted | reproduced | 3 |
| page-designer | f-11419628b6ca7ab9de21fe1e | An edit box's Show Label is PSPNLFIELD.FIELDUSE 0x400 | observed | 1 |
| page-designer | f-117a811a762c6d2723422232 | A range input's Min / Max / Step are PSPNLFIELDEXT.MINNUMBER / MAXNUMBER / STEPNUMBER, as text | reproduced | 2 |
| page-designer | f-12240bb11be358e2373fefbd | A standard page's Page Size choice is one PSPNLDEFN.PNLUSE bit (0x4 800x600, 0x20 / 0x40 in / without portal, 0x800 / 0x80 1024x768, 0x200 / 0x400 Var, 0x8 Custom) | reproduced | 11 |
| page-designer | f-1372499479272a44b269fd36 | A page control's Allow Deferred Processing is PSPNLFIELD.DEFERPROC 1 | reproduced | 2 |
| page-designer | f-13ecc4acae52097e9adba9c2 | A freshly inserted Grid is FIELDUSE 0x1000, DSPLFORMAT 0x20000, label 'Grid' of type None, RECNAME its main record | reproduced | 2 |
| page-designer | f-13f00023f4a3a533d8e2910b | Hide Border on a frame or group box is PSPNLFIELD.FIELDUSE 0x4000000 | reproduced | 2 |
| page-designer | f-14e0cdaa292646aba5f54d97 | A group box's Droppable is PSPNLFIELD.FIELDUSETMP 0x1000000 | observed | 1 |
| page-designer | f-1a28b9a9355c3b91165ec3df | A page's Fluid Page setting is PSPNLDEFN.PNLUSE 0x4000 | reproduced | 3 |
| page-designer | f-1c4f8c2db2dd8406f9cce1b2 | A page's type is PSPNLDEFN.PNLTYPE: 0 Standard, 1 Subpage, 2 Secondary, 3 Popup, 4 Header, 5 Side Page 1, 6 Footer, 7 Layout, 8 Search, 9 Prompt, 10 Master/Detail Target, 11 Side Page 2 | reproduced | 18 |
| page-designer | f-1cfacdb76859e25a4b7885f2 | A label's Position is PSPNLFIELD.LABELSIZETYPE: 0 Left, 1 Custom, 2 Top | reproduced | 4 |
| page-designer | f-1d8a1339e6ad19df29cbe338 | A page control label's Alignment Left / Centered / Right is PSPNLFIELD.DSPLFORMAT 0x80000 / 0x100000 / 0x200000 | reproduced | 7 |
| page-designer | f-1de8ee3db13ed02a78431b8b | App Designer puts a new page control right after the control before it in reading order, not after the selection or at the end | reproduced | 19 |
| page-designer | f-218f79682c2d01f237e7f3c2 | Fluid Suppress On Form Factor: Large is PSPNLFIELD.FIELDUSETMP 0x20000000 | observed | 1 |
| page-designer | f-22fdf94fdd2a0fb6d19ef98d | A page's Background is PSPNLDEFN.PNLSTYLE | observed | 1 |
| page-designer | f-28c115a2a1db1ccac7fcd6fc | The first OK on a page control's Properties dialog writes PSPNLFIELDEXT.FFSTYLELONG ' | | | | ' | reproduced | 7 |
| page-designer | f-29741c05ebc7cd61421d4026 | An edit box's Auto Decimal is PSPNLFIELD.DSPLFORMAT 0x400 | reproduced | 2 |
| page-designer | f-2bdceb29cac6ed0da30bc8bf | An edit box's Show Prompt Button off is PSPNLFIELD.DSPLFORMAT 0x800000 | reproduced | 2 |
| page-designer | f-2cf26e1cbf388b8318b68f40 | An edit box's Generate As Hyperlink is PSPNLFIELD.FIELDUSETMP 0x80000 | reproduced | 2 |
| page-designer | f-37b4f697cdfd1298674419a4 | A freshly inserted Scroll Bar is invisible (FIELDUSE 0x2, SECUREINVISIBLE 1), 17 wide, at Occurs Level 1 | observed | 1 |
| page-designer | f-3b06650e8f06201594627764 | An edit box's Auto Fill is PSPNLFIELD.DSPLFORMAT 0x200 | reproduced | 2 |
| page-designer | f-3c462058225a8bc301b1903b | A group box's Fluid Capture Trigger is PSPNLFIELDEXT.FIELDUSETEMP2 0x8000 | observed | 1 |
| page-designer | f-3c56a041d8fbd4f7f9cd5f6a | A long edit box's Enable Long Edit Counter is PSPNLFIELD.FIELDUSETMP 0x8000000 | observed | 1 |
| page-designer | f-41174182e7047fff4bcdc7ea | First occurs only is PSPNLFIELD.DSPLFORMAT 0x400000 | reproduced | 3 |
| page-designer | f-41bfc2ce8c2248b2eaa37a16 | An edit box's Display Zero is PSPNLFIELD.DSPLFORMAT 0x80 | reproduced | 2 |
| page-designer | f-42b8af610f611006491e2062 | Fluid Label Rendering: After Control is PSPNLFIELD.FIELDUSETMP 0x2000000 | observed | 1 |
| page-designer | f-45cd887de7d76193944eec38 | Choosing a Message Catalog label blanks PSPNLFIELD.LBLTEXT to ' ' | reproduced | 4 |
| page-designer | f-4aeb84aae7118e1e498b49b8 | Multi-Currency Field on a page control is PSPNLFIELD.FIELDUSE 0x20 | reproduced | 7 |
| page-designer | f-4b0082e124ad2689740702a9 | An edit box's Password is PSPNLFIELD.DSPLFORMAT 0x8000 | reproduced | 2 |
| page-designer | f-4c9dc928359cd61e972c2e46 | Generate in HTML on an invisible page control is PSPNLFIELDEXT.FIELDUSETEMP2 0x20 | reproduced | 4 |
| page-designer | f-4ccab1a68be0d2b3c1cc3609 | A freshly inserted Static Text is DSPLFORMAT 0x4001: Left alignment 0x1 set | observed | 1 |
| page-designer | f-4f0035647e8f65de949dcd83 | An edit box's Input Only is PSPNLFIELDEXT.FIELDUSETEMP2 0x200 | reproduced | 2 |
| page-designer | f-4f76b0ca1768a39b7ce0cab8 | Invisible set from the Properties window's grid is PSPNLFIELD.FIELDUSE 0x2 alone; SECUREINVISIBLE stays 0 | reproduced | 2 |
| page-designer | f-5150a2ffdf10f82fe5a02161 | An edit box's Display Century is PSPNLFIELD.DSPLFORMAT 0x10000 | reproduced | 2 |
| page-designer | f-52f47bd73ce2e52fc4b384ca | An edit box's Message Catalog popup is PSPNLFIELD.FIELDUSETMP 0x2200 with PSPNLFIELDEXT.MESSAGE_SET_NBR / MESSAGE_NBR | reproduced | 2 |
| page-designer | f-552b4d2db08e2d40b5859f3e | An edit box's Display Time Zone is PSPNLFIELD.DSPLFORMAT 0x20000000 | reproduced | 2 |
| page-designer | f-59dfdd3d38ea37d8e5ced4a6 | Enable Spell Check is PSPNLFIELD.FIELDUSETMP 0x2 | reproduced | 3 |
| page-designer | f-5c5c7eb705e2fbee555fbfe3 | A horizontal rule's Set to Level is FIELDUSE 0x2 with SECUREINVISIBLE 1; its level is OCCURSLEVEL and PSPNLFIELDEXT.PT_NUMFLD1, which clearing keeps | reproduced | 4 |
| page-designer | f-5efa432327cbb9df35f96e29 | Display Control Field is PSPNLFIELD.FIELDUSE 0x8 | reproduced | 6 |
| page-designer | f-60f36939a246a479af94f7ba | A page control label's type is PSPNLFIELD.LBLTYPE: 0 None, 1 Text, 2 RFT Short, 3 RFT Long, 7 Message Catalog | reproduced | 15 |
| page-designer | f-62b99e3779da3856fbe781ac | App Designer stores each page control's OCCURSLEVEL from tab order: a running level that each scroll and each Set to Level rule sets to its own | reproduced | 16 |
| page-designer | f-6a77a4c6fa99303b68267217 | Fluid Control Structure: Basic is PSPNLFIELD.FIELDUSETMP 0x4000000 | observed | 1 |
| page-designer | f-6bbfd2ebcb24e3aa8d8a3bee | An App Designer page save moves PDM by 1 (PSVERSION and PSLOCK) and SYS by 1; PSPNLDEFN.VERSION is the new PDM | reproduced | 95 |
| page-designer | f-6db3412abdca45605004f823 | A group box's Draggable is PSPNLFIELD.FIELDUSETMP 0x800000 | observed | 1 |
| page-designer | f-6e870830b618233fd3bd3ad8 | Fluid Suppress On Form Factor: Extra Large is PSPNLFIELDEXT.FIELDUSETEMP2 0x80 | observed | 1 |
| page-designer | f-6f34cd13c903c9cd40a06bfa | Page control Display Only is PSPNLFIELD.FIELDUSE bit 1; Invisible is bit 2 and sets SECUREINVISIBLE | observed | 1 |
| page-designer | f-71f9cb0003fcaa037980cd29 | Adjust Layout for Hidden Fields is PSPNLFIELD.PTADJHIDDENFIELDS 1 | reproduced | 3 |
| page-designer | f-72a1b1e5c2b60d4641047a0d | A static text's Message Catalog shown as Explanation is PSPNLFIELD.DSPLFORMAT 0x40000000 | observed | 1 |
| page-designer | f-774d7686aaac9710aa34aebc | A static image's Image ID is PSPNLFIELD.CONTNAME | observed | 1 |
| page-designer | f-78fdc3c6fc16a442a45b34e7 | Enable When Page is Display Only is PSPNLFIELD.FIELDUSE 0x40000 | reproduced | 4 |
| page-designer | f-79e2038a6957e7b6c50f6557 | An edit box's Currency Symbol is PSPNLFIELD.DSPLFORMAT 0x10 | reproduced | 2 |
| page-designer | f-7d8871e6dd323ebf5735c04e | An edit box's Fill Character is PSPNLFIELD.DSPLFILL | reproduced | 2 |
| page-designer | f-7ee9369365c10274e498ac35 | An edit box's Page Popup is PSPNLFIELD.FIELDUSETMP 0x200 and PSPNLFIELDEXT.PTPOPUPPNL | reproduced | 2 |
| page-designer | f-816517d0d2510c55b26932ae | A page control's Page Field Name is PSPNLFIELD.PNLFIELDNAME | observed | 1 |
| page-designer | f-822a0691dc44467e46a5bde4 | A page's Fluid style classes are PSPNLDEFN.FFSTYLEDESKTOP, FFSTYLEPHONE (Small), FFSTYLEMEDIUM, FFSTYLETABLET (Large) and FFSTYLEEXLARGE | reproduced | 5 |
| page-designer | f-89c46286c14ee7f87b30a73b | A long edit box's Display in Modal Window is PSPNLFIELD.FIELDUSETMP 0x100 | observed | 1 |
| page-designer | f-8eb6c38024387aa0c2a9c163 | An edit box's Alignment Auto / Left / Right is PSPNLFIELD.DSPLFORMAT 0x8 / 0x1 / 0x4 | reproduced | 3 |
| page-designer | f-938ded8dd042f5e560b3826c | A Secondary Page control is inserted invisible (FIELDUSE 0x2, SECUREINVISIBLE 1), 24 x 22, FIELDSIZETYPE 3, DSPLFORMAT 0x80000, SUBPNLNAME the page | observed | 1 |
| page-designer | f-9a96add14da9ae2f35c1e568 | A group box's Fluid Group Box Type, Html Tag Type and ScrollBars are PSPNLFIELDEXT.GRPBOXTYPE, GRPBOXHTMLTYPE and SCROLLBARS, as list indexes | reproduced | 4 |
| page-designer | f-9ecc6fd8d9258c7cdf8d40e6 | A group box's Suppress Accessible Label is PSPNLFIELD.FIELDUSE 0x2000 | observed | 1 |
| page-designer | f-9f767c0982b8c4778efdccee | App Designer puts a new scroll (Scroll Area, Scroll Bar, Grid) after the last control whose top is at or above the scroll's bottom edge | reproduced | 5 |
| page-designer | f-a0c36f3aa7c4649110545d1a | Dragging a control to a new tab position swaps PSPNLFIELD.FIELDNUM; nothing else changes | observed | 1 |
| page-designer | f-a4b24a8100957266f22d7bb3 | An HTML Area's Respond Only Once is PSPNLFIELDEXT.FIELDUSETEMP2 0x1000 | reproduced | 2 |
| page-designer | f-a59884249af2192134fa87ee | Every page control has a PSPNLFIELDEXT row beside its PSPNLFIELD row | reproduced | 5 |
| page-designer | f-a62727af1a73ad77f017d76e | A Message Catalog label's set and number are PSPNLFIELD.GRDLBLMSGSET and GRDLBLMSGNUM | reproduced | 6 |
| page-designer | f-a86d3314045b11099b172255 | Fluid Suppress On Form Factor: Small is PSPNLFIELD.FIELDUSETMP 0x40000000 | observed | 1 |
| page-designer | f-aa52e78a39660e3e4c945bed | A page control's Enable as Page Anchor is PSPNLFIELD.ENABLEASANCHOR 1 | observed | 1 |
| page-designer | f-acbaa492626109e5af2cb0b1 | A group box's Fluid Scroll Sizing by Style is PSPNLFIELDEXT.FIELDUSETEMP2 0x8 | observed | 1 |
| page-designer | f-af75869018e651465d3e0897 | A group box's Collapsible Data Area, Default Initial View to Expanded and Hide all Fields are PSPNLFIELD.PTCOLLAPSEDATAAREA, PTDFLTVIEWEXPANDED and PTHIDEFIELDS | reproduced | 3 |
| page-designer | f-b37f4d98644bf0db3b970b00 | Set Component Changed off is PSPNLFIELD.FIELDUSETMP 0x8 | reproduced | 3 |
| page-designer | f-b46dd5e41d5dc1cc10dffda0 | A page's Owner ID is PSPNLDEFN.OBJECTOWNERID | observed | 1 |
| page-designer | f-b948d204e86b0616d9d4a9cf | An edit box's 1000 Separator is PSPNLFIELD.DSPLFORMAT 0x20 | reproduced | 2 |
| page-designer | f-b9671e6c984cf7b1dfccb69b | Binding an edit box to another field writes the field's default LABEL_ID and FORMATFAMILY | reproduced | 2 |
| page-designer | f-bb18f22a884a893c5c6a9e15 | A new page control takes PNLFLDID = MAXPNLFLDID + 1; MAXPNLFLDID never goes down, deleted ids are not reused | reproduced | 4 |
| page-designer | f-bbad6a074f57a27f3f487f05 | Wrap Long Words is PSPNLFIELD.FIELDUSETMP 0x40 | reproduced | 3 |
| page-designer | f-bf31ed91a2ed6881bd7b30c6 | Modifiable by JavaScript on an invisible page control is PSPNLFIELD.SECUREINVISIBLE 0 | reproduced | 2 |
| page-designer | f-c5cd81e8e53ac0d5d23fb332 | A page control's Style is PSPNLFIELD.FIELDSTYLE, the style class name, ' ' for the default | reproduced | 7 |
| page-designer | f-c6a6a1fd0f428c5bd4faee8a | A page's Style Sheet is PSPNLDEFN.STYLESHEETNAME | observed | 1 |
| page-designer | f-c8651ec6661cd8d2f00a76ad | Read only control for screen reader is PSPNLFIELDEXT.FIELDUSETEMP2 0x10000 | reproduced | 4 |
| page-designer | f-c949f4189df653ce6c5c6b4b | A Fluid control's style classes are PSPNLFIELDEXT.FFSTYLELONG: five '|'-separated slots, Default, Small, Medium, Large, Extra Large | reproduced | 5 |
| page-designer | f-ca8e291fb7c618832608484d | Fluid Suppress System-Supplied Style Classes is PSPNLFIELD.FIELDUSETMP 0x400000 | observed | 1 |
| page-designer | f-cc0a97fca9864643fcb92961 | A page's Adjust Layout for Hidden Fields is PSPNLDEFN.PNLUSE 0x100 | observed | 1 |
| page-designer | f-cd81a5c55bdbf553224e0f62 | An App Designer page save deletes and re-inserts every row of the page, changed or not | reproduced | 92 |
| page-designer | f-cee49e5b7ed853fea8bf7dcf | A long edit box's Enable Rich Text is PSPNLFIELD.FIELDUSETMP 0x80 and a PSPTPNLRTEDITOR row | reproduced | 2 |
| page-designer | f-d196920137385fbd15604fd6 | Fluid Suppress On Form Factor: Medium is PSPNLFIELDEXT.FIELDUSETEMP2 0x10 | observed | 1 |
| page-designer | f-d1f35fe2d0aed6a5bbbb36a8 | Paragraph is PSPNLFIELDEXT.FIELDUSETEMP2 0x800 | reproduced | 3 |
| page-designer | f-d2864b0e380ba5130201ba51 | A static image's Scale / Size is PSPNLFIELD.DSPLFORMAT 0x800 / 0x4000 | reproduced | 4 |
| page-designer | f-d46df932804c56165de15984 | A static text's Alignment Left / Centered / Right is PSPNLFIELD.DSPLFORMAT 0x1 / 0x2 / 0x4 | reproduced | 2 |
| page-designer | f-d9e03c2f85410cac3cad4e87 | An edit box's Smart Prompt is PSPNLFIELDEXT.PTDISABLESMARTPROM 0 | reproduced | 2 |
| page-designer | f-dc0443deed0189182ffd137f | Display-Only Appearance: Disabled Edit Control is PSPNLFIELD.FIELDUSETMP 0x4 | reproduced | 3 |
| page-designer | f-dcd7cd1b0236ecc69d32f9e4 | Fluid Placeholder Text is PSPNLFIELDEXT.PLHTYPE 0 None / 1 Static / 2 Message Catalog with PLACEHOLDER or PLH_MSG_SET_NBR / PLH_MSG_NBR | reproduced | 2 |
| page-designer | f-dd4004fb630a3d4a7776ad53 | Display Only on a page control is PSPNLFIELD.FIELDUSE 0x1 | reproduced | 4 |
| page-designer | f-decaffd9db3234f3841aa857 | A page's Suppress System-Supplied Style Classes is PSPNLDEFN.PNLUSETEMP 0x1 | observed | 1 |
| page-designer | f-dfd8f0d79b2abf200c8322c6 | A long edit box's Expand Field When Display Only is PSPNLFIELD.PTLEBEXPANDFIELD 1 | reproduced | 2 |
| page-designer | f-e2c41d86557fba7f022cc9f2 | A group box's Message Catalog Popup is PSPNLFIELD.FIELDUSETMP 0xA000 with PSPNLFIELDEXT.MESSAGE_SET_NBR / MESSAGE_NBR | reproduced | 2 |
| page-designer | f-e601f9dfa5a2ccc9b10d2d01 | A page's Allow Deferred Processing is PSPNLDEFN.DEFERPROC 1 | observed | 1 |
| page-designer | f-f31161a932a8df1c887fc17c | An HTML Area's HTML Tags Only is PSPNLFIELD.FIELDUSETMP 0x100000 | reproduced | 2 |
| page-designer | f-f5591d5a054aa476ae80a09f | Invisible on a page control is PSPNLFIELD.FIELDUSE 0x2 with SECUREINVISIBLE 1 | reproduced | 4 |
| page-designer | f-f7904ce34399f697bd7fb272 | Fluid Include Labels in Grid Cells is PSPNLFIELDEXT.FIELDUSETEMP2 0x2 | observed | 1 |
| page-designer | f-fe89a32dd42b46075306c28e | An HTML Area's Constant value is a PSPNLHTMLAREA row; going back to Field deletes it | reproduced | 2 |
| page-designer | f-feb8dc63228d1cd6d0db7486 | PSPNLFIELD.FIELDTYPE is the page control's kind: 22 codes from 0 Static Text to 32 Analytic Grid, read from App Designer's inserts | reproduced | 21 |
| page-designer | f-ffe416ba3fff85f9abc83c88 | An edit box's Fluid Input Type is PSPNLFIELDEXT.HTML_INPUT_TYPE: 0 text, 1 color, 2 date, 3 datetime, 5 email, 7 number, 8 range, 9 search, 10 tel, 11 time, 12 url | reproduced | 11 |
| peoplecode | f-232ea6241450a52b85ba008e | Component PeopleCode keys are PSPCMPROG OBJECTIDs 10 / 39 / 12 (component), 10 / 39 / 1 / 12 (record), 10 / 39 / 1 / 2 / 12 (record field) | reproduced | 3 |
| peoplecode | f-3761278ebeac004eaa038d19 | Page PeopleCode is keyed PSPCMPROG OBJECTID 9 (page) / 12 (event Activate) | reproduced | 2 |
| peoplecode | f-4b305278e139223725373289 | Changing an application class's PeopleCode, its interface included, moves only PCM and SYS; PSAPPCLASSDEFN and PSPACKAGEDEFN are not touched | observed | 1 |
| peoplecode | f-5841ece4e2d085787c72b537 | Deleting Page PeopleCode writes a PSPCMPROGDEL row at the new PCM | observed | 1 |
| peoplecode | f-59da48c7debdd679ee3e231e | Deleting a component PeopleCode program writes a PSPCMPROGDEL row at the new PCM | observed | 1 |
| peoplecode | f-5bf95fb66564b0f38173eb9f | Record Field PeopleCode is keyed PSPCMPROG OBJECTID 1 (record) / 2 (field) / 12 (event) | reproduced | 2 |
| peoplecode | f-6f30e5b716884d8f951e7ff5 | A Record PeopleCode save moves PCM by 1 (PSVERSION and PSLOCK) and SYS by 1; PSPCMPROG.VERSION is the new PCM | reproduced | 9 |
| peoplecode | f-8fcfa52cbc8b14ffc8bc9bb8 | PSPCMPROG.PROGLEN is the program's total bytes and NAMECOUNT the number of its PSPCMNAME rows | reproduced | 4 |
| peoplecode | f-a0584c68febd6fc37ec6e774 | Creating, editing or deleting Page PeopleCode moves PCM and SYS by 1; the page's PDM does not move | reproduced | 3 |
| peoplecode | f-a8f691f0029aa37a5c51e405 | App Designer writes nothing when a PeopleCode program does not compile | observed | 1 |
| peoplecode | f-c25d40474b82a4b3d5f39a89 | Creating, editing or deleting a component PeopleCode program moves PCM and SYS by 1; the component's PGM and MDM do not move | reproduced | 5 |
| peoplecode | f-f5ee5f5d3c262cf5fcefaf63 | Saving a PeopleCode program empty deletes it and writes PSPCMPROGDEL at the new PCM; saving the key again deletes that marker | reproduced | 2 |
| peoplecode | f-fb2ffc81365c4d15d0ea8077 | A PeopleCode save deletes and re-inserts every PSPCMTXT, PSPCMPROG and PSPCMNAME row of the program's key, unchanged rows included | reproduced | 7 |
| project | f-1a1df3b9c0cdf0d0553e5ffb | Creating a project writes one PSPROJECTDEFN row (VERSION = new PJM; KEEPTGT 31, COMPARETYPE 1, COMMITLIMIT 50, REPORTFILTER 16232832) and moves PJM and SYS by 1 | observed | 1 |
| project | f-26c465f2ded30e5cb29a474d | Saving a project after Insert Into Project adds one PSPROJECTITEM row, rewrites PSPROJECTDEFN at the new PJM and moves PJM and SYS by 1 | observed | 1 |
| project | f-74c70228d2ea52f7a76b0219 | A message channel in a project is PSPROJECTITEM OBJECTTYPE 36, OBJECTID1 61 (CHNLNAME) | observed | 1 |
| project | f-b1c3ec7acdb9b451a91a3bea | A field in a project is PSPROJECTITEM OBJECTTYPE 2, OBJECTID1 6 (FIELDNAME) | observed | 1 |
| record | f-02b34d989d83e3631d9abc1c | An Analytic Delete reference does not move the referring record when the referenced record is saved | observed | 1 |
| record | f-13f37132ac91664fbbd38a05 | Removing a field or subrecord from a record moves PGM by 1 as well as RDM | reproduced | 4 |
| record | f-1ae1a55f3e464f2673977ca6 | An App Designer record save moves RDM by 1 (PSVERSION and PSLOCK) and SYS by 1; PSRECDEFN.VERSION is the new RDM | reproduced | 41 |
| record | f-641fe0bd360226a91e455c39 | An App Designer record save deletes and re-inserts the PSRECDEFN row and every PSRECFIELD and PSRECFIELDDB row of the record | reproduced | 7 |
| record | f-6d12bbea7647baca6415b746 | Renaming a record re-keys its rows in place, writes PSRECDEL and PSOBJCHNG, and moves 19 counters by 1 each | observed | 1 |
| record | f-a4f8562daa47bf2f893a75a5 | Deleting a record moves RDM and AEM by 1 and SYS by 1, and writes PSRECDEL at the new RDM | observed | 1 |
| record | f-a8daaa0842dae718027cde3e | Saving a record sets VERSION on each record that names it as Related Language record to the new RDM, without restamping | reproduced | 5 |
| record | f-dcf2998165b40fdf33d49b52 | A record save that writes or removes the record's view SQL moves SRM by 1 as well as RDM | reproduced | 6 |
| record | f-df985b98ec0473885077bd9b | Saving a new record under a deleted record's name deletes that name's PSRECDEL row | observed | 1 |
| sql | f-c3cf5c2bdb40d259ddf76597 | An App Designer SQL definition save moves SRM by 1 (PSVERSION and PSLOCK) and SYS by 1; PSSQLDEFN.VERSION is the new SRM | reproduced | 2 |
| style-sheet | f-02444755dab8bc78dfc453d3 | A style sheet save moves SSM by 1 (PSVERSION and PSLOCK) and SYS by 1, not CRM; PSSTYLSHEETDEFN.VERSION is the new SSM | reproduced | 3 |
| style-sheet | f-309a9baa82e662b5c857f400 | A freeform style sheet is a PSSTYLSHEETDEFN row of STYLESHEETTYPE 2 with its text as a PSCONTDEFN (CONTTYPE 9) / PSCONTENT definition; its description is PSSTYLSHEETDEFN.DESCR | reproduced | 2 |
| style-sheet | f-f7f853642639ae468ed18edd | Saving a freeform style sheet writes its PSCONTDEFN.VERSION as the row's previous VERSION + 1, without moving CRM | reproduced | 2 |

## Resume: next tasks, in order

1. **Open the Discovery Center in a real VS Code window** (install the
   built VSIX): the view, a panel, the review; with the local server, one
   submission.
2. **More findings**: menus, Component Interfaces, channel properties and
   records (r*: not r02, r25, r53, r65, whose windows held two saves; the
   rd* writer runs; the r0N-type-* page cases), fields (c01, c07, f01-f06;
   not the x* writer runs) and components (c01-c08b and the numbered
   i336-s406 series; not h398, a two-save window, or the w0N writer runs)
   are recorded, and page controls' Properties settings (fr, st, si, gb, hr,
   cb, cbx, ha, le, eb: 66 mapping findings, each case's change checked bit
   by bit) with every App Designer page sweep under the page counter-step
   and physical-rewrite findings; page properties (t*, r0N-type-*, u*,
   s02-s08, f01-f06, g01, o01), HTML definitions (h01, h04), style sheets
   (s01-s03; s04's window holds the writer's x10) and component PeopleCode
   (p01-p05), scroll levels (lv*: every after-image checked against the
   level rule), Page PeopleCode (q01-q03), projects (c02, p01; not p03, a
   long mixed window), packages and classes (c03-c06), control FIELDTYPE
   codes and insert defaults (*-fresh, in01, in03), the property-grid saves
   (cb-*; Invisible there leaves SECUREINVISIBLE 0) and menu groups
   (mn06-mn22), Record PeopleCode writeback (02-12b; not 03 or 12, multi-
   save windows), where an inserted control goes (to-*, every single insert
   checked against the rule; sp-fresh the one exception), App Designer
   saving what Studio's writers made (nae01, nce01, nchn01, nme01: the
   "native" cases are App Designer), and the App Engine leftovers (aa01,
   ae10, ap19, ap-pc01, the ad01 / ad02 / ae16 tombstones). Left out on
   purpose: msg02-03 (no record of which tool saved them), multi-save
   windows (ae11, ae17, ar01, 03, 12, h398, r02, r25, r53, r65, s01, s04,
   p03, f03, f06's counters), saves that wrote nothing (cb modjs, cbx01,
   eb06, eb52, msg01, sc-scroll-fields, in02, sec-fresh), and the writer
   runs (w*, x*, rd*, NN-writer-*, d*, e01, emw*). When adding captures --
   check each family's
   format with the adapter, select cases by operation, record with
   `--expect-counters` (DISCOVERY_PROTOCOL.md rules 7-9).
3. Adapters for the controlled compile lab and writer replay tests.
4. Filing issues / preparing pull requests from CI: the owner's decision
   and a least-privilege token.
5. Owner decisions: the production signing key (generate offline, add to
   `trustedKeys.ts` in a release); the retention policy (SECURITY_PRIVACY.md)
   before uploads are used outside this project.

Phase 6 commands: `npx tsx tools/intelligence/engineering-task.mts <id> [--write-fixture]`.

**Do not repeat:** reconnaissance; recording the 4 findings; the contract
export (regenerate only after a schema change); the phase 3 bundle-driven
verification (scripted in this session, not kept: redo it in a real window).

**Blockers:** none. Exposure beyond localhost needs the DEPLOYMENT.md review.
