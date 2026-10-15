# Security tools: OAuth and SAML

Configuration Tools > Security opens OAuth and SAML panels on the selected
connected database. The command palette exposes the same tools. Search results
page in groups of 100; configurations show stored properties and configuration
checks. Checks do not execute authentication or contact any endpoint.

## OAuth2 Service Applications

Browse the installed service applications by OAuth name. Identity is the pair
`[PTAPP_NAME, PTAUTHSERVER]`. The panel displays authorization server,
application type, grant, client ID, issuer, endpoints, scope, audiences,
certificate alias, registration state ID and application role names. Translate
labels come from the connected environment's effective-dated `PSXLATITEM` rows.

Public settings come from `PSPTSEC_TOKEN`, secondary audiences from
`PSPTSEC_AUD`, and role names from `PSPTSEC_ROLES`. Role assignments are keyed
by application name, without an authorization-server key.

On **Oracle / PeopleTools 8.62.09**, existing **CUSTOM / Client Only / Client
Credentials** applications support editing Client ID, Issuer, Token Endpoint
and Scope URL. Preview validates and rolls back. Save requires Writable access,
a configured existing Operator ID, the configured write-name prefix, an
unchanged opened configuration and confirmation. The writer locks the parent
row, updates only those public fields, verifies before commit, and reads back
on another connection after commit. No version or operator stamps are invented:
the native saves changed no `PSVERSION` counters and this table has no native
last-update/operator columns.

Other application types and grants are available for inspection. Application
creation, deletion, role/audience changes, grant/type changes, credential
management, token retrieval and token cleanup remain in PIA. Use PeopleTools >
Security > OAuth2 Administration. Delivered `PTOICS.SavePreChange` calls
`PTPSSEC_WRK.PTCLIENT_SECRET_IN.FieldFormula`, which uses
`%IntBroker.EncryptToken`; Studio does not substitute its own encryption.

Client secrets, access/refresh tokens and private keys are never selected by the
reader or writer. The concurrency token covers public configuration, audiences
and role names; credential rotation is outside that token and is preserved by
these partial updates. Token endpoints must be HTTPS without embedded
credentials or URL fragments.

## SAML release boundary

**PeopleTools 8.63 adds the SAML 2.0 browser sign-on configuration described by
Oracle's Identity Provider, Service Provider and Provider Links guides.** That
configuration is not implemented in Studio and must not be inferred from 8.62
inbound web-service tables.

The SAML panel currently inspects the older **Inbound SAML Setup** in
`PS_PTWSSINBSAML`. Its identity has four parts: certificate alias, issuer,
subject and qualifier. It displays the mapped PeopleSoft user, active flag,
description and update metadata. It does not read certificate bodies or keys,
and it does not create/edit mappings or configure browser SSO.

References:

- [Oracle 8.62 Security Administration](https://docs.oracle.com/cd/G23955_01/psft/pdf/pt862tsec-b042025.pdf), Configuring the SAML Inbound Setup.
- [Oracle 8.63 SAML 2.0 environment setup](https://docs.oracle.com/en/applications/peoplesoft/peopletools/8.63/security-administration/setting-peoplesoft-environment-use-saml-2-0.html).
- [Oracle service application configuration](https://docs.oracle.com/en/applications/peoplesoft/peopletools/8.63/security-administration/configuring-service-applications.html); local record/component evidence governs Studio's 8.62 implementation.

## MCP

- `psft_security_list`: connection, kind (`oauth`/`saml`), query, offset.
- `psft_security_get`: connection, kind, full key; public configuration,
  related rows, concurrency token and diagnostics.
- `psft_security_reference`: installed OAuth code labels and SAML boundaries.
- `psft_oauth_save`: connection, OAuth key, expectedToken, changes, optional
  dryRun. Only `PTCLIENT_ID`, `PTISS`, `PTTOKENURL`, `PTSCOPE_URL` are accepted.

MCP uses its off/confirm/allow gate and refuses writes while the OAuth panel has
unsaved changes. Dry runs use write-access gates and roll back without asking
for approval. Actual saves use the standard MCP approval flow.

## Evidence and validation

`src/test/fixtures/security-8.62.09/oauth-native.json` contains sanitized native
PIA creation/edit snapshots for the inert `ZZ_STUDIO_OAUTH_01` fixture. It has a
synthetic client and an `example.invalid` endpoint. Only its four public fields
changed; cache counters did not. No encrypted credential material is retained.

`tools/lab/security-e2e.mts` verifies live readers, installed code labels,
preview rollback, stale-token rejection, commit/readback, restoration, secret
preservation using a database digest comparison, and unchanged cache counters.
`tools/lab/security-mcp-e2e.mts` exercises the production HTTP MCP routes and
off/dirty/approval gates. Results are in `tools/lab/results/security*-e2e.json`.
No PeopleCode encoder or decoder changes are included.
