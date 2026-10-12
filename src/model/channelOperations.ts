import * as z from 'zod/v4';
import {
  addPartition, CHANNEL_NAME_MAX, DESCR_MAX, FIELD_NAME_MAX, newChannel, setChannel, setPartition, STATUS_LABELS, THRUPUT_LABELS,
  type ChannelDocument
} from './channelDocument.js';

/*
 * Message channels for agents (the MCP's psft_channel_* tools) and as text:
 * a channel as a spec in App Designer's terms, the Message Channel window's
 * operations by name, both turned into the window's own document and
 * operations (channelDocument.ts).
 */

export const channelSpec = z.object({
  channel: z.string().min(1).max(CHANNEL_NAME_MAX),
  description: z.string().max(DESCR_MAX).optional(),
  comments: z.string().optional(),
  owner: z.string().max(4).optional().describe('Owner ID.'),
  status: z.enum(['run', 'pause']).optional().describe('Message Channel Status. A new channel whose properties are never given is stored as neither (0, shown as Run).'),
  archive: z.boolean().optional().describe('Archive Messages? (on for a new channel).'),
  unordered: z.boolean().optional().describe('Unordered? (off: ordered).'),
  partitions: z.array(z.string().max(FIELD_NAME_MAX)).optional().describe('Use These Fields to Partition: the fields checked.')
});
export type ChannelSpec = z.infer<typeof channelSpec>;

export const channelOperation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_channel'), description: z.string().max(DESCR_MAX).optional(), comments: z.string().optional(), owner: z.string().max(4).optional(),
    status: z.enum(['run', 'pause']).optional(), archive: z.boolean().optional(), unordered: z.boolean().optional() })
    .describe('Message Channel Properties (General and Use), as its OK: a status or throughput never set is written as Run / ordered.'),
  z.object({ op: z.literal('add_partition'), field: z.string().min(1).max(FIELD_NAME_MAX) })
    .describe('Add Partition Field: a field (PSDBFIELD) appended checked, or checked if listed.'),
  z.object({ op: z.literal('check_partition'), field: z.string().min(1), checked: z.boolean() })
    .describe('A listed field\'s check box: unchecked, the channel is no longer partitioned by it.')
]);
export type ChannelOperation = z.infer<typeof channelOperation>;

export function applyChannelOperation(doc: ChannelDocument, o: ChannelOperation): ChannelDocument {
  switch (o.op) {
    case 'set_channel': return setChannel(doc, {
      ...(o.description !== undefined ? { descr: o.description } : {}), ...(o.comments !== undefined ? { descrlong: o.comments } : {}),
      ...(o.owner !== undefined ? { owner: o.owner } : {}), ...(o.status !== undefined ? { status: o.status } : {}),
      ...(o.archive !== undefined ? { archive: o.archive } : {}), ...(o.unordered !== undefined ? { unordered: o.unordered } : {})
    });
    case 'add_partition': return addPartition(doc, o.field);
    case 'check_partition': return setPartition(doc, o.field, o.checked);
  }
}

const statusName = (s: number) => (s === 2 ? 'pause' : 'run');

export function specFromDocument(doc: ChannelDocument): ChannelSpec & { messages: string[]; partitionChoices: string[]; storedStatus: number; storedThruput: number } {
  return {
    channel: doc.name, description: doc.descr, comments: doc.descrlong ?? '', owner: doc.owner,
    status: statusName(doc.status), archive: doc.archive, unordered: doc.thruput === 1,
    partitions: doc.partitions.filter((p) => p.checked).map((p) => p.field),
    messages: doc.messages, partitionChoices: doc.partitions.map((p) => p.field), storedStatus: doc.status, storedThruput: doc.thruput
  };
}

/**
 * A new channel from a spec: File > New, then -- when the spec gives any
 * property -- Message Channel Properties OK, then each partition added.
 */
export function documentFromSpec(spec: ChannelSpec, messages: readonly string[] = [], candidates: readonly string[] = []): ChannelDocument {
  let doc = newChannel(spec.channel.trim().toUpperCase(), messages, candidates);
  const props = ['description', 'comments', 'owner', 'status', 'archive', 'unordered'] as const;
  if (props.some((k) => spec[k] !== undefined)) {
    doc = applyChannelOperation(doc, { op: 'set_channel', ...Object.fromEntries(props.filter((k) => spec[k] !== undefined).map((k) => [k, spec[k]])) });
  }
  for (const f of spec.partitions ?? []) doc = addPartition(doc, f);
  return doc;
}

/** What a stored channel differs from a spec in (after a save: nothing). */
export function diffChannelSpec(stored: ChannelDocument, spec: ChannelSpec): string[] {
  const s = specFromDocument(stored);
  const out: string[] = [];
  for (const k of ['description', 'comments', 'owner', 'status', 'archive', 'unordered'] as const) {
    if (spec[k] !== undefined && String(spec[k]) !== String(s[k])) out.push(`${k}: stored ${JSON.stringify(s[k])}, wanted ${JSON.stringify(spec[k])}`);
  }
  if (spec.partitions) {
    const want = [...new Set(spec.partitions.map((f) => f.toUpperCase()))].sort().join(', ');
    const got = [...(s.partitions ?? [])].sort().join(', ');
    if (want !== got) out.push(`partitions: stored ${got || 'none'}, wanted ${want || 'none'}`);
  }
  return out;
}

/** The channel as text, as its window shows it (psft_get_definition, the virtual file system). */
export function renderChannel(doc: ChannelDocument): string {
  const lines = [
    `Message Channel ${doc.name}`,
    '',
    'General',
    `  Description: ${doc.descr}`,
    `  Owner ID: ${doc.owner}`,
    ...(doc.descrlong ? ['  Comments:', ...doc.descrlong.split(/\r?\n/).map((l) => `    ${l}`)] : []),
    `  Last Updated: ${doc.lastUpdated ?? ''} by ${doc.lastUpdatedBy ?? ''}`,
    '',
    'Use',
    `  Message Channel Status: ${STATUS_LABELS[doc.status] ?? doc.status}${doc.status === 0 ? ' (never set: stored 0)' : ''}`,
    `  Archive Messages?: ${doc.archive ? 'Yes' : 'No'}`,
    `  Unordered?: ${doc.thruput === 1 ? 'Yes' : 'No'} (${THRUPUT_LABELS[doc.thruput] ?? doc.thruput}${doc.thruput === 0 ? ', never set: stored 0' : ''})`,
    '',
    'Messages',
    ...(doc.messages.length ? doc.messages.map((m) => `  ${m}`) : ['  (none)']),
    '',
    'Use These Fields to Partition',
    ...(doc.partitions.length ? doc.partitions.map((p) => `  [${p.checked ? 'x' : ' '}] ${p.field}`) : ['  (none listed)']),
    ...(doc.dropped.length ? ['', `Stored but not listed (App Designer drops them on open): ${doc.dropped.join(', ')}`] : []),
    '',
    `Not shown by App Designer: publish / subscribe timeout ${doc.pubTimeoutMin} / ${doc.subTimeoutMin} min, retry ${doc.pubRetrySec} / ${doc.subRetrySec} s, ` +
      `error threshold ${doc.errorThreshold}, quality of service ${doc.qualityOfService}.`
  ];
  return lines.join('\n') + '\n';
}

export { statusName };
