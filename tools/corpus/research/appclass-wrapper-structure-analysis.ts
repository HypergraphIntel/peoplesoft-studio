/**
 * Cycle 17: reverse-engineer the executable/member wrapper structure
 * surrounding Application Class methods and constructors, especially
 * empty bodies. Read-only, no encoder changes.
 *
 * This works directly against STORED PSPCMPROG bytes (ground truth),
 * independent of whether the current encoder can successfully generate
 * a given definition, so the population is not limited to the 154
 * "methods-only" strict-IR subset Cycles 14-16 used. A local, permissive
 * regex extraction (not `parseApplicationClassSource`) locates each
 * method's header declaration and implementation body, tolerating shapes
 * that parser deliberately rejects (interfaces, abstracts, 2+ storage
 * members, etc.) -- this cycle only needs member NAME + BODY TEXT + a
 * class name, nothing else.
 *
 * Method/constructor wrapper bytes are located directly in the STORED
 * bytes by searching for each member's own UTF-16LE name, guarded by a
 * preceding `63 41` window (the same technique validated in Cycle 15's
 * `locateMethodByteRanges`, applied here to stored bytes instead of
 * generated ones).
 *
 * Usage:
 *   npx tsx tools/corpus/research/appclass-wrapper-structure-analysis.ts
 */

import { readProgramLayout } from '../../../src/peoplecode/programLayout';
import { listSnapshotDefinitions } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';
import type { SnapshotDefinition } from '../snapshot/types';

const APPLICATION_CLASS_OBJECT_ID = 104;

interface RawMember {
  name: string;
  headerIndex: number;
  isAbstract: boolean;
  implIndex: number;
  body: string;
  signatureComments: string[];
}

interface RawClass {
  className: string;
  members: RawMember[];
}

function maskCommentsAndStrings(source: string): string {
  const chars = [...source];
  let i = 0;
  while (i < chars.length) {
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
          if (chars[i] === '"') { chars[i++] = ' '; continue; }
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

/**
 * Permissive extraction: class name, header method declarations (name +
 * abstract flag, in header/declaration order), and implementation bodies
 * (name + signature comments + raw body text, in physical/source order).
 * Unlike `parseApplicationClassSource`, this does NOT reject interfaces,
 * abstract methods, 2+ storage members, or mismatched
 * declaration/implementation counts -- it simply returns whatever it can
 * find, keyed by name, so wrapper-byte analysis can run over the widest
 * possible population. Interfaces (no implementation region) are
 * filtered by the caller via `members.length === 0`.
 */
function extractRawClass(source: string): RawClass | undefined {
  const masked = maskCommentsAndStrings(source);
  const classMatch = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(masked);
  if (!classMatch) return undefined;
  const endClass = /\bend-class\s*;?/i.exec(masked.slice((classMatch.index ?? 0) + classMatch[0].length));
  if (!endClass) return undefined;

  const classRegionStart = (classMatch.index ?? 0) + classMatch[0].length;
  const classRegionEnd = classRegionStart + (endClass.index ?? 0);
  const classRegion = masked.slice(classRegionStart, classRegionEnd);
  const implementationRegionStart = classRegionEnd + endClass[0].length;
  const implementationRegion = masked.slice(implementationRegionStart);
  const rawImplementationRegion = source.slice(implementationRegionStart);

  const headerDeclarations = new Map<string, { index: number; isAbstract: boolean }>();
  for (const match of classRegion.matchAll(
    /\bmethod\s+([A-Za-z_][A-Za-z0-9_$]*)\s*(?:\([^;]*?\))?\s*(?:Returns\s+[^;]+?)?\s*(abstract\s*)?;/gi
  )) {
    headerDeclarations.set(match[1].toLowerCase(), {
      index: match.index ?? 0,
      isAbstract: match[2] !== undefined
    });
  }

  const implementationPattern = /\bmethod\s+([A-Za-z_][A-Za-z0-9_$]*)\s*((?:\/\+[\s\S]*?\+\/\s*)*)([\s\S]*?)\bend-method\s*;/gid;
  const members: RawMember[] = [];
  for (const match of implementationRegion.matchAll(implementationPattern)) {
    const header = headerDeclarations.get(match[1].toLowerCase());
    if (header === undefined) continue; // an implementation with no matching declaration (out of scope)
    const signatureComments = [...match[2].matchAll(/\/\+\s*([\s\S]*?)\s*\+\//g)].map(m => m[1].trim());
    const indices = (match as RegExpMatchArray & { indices: Array<[number, number]> }).indices;
    const [bodyStart, bodyEnd] = indices[3];
    members.push({
      name: match[1],
      headerIndex: header.index,
      isAbstract: header.isAbstract,
      implIndex: match.index ?? 0,
      body: rawImplementationRegion.slice(bodyStart, bodyEnd),
      signatureComments
    });
  }

  return { className: classMatch[1], members };
}

type EmptinessCategory = 'truly-empty' | 'comment-only' | 'non-empty';

function classifyBody(body: string): EmptinessCategory {
  if (body.trim() === '') return 'truly-empty';
  if (maskCommentsAndStrings(body).trim() === '') return 'comment-only';
  return 'non-empty';
}

interface LocatedMember extends RawMember {
  storedStart: number;
  storedEnd: number;
  sourceOrder: number;
  headerOrder: number;
  isConstructor: boolean;
  emptiness: EmptinessCategory;
}

/** Locates each member's `63 41 <introducer> <utf16le name>` start offset
 * directly in STORED bytes, in the order supplied (source/implementation
 * order), then assigns each an end offset (next member's start, or the
 * end of the statements section). */
function locateStoredMemberRanges(
  stored: Buffer,
  statementsEnd: number,
  members: readonly RawMember[]
): Array<{ member: RawMember; start: number; end: number } | undefined> {
  const starts: number[] = [];
  let searchFrom = 0;
  for (const member of members) {
    const namePrefix = Buffer.from(member.name, 'utf16le');
    let at = -1;
    let cursor = searchFrom;
    while (true) {
      const nameAt = stored.indexOf(namePrefix, cursor);
      if (nameAt < 0 || nameAt >= statementsEnd) break;
      const precedingWindow = stored.subarray(Math.max(0, nameAt - 4), nameAt);
      if (precedingWindow.includes(0x41) && precedingWindow.includes(0x63)) {
        at = nameAt - 3;
        break;
      }
      cursor = nameAt + 1;
    }
    starts.push(at);
    if (at >= 0) searchFrom = at + 3 + namePrefix.length;
  }
  return members.map((member, index) => {
    if (starts[index] < 0) return undefined;
    const end = index + 1 < starts.length && starts[index + 1] >= 0 ? starts[index + 1] : statementsEnd;
    return { member, start: starts[index], end };
  });
}

function hex(buffer: Buffer): string {
  return buffer.toString('hex').replace(/(..)/g, '$1 ').trim();
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) {
    const k = key(value);
    result[k] = (result[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1]));
}

interface MemberEvidence {
  definitionId: number;
  className: string;
  name: string;
  isConstructor: boolean;
  emptiness: EmptinessCategory;
  sourceOrder: number;
  memberCount: number;
  wrapperOrderPosition: number;
  matchesSourceOrder: boolean;
  prevKind: 'constructor' | 'method' | 'none';
  prevEmptiness: EmptinessCategory | 'none';
  nextKind: 'constructor' | 'method' | 'none';
  nextEmptiness: EmptinessCategory | 'none';
  isLastInClass: boolean;
  headerBytes: string;
  trailerBytes: string;
  wrapperLength: number;
  bodyByteLength: number;
}

function main(): void {
  const db = openSnapshotDatabase();
  const definitions = listSnapshotDefinitions(db).filter(d => d.objectid1 === APPLICATION_CLASS_OBJECT_ID);
  db.close();

  const evidence: MemberEvidence[] = [];
  let totalClasses = 0;
  let classesWithLocatedAllMembers = 0;
  let classesWithSomeUnlocated = 0;
  const unexplainedShapes: Array<{ id: number; reason: string }> = [];

  for (const definition of definitions) {
    const raw = extractRawClass(definition.sourceText);
    if (raw === undefined || raw.members.length === 0) continue; // interfaces / unparsed / no bodies
    totalClasses++;

    let layout;
    try {
      layout = readProgramLayout(definition.storedProgram);
    } catch {
      unexplainedShapes.push({ id: definition.definitionId, reason: 'unsupported program layout' });
      continue;
    }
    const statementsEnd = layout.names.offset; // includes trailing 0x07

    const membersInSourceOrder = [...raw.members].sort((a, b) => a.implIndex - b.implIndex);
    const located = locateStoredMemberRanges(definition.storedProgram, statementsEnd, membersInSourceOrder);
    if (located.some(item => item === undefined)) {
      classesWithSomeUnlocated++;
      unexplainedShapes.push({ id: definition.definitionId, reason: 'one or more members not located in stored bytes' });
      continue;
    }
    classesWithAllLocated: {
      classesWithLocatedAllMembers++;
    }

    const ranges = located as Array<{ member: RawMember; start: number; end: number }>;
    // Wrapper order = order these members actually appear at in the byte stream.
    const byWrapperStart = [...ranges].sort((a, b) => a.start - b.start);
    const wrapperPositionOf = new Map<RawMember, number>();
    byWrapperStart.forEach((r, index) => wrapperPositionOf.set(r.member, index));

    for (let i = 0; i < ranges.length; i++) {
      const { member, start, end } = ranges[i];
      const emptiness = classifyBody(member.body);
      const isConstructor = member.name.toLowerCase() === raw.className.toLowerCase();
      const prev = i > 0 ? ranges[i - 1].member : undefined;
      const next = i + 1 < ranges.length ? ranges[i + 1].member : undefined;

      const region = definition.storedProgram.subarray(start, end);
      const nameByteLength = member.name.length * 2;
      // Header: 63 41 <introducer> <utf16le name> <null> -- fixed-shape prefix.
      const headerLength = 3 + nameByteLength + 2;
      const headerBytes = region.subarray(0, Math.min(headerLength, region.length));
      const trailerBytes = region.subarray(Math.max(0, region.length - 8));

      evidence.push({
        definitionId: definition.definitionId,
        className: raw.className,
        name: member.name,
        isConstructor,
        emptiness,
        sourceOrder: i,
        memberCount: ranges.length,
        wrapperOrderPosition: wrapperPositionOf.get(member) ?? -1,
        matchesSourceOrder: wrapperPositionOf.get(member) === i,
        prevKind: prev === undefined ? 'none' : prev.name.toLowerCase() === raw.className.toLowerCase() ? 'constructor' : 'method',
        prevEmptiness: prev === undefined ? 'none' : classifyBody(prev.body),
        nextKind: next === undefined ? 'none' : next.name.toLowerCase() === raw.className.toLowerCase() ? 'constructor' : 'method',
        nextEmptiness: next === undefined ? 'none' : classifyBody(next.body),
        isLastInClass: i === ranges.length - 1,
        headerBytes: hex(headerBytes),
        trailerBytes: hex(trailerBytes),
        wrapperLength: end - start,
        bodyByteLength: region.length
      });
    }
  }

  const constructors = evidence.filter(e => e.isConstructor);
  const methods = evidence.filter(e => !e.isConstructor);

  console.log(JSON.stringify({
    population: {
      totalClassesWithBodies: totalClasses,
      classesWithAllMembersLocated: classesWithLocatedAllMembers,
      classesWithSomeUnlocated,
      totalMembersAnalyzed: evidence.length,
      constructors: constructors.length,
      ordinaryMethods: methods.length
    },
    emptinessBreakdown: {
      all: countBy(evidence, e => e.emptiness),
      constructors: countBy(constructors, e => e.emptiness),
      methods: countBy(methods, e => e.emptiness)
    },
    wrapperOrderMatchesSourceOrder: {
      all: countBy(evidence, e => String(e.matchesSourceOrder)),
    },
    headerBytesByEmptinessAndKind: {
      constructorEmpty: countBy(constructors.filter(e => e.emptiness === 'truly-empty'), e => e.headerBytes),
      constructorNonEmpty: countBy(constructors.filter(e => e.emptiness === 'non-empty'), e => e.headerBytes),
      methodEmpty: countBy(methods.filter(e => e.emptiness === 'truly-empty'), e => e.headerBytes),
      methodNonEmpty: countBy(methods.filter(e => e.emptiness === 'non-empty'), e => e.headerBytes)
    },
    trailerBytesByEmptinessAndPosition: {
      emptyNotLast: countBy(evidence.filter(e => e.emptiness === 'truly-empty' && !e.isLastInClass), e => e.trailerBytes),
      emptyLast: countBy(evidence.filter(e => e.emptiness === 'truly-empty' && e.isLastInClass), e => e.trailerBytes),
      nonEmptyNotLast: countBy(evidence.filter(e => e.emptiness === 'non-empty' && !e.isLastInClass), e => e.trailerBytes),
      nonEmptyLast: countBy(evidence.filter(e => e.emptiness === 'non-empty' && e.isLastInClass), e => e.trailerBytes),
      commentOnlyNotLast: countBy(evidence.filter(e => e.emptiness === 'comment-only' && !e.isLastInClass), e => e.trailerBytes),
      commentOnlyLast: countBy(evidence.filter(e => e.emptiness === 'comment-only' && e.isLastInClass), e => e.trailerBytes)
    },
    trailerByNextMemberEmptiness: {
      emptyFollowedByEmpty: countBy(evidence.filter(e => e.emptiness === 'truly-empty' && e.nextEmptiness === 'truly-empty'), e => e.trailerBytes),
      emptyFollowedByNonEmpty: countBy(evidence.filter(e => e.emptiness === 'truly-empty' && e.nextEmptiness === 'non-empty'), e => e.trailerBytes),
      nonEmptyFollowedByEmpty: countBy(evidence.filter(e => e.emptiness === 'non-empty' && e.nextEmptiness === 'truly-empty'), e => e.trailerBytes),
      nonEmptyFollowedByNonEmpty: countBy(evidence.filter(e => e.emptiness === 'non-empty' && e.nextEmptiness === 'non-empty'), e => e.trailerBytes)
    },
    singleMemberClasses: {
      count: evidence.filter(e => e.memberCount === 1).length,
      trailerByEmptiness: countBy(evidence.filter(e => e.memberCount === 1), e => `${e.emptiness}:${e.trailerBytes}`)
    },
    unexplainedShapesCount: unexplainedShapes.length,
    unexplainedShapesSample: unexplainedShapes.slice(0, 15),
    sampleConstructorEmpty: constructors.filter(e => e.emptiness === 'truly-empty').slice(0, 6),
    sampleConstructorNonEmpty: constructors.filter(e => e.emptiness === 'non-empty').slice(0, 6),
    sampleMethodEmpty: methods.filter(e => e.emptiness === 'truly-empty').slice(0, 6),
    sampleCommentOnly: evidence.filter(e => e.emptiness === 'comment-only').slice(0, 10),
    sampleWrapperOrderMismatch: evidence.filter(e => !e.matchesSourceOrder).slice(0, 15)
  }, null, 2));
}

main();
