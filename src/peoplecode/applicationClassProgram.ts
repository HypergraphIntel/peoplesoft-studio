/**
 * Application Class structural model. Cycle 13 established directory and
 * signature metadata; Cycle 22 established the executable unit/member
 * statement grammar implemented in Cycle 23. This module owns:
 *
 *  - the Application Class IR (`ApplicationClassProgram`/`ApplicationClassMember`),
 *  - source parsing into an ordered executable-declaration IR,
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
 * Executable declaration order remains independent from implementation and
 * directory order. Cycle 23 broadens only the former; it does not claim to
 * resolve Cycle 13's open physical-directory ordering questions.
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
  /**
   * Cycle 17/18: number of `0x4F` inter-member TRANSITION markers stored
   * between this method's own `end-method;` and the NEXT method
   * implementation's `method` keyword, in IMPLEMENTATION (source) order --
   * one per blank source line, using the same
   * `Math.max(1, newlineCount - 1)` counting rule the general encoder
   * already uses for ordinary multi-blank-line runs. Always `0` for the
   * last method in implementation order (Cycle 17 section 1/5: the last
   * member's transition collapses to the class program's own trailer,
   * with no `0x4F` of its own).
   */
  transitionBlankLines: number;
  /** Whether the declaration itself ended in `;` before the unit closer. */
  terminated: boolean;
  /** The one corpus signature with a comment after a trailing comma retains it. */
  trailingParameterComma: boolean;
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
  /** Property modifiers in source order. Empty for instances/plain properties. */
  modifiers: Array<'readonly' | 'get' | 'set'>;
}

export interface ApplicationClassConstantMember {
  kind: 'constant';
  name: string;
  sourceOrder: number;
  value: string;
  visibility: ApplicationClassVisibility;
}

export type ApplicationClassMember =
  | ApplicationClassMethodMember
  | ApplicationClassStorageMember
  | ApplicationClassConstantMember;

export interface ApplicationClassVisibilityStatement {
  kind: 'visibility';
  visibility: Exclude<ApplicationClassVisibility, 'public'>;
  sourceIndex: number;
}

export interface ApplicationClassInstanceStatement {
  kind: 'instance-statement';
  type: string;
  names: string[];
  sourceIndex: number;
}

export type ApplicationClassStatement =
  | ApplicationClassVisibilityStatement
  | ApplicationClassMethodMember
  | ApplicationClassStorageMember
  | ApplicationClassConstantMember
  | ApplicationClassInstanceStatement;

export interface ApplicationClassImplementation {
  kind: 'method' | 'get' | 'set';
  name: string;
  sourceIndex: number;
  body: string;
  signatureComments: string[];
  transitionBlankLines: number;
}

export interface ApplicationClassProgram {
  unitKind: 'class' | 'interface';
  className: string;
  /** At most one of `extendsType`/`implementsType` -- Cycle 13 found zero classes combining both. */
  extendsType?: string;
  implementsType?: string;
  /** Declaration order (class-header order), matching `declarationOrdinal` above. */
  members: ApplicationClassMember[];
  /** Executable declaration statements, including visibility transitions. */
  statements: ApplicationClassStatement[];
  /** Concrete method/getter/setter wrappers in source implementation order. */
  implementations: ApplicationClassImplementation[];
  /** Exact source offsets used to preserve already-supported surrounding syntax. */
  unitStart: number;
  unitEnd: number;
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
 * Parses the full Cycle 22 executable statement population. Returns
 * `undefined` (never throws) for shapes outside the measured grammar. The
 * parser records metadata members too, but executable ordering is represented
 * separately by `statements`; this is what prevents declaration order from
 * being conflated with implementation or physical directory order.
 */
export function parseApplicationClassSource(
  source: string
): ApplicationClassProgram | undefined {
  const masked = maskNonCode(source);
  const unitStartMatch = /\b(class|interface)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(masked);
  if (!unitStartMatch) return undefined;
  const unitKind = unitStartMatch[1].toLowerCase() as 'class' | 'interface';
  const unitStart = unitStartMatch.index ?? 0;
  const unitRegionStart = unitStart + unitStartMatch[0].length;
  const unitEndMatch = new RegExp(`\\bend-${unitKind}\\s*;?`, 'i').exec(masked.slice(unitRegionStart));
  if (!unitEndMatch) return undefined;
  const unitRegionEnd = unitRegionStart + (unitEndMatch.index ?? 0);
  const unitEnd = unitRegionEnd + unitEndMatch[0].length;
  const unitRegion = masked.slice(unitRegionStart, unitRegionEnd);
  const rawUnitRegion = source.slice(unitRegionStart, unitRegionEnd);

  const firstMember = /\b(?:public|private|protected|method|property|instance|constant)\b/i.exec(unitRegion);
  const header = unitRegion.slice(0, firstMember?.index ?? unitRegion.length).replace(/;/g, ' ');
  const extendsType = /\bextends\s+([%A-Za-z_][%A-Za-z0-9_]*(?::[%A-Za-z_][%A-Za-z0-9_]*)*)/i.exec(header)?.[1];
  const implementsMatch = /\bimplements\s+([\s\S]*)/i.exec(header);
  const implementsTypes = implementsMatch
    ? implementsMatch[1].split(',').map(value => value.trim()).filter(Boolean)
    : [];
  if (extendsType && implementsTypes.length > 0) return undefined;
  if (implementsTypes.length > 1) return undefined;

  type Pending = {
    index: number;
    visibility?: ApplicationClassVisibility;
    member?: ApplicationClassMember;
    instanceNames?: string[];
  };
  const pending: Pending[] = [];
  for (const match of unitRegion.matchAll(/\b(public|private|protected)\b/gi)) {
    pending.push({ index: match.index ?? 0, visibility: match[1].toLowerCase() as ApplicationClassVisibility });
  }

  for (const match of unitRegion.matchAll(
    /\bmethod\s+([A-Za-z_][A-Za-z0-9_$]*)\s*(?:\(([^;]*?)\))?\s*(?:Returns\s+([^;]+?))?\s*(abstract\s*)?(?:;|(?=\s*$))/gi
  )) {
    let returnType = match[3]?.trim();
    let abstract = match[4] !== undefined;
    if (returnType && /\s+abstract$/i.test(returnType)) {
      returnType = returnType.replace(/\s+abstract$/i, '').trim();
      abstract = true;
    }
    const rawParameters = match[2] ?? '';
    const parameters = splitParameters(rawParameters);
    if (rawParameters.replace(/,\s*$/, '').trim() !== '' && parameters.length === 0) return undefined;
    pending.push({
      index: match.index ?? 0,
      member: {
        kind: 'method', name: match[1], sourceOrder: -1,
        declarationOrdinal: -1, implementationOrder: -1,
        visibility: 'public', abstract, parameters,
        returnType: returnType === undefined ? undefined : normalizeTypeName(returnType),
        body: '', signatureComments: [], signatureSlotOffset: -1,
        transitionBlankLines: 0,
        terminated: /;\s*$/.test(match[0]),
        trailingParameterComma: /,\s*$/.test(rawParameters)
      }
    });
  }

  const typePattern = '(?:array\\s+of\\s+)*(?:[%A-Za-z_][%A-Za-z0-9_]*(?::[%A-Za-z_][%A-Za-z0-9_]*)*)';
  const propertyPattern = new RegExp(
    `\\bproperty\\s+(${typePattern})\\s+([A-Za-z_][A-Za-z0-9_]*#?)\\s*(readonly|get(?:\\s+set)?|set(?:\\s+get)?)?\\s*;`,
    'gi'
  );
  for (const match of unitRegion.matchAll(propertyPattern)) {
    const modifiers = (match[3]?.replace(/\s+/g, ' ').trim().toLowerCase().split(' ').filter(Boolean) ?? []) as Array<'readonly' | 'get' | 'set'>;
    const mode: ApplicationClassStorageMember['mode'] =
      modifiers.includes('readonly') ? 'readonly' :
      modifiers.includes('get') && modifiers.includes('set') ? 'get-set' :
      modifiers.includes('get') ? 'get' : 'plain';
    pending.push({
      index: match.index ?? 0,
      member: {
        kind: 'property', type: normalizeTypeName(match[1]), name: match[2],
        mode, modifiers, visibility: 'public', sourceOrder: -1,
        declarationOrdinal: -1
      }
    });
  }

  const instancePattern = new RegExp(`\\binstance\\s+(${typePattern})\\s+([^;]+?)(?:;|$)`, 'gim');
  for (const match of unitRegion.matchAll(instancePattern)) {
    const names = match[2].match(/&[A-Za-z0-9_][A-Za-z0-9_]*#?/g) ?? [];
    if (names.length === 0) return undefined;
    pending.push({ index: match.index ?? 0, instanceNames: names });
    for (const name of names) {
      pending.push({
        index: match.index ?? 0,
        member: {
          kind: 'instance', type: normalizeTypeName(match[1]), name: name.slice(1),
          mode: 'plain', modifiers: [], visibility: 'private', sourceOrder: -1,
          declarationOrdinal: -1
        }
      });
    }
  }

  for (const match of unitRegion.matchAll(/\bconstant\s+(&?[A-Za-z_][A-Za-z0-9_#]*)\s*=\s*([^;]*);/gi)) {
    pending.push({
      index: match.index ?? 0,
      member: {
        kind: 'constant', name: match[1], sourceOrder: -1,
        value: rawUnitRegion.slice(match.index ?? 0, (match.index ?? 0) + match[0].length)
          .replace(/^[\s\S]*?=/, '').replace(/;\s*$/, '').trim(),
        visibility: 'public'
      }
    });
  }

  // Stable sort keeps an instance statement immediately ahead of its flattened
  // metadata members at the same source coordinate.
  pending.sort((a, b) => a.index - b.index);
  let visibility: ApplicationClassVisibility = 'public';
  let sourceOrder = 0;
  const members: ApplicationClassMember[] = [];
  const statements: ApplicationClassStatement[] = [];
  const seenInstanceStatements = new Set<number>();
  for (const event of pending) {
    if (event.visibility) {
      visibility = event.visibility;
      if (visibility !== 'public') {
        statements.push({ kind: 'visibility', visibility, sourceIndex: unitRegionStart + event.index });
      }
      continue;
    }
    if (event.instanceNames && !seenInstanceStatements.has(event.index)) {
      const first = pending.find(candidate => candidate.index === event.index && candidate.member?.kind === 'instance')?.member;
      if (first?.kind !== 'instance') return undefined;
      statements.push({
        kind: 'instance-statement', type: first.type, names: event.instanceNames,
        sourceIndex: unitRegionStart + event.index
      });
      seenInstanceStatements.add(event.index);
      continue;
    }
    if (!event.member) continue;
    event.member.sourceOrder = sourceOrder++;
    if (event.member.kind !== 'instance') event.member.visibility = visibility;
    members.push(event.member);
    if (event.member.kind !== 'instance') statements.push(event.member);
  }

  let methodOrdinal = 0;
  let storageOrdinal = 0;
  for (const member of members) {
    if (member.kind === 'method') member.declarationOrdinal = methodOrdinal++;
    else if (member.kind === 'instance' || (member.kind === 'property' && ['plain', 'readonly'].includes(member.mode))) {
      member.declarationOrdinal = storageOrdinal++;
    }
  }

  const implementationRegion = masked.slice(unitEnd);
  const rawImplementationRegion = source.slice(unitEnd);
  const pattern = /\b(method|get|set)\s+([A-Za-z_][A-Za-z0-9_$]*)([\s\S]*?)\bend-(method|get|set)\s*;/gid;
  const implementations: Array<ApplicationClassImplementation & { localIndex: number; fullEnd: number }> = [];
  for (const match of implementationRegion.matchAll(pattern)) {
    const kind = match[1].toLowerCase() as 'method' | 'get' | 'set';
    if (match[4].toLowerCase() !== kind) continue;
    const indices = (match as RegExpMatchArray & { indices: Array<[number, number]> }).indices;
    const [interiorStart, interiorEnd] = indices[3];
    const interior = implementationRegion.slice(interiorStart, interiorEnd);
    const signatureComments: string[] = [];
    let cursor = 0;
    while (true) {
      const whitespace = /^[ \t]*(?:\r?\n[ \t]*)*/.exec(interior.slice(cursor))?.[0].length ?? 0;
      const commentStart = cursor + whitespace;
      if (!interior.startsWith('/+', commentStart)) break;
      const commentEnd = interior.indexOf('+/', commentStart + 2);
      if (commentEnd < 0) break;
      signatureComments.push(interior.slice(commentStart + 2, commentEnd).trim());
      cursor = commentEnd + 2;
    }
    implementations.push({
      kind, name: match[2], sourceIndex: unitEnd + (match.index ?? 0),
      body: rawImplementationRegion.slice(interiorStart + cursor, interiorEnd),
      signatureComments, transitionBlankLines: 0,
      localIndex: match.index ?? 0, fullEnd: (match.index ?? 0) + match[0].length
    });
  }
  for (let index = 0; index + 1 < implementations.length; index++) {
    const gap = rawImplementationRegion.slice(implementations[index].fullEnd, implementations[index + 1].localIndex);
    if (/(?:\r?\n)[ \t]*(?:\r?\n)/.test(gap)) {
      implementations[index].transitionBlankLines = Math.max(1, (gap.match(/\r?\n/g) ?? []).length - 1);
    }
  }

  const methods = members.filter((member): member is ApplicationClassMethodMember => member.kind === 'method');
  const methodQueues = new Map<string, ApplicationClassMethodMember[]>();
  for (const method of methods) {
    const key = method.name.toLowerCase();
    methodQueues.set(key, [...(methodQueues.get(key) ?? []), method]);
  }
  let implementationOrder = 0;
  for (const implementation of implementations) {
    if (implementation.kind !== 'method') continue;
    const queue = methodQueues.get(implementation.name.toLowerCase());
    const method = queue?.shift();
    if (!method) continue;
    method.implementationOrder = implementationOrder++;
    method.body = implementation.body;
    method.signatureComments = implementation.signatureComments;
    method.transitionBlankLines = implementation.transitionBlankLines;
  }

  let slotOffset = 0;
  for (const method of [...methods].sort((a, b) => a.declarationOrdinal - b.declarationOrdinal)) {
    method.signatureSlotOffset = slotOffset;
    slotOffset += method.parameters.length + 1;
  }

  return {
    unitKind, className: unitStartMatch[2], extendsType,
    implementsType: implementsTypes[0], members, statements,
    implementations: implementations.map(({ localIndex: _localIndex, fullEnd: _fullEnd, ...implementation }) => implementation),
    unitStart, unitEnd
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
