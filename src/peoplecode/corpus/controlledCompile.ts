/*
 * Cycle 172: ingest controlled-compile results.
 *
 * A controlled compile is a program saved by Application Designer in a
 * writable PeopleTools lab (docs/CONTROLLED_COMPILE_LAB.md) and read back
 * from PSPCMPROG / PSPCMNAME. This module compares such a capture with
 * this repository's decoder and encoder and with the candidate models an
 * experiment names. It needs no database: the input is the capture
 * itself (definition key, source, program bytes, PSPCMNAME rows).
 *
 * The encode context is the corpus harness's (tools/corpus/validator.ts,
 * tools/corpus/research/lib/harnessContext.ts): the owner and package
 * path from the key, Application Class mode for OBJECTID1 104, the
 * captured Application Classes of the same lab as type metadata, and the
 * lab's PeopleTools release for conditional compilation.
 *
 * Nothing here changes encoder behavior. A model that every experiment of
 * a family is consistent with -- with at least one positive and one
 * control experiment observed -- is a candidate for a rule, not a rule.
 */
import { createHash } from 'node:crypto';

import { decodeProgram } from '../decoder.js';
import { encodeProgramArtifacts, isBuiltinObjectTypeName, type PeopleCodeReference } from '../encoder.js';
import { NameTable } from '../progtext.js';
import {
  createApplicationClassTypeMetadataProvider,
  type ApplicationClassDefinition
} from '../applicationClassTypeMetadata.js';
import { compareBuffers } from './binaryDiff.js';
import { sourcesMatch } from './sourceNormalize.js';
import type { BinaryDiff } from './types.js';

export const CONTROLLED_COMPILE_RESULTS_FORMAT = 'pcode-lab-results/1';
export const CONTROLLED_COMPILE_EXPERIMENTS_FORMAT = 'pcode-lab-experiments/1';

const APPLICATION_CLASS_OBJECT_ID = 104;

/** PSPCMPROG / PSPCMNAME / PSPCMTXT key: OBJECTID1..7, OBJECTVALUE1..7. */
export interface ControlledCompileKey {
  objectIds: number[];
  objectValues: string[];
}

export interface ControlledCompileNameRow {
  namenum: number;
  recname: string;
  refname: string;
  packageroot?: string;
  qualifypath?: string;
  appclassmethod?: string;
}

export interface ControlledCompileDefinition {
  /** The experiment the definition was saved for; support classes have none. */
  experimentId?: string;
  key: ControlledCompileKey;
  /** PSPCMTXT.PCTEXT as captured. */
  source: string;
  /** PSPCMPROG.PROGTXT, PROGSEQ order, concatenated, hex. */
  programHex: string;
  /** PSPCMNAME rows. */
  names: ControlledCompileNameRow[];
  /** MAX(PSPCMPROG.LASTUPDDTTM) for the key, ISO 8601, when captured. */
  compiledAt?: string;
}

export interface ControlledCompileResults {
  format: typeof CONTROLLED_COMPILE_RESULTS_FORMAT;
  lab: {
    /** The lab database's name; never HCDEV or another institutional database. */
    database: string;
    /** PSSTATUS.TOOLSREL, e.g. "8.61". */
    toolsRelease: string;
    /** PSSTATUS.PTPATCHREL, e.g. 15. */
    patch?: number;
    capturedAt?: string;
  };
  definitions: ControlledCompileDefinition[];
}

/**
 * What an experiment reads from the capture.
 *
 * - `order`: the relative NAMENUM order of `keys` (those present).
 * - `presence`: which of `keys` have a row at all.
 *   Keys are `RECNAME.REFNAME`, upper case (`PACKAGE.CHILD`, `RECORD.X`,
 *   `FIELD.Y`, `REC.FIELD`), as the corpus taxonomy compares them.
 * - `member-form`: for every occurrence, in program order, of a member
 *   named in `keys` (`ZZ_LAB_VAL`): `NAME:ref` when the program writes it
 *   as a reference operand (0x4A), `NAME:recfield` as a `REC.FIELD`
 *   reference (0x21), `NAME:inline` when it writes the name itself (0x0A;
 *   10860's `Call_Link` and 15598's top-level code store these where the
 *   encoder writes 0x4A).
 */
export interface ExperimentObservation {
  type: 'order' | 'presence' | 'member-form';
  keys: string[];
}

export interface ExperimentSpec {
  id: string;
  /** The program family the experiment informs (`30124`, `10860/15598`, `confirmation`). */
  family: string;
  /** `positive`: the corpus shape; `control`: one condition changed. */
  role: 'positive' | 'control';
  variation: string;
  key: ControlledCompileKey;
  source: string;
  observe: ExperimentObservation;
  /**
   * Model name -> its predicted observation: the keys in order (`order`)
   * or the keys present (`presence`); null when the model predicts
   * nothing for this experiment.
   */
  models: Record<string, string[] | null>;
  /**
   * For a corpus replica: the observation the corpus program stores. A
   * replica that does not reproduce it is not a faithful replica, or the
   * lab compiler differs from the one that compiled the corpus.
   */
  corpusExpectation?: string[];
}

export interface SupportDefinition {
  key: ControlledCompileKey;
  source: string;
  note?: string;
}

export interface ExperimentPack {
  format: typeof CONTROLLED_COMPILE_EXPERIMENTS_FORMAT;
  /** Cycle 175: the pipeline smoke definition, compiled before any experiment. */
  smoke?: { id: string; key: ControlledCompileKey; source: string; note?: string };
  supportDefinitions: SupportDefinition[];
  experiments: ExperimentSpec[];
}

export type ModelVerdict = 'consistent' | 'refuted' | 'not-applicable';

export interface DefinitionComparison {
  experimentId?: string;
  keyDescription: string;
  applicationClass: boolean;
  storedProgramBytes: number;
  /** sha256 of the source text, the program bytes and the canonical PSPCMNAME rows. */
  hashes: { source: string; program: string; names: string };
  /** Stored references in NAMENUM order. */
  storedReferences: string[];
  /** NAMENUM -> key. */
  nameNumMap: Record<number, string>;
  /** Stored references in the order the program first uses them (0x21 / 0x48 / 0x4A operands). */
  firstUseOrder: string[];
  decode: { ok: boolean; text?: string; matchesSource?: boolean; unknownOpcodes?: number; error?: string };
  encode: {
    ok: boolean;
    error?: string;
    externalMetadataFallback: boolean;
    generatedReferences?: string[];
    bytes?: BinaryDiff;
    referencesExact?: boolean;
    /** First NAMENUM (1-based) where stored and generated references differ. */
    firstReferenceDifference?: { nameNum: number; stored?: string; generated?: string };
  };
  observation?: {
    type: ExperimentObservation['type'];
    stored: string[];
    generated?: string[];
    /** `member-form` only: the forms with the NAMENUM each reference used (reuse vs a new row). */
    storedDetail?: string[];
    generatedDetail?: string[];
    encoderAgrees?: boolean;
    /** Present for a corpus replica: whether the lab reproduced the corpus observation. */
    replicaReproduced?: boolean;
    models: Record<string, ModelVerdict>;
  };
}

export interface FamilySummary {
  family: string;
  experiments: string[];
  missing: string[];
  /** Model -> verdicts across the family's observed experiments. */
  models: Record<string, { consistent: string[]; refuted: string[]; notApplicable: string[] }>;
  /**
   * Models consistent with every observed experiment that predicts, with
   * >= 1 positive and >= 1 control among them. Empty while a replica is
   * not reproduced: the lab compiler then does not reproduce the corpus
   * program from its source, so no model of that source explains it.
   */
  candidates: string[];
  encoderDisagrees: string[];
  /** Replicas whose lab observation differs from the corpus program's. */
  replicasNotReproduced: string[];
}

export interface ControlledCompileReport {
  lab: ControlledCompileResults['lab'];
  definitions: DefinitionComparison[];
  families: FamilySummary[];
}

const trimmed = (value: unknown): string => String(value ?? '').trim();

export function describeKey(key: ControlledCompileKey): string {
  return key.objectValues.map(trimmed).filter(Boolean).join('.');
}

const sameKey = (a: ControlledCompileKey, b: ControlledCompileKey): boolean =>
  a.objectIds.length === b.objectIds.length &&
  a.objectIds.every((id, i) => Number(id) === Number(b.objectIds[i]) &&
    trimmed(a.objectValues[i]).toUpperCase() === trimmed(b.objectValues[i]).toUpperCase());

export const isApplicationClassKey = (key: ControlledCompileKey): boolean =>
  Number(key.objectIds[0]) === APPLICATION_CLASS_OBJECT_ID;

/** The harness owner (`harnessContext.ts` harnessOwner, `validator.ts` encodeContext.owner). */
export function ownerOfKey(key: ControlledCompileKey) {
  const values = key.objectValues.map(trimmed);
  const ids = key.objectIds.map(Number);
  const eventIndex = values.findIndex(v => v.toLowerCase() === 'onexecute');
  const recordIndex = ids.findIndex(id => id === 1);
  const fieldIndex = ids.findIndex(id => id === 2);
  const appClass = isApplicationClassKey(key);
  return {
    recordName: recordIndex >= 0 ? values[recordIndex] : appClass ? values[0] : '',
    fieldName: fieldIndex >= 0 ? values[fieldIndex] : appClass ? values[1] : '',
    packagePath: values.slice(0, eventIndex < 0 ? values.length : eventIndex).filter(Boolean)
  };
}

/** `RECNAME.REFNAME`, upper case: the taxonomy's stored-row key. */
export const nameRowKey = (row: ControlledCompileNameRow): string =>
  `${trimmed(row.recname).toUpperCase()}.${trimmed(row.refname).toUpperCase()}`;

/** The taxonomy's generated-reference key (`cycle73-nonexact-taxonomy.ts` gKeyOf). */
export function generatedReferenceKey(reference: PeopleCodeReference): string {
  const up = (v: unknown) => String(v ?? '').toUpperCase();
  switch (reference.kind) {
    case 'owner': return (reference.recordName || reference.fieldName) ? `${up(reference.recordName)}.${up(reference.fieldName)}` : '.';
    case 'package': return `PACKAGE.${up(reference.packageName)}`;
    case 'scroll': return `SCROLL.${up(reference.recordName)}`;
    case 'record': return `RECORD.${up(reference.recordName)}`;
    case 'field': return `FIELD.${up(reference.fieldName)}`;
    case 'component': return `COMPONENT.${up(reference.objectName)}`;
    default: return `${up(reference.recordName)}.${up(reference.fieldName)}`;
  }
}

/** A generated reference as the PSPCMNAME row it stands for (synthetic captures, tests). */
export function referenceToNameRow(reference: PeopleCodeReference): ControlledCompileNameRow {
  const key = generatedReferenceKey(reference);
  const dot = key.indexOf('.');
  return { namenum: reference.sequence, recname: key.slice(0, dot), refname: key.slice(dot + 1) };
}

function nameTable(rows: readonly ControlledCompileNameRow[]): NameTable {
  const names = new NameTable();
  for (const row of rows) {
    const rec = trimmed(row.recname), ref = trimmed(row.refname);
    names.add(Number(row.namenum), rec && ref ? `${rec}.${ref}` : ref || rec);
  }
  return names;
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/**
 * Hashes for a capture:
 * - source: the UTF-8 source text;
 * - program: the PSPCMPROG bytes;
 * - names: the PSPCMNAME rows in NAMENUM order, as JSON of
 *   [namenum, recname, refname, packageroot, qualifypath, appclassmethod],
 *   each value trimmed.
 */
export function captureHashes(definition: ControlledCompileDefinition): { source: string; program: string; names: string } {
  const rows = [...definition.names]
    .sort((a, b) => Number(a.namenum) - Number(b.namenum))
    .map(row => [Number(row.namenum), trimmed(row.recname), trimmed(row.refname), trimmed(row.packageroot), trimmed(row.qualifypath), trimmed(row.appclassmethod)]);
  return {
    source: sha256(Buffer.from(definition.source, 'utf8')),
    program: sha256(Buffer.from(definition.programHex, 'hex')),
    names: sha256(JSON.stringify(rows))
  };
}

export interface LabCompileCheck {
  ok: boolean;
  reasons: string[];
}

/**
 * Whether a capture is the lab compiler's output for `expectedSource`,
 * and not a leftover. It requires:
 * - the captured PSPCMTXT source equals the experiment source (after
 *   normalization);
 * - the program decodes, and the decoded text equals that source;
 * - the program differs from the sentinel (the pristine program the
 *   loader left in place), when one is given;
 * - PSPCMPROG.LASTUPDDTTM is not earlier than the compile start, when
 *   both are known. Both must be read from the database clock (the
 *   orchestrator reads SYSTIMESTAMP before it compiles).
 */
export function checkLabCompile(
  definition: ControlledCompileDefinition,
  expectedSource: string,
  options: { sentinelProgramHex?: string; compileStartedAt?: string } = {}
): LabCompileCheck {
  const reasons: string[] = [];
  if (!sourcesMatch(expectedSource, definition.source)) reasons.push('captured PSPCMTXT source differs from the experiment source');
  if (definition.programHex === '') reasons.push('no PSPCMPROG rows');
  else {
    try {
      const names = nameTable(definition.names);
      const decoded = decodeProgram(Buffer.from(definition.programHex, 'hex'), names, { mode: 'auto', isApplicationClass: isApplicationClassKey(definition.key) });
      if (!sourcesMatch(expectedSource, decoded.text)) reasons.push('the compiled program does not decode to the experiment source');
    } catch (error) {
      reasons.push(`the compiled program does not decode: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (options.sentinelProgramHex !== undefined && options.sentinelProgramHex.toLowerCase() === definition.programHex.toLowerCase()) {
    reasons.push('PSPCMPROG still holds the sentinel (pristine) program: the compiler did not run');
  }
  if (options.compileStartedAt !== undefined && definition.compiledAt !== undefined &&
      Date.parse(definition.compiledAt) < Date.parse(options.compileStartedAt)) {
    reasons.push(`PSPCMPROG.LASTUPDDTTM ${definition.compiledAt} predates the compile start ${options.compileStartedAt}`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** The release `#If #ToolsRel` compares against: major.minor of PSSTATUS.TOOLSREL. */
export function conditionalReleaseOf(toolsRelease: string): string | undefined {
  const match = /^(\d+\.\d+)/.exec(toolsRelease.trim());
  return match === null ? undefined : match[1];
}

/** Application Class path of an App Class key: the values before `OnExecute`. */
const applicationClassPath = (key: ControlledCompileKey): string[] => ownerOfKey(key).packagePath;

const INLINE_MEMBER_OPCODE = 0x0a;
const MEMBER_REFERENCE_OPCODE = 0x4a;
const RECORD_FIELD_REFERENCE_OPCODE = 0x21;

interface MemberToken { opcode: number; text: string; nameNum?: number }

/** `member-form` values with the NAMENUM each reference used (`NAME:ref#12`), program order. */
export function memberForms(tokens: readonly MemberToken[], members: readonly string[]): string[] {
  const wanted = new Set(members.map(m => m.toUpperCase()));
  const forms: string[] = [];
  for (const token of tokens) {
    const text = token.text.toUpperCase();
    if (token.opcode === MEMBER_REFERENCE_OPCODE && token.nameNum !== undefined && wanted.has(text)) {
      forms.push(`${text}:ref#${token.nameNum}`);
    } else if (token.opcode === INLINE_MEMBER_OPCODE && token.nameNum === undefined && wanted.has(text)) {
      forms.push(`${text}:inline`);
    } else if (token.opcode === RECORD_FIELD_REFERENCE_OPCODE && token.nameNum !== undefined && !text.startsWith('SCROLL.')) {
      const member = text.slice(text.lastIndexOf('.') + 1);
      if (text.includes('.') && wanted.has(member)) forms.push(`${member}:recfield#${token.nameNum}`);
    }
  }
  return forms;
}

/** A member form without its NAMENUM, the member upper case (`ZZ_LAB_VAL:ref`). */
const withoutNameNum = (form: string): string => {
  const colon = form.indexOf(':');
  const bare = form.replace(/#\d+$/, '');
  return colon < 0 ? bare.toUpperCase() : `${bare.slice(0, colon).toUpperCase()}:${bare.slice(colon + 1).toLowerCase()}`;
};

function observe(spec: ExperimentObservation, keysInNameNumOrder: readonly string[], tokens?: readonly MemberToken[]): string[] {
  const wanted = spec.keys.map(k => k.toUpperCase());
  if (spec.type === 'member-form') return tokens === undefined ? [] : memberForms(tokens, wanted).map(withoutNameNum);
  if (spec.type === 'presence') return wanted.filter(k => keysInNameNumOrder.includes(k));
  return keysInNameNumOrder.filter((k, i) => wanted.includes(k) && keysInNameNumOrder.indexOf(k) === i);
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function verdict(spec: ExperimentObservation, observed: readonly string[], predicted: readonly string[] | null): ModelVerdict {
  if (predicted === null) return 'not-applicable';
  if (spec.type === 'member-form') return sameList(predicted.map(withoutNameNum), observed.map(withoutNameNum)) ? 'consistent' : 'refuted';
  const expected = predicted.map(k => k.toUpperCase());
  if (spec.type === 'presence') {
    return sameList([...expected].sort(), [...observed].sort()) ? 'consistent' : 'refuted';
  }
  return sameList(expected, observed) ? 'consistent' : 'refuted';
}

export interface CompareOptions {
  /** Overrides the conditional-compilation release derived from `lab.toolsRelease`. */
  conditionalRelease?: string;
}

export function compareControlledCompile(
  results: ControlledCompileResults,
  pack: ExperimentPack | undefined,
  options: CompareOptions = {}
): ControlledCompileReport {
  if (results.format !== CONTROLLED_COMPILE_RESULTS_FORMAT) {
    throw new Error(`Unsupported results format ${String(results.format)}; expected ${CONTROLLED_COMPILE_RESULTS_FORMAT}.`);
  }
  const experiments = new Map((pack?.experiments ?? []).map(e => [e.id, e]));
  const experimentOf = (definition: ControlledCompileDefinition): ExperimentSpec | undefined =>
    (definition.experimentId !== undefined ? experiments.get(definition.experimentId) : undefined) ??
    pack?.experiments.find(e => sameKey(e.key, definition.key));

  /* Type metadata: the lab's own captured classes; the pack's support sources only for classes not captured. */
  const classSources = new Map<string, ApplicationClassDefinition>();
  for (const support of pack?.supportDefinitions ?? []) {
    if (isApplicationClassKey(support.key)) {
      const path = applicationClassPath(support.key);
      classSources.set(path.join(':').toUpperCase(), { path, source: support.source });
    }
  }
  for (const definition of results.definitions) {
    if (isApplicationClassKey(definition.key)) {
      const path = applicationClassPath(definition.key);
      classSources.set(path.join(':').toUpperCase(), { path, source: definition.source });
    }
  }
  const metadata = createApplicationClassTypeMetadataProvider(classSources.values(), { isBuiltinType: isBuiltinObjectTypeName });
  const release = options.conditionalRelease ?? conditionalReleaseOf(results.lab.toolsRelease);

  const definitions = results.definitions.map((definition): DefinitionComparison => {
    const experiment = experimentOf(definition);
    const applicationClass = isApplicationClassKey(definition.key);
    const program = Buffer.from(definition.programHex, 'hex');
    const rows = [...definition.names].sort((a, b) => Number(a.namenum) - Number(b.namenum));
    const storedReferences = rows.map(nameRowKey);
    const nameNumMap: Record<number, string> = {};
    for (const row of rows) nameNumMap[Number(row.namenum)] = nameRowKey(row);

    const comparison: DefinitionComparison = {
      experimentId: experiment?.id ?? definition.experimentId,
      keyDescription: describeKey(definition.key),
      applicationClass,
      storedProgramBytes: program.length,
      hashes: captureHashes(definition),
      storedReferences,
      nameNumMap,
      firstUseOrder: [],
      decode: { ok: false },
      encode: { ok: false, externalMetadataFallback: false }
    };

    let storedTokens: MemberToken[] | undefined;
    let generatedTokens: MemberToken[] | undefined;
    try {
      const decoded = decodeProgram(program, nameTable(rows), { mode: 'auto', isApplicationClass: applicationClass });
      storedTokens = decoded.tokens;
      const seen = new Set<number>();
      for (const token of decoded.tokens) {
        if (token.nameNum === undefined || seen.has(token.nameNum)) continue;
        seen.add(token.nameNum);
        comparison.firstUseOrder.push(nameNumMap[token.nameNum] ?? `#${token.nameNum}`);
      }
      comparison.decode = {
        ok: true,
        text: decoded.text,
        matchesSource: sourcesMatch(definition.source, decoded.text),
        unknownOpcodes: decoded.unknownOpcodes.length
      };
    } catch (error) {
      comparison.decode = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    let generated: string[] | undefined;
    try {
      let fallback = false;
      const owner = ownerOfKey(definition.key);
      const artifacts = encodeProgramArtifacts(definition.source, {
        owner,
        applicationClassDefinition: applicationClass,
        applicationClassTypeMetadata: metadata,
        ...(release !== undefined ? { conditionalCompilation: { toolsRelease: release } } : {}),
        onExternalMetadataFallback: () => { fallback = true; }
      });
      generated = [...artifacts.references].sort((a, b) => a.sequence - b.sequence).map(generatedReferenceKey);
      try {
        generatedTokens = decodeProgram(artifacts.program, nameTable(artifacts.references.map(referenceToNameRow)), { mode: 'auto', isApplicationClass: applicationClass }).tokens;
      } catch {
        generatedTokens = undefined;
      }
      let firstReferenceDifference: DefinitionComparison['encode']['firstReferenceDifference'];
      for (let i = 0; i < Math.max(generated.length, storedReferences.length); i++) {
        if (generated[i] !== storedReferences[i]) {
          firstReferenceDifference = { nameNum: i + 1, stored: storedReferences[i], generated: generated[i] };
          break;
        }
      }
      comparison.encode = {
        ok: true,
        externalMetadataFallback: fallback,
        generatedReferences: generated,
        bytes: compareBuffers(program, artifacts.program),
        referencesExact: firstReferenceDifference === undefined,
        ...(firstReferenceDifference !== undefined ? { firstReferenceDifference } : {})
      };
    } catch (error) {
      comparison.encode = { ok: false, externalMetadataFallback: false, error: error instanceof Error ? error.message : String(error) };
    }

    if (experiment !== undefined) {
      const stored = observe(experiment.observe, storedReferences, storedTokens);
      const generatedObservation = generated !== undefined ? observe(experiment.observe, generated, generatedTokens) : undefined;
      const models: Record<string, ModelVerdict> = {};
      for (const [model, predicted] of Object.entries(experiment.models)) {
        models[model] = verdict(experiment.observe, stored, predicted);
      }
      const memberForm = experiment.observe.type === 'member-form';
      comparison.observation = {
        type: experiment.observe.type,
        stored,
        ...(memberForm && storedTokens !== undefined ? { storedDetail: memberForms(storedTokens, experiment.observe.keys) } : {}),
        ...(memberForm && generatedTokens !== undefined ? { generatedDetail: memberForms(generatedTokens, experiment.observe.keys) } : {}),
        ...(generatedObservation !== undefined ? {
          generated: generatedObservation,
          encoderAgrees: verdict(experiment.observe, stored, generatedObservation) === 'consistent'
        } : {}),
        ...(experiment.corpusExpectation !== undefined ? {
          replicaReproduced: verdict(experiment.observe, stored, experiment.corpusExpectation) === 'consistent'
        } : {}),
        models
      };
    }
    return comparison;
  });

  const families = new Map<string, ExperimentSpec[]>();
  for (const experiment of pack?.experiments ?? []) {
    families.set(experiment.family, [...(families.get(experiment.family) ?? []), experiment]);
  }
  const summaries: FamilySummary[] = [...families].map(([family, specs]) => {
    const observed = specs
      .map(spec => ({ spec, comparison: definitions.find(d => d.experimentId === spec.id && d.observation !== undefined) }))
      .filter((entry): entry is { spec: ExperimentSpec; comparison: DefinitionComparison } => entry.comparison !== undefined);
    const models: FamilySummary['models'] = {};
    for (const spec of specs) {
      for (const model of Object.keys(spec.models)) models[model] ??= { consistent: [], refuted: [], notApplicable: [] };
    }
    for (const { spec, comparison } of observed) {
      for (const [model, result] of Object.entries(comparison.observation!.models)) {
        const bucket = models[model];
        if (result === 'consistent') bucket.consistent.push(spec.id);
        else if (result === 'refuted') bucket.refuted.push(spec.id);
        else bucket.notApplicable.push(spec.id);
      }
    }
    const roleOf = new Map(specs.map(s => [s.id, s.role]));
    const replicasNotReproduced = observed.filter(o => o.comparison.observation!.replicaReproduced === false).map(o => o.spec.id);
    const candidates = replicasNotReproduced.length > 0 ? [] : Object.entries(models)
      .filter(([, v]) => v.refuted.length === 0 &&
        v.consistent.some(id => roleOf.get(id) === 'positive') &&
        v.consistent.some(id => roleOf.get(id) === 'control'))
      .map(([model]) => model);
    return {
      family,
      experiments: specs.map(s => s.id),
      missing: specs.filter(s => !observed.some(o => o.spec.id === s.id)).map(s => s.id),
      models,
      candidates,
      encoderDisagrees: observed.filter(o => o.comparison.observation!.encoderAgrees === false).map(o => o.spec.id),
      replicasNotReproduced
    };
  });

  return { lab: results.lab, definitions, families: summaries };
}

/**
 * The encoder's own output for every support definition and experiment, in
 * the results format: what the lab would return if the encoder were the
 * compiler. Used for the encoder's predictions before a lab run and for
 * tests of this module; never evidence.
 */
export function synthesizeResults(
  pack: ExperimentPack,
  lab: ControlledCompileResults['lab'] = { database: 'SYNTHETIC', toolsRelease: '8.61' }
): ControlledCompileResults {
  const classes: ApplicationClassDefinition[] = [];
  for (const definition of [...pack.supportDefinitions, ...pack.experiments]) {
    if (isApplicationClassKey(definition.key)) classes.push({ path: applicationClassPath(definition.key), source: definition.source });
  }
  const metadata = createApplicationClassTypeMetadataProvider(classes, { isBuiltinType: isBuiltinObjectTypeName });
  const release = conditionalReleaseOf(lab.toolsRelease);
  const synthesize = (key: ControlledCompileKey, source: string, experimentId?: string): ControlledCompileDefinition | undefined => {
    let artifacts: ReturnType<typeof encodeProgramArtifacts>;
    try {
      artifacts = encodeProgramArtifacts(source, {
        owner: ownerOfKey(key),
        applicationClassDefinition: isApplicationClassKey(key),
        applicationClassTypeMetadata: metadata,
        ...(release !== undefined ? { conditionalCompilation: { toolsRelease: release } } : {})
      });
    } catch {
      return undefined; /* the encoder has no prediction; the comparison reports the experiment missing */
    }
    return {
      ...(experimentId !== undefined ? { experimentId } : {}),
      key,
      source,
      programHex: artifacts.program.toString('hex'),
      names: artifacts.references.map(referenceToNameRow)
    };
  };
  return {
    format: CONTROLLED_COMPILE_RESULTS_FORMAT,
    lab,
    definitions: [
      ...pack.supportDefinitions.map(s => synthesize(s.key, s.source)),
      ...pack.experiments.map(e => synthesize(e.key, e.source, e.id))
    ].filter((d): d is ControlledCompileDefinition => d !== undefined)
  };
}
