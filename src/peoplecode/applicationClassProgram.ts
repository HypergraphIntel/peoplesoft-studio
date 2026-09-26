/**
 * Cycle 14: Application Class structural model, implementing only the
 * fully evidence-backed rules from Cycle 13's research (see
 * `.claude/corpus-progress.md`, "Compiler Semantics Cycle 13"). This
 * module owns:
 *
 *  - the Application Class IR (`ApplicationClassProgram`/`ApplicationClassMember`),
 *  - source parsing into that IR, restricted to shapes whose directory
 *    layout is fully evidenced (see `parseApplicationClassSource`'s own
 *    comment for the exact restrictions and why each one exists),
 *  - the type-descriptor encoder (the exact inverse of Cycle 13's own
 *    `decodeDescriptor`),
 *  - directory-record and trailer assembly.
 *
 * It does NOT encode method BODIES itself -- that remains
 * `encodeFragmentInternal`'s job (see `encoder.ts`'s own orchestration),
 * reusing the same general-purpose, already-calibrated PeopleCode
 * statement/expression encoder every other program type uses. This
 * module only assembles the class header, member directory, signature
 * slots, and name table around bytes the caller already produced.
 *
 * Two axes Cycle 13 found are independent are kept independent here
 * too, exactly as named in Cycle 13's own report:
 *
 *  - `declarationOrdinal` -- position in class-HEADER declaration order.
 *    Governs signature slot offsets (methods) and storage ordinals
 *    (properties/instances).
 *  - `implementationOrder` -- position in method-IMPLEMENTATION (body)
 *    order. Governs physical directory record position for methods.
 *
 * Where Cycle 13 left a question unresolved (interface/abstract method
 * physical ordering; property/instance physical position for 2+ storage
 * members), this module refuses to parse the shape rather than guess --
 * see `parseApplicationClassSource`'s own restrictions.
 */

export type ApplicationClassVisibility = 'public' | 'private' | 'protected';

export interface ApplicationClassParameter {
  name: string;
  type: string;
  out: boolean;
}

export interface ApplicationClassMethodMember {
  kind: 'method';
  name: string;
  /** Index into the class header's own declaration order (0-based). */
  sourceOrder: number;
  /** Position among methods in declaration order; drives signature slot offset. */
  declarationOrdinal: number;
  /** Position among methods in IMPLEMENTATION (body) order; drives physical directory position. */
  implementationOrder: number;
  visibility: ApplicationClassVisibility;
  abstract: boolean;
  parameters: ApplicationClassParameter[];
  returnType?: string;
  /** Raw source text between the method-implementation header and `end-method`. */
  body: string;
  /** `/+ ... +/` compiler signature comments, in source order, verbatim. */
  signatureComments: string[];
  /** Cumulative signature-slot start, in declaration order (Cycle 13 section 3/5). */
  signatureSlotOffset: number;
}

export interface ApplicationClassStorageMember {
  kind: 'property' | 'instance';
  name: string;
  sourceOrder: number;
  /** Position among storage-backed members (instances + plain/readonly properties) in declaration order. */
  declarationOrdinal: number;
  type: string;
  /** Only meaningful for `kind: 'property'`; an `instance` is always private/storage. */
  mode: 'plain' | 'readonly' | 'get' | 'get-set';
  visibility: ApplicationClassVisibility;
}

export type ApplicationClassMember =
  | ApplicationClassMethodMember
  | ApplicationClassStorageMember;

export interface ApplicationClassProgram {
  unitKind: 'class';
  className: string;
  /** At most one of `extendsType`/`implementsType` -- Cycle 13 found zero classes combining both. */
  extendsType?: string;
  implementsType?: string;
  /** Declaration order (class-header order), matching `declarationOrdinal` above. */
  members: ApplicationClassMember[];
}

function normalizeTypeName(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed;
}

function maskNonCode(source: string): string {
  const chars = [...source];
  let i = 0;
  while (i < chars.length) {
    if (
      source.slice(i, i + 3).toLowerCase() === 'rem' &&
      (i === 0 || !/[A-Za-z0-9_%&]/.test(source[i - 1])) &&
      /[\s:]/.test(source[i + 3] ?? '')
    ) {
      while (i < chars.length && chars[i] !== ';') {
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
        i++;
      }
      if (i < chars.length) chars[i++] = ' ';
      continue;
    }
    const pair = `${chars[i] ?? ''}${chars[i + 1] ?? ''}`;
    if (pair === '/*' || pair === '<*') {
      const close = pair === '/*' ? '*/' : '*>';
      chars[i++] = ' ';
      chars[i++] = ' ';
      while (i < chars.length && `${chars[i]}${chars[i + 1] ?? ''}` !== close) {
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
        i++;
      }
      if (i < chars.length) chars[i++] = ' ';
      if (i < chars.length) chars[i++] = ' ';
      continue;
    }
    if (pair === '//') {
      while (i < chars.length && chars[i] !== '\n') chars[i++] = ' ';
      continue;
    }
    if (chars[i] === '"') {
      chars[i++] = ' ';
      while (i < chars.length) {
        if (chars[i] === '"') {
          chars[i++] = ' ';
          if (chars[i] === '"') {
            chars[i++] = ' ';
            continue;
          }
          break;
        }
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
        i++;
      }
      continue;
    }
    i++;
  }
  return chars.join('');
}

function splitParameters(text: string): ApplicationClassParameter[] {
  const inner = text.trim();
  if (inner === '') return [];
  const parts = inner.split(',').map(part => part.trim()).filter(Boolean);
  const parameters: ApplicationClassParameter[] = [];
  for (const part of parts) {
    const match = /^(&[A-Za-z0-9_][A-Za-z0-9_]*#?)\s+As\s+(.+?)(\s+out)?$/i.exec(part);
    if (!match) return [];
    parameters.push({
      name: match[1],
      type: normalizeTypeName(match[2]),
      out: match[3] !== undefined
    });
  }
  return parameters;
}

/**
 * Parses Application Class source into the IR above, restricted to
 * shapes whose PHYSICAL DIRECTORY LAYOUT is fully evidenced by Cycle 13.
 * Returns `undefined` (never throws) for anything out of scope, so the
 * caller falls through to the existing unsupported-syntax path.
 *
 * Deliberately rejected, per Cycle 13's own unresolved-cases list
 * (`.claude/corpus-progress.md` Cycle 13 section 10) -- NOT guessed at:
 *
 *  - `interface` units (interface method physical ordering: 4/16 exact,
 *    unresolved).
 *  - any `abstract` method, in a class or interface (abstract method
 *    physical ordering: 2/26 exact, unresolved).
 *  - 2+ combined properties/instances (physical position: 57/643 exact,
 *    unresolved -- 0 or 1 is unambiguous and therefore safe).
 *  - `constant` declarations (no directory representation was found, and
 *    this cycle does not trace their executable-body encoding).
 *  - both `extends` and `implements` present together (zero corpus
 *    examples exist; the self-descriptor rule for that combination was
 *    never tested).
 *  - more than one `implements` target (Cycle 13 never established
 *    which one the self descriptor selects when several are present).
 *  - a method whose body cannot be located between a signature-comment
 *    run and `end-method` in the implementation region.
 */
export function parseApplicationClassSource(
  source: string
): ApplicationClassProgram | undefined {
  const masked = maskNonCode(source);

  /*
   * The `import` statement is NOT required (many classes only reference
   * types by full package path, or none at all) and, when present, its
   * path is NOT the class's own owner package -- that comes from the
   * DEFINITION's own objectValue1/objectValue2 (via the caller's context
   * at encode time, exactly like the owner reference for ordinary
   * Record.Field programs), not from source. This parser only needs a
   * strong enough structural signal that this source IS an Application
   * Class unit; leading `import`, if present, is skipped over but
   * otherwise unused here.
   */
  const leadingImport = /^\s*(?:import\s+[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)*\s*;\s*)*/i.exec(masked);
  const afterImports = masked.slice(leadingImport?.[0].length ?? 0);
  const classDeclarationSignal = /^\s*class\s+[A-Za-z_][A-Za-z0-9_]*\b/i;
  if (!classDeclarationSignal.test(afterImports)) return undefined;

  const classStart = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(masked);
  if (!classStart || /\binterface\s+[A-Za-z_][A-Za-z0-9_]*\b/i.test(masked.slice(0, classStart.index ?? 0))) {
    return undefined;
  }
  const endClass = /\bend-class\s*;?/i.exec(masked.slice((classStart.index ?? 0) + classStart[0].length));
  if (!endClass) return undefined;

  const classRegionStart = (classStart.index ?? 0) + classStart[0].length;
  const classRegionEnd = classRegionStart + (endClass.index ?? 0);
  const classRegion = masked.slice(classRegionStart, classRegionEnd);
  const implementationRegion = masked.slice(classRegionEnd + endClass[0].length);
  const rawImplementationRegion = source.slice(classRegionEnd + endClass[0].length);

  const firstMemberKeyword = /\b(?:public|private|protected|method|property|instance|constant)\b/i.exec(classRegion);
  const header = classRegion.slice(0, firstMemberKeyword?.index ?? classRegion.length).replace(/;/g, ' ');
  const extendsMatch = /\bextends\s+([%A-Za-z_][%A-Za-z0-9_]*(?::[%A-Za-z_][%A-Za-z0-9_]*)*)/i.exec(header);
  const implementsMatch = /\bimplements\s+([\s\S]*)/i.exec(header);
  const implementsTypes = implementsMatch
    ? implementsMatch[1].split(',').map(value => value.trim()).filter(Boolean)
    : [];

  // Unresolved: both extends+implements together, or 2+ implements targets.
  if (extendsMatch && implementsTypes.length > 0) return undefined;
  if (implementsTypes.length > 1) return undefined;

  if (/\bconstant\b/i.test(classRegion)) return undefined;

  type Event = { index: number; visibility?: ApplicationClassVisibility; member?: ApplicationClassMember };
  const events: Event[] = [];
  for (const match of classRegion.matchAll(/\b(public|private|protected)\b/gi)) {
    events.push({ index: match.index ?? 0, visibility: match[1].toLowerCase() as ApplicationClassVisibility });
  }

  let sourceOrder = 0;
  for (const match of classRegion.matchAll(
    /\bmethod\s+([A-Za-z_][A-Za-z0-9_$]*)\s*(?:\(([^;]*?)\))?\s*(?:Returns\s+([^;]+?))?\s*(abstract\s*)?;/gi
  )) {
    if (match[4] !== undefined) return undefined; // unresolved: abstract method ordering
    let returnType = match[3]?.trim();
    if (returnType && /\s+abstract$/i.test(returnType)) return undefined; // unresolved: abstract method ordering
    const parameters = splitParameters(match[2] ?? '');
    if ((match[2] ?? '').trim() !== '' && parameters.length === 0) return undefined; // unparsed parameter shape
    events.push({
      index: match.index ?? 0,
      member: {
        kind: 'method',
        name: match[1],
        sourceOrder: sourceOrder++,
        declarationOrdinal: -1,
        implementationOrder: -1,
        parameters,
        returnType: returnType === undefined ? undefined : normalizeTypeName(returnType),
        visibility: 'public',
        abstract: false,
        body: '',
        signatureComments: [],
        signatureSlotOffset: -1
      }
    });
  }

  const typePattern = '(?:array\\s+of\\s+)*(?:[%A-Za-z_][%A-Za-z0-9_]*(?::[%A-Za-z_][%A-Za-z0-9_]*)*)';
  const propertyPattern = new RegExp(
    `\\bproperty\\s+(${typePattern})\\s+([A-Za-z_][A-Za-z0-9_]*#?)\\s*(readonly|get(?:\\s+set)?|set(?:\\s+get)?)?\\s*;`,
    'gi'
  );
  for (const match of classRegion.matchAll(propertyPattern)) {
    const spelling = match[3]?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';
    const mode: ApplicationClassStorageMember['mode'] =
      spelling === 'readonly'
        ? 'readonly'
        : spelling === 'get'
          ? 'get'
          : spelling.includes('get') && spelling.includes('set')
            ? 'get-set'
            : 'plain';
    events.push({
      index: match.index ?? 0,
      member: {
        kind: 'property',
        type: normalizeTypeName(match[1]),
        name: match[2],
        mode,
        visibility: 'public',
        sourceOrder: sourceOrder++,
        declarationOrdinal: -1
      }
    });
  }
  const instancePattern = new RegExp(`\\binstance\\s+(${typePattern})\\s+([^;]+?)(?:;|$)`, 'gim');
  for (const match of classRegion.matchAll(instancePattern)) {
    const names = match[2].match(/&[A-Za-z0-9_][A-Za-z0-9_]*#?/g) ?? [];
    for (const name of names) {
      events.push({
        index: match.index ?? 0,
        member: {
          kind: 'instance',
          type: normalizeTypeName(match[1]),
          name: name.slice(1),
          mode: 'plain',
          visibility: 'private',
          sourceOrder: sourceOrder++,
          declarationOrdinal: -1
        }
      });
    }
  }

  events.sort((a, b) => a.index - b.index);
  let visibility: ApplicationClassVisibility = 'public';
  const members: ApplicationClassMember[] = [];
  for (const event of events) {
    if (event.visibility) visibility = event.visibility;
    if (event.member) {
      if (event.member.kind !== 'instance') event.member.visibility = visibility;
      members.push(event.member);
    }
  }

  // Unresolved: 2+ combined storage-backed members (property/instance
  // physical directory position).
  const storageBackedCount = members.filter(member =>
    member.kind === 'instance' ||
    (member.kind === 'property' && (member.mode === 'plain' || member.mode === 'readonly'))
  ).length;
  if (storageBackedCount > 1) return undefined;

  // Assign declarationOrdinal within each kind-specific numbering space.
  let methodOrdinal = 0;
  let storageOrdinal = 0;
  for (const member of members) {
    if (member.kind === 'method') {
      member.declarationOrdinal = methodOrdinal++;
    } else if (
      member.kind === 'instance' ||
      (member.kind === 'property' && (member.mode === 'plain' || member.mode === 'readonly'))
    ) {
      member.declarationOrdinal = storageOrdinal++;
    }
  }

  // Locate each method's implementation body, in IMPLEMENTATION (source)
  // order -- physical directory position, per Cycle 13 section 3.
  const methodMembers = members.filter((member): member is ApplicationClassMethodMember => member.kind === 'method');
  const implementationPattern = /\bmethod\s+([A-Za-z_][A-Za-z0-9_$]*)\s*((?:\/\+[\s\S]*?\+\/\s*)*)([\s\S]*?)\bend-method\s*;/gid;
  const implementationOrder: Array<{ name: string; comments: string[]; body: string; index: number }> = [];
  for (const match of implementationRegion.matchAll(implementationPattern)) {
    const signatureComments = [...match[2].matchAll(/\/\+\s*([\s\S]*?)\s*\+\//g)].map(m => m[1].trim());
    const indices = (match as RegExpMatchArray & { indices: Array<[number, number]> }).indices;
    const [bodyStart, bodyEnd] = indices[3];
    implementationOrder.push({
      name: match[1],
      comments: signatureComments,
      body: rawImplementationRegion.slice(bodyStart, bodyEnd),
      index: match.index ?? 0
    });
  }

  if (implementationOrder.length !== methodMembers.length) return undefined;

  const byName = new Map(methodMembers.map(member => [member.name.toLowerCase(), member]));
  for (const [position, implementation] of implementationOrder.entries()) {
    const member = byName.get(implementation.name.toLowerCase());
    if (member === undefined) return undefined; // an implementation with no matching declaration
    member.implementationOrder = position;
    member.body = implementation.body;
    member.signatureComments = implementation.comments;
    byName.delete(implementation.name.toLowerCase());
  }
  if (byName.size !== 0) return undefined; // a declared method with no matching implementation

  if (methodMembers.some(member => member.implementationOrder < 0)) return undefined;

  // Signature slot offsets: cumulative over methods in DECLARATION order
  // (Cycle 13 section 3/5 -- separate from implementationOrder above).
  const methodsInDeclarationOrder = [...methodMembers].sort((a, b) => a.declarationOrdinal - b.declarationOrdinal);
  let slotOffset = 0;
  for (const member of methodsInDeclarationOrder) {
    member.signatureSlotOffset = slotOffset;
    slotOffset += member.parameters.length + 1;
  }

  return {
    unitKind: 'class',
    className: classStart[1],
    extendsType: extendsMatch?.[1],
    implementsType: implementsTypes[0],
    members
  };
}

/**
 * The directory-entry bitfield, per Cycle 13 section 2 -- validated with
 * zero contradicting combinations across 19,437 real directory records.
 */
export const APPLICATION_CLASS_FLAGS = {
  private: 0x00010000,
  property: 0x00020000,
  readonly: 0x00040000,
  storage: 0x00080000,
  getter: 0x00100000,
  setter: 0x00200000,
  self: 0x00400000,
  abstract: 0x00800000,
  protected: 0x01000000
} as const;

/** The sentinel descriptor value for "no type" (void return, no self relation). */
export const NO_TYPE_DESCRIPTOR = 7;

const SCALAR_TYPE_IDS = new Map<string, number>([
  ['string', 1], ['date', 2], ['any', 4], ['boolean', 5], ['time', 10],
  ['datetime', 11], ['object', 13], ['integer', 17], ['number', 19]
]);

const BUILTIN_TYPE_IDS = new Map<string, number>([
  ['file', 1], ['sql', 2], ['record', 3], ['rowset', 7], ['row', 8], ['field', 9],
  ['processrequest', 11], ['message', 14], ['apiobject', 15], ['grid', 20],
  ['javaobject', 27], ['xmldoc', 29], ['exception', 33], ['xmlnode', 34],
  ['document', 63], ['compound', 66], ['collection', 67], ['map', 73],
  ['mapelement', 75], ['jsonbuilder', 97], ['jsonobject', 99], ['jsonarray', 100]
]);

/**
 * The exact inverse of Cycle 13's own `decodeDescriptor` (see
 * `tools/corpus/research/application-class-structure-analysis.ts`):
 * `descriptor = (arrayDepth << 20) | core`, where `core` is either a
 * fixed scalar id, a fixed builtin-object id with the `0x80000` bit set,
 * or (`0x80000 | (0x100 + nameTableOffset)`) for an Application Class
 * type. `ensureNameOffset` registers the type's own path text (used
 * VERBATIM, matching Cycle 13's 507/507 and 236/236 exact self-relation
 * findings, which compared decoded name-table text directly against the
 * source-written type text with no path resolution) and returns its
 * name-table character offset.
 */
export function encodeTypeDescriptor(
  typeName: string,
  ensureNameOffset: (path: string) => number
): number {
  let remaining = typeName.trim();
  let arrayDepth = 0;
  while (/^array\s+of\s+/i.test(remaining)) {
    arrayDepth++;
    remaining = remaining.replace(/^array\s+of\s+/i, '');
  }
  const lower = remaining.toLowerCase();
  const scalar = SCALAR_TYPE_IDS.get(lower);
  const builtin = BUILTIN_TYPE_IDS.get(lower);
  const core =
    scalar !== undefined
      ? scalar
      : builtin !== undefined
        ? 0x80000 | builtin
        : 0x80000 | (0x100 + ensureNameOffset(remaining));
  return (arrayDepth << 20) | core;
}

export interface ApplicationClassDirectoryRecordFields {
  nameOffset: number;
  signatureSlotOffset: number;
  flags: number;
  low: number;
  descriptor: number;
}

/** One 16-byte directory record: `[nameOffset][signatureSlotOffset][flags|low][descriptor]`. */
export function encodeApplicationClassDirectoryRecord(
  fields: ApplicationClassDirectoryRecordFields
): Buffer {
  const record = Buffer.alloc(16);
  record.writeUInt32LE(fields.nameOffset >>> 0, 0);
  record.writeUInt32LE(fields.signatureSlotOffset >>> 0, 4);
  record.writeUInt32LE(((fields.flags & 0xffff0000) | (fields.low & 0xffff)) >>> 0, 8);
  record.writeUInt32LE(fields.descriptor >>> 0, 12);
  return record;
}

/** One UTF-16LE, null-terminated name-table entry (Cycle 13 section 1/2). */
export function encodeApplicationClassNameEntry(text: string): Buffer {
  return Buffer.from(`${text}\0`, 'utf16le');
}

/** One 4-byte dispatch slot: a parameter's own type descriptor, or the mode-flagged variant, or the `7` terminator. */
export function encodeApplicationClassSlot(value: number): Buffer {
  const slot = Buffer.alloc(4);
  slot.writeUInt32LE(value >>> 0, 0);
  return slot;
}
