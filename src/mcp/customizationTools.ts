import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { decideWrite, OWNERSHIP_LABELS } from '../model/ownership.js';
import { describeMapping, EVENT_LEVEL_LABELS, eventLabel, PROCESSING_LABELS, type EventLevel } from '../model/eventMapping.js';
import { describeSequence, PFC_APPLY_TO_LABELS, PFC_CONFIG_TYPE_LABELS } from '../model/pageFieldConfigurator.js';
import { CS_SEARCH_TYPE_LABELS, describeCsConfiguration } from '../model/configurableSearch.js';
import { DatabaseProvider } from '../providers/database.js';
import { knowledgeFor } from '../intelligenceCommands.js';
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

  server.registerTool('psft_customization_discover', {
    title: 'Customization: which configuration frameworks could extend a definition',
    description: 'Discovers, on this database, whether supported configuration frameworks can extend a definition without changing it. Event Mapping ' +
      '(application class PeopleCode run at component, record, field and page events): VERIFIED_AVAILABLE when the component -- a page\'s or record\'s ' +
      'components -- is registered as a content reference, VERIFIED_UNAVAILABLE when not, with the evidence and the configurations already there ' +
      '(level, event, service and its application class, processing sequence, sequence, enabled, who saved them). Drop Zones (custom subpages ' +
      'inserted into a page\'s drop zones): VERIFIED_AVAILABLE when the component\'s pages -- or the page, with its subpages and secondary pages -- have ' +
      'drop zones, each with its page, label, key and any configured subpage; VERIFIED_UNAVAILABLE when none. Page and Field Configurator: ' +
      'VERIFIED_AVAILABLE when the component is registered (it applies through Event Mapping), with its configurations, what each sequence ' +
      'changes, and on which content references the EOCC Event Mapping applies them; VERIFIED_UNAVAILABLE when not registered or not installed. ' +
      'Configurable Search is discovered (read only: its configurations, not yet written); AE plug-ins are not discovered yet (UNKNOWN). Read only.',
    inputSchema: z.object({ connection: z.string().min(1), type: z.number().int(), parts: z.array(z.string()).min(1) }),
    annotations: READ_ONLY
  }, async ({ connection, type, parts }) => {
    const p = await requireProvider(workspace, connection);
    if (!(p instanceof DatabaseProvider)) throw new Error(`${p.displayName} is a project export; capabilities are discovered on a database connection.`);
    const r = await p.discoverCapabilities(keyFromInput(type, parts));
    const em = r.eventMapping;
    return jsonResult({
      eventMapping: em ? {
        state: em.state, evidence: em.evidence, contentReferences: em.contentReferences, services: em.services,
        configurations: em.mappings.map((m) => ({
          summary: describeMapping(m), contentReference: m.contentReference, level: EVENT_LEVEL_LABELS[m.level as EventLevel] ?? m.level,
          page: m.page, record: m.record, field: m.field, event: eventLabel(m), service: m.serviceId, applicationClass: m.applicationClass,
          processing: PROCESSING_LABELS[m.processing] ?? m.processing, sequence: m.sequence, enabled: m.enabled, savedBy: m.operator, savedAt: m.updated
        }))
      } : { state: 'NOT_APPLICABLE', evidence: ['Event Mapping maps components\' events: it applies to components, pages, records and their PeopleCode.'] },
      ...(em ? { knowledge: await knowledgeFor({ subsystem: 'event-mapping' }, p).then((k) => k ?? { answer: 'UNKNOWN', findings: [] }).catch(() => ({ answer: 'UNKNOWN', findings: [] })),
        knowledgeNote: 'What recorded findings say about Event Mapping on this connection\'s release (psft_knowledge_capability for details): information, never permission.' } : {}),
      dropZones: r.dropZones ? {
        state: r.dropZones.state, evidence: r.dropZones.evidence, stubSubpage: r.dropZones.stubSubpage,
        dropZones: r.dropZones.dropZones.map((z) => ({
          label: z.label, component: z.component ? `${z.component}.${z.market}` : undefined, page: z.page, definedOn: z.container,
          groupBoxId: z.groupBoxId, tabOrder: z.tabOrder, recordField: z.record ? `${z.record}.${z.field}` : undefined,
          key: z.fieldName, configuredSubpage: z.subpage ?? null
        }))
      } : { state: 'NOT_APPLICABLE', evidence: ['Drop Zones are on pages: they apply to components, pages and their PeopleCode.'] },
      pageFieldConfigurator: r.pageFieldConfigurator ? {
        state: r.pageFieldConfigurator.state, evidence: r.pageFieldConfigurator.evidence, contentReferences: r.pageFieldConfigurator.contentReferences,
        appliedOn: r.pageFieldConfigurator.appliedOn,
        configurations: r.pageFieldConfigurator.configurations.map((c) => ({
          component: `${c.component}.${c.market}`, type: PFC_CONFIG_TYPE_LABELS[c.type] ?? c.type, description: c.description, active: c.active,
          sequences: c.sequences.map((s) => ({ ...s, summary: describeSequence(s), applyToLabel: PFC_APPLY_TO_LABELS[s.applyTo] ?? s.applyTo }))
        }))
      } : { state: 'NOT_APPLICABLE', evidence: ['Page and Field Configurator configures components (and their pages).'] },
      configurableSearch: r.configurableSearch ? {
        state: r.configurableSearch.state, evidence: r.configurableSearch.evidence, contentReferences: r.configurableSearch.contentReferences,
        configurations: r.configurableSearch.configurations.map((c) => ({ ...c, typeLabel: CS_SEARCH_TYPE_LABELS[c.type] ?? c.type, summary: describeCsConfiguration(c) }))
      } : { state: 'NOT_APPLICABLE', evidence: ['Configurable Search configures a component\'s search page (components and their pages).'] },
      notDiscoveredYet: ['App Engine Plug-ins']
    });
  });
}
