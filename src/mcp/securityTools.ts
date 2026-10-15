import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { DatabaseProvider } from '../providers/database.js';
import type { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { hasUnsavedSecurity } from '../editors/securityPanel.js';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { READ_ONLY, WRITE, writable, approve, type McpWriteHost } from './writeTools.js';
import { SAML_BOUNDARY, securityDiagnostics } from '../model/security.js';
const kind = z.enum(['oauth', 'saml']);
export function registerSecurityTools(server: McpServer, workspace: Workspace, host?: McpWriteHost): void {
  server.registerTool('psft_security_list', {
    title: 'Search OAuth applications or inbound SAML mappings',
    description: 'Read-only configuration search. OAuth keys are [application name, authorization server]; SAML keys are [certificate alias, issuer, subject, qualifier]. SAML here is legacy inbound web-service mapping, not 8.63 browser SSO. Secrets and tokens are excluded.',
    inputSchema: z.object({ connection: z.string().min(1), kind, query: z.string().default(''), offset: z.number().int().min(0).default(0) }), annotations: READ_ONLY
  }, async ({ connection, kind, query, offset }) => {
    const p = await requireProvider(workspace, connection);
    if (!(p instanceof DatabaseProvider)) throw new Error('Security tools require a database connection.');
    return jsonResult(await p.listSecurity(kind, query, offset));
  });
  server.registerTool('psft_security_get', {
    title: 'Inspect OAuth application or inbound SAML mapping',
    description: 'Read public configuration, related audiences and role names, concurrency token and configuration diagnostics. Does not read client secrets, access/refresh tokens, certificate bodies or private keys; does not test authentication.',
    inputSchema: z.object({ connection: z.string().min(1), kind, key: z.array(z.string()).min(2).max(4) }), annotations: READ_ONLY
  }, async ({ connection, kind, key }) => {
    const p = await requireProvider(workspace, connection);
    if (!(p instanceof DatabaseProvider)) throw new Error('Security tools require a database connection.');
    const document = await p.readSecurity(kind, key);
    if (!document) throw new Error('Security configuration not found.');
    return jsonResult({ document, diagnostics: securityDiagnostics(document) });
  });
  server.registerTool('psft_security_reference', {
    title: 'OAuth and SAML configuration scope',
    description: 'Installed OAuth authorization-server, application-type, grant and scope choices, public configuration identities, and SAML release boundary.',
    inputSchema: z.object({ connection: z.string().min(1) }), annotations: READ_ONLY
  }, async ({ connection }) => {
    const p = await requireProvider(workspace, connection);
    if (!(p instanceof DatabaseProvider)) throw new Error('Security tools require a database connection.');
    return jsonResult({ choices: await p.securityChoices(), oauthKey: ['application name', 'authorization server'], samlKey: ['certificate alias', 'issuer', 'subject', 'qualifier'], samlBoundary: SAML_BOUNDARY,
      excluded: ['client secrets', 'access tokens', 'refresh tokens', 'private keys'], authenticationTested: false });
  });
  if (!host) return;
  server.registerTool('psft_oauth_save', {
    title: 'Edit existing OAuth public configuration',
    description: 'Calibrated Oracle PeopleTools 8.62.09 edit for existing CUSTOM / Client Only / Client Credentials applications. Updates only client ID, issuer, token endpoint and scope URL; preserves secrets, registration state, roles, audiences and tokens. Read psft_security_get first; supply its token. dryRun validates and rolls back. No token retrieval or application creation.',
    inputSchema: z.object({ connection: z.string().min(1), key: z.tuple([z.string().min(1), z.string().min(1)]), expectedToken: z.string().min(1), changes: z.object({ PTCLIENT_ID: z.string().optional(), PTISS: z.string().optional(), PTTOKENURL: z.string().optional(), PTSCOPE_URL: z.string().optional() }).strict(), dryRun: z.boolean().default(false) }), annotations: WRITE
  }, async ({ connection, key, expectedToken, changes, dryRun }) => {
    const gate = await writable(workspace, host, connection, key[0]);
    if (hasUnsavedSecurity(gate.provider.id)) throw new Error('OAuth editor has unsaved edits. Save or discard them first.');
    const definitionKey = makeKey(DefinitionType.Record, 'PSPTSEC_TOKEN');
    if (!dryRun) await approve(host, gate, definitionKey, 'edit OAuth application ' + key.join(' / '), JSON.stringify(changes, null, 2));
    const document = await gate.provider.saveOAuth({ key, expectedToken, changes, dryRun, operatorId: gate.operatorId });
    return jsonResult({ saved: !dryRun, dryRun, document, diagnostics: securityDiagnostics(document) });
  });
}
