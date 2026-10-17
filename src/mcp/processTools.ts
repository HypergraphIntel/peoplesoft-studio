import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { PROCESS_FIELDS, processEdit, processToken, validateProcessEdit } from '../model/processEdit.js';
import type { ProcessView } from '../model/processDefinition.js';
import { DatabaseProvider } from '../providers/database.js';
import type { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { READ_ONLY, WRITE, GATES, writable, approve, type McpWriteHost } from './writeTools.js';

const identity = { connection: z.string().min(1), processType: z.string().min(1), name: z.string().min(1) };
function document(view: ProcessView) {
  return { process: view.process, input: processEdit(view), token: processToken(view),
    choices: Object.fromEntries([...view.translates].map(([field, values]) => [field, Object.fromEntries(values)])) };
}

export function registerProcessTools(server: McpServer, workspace: Workspace, host?: McpWriteHost): void {
  server.registerTool('psft_process_reference', {
    title: 'Process Definition editing reference',
    description: 'Read before editing Process Definitions: editable fields, key, token, native save boundaries and preview semantics. Does not schedule or run a process.',
    inputSchema: z.object({}), annotations: READ_ONLY
  }, async () => jsonResult({ key: ['process type', 'process name'], fields: PROCESS_FIELDS,
    workflow: 'Find type 20 with psft_search_definitions, read psft_process_get, edit its input, preview with dryRun, then save with the original token. Read back after saving.',
    limits: ['Edit existing definitions on Oracle; psft_process_create adds new ones as the PRCSDEFN component\'s Add mode does. No copy, rename, delete, schedule or execution.', 'Supply the complete input; omitted components/groups are removed.', 'Choices are installed PSXLATITEM values returned by get. Reference and server/category checks run in the shared writer.', 'dryRun uses the same transactional save and verification, then rolls back. Its returned token is hypothetical; keep the original token for the actual save.'],
    evidence: ['docs/PROCESS_DEFINITIONS.md', 'src/providers/processWriter.ts'] }));

  server.registerTool('psft_process_get', {
    title: 'Read a Process Definition for editing',
    description: 'Read stored properties, complete editable input, component and process-group associations, installed choice labels and concurrency token. The key is processType plus name.',
    inputSchema: z.object(identity).strict(), annotations: READ_ONLY
  }, async ({ connection, processType, name }) => {
    const provider = await requireProvider(workspace, connection);
    if (!(provider instanceof DatabaseProvider)) throw new Error('Process tools require a database connection.');
    return jsonResult(document(await provider.readProcessDocument(makeKey(DefinitionType.ProcessDefinition, processType, name))));
  });

  if (!host) return;
  server.registerTool('psft_process_save', {
    title: 'Preview or save an existing Process Definition',
    description: 'Edit the complete input returned by psft_process_get, supplying its expectedToken. Uses the editor writer: native counters, reference validation, stale-token refusal and readback verification. dryRun rolls back all changes and needs no save approval. Does not schedule or run the process. ' + GATES,
    inputSchema: z.object({ ...identity, expectedToken: z.string().min(1), input: z.object({
      properties: z.record(z.string(), z.string()), components: z.array(z.string()), groups: z.array(z.string())
    }).strict(), dryRun: z.boolean().default(false) }).strict(), annotations: WRITE
  }, async ({ connection, processType, name, expectedToken, input, dryRun }) => {
    const gate = await writable(workspace, host, connection, name);
    const key = makeKey(DefinitionType.ProcessDefinition, processType, name);
    if (host.hasUnsavedEditor(gate.provider.id, key)) throw new Error('Process editor has unsaved changes. Save or revert them first.');
    const current = await gate.provider.readProcessDocument(key);
    if (processToken(current) !== expectedToken) throw new Error('Process definition changed since it was read. Reload before saving.');
    validateProcessEdit(input, current);
    if (!dryRun) await approve(host, gate, key, 'edit Process Definition ' + processType + ' / ' + name, JSON.stringify(input, null, 2));
    const view = await gate.provider.saveProcessDocument({ key: [processType, name], token: expectedToken, edit: input, operatorId: gate.operatorId, dryRun });
    if (!dryRun) host.saved(gate.provider.id, key);
    return jsonResult({ saved: !dryRun, dryRun, ...document(view) });
  });

  server.registerTool('psft_process_create', {
    title: 'Create a Process Definition',
    description: 'Add a Process Definition as PeopleTools > Process Scheduler > Processes in Add mode does: the record\'s defaults (priority Medium, run location ' +
      'Server, API aware, log request, output Any/User Specified, category Default), the description defaulting to the name, then the given properties, ' +
      'components (the run control components it runs from) and process groups -- at least one, as the page requires -- saved with the same writer as ' +
      'psft_process_save (PPC/SYS counters, reference checks, readback). The name is the App Engine program name for an Application Engine process. ' +
      'dryRun rolls everything back. Security: the process groups must be in a permission list\'s Process Group Permissions for users to run it. ' + GATES,
    inputSchema: z.object({ ...identity,
      properties: z.record(z.string(), z.string()).default({}).describe('Fields as psft_process_reference lists them (DESCR, PRCSPRIORITY ...); omitted ones take the Add-mode defaults.'),
      components: z.array(z.string()).default([]).describe('Components (PNLGRPNAME) whose run control pages run it.'),
      groups: z.array(z.string()).min(1).describe('Process groups (PRCSGRP); at least one.'),
      dryRun: z.boolean().default(false) }).strict(), annotations: WRITE
  }, async ({ connection, processType, name, properties, components, groups, dryRun }) => {
    const prcsName = name.trim().toUpperCase();
    const gate = await writable(workspace, host, connection, prcsName);
    const key = makeKey(DefinitionType.ProcessDefinition, processType.trim(), prcsName);
    const known = new Set(PROCESS_FIELDS.map((f) => f.name));
    const unknown = Object.keys(properties).filter((k) => !known.has(k));
    if (unknown.length) throw new Error(`Not a process definition property: ${unknown.join(', ')} (psft_process_reference lists them).`);
    if (!dryRun) await approve(host, gate, key, 'create Process Definition ' + processType + ' / ' + prcsName,
      JSON.stringify({ properties, components, groups }, null, 2));
    const view = await gate.provider.createProcessDocument({ processType, name: prcsName, properties, components, groups, operatorId: gate.operatorId, dryRun });
    if (!dryRun) host.saved(gate.provider.id, key);
    return jsonResult({ created: !dryRun, dryRun, ...document(view) });
  });
}
