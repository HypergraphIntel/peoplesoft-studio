import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { decideWrite, OWNERSHIP_LABELS } from '../model/ownership.js';
import { DatabaseProvider } from '../providers/database.js';
import { effectivePolicy } from '../providers/writeGuard.js';
import { Workspace } from '../workspace.js';
import { jsonResult, keyFromInput, requireProvider } from './tools.js';
import { READ_ONLY } from './writeTools.js';

/*
 * Customization Intelligence through the MCP (docs/CUSTOMIZATION.md): the
 * effective policy, and who owns a definition with the evidence -- the same
 * classification the write guard applies to every write, whichever tool makes
 * it. Read only.
 */

export function registerCustomizationTools(server: McpServer, workspace: Workspace): void {
  server.registerTool('psft_customization_get_policy', {
    title: 'Customization: the effective policy',
    description: 'The customization policy in force: the naming prefixes (the organization\'s, and each bolt-on vendor\'s), the preferred strategy, and the ' +
      'delivered-object policies every write passes (block, requireApproval, allowWithAudit): agentDeliveredObjectPolicy for writes through the MCP, ' +
      'deliveredObjectPolicy for the user\'s own in the editors. Writes to Oracle- or vendor-delivered definitions, and to definitions of unknown ' +
      'ownership, follow the agent policy whichever write tool is used; an agent cannot approve them -- the user does, in VS Code.',
    inputSchema: z.object({}),
    annotations: READ_ONLY
  }, async () => jsonResult(effectivePolicy()));

  server.registerTool('psft_object_classify', {
    title: 'Customization: who owns a definition',
    description: 'Classifies a definition as DELIVERED (Oracle\'s, never saved locally), DELIVERED_MODIFIED (Oracle\'s, re-saved locally), PARTNER (a bolt-on ' +
      'vendor\'s), CUSTOM (the organization\'s) or UNKNOWN, with a confidence and the evidence: the definition\'s stamp (PPLSOFT = Oracle), an ' +
      'Oracle-delivered project listing it, the delivered baseline of this release when one was captured, the naming prefixes. Also what the ' +
      'delivered-object policy for agents would do with a write to it. A PeopleCode program not stored yet is judged by the definition it belongs to. ' +
      'Key as psft_get_definition takes it (type code and parts).',
    inputSchema: z.object({ connection: z.string().min(1), type: z.number().int(), parts: z.array(z.string()).min(1) }),
    annotations: READ_ONLY
  }, async ({ connection, type, parts }) => {
    const p = await requireProvider(workspace, connection);
    if (!(p instanceof DatabaseProvider)) throw new Error(`${p.displayName} is a project export; definitions are classified on a database connection.`);
    const policy = effectivePolicy();
    const key = keyFromInput(type, parts);
    const r = await p.classifyDefinition(key, policy.prefixes);
    // An agent asks: the agent policy is the one its writes meet.
    const decision = decideWrite(r.classification, policy.agentDeliveredObjectPolicy, r.evidence.exists);
    return jsonResult({
      ownership: r.classification.ownership, label: OWNERSHIP_LABELS[r.classification.ownership], confidence: r.classification.confidence,
      evidence: r.classification.evidence, stored: r.evidence.exists,
      release: r.release, baselineApplied: !!r.evidence.baseline,
      writePolicy: { setting: 'peoplesoft.customization.agentDeliveredObjectPolicy', policy: policy.agentDeliveredObjectPolicy, outcome: decision.action, reason: decision.reason }
    });
  });
}

