/**
 * Cycle 21: full residual compiler population census.
 *
 * Read-only. Uses only the latest completed 30,209-definition corpus run,
 * the completed local HCDEV snapshot, and the current local encoder/decoder.
 * It never connects to Oracle and never writes corpus results.
 *
 * Usage:
 *   npx tsx tools/corpus/research/residual-population-analysis.ts
 *   npx tsx tools/corpus/research/residual-population-analysis.ts --csv
 *   npx tsx tools/corpus/research/residual-population-analysis.ts --json
 */

import Database from 'better-sqlite3';

import { decodeProgram } from '../../../src/peoplecode/decoder';
import {
  encodeProgramArtifacts,
  type PeopleCodeOwner,
  type PeopleCodeReference
} from '../../../src/peoplecode/encoder';
import {
  PROGRAM_HEADER_LENGTH,
  readProgramLayout,
  type ProgramLayout
} from '../../../src/peoplecode/programLayout';
import { NameTable } from '../../../src/peoplecode/progtext';
import { getSnapshotDefinition } from '../snapshot/reader';
import { openSnapshotDatabase } from '../snapshot/store';
import type { SnapshotDefinition } from '../snapshot/types';

const TOTAL_CORPUS = 30_209;
const APPLICATION_CLASS_OBJECT_ID = 104;

const CLASSIFICATIONS = [
  'ENCODE_ERROR',
  'UNKNOWN_MISMATCH',
  'SOURCE_BODY_MISMATCH',
  'SOURCE_REFERENCE_MISMATCH',
  'ROUNDTRIP_BODY_MISMATCH',
  'ROUNDTRIP_REFERENCE_MISMATCH',
  'DECODE_SOURCE_MISMATCH',
  'DECODE_ERROR',
  'UNKNOWN_OPCODE',
  'UNSUPPORTED_SYNTAX',
  'NO_SOURCE',
  'NO_PROGRAM',
  'OTHER'
] as const;

type SemanticSubsystem =
  | 'parser / grammar coverage'
  | 'statement/expression bytecode layout'
  | 'PSPCMNAME / dependency identity / reference numbering'
  | 'comment / blank-line / structural markers'
  | 'Application Class metadata'
  | 'Application Class executable-body layout'
  | 'native/library declaration metadata'
  | 'preprocessor / compile-time environment'
  | 'owner / package / external context'
  | 'decoder-only issue'
  | 'unknown / unclassified';

interface FullRun {
  runId: number;
  gitCommit: string;
  definitions: number;
  exactCount: number;
  failureCount: number;
}

interface ResidualResult {
  definitionId: number;
  displayName: string;
  objectId1: number;
  classification: string;
  sourceChars: number;
  storedProgramBytes: number;
  generatedProgramBytes?: number;
  pscmnameRows: number;
  decodeSuccess: boolean;
  sourceMatch: boolean;
  sourceEncodeSuccess: boolean;
  sourceEncodeExact: boolean;
  roundtripSuccess: boolean;
  roundtripExact: boolean;
  firstDiffOffset?: number;
  construct?: string;
  errorMessage?: string;
  storedDiffHex?: string;
  generatedDiffHex?: string;
}

interface MeaningfulDiff {
  section: 'header' | 'statements' | 'names' | 'records' | 'slots' | 'none';
  relativeOffset?: number;
  storedAbsoluteOffset?: number;
  generatedAbsoluteOffset?: number;
  storedByte?: number;
  generatedByte?: number;
  storedWindow?: string;
  generatedWindow?: string;
  storedLength: number;
  generatedLength: number;
}

interface CensusRow extends ResidualResult {
  definitionType: string;
  isApplicationClass: boolean;
  source: string;
  rootFamily: string;
  subsystem: SemanticSubsystem;
  confidence: 'high' | 'medium' | 'low';
  understood: boolean;
  signature: string;
  sourceContext: string;
  meaningfulDiff?: MeaningfulDiff;
  generatedReferenceCount?: number;
  preprocessor: boolean;
  nativeLibraryDeclaration: boolean;
  commentBearing: boolean;
  packageOrApplicationClassDependency: boolean;
}

interface FamilySummary {
  family: string;
  subsystem: SemanticSubsystem;
  count: number;
  residualPercent: number;
  totalPercent: number;
  confidence: string;
  understood: number;
  signatures: number;
  representatives: Array<{
    definitionId: number;
    displayName: string;
    sourceContext: string;
  }>;
}

interface BucketSummary {
  subsystem: SemanticSubsystem;
  count: number;
  residualPercent: number;
  signatures: number;
  understood: number;
  unknown: number;
  largestFamily: number;
  priorModel: string;
}

interface StoredTokenContext {
  display?: string;
  referenceKind?: string;
}

function percentage(value: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((100 * value / denominator).toFixed(2));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = key(value);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return new Map([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function definitionType(objectId1: number): string {
  switch (objectId1) {
    case 1: return 'Record PeopleCode';
    case 3: return 'Menu PeopleCode';
    case 9: return 'Page PeopleCode';
    case 10: return 'Component PeopleCode';
    case 60: return 'Message/Subscription PeopleCode';
    case 66: return 'Application Engine PeopleCode';
    case 74: return 'Component Interface PeopleCode';
    case APPLICATION_CLASS_OBJECT_ID: return 'Application Class PeopleCode';
    default: return `Object ${objectId1}`;
  }
}

function ownerContext(definition: SnapshotDefinition): PeopleCodeOwner {
  const values = [
    definition.objectvalue1,
    definition.objectvalue2,
    definition.objectvalue3,
    definition.objectvalue4,
    definition.objectvalue5,
    definition.objectvalue6,
    definition.objectvalue7
  ].map(value => value.trim());
  const eventIndex = values.findIndex(value => value.toLowerCase() === 'onexecute');
  return {
    recordName: values[0],
    fieldName: values[1],
    packagePath: values
      .slice(0, eventIndex < 0 ? values.length : eventIndex)
      .filter(Boolean)
  };
}

function firstDifference(a: Buffer, b: Buffer): number | undefined {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index++) {
    if (a[index] !== b[index]) return index;
  }
  return a.length === b.length ? undefined : shared;
}

function hexWindow(bytes: Buffer, offset: number, radius = 10): string {
  const start = Math.max(0, offset - radius);
  const end = Math.min(bytes.length, offset + radius + 1);
  return bytes.subarray(start, end).toString('hex');
}

function section(bytes: Buffer, layout: ProgramLayout, name: 'statements' | 'names' | 'records' | 'slots'): Buffer {
  const target = layout[name];
  return bytes.subarray(target.offset, target.offset + target.byteLength);
}

function meaningfulDiff(stored: Buffer, generated: Buffer): MeaningfulDiff {
  let storedLayout: ProgramLayout;
  let generatedLayout: ProgramLayout;
  try {
    storedLayout = readProgramLayout(stored);
    generatedLayout = readProgramLayout(generated);
  } catch {
    const offset = firstDifference(stored, generated);
    return {
      section: 'header',
      relativeOffset: offset,
      storedAbsoluteOffset: offset,
      generatedAbsoluteOffset: offset,
      storedByte: offset === undefined ? undefined : stored[offset],
      generatedByte: offset === undefined ? undefined : generated[offset],
      storedWindow: offset === undefined ? undefined : hexWindow(stored, offset),
      generatedWindow: offset === undefined ? undefined : hexWindow(generated, offset),
      storedLength: stored.length,
      generatedLength: generated.length
    };
  }

  for (const name of ['statements', 'names', 'records', 'slots'] as const) {
    const storedSection = section(stored, storedLayout, name);
    const generatedSection = section(generated, generatedLayout, name);
    const offset = firstDifference(storedSection, generatedSection);
    if (offset === undefined) continue;
    const storedAbsoluteOffset = storedLayout[name].offset + offset;
    const generatedAbsoluteOffset = generatedLayout[name].offset + offset;
    return {
      section: name,
      relativeOffset: offset,
      storedAbsoluteOffset,
      generatedAbsoluteOffset,
      storedByte: storedSection[offset],
      generatedByte: generatedSection[offset],
      storedWindow: hexWindow(storedSection, offset),
      generatedWindow: hexWindow(generatedSection, offset),
      storedLength: storedSection.length,
      generatedLength: generatedSection.length
    };
  }

  const headerOffset = firstDifference(
    stored.subarray(0, PROGRAM_HEADER_LENGTH),
    generated.subarray(0, PROGRAM_HEADER_LENGTH)
  );
  return {
    section: headerOffset === undefined ? 'none' : 'header',
    relativeOffset: headerOffset,
    storedAbsoluteOffset: headerOffset,
    generatedAbsoluteOffset: headerOffset,
    storedByte: headerOffset === undefined ? undefined : stored[headerOffset],
    generatedByte: headerOffset === undefined ? undefined : generated[headerOffset],
    storedWindow: headerOffset === undefined ? undefined : hexWindow(stored, headerOffset),
    generatedWindow: headerOffset === undefined ? undefined : hexWindow(generated, headerOffset),
    storedLength: stored.length,
    generatedLength: generated.length
  };
}

function byteLabel(value: number | undefined): string {
  return value === undefined ? 'EOF' : `0x${value.toString(16).padStart(2, '0')}`;
}

function sourceSnippet(source: string, offset: number | undefined, radius = 90): string {
  if (offset === undefined || !Number.isInteger(offset) || offset < 0) {
    return source.slice(0, radius * 2).replace(/\s+/g, ' ').trim();
  }
  return source
    .slice(Math.max(0, offset - radius), Math.min(source.length, offset + radius))
    .replace(/\s+/g, ' ')
    .trim();
}

function errorOffset(message: string | undefined): number | undefined {
  const value = /source offset (\d+)/i.exec(message ?? '')?.[1];
  return value === undefined ? undefined : Number(value);
}

function hasPreprocessor(source: string): boolean {
  return /(^|\n)\s*#(?:if|else|end-if|toolsrel|define|undef|ifdef|ifndef)\b/im.test(source);
}

function hasNativeLibraryDeclaration(source: string): boolean {
  return /\bDeclare\s+Function\b[\s\S]{0,600}?\bLibrary\b/i.test(source);
}

function hasPackageOrApplicationClassDependency(source: string): boolean {
  return /\b(?:import|create)\s+[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+|\b(?:Local|Component|Global|Function|Returns|As)\b[^;\n]{0,200}[A-Za-z_][A-Za-z0-9_]*:[A-Za-z_]/i.test(source);
}

function applicationClassScopeFamily(source: string): string {
  if (/\binterface\b/i.test(source)) return 'Application Class statement grammar: interface';
  if (/\b(?:extends|implements)\b/i.test(source)) return 'Application Class statement grammar: extends/implements';
  if (/\b(?:property|instance)\b/i.test(source)) return 'Application Class statement grammar: property/instance';
  if (/\babstract\b/i.test(source)) return 'Application Class statement grammar: abstract member';
  if (/\bconstant\b/i.test(source)) return 'Application Class statement grammar: constant';
  return 'Application Class method-body grammar';
}

function normalizedErrorFamily(row: ResidualResult, definition: SnapshotDefinition): {
  family: string;
  subsystem: SemanticSubsystem;
  confidence: 'high' | 'medium' | 'low';
  understood: boolean;
  signature: string;
} {
  const source = definition.sourceText;
  const message = row.errorMessage ?? '(missing error message)';
  const normalized = message
    .replace(/source offset \d+/gi, 'source offset <n>')
    .replace(/\b\d+\b/g, '<n>');

  if (hasPreprocessor(source)) {
    return {
      family: 'preprocessor / #ToolsRel compile-time branch',
      subsystem: 'preprocessor / compile-time environment',
      confidence: 'high',
      understood: true,
      signature: normalized
    };
  }
  if (hasNativeLibraryDeclaration(source)) {
    return {
      family: 'native Declare Function ... Library metadata',
      subsystem: 'native/library declaration metadata',
      confidence: 'high',
      understood: false,
      signature: normalized
    };
  }
  if (definition.objectid1 === APPLICATION_CLASS_OBJECT_ID) {
    return {
      family: applicationClassScopeFamily(source),
      subsystem: 'Application Class executable-body layout',
      confidence: 'high',
      understood: /(?:interface|extends\/implements|property\/instance|abstract member|constant)$/.test(applicationClassScopeFamily(source)),
      signature: normalized
    };
  }
  if (/unknown opcode|unknown token/i.test(message)) {
    return {
      family: 'unknown opcode/token',
      subsystem: 'unknown / unclassified',
      confidence: 'high',
      understood: false,
      signature: normalized
    };
  }
  if (/bare identifiers are only supported as calls/i.test(message)) {
    return {
      family: 'unsupported expression/postfix: bare identifier',
      subsystem: 'parser / grammar coverage',
      confidence: 'high',
      understood: true,
      signature: normalized
    };
  }
  if (/expected an ASCII &variable/i.test(message)) {
    return {
      family: 'declaration grammar: noncanonical/comment-interleaved variable list',
      subsystem: 'parser / grammar coverage',
      confidence: 'high',
      understood: true,
      signature: normalized
    };
  }
  if (/expected When, When-Other, or End-Evaluate/i.test(message)) {
    return {
      family: 'disabled-code block inside Evaluate',
      subsystem: 'parser / grammar coverage',
      confidence: 'high',
      understood: true,
      signature: normalized
    };
  }
  if (/expected Then/i.test(message)) {
    return {
      family: 'expression grammar: cast/member expression before Then',
      subsystem: 'parser / grammar coverage',
      confidence: 'medium',
      understood: true,
      signature: normalized
    };
  }
  if (/keyword catch is not a supported call name/i.test(message)) {
    return {
      family: 'Try/Catch statement grammar',
      subsystem: 'parser / grammar coverage',
      confidence: 'high',
      understood: true,
      signature: normalized
    };
  }
  if (/unsupported PeopleCode statement/i.test(message)) {
    const offset = errorOffset(message);
    const tail = source.slice(offset ?? 0).trimStart();
    const word = /^[#A-Za-z_%][A-Za-z0-9_%-]*/.exec(tail)?.[0];
    const token = word?.toLowerCase() ?? (
      tail.startsWith(';') ? 'orphan/extra statement terminator' :
      tail.startsWith('(') ? 'parenthesized expression/create' :
      tail.startsWith('<*') || tail.startsWith('*>') ? 'disabled-code delimiter' :
      'punctuation/unknown'
    );
    return {
      family: `unsupported top-level statement: ${token}`,
      subsystem: 'parser / grammar coverage',
      confidence: 'high',
      understood: token !== 'punctuation/unknown',
      signature: normalized
    };
  }
  if (/Unsupported function metadata type|Unsupported Function parameter/i.test(message)) {
    return {
      family: 'Function/native signature metadata',
      subsystem: 'native/library declaration metadata',
      confidence: 'high',
      understood: false,
      signature: normalized
    };
  }
  if (/expected .* after|expected .* before|expected ;|expected \)|expected End-|parser/i.test(message)) {
    return {
      family: 'parser boundary / unsupported nested syntax',
      subsystem: 'parser / grammar coverage',
      confidence: 'medium',
      understood: false,
      signature: normalized
    };
  }
  if (/unsupported/i.test(message)) {
    return {
      family: 'unsupported expression/declaration form',
      subsystem: 'parser / grammar coverage',
      confidence: 'medium',
      understood: false,
      signature: normalized
    };
  }
  return {
    family: 'parser failure: other diagnosed boundary',
    subsystem: 'parser / grammar coverage',
    confidence: 'medium',
    understood: false,
    signature: normalized
  };
}

function localStatementBytes(definition: SnapshotDefinition, generated: Buffer, diff: MeaningfulDiff): {
  stored: Buffer;
  generated: Buffer;
  offset: number;
} | undefined {
  if (diff.section !== 'statements' || diff.relativeOffset === undefined) return undefined;
  try {
    const storedLayout = readProgramLayout(definition.storedProgram);
    const generatedLayout = readProgramLayout(generated);
    return {
      stored: section(definition.storedProgram, storedLayout, 'statements'),
      generated: section(generated, generatedLayout, 'statements'),
      offset: diff.relativeOffset
    };
  } catch {
    return undefined;
  }
}

function classifySuccessfulMismatch(
  row: ResidualResult,
  definition: SnapshotDefinition,
  generated: Buffer,
  diff: MeaningfulDiff,
  storedContext: StoredTokenContext
): {
  family: string;
  subsystem: SemanticSubsystem;
  confidence: 'high' | 'medium' | 'low';
  understood: boolean;
  signature: string;
} {
  if (row.sourceEncodeExact) {
    if (!row.sourceMatch && row.roundtripExact) {
      return {
        family: 'decoder text reconstruction only',
        subsystem: 'decoder-only issue',
        confidence: 'high',
        understood: true,
        signature: `${row.classification}:source exact:roundtrip exact`
      };
    }
    if (!row.sourceMatch) {
      return {
        family: 'decoder semantic roundtrip mismatch',
        subsystem: 'decoder-only issue',
        confidence: 'high',
        understood: false,
        signature: `${row.classification}:source exact:roundtrip ${row.roundtripSuccess ? 'mismatch' : 'error'}`
      };
    }
    return {
      family: 'decoder semantic roundtrip mismatch',
      subsystem: 'decoder-only issue',
      confidence: 'high',
      understood: false,
      signature: `${row.classification}:source exact:roundtrip mismatch`
    };
  }

  if (hasPreprocessor(definition.sourceText)) {
    return {
      family: 'preprocessor / #ToolsRel compile-time branch',
      subsystem: 'preprocessor / compile-time environment',
      confidence: 'high',
      understood: true,
      signature: `${diff.section}:${byteLabel(diff.storedByte)}->${byteLabel(diff.generatedByte)}`
    };
  }

  if (diff.section === 'names' || diff.section === 'records' || diff.section === 'slots') {
    if (definition.objectid1 === APPLICATION_CLASS_OBJECT_ID) {
      return {
        family: `Application Class ${diff.section} metadata`,
        subsystem: 'Application Class metadata',
        confidence: 'high',
        understood: diff.section !== 'records',
        signature: `${diff.section}:${byteLabel(diff.storedByte)}->${byteLabel(diff.generatedByte)}`
      };
    }
    return {
      family: 'Function/native trailer metadata',
      subsystem: 'native/library declaration metadata',
      confidence: 'high',
      understood: false,
      signature: `${diff.section}:${byteLabel(diff.storedByte)}->${byteLabel(diff.generatedByte)}`
    };
  }

  if (diff.section === 'header' || diff.section === 'none') {
    return {
      family: diff.section === 'none' ? 'unclassified exact-section mismatch' : 'program header/layout mismatch',
      subsystem: 'unknown / unclassified',
      confidence: 'low',
      understood: false,
      signature: `${diff.section}:${byteLabel(diff.storedByte)}->${byteLabel(diff.generatedByte)}`
    };
  }

  const local = localStatementBytes(definition, generated, diff);
  const offset = local?.offset ?? 0;
  const stored = local?.stored ?? Buffer.alloc(0);
  const actual = local?.generated ?? Buffer.alloc(0);
  const storedByte = stored[offset];
  const generatedByte = actual[offset];
  const precedingReference = [1, 2].some(back =>
    offset >= back &&
    [0x21, 0x48, 0x4a].includes(stored[offset - back]) &&
    stored[offset - back] === actual[offset - back]
  );

  if (precedingReference) {
    const kind = storedContext.referenceKind ?? 'unresolved reference kind';
    const ownerContext = kind === 'PACKAGE/Application Class' || kind === 'Application Class method';
    return {
      family: `reference index / NAMENUM disagreement: ${kind}`,
      subsystem: ownerContext
        ? 'owner / package / external context'
        : 'PSPCMNAME / dependency identity / reference numbering',
      confidence: 'high',
      understood: false,
      signature: `reference-operand:${kind}:${byteLabel(storedByte)}->${byteLabel(generatedByte)}`
    };
  }
  if ([0x21, 0x48, 0x4a].includes(storedByte) || [0x21, 0x48, 0x4a].includes(generatedByte)) {
    const kind = storedContext.referenceKind ?? 'unresolved reference kind';
    const ownerContext = kind === 'PACKAGE/Application Class' || kind === 'Application Class method';
    return {
      family: `missing/extra reference operand: ${kind}`,
      subsystem: ownerContext
        ? 'owner / package / external context'
        : 'PSPCMNAME / dependency identity / reference numbering',
      confidence: 'high',
      understood: false,
      signature: `reference-opcode:${kind}:${byteLabel(storedByte)}->${byteLabel(generatedByte)}`
    };
  }
  if (storedByte === 0x4f || generatedByte === 0x4f) {
    return {
      family: storedByte === 0x4f ? 'missing 0x4F structural marker' : 'extra 0x4F structural marker',
      subsystem: 'comment / blank-line / structural markers',
      confidence: 'high',
      understood: true,
      signature: `0x4F:${byteLabel(storedByte)}->${byteLabel(generatedByte)}`
    };
  }
  if (storedByte === 0x2d || generatedByte === 0x2d) {
    return {
      family: storedByte === 0x2d ? 'missing 0x2D structural marker' : 'extra 0x2D structural marker',
      subsystem: 'comment / blank-line / structural markers',
      confidence: 'high',
      understood: true,
      signature: `0x2D:${byteLabel(storedByte)}->${byteLabel(generatedByte)}`
    };
  }
  if ([0x24, 0x4e].includes(storedByte) || [0x24, 0x4e].includes(generatedByte)) {
    return {
      family: 'comment opcode/placement mismatch',
      subsystem: 'comment / blank-line / structural markers',
      confidence: 'high',
      understood: false,
      signature: `comment:${byteLabel(storedByte)}->${byteLabel(generatedByte)}`
    };
  }
  if (storedByte === 0x15 || generatedByte === 0x15) {
    return {
      family: 'statement terminator/separator mismatch',
      subsystem: 'statement/expression bytecode layout',
      confidence: 'high',
      understood: false,
      signature: `separator:${byteLabel(storedByte)}->${byteLabel(generatedByte)}`
    };
  }
  if (
    definition.objectid1 === APPLICATION_CLASS_OBJECT_ID &&
    /^\s*(?:\/\*|<\*|\/+)/.test(definition.sourceText)
  ) {
    return {
      family: 'Application Class leading comment/wrapper layout',
      subsystem: 'Application Class executable-body layout',
      confidence: 'high',
      understood: true,
      signature: `appclass-leading-comment:${byteLabel(storedByte)}->${byteLabel(generatedByte)}`
    };
  }
  if (definition.objectid1 === APPLICATION_CLASS_OBJECT_ID) {
    return {
      family: 'Application Class executable-body/wrapper mismatch',
      subsystem: 'Application Class executable-body layout',
      confidence: 'medium',
      understood: false,
      signature: `appclass-statements:${byteLabel(storedByte)}->${byteLabel(generatedByte)}`
    };
  }
  if (hasNativeLibraryDeclaration(definition.sourceText)) {
    return {
      family: 'native Declare Function ... Library layout',
      subsystem: 'native/library declaration metadata',
      confidence: 'high',
      understood: false,
      signature: `native-library:${byteLabel(storedByte)}->${byteLabel(generatedByte)}`
    };
  }
  if (storedByte === 0x0a && [0x01, 0x40].includes(generatedByte)) {
    return {
      family: 'built-in object type/declaration encoding',
      subsystem: 'statement/expression bytecode layout',
      confidence: 'high',
      understood: true,
      signature: `built-in-type:${byteLabel(storedByte)}->${byteLabel(generatedByte)}`
    };
  }
  return {
    family: 'statement/expression opcode/layout mismatch',
    subsystem: 'statement/expression bytecode layout',
    confidence: 'medium',
    understood: false,
    signature: `statement:${byteLabel(storedByte)}->${byteLabel(generatedByte)}`
  };
}

function referenceKind(definition: SnapshotDefinition, nameNum: number): string {
  const row = definition.names.find(name => name.namenum === nameNum);
  if (row === undefined) return 'missing PSPCMNAME row';
  if (row.appclassmethod.trim()) return 'Application Class method';
  if (row.packageroot.trim() || row.qualifypath.trim()) return 'PACKAGE/Application Class';
  const record = row.recname.trim().toUpperCase();
  const reference = row.refname.trim();
  if (['RECORD', 'FIELD', 'SCROLL', 'HTML', 'COMPONENT'].includes(record)) return record;
  if (record && reference) return 'ordinary record-field/owner';
  if (record) return 'record-only';
  if (reference) return 'reference-only';
  return 'blank/other';
}

function nearestStoredToken(definition: SnapshotDefinition, byteOffset: number | undefined): StoredTokenContext {
  if (byteOffset === undefined) return {};
  try {
    const names = new NameTable();
    for (const row of definition.names) {
      const recname = row.recname.trim();
      const refname = row.refname.trim();
      names.add(row.namenum, recname && refname ? `${recname}.${refname}` : refname || recname);
    }
    const decoded = decodeProgram(definition.storedProgram, names, {
      mode: 'auto',
      isApplicationClass: definition.objectid1 === APPLICATION_CLASS_OBJECT_ID
    });
    let nearest = decoded.tokens[0];
    for (const token of decoded.tokens) {
      if (token.offset > byteOffset) break;
      nearest = token;
    }
    if (nearest === undefined) return {};
    return {
      display: `${nearest.text || '(empty)'} @byte ${nearest.offset} opcode=${byteLabel(nearest.opcode)}`,
      referenceKind: nearest.nameNum === undefined
        ? undefined
        : referenceKind(definition, nearest.nameNum)
    };
  } catch {
    return {};
  }
}

function priorModelFor(subsystem: SemanticSubsystem): string {
  switch (subsystem) {
    case 'PSPCMNAME / dependency identity / reference numbering':
      return 'Cycles 4-12 and 19-20 model substantial RECORD/FIELD/HTML identity; residual first-allocation rules remain.';
    case 'comment / blank-line / structural markers':
      return 'Cycles 15-18 model 0x4F/0x2D and Application Class wrapper boundaries; minority placements remain.';
    case 'Application Class metadata':
      return 'Cycle 13 solved flags, descriptors, and most callable ordering; property/interface physical ordering remains open.';
    case 'Application Class executable-body layout':
      return 'Cycles 14-18 cover methods-only classes and wrapper basics; broader class-header/member statements remain unsupported.';
    case 'decoder-only issue':
      return 'Decoder is complete enough to decode all current programs; remaining differences are reconstruction/semantic rendering.';
    case 'preprocessor / compile-time environment':
      return 'No complete compile-time branch/environment model exists.';
    case 'owner / package / external context':
      return 'Package/Application Class dependency rows are decoded, but residual owner-scoped allocation order is not modeled.';
    case 'statement/expression bytecode layout':
      return 'Built-in object type declarations form one concentrated signature; other opcode/layout mismatches remain.';
    default:
      return 'No population-wide model established for this residual bucket.';
  }
}

function summarizeFamilies(rows: readonly CensusRow[]): FamilySummary[] {
  const byFamily = new Map<string, CensusRow[]>();
  for (const row of rows) {
    const values = byFamily.get(row.rootFamily) ?? [];
    values.push(row);
    byFamily.set(row.rootFamily, values);
  }
  return [...byFamily.entries()].map(([family, values]) => ({
    family,
    subsystem: values[0].subsystem,
    count: values.length,
    residualPercent: percentage(values.length, rows.length),
    totalPercent: percentage(values.length, TOTAL_CORPUS),
    confidence: countBy(values, value => value.confidence).keys().next().value ?? 'low',
    understood: values.filter(value => value.understood).length,
    signatures: new Set(values.map(value => value.signature)).size,
    representatives: values.slice(0, 3).map(value => ({
      definitionId: value.definitionId,
      displayName: value.displayName,
      sourceContext: value.sourceContext
    }))
  })).sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
}

function summarizeBuckets(rows: readonly CensusRow[], families: readonly FamilySummary[]): BucketSummary[] {
  const byBucket = new Map<SemanticSubsystem, CensusRow[]>();
  for (const row of rows) {
    const values = byBucket.get(row.subsystem) ?? [];
    values.push(row);
    byBucket.set(row.subsystem, values);
  }
  return [...byBucket.entries()].map(([subsystem, values]) => ({
    subsystem,
    count: values.length,
    residualPercent: percentage(values.length, rows.length),
    signatures: new Set(values.map(value => value.signature)).size,
    understood: values.filter(value => value.understood).length,
    unknown: values.filter(value => !value.understood).length,
    largestFamily: Math.max(...families.filter(family => family.subsystem === subsystem).map(family => family.count)),
    priorModel: priorModelFor(subsystem)
  })).sort((a, b) => b.count - a.count || a.subsystem.localeCompare(b.subsystem));
}

function csv(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function printCounts(title: string, counts: Map<string, number>, total: number, limit = Number.POSITIVE_INFINITY): void {
  console.log(`\n${title}`);
  console.log('count\tresidual%\ttotal%\tlabel');
  for (const [label, count] of [...counts].slice(0, limit)) {
    console.log(`${count}\t${percentage(count, total).toFixed(2)}\t${percentage(count, TOTAL_CORPUS).toFixed(2)}\t${label}`);
  }
  if (counts.size > limit) console.log(`... ${counts.size - limit} additional signatures available with --json or --csv`);
}

function main(): void {
  const resultDb = new Database('tools/corpus/corpus-results.sqlite', { readonly: true });
  const fullRunRow = resultDb.prepare(`
    SELECT run_id, git_commit, definitions, exact_count, failure_count
    FROM corpus_run
    WHERE completed_at IS NOT NULL AND definitions = ?
    ORDER BY run_id DESC
    LIMIT 1
  `).get(TOTAL_CORPUS) as {
    run_id: number;
    git_commit: string;
    definitions: number;
    exact_count: number;
    failure_count: number;
  } | undefined;
  if (fullRunRow === undefined) throw new Error(`No completed ${TOTAL_CORPUS}-definition run found.`);
  const fullRun: FullRun = {
    runId: fullRunRow.run_id,
    gitCommit: fullRunRow.git_commit,
    definitions: fullRunRow.definitions,
    exactCount: fullRunRow.exact_count,
    failureCount: fullRunRow.failure_count
  };

  const resultRows = resultDb.prepare(`
    SELECT
      r.definition_id AS definitionId,
      d.display_name AS displayName,
      d.objectid1 AS objectId1,
      r.classification,
      r.source_chars AS sourceChars,
      r.stored_program_bytes AS storedProgramBytes,
      r.generated_program_bytes AS generatedProgramBytes,
      r.pscmname_rows AS pscmnameRows,
      r.decode_success AS decodeSuccess,
      r.source_match AS sourceMatch,
      r.source_encode_success AS sourceEncodeSuccess,
      r.source_encode_exact AS sourceEncodeExact,
      r.roundtrip_success AS roundtripSuccess,
      r.roundtrip_exact AS roundtripExact,
      r.first_diff_offset AS firstDiffOffset,
      r.construct,
      r.error_message AS errorMessage,
      r.stored_diff_hex AS storedDiffHex,
      r.generated_diff_hex AS generatedDiffHex
    FROM result r
    JOIN definition d USING (definition_id)
    WHERE r.run_id = ? AND r.classification <> 'EXACT'
    ORDER BY r.definition_id
  `).all(fullRun.runId) as Array<Record<string, unknown>>;
  resultDb.close();

  const residualResults: ResidualResult[] = resultRows.map(raw => ({
    definitionId: Number(raw.definitionId),
    displayName: String(raw.displayName),
    objectId1: Number(raw.objectId1),
    classification: String(raw.classification),
    sourceChars: Number(raw.sourceChars),
    storedProgramBytes: Number(raw.storedProgramBytes),
    generatedProgramBytes: raw.generatedProgramBytes === null ? undefined : Number(raw.generatedProgramBytes),
    pscmnameRows: Number(raw.pscmnameRows),
    decodeSuccess: Boolean(raw.decodeSuccess),
    sourceMatch: Boolean(raw.sourceMatch),
    sourceEncodeSuccess: Boolean(raw.sourceEncodeSuccess),
    sourceEncodeExact: Boolean(raw.sourceEncodeExact),
    roundtripSuccess: Boolean(raw.roundtripSuccess),
    roundtripExact: Boolean(raw.roundtripExact),
    firstDiffOffset: raw.firstDiffOffset === null ? undefined : Number(raw.firstDiffOffset),
    construct: raw.construct === null ? undefined : String(raw.construct),
    errorMessage: raw.errorMessage === null ? undefined : String(raw.errorMessage),
    storedDiffHex: raw.storedDiffHex === null ? undefined : String(raw.storedDiffHex),
    generatedDiffHex: raw.generatedDiffHex === null ? undefined : String(raw.generatedDiffHex)
  }));
  if (residualResults.length !== fullRun.failureCount) {
    throw new Error(`Residual population mismatch: rows=${residualResults.length}, run=${fullRun.failureCount}`);
  }

  const snapshotDb = openSnapshotDatabase();
  const census: CensusRow[] = [];
  let reencodeFailures = 0;

  for (const row of residualResults) {
    const definition = getSnapshotDefinition(snapshotDb, row.definitionId);
    const common = {
      ...row,
      definitionType: definitionType(definition.objectid1),
      isApplicationClass: definition.objectid1 === APPLICATION_CLASS_OBJECT_ID,
      source: definition.sourceText,
      preprocessor: hasPreprocessor(definition.sourceText),
      nativeLibraryDeclaration: hasNativeLibraryDeclaration(definition.sourceText),
      commentBearing: /\/\*|<\*|\/\+|(^|\n)\s*REM\b/i.test(definition.sourceText),
      packageOrApplicationClassDependency: hasPackageOrApplicationClassDependency(definition.sourceText)
    };

    if (!row.sourceEncodeSuccess) {
      const classification = normalizedErrorFamily(row, definition);
      census.push({
        ...common,
        rootFamily: classification.family,
        subsystem: classification.subsystem,
        confidence: classification.confidence,
        understood: classification.understood,
        signature: classification.signature,
        sourceContext: sourceSnippet(definition.sourceText, errorOffset(row.errorMessage))
      });
      continue;
    }

    try {
      const encoded = encodeProgramArtifacts(definition.sourceText, {
        owner: ownerContext(definition)
      });
      const diff = meaningfulDiff(definition.storedProgram, encoded.program);
      const tokenContext = nearestStoredToken(definition, diff.storedAbsoluteOffset);
      const classification = classifySuccessfulMismatch(row, definition, encoded.program, diff, tokenContext);
      census.push({
        ...common,
        rootFamily: classification.family,
        subsystem: classification.subsystem,
        confidence: classification.confidence,
        understood: classification.understood,
        signature: classification.signature,
        sourceContext: tokenContext.display ?? sourceSnippet(definition.sourceText, undefined),
        meaningfulDiff: diff,
        generatedReferenceCount: encoded.references.length
      });
    } catch (error) {
      reencodeFailures++;
      census.push({
        ...common,
        rootFamily: 'current re-encode inconsistency',
        subsystem: 'unknown / unclassified',
        confidence: 'high',
        understood: false,
        signature: error instanceof Error ? error.message.replace(/source offset \d+/g, 'source offset <n>') : String(error),
        sourceContext: sourceSnippet(definition.sourceText, undefined)
      });
    }
  }
  snapshotDb.close();

  const families = summarizeFamilies(census);
  const buckets = summarizeBuckets(census, families);
  const classificationCounts = new Map<string, number>();
  for (const classification of CLASSIFICATIONS) classificationCounts.set(classification, 0);
  for (const row of census) {
    const key = CLASSIFICATIONS.includes(row.classification as typeof CLASSIFICATIONS[number])
      ? row.classification
      : 'OTHER';
    classificationCounts.set(key, (classificationCounts.get(key) ?? 0) + 1);
  }
  const topLevelDetails = [...classificationCounts].map(([classification, count]) => {
    const values = census.filter(row => row.classification === classification);
    const typeDistribution = [...countBy(values, value => value.definitionType)].slice(0, 5);
    return {
      classification,
      count,
      residualPercent: percentage(count, census.length),
      totalPercent: percentage(count, TOTAL_CORPUS),
      meanSourceChars: values.length === 0
        ? 0
        : Math.round(values.reduce((sum, value) => sum + value.sourceChars, 0) / values.length),
      medianSourceChars: median(values.map(value => value.sourceChars)),
      typeDistribution
    };
  });

  const firstDivergenceRows = census.filter(row => row.sourceEncodeSuccess && !row.sourceEncodeExact);
  const encodeErrorRows = census.filter(row => !row.sourceEncodeSuccess);
  const unknownRows = census.filter(row => row.subsystem === 'unknown / unclassified');
  const environmentalRows = census.filter(row => row.subsystem === 'preprocessor / compile-time environment');
  const sortedFamilyCounts = families.map(family => family.count);
  const cumulative = (count: number): number => percentage(
    sortedFamilyCounts.slice(0, count).reduce((sum, value) => sum + value, 0),
    census.length
  );
  const singletons = families.filter(family => family.count === 1).length;
  const verySmall = families.filter(family => family.count <= 5).length;

  const knownMeasurements = [
    ['Application Class residuals', census.filter(row => row.isApplicationClass).length],
    ['preprocessor/#ToolsRel source', census.filter(row => row.preprocessor).length],
    ['native Declare Function ... Library source', census.filter(row => row.nativeLibraryDeclaration).length],
    ['reference-numbering root family', census.filter(row => row.subsystem === 'PSPCMNAME / dependency identity / reference numbering').length],
    ['owner/package/external-context root family', census.filter(row => row.subsystem === 'owner / package / external context').length],
    ['comment/blank-line/0x4F/0x2D root family', census.filter(row => row.subsystem === 'comment / blank-line / structural markers').length],
    ['package/Application Class dependency-bearing source', census.filter(row => row.packageOrApplicationClassDependency).length],
    ['unsupported top-level syntax root family', census.filter(row => row.rootFamily.startsWith('unsupported top-level statement')).length],
    ['unsupported expression/postfix root family', census.filter(row => row.rootFamily.startsWith('unsupported expression/postfix')).length],
    ['unknown opcode/token root family', census.filter(row => row.rootFamily === 'unknown opcode/token').length],
    ['environment-dependent root family', environmentalRows.length],
    ['decoder-only root family', census.filter(row => row.subsystem === 'decoder-only issue').length]
  ] as const;

  const candidateOrder: SemanticSubsystem[] = [
    'Application Class executable-body layout',
    'statement/expression bytecode layout',
    'comment / blank-line / structural markers',
    'decoder-only issue',
    'parser / grammar coverage',
    'Application Class metadata',
    'owner / package / external context',
    'native/library declaration metadata',
    'PSPCMNAME / dependency identity / reference numbering',
    'preprocessor / compile-time environment'
  ];
  const candidateNotes: Partial<Record<SemanticSubsystem, [string, string, string, string, string]>> = {
    'Application Class executable-body layout': ['high', 'low-medium', 'high', 'high', 'low (no Application Class is EXACT)'],
    'statement/expression bytecode layout': ['high for built-in-type cluster', 'medium', 'medium-high', 'high', 'medium'],
    'comment / blank-line / structural markers': ['high', 'medium', 'high', 'medium', 'medium'],
    'decoder-only issue': ['high', 'medium', 'medium', 'medium', 'low-medium'],
    'parser / grammar coverage': ['high', 'medium', 'medium', 'medium-high', 'medium'],
    'Application Class metadata': ['high', 'high for known fields', 'low', 'medium-high', 'low'],
    'owner / package / external context': ['high', 'medium', 'high', 'high', 'medium-high'],
    'native/library declaration metadata': ['high', 'low', 'medium', 'medium', 'low-medium'],
    'PSPCMNAME / dependency identity / reference numbering': ['high', 'medium-high but heterogeneous', 'very high', 'high', 'medium-high'],
    'preprocessor / compile-time environment': ['high', 'low', 'high/environmental', 'medium', 'high/environment-dependent']
  };
  const candidates = candidateOrder.map(subsystem => {
    const bucket = buckets.find(item => item.subsystem === subsystem);
    const notes = candidateNotes[subsystem]!;
    return {
      subsystem,
      count: bucket?.count ?? 0,
      residualPercent: percentage(bucket?.count ?? 0, census.length),
      confidence: notes[0],
      currentUnderstanding: notes[1],
      estimatedComplexity: notes[2],
      architecturalLeverage: notes[3],
      exactRegressionRisk: notes[4],
      matchedControls: priorModelFor(subsystem)
    };
  }).filter(candidate => candidate.count > 0);

  const report = {
    run: fullRun,
    residual: census.length,
    reencodeFailures,
    topLevelDetails,
    families,
    buckets,
    knownMeasurements,
    concentration: {
      top1Percent: cumulative(1),
      top3Percent: cumulative(3),
      top5Percent: cumulative(5),
      top10Percent: cumulative(10),
      singletonFamilies: singletons,
      familiesAtMostFive: verySmall,
      unclassifiedDefinitions: unknownRows.length
    },
    candidates,
    environmentalDefinitionIds: environmentalRows.map(row => row.definitionId),
    unclassifiedDefinitionIds: unknownRows.map(row => row.definitionId),
    capabilityCoverage: {
      exact: fullRun.exactCount,
      exactPercent: percentage(fullRun.exactCount, TOTAL_CORPUS),
      sourceEncodeSuccess: TOTAL_CORPUS - census.filter(row => !row.sourceEncodeSuccess).length,
      sourceEncodeSuccessPercent: percentage(TOTAL_CORPUS - census.filter(row => !row.sourceEncodeSuccess).length, TOTAL_CORPUS),
      sourceEncodeExact: TOTAL_CORPUS - census.filter(row => !row.sourceEncodeExact).length,
      sourceEncodeExactPercent: percentage(TOTAL_CORPUS - census.filter(row => !row.sourceEncodeExact).length, TOTAL_CORPUS),
      decodeSourceMatch: TOTAL_CORPUS - census.filter(row => !row.sourceMatch).length,
      decodeSourceMatchPercent: percentage(TOTAL_CORPUS - census.filter(row => !row.sourceMatch).length, TOTAL_CORPUS),
      to90Percent: Math.ceil(TOTAL_CORPUS * 0.90) - fullRun.exactCount,
      to95Percent: Math.ceil(TOTAL_CORPUS * 0.95) - fullRun.exactCount,
      to100Percent: TOTAL_CORPUS - fullRun.exactCount
    }
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ...report, rows: census }, null, 2));
    return;
  }

  console.log('=== Cycle 21 residual compiler population census ===');
  console.log(`Full run: ${fullRun.runId} (${fullRun.gitCommit.slice(0, 7)})`);
  console.log(`Corpus: ${fullRun.exactCount}/${fullRun.definitions} EXACT; residual ${census.length}`);
  console.log(`Current re-encode inconsistencies: ${reencodeFailures}`);

  console.log('\nTop-level classification distribution');
  console.log('count\tresidual%\ttotal%\tmean chars\tmedian chars\tclassification\tmajor types');
  for (const item of topLevelDetails) {
    console.log(`${item.count}\t${item.residualPercent.toFixed(2)}\t${item.totalPercent.toFixed(2)}\t${item.meanSourceChars}\t${item.medianSourceChars}\t${item.classification}\t${item.typeDistribution.map(([type, count]) => `${type}:${count}`).join('; ')}`);
  }

  console.log(`\nFirst-divergence census (${firstDivergenceRows.length} successful source encodes with non-exact PSPCMPROG)`);
  printCounts('First-divergence root families', countBy(firstDivergenceRows, row => row.rootFamily), census.length);
  printCounts('First-divergence structural signatures', countBy(firstDivergenceRows, row => row.signature), census.length, 40);

  console.log(`\nENCODE_ERROR/UNSUPPORTED_SYNTAX census (${encodeErrorRows.length})`);
  printCounts('Normalized encoder failure families', countBy(encodeErrorRows, row => row.rootFamily), census.length);
  printCounts('Normalized encoder error signatures', countBy(encodeErrorRows, row => row.signature), census.length, 40);

  console.log('\nSemantic subsystem buckets');
  console.log('count\tresidual%\tsignatures\tunderstood\tunknown\tlargest family\tsubsystem');
  for (const bucket of buckets) {
    console.log(`${bucket.count}\t${bucket.residualPercent.toFixed(2)}\t${bucket.signatures}\t${bucket.understood}\t${bucket.unknown}\t${bucket.largestFamily}\t${bucket.subsystem}`);
  }

  console.log('\nTop 10 mutually-exclusive root-cause families');
  console.log('count\tresidual%\ttotal%\tsignatures\tconfidence\tfamily\trepresentative ids');
  for (const family of families.slice(0, 10)) {
    console.log(`${family.count}\t${family.residualPercent.toFixed(2)}\t${family.totalPercent.toFixed(2)}\t${family.signatures}\t${family.confidence}\t${family.family}\t${family.representatives.map(item => item.definitionId).join(',')}`);
  }

  console.log('\nExplicit known-family measurements');
  for (const [label, count] of knownMeasurements) {
    console.log(`${count}\t${percentage(count, census.length).toFixed(2)}%\t${label}`);
  }

  console.log('\nConcentration');
  console.log(`Top 1 family: ${report.concentration.top1Percent.toFixed(2)}%`);
  console.log(`Top 3 families: ${report.concentration.top3Percent.toFixed(2)}%`);
  console.log(`Top 5 families: ${report.concentration.top5Percent.toFixed(2)}%`);
  console.log(`Top 10 families: ${report.concentration.top10Percent.toFixed(2)}%`);
  console.log(`Singleton families: ${singletons}`);
  console.log(`Families with <=5 definitions: ${verySmall}`);
  console.log(`Genuinely unclassified definitions: ${unknownRows.length}`);

  console.log('\nRanked Cycle 22 candidate subsystems');
  console.log('rank\tcount\tresidual%\tconfidence\tunderstanding\tcomplexity\tleverage\tregression risk\tsubsystem');
  candidates.forEach((candidate, index) => {
    console.log(`${index + 1}\t${candidate.count}\t${candidate.residualPercent.toFixed(2)}\t${candidate.confidence}\t${candidate.currentUnderstanding}\t${candidate.estimatedComplexity}\t${candidate.architecturalLeverage}\t${candidate.exactRegressionRisk}\t${candidate.subsystem}`);
  });

  console.log('\nCapability coverage and thresholds');
  console.log(`EXACT: ${report.capabilityCoverage.exact}/${TOTAL_CORPUS} (${report.capabilityCoverage.exactPercent.toFixed(2)}%)`);
  console.log(`Source encode succeeds: ${report.capabilityCoverage.sourceEncodeSuccess}/${TOTAL_CORPUS} (${report.capabilityCoverage.sourceEncodeSuccessPercent.toFixed(2)}%)`);
  console.log(`Source encode exact: ${report.capabilityCoverage.sourceEncodeExact}/${TOTAL_CORPUS} (${report.capabilityCoverage.sourceEncodeExactPercent.toFixed(2)}%)`);
  console.log(`Decode source match: ${report.capabilityCoverage.decodeSourceMatch}/${TOTAL_CORPUS} (${report.capabilityCoverage.decodeSourceMatchPercent.toFixed(2)}%)`);
  console.log(`Additional EXACT needed: 90%=${report.capabilityCoverage.to90Percent}, 95%=${report.capabilityCoverage.to95Percent}, 100%=${report.capabilityCoverage.to100Percent}`);

  console.log(`\nEnvironment-dependent definition ids (${environmentalRows.length})`);
  console.log(report.environmentalDefinitionIds.join(','));
  console.log(`\nUnknown/unclassified definition ids (${unknownRows.length})`);
  console.log(report.unclassifiedDefinitionIds.join(','));

  if (process.argv.includes('--csv')) {
    console.log('\nCSV');
    const headers = [
      'definition_id', 'display_name', 'definition_type', 'classification',
      'root_family', 'subsystem', 'confidence', 'understood', 'signature',
      'source_chars', 'stored_program_bytes', 'generated_program_bytes',
      'pscmname_rows', 'first_diff_section', 'first_diff_relative_offset',
      'stored_diff_window', 'generated_diff_window', 'source_context'
    ];
    console.log(headers.join(','));
    for (const row of census) {
      console.log([
        row.definitionId, row.displayName, row.definitionType, row.classification,
        row.rootFamily, row.subsystem, row.confidence, row.understood, row.signature,
        row.sourceChars, row.storedProgramBytes, row.generatedProgramBytes,
        row.pscmnameRows, row.meaningfulDiff?.section,
        row.meaningfulDiff?.relativeOffset, row.meaningfulDiff?.storedWindow,
        row.meaningfulDiff?.generatedWindow, row.sourceContext
      ].map(csv).join(','));
    }
  }
}

main();
