/*
 * Cycle 123: the one harness-equivalent encode / decode context for
 * research tools.
 *
 * Research tools that build their own encode context drift from the
 * harness (Cycle 110: a census without the snapshot metadata provider
 * reported a population the harness does not have). Every durable
 * research tool should take its context from here:
 *
 *   - owner: the OBJECTID 1 / 2 values (else OBJECTVALUE 1 / 2), and the
 *     package path = every OBJECTVALUE before `OnExecute` -- exactly as
 *     `tools/corpus/validator.ts` builds `encodeContext`;
 *   - the snapshot Application Class type-metadata provider (Cycle 107);
 *   - the snapshot conditional-compilation release (Cycle 115);
 *   - the decoder in `auto` mode with the stored PSPCMNAME table.
 *
 * Reference keys follow `cycle73-nonexact-taxonomy.ts`'s comparator (the
 * taxonomy's own definition of "references exact").
 */
import { openSnapshotDatabase } from '../../snapshot/store';
import { listSnapshotDefinitions, type SnapshotDefinition } from '../../snapshot/reader';
import { snapshotApplicationClassTypeMetadata } from '../../snapshot/applicationClassTypeMetadata';
import { snapshotToolsRelease } from '../../snapshot/toolsRelease';
import { encodeProgramArtifacts as committedEncodeProgramArtifacts } from '../../../../src/peoplecode/encoder';
import { decodeProgram as committedDecodeProgram } from '../../../../src/peoplecode/decoder';
import { NameTable } from '../../../../src/peoplecode/progtext';
import type { ApplicationClassTypeMetadataProvider } from '../../../../src/peoplecode/applicationClassTypeMetadata';
import { compilerProfileForToolsRelease, type CompilerProfile } from '../../../../src/peoplecode/compilerProfile';

export const PROGRAM_HEADER_LENGTH = 37;

/*
 * `RESEARCH_ENCODER_MODULE` (a module path under src/peoplecode, e.g.
 * `encoder-xyz`) runs an observational encoder variant through the exact
 * same harness context; unset, the committed encoder is used.
 */
const encodeProgramArtifacts: typeof committedEncodeProgramArtifacts = process.env.RESEARCH_ENCODER_MODULE
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ? require(`../../../../src/peoplecode/${process.env.RESEARCH_ENCODER_MODULE}`).encodeProgramArtifacts
  : committedEncodeProgramArtifacts;
/* `RESEARCH_DECODER_MODULE` does the same for an observational decoder variant (Cycle 125). */
const decodeProgram: typeof committedDecodeProgram = process.env.RESEARCH_DECODER_MODULE
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ? require(`../../../../src/peoplecode/${process.env.RESEARCH_DECODER_MODULE}`).decodeProgram
  : committedDecodeProgram;

export interface HarnessContext {
  definitions: SnapshotDefinition[];
  /** The snapshot's metadata universe (research scripts may wrap it). */
  applicationClassTypeMetadata: ApplicationClassTypeMetadataProvider;
  /** The snapshot's PeopleTools release (HCDEV: 8.61), when recorded. */
  toolsRelease: string | undefined;
}

export function openHarnessContext(): HarnessContext {
  const db = openSnapshotDatabase();
  return {
    definitions: listSnapshotDefinitions(db),
    applicationClassTypeMetadata: snapshotApplicationClassTypeMetadata(db),
    toolsRelease: snapshotToolsRelease(db)
  };
}

/**
 * Cycle 184: the compiler profile the harness encodes under -- the
 * snapshot's release (PT861 for HCDEV) with the context's current metadata
 * universe. Built per call, so a research wrapper of the provider applies.
 */
export function harnessCompilerProfile(ctx: HarnessContext): CompilerProfile | undefined {
  return ctx.toolsRelease === undefined ? undefined : compilerProfileForToolsRelease(ctx.toolsRelease, { applicationClassTypeMetadata: ctx.applicationClassTypeMetadata });
}

/*
 * One effective compile context for an encode: `extra.profile` when given;
 * otherwise a profile translated from legacy `conditionalCompilation` /
 * `applicationClassTypeMetadata` overrides, else the context's. The legacy
 * fields passed along are derived from that same profile (an observational
 * RESEARCH_ENCODER_MODULE may predate profiles), so they never disagree.
 */
function compileContext(ctx: HarnessContext, extra: Record<string, unknown>): Record<string, unknown> {
  const { profile: given, conditionalCompilation, applicationClassTypeMetadata, ...rest } = extra as {
    profile?: CompilerProfile; conditionalCompilation?: { toolsRelease: string }; applicationClassTypeMetadata?: ApplicationClassTypeMetadataProvider;
  } & Record<string, unknown>;
  if (given !== undefined && (conditionalCompilation !== undefined || applicationClassTypeMetadata !== undefined)) {
    throw new Error('encodeAsHarness: pass a profile or legacy release / metadata overrides, not both');
  }
  const metadata = 'applicationClassTypeMetadata' in extra ? applicationClassTypeMetadata : ctx.applicationClassTypeMetadata;
  const toolsRelease = conditionalCompilation?.toolsRelease ?? ctx.toolsRelease;
  const profile = given ?? (toolsRelease === undefined ? undefined : compilerProfileForToolsRelease(toolsRelease, metadata !== undefined ? { applicationClassTypeMetadata: metadata } : {}));
  if (profile === undefined) return { ...rest, ...(metadata !== undefined ? { applicationClassTypeMetadata: metadata } : {}) };
  return {
    ...rest,
    profile,
    conditionalCompilation: { toolsRelease: profile.toolsRelease },
    applicationClassTypeMetadata: profile.applicationClassTypeMetadata
  };
}

export const isApplicationClass = (def: SnapshotDefinition): boolean => (def as any).objectid1 === 104;

/** The harness owner (validator.ts `encodeContext.owner`). */
export function harnessOwner(def: SnapshotDefinition) {
  const d = def as any;
  const values = [d.objectvalue1, d.objectvalue2, d.objectvalue3, d.objectvalue4, d.objectvalue5, d.objectvalue6, d.objectvalue7]
    .map((v: string | null | undefined) => String(v ?? '').trim());
  const ids = [d.objectid1, d.objectid2, d.objectid3, d.objectid4, d.objectid5, d.objectid6, d.objectid7];
  const eventIndex = values.findIndex(v => v.toLowerCase() === 'onexecute');
  const recordIndex = ids.findIndex(id => id === 1);
  const fieldIndex = ids.findIndex(id => id === 2);
  // Cycle 146: a key without OBJECTID 1 / 2 has a blank owner record /
  // field (stored `REC.` / `.`); Application Classes keep their values.
  const appClass = d.objectid1 === 104;
  return {
    recordName: recordIndex >= 0 ? values[recordIndex] : appClass ? values[0] : '',
    fieldName: fieldIndex >= 0 ? values[fieldIndex] : appClass ? values[1] : '',
    packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean)
  };
}

export interface HarnessEncode {
  artifacts?: ReturnType<typeof encodeProgramArtifacts>;
  error?: string;
  fallback: boolean;
}

/** Encode exactly as the harness does; `extra` adds observational hooks only. */
export function encodeAsHarness(ctx: HarnessContext, def: SnapshotDefinition, extra: Record<string, unknown> = {}): HarnessEncode {
  let fallback = false;
  try {
    const artifacts = encodeProgramArtifacts(def.sourceText, {
      owner: harnessOwner(def),
      applicationClassDefinition: isApplicationClass(def),
      onExternalMetadataFallback: () => { fallback = true; },
      ...compileContext(ctx, extra)
    } as any);
    return { artifacts, fallback };
  } catch (error: any) {
    return { error: String(error?.message ?? error), fallback };
  }
}

/**
 * The harness roundtrip: decode the stored program, encode the decoded text
 * in the harness context; exact when the re-encoded bytes equal stored.
 */
export function roundtripAsHarness(ctx: HarnessContext, def: SnapshotDefinition): { decodedText?: string; exact: boolean; error?: string } {
  let decoded: ReturnType<typeof decodeAsHarness>;
  try {
    decoded = decodeAsHarness(def, def.storedProgram, storedNameTable(def));
  } catch (error: any) {
    return { exact: false, error: String(error?.message ?? error) };
  }
  // validator.ts TEST B: the decoded comment opcodes travel with the re-encode
  const commentOpcodes = decoded.tokens.map(token => token.opcode).filter(opcode => opcode === 0x24 || opcode === 0x4e);
  const encoded = encodeAsHarness(ctx, { ...(def as any), sourceText: decoded.text } as SnapshotDefinition, { commentOpcodes });
  return { decodedText: decoded.text, exact: encoded.artifacts !== undefined && Buffer.compare(encoded.artifacts.program, def.storedProgram) === 0, error: encoded.error };
}

/** The stored PSPCMNAME table, keyed by NAMENUM (1-based). */
export function storedNameTable(def: SnapshotDefinition): NameTable {
  const names = new NameTable();
  for (const row of (def as any).names) {
    const rec = String(row.recname ?? '').trim(), ref = String(row.refname ?? '').trim();
    names.add(Number(row.namenum), rec && ref ? `${rec}.${ref}` : ref || rec);
  }
  return names;
}

/** A generated reference list as a name table: NAMENUM = reference index + 1. */
export function generatedNameTable(references: readonly any[]): NameTable {
  const names = new NameTable();
  for (const r of references) {
    const key = generatedReferenceKey(r);
    names.add(Number(r.index) + 1, key === '.' ? '' : key.replace(/\.$/, ''));
  }
  return names;
}

export function decodeAsHarness(def: SnapshotDefinition, program: Buffer, names: NameTable) {
  return decodeProgram(program, names, { mode: 'auto', isApplicationClass: isApplicationClass(def) } as any);
}

/** `cycle73-nonexact-taxonomy.ts` gKeyOf. */
export function generatedReferenceKey(g: any): string {
  const up = (v: unknown) => String(v ?? '').toUpperCase();
  switch (g.kind) {
    case 'owner': return (g.recordName || g.fieldName) ? `${up(g.recordName)}.${up(g.fieldName)}` : '.';
    case 'package': return `PACKAGE.${up(g.packageName)}`;
    case 'scroll': return `SCROLL.${up(g.recordName)}`;
    case 'record': return `RECORD.${up(g.recordName)}`;
    case 'field': return `FIELD.${up(g.fieldName)}`;
    case 'record-field': return `${up(g.recordName)}.${up(g.fieldName)}`;
    case 'component': return `COMPONENT.${up(g.objectName)}`;
    case 'declare-function': return `${up(g.recordName)}.${up(g.fieldName)}`;
    case 'quoted-reference': return `${up(g.recordName)}.${up(g.fieldName)}`;
    default: return JSON.stringify(g);
  }
}

/** `cycle73-nonexact-taxonomy.ts` sKeyOf, in NAMENUM order. */
export function storedReferenceKeys(def: SnapshotDefinition): string[] {
  return [...(def as any).names]
    .sort((a: any, b: any) => Number(a.namenum) - Number(b.namenum))
    .map((row: any) => `${String(row.recname ?? '').trim().toUpperCase()}.${String(row.refname ?? '').trim().toUpperCase()}`);
}

/** The kind of a reference key, as the taxonomy groups it. */
export function referenceKeyKind(key: string | undefined): string {
  if (key === undefined) return 'none';
  const head = key.split('.')[0];
  if (['PACKAGE', 'RECORD', 'FIELD', 'SCROLL', 'COMPONENT', 'PAGE', 'MENUNAME', 'SQL', 'IMAGE', 'BARNAME', 'ITEMNAME', 'OPERATION', 'MESSAGE', 'HTML', 'URL', 'FILELAYOUT', 'BUSPROCESS', 'BUSACTIVITY', 'QUERY', 'NODE', 'INTERLINK', 'STYLESHEET', 'MOBILEPAGE', 'PANELGROUP', 'PANEL', 'ANALYTICMODEL'].includes(head)) return head;
  return key === '.' ? 'owner' : 'REC.FIELD';
}
