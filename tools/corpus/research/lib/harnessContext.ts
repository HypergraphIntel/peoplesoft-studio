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
import { snapshotConditionalCompilation } from '../../snapshot/toolsRelease';
import { encodeProgramArtifacts as committedEncodeProgramArtifacts } from '../../../../src/peoplecode/encoder';
import { decodeProgram } from '../../../../src/peoplecode/decoder';
import { NameTable } from '../../../../src/peoplecode/progtext';
import type { ApplicationClassTypeMetadataProvider } from '../../../../src/peoplecode/applicationClassTypeMetadata';
import type { ConditionalCompilationOptions } from '../../../../src/peoplecode/conditionalCompilation';

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

export interface HarnessContext {
  definitions: SnapshotDefinition[];
  applicationClassTypeMetadata: ApplicationClassTypeMetadataProvider;
  conditionalCompilation: ConditionalCompilationOptions | undefined;
}

export function openHarnessContext(): HarnessContext {
  const db = openSnapshotDatabase();
  return {
    definitions: listSnapshotDefinitions(db),
    applicationClassTypeMetadata: snapshotApplicationClassTypeMetadata(db),
    conditionalCompilation: snapshotConditionalCompilation(db)
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
  return {
    recordName: recordIndex >= 0 ? values[recordIndex] : values[0],
    fieldName: fieldIndex >= 0 ? values[fieldIndex] : values[1],
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
      applicationClassTypeMetadata: ctx.applicationClassTypeMetadata,
      conditionalCompilation: ctx.conditionalCompilation,
      onExternalMetadataFallback: () => { fallback = true; },
      ...extra
    } as any);
    return { artifacts, fallback };
  } catch (error: any) {
    return { error: String(error?.message ?? error), fallback };
  }
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
