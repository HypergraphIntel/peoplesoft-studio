/*
 * A message channel as App Designer's Message Channel window holds it
 * (docs/MESSAGE_CHANNELS.md): Message Channel Properties -- General
 * (Description, Comments, Owner ID) and Use (Run / Pause, Archive Messages?,
 * Unordered?) -- and the Messages tab: the channel's messages, read-only, and
 * the fields its messages can be partitioned by, checked when the channel is
 * partitioned by them. Pure: the rows come in (channelWriter.ts reads them)
 * and the rows go out.
 */

export type Row = Record<string, unknown>;

export const CHANNEL_NAME_MAX = 30;
export const DESCR_MAX = 30;
export const FIELD_NAME_MAX = 18;
export const NAME_PATTERN = /^[A-Z0-9_#@$]+$/;

/** CHNLSTATUS: 0 on a channel never given its properties (shown as Run), 1 Run, 2 Pause [chn00, chn03, chn09]. */
export const STATUS_LABELS: Readonly<Record<number, string>> = { 0: 'Run', 1: 'Run', 2: 'Pause' };
/** THRUPUTTYPE: 0 on a channel never given its properties (shown as ordered), 1 Unordered, 2 Ordered [chn00, chn03, chn04, chn09]. */
export const THRUPUT_LABELS: Readonly<Record<number, string>> = { 0: 'Ordered', 1: 'Unordered', 2: 'Ordered' };

/**
 * The fields every channel with messages offers to partition by, after its
 * messages' own [chn05, CHNL window]: App Designer lists them last.
 */
export const STANDARD_PARTITION_FIELDS = ['MSGNAME', 'MSGNAMEDETAIL', 'PUBLISHER', 'PUBPROC'] as const;

export interface ChannelPartition {
  field: string;
  /** Checked: a PSSUBCHNL row. */
  checked: boolean;
  /** Added with Add Partition Field (not one of the messages' fields). */
  added?: boolean;
}

export interface ChannelDocument {
  name: string;
  descr: string;
  descrlong: string | null;
  owner: string;
  /** CHNLSTATUS as stored: 0 (never set), 1 Run, 2 Pause. */
  status: number;
  /** APMSGARCHIVE: Archive Messages? */
  archive: boolean;
  /** THRUPUTTYPE as stored: 0 (never set), 1 Unordered, 2 Ordered. */
  thruput: number;
  /** Columns the window does not show, kept as stored (a new channel's App Designer defaults) [chn00]. */
  pubTimeoutMin: number;
  subTimeoutMin: number;
  pubRetrySec: number;
  subRetrySec: number;
  errorThreshold: number;
  qualityOfService: number;
  /** The Messages tab's left list: PSMSGDEFN rows naming the channel, by name. Read-only. */
  messages: string[];
  /** The right list, in App Designer's order: the messages' fields, then the standard four, then those added. */
  partitions: ChannelPartition[];
  /**
   * Stored PSSUBCHNL fields the window does not list -- App Designer drops
   * them when it opens the channel, so its next save deletes them [chn15].
   */
  dropped: string[];
  /** PSCHNLDEFNLANG / PSCHNLNODE rows, kept. */
  languages: Row[];
  nodes: Row[];
  /** The stored stamp, read-only (the save sets it). */
  version?: number;
  lastUpdated?: string;
  lastUpdatedBy?: string;
}

export interface ChannelRows {
  channel: Row;
  partitions: Row[];
  languages: Row[];
  nodes: Row[];
}

export class ChannelEditError extends Error {
  constructor(message: string) { super(message); this.name = 'ChannelEditError'; }
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const trim = (v: unknown) => str(v).trim();
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const blank = (s: string) => (s === '' ? ' ' : s);

/**
 * The fields App Designer's window offers to partition by: the level-0
 * record fields every message on the channel shares (each message's default
 * version, Long fields left out), in the first message's field order, then
 * MSGNAME, MSGNAMEDETAIL, PUBLISHER and PUBPROC; none without messages
 * [chn15, CHN5 with one and two messages].
 */
export function partitionCandidates(messageFields: readonly (readonly string[])[]): string[] {
  if (!messageFields.length) return [];
  const [first, ...rest] = messageFields;
  const shared = first.filter((f) => rest.every((m) => m.includes(f)));
  const out: string[] = [];
  for (const f of [...shared, ...STANDARD_PARTITION_FIELDS]) if (!out.includes(f)) out.push(f);
  return out;
}

/**
 * The channel as App Designer opens it: its row, its messages, and the
 * partition list -- the candidates, each checked when stored; stored fields
 * that are not candidates are dropped [chn15].
 */
export function documentFromRows(rows: ChannelRows, messages: readonly string[], candidates: readonly string[]): ChannelDocument {
  const c = rows.channel;
  const stored = rows.partitions.map((r) => trim(r.FIELDNAME));
  return {
    name: trim(c.CHNLNAME), descr: trim(c.DESCR), descrlong: c.DESCRLONG === null || c.DESCRLONG === undefined ? null : str(c.DESCRLONG),
    owner: trim(c.OBJECTOWNERID), status: num(c.CHNLSTATUS), archive: num(c.APMSGARCHIVE) === 1, thruput: num(c.THRUPUTTYPE),
    pubTimeoutMin: num(c.PUBTIMEOUTMIN), subTimeoutMin: num(c.SUBTIMEOUTMIN), pubRetrySec: num(c.PUBRETRYSEC), subRetrySec: num(c.SUBRETRYSEC),
    errorThreshold: num(c.ERRORTHRESHOLD), qualityOfService: num(c.QUALITYOFSERVICE),
    messages: [...messages].sort(),
    partitions: candidates.map((field) => ({ field, checked: stored.includes(field) })),
    dropped: stored.filter((f) => !candidates.includes(f)).sort(),
    languages: rows.languages.map((r) => ({ ...r })), nodes: rows.nodes.map((r) => ({ ...r })),
    version: num(c.VERSION), lastUpdated: str(c.LASTUPDDTTM), lastUpdatedBy: trim(c.LASTUPDOPRID)
  };
}

/** The rows the document is stored as (VERSION / LASTUPDDTTM / LASTUPDOPRID are the save's). */
export function rowsFromDocument(doc: ChannelDocument): ChannelRows {
  return {
    channel: {
      CHNLNAME: doc.name, CHNLSTATUS: doc.status, PUBTIMEOUTMIN: doc.pubTimeoutMin, SUBTIMEOUTMIN: doc.subTimeoutMin,
      PUBRETRYSEC: doc.pubRetrySec, SUBRETRYSEC: doc.subRetrySec, ERRORTHRESHOLD: doc.errorThreshold, APMSGARCHIVE: doc.archive ? 1 : 0,
      THRUPUTTYPE: doc.thruput, QUALITYOFSERVICE: doc.qualityOfService, CHNLDISPLAYNAME: doc.name,
      DESCR: blank(doc.descr), OBJECTOWNERID: blank(doc.owner), DESCRLONG: doc.descrlong
    },
    partitions: doc.partitions.filter((p) => p.checked).map((p) => ({ CHNLNAME: doc.name, FIELDNAME: p.field })),
    languages: doc.languages.map((r) => ({ ...r, CHNLNAME: doc.name })),
    nodes: doc.nodes.map((r) => ({ ...r, CHNLNAME: doc.name }))
  };
}

/**
 * A new channel as File > New > Message Channel saves it when its
 * properties are never opened: status and throughput 0, the IB defaults for
 * the columns the window does not show, Archive on [chn00]. Its messages
 * (PSMSGDEFN rows already naming it) and their fields come from the caller.
 */
export function newChannel(name: string, messages: readonly string[] = [], candidates: readonly string[] = []): ChannelDocument {
  return {
    name, descr: '', descrlong: null, owner: '', status: 0, archive: true, thruput: 0,
    pubTimeoutMin: 14400, subTimeoutMin: 14400, pubRetrySec: 300, subRetrySec: 300, errorThreshold: 100, qualityOfService: 1,
    messages: [...messages].sort(), partitions: candidates.map((field) => ({ field, checked: false })), dropped: [], languages: [], nodes: []
  };
}

/** File > Save As: the channel under a new name, its properties and checked partitions with it [chn06]. */
export function copyChannel(doc: ChannelDocument, to: string): ChannelDocument {
  const copy = structuredClone(doc);
  copy.name = to;
  copy.dropped = [];
  delete copy.version; delete copy.lastUpdated; delete copy.lastUpdatedBy;
  return copy;
}

export function checkName(name: string, max = CHANNEL_NAME_MAX, what = 'message channel'): string {
  const n = name.trim().toUpperCase();
  if (!n) throw new ChannelEditError(`A ${what} name is required.`);
  if (n.length > max) throw new ChannelEditError(`A ${what} name is at most ${max} characters.`);
  if (!NAME_PATTERN.test(n)) throw new ChannelEditError(`${n}: a ${what} name has only A-Z, 0-9, _, #, @ and $.`);
  return n;
}

export interface ChannelPatch {
  descr?: string;
  descrlong?: string | null;
  owner?: string;
  /** Message Channel Status: run or pause. */
  status?: 'run' | 'pause';
  archive?: boolean;
  unordered?: boolean;
}

/**
 * Message Channel Properties, OK: the patch applied, and -- as every OK
 * does, changed or not -- a status of 0 written as Run (1) and a throughput
 * of 0 as Ordered (2) [chn09, chn10].
 */
export function setChannel(doc: ChannelDocument, patch: ChannelPatch): ChannelDocument {
  const d = structuredClone(doc);
  if (patch.descr !== undefined) {
    if (patch.descr.length > DESCR_MAX) throw new ChannelEditError(`A description is at most ${DESCR_MAX} characters.`);
    d.descr = patch.descr;
  }
  if (patch.descrlong !== undefined) d.descrlong = patch.descrlong === '' ? null : patch.descrlong;
  if (patch.owner !== undefined) d.owner = patch.owner.trim().toUpperCase();
  if (patch.archive !== undefined) d.archive = patch.archive;
  d.status = patch.status === 'pause' ? 2 : patch.status === 'run' ? 1 : d.status === 0 ? 1 : d.status;
  d.thruput = patch.unordered === true ? 1 : patch.unordered === false ? 2 : d.thruput === 0 ? 2 : d.thruput;
  return d;
}

/**
 * Add Partition Field: the name uppercased; a field already listed is
 * checked (a duplicate is not added), a new one appended checked [chn12,
 * chn14]. Whether the field exists (78,1) is the caller's to ask the
 * database (validateChannelReferences).
 */
export function addPartition(doc: ChannelDocument, field: string): ChannelDocument {
  const f = checkName(field, FIELD_NAME_MAX, 'field');
  const d = structuredClone(doc);
  const p = d.partitions.find((x) => x.field === f);
  if (p) p.checked = true;
  else d.partitions.push({ field: f, checked: true, added: true });
  return d;
}

/** A partition field's check box: unchecked, its PSSUBCHNL row is deleted by the save [chn13]. */
export function setPartition(doc: ChannelDocument, field: string, checked: boolean): ChannelDocument {
  const f = field.trim().toUpperCase();
  const d = structuredClone(doc);
  const p = d.partitions.find((x) => x.field === f);
  if (!p) throw new ChannelEditError(`${f} is not in the partition list; add it with Add Partition Field.`);
  p.checked = checked;
  return d;
}

export type ChannelOp =
  | { kind: 'setChannel'; patch: ChannelPatch }
  | { kind: 'addPartition'; field: string }
  | { kind: 'setPartition'; field: string; checked: boolean };

export function applyChannelOp(doc: ChannelDocument, op: ChannelOp): ChannelDocument {
  switch (op.kind) {
    case 'setChannel': return setChannel(doc, op.patch);
    case 'addPartition': return addPartition(doc, op.field);
    case 'setPartition': return setPartition(doc, op.field, op.checked);
  }
}

export type Severity = 'error' | 'warning' | 'info';

export interface ChannelDiagnostic {
  severity: Severity;
  code: string;
  path: string;
  message: string;
  /** The partition field it is about. */
  field?: string;
}

/** App Designer's checks on what the window can hold, and what it does that a reader should know. */
export function validateChannel(doc: ChannelDocument): ChannelDiagnostic[] {
  const out: ChannelDiagnostic[] = [];
  const err = (code: string, path: string, message: string, field?: string) => out.push({ severity: 'error', code, path, message, ...(field ? { field } : {}) });
  if (!doc.name) err('name-required', 'Name', 'A message channel name is required.');
  else if (doc.name.length > CHANNEL_NAME_MAX) err('name-length', doc.name, `A message channel name is at most ${CHANNEL_NAME_MAX} characters.`);
  else if (!NAME_PATTERN.test(doc.name)) err('name-chars', doc.name, `${doc.name}: a message channel name has only A-Z, 0-9, _, #, @ and $.`);
  if (doc.descr.length > DESCR_MAX) err('length', 'Description', `A description is at most ${DESCR_MAX} characters.`);
  if (![0, 1, 2].includes(doc.status)) err('status', 'Message Channel Status', `Status ${doc.status} is neither Run nor Pause.`);
  if (![0, 1, 2].includes(doc.thruput)) err('thruput', 'Unordered?', `Throughput ${doc.thruput} is neither ordered nor unordered.`);
  const seen = new Set<string>();
  for (const p of doc.partitions) {
    if (seen.has(p.field)) err('partition-duplicate', p.field, `${p.field} is listed twice.`, p.field);
    seen.add(p.field);
    if (p.field.length > FIELD_NAME_MAX || !NAME_PATTERN.test(p.field)) err('partition-name', p.field, `${p.field} is not a field name.`, p.field);
  }
  if (doc.dropped.length) {
    out.push({ severity: 'warning', code: 'partition-dropped', path: 'Use These Fields to Partition',
      message: `Stored partition field${doc.dropped.length === 1 ? '' : 's'} ${doc.dropped.join(', ')} ${doc.dropped.length === 1 ? 'is' : 'are'} not a field of this channel's messages: App Designer drops ${doc.dropped.length === 1 ? 'it' : 'them'} when it opens the channel, so the next save deletes ${doc.dropped.length === 1 ? 'it' : 'them'}.` });
  }
  if (!doc.messages.length) {
    out.push({ severity: 'info', code: 'no-messages', path: 'Messages',
      message: 'No message names this channel, so App Designer offers no fields to partition by; fields added with Add Partition Field are saved but dropped the next time the channel is opened.' });
  }
  return out;
}

/** Database answers for deeper validation. */
export interface ChannelReferenceLookup {
  fieldExists(field: string): Promise<boolean>;
  ownerExists(owner: string): Promise<boolean>;
}

export async function validateChannelReferences(doc: ChannelDocument, lookup: ChannelReferenceLookup): Promise<ChannelDiagnostic[]> {
  const out: ChannelDiagnostic[] = [];
  for (const p of doc.partitions) {
    if (p.checked && !(await lookup.fieldExists(p.field))) {
      out.push({ severity: 'error', code: 'field-missing', path: p.field, message: `${p.field}: Invalid object name for this object type. (78,1)`, field: p.field });
    }
  }
  if (doc.owner && !(await lookup.ownerExists(doc.owner))) out.push({ severity: 'error', code: 'owner', path: 'Owner ID', message: `Owner ID ${doc.owner} is not one App Designer lists.` });
  return out;
}

export class ChannelSession {
  private past: ChannelDocument[] = [];
  private future: ChannelDocument[] = [];
  private saved: string;

  constructor(public doc: ChannelDocument, public token: string, private readonly limit = 200) {
    this.saved = JSON.stringify(doc);
  }

  get dirty(): boolean { return JSON.stringify(this.doc) !== this.saved; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  apply(op: ChannelOp): ChannelDocument {
    return this.replace(applyChannelOp(this.doc, op));
  }

  replace(doc: ChannelDocument): ChannelDocument {
    this.past.push(this.doc);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.doc = doc;
    return doc;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.doc);
    this.doc = prev;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.doc);
    this.doc = next;
    return true;
  }

  reset(doc: ChannelDocument, token: string): void {
    this.doc = doc;
    this.token = token;
    this.saved = JSON.stringify(doc);
    this.past = [];
    this.future = [];
  }

  diagnostics(): ChannelDiagnostic[] {
    return validateChannel(this.doc);
  }
}
