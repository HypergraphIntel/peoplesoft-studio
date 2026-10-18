# Administration tools

Configuration Tools > Administration opens three Studio editors: Message Catalog, HCM Text Catalog, and URL Definitions. No App Designer is required. Each tool also appears in the PeopleSoft command palette.

Connect a database, search an ID or description, and open an entry. Previous/Next pages contain up to 100 results. New Entry creates a draft. Saving requires Writable access and a configured PeopleSoft Operator ID. Each save checks the opened token, writes in one transaction, verifies before COMMIT, and reads back on another connection afterward.

## Message Catalog

Browse all sets and messages. Create custom sets/messages and edit custom message text, severity, explanation and set descriptions. Sets 1–19999 are shown read only; custom sets use 20000–32767. Message numbers are 1–32767. Adding a message to an existing set preserves that set's descriptions.

Message Text is limited to 100 characters, Set Description to 30, and Short Description to 10, as HRDMO's field definitions specify. Explanation is a CLOB. Related-language messages are shown and preserved; translation editing and deletion are not yet offered.

HRDMO's delivered PSMSGSETDEFN.VERSION SavePreChange calls UpdateSysVersion; PSMSGCATDEFN.LAST_UPDATE_DTTM SavePreChange changes the timestamp when the message record changes. The writer updates the set's version from SYS and stamps changed message content. It does not rewrite translations.

[Oracle Message Catalog documentation](https://docs.oracle.com/en/applications/peoplesoft/peopletools/8.63/system-and-server-administration/message-catalog.html) documents the reserved/custom ranges and severity/text behavior. [UpdateSysVersion](https://docs.oracle.com/en/applications/peoplesoft/peopletools/8.63/peoplecode-language-reference/updatesysversion.html) returns the updated system version.

## URL Definitions

Create and edit URL ID, description, URL, owner and comments. URL IDs/descriptions are at most 30 characters; URL is at most 254 and owner ID at most four. Existing client/server flags and related properties are preserved.

The editor shows protocol/property names, not secret property values. Changing a protocol on a URL with properties is refused because delivered URL FieldChange changes dependent properties with it. Property editing and deletion are not yet offered.

Delivered PSURLDEFN.VERSION SavePreChange calls UpdateSysVersion; LASTUPDDTTM SavePreChange stamps date/time and operator. Existing-definition writes use the extension's ownership guard; verified new URLs retain Studio creation evidence. URL definitions can now be included as project members (type 56, ID 103).

## HCM Text Catalog

Choose an existing owner/sub-ID configuration and create a Text ID or add an effective-dated context row. Each identity includes owner, sub-ID, Text ID, effective date, all six context keys, and language. Base text uses a blank language key; translations require an existing base context and a known language code.

Use Add / Open Translation on an entry to choose a language and create or edit its text. Text ID description and usage are set on first creation; adding contexts/dates preserves existing header metadata. Text is limited to 8095 characters. Changed markup is checked against HR_SSTEXT_TAGS, following delivered HR_SSTEXT_TEXT FieldEdit's exact tag list.

The writer uses HR_SSTEXT_MSGID, HR_SSTEXT_EFFDT, HR_SSTEXT_TEXT, and HR_SSTEXT_LANG; it does not apply PeopleTools definition counters to HCM application rows. Configuration editing, deletion, the native Text Catalog Test UI, and application-session cache refresh are not implemented. Environments without HCM Text Catalog tables report that capability directly.

## MCP

- psft_admin_list: connection, kind (message/text/url), query, offset.
- psft_admin_get: connection, kind, key; returns editable input, the document and token.
- psft_admin_save: connection, kind, input, expectedToken (absent only for creation). Its schema exposes typed message, text and URL input branches.
- psft_admin_choices: installed Text Catalog owner/sub-ID configurations, languages and usage codes.
- psft_admin_reference: catalog identities, field limits, semantics and the list/get/save workflow.

URL key: [id]. Message key: [set, number]. Text key: [owner, sub-ID, ID, YYYY-MM-DD, key1, key2, key3, key4, key5, key6, language].

MCP saves use the existing write/approval gates and reject saves while that administration editor has unsaved changes. Numeric message sets use the custom-number range; configured name prefixes apply to URL IDs and Text IDs.

## Evidence and verification

Live record metadata is retained in tools/lab/results/administration-record-evidence.json. The 21-check HRDMO write/readback run is recorded in tools/lab/results/administration-e2e.json and can be repeated with tools/lab/administration-e2e.mts. It retains fresh test definitions and does not delete them.

A native Message Catalog save in PIA on PeopleTools 8.61.15 (new set, one message, Short Description left blank) settled the version protocol. UpdateSysVersion() moves PSVERSION and PSLOCK `PPC` to max(PSVERSION, PSLOCK) + 1 and SYS by one, and returns the new PPC, which becomes PSMSGSETDEFN.VERSION. Message sets and URL definitions share that counter: their versions run alongside PPC. Studio used to bump only SYS and store it. A blank Short Description becomes the first 10 characters of the description (PSMSGSETDEFN.DESCR SavePreChange). Studio's set and message now have rows and counter moves equal to PIA's. URL definitions use the same delivered UpdateSysVersion() call; that path was not captured separately. The production MCP HTTP routing passed nine checks, including off/unsaved-edit/approval/stale-token gates (tools/lab/results/administration-mcp-e2e.json). No PeopleCode encoder or decoder rules were changed.
