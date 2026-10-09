import {
  McpServer
} from '@modelcontextprotocol/server';

import * as z from 'zod/v4';

import {
  DefinitionKey,
  DefinitionType,
  PEOPLECODE_TYPES,
  displayName,
  isPeopleCode,
  typeLabel
} from '../model/definitions.js';

import {
  Workspace,
  providerId
} from '../workspace.js';

import {
  UnsupportedOperationError
} from '../providers/provider.js';

import type {
  DefinitionProvider,
  DefinitionSummary
} from '../providers/provider.js';

import {
  imageMimeType,
  sniffImageMimeType
} from '../editors/imageHtml.js';

import {
  DEFINITION_TYPE_GUIDE,
  typeCodeSummary
} from './definitionTypes.js';

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

const PEOPLECODE_TYPE_VALUES =
  [...PEOPLECODE_TYPES];

/** Image types an MCP client can be handed as an image. */
const MCP_IMAGE_TYPES =
  new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
  ]);

/** Larger images are described, not sent. */
const MCP_IMAGE_MAXIMUM_BYTES =
  1024 * 1024;

const TYPE_CODES =
  'Types: ' +
  typeCodeSummary() +
  '. psft_list_definition_types gives the key parts each type takes.';

export function jsonResult(value: unknown) {
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

export async function requireProvider(
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

export function keyFromInput(
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

function equalsIgnoreCase(
  left: string | undefined,
  right: string | undefined
): boolean {
  if (
    left === undefined ||
    right === undefined
  ) {
    return false;
  }

  return (
    left.localeCompare(
      right,
      undefined,
      {
        sensitivity: 'accent'
      }
    ) === 0
  );
}

function containsPart(
  key: DefinitionKey,
  value: string
): boolean {
  return key.parts.some(
    part =>
      equalsIgnoreCase(
        part,
        value
      )
  );
}

function startsWithParts(
  key: DefinitionKey,
  parts: readonly string[]
): boolean {
  if (
    key.parts.length <
    parts.length
  ) {
    return false;
  }

  return parts.every(
    (part, index) =>
      equalsIgnoreCase(
        key.parts[index],
        part
      )
  );
}

async function readPeopleCodeResults(
  provider: DefinitionProvider,
  summaries: DefinitionSummary[],
  maximum = 100
): Promise<Array<{
  key: DefinitionKey;
  displayName: string;
  typeLabel: string;
  source: string;
}>> {
  const result: Array<{
    key: DefinitionKey;
    displayName: string;
    typeLabel: string;
    source: string;
  }> = [];

  for (
    const summary
    of summaries.slice(
      0,
      maximum
    )
  ) {
    if (
      !isPeopleCode(
        summary.key.type
      ) ||
      !provider.canReadAsText(
        summary.key.type
      )
    ) {
      continue;
    }

    const source =
      await provider.readText(
        summary.key
      );

    result.push({
      key:
        summary.key,
      displayName:
        displayName(
          summary.key
        ),
      typeLabel:
        typeLabel(
          summary.key.type
        ),
      source
    });
  }

  return result;
}

function sourceMatches(
  source: string,
  symbol: string,
  caseSensitive: boolean
): Array<{
  line: number;
  column: number;
  context: string;
}> {
  const haystack =
    caseSensitive
      ? source
      : source.toLocaleLowerCase();

  const needle =
    caseSensitive
      ? symbol
      : symbol.toLocaleLowerCase();

  const matches: Array<{
    line: number;
    column: number;
    context: string;
  }> = [];

  let offset = 0;

  while (
    matches.length < 5
  ) {
    const found =
      haystack.indexOf(
        needle,
        offset
      );

    if (found < 0) {
      break;
    }

    const before =
      source.slice(
        0,
        found
      );

    const line =
      before.split(
        '\n'
      ).length;

    const lineStart =
      source.lastIndexOf(
        '\n',
        found - 1
      ) + 1;

    const lineEndRaw =
      source.indexOf(
        '\n',
        found
      );

    const lineEnd =
      lineEndRaw < 0
        ? source.length
        : lineEndRaw;

    matches.push({
      line,
      column:
        found - lineStart + 1,
      context:
        source
          .slice(
            lineStart,
            lineEnd
          )
          .trimEnd()
    });

    offset =
      found +
      Math.max(
        needle.length,
        1
      );
  }

  return matches;
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
    'psft_list_definition_types',
    {
      title:
        'List PeopleSoft definition types',
      description:
        'List the definition types the psft_* tools take: each OBJECTTYPE ' +
        'code, its name, the key parts psft_get_definition expects for it ' +
        '(in order), and whether a database connection can search it.',
      annotations:
        READ_ONLY
    },
    async () => jsonResult({
      types:
        DEFINITION_TYPE_GUIDE.map(
          guide => ({
            type:
              guide.type,
            typeLabel:
              typeLabel(guide.type),
            keyParts:
              guide.keyParts,
            databaseSearch:
              guide.databaseSearch,
            ...(
              guide.note
                ? {
                    note:
                      guide.note
                  }
                : {}
            )
          })
        )
    })
  );

  server.registerTool(
    'psft_search_definitions',
    {
      title:
        'Search PeopleSoft definitions',
      description:
        'Search definitions in a configured PeopleSoft Studio connection. ' +
        'The type is a PeopleTools OBJECTTYPE code; omit it to search every ' +
        'type. namePattern supports the same % and _ wildcards as PeopleSoft ' +
        'Studio search. Each result carries the key psft_get_definition ' +
        'takes. ' +
        TYPE_CODES,
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
        'provider used by the VS Code extension. Records are returned as ' +
        'structured record metadata, images as the image itself, and every ' +
        'other type as text: PeopleCode, SQL and HTML as their source, and ' +
        'pages, components, menus, App Engine programs, queries, trees and ' +
        'the rest as App Designer shows them. ' +
        TYPE_CODES,
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
        DefinitionType.Image &&
        provider.readImage
      ) {
        const image =
          await provider.readImage(
            key
          );

        if (!image) {
          throw new Error(
            `No image named ${key.parts[0]}.`
          );
        }

        const images =
          image.alternates.map(
            alternate => ({
              ...alternate,
              mimeType:
                sniffImageMimeType(
                  alternate.bytes
                ) ??
                imageMimeType(
                  alternate.format
                )
            })
          );

        const sent =
          images.find(
            alternate =>
              MCP_IMAGE_TYPES.has(
                alternate.mimeType
              ) &&
              alternate.bytes.length <=
              MCP_IMAGE_MAXIMUM_BYTES
          );

        const svg =
          images.find(
            alternate =>
              alternate.mimeType ===
              'image/svg+xml'
          );

        const result =
          jsonResult({
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
                'image',
              description:
                image.description,
              format:
                image.format,
              alternates:
                images.map(
                  alternate => ({
                    altContNum:
                      alternate.altContNum,
                    format:
                      alternate.format,
                    mimeType:
                      alternate.mimeType,
                    bytes:
                      alternate.bytes.length
                  })
                ),
              imageAttached:
                sent?.altContNum,
              ...(
                !sent && svg
                  ? {
                      svg:
                        svg.bytes.toString(
                          'utf8'
                        )
                    }
                  : {}
              )
            }
          });

        return sent
          ? {
              content: [
                ...result.content,
                {
                  type:
                    'image' as const,
                  data:
                    sent.bytes.toString(
                      'base64'
                    ),
                  mimeType:
                    sent.mimeType
                }
              ]
            }
          : result;
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

  server.registerTool(
    'psft_get_peoplecode',
    {
      title:
        'Read PeopleCode source',
      description:
        'Read a specific PeopleCode definition by PeopleTools object type and ' +
        'key parts. This is the preferred tool when the caller already knows ' +
        'the exact PeopleCode definition key.',
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
        !isPeopleCode(
          key.type
        )
      ) {
        throw new Error(
          `${typeLabel(key.type)} is not a PeopleCode definition type.`
        );
      }

      if (
        !provider.canReadAsText(
          key.type
        )
      ) {
        throw new Error(
          `${provider.displayName} cannot read ${typeLabel(key.type)} as text.`
        );
      }

      const source =
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
        key,
        displayName:
          displayName(key),
        typeLabel:
          typeLabel(key.type),
        source
      });
    }
  );

  server.registerTool(
    'psft_get_record_peoplecode',
    {
      title:
        'Read Record PeopleCode',
      description:
        'Read Record or Record Field PeopleCode for a record. Optionally narrow ' +
        'to a field and/or event such as FieldFormula, SaveEdit, RowInit, or ' +
        'FieldChange. Returns all matching programs when the field/event is omitted.',
      inputSchema:
        z.object({
          connection:
            z.string().min(1),
          record:
            z.string().min(1),
          field:
            z.string()
              .min(1)
              .optional(),
          event:
            z.string()
              .min(1)
              .optional(),
          limit:
            z.number()
              .int()
              .min(1)
              .max(200)
              .optional()
        }),
      annotations:
        READ_ONLY
    },
    async ({
      connection,
      record,
      field,
      event,
      limit
    }) => {
      const provider =
        await requireProvider(
          workspace,
          connection
        );

      const candidates =
        await provider.search({
          type:
            DefinitionType.RecordPeopleCode,
          namePattern:
            record,
          limit:
            500
        });

      const matches =
        candidates.filter(
          summary => {
            const key =
              summary.key;

            if (
              !equalsIgnoreCase(
                key.parts[0],
                record
              )
            ) {
              return false;
            }

            if (
              field &&
              !containsPart(
                key,
                field
              )
            ) {
              return false;
            }

            if (
              event &&
              !containsPart(
                key,
                event
              )
            ) {
              return false;
            }

            return true;
          }
        );

      const definitions =
        await readPeopleCodeResults(
          provider,
          matches,
          limit ?? 50
        );

      return jsonResult({
        connection: {
          id:
            provider.id,
          name:
            provider.displayName
        },
        record,
        field,
        event,
        count:
          definitions.length,
        definitions
      });
    }
  );

  server.registerTool(
    'psft_get_component_peoplecode',
    {
      title:
        'Read Component PeopleCode',
      description:
        'Read Component and Component Record PeopleCode associated with a ' +
        'component. Optionally narrow to a specific event.',
      inputSchema:
        z.object({
          connection:
            z.string().min(1),
          component:
            z.string().min(1),
          event:
            z.string()
              .min(1)
              .optional(),
          includeComponentRecord:
            z.boolean()
              .optional(),
          limit:
            z.number()
              .int()
              .min(1)
              .max(200)
              .optional()
        }),
      annotations:
        READ_ONLY
    },
    async ({
      connection,
      component,
      event,
      includeComponentRecord,
      limit
    }) => {
      const provider =
        await requireProvider(
          workspace,
          connection
        );

      const types =
        includeComponentRecord === false
          ? [
              DefinitionType.ComponentPeopleCode
            ]
          : [
              DefinitionType.ComponentPeopleCode,
              DefinitionType.ComponentRecordPeopleCode,
              DefinitionType.ComponentRecordFieldPeopleCode
            ];

      const all:
        DefinitionSummary[] = [];

      for (
        const type
        of types
      ) {
        const candidates =
          await provider.search({
            type,
            namePattern:
              component,
            limit:
              500
          });

        all.push(
          ...candidates.filter(
            summary => {
              if (
                !equalsIgnoreCase(
                  summary.key.parts[0],
                  component
                )
              ) {
                return false;
              }

              if (
                event &&
                !containsPart(
                  summary.key,
                  event
                )
              ) {
                return false;
              }

              return true;
            }
          )
        );
      }

      const definitions =
        await readPeopleCodeResults(
          provider,
          all,
          limit ?? 50
        );

      return jsonResult({
        connection: {
          id:
            provider.id,
          name:
            provider.displayName
        },
        component,
        event,
        count:
          definitions.length,
        definitions
      });
    }
  );

  server.registerTool(
    'psft_get_application_class',
    {
      title:
        'Read Application Class PeopleCode',
      description:
        'Read Application Class PeopleCode by package path. Supply the package ' +
        'path from the root package downward and optionally the class name. ' +
        'Returns matching Application Class PeopleCode programs.',
      inputSchema:
        z.object({
          connection:
            z.string().min(1),
          packagePath:
            z.array(
              z.string().min(1)
            ).min(1),
          className:
            z.string()
              .min(1)
              .optional(),
          limit:
            z.number()
              .int()
              .min(1)
              .max(200)
              .optional()
        }),
      annotations:
        READ_ONLY
    },
    async ({
      connection,
      packagePath,
      className,
      limit
    }) => {
      const provider =
        await requireProvider(
          workspace,
          connection
        );

      const rootPackage =
        packagePath[0];

      const candidates =
        await provider.search({
          type:
            DefinitionType.ApplicationClassPeopleCode,
          namePattern:
            rootPackage,
          limit:
            500
        });

      const matches =
        candidates.filter(
          summary => {
            if (
              !startsWithParts(
                summary.key,
                packagePath
              )
            ) {
              return false;
            }

            if (
              className &&
              !containsPart(
                summary.key,
                className
              )
            ) {
              return false;
            }

            return true;
          }
        );

      const definitions =
        await readPeopleCodeResults(
          provider,
          matches,
          limit ?? 50
        );

      return jsonResult({
        connection: {
          id:
            provider.id,
          name:
            provider.displayName
        },
        packagePath,
        className,
        count:
          definitions.length,
        definitions
      });
    }
  );

  server.registerTool(
    'psft_find_peoplecode_references',
    {
      title:
        'Find references in PeopleCode',
      description:
        'Search PeopleCode source for an identifier or text fragment. This is a ' +
        'bounded source scan, not an Oracle dependency-table lookup. It searches ' +
        'PeopleCode definitions exposed by the configured provider and returns ' +
        'matching source lines.',
      inputSchema:
        z.object({
          connection:
            z.string().min(1),
          symbol:
            z.string().min(1),
          namePattern:
            z.string()
              .optional(),
          caseSensitive:
            z.boolean()
              .optional(),
          types:
            z.array(
              z.number().int()
            )
              .optional(),
          scanLimit:
            z.number()
              .int()
              .min(1)
              .max(5000)
              .optional(),
          matchLimit:
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
      symbol,
      namePattern,
      caseSensitive,
      types,
      scanLimit,
      matchLimit
    }) => {
      const provider =
        await requireProvider(
          workspace,
          connection
        );

      const requestedTypes =
        types === undefined
          ? PEOPLECODE_TYPE_VALUES
          : types
              .map(
                value =>
                  value as DefinitionType
              )
              .filter(
                type =>
                  isPeopleCode(type)
              );

      const maximumScanned =
        scanLimit ?? 500;

      const maximumMatches =
        matchLimit ?? 100;

      let scanned = 0;

      const references: Array<{
        key: DefinitionKey;
        displayName: string;
        typeLabel: string;
        occurrences: Array<{
          line: number;
          column: number;
          context: string;
        }>;
      }> = [];

      for (
        const type
        of requestedTypes
      ) {
        if (
          scanned >=
          maximumScanned ||
          references.length >=
          maximumMatches
        ) {
          break;
        }

        const remaining =
          maximumScanned -
          scanned;

        let candidates:
          DefinitionSummary[];

        try {
          candidates =
            await provider.search({
              type,
              namePattern:
                namePattern ?? '%',
              limit:
                Math.min(
                  remaining,
                  500
                )
            });
        } catch (error) {
          // A kind of PeopleCode this provider cannot list is not scanned.
          if (
            error instanceof
            UnsupportedOperationError
          ) {
            continue;
          }

          throw error;
        }

        for (
          const candidate
          of candidates
        ) {
          if (
            scanned >=
            maximumScanned ||
            references.length >=
            maximumMatches
          ) {
            break;
          }

          scanned++;

          if (
            !provider.canReadAsText(
              candidate.key.type
            )
          ) {
            continue;
          }

          const source =
            await provider.readText(
              candidate.key
            );

          const occurrences =
            sourceMatches(
              source,
              symbol,
              caseSensitive ?? false
            );

          if (
            occurrences.length === 0
          ) {
            continue;
          }

          references.push({
            key:
              candidate.key,
            displayName:
              displayName(
                candidate.key
              ),
            typeLabel:
              typeLabel(
                candidate.key.type
              ),
            occurrences
          });
        }
      }

      return jsonResult({
        connection: {
          id:
            provider.id,
          name:
            provider.displayName
        },
        symbol,
        scanned,
        matchedDefinitions:
          references.length,
        truncated:
          scanned >= maximumScanned ||
          references.length >= maximumMatches,
        references
      });
    }
  );
}
