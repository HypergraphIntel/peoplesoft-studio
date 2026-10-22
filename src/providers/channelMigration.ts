import * as z from 'zod/v4';
import type { ChannelDocument } from '../model/channelDocument.js';

/**
 * A message channel as a migration carries it: its Properties window and the partition fields it stores (PSSUBCHNL),
 * sorted. The Messages tab's left list is derived from PSMSGDEFN (other definitions) and travels with them -- without them
 * in the target, App Designer offers no partition fields and drops the stored ones when it next opens the channel; node rows
 * (PSCHNLNODE) are environment specific and translations (PSCHNLDEFNLANG) are not migrated: both refuse.
 */
export interface ChannelMigrationData {
  name: string;
  descr: string;
  descrlong: string | null;
  owner: string;
  status: number;
  archive: boolean;
  thruput: number;
  pubTimeoutMin: number;
  subTimeoutMin: number;
  pubRetrySec: number;
  subRetrySec: number;
  errorThreshold: number;
  qualityOfService: number;
  partitions: string[];
}

export const channelMigrationSchema = z.object({
  name: z.string().regex(/^[A-Z0-9_]{1,30}$/), descr: z.string().max(30), descrlong: z.string().nullable(), owner: z.string().max(4),
  status: z.number().int().min(0).max(2), archive: z.boolean(), thruput: z.number().int().min(0).max(2),
  pubTimeoutMin: z.number().int(), subTimeoutMin: z.number().int(), pubRetrySec: z.number().int(), subRetrySec: z.number().int(),
  errorThreshold: z.number().int(), qualityOfService: z.number().int(), partitions: z.array(z.string().regex(/^[A-Z0-9_]{1,18}$/)).max(200)
}).strict();

/** The portable payload of a stored channel; refuses node and language rows. */
export function portableChannel(doc: ChannelDocument): ChannelMigrationData {
  if (doc.nodes.length) throw new Error(`${doc.name}: channel node rows are environment specific and are not migrated.`);
  if (doc.languages.length) throw new Error(`${doc.name}: channel translations are not migrated.`);
  const { name, descr, descrlong, owner, status, archive, thruput, pubTimeoutMin, subTimeoutMin, pubRetrySec, subRetrySec, errorThreshold, qualityOfService } = doc;
  return { name, descr, descrlong, owner, status, archive, thruput, pubTimeoutMin, subTimeoutMin, pubRetrySec, subRetrySec, errorThreshold, qualityOfService,
    // The stored PSSUBCHNL rows: checked fields, and fields no message of this database offers (the reader's `dropped`,
    // which App Designer drops when it next opens the channel without those messages).
    partitions: [...doc.partitions.filter(p => p.checked).map(p => p.field), ...doc.dropped].sort() };
}

/**
 * The document to save in the target: its own (or App Designer's new channel there), with the payload's properties and
 * exactly the payload's partition fields checked -- a field the target's messages do not offer is an added partition.
 */
export function channelDocumentFor(base: ChannelDocument, data: ChannelMigrationData): ChannelDocument {
  if (base.nodes.length || base.languages.length) throw new Error(`${data.name}: the target channel has node or translation rows that migration does not manage.`);
  const wanted = new Set(data.partitions);
  const partitions = base.partitions.map(p => ({ ...p, checked: wanted.has(p.field) }));
  for (const field of data.partitions) if (!partitions.some(p => p.field === field)) partitions.push({ field, checked: true, added: true });
  const { partitions: _p, name: _n, ...properties } = data;
  return { ...base, ...properties, partitions, dropped: [] };
}
