import * as z from 'zod/v4';

/*
 * psft_page_field_config_save's configuration: a configuration's rows by
 * table. Every list the writer saves is here -- a list the schema dropped would
 * reach the writer as absent and be saved empty, deleting the stored rows.
 */

const row = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

export const PFC_CONFIGURATION_SCHEMA = z.object({
  header: row, sequences: z.array(row), criteria: z.array(row).optional(), pages: z.array(row).optional(), fields: z.array(row).optional(),
  seqUsers: z.array(row).optional(), seqExcludedUsers: z.array(row).optional(), seqRoles: z.array(row).optional(), seqExcludedRoles: z.array(row).optional(),
  users: z.array(row).optional(), excludedUsers: z.array(row).optional(), roles: z.array(row).optional(), excludedRoles: z.array(row).optional()
});
