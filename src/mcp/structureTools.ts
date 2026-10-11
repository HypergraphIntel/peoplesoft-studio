import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { SCROLLS_GUIDE } from '../model/bufferStructure.js';
import { DatabaseProvider } from '../providers/database.js';
import type { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';

/*
 * The MCP's read tools for how pages, scrolls, record keys, components and PeopleCode fit together: a page's scroll
 * structure (levels from the tab order, App Designer's checks), a component's buffer (search record, scroll levels,
 * primary records and their keys, PeopleCode paths), and the guide to the rules behind them (bufferStructure.ts).
 */

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

async function database(workspace: Workspace, connection: string): Promise<DatabaseProvider> {
  const provider = await requireProvider(workspace, connection);
  if (!(provider instanceof DatabaseProvider)) throw new Error(`${provider.displayName} is not a database connection.`);
  return provider;
}

export function registerStructureTools(server: McpServer, workspace: Workspace): void {
  server.registerTool('psft_explain_scrolls', {
    title: 'How scrolls, component buffers and PeopleCode navigation work',
    description:
      'The rules for PeopleSoft scroll levels: how a page\'s tab order (Order tab) sets each control\'s level (Scroll Area / Scroll Bar / ' +
      'Grid and Horizontal Rule Set to Level), App Designer\'s page checks, how records are keyed for each level, how a component\'s buffer ' +
      'is built from its pages, and how PeopleCode reaches rowsets, rows, records and fields (GetLevel0, GetRowset(Scroll.X), scroll paths ' +
      'in built-in functions). Read it before building or changing a page with scrolls or writing PeopleCode that walks a component.',
    inputSchema: z.object({}),
    annotations: READ_ONLY
  }, async () => ({ content: [{ type: 'text' as const, text: SCROLLS_GUIDE }] }));

  server.registerTool('psft_get_page_structure', {
    title: 'Read a page\'s scroll structure',
    description:
      'A page\'s controls in tab order with each one\'s scroll level and scroll (by control id), its scrolls as a tree -- each with its ' +
      'level, primary record (the rowset), that record\'s keys split into parentKeys (shared with the levels above) and rowKeys, the ' +
      'records and fields in it, and the PeopleCode that reaches it -- and App Designer\'s save checks on it (Message Set 15: No data for ' +
      'scroll, More than one data record in scroll, Invalid field level, Invalid related display). psft_explain_scrolls has the rules.',
    inputSchema: z.object({ connection: z.string().min(1), page: z.string().min(1) }),
    annotations: READ_ONLY
  }, async ({ connection, page }) => jsonResult(await (await database(workspace, connection)).readPageStructure(page)));

  server.registerTool('psft_get_component_structure', {
    title: 'Read a component\'s buffer structure',
    description:
      'A component\'s buffer, as App Designer\'s Structure tab builds it from its pages: the search record and its keys, the level-0 ' +
      'records, and each scroll level below with its primary record (Scroll.<record> in PeopleCode), its keys (parentKeys select its rows ' +
      'for each parent row; rowKeys tell them apart), every record in its rows with the fields on the pages, the PeopleCode object path ' +
      'and built-in scroll paths that reach it, and notes on its keying. psft_explain_scrolls has the rules.',
    inputSchema: z.object({ connection: z.string().min(1), component: z.string().min(1), market: z.string().optional().describe('Market; GBL when omitted.') }),
    annotations: READ_ONLY
  }, async ({ connection, component, market }) => jsonResult(await (await database(workspace, connection)).readComponentBuffer(component, market ?? 'GBL')));
}
