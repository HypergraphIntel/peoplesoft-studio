import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { answerCapability, findingInput, SUBSYSTEMS, type Finding } from '../intelligence/index.js';
import { intelligenceAccess } from '../intelligenceCommands.js';
import { DatabaseProvider } from '../providers/database.js';
import { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { READ_ONLY, WRITE, type McpWriteHost } from './writeTools.js';

/*
 * Discoveries and knowledge through the MCP (docs/intelligence/MCP_INTEGRATION.md,
 * phase 5): an agent can ask what PeopleSoft Studio knows about a capability --
 * verified (an installed, verified bundle), only observed, known not to hold,
 * conflicting or unknown, for the connection's PeopleTools release -- and see
 * the evidence. Knowledge is information: these tools change no write gate,
 * and an answer is never permission. psft_discovery_record records a finding
 * on this installation (never uploads it), with the user's approval.
 */

function access() {
  const a = intelligenceAccess();
  if (!a) throw new Error('The discovery engine is not available (the extension has not activated it).');
  return a;
}

async function allLocal(): Promise<Array<{ source: string; finding: Finding }>> {
  const out: Array<{ source: string; finding: Finding }> = [];
  for (const s of await access().sources()) {
    for (const summary of await s.store.list()) {
      const f = await s.store.get(summary.id);
      if (f) out.push({ source: s.label, finding: f });
    }
  }
  return out;
}

async function installedBundle() {
  const r = await (await access().knowledge()).current();
  return r?.ok ? r.bundle : undefined;
}

const question = {
  subsystem: z.enum(SUBSYSTEMS).optional(),
  objectType: z.string().max(64).optional().describe('The PeopleSoft object type, as findings name it (Page, Event Mapping configuration...).'),
  table: z.string().max(64).optional().describe('A PeopleTools table the claim concerns (PSPNLFIELD, PSPTCSSRVCONF...).'),
  kind: z.string().max(64).optional().describe('The assertion kind (column-mapping, row-resave, counter-step...).'),
  text: z.string().max(200).optional().describe('Words that must all appear in the title, statement or facts.')
};

export function registerDiscoveryTools(server: McpServer, workspace: Workspace, host: McpWriteHost | undefined): void {
  server.registerTool('psft_discovery_list', {
    title: 'Discoveries: list recorded findings',
    description: 'Findings PeopleSoft Studio has recorded about PeopleSoft internals -- on this installation and in the workspace\'s research store -- with ' +
      'their local status (observed, or reproduced by a second run), confidence and the PeopleTools releases they were observed on. Local findings are ' +
      'evidence, not verified knowledge. Read only.',
    inputSchema: z.object({ subsystem: z.enum(SUBSYSTEMS).optional(), release: z.string().max(16).optional(), text: z.string().max(200).optional() }),
    annotations: READ_ONLY
  }, async ({ subsystem, release, text }) => {
    const out = [];
    for (const s of await access().sources()) {
      for (const f of await s.store.list({ ...(subsystem ? { subsystem } : {}), ...(release ? { release } : {}), ...(text ? { text } : {}) })) out.push({ source: s.label, ...f });
    }
    return jsonResult({ findings: out, note: 'Local findings: observed or reproduced, never verified. psft_knowledge_capability judges them with verified knowledge.' });
  });

  server.registerTool('psft_discovery_get', {
    title: 'Discoveries: get a finding',
    description: 'A recorded finding in full: the claim (assertion), statement, observations with their methods, experiments, releases, deltas and test results. Read only.',
    inputSchema: z.object({ id: z.string().regex(/^f-[0-9a-f]{24}$/) }),
    annotations: READ_ONLY
  }, async ({ id }) => {
    for (const s of await access().sources()) {
      const f = await s.store.get(id);
      if (f) return jsonResult({ source: s.label, finding: f });
    }
    throw new Error(`No finding ${id} on this installation or in the workspace.`);
  });

  server.registerTool('psft_knowledge_capability', {
    title: 'Knowledge: is a capability verified?',
    description: 'What PeopleSoft Studio knows about a claim or capability, judged for a PeopleTools release: VERIFIED (published knowledge verified on it), ' +
      'UNSUPPORTED (known not to hold), CONFLICTING (both), UNVERIFIED (only observed locally), UNKNOWN (nothing). Give a connection to judge for its ' +
      'release (PSSTATUS), or a release. Returns every finding behind the answer with its source, status and scope. An answer is information, never ' +
      'permission: writes still pass every write gate, and a verified mapping is not a verified save workflow.',
    inputSchema: z.object({ ...question, connection: z.string().optional(), release: z.string().regex(/^\d\.\d{2}(\.\d{2})?$/).optional() }),
    annotations: READ_ONLY
  }, async ({ connection, release, ...q }) => {
    let rel = release;
    let releaseFrom = release ? 'given' : undefined;
    if (!rel && connection) {
      const p = await requireProvider(workspace, connection);
      if (p instanceof DatabaseProvider && p.isConnected) {
        rel = (await p.databaseRelease()).toolsRelease.trim() || undefined;
        releaseFrom = rel ? `${p.displayName} (PSSTATUS.TOOLSREL)` : undefined;
      }
    }
    const result = answerCapability({ ...q, ...(rel ? { release: rel } : {}) }, (await allLocal()).map((x) => x.finding), await installedBundle());
    return jsonResult({ ...result, ...(releaseFrom ? { releaseFrom } : {}) });
  });

  server.registerTool('psft_knowledge_compatibility', {
    title: 'Knowledge: where does a finding hold?',
    description: 'For a finding: the PeopleTools releases it is verified on (published knowledge), observed on (local evidence), known not to hold on, and whether ' +
      'published knowledge revoked it. Read only.',
    inputSchema: z.object({ id: z.string().regex(/^f-[0-9a-f]{24}$/) }),
    annotations: READ_ONLY
  }, async ({ id }) => {
    const bundle = await installedBundle();
    const published = bundle?.findings.find((k) => k.id === id);
    const local = (await allLocal()).find((x) => x.finding.id === id)?.finding;
    if (!published && !local) throw new Error(`No finding ${id} is known here.`);
    return jsonResult({
      id, revoked: !!bundle?.revoked.includes(id),
      verifiedOn: published?.verifiedReleases ?? [], observedOn: local?.compatibility.observedReleases ?? [],
      knownIncompatible: [...new Set([...(published?.knownIncompatible ?? []), ...(local?.compatibility.knownIncompatible ?? [])])].sort(),
      untestedNote: 'Any release not listed is untested: neither verified nor known to fail.',
      knowledgeInstalled: !!bundle
    });
  });

  server.registerTool('psft_knowledge_evidence', {
    title: 'Knowledge: the evidence behind a finding',
    description: 'The evidence for a finding: each observation\'s method, experiment, release, sanitized delta (tables and counters changed), test results ' +
      'and references; and, when published, its verified releases. Read only.',
    inputSchema: z.object({ id: z.string().regex(/^f-[0-9a-f]{24}$/) }),
    annotations: READ_ONLY
  }, async ({ id }) => {
    const bundle = await installedBundle();
    const published = bundle?.findings.find((k) => k.id === id);
    const local = (await allLocal()).find((x) => x.finding.id === id);
    if (!published && !local) throw new Error(`No finding ${id} is known here.`);
    return jsonResult({
      id, ...(published ? { published: { verifiedReleases: published.verifiedReleases, publishedAt: published.publishedAt } } : {}),
      ...(local ? {
        local: {
          source: local.source, status: local.finding.localStatus, confidence: local.finding.confidence,
          observations: local.finding.observations.map((o) => ({ method: o.method, experimentId: o.experimentId, runId: o.runId, release: o.environment.peopleToolsRelease,
            tool: o.environment.tool, observation: o.observation, delta: o.delta, testResults: o.testResults, evidence: o.evidence }))
        }
      } : {})
    });
  });

  server.registerTool('psft_discovery_record', {
    title: 'Discoveries: record a finding',
    description: 'Records a finding (psft-finding/1: type, subject, assertion, title, statement, confidence, one observation with its PeopleTools release) on ' +
      'this installation only -- nothing is uploaded. The schema is strict and a privacy scan refuses hosts, paths, addresses, credentials and data. ' +
      'Record what an experiment showed, not a guess; one observation is evidence, not a rule. Recorded as source mcp-agent, after the user approves.',
    inputSchema: z.object({ finding: z.record(z.string(), z.unknown()).describe('The finding input, without "source" (set to mcp-agent).') }),
    annotations: WRITE
  }, async ({ finding }) => {
    if (!host || host.mode() === 'off') throw new Error('Recording findings through the MCP needs MCP writes on (peoplesoft.mcp.writes).');
    const input = { ...finding, source: 'mcp-agent' };
    const parsed = findingInput.safeParse(input);
    if (!parsed.success) throw new Error(`Not a psft-finding/1 input: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('; ')}`);
    if (host.mode() !== 'allow') {
      const ok = await host.confirm({
        title: 'An AI agent wants to record a discovery on this installation.',
        detail: `${parsed.data.title}\n${parsed.data.type} · ${parsed.data.subject.subsystem} · PeopleTools ${parsed.data.observation.environment.peopleToolsRelease}\n\nRecorded locally only; nothing is uploaded.`
      });
      if (!ok) throw new Error('The user declined; nothing was recorded.');
    }
    const r = await (await access().installation()).record(input);
    access().refresh();
    return jsonResult({ outcome: r.outcome, id: r.finding.id, localStatus: r.finding.localStatus, observations: r.finding.observations.length });
  });
}
