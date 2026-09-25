import {
  McpServer
} from '@modelcontextprotocol/server';

import * as z from 'zod/v4';

import {
  DefinitionKey,
  DefinitionType,
  displayName,
  typeLabel
} from '../model/definitions.js';

import {
  Workspace,
  providerId
} from '../workspace.js';

import type {
  DefinitionProvider,
  DefinitionSummary
} from '../providers/provider.js';

import type {
  McpConnectionDescriptor,
  McpDefinitionDescriptor
} from './types.js';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function definitionDescriptor(
  summary: DefinitionSummary
): McpDefinitionDescriptor {
  return {
    key: summary.key,
    displayName:
      displayName(summary.key),
    typeLabel:
      typeLabel(summary.key.type),
    description:
      summary.description,
    lastUpdated:
      summary.lastUpdated?.toISOString(),
    lastUpdatedBy:
      summary.lastUpdatedBy
  };
}

function resolveConnectionId(
  workspace: Workspace,
  connection: string
): string {
  const requested =
    connection.trim();

  const exactId =
    workspace.connections.find(
      config =>
        providerId(config) ===
        requested
    );

  if (exactId) {
    return providerId(exactId);
  }

  const byName =
    workspace.connections.find(
      config =>
        config.name.localeCompare(
          requested,
          undefined,
          {
            sensitivity: 'accent'
          }
        ) === 0
    );

  if (byName) {
    return providerId(byName);
  }

  const active =
    workspace.activeProviders.find(
      provider =>
        provider.id === requested ||
        provider.displayName.localeCompare(
          requested,
          undefined,
          {
            sensitivity: 'accent'
          }
        ) === 0
    );

  if (active) {
    return active.id;
  }

  throw new Error(
    `No PeopleSoft connection matches "${connection}". ` +
    'Call psft_list_connections first.'
  );
}

async function requireProvider(
  workspace: Workspace,
  connection: string
): Promise<DefinitionProvider> {
  return workspace.require(
    resolveConnectionId(
      workspace,
      connection
    )
  );
}

function keyFromInput(
  type: number,
  parts: string[]
): DefinitionKey {
  return {
    type:
      type as DefinitionType,
    parts:
      parts.map(
        part => part.trim()
      )
  };
}

export function registerPeopleSoftTools(
  server: McpServer,
  workspace: Workspace
): void {
  server.registerTool(
    'psft_list_connections',
    {
      title:
        'List PeopleSoft Studio connections',
      description:
        'List the PeopleSoft environments and project exports configured in ' +
        'PeopleSoft Studio. Use this before other psft_* tools when the ' +
        'connection name is unknown.',
      annotations:
        READ_ONLY
    },
    async () => {
      const connected =
        new Set(
          workspace.activeProviders
            .filter(
              provider =>
                provider.isConnected
            )
            .map(
              provider =>
                provider.id
            )
        );

      const connections:
        McpConnectionDescriptor[] =
        workspace.connections.map(
          config => {
            const id =
              providerId(config);

            return {
              id,
              name:
                config.name,
              kind:
                config.kind,
              connected:
                connected.has(id),
              selected:
                workspace.selectedConnectionId ===
                id
            };
          }
        );

      return jsonResult({
        connections
      });
    }
  );

  server.registerTool(
    'psft_search_definitions',
    {
      title:
        'Search PeopleSoft definitions',
      description:
        'Search definitions in a configured PeopleSoft Studio connection. ' +
        'The type is a PeopleTools OBJECTTYPE code. Omit type to let the ' +
        'provider use its normal search behavior. namePattern supports the ' +
        'same % and _ wildcards as PeopleSoft Studio search.',
      inputSchema:
        z.object({
          connection:
            z.string().min(1),
          type:
            z.number()
              .int()
              .optional(),
          namePattern:
            z.string()
              .optional(),
          limit:
            z.number()
              .int()
              .min(1)
              .max(500)
              .optional()
        }),
      annotations:
        READ_ONLY
    },
    async ({
      connection,
      type,
      namePattern,
      limit
    }) => {
      const provider =
        await requireProvider(
          workspace,
          connection
        );

      const results =
        await provider.search({
          type:
            type === undefined
              ? undefined
              : type as DefinitionType,
          namePattern,
          limit:
            limit ?? 50
        });

      return jsonResult({
        connection: {
          id:
            provider.id,
          name:
            provider.displayName
        },
        count:
          results.length,
        definitions:
          results.map(
            definitionDescriptor
          )
      });
    }
  );

  server.registerTool(
    'psft_get_definition',
    {
      title:
        'Read a PeopleSoft definition',
      description:
        'Read the live definition payload through the same PeopleSoft Studio ' +
        'provider used by the VS Code extension. For text-backed definitions ' +
        'such as PeopleCode, SQL, and HTML, returns the source text. Records ' +
        'are returned as structured record metadata.',
      inputSchema:
        z.object({
          connection:
            z.string().min(1),
          type:
            z.number().int(),
          parts:
            z.array(
              z.string()
            ).min(1)
        }),
      annotations:
        READ_ONLY
    },
    async ({
      connection,
      type,
      parts
    }) => {
      const provider =
        await requireProvider(
          workspace,
          connection
        );

      const key =
        keyFromInput(
          type,
          parts
        );

      if (
        provider.canReadAsText(
          key.type
        )
      ) {
        const text =
          await provider.readText(
            key
          );

        return jsonResult({
          connection: {
            id:
              provider.id,
            name:
              provider.displayName
          },
          definition: {
            key,
            displayName:
              displayName(key),
            typeLabel:
              typeLabel(key.type),
            kind:
              'text',
            text
          }
        });
      }

      if (
        key.type ===
        DefinitionType.Record
      ) {
        const record =
          await provider.readRecord(
            key
          );

        return jsonResult({
          connection: {
            id:
              provider.id,
            name:
              provider.displayName
          },
          definition: {
            key,
            displayName:
              displayName(key),
            typeLabel:
              typeLabel(key.type),
            kind:
              'record',
            record
          }
        });
      }

      throw new Error(
        `${provider.displayName} cannot read ` +
        `${typeLabel(key.type)} as text or record metadata.`
      );
    }
  );

  server.registerTool(
    'psft_list_children',
    {
      title:
        'List child PeopleSoft definitions',
      description:
        'List definitions nested beneath another definition, such as fields ' +
        'under a record or pages under a component.',
      inputSchema:
        z.object({
          connection:
            z.string().min(1),
          type:
            z.number().int(),
          parts:
            z.array(
              z.string()
            ).min(1)
        }),
      annotations:
        READ_ONLY
    },
    async ({
      connection,
      type,
      parts
    }) => {
      const provider =
        await requireProvider(
          workspace,
          connection
        );

      const key =
        keyFromInput(
          type,
          parts
        );

      const children =
        await provider.listChildren(
          key
        );

      return jsonResult({
        parent: {
          key,
          displayName:
            displayName(key),
          typeLabel:
            typeLabel(key.type)
        },
        count:
          children.length,
        children:
          children.map(
            definitionDescriptor
          )
      });
    }
  );

  server.registerTool(
    'psft_list_project_items',
    {
      title:
        'List PeopleSoft project items',
      description:
        'List the definitions contained in a PeopleSoft project through a ' +
        'configured PeopleSoft Studio connection.',
      inputSchema:
        z.object({
          connection:
            z.string().min(1),
          project:
            z.string().min(1)
        }),
      annotations:
        READ_ONLY
    },
    async ({
      connection,
      project
    }) => {
      const provider =
        await requireProvider(
          workspace,
          connection
        );

      const items =
        await provider.listProjectItems(
          project
        );

      return jsonResult({
        connection: {
          id:
            provider.id,
          name:
            provider.displayName
        },
        project,
        count:
          items.length,
        items:
          items.map(
            definitionDescriptor
          )
      });
    }
  );
}
