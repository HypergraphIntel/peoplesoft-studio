import { encodePrimitiveMethodSignature } from './applicationClassMetadata.js';
import type { ApplicationClassMemberType, ApplicationClassTypeMetadataProvider } from './applicationClassTypeMetadata.js';
import {
  APPLICATION_CLASS_FLAGS,
  NO_TYPE_DESCRIPTOR,
  encodeApplicationClassDirectoryRecord,
  encodeApplicationClassNameEntry,
  encodeApplicationClassSlot,
  encodeTypeDescriptor,
  applicationClassHasTrailingSourceTerminator,
  parseApplicationClassSource,
  type ApplicationClassMethodMember,
  type ApplicationClassStorageMember
} from './applicationClassProgram.js';
import { encodeSimpleProgramHeader, PROGRAM_DIRECTORY_SEPARATOR } from './programLayout.js';
import {
  INLINE_IDENTIFIER_OPCODE,
  OPCODES,
  PRIMITIVE_SIGNATURE_TYPE_IDS,
  TEXT_INTRODUCERS,
  TokenKind
} from './format.js';
import { UNSIGNED_NUMBER_FORMAT } from './numberFormats.js';
import {
  ConditionalCompilationError,
  hasConditionalDirectives,
  preprocessConditionalCompilation,
  type ConditionalCompilationOptions,
  type ConditionalDirectiveRegion
} from './conditionalCompilation.js';

const MAX_UNSIGNED_INTEGER = (1n << BigInt(UNSIGNED_NUMBER_FORMAT.valueBytes * 8)) - 1n;
const MAX_INTEGER_DIGITS = MAX_UNSIGNED_INTEGER.toString().length;
const MAX_EXPRESSION_DEPTH = 128;

interface FunctionMetadata {
  name: string;
  parameterTypes: string[];
  returnType?: string;
  hasParameterList: boolean;
}

export interface PeopleCodeReference {
  /** Zero-based PSPCMPROG 0x21 operand; PSPCMNAME sequence is index + 1. */
  index: number;
  /** One-based PSPCMNAME sequence. */
  sequence: number;
  kind: 'owner' | 'record-field' | 'package' | 'record' | 'field' | 'scroll' | 'component' | 'declare-function' | 'quoted-reference';
  recordName?: string;
  fieldName?: string;
  eventName?: string;
  packageName?: string;
  objectName?: string;
  /** Application Package path components, excluding the class name. */
  packagePath?: string[];
  /** Application Class name for PACKAGE dependency rows. */
  className?: string;
  methodName?: string;
}

/**
 * Evidence-backed visibility facade for block-scoped RECORD/SCROLL
 * dependencies.
 *
 * This deliberately owns no storage and does not allocate scope ids. It
 * projects the parser's existing controlGroup/controlDepth state over the
 * existing maps so callers cannot accidentally read a block-scoped pool
 * while no real lexical/control block is open.
 */
interface DependencyScope {
  readonly id: number;
  readonly isOpen: boolean;

  lookupRecord(recordName: string): PeopleCodeReference | undefined;
  recordRecord(
    recordName: string,
    reference: PeopleCodeReference
  ): void;

  lookupScroll(recordName: string): PeopleCodeReference | undefined;
  recordScroll(
    recordName: string,
    reference: PeopleCodeReference
  ): void;
}

/**
 * Cycle 11's evidence-backed FIELD identity namespace.
 *
 * ChainSemantics and DependencyKind decide whether a postfix member is an
 * eligible FIELD dependency before this facade is consulted. This facade
 * answers only whether that FIELD name already has a PSPCMNAME identity in
 * the current compiler control group. Receiver-specific `recordVariableFields`
 * lookup remains outside, and ahead of, this shared name-level namespace.
 */
interface FieldDependencyScope {
  lookupField(fieldName: string): PeopleCodeReference | undefined;
  recordField(fieldName: string, reference: PeopleCodeReference): void;
}

/**
 * Cycle 20's semantic namespace for static `HTML.NAME` dependencies.
 *
 * The serialized artifact remains an ordinary `record-field` reference with
 * `recordName = "HTML"` and `fieldName = NAME`; this facade owns only the
 * independently-evidenced lifetime identity. Its namespace key is supplied by
 * the parser because the lifetime differs by program shape:
 *
 * - one namespace for an entire Application Class compilation unit;
 * - one namespace per ordinary Function body;
 * - one namespace per ordinary top-level control region.
 */
class HtmlDependencyScope {
  private readonly references = new Map<string, PeopleCodeReference>();

  lookup(namespace: string, name: string): PeopleCodeReference | undefined {
    return this.references.get(`${namespace}:${name.toLowerCase()}`);
  }

  record(
    namespace: string,
    name: string,
    reference: PeopleCodeReference
  ): void {
    this.references.set(`${namespace}:${name.toLowerCase()}`, reference);
  }
}

/**
 * Application Class bodies are parsed as separate fragments, but stored
 * PSPCMNAME evidence gives them one compilation-unit reference namespace.
 * A fragment may reuse an identity established by an earlier fragment while
 * retaining all ordinary within-fragment control/receiver scoping rules.
 */
class ApplicationClassReferenceScope {
  private readonly references = new Map<string, PeopleCodeReference>();
  private wildcardImportMetadataAllocated = false;

  beginFragment(): ApplicationClassReferenceSession {
    return {
      lookup: reference =>
        this.references.get(applicationClassReferenceKey(reference)),

      claimWildcardImportMetadata: () => {
        if (this.wildcardImportMetadataAllocated) {
          return false;
        }

        this.wildcardImportMetadataAllocated = true;
        return true;
      }
    };
  }

  commit(references: readonly PeopleCodeReference[]): void {
    for (const reference of references) {
      if (reference.kind === 'owner') continue;

      const key = applicationClassReferenceKey(reference);
      if (!this.references.has(key)) {
        this.references.set(key, reference);
      }
    }
  }
}

/**
 * Cycle 108: the Application Class PACKAGE rows of ONE Application Class
 * PROGRAM -- the lifetime of a method-dependency row there.
 *
 * In an Application Class program a class has ONE row for the whole
 * program. The first occurrence that needs the class opens it -- a type
 * (import, declaration dependency, Local, `create`) or a method call on a
 * receiver of the class -- and every later occurrence reuses it, in any
 * method body, statement or control structure, whatever method it calls.
 * The row's APPCLASSMETHOD (descriptive stores only) is the method of the
 * call that opened it, blank when a type opened it; it is not part of the
 * identity. Ordinary programs scope these rows to the Cycle 94 allocation
 * unit instead (`classRowsByUnit`); this pool is never used there.
 *
 * LOCAL SNAPSHOT (`cycle108-app-class-method-row-census.ts`,
 * `cycle108-app-class-method-row-models.py`; 1,506 Application Class
 * programs, 15,841 typed calls, 2,218 (program, class) groups):
 *
 *   - consecutive calls on one class where the later call is alone in its
 *     gap: 903 reuse, 8 open -- all 8 in 29797 / 29883, programs whose
 *     every row repeats; per body / per called method / per statement
 *     scopes would need 454 / 551 / 674 cross-scope reuses;
 *   - every %Super-property (30), %This-property (105), typed-property
 *     (32) and method-result (24) receiver group stores exactly ONE row,
 *     including 69 groups whose calls span several method bodies and 65
 *     calling several methods; 28927 calls `%Super.TxtCat` eighteen times
 *     (getSimpleTextPlan, getTextPlan; three bodies): one TEXTCATALOG row;
 *   - descriptive stores: 284 call-opened rows carry the opening call's
 *     method, 527 type-opened rows are blank; 393 groups calling several
 *     methods store one row.
 *
 * A row matches by the class NAME (REFNAME), the key the Cycle 57
 * class-wide session already uses: 29422 imports GPS_CAR_REPORT_MANAGER:Utils
 * and creates and calls GPS_WFS_REPORT_MANAGER:Utils, and stores ONE
 * UTILS row (rooted at the import) -- a package-path-aware key reopened it
 * (and 9 more programs' rows, e.g. PTAI_COLLECTION:Collection declared as
 * a built-in-shaped COLLECTION row).
 */
class ApplicationClassProgramRows {
  private readonly rows: PeopleCodeReference[] = [];

  commit(references: readonly PeopleCodeReference[]): void {
    for (const reference of references) {
      if (reference.kind === 'package' && (reference.className ?? reference.packageName ?? '') !== '') this.rows.push(reference);
    }
  }

  /** The program's row of the class, from earlier fragments or `pending` (the current one). */
  find(className: string, pending: readonly PeopleCodeReference[] = []): PeopleCodeReference | undefined {
    const name = className.toLowerCase();
    const matches = (reference: PeopleCodeReference): boolean =>
      reference.kind === 'package' && (reference.className ?? reference.packageName ?? '').toLowerCase() === name;
    return this.rows.find(matches) ?? pending.find(matches);
  }
}

interface ApplicationClassReferenceSession {
  lookup(
    reference: Omit<PeopleCodeReference, 'index' | 'sequence'>
  ): PeopleCodeReference | undefined;

  /**
   * Application Class imports are encoded as independent fragments, but
   * wildcard-import PACKAGE metadata has compilation-unit lifetime.
   *
   * Returns true exactly once for a modeled Application Class compilation
   * unit. Later wildcard-import fragments return false.
   */
  claimWildcardImportMetadata(): boolean;
}


/**
 * Cycle 82: `%This.<ownMethod>(...)` allocates the class's own
 * `PACKAGE|<CLASSNAME>` PSPCMNAME row.
 *
 * Native evidence (pspcm.dll method-call resolver at 0x1804f0e9c, see the
 * progress file's "PcmCompileObject Native Trace"): a method call on an
 * Application Class object builds a PACKAGE row for the receiver's class
 * and adds it to the name table. `%This` is a receiver whose class is the
 * compilation unit itself.
 *
 * Corpus evidence (LOCAL SNAPSHOT, all 1,510 App Classes,
 * `cycle82-self-row-allocation-census.ts`): every class with a live
 * (non-comment) own-method `%This` call has a self row. Inherited
 * `%This.<baseMethod>(...)` calls allocate the SAME self row (28886's
 * first call is the inherited `%This.getDataFromInputJson(...)`; 29341's
 * stored row even names an inherited method). The row is allocated ONCE
 * per class, at the first such call in encode order, unless an own-class
 * PACKAGE identity already exists (then it is reused), and it is never an
 * executable operand -- it only shifts later NAMENUMs.
 *
 * Only the allocation point is modeled. The row's descriptive columns
 * (PACKAGEROOT/QUALIFYPATH/APPCLASSMETHOD) are compile-history content and
 * never reach PSPCMPROG, so the row is emitted as a class-level identity.
 *
 * Out of scope: a handful of programs (29797, 29883, 30170, 30179) key
 * every Application Class method-dependency row per (method body, called
 * method) -- their foreign-class rows repeat the same way -- a separate,
 * unmodeled lifetime family.
 */
interface ApplicationClassSelfMethodDependency {
  isSelfMethodCall(memberName: string): boolean;
  /** Returns the row template on the class's first `%This` method call only. */
  claim(): Omit<PeopleCodeReference, 'index' | 'sequence'> | undefined;
}

function applicationClassReferenceKey(
  reference: Omit<PeopleCodeReference, 'index' | 'sequence'>
): string {
  if (reference.kind === 'package') {
    const packageIdentity = (reference.className ?? reference.packageName ?? '').toLowerCase();
    if (packageIdentity !== '') {
      return JSON.stringify([
        reference.kind,
        packageIdentity,
        reference.methodName?.toLowerCase() ?? ''
      ]);
    }
  }
  const normalizedPath = reference.packagePath?.map(component => component.toLowerCase()) ?? [];
  return JSON.stringify([
    reference.kind,
    reference.recordName?.toLowerCase() ?? '',
    reference.fieldName?.toLowerCase() ?? '',
    reference.eventName?.toLowerCase() ?? '',
    reference.packageName?.toLowerCase() ?? '',
    reference.objectName?.toLowerCase() ?? '',
    normalizedPath,
    reference.className?.toLowerCase() ?? '',
    reference.methodName?.toLowerCase() ?? ''
  ]);
}

/**
 * The semantic result of a postfix expression chain (Cycle 4 research:
 * `.claude/corpus-progress.md`'s "Compiler Semantics Research Cycle 4"
 * section) -- deliberately separate from `DependencyScope`. DependencyScope
 * answers "may an existing reference be reused"; `ChainSemantics` answers
 * two different, earlier questions: what runtime-shaped value does this
 * expression currently hold, and does that value carry enough
 * binding/schema provenance for a following bare `.MEMBER` to be eligible
 * to become a RECORD/FIELD/SCROLL dependency at all (as opposed to staying
 * inline text). Knowing the value type alone is not sufficient for the
 * second question: a `GetRowset()` result assigned to an UNDECLARED
 * variable has the same `rowset` value type whether or not it came from a
 * schema-bearing call, but only the schema-bearing case's later members
 * bind (definition 524 vs. 1721/1722).
 *
 * `binding`/`provenance` are readable at this Phase 5 stage but not
 * wired into any encoding decision -- see `deriveChainSemantics()`'s own
 * comment for exactly which existing classification this mirrors, and
 * what it deliberately leaves unmodeled.
 */
interface ChainSemantics {
  readonly valueType: 'unknown' | 'rowset' | 'row' | 'record' | 'field' | 'scalar';
  readonly binding: 'dynamic' | 'dependency-bound';
  /**
   * Cycle 9 (Phase 9B) adds `'selector'`: the Rowset-selector `(...)`
   * transition's own provenance -- previously represented only as
   * `provenance: 'unknown'` plus a SEPARATE `chainSemanticsBindingUnmodeled`
   * boolean the bare-member eligibility gate consulted alongside
   * `binding`. `'selector'` makes that state explicit and inspectable
   * inside `ChainSemantics` itself, matching this cycle's own directive
   * ("must become representable inside ChainSemantics instead of being
   * marked unmodeled"). See the Rowset-selector transition's own comment
   * for why `binding` still reads `'dynamic'` here (the construct's
   * receiver-provenance rule itself remains unmodeled -- only the LABEL
   * moved, not the underlying uncertainty).
   */
  readonly provenance: 'intrinsic' | 'declared' | 'schema' | 'navigation' | 'selector' | 'unknown';
}

/**
 * Cycle 9 (Phase 9A): the dependency-kind responsibility factored out of
 * `expectedReferenceMember` (see that variable's own comment at its
 * declaration, and Cycle 8's role map in .claude/corpus-progress.md).
 * Answers exactly one question -- "if a postfix member here becomes a
 * new PSPCMNAME dependency, is it a RECORD or a FIELD row" -- and
 * nothing else. Only the two kinds `expectedReferenceMember` ever
 * actually produces are represented; `'none'` stands in for its
 * `undefined`. A `'scroll'` kind is NOT included here: the one site that
 * allocates a SCROLL reference (`scrollReference()`) does not go through
 * `expectedReferenceMember`/`dependencyKind` at all, so inventing a
 * `'scroll'` arm would not be evidenced by any existing code path this
 * cycle touches.
 */
type DependencyKind = 'none' | 'record' | 'field';

export interface PeopleCodeOwner {
  recordName: string;
  fieldName: string;
  /**
   * Cycle 14: the full nested-package path (`objectValue1..7`, stopping
   * before the event name, e.g. `['PKG', 'SubPkg', 'ClassName']`) for an
   * Application Class definition -- `recordName`/`fieldName` alone only
   * carry the first TWO components, which is insufficient for the 46%
   * of Application Class definitions with a nested package path (Cycle
   * 13's own `nestedPackagePath: 702/1510` finding). Undefined (and
   * unused) for ordinary Record.Field-owned PeopleCode.
   */
  packagePath?: readonly string[];
}

export interface ReferenceTraceEvent {
  action: 'ALLOC' | 'USE';

  sourceOffset: number;
  controlGroup: number;
  /** Control-flow nesting depth (If/For/While/Evaluate/etc) at this point. */
  controlDepth: number;
  /** Function/Method body nesting depth at this point. */
  functionDepth: number;

  reference: PeopleCodeReference;
}

/**
 * Cycle 6 (see .claude/corpus-progress.md): a research-only report that
 * `ChainSemantics`'s own binding prediction (derived purely from receiver
 * provenance, per Cycle 4's evidence -- see `deriveChainSemantics`'s own
 * comment) disagreed with what the encoder's EXISTING, unconditional
 * name-based logic actually decided for a bare `.MEMBER` postfix step.
 *
 * Confirmed corpus shape (definitions 1423/1424/1721/1722): a bare,
 * argument-less intrinsic call (`GetRecord()`, `GetRowset()`) with no
 * schema information, or `.ParentRow`/`.ParentRowset` navigation off such
 * a value, has `binding: 'dynamic'` -- calling `.GetRecord(Record.X)` /
 * `.GetRow(...)` on it changes `valueType` but, per Cycle 4, does NOT
 * itself establish binding ("a method name on a dynamic value does not by
 * itself authorize dependency shorthand"). The existing encoder's
 * `expectedReferenceMember` ternary sets `'field'`/`'record'` purely from
 * the METHOD NAME (`GetRecord`/`GetRow`), with no receiver-provenance
 * check at all, so it wrongly treats a subsequent bare member as
 * dependency-eligible in exactly this shape -- the corpus-confirmed
 * bug this diagnostic exists to surface.
 */
export interface ChainSemanticsDiagnostic {
  sourceOffset: number;
  /** The bare member name whose binding eligibility was being decided. */
  member: string;
  /** ChainSemantics' own prediction at this point. */
  predicted: ChainSemantics;
  /** What the existing encoder actually decided (true = treated as a dependency candidate). */
  actualBindingEligible: boolean;
}

/**
 * Research observation of the remaining postfix reuse pools.
 *
 * The callback is deliberately downstream of every existing key choice and
 * Map lookup/write. Consumers can compare authoritative and shadow histories
 * without making the diagnostics part of generated output.
 */
export interface ReusePoolTraceEvent {
  action: 'READ' | 'WRITE';
  pool:
    | 'scopedFieldReferences'
    | 'recordVariableFields'
    | 'rowShorthandRecords';
  site: string;
  key: string;
  sourceOffset: number;
  controlGroup: number;
  controlDepth: number;
  functionDepth: number;
  hit?: boolean;
  reference?: PeopleCodeReference;
}

export interface EncodeProgramContext {
  owner?: PeopleCodeOwner;

  /**
   * Cycle 115: the Tools release `#If #ToolsRel ...` conditional
   * compilation is evaluated against (see `conditionalCompilation.ts`).
   * Without it the source is encoded as before Cycle 115 -- a directive is
   * not understood (an encode error almost everywhere); the encoder never
   * assumes a release.
   */
  conditionalCompilation?: ConditionalCompilationOptions;

  /**
   * Cycle 115, internal: the program's directive regions (absolute
   * offsets in the preprocessed source), set by `encodeProgramArtifacts`.
   */
  conditionalDirectiveRegions?: ReadonlyMap<number, ConditionalDirectiveRegion>;

  /**
   * Cycle 115, internal: the absolute offset of the fragment being
   * encoded within the program source (Application Class member
   * fragments), for `conditionalDirectiveRegions` lookups.
   */
  conditionalDirectiveBase?: number;

  /** Cycle 115, internal: the start of every directive region whose records were written. */
  conditionalDirectiveEmissions?: Set<number>;

  /**
   * Optional diagnostic hook for PSPCMNAME/reference provenance tracing.
   *
   * This callback is observational only. It must never influence encoding.
   */
  referenceTrace?: (
    event: ReferenceTraceEvent
  ) => void;

  /**
   * Optional diagnostic hook reporting a disagreement between
   * `ChainSemantics`'s own binding prediction and the encoder's existing
   * decision for a bare postfix member. See `ChainSemanticsDiagnostic`'s
   * own comment. Purely observational -- never read by any encoding
   * decision, confirmed by a full corpus zero-behavior-change diff (see
   * the progress file).
   */
  chainSemanticsTrace?: (
    event: ChainSemanticsDiagnostic
  ) => void;

  /**
   * Optional Cycle 10 diagnostic hook for reuse-pool population research.
   * Observational only: the callback result is never read.
   */
  reusePoolTrace?: (
    event: ReusePoolTraceEvent
  ) => void;

  /**
   * Original block-comment opcodes, in source order, when re-encoding
   * text produced by decodeProgram().
   *
   * 0x24 = standalone block comment
   * 0x4E = alternate/trailing block-comment representation
   *
   * Ordinary source encoding leaves this undefined and derives the
   * representation from source placement.
   */
  commentOpcodes?: readonly (0x24 | 0x4e)[];

  /**
   * Cycle 14: Application Class method bodies are each their own
   * independent `encodeFragmentInternal` call (own control groups, own
   * reuse pools), but PSPCMPROG reference operands and PSPCMNAME
   * sequence numbers are GLOBAL across the whole compiled program, not
   * per-method. `referenceIndexOffset` shifts every reference this call
   * allocates by that many slots, so a second/third/etc. method's own
   * references continue numbering where the previous method's own
   * references left off. Every existing caller omits this (defaults to
   * 0), so ordinary encoding is unaffected.
   */
  referenceIndexOffset?: number;

  /**
   * Cycle 14: skips pushing the leading placeholder "owner" reference
   * (index 0) that every other `encodeFragmentInternal` call makes
   * unconditionally. An Application Class program has exactly ONE such
   * blank placeholder for the whole program (confirmed: exactly one
   * `blankSentinels` row per definition, Cycle 13's own finding) -- the
   * first method body's own call supplies it; every subsequent method
   * body's call must not add a second one. Every existing caller omits
   * this (defaults to `false`), so ordinary encoding is unaffected.
   */
  suppressOwnerReference?: boolean;

  /**
   * Cycle 14: disables the top-level/Application-Class-Local
   * declaration-SECTION boundary markers (`0x2D`, plus their own
   * blank-line `0x4F` companions) that `encodeFragmentInternal`
   * otherwise emits once, at the transition from a program's leading
   * declaration run into its first executable statement -- see the
   * `closedTopLevelDeclarationSection`/`closedApplicationClassLocalSection`
   * declarations' own comment for the direct evidence this cycle found
   * (the golden OU_CORPUS:Utilities:TestClass fixture's own method body
   * has no such marker, unlike the equivalent ordinary top-level shape).
   * Every existing caller omits this (defaults to `false`), so ordinary
   * encoding is unaffected.
   */
  suppressDeclarationSectionMarkers?: boolean;

  /**
   * Cycle 16: overrides the deferred blank-line/declaration-boundary
   * marker flush decision (`hasCompiledReferences`, see its own
   * declaration comment) with a caller-supplied, WHOLE-COMPILATION-UNIT
   * answer, instead of this one call's own local `references` list.
   * Every other program kind already encodes its entire compilation unit
   * through one `encodeFragmentInternal` call, so the local computation
   * IS the whole-unit answer for them; only Application Class method
   * bodies (each their own independent call, a Cycle 14 design choice)
   * need this override. Every existing caller omits it (stays
   * `undefined`), leaving the local, per-call computation -- and every
   * currently-EXACT definition -- unaffected.
   */
  compilationUnitHasCompiledReferences?: boolean;

  /**
   * Cycle 67 (definition 28964 and a 31-candidate corpus population,
   * zero contradictions): `%Super.<property>` accesses an INHERITED
   * property -- one declared on an ANCESTOR class, never on this class's
   * own `source`. When that property's declared type is an Application
   * Class, stored PeopleTools allocates a PACKAGE dependency for it (at
   * the point of first body-level use, interleaved with other body-level
   * references -- NOT via the early declaration-dependency prepass,
   * confirmed by definition `28972`'s own stored PSPCMNAME: its
   * `PACKAGE.TEXTCATALOG` row for `%Super.TxtCat` lands AFTER a body-level
   * `RECORD.FIELD` reference, not before it). This class's own source has
   * no way to discover an ancestor's property declarations (a genuinely
   * different architectural gap from the already-proven declaration-
   * dependency PREPASS, Cycle 52/60, which only ever scans THIS class's
   * own header) -- so the caller externally resolves the ancestor
   * chain's own property-name -> declared-type map (e.g. from local
   * snapshot metadata, when the ancestor class is itself present there)
   * and supplies it here. Every existing caller omits this (stays
   * `undefined`), so ordinary encoding -- and every already-EXACT
   * definition -- is completely unaffected. Keys are lowercased property
   * names; values are the property's declared type exactly as written
   * (e.g. `"BNE_OPEN_ENROLL_FL:Utility:TextCatalog"`).
   */
  inheritedPropertyTypes?: ReadonlyMap<string, string>;

  /**
   * Cycle 107: optional Application Class TYPE metadata -- the declared
   * types of other classes' properties / instances and method results
   * (`applicationClassTypeMetadata.ts`), e.g. from the local corpus
   * snapshot. It only answers "which class is this value?" for a chain step
   * the source cannot type -- `&obj.Prop.M()`, `&obj.Get().M()` on a
   * variable of a known class, `%Super.Prop.M()`, `%This.Prop.M()` (Cycle
   * 108), and, in Application Class programs, the element of an
   * `array of <Class>` property or result (Cycle 109). The resulting
   * receiver then uses the existing method-row allocator (the Cycle 94
   * unit in ordinary programs, the Cycle 108 program row in Application
   * Class programs); the provider never allocates. A step it cannot resolve keeps the conservative
   * behavior (and the Cycle 93 external-metadata accounting). Absent:
   * encoding is unchanged.
   */
  applicationClassTypeMetadata?: ApplicationClassTypeMetadataProvider;
  /** Cycle 107 research hook: every provider consultation. Observational only. */
  applicationClassTypeMetadataTrace?: (event: ApplicationClassTypeMetadataEvent) => void;
  /** Cycle 107 research mode: consult and trace the provider, but encode as if it were absent. */
  applicationClassTypeMetadataDiagnosticsOnly?: boolean;
  /**
   * Cycle 111 research hook: called when an ordinary program is re-encoded
   * because its class rows depend on external metadata (Cycle 93 / 112,
   * `externalMetadataWildcardClaims`). Observational only.
   */
  onExternalMetadataFallback?: () => void;
  /**
   * Cycle 112 research switch: encode an ordinary program with allocation
   * units even when its class rows depend on external metadata, i.e. never
   * take the Cycle 93 fallback. For measuring the fallback; the harness
   * never sets it.
   */
  suppressExternalMetadataFallback?: boolean;
}

export interface ApplicationClassTypeMetadataEvent {
  kind: 'member' | 'method-result';
  receiver: readonly string[];
  member: string;
  result: ApplicationClassMemberType | undefined;
  sourceOffset: number;
}

/** Internal-only state shared by Application Class member fragments. */
interface EncodeFragmentContext extends EncodeProgramContext {
  /**
   * Cycle 93: out-parameter. `unresolvedReceiverCalls` counts, for an
   * ordinary program, every method call whose receiver is the RESULT of a
   * property access or method call on an Application Class instance
   * (`&obj.PROP.Method(...)`, `&obj.Get().Method(...)`). PeopleTools may
   * allocate a PACKAGE row for the class of that result, but the class is
   * declared in ANOTHER definition (the receiver class's property or
   * method signature) and is not an input to this encoder. See
   * `encodeOrdinaryProgramFragment`.
   */
  externalClassMetadata?: { unresolvedReceiverCalls: number };

  /**
   * Cycle 93 / 112: every wildcard import of an ordinary program claims a
   * blank-REFNAME PACKAGE row (instead of the first one only). Set only by
   * `encodeOrdinaryProgramFragment`, for a program whose references depend
   * on unavailable external class metadata; see there.
   */
  externalMetadataWildcardClaims?: boolean;

  htmlDependencyScope?: HtmlDependencyScope;
  htmlDependencyLifetime?: 'application-class';
  applicationClassReferenceSession?: ApplicationClassReferenceSession;
  /**
   * Cycle 57: a SEPARATE, ALWAYS-present (never gated by
   * `hasUnmodeledThisMethodDependencies`) cross-fragment lookup for plain
   * TYPE-dependency identities only (`kind: 'package'`, `methodName`
   * undefined). `applicationClassReferenceSession` above stays gated
   * exactly as Cycle 32/34 established, since it also governs
   * method-dependency reference reuse for inherited `%This.method()`
   * calls (an environment-dependent case this cycle's population does not
   * test). A corpus-wide census of 1,053 class-wide/import-established
   * (definition, leaf) candidates found the underlying
   * `ApplicationClassReferenceScope` already answers this correctly for
   * 906/920 candidates whose class has NO inherited `%This` call (the
   * gated session already covers them); of the 106 mismatches that DO
   * have an inherited `%This` call elsewhere in the class, the mismatch
   * is caused entirely by the gate suppressing an otherwise-unrelated
   * TYPE lookup, not by any genuine method-dependency concern -- `commit()`
   * on `ApplicationClassReferenceScope` is already unconditional, so the
   * shared map already has the right entries; only the LOOKUP was denied.
   * Consulted only by `ensureLocalApplicationClassPackageReference` and
   * `ensureRuntimeCreateReference`.
   */
  applicationClassTypeReferenceSession?: ApplicationClassReferenceSession;
  /**
   * Cycle 108: the program-wide Application Class rows of an Application
   * Class program (see `ApplicationClassProgramRows`). Set only by
   * `encodeApplicationClassProgramV2`.
   */
  applicationClassProgramRows?: ApplicationClassProgramRows;
  /** Cycle 108: the class an Application Class fragment belongs to (`%This`). */
  applicationClassSelfPath?: readonly string[];
  /**
   * Cycle 108: the Application Class's own properties / instances whose
   * declared class the source alone names (a qualified type, or a short
   * name with a named import) -- lowercased name -> class and array depth
   * (0 for a scalar; Cycle 109). Source declarations win over the
   * type-metadata provider.
   */
  applicationClassOwnPropertyTypes?: ReadonlyMap<string, { packagePath: readonly string[]; className: string; depth: number }>;
  /**
   * Cycle 109: the Application Class variables an Application Class method
   * body sees without declaring them -- its program's instances, properties
   * (`&Name`), Component / Global declarations, and its own method's
   * parameters -- whose declared type the source alone names (a qualified
   * path or a named import): lowercased `&name` -> element class and array
   * depth (0 for a scalar).
   */
  applicationClassDeclaredVariables?: ReadonlyMap<string, { packagePath: readonly string[]; className: string; depth: number }>;
  /**
   * Cycle 120: the Application Class program's variables declared outside
   * the method body with a built-in object type -- header `instance` /
   * `property` (`&<name>`) and top-level `Global` / `Component`
   * declarations: lowercased `&name` -> the type as written. A body
   * applies only the evidenced types (Record).
   */
  applicationClassDeclaredBuiltinVariables?: ReadonlyMap<string, string>;
  /**
   * Cycle 82: the compilation unit's own self-class PACKAGE row. Present
   * only for Application Class programs. See
   * `ApplicationClassSelfMethodDependency`'s own comment.
   */
  applicationClassSelfMethodDependency?: ApplicationClassSelfMethodDependency;
  bindOwnerReference?: boolean;
  /**
   * Cycle 36: gives bare built-in-object `Local`-declaration PACKAGE
   * identities (`ensureLocalObjectPackageReference`'s own reuse pool)
   * METHOD-WIDE lifetime instead of the ordinary control-group-scoped
   * lifetime -- see that function's own declaration comment for the
   * population evidence. Set only by `encodeApplicationClassProgramV2`
   * for its own method-body fragments; every other caller omits it.
   */
  builtinObjectDeclarationsHaveMethodWideLifetime?: boolean;
  /**
   * Cycle 43: gives `DependencyScope`'s own RECORD/SCROLL reuse
   * (`dependencyScope.lookupRecord`/`lookupScroll`, and
   * `resolvePostfixMemberReuse`'s own raw read of the SAME underlying
   * map) METHOD-WIDE lifetime, ignoring both `controlGroup` and the
   * ordinary `controlDepth > 0` "open" gate -- see `recordScopeId`'s own
   * declaration comment for the population evidence and the Cycle 42
   * regression (definition 29528) this cycle's fix corrects. Set only
   * by `encodeApplicationClassProgramV2` for its own method-body
   * fragments; every other caller omits it.
   */
  recordDependenciesHaveMethodWideLifetime?: boolean;
  /*
   * Cycle 46: an Application Class method IMPLEMENTATION's own parameter
   * list (from the class header's `ApplicationClassMethodMember.parameters`,
   * already parsed -- never re-parsed from body text), threaded into this
   * ONE method-body fragment's own type environment before its statements
   * are encoded. Method bodies are each their own fresh `encodeFragmentInternal`
   * call (see `encodeApplicationClassProgramV2`'s own `encodeFragment`
   * closure), so this never leaks between methods or persists past one
   * fragment -- matching an ordinary Function parameter's own scope, which
   * this reuses the SAME registration logic for (`registerTypedParameter`).
   * Absent for the leading-import fragment and for get/set accessor bodies
   * (no evidenced population for either).
   */
  methodParameters?: { name: string; type: string }[];
}

/*
 * Cycle 97: built-in object properties that stay INLINE member names.
 *
 * In a postfix chain the encoder binds a bare member as a PSPCMNAME row
 * when it sits where a record or a field name belongs:
 *
 *   dependencyKind 'record'  -- off a Row / Rowset value (`&rs(1).X`,
 *                               `GetRow().X`): X would become a RECORD row
 *   dependencyKind 'field'   -- off a Record value (`&rs(1).REC.X`,
 *                               `&rec.X`): X would become a FIELD row
 *
 * The members below are properties of the object at that position, not
 * record or field names. Stored writes them inline (0x0A text) and opens no
 * row. Evidence (`cycle97-member-identity-census.py`, every ordinary
 * definition, EXACT ones included): at each listed position the generated
 * row had no stored counterpart, and stored never has a row with that
 * identity anywhere in the corpus (RECORD.DELETEENABLED, FIELD.FIELDCOUNT,
 * ... : 0 rows). All occurrences are property syntax.
 *
 *   position 'record' (Row / Rowset value)
 *     DeleteEnabled  38 occurrences / 24 definitions (5182, 5313)
 *     ParentRowset   34 / 19 (924, 3689)
 *     Style          28 / 15 (2085, 2086)
 *     ChildCount     16 / 10 (24578)
 *     RecordCount     4 /  4 (5065, 14194)
 *   position 'field' (Record value)
 *     FieldCount    170 / 124 (1295, 2127)
 *     ParentRow      49 / 22 (1417, 1419)
 *     DBRecordName    8 /  8 (4132)
 *     IsEditError     7 /  5 (7078)
 *     RelLangRecName  6 /  5 (17295)
 *     ActiveRowCount  2 /  2 (20777, 21252)
 *     ParentRowset    1 /  1 (924)
 *
 * The key is position + member, never the member name alone: the same
 * names are left to the existing rules everywhere else. FIELDVALUE,
 * XLATLONGNAME and XLATSHORTNAME are NOT listed: they are real field names
 * of the translate records (stored FIELD rows in 75 / 60 / 10 definitions)
 * and inline properties elsewhere, which needs the record's field list to
 * decide.
 */
const BUILTIN_OBJECT_PROPERTIES: Readonly<Record<'record' | 'field', ReadonlySet<string>>> = {
  record: new Set(
    ['DeleteEnabled', 'ParentRowset', 'Style', 'ChildCount', 'RecordCount'].map(name => name.toLowerCase())
  ),
  field: new Set(
    ['FieldCount', 'ParentRow', 'DBRecordName', 'IsEditError', 'RelLangRecName', 'ActiveRowCount', 'ParentRowset']
      .map(name => name.toLowerCase())
  )
};

function isBuiltinObjectProperty(position: string, member: string): boolean {
  return (position === 'record' || position === 'field') &&
    BUILTIN_OBJECT_PROPERTIES[position].has(member.toLowerCase());
}

export interface EncodedPeopleCode {
  program: Buffer;
  references: PeopleCodeReference[];
}

const BUILTIN_FUNCTION_TYPE_IDS: ReadonlyMap<string, number> = new Map([
  ['file', 0x80001],
  // `Function PopulateAcmArray(..., &AcmMbrSQL As SQL, &AcmMbrArray As
  // array of Record);` (definition 4861): the parameter signature tail
  // stores SQL's descriptor as `c0080002` immediately between the `date`
  // (`c0000002`) and `array of Record` (`c0180003`) parameters, i.e.
  // SQL's own type id is 0x80002 -- the gap between `file` (0x80001) and
  // `record` (0x80003) in this same enumeration.
  ['sql', 0x80002],
  ['record', 0x80003],
  ['rowset', 0x80007],
  ['row', 0x80008],
  ['field', 0x80009],
  ['apiobject', 0x8000f],
  // `Function SetCompoundColumnVisibility(&rs As Rowset, &GRID As Grid)`
  // (definition 14962): the parameter signature tail stores Grid's
  // descriptor as `c0080014` immediately after Rowset's (`c0080007`),
  // i.e. Grid's own type id is 0x80014.
  ['grid', 0x80014],
  ['xmldoc', 0x8001d],
  ['exception', 0x80021],
  ['xmlnode', 0x80022]
]);

function functionTypeId(
  typeName: string,
  applicationClassOffsets?: ReadonlyMap<string, number>
): number {
  /*
   * Each nesting level of `array of` contributes its OWN multiple of
   * 0x100000 -- NOT a single OR'd flag bit reused at every level. A bare
   * trailing `array` (no final `of ElementType`) counts as one more
   * nesting level over an implicit `any` element type.
   *
   * `Function savewideqryvalues(..., &arr As array of array of string) ...`
   * (definition 14899): the parameter signature tail stores this
   * 2-level-nested parameter as `c0200001` -- `0x200000` (TWO multiples
   * of `0x100000`, not one) OR'd with `0x000001` (`string`'s own id).
   *
   * `Function parse_objclass(..., &array_structobj As array of array of
   * array of string, ...)` (definition 15115): the 3-level-nested
   * parameter stores `c0300001` -- `0x300000` (three multiples),
   * confirming the pattern is `depth * 0x100000`, not a saturating OR.
   *
   * `Function Get_ACM_Ern(&Acm_Pin As number, &Ern_array As array)`
   * (definition 8229): the bare (untyped) `array` parameter stores
   * `c0100004` -- one level (`0x100000`) OR'd with `0x000004`, `any`'s
   * own primitive id.
   */
  let rest = typeName.trim();
  let depth = 0;
  while (true) {
    const arrayOfMatch = /^array\s+of\s+/i.exec(rest);
    if (arrayOfMatch) {
      depth++;
      rest = rest.slice(arrayOfMatch[0].length);
      continue;
    }
    if (/^array$/i.test(rest)) {
      depth++;
      rest = 'any';
    }
    break;
  }

  if (depth > 0) {
    return (
      (depth * 0x100000) |
      functionTypeId(rest, applicationClassOffsets)
    ) >>> 0;
  }

  const applicationClassOffset = applicationClassOffsets?.get(
    typeName.trim().toLowerCase()
  );
  if (applicationClassOffset !== undefined) {
    return (0x80000 | 0x100 | applicationClassOffset) >>> 0;
  }

  // Built-in object descriptors use 0x80000 plus their calibrated subtype.
  // Function parameter slots add 0xc0000000 in parameterTypeDescriptor().
  const builtinObjectType = BUILTIN_FUNCTION_TYPE_IDS.get(typeName.toLowerCase());
  if (builtinObjectType !== undefined) return builtinObjectType;

  // Function directories encode Date as scalar descriptor 0x02. This has not
  // yet been established for Application Class method signature records, so
  // keep it local to Function metadata rather than the shared primitive map.
  if (typeName.toLowerCase() === 'date') return 0x02;

  const id = PRIMITIVE_SIGNATURE_TYPE_IDS.get(typeName.toLowerCase());
  if (id === undefined) throw new Error(`Unsupported function metadata type: ${typeName}`);
  return id;
}

function returnTypeDescriptor(
  typeName?: string,
  applicationClassOffsets?: ReadonlyMap<string, number>
): number {
  return typeName === undefined
    ? 0x07
    : functionTypeId(typeName, applicationClassOffsets);
}

function parameterTypeDescriptor(
  typeName: string,
  applicationClassOffsets?: ReadonlyMap<string, number>
): number {
  if (typeName === '__untyped_parameter__') {
    return 0xc0000004;
  }

  return (
    0xc0000000 |
    functionTypeId(typeName, applicationClassOffsets)
  ) >>> 0;
}

/*
 * Cycle 113: the Function metadata's Application Class type names are one
 * entry PER USE, allocated as they are written -- every Function's return
 * type in directory order, then every parameter type in signature-slot
 * order -- never deduplicated (the same order the Application Class
 * directory allocates its type paths, Cycle 29). LOCAL SNAPSHOT: 15800
 * stores `PTIB_PACKAGE:MobileURLParams` three times (three parameters),
 * 24546 `PROJECT:ProjectDefn` twice; 14327 stores its two return types
 * (`PTADSDEFN:AdsValidationBase`, `ADSM:ADSInstance`) before the
 * parameter types. Every changed program's pool equals stored (19); a
 * parameters-first order mismatches 14327.
 */
function functionApplicationClassTypeUses(
  metadata: readonly FunctionMetadata[]
): { typeName: string; key: string }[] {
  const uses: { typeName: string; key: string }[] = [];
  const add = (rawType: string | undefined, key: string) => {
    if (rawType === undefined) return;
    const typeName = rawType.replace(/^(?:array\s+of\s+)+/i, '').trim();
    if (!typeName.includes(':')) return;
    uses.push({ typeName, key });
  };
  metadata.forEach((item, fn) => add(item.returnType, `${fn}:return`));
  metadata.forEach((item, fn) => {
    if (item.hasParameterList) item.parameterTypes.forEach((typeName, slot) => add(typeName, `${fn}:${slot}`));
  });
  return uses;
}

function functionApplicationClassTypes(
  metadata: readonly FunctionMetadata[]
): string[] {
  return functionApplicationClassTypeUses(metadata).map(use => use.typeName);
}

function encodeFunctionProgramHeader(
  executableLength: number,
  metadata: readonly FunctionMetadata[]
): Buffer {
  // Calibrated 37-byte Function PSPCMPROG header.
  const header = Buffer.alloc(37);

  const nameBytes = metadata.reduce(
    (total, item) =>
      total + Buffer.byteLength(item.name + '\0', 'utf16le'),
    0
  ) + functionApplicationClassTypes(metadata).reduce(
    (total, typeName) =>
      total + Buffer.byteLength(typeName + '\0', 'utf16le'),
    0
  );

  /*
   * Header slot 21 is the total number of signature slots:
   * one return slot per Function plus one slot per parameter.
   *
   * For a single Function this is parameterCount + 1, matching the
   * original calibration. For the 9-function ABS_HIST_UK_SBR fixture,
   * with no parameters, the stored value is 9.
   */
  const signatureSlots = metadata.reduce(
    (total, item) => total + (item.hasParameterList ? item.parameterTypes.length + 1 : 0),
    0
  );

  header[0] = 0xa0;
  header.writeUInt32LE(0, 1);
  header.writeUInt32LE(executableLength, 5);
  header.writeUInt32LE(0, 9);
  header.writeUInt32LE(nameBytes, 13);
  header.writeUInt32LE(0, 17);
  header.writeUInt32LE(signatureSlots, 21);
  header.writeUInt32LE(0, 25);
  header.writeUInt32LE(metadata.length, 29);
  header.writeUInt32LE(0x85, 33);

  return header;
}

function encodeFunctionMetadata(
  metadata: readonly FunctionMetadata[]
): Buffer {
  /*
   * Calibrated Function-directory layout:
   *
   *   [all NUL-terminated UTF-16 Function names]
   *   [one 16-byte directory record per Function]
   *   [parameter slots / 0x00000007 terminators]
   *
   * Each 16-byte record is:
   *
   *   uint32 nameOffsetUtf16
   *   uint32 signatureSlotOffset
   *   uint32 parameterCount
   *   uint32 returnDescriptor
   *
   * Offset 170 (nine zero-parameter Functions) stores:
   *
   *   [0,   0, 0, 5]
   *   [18,  1, 0, 5]
   *   [30,  2, 0, 5]
   *   ...
   *   [167, 8, 0, 5]
   *   [7, 7, 7, 7, 7, 7, 7, 7, 7]
   *
   * nameOffsetUtf16 is measured in UTF-16 code units, including each prior
   * name's NUL terminator.
   *
   * signatureSlotOffset is the cumulative number of signature-tail slots
   * occupied by prior Functions. Each Function contributes one slot per
   * parameter plus one 0x00000007 terminator slot.
   *
   * This was previously mistaken for a zero-based function ordinal because
   * zero-parameter Function fixtures produce 0, 1, 2, ... in both cases.
   * DERIVED_CO.FUNCLIB.FieldFormula disambiguates the field: its first
   * Function has one parameter, so the second directory record stores 2,
   * not 1.
   *
   * For a single Function this remains byte-compatible because the first
   * signatureSlotOffset is always 0.
   */
  const names = metadata.map(
    item => Buffer.from(item.name + '\0', 'utf16le')
  );
  const applicationClassUses = functionApplicationClassTypeUses(metadata);
  const applicationClassNames = applicationClassUses.map(
    use => Buffer.from(use.typeName + '\0', 'utf16le')
  );
  // Each use's own name offset, keyed `<function>:return` / `<function>:<slot>`.
  const useOffsets = new Map<string, ReadonlyMap<string, number>>();
  let applicationClassCharOffset = metadata.reduce(
    (total, item) => total + item.name.length + 1,
    0
  );
  for (const use of applicationClassUses) {
    useOffsets.set(use.key, new Map([[use.typeName.toLowerCase(), applicationClassCharOffset]]));
    applicationClassCharOffset += use.typeName.length + 1;
  }

  const directory = Buffer.alloc(metadata.length * 16);

  let nameOffsetUtf16 = 0;
  let signatureSlotOffset = 0;

  for (let i = 0; i < metadata.length; i++) {
    const item = metadata[i];
    const offset = i * 16;

    directory.writeUInt32LE(nameOffsetUtf16, offset);
    directory.writeUInt32LE(item.hasParameterList ? signatureSlotOffset : 0, offset + 4);
    directory.writeUInt32LE(item.parameterTypes.length, offset + 8);
    directory.writeUInt32LE(
      returnTypeDescriptor(item.returnType, useOffsets.get(`${i}:return`)),
      offset + 12
    );

    nameOffsetUtf16 += item.name.length + 1;
    if (item.hasParameterList) signatureSlotOffset += item.parameterTypes.length + 1;
  }

  /*
   * Signature tails follow all directory records. A zero-parameter Function
   * contributes only 0x00000007. Parameterized Functions contribute their
   * calibrated parameter type slots followed by the same terminator.
   */
  const signatureTails: Buffer[] = [];

  for (const [fn, item] of metadata.entries()) {
    if (!item.hasParameterList) continue;
    for (const [slot, typeName] of item.parameterTypes.entries()) {
      const parameter = Buffer.alloc(4);
      parameter.writeUInt32LE(
        parameterTypeDescriptor(typeName, useOffsets.get(`${fn}:${slot}`)),
        0
      );
      signatureTails.push(parameter);
    }

    const terminator = Buffer.alloc(4);
    terminator.writeUInt32LE(0x07, 0);
    signatureTails.push(terminator);
  }

  return Buffer.concat([
    ...names,
    ...applicationClassNames,
    directory,
    ...signatureTails
  ]);
}
export class UnsupportedPeopleCodeError extends Error {
  constructor(readonly offset: number, detail: string) {
    super(`Cannot encode PeopleCode at source offset ${offset}: ${detail}`);
    this.name = 'UnsupportedPeopleCodeError';
  }
}

function fixed(text: string, selectedOpcode?: number): Buffer {
  const matches = [...OPCODES].filter(([, spec]) => spec.text === text);
  if (selectedOpcode !== undefined) {
    if (!matches.some(([opcode]) => opcode === selectedOpcode)) throw new Error(`No opcode ${selectedOpcode} for ${text}`);
    return Buffer.from([selectedOpcode]);
  }
  if (matches.length !== 1) throw new Error(`No unambiguous opcode for ${text}`);
  return Buffer.from([matches[0][0]]);
}

function textOperand(opcode: number, kind: TokenKind, value: string): Buffer {
  const expectedKind = opcode === INLINE_IDENTIFIER_OPCODE ? TokenKind.Name : TEXT_INTRODUCERS.get(opcode);
  if (expectedKind !== kind) throw new Error('Unsupported text operand opcode');
  return Buffer.concat([Buffer.from([opcode]), Buffer.from(value, 'utf16le'), Buffer.alloc(2)]);
}

/**
 * Experimental statement bytes ONLY: no PSPCMPROG header, trailer or name table.
 * Grammar:
 *   statement:
 *     ';'
 *     | 'Local' type variable ('=' expression)? ';'
 *     | 'Return' expression? ';'
 *     | variable '=' expression ';'
 *     | call ';'
 *
 * expression: primary (('+' | '-' | '*' | '/') primary)*
 * primary: '-' primary | value | '(' expression ')' | call
 * call: identifier '(' (expression (',' expression)*)? ')'
 * value: &variable | quoted string (doubled delimiters) | True | False | uint128.
 * Operators retain source order; no folding, type checking or AST is needed
 * for this token format. Unary minus is supported; unary plus and member/index
 * access are unsupported.
 */

/*
 * Compiler architecture: canonical built-in PeopleCode type semantics.
 *
 * Historically this project maintained the SAME type-to-PACKAGE-reference
 * mapping independently in 7 separate dispatch chains (Local declaration,
 * both the plain and array-element-type branches; Global declaration;
 * Component declaration; Application Class method parameters; ordinary
 * Function parameters; Function Returns types), each hand-copied when a
 * corpus definition exposed a gap. This caused real drift: one dispatch
 * chain's own comment still asserted (until this consolidation) that
 * Rowset-typed parameters "deliberately" do NOT allocate a PACKAGE
 * reference, citing a historical regression -- even though a SIBLING
 * dispatch chain (`registerTypedParameter`) had already been corrected
 * earlier the same session to prove that claim false for 395/395 genuine
 * corpus occurrences. A single source of truth prevents this class of
 * drift by construction: fixing one cell fixes every context that reads
 * from it.
 *
 * `packageAllocationContexts` encodes ONLY contexts with direct, current
 * corpus evidence (or an existing, already-migrated dispatch chain) that
 * this type allocates a PACKAGE dependency row there. A context's ABSENCE
 * from this set means "not currently evidenced to allocate here" -- which
 * may mean "genuinely does not" (a real compiler restriction) OR "not yet
 * investigated." Do NOT treat an empty set membership as a claim that the
 * type is proven excluded from that context; only add a context here once
 * a corpus census (the same discipline every entry below already
 * required) supports it. This table is a faithful, behavior-preserving
 * transcription of the union of all 7 chains as they stood at the time of
 * this consolidation -- it does not, by itself, add or remove any type/
 * context combination.
 */
type BuiltinTypeContext =
  | 'local'
  | 'local-array-element'
  | 'global'
  | 'global-array-element'
  | 'component'
  | 'application-class-parameter'
  | 'function-parameter'
  | 'function-returns';

interface BuiltinTypeSemantics {
  readonly packageKey: string;
  readonly canonicalName: string;
  readonly packageAllocationContexts: ReadonlySet<BuiltinTypeContext>;
}

const BUILTIN_TYPE_REGISTRY: ReadonlyMap<string, BuiltinTypeSemantics> = new Map(
  (
    [
      ['Record', ['local', 'local-array-element', 'global', 'global-array-element', 'component', 'application-class-parameter', 'function-parameter', 'function-returns']],
      ['Row', ['local', 'local-array-element', 'component', 'application-class-parameter', 'function-parameter', 'function-returns']],
      ['Rowset', ['local', 'local-array-element', 'global', 'component', 'application-class-parameter', 'function-parameter', 'function-returns']],
      ['SQL', ['local', 'local-array-element', 'global', 'application-class-parameter', 'function-parameter', 'function-returns']],
      ['File', ['local', 'local-array-element', 'global', 'component', 'application-class-parameter', 'function-parameter', 'function-returns']],
      ['Field', ['local', 'local-array-element', 'component', 'application-class-parameter', 'function-parameter', 'function-returns']],
      ['XmlDoc', ['local', 'local-array-element', 'component', 'application-class-parameter', 'function-parameter', 'function-returns']],
      ['XmlNode', ['local', 'local-array-element', 'function-parameter', 'function-returns']],
      ['ApiObject', ['local', 'global', 'component', 'application-class-parameter', 'function-parameter', 'function-returns']],
      ['Grid', ['local', 'component', 'application-class-parameter', 'function-parameter', 'function-returns']],
      ['Message', ['local', 'local-array-element', 'component', 'application-class-parameter', 'function-parameter', 'function-returns']],
      ['GridColumn', ['local']],
      ['JavaObject', ['local', 'application-class-parameter', 'function-returns']],
      ['TransformData', ['local']],
      ['Chart', ['local', 'global', 'component']],
      ['ProcessRequest', ['local', 'component', 'application-class-parameter']],
      // Cycle 103 (see the comment below the table).
      ['Page', ['local']],
      ['Exception', ['local', 'function-parameter']],
      ['JsonObject', ['local', 'application-class-parameter']],
      ['JsonArray', ['local', 'application-class-parameter']],
      ['JsonBuilder', ['local', 'application-class-parameter']],
      ['JsonParser', ['local']],
      ['CubeCollection', ['local', 'global', 'component']],
      ['AnalyticInstance', ['local', 'component']],
      ['AnalyticGrid', ['local', 'component']],
      ['AnalyticModel', ['component']],
      ['RatingBoxChart', ['global']],
      ['DocumentKey', ['local', 'function-parameter']],
      ['Compound', ['local', 'function-parameter']],
      ['Primitive', ['local', 'function-parameter']],
      ['Interlink', ['local']],
      ['PostReport', ['local']],
      ['Request', ['local']],
      ['SOAPDoc', ['local']],
      ['IntBroker', ['local']],
      ['CompositeQuery', ['local']],
      ['BIDocs', ['local']],
      ['IBInfo', ['local']],
      // Cycle 110 (see the comment below the table).
      ['Collection', ['local']],
      ['Document', ['local']],
      ['Map', ['local']],
      ['JsonNode', ['local']],
      ['Response', ['local']],
      ['CQRuntime', ['local']],
      ['Crypt', ['local']]
    ] as const
  ).map(([name, contexts]) => [
    name.toLowerCase(),
    {
      packageKey: name.toUpperCase(),
      canonicalName: name,
      packageAllocationContexts: new Set(contexts) as ReadonlySet<BuiltinTypeContext>
    }
  ])
);

/*
 * Cycle 103: every type declared WITHOUT a package path that PeopleTools
 * stores a PACKAGE.<TYPE> row for is a built-in object type, and every
 * declaration context evidenced in the corpus allocates its row. Evidence
 * (`cycle103-builtin-package-lifetime-census.ts` and a per-context census
 * of programs where the type occurs in ONE context only): the stored row
 * is present in every such program for every entry and context added here
 * -- Page 20/20, Exception 38/38, JsonObject 25/25, JsonArray 22/22,
 * CubeCollection 11/11, AnalyticInstance 11/11, JsonBuilder 12/12, ... --
 * and none of these names is ever stored as an Application Class row
 * (PACKAGEROOT is the type itself or blank, never a package). Added
 * contexts of registered types: SQL global 7/7, ApiObject global 2/2,
 * Chart component 3/3 / global 1/1, Grid component 2/2, Message component
 * 1/1, Field component 2/2 / App Class parameter 20/20, ProcessRequest
 * component 4/4, XmlDoc parameter 1/1 + 51/51, File / JavaObject App Class
 * parameter; XmlNode function-parameter and Message local-array-element
 * from the lifetime census's interval evidence.
 *
 * Cycle 110: Collection, Document, Map, JsonNode, Response, CQRuntime and
 * Crypt are built-ins too. A `Local` of one stores its PACKAGE row in every
 * program that declares it (Collection 8/8, Document 7/7, Map 3/3, the
 * others 1/1; ordinary and Application Class alike), and descriptive
 * stores root the row at the type itself (29527 Collection / Document /
 * Map, 28890 JsonNode, 29530, 29531) -- never at a package. Two packages
 * define an Application Class named Collection (PTAI_COLLECTION,
 * PSXP_XMLGEN); every reference to those classes is written qualified, and
 * a short `Collection` under `import PSXP_XMLGEN:*` (29870) still stores
 * the self-rooted built-in row. Application Class header declarations of
 * these types already allocate through the declaration prepass.
 *
 * Exception as an Application Class METHOD parameter also stores a row
 * (10/10), but it is deliberately not added: the Application Class
 * declaration prepass lists `exception` among its scalar declaration types,
 * so the row would be allocated at the implementation instead of in the
 * class-header order (30206). That is Application Class semantics, not
 * built-in registry coverage.
 */

/** Cycle 107: whether a type name is a PeopleTools built-in object type (`BUILTIN_TYPE_REGISTRY`). */
export function isBuiltinObjectTypeName(name: string): boolean {
  return BUILTIN_TYPE_REGISTRY.has(name.toLowerCase());
}

function encodeFragmentInternal(source: string, context?: EncodeFragmentContext): { bytes: Buffer; references: PeopleCodeReference[]; commentOpcodesConsumed: number } {

  let commentOpcodeIndex = 0;

  /*
   * Cycle 107: the optional type-metadata provider (see
   * `EncodeProgramContext.applicationClassTypeMetadata`). Consultation is
   * traced; in diagnostics-only mode its answers are not used.
   *
   * Ordinary programs consult it at every step (Cycle 107). So do
   * Application Class programs (Cycle 109): their method rows have program
   * lifetime (`ApplicationClassProgramRows`, Cycle 108), and the element of
   * an `array of <Class>` value is a receiver. 29109's first FACTORHANDLER
   * use is `&factors [&f].FactorHandler.GetFactorDisplays(...)` on an
   * array parameter; with array elements untyped, typing only the later
   * uses opened the row too late (LOCAL SNAPSHOT: typed steps without
   * array elements 24 lists changed, 1 farther -- 29109; with them, and
   * with the body's declared variables as receivers, 41 changed, 40
   * closer, 0 farther). An array of a class is modeled in Application
   * Class programs only. A `%This` method's result stays untyped (no
   * evidenced change, Cycle 108).
   */
  const consultTypeMetadata = (
    kind: 'member' | 'method-result',
    receiver: readonly string[],
    member: string
  ): ApplicationClassMemberType | undefined => {
    const provider = context?.applicationClassTypeMetadata;
    if (provider === undefined) return undefined;
    const result = kind === 'member' ? provider.memberType(receiver, member) : provider.methodReturnType(receiver, member);
    context?.applicationClassTypeMetadataTrace?.({ kind, receiver, member, result, sourceOffset: pos });
    if (context?.applicationClassTypeMetadataDiagnosticsOnly) return undefined;
    /* An array type is not modeled as a receiver: keep the conservative behavior. */
    if (result?.kind === 'other' && /^array\b/i.test(result.type)) return undefined;
    // Cycle 109: an array of a class is modeled in Application Class programs only.
    if (result?.kind === 'array' && !context?.builtinObjectDeclarationsHaveMethodWideLifetime) return undefined;
    return result;
  };
  const metadataReceiver = (path: readonly string[]) => ({
    packagePath: path.slice(0, -1),
    className: path[path.length - 1],
    reuseRuntimeCreateForMethods: false
  });

  const consumeCommentOpcode = (
    fallback: 0x24 | 0x4e
  ): 0x24 | 0x4e => {
    const opcode =
      context?.commentOpcodes?.[commentOpcodeIndex];

    if (opcode === 0x24 || opcode === 0x4e) {
      commentOpcodeIndex++;
      return opcode;
    }

    return fallback;
  };

  const typeName = (): Buffer => {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));
    if (!match) return fail('expected a PeopleCode type name');

    const name = match[0];
    pos += name.length;

    // Calibrated object declaration types use the ordinary inline-name
    // introducer rather than the primitive-type 0x40 introducer.
    //
    // ADSRECORDS1_WRK.QRYSEARCHBTN.FieldChange (definition 772) proves
    // ApiObject belongs on this list too: `Local ApiObject &aRecordsList;`
    // stores its type as `44 0A "ApiObject"`, not `44 40 "ApiObject"`.
    //
    // AMM_FILTER.IB_DIRECTION.FieldFormula (definition 1046) proves Grid
    // belongs on it too: `Local Grid &GRID, &GRID2;` stores its type as
    // `44 0A "Grid"`, not `44 40 "Grid"`.
    //
    // BENEF_PB_WRK.ODEM_SCHED_ACTY_PB.FieldDefault (definition 1749) proves
    // ProcessRequest belongs on it too: `Local ProcessRequest &RQST;`
    // stores its type as `44 0A "ProcessRequest"`, not `44 40
    // "ProcessRequest"`.
    //
    // Cycle 78: Message, JsonArray, JsonObject, JavaObject, GridColumn, and
    // Exception belong on this list too, found via a corpus-wide first-
    // true-byte-divergence census of the population Cycle 77's decoder fix
    // newly exposed as genuinely encoder-wrong (rather than decoder-
    // blocked): 160 definitions share one first divergence, always at this
    // exact type-name introducer byte (`0A` expected, `40` generated),
    // dominated by `Local Message` (140/160). AAOTOAA_MSGS.OnNotify
    // (definition 28700) proves Message: `Local Message &MSG;` stores its
    // type as `44 0A "Message"`, not `44 40 "Message"`. Zero contradictions
    // found corpus-wide (583 definitions with a declaration-position use of
    // one of these six names; the only 5 currently-EXACT matches are all
    // the literal type name appearing inside disabled/commented-out code,
    // which bypasses this function entirely).
    //
    // Compiler closure: TransformData and Chart belong on this list too --
    // same exact byte pattern (`44 0A "TransformData"`/`44 0A "Chart"`
    // expected, `44 40 ...` generated), found while decomposing the
    // REFERENCE_ACTIVE_PACKAGE census. Both are ALSO missing their own
    // separate PACKAGE-allocation dispatch entry (see
    // ensureLocalObjectPackageReference's own call sites) -- two
    // independent mechanisms for the same type name, exactly like Cycle
    // 78's own six types.
    //
    // Cycle 113: the list was the wrong way round. Only the PRIMITIVE
    // types are keywords; every other type name is an inline identifier.
    // LOCAL SNAPSHOT (every stored program decoded, every type token after
    // Local / Global / Component / ComponentLife / As / Returns / of /
    // instance / property that is not a package path): the 11 primitive
    // names below are 0x40 in all 72,048 occurrences, the 47 other names
    // (every built-in object type -- Page, JsonBuilder, JsonParser,
    // CubeCollection, AnalyticInstance, RatingBoxChart, Document, ... --
    // and `long`) are 0x0A in all 28,581, with no name ever written both
    // ways. 2171: `Local Page &MYPAGE;` stores `44 0A "Page"`.
    if (!/^(string|number|boolean|array|integer|date|any|object|datetime|time|float)$/i.test(name)) {
      return textOperand(INLINE_IDENTIFIER_OPCODE, TokenKind.Name, name);
    }

    return textOperand(0x40, TokenKind.Keyword, name);
  };

  // Cycle 93: the Application Class element type of the array declaration
  // `arrayElementTypes()` last parsed, if any.
  let arrayElementApplicationClass:
    | { packagePath: string[]; className: string }
    | undefined;

  const arrayElementTypes = (): string | undefined => {
    let elementType: string | undefined;
    arrayElementApplicationClass = undefined;
    do {
      space();
      /*
       * `array` (bare, with no `of ElementType` clause at all) is itself a
       * valid, untyped array declaration -- at any nesting level, not just
       * the outermost one.
       *
       * PSMCF_UQSVC_MSGS.MCFUQPUBLISH.RowInit (definition 16150):
       *
       *   Component array &QueueIDArrayAdd;
       *
       * stores only `54 40 "array" 01 "&QueueIDArrayAdd" 15` -- no `of`
       * keyword byte, nothing after the type name at all. Confirmed for
       * nested bare arrays too, e.g. `Component array of array &Var;`
       * (definition 19016): the second `array` also has no trailing `of`.
       */
      if (!word('of')) return elementType;
      chunks.push(textOperand(0x40, TokenKind.Keyword, 'of'));
      space();
      if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(source.slice(pos))) {
        const appClass = applicationClassPath();
        /*
         * Cycle 113: the element class is written like any qualified type
         * -- 14888 `Component array of PT_CUBQUERYCHUNK:QueryChunker
         * &aQChunker;` stores `40 "array" 40 "of" 0A "PT_CUBQUERYCHUNK" 57
         * 0A "QueryChunker" 01 "&aQChunker"`; 17894 the same after a
         * nested `array of array of`.
         */
        chunks.push(appClass.bytes);
        elementType = appClass.className;
        arrayElementApplicationClass = appClass;
        continue;
      }
      elementType = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
      chunks.push(typeName());
    } while (/^array$/i.test(elementType ?? ''));
    return elementType;
  };

  const localDeclaration = () => {
    lastLocalHadInitializer = false;

    chunks.push(fixed('Local'));

    space();

    // Application-class declaration:
    //   Local OU_CORPUS:Utilities:TestClass &obj;
    // => 44 0A "OU_CORPUS" 57 0A "Utilities" 57 0A "TestClass" 01 "&obj"
    //
    // The declaration itself does NOT allocate a PSPCMNAME dependency row.
    //
    // The package root may also be the reserved `%metadata` package
    // (metadata-driven Application Classes), the same leading `%?` this
    // lookahead's own `applicationClassPath()` call already accepts:
    //
    //   Local %metadata:AppDataSet &recName;
    //
    // PSPPMSSRVC_PLAT.QUERY_PLATFORM_XX.FieldFormula (one of several
    // corpus occurrences of this exact shape).
    const appClassLookahead =
      /^(%?[A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(
        source.slice(pos)
      );

    if (appClassLookahead) {
      const appClass = applicationClassPath();
      chunks.push(appClass.bytes);

      space();

      const variableMatch =
        /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos));
      if (!variableMatch) {
        return fail('expected an ASCII &variable');
      }

      const variableName = variableMatch[0];
      chunks.push(variable());

      const appClassVariable = {
        packagePath: appClass.packagePath,
        className: appClass.className,
        reuseRuntimeCreateForMethods:
          functionDepth === 0 &&
          !(controlDepth === 0 && sawTopLevelExecutableStatement)
      };

      const registerApplicationClassVariable = (name: string) => {
        applicationClassVariables.set(
          name.toLowerCase(),
          appClassVariable
        );

        if (functionDepth > 0) {
          functionApplicationClassVariables.set(
            name.toLowerCase(),
            {
              ...appClassVariable,
              reuseRuntimeCreateForMethods: false
            }
          );
        }
      };

      registerApplicationClassVariable(variableName);

      /*
       * A late top-level Application Class Local, after executable code has
       * already begun, allocates its own PACKAGE dependency at declaration
       * time. Declaration-phase App Class Locals retain the existing behavior
       * and do not allocate here.
       *
       * COMPANY_TBL.LOCATION.FieldChange calibrates:
       *
       *   Local EO:CA:Address &LocAddress;
       *
       * after executable statements as PSPCMNAME PACKAGE sequence 28, before
       * the following Record.DERIVED_ADDRESS dependency.
       */
      /*
       * Cycle 82: Application Class method bodies have no separate
       * declaration phase for this purpose -- a LEADING App Class Local
       * also allocates at its declaration. Evidence (LOCAL SNAPSHOT,
       * `cycle82-self-row-allocation-census.ts`): 29413's never-used
       * `Local GPS_UTILS:ClassUtility &_classUtil;` is stored at NAMENUM 6,
       * before the method's first Record.GPS_ACTION_TBL; 29876/29877's
       * `Local PSXP_RPTDEFNMANAGER:Utility &util;` is stored before the
       * self row allocated by the following `%This.GetMetaData()`, not at
       * the later `create`. Across all Application Classes this moves 60
       * definitions to a names-exact PSPCMNAME list and 0 away.
       * `builtinObjectDeclarationsHaveMethodWideLifetime` is set only for
       * Application Class fragments.
       */
      /*
       * Cycle 93: an UNINITIALIZED App Class Local nested inside a
       * top-level control structure (ordinary PeopleCode only) allocates
       * its PACKAGE row at the declaration, and a later `create` of the
       * same class reuses that row instead of allocating its own.
       *
       * Definition 25507:
       *
       *   If &RootNode <> "" Then
       *      ...
       *      Local FM_PS_ESP:PSFormProcessor &FP;
       *      Local FM_PS_ESP:PSForm &Form;
       *      ...
       *      &Form = create FM_PS_ESP:PSForm(&RootNode, CTPR_ESP_AET.LANGUAGE_CD.Value, ...);
       *
       * stores PSFORMPROCESSOR (27) and PSFORM (28) adjacently, BEFORE the
       * create argument's CTPR_ESP_AET.LANGUAGE_CD (29), and no second
       * PSFORM row. LOCAL SNAPSHOT, all definitions: allocating at the
       * nested declaration (rather than at the first `create`) moves 17
       * generated PSPCMNAME lists closer to stored and 0 farther
       * (19393, 19538, 19570, 24445, 24447, 24452, 24455 become EXACT).
       * A row already established by an earlier `create` is reused.
       */
      const nestedUninitializedLocal =
        !context?.builtinObjectDeclarationsHaveMethodWideLifetime &&
        functionDepth === 0 &&
        controlDepth > 0 &&
        !/^\s*=/.test(source.slice(pos));

      if (unitScopedClassRows) {
        // Cycle 94: see `useApplicationClassRow`.
        useApplicationClassRow(appClass.packagePath, appClass.className);
      } else if (nestedUninitializedLocal) {
        const classKey = [...appClass.packagePath, appClass.className]
          .map(component => component.toLowerCase())
          .join(':');
        if (!runtimeCreateReferences.has(classKey)) {
          runtimeCreateReferences.set(
            classKey,
            ensureLocalApplicationClassPackageReference(
              appClass.packagePath,
              appClass.className
            )
          );
        }
      } else if (
        /*
         * Cycle 108: an Application Class body's Local uses its class's
         * program row (`ApplicationClassProgramRows`) at the declaration at
         * ANY control depth, as at the top of the body. 29983:
         *
         *   If (&count > 0) Then
         *      Local PTAF_CRITERIA:DEFINITION:CriteriaBase &crit = &fact.GetCriteria(...);
         *      ... &crit.Check(...) ... &crit.Check(...)
         *
         * stores one CRITERIABASE row (two method rows before); 29998's
         * nested `Local PTAF_CORE:DEFN:UserListBase &u = ...` stores
         * USERLISTBASE at the declaration, before the next statement's rows.
         * LOCAL SNAPSHOT: 7 generated lists closer, 0 farther (30065
         * forward-exact); uninitialized nested Locals alone, 2.
         */
        (context?.builtinObjectDeclarationsHaveMethodWideLifetime === true ||
          (functionDepth === 0 && controlDepth === 0 && sawTopLevelExecutableStatement) ||
          (functionDepth > 0 && !/^\s*=/.test(source.slice(pos)))) &&
        !/^\s*=\s*create\b/i.test(source.slice(pos))
      ) {
        ensureLocalApplicationClassPackageReference(
          appClass.packagePath,
          appClass.className
        );
      }

      while (true) {
        space();
        if (source[pos] !== ',') break;

        pos++;
        chunks.push(fixed(','));
        space();

        const additionalVariable =
          /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
        if (additionalVariable === undefined) {
          return fail('expected an ASCII &variable after ,');
        }

        chunks.push(variable());
        registerApplicationClassVariable(additionalVariable);
      }

      space();
      if (source[pos] === '=') {
        lastLocalHadInitializer = true;

        pos++;
        chunks.push(fixed('='));
        expression();
      }

      return;
    }

    const type =
      /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];

    chunks.push(typeName());

    /*
     * Cycle 45: captured so the `firstDeclaredVariable`/`declaredVariable`
     * handling below (which only ever branches on `type`, not on this) can
     * also recognize `Local array of Record &x;` -- see its own use below
     * for why.
     */
    let declaredArrayElementType: string | undefined;

    // Calibrated compound declarations:
    //   Local array of string &values;
    // => 44 40 "array" 40 "of" 40 "string" 01 "&values"
    //   Local array &values;
    // => 44 40 "array" 01 "&values"
    let arrayDeclarationStartedGroup = false;
    if (/^array$/i.test(type ?? '')) {
      space();

      /*
       * Cycle 94: an initialized top-level `Local array of <Type> &x = ...`
       * after executable code has begun starts its new reference group (see
       * `declarationHasInitializer` below) BEFORE its element type's
       * PACKAGE row, exactly as the scalar form already does.
       *
       * 2092:  Local Record &record;                                  RECORD 12
       *        Local array of Record &records = CreateArrayRept(...);  RECORD 13
       *
       * In the leading declaration section the same two lines share one
       * RECORD row (2093, 18375, 18376), so this applies only once that
       * section has ended.
       */
      if (
        ordinaryProgram &&
        functionDepth === 0 &&
        controlDepth === 0 &&
        sawTopLevelExecutableStatement &&
        /^(?:of\s+[A-Za-z_][A-Za-z0-9_:]*\s*)+&[A-Za-z0-9_]+#?(?:\s*,\s*&[A-Za-z0-9_]+#?)*\s*=(?!=)/i.test(source.slice(pos))
      ) {
        controlGroup = nextControlGroup++;
        arrayDeclarationStartedGroup = true;
      }

      const ofMatch = /^of\b/i.exec(source.slice(pos));

      /*
       * `Local array &values;` (bare, no `of ElementType` clause) is
       * itself a valid, untyped array declaration -- the same allowance
       * `arrayElementTypes()` grants Component/Global/nested array
       * declarations.
       *
       * WEBLIB_MCF_QU.MCF_UQ_TASK_UT.FieldFormula (definition 6350):
       *
       *   Local array &NODE_ARRAY, &PARENT_ARRAY, &BRANCH_ARRAY;
       *
       * stores only `44 40 "array" 01 "&NODE_ARRAY" ...` -- no `of`
       * keyword byte at all.
       */
      if (ofMatch) {
        pos += ofMatch[0].length;
        chunks.push(textOperand(0x40, TokenKind.Keyword, 'of'));

        space();

        let elementType =
          /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];

        if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(source.slice(pos))) {
          const appClass = applicationClassPath();
          chunks.push(appClass.bytes);
          if (unitScopedClassRows) {
            // Cycle 94: see `useApplicationClassRow`.
            useApplicationClassRow(appClass.packagePath, appClass.className);
          } else {
            ensureLocalApplicationClassPackageReference(appClass.packagePath, appClass.className);
          }
        } else {
          chunks.push(typeName());
          if (/^array$/i.test(elementType ?? '')) {
            elementType = arrayElementTypes();
          }
        }

        declaredArrayElementType = elementType;

        if (elementType !== undefined) {
          allocateBuiltinTypePackageReferenceIfSupported(elementType, 'local-array-element');
        }
      }
    }

    /*
     * A top-level `Local <BuiltinType> &var = <initializer>;` declaration
     * starts a new ordinary reference-allocation group, the same
     * "assignsCreateRecord" rule already applies to a plain top-level
     * `&REC1 = CreateRecord(...)` RE-assignment (see its own declaration
     * comment a few hundred lines below). Two consecutive top-level
     * declarations of the SAME built-in type, each with its own
     * initializer, each allocate their OWN fresh PACKAGE dependency row --
     * they do NOT dedupe with each other the way two consecutive BARE
     * (uninitialized) declarations of the same type already correctly do.
     *
     * GPS_POSTPLN_DTL.RowInit (definition 22515):
     *
     *   Local SQL &_SQL = GetSQL(SQL.GPS_ACTION_TBL_SQL);
     *   Local SQL &_SQLx = GetSQL(SQL.GPS_ACTION_LNG_SQL);
     *
     * stores two separate PACKAGE/SQL rows (NAMENUM 4 and 6), while
     * AE_WRK.AE_GO.DeleteAEInfo (definition 802)'s three BARE
     * `Local SQL &SelectRec;` / `&SelectOvrd;` / `&Delete;` declarations
     * share exactly one. A declaration inside a nested control structure
     * (If/For/etc, controlDepth > 0) is unaffected -- GPMX_...ACA_EMP_XMIT_PART3
     * (definition 19565)'s three INITIALIZED `Local Rowset` declarations
     * inside an `If %Page = ... Then` block correctly dedupe to one
     * PACKAGE/ROWSET row, proving this rule is specific to top-level
     * (controlDepth === 0) declarations, exactly mirroring
     * assignsCreateRecord's own scope.
     */
    const declarationHasInitializer =
      /^\s*&[A-Za-z0-9_]+#?(?:\s*,\s*&[A-Za-z0-9_]+#?)*\s*=(?!=)/.test(
        source.slice(pos)
      );

    if (declarationHasInitializer && controlDepth === 0 && !arrayDeclarationStartedGroup) {
      controlGroup = nextControlGroup++;
    }

    /*
     * Compiler architecture: this was the most complete of the 7
     * historically-independent type dispatch chains (see
     * BUILTIN_TYPE_REGISTRY's own comment) -- its per-type corpus
     * citations are preserved there rather than here: ApiObject
     * (definition 772), Grid (1046), GridColumn (45-definition census,
     * definition 10760), Message (15-definition census), JavaObject
     * (10-definition census), TransformData (31-definition census),
     * Chart (17-definition census), ProcessRequest (definition 1749).
     */
    if (type !== undefined) {
      allocateBuiltinTypePackageReferenceIfSupported(type, 'local');
    }

    /*
    * A Local declaration may declare multiple variables of the same type:
    *
    *   Local Rowset &RS1, &RS2;
    *   Local number &I, &FirstRow, &HireRow;
    *
    * The comma is the ordinary 0x03 punctuation opcode and each variable
    * remains an ordinary 0x01 text operand.
    */
    /*
     * Cycle 45: `Local array of Record &x;` tracked separately from scalar
     * `Local Record &x;` -- see `recordArrayVariables`'s own declaration
     * comment for why an indexed element (`&x [&i].FIELDNAME`) must be
     * distinguished from a bare access on the array itself (`&x.Len`,
     * `&x.Push(...)`), which is why this is a distinct set rather than
     * folded into `recordVariables`.
     */
    const isRecordArray =
      /^array$/i.test(type ?? '') &&
      /^Record$/i.test(declaredArrayElementType ?? '');

    space();
    const firstDeclaredVariable =
      /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
    if (/^Record$/i.test(type ?? '') && firstDeclaredVariable) {
      recordVariables.add(firstDeclaredVariable.toLowerCase());
    } else if (isRecordArray && firstDeclaredVariable) {
      recordArrayVariables.add(firstDeclaredVariable.toLowerCase());
    } else if (/^Row$/i.test(type ?? '') && firstDeclaredVariable) {
      rowVariables.add(firstDeclaredVariable.toLowerCase());
    } else if (/^Rowset$/i.test(type ?? '') && firstDeclaredVariable) {
      rowsetVariables.add(firstDeclaredVariable.toLowerCase());
    }
    chunks.push(variable());

    while (true) {
      space();

      if (source[pos] !== ',') {
        break;
      }

      pos++;
      chunks.push(fixed(','));

      space();
      const declaredVariable =
        /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
      if (/^Record$/i.test(type ?? '') && declaredVariable) {
        recordVariables.add(declaredVariable.toLowerCase());
      } else if (isRecordArray && declaredVariable) {
        recordArrayVariables.add(declaredVariable.toLowerCase());
      } else if (/^Row$/i.test(type ?? '') && declaredVariable) {
        rowVariables.add(declaredVariable.toLowerCase());
      } else if (/^Rowset$/i.test(type ?? '') && declaredVariable) {
        rowsetVariables.add(declaredVariable.toLowerCase());
      }
      chunks.push(variable());
    }

    space();

    if (source[pos] === '=') {
      lastLocalHadInitializer = true;

      pos++;
      chunks.push(fixed('='));

      space();

      if (/^boolean$/i.test(type ?? '') && source[pos] === '(') {
        parenthesized(booleanExpression, false);
      } else {
        expression();
      }
    }
  };

  const globalDeclaration = () => {
    chunks.push(fixed('Global'));

    space();

    /*
     * Global declarations may use a fully-qualified Application Class type:
     *
     *   Global CO_NAVIGATN:Stack &MyNavStack;
     *
     * DERIVED_CO.FUNCLIB.FieldFormula stores the type inline as:
     *
     *   45 0A "CO_NAVIGATN" 57 0A "Stack" 01 "&MyNavStack" 15
     *
     * The declaration itself does not allocate a PSPCMNAME dependency row.
     * The runtime create later in the program owns that dependency.
     */
    const appClassLookahead =
      /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(
        source.slice(pos)
      );

    if (appClassLookahead) {
      const appClass = applicationClassPath();
      chunks.push(appClass.bytes);

      // Cycle 82: Application Class programs only -- see the matching
      // `componentDeclaration()` comment (130/130 census, e.g. 29531).
      if (context?.builtinObjectDeclarationsHaveMethodWideLifetime) {
        ensureLocalApplicationClassPackageReference(appClass.packagePath, appClass.className);
      } else if (unitScopedClassRows) {
        // Cycle 94: see `useApplicationClassRow`.
        useApplicationClassRow(appClass.packagePath, appClass.className);
      }

      space();
      /*
       * Cycle 94: a Global Application Class instance is a method-call
       * receiver like a Local or Component one. Stored opens a method row
       * for every top-level call on one (58 / 58 single-call gaps, e.g.
       * 18698); 66 lists move closer, 0 farther.
       */
      const globalVariable = /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
      if (unitScopedClassRows && globalVariable !== undefined) {
        applicationClassVariables.set(globalVariable.toLowerCase(), {
          packagePath: appClass.packagePath,
          className: appClass.className,
          reuseRuntimeCreateForMethods: false
        });
      }
      chunks.push(variable());
      return;
    }

    const declaredType = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    chunks.push(typeName());
    /*
     * Compiler architecture: File (Cycle 75, 965-candidate census), Rowset
     * (Cycle 76, 962-candidate census -- Cycle 7's own "genuinely mixed"
     * caution was scoped to the SEPARATE Function/Method-parameter Rowset
     * population, not this declaration scope, and was itself later
     * disproven for parameters too, see registerTypedParameter's own
     * history), and Record (71-candidate census) all route through the
     * shared registry now; `array of Record` is `global-array-element`'s
     * own, narrower cell (only Record evidenced there, unlike Local's
     * wider array-element coverage).
     */
    if (/^array$/i.test(declaredType ?? '')) {
      const elementType = arrayElementTypes();
      if (elementType !== undefined) {
        allocateBuiltinTypePackageReferenceIfSupported(elementType, 'global-array-element');
      }
    } else if (declaredType !== undefined) {
      allocateBuiltinTypePackageReferenceIfSupported(declaredType, 'global');
    }

    space();
    /*
     * Cycle 7 (Phase 7C): `Global Rowset &x;` (evidenced: 5 definitions)
     * was never added to any declaration-tracking set at all --
     * `globalDeclaration()` had no type-specific variable tracking prior
     * to this cycle. Added only to the isolated ChainSemantics-only set
     * (see its own declaration comment), not the shared `rowsetVariables`,
     * to avoid changing any OTHER existing decision's behavior for Global
     * variables. No Global-Row or Global-Record gap was evidenced, so
     * neither is added here.
     */
    const firstGlobalVariable =
      /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
    if (/^Rowset$/i.test(declaredType ?? '') && firstGlobalVariable) {
      chainSemanticsDeclaredRowsetVariables.add(firstGlobalVariable.toLowerCase());
    }
    /*
     * Cycle 98: a Global Record is a Record receiver like a Local or
     * Component one: stored binds `&gRec.FIELD` as a FIELD row in all 70
     * occurrences (20 definitions, e.g. 4429, 4589), none inline.
     */
    if (/^Record$/i.test(declaredType ?? '') && firstGlobalVariable) {
      recordVariables.add(firstGlobalVariable.toLowerCase());
    }
    chunks.push(variable());

    while (true) {
      space();

      if (source[pos] !== ',') {
        break;
      }

      pos++;
      chunks.push(fixed(','));

      space();
      const nextGlobalVariable =
        /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
      if (/^Rowset$/i.test(declaredType ?? '') && nextGlobalVariable) {
        chainSemanticsDeclaredRowsetVariables.add(nextGlobalVariable.toLowerCase());
      }
      if (/^Record$/i.test(declaredType ?? '') && nextGlobalVariable) {
        recordVariables.add(nextGlobalVariable.toLowerCase());
      }
      chunks.push(variable());
    }
  };

  const panelGroupDeclaration = () => {
    /*
     * PanelGroup declarations use opcode 0x51.
     *
     * DERIVED_CO.FUNCLIB.FieldFormula:
     *   PanelGroup number &NbrHeaders, &NbrGrids;
     *   PanelGroup string &SortBy;
     *   PanelGroup boolean &Transfer;
     *
     * Stored shape:
     *   51 40 <type> 01 <var> ...
     */
    chunks.push(Buffer.from([0x51]));

    space();
    const declaredType = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    chunks.push(typeName());
    /*
     * Cycle 103: PanelGroup is the legacy spelling of Component, and a
     * built-in type declared with it needs the same PACKAGE/<TYPE> row
     * (`componentDeclaration`). Every program whose only declaration of
     * a built-in type is a PanelGroup one stores the row (23/23: Rowset
     * 14, Message 4, XmlDoc 2, Record, Field, Row), e.g. 959's leading
     * `PanelGroup Message &Msg;` (row 2) and 3618's `PanelGroup Record`.
     */
    if (declaredType !== undefined) {
      allocateBuiltinTypePackageReferenceIfSupported(declaredType, 'component');
    }
    /*
     * Cycle 121: and its variables are typed exactly as a Component
     * declaration's (`componentDeclaration`): 4434 `PanelGroup Record
     * &REC_JOB;` ... `&REC_JOB.EMPLID.Value` stores a FIELD row, 8115
     * `PanelGroup Rowset &RS2;` binds `&RS2(&R1).GPHK_PSLP_SECT.SEQ_NUM`.
     */
    const registerPanelGroupVariable = (name: string | undefined) => {
      if (name === undefined) return;
      if (/^Record$/i.test(declaredType ?? '')) {
        recordVariables.add(name.toLowerCase());
      } else if (/^Rowset$/i.test(declaredType ?? '')) {
        chainSemanticsDeclaredRowsetVariables.add(name.toLowerCase());
      } else if (/^Row$/i.test(declaredType ?? '')) {
        chainSemanticsDeclaredRowVariables.add(name.toLowerCase());
        rowVariables.add(name.toLowerCase());
      }
    };

    space();
    registerPanelGroupVariable(/^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0]);
    chunks.push(variable());

    while (true) {
      space();

      if (source[pos] !== ',') {
        break;
      }

      pos++;
      chunks.push(fixed(','));

      space();
      registerPanelGroupVariable(/^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0]);
      chunks.push(variable());
    }
  };

  const componentDeclaration = () => {
    chunks.push(fixed('Component'));

    space();
    const appClassType =
      /^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(source.slice(pos))
        ? applicationClassPath()
        : undefined;
    const declaredType =
      appClassType === undefined
        ? /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0]
        : undefined;
    chunks.push(appClassType?.bytes ?? typeName());
    if (/^array$/i.test(declaredType ?? '')) {
      arrayElementTypes();
      if (unitScopedClassRows && arrayElementApplicationClass !== undefined) {
        // Cycle 94: see `useApplicationClassRow` (14888).
        useApplicationClassRow(
          arrayElementApplicationClass.packagePath,
          arrayElementApplicationClass.className
        );
      }
    }
    /*
     * `Component <BuiltinType> &var;` allocates the same PACKAGE/<TYPE>
     * local object dependency row the matching Local declaration already
     * does (see BUILTIN_TYPE_REGISTRY). Evidenced across Record, Rowset
     * (DERIVED_ABS_EA.CLEAR_ALL.FieldChange, definition 4067), XmlDoc
     * (AMM_ARCHIVE_WK.FUNCLIB.FieldFormula, definition 935), File (Cycle
     * 75, 11-candidate corpus population), ApiObject (14-candidate
     * population), and Row (34-candidate population) -- 0 contradictions
     * across all six.
     */
    if (declaredType !== undefined) {
      allocateBuiltinTypePackageReferenceIfSupported(declaredType, 'component');
    }

    /*
     * Component declarations may declare multiple variables of the same
     * type, using the ordinary comma punctuation opcode:
     *
     *   Component string &A, &B, &C;
     *
     * => 54 40 "string"
     *    01 "&A"
     *    03 01 "&B"
     *    03 01 "&C"
    */
    space();
    const firstVariable =
      /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
    if (/^Record$/i.test(declaredType ?? '') && firstVariable) {
      recordVariables.add(firstVariable.toLowerCase());
    } else if (/^Rowset$/i.test(declaredType ?? '') && firstVariable) {
      /*
       * Cycle 7 (Phase 7C): `Component Rowset &x;` (evidenced above,
       * definition 4067) was never added to any declaration-tracking
       * set -- only into the isolated ChainSemantics-only set (see its
       * own declaration comment), not the shared `rowsetVariables`, to
       * avoid changing any OTHER existing decision's behavior for
       * Component Rowset variables.
       */
      chainSemanticsDeclaredRowsetVariables.add(firstVariable.toLowerCase());
    } else if (/^Row$/i.test(declaredType ?? '') && firstVariable) {
      /*
       * Cycle 7 (Phase 7C): `Component Row &x;` -- same gap and same
       * isolated-set treatment as `Component Rowset` immediately above.
       */
      chainSemanticsDeclaredRowVariables.add(firstVariable.toLowerCase());
      /*
       * Cycle 98: a Component Row is a Row receiver like a Local one.
       * Stored binds `&cRow.REC` as a RECORD row in all 176 occurrences
       * (8 definitions, e.g. 1066, 22666) and never writes a record name
       * inline after one; before this the encoder never bound it.
       */
      rowVariables.add(firstVariable.toLowerCase());
    }
    /*
     * A Component-declared Application Class instance reuses its
     * runtime-create PSPCMNAME dependency for later method calls, exactly
     * like a declaration-phase Local Application Class variable does (see
     * the matching Local-declaration logic above, "offset 179"/"offset
     * 411"). A Component declaration is itself always declaration-phase
     * (it appears before any executable code), so this is unconditional
     * here.
     *
     * ADDRESS_SBR.COUNTRY.RowInit (definition 525):
     *
     *   Component EO:CA:Address &cobj_EO_CA_Address;
     *   ...
     *   If &cobj_EO_CA_Address = Null Then
     *      &cobj_EO_CA_Address = create EO:CA:Address(&Addr_Rec, &Der_Address, &Der_addr);
     *   Else
     *      &cobj_EO_CA_Address.ResetAddressRecord(&Addr_Rec);
     *      &cobj_EO_CA_Address.ResetDerivedAddressRecord(&Der_Address);
     *      &cobj_EO_CA_Address.ResetDerivedAddrRecord(&Der_addr);
     *   End-If;
     *
     * Direct stored-PSPCMNAME enumeration proves there is NO separate
     * method-dependency PSPCMNAME row at all for any of the three Reset*
     * calls -- only the single runtime-create PACKAGE|ADDRESS row exists.
     * The prior hardcoded `reuseRuntimeCreateForMethods: false` for every
     * Component Application Class declaration was backwards for this case.
     */
    const componentAppClassReuseRuntimeCreateForMethods =
      functionDepth === 0 &&
      !(controlDepth === 0 && sawTopLevelExecutableStatement);

    if (appClassType !== undefined && firstVariable) {
      applicationClassVariables.set(firstVariable.toLowerCase(), {
        packagePath: appClassType.packagePath,
        className: appClassType.className,
        reuseRuntimeCreateForMethods:
          componentAppClassReuseRuntimeCreateForMethods
      });
      if (context?.builtinObjectDeclarationsHaveMethodWideLifetime) {
        /*
         * Cycle 82: in an Application Class program the class's imports
         * live in a SEPARATE leading fragment, so the fragment-local
         * `sawWildcardImport` below never sees them. LOCAL SNAPSHOT census
         * (all App Classes): stored has the declared class's PACKAGE row
         * for 130/130 top-level Global/Component App Class declarations;
         * 29420's `Component GPS_WFS_REPORT_MANAGER:MappingEntry &_entry;`
         * (wildcard-imported, never used elsewhere) is stored at NAMENUM
         * 5, at the declaration. Allocate here, reusing any identity an
         * explicit import or earlier declaration already established.
         */
        ensureLocalApplicationClassPackageReference(
          appClassType.packagePath,
          appClassType.className
        );
      } else {
        if (unitScopedClassRows) {
          // Cycle 94: see `useApplicationClassRow` (18028, 24499: the
          // import row of a named-import class is in the same unit).
          useApplicationClassRow(
            appClassType.packagePath,
            appClassType.className
          );
        } else if (sawWildcardImport) {
          addApplicationClassReference(
            appClassType.packagePath,
            appClassType.className
          );
        }
      }
    }
    chunks.push(variable());

    while (true) {
      space();

      if (source[pos] !== ',') {
        break;
      }

      pos++;
      chunks.push(fixed(','));

      space();
      /*
       * PeopleTools preserves a trailing comma in ordinary Component
       * declarations as the normal comma opcode immediately before the
       * declaration semicolon. HCDEV definitions 14721, 17309, 21463, and
       * 21578 independently contain this form (including scalar, Rowset,
       * and array types):
       *
       *   Component string &A,;
       *
       * => 54 40 "string" 01 "&A" 03 15
       */
      if (source[pos] === ';') {
        break;
      }

      const nextVariable =
        /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
      if (/^Record$/i.test(declaredType ?? '') && nextVariable) {
        recordVariables.add(nextVariable.toLowerCase());
      } else if (/^Rowset$/i.test(declaredType ?? '') && nextVariable) {
        chainSemanticsDeclaredRowsetVariables.add(nextVariable.toLowerCase());
      } else if (/^Row$/i.test(declaredType ?? '') && nextVariable) {
        chainSemanticsDeclaredRowVariables.add(nextVariable.toLowerCase());
        rowVariables.add(nextVariable.toLowerCase());
      }
      if (appClassType !== undefined && nextVariable) {
        applicationClassVariables.set(nextVariable.toLowerCase(), {
          packagePath: appClassType.packagePath,
          className: appClassType.className,
          reuseRuntimeCreateForMethods:
            componentAppClassReuseRuntimeCreateForMethods
        });
      }
      chunks.push(variable());
    }
  };

  const componentLifeDeclaration = () => {
    /*
     * ComponentLife is a fifth declarator alongside Local/Global/
     * Component/Constant (0x79, "a fourth declarator" per Component's own
     * 0x56 comment) -- a component-interface object lifetime scope, e.g.
     * `ComponentLife PTPN_PUBLISH:PublishToWindow &wlSrch;`. Structurally
     * identical declaration grammar to Component (type, then one or more
     * comma-separated &variables), confirmed by CAFNUI_CTRL_WRK.FUNCLIB.
     * FieldFormula (definition 2092): `ComponentLife string &p_compkey,
     * &p_entityname;`.
     *
     * Cycle 104: in an ordinary program a ComponentLife Application Class
     * variable is a receiver like a Component one: the declaration uses
     * its class in the allocation unit, and a method call on the variable
     * uses it in the call's unit -- a new method row unless the unit
     * already has one (`useApplicationClassRow`, Cycle 94). LOCAL SNAPSHOT
     * (`cycle104-receiver-method-row-census.ts`): the Cycle 94 prediction
     * equals stored in all 8 aligned gaps; untracked, the calls had no row
     * (2200 `ComponentLife CAF_SEARCH_NUI:Search &cafsrch;` then
     * `&cafsrch.ClearAllPromptFilters();` -> PACKAGE SEARCH with
     * APPCLASSMETHOD CLEARALLPROMPTFILTERS, and three more). Exempt from
     * the external-metadata detector (`externalMetadataExempt`).
     */
    chunks.push(fixed('ComponentLife'));

    space();
    const appClassType =
      /^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(source.slice(pos))
        ? applicationClassPath()
        : undefined;
    const declaredType =
      appClassType === undefined
        ? /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0]
        : undefined;
    chunks.push(appClassType?.bytes ?? typeName());
    if (/^array$/i.test(declaredType ?? '')) {
      arrayElementTypes();
    }
    const tracksClass = unitScopedClassRows && appClassType !== undefined;
    if (tracksClass) {
      useApplicationClassRow(appClassType!.packagePath, appClassType!.className);
    }
    const registerReceiver = () => {
      const name = /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
      if (tracksClass && name) {
        applicationClassVariables.set(name.toLowerCase(), {
          packagePath: appClassType!.packagePath,
          className: appClassType!.className,
          reuseRuntimeCreateForMethods: false,
          externalMetadataExempt: true
        });
      }
    };

    space();
    registerReceiver();
    chunks.push(variable());

    while (true) {
      space();

      if (source[pos] !== ',') {
        break;
      }

      pos++;
      chunks.push(fixed(','));

      space();
      registerReceiver();
      chunks.push(variable());
    }
  };

  const constantDeclaration = () => {
    chunks.push(fixed('Constant'));

    space();
    chunks.push(variable());

    space();

    if (source[pos] !== '=') {
      fail('expected = in Constant declaration');
    }

    pos++;
    chunks.push(fixed('='));

    expression();
  };

  const systemVariable = (): Buffer => {
    const match = /^%[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));

    if (!match) {
      return fail('expected a PeopleCode system variable');
    }

    const name = match[0];
    pos += name.length;

    return textOperand(
      0x12,
      TokenKind.Name,
      name
    );
  };
  
  let pos = 0;
  let depth = 0;
  const chunks: Buffer[] = [];
  const references: PeopleCodeReference[] = [];

  // Application-class declarations establish receiver type information used
  // to emit PSPCMNAME dependency metadata for method calls.
  const applicationClassVariables = new Map<
    string,
    {
      packagePath: string[];
      className: string;
      reuseRuntimeCreateForMethods: boolean;
      /*
       * Cycle 104: a receiver the Cycle 93 external-metadata detector must
       * not count (a call through its property is not counted as an
       * unresolved receiver call), so the fallback population stays the
       * one Cycle 93 calibrated: these receivers were unknown to it.
       */
      externalMetadataExempt?: boolean;
    }
  >();

  /*
   * Keep Function-local Application Class receiver provenance separate from
   * top-level receiver provenance.
   *
   * Offset 420 requires Function-local method calls on &MYDISPLAY to allocate
   * distinct PACKAGE method rows:
   *
   *   &MYDISPLAY.SetupDisplayTmplt()
   *   &MYDISPLAY.GetChartfieldnrow(...)
   */
  /*
   * Cycle 104: variables declared `array of <Package:Class>` (Local /
   * Global / Component / ComponentLife), with their array depth. Indexing
   * one that many times yields an element of the class: a receiver under
   * the Cycle 94 unit rule like a declared instance -- `&arr [i].M(...)`
   * uses the class in the call's allocation unit, a method row unless the
   * unit already has one. LOCAL SNAPSHOT
   * (`cycle104-receiver-method-row-census.ts`): the Cycle 94 prediction
   * equals stored in all 29 aligned array-element gaps, named and wildcard
   * imports alike; untracked, the calls had no row (24504
   * `Component array of ADS_DMW:UI:ProjectBindsGrid &AdsProjectBinds;` ...
   * `&AdsProjectBinds [&CurrentAds].GenerateHTML()`). Ordinary programs
   * with unit-scoped class rows only; element receivers are exempt from
   * the Cycle 93 external-metadata detector (`externalMetadataExempt`).
   */
  const applicationClassArrayVariables = new Map<string, { packagePath: string[]; className: string; depth: number }>();
  const functionApplicationClassVariables = new Map<
    string,
    {
      packagePath: string[];
      className: string;
      reuseRuntimeCreateForMethods: boolean;
      externalMetadataExempt?: boolean;
    }
  >();

  const recordVariables = new Set<string>();
  const rowVariables = new Set<string>();
  const rowsetVariables = new Set<string>();

  /*
   * Cycle 45: `Local array of Record &x;` declarations, tracked separately
   * from `recordVariables`. A bare array-of-Record variable is itself an
   * ARRAY object (`.Len`, `.Push(...)`, `.Delete(...)`, ...), not a Record
   * -- only an INDEXED element (`&x [&i]`) narrows it to a Record, whose own
   * bare `.MEMBER` is then a FIELD reference the same way a scalar `Local
   * Record &rec;`'s `.MEMBER` already is. Folding this into `recordVariables`
   * directly regressed definition 29522 itself: `&ARYDrvDtl.Len` (the bare
   * array's own Length property, no subscript) was wrongly resolved as a
   * FIELD dependency, corrupting the reference stream before the intended
   * `&ARYDrvDtl [&i].DUR` target was ever reached. This set alone only marks
   * "this variable IS a Record when indexed" -- see its own use immediately
   * before the postfix-chain `expectedReferenceMember`/`chainSemantics`
   * computation for the indexing-aware gate that actually applies it.
   */
  const recordArrayVariables = new Set<string>();

  /*
   * Cycle 7 (Phase 7C): supplementary, ChainSemantics-only declaration
   * tracking, kept ISOLATED from `recordVariables`/`rowVariables`/
   * `rowsetVariables` above on purpose -- those sets are consulted by
   * several OTHER, unrelated existing decisions (`rowStartsRecordFieldChain`,
   * the FIELD-mode row-shorthand pools, etc.), so writing into them for
   * newly-recognized declaration shapes would risk changing behavior far
   * beyond this cycle's one target (postfix .GetRecord(...)/.GetRow(...)/
   * .GetRowset(...) dependency eligibility). These sets are read ONLY by
   * `initialChainSemantics` below, so populating them can only affect that
   * one, purely-additive consumer.
   *
   * Populated only where Phase 7A's full-corpus census found real,
   * currently-EXACT definitions using a declaration shape
   * `recordVariables`/`rowVariables`/`rowsetVariables` do not already
   * cover: `Component Rowset &x;` (139 definitions, 70 EXACT),
   * `Component Row &x;` (1 definition), `Global Rowset &x;` (5
   * definitions), and a `Rowset`-typed function parameter (48
   * definitions, 4 EXACT) -- see the Cycle 7 report in
   * .claude/corpus-progress.md for the full census. `Local Row &x;` and
   * a `Row`-typed parameter are NOT added here because they already join
   * the shared `rowVariables` set via existing code; `Local`/`Component
   * Record` and `Global Record` likewise already join `recordVariables`.
   * No Record-typed-parameter or Global-Row gap was evidenced in the
   * census, so neither is added here (per this codebase's own established
   * "do not generalize without evidence" discipline).
   */
  const chainSemanticsDeclaredRowVariables = new Set<string>();
  const chainSemanticsDeclaredRowsetVariables = new Set<string>();

  /*
   * Runtime `create` dependencies are distinct from import dependencies, but
   * repeated creates of the same Application Class share one PSPCMNAME row.
   *
   * Example from ACCOMPLISHMENTS.EMPLID.SavePostChange:
   *
   *   import ...:collProfileItemType;                 // PACKAGE row 11
   *   &a = create ...:collProfileItemType();          // PACKAGE row 21
   *   &b = create ...:collProfileItemType();          // reuses row 21
   *
   * Keep this registry separate from references[] so an import does not
   * suppress the first runtime-create dependency.
   */
  const runtimeCreateReferences = new Map<string, PeopleCodeReference>();

  /*
   * Local object-type declaration PACKAGE dependencies are scoped by the
   * current control group.
   *
   * Same-scope declarations reuse:
   *   Local File &fileWSDL;
   *   ...
   *   Local File &XMLFile;              // same PACKAGE FILE
   *
   * Nested-scope declarations allocate a fresh dependency:
   *   Local Row &row;                   // PACKAGE ROW seq 2
   *   If ...
   *      Local Row &L1Row, &L2Row;      // PACKAGE ROW seq 5
   */
  const localObjectPackageReferences =
    new Map<string, PeopleCodeReference>();

  /*
   * Cycle 55: local Application-Class-typed declarations share the SAME
   * method-wide reuse pool `ensureLocalObjectPackageReference` already
   * proved for built-in object types (Cycle 36's 114/122-control finding
   * just above) -- a corpus-wide census of every Application Class method
   * body containing 2+ `Local`/`Local array of` declarations of the same
   * Application-Class leaf type (173 candidates, scalar/array-of mixed
   * freely, up to 21 declarations of one leaf in a single method) found
   * stored PSPCMNAME allocates exactly ONE identity in every single case
   * (173/173, zero contradictions) -- regardless of scalar vs array-of
   * shape and regardless of declaration count. `addApplicationClassReference`
   * itself has no dedup at all, so each qualifying declaration allocated an
   * independent reference (up to 30 duplicates observed for one leaf type
   * in one method). Scoped identically to `ensureLocalObjectPackageReference`
   * (guarded by `builtinObjectDeclarationsHaveMethodWideLifetime`, set only
   * for Application Class method-body fragments) so ordinary PeopleCode's
   * existing Local-declaration behavior is completely unaffected.
   */
  const localApplicationClassPackageReferences =
    new Map<string, PeopleCodeReference>();

  const ensureLocalApplicationClassPackageReference = (
    packagePath: string[],
    className: string
  ): PeopleCodeReference => {
    if (!context?.builtinObjectDeclarationsHaveMethodWideLifetime) {
      return addApplicationClassReference(packagePath, className);
    }

    const key = `${functionDepth}:${packagePath.map(component => component.toLowerCase()).join(':')}:${className.toLowerCase()}`;

    const existing = localApplicationClassPackageReferences.get(key);
    if (existing !== undefined) {
      return existing;
    }

    /*
     * Cycle 56: a `create Package:X:Y(...)`-initialized local of the SAME
     * leaf type occurring earlier in this same method already established
     * an identity through `runtimeCreateReferences` (see
     * `ensureRuntimeCreateReference`'s own mirrored check below) -- reuse
     * it rather than allocating a second one for a plain/array-of Local
     * declaration of the identical leaf that happens to follow it.
     */
    const runtimeCreateKey = [...packagePath, className]
      .map(component => component.toLowerCase())
      .join(':');
    const createdEarlier = runtimeCreateReferences.get(runtimeCreateKey);
    if (createdEarlier !== undefined) {
      localApplicationClassPackageReferences.set(key, createdEarlier);
      return createdEarlier;
    }

    /*
     * Cycle 57: a compatible TYPE-dependency identity for this same leaf
     * may already have been committed by an EARLIER fragment -- an
     * explicit import, a property/instance declaration, or a
     * declaration-dependency allocation (Cycle 52) -- reuse it rather
     * than allocating a fresh method-scoped one. See
     * `EncodeFragmentContext.applicationClassTypeReferenceSession`'s own
     * declaration comment for the population evidence.
     */
    const classWide = context?.applicationClassTypeReferenceSession?.lookup({
      kind: 'package',
      packageName: className.toUpperCase(),
      objectName: packagePath[0]?.toUpperCase(),
      packagePath: packagePath.map((component, index) => index === 0 ? component.toUpperCase() : component),
      className: className.toUpperCase()
    });
    // Cycle 108: or a row an earlier fragment opened for a method call.
    const programRow = classWide ?? context?.applicationClassProgramRows?.find(className);
    if (programRow !== undefined) {
      localApplicationClassPackageReferences.set(key, programRow);
      return programRow;
    }

    const created = addApplicationClassReference(packagePath, className);
    localApplicationClassPackageReferences.set(key, created);
    return created;
  };

  /*
   * Cycle 94: Application Class PACKAGE rows in ORDINARY PeopleCode are
   * scoped to an ALLOCATION UNIT.
   *
   * Every use of a class -- a declaration's type, a `create`, an `As` cast,
   * a method call on a declared instance -- needs a PACKAGE row for that
   * class. It reuses the row the class already has IN THE CURRENT UNIT and
   * otherwise opens a new one (a method call's row carries the method
   * name). Units:
   *
   *   - the leading declaration section is ONE unit: the imports, the
   *     Component / Global / Declare declarations, the leading Locals and
   *     the first initialized Local that ends the section;
   *   - after that, every top-level statement is its own unit -- a whole
   *     If / For / While / Evaluate / try block is one statement, so
   *     everything nested in it shares one unit;
   *   - inside a Function, every statement of the body is its own unit
   *     (the header belongs to the unit before it).
   *
   * This one rule replaces the separate Cycle 93 rules, which were its
   * special cases:
   *
   *   named-import class, leading Local / Component / Global   the import
   *       row is in the same unit -> no row (381, 18028, 24499)
   *   wildcard-resolved class, leading declarations            no row in
   *       the unit yet -> one row, shared (15559, 14888, 17900)
   *   leading `Local X &v = create X()` of a named-import class  -> no row
   *       at all: 68 / 68 stored gaps
   *   late / function / nested Local                            own unit
   *       -> row, even for a named-import class (17893, 25507)
   *   `&v = create X(args)`                                      row after
   *       the argument rows, unless the unit already has one (20249)
   *   top-level method call on a declared instance               its own
   *       statement -> its own row: 522 stored single-call gaps, 0
   *       without a row; named and wildcard alike (18918, 22882)
   *   calls nested in one control structure or try               at most
   *       one row per class for the whole block (17594)
   *   a second call in a later top-level statement               a second
   *       row (26262)
   *
   * A call on an UNDECLARED variable allocates nothing (69 / 69 stored
   * gaps): the compiler has no class for it.
   *
   * Evidence: `cycle94-method-row-truth-census.ts` (positional truth from
   * stored PSPCMNAME, per call and per gap). LOCAL SNAPSHOT against the
   * Cycle 93 rules: 714 generated PSPCMNAME lists change, 704 move closer
   * to stored; of the 5 farther, 6622-6624 are displaced by unrelated
   * RECORD rows and 15257 / 15598 newly fall under the external-metadata
   * fallback. 520 lists become names-exact, 0 stop being so.
   *
   * Builtin object type rows (PACKAGE.RECORD, ROWSET, ...) do NOT share
   * these units (tested: 96 closer / 110 farther); they keep their own
   * control-group pool. Application Class programs are unaffected.
   *
   * A program whose rows depend on external class metadata uses all of
   * this too (Cycle 112); only its wildcard imports differ, see
   * `encodeOrdinaryProgramFragment`.
   */
  const ordinaryProgram = !context?.builtinObjectDeclarationsHaveMethodWideLifetime;
  /*
   * Cycle 121: every variable an ordinary program declares (any
   * declaration keyword, or a Function parameter, typed or not), by name.
   * A variable it never declares is an implicit untyped local: its member
   * chains are late-bound -- see `rootIsUndeclaredVariable` in primary().
   */
  const declaredVariableNames = new Set<string>();
  if (ordinaryProgram) {
    // The raw source: a declaration-shaped text inside a comment or string
    // only counts one more name as declared (the conservative direction).
    const code = source;
    for (const m of code.matchAll(/\b(?:Local|Global|Component|ComponentLife|PanelGroup|instance)\s+(?:array\s+of\s+)*[%A-Za-z_][\w:]*\s+(&\w+#?(?:\s*,\s*&\w+#?)*)/gi)) {
      for (const name of m[1].split(',')) declaredVariableNames.add(name.trim().toLowerCase());
    }
    for (const m of code.matchAll(/\bFunction\s+\w+\s*\(([^)]*)\)/gi)) {
      for (const name of m[1].matchAll(/&\w+#?/g)) declaredVariableNames.add(name[0].toLowerCase());
    }
  }
  // Cycle 109: a fragment of an Application Class program (its program-wide rows, `ApplicationClassProgramRows`).
  const applicationClassBody = context?.applicationClassProgramRows !== undefined;
  const unitScopedClassRows = ordinaryProgram;
  /*
   * Cycle 122: an ordinary program's Application Class row is identified by
   * its LEAF class name within an allocation unit -- the same identity the
   * PSPCMNAME row itself carries (`PACKAGE.<CLASS>`). 18372 imports
   * `CAFNUI_API:OBJECT:Action` and declares `Local array of
   * CAFNUI_CORE:OBJECT:Action` in the same leading unit: stored has one
   * ACTION row; 2125 likewise. See also `importStatement`.
   */
  const applicationClassKey = (_packagePath: string[], className: string): string =>
    className.toLowerCase();

  /*
   * Cycle 94 / 95: the ALLOCATION UNIT of an ordinary program -- the
   * leading declaration section (through the first initialized Local),
   * then each top-level statement (a whole control structure or try block
   * being one statement), each Function header after the leading section
   * (Cycle 111; the first Function's header stays in the leading section),
   * then each Function body statement. Advanced by the top-level statement
   * loop and the Function body loop. Application
   * Class rows (`classRowsByUnit`) and RECORD rows (`recordRowsByUnit`)
   * are scoped to it, each in its own pool.
   */
  let allocationUnit = 0;
  let nextAllocationUnit = 1;
  const startAllocationUnit = (): void => {
    allocationUnit = nextAllocationUnit++;
  };
  /*
   * Cycle 103: the BUILT-IN TYPE UNIT of an ordinary program -- the
   * lifetime of a built-in type's PACKAGE row (`ensureLocalObjectPackageReference`).
   * Every declaration of a built-in type (Local / Global / Component,
   * scalar or array element, Function parameter, Returns) needs the row;
   * within one unit the row is reused, a new unit opens a new one:
   *
   *   - the leading top-level declaration section, closed by the first
   *     executable statement or control structure, or after the first
   *     initialized declaration of any type (`sawTopLevelExecutableStatement`)
   *     -- but NOT closed by a Function definition: each Function starts a
   *     new RUN of it, and a Function's own header (parameter and Returns
   *     types) belongs to the run immediately before it;
   *   - otherwise: each top-level statement (a whole control structure
   *     being one), each Function header, each Function body statement.
   *
   * This differs from the Cycle 94 allocation unit only at Function
   * definitions (which close Cycle 94's leading section): that difference
   * is why built-in rows could not share `allocationUnit` (96 closer / 110
   * farther). LOCAL SNAPSHOT (`cycle103-builtin-package-lifetime-census.ts`,
   * `cycle103-builtin-package-unit-model.py`): 0 errors on 17,063 events
   * whose stored outcome is determined, and the opened-row count matches
   * stored in all 15,296 (type, interval) groups of 6,759 aligned ordinary
   * programs, 35 types; the control-group pool it replaces was wrong on 460
   * events / 285 intervals. E.g. AE_WRK.AE_GO.DeleteAEInfo (802): three
   * bare top-level `Local SQL` declarations in the leading section share
   * one row; definition 10263's three consecutive bare `Local Record`
   * statements inside a Function body open three (the control-group pool
   * shared one). Application Class method bodies keep their method-wide
   * pool (`builtinObjectDeclarationsHaveMethodWideLifetime`).
   */
  let builtinUnit = 0;
  let nextBuiltinUnit = 1;
  let builtinRunSplitPending = false;
  const startBuiltinUnit = (): void => {
    builtinUnit = nextBuiltinUnit++;
  };
  const classRowsByUnit = new Map<string, { unit: number; reference: PeopleCodeReference }>();
  const useApplicationClassRow = (
    packagePath: string[],
    className: string,
    methodName?: string
  ): PeopleCodeReference => {
    const key = applicationClassKey(packagePath, className);
    const current = classRowsByUnit.get(key);
    if (current !== undefined && current.unit === allocationUnit) {
      return current.reference;
    }
    const reference = addApplicationClassReference(packagePath, className, methodName);
    classRowsByUnit.set(key, { unit: allocationUnit, reference });
    return reference;
  };

  let sawFunctionDefinition = false;
  // Cycle 94: Application-Class-typed parameters of the Function header
  // being parsed; they become receivers once the body starts.
  const pendingParameterReceivers: { name: string; packagePath: string[]; className: string }[] = [];

  const same = (a: string | undefined, b: string | undefined): boolean =>
    (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

  // Every calibrated PSPCMNAME set has sequence 1 occupied by the owning
  // PeopleCode definition. When the caller supplies owner context we expose
  // that row explicitly. Without context we reserve the slot internally and
  // bind it to the first matching ordinary record/field reference if one is
  // encountered. This preserves the calibrated encodeProgram(source) API
  // while allowing persistence code to provide the exact owner.
  const referenceIndexOffset = context?.referenceIndexOffset ?? 0;
  let ownerReference: PeopleCodeReference = {
    index: referenceIndexOffset,
    sequence: referenceIndexOffset + 1,
    kind: 'owner',
    recordName: context?.owner?.recordName,
    fieldName: context?.owner?.fieldName
  };
  if (!context?.suppressOwnerReference) {
    references.push(ownerReference);
  }

  /*
   * Cycle 95: RECORD rows of an ordinary program live for exactly one
   * allocation unit (see `allocationUnit`). Within a unit every occurrence
   * of a record -- `Record.REC` (0x21) or row shorthand `<row>.REC` (0x4A),
   * whatever construct it sits in -- uses ONE row; the first occurrence in
   * a later unit opens a new one.
   *
   * Stored evidence (`cycle95-record-unit-census.ts`, LOCAL SNAPSHOT, every
   * ordinary definition, EXACT ones included): 52,932 RECORD occurrences in
   * 7,112 definitions. An occurrence whose record already occurred in the
   * same unit reuses (32,292 / 32,292: explicit 8,141, shorthand 24,151); an
   * occurrence whose record did not occur in the unit opens a new row
   * (20,640 / 20,640), even when the record occurred in an earlier unit
   * (7,158 of them). No reuse ever crosses a unit.
   *
   *   &rs = CreateRowset(Record.REC);     unit n: RECORD.REC row A
   *   &x = &rs(1).REC.FIELD.Value;        unit n+1: new row B
   *   If ... Then
   *      &y = &rs(1).REC.FIELD.Value;     unit n+2: new row C ...
   *      &z = &rs(2).REC.OTHER.Value;     ... reused inside the If
   *   End-If;
   *
   * The receiver, the construct (CreateRowset / GetRecord / CreateRecord
   * argument, bare Record.REC, shorthand) and the access direction do not
   * matter. The existing RECORD reuse caches still choose a candidate
   * row; this pool has the final word: `nextReference` returns the unit's
   * row instead of allocating a second one, and `unitRecordOperand`
   * replaces a row that a cache carried over from an earlier unit.
   * Application Class programs keep their method-wide RECORD lifetime.
   */
  const recordRowsByUnit = new Map<string, { unit: number; reference: PeopleCodeReference }>();
  const unitScopedRecordRows = !context?.builtinObjectDeclarationsHaveMethodWideLifetime;

  /*
   * Cycle 96: the same one-row-per-unit lifetime holds for these operand
   * rows of an ordinary program, each kind in its own pool, keyed by the
   * PSPCMNAME row identity (RECNAME.REFNAME):
   *
   *   FIELD         FIELD.<name>       30,420 / 30,420 reuse in unit; 40,405 /
   *                                      40,405 new otherwise (the same field
   *                                      name under different records is ONE
   *                                      FIELD row: the row carries no record)
   *   SCROLL        SCROLL.<name>      1,494 / 1,494 reuse; 7,186 / 7,186 new
   *   RECORD.FIELD  <REC>.<FIELD>      66,393 / 66,393 reuse; 96,991 / 96,991 new
   *                                      (code operands; Declare Function
   *                                      operands excluded, see below)
   *
   * Stored evidence: `cycle95-record-unit-census.ts --all`, every aligned
   * operand occurrence of every ordinary definition. Construct, receiver
   * and access direction do not matter, exactly as for RECORD.
   *
   * The key is the ROW identity, not the encoder's reference kind: the
   * statement-start path parses `Field.VERSION.Value = &x;` as a
   * record-field reference "Field|VERSION" (16080) and
   * `Scroll.X.Flush();` as "Scroll|X" (5037); both are the stored FIELD /
   * SCROLL row and share the unit's row with `Field.VERSION` /
   * `GetRowset(Scroll.X)` elsewhere in the statement.
   *
   * Declare Function operands (`Declare Function f PeopleCode REC.FIELD
   * FieldFormula`, reference kind 'declare-function') are NOT unit-scoped:
   * stored reuses one row per REC.FIELD for the whole program (3,692 in the
   * same unit, 10 across units -- 4601, 4602, 13823, 13915, 21321, 27129 --
   * and never a second row), so they stay out of these pools.
   */
  type UnitScopedRowFamily = 'field' | 'scroll' | 'record-field';
  const UNIT_SCOPED_ROW_FAMILIES: ReadonlySet<UnitScopedRowFamily> = new Set<UnitScopedRowFamily>(['field', 'scroll', 'record-field']);
  const unitScopedRows: Record<UnitScopedRowFamily, Map<string, { unit: number; reference: PeopleCodeReference }>> = {
    field: new Map(),
    scroll: new Map(),
    'record-field': new Map()
  };
  const unitScopedRowIdentity = (
    reference: Omit<PeopleCodeReference, 'index' | 'sequence'>
  ): { pool: Map<string, { unit: number; reference: PeopleCodeReference }>; key: string } | undefined => {
    if (!unitScopedRecordRows) return undefined;
    if (reference.kind !== 'field' && reference.kind !== 'scroll' && reference.kind !== 'record-field') {
      return undefined;
    }
    const key =
      reference.kind === 'field'
        ? `FIELD.${(reference.fieldName ?? '').toUpperCase()}`
        : reference.kind === 'scroll'
          ? `SCROLL.${(reference.recordName ?? '').toUpperCase()}`
          : `${(reference.recordName ?? '').toUpperCase()}.${(reference.fieldName ?? '').toUpperCase()}`;
    const family: UnitScopedRowFamily =
      key.startsWith('FIELD.') ? 'field' : key.startsWith('SCROLL.') ? 'scroll' : 'record-field';
    return UNIT_SCOPED_ROW_FAMILIES.has(family) ? { pool: unitScopedRows[family], key } : undefined;
  };

  const unitRecordOperand = (reference: PeopleCodeReference): PeopleCodeReference => {
    const identity = unitScopedRowIdentity(reference);
    if (identity !== undefined) {
      const current = identity.pool.get(identity.key);
      if (current !== undefined && current.unit === allocationUnit) return current.reference;
      const { index: _index, sequence: _sequence, ...fields } = reference;
      return nextReference(fields);
    }
    if (!unitScopedRecordRows || reference.kind !== 'record') return reference;
    const current = recordRowsByUnit.get((reference.recordName ?? '').toLowerCase());
    if (current !== undefined && current.unit === allocationUnit) return current.reference;
    return nextReference({ kind: 'record', recordName: reference.recordName });
  };

  const nextReference = (
    reference: Omit<PeopleCodeReference, 'index' | 'sequence'>
  ): PeopleCodeReference => {
    const shared = context?.applicationClassReferenceSession?.lookup(reference);
    if (shared !== undefined) return shared;

    const unitRecordKey =
      unitScopedRecordRows && reference.kind === 'record'
        ? (reference.recordName ?? '').toLowerCase()
        : undefined;
    if (unitRecordKey !== undefined) {
      const current = recordRowsByUnit.get(unitRecordKey);
      if (current !== undefined && current.unit === allocationUnit) return current.reference;
    }
    const unitRowIdentity = unitScopedRowIdentity(reference);
    if (unitRowIdentity !== undefined) {
      const current = unitRowIdentity.pool.get(unitRowIdentity.key);
      if (current !== undefined && current.unit === allocationUnit) return current.reference;
    }

    const sequence = references.length + 1 + referenceIndexOffset;
    const created: PeopleCodeReference = {
      ...reference,
      sequence,
      index: sequence - 1
    };
    references.push(created);
    if (unitRecordKey !== undefined) {
      recordRowsByUnit.set(unitRecordKey, { unit: allocationUnit, reference: created });
    }
    if (unitRowIdentity !== undefined) {
      unitRowIdentity.pool.set(unitRowIdentity.key, { unit: allocationUnit, reference: created });
    }

    context?.referenceTrace?.({
      action: 'ALLOC',
      sourceOffset: pos,
      controlGroup,
      controlDepth,
      functionDepth,
      reference: created
    });

    return created;
  };

  const ensureLocalObjectPackageReference = (
    packageName: string,
    objectName: string
  ): PeopleCodeReference => {
    /*
     * ADSRECORDS1_WRK.QRYSEARCHBTN.FieldChange (definition 772) proves this
     * reuse pool is also FUNCTION-BODY sensitive, not just control-group
     * sensitive: leading Local declarations inside a `Function ...
     * End-Function;` body do not bump `controlGroup` (only executable
     * statements do, per the Function-body control-group rule), so a
     * top-level `Component Rowset &grsLevelList;` (functionDepth 0) and a
     * later `Local Rowset &rsRecordsList;` inside `Function
     * DoRecordsSearch()` (functionDepth 1) land in the SAME numeric
     * control group despite being in clearly different declaration scopes
     * -- stored allocates a distinct PACKAGE/ROWSET row for each, not one
     * shared row.
     *
     * Cycle 36: this control-group-scoped reuse pool is population-
     * validated for ORDINARY PeopleCode (401/651 corpus candidates with a
     * bare built-in-type Local declared 2+ times across a control-group
     * boundary match this behavior exactly; only 1 isolated exception).
     * Application Class METHOD BODIES behave differently: 114/122 corpus
     * candidates show PeopleTools reusing ONE identity for the whole
     * method regardless of control-group nesting (definition 28820's own
     * `PACKAGE|XMLNODE` duplicate is this exact case) -- the reuse pool
     * has METHOD-WIDE, not control-group-scoped, lifetime there.
     * `context.builtinObjectDeclarationsHaveMethodWideLifetime` (set only
     * by `encodeApplicationClassProgramV2` for its own method-body
     * fragments) drops `controlGroup` from the key for exactly that
     * population; every ordinary caller omits it, leaving this reuse pool
     * -- and the 4,272 exact ordinary programs containing PACKAGE rows --
     * completely unaffected.
     */
    const key = context?.builtinObjectDeclarationsHaveMethodWideLifetime
      ? `${functionDepth}:${packageName.toLowerCase()}:${objectName.toLowerCase()}`
      : `unit${builtinUnit}:${packageName.toLowerCase()}:${objectName.toLowerCase()}`;

    const existing = localObjectPackageReferences.get(key);
    if (existing !== undefined) {
      return existing;
    }

    /*
     * Cycle 64 (definitions 28755/28964/29099): a compatible TYPE-only
     * identity for this SAME built-in leaf (Record/Rowset/Row/Field/SQL/
     * File/XmlDoc/XmlNode) may already have been committed by an EARLIER
     * method's own `Local` declaration of the identical leaf, or by the
     * declaration-dependency prepass (Cycle 52/60, for a parameter/return
     * type of the same leaf) -- exactly the class-wide facade
     * `ensureLocalApplicationClassPackageReference`/`ensureRuntimeCreateReference`
     * already consult (Cycle 57's `applicationClassTypeReferenceSession`).
     * That facade was never extended to THIS allocator, so a built-in
     * leaf's SECOND (and every subsequent) method kept allocating its own
     * fresh, duplicate PACKAGE row instead of reusing the class-wide one.
     * A corpus-wide census (`cycle64-builtin-classwide-reuse-census.ts`,
     * 451 (definition, leaf) candidates declared via `Local` in 2+
     * methods) found 47 cases where stored collapses to exactly ONE
     * identity across every method while generated allocated 2-30, and
     * ZERO cases where stored allocates 2+ AND generated does not already
     * (independently, for a pre-existing, unrelated reason -- the same 4
     * definitions Cycles 56/57/62 already found under-allocating relative
     * to stored's own genuine multiplicity) match at 1 -- i.e. no corpus
     * evidence this reuse is ever wrong. `context?.applicationClassTypeReferenceSession`
     * is `undefined` for every non-Application-Class caller (only
     * `encodeApplicationClassProgramV2` ever populates it), so ordinary
     * PeopleCode's own control-group-scoped behavior (Cycle 36, 401/651
     * population) is completely unaffected.
     */
    const classWideTypeIdentity = context?.applicationClassTypeReferenceSession?.lookup({
      kind: 'package',
      packageName,
      objectName
    });
    if (classWideTypeIdentity !== undefined) {
      localObjectPackageReferences.set(key, classWideTypeIdentity);
      return classWideTypeIdentity;
    }

    const created = nextReference({
      kind: 'package',
      packageName,
      objectName
    });

    localObjectPackageReferences.set(key, created);
    return created;
  };

  /*
   * Compiler architecture: the single dispatch point every migrated
   * declaration-context call site now consults instead of maintaining its
   * own independent if/else-if type-name chain. Looks up `typeName` in
   * `BUILTIN_TYPE_REGISTRY` (case-insensitively) and allocates the type's
   * PACKAGE reference only if `context` is one of its proven
   * `packageAllocationContexts` -- an unrecognized type name, or a
   * recognized type not yet evidenced for this specific context, is a
   * silent no-op, matching every migrated chain's own prior behavior
   * exactly (none of them threw or warned on an unhandled type either).
   */
  const allocateBuiltinTypePackageReferenceIfSupported = (
    typeName: string,
    context: BuiltinTypeContext
  ): void => {
    const semantics = BUILTIN_TYPE_REGISTRY.get(typeName.toLowerCase());
    if (semantics === undefined) return;
    if (!semantics.packageAllocationContexts.has(context)) return;
    ensureLocalObjectPackageReference(semantics.packageKey, semantics.canonicalName);
  };

  /*
   * Cycle 46: the SAME registration semantics the Function-parameter
   * parsing loop already applies for `Record`/`Row`/`Rowset`-typed
   * parameters (see that loop's own comments for the Row/Record evidence),
   * factored out so an Application Class method implementation's own
   * parameter list (see `EncodeFragmentContext.methodParameters`'s own
   * comment) can be seeded into this fragment's type environment through
   * the identical, already-proven code path rather than a duplicate one.
   * `Rowset` deliberately joins ONLY `chainSemanticsDeclaredRowsetVariables`,
   * not `rowsetVariables` and not `ensureLocalObjectPackageReference` --
   * Cycle 7 found that broader treatment regresses definitions already
   * EXACT without it (see the Function-parameter loop's own `Rowset`
   * comment). Any OTHER type (Application Class, array of Record,
   * built-in objects, primitives, ...) is deliberately left untouched --
   * no existing, validated registration semantics exist for those as
   * PARAMETERS yet (even for ordinary Functions), so extending this
   * helper to them would be inventing new semantics rather than reusing
   * proven ones.
   */
  const registerTypedParameter = (name: string, type: string): void => {
    if (/^Record$/i.test(type)) {
      ensureLocalObjectPackageReference('RECORD', 'Record');
      recordVariables.add(name.toLowerCase());
    } else if (/^Row$/i.test(type)) {
      ensureLocalObjectPackageReference('ROW', 'Row');
      rowVariables.add(name.toLowerCase());
    } else if (/^Rowset$/i.test(type)) {
      /*
       * Compiler closure: `Rowset`-typed PARAMETERS (both ordinary
       * Function parameters and Application Class method parameters,
       * this function's two call sites) were previously believed
       * "genuinely mixed" (Cycle 7's own note: "that broader treatment
       * regressed already-EXACT definitions") and deliberately excluded
       * from the PACKAGE-allocation dispatch every sibling type (Record/
       * Row/SQL/ApiObject/Message) already has. Re-investigation with
       * the same token-level, comment-excluding census methodology that
       * resolved the analogous Field-parameter caution (see
       * functionStatement()'s own `Field` branch) found a clean,
       * unanimous 395/395 corpus population (163 Application Class + 232
       * ordinary Function, 0 contradictions either way) -- every single
       * genuine `As Rowset` parameter occurrence stores a PACKAGE/ROWSET
       * row. `chainSemanticsDeclaredRowsetVariables` tracking is
       * unrelated to this allocation and is kept alongside it unchanged;
       * whatever caused Cycle 7's regression was evidently a different,
       * unexamined interaction, not a genuine absence of the reference
       * itself in real corpus evidence.
       */
      ensureLocalObjectPackageReference('ROWSET', 'Rowset');
      chainSemanticsDeclaredRowsetVariables.add(name.toLowerCase());
    } else if (!/^(?:Record|Row|Rowset)$/i.test(type)) {
      /*
       * Compiler architecture: SQL/ApiObject/Grid/Message have no
       * tracking side effect beyond PACKAGE allocation (unlike Record/
       * Row/Rowset above), so they route through the shared registry.
       * This function is the ONLY dispatch for an Application Class
       * method implementation's own parameter list (seeded via this
       * function's own call site above) -- the separate SQL/ApiObject/
       * Grid/Message branches on the ordinary Function-parameter path
       * never run for App Class method parameters at all. 206 of the
       * 207-candidate `As Message` parameter corpus population (this
       * project's single largest population) are Application Class
       * method signatures, so without this, the ordinary-path fix alone
       * only reached 1 of them.
       */
      allocateBuiltinTypePackageReferenceIfSupported(type, 'application-class-parameter');
    }
  };

  const addApplicationClassReference = (
    packagePath: string[],
    className: string,
    methodName?: string
  ): PeopleCodeReference => {
    if (packagePath.length === 0) {
      return fail('application class requires at least one package component');
    }

    return nextReference({
      kind: 'package',

      // Preserve the original two-component artifact mapping for existing
      // consumers while also exposing the complete calibrated hierarchy.
      //
      //   OU_CORPUS:TestClass
      //     PSPCMNAME: PACKAGE | TESTCLASS | OU_CORPUS
      //
      //   OU_CORPUS:Utilities:TestClass
      //     PSPCMNAME: PACKAGE | TESTCLASS | OU_CORPUS | Utilities
      //
      // A method dependency appends the method name after the package path.
      packageName: className.toUpperCase(),
      objectName: packagePath[0].toUpperCase(),
      packagePath: packagePath.map(
        (component, index) =>
          index === 0 ? component.toUpperCase() : component
      ),
      className: className.toUpperCase(),
      methodName: methodName?.toUpperCase()
    });
  };

  const ensureRuntimeCreateReference = (
    packagePath: string[],
    className: string
  ): PeopleCodeReference => {
    const key = [
      ...packagePath,
      className
    ].map(component => component.toLowerCase()).join(':');

    const existing = runtimeCreateReferences.get(key);
    if (existing !== undefined) {
      return existing;
    }

    /*
     * Cycle 56: a corpus-wide census of 1,778 (method, leaf) create-local
     * candidates found stored PSPCMNAME allocates exactly one identity for
     * the create target's leaf type in 1758/1778 cases -- including every
     * case where a plain/array-of Local declaration of the SAME leaf
     * already exists earlier in this same method (definition 28726's
     * `GetOutgoingRelationships`: a plain `Local ADSM:ADSRelationship
     * &ship;` and an `array of` declaration of the same leaf, followed by
     * `Local ADSM:ADSRelationship &relation = create
     * ADSM:ADSRelationship(...)` inside a nested `For` loop, all reuse ONE
     * stored identity; the pre-fix encoder allocated 3). Reuse the SAME
     * method-wide pool `ensureLocalApplicationClassPackageReference`
     * already established for that population before falling back to this
     * helper's own runtime-create dedup (unchanged, and still the sole
     * path for ordinary -- non-Application-Class-method-body -- PeopleCode,
     * per the same `builtinObjectDeclarationsHaveMethodWideLifetime` guard
     * that scopes the Local-declaration pool). Cross-method and
     * import-established reuse (49/1,778 candidates) are a separate,
     * broader claim this population does not test -- not extended here.
     */
    if (context?.builtinObjectDeclarationsHaveMethodWideLifetime) {
      const localKey = `${functionDepth}:${key}`;
      const existingLocal = localApplicationClassPackageReferences.get(localKey);
      if (existingLocal !== undefined) {
        runtimeCreateReferences.set(key, existingLocal);
        return existingLocal;
      }
    }

    /*
     * Cycle 57: same class-wide compatible-identity lookup as
     * `ensureLocalApplicationClassPackageReference` -- a `create` may be
     * the FIRST method-local occurrence of a leaf already established at
     * class/declaration scope (import, property, instance, or a Cycle 52
     * declaration-dependency row), with no plain/array-of Local
     * declaration of the same leaf in this method to have already found
     * it via the check above.
     */
    const classWide = context?.applicationClassTypeReferenceSession?.lookup({
      kind: 'package',
      packageName: className.toUpperCase(),
      objectName: packagePath[0]?.toUpperCase(),
      packagePath: packagePath.map((component, index) => index === 0 ? component.toUpperCase() : component),
      className: className.toUpperCase()
    });
    // Cycle 108: or a row an earlier fragment opened for a method call.
    const programRow = classWide ?? context?.applicationClassProgramRows?.find(className);
    if (programRow !== undefined) {
      runtimeCreateReferences.set(key, programRow);
      if (context?.builtinObjectDeclarationsHaveMethodWideLifetime) {
        localApplicationClassPackageReferences.set(`${functionDepth}:${key}`, programRow);
      }
      return programRow;
    }

    const created = addApplicationClassReference(
      packagePath,
      className
    );

    runtimeCreateReferences.set(key, created);
    if (context?.builtinObjectDeclarationsHaveMethodWideLifetime) {
      localApplicationClassPackageReferences.set(`${functionDepth}:${key}`, created);
    }
    return created;
  };

  const applicationClassPath = (
    options?: { allowWildcard?: boolean }
  ): {
    packagePath: string[];
    className: string;
    bytes: Buffer;
    wildcard: boolean;
  } => {
    const components: string[] = [];
    let wildcard = false;

    /*
     * `%metadata` is a reserved package root for metadata-driven
     * Application Classes -- always the FIRST path component, never
     * later ones (67 corpus occurrences checked, 23 distinct shapes, all
     * `%metadata` as the sole root).
     *
     *   import %metadata:AnalyticModelDefn:Aceorganizer;
     *   import %metadata:*;
     */
    const firstMatch =
      /^%?[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));
    if (!firstMatch) {
      return fail('expected application package name');
    }

    components.push(firstMatch[0]);
    pos += firstMatch[0].length;

    while (true) {
      space();

      if (source[pos] !== ':') {
        break;
      }

      pos++;
      space();

      if (options?.allowWildcard && source[pos] === '*') {
        pos++;
        wildcard = true;
        break;
      }

      const componentMatch =
        /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));
      if (!componentMatch) {
        return fail('expected application package/class name after :');
      }

      components.push(componentMatch[0]);
      pos += componentMatch[0].length;
    }

    /*
     * Ordinary Application Class paths require at least:
     *
     *   PACKAGE:Class
     *
     * but wildcard imports may target the package root itself:
     *
     *   import HMCF_CHARTFIELDS:*;
     *
     * which stores:
     *
     *   58 0A "HMCF_CHARTFIELDS" 57 59 15
     *
     * and a PACKAGE metadata row with blank REFNAME / QUALIFYPATH.
     */
    if (components.length < 2 && !wildcard) {
      return fail('application class path requires package and class names');
    }

    const className = components[components.length - 1];
    const packagePath = components.slice(0, -1);

    const encoded: Buffer[] = [];
    components.forEach((component, index) => {
      if (index > 0) {
        encoded.push(Buffer.from([0x57]));
      }

      encoded.push(
        textOperand(
          index === 0 && /^%metadata$/i.test(component)
            ? 0x12
            : INLINE_IDENTIFIER_OPCODE,
          TokenKind.Name,
          component
        )
      );
    });

    if (wildcard) {
      /*
       * Wildcard import suffix:
       *
       *   import ROOT:Path:Leaf:*;
       *
       * stores the normal ':' path separator (0x57) followed by the
       * dedicated wildcard token 0x59. It is not the arithmetic '*' opcode.
       */
      encoded.push(Buffer.from([0x57, 0x59]));
    }

    return {
      packagePath,
      className,
      bytes: Buffer.concat(encoded),
      wildcard
    };
  };

  const referenceOperand = (candidate: PeopleCodeReference): Buffer => {
    const reference = unitRecordOperand(candidate);
    if (reference.index > 0xffff) {
      throw new UnsupportedPeopleCodeError(
        pos,
        'PeopleCode reference index exceeds uint16 range'
      );
    }

    context?.referenceTrace?.({
      action: 'USE',
      sourceOffset: pos,
      controlGroup,
      controlDepth,
      functionDepth,
      reference
    });

    const bytes = Buffer.alloc(3);
    bytes[0] = 0x21;
    bytes.writeUInt16LE(reference.index, 1);
    return bytes;
  };

  const htmlDependencyScope =
    context?.htmlDependencyScope ?? new HtmlDependencyScope();

  const htmlReference = (): Buffer => {
    const qualifier = /^HTML\b/i.exec(source.slice(pos));
    if (qualifier === null) return fail('expected HTML reference qualifier');
    pos += qualifier[0].length;

    space();
    if (source[pos] !== '.') return fail('expected . after HTML reference qualifier');
    pos++;
    space();

    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (name === undefined) return fail('expected HTML definition name');
    pos += name.length;

    const namespace =
      context?.htmlDependencyLifetime === 'application-class'
        ? 'application-class'
        : functionDepth > 0
          ? `function:${currentHtmlFunctionNamespace}`
          : `top-level:${controlGroup}`;

    const existing = htmlDependencyScope.lookup(namespace, name);
    if (existing !== undefined) return referenceOperand(existing);

    const reference = nextReference({
      kind: 'record-field',
      recordName: 'HTML',
      fieldName: name
    });
    htmlDependencyScope.record(namespace, name, reference);
    return referenceOperand(reference);
  };

  const ordinaryRecordFieldReference = (): Buffer => {
    const recordName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (!recordName) return fail('expected record name');
    pos += recordName.length;

    if (source[pos] !== '.') return fail('expected . in record/field reference');
    pos++;

    const fieldName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (!fieldName) return fail('expected field name');
    pos += fieldName.length;

    // A reference to the owning record/field uses PSPCMNAME sequence 1.
    // If owner context was omitted, the first ordinary record/field reference
    // is the only calibrated inference available, so bind the reserved owner
    // slot to it. If it is not the owner, allocate a normal occurrence row.
    const ownerUnbound =
      context?.bindOwnerReference !== false &&
      (!context?.suppressOwnerReference || context?.bindOwnerReference === true) &&
      ownerReference.recordName === undefined &&
      ownerReference.fieldName === undefined;

    if (ownerUnbound) {
      ownerReference.recordName = recordName;
      ownerReference.fieldName = fieldName;
      return referenceOperand(ownerReference);
    }

    if (
      same(ownerReference.recordName, recordName) &&
      same(ownerReference.fieldName, fieldName)
    ) {
      return referenceOperand(ownerReference);
    }

    /*
    * Ordinary RECORD.FIELD references are name-deduplicated.
    *
    * Calibrated by AA_COST_RT_JPN.EMPL_RCD_JPN.FieldChange:
    * BUS_UNIT_TBL_HR.DESCRSHORT appears repeatedly in source but occupies
    * one PSPCMNAME row, and every compiled 0x21 operand reuses that same
    * zero-based reference index.
    *
    * This is distinct from explicit Record.X / Field.X / Scroll.X
    * references, which have separate occurrence-based calibration.
    *
    * Cycle 68 (definition 29389): this reuse pool's own key used raw
    * `controlGroup` directly, unlike `dependencyScope`/`fieldDependencyScope`
    * (Cycle 43/46's own already-proven `recordScopeId()`/`fieldScopeId()`
    * method-wide override for Application Class method bodies) -- a third
    * instance of the same "canonical method-wide override exists, this
    * allocator was never wired to it" shape (Cycles 64/65/66 each found
    * one before, for different allocators). `29389`'s own
    * `GetRowset(Scroll.GPS_POST).Sort(GPS_POST.SETID, "A", GPS_POST.YEAR, "A", ...)`
    * call appears twice in one method (`runAction`), each time nested
    * inside a DIFFERENT top-level `If` block (controlDepth 2 and 1,
    * never 0, so the existing "top-level repeat starts fresh" rule a few
    * lines below never applies to either) -- stored reuses the SAME 8
    * identities both times; generated allocated a fresh set the second
    * time purely because the two occurrences fall in different RAW
    * control groups (3 and 7), which the old key-by-`controlGroup`
    * design could never bridge. A corpus-wide census
    * (`cycle68-record-field-classwide-census.ts`, 581 (definition,
    * method, record.field) candidates repeated 2+ times in one method)
    * found 173 cases where stored collapses to one identity across
    * control-group boundaries within a method while generated allocated
    * 2+, and the 7 apparent "contradictions" (generated already allocated
    * ZERO occurrences, not merely fewer than stored) are confirmed
    * unrelated -- a different, pre-existing, not-yet-characterized gap
    * (spot-checked `28925`: the construct is inside a SQL string literal
    * bind-argument position `ordinaryRecordFieldReference()` never
    * reaches at all, regardless of this cycle's change). Using
    * `recordScopeId()` here (rather than raw `controlGroup`) leaves
    * ordinary PeopleCode's own existing, calibrated behavior completely
    * unchanged (it returns raw `controlGroup` there) and only affects
    * Application Class method bodies, where it already returns a
    * constant `0` -- the SAME method-wide scoping `dependencyScope`
    * already uses for plain RECORD/SCROLL reuse.
    */
    let key = `${recordScopeId()}:${recordName.toLowerCase()}:${fieldName.toLowerCase()}`;
    const statementKey = `${recordName.toLowerCase()}:${fieldName.toLowerCase()}`;
    /*
     * Cycle 68 (definition 28932): BEN_TRAN_WK.ASOFDATE's stored PSPCMNAME
     * has exactly one row, reused across EIGHT different methods
     * (EnrolledPlan, RefreshByDate, DateSelection, ...) of the same
     * Application Class -- CLASS-wide, not just method-wide. This is the
     * SAME canonical class-wide facade (`applicationClassTypeReferenceSession`
     * / `ApplicationClassReferenceScope`) Cycles 62/64/65/66 already wired
     * five other allocators to (each a different explicit/implicit
     * reference syntax); `ordinaryRecordFieldReference()` was never one of
     * them. The method-wide pool is checked first since it never requires
     * crossing the facade at all.
     */
    const existing =
      ordinaryRecordFieldsByControlGroup.get(key) ??
      context?.applicationClassTypeReferenceSession?.lookup({
        kind: 'record-field',
        recordName,
        fieldName
      });

    const statementReference = currentStatementRecordFields.get(statementKey);
    if (statementReference !== undefined) {
      return referenceOperand(statementReference);
    }

    if (existing !== undefined) {
      /*
       * At top level, encountering a RECORD.FIELD that has already been used
       * in the current allocation group starts a fresh group.
       *
       * Calibrated by ABS_HIST_UK_SBR.SMP_MA_ELIG.FieldFormula,
       * Employee_MA():
       *
       *   ABSENCE_HIST.SHPL_EE_WEEKS.DisplayOnly = True;   // 0x55
       *   ABSENCE_HIST.SHPL_WEEKS.DisplayOnly = True;      // 0x56
       *   ABSENCE_HIST.SHPP_WEEKS.DisplayOnly = True;      // 0x57
       *   ABSENCE_HIST.SHP_EE_WEEKS.DisplayOnly = True;    // 0x58
       *   ABSENCE_HIST.SHPL_EE_WEEKS.DisplayOnly = False;  // 0x59
       *
       * The second SHPL_EE_WEEKS occurrence is not reused as 0x55; it begins
       * a new sequence. Nested control structures retain their existing
       * inControlGroup() behavior.
       *
       * Consecutive field SetDefault() statements are already modeled as one
       * explicit allocation run, so do not split that run merely because a
       * SetDefault field repeats.
       *
       * Cycle 68: this "start fresh" rule is itself gated out entirely for
       * Application Class method bodies, mirroring `dependencyScope.isOpen`
       * (Cycle 43's own unconditional `true` for
       * `recordDependenciesHaveMethodWideLifetime`). Definition 28795's
       * `CreateTemplate` method reuses `AGC_TMPL_TBL.AGC_CATEGORY_ID` and
       * `AGC_TMPL_TBL.EFFDT` (one stored identity each) across several
       * literal top-level statements (controlDepth 0, no intervening
       * control structure at all) as `Fill(...)` bind arguments -- proving
       * ABSENCE_HIST's "top-level repeat starts fresh" calibration is
       * specific to ordinary (non-Application-Class) PeopleCode and was
       * never meant to override method-wide reuse for Application Class
       * bodies.
       */
      if (
        !context?.recordDependenciesHaveMethodWideLifetime &&
        controlDepth === 0 &&
        !inTopLevelRecordFieldSetDefaultRun
      ) {
        controlGroup = nextControlGroup++;
        key = `${recordScopeId()}:${recordName.toLowerCase()}:${fieldName.toLowerCase()}`;
      } else {
        return referenceOperand(existing);
      }
    }

    const reference = nextReference({
      kind: 'record-field',
      recordName,
      fieldName
    });
    ordinaryRecordFieldsByControlGroup.set(key, reference);
    currentStatementRecordFields.set(statementKey, reference);
    return referenceOperand(reference);
  };

  let reuseRecordReferenceByName = false;

  /*
   * RowScrollSelect's own repeated Record.X arguments reuse a same-name
   * RECORD row ONLY within that same call's own argument list, as a last
   * resort when no earlier reuse-participating reference already exists
   * for that name in the current control group -- neither the broader
   * by-name reuse (any earlier occurrence anywhere, including from
   * non-participating calls) nor plain occurrence-based allocation (never
   * reuse) match stored behavior on their own.
   *
   * AE_UPGCONV_WRK.AE_REFRESH.FieldChange (definition 840):
   *
   *   ScrollFlush(Record.MESSAGE_LOG);
   *   RowScrollSelect(1, Record.MESSAGE_LOG, Record.MESSAGE_LOG, "...", &PI);
   *
   * ScrollFlush is NOT a reuse-participating call (it never sets
   * `reuseRecordReferenceWithinControlGroup`), so its own Record.MESSAGE_LOG
   * allocates its own row (NAMENUM 3) without registering as reusable.
   * RowScrollSelect's FIRST Record.MESSAGE_LOG argument therefore finds no
   * participating entry and allocates fresh (NAMENUM 4); its SECOND
   * argument, in the SAME call, reuses that fresh one. A fresh Map per
   * RowScrollSelect call (saved/restored around the call like the other
   * reuse flags, to handle nesting) gives exactly this same-call scope.
   *
   * ABSENCE_CAL_VW.ABSENCE_TYPE.RowInit (definition 27, protected
   * baseline) proves the OTHER half: when a reuse-participating call HAS
   * already established a same-name RECORD row in the current control
   * group, RowScrollSelect DOES reuse it, even across statements:
   *
   *   &LEVEL1_ROWS = ActiveRowCount(Record.ABS_TYPE_TBL);
   *   ...
   *   RowScrollSelect(1, Record.ABS_TYPE_TBL, Record.ABS_TYPE_TBL, "...", ...);
   *
   * ActiveRowCount IS reuse-participating, so its Record.ABS_TYPE_TBL
   * registers in `participatingRecordReferencesByControlGroup` (see that
   * map's own declaration) -- both of RowScrollSelect's own arguments
   * reuse THAT row, not a fresh same-call one. See the priority order in
   * `recordReference()`: the participating-call check runs before the
   * same-call fallback below.
   */
  let reuseRecordReferenceWithinCallArguments = false;
  let recordReferencesWithinCallArguments =
    new Map<string, PeopleCodeReference>();

  /*
   * `PriorValue(Record.X, ...)`'s own Record.X argument must not become
   * visible to a LATER reuse-participating call's control-group-scoped
   * lookup, unlike every other Record.X allocation (the unconditional
   * write it would otherwise join).
   *
   * ARCH_SQL_LNG.ARCH_SQL.FieldChange (definition 1254):
   *
   *   &PRIOR_ARCH_SQL = PriorValue(Record.ARCH_TBL, &ZI, ARCH_SQL_LNG.ARCH_SQL, &ZJ);
   *   &CURRENT_ARCH_SQL = FetchValue(Record.ARCH_TBL, &ZI, ARCH_SQL_LNG.ARCH_SQL, &ZJ);
   *
   * `PriorValue` is not itself a reuse-participating call (it never reads
   * this map for its own argument), but its allocation would otherwise
   * still unconditionally write into `recordReferencesByControlGroup`
   * the same way any other allocation does -- and `FetchValue` IS
   * reuse-participating, so it would wrongly find and reuse that row
   * instead of allocating its own fresh one, which is what stored does.
   * Scoped narrowly to `PriorValue`'s own call (mirroring the identical,
   * already-proven RowScrollSelect-own-arguments exclusion just below)
   * so every other Record.X allocation keeps writing here exactly as
   * before -- this is NOT a claim that every non-participating call
   * behaves this way, only that `PriorValue` specifically does.
   */
  let suppressRecordReferenceControlGroupWrite = false;

  /*
   * ScrollFlush(Record.X); ScrollSelect(1, Record.X, Record.Y, ...) --
   * a RowScrollSelect/RowScrollSelectNew/ScrollSelect call's Record.X
   * argument whose name appears only ONCE across this call's own entire
   * argument list (i.e. does NOT also recur as a later argument of this
   * SAME call) reuses a same-control-group row an immediately preceding
   * ScrollFlush already allocated, unlike a repeated-within-the-call name
   * (see `reuseRecordReferenceWithinCallArguments`'s own comment: a
   * repeated name reuses ONLY within the call, never an outside row).
   *
   * ARCH_FLT_RQST.PSARCH_ID.SavePostChange (definition 1220):
   *
   *   ScrollFlush(Record.ARCH_OTH_CTL_VW);
   *   ScrollSelect(1, Record.ARCH_OTH_CTL_VW, Record.ARCH_OTH_CTRL, &WHERE | &ORDER_BY, ARCH_FLT_RQST.PSARCH_ID);
   *
   * ScrollSelect's own Record.ARCH_OTH_CTL_VW argument (name appears once
   * in this call -- ARCH_OTH_CTRL is a different name) reuses ScrollFlush's
   * row. This does NOT reopen ARCH_WRK.PSARCH_COPY_ROWS.FieldChange
   * (definition 1283, the ORIGINAL evidence for `reuseRecordReferenceWithinCallArguments`):
   *
   *   ScrollFlush(Record.ARCH_CTRL_VW2);
   *   ScrollSelect(1, Record.ARCH_CTRL_VW2, Record.ARCH_CTRL_VW2, &WHERE, ...);
   *
   * ARCH_CTRL_VW2 appears TWICE in that ScrollSelect's own argument list,
   * so it is excluded from this single-occurrence set entirely -- both of
   * its own arguments keep allocating a fresh, call-shared row exactly as
   * 1283 already proved. DERIVED_BEN.BUTTON_FUNC.FieldFormula (definition
   * 4282) looks superficially identical to 1220 (ScrollFlush immediately
   * followed by a different-name ScrollSelect) but is unaffected by this
   * rule for an unrelated reason: that pair sits inside a
   * `Function ... End-Function;` body, where each top-level statement gets
   * its own fresh control group (see the Function-body control-group
   * rule), so ScrollFlush and ScrollSelect there are never in the same
   * control group regardless of this set's contents.
   */
  let singleOccurrenceCallArgumentRecordNames:
    Set<string> | undefined;

  /*
   * The single-occurrence fallback above (`singleOccurrenceCallArgumentRecordNames`)
   * originally read straight from `recordReferencesByControlGroup`, the
   * pool EVERY Record.X allocation writes to (including a RowScrollSelect/
   * RowScrollSelectNew call's own "last call argument becomes visible"
   * write a few dozen lines below, evidenced separately by definition
   * 1145 for a LATER UpdateValue-style reader). AE_UPGCONV_WRK.UPGPATH.
   * FieldChange (definition 843) disproves reading that shared pool here:
   *
   *   ScrollFlush(Record.PSAEAPPLDEFN);
   *   RowScrollSelect(1, Record.UPGCONV_DEFN, Record.UPGCONV_DEFN);
   *   RowScrollSelectNew(1, Record.UPGCONV_DEFN, Record.PSAEAPPLDEFN, "...", &UPGPATH);
   *
   * RowScrollSelectNew's own UPGCONV_DEFN and PSAEAPPLDEFN arguments both
   * allocate fresh rows (NAMENUM 4/5) in the stored program -- reusing
   * neither the intervening RowScrollSelect's own UPGCONV_DEFN row nor
   * ScrollFlush's earlier PSAEAPPLDEFN row. AE_WRK.AE_DECIDE.SavePreChange
   * (definition 860) proves the fallback is still real, not merely
   * disprovable: a bare `ScrollSelectNew(1, Record.A, Record.B, ...)` (not
   * itself a RowScrollSelect-family name, so an utterly ordinary call)
   * immediately followed, in the sibling Else branch of the same If, by
   * `ScrollSelect(1, Record.A, Record.B, ...)` -- ScrollSelect's own A/B
   * arguments DO reuse ScrollSelectNew's rows.
   *
   * The distinguishing factor is not "was the earlier call specifically
   * ScrollFlush" -- it's whether a RowScrollSelect-family call (RowScrollSelect,
   * RowScrollSelectNew, or bare ScrollSelect) has intervened since the
   * earlier allocation. `genericRecordReferencesSinceLastFamilyCall` mirrors
   * `recordReferencesByControlGroup`'s own ordinary (non-call-private)
   * writes, but is entirely cleared in the `finally` block of every
   * RowScrollSelect-family call (after that call's own resolution has
   * already read it) -- so it carries a row forward across an ordinary
   * call (ScrollFlush, ScrollSelectNew, or a sibling If/Else branch
   * boundary) but not across a RowScrollSelect-family call. In definition
   * 843, RowScrollSelect's own completion clears it, so RowScrollSelectNew
   * finds neither row. In definition 860, ScrollSelectNew never clears it
   * (not a family name), so ScrollSelect finds both.
   */
  const genericRecordReferencesSinceLastFamilyCall =
    new Map<string, PeopleCodeReference>();

  /*
   * Bare GetRecord(Record.X) has a narrower reuse scope than GetSetId.
   * It may reuse a same-name RECORD only inside the current control group.
   */
  let reuseRecordReferenceWithinControlGroup = false;
  const recordReferencesByControlGroup =
    new Map<string, PeopleCodeReference>();

  /*
   * Same-statement companion to the controlDepth > 0 guard on
   * `recordReferencesByControlGroup` above (see that check's own
   * comment). Two occurrences of the same Record.X reference WITHIN ONE
   * STATEMENT reuse each other regardless of controlDepth -- this is
   * narrower than "same control group" and does not depend on any block
   * being open.
   *
   * GPFR_LOANS_WRK.GPFR_SCHEDULE_PB.FieldChange (definition 7365) proves
   * it for a nested-call argument, at flat top level:
   *
   *   DeleteRow(Record.GPFR_LOAN, &L1, Record.GPFR_LOAN_SCHED,
   *     ActiveRowCount(Record.GPFR_LOAN, &L1, GPFR_LOAN_SCHED.GPFR_ROW_NUM));
   *
   * The inner `ActiveRowCount`'s own `Record.GPFR_LOAN` argument reuses
   * the outer `DeleteRow`'s `Record.GPFR_LOAN` argument's row, even
   * though both sit at controlDepth === 0 (this statement immediately
   * follows an `End-If;`, so no block is open).
   *
   * PSSERVICESWRK4.IB_TREENEXT.FieldChange (definition 17132) proves the
   * same rule for two sibling postfix chains in one expression, inside a
   * Function body's own top-level statement (also controlDepth === 0):
   *
   *   Return (&prow.GetRecord(Record.PSMSGPARTS).IB_MSGNAME.Value | "." |
   *     &prow.GetRecord(Record.PSMSGPARTS).IB_MSGVERSION.Value);
   *
   * Cleared at the same per-statement boundary as the ordinary-reference
   * `currentStatementRecordFields` pool (see `statement()`).
   */
  const recordReferencesWithinCurrentStatement =
    new Map<string, PeopleCodeReference>();

  /*
   * A call that is reuse-participating for its OWN Record.X argument (i.e.
   * checks `recordReferencesByControlGroup` before allocating) is not
   * necessarily a call whose resulting reference should become visible to a
   * LATER RowScrollSelect/ScrollSelect call's "participating" lookup (see
   * `participatingRecordReferencesByControlGroup`'s own comment).
   *
   * ScrollFlush is the proven counter-example. AE_UPGCONV_WRK.AE_REFRESH.
   * FieldChange (definition 840, established before ScrollFlush was ever
   * added to the reuse-participating list) and ARCH_WRK.PSARCH_COPY_ROWS.
   * FieldChange (definition 1283) both show:
   *
   *   ScrollFlush(Record.X);
   *   RowScrollSelect(1, Record.X, Record.X, ...);   // or ScrollSelect
   *
   * ScrollFlush's own Record.X argument correctly reuses an EARLIER
   * participating call's row when one exists in the control group
   * (definition 1236's fix), but when ScrollFlush itself is the FIRST
   * reference and must allocate fresh, that fresh allocation must NOT be
   * treated as a "participating" source for a later RowScrollSelect/
   * ScrollSelect call to find -- those calls must still allocate their own
   * fresh row (reusing only each other, within their own call). Scoped to
   * this one proven exception rather than re-deriving participation from
   * scratch for every entry already on the broader reuse list.
   */
  let marksControlGroupParticipant = false;

  /*
   * Unlike `recordReferencesByControlGroup` (populated by EVERY Record.X
   * allocation regardless of context), this parallel map is populated
   * only when the allocation itself happened while
   * `reuseRecordReferenceWithinControlGroup` was already true -- i.e.
   * only by an already-recognized reuse-participating call (ActiveRowCount,
   * GetRecord, DeleteRow, etc, see that flag's own trigger list). It lets
   * RowScrollSelect distinguish "an earlier PARTICIPATING call already
   * established this RECORD row in the current control group, reuse it"
   * from "some unrelated non-participating call (e.g. ScrollFlush) merely
   * happened to reference the same record name" -- see
   * `reuseRecordReferenceWithinCallArguments`'s own comment for the full
   * definition-27-vs-definition-840 evidence this distinction is based on.
   */
  const participatingRecordReferencesByControlGroup =
    new Map<string, PeopleCodeReference>();

  /*
   * Scroll.X is generally occurrence-based, but GetRowset(Scroll.X) has a
   * narrower reuse rule within a control group.
   *
   * DERIVED_CO.FUNCLIB.FieldFormula proves two separate
   * GetRowset(Scroll.CRSE_SESSN_VW) calls in the same function/control group
   * both point to the original SCROLL dependency rather than allocating a
   * second PSPCMNAME row.
   */
  let reuseScrollReferenceWithinControlGroup = false;
  const scrollReferencesByControlGroup =
    new Map<string, PeopleCodeReference>();

  /*
   * Field.X is generally occurrence-based ("Repeated-Field calibration
   * proves FIELD rows are occurrence-based" -- see fieldReference()), but
   * GetField(Field.X) on a .GetRecord(...) chain result has a narrower
   * reuse rule within a control group, mirroring GetRecord's own Record.X
   * reuse rule exactly.
   *
   * ADDRESS_SBR.COUNTRY.FieldChange (definition 524) proves two identical
   * &RS_Country.GetRow(1).GetRecord(Record.COUNTRY_TBL).GetField(Field.DESCR).Value
   * chains (one on the LHS-adjacent statement, one on the RHS a statement
   * later, same control group) both reuse the same PSPCMNAME FIELD row for
   * `Field.DESCR` -- not just the already-calibrated RECORD reuse for
   * `Record.COUNTRY_TBL`.
   */
  let reuseFieldReferenceWithinControlGroup = false;
  const scopedFieldReferences =
    new Map<string, PeopleCodeReference>();

  /*
   * Cycle 66 (definition 29099): `GetField(Field.X)` deliberately OWNS its
   * own FIELD occurrence for ORDINARY (non-Application-Class) PeopleCode --
   * each call allocates a fresh row even when the SAME field name was
   * already referenced elsewhere in the same control group (the existing
   * calibrated test, 'encodeProgramArtifacts allocates repeated Scroll and
   * Field references by occurrence', proves this for `GetField(Field.CODE)`
   * called twice on a stored Record variable). Every OTHER consumer of an
   * explicit `Field.X` reference (a plain expression/array argument such as
   * `CreateArray(Field.X, ...)`, or an argument to any OTHER function/method
   * such as `%This.GetSpecificRow(..., Field.X, ...)`/
   * `%This.GetLongTranslateValue(Field.X, ...)`) treats `Field.X` as an
   * ordinary symbolic constant that stored PeopleTools reuses -- a
   * corpus-wide census (`cycle66-field-consumer-context-census.ts`) found
   * ZERO cases, across every enclosing call EXCEPT `GetField` itself, where
   * stored keeps repeated identical `Field.X` references distinct.
   *
   * Cycle 69 (definition 29389): that "existing calibrated test" supplies
   * no Application Class `owner` (no `packagePath`) -- it is ordinary
   * PeopleCode, where `fieldReference()`'s own reuse check below is ALREADY
   * gated by `recordDependenciesHaveMethodWideLifetime`, so the test's
   * outcome is unaffected by this flag's value either way; it never
   * actually tested Application Class bodies. A dedicated corpus census
   * (`cycle69-getfield-argument-reuse-census.ts`, 296 candidates) found 78
   * Application Class cases where stored reuses ONE identity across
   * repeated RECEIVER-based `.GetField(Field.X)` calls (`29389`'s own
   * `&_recDtl.GetField(Field.EFFDT)`/`&_recDtl.GetField(Field.GPS_POST_ID)`,
   * called twice from two different `SQLExec(...)` statements, reusing an
   * identity first allocated even earlier via a DIFFERENT receiver
   * entirely), 0 contradictions, and 0 matched cases with a stored count of
   * 2+ (i.e., zero direct evidence Application Class bodies ever want
   * occurrence-based behavior here). Scoped to ordinary PeopleCode only,
   * matching the one construct this flag was ever actually proven for; set
   * true only while parsing arguments to a `GetField(...)` call
   * specifically (regardless of `fieldMemberFromGetRecord`, unlike
   * `reuseFieldReferenceWithinControlGroup`'s own narrower condition below),
   * so `fieldReference()` can tell "am I this call's own occurrence-owned
   * argument" apart from "am I a plain symbolic reference" without touching
   * `reuseFieldReferenceWithinControlGroup`'s own, already-proven, narrower
   * semantics.
   */
  let fieldReferenceOccurrenceOwnedByGetField = false;
  const ordinaryRecordFieldsByControlGroup = new Map<string, PeopleCodeReference>();
  const currentStatementRecordFields = new Map<string, PeopleCodeReference>();
  const componentReferencesByControlGroup = new Map<string, PeopleCodeReference>();
  let controlDepth = 0;
  let controlGroup = 0;
  let nextControlGroup = 1;

  /*
   * Phase 6 compiler-state map
   * --------------------------
   *
   * DependencyScope state:
   *   - `recordReferencesByControlGroup` and
   *     `scrollReferencesByControlGroup` are the backing stores.
   *   - `controlGroup` supplies the current scope id.
   *   - `controlDepth` determines whether that scope is open/readable.
   *   - `reuseRecordReferenceWithinControlGroup` and
   *     `reuseScrollReferenceWithinControlGroup` are parser-selected policy
   *     flags deciding whether the current call participates in this scope.
   *
   * Same-statement state:
   *   - `recordReferencesWithinCurrentStatement` is intentionally outside
   *     DependencyScope and remains readable even when this facade is closed.
   *
   * Call-local state:
   *   - `reuseRecordReferenceWithinCallArguments`,
   *     `recordReferencesWithinCallArguments`, and
   *     `singleOccurrenceCallArgumentRecordNames` describe one call's own
   *     argument list. `suppressRecordReferenceControlGroupWrite` is the
   *     PriorValue call's narrow write-suppression flag.
   *
   * RowScrollSelect-family policy:
   *   - `participatingRecordReferencesByControlGroup` and
   *     `genericRecordReferencesSinceLastFamilyCall` retain their distinct
   *     participation/epoch rules. They are not DependencyScope stores.
   *
   * Unresolved legacy approximation:
   *   - the row-shorthand postfix bridge has one documented raw read from
   *     `recordReferencesByControlGroup`; its visibility rule has not been
   *     proven identical to DependencyScope and is therefore not forced
   *     through this facade.
   *
   * Parser state only:
   *   - `functionDepth` remains orthogonal parser/declaration state. It does
   *     not decide whether DependencyScope is open.
   *
   * Ordinary RECORD.FIELD interning, owner resolution, FIELD interning, and
   * every other reference pool remain outside this facade.
   */
  /*
   * Cycle 43: the effective RECORD/SCROLL dependency-scope id, shared by
   * `dependencyScope` below AND `resolvePostfixMemberReuse`'s own raw
   * read of `recordReferencesByControlGroup` (search for
   * `recordScopeId()` there). Cycle 42's own attempt computed this
   * override only inside `dependencyScope`, leaving that OTHER,
   * independent consumer of the SAME map still keyed by raw
   * `controlGroup` -- a write/read key mismatch that silently broke a
   * previously-correct reuse (definition 29528's own row-shorthand
   * `&rowset.GetRow(1).RECORDNAME...` chain) once the write side started
   * using a different key. Both sites must use this one function so
   * they can never diverge again.
   */
  const recordScopeId = (): number =>
    context?.recordDependenciesHaveMethodWideLifetime ? 0 : controlGroup;

  /*
   * Cycle 46: the FIELD-side counterpart to `recordScopeId()`, governed by
   * the SAME `recordDependenciesHaveMethodWideLifetime` flag -- Cycle 42
   * originally scoped its own investigation as "RECORD/FIELD Reuse
   * Semantics" together; Cycle 43 implemented only the RECORD/SCROLL half
   * (via `recordScopeId()`), explicitly leaving `fieldDependencyScope` and
   * `recordVariableFields` "keyed by raw controlGroup -- no evidence
   * gathered about their own lifetime" (see `recordScopeId()`'s own
   * declaration comment history). Definition 29522 (`&AbsenceRec.EMPLID.Value`,
   * used twice in `SaveAppointmentToQueue`, once per SQLExec call --
   * different control groups) is now direct evidence: stored has exactly
   * ONE `FIELD|EMPLID` row, reused across both call sites, while the
   * pre-Cycle-46 encoder allocated two. Both `fieldDependencyScope` (the
   * receiver-agnostic fallback pool) and `recordVariableFields` (the
   * receiver-specific pool `resolvePostfixMemberReuse` checks FIRST) must
   * use this same scope id on BOTH their read and write sides -- Cycle 43's
   * own precedent is the reason this is a single shared function rather
   * than two independently-computed keys that could silently diverge.
   */
  const fieldScopeId = (): number =>
    context?.recordDependenciesHaveMethodWideLifetime ? 0 : controlGroup;

  const dependencyScope: DependencyScope = {
    get id(): number {
      return recordScopeId();
    },

    get isOpen(): boolean {
      return context?.recordDependenciesHaveMethodWideLifetime ? true : controlDepth > 0;
    },

    lookupRecord(recordName: string): PeopleCodeReference | undefined {
      if (!this.isOpen) return undefined;

      return recordReferencesByControlGroup.get(
        `${this.id}:${recordName.toLowerCase()}`
      );
    },

    recordRecord(
      recordName: string,
      reference: PeopleCodeReference
    ): void {
      recordReferencesByControlGroup.set(
        `${this.id}:${recordName.toLowerCase()}`,
        reference
      );
    },

    lookupScroll(recordName: string): PeopleCodeReference | undefined {
      if (!this.isOpen) return undefined;

      return scrollReferencesByControlGroup.get(
        `${this.id}:${recordName.toLowerCase()}`
      );
    },

    recordScroll(
      recordName: string,
      reference: PeopleCodeReference
    ): void {
      scrollReferencesByControlGroup.set(
        `${this.id}:${recordName.toLowerCase()}`,
        reference
      );
    }
  };

  /*
   * Function-local Application Class instances have distinct PSPCMNAME
   * method dependencies even when the same class already has a runtime-create
   * dependency in the function body.
   *
   * ACCT_CD_TBL.ACCT_CD.FieldFormula (offset 420) proves:
   *
   *   create HMCF_CHARTFIELDS:CHARTFIELD_COMBINATION()  -> runtime row
   *   &MYDISPLAY.SetupDisplayTmplt()                    -> method row
   *   &MYDISPLAY.GetChartfieldnrow(...)                 -> method row
   *
   * Keep this separate from top-level offset-179 behavior.
   */
  let functionDepth = 0;

  /*
   * Cycle 46: seed this fragment's type environment from an Application
   * Class method implementation's own parameter list (see
   * `EncodeFragmentContext.methodParameters`'s own comment and
   * `registerTypedParameter`'s own comment for the registration semantics
   * this reuses). Must run after `functionDepth`/`controlGroup` (both read
   * by `ensureLocalObjectPackageReference`) are initialized, and before any
   * source parsing begins -- `context?.methodParameters` is empty/undefined
   * for every caller except an Application Class method-body fragment, so
   * this is a no-op everywhere else.
   */
  /*
   * Cycle 120: a Record declared outside the body (header `instance` /
   * `property`, top-level `Global` / `Component`) is a Record variable in
   * every body, exactly like a body `Local Record` (its bare member is a
   * FIELD row). Its declaration rows were written where it was declared,
   * so nothing is allocated here. A parameter of the same name shadows it.
   * `cycle120-record-variable-field-census.ts`: bare members of instance
   * (1,638), property (200), Global (45) and Component (78) Record
   * variables all have a stored FIELD row of that name.
   */
  for (const [name, type] of context?.applicationClassDeclaredBuiltinVariables ?? []) {
    if (/^Record$/i.test(type.trim())) recordVariables.add(name);
  }
  for (const parameter of context?.methodParameters ?? []) {
    const name = `&${parameter.name.replace(/^&/, '')}`.toLowerCase();
    if (context?.applicationClassDeclaredBuiltinVariables?.has(name) && !/^Record$/i.test(parameter.type.trim())) recordVariables.delete(name);
    registerTypedParameter(parameter.name, parameter.type);
  }
  /*
   * Cycle 109: an Application Class body's declared App Class variables
   * (`applicationClassDeclaredVariables`) are receivers: a scalar one of
   * its class, an `array of <Class>` one once indexed
   * (`applicationClassArrayVariables`) -- 29109's parameter
   * `&factors As array of CAFNUI_CORE:OBJECT:Factor`, then
   * `&factors [&f].FactorHandler.GetFactorDisplays(...)`. A receiver's
   * method call uses its class's program row
   * (`ApplicationClassProgramRows`), which its declaration already opened
   * in every evidenced case (alone, these change no generated row).
   */
  for (const [name, declared] of context?.applicationClassDeclaredVariables ?? []) {
    if (declared.depth > 0) {
      applicationClassArrayVariables.set(name, { packagePath: [...declared.packagePath], className: declared.className, depth: declared.depth });
    } else {
      applicationClassVariables.set(name, {
        packagePath: [...declared.packagePath],
        className: declared.className,
        reuseRuntimeCreateForMethods: false
      });
    }
  }

  let nextHtmlFunctionNamespace = 1;
  let currentHtmlFunctionNamespace = 0;

  /*
   * Ordinary RECORD.FIELD references are grouped by contiguous semantic
   * statement runs. Field.SetDefault() starts a fresh allocation run, but
   * consecutive SetDefault() statements share that run.
   */
  let inTopLevelRecordFieldSetDefaultRun = false;
  const inControlGroup = (parse: () => void): void => {
    const previousGroup = controlGroup;
    const enteringTopLevel = controlDepth === 0;
    if (enteringTopLevel) controlGroup = nextControlGroup++;
    controlDepth++;
    try {
      parse();
    } finally {
      controlDepth--;
      /*
       * A top-level control-structure block (For/If/Evaluate) is bounded
       * on both sides: whatever follows it at top level starts a fresh
       * allocation group too, not a reuse-resumption of whatever group was
       * active before the block began.
       *
       * ARCH_TBL.RECNAME.SavePreChange (definition 1269) proves this:
       *
       *   &ALL_ROWS = ActiveRowCount(Record.ARCH_TBL, &I, Record.ARCH_CTRL);
       *   For &K = 1 To &ALL_ROWS
       *      ...
       *   End-For;
       *   &ALL_ROWS = ActiveRowCount(Record.ARCH_TBL, &I, Record.ARCH_OTH_CTRL);
       *
       * The second top-level ActiveRowCount's Record.ARCH_TBL argument
       * allocates a fresh PSPCMNAME row rather than reusing the row the
       * first (pre-loop) ActiveRowCount call allocated, even though both
       * calls are plain top-level statements with no control structure of
       * their own and would previously have shared controlGroup 0.
       */
      controlGroup = enteringTopLevel ? nextControlGroup++ : previousGroup;
    }
  };
  let reuseRowShorthandRecord = false;
  let captureRowsetElementRecord = false;
  const rowShorthandRecords = new Map<string, PeopleCodeReference>();
  const rowsetElementRecords = new Map<string, PeopleCodeReference>();
  const rowsetRecordNamesByVariable = new Map<string, string>();
  /*
   * Cycle 6, diagnostic-only (see .claude/corpus-progress.md): tracks
   * which `&variable`s were most recently assigned a top-level
   * `CreateRowset(Record.X)` result, REGARDLESS of whether that variable
   * is declared (unlike `rowsetRecordNamesByVariable` above, which is
   * intentionally scoped to `rowsetVariables`-declared receivers for its
   * own, separately-evidenced `GetLevel0()(N).GetRowset(Scroll.X)` rule).
   * This is the missing half of Cycle 4's "schema provenance" finding:
   * definition 524's own `&RS_Country = CreateRowset(Record.COUNTRY_TBL);`
   * is an UNDECLARED receiver that nonetheless has known schema
   * provenance. Consulted only by `initialChainSemantics`'s own
   * derivation below -- purely observational, never read by any encoding
   * decision.
   */
  const schemaBoundVariables = new Set<string>();
  const level0RowsetRecordsByField = new Map<string, PeopleCodeReference>();
  const createRecordReferences = new Map<string, PeopleCodeReference>();
  const createRecordReferenceCounts = new Map<string, number>();

  /*
   * CreateRecord reuse is target-variable AND control-group sensitive.
   *
   * PeopleTools may allocate a new RECORD row when the same Local Record
   * variable is assigned CreateRecord(Record.X) in a later control group.
   * Reuse is therefore limited to the same target variable, record name,
   * and control group.
   *
   * ACCOMPLISHMENTS.EMPLID.SavePostChange:
   *
   *   &recAccTbl = CreateRecord(Record.ACCOMP_TBL);  // RECORD seq 25
   *   ...
   *   &recAccTbl = CreateRecord(Record.ACCOMP_TBL);  // same group: reuses
   *
   * AA_SUMM_JPN_VW.EMPLID.SavePostChange adds the complementary case:
   * a later &REC_JOB = CreateRecord(Record.JOB) in another control group
   * allocates a new RECORD row instead of reusing the top-level JOB row.
   */
  const createRecordReferencesByTarget =
    new Map<string, PeopleCodeReference>();
  let createRecordAssignmentTarget: string | undefined;

  const rowShorthandRecordsByBase = new Map<string, PeopleCodeReference>();

  /*
   * Row-shorthand RECORD dependencies can also be reused across different
   * Rowset/Row bases inside the same control group.
   *
   * DERIVED_CO.FUNCLIB.FieldFormula proves:
   *
   *   &SessionRowset(&j).DERIVED_HR.OPEN_SEATS.Value
   *   ...
   *   &CourseRowset(CurrentRowNumber()).DERIVED_HR.SORTBY_COURSE_SESS.Visible
   *
   * Both use the same PSPCMNAME RECORD.DERIVED_HR dependency. Keep this pool
   * separate from explicit Record.X reuse so we do not broaden that behavior
   * beyond the evidence.
   */
  const rowShorthandRecordsByControlGroup =
    new Map<string, PeopleCodeReference>();
  const recordVariableFields = new Map<string, PeopleCodeReference>();

  /*
   * Explicit qualified chains:
   *
   *   Record.REC.FIELD.Value
   *
   * reuse the RECORD dependency within one control group. The FIELD half uses
   * the shared scoped namespace.
   *
   * Offset 433 calibrates this across repeated top-level If blocks.
   */
  const explicitRecordReferences =
    new Map<string, PeopleCodeReference>();

  type TracedReusePoolName = ReusePoolTraceEvent['pool'];

  const readTracedReusePool = (
    pool: TracedReusePoolName,
    map: Map<string, PeopleCodeReference>,
    key: string,
    site: string,
    sourceOffset = pos
  ): PeopleCodeReference | undefined => {
    const reference = map.get(key);

    context?.reusePoolTrace?.({
      action: 'READ',
      pool,
      site,
      key,
      sourceOffset,
      controlGroup,
      controlDepth,
      functionDepth,
      hit: reference !== undefined,
      reference
    });

    return reference;
  };

  const writeTracedReusePool = (
    pool: TracedReusePoolName,
    map: Map<string, PeopleCodeReference>,
    key: string,
    reference: PeopleCodeReference,
    site: string,
    sourceOffset = pos
  ): void => {
    map.set(key, reference);

    context?.reusePoolTrace?.({
      action: 'WRITE',
      pool,
      site,
      key,
      sourceOffset,
      controlGroup,
      controlDepth,
      functionDepth,
      reference
    });
  };

  const fieldDependencyScope: FieldDependencyScope = {
    lookupField(fieldName: string): PeopleCodeReference | undefined {
      return readTracedReusePool(
        'scopedFieldReferences',
        scopedFieldReferences,
        `${fieldScopeId()}:${fieldName.toLowerCase()}`,
        'fieldDependencyScope:lookup',
        pos - fieldName.length
      );
    },

    recordField(
      fieldName: string,
      reference: PeopleCodeReference
    ): void {
      writeTracedReusePool(
        'scopedFieldReferences',
        scopedFieldReferences,
        `${fieldScopeId()}:${fieldName.toLowerCase()}`,
        reference,
        'fieldDependencyScope:record',
        pos - fieldName.length
      );
    }
  };

  const resetRecordVariableFields = new Set<string>();

  const recordReference = (
    options: {
      explicitChainReuse?: boolean;
    } = {}
  ): Buffer => {
    if (!word('Record')) return fail('expected Record');
    if (source[pos] !== '.') return fail('expected . after Record');
    pos++;

    const recordName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (!recordName) return fail('expected record name after Record.');
    pos += recordName.length;

    /*
     * Explicit qualified chains:
     *
     *   Record.REC.FIELD.Value
     *
     * Offset 433 proves that the RECORD dependency is reused within the
     * current control group. Keep this opt-in so every previously calibrated
     * Record.X context below retains its existing provenance behavior.
     */
    if (options.explicitChainReuse) {
      const explicitKey =
        `${controlGroup}:${recordName.toLowerCase()}`;

      const existing =
        explicitRecordReferences.get(explicitKey);

      if (existing !== undefined) {
        return referenceOperand(existing);
      }
    }

    /*
    * Record.X is normally occurrence-based.
    *
    * However, calibrated GetSetId(...) calls reuse an existing RECORD
    * PSPCMNAME row when the same Record.X is supplied repeatedly:
    *
    *   GetSetId(..., Record.DEPT_TBL, ...)
    *   GetSetId(..., Record.DEPT_TBL, ...)
    *
    * Other calibrated contexts such as CreateRecord(Record.X) remain
    * occurrence-based.
    */
    if (reuseRowShorthandRecord) {
      if (createRecordAssignmentTarget !== undefined) {
        const targetKey =
          `${controlGroup}:${createRecordAssignmentTarget.toLowerCase()}:${recordName.toLowerCase()}`;
        const byTarget = createRecordReferencesByTarget.get(targetKey);

        if (byTarget !== undefined) {
          return referenceOperand(byTarget);
        }
      }

      const existing = readTracedReusePool(
        'rowShorthandRecords',
        rowShorthandRecords,
        recordName.toLowerCase(),
        'recordReference:reuseRowShorthandRecord',
        pos - recordName.length
      );
      if (existing !== undefined) {
        return referenceOperand(existing);
      }

      const createCount =
        createRecordReferenceCounts.get(recordName.toLowerCase()) ?? 0;
      const previousCreate =
        createRecordReferences.get(recordName.toLowerCase());

      if (createCount >= 2 && previousCreate !== undefined) {
        return referenceOperand(previousCreate);
      }
    }

    /*
     * This control-group-scoped pool only holds a genuine reusable
     * dependency when a real lexical block (If/For/While/Evaluate/Try, or
     * a Function/Method body's own statement) is actually open --
     * `controlDepth > 0`. At the bare top level, `controlGroup` can stay
     * numerically unchanged across many unrelated flat top-level
     * statements (nothing bumps it there), so reading this pool
     * unconditionally wrongly reuses one flat statement's Record.X
     * argument for a later, unrelated flat statement's own argument.
     *
     * DERIVED_HR_TRN.ATTENDANCE.FieldChange (definition 6352) proves the
     * flat-top-level case: four consecutive top-level
     * `FetchValue(Record.DERIVED_HR_TRN, CurrentRowNumber(), ...)`
     * statements each allocate a FRESH RECORD.DERIVED_HR_TRN row in
     * stored bytes, not one shared row. AE_DERIVED.AE_RELEASE_BTN.
     * FieldFormula (definition 802) proves the nested case still reuses
     * correctly once this guard is added: six `FetchValue`/`UpdateValue`
     * calls to `Record.AETEMPTBLMGR`, all inside a `Function`'s own
     * `For`/`If` body (so `controlDepth > 0` throughout), share one
     * PSPCMNAME row exactly as before.
     *
     * This mirrors the identical `controlDepth > 0` guard
     * `reuseRecordReferenceWithinCallArguments`'s own fallback already
     * uses a few lines below (see its own comment, citing definitions
     * 1220 vs 840/1283) -- the same rule, independently confirmed for
     * this sibling mechanism by a full-corpus research pass across
     * GetRecord/ActiveRowCount/FetchValue/ScrollFlush.
     */
    if (reuseRecordReferenceWithinControlGroup) {
      const withinStatement = recordReferencesWithinCurrentStatement.get(
        recordName.toLowerCase()
      );

      if (withinStatement !== undefined) {
        return referenceOperand(withinStatement);
      }
    }

    /*
     * Cycle 47 (definition 29522): `CreateRecord(Record.X)` writes into
     * `dependencyScope` UNCONDITIONALLY (see the unconditional
     * `dependencyScope.recordRecord(...)` call below, guarded only by the
     * unrelated `reuseRecordReferenceWithinCallArguments`/
     * `suppressRecordReferenceControlGroupWrite` flags -- both false here)
     * but never READS from it -- `reuseRecordReferenceWithinControlGroup`
     * (the flag gating this read) is set by `GetRecord`/`CreateRowset`/etc.
     * but deliberately NOT by `CreateRecord` (see that flag's own
     * assignment site). For ORDINARY PeopleCode this is calibrated and
     * correct: `CreateRecord(Record.X)` there is genuinely occurrence-based
     * (population census: 146/221 same-method-repeated-name candidates
     * allocate fresh each time, only 58/221 reuse -- a mixed, ALREADY
     * separately-modeled population via `createRecordReferencesByTarget`/
     * `createRecordReferenceCounts` below, not method-wide reuse). But
     * Application Class method bodies behave differently, exactly like
     * Cycle 43's RECORD/SCROLL finding and Cycle 46's FIELD finding:
     * population census of repeated-same-record-name `CreateRecord` calls
     * within one Application Class method found 83/84 (99%) reuse ONE
     * RECORD row, regardless of target variable or control-group boundary
     * -- confirmed directly against definition 29522 itself
     * (`&ConfRec_bef = CreateRecord(Record.GP_ABS_SS); ... &ConfRec =
     * CreateRecord(Record.GP_ABS_SS);`, two different target variables,
     * separated by an If/Else block). Gated on
     * `recordDependenciesHaveMethodWideLifetime` (Cycle 43's own flag, set
     * only for Application Class method-body fragments) so ordinary
     * PeopleCode's existing, separately-calibrated CreateRecord behavior
     * below is completely unaffected -- this new check runs FIRST and
     * falls through to that existing logic untouched when it finds
     * nothing.
     */
    if (
      reuseRecordReferenceWithinControlGroup ||
      (reuseRowShorthandRecord && context?.recordDependenciesHaveMethodWideLifetime)
    ) {
      /*
       * Cycle 71 (definitions 28726/28755/...): `dependencyScope.lookupRecord`
       * only ever consulted the method-wide `recordReferencesByControlGroup`
       * pool -- unlike `fieldReference()`'s own two branches (Cycle 69/70),
       * it never fell back to the class-wide `applicationClassTypeReferenceSession`
       * facade, so cross-method reuse never happened. `28726`'s
       * `CreateRowset(Record.PSADSDEFNITEM)` (method `FindLikeShape`) and
       * `CreateRecord(Record.PSADSDEFNITEM)` (method `BuildAdsRecList`)
       * share ONE stored identity; each method independently (but
       * correctly, method-wide) allocated its own fresh one. A corpus-wide
       * census (`cycle71-record-scroll-classwide-census.ts`) found 0
       * contradictions across the RECORD population.
       */
      const existing =
        dependencyScope.lookupRecord(recordName) ??
        context?.applicationClassTypeReferenceSession?.lookup({
          kind: 'record',
          recordName
        });

      if (existing !== undefined) {
        dependencyScope.recordRecord(recordName, existing);
        /*
         * DERIVED_HR.LOOKUP_NID_BTN.FieldChange (definition 5687):
         *
         *   ScrollFlush(Record.NID_SRCH_VW);
         *   &n = ScrollSelect(1, Record.NID_SRCH_VW, Record.NID_SRCH_VW1, ...);
         *   Else
         *   ScrollFlush(Record.NID_SRCH_VW);
         *   &n = ScrollSelect(1, Record.NID_SRCH_VW, Record.NID_DEP_SRCH_V1, ...);
         *
         * The If-branch's ScrollSelect (a RowScrollSelect-family call)
         * clears `genericRecordReferencesSinceLastFamilyCall` on completion
         * (see that map's own declaration). The Else-branch's ScrollFlush
         * then reuses NID_SRCH_VW via THIS check, not a fresh allocation --
         * but that reuse must re-populate the map so the Else-branch's own
         * ScrollSelect (another family call, right after) can still find
         * it as a single-occurrence candidate. Without this, the row would
         * wrongly look "gone" merely because the carrying call happened to
         * be a reuse rather than a fresh allocation.
         */
        genericRecordReferencesSinceLastFamilyCall.set(
          `${controlGroup}:${recordName.toLowerCase()}`,
          existing
        );
        return referenceOperand(existing);
      }
    }

    if (reuseRecordReferenceByName) {
      const existing = references.find(
        reference =>
          reference.kind === 'record' &&
          reference.recordName !== undefined &&
          reference.recordName.toLowerCase() === recordName.toLowerCase()
      );

      if (existing !== undefined) {
        return referenceOperand(existing);
      }
    }

    if (reuseRecordReferenceWithinCallArguments) {
      const participating = participatingRecordReferencesByControlGroup.get(
        `${controlGroup}:${recordName.toLowerCase()}`
      );

      if (participating !== undefined) {
        return referenceOperand(participating);
      }

      const existing = recordReferencesWithinCallArguments.get(
        recordName.toLowerCase()
      );

      if (existing !== undefined) {
        return referenceOperand(existing);
      }

      /*
       * See `singleOccurrenceCallArgumentRecordNames`'s own declaration
       * (definition 1220 vs definition 1283): a name that appears only
       * once across this whole call's own argument list may still reuse
       * an EARLIER, same-control-group row (e.g. an immediately preceding
       * ScrollFlush's own allocation) -- unlike a name repeated within
       * this call, which normally stays call-private per the two checks
       * above.
       *
       * Read from `genericRecordReferencesSinceLastFamilyCall`, not
       * `recordReferencesByControlGroup` directly -- see that map's own
       * declaration (definition 843 vs definition 860) for why an
       * intervening RowScrollSelect-family call must invalidate this.
       *
       * A name REPEATED within this call may ALSO reuse that earlier row,
       * but only when nested inside a control-flow block (`controlDepth >
       * 0` -- If/For/While/Evaluate/etc), not at the flat top level.
       * AE_WRK.AE_REFRESH.FieldChange (definition 889, inside a Function's
       * `Evaluate ... When` body), AMM_DERIVED.PT_FORCE_RETRY.FieldChange
       * (definition 1007, inside nested top-level `If` blocks) and
       * DERIVED_BAS.BN_TOGGLE.ODEM_RemoteCall (definition 1749, inside a
       * Function's own `If` body) all prove a single-argument
       * `ScrollFlush(Record.X); RowScrollSelect(N, Record.X, Record.X,
       * ...)` / `ScrollSelect(...)` pair DOES share one row when nested --
       * disproving definition 840/1283's own flat-top-level non-reuse
       * ONLY at that same nesting depth: BENCHMARK.ARCH_FLT_RQST's own
       * definition 1220 (this fallback's ORIGINAL evidence) is itself
       * nested inside an `If %PanelGroup = ... Then` block, and 840/1283's
       * OWN repeated-name ScrollFlush/ScrollSelect pairs sit at flat
       * top level (`controlDepth === 0`) with no wrapping block at all --
       * so `controlDepth` is the actual discriminator this fallback was
       * always missing, not "single occurrence vs repeated".
       */
      if (
        singleOccurrenceCallArgumentRecordNames?.has(
          recordName.toLowerCase()
        ) ||
        dependencyScope.isOpen
      ) {
        const controlGroupExisting =
          genericRecordReferencesSinceLastFamilyCall.get(
            `${controlGroup}:${recordName.toLowerCase()}`
          );

        if (controlGroupExisting !== undefined) {
          return referenceOperand(controlGroupExisting);
        }
      }
    }

    /*
     * Cycle 72 (definitions 28954/28998/...): outside every RECORD-aware
     * consumer above (GetRecord/Select/GetSetId/CreateRecord's own
     * argument -- none of `reuseRecordReferenceWithinControlGroup`,
     * `reuseRowShorthandRecord`, `reuseRecordReferenceByName`, or
     * `reuseRecordReferenceWithinCallArguments` fired), a bare `Record.X`
     * passed to some OTHER, generic consumer (an Application Class method
     * call, an arbitrary function) is an ordinary symbolic constant --
     * exactly Cycle 66's own proven rule for `Field.X` outside
     * `GetField(...)`. A corpus-wide census
     * (`cycle72-generic-record-argument-census.ts`, 511 RECORD + 180
     * SCROLL candidates, repeated 2+ times via a non-RECORD-aware
     * consumer) found 0 contradictions either kind. Deliberately excludes
     * `reuseRowShorthandRecord` (CreateRecord's own argument) --
     * CreateRecord is its OWN, separately calibrated, genuinely mixed
     * population (Cycle 43: 146/221 fresh vs 58/221 reuse for ordinary
     * PeopleCode) and must not be folded into this unconditional rule.
     * Shares the SAME `dependencyScope` pool (method-wide via
     * `recordScopeId()`, class-wide via `applicationClassTypeReferenceSession`)
     * every RECORD-aware consumer already reads from -- one identity
     * regardless of which consumer happens to reach it first.
     */
    if (
      !reuseRowShorthandRecord &&
      !reuseRecordReferenceWithinControlGroup &&
      !reuseRecordReferenceByName &&
      !reuseRecordReferenceWithinCallArguments &&
      context?.recordDependenciesHaveMethodWideLifetime
    ) {
      const existing =
        dependencyScope.lookupRecord(recordName) ??
        context?.applicationClassTypeReferenceSession?.lookup({
          kind: 'record',
          recordName
        });

      if (existing !== undefined) {
        dependencyScope.recordRecord(recordName, existing);
        return referenceOperand(existing);
      }
    }

    const reference = nextReference({
      kind: 'record',
      recordName
    });

    if (reuseRecordReferenceWithinCallArguments) {
      recordReferencesWithinCallArguments.set(
        recordName.toLowerCase(),
        reference
      );
    }

    if (options.explicitChainReuse) {
      explicitRecordReferences.set(
        `${controlGroup}:${recordName.toLowerCase()}`,
        reference
      );
    }

    /*
     * A RowScrollSelect/RowScrollSelectNew call's OWN Record.X arguments
     * are private to that call: they must not become visible to a LATER
     * statement's own control-group-scoped reuse check (the unconditional
     * write below, otherwise shared by every other Record.X allocation).
     *
     * ANL_MOD_DAT_SRC.QRYNAME.FieldChange (definition 1172):
     *
     *   RowScrollSelectNew(2, Record.ANL_MOD_DAT_SRC, &N_DATA_SRC_NUM, Record.ANL_MOD_DIM_FLD, Record.QRY_FLD_VW, "...", ANL_MOD_DAT_SRC.QRYNAME);
     *   &N_FLD_COUNT = ActiveRowCount(Record.ANL_MOD_DAT_SRC, &N_DATA_SRC_NUM, Record.ANL_MOD_DIM_FLD);
     *
     * both in the same control group. The immediately-following
     * ActiveRowCount call's own Record.ANL_MOD_DAT_SRC/Record.
     * ANL_MOD_DIM_FLD arguments do NOT reuse RowScrollSelectNew's rows --
     * stored allocates two fresh ones -- even though ActiveRowCount is
     * itself a normal reuse-participating call that WOULD otherwise find
     * them via this map. Scoped narrowly to
     * `reuseRecordReferenceWithinCallArguments` (true only while parsing
     * a RowScrollSelect/RowScrollSelectNew call's own argument list, see
     * that flag's own declaration) so every other Record.X allocation
     * keeps writing here exactly as before.
     */
    if (
      !reuseRecordReferenceWithinCallArguments &&
      !suppressRecordReferenceControlGroupWrite
    ) {
      dependencyScope.recordRecord(recordName, reference);
      genericRecordReferencesSinceLastFamilyCall.set(
        `${controlGroup}:${recordName.toLowerCase()}`,
        reference
      );
    }
    if (reuseRecordReferenceWithinControlGroup) {
      recordReferencesWithinCurrentStatement.set(
        recordName.toLowerCase(),
        reference
      );
    }
    if (marksControlGroupParticipant) {
      participatingRecordReferencesByControlGroup.set(
        `${controlGroup}:${recordName.toLowerCase()}`,
        reference
      );
    }
    if (reuseRowShorthandRecord) {
      const key = recordName.toLowerCase();

      createRecordReferences.set(key, reference);
      createRecordReferenceCounts.set(
        key,
        (createRecordReferenceCounts.get(key) ?? 0) + 1
      );

      if (createRecordAssignmentTarget !== undefined) {
        createRecordReferencesByTarget.set(
          `${controlGroup}:${createRecordAssignmentTarget.toLowerCase()}:${key}`,
          reference
        );
      }
    }
    if (captureRowsetElementRecord) {
      rowsetElementRecords.set(recordName.toLowerCase(), reference);
    }
    return referenceOperand(reference);
  };

  const fieldReference = (): Buffer => {
    if (!word('Field')) return fail('expected Field');
    if (source[pos] !== '.') return fail('expected . after Field');
    pos++;

    const fieldName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (!fieldName) return fail('expected field name after Field.');
    pos += fieldName.length;

    // Field.X allocates only the occurrence-based FIELD row.
    // PACKAGE FIELD is created by a Field object declaration, not by
    // encountering Field.X in an expression.
    // Repeated-Field calibration proves FIELD rows are occurrence-based.
    //
    // GetField(Field.X) on a .GetRecord(...) chain result is the one
    // evidenced exception: it reuses within the current control group
    // (see reuseFieldReferenceWithinControlGroup's declaration comment).
    //
    // Cycle 70 (definitions 29401/29445): this branch only ever consulted
    // `fieldDependencyScope` (method-wide, via `fieldScopeId()`), unlike
    // its sibling branch below (fixed in Cycle 69), which also falls back
    // to the class-wide `applicationClassTypeReferenceSession` facade.
    // `29445`'s `&GrnRowInfo.GetRecord(Record.GPUS_GRN).GetField(Field.RECIPIENT_ID)`
    // is reached from TWO different methods (`AddRecipientInfo`,
    // `SetRecipientID`); stored has exactly ONE PSPCMNAME row, shared by
    // both, while each method independently (but correctly, method-wide)
    // allocated its OWN fresh identity. A corpus-wide census
    // (`cycle70-getfield-chain-classwide-census.ts`, 86 candidates via the
    // direct `.GetRecord(Record.X).GetField(Field.Y)` chain shape alone --
    // the same branch is also reached via a numeric-index
    // `.GetRecord(n).GetField(...)` chain, per 29457's own
    // `&rsDefaultsSet(&i).GetRecord(1).GetField(Field.EFFDT)`, not
    // separately re-counted) found 79/86 matched, 0 contradictions.
    if (reuseFieldReferenceWithinControlGroup) {
      const existing =
        fieldDependencyScope.lookupField(fieldName) ??
        context?.applicationClassTypeReferenceSession?.lookup({
          kind: 'field',
          fieldName
        });

      if (existing !== undefined) {
        fieldDependencyScope.recordField(fieldName, existing);
        return referenceOperand(existing);
      }
    }

    /*
     * Cycle 66 (definition 29099): outside a `GetField(...)` call's own
     * occurrence-owned arguments (see `fieldReferenceOccurrenceOwnedByGetField`'s
     * own declaration comment for the population evidence), an explicit
     * `Field.X` reference is an ordinary symbolic constant -- reuse it the
     * same way a Record-typed variable's bare-member FIELD access already
     * does (Cycle 46's method-wide `fieldDependencyScope`, Cycle 65's
     * class-wide `applicationClassTypeReferenceSession` fallback for when
     * an inherited `%This.method()` call disables the gated cross-fragment
     * session). Scoped to Application Class method bodies only
     * (`recordDependenciesHaveMethodWideLifetime`, set only by
     * `encodeApplicationClassProgramV2`) -- this cycle's census covered
     * only that population; ordinary PeopleCode's own occurrence-based
     * default (a large, already-EXACT population) is left untouched.
     */
    if (
      !reuseFieldReferenceWithinControlGroup &&
      !fieldReferenceOccurrenceOwnedByGetField &&
      context?.recordDependenciesHaveMethodWideLifetime
    ) {
      const existing =
        fieldDependencyScope.lookupField(fieldName) ??
        context?.applicationClassTypeReferenceSession?.lookup({
          kind: 'field',
          fieldName
        });

      if (existing !== undefined) {
        fieldDependencyScope.recordField(fieldName, existing);
        return referenceOperand(existing);
      }
    }

    const reference = nextReference({
      kind: 'field',
      fieldName
    });

    if (reuseFieldReferenceWithinControlGroup) {
      fieldDependencyScope.recordField(fieldName, reference);
    } else if (
      !fieldReferenceOccurrenceOwnedByGetField &&
      context?.recordDependenciesHaveMethodWideLifetime
    ) {
      fieldDependencyScope.recordField(fieldName, reference);
    }

    return referenceOperand(reference);
  };

  const scrollReference = (): Buffer => {
    if (!word('Scroll')) return fail('expected Scroll');
    if (source[pos] !== '.') return fail('expected . after Scroll');
    pos++;

    const recordName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (!recordName) return fail('expected scroll name after Scroll.');
    pos += recordName.length;

    // Same controlDepth > 0 guard as recordReference()'s identical
    // Record.X check a few lines above -- see that check's own comment
    // for the full evidence trail (definitions 6352 vs 802).
    if (reuseScrollReferenceWithinControlGroup && dependencyScope.isOpen) {
      /*
       * Cycle 71: same class-wide facade fallback as `recordReference()`'s
       * own fix a few dozen lines above -- `dependencyScope.lookupScroll`
       * only ever consulted the method-wide pool. `28713`'s
       * `GetRowset(Scroll.PSADSRELATION)` reused across 6 different
       * occurrences (some cross-method) is the concrete evidence; a
       * corpus-wide census found 0 contradictions across the SCROLL
       * population.
       */
      const existing =
        dependencyScope.lookupScroll(recordName) ??
        context?.applicationClassTypeReferenceSession?.lookup({
          kind: 'scroll',
          recordName
        });

      if (existing !== undefined) {
        dependencyScope.recordScroll(recordName, existing);
        return referenceOperand(existing);
      }

      const reference = nextReference({
        kind: 'scroll',
        recordName
      });

      dependencyScope.recordScroll(recordName, reference);

      return referenceOperand(reference);
    }

    /*
     * Cycle 72: SCROLL-side counterpart to `recordReference()`'s own
     * generic-argument fix above -- outside the calibrated `GetRowset()`
     * context, a bare `Scroll.X` passed to some OTHER, generic consumer
     * still shares the SAME class-wide identity `GetRowset(Scroll.X)`
     * itself would reuse (a corpus-wide census,
     * `cycle72-generic-record-argument-census.ts`, found 180 SCROLL
     * candidates, 0 contradictions). Ordinary PeopleCode is unaffected:
     * `applicationClassTypeReferenceSession` is `undefined` there, and
     * `recordDependenciesHaveMethodWideLifetime` gates the whole check.
     */
    if (context?.recordDependenciesHaveMethodWideLifetime) {
      const existing =
        dependencyScope.lookupScroll(recordName) ??
        context?.applicationClassTypeReferenceSession?.lookup({
          kind: 'scroll',
          recordName
        });

      if (existing !== undefined) {
        dependencyScope.recordScroll(recordName, existing);
        return referenceOperand(existing);
      }

      const genericReference = nextReference({
        kind: 'scroll',
        recordName
      });

      dependencyScope.recordScroll(recordName, genericReference);

      return referenceOperand(genericReference);
    }

    // Outside the calibrated GetRowset() context, preserve the long-standing
    // occurrence-based SCROLL allocation behavior.
    return referenceOperand(
      nextReference({
        kind: 'scroll',
        recordName
      })
    );
  };


  const componentReference = (): Buffer => {
    if (!word('Component')) return fail('expected Component');
    if (source[pos] !== '.') return fail('expected . after Component');
    pos++;

    const componentName =
      /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];

    if (!componentName) {
      return fail('expected component name after Component.');
    }

    pos += componentName.length;

    /*
     * COMPONENT references are name-deduplicated only within the current
     * control group.
     *
     * Offset 166 proves that an outer If and a nested If in the same control
     * group reuse Component.ABS_SHP_LEAVE_GBR.
     *
     * The large ABS_HIST_UK_SBR.SMP_MA_ELIG.FieldFormula capture proves that
     * the same component name is allocated again in later independent control
     * groups; PSPCMNAME contains multiple COMPONENT/ABS_SHP_LEAVE_GBR rows.
     */
    const key = `${controlGroup}:${componentName.toLowerCase()}`;
    const existing = componentReferencesByControlGroup.get(key);

    if (existing !== undefined) {
      return referenceOperand(existing);
    }

    const reference = nextReference({
      kind: 'component',
      objectName: componentName
    });

    componentReferencesByControlGroup.set(key, reference);
    return referenceOperand(reference);
  };

  /*
   * Confirmed PeopleTools 0x48 quoted-name reference qualifiers.
   *
   * Examples:
   *   Operation."GL_JRNL_IMP"
   *   MenuName."HEADCOUNT_(FP)"
   *   BusProcess."SEND_ACA_NOTIFICATION"
   *   BusActivity."SEND_ACA_NOTIFICATION"
   *   BusEvent."Notify Employee"
   *
   * PSPCMNAME stores the qualifier in RECNAME and the quoted value in
   * REFNAME. The compiled statement stream stores:
   *
   *   48 <uint16 little-endian zero-based PSPCMNAME index>
   *
   * Keep this list aligned with the decoder's already-calibrated 0x48
   * qualifier set. Qualifiers outside this set are not guessed.
   */
  const quotedReferenceQualifiers = new Map<string, string>([
    ['operation', 'OPERATION'],
    ['menuname', 'MENUNAME'],
    ['barname', 'BARNAME'],
    ['itemname', 'ITEMNAME'],
    ['page', 'PAGE'],
    ['busprocess', 'BUSPROCESS'],
    ['busactivity', 'BUSACTIVITY'],
    ['busevent', 'BUSEVENT'],
    ['panel', 'PANEL'],
    ['panelgroup', 'PANELGROUP'],
    ['component', 'COMPONENT']
  ]);

  /*
   * Quoted 0x48 references are deduplicated by qualifier + quoted value
   * WITHIN THE SAME CONTROL GROUP, not globally across the whole program.
   *
   * ACA_XML_WRK.ACA_UPDATE_PB.FieldChange (definition 369) proves the
   * reuse case: two `Transfer(...)` calls, `MenuName."ACA_SETUP_RPT"` and
   * `BarName."USE"` identical in both, sit inside the SAME top-level `If
   * %Page = "ACA_XMIT_ACK" Then ... Else If All(...) Then ... End-If;
   * End-If;` -- one Then-branch's nested call and the Else's nested call,
   * sharing one control group (only the outermost `If` bumps it) -- both
   * compiled uses point back to the same PSPCMNAME rows.
   *
   * AE_DERIVED.AE_TEMPTBL_BTN.FieldChange (definition 805) disproves
   * reusing that GLOBALLY: its own two `Transfer(...)` calls, with an
   * IDENTICAL `BarName."USE"`, sit in two SEPARATE top-level `If
   * %PanelGroup <> ... Then ... End-If;` / `If %PanelGroup = ... Then
   * ... End-If;` statements -- different control groups -- and stored
   * allocates a completely fresh row for the second call's `BarName.
   * "USE"` (NAMENUM 15, not reusing NAMENUM 7's row from the first call).
   */
  const quotedReferencesByControlGroup =
    new Map<string, PeopleCodeReference>();

  const quotedReference = (): Buffer => {
    const qualifierMatch =
      /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));

    if (!qualifierMatch) {
      return fail('expected quoted-reference qualifier');
    }

    const sourceQualifier = qualifierMatch[0];
    const storedQualifier =
      quotedReferenceQualifiers.get(sourceQualifier.toLowerCase());

    if (storedQualifier === undefined) {
      return fail(`unsupported quoted-reference qualifier ${sourceQualifier}`);
    }

    pos += sourceQualifier.length;
    space();

    if (source[pos] !== '.') {
      return fail('expected . after quoted-reference qualifier');
    }

    pos++;
    space();

    const quote = source[pos];
    if (quote !== '"' && quote !== "'") {
      return fail('expected quoted name after quoted-reference qualifier');
    }

    pos++;

    let refName = '';

    while (pos < source.length) {
      const char = source[pos++];

      if (char === quote) {
        if (source[pos] === quote) {
          refName += quote;
          pos++;
          continue;
        }

        // See `quotedReferencesByControlGroup`'s own declaration
        // (definition 369 vs definition 805) for why this must be scoped
        // by control group, not deduplicated globally.
        const quotedKey =
          `${controlGroup}:${storedQualifier.toLowerCase()}:${refName.toLowerCase()}`;
        let reference = quotedReferencesByControlGroup.get(quotedKey);

        if (reference === undefined) {
          reference = nextReference({
            kind: 'quoted-reference',
            recordName: storedQualifier,
            fieldName: refName
          });
          quotedReferencesByControlGroup.set(quotedKey, reference);
        }

        if (reference.index > 0xffff) {
          return fail('quoted-reference index exceeds uint16 range');
        }

        // This 0x48 path writes its own operand bytes directly instead of
        // going through referenceOperand() (0x21's shared helper), so it
        // must fire its own diagnostic USE trace the same way -- otherwise
        // a reference-lifecycle research consumer silently sees zero
        // occurrences for every quoted reference after its first ALLOC.
        // Purely observational: does not affect encoding.
        context?.referenceTrace?.({
          action: 'USE',
          sourceOffset: pos,
          controlGroup,
          controlDepth,
          functionDepth,
          reference
        });

        const bytes = Buffer.alloc(3);
        bytes[0] = 0x48;
        bytes.writeUInt16LE(reference.index, 1);
        return bytes;
      }

      if (char === '\0') {
        return fail('NUL cannot appear in quoted-reference name');
      }

      refName += char;
    }

    return fail('unterminated quoted-reference name');
  };

  const reservedCallNames = new Set([...OPCODES.values()]
    .filter(spec => spec.kind === TokenKind.Keyword && spec.text)
    .map(spec => spec.text!.toLowerCase()));
  // Value is also a real bare 0x0a-introduced conversion call in the
  // corpus; its keyword meaning applies in DLL parameter declarations.
  reservedCallNames.delete('value');
  const fail = (message: string): never => {
    throw new UnsupportedPeopleCodeError(pos, message);
  };
  /*
   * Cycle 115: a conditional-compilation directive region is masked as
   * whitespace (see `conditionalCompilation.ts`); its records are written
   * the first time the encoder's whitespace skipping reaches it -- after
   * the preceding token, before any boundary marker of the next item.
   */
  const conditionalRegions = context?.conditionalDirectiveRegions;
  const conditionalBase = context?.conditionalDirectiveBase ?? 0;
  const emittedConditionalRegions = new Set<number>();
  const emitConditionalRegionAt = (at: number): void => {
    const region = conditionalRegions!.get(conditionalBase + at);
    if (region === undefined || emittedConditionalRegions.has(region.start)) return;
    emittedConditionalRegions.add(region.start);
    context?.conditionalDirectiveEmissions?.add(region.start);
    chunks.push(region.records);
  };
  // Cycle 115: whether a directive region starts in [from, to).
  const conditionalRegionBetween = (from: number, to: number): boolean => {
    if (conditionalRegions === undefined) return false;
    for (let at = from; at < to; at++) {
      if (conditionalRegions.has(conditionalBase + at)) return true;
    }
    return false;
  };
  const space = conditionalRegions === undefined
    ? () => { while (pos < source.length && /\s/.test(source[pos])) pos++; }
    : () => { while (pos < source.length && /\s/.test(source[pos])) { emitConditionalRegionAt(pos); pos++; } };

  /*
   * Look past one or more standalone block comments to determine what the
   * next significant top-level source item is. This is used only to decide
   * whether a comment is still inside a leading Local declaration run or
   * follows the end of that run.
   */
  /*
   * Cycle 88: like `nextSignificantAfterBlockComments`, but also skips REM
   * statements (a REM runs to its terminating `;`, possibly across lines,
   * exactly as `remComment()` consumes it). Used to find the next REAL
   * top-level item after a REM.
   */
  const nextSignificantAfterComments = (start: number): number => {
    let scan = start;
    while (true) {
      scan = nextSignificantAfterBlockComments(scan);
      if (!startsRemComment(scan)) {
        return scan;
      }
      const end = source.indexOf(';', scan);
      scan = end < 0 ? source.length : end + 1;
    }
  };

  /*
   * Cycle 90: the next REAL top-level item, looking past every kind of
   * comment trivia -- block comments, REM statements and `<* ... *>`
   * disabled code.
   */
  const nextSignificantAfterTrivia = (start: number): number => {
    let scan = start;
    while (true) {
      scan = nextSignificantAfterComments(scan);
      if (!source.startsWith('<*', scan)) {
        return scan;
      }
      const end = source.indexOf('*>', scan + 2);
      if (end < 0) {
        return scan;
      }
      scan = end + 2;
    }
  };

  /*
   * Cycle 90: before executable code, top-level comments are transparent to
   * the generic declaration section. A comment only closes the section when
   * the next REAL item (past all intervening comment trivia) neither
   * continues the section as a declaration nor as a Local. LOCAL SNAPSHOT
   * (`cycle90-comment-state-census.py`): stored never closes at the comment
   * when a declaration or Local follows -- e.g. 2128 `Component ...; <blank>
   * REM ...; <blank> Local ...` stores `4F REM` there and the formal
   * `2D 4F` only at the end of the Local run; 28250 `Declare ...; /*c*\/
   * REM ...; Local` and 19549 `Declare ...; /*c*\/ <* *> Local` likewise.
   */
  const nextRealItemContinuesDeclarationSection = (start: number): boolean => {
    const rest = source.slice(nextSignificantAfterTrivia(start));
    return /^(?:Global|PanelGroup|Component|Constant|Declare\s+Function|Local)\b/i.test(rest);
  };

  const nextSignificantAfterBlockComments = (
    start: number
  ): number => {
    let scan = start;

    while (true) {
      while (
        scan < source.length &&
        /\s/.test(source[scan])
      ) {
        scan++;
      }

      if (!source.startsWith('/*', scan)) {
        return scan;
      }

      const end = source.indexOf('*/', scan + 2);

      if (end < 0) {
        return scan;
      }

      scan = end + 2;
    }
  };
  const blockComment = (): Buffer => {
    if (!source.startsWith('/*', pos)) {
      return fail('expected block comment');
    }

    const end = source.indexOf('*/', pos + 2);

    if (end < 0) {
      return fail('unterminated block comment');
    }

    const text = source.slice(pos, end + 2);
    const payload = Buffer.from(text, 'utf16le');

    if (payload.length > 0xffff) {
      return fail('block comment exceeds uint16 byte-length field');
    }

    const header = Buffer.alloc(3);
    /*
     * REM participates in decoded comment-opcode provenance just like block
     * comments do. PSREN.SSL_FLAG.SaveEdit (definition 16858) stores a 0x24
     * REM immediately followed by a trailing 0x4E block comment; failing to
     * consume the REM's entry shifts the trailing comment back to 0x24 on
     * roundtrip.
     *
     * Cycle 113: without decoded provenance the opcode is the comment's
     * PLACEMENT, whichever call site reaches it -- 0x24 when the `/*`
     * starts its own source line, 0x4E when anything precedes it on that
     * line (another comment, `try`, a REM, a For / If header). Across the
     * local corpus 70,152 aligned block comments follow this with no
     * exception; e.g. 523 `/* 811477 end *\/ /* Begin Bug 19722155 *\/`
     * stores the second comment as 0x4E.
     */
    header[0] = consumeCommentOpcode(blockCommentStartsOwnLine() ? 0x24 : 0x4e);
    header.writeUInt16LE(payload.length, 1);

    pos = end + 2;

    return Buffer.concat([header, payload]);
  };

  /*
   * PeopleTools stores a REM statement as a 0x24 length-prefixed comment
   * payload containing the complete source text, including its semicolon:
   *
   *   REM &b0k = Default_SHP_setup();
   *
   * Unlike a normal PeopleCode statement, there is no separate 0x15
   * terminator after the payload.
   */

  const disabledCodeComment = (): Buffer => {
    if (!source.startsWith('<*', pos)) {
      return fail('expected <* disabled-code comment');
    }

    const end = source.indexOf('*>', pos + 2);
    if (end < 0) {
      return fail('unterminated <* disabled-code comment');
    }

    /*
     * PeopleTools preserves disabled PeopleCode blocks as one opaque token:
     *
     *   <*
     *      ... arbitrary PeopleCode text ...
     *   *>
     *
     * Offset 431 stores:
     *
     *   55 <uint16 UTF-16 byte length> <complete text including <* and *>>
     *
     * The payload is not tokenized or parsed as PeopleCode.
     */
    const value = source.slice(pos, end + 2);
    pos = end + 2;

    const payload = Buffer.from(value, 'utf16le');
    if (payload.length > 0xffff) {
      throw new UnsupportedPeopleCodeError(
        pos,
        'disabled-code comment exceeds uint16 payload length'
      );
    }

    const bytes = Buffer.alloc(3);
    bytes[0] = 0x55;
    bytes.writeUInt16LE(payload.length, 1);

    return Buffer.concat([bytes, payload]);
  };

  const startsRemComment = (
    start = pos
  ): boolean =>
    /^(?:REM|remark)\b/i.test(source.slice(start));

  const remComment = (allowMissingSemicolon = false): Buffer => {
    const match = /^(?:REM|remark)\b(?:[^;\r\n]*;|[^\r\n]*)/i.exec(
      source.slice(pos)
    );

    if (!match) {
      return fail('expected REM comment');
    }

    let remText = match[0];
    let consumedLength = match[0].length;

    /*
     * A REM line with no terminating ';' of its own is not yet a complete
     * comment token -- PeopleTools continues the same 0x24 payload across
     * physical lines, embedded line breaks included, until the first `;`.
     *
     * AMM_DERIVED.DELETE_BTN.RowInit (definition 964):
     *
     *   rem PSCHNLDEFN is a deprecated table in PT 8.48 and above.
     *   rem SQLExec("select ...", AMM_SYNCLIST.MSGNAME, &archive);
     *
     * Line 1 has no ';' of its own (a continued comment, not a complete
     * statement), so it merges with line 2 (which does close with ';')
     * into one 0x24 record covering both lines.
     *
     * AMM_ARCHIVE_WK.XML3_PB.FieldChange (definition 937) proves the
     * merge must STOP once a line already closes with ';' of its own,
     * rather than blindly merging every immediately-consecutive REM line
     * regardless:
     *
     *   rem AMM_DERIVED.MSGNAME = PSAPMSGARCHSC.MSGNAME;
     *   rem AMM_DERIVED.SUBNAME = PSAPMSGARCHSC.SUBNAME;
     *   rem AMM_DERIVED.APMSGVER = PSAPMSGARCHSC.APMSGVER;
     *
     * Each of these three lines closes with its own ';', so each is
     * already a complete rem statement -- stored has three SEPARATE 0x24
     * records (96, 96, and 100 bytes), not one 296-byte merged record.
     *
     * PSOPRDEFN.PTACCTNEVERLOCK.FieldChange (definition 16413) proves
     * indentation is not a continuation boundary: its second prose line
     * has the same indentation as REM, and the first line's trailing space
     * is preserved immediately before the embedded newline in the payload.
     */
    while (!remText.endsWith(';')) {
      const continuation = /^(\r?\n)(?:[^;\r\n]*;|[^\r\n]*)/.exec(
        source.slice(pos + consumedLength)
      );

      if (!continuation) {
        break;
      }

      remText += continuation[0];
      consumedLength += continuation[0].length;
    }

    if (!allowMissingSemicolon && !remText.endsWith(';')) {
      return fail('expected ; at end of REM comment');
    }

    // Preserve whitespace before embedded newlines, but retain the existing
    // normalization of horizontal whitespace after the final physical line.
    remText = remText.replace(/[ \t]+$/g, '');

    const payload = Buffer.from(remText, 'utf16le');

    if (payload.length > 0xffff) {
      return fail('REM comment exceeds uint16 byte-length field');
    }

    const header = Buffer.alloc(3);
    header[0] = consumeCommentOpcode(0x24);
    header.writeUInt16LE(payload.length, 1);

    pos += consumedLength;

    return Buffer.concat([header, payload]);
  };
  const inlineBlockComment = (): Buffer => {
    if (!source.startsWith('/*', pos)) {
      return fail('expected inline block comment');
    }

    const end = source.indexOf('*/', pos + 2);

    if (end < 0) {
      return fail('unterminated inline block comment');
    }

    const text = source.slice(pos, end + 2);
    const payload = Buffer.from(text, 'utf16le');

    if (payload.length > 0xffff) {
      return fail(
        'inline block comment exceeds uint16 byte-length field'
      );
    }

    const header = Buffer.alloc(3);
    // Cycle 113: by placement, as in `blockComment()` (2809: an own-line
    // comment reached through this inline site stores 0x24).
    header[0] = consumeCommentOpcode(blockCommentStartsOwnLine() ? 0x24 : 0x4e);
    header.writeUInt16LE(payload.length, 1);

    pos = end + 2;

    return Buffer.concat([
      header,
      payload
    ]);
  };
  const trailingBlockComments = (): void => {
    while (true) {
      /*
      * Only consume horizontal whitespace here.
      * A newline means the comment is no longer trailing the statement.
      */
      while (
        pos < source.length &&
        (source[pos] === ' ' || source[pos] === '\t')
      ) {
        pos++;
      }

      if (!source.startsWith('/*', pos)) {
        return;
      }

      chunks.push(inlineBlockComment());
    }
  };
  const word = (value: string): boolean => {
    const tail = source.slice(pos);
    if (!tail.toLowerCase().startsWith(value.toLowerCase()) || /[A-Za-z0-9_$#]/.test(tail[value.length] ?? '')) return false;
    pos += value.length;
    return true;
  };
  const variable = (): Buffer => {
    /*
     * A `&variable` name may start with a digit and continue with letters
     * -- not just be either letter-led or purely numeric. `[A-Za-z0-9_]+`
     * is a strict superset of the previous two-branch alternation
     * (letter-led identifiers and pure-digit names both still match
     * identically), additively covering the mixed digit-prefix case.
     *
     * WEBLIB_HSE.ISCRIPT1.FieldFormula (definition 21765, one of 27
     * corpus occurrences of this exact shape):
     *
     *   Local number &80EE_pin_num, &HSEPRP_pin_num, ...;
     *
     * `&80EE_pin_num` is a single variable name; the previous regex could
     * only match its `&80` prefix (via the `\d+` branch), leaving
     * `EE_pin_num` to break the declaration's own comma/semicolon check.
     */
    const match = /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos));
    if (!match) return fail('expected an ASCII &variable');
    pos += match[0].length;
    return textOperand(0x01, TokenKind.Name, match[0]);
  };
  const value = (): Buffer => {
    space();
    if (source[pos] === '&') return variable();
    if (word('True')) return fixed('True');
    if (word('False')) return fixed('False');

    /*
     * PeopleCode Null literal.
     *
     * Calibrated by ACCOMPLISHMENTS.EMPLID.SavePostChange:
     *
     *   &ServiceManager.LocateService("GetPersonProfileId", "1.0", Null)
     *
     * stores the third argument as the single-byte opcode 0x4B.
     */
    if (word('Null')) return Buffer.from([0x4b]);

    const numberMatch = /^([0-9]+)(?:\.([0-9]+))?/.exec(source.slice(pos));
    if (numberMatch) {
      const [wholeMatch, integerPart, fractionPart] = numberMatch;
      /*
       * A decimal literal (e.g. `33.34`, `9999999.99`) stores its
       * fractional digit count as a *scale* byte alongside the same
       * 0x50 magnitude field an integer literal uses -- the decoder
       * already reconstructs `value / 10^scale` (see `formatScaled()`
       * in decoder.ts, "found by refusing" pass thirty-four), but the
       * encoder previously only ever parsed bare integer digits, always
       * writing a zero scale. Without this, a decimal literal's `.`
       * was left for the general postfix-chain parser to choke on,
       * expecting a member name after what it saw as a `.` operator.
       *
       * CAN_AMEND_RL1_D.CORRECTED_AMOUNT.FieldFormula (definition 2291,
       * one of many corpus occurrences of this shape):
       *
       *   If CAN_AMEND_RL1_D.CORRECTED_AMOUNT > 9999999.99 Then
       */
      const scale = fractionPart?.length ?? 0;
      // Bound conversion before BigInt, including arbitrarily many leading
      // zeros. Never route the magnitude through a lossy JS Number.
      const canonical = (integerPart + (fractionPart ?? '')).replace(/^0+/, '') || '0';
      if (canonical.length > MAX_INTEGER_DIGITS) fail('unsigned integer exceeds the 128-bit magnitude field');
      let magnitude = BigInt(canonical);
      if (magnitude > MAX_UNSIGNED_INTEGER) fail('unsigned integer exceeds the 128-bit magnitude field');
      if (scale > 0xff) fail('decimal literal scale exceeds the 1-byte scale field');
      const { opcode, operandLength, valueOffset, valueBytes } = UNSIGNED_NUMBER_FORMAT;
      const bytes = Buffer.alloc(1 + operandLength);
      bytes[0] = opcode;
      // The zero prefix stays zero. Write the scale, then the entire
      // little-endian magnitude field; integer division never rounds
      // through floating point.
      bytes[2] = scale;
      for (let i = 0; i < valueBytes; i++) {
        bytes[1 + valueOffset + i] = Number(magnitude & 0xffn);
        magnitude >>= 8n;
      }
      pos += wholeMatch.length;
      return bytes;
    }
    const quote = source[pos];
    if (quote !== '"' && quote !== "'") return fail('expected a variable, string, boolean, or unsigned integer; other operands are unsupported');
    pos++;
    let text = '';
    while (pos < source.length) {
      const char = source[pos++];
      if (char === '\0') { pos--; return fail('NUL cannot appear in a terminated string operand'); }
      if (char === quote) {
        if (source[pos] === quote) { text += quote; pos++; }
        else return textOperand(0x16, TokenKind.StringLiteral, text);
      } else text += char;
    }
    return fail('unterminated string');
  };
  /*
   * Encode a primary expression together with any PeopleCode application-class
   * cast suffix:
   *
   *   &ServiceManager.LocateService("GetPersonProfileId", "1.0", Null)
   *      As HJPM_PERSON_SERVICES:Person:GetPersonProfileId_v1_0:GetPersonProfileId
   *
   * ACCOMPLISHMENTS.EMPLID.SavePostChange calibrates the compiled form as:
   *
   *   <primary> 35 <application-class-path>
   *
   * where 0x35 is the ordinary `As` opcode and the type path uses the same
   * inline-name / 0x57 separator encoding as an application-class declaration.
   *
   * The cast target establishes a runtime PACKAGE dependency, separate from
   * any import dependency. Repeated runtime references to the same class are
   * deduplicated through the runtime dependency registry.
   */
  const castPrimary = () => {
    primary();

    while (true) {
      const beforeWhitespace = pos;
      space();

      if (!/^As\b/i.test(source.slice(pos))) {
        pos = beforeWhitespace;
        return;
      }

      word('As');
      chunks.push(fixed('As'));

      space();

      if (!/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(source.slice(pos))) {
        chunks.push(typeName());
        continue;
      }

      const appClass = applicationClassPath();
      chunks.push(appClass.bytes);

      /*
       * An Application Class `As` cast establishes a runtime PACKAGE
       * dependency for the cast target.
       *
       * ACCOMPLISHMENTS.EMPLID.SavePostChange calibrates the sequence:
       *
       *   create ...ServiceManager()                         -> PACKAGE 16
       *   ... As ...GetPersonProfileId                      -> PACKAGE 17
       *   ... As ...SetPersonProfileContent                 -> PACKAGE 18
       *   ... As ...SetPersonProfileItems                   -> PACKAGE 19
       *   ... As ...DeletePersonProfileItems                -> PACKAGE 20
       *   create ...collProfileItemType()                   -> PACKAGE 21
       *   GetRowset()(&k).ACCOMPLISHMENTS                   -> RECORD 22
       *
       * Imports remain separate PACKAGE dependencies. Reuse the runtime
       * dependency registry so repeated casts/creates of the same class do
       * not create duplicate runtime rows.
       */
      if (unitScopedClassRows) {
        // Cycle 94: a cast uses its class in the current allocation unit.
        useApplicationClassRow(appClass.packagePath, appClass.className);
      } else {
        ensureRuntimeCreateReference(
          appClass.packagePath,
          appClass.className
        );
      }
    }
  };

  const expression = () => {
    castPrimary();

    while (true) {
      space();

      // A block comment starts with the same slash used by division, but it
      // is a statement boundary and must remain available to the statement
      // parser.
      if (source.startsWith('/*', pos)) break;

      const operator = /^[+\-*/|]/.exec(source.slice(pos))?.[0];
      if (!operator) break;

      pos += operator.length;
      chunks.push(fixed(operator, operator === '*' ? 0x0f : undefined));
      castPrimary();
    }
  };
  const booleanUnary = () => {
    space();

    /*
     * A comment between a boolean operator and its right operand is
     * inline (0x4E) if it continues the operator's own line, or
     * standalone (0x24) if it starts a new line -- see
     * `blockCommentByPlacement()`. PSIBLOGICL2_WRK.IB_FIELDTYPE_GUI
     * calibrates the inline case: `... = "0" Or /* Save or Reset *\/ ...
     * = "1"`. HS_EXAM_AUDIO2.<various>.FieldChange proves the standalone
     * case, with two own-line comments in a row after `And`:
     *
     *   If None(AUDIOMETRIC_TST.EXAM_TYPE_CD) And
     *         /***** Start of Resolution 597700 ******\/
     *         /*The below error message will be thrown ... *\/
     *         &DEL = "FALSE"
     */
    while (source.startsWith('/*', pos)) {
      chunks.push(blockCommentByPlacement());
      space();
    }

    /*
     * Cycle 117: a `(` group or an `@` operand is an ordinary primary --
     * comparisonExpression() -> expression() -> primary() parses it with
     * the full grammar inside and its postfix chain, arithmetic and
     * comparison after it. booleanUnary() formerly parsed both itself
     * (a group with no postfix chain, `@` only before `(` with no
     * arithmetic after it), so `Not ((Record.GP_ABS_EVENT).IsDeleted)`
     * (21960) and `... And (&row.GetRowset(1)).GetRow(1)...` (29945) failed
     * with "expected )", and `(@&L_SCROLL)` (4861) / `(@(...) + @(...))`
     * (26573) would have once groups use booleanExpression().
     */
    if (/^Not\b/i.test(source.slice(pos))) {
      pos += 3;
      chunks.push(fixed('Not'));
      booleanUnary();
      return;
    }

    comparisonExpression();
  };

  /*
   * Look past any leading `/* ... *\/` block comments (each followed by
   * ordinary whitespace) to determine whether `keyword` follows, without
   * consuming any source. Used to decide whether an And/Or-group
   * continues when a standalone comment sits between the last operand
   * and the next `And`/`Or`, e.g.:
   *
   *   PanelGroup.HS_INJ_ILL_REHAB
   *      /* Start of Resolution Id: 305302 *\/
   *      Or
   *      %Component = ...
   *
   * HS_INJ_ILL_REHAB.HS_PNLGRP_ROUTE.Value stores this comment as an
   * ordinary standalone 0x24 record positioned right after the 0x41
   * And/Or-group-open marker, before the `Or` keyword itself.
   */
  const restStartsWithKeywordPastComments = (keyword: RegExp): boolean => {
    let peek = pos;
    while (true) {
      while (peek < source.length && /\s/.test(source[peek])) peek++;
      if (source.startsWith('/*', peek)) {
        const end = source.indexOf('*/', peek + 2);
        if (end < 0) return false;
        peek = end + 2;
        continue;
      }
      break;
    }
    return keyword.test(source.slice(peek));
  };

  /*
   * A block comment renders as a standalone 0x24 record when it starts
   * on its own source line, or an inline 0x4E record when it continues
   * the same line as whatever precedes it -- the same distinction
   * `blockComment()`/`inlineBlockComment()` already draw elsewhere, just
   * decided here from the comment's own position rather than a fixed
   * per-call-site choice. Looks backward from `pos` (already positioned
   * at the comment's own `/*`) past only spaces/tabs, not newlines.
   *
   * HS_INJ_ILL_REHAB.HS_PNLGRP_ROUTE.Value proves both shapes can appear
   * around the SAME And/Or-group and If/Then boundary depending purely
   * on line placement:
   *
   *   If %PanelGroup = PanelGroup.HS_INJ_ILL_REHAB
   *         /* Start of Resolution Id: 305302 *\/    -- own line -> 0x24
   *         Or
   *         %Component = Component.HS_NE_INJILL_REHAB
   *      /* End of Resolution Id: 305302 *\/          -- own line -> 0x24
   *      Then
   */
  const blockCommentStartsOwnLine = (): boolean => {
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) i--;
    return i < 0 || source[i] === '\n' || source[i] === '\r';
  };

  const blockCommentByPlacement = (): Buffer =>
    blockCommentStartsOwnLine() ? blockComment() : inlineBlockComment();

  /*
   * Compiler architecture: extracted from 8 previously-duplicated call
   * sites (the And/Or-group leading/trailing comment checks, and the
   * ordinary When / When-Other / catch / End-Function header trailing-
   * comment checks) that each independently re-implemented this exact
   * lookahead. This is a strictly behavior-preserving consolidation --
   * every call site's own literal code (outer `[ \t]*` lookahead, then
   * `space()`, then the `blockCommentStartsOwnLine()` gate) is unchanged,
   * just shared instead of copy-pasted.
   *
   * If a `/*` comment is reachable from the current position by skipping
   * only horizontal whitespace (no newline in between), advances past
   * that whitespace and, when the comment is genuinely INLINE (non-
   * whitespace precedes it on its own source line, per
   * `blockCommentStartsOwnLine()`), consumes and returns its encoded
   * 0x4E buffer. Otherwise returns `undefined`.
   *
   * Callers that previously called `space()` again immediately after
   * consuming the comment (the And/Or-group sites) must still do so
   * themselves -- this helper does not, matching the header-trailing-
   * comment sites' own original behavior, which never had a trailing
   * `space()` call either.
   */
  const captureTrailingInlineComment = (): Buffer | undefined => {
    if (!/^[ \t]*\/\*/.test(source.slice(pos))) return undefined;
    space();
    if (source.startsWith('/*', pos) && !blockCommentStartsOwnLine()) {
      return inlineBlockComment();
    }
    return undefined;
  };

  /*
   * Compiler architecture: the trivia that may sit between a construct's
   * own core tokens and the structural boundary marker (0x2D/0x4F) that
   * follows it. Proven, corpus-wide, to be exactly ONE optional inline
   * comment for the Function/catch/When header closers (each fixed
   * independently earlier this session before this consolidation) -- NOT
   * a generalized "anything can precede a boundary" bag. A second trivia
   * kind must have its own corpus proof before being added here; do not
   * widen this type speculatively.
   */
  interface TrailingTrivia {
    readonly inlineComment?: Buffer;
  }

  const captureTrailingTrivia = (): TrailingTrivia => {
    const comments: Buffer[] = [];
    for (let comment = captureTrailingInlineComment(); comment !== undefined; comment = captureTrailingInlineComment()) {
      comments.push(comment);
    }
    return { inlineComment: comments.length > 0 ? Buffer.concat(comments) : undefined };
  };

  /*
   * Emits a construct's own TrailingTrivia (if any) immediately before
   * the structural boundary marker itself -- the inline comment, when
   * present, always renders BEFORE the marker, never after (proven
   * identically for End-Function/catch/When's own header closers). This
   * only replaces call sites already proven to share this EXACT shape
   * (trivia capture immediately followed by a bare marker push, nothing
   * else in between); a raw `chunks.push(Buffer.from([0x2d/0x4f]))` site
   * that has NOT been proven to accept a preceding inline comment must
   * not be routed through this function speculatively.
   */
  const emitBoundary = (trivia: TrailingTrivia, marker: 0x2d | 0x4f): void => {
    if (trivia.inlineComment !== undefined) {
      chunks.push(trivia.inlineComment);
    }
    chunks.push(Buffer.from([marker]));
  };

  /*
   * Compiler architecture: PeopleTools represents a vertical gap in
   * source (a run of blank formatting lines) as a run of 0x4F layout
   * markers -- one marker per BLANK line, not per newline. The first
   * newline in any captured gap is the ordinary line separator between
   * two real source items; only each ADDITIONAL newline is a genuine
   * blank line and contributes its own 0x4F.
   *
   * Proven identically at 36 independent call sites across every
   * statement handler in this file (Function/For/While/try/catch/
   * Evaluate/When bodies, top-level declaration/import sections, And/Or-
   * group operand gaps) -- this is the SAME semantic rule, not 36
   * coincidentally similar ones. Corpus evidence: AMM_DERIVED.AMM_CANCEL_M
   * (definition 942) and AMM_DERIVED.AMM_COLLAPSE_ALL (945) both prove
   * the rule scales with blank-line count ("two blank lines" -> two
   * 0x4F, not one); ADDRESSES.EMPLID.RowInit (518) and many other cited
   * definitions throughout this file corroborate it independently.
   *
   * This function intentionally does NOT decide WHETHER a gap counts --
   * every call site keeps its own guard (whether this position even
   * permits a blank-line marker at all is genuine per-construct logic:
   * `!firstForBodyItem`, `!justClosedImportSection`,
   * `sawTopLevelDeclaration`, etc.). It only answers, once a caller has
   * already decided a gap is real: how many 0x4F bytes is this specific
   * captured whitespace span worth.
   *
   * Cycle 113: the sites once documented as "always exactly one 0x4F
   * regardless of blank-line count" (before End-Evaluate, before a
   * When-body statement, after a For header) follow THIS rule -- their
   * single-marker evidence held only single blank lines. LOCAL SNAPSHOT:
   * before End-Evaluate the stored 0x4F count equals the source's blank
   * lines in every occurrence (393 programs; 6956 / 7000 two blank lines
   * -> `4F 4F 3F`); a When-body statement after two blank lines stores two
   * (5208, 5373); after a For header in every occurrence (745 programs;
   * 4950 `For ... <2 blank> &Emplid = ...` -> `2D 4F 4F 01`).
   */
  const emitBlankLineMarkers = (whitespace: string): void => {
    const markerCount = Math.max(
      1,
      (whitespace.match(/\r?\n/g) ?? []).length - 1
    );
    for (let marker = 0; marker < markerCount; marker++) {
      chunks.push(Buffer.from([0x4f]));
    }
  };

  /*
   * Sibling to `emitBlankLineMarkers` above -- same source-gap-to-marker-
   * count formula, but the resulting 0x4F markers are not written into
   * `chunks` immediately. Instead each marker's chunk-index position is
   * queued into `pendingReferenceGroupBoundaries` and resolved once,
   * at the end of the whole fragment, only if the fragment ultimately
   * contains a compiled PSPCMNAME reference (see that array's own
   * declaration comment and the `hasCompiledReferences` flush block).
   * A fragment with no compiled references drops every queued marker
   * here silently -- a real, corpus-proven PeopleTools rule (Compiler
   * Semantics Cycle 15's matched-control pair), not a simplified case
   * of `emitBlankLineMarkers`'s unconditional emission.
   *
   * Which specific gaps in a given body route through this deferred
   * mechanism versus the immediate one above, or get no marker handling
   * at all, differs by statement kind (Repeat/For/While/If each accrued
   * this coverage independently) -- this helper only centralizes the
   * producer-side mechanics already proven identical at all 14 existing
   * call sites; it does not change, or attempt to unify, which sites
   * call it.
   */
  const deferReferenceGatedMarkers = (whitespace: string): void => {
    const markerCount = Math.max(
      1,
      (whitespace.match(/\r?\n/g) ?? []).length - 1
    );
    for (let marker = 0; marker < markerCount; marker++) {
      pendingReferenceGroupBoundaries.push(chunks.length);
    }
  };

  const andExpression = () => {
    booleanUnary();
    space();

    if (!restStartsWithKeywordPastComments(/^And\b/i)) {
      return;
    }

    /*
     * An INLINE (same-line) comment between the first operand and the
     * group's first `And` still belongs to that operand's own token
     * stream, emitted BEFORE the group-open 0x41 -- the opposite order
     * from a STANDALONE (own-line) comment, which belongs to the group
     * itself and is emitted AFTER 0x41.
     *
     * BANKACCT_SBR.ACCOUNT_EC_ID.FieldFormula (definition 1411):
     *
     *   If %Component = "GPSC_BANK_ACC_FL" /*FLUID*\/ And
     *
     * stores `... "GPSC_BANK_ACC_FL" 4E<comment> 41 18(And) ...` -- the
     * inline comment directly after the string literal, THEN 0x41, THEN
     * `And`. Contrast HS_INJ_ILL_REHAB.HS_PNLGRP_ROUTE.Value's own-line
     * comment before `Or` (definition 6509), which stores
     * `... 41 24<comment> 1E(Or) ...` -- 0x41 first.
     */
    while (true) {
      const comment = captureTrailingInlineComment();
      if (comment === undefined) break;
      chunks.push(comment);
      space();
    }

    chunks.push(Buffer.from([0x41]));

    while (source.startsWith('/*', pos)) {
      chunks.push(blockCommentByPlacement());
      space();
    }

    while (restStartsWithKeywordPastComments(/^And\b/i)) {
      /*
       * A standalone/inline comment may likewise sit between a PRIOR
       * operand and a SUBSEQUENT `And` in the same multi-operand group
       * (not just before the group's first `And`, handled above) --
       * mirrored from that same check for this loop's own re-entry
       * condition. HS_INJ_WORK.CHECK_BOX.FieldChange (definition 6507)
       * proves this with a THREE-operand Or-chain where the comment sits
       * between the second and third operands, not the first and
       * second.
       */
      while (source.startsWith('/*', pos)) {
        chunks.push(blockCommentByPlacement());
        space();
      }

      pos += 3;
      chunks.push(fixed('And'));

      /*
       * A blank line may separate `And` from its next operand, inside a
       * multi-line boolean condition -- encoded the same blank-line 0x4F
       * marker way as every other calibrated boundary in this file, not
       * previously handled at all inside an And-group.
       *
       * BAS_PARTIC_PLAN.ANNUAL_PLEDGE.SaveEdit (definition 1643):
       *
       *   If None(&RSLT) And
       *
       *         All(&PLEDGE) Then
       *
       * stores one 0x4F between the `And` keyword and `All(&PLEDGE)`.
       */
      const operandWhitespaceStart = pos;
      space();
      const operandWhitespace = source.slice(operandWhitespaceStart, pos);
      if (/(?:\r?\n)[ \t]*(?:\r?\n)/.test(operandWhitespace)) {
        emitBlankLineMarkers(operandWhitespace);
      }

      booleanUnary();
      space();
    }

    /*
     * An INLINE (same-line) block comment may follow the last And-group
     * operand, before the group's closing 0x42 -- it still logically
     * hugs that operand. A comment starting its OWN line instead belongs
     * to whatever follows the closing 0x42 (e.g. ifStatement()'s own
     * comment-before-Then handling), not inside this group -- proven by
     * HS_INJ_ILL_REHAB.HS_PNLGRP_ROUTE.Value, whose own-line comment
     * before `Then` stores AFTER the Or-group's 0x42, not before it (see
     * booleanExpression's Or-group below for the original inline-only
     * calibrating fixture this narrows).
     */
    {
      const comment = captureTrailingInlineComment();
      if (comment !== undefined) {
        chunks.push(comment);
        space();
      }
    }

    chunks.push(Buffer.from([0x42]));
  };

  const booleanExpression = () => {
    andExpression();
    space();

    if (!restStartsWithKeywordPastComments(/^Or\b/i)) {
      return;
    }

    /*
     * See andExpression()'s identical check: an INLINE comment before
     * the group's first `Or` is emitted before the group-open 0x41; a
     * STANDALONE one is emitted after it.
     */
    while (true) {
      const comment = captureTrailingInlineComment();
      if (comment === undefined) break;
      chunks.push(comment);
      space();
    }

    chunks.push(Buffer.from([0x41]));

    while (source.startsWith('/*', pos)) {
      chunks.push(blockCommentByPlacement());
      space();
    }

    while (restStartsWithKeywordPastComments(/^Or\b/i)) {
      /*
       * See andExpression()'s identical re-entry check for a comment
       * between a prior operand and a SUBSEQUENT `Or` (definition 6507's
       * three-operand chain).
       */
      while (source.startsWith('/*', pos)) {
        chunks.push(blockCommentByPlacement());
        space();
      }

      pos += 2;
      chunks.push(fixed('Or'));

      /*
       * Mirrors andExpression()'s own blank-line-before-next-operand fix
       * (definition 1643) -- only the And-group shape was directly
       * evidenced, but the Or-group has the identical code shape and is
       * presumably subject to the same rule (same pattern fix #7 already
       * used for the inline-comment case just below).
       */
      const operandWhitespaceStart = pos;
      space();
      const operandWhitespace = source.slice(operandWhitespaceStart, pos);
      if (/(?:\r?\n)[ \t]*(?:\r?\n)/.test(operandWhitespace)) {
        emitBlankLineMarkers(operandWhitespace);
      }

      andExpression();
      space();
    }

    /*
     * An INLINE (same-line) block comment may follow the last Or-group
     * operand, before the group's closing 0x42 -- it still logically
     * hugs that operand. A comment starting its OWN line instead belongs
     * to whatever follows the closing 0x42, not inside this group.
     *
     * BANKACCT_SBR.ACCOUNT_EC_ID.FieldFormula (definition 1406):
     *
     *   If (%Component = Component.PYE_BANKACCT Or
     *         %Component = "GPSC_BANK_ACC_FL" /*FLUID*\/) And
     *
     * stores the inline 0x4E comment immediately before the Or-group's
     * closing 0x42, not after it (same line as the last operand).
     * HS_INJ_ILL_REHAB.HS_PNLGRP_ROUTE.Value's own-line comment before
     * `Then` instead stores AFTER the Or-group's 0x42 (picked up by
     * ifStatement()'s own comment-before-Then handling), proving the
     * own-line case must NOT be consumed here.
     */
    {
      const comment = captureTrailingInlineComment();
      if (comment !== undefined) {
        chunks.push(comment);
        space();
      }
    }

    chunks.push(Buffer.from([0x42]));
  };

  const comparisonExpression = () => {
    expression();
    space();

    /*
     * `Not =` / `Not >` (a space-separated `Not` immediately before an
     * ordinary comparison operator) compile as two literal, separate
     * tokens -- `Not` (0x1d) directly followed by the operator's own
     * punctuation opcode (`=` is 0x06, `>` is 0x09) -- never translated
     * into a single combined opcode (e.g. `<>` is a genuinely distinct
     * single opcode, 0x10, not just an alternate rendering of `Not =`).
     * Only `=` and `>` are attested in the corpus after `Not`; `<`,
     * `<=`, `>=`, `<>` never appear there.
     *
     * PAY_LINE.BENEFIT_PROGRAM.FieldEdit (definition 23620):
     *
     *   If &BEN_SYSTEM Not = "BA" And
     *         &BEN_SYSTEM Not = "BN" And
     *         None(PAY_LINE.BENEFIT_PROGRAM) Then
     *
     * PI_DEFN_RECORD.EFFDT.SavePreChange (definition 11267, one of 11
     * corpus occurrences of `Not >`):
     *
     *   If &recCount Not > 1 Then
     */
    const notOperator =
      /^Not\s*([=>])/i.exec(source.slice(pos));

    if (notOperator) {
      pos += 3;
      chunks.push(fixed('Not'));
      space();
      pos += 1;
      chunks.push(fixed(notOperator[1]));
      expression();
      return;
    }

    const operator =
      /^(<>|<=|>=|=|<|>)/.exec(source.slice(pos))?.[0];

    if (!operator) {
      return;
    }

    pos += operator.length;
    chunks.push(fixed(operator));

    expression();
  };
  const parenthesized = (body: () => void, allowEmpty: boolean) => {
    if (source[pos] !== '(') fail('expected (');
    if (depth >= MAX_EXPRESSION_DEPTH) fail(`expression nesting exceeds ${MAX_EXPRESSION_DEPTH}`);
    depth++;
    pos++;
    chunks.push(fixed('('));
    space();
    if (!allowEmpty || source[pos] !== ')') body();
    space();

    /*
     * An inline block comment may sit between the last parenthesized
     * token and the closing ")", encoded the same same-line 0x4E way as
     * any other inline trailing comment.
     *
     * BANKACCT_SBR.ACCOUNT_EC_ID.FieldFormula (definition 1406):
     *
     *   If (%Component = Component.PYE_BANKACCT Or
     *         %Component = "GPSC_BANK_ACC_FL" /*FLUID*\/) And
     *
     * stores ... 4E 12 00 "/*FLUID*\/" 42 ... immediately before the ")".
     */
    if (source.startsWith('/*', pos)) {
      chunks.push(inlineBlockComment());
      space();
    }

    if (source[pos] !== ')') fail('expected )');
    pos++;
    chunks.push(fixed(')'));
    depth--;
  };
  
  const declareFunction = () => {
    chunks.push(Buffer.from([0x31]));

    space();
    if (!word('Function')) {
      throw new UnsupportedPeopleCodeError(pos, 'expected Function after Declare');
    }
    chunks.push(fixed('Function'));

    space();
    const name = /^[A-Za-z_][A-Za-z0-9_]*#?/.exec(source.slice(pos))?.[0];
    if (name === undefined) {
      throw new UnsupportedPeopleCodeError(pos, 'expected declared Function name');
    }
    pos += name.length;
    chunks.push(textOperand(INLINE_IDENTIFIER_OPCODE, TokenKind.Name, name));

    space();
    if (!word('PeopleCode')) {
      throw new UnsupportedPeopleCodeError(pos, 'expected PeopleCode in Declare Function');
    }
    chunks.push(Buffer.from([0x3a]));

    space();
    const recordName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (recordName === undefined) {
      throw new UnsupportedPeopleCodeError(pos, 'expected record name in Declare Function PeopleCode target');
    }
    pos += recordName.length;

    if (source[pos] !== '.') {
      throw new UnsupportedPeopleCodeError(pos, 'expected . in Declare Function PeopleCode target');
    }
    pos++;

    const fieldName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
    if (fieldName === undefined) {
      throw new UnsupportedPeopleCodeError(pos, 'expected field name in Declare Function PeopleCode target');
    }
    pos += fieldName.length;

    space();
    const eventName = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(pos))?.[0];
    if (eventName === undefined) {
      throw new UnsupportedPeopleCodeError(pos, 'expected event name in Declare Function');
    }
    pos += eventName.length;

    let reference: PeopleCodeReference | undefined =
      same(ownerReference.recordName, recordName) &&
      same(ownerReference.fieldName, fieldName)
        ? ownerReference
        : undefined;

    /*
     * Cycle 99: the reusable row is keyed by REC.FIELD alone. Stored gives
     * every Declare Function target one PSPCMNAME row for the whole program
     * whatever the event: across all 14,094 stored Declare Function operands
     * (7,694 ordinary programs), two declarations of the same REC.FIELD share
     * a row in every pair (13,926) and different REC.FIELD targets never do
     * (15,944) -- including 339 pairs with DIFFERENT events (e.g. 6270:
     * FieldFormula and FieldChange of FUNCLIB_HR.NEW_COMPRATE). Keying on the
     * event as well opened a second row in 37 aligned occurrences. The event
     * is still written into the program (0x40 keyword below).
     */
    reference ??= references.find(
      item =>
        item.kind === 'declare-function' &&
        same(item.recordName, recordName) &&
        same(item.fieldName, fieldName)
    );

    if (reference === undefined) {
      reference = nextReference({
        kind: 'declare-function',
        recordName,
        fieldName,
        eventName
      });
    }

    chunks.push(referenceOperand(reference));
    chunks.push(textOperand(0x40, TokenKind.Keyword, eventName));
    chunks.push(Buffer.from([0x42]));
  };

  const importStatement = () => {
    // `import` is 0x58 in the calibrated Application Class fixture.
    chunks.push(Buffer.from([0x58]));

    space();

    /*
    * Application Class wildcard imports have two distinct effects:
    *
    *   1. every wildcard import participates in package/class resolution;
    *   2. only the first wildcard import contributes the blank-REFNAME
    *      PACKAGE metadata row.
    *
    * Cycle 33 controls:
    *
    *   28801
    *   28802
    *   29087
    *   29134
    *   29191
    *
    * show that subsequent wildcard imports remain semantically active but do
    * not consume additional PSPCMNAME identities merely because the import
    * declaration exists. Concrete classes subsequently resolved through those
    * wildcard namespaces still allocate their normal PACKAGE dependencies.
    *
    * Preserve the pre-import state because sawWildcardImport also describes
    * the compilation unit's resolution environment after this statement.
    */

    const appClass = applicationClassPath({ allowWildcard: true });
    if (appClass.wildcard) sawWildcardImport = true;
    chunks.push(appClass.bytes);
    /*
     * Cycle 106: an import rooted at `%metadata` contributes no PSPCMNAME
     * row -- neither a named import's class row nor a wildcard's blank
     * metadata row -- and its wildcard does not take the one-time "first
     * wildcard claims the metadata row" (Cycle 93): the first ORDINARY
     * wildcard still claims it. The import stays part of the resolution
     * environment (`sawWildcardImport` above); the class gets its rows from
     * its uses, under the ordinary unit rules. LOCAL SNAPSHOT
     * (`cycle106-metadata-import-census.ts`, 37 definitions with
     * `%metadata` imports): programs whose wildcards are all `%metadata`
     * store no blank row (11 / 11); mixed programs with a `%metadata`
     * wildcard first still store one (7 / 7); a named `%metadata` import of
     * a class used nowhere else stores no row (3 / 3) while ordinary ones do
     * (301 / 301). 28726: `import %metadata:*; import
     * %metadata:RecordDefn:*; import %metadata:AppDataSetMgr:*;` -- no blank
     * row; APPDATASETMGR / KEY / APPDATASETMGR_MANAGER at their declarations.
     */
    if (/^%metadata$/i.test([...appClass.packagePath, appClass.className][0] ?? '')) {
      return;
    }


    /*
    * Import itself may establish one PSPCMNAME PACKAGE dependency row.
    *
    * Ordinary class import:
    *
    *   import ROOT:Path:Class;
    *
    * => PACKAGE row for Class.
    *
    * First wildcard import:
    *
    *   import ROOT:Path:Leaf:*;
    *
    * => PACKAGE row with blank REFNAME, PACKAGEROOT=ROOT and
    *    QUALIFYPATH=Path:Leaf.
    *
    * Later wildcard imports extend the wildcard resolution environment but do
    * not independently allocate another blank-REFNAME PACKAGE row.
    *
    * The reference is metadata-only here; the executable stream contains
    * the 0x58/.../0x57/0x59 import bytes rather than a 0x21 operand.
    */
    if (appClass.wildcard) {
      /*
      * Application Class imports are emitted as independent encoder fragments,
      * but PSPCMNAME wildcard-import metadata is scoped to the whole
      * compilation unit.
      *
      * The shared ApplicationClassReferenceSession therefore owns the
      * "first wildcard import" decision. Ordinary fragment encoding retains
      * the existing fragment-local behavior.
      *
      * Cycle 61: "only the first wildcard import claims the metadata row"
      * is a purely mechanical, source-derived tracking concern -- it has
      * nothing to do with the method-dependency-resolution uncertainty
      * `applicationClassReferenceSession`'s own gate exists for (Cycle
      * 32/34). When that session is gated off (an inherited %This.method()
      * call elsewhere in the class), this call previously fell back to
      * `true` unconditionally -- meaning EVERY wildcard import in the
      * class's leading fragment claimed the row, not just the first. A
      * corpus-wide census of 28 Application Class definitions with an
      * inherited %This call AND 2+ wildcard imports found stored PSPCMNAME
      * has exactly the ordinary "one claim" row count in 27/28 (28726 is a
      * distinct, unrelated residual -- stored has ZERO blank rows for it,
      * a different gap this fix does not address). Use the always-present
      * `applicationClassTypeReferenceSession` (Cycle 57) instead, which
      * shares the SAME underlying `ApplicationClassReferenceScope`
      * instance and its claim-tracking state -- not a new cache.
      */
      /*
       * Cycle 93: the same single claim holds for ORDINARY programs, which
       * encode the whole compilation unit in this one call. LOCAL SNAPSHOT
       * census (`cycle93-wildcard-import-census.ts`): every one of the
       * 1,556 definitions with a wildcard import stores exactly ONE
       * blank-REFNAME PACKAGE row, at the first wildcard import --
       * including all 125 ordinary programs with two or more wildcard
       * imports (5495: `import GVT_PAR_UTILITIES:*; import
       * GVT_WIP_UTILITIES:*;` stores one blank row at NAMENUM 2). The
       * previous unconditional `true` allocated one row per wildcard
       * import; 109 generated PSPCMNAME lists move closer to stored and 0
       * farther.
       */
      const allocateWildcardMetadata =
        context?.applicationClassTypeReferenceSession !== undefined
          ? context.applicationClassTypeReferenceSession.claimWildcardImportMetadata()
          : context?.externalMetadataWildcardClaims
            ? true
            : !claimedWildcardImportMetadata;
      claimedWildcardImportMetadata = true;

      if (allocateWildcardMetadata) {
        const fullPath = [
          ...appClass.packagePath,
          appClass.className
        ];

        nextReference({
          kind: 'package',
          packageName: '',
          objectName: fullPath[0]?.toUpperCase(),
          packagePath: fullPath.map(
            (component, index) =>
              index === 0 ? component.toUpperCase() : component
          ),
          className: ''
        });
      }
    } else {
      /*
       * Cycle 122: in an ordinary program a named import whose leaf class
       * name already has a row in the unit opens none -- 22665 imports
       * `GPS_WFS_REPORT_MANAGER:ReportManager` and
       * `GPS_CAR_REPORT_MANAGER:ReportManager` and stores one REPORTMANAGER
       * row (the first), 19155 imports one class twice and stores one row.
       */
      const sameLeafRow = unitScopedClassRows
        ? classRowsByUnit.get(applicationClassKey(appClass.packagePath, appClass.className))
        : undefined;
      const imported = sameLeafRow !== undefined && sameLeafRow.unit === allocationUnit
        ? sameLeafRow.reference
        : addApplicationClassReference(
          appClass.packagePath,
          appClass.className
        );
      if (unitScopedClassRows) {
        // Cycle 94: an import always opens its row; the leading unit's
        // later uses of the class find it.
        classRowsByUnit.set(
          applicationClassKey(appClass.packagePath, appClass.className),
          { unit: allocationUnit, reference: imported }
        );
      }
    }
  };

  /*
   * Non-consuming structural lookahead for the statement dispatcher.
   * It distinguishes a real call-result property assignment such as
   * `GetPageField(..., "EDIT").Label = value` from a plain call whose
   * string argument contains JavaScript like
   * `getElementById(...).style.visibility = ...`. A regex cannot tell the
   * source-level postfix chain from the lookalike text inside the string.
   */
  const balancedLookaheadEnd = (
    start: number,
    open: '(' | '[',
    close: ')' | ']'
  ): number => {
    if (source[start] !== open) return -1;

    let depth = 0;
    let peek = start;
    while (peek < source.length) {
      if (source[peek] === '"') {
        peek++;
        while (peek < source.length) {
          if (source[peek] !== '"') {
            peek++;
            continue;
          }
          if (source[peek + 1] === '"') {
            peek += 2;
            continue;
          }
          peek++;
          break;
        }
        continue;
      }

      if (source.startsWith('/*', peek)) {
        const commentEnd = source.indexOf('*/', peek + 2);
        if (commentEnd < 0) return -1;
        peek = commentEnd + 2;
        continue;
      }

      if (source[peek] === open) depth++;
      if (source[peek] === close) {
        depth--;
        if (depth === 0) return peek + 1;
      }
      peek++;
    }

    return -1;
  };

  const startsCallResultPropertyAssignment = (start: number): boolean => {
    const callName = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(start))?.[0];
    if (callName === undefined) return false;

    let peek = start + callName.length;
    while (/\s/.test(source[peek] ?? '')) peek++;
    peek = balancedLookaheadEnd(peek, '(', ')');
    if (peek < 0) return false;

    let sawMember = false;
    while (true) {
      while (/\s/.test(source[peek] ?? '')) peek++;

      if (source[peek] === '.') {
        peek++;
        while (/\s/.test(source[peek] ?? '')) peek++;
        const member = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(peek))?.[0];
        if (member === undefined) return false;
        sawMember = true;
        peek += member.length;
        while (/\s/.test(source[peek] ?? '')) peek++;
        if (source[peek] === '(') {
          peek = balancedLookaheadEnd(peek, '(', ')');
          if (peek < 0) return false;
        }
        continue;
      }

      if (source[peek] === '(') {
        peek = balancedLookaheadEnd(peek, '(', ')');
        if (peek < 0) return false;
        continue;
      }

      if (source[peek] === '[') {
        peek = balancedLookaheadEnd(peek, '[', ']');
        if (peek < 0) return false;
        continue;
      }

      break;
    }

    while (/\s/.test(source[peek] ?? '')) peek++;
    return sawMember && source[peek] === '=';
  };

  function statement(): void {
    /*
     * Cycle 114: the empty statement. A `;` where a statement starts is a
     * statement with no tokens; the caller's own terminator path writes
     * its 0x15, so every statement list -- If / Else, While, Repeat,
     * When / When-Other, try / catch, Function and method bodies --
     * accepts it with that list's blank-line and comment handling intact.
     * Each `;` is one statement: `;;` stores `15 15`, `;;;` `15 15 15`.
     *
     * LOCAL SNAPSHOT: 309 standalone semicolons in 216 programs; in every
     * one the stored stream holds one 0x15 per empty statement at the
     * source position -- directly after the previous 0x15 when on the same
     * line (5061 `... ".pdf";;` -> `15 15`), after an intervening comment
     * (14641 `...; /* bugdb 12896908 *\/;` -> `15 4E 15`; 29570 `rem;;` ->
     * `24 "rem;" 15`), first in a body (9136 `Else /* ... *\/;`). It is an
     * executable statement: a Function body's empty statement enters the
     * executable section (3219 `Function ... Returns boolean;; <blank>
     * If` keeps the If's 0x4F). No reference list in the corpus
     * distinguishes whether it also opens a reference / allocation unit.
     */
    if (source[pos] === ';') return;
    currentStatementRecordFields.clear();
    recordReferencesWithinCurrentStatement.clear();
    /*
     * Field-method SetDefault is a reference-allocation boundary.
     *
     * Calibrated by ABS_HIST_UK_SBR.SMP_MA_ELIG.FieldFormula:
     *
     *   ABSENCE_HIST.SMP_MA_ELIG.DisplayOnly = True;
     *   ABSENCE_HIST.SMP_MA_ELIG.SetDefault();
     *   ABSENCE_HIST.DT_BOOKING_NOTICE.SetDefault();
     *   ...
     *
     * PeopleTools allocates a new PSPCMNAME row for the first
     * SMP_MA_ELIG.SetDefault() even though the same RECORD.FIELD was just
     * referenced by DisplayOnly. Consecutive field SetDefault() calls remain
     * in the same allocation group.
     *
     * Keep this scoped to controlDepth === 0; statements inside If/Evaluate
     * already receive allocation scoping from inControlGroup().
     */
    if (controlDepth === 0) {
      const startsRecordFieldSetDefault =
        /^[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*\.\s*SetDefault\s*\(/i
          .test(source.slice(pos));

      if (startsRecordFieldSetDefault) {
        if (!inTopLevelRecordFieldSetDefaultRun) {
          controlGroup = nextControlGroup++;
          inTopLevelRecordFieldSetDefaultRun = true;
        }
      } else {
        inTopLevelRecordFieldSetDefaultRun = false;
      }
    }

    if (applicationClassBody) {
      /*
       * Cycle 109: a Local of an Application Class body shadows a declared
       * variable of the same name (`applicationClassDeclaredVariables`).
       */
      const localNames = /^Local\s+(?:array\s+of\s+)*[%A-Za-z_][\w:]*\s+(&[A-Za-z0-9_]+#?(?:\s*,\s*&[A-Za-z0-9_]+#?)*)/i.exec(source.slice(pos));
      for (const name of localNames?.[1].split(',') ?? []) {
        applicationClassArrayVariables.delete(name.trim().toLowerCase());
        applicationClassVariables.delete(name.trim().toLowerCase());
        // Cycle 120: and a Record declared outside the body (a Local Record re-adds it)
        if (context?.applicationClassDeclaredBuiltinVariables?.has(name.trim().toLowerCase())) recordVariables.delete(name.trim().toLowerCase());
      }
    }
    if (unitScopedClassRows || applicationClassBody) {
      const arrayDeclaration =
        /^(?:Local|Global|ComponentLife|Component)\s+((?:array\s+of\s+)+)([A-Za-z_][A-Za-z0-9_]*(?:\s*:\s*[A-Za-z_][A-Za-z0-9_]*)+)\s+(&[A-Za-z0-9_]+#?(?:\s*,\s*&[A-Za-z0-9_]+#?)*)/i
          .exec(source.slice(pos));
      if (arrayDeclaration) {
        const components = arrayDeclaration[2].split(':').map(component => component.trim());
        const depth = (arrayDeclaration[1].match(/array/gi) ?? []).length;
        for (const name of arrayDeclaration[3].split(',')) {
          applicationClassArrayVariables.set(name.trim().toLowerCase(), {
            packagePath: components.slice(0, -1),
            className: components.at(-1)!,
            depth
          });
        }
      }
    }

    if (source.startsWith('/*', pos)) {
      chunks.push(blockComment());
    } else if (word('import')) {
      importStatement();
    } else if (word('Declare')) {
      declareFunction();
    } else if (word('Function')) {
      functionStatement();
    } else if (word('Local')) {
      localDeclaration();
    } else if (word('Global')) {
      globalDeclaration();
    } else if (word('PanelGroup')) {
      panelGroupDeclaration();
    } else if (word('ComponentLife')) {
      componentLifeDeclaration();
    } else if (word('Component')) {
      componentDeclaration();
    } else if (word('Constant')) {
      constantDeclaration();
    } else if (word('Return')) {
      chunks.push(fixed('Return'));
      space();
      if (source[pos] !== ';') expression();
    } else if (word('If')) {
      inControlGroup(ifStatement);
    } else if (word('While')) {
      inControlGroup(whileStatement);
    } else if (word('For')) {
      inControlGroup(forStatement);
    } else if (word('Repeat')) {
      inControlGroup(repeatStatement);
    } else if (word('try')) {
      tryStatement();
    } else if (word('throw')) {
      throwStatement();

    } else if (word('Break')) {
      chunks.push(fixed('Break'));

    } else if (word('Exit')) {
      chunks.push(fixed('Exit'));
      const afterExit = pos;
      space();
      if (source[pos] === '(') {
        parenthesized(expression, false);
      } else if (/^-?\d/.test(source.slice(pos))) {
        /*
         * `Exit N;` (a bare numeric literal, no parentheses) is a
         * distinct, unparenthesized alternative to `Exit(N);`.
         *
         * ACA_EXTRACT_AET.<various>.FieldFormula (definition 25166, one
         * of 197 corpus occurrences of this exact shape):
         *
         *   If ... Then
         *      Exit 1;
         *   End-If;
         */
        expression();
      } else {
        pos = afterExit;
      }

    } else if (word('Continue')) {
      /*
       * `Continue` is not in the general OPCODES table: 0x6E is heavily
       * overloaded corpus-wide with unrelated byte values outside this
       * exact grammatical position (see decoder.ts's gated `opcode ===
       * 0x6e && bytes[i] === 0x15` handling), so `fixed('Continue')` has
       * no unambiguous entry to find. The encoder already knows the
       * source keyword is literally `Continue` here -- unlike the
       * decoder, which has to infer intent from a raw byte -- so 0x6E can
       * be emitted directly with no ambiguity.
       * Continue is the context-gated 0x6E statement opcode. It stays out
       * of the general fixed-token table because 0x6E is overloaded outside
       * the `Continue;` shape, but the encoder is already inside a parsed
       * Continue statement here and can select it unambiguously.
       *
       * PRCSRUNCNTL_WRK.<fields> (definitions 14194-14196) independently
       * store `Else Continue;` as 0x19 0x6E 0x15.
       */
      chunks.push(Buffer.from([0x6e]));

    } else if (word('Error')) {
      chunks.push(fixed('Error'));
      space();
      expression();

    } else if (word('Warning')) {
      chunks.push(fixed('Warning'));
      space();
      expression();

    } else if (word('Evaluate')) {
      inControlGroup(evaluateStatement);

    } else if (
      source[pos] === '&' ||
      source[pos] === '@' ||
      source[pos] === '%'
    ) {
      // A variable-led statement may be either an assignment:
      //
      //   &x = value;
      //   &fld.Value = value;
      //
      // or a method-call statement:
      //
      //   &fld.ClearDropDownList();
      //
      // primary() consumes the complete variable/member/call chain.
      const statementVariable =
        /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
      primary();
      space();

      if (source[pos] === '=') {
        pos++;

        const assignedLevel0Rowset =
          /^\s*GetLevel0\s*\(\s*\)\s*\(\s*[^)]*\)\s*\.\s*GetRowset\s*\(\s*Scroll\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/i
            .exec(source.slice(pos));
        if (
          statementVariable !== undefined &&
          rowsetVariables.has(statementVariable.toLowerCase())
        ) {
          if (assignedLevel0Rowset !== null) {
            rowsetRecordNamesByVariable.set(
              statementVariable.toLowerCase(),
              assignedLevel0Rowset[1]
            );
          } else {
            rowsetRecordNamesByVariable.delete(statementVariable.toLowerCase());
          }
        }

        // Cycle 6, diagnostic-only: see schemaBoundVariables's own
        // declaration comment. Deliberately NOT scoped to
        // rowsetVariables/recordVariables -- this specifically tracks the
        // UNDECLARED case.
        if (statementVariable !== undefined) {
          if (/^\s*CreateRowset\s*\(\s*Record\s*\./i.test(source.slice(pos))) {
            schemaBoundVariables.add(statementVariable.toLowerCase());
          } else {
            schemaBoundVariables.delete(statementVariable.toLowerCase());
          }
        }

        /*
         * A top-level CreateRecord assignment starts a new ordinary
         * RECORD.FIELD reference-allocation group.
         *
         * Calibrated by ABSV_REQUEST.ABSV_APPROVED_FLG.SavePostChange:
         *
         *   &REC1 = CreateRecord(Record.ABSENCE_HIST);
         *   &REC1.emplid.value = ABSV_REQUEST.EMPLID;
         *   ...
         *   &REC2 = CreateRecord(Record.ABSENCE_HIST);
         *   &REC2.emplid.value = ABSV_REQUEST.EMPLID;
         *
         * PeopleTools allocates a fresh PSPCMNAME row for the second
         * ABSV_REQUEST.EMPLID instead of reusing the row from the REC1
         * construction block. Control-structure groups already get their
         * own allocation scope through inControlGroup(), so keep this rule
         * deliberately limited to top-level CreateRecord assignments.
         */
        const assignsCreateRecord =
          /^\s*CreateRecord\b/i.test(source.slice(pos));

        if (assignsCreateRecord && controlDepth === 0) {
          controlGroup = nextControlGroup++;
        }

        if (
          statementVariable !== undefined &&
          recordVariables.has(statementVariable.toLowerCase()) &&
          assignsCreateRecord &&
          !resetRecordVariableFields.has(statementVariable.toLowerCase())
        ) {
          const prefix = `${statementVariable.toLowerCase()}:`;
          let clearedField = false;
          for (const key of recordVariableFields.keys()) {
            if (key.startsWith(prefix)) {
              recordVariableFields.delete(key);
              clearedField = true;
            }
          }
          if (clearedField) {
            resetRecordVariableFields.add(statementVariable.toLowerCase());
          }
        }
        chunks.push(fixed('='));

        const previousCreateRecordAssignmentTarget =
          createRecordAssignmentTarget;

        if (
          assignsCreateRecord &&
          statementVariable !== undefined &&
          recordVariables.has(statementVariable.toLowerCase())
        ) {
          createRecordAssignmentTarget = statementVariable;
        } else {
          createRecordAssignmentTarget = undefined;
        }

        try {
          expression();
        } finally {
          createRecordAssignmentTarget =
            previousCreateRecordAssignmentTarget;
        }
      }
      /*
       * A variable-led method-call statement (e.g. `&RS.DeleteRow(&i)`)
       * may itself omit its trailing source semicolon under the same
       * conditions a bare (non-variable-led) call statement already can
       * -- primary() has already consumed the complete chain above; the
       * caller's own body-terminator check (e.g. `expected ; in For
       * body`, which already allows omission immediately before
       * `End-For`) decides whether the omission is legal here, exactly
       * as it does for the bare-call statement branch below.
       *
       * GPMY_RC_RCPT_FL.GPMY_RCPNT_OPTN.FieldFormula (definition 9256):
       *
       *   For &i = &RS.ActiveRowCount To 1 Step - 1
       *      &RS.DeleteRow(&i)
       *   End-For
       */
    } else if (/[A-Za-z_]/.test(source[pos] ?? '')) {
      const tail = source.slice(pos);
      if (/^Record\s*\./i.test(tail)) {
        const statementStart = pos;
        primary();
        const endsWithMethodCall = /\)\s*$/.test(
          source.slice(statementStart, pos)
        );
        space();
        if (source[pos] === '=') {
          pos++;
          chunks.push(fixed('='));
          expression();
        } else if (!endsWithMethodCall) {
          fail('expected = after explicit Record field chain');
        }
      } else if (/^[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*/.test(tail)) {
        chunks.push(ordinaryRecordFieldReference());
        let sawMethodCall = false;

        // Calibrated postfix member chain, e.g. OU_CORPUS.CODE.Value.
        while (true) {
          space();
          if (source[pos] !== '.') break;
          pos++;
          chunks.push(fixed('.'));
          space();
          const member = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
          if (member === undefined) {
            throw new UnsupportedPeopleCodeError(pos, 'expected member name after .');
          }
          pos += member.length;
          chunks.push(textOperand(INLINE_IDENTIFIER_OPCODE, TokenKind.Name, member));
          space();
          if (source[pos] === '(') {
            sawMethodCall = true;
            parenthesized(() => {
              space();
              if (source[pos] === ')') return;
              expression();
              space();
              while (source[pos] === ',') {
                pos++;
                chunks.push(fixed(','));
                expression();
                space();
              }
            }, true);
          }
        }

        space();
        if (sawMethodCall && source[pos] === ';') {
          return;
        }
        //if (source[pos] !== '=') fail('expected assignment =');
        if (source[pos] !== '=') {
          fail(
            `expected assignment = [DOTTED-STMT] ` +
            `next=${JSON.stringify(source.slice(pos, pos + 80))} ` +
            `previous=${JSON.stringify(source.slice(Math.max(0, pos - 80), pos))}`
          );
        }
        pos++;
        chunks.push(fixed('='));
        expression();
      } else if (startsCallResultPropertyAssignment(pos)) {
        /*
         * A call-result property chain may traverse more than one dotted
         * member before the assigned property, e.g.
         * `GetRecord().GPS_BDG_ORG2.SqlText = ExpandSqlBinds(...);`
         * (definition 9989 and 25 other corpus occurrences) --
         * `GetRecord()` then RECORD member `GPS_BDG_ORG2` then FIELD
         * member `SqlText`, not just the single-member
         * `Name(args).Property =` shape this branch originally matched.
         * primary() already walks an arbitrarily long postfix chain.
         */
        primary();
        space();
        if (source[pos] !== '=') {
          fail('expected assignment = after call-result property');
        }
        pos++;
        chunks.push(fixed('='));
        expression();
      } else {
        /*
         * A bare call statement may itself be the head of a postfix
         * chain rather than a standalone call, e.g. a call-result
         * indexed and then invoked further:
         *
         *   GetLevel0()(1).GetRowset(Scroll.PSIBDOMSTATUSVW).Flush();
         *
         * Plain call() only consumes "Name(args)" and returns, leaving
         * the rest of the chain unconsumed and the statement failing its
         * trailing ";" check. primary() consumes the complete call/
         * member/index chain (it already handles the plain "Name(args);"
         * case identically, via the same call() internally), matching
         * the call-result-property-assignment branch just above.
         *
         * AMM_DERIVED.IB_SAVE_PB.FieldChange (definition 984).
         */
        primary();
      }
    } else if (source[pos] === '(' && groupedExpressionStatementFollows(pos)) {
      /*
       * Cycle 116: a statement may start with a parenthesized (grouped)
       * expression continued by a postfix chain -- 56 of the 73 corpus
       * occurrences are `(create PKG:Class()).Method(...);`
       * (`cycle116-grouped-expression-census.ts`). Stored writes the group
       * as the ordinary 0x0B `(` ... 0x14 `)` expression bytes and the
       * chain after it as any postfix chain (5857
       * `0B 69 <class path> 0B 14 14 05 0A "doSignOut" 0B 14 15`); there
       * is no grouping opcode. primary() already parses a parenthesized
       * primary and continues its postfix loop after it. A group with
       * no postfix step (`(&a + &b);`) has no corpus evidence and stays
       * unsupported.
       */
      primary();
      space();
      if (source[pos] === '=') {
        pos++;
        chunks.push(fixed('='));
        expression();
      }
    } else {
      fail('unsupported PeopleCode statement');
    }
  };

  /**
   * Cycle 116: true when the `(` at `start` opens a group directly followed
   * by a postfix step (`.` or `[`). Strings and comments inside the group
   * are skipped.
   */
  function groupedExpressionStatementFollows(start: number): boolean {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
      const c = source[i];
      if (c === '"') {
        i++;
        while (i < source.length && !(source[i] === '"' && source[i + 1] !== '"')) i += source[i] === '"' ? 2 : 1;
      } else if (source.startsWith('/*', i)) {
        const end = source.indexOf('*/', i + 2);
        if (end < 0) return false;
        i = end + 1;
      } else if (c === '(') {
        depth++;
      } else if (c === ')' && --depth === 0) {
        return /^\s*[.[]/.test(source.slice(i + 1));
      }
    }
    return false;
  }

  function functionStatement(): void {
    chunks.push(fixed('Function'));

    space();

    const nameMatch =
      /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));

    if (!nameMatch) {
      return fail('expected Function name');
    }

    const name = nameMatch[0];
    pos += name.length;

    chunks.push(
      textOperand(
        INLINE_IDENTIFIER_OPCODE,
        TokenKind.Name,
        name
      )
    );

    const afterNameWhitespaceStart = pos;
    space();
    const afterNameWhitespace = source.slice(afterNameWhitespaceStart, pos);

    // Parameters
    if (source[pos] === '(') parenthesized(() => {
      space();

      if (source[pos] === ')') {
        return;
      }

      while (true) {
        const paramName =
          /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
        chunks.push(variable());

        const afterVariable = pos;
        space();

        /*
         * Function parameters may be typed:
         *
         *   &value As string
         *
         * or untyped:
         *
         *   &EMPLID
         *
         * The latter is confirmed by
         * ACCOMPLISHMENTS.MAJOR_CODE.SaveEdit.
         */
        if (word('As')) {
          chunks.push(fixed('As'));

          space();
          if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(source.slice(pos))) {
            const parameterClass = applicationClassPath();
            chunks.push(parameterClass.bytes);
            /*
             * Cycle 94: an Application-Class-typed parameter uses its
             * class in the header's unit and is a method-call receiver in
             * the body (14356: a named-import parameter type of the first
             * Function allocates nothing -- the header is still in the
             * leading unit; 19 lists closer, the 2 farther are programs
             * that now fall under the external-metadata fallback).
             */
            if (unitScopedClassRows) {
              useApplicationClassRow(parameterClass.packagePath, parameterClass.className);
              if (paramName !== undefined) {
                pendingParameterReceivers.push({
                  name: paramName,
                  packagePath: parameterClass.packagePath,
                  className: parameterClass.className
                });
              }
            }
          } else {
            const isArrayType = /^array\b/i.test(source.slice(pos));
            const paramType =
              /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
            chunks.push(typeName());
            if (isArrayType) {
              arrayElementTypes();
            } else if (paramName !== undefined && /^(?:Record|Row|Rowset)$/i.test(paramType ?? '')) {
              /*
               * `Record`/`Row`/`Rowset`-typed Function PARAMETERS need the
               * same declaration-tracking a `Local Record|Row|Rowset &var;`
               * already gets -- see `registerTypedParameter`'s own
               * declaration comment for the full Record/Row/Rowset
               * evidence (definitions 921/924 for Row; 29522 and 265
               * corpus definitions for Record; Cycle 7's 48-definition
               * Rowset population, which is why Rowset deliberately joins
               * ONLY `chainSemanticsDeclaredRowsetVariables`, not
               * `rowsetVariables`/`ensureLocalObjectPackageReference` --
               * that broader treatment regressed already-EXACT
               * definitions). Cycle 46 reuses this exact same helper to
               * seed an Application Class method implementation's own
               * parameter list into its body fragment -- see
               * `EncodeFragmentContext.methodParameters`'s own comment.
               */
              registerTypedParameter(paramName, paramType!);
            } else if (paramType !== undefined && !/^(?:Record|Row|Rowset)$/i.test(paramType)) {
              /*
               * Compiler architecture: File (definitions 7499/7500,
               * 48/53-candidate census), SQL (8-candidate), ApiObject
               * (65-candidate), Grid (8-candidate), Message (207-
               * candidate, this project's single largest population),
               * and Field (122-candidate, after excluding 4 false leads
               * -- 2 comment-only, 2 an unrelated `value As Field`
               * runtime type-check expression) are all a plain PACKAGE
               * allocation with NO other side effect, unlike Record/Row/
               * Rowset above (which also need `registerTypedParameter`'s
               * own variable-set tracking) -- so these route through the
               * shared registry instead. Every citation's own corpus
               * population size is preserved in `BUILTIN_TYPE_REGISTRY`'s
               * own history for these types.
               */
              allocateBuiltinTypePackageReferenceIfSupported(paramType, 'function-parameter');
            }
          }
          space();
        } else {
          /*
           * Preserve parser position semantics for the untyped form while
           * still allowing whitespace before ',' or ')'.
           */
          pos = afterVariable;
          space();
        }

        if (source[pos] !== ',') {
          break;
        }

        pos++;
        chunks.push(fixed(','));
        space();
      }
    }, true);

    /*
     * Preserve the whitespace that separates the Function header from its
     * first body item. We must capture it here: the old trailing space()
     * after the return type consumed it before the body loop could inspect it.
     */
    const afterParamsWhitespaceStart = pos;
    space();
    let functionBodyWhitespace =
      source.slice(afterParamsWhitespaceStart, pos) || afterNameWhitespace;

    // Optional return type.
    if (word('Returns')) {
      chunks.push(fixed('Returns'));

      space();
      if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(source.slice(pos))) {
        const returnClass = applicationClassPath();
        chunks.push(returnClass.bytes);
        /*
         * Cycle 111: like an Application-Class-typed parameter, a
         * `Returns <Package:Class>` type uses its class in the header's
         * unit. 2116 / 2158 store COMPARESESSION and CONFIGURATION rows at
         * `Function GetSessionFromParms() Returns ...:CompareSession` and
         * `... Returns ...:Configuration`, and none for the first Function's
         * `Returns` (its class is in the leading unit).
         */
        if (unitScopedClassRows) useApplicationClassRow(returnClass.packagePath, returnClass.className);
      } else {
        const isArrayType = /^array\b/i.test(source.slice(pos));
        const returnType =
          /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos))?.[0];
        chunks.push(typeName());
        /*
         * Compiler architecture: a Function's `Returns <BuiltinType>`
         * type never allocated a PACKAGE dependency row for ANY built-in
         * type at all until a corpus-wide, token-level census (decoding
         * every candidate and requiring a genuine `Returns`(text) token
         * immediately followed by a real type keyword token) found a
         * unanimous, zero-contradiction population across every built-in
         * type this file already grants a PACKAGE row elsewhere: Record
         * (57), Rowset (75), Row (23), SQL (4), File (1), ApiObject (13),
         * Message (32), JavaObject (3), XmlDoc (22), XmlNode (13), Field
         * (11) -- 254 occurrences total, 0 exceptions.
         */
        if (isArrayType) {
          arrayElementTypes();
        } else if (returnType !== undefined) {
          allocateBuiltinTypePackageReferenceIfSupported(returnType, 'function-returns');
        }
      }

      const afterReturnWhitespaceStart = pos;
      space();
      functionBodyWhitespace =
        source.slice(afterReturnWhitespaceStart, pos);
    }

    // Confirmed Function header -> body boundary.
    const functionHeaderTrivia = captureTrailingTrivia();
    emitBoundary(functionHeaderTrivia, 0x2d);
    if (functionHeaderTrivia.inlineComment !== undefined) {
      const afterHeaderCommentWhitespaceStart = pos;
      space();
      functionBodyWhitespace = source.slice(afterHeaderCommentWhitespaceStart, pos);
    }

    /*
     * A Function header may carry an explicit source semicolon:
     *
     *   Function major_code_ckeck(&EMPLID, &COMPANY);
     *
     * which compiles as:
     *
     *   32 ... 14 2D 15 <body...>
     *
     * 0x2D is the structural header/body boundary and 0x15 preserves the
     * explicit semicolon, matching the same calibrated pattern used by While.
     */
    if (source[pos] === ';') {
      pos++;
      chunks.push(fixed(';'));

      const afterHeaderSemicolonWhitespaceStart = pos;
      space();
      functionBodyWhitespace =
        source.slice(afterHeaderSemicolonWhitespaceStart, pos);
    }

    /*
     * Blank formatting lines immediately after a Function header are
     * preserved as 0x4F boundaries. The ordinary newline separating the
     * header from the first body item is not a boundary; each additional
     * newline contributes one 0x4F.
     *
     * Calibrated by ABS_HIST_UK_SBR.SMP_MA_ELIG.FieldFormula:
     *
     *   Function Default_SHP_setup() Returns boolean
     *
     *
     *      ABSENCE_HIST.DT_BOOKING_NOTICE.DisplayOnly = True;
     *
     * which begins its body as: 2D 4F 4F 21 ...
     */
    if (
      /(?:\r?\n)[ \t]*(?:\r?\n)/.test(functionBodyWhitespace)
    ) {
      /*
       * The header/body separator consumes the first newline. Each additional
       * newline in the captured whitespace is preserved as a 0x4F boundary.
       *
       * For:
       *
       *   Function Default_SHP_setup() Returns boolean
       *
       *
       *      ABSENCE_HIST.DT_BOOKING_NOTICE.DisplayOnly = True;
       *
       * the captured whitespace contains three newline characters and
       * PeopleTools stores exactly two markers:
       *
       *   2D 4F 4F 21 ...
       */
      emitBlankLineMarkers(functionBodyWhitespace);
    }

    let sawLocalDeclaration = false;
    let enteredExecutableSection = false;
    /*
     * A standalone block/disabled-code comment appearing before ANY Local
     * declaration is a complete leading body item of its own. A blank line
     * between it and the first Local declaration still gets a 0x4F marker,
     * exactly like blank lines elsewhere in the body do -- but the ordinary
     * top-of-loop marker check below is gated on `enteredExecutableSection`,
     * which is not yet true this early (no Local seen yet, no executable
     * statement reached yet), so that gap went unmarked entirely.
     *
     * ADJ_CN_TAX_BAL.BALANCE_YEAR.FieldFormula (definition 634):
     *
     *   Function TAX_CLASS_CAN_List();
     *      /* Set up dropdown list of Tax Class for balance adjustment *\/
     *
     *      Local Rowset &Xlat;
     *
     * stores the blank line between the comment and `Local Rowset` as one
     * 0x4F marker (`... 4F 44 0A "Rowset" ...`), which the encoder was
     * dropping entirely.
     */
    let sawLeadingComment = false;

    const previousHtmlFunctionNamespace = currentHtmlFunctionNamespace;
    currentHtmlFunctionNamespace = nextHtmlFunctionNamespace++;
    functionDepth++;
    sawFunctionDefinition = true;

    if (functionDepth === 1) {
      functionApplicationClassVariables.clear();
      for (const parameter of pendingParameterReceivers.splice(0)) {
        functionApplicationClassVariables.set(parameter.name.toLowerCase(), {
          packagePath: parameter.packagePath,
          className: parameter.className,
          reuseRuntimeCreateForMethods: false
        });
      }
    }

    while (true) {
      const bodyWhitespaceStart = pos;
      space();
      const bodyWhitespace = source.slice(bodyWhitespaceStart, pos);

      /*
       * Once a Function is in its executable section, blank formatting lines
       * between top-level body statements are preserved as 0x4F boundaries.
       *
       * The ordinary newline between statements is not a marker; each
       * additional newline contributes one 0x4F.
       *
       * Calibrated by ABS_HIST_UK_SBR.SMP_MA_ELIG.FieldFormula:
       *
       *   ABSENCE_HIST.SMP_END_DATE.DisplayOnly = False;
       *
       *   If ABSENCE_HIST.PARTNER_DEC = "Y" Then
       *
       * which stores:
       *
       *   ... 06 30 15 4F 1C ...
       */
      if (
        (enteredExecutableSection ||
          (sawLeadingComment && !sawLocalDeclaration)) &&
        !/^End-Function\b/i.test(source.slice(pos)) &&
        /(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace)
      ) {
        emitBlankLineMarkers(bodyWhitespace);
      }

      if (word('End-Function')) {
        /*
         * Blank formatting lines immediately before End-Function are
         * preserved as 0x4F boundaries.
         *
         * ACCOMPLISHMENTS.MAJOR_CODE.SaveEdit:
         *
         *   End-If;
         *
         *   End-Function;
         *
         * stores:
         *
         *   ... 1A 15 4F 37 15 ...
         */
        if (/(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace)) {
          emitBlankLineMarkers(bodyWhitespace);
        }

        chunks.push(fixed('End-Function'));

        space();

        if (source[pos] !== ';') {
          fail('expected ; after End-Function');
        }

        pos++;
        chunks.push(fixed(';'));

        /*
         * An inline trailing comment immediately after End-Function's own
         * semicolon (same source line) renders BEFORE the structural 0x2D
         * function-definition boundary, with the inline (0x4E) comment
         * opcode -- the same inline-vs-standalone ordering already proven
         * for the ordinary `When <value>` header's own trailing comment
         * and (this session) `When-Other`'s.
         *
         * FieldRowsetProcessing's own defining program (definition 3128):
         *
         *   End-Function; /* FieldRowsetProcessing*\/
         *
         * stores `... 15 4E <comment> 2D ...`, not `... 15 2D 24 <comment> ...`.
         */
        // Confirmed Function-definition boundary.
        emitBoundary(captureTrailingTrivia(), 0x2d);

        functionDepth--;
        currentHtmlFunctionNamespace = previousHtmlFunctionNamespace;

        if (functionDepth === 0) {
          functionApplicationClassVariables.clear();
        }

        return;
      }

      if (pos === source.length) {
        fail('expected End-Function');
      }

      /*
       * A blank line between leading Local declarations and whatever
       * follows them (an executable statement OR a standalone comment)
       * contributes a 0x4f boundary. An ordinary newline does not
       * (DERIVED_HR_DR.HR_DR_CONTINUE1_PB.FieldChange, ValidateData).
       *
       * This transition check must run BEFORE the comment branches below,
       * not just before ordinary statement parsing: AMM_ARCHIVE_WK.
       * FUNCLIB.FieldFormula (definition 935) proves a standalone comment
       * immediately after the leading Local run needs this same marker --
       *
       *   Local string &segmentsunordered;
       *
       *   /* Archived Details Component *\/
       *
       * -- and the comment branches `continue` immediately after
       * consuming the comment, so if this check ran after them (as it
       * used to) it would never fire for a comment at all.
       */
      const isLocal = /^Local\b/i.test(source.slice(pos));

      if (!isLocal && sawLocalDeclaration && !enteredExecutableSection) {
        if (/(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace)) {
          emitBlankLineMarkers(bodyWhitespace);
        }
        enteredExecutableSection = true;
      }

      /*
       * Cycle 113: so does a blank line BETWEEN two leading Local
       * declarations of a Function body. 2116:
       *
       *   Local CAFNUI_CORE:HANDLER:FactorHandler:Chart &fctHandler;
       *
       *   Local Record &record;
       *
       * stores `... 15 4F 44 ...`. LOCAL SNAPSHOT (every ordinary Function
       * body, consecutive Locals separated by whitespace only): stored
       * writes one 0x4F per blank line in all 131 such pairs -- plain or
       * Application-Class-typed, initialized or not -- of which the
       * encoder kept 22 (after an executable statement) and dropped 109.
       */
      if (isLocal && sawLocalDeclaration && !enteredExecutableSection && /(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace)) {
        emitBlankLineMarkers(bodyWhitespace);
      }

      /*
       * A standalone block comment inside an already-entered Function
       * executable section is a complete body item and does not require a
       * following 0x15 statement terminator.
       *
       * DERIVED_CO.FUNCLIB.FieldFormula calibrates:
       *
       *   &HeaderRowset = ...;
       *
       *   [standalone block comment: set wording of 'no rows found' message]
       *   &Rowset(1).DERIVED_HR.NO_RESULTS.Value = ...;
       *
       * Stored shape:
       *
       *   ... 15 4F 24 <comment> 01 ...
       *
       * The generic Function-body path previously sent the comment through
       * statement() and then incorrectly required ';', producing
       * "expected ; in Function body".
       *
       * A comment immediately after leading Locals is likewise a complete
       * body item. The decoded source can render an original same-line 0x4E
       * comment on a separate line; comment opcode provenance preserves it.
       */
      if (source.startsWith('<*', pos)) {
        chunks.push(disabledCodeComment());
        if (!sawLocalDeclaration && !enteredExecutableSection) {
          sawLeadingComment = true;
        }
        continue;
      }

      if (source.startsWith('/*', pos)) {
        chunks.push(blockComment());
        if (!sawLocalDeclaration && !enteredExecutableSection) {
          sawLeadingComment = true;
        }
        continue;
      }

      /*
       * Unlike the main program's top level (where flat sequential
       * statements share one control group by default, only bumping on
       * specific triggers like SetDefault or a top-level CreateRecord
       * assignment), each top-level-of-a-Function-body statement gets its
       * OWN fresh control group -- including plain assignments, not just
       * bare calls. Nested control structures within the function (If/
       * For/etc, once entered via inControlGroup()) are unaffected: they
       * keep the ordinary shared-group reuse behavior for their own body,
       * exactly like top-level program code does.
       *
       * AE_WRK.AE_GO.FieldChange (definition 871), `Function man_stmt`:
       *
       *   InsertRow(Record.AE_STMT_TBL, ActiveRowCount(Record.AE_STMT_TBL));
       *   &TO_ROW = ActiveRowCount(Record.AE_STMT_TBL);
       *   CopyFields(1, Record.AE_TOOLS_CHK_VW, &ROW, 1, Record.AE_STMT_TBL, &TO_ROW);
       *
       * proves InsertRow's own Record.AE_STMT_TBL argument is reused ONLY
       * by its own nested ActiveRowCount(...) argument (same statement,
       * same group) -- the very next statement's OWN
       * `ActiveRowCount(Record.AE_STMT_TBL)` does NOT reuse it (fresh
       * row), and CopyFields' Record.AE_STMT_TBL argument two statements
       * later is ALSO fresh, not reusing either prior one. Direct
       * stored-PSPCMNAME enumeration confirms this pattern (each of the
       * three flat statements gets its own row for AE_STMT_TBL, some used
       * more than once only via nesting within their own statement).
       */
      if (controlDepth === 0 && !isLocal) {
        controlGroup = nextControlGroup++;
      }
      // Cycle 94: every Function body statement, Locals included, is its
      // own allocation unit.
      if (ordinaryProgram && controlDepth === 0) {
        startAllocationUnit();
        // Cycle 103: so is every Function body statement for built-in rows.
        startBuiltinUnit();
      }

      const isRemStatement = startsRemComment();
      if (isRemStatement) {
        chunks.push(remComment(true));
      } else {
        statement();
      }

      if (isLocal) {
        sawLocalDeclaration = true;
      } else {
        enteredExecutableSection = true;
      }

      if (isRemStatement) {
        /*
         * remComment() already consumed its own trailing ';' as part of
         * matching the rest of its source line, unlike an ordinary
         * statement whose semicolon is still ahead of `pos` at this point
         * (the `space()` call below exists to skip whitespace BEFORE that
         * still-unconsumed semicolon, not to skip whitespace after it).
         * Calling `space()` here for a REM statement would therefore eat
         * a following blank line that the NEXT loop iteration (or the
         * dedicated blank-line-before-End-Function check) needs intact.
         *
         * AMM_ARCHIVE_WK.FUNCLIB.FieldFormula (definition 935):
         *
         *   rem &xmldoc = GetArchPubHeaderXmlDoc(..., &xmlsegmentindex);
         *
         *   End-Function;
         *
         * was losing this blank line's 0x4F marker entirely.
         */
      } else {
        space();

        if (source[pos] === ';') {
          pos++;
          chunks.push(fixed(';'));
        } else if (/^End-Function\b/i.test(source.slice(pos))) {
          // PeopleTools accepts a Return immediately before End-Function
          // without a semicolon (common in exported corpus source).
        } else {
          fail('expected ; in Function body');
        }
      }
      trailingBlockComments();
    }
  }

  function tryStatement(): void {
    chunks.push(fixed('try'));

    while (true) {
      const whitespaceStart = pos;
      space();
      const tryWhitespace = source.slice(whitespaceStart, pos);
      const hasBlankLine =
        /(?:\r?\n)[ \t]*(?:\r?\n)/.test(tryWhitespace);

      if (word('catch')) {
        /*
         * A blank formatting line immediately before catch is preserved as
         * one or more 0x4F source-group boundaries.
         *
         * ACA_ACK_RUNCTL.ACA_ATTACHADD.FieldChange:
         *
         *   &nReturn = GetAttachment(...);
         *
         *   catch Exception &ef1;
         *
         * stores:
         *
         *   ... 15 4F 66 ...
         */
        if (hasBlankLine) {
          emitBlankLineMarkers(tryWhitespace);
        }

        chunks.push(fixed('catch'));

        space();

        /*
         * Catch exception types may be either a simple type name or a fully
         * qualified Application Class path.
         *
         * Calibrated by ACCOMPLISHMENTS.EMPLID.SavePostChange:
         *
         *   catch HMCR_FRAMEWORK:ServiceFramework:baseClasses:baseException &ex1;
         *
         * Compiles as:
         *
         *   66
         *   0A "HMCR_FRAMEWORK"
         *   57 0A "ServiceFramework"
         *   57 0A "baseClasses"
         *   57 0A "baseException"
         *   01 "&ex1"
         *   2D 15
         *
         * The exception type path itself is executable-stream metadata and
         * does not allocate another PSPCMNAME dependency row here (Cycle
         * 111: its variable is a receiver, see below).
         */
        const qualifiedCatchType =
          /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/
            .test(source.slice(pos));

        let catchClass: { packagePath: string[]; className: string } | undefined;
        if (qualifiedCatchType) {
          const exceptionClass = applicationClassPath();
          chunks.push(exceptionClass.bytes);
          catchClass = exceptionClass;
        } else {
          const typeMatch =
            /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));

          if (!typeMatch) {
            return fail('expected exception type after catch');
          }

          const typeName = typeMatch[0];
          pos += typeName.length;

          chunks.push(
            textOperand(
              INLINE_IDENTIFIER_OPCODE,
              TokenKind.Name,
              typeName
            )
          );
        }

        space();

        /*
         * Cycle 111: the exception variable of an Application Class `catch`
         * is a receiver of the class (the clause itself allocates nothing):
         * a method call on it uses the class in its allocation unit. 10567:
         *
         *   catch GP_ABS_CS_TMPL:TEL:absTelTransferEx &ex
         *      &ex.Output();
         *
         * stores ABSTELTRANSFEREX with APPCLASSMETHOD OUTPUT. LOCAL SNAPSHOT:
         * of the 16 qualified catch clauses of unit-encoded ordinary
         * programs, the 9 whose body calls a method on the variable store
         * the row (4074, 10565 x3, 10567, 10568, 17382, 17383, 25033); the
         * 7 without a call store none (14134, 14149, 18130, 25111, 5525 x3).
         */
        const catchVariable = /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
        if (unitScopedClassRows && catchClass !== undefined && catchVariable !== undefined) {
          const receiver = { packagePath: catchClass.packagePath, className: catchClass.className, reuseRuntimeCreateForMethods: false };
          applicationClassVariables.set(catchVariable.toLowerCase(), receiver);
          if (functionDepth > 0) functionApplicationClassVariables.set(catchVariable.toLowerCase(), receiver);
        }
        chunks.push(variable());

        /*
         * An inline trailing comment immediately after catch's own
         * exception variable (same source line, no semicolon) renders
         * BEFORE the structural 0x2D catch-header boundary, with the
         * inline (0x4E) comment opcode -- the same ordering already
         * proven for When/When-Other/End-Function's own trailing
         * comments this session.
         *
         *   catch Exception &exMask /*Masking API don't exist*\/
         *      Local string &exMasks = &exMask.ToString();
         *
         * stores `... &exMask 4E <comment> 2D ...`, not
         * `... &exMask 2D 24 <comment> ...`.
         */
        // Confirmed catch-header -> body boundary.
        emitBoundary(captureTrailingTrivia(), 0x2d);

        /*
         * Catch-header semicolon handling is source-dependent.
         *
         * ACCOMPLISHMENTS.EMPLID.SavePostChange contains:
         *
         *   catch HMCR_FRAMEWORK:ServiceFramework:baseClasses:baseException &ex1;
         *
         * and its compiled stream contains:
         *
         *   ... 01 "&ex1" 2D 15 ...
         *
         * Earlier calibrated try/catch fixtures omit the source semicolon and
         * likewise have no 0x15 at this position. Therefore the semicolon is
         * optional here and must be emitted only when it is present in source.
         */
        const catchHeaderTrailingWhitespaceStart = pos;
        space();

        if (source[pos] === ';') {
          pos++;
          chunks.push(fixed(';'));
        }

        let firstCatchBodyItem = true;

        while (true) {
          const catchBodyWhitespaceStart = pos;
          space();

          /*
           * Blank formatting lines inside a catch body are preserved as
           * 0x4F source-group boundaries, including right after the catch
           * header (before the first body item) and before end-try.
           *
           * ADDRESSES.EMPLID.SavePostChange (definition 521):
           *
           *   catch Exception &ex
           *
           *   end-try;
           *
           * stores the blank line between the catch header and end-try as
           * a single 0x4F. The catch-header trailing whitespace is
           * consumed by the semicolon check above, before this loop's own
           * whitespace tracking starts, so the first iteration must look
           * back across that earlier span instead of its own (empty) one.
           */
          const catchBodyWhitespace = source.slice(
            firstCatchBodyItem
              ? catchHeaderTrailingWhitespaceStart
              : catchBodyWhitespaceStart,
            pos
          );
          firstCatchBodyItem = false;

          if (/(?:\r?\n)[ \t]*(?:\r?\n)/.test(catchBodyWhitespace)) {
            emitBlankLineMarkers(catchBodyWhitespace);
          }

          if (source.startsWith('/*', pos)) {
            chunks.push(blockComment());
            continue;
          }

          if (startsRemComment()) {
            chunks.push(remComment(true));
            continue;
          }

          if (word('end-try')) {
            chunks.push(fixed('end-try'));
            return;
          }

          if (pos === source.length) {
            fail('expected end-try');
          }

          statement();

          space();

          if (source[pos] !== ';') {
            fail('expected ; in catch body');
          }

          pos++;
          chunks.push(fixed(';'));
        }
      }

      if (pos === source.length) {
        fail('expected catch');
      }

      /*
       * Blank formatting lines inside a try body are preserved as 0x4F
       * source-group boundaries, the same way they are immediately before
       * catch above. This includes the boundary right after the `try`
       * header, before its first body item.
       *
       * ADDRESSES.EMPLID.SavePostChange (definition 521):
       *
       *   try
       *
       *      If CheckFieldExists(...) Then
       *
       * stores the blank line between `try` and the first body statement
       * as a single 0x4F.
       */
      if (hasBlankLine) {
        emitBlankLineMarkers(tryWhitespace);
      }

      if (source.startsWith('/*', pos)) {
        chunks.push(blockComment());
        continue;
      }

      if (startsRemComment()) {
        chunks.push(remComment(true));
        continue;
      }

      statement();

      space();

      if (source[pos] !== ';') {
        fail('expected ; in try body');
      }

      pos++;
      chunks.push(fixed(';'));
      trailingBlockComments();
    }
  }
  

  function throwStatement(): void {
    chunks.push(fixed('throw'));
    expression();
  }
  function repeatStatement(): void {
    chunks.push(fixed('Repeat'));

    while (true) {
      const whitespaceStart = pos;
      space();
      const bodyWhitespace = source.slice(whitespaceStart, pos);
      const hasBlankLine =
        /(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace);

      if (word('Until')) {
        if (hasBlankLine) {
          deferReferenceGatedMarkers(bodyWhitespace);
        }

        chunks.push(fixed('Until'));

        space();
        booleanExpression();
        return;
      }

      if (pos === source.length) {
        fail('expected Until');
      }

      /*
       * A Repeat body may contain a standalone `/* ... *\/` comment or a
       * REM comment, the same way every other body loop (If/While/For/
       * Evaluate) already does -- this body loop had neither at all.
       *
       * PA_PYE_DATA.PYE_ARCHIVE.FieldFormula (one of several corpus
       * occurrences of a standalone comment inside a Repeat body):
       *
       *   Repeat
       *      /*** ... valid ***\/
       *      &THIS_REPEAT_ROWS = &rs1.ActiveRowCount;
       *   Until ...
       */
      if (source.startsWith('/*', pos)) {
        if (hasBlankLine) {
          deferReferenceGatedMarkers(bodyWhitespace);
        }

        chunks.push(blockComment());
        continue;
      }

      if (/^REM\b/i.test(source.slice(pos))) {
        if (hasBlankLine) {
          deferReferenceGatedMarkers(bodyWhitespace);
        }

        chunks.push(remComment(true));
        continue;
      }

      // Cycle 113: a statement keeps its blank lines too, like the comment,
      // REM and Until above (4827 `&NEW_ROW_NUM = ...; <blank> For ...`
      // inside a Repeat stores `15 4F 29`).
      if (hasBlankLine) {
        deferReferenceGatedMarkers(bodyWhitespace);
      }

      statement();

      space();
      if (source[pos] !== ';') {
        /*
         * The final statement in a Repeat body may omit its source
         * semicolon when it is immediately followed by Until, the same
         * way a While body already can before End-While.
         *
         * TRN_SML_SUM.FUNCLIB.FieldFormula (one of several corpus
         * occurrences):
         *
         *   Repeat
         *      ...
         *      &ROW3_DEMAND_ID = FetchValue(TRN_SML_SUM_VW.DEMAND_ID, &ROW3)
         *   Until &ROW3_DEMAND_ID = &ROW2_DEMAND_ID;
         */
        if (!/^Until\b/i.test(source.slice(pos))) {
          fail('expected ; in Repeat body');
        }
        continue;
      }

      pos++;
      chunks.push(fixed(';'));
      trailingBlockComments();
    }
  }
  function forStatement(): void {
    chunks.push(fixed('For'));

    space();
    chunks.push(variable());

    space();
    if (source[pos] !== '=') {
      fail('expected = in For');
    }

    pos++;
    chunks.push(fixed('='));

    expression();

    space();
    if (!word('To')) {
      fail('expected To');
    }

    chunks.push(fixed('To'));

    expression();

    space();

    if (word('Step')) {
      chunks.push(fixed('Step'));
      expression();
    }

    // Confirmed PeopleTools boundary between loop header and body.
    const forHeaderTrivia = captureTrailingTrivia();
    emitBoundary(forHeaderTrivia, 0x2d);

    /*
     * A For header may carry an explicit source semicolon:
     *
     *   For &I = 1 To &ACTIVE_ROW_L2;
     *
     * PeopleTools stores:
     *
     *   29 <init> 2A <limit> 2D 15 <body...>
     *
     * The 0x2D remains the structural header/body boundary; 0x15 preserves
     * the explicit source semicolon.
     */
    let explicitHeaderSemicolon = false;

    if (source[pos] === ';') {
      explicitHeaderSemicolon = true;
      pos++;
      chunks.push(fixed(';'));
    }

    /*
     * Determine the whitespace that separates the completed For header from
     * its first body item.
     *
     * Without an explicit header semicolon, expression() may already have
     * consumed this whitespace, so recover it by scanning backward.
     *
     * With an explicit semicolon:
     *
     *   For &I = 1 To &RS.RowCount;
     *
     *      &Row = ...
     *
     * the significant whitespace begins AFTER the semicolon. Consume it
     * directly so the blank formatting line produces the stored 0x4F:
     *
     *   ... 2D 15 4F <body>
     */
    let headerTrailingWhitespace: string;

    if (explicitHeaderSemicolon || forHeaderTrivia.inlineComment !== undefined) {
      const afterHeaderSemicolonWhitespaceStart = pos;
      space();
      headerTrailingWhitespace =
        source.slice(afterHeaderSemicolonWhitespaceStart, pos);
    } else {
      let trailingWhitespaceStart = pos;

      while (
        trailingWhitespaceStart > 0 &&
        /\s/.test(source[trailingWhitespaceStart - 1])
      ) {
        trailingWhitespaceStart--;
      }

      headerTrailingWhitespace =
        source.slice(trailingWhitespaceStart, pos);
    }

    const hadBlankLineAfterForHeader =
      /(?:\r?\n)[ \t]*(?:\r?\n)/.test(
        headerTrailingWhitespace
      );

    // Cycle 113: one 0x4F per blank line (see `emitBlankLineMarkers`).
    if (hadBlankLineAfterForHeader) {
      emitBlankLineMarkers(headerTrailingWhitespace);
    }

    let firstForBodyItem = true;

    while (true) {
      const whitespaceStart = pos;
      space();

      const bodyWhitespace =
        source.slice(whitespaceStart, pos);

      const hasBlankLine =
        /(?:\r?\n)[ \t]*(?:\r?\n)/.test(
          bodyWhitespace
        );

      if (word('End-For')) {
        if (hasBlankLine) {
          deferReferenceGatedMarkers(bodyWhitespace);
        }
        chunks.push(fixed('End-For'));
        return;
      }

      if (pos === source.length) {
        fail('expected End-For');
      }

      // Standalone block comments are executable-stream records in their
      // own right. They can appear between For-body statements just as they
      // can inside If bodies; preserve their calibrated 0x24 provenance.
      if (source.startsWith('<*', pos)) {
        if (hasBlankLine && !firstForBodyItem) {
          emitBlankLineMarkers(bodyWhitespace);
        }

        chunks.push(disabledCodeComment());
        continue;
      }

      if (source.startsWith('/*', pos)) {
        if (hasBlankLine && !firstForBodyItem) {
          emitBlankLineMarkers(bodyWhitespace);
        }
        chunks.push(blockComment());
        continue;
      }

      if (startsRemComment()) {
        // Cycle 113: a REM keeps its blank lines, like a block comment
        // (4094, 6288: `End-If; <blank> rem ...;` in a For body stores
        // `15 4F 24`).
        if (hasBlankLine && !firstForBodyItem) {
          emitBlankLineMarkers(bodyWhitespace);
        }
        chunks.push(remComment(true));
        continue;
      }

      // An extra semicolon is an empty statement and is retained as its own
      // 0x15 token. PSIBLOGICL2_WRK.IB_LINKDOC has this inside a For body:
      // `&recPage = &row.GetRecord(Record.PSDOCLOPAGE);;`.
      if (source[pos] === ';') {
        pos++;
        chunks.push(fixed(';'));
        firstForBodyItem = false;
        continue;
      }

      if (hasBlankLine && !firstForBodyItem) {
        /*
         * Preserve every blank formatting line between For-body constructs.
         * One ordinary newline is line separation; each additional newline
         * contributes one 0x4F.
         *
         * Offset 420:
         *
         *   End-If;
         *
         *
         *   &THISDISPLAYROW = ...
         *
         * stores:
         *
         *   ... 1A 15 4F 4F 01 ...
         */
        emitBlankLineMarkers(bodyWhitespace);
      }

      firstForBodyItem = false;

      statement();

      space();

      if (source[pos] !== ';') {
        /*
         * The final statement in a For body may omit its source semicolon
         * when it is immediately followed by End-For, the same way a
         * top-level If/Evaluate/assignment may omit its semicolon at EOF.
         *
         * CAN_TAX_TYPE.SOURCE_TAX.RowInit (definition 2406):
         *
         *   For &i = ActiveRowCount(...) To 1 Step - 1
         *      DeleteRow(Record.CAN_TAX_TYPE, &Current_Row_1, ...)
         *   End-For;
         *
         * and ARCH_TBL.RECNAME.SavePreChange (definition 1269), where the
         * omitted statement is itself a compound If block:
         *
         *   For &K = 1 To &ALL_ROWS
         *      UpdateValue(...);
         *      If &K = 1 Then
         *         UpdateValue(...);
         *      End-If
         *   End-For;
         *
         * Both decode back to this exact source (SOURCE MATCH), so no 0x15
         * token is stored for the omitted semicolon; only fail when the
         * statement is not immediately followed by End-For.
         */
        if (!/^End-For\b/i.test(source.slice(pos))) {
          fail('expected ; in For body');
        }
        continue;
      }

      pos++;
      chunks.push(fixed(';'));
      trailingBlockComments();
    }
  }
  function whileStatement(): void {
    chunks.push(fixed('While'));

    space();
    booleanExpression();

    /*
     * Confirmed While header encoding:
     *
     *   While <condition>;
     *
     * compiles as:
     *
     *   <condition> 0x2D 0x15 <body...>
     *
     * 0x2D is the structural condition/body boundary and 0x15 is the
     * explicit source semicolon.
     */
    emitBoundary(captureTrailingTrivia(), 0x2d);

    /*
     * Cycle 83: every While-body item is a gap boundary (see the body loop
     * below). Without a header semicolon, the condition's own trailing
     * `space()` has already consumed the whitespace before the FIRST body
     * item, so recover it here -- the same backward scan forStatement()
     * uses for a semicolon-less For header. CO_STATETAX_TBL.EFFDT.RowInsert
     * (definition 3237):
     *
     *   While &LibAccFetch.Fetch(&Status, &TaxClass, &Category)
     *
     *      &Found = "N";
     *
     * stores 0x4F before the first body statement.
     */
    const afterWhileCondition = pos;
    space();
    let headerTrailingWhitespace = '';
    if (source[pos] === ';') {
      pos++;
      chunks.push(fixed(';'));
    } else {
      pos = afterWhileCondition;
      let trailingWhitespaceStart = pos;
      while (trailingWhitespaceStart > 0 && /\s/.test(source[trailingWhitespaceStart - 1])) {
        trailingWhitespaceStart--;
      }
      headerTrailingWhitespace = source.slice(trailingWhitespaceStart, pos);
    }

    while (true) {
      const whitespaceStart = pos;
      space();
      const bodyWhitespace = headerTrailingWhitespace + source.slice(whitespaceStart, pos);
      headerTrailingWhitespace = '';
      const hasBlankLine =
        /(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace);

      if (word('End-While')) {
        /*
         * Preserve blank-line multiplicity immediately before End-While,
         * mirroring ifStatement()'s identical End-If handling above --
         * this branch was previously missing entirely.
         *
         * CO_STATETAX_TBL.EFFDT.FieldChange (definition 3235):
         *
         *   &AccountsModified = True;
         *
         *   End-If;
         *
         *   End-While;
         *
         * stores a 0x4F boundary before End-While just as it does before
         * the enclosing End-If.
         */
        if (hasBlankLine) {
          deferReferenceGatedMarkers(bodyWhitespace);
        }

        chunks.push(fixed('End-While'));
        return;
      }

      if (pos === source.length) {
        fail('expected End-While');
      }

      if (source.startsWith('/*', pos)) {
        // Cycle 83: same comment-gap rule as the If body's `/*` branch.
        // COMP_PROP.DT_RETURNED.SaveEdit (definition 2991) stores 0x4F
        // before a standalone comment that follows a blank line.
        if (hasBlankLine) {
          emitBlankLineMarkers(bodyWhitespace);
        }
        chunks.push(blockComment());
        continue;
      }

      /*
       * REM is compiled as a 0x24 comment payload containing its own
       * semicolon, so consume it here rather than sending it through the
       * ordinary statement + 0x15 terminator path -- mirroring
       * ifStatement()'s identical REM handling above, which a While body
       * was entirely missing (only If/For/Evaluate/try bodies had it).
       *
       * PSXP_PRCSDEFN.CI_PROPERTY.FieldFormula (definition 9661):
       *
       *   While &CIProperties.Fetch(&PropertyName, &RecName, &Fieldname)
       *
       *      REM MessageBox(0, "", 0, 0, "&RecName = " | &RecName | ...);
       */
      if (startsRemComment()) {
        if (hasBlankLine) {
          deferReferenceGatedMarkers(bodyWhitespace);
        }

        chunks.push(remComment(true));
        continue;
      }

      if (hasBlankLine) {
        /*
         * Cycle 83: a blank formatting line before an ordinary While-body
         * statement is a 0x4F source-group boundary, exactly as in an If
         * body (same deferred, reference-gated producer). This branch was
         * missing: the Phase 1 consolidation audit recorded that
         * whileStatement handled only End-While/REM gaps. HP_WORKDAYS
         * SaveEdit (definition 3054) stores `15 4F` between the body's
         * statements. LOCAL SNAPSHOT: 1,535 missing markers across 400
         * NONEXACT definitions; among all 1,233 While programs the full
         * rule (statement + comment + header gaps) makes 186 more forward-
         * exact and 0 fewer. Deferred vs immediate gating produces
         * byte-identical output for every While program in the corpus, so
         * the If-body sibling's producer is used.
         */
        deferReferenceGatedMarkers(bodyWhitespace);
      }

      statement();

      space();
      if (source[pos] !== ';') {
        /*
         * The final statement in a While body may omit its source
         * semicolon when it is immediately followed by End-While, the
         * same way a For body already can before End-For.
         *
         * GPGB_RC_CTL.GPGB_RC_APPLD.FieldFormula (definition 7041):
         *
         *   While ...
         *      ...
         *      &i = &i + 1
         *   End-While;
         */
        if (!/^End-While\b/i.test(source.slice(pos))) {
          fail('expected ; in While body');
        }
        continue;
      }

      pos++;
      chunks.push(fixed(';'));
      trailingBlockComments();
    }
  }

  function ifStatement(): void {
    chunks.push(fixed('If'));

    space();
    booleanExpression();

    space();

    /*
     * A block comment may appear between an If condition and Then, either
     * inline (0x4E, continuing the condition's own line) or standalone
     * (0x24, starting a new line) -- see `blockCommentByPlacement()`.
     *
     *   If &HeaderRowset(&i).Visible = True [inline block comment] Then
     *
     * DERIVED_CO.FUNCLIB.FieldFormula stores that comment as 0x4E directly
     * between the completed condition and the 0x1F Then opcode:
     *
     *   ... 06 2F 4E <comment> 1F ...
     *
     * HS_INJ_ILL_REHAB.HS_PNLGRP_ROUTE.Value proves the standalone case:
     * its own comment sits on its own line right before `Then` and
     * stores as 0x24, not 0x4E.
     */
    while (source.startsWith('/*', pos)) {
      chunks.push(blockCommentByPlacement());
      space();
    }

    /*
     * A REM between the completed condition and Then is an opaque disabled
     * condition tail, not an executable If-body statement. Definitions
     * 22751 and 8781 independently store it as 0x24 directly before 0x1F;
     * 22751 also proves the payload may continue onto one indented line.
     */
    while (startsRemComment()) {
      chunks.push(remComment(true));
      space();
    }

    if (!word('Then')) {
      fail('expected Then');
    }
    chunks.push(fixed('Then'));

    /*
     * A block comment attached directly to Then is encoded as 0x4E, not as
     * a standalone 0x24 body comment.
     *
     * DERIVED_CO.FUNCLIB.FieldFormula:
     *
     *   If &NbrSessions = 0 Then [inline block comment]
     *
     * Stored shape:
     *
     *   ... 1F 4E <comment> ...
     *
     * Keep this source-side rule narrow: only horizontal whitespace may occur
     * between Then and the comment. A comment beginning on a later source line
     * remains subject to the ordinary If-body comment rules.
     */
    const afterThen = pos;
    let afterThenScan = pos;
    while (
      afterThenScan < source.length &&
      (source[afterThenScan] === ' ' || source[afterThenScan] === '\t')
    ) {
      afterThenScan++;
    }

    if (source.startsWith('/*', afterThenScan)) {
      pos = afterThenScan;
      chunks.push(inlineBlockComment());
    } else {
      pos = afterThen;
    }

    const afterInlineThenComment = pos;
    space();
    if (source[pos] === ';') {
      pos++;
      chunks.push(fixed(';'));
    } else {
      pos = afterInlineThenComment;
    }

    // Then body
    while (true) {
      const whitespaceStart = pos;
      space();
      const bodyWhitespace = source.slice(whitespaceStart, pos);
      const hasBlankLine =
        /(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace);

      if (word('Else')) {
        /*
        * A blank line immediately before Else is represented by 0x4F before
        * the 0x19 Else opcode.
        */
        if (hasBlankLine) {
          deferReferenceGatedMarkers(bodyWhitespace);
        }

        chunks.push(fixed('Else'));

        /*
         * `Else` may carry its own optional, immediately-following `;`
         * before its body starts on the next line -- stored as a bare
         * `19 15` (Else then `;`), with nothing else in between (no
         * separate newline/boundary marker the way a `When` clause
         * header's own trailing `;` needs).
         *
         * PA_DFN_OPT_SET.FORM_CD_PROMPT.RowInit (definition 12251, one of
         * several corpus occurrences of this exact shape):
         *
         *   Else;
         *      DERIVED.FORM_CD_PROMPT = "PA_DFN_FORM_VW";
         *   End-If;
         */
        if (source[pos] === ';') {
          pos++;
          chunks.push(fixed(';'));
        }

        /*
         * A block comment attached directly to Else is encoded as 0x4E.
         *
         * DERIVED_CO.FUNCLIB.FieldFormula:
         *
         *   Else [inline block comment]
         *
         * Stored shape:
         *
         *   ... 19 4E <comment> ...
         *
         * Restrict this to horizontal whitespace so a comment beginning on a
         * later line remains an ordinary Else-body comment.
         */
        const afterElse = pos;
        let afterElseScan = pos;
        while (
          afterElseScan < source.length &&
          (source[afterElseScan] === ' ' || source[afterElseScan] === '\t')
        ) {
          afterElseScan++;
        }

        if (source.startsWith('/*', afterElseScan)) {
          pos = afterElseScan;
          chunks.push(inlineBlockComment());
        } else {
          pos = afterElse;
        }

        break;
      }

      if (word('End-If')) {
        if (hasBlankLine) {
          /*
           * Preserve blank-line multiplicity immediately before End-If.
           * One ordinary newline is line separation; each additional newline
           * contributes one 0x4F boundary.
           *
           * DERIVED_CO.FUNCLIB.FieldFormula proves a case with two blank
           * formatting lines before End-If, stored as:
           *
           *   ... 15 4F 4F 1A ...
           */
          deferReferenceGatedMarkers(bodyWhitespace);
        }
        chunks.push(fixed('End-If'));
        return;
      }

      if (pos === source.length) {
        fail('expected Else or End-If');
      }

      /*
       * decodeProgram renders 0x4E comments on their own line. Inside an
       * If body, accept that canonical decoded form and re-emit the same
       * 0x4E length-prefixed comment rather than treating it as a statement.
       * The original inline form is still handled by trailingBlockComments()
       * immediately after the preceding semicolon.
       */
      if (source.startsWith('<*', pos)) {
        if (hasBlankLine) {
          emitBlankLineMarkers(bodyWhitespace);
        }

        chunks.push(disabledCodeComment());
        continue;
      }

      if (source.startsWith('/*', pos)) {
        if (hasBlankLine) {
          emitBlankLineMarkers(bodyWhitespace);
        }

        chunks.push(blockComment());
        continue;
      }

      /*
       * REM is compiled as a 0x24 comment payload containing its own
       * semicolon, so consume it here rather than sending it through the
       * ordinary statement + 0x15 terminator path.
       *
       * Blank-line marker multiplicity before REM follows the same rule
       * as every other body-item boundary in this same loop (the
       * sibling `<*`/`/*` branches just above, and End-If below) -- this
       * branch was pushing exactly one marker regardless of actual
       * blank-line count.
       *
       * ADDRESS_TYPE_FL.EMPLID.SavePreChange (definition 534): TWO blank
       * lines before `REM TriggerPDHEvent_Fluid(GetRow());` inside a
       * nested If body store TWO 0x4F markers, not one.
       */
      if (startsRemComment()) {
        if (hasBlankLine) {
          deferReferenceGatedMarkers(bodyWhitespace);
        }

        chunks.push(remComment(true));
        trailingBlockComments();
        continue;
      }

      if (hasBlankLine) {
        /*
         * Inside an If body, PeopleTools preserves each blank formatting
         * line between executable constructs as a 0x4F source-group
         * boundary. One ordinary newline is just line separation; each
         * additional newline contributes one 0x4F.
         *
         * Keep these deferred because this structural marker is calibrated
         * only for programs that actually have compiled references.
         */
        deferReferenceGatedMarkers(bodyWhitespace);
      }

      statement();

      space();

      /*
       * PeopleTools can place an inline/trailing block comment before the
       * statement terminator:
       *
       *   FIELD = 0 [block comment];
       *
       * Stored shape:
       *   ... value 4E <comment> 15
       *
       * decodeProgram() may render the same 0x4E comment on its own line
       * before the semicolon, so accept that canonical form here as well.
       */
      while (source.startsWith('/*', pos)) {
        chunks.push(inlineBlockComment());
        space();
      }

      if (source[pos] === ';') {
        pos++;
        chunks.push(fixed(';'));
      } else if (!/^(?:Else|End-If|REM)\b/i.test(source.slice(pos))) {
        /*
         * A statement immediately followed by a REM comment (no
         * intervening statement of its own) may likewise omit its
         * trailing source semicolon, the same way one immediately
         * before Else/End-If already can.
         *
         * FUNCLIB_HR.FIELDVALUE_ERROR.FieldEdit (definition 13181):
         *
         *   Error MsgGet(2050, 10, "Field Text Type required for
         *      Field Type of VALUE")
         *   rem error "Text cannot be blank for VALUE field type ";
         *   End-If;
         */
        fail('expected ; in If body');
      }
      trailingBlockComments();
    }

    // Else body
    while (true) {
      const whitespaceStart = pos;
      space();
      const bodyWhitespace = source.slice(whitespaceStart, pos);
      const hasBlankLine =
        /(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace);

      if (word('End-If')) {
        if (hasBlankLine) {
          /*
           * Preserve blank-line multiplicity immediately before End-If.
           * One ordinary newline is line separation; each additional newline
           * contributes one 0x4F boundary.
           *
           * DERIVED_CO.FUNCLIB.FieldFormula proves a case with two blank
           * formatting lines before End-If, stored as:
           *
           *   ... 15 4F 4F 1A ...
           */
          deferReferenceGatedMarkers(bodyWhitespace);
        }
        chunks.push(fixed('End-If'));
        return;
      }

      if (pos === source.length) {
        fail('expected End-If');
      }

      /*
       * Same canonical round-trip case as the Then body: a decoded 0x4E
       * comment may appear on its own source line even though the stored
       * token immediately follows the previous semicolon.
       */
      if (source.startsWith('<*', pos)) {
        if (hasBlankLine) {
          emitBlankLineMarkers(bodyWhitespace);
        }

        chunks.push(disabledCodeComment());
        continue;
      }

      if (source.startsWith('/*', pos)) {
        if (hasBlankLine) {
          emitBlankLineMarkers(bodyWhitespace);
        }

        chunks.push(blockComment());
        continue;
      }

      /*
       * REM is compiled as a 0x24 comment payload containing its own
       * semicolon, so consume it here rather than sending it through the
       * ordinary statement + 0x15 terminator path.
       *
       * Blank-line marker multiplicity before REM follows the same rule
       * as every other body-item boundary in this same loop (the
       * sibling `<*`/`/*` branches just above, and End-If below) -- this
       * branch was pushing exactly one marker regardless of actual
       * blank-line count.
       *
       * ADDRESS_TYPE_FL.EMPLID.SavePreChange (definition 534): TWO blank
       * lines before `REM TriggerPDHEvent_Fluid(GetRow());` inside a
       * nested If body store TWO 0x4F markers, not one.
       */
      if (startsRemComment()) {
        if (hasBlankLine) {
          deferReferenceGatedMarkers(bodyWhitespace);
        }

        chunks.push(remComment(true));
        trailingBlockComments();
        continue;
      }

      if (hasBlankLine) {
        /*
         * Inside an If body, PeopleTools preserves each blank formatting
         * line between executable constructs as a 0x4F source-group
         * boundary. One ordinary newline is just line separation; each
         * additional newline contributes one 0x4F.
         *
         * Keep these deferred because this structural marker is calibrated
         * only for programs that actually have compiled references.
         */
        deferReferenceGatedMarkers(bodyWhitespace);
      }

      statement();

      space();

      while (source.startsWith('/*', pos)) {
        chunks.push(inlineBlockComment());
        space();
      }

      if (source[pos] === ';') {
        pos++;
        chunks.push(fixed(';'));
      } else if (!/^End-If\b/i.test(source.slice(pos))) {
        fail('expected ; in Else body');
      }
      trailingBlockComments();
    }
  }
  function evaluateStatement(): void {
    chunks.push(fixed('Evaluate'));

    space();
    expression();

    let sawWhen = false;
    let sawWhenOther = false;

    while (true) {
      space();

      // Evaluate may carry a REM comment between its selector and first When.
      // PSXPRPTDEFN_WRK.PROPTYPE stores it directly as a 0x24 comment record.
      if (!sawWhen && startsRemComment()) {
        chunks.push(remComment(true));
        continue;
      }

      /*
       * A standalone block comment may likewise appear between the
       * selector and the first When, stored the same direct 0x24 way as
       * the REM case above.
       *
       * AE_WRK.AE_DECIDE.FieldChange (definition 858):
       *
       *   Evaluate AE_WRK.AE_DECIDE
       *      /*
       *       Keep track of how many pending updates there are
       *      *\/
       *   When "T"
       */
      if (!sawWhen && source.startsWith('/*', pos)) {
        chunks.push(blockComment());
        continue;
      }

      if (word('When-Other')) {
        if (sawWhenOther) {
          fail('duplicate When-Other');
        }

        sawWhenOther = true;
        chunks.push(fixed('When-Other'));
        if (source[pos] === ';') {
          pos++;
          chunks.push(fixed(';'));
        }

        /*
         * An inline trailing comment immediately after When-Other's own
         * header (same line as the keyword/semicolon) renders with the
         * inline (0x4E) comment opcode, not the standalone (0x24) one the
         * general body-item dispatch below always uses via `blockComment()`
         * -- the same inline-vs-standalone distinction the ordinary `When
         * <value>` header already makes for its own trailing comment, a
         * few dozen lines above.
         *
         * DERIVED_ABS_SS.PARTIAL_DAYS.FieldChange (definition 4122):
         *
         *   When-Other; /*Hide All*\/
         *      DERIVED_ABS_SS.BGN_DT.Visible = False;
         *
         * stores the comment as 0x4E, not 0x24.
         */
        {
          const comment = captureTrailingInlineComment();
          if (comment !== undefined) {
            chunks.push(comment);
          }
        }

        // Parse When-Other body until End-Evaluate.
        while (true) {
          
          const whitespaceStart = pos;
          space();
          const bodyWhitespace = source.slice(whitespaceStart, pos);
          const hasBlankLine =
            /(?:\r?\n)[ \t]*(?:\r?\n)/.test(bodyWhitespace);
            
          if (word('End-Evaluate')) {
            if (hasBlankLine) {
              emitBlankLineMarkers(bodyWhitespace);
            }
            chunks.push(fixed('End-Evaluate'));
            return;
          }

          if (pos === source.length) {
            fail('expected End-Evaluate');
          }

          if (source.startsWith('<*', pos)) {
            if (hasBlankLine) {
              emitBlankLineMarkers(bodyWhitespace);
            }

            chunks.push(disabledCodeComment());
            continue;
          }

          if (source.startsWith('/*', pos)) {
            if (hasBlankLine) {
              emitBlankLineMarkers(bodyWhitespace);
            }

            chunks.push(blockComment());
            continue;
          }

          if (startsRemComment()) {
            if (hasBlankLine) {
              emitBlankLineMarkers(bodyWhitespace);
            }

            chunks.push(remComment(true));
            continue;
          }

          /*
           * When-Other uses the same body-spacing rule as an ordinary When:
           * one normal newline separates the clause header from its body;
           * each additional blank formatting line contributes one 0x4F.
           *
           * This is a grammar-level Evaluate-body rule, not a fixture special
           * case. Offset 171 calibrates:
           *
           *   When-Other
           *
           *      &b0k = Employee_blank_mat_pay_det();
           *
           * Stored:
           *   3E 4F 01 ...
           */
          if (hasBlankLine) {
            emitBlankLineMarkers(bodyWhitespace);
          }

          /*
           * The LAST statement in a `When-Other` body may omit its
           * trailing `;` when immediately followed by `End-Evaluate` --
           * the same allowance the ordinary `When` body loop already
           * grants any statement type before `When`/`When-Other`/
           * `End-Evaluate`, and mirrors the proven EOF-omission
           * allowance for other self-terminating top-level statement
           * shapes (assignments/If/Evaluate/bare calls/try), just at
           * this body-closing boundary instead of true source EOF.
           *
           * PTAFAW_NOTIFY.PTAFEVENT.<event> (definition 18001) is the
           * `Break`-only case this allowance originally covered; the
           * corpus also has plain assignments in the same position, e.g.
           * PA_RT_TBL.DERIVED.BEN_PLAN_EDIT (definitions 12623/12626):
           *
           *   When-Other
           *      DERIVED.BEN_PLAN_EDIT = "PA_RT_FORM_VW"
           *   End-Evaluate
           */
          statement();

          space();

          /*
           * A block comment may appear between a When-Other body
           * statement's expression and its own terminating semicolon, the
           * same way top-level statements and If/For/While bodies already
           * allow -- inline (0x4E) or standalone (0x24) by placement.
           *
           * GPFR_AF_RUNCTL.DERIVED_GPFR_AF.FieldChange (definition 5000):
           *
           *   When-Other
           *      &Evtsel(&i).DERIVED_GPFR_AF.GPFR_AF_EXTRACT_ID.Enabled = True /*False*\/;
           */
          while (source.startsWith('/*', pos)) {
            chunks.push(blockCommentByPlacement());
            space();
          }

          if (source[pos] !== ';') {
            /*
             * The last statement in a When-Other body may omit its source
             * semicolon immediately before End-Evaluate. This is the same
             * boundary rule already used by ordinary When bodies below; it
             * is not limited to Break/Continue.
             *
             * PA_RT_SCHED_VW.BENEFIT_PLAN.RowInit (definition 12623)
             * proves the assignment form, while definitions 5000 and 15626
             * independently prove concatenation and Return expressions:
             *
             *   When-Other
             *      DERIVED.BEN_PLAN_EDIT = "PA_RT_FORM_VW"
             *   End-Evaluate
             *
             * None stores a 0x15 statement terminator before 0x3F.
             */
            if (/^End-Evaluate\b/i.test(source.slice(pos))) {
              continue;
            }

            fail('expected ; in When-Other body');
          }

          pos++;
          chunks.push(fixed(';'));
          trailingBlockComments();
        }
      }

      if (word('When')) {
        sawWhen = true;
        chunks.push(fixed('When'));

        space();

        // Evaluate clauses commonly spell the selector as `When = value`.
        // The equals sign is part of the clause grammar, not an expression
        // operator, so preserve it before parsing the selector value.
        const selectorOperator = /^(?:<>|<=|>=|=|<|>)/.exec(
          source.slice(pos)
        )?.[0];
        if (selectorOperator !== undefined) {
          pos += selectorOperator.length;
          chunks.push(fixed(selectorOperator));
          space();
        }

        // Our calibrated fixture permits a parenthesized comparison here.
        if (source[pos] === '(') {
          parenthesized(booleanExpression, false);
        } else {
          expression();
        }

        /*
         * An inline trailing comment on the When header line (same line as
         * the selector value) is emitted BEFORE the structural 0x2D
         * boundary, not after it -- the same inline-vs-standalone ordering
         * already proven for And/Or-group leading comments.
         *
         * HR_ILL_NLD_AET.ABSENCE_TYPE.RowInit (definition 27819):
         *
         *   When "SKN" /*Sickness - SKN *\/
         *      &reason_sick = "1";
         *
         * stores `... "SKN" 00 4E ... 2D ...` (comment then 0x2D), not
         * `... "SKN" 00 2D 24 ...` (0x2D then a standalone-style comment).
         *
         * The structural 0x2D boundary itself comes BEFORE a When header's
         * own optional trailing source semicolon, not after it -- the
         * reverse of the order this previously emitted.
         *
         * CONTRACT.PAYMENT_TERM.FieldChange (definition 3062):
         *
         *   When = "X";
         *      UnGray(CONTRACT.PAYMENT_END_DT);
         *
         * stores `... "X" 2D 15 0A "UnGray" ...` (0x2D then 0x15), not
         * `... "X" 15 2D ...`.
         */
        emitBoundary(captureTrailingTrivia(), 0x2d);

        if (source[pos] === ';') {
          pos++;
          chunks.push(fixed(';'));
        }

        let selectorWhitespaceStart = pos;
        while (
          selectorWhitespaceStart > 0 &&
          /\s/.test(source[selectorWhitespaceStart - 1])
        ) {
          selectorWhitespaceStart--;
        }
        const selectorTrailingWhitespace =
          source.slice(selectorWhitespaceStart, pos);
        if (
          /(?:\r?\n)[ \t]*(?:\r?\n)/.test(selectorTrailingWhitespace)
        ) {
          /*
           * Preserve every blank formatting line between a When header and
           * its first body statement, the same way other calibrated
           * blank-line boundaries do: one ordinary newline is line
           * separation, each additional newline contributes one 0x4F.
           *
           * ADDRESSES.EMPLID.RowInit (definition 518):
           *
           *   When Component.RA_PERS_DATA
           *
           *
           *      DERIVED_ADDR.SELF_SERVE.Enabled = False;
           *
           * has two blank lines after the When header and stores 4F 4F, not
           * a single 4F.
           */
          emitBlankLineMarkers(selectorTrailingWhitespace);
        }

        // Parse this When body until the next clause/end.
        while (true) {
          const whitespaceStart = pos;
          space();

          const bodyWhitespace =
            source.slice(whitespaceStart, pos);

          const hasBlankLine =
            /(?:\r?\n)[ \t]*(?:\r?\n)/.test(
              bodyWhitespace
            );

          if (
            /^When(?:-Other)?\b/i.test(source.slice(pos)) ||
            /^End-Evaluate\b/i.test(source.slice(pos))
          ) {
            /*
             * Blank formatting lines between a completed When body and the
             * next When / When-Other clause are preserved as 0x4F markers.
             *
             * One ordinary newline is clause separation; each additional
             * newline contributes one 0x4F. Offset 169 calibrates both:
             *
             *   Break;
             *
             *   When = "B"       -> one 0x4F
             *
             * and:
             *
             *   Break;
             *
             *
             *   When-Other       -> two 0x4F
             */
            if (
              hasBlankLine &&
              /^When(?:-Other)?\b/i.test(source.slice(pos))
            ) {
              emitBlankLineMarkers(bodyWhitespace);
            } else if (
              hasBlankLine &&
              /^End-Evaluate\b/i.test(source.slice(pos))
            ) {
              emitBlankLineMarkers(bodyWhitespace);
            }

            break;
          }

          if (pos === source.length) {
            fail('expected End-Evaluate');
          }

          if (source.startsWith('<*', pos)) {
            if (hasBlankLine) {
              emitBlankLineMarkers(bodyWhitespace);
            }

            chunks.push(disabledCodeComment());
            continue;
          }

          if (source.startsWith('/*', pos)) {
            if (hasBlankLine) {
              /*
               * Inside a When body, PeopleTools preserves multiple blank-line
               * group boundaries before a standalone comment. One 0x4F is
               * emitted for each blank line beyond the ordinary line break.
               *
               * Example: three newline separators before the comment produce
               * two 0x4F markers.
               */
              emitBlankLineMarkers(bodyWhitespace);
            }

            chunks.push(blockComment());
            continue;
          }

          /*
           * REM inside an Evaluate/When body uses the same calibrated
           * length-prefixed 0x24 representation as REM in an If body.
           *
           * Offset 171:
           *
           *   &bok = Employee_Elig_SMP();
           *   rem &bok = Employee_MatDetails_default();
           *   &bok1 = Calculate_smp_weeks();
           *
           * Stored shape after the first call's 0x15 terminator:
           *
           *   24 <uint16 byte length> <UTF-16LE full REM text including ;>
           *
           * There is no separate 0x15 for the REM statement.
           */
          if (startsRemComment()) {
            if (hasBlankLine) {
              emitBlankLineMarkers(bodyWhitespace);
            }

            chunks.push(remComment(true));
            continue;
          }

          // Cycle 113: one 0x4F per blank line (see `emitBlankLineMarkers`).
          if (hasBlankLine) {
            emitBlankLineMarkers(bodyWhitespace);
          }

          statement();

          space();

          /*
           * A standalone comment may sit between a completed When-body
           * statement (itself omitting its own semicolon, e.g. a nested
           * `If ... End-If` with no trailing `;`) and the next `When`/
           * `End-Evaluate`, the same way one already can before those
           * keywords with no comment in between.
           *
           * CAR_PLAN_TBL.MAX_LIST_AMT.FieldFormula (definition 2484):
           *
           *   End-If
           *   /* Lease *\/
           *   When = "L"
           */
          if (
            source[pos] !== ';' &&
            source.startsWith('/*', pos) &&
            restStartsWithKeywordPastComments(/^(?:When(?:-Other)?|End-Evaluate)\b/i)
          ) {
            while (source.startsWith('/*', pos)) {
              chunks.push(blockCommentByPlacement());
              space();
            }
          }

          if (
            source[pos] !== ';' &&
            !/^When(?:-Other)?\b/i.test(source.slice(pos)) &&
            !/^End-Evaluate\b/i.test(source.slice(pos))
          ) {
            fail('expected ; in When body');
          }

          if (source[pos] === ';') {
            pos++;
            chunks.push(fixed(';'));
            trailingBlockComments();
          }
        }

        continue;
      }

      if (word('End-Evaluate')) {
        if (!sawWhen) {
          fail('Evaluate requires at least one When');
        }

        chunks.push(fixed('End-Evaluate'));
        return;
      }

      if (pos === source.length) {
        fail('expected End-Evaluate');
      }

      fail('expected When, When-Other, or End-Evaluate');
    }
  }
  const call = () => {
  const name =
    /^[A-Za-z_][A-Za-z0-9_]*#?/.exec(source.slice(pos))?.[0];

  if (!name) {
    return fail('expected a simple call name');
  }

  if (reservedCallNames.has(name.toLowerCase())) {
    fail(`keyword ${name} is not a supported call name`);
  }

  /*
   * Calibrated top-level SetDefault behavior:
   *
   *   UnGray(R.F1);
   *   ...
   *   SetDefault(R.F2);
   *   SetDefault(R.F1);
   *   R.F3 = ...;
   *
   * PeopleTools starts a fresh ordinary RECORD.FIELD allocation group at a
   * top-level SetDefault call. References encountered after that point do not
   * reuse same-name rows allocated by the preceding top-level statement run.
   *
   * Keep this scoped to bare top-level SetDefault calls. Calls inside If /
   * Evaluate / other control structures already live inside an inControlGroup()
   * allocation scope.
   */
  if (/^SetDefault$/i.test(name) && controlDepth === 0) {
    controlGroup = nextControlGroup++;
  }

  pos += name.length;

  space();

  if (source[pos] !== '(') {
    fail('bare identifiers are only supported as calls');
  }

  chunks.push(
    textOperand(
      INLINE_IDENTIFIER_OPCODE,
      TokenKind.Name,
      name
    )
  );

  /*
   * Calibrated GetSetId behavior:
   *
   * repeated Record.X arguments reuse the existing RECORD PSPCMNAME
   * entry instead of allocating another occurrence.
   *
   * Preserve the previous value because calls may nest.
   *
   * RowScrollSelect does NOT share this GLOBAL by-name rule, despite
   * being added to this same trigger list in an earlier bulk pass with no
   * citation of its own. AE_UPGCONV_WRK.AE_REFRESH.FieldChange (definition
   * 840) disproves it directly:
   *
   *   ScrollFlush(Record.MESSAGE_LOG);
   *   RowScrollSelect(1, Record.MESSAGE_LOG, Record.MESSAGE_LOG, "...", &PI);
   *
   * ScrollFlush's own Record.MESSAGE_LOG allocates its own row (NAMENUM
   * 3). RowScrollSelect's FIRST Record.MESSAGE_LOG argument does NOT
   * reuse it (fresh NAMENUM 4) -- so RowScrollSelect isn't on the global
   * by-name list -- but its SECOND Record.MESSAGE_LOG argument, in the
   * SAME call, DOES reuse the first (also NAMENUM 4) -- so it isn't
   * plain occurrence-based either. See
   * `reuseRecordReferenceWithinCallArguments`/
   * `recordReferencesWithinCallArguments` (declared near
   * `reuseRecordReferenceByName`) for the narrower "reuse only within
   * this call's own argument list" scope this actually needs.
   *
   * `ScrollSelect` (no leading "Row") shares RowScrollSelect's exact same
   * call-arguments-only rule, NOT the GLOBAL by-name rule it was bulk-added
   * to alongside GetSetId/Gray/UnGray -- same mis-citation pattern.
   * ARCH_WRK.PSARCH_COPY_ROWS.FieldChange (definition 1283) disproves the
   * global rule directly:
   *
   *   ScrollFlush(Record.ARCH_CTRL_VW2);
   *   ...
   *   ScrollSelect(1, Record.ARCH_CTRL_VW2, Record.ARCH_CTRL_VW2, &WHERE, &ARCHIVE_ID, &PARENT_TBL);
   *
   * ScrollFlush's own Record.ARCH_CTRL_VW2 allocates its own row.
   * ScrollSelect's own two Record.ARCH_CTRL_VW2 arguments do NOT reuse
   * it -- stored allocates a fresh row for them -- but the two arguments
   * DO reuse each other within that same call. Moved to
   * `reuseRecordReferenceWithinCallArguments`, mirroring RowScrollSelect.
   */
  const previousReuseRecordReferenceByName =
    reuseRecordReferenceByName;
  const previousReuseRecordReferenceWithinControlGroup =
    reuseRecordReferenceWithinControlGroup;
  const previousMarksControlGroupParticipant =
    marksControlGroupParticipant;
  const previousReuseRowShorthandRecord =
    reuseRowShorthandRecord;
  const previousCaptureRowsetElementRecord =
    captureRowsetElementRecord;
  const previousReuseScrollReferenceWithinControlGroup =
    reuseScrollReferenceWithinControlGroup;
  const previousReuseRecordReferenceWithinCallArguments =
    reuseRecordReferenceWithinCallArguments;
  const previousRecordReferencesWithinCallArguments =
    recordReferencesWithinCallArguments;
  const previousSingleOccurrenceCallArgumentRecordNames =
    singleOccurrenceCallArgumentRecordNames;
  const previousSuppressRecordReferenceControlGroupWrite =
    suppressRecordReferenceControlGroupWrite;

  if (/^(?:GetSetId|Gray|UnGray)$/i.test(name)) {
    reuseRecordReferenceByName = true;
  }
  if (/^PriorValue$/i.test(name)) {
    suppressRecordReferenceControlGroupWrite = true;
  }
  if (/^(?:RowScrollSelect(?:New)?|ScrollSelect)$/i.test(name)) {
    /*
     * ANALYSIS_DB_WRK.BASE_CUBE_INST_ID.FieldChange (definition 1145)
     * proves `RowScrollSelectNew` shares RowScrollSelect's exact rule:
     *
     *   RowScrollSelectNew(1, Record.ANALYSIS_DB_DIM, Record.ANALYSIS_DB_DIM, "...", ANALYSIS_DB.BASE_CUBE_INST_ID);
     *
     * Both Record.ANALYSIS_DB_DIM arguments, in the same call, reuse one
     * PSPCMNAME row. ARCH_WRK.PSARCH_COPY_ROWS.FieldChange (definition
     * 1283) proves plain `ScrollSelect` (no leading "Row") shares it too.
     */
    reuseRecordReferenceWithinCallArguments = true;
    recordReferencesWithinCallArguments = new Map();

    singleOccurrenceCallArgumentRecordNames = (() => {
      if (source[pos] !== '(') return undefined;

      const counts = new Map<string, number>();
      let i = pos + 1;
      let depth = 1;

      while (i < source.length && depth > 0) {
        const ch = source[i];

        if (ch === '(') {
          depth++;
          i++;
        } else if (ch === ')') {
          depth--;
          i++;
        } else if (ch === '"') {
          i++;
          while (i < source.length && source[i] !== '"') i++;
          i++;
        } else {
          const recordMatch =
            /^Record\.([A-Za-z_][A-Za-z0-9_]*)/i.exec(source.slice(i));

          if (recordMatch) {
            const key = recordMatch[1].toLowerCase();
            counts.set(key, (counts.get(key) ?? 0) + 1);
            i += recordMatch[0].length;
          } else {
            i++;
          }
        }
      }

      const singles = new Set<string>();
      for (const [recordName, count] of counts) {
        if (count === 1) singles.add(recordName);
      }
      return singles;
    })();
  }

  /*
   * Unlike RowScrollSelect (no cross-call evidence either way yet), a
   * plain `ScrollSelect` call's OWN fresh allocations must also become
   * visible to a LATER ScrollSelect call in the same control group --
   * not merely reused within its own argument list.
   *
   * ABSENCE_HIST.ABSENCE_TYPE.RowInit (definition 30, protected baseline)
   * has two TEXTUALLY IDENTICAL calls in the same control group, each
   * inside its own `If Not RecordNew(...) Then ... End-If;`:
   *
   *   ScrollSelect(2, Record.ABSENCE_HIST, Record.ABS_HIST_DET, Record.ABS_HIST_DET, "...", ...);
   *   ...
   *   ScrollSelect(2, Record.ABSENCE_HIST, Record.ABS_HIST_DET, Record.ABS_HIST_DET, "...", ...);
   *
   * The second call's Record.ABSENCE_HIST/Record.ABS_HIST_DET arguments
   * reuse the FIRST call's own rows entirely, not fresh ones -- disproven
   * for RowScrollSelect specifically (definition 840) but proven true for
   * ScrollSelect here. Marking participating does not reopen the 1283
   * ScrollFlush-then-ScrollSelect case: a single-argument ScrollFlush call
   * still does not mark participating (see `isMultiArgScrollFlushCall`),
   * so ScrollSelect's read still finds nothing there and allocates fresh,
   * exactly as 1283 requires.
   */
  if (/^ScrollSelect$/i.test(name)) {
    marksControlGroupParticipant = true;
  }

  /*
   * GetRecord, DeleteRow and ActiveRowCount's Record.X argument reuse an
   * existing same-control-group RECORD PSPCMNAME row rather than
   * allocating a fresh one.
   *
   * CAN_TAX_TYPE.SOURCE_TAX.FieldChange (definition 2406):
   *
   *   For &i = ActiveRowCount(Record.CAN_TAX_TYPE, ..., Record.CAN_TAX_STCLASS) To 1 Step - 1
   *      DeleteRow(Record.CAN_TAX_TYPE, ..., Record.CAN_TAX_STCLASS, &i)
   *   End-For;
   *   If ... Then
   *      For &i = ActiveRowCount(Record.CAN_TAX_TYPE, ..., Record.CAN_TAX_CLASS) To 1 Step - 1
   *   ...
   *
   * stores DeleteRow's Record.CAN_TAX_TYPE and Record.CAN_TAX_STCLASS
   * reusing the exact same PSPCMNAME rows ActiveRowCount's own arguments
   * allocated two statements earlier, in the same For loop's control
   * group -- but the *second* If/For's ActiveRowCount call, in a
   * different top-level control group, allocates a *fresh* Record.
   * CAN_TAX_TYPE row rather than reusing the first loop's. ActiveRowCount
   * was previously in the reuseRecordReferenceByName set below, which
   * searches `references` globally with no control-group scoping --
   * correct only by coincidence for single-control-group fixtures, and
   * wrong here. Moving it to this control-group-scoped mechanism instead
   * (checked first in recordReference()'s lookup chain) preserves
   * identical behavior for every fixture where all ActiveRowCount calls
   * either share one control group or live at plain top level (which all
   * share controlGroup 0 unless a top-level SetDefault call bumps it),
   * and only changes output for multiple ActiveRowCount calls to the same
   * record name across genuinely different top-level control groups --
   * exactly the previously-wrong case.
   *
   * This is purely additive for GetRecord/DeleteRow:
   * recordReferencesByControlGroup is only ever populated by a reference
   * that has already occurred, so it cannot change output for a call
   * whose record name has not appeared earlier in the same control group
   * (the common case today).
   *
   * UpdateValue's own Record.X argument shares this same control-group
   * reuse rule. ARCH_TBL.RECNAME.SavePreChange (definition 1269) proves it:
   *
   *   For &K = 1 To &ALL_ROWS
   *      UpdateValue(Record.ARCH_TBL, &I, ARCH_CTRL.PSARCH_MATCH_KEY, &K, &K);
   *      If &K = 1 Then
   *         UpdateValue(Record.ARCH_TBL, &I, ARCH_CTRL.PSARCH_AND_OR, &K, " ");
   *      End-If;
   *   End-For;
   *
   * The second UpdateValue's Record.ARCH_TBL (nested one control-depth
   * deeper, but still control group 1 -- only top-level entry bumps the
   * group) reuses the exact same PSPCMNAME row the first UpdateValue's
   * Record.ARCH_TBL allocated moments earlier in the same For-loop body,
   * rather than allocating a fresh one.
   *
   * InsertRow's own Record.X argument shares the same rule. The same
   * definition 1269, deep inside a nested For/If chain within that same
   * top-level For &L loop's control group:
   *
   *   ScrollFlush(Record.ARCH_TMP_RECUNQ);
   *   ...
   *   InsertRow(Record.ARCH_TMP_RECUNQ, &RT - 1);
   *
   * reuses the ARCH_TMP_RECUNQ row already allocated earlier in that same
   * control group rather than allocating a fresh one.
   *
   * SetCursorPos's own Record.X argument shares the same rule.
   * BENEF_PB_WRK.BEN_CLEAR_PB.FieldChange (definition 1738):
   *
   *   &ActRowCnt = ActiveRowCount(Record.BEN_BI_CHARGE);
   *   SetCursorPos(%Panel, Record.BEN_BI_CHARGE, &ActRowCnt, BEN_BI_CHARGE.EMPLID);
   *
   * SetCursorPos's Record.BEN_BI_CHARGE reuses the RECORD row
   * ActiveRowCount's own argument allocated one statement earlier, in the
   * same top-level If's control group.
   *
   * This mechanism is control-group-scoped, not function-scoped -- see the
   * "top-level-of-a-Function-body statement gets its own fresh control
   * group" fix in functionStatement()'s body loop (cites definition 871)
   * for why a flat run of top-level-of-function statements does not
   * spuriously reuse each other's rows even though this reuse rule applies
   * unconditionally here.
   *
   * HideScroll/UnhideScroll/UnhideRow's own Record.X argument share the
   * same rule -- also cited by definition 871, inside
   * `Function adjust_row_num`'s nested If/Else:
   *
   *   If ActiveRowCount(Record.AE_STMT_TBL) = 1 And None(&SECTION, &STEP) Then
   *      AE_WRK.AE_ROW_COUNT = 0;
   *      HideScroll(Record.AE_STMT_TBL);
   *   Else
   *      UnhideScroll(Record.AE_STMT_TBL);
   *      AE_WRK.AE_ROW_COUNT = ActiveRowCount(Record.AE_STMT_TBL);
   *      For &ROW = ActiveRowCount(Record.AE_STMT_TBL) To 1 Step - 1
   *         UnhideRow(Record.AE_STMT_TBL, &ROW);
   *      ...
   *
   * Every one of these Record.AE_STMT_TBL mentions reuses the exact same
   * PSPCMNAME row the If's own condition allocated -- not just the ones
   * already covered by ActiveRowCount above. Before this addition,
   * HideScroll/UnhideScroll/UnhideRow's own fresh allocations (bypassing
   * the reuse check because they were not yet in this list) would
   * overwrite the shared control-group cache entry, breaking reuse for
   * every reference after them too.
   *
   * CopyFields' own Record.X arguments share the same rule. The same
   * definition 871, inside `Function man_stmt` (a flat, untriggered
   * top-level-of-function run following one InsertRow trigger statement):
   *
   *   InsertRow(Record.AE_STMT_TBL, ActiveRowCount(Record.AE_STMT_TBL));
   *   &TO_ROW = ActiveRowCount(Record.AE_STMT_TBL);
   *   CopyFields(1, Record.AE_TOOLS_CHK_VW, &ROW, 1, Record.AE_STMT_TBL, &TO_ROW);
   *
   * CopyFields' second Record.X argument (Record.AE_STMT_TBL) reuses the
   * same row InsertRow's own trigger-statement group established, exactly
   * like the plain assignment `&TO_ROW = ActiveRowCount(...)` between them
   * already does via ActiveRowCount's own reuse rule -- CopyFields itself
   * is not a trigger statement (see the ScrollFlush/HideScroll/InsertRow
   * trigger in the bare-call name dispatcher above), it simply continues
   * in whichever group is currently active and reuses within it like any
   * other reuse-enabled name.
   *
   * RecordDeleted's and RecordChanged's own Record.X arguments share the
   * same rule. ADDRESS_TYPE_FL.EMPLID.SavePreChange (definition 534):
   *
   *   (&new_row = True Or
   *      RecordDeleted(Record.ADDRESS_TYPE_FL) Or
   *      RecordChanged(Record.ADDRESS_TYPE_FL)) Then
   *
   * RecordChanged's Record.ADDRESS_TYPE_FL reuses the exact same
   * PSPCMNAME row RecordDeleted's own argument allocated moments earlier,
   * in the same If condition's control group.
   *
   * CreateRowset's own Record.X argument shares the same rule.
   * AE_DERIVED.REFRESH_BTN.SavePreChange (definition 808):
   *
   *   &group = &RSComponent.GetRow(1).GetRecord(Record.DAEMONGROUP)
   *              .GetField(Field.DAEMONGROUP).Value;
   *   &RSDaemon = CreateRowset(Record.DAEMONGROUP);
   *   ...
   *   &RSDaemon.GetRow(...).GetRecord(Record.DAEMONGROUP).Delete();
   *   ...
   *   &RSComponent.GetRow(&i).GetRecord(Record.DAEMONGROUP).Insert();
   *
   * All four Record.DAEMONGROUP occurrences, spanning the GetRecord call,
   * CreateRowset's own argument, and two later GetRecord calls inside
   * separate For loops, reuse the SAME single PSPCMNAME RECORD row --
   * stored's PSPCMNAME table has only one RECORD/DAEMONGROUP entry, not
   * two. Without CreateRowset in this list, its own Record.X argument
   * allocated a fresh row (bypassing the reuse check) and then every
   * later GetRecord call reused THAT wrong row instead of the original.
   *
   * FetchValue's own Record.X argument shares the same rule.
   * ANALYSIS_DB_DIM.DIMENSION_ID.FieldEdit (definition 1128):
   *
   *   &N_AGG_COUNT = ActiveRowCount(ANALYSIS_DB.ANALYSIS_DB_ID, &N_INST_ID, Record.CUBE_AGG_DEF);
   *   For &N_AGG_NUM = 1 To &N_AGG_COUNT
   *      ... Record.CUBE_AGG_DEF, &N_AGG_NUM, Record.CUBE_AGG_DIM);
   *      For &N_AGG_DIM_NUM = 1 To &N_AGG_DIM_COUNT
   *         &S_AGG_DIM_ID = FetchValue(ANALYSIS_DB.ANALYSIS_DB_ID, &N_INST_ID, Record.CUBE_AGG_DEF, &N_AGG_NUM, CUBE_AGG_DIM.DIMENSION_ID, &N_AGG_DIM_NUM);
   *
   * FetchValue's Record.CUBE_AGG_DEF argument reuses the exact same
   * PSPCMNAME RECORD row the earlier ActiveRowCount calls already
   * established in the same control group. FetchValue therefore belongs in
   * the ordinary control-group reuse policy alongside GetRecord,
   * ActiveRowCount, and the other participating calls.
   *
   * DoModalPanelGroup's own Record.X argument shares the same rule.
   * ANALYSIS_DB_WRK.PB_OPEN_ANL_MODEL.FieldChange (definition 1152):
   *
   *   If ANALYSIS_DB_WRK.BASE_CUBE_TYPE = "D" Then
   *      ...
   *      DoModalPanelGroup(..., Panel.CUBE_DEF, &S_MODE, Record.ANALYSIS_DB_WRK);
   *   Else
   *      If ANALYSIS_DB_WRK.BASE_CUBE_TYPE = "I" Then
   *         ...
   *         DoModalPanelGroup(..., Panel.ANALYSIS_DB, "U", Record.ANALYSIS_DB_WRK);
   *      End-If;
   *   End-If;
   *
   * Both DoModalPanelGroup calls' own Record.ANALYSIS_DB_WRK argument
   * (one in the If body, one in a nested If inside the Else body -- still
   * the same top-level control group, since the nested If is not itself
   * a fresh top-level control structure) reuse the SAME PSPCMNAME RECORD
   * row.
   *
   * SortScroll's own Record.X argument shares the same rule.
   * ANL_MOD_DIM_FLD.COMPONENT_NBR.RowDelete (definition 1187):
   *
   *   If %Panel = Panel.CUBE_INPUT_FLD Then
   *      &I_COMP_COUNT = ActiveRowCount(Record.ANL_MOD_DIM_FLD);
   *      ...
   *      For &I_COMP_NUM = &I_STARTING_COMP To &I_COMP_COUNT
   *         UpdateValue(ANL_MOD_DIM_FLD.COMPONENT_NBR, &I_COMP_NUM, &I_COMP_NUM - 1);
   *      End-For;
   *      SortScroll(1, Record.ANL_MOD_DIM_FLD, ANL_MOD_DIM_FLD.COMPONENT_NBR, "A");
   *   End-If;
   *
   * SortScroll's own Record.ANL_MOD_DIM_FLD argument (after the nested
   * For loop closes and control returns to the enclosing If-body group)
   * reuses the ActiveRowCount call's earlier row -- SortScroll was
   * missing from this list, so it always allocated fresh.
   *
   * ScrollFlush's own Record.X argument shares the same rule.
   * ARCH_OTH_CTRL.RECNAME1.FieldChange (definition 1236):
   *
   *   &L = ActiveRowCount(Record.ARCH_TBL, &I, Record.ARCH_OTH_CTRL);
   *   ...
   *   If &EXIST <> "X" Then
   *      ScrollFlush(Record.ARCH_TBL, &I, Record.ARCH_KEYFLD_VW2);
   *      ...
   *      RowScrollSelect(2, Record.ARCH_TBL, ...);
   *      &P = ActiveRowCount(Record.ARCH_TBL, &I, Record.ARCH_COMMON_KEY);
   *      ...
   *      ScrollFlush(Record.ARCH_TBL, &I, Record.ARCH_KEYFLD_VW2);
   *   End-If;
   *
   * Without ScrollFlush in this list, its own Record.ARCH_TBL argument
   * always allocated a fresh row (unconditionally overwriting the
   * control-group cache, same failure shape as fix #18), poisoning every
   * later same-name reference in the group -- both ScrollFlush calls and
   * everything between them should reuse the ActiveRowCount call's
   * original row.
   *
   * `Hide`/`UnHide` (not `HideScroll`/`UnhideScroll` -- distinct functions,
   * field-level rather than scroll-level) share the same rule.
   * ARCH_WRK.PSARCH_COPY_ROWS.FieldChange (definition 1283):
   *
   *   Hide(Record.ARCH_TBL, &I, ARCH_OTH_CTRL.PSARCH_MATCHVAL1, &SEQ);
   *   UnHide(Record.ARCH_TBL, &I, ARCH_OTH_CTRL.PSARCH_MATCHDT1, &SEQ);
   *
   * repeated several times reuse the same control-group Record.ARCH_TBL
   * row rather than each allocating a fresh one.
   *
   * `Gray`/`UnGray`'s own Record.X argument needs this SAME control-group
   * check too, even though they are ALSO on the global by-name list
   * (`reuseRecordReferenceByName` a few lines below) -- that global list
   * is checked strictly AFTER this control-group check in
   * `recordReference()`'s priority order, so adding them here only takes
   * priority when a control-group establishment actually exists; it does
   * not remove or override whatever the by-name behavior was originally
   * validated for.
   *
   * ARCH_WRK.PSARCH_COPY_ROWS.FieldChange (definition 1283), continuing
   * the same construct as the Hide/UnHide evidence above:
   *
   *   ScrollFlush(Record.ARCH_TBL, &I, Record.ARCH_KEYFLD_VW2);
   *   ...
   *   Gray(Record.ARCH_TBL, &I, ARCH_OTH_CTRL.PSARCH_MATCHVAL1, &SEQ);
   *
   * Gray's own Record.ARCH_TBL argument reuses ScrollFlush's
   * control-group row, NOT the very first ARCH_TBL reference anywhere in
   * the program (which is what the global by-name rule alone found).
   *
   * `HideRow` (distinct from `HideScroll`/`UnhideRow` -- both already on
   * this list, but the plain `HideRow` counterpart was missing entirely).
   * BAS_ENR_RUNCTL.PASSIVE_EVENT_IND.FieldChange (definition 1549):
   *
   *   DeleteRow(Record.BAS_ENR_PASSIVE, &I);
   *   ...
   *   HideRow(Record.BAS_ENR_PASSIVE, 1);
   *   ...
   *   UnhideRow(Record.BAS_ENR_PASSIVE, 1);
   *
   * `HideRow`'s own Record.BAS_ENR_PASSIVE argument reuses DeleteRow's
   * earlier control-group row; without `HideRow` on this list it always
   * allocated fresh, poisoning the later `UnhideRow` reuse too (same
   * failure shape as fix #18).
   *
   * Bare `GetRowset(Record.X)` (assigned to a variable, distinct from
   * `.GetRowset(Scroll.X)` as a postfix method call, and from
   * `CreateRowset`, already on this list) shares the same rule.
   * GPHK_PSLP.GPHK_EXCL_PRNT.FieldChange (definition 8093):
   *
   *   Evaluate GPHK_PSLP.GPHK_EXCL_PRNT
   *   When = "20"
   *      &RS = GetRowset(Record.GPHK_PSLP_LOCTN);
   *      ...
   *   When-Other
   *      &RS = GetRowset(Record.GPHK_PSLP_LOCTN);
   *      ...
   *   End-Evaluate
   *
   * the `When-Other` clause's own `GetRowset(Record.GPHK_PSLP_LOCTN)`
   * reuses the `When = "20"` clause's own row -- both `When` clause
   * bodies share one control group (only the `Evaluate` statement's own
   * entry bumps it, not each individual `When`).
   */
  if (/^(?:GetRecord|DeleteRow|ActiveRowCount|UpdateValue|InsertRow|SetCursorPos|HideScroll|UnhideScroll|UnhideRow|HideRow|CopyFields|RecordDeleted|RecordChanged|CreateRowset|GetRowset|FetchValue|DoModalPanelGroup|SortScroll|ScrollFlush|Hide|UnHide|Gray|UnGray)$/i.test(name)) {
    reuseRecordReferenceWithinControlGroup = true;
  }
  /*
   * See `marksControlGroupParticipant`'s own declaration: every name above
   * EXCEPT ScrollFlush marks its own fresh allocation as a visible
   * "participating" source for a later RowScrollSelect/ScrollSelect call.
   */
  if (/^(?:GetRecord|DeleteRow|ActiveRowCount|UpdateValue|InsertRow|SetCursorPos|HideScroll|UnhideScroll|UnhideRow|HideRow|CopyFields|RecordDeleted|RecordChanged|CreateRowset|GetRowset|FetchValue|DoModalPanelGroup|SortScroll|Hide|UnHide|Gray|UnGray)$/i.test(name)) {
    marksControlGroupParticipant = true;
  }
  if (/^CreateRecord$/i.test(name)) {
    reuseRowShorthandRecord = true;
  }
  if (/^CreateRowset$/i.test(name)) {
    captureRowsetElementRecord = true;
  }

  /*
   * Scroll.X arguments to ActiveRowCount/UpdateValue/Gray/UnGray share the
   * same control-group-scoped reuse rule as Record.X arguments above.
   *
   * DEDUCTION_TBL.SPCL_PROCESS.FieldChange (definition 3586):
   *
   *   For &I = 1 To ActiveRowCount(Scroll.DEDUCTION_TBL, CurrentRowNumber(1), Scroll.DEDUCTION_CLASS);
   *      UpdateValue(Scroll.DEDUCTION_TBL, CurrentRowNumber(1), Scroll.DEDUCTION_CLASS, &I, DEDUCTION_CLASS.DED_CLASS, "A");
   *      ...
   *      Gray(Scroll.DEDUCTION_TBL, CurrentRowNumber(1), Scroll.DEDUCTION_CLASS, &I, DEDUCTION_CLASS.DED_CLASS);
   *      ...
   *   End-For;
   *
   * Every UpdateValue/Gray call's Scroll.DEDUCTION_TBL and
   * Scroll.DEDUCTION_CLASS arguments reuse the exact same PSPCMNAME SCROLL
   * rows the loop header's ActiveRowCount call allocated, rather than each
   * one allocating a fresh row.
   *
   * DeleteRow's own Scroll.X argument shares the same rule.
   * BENEF_PB_WRK.BEN_CLEAR_PB.FieldChange (definition 1738):
   *
   *   &I = ActiveRowCount(Scroll.BEN_PRIJOB_LIST);
   *   While &I > 0
   *      DeleteRow(Scroll.BEN_PRIJOB_LIST, &I);
   *      &I = &I - 1;
   *   End-While;
   *
   * DeleteRow's Scroll.BEN_PRIJOB_LIST reuses the SCROLL row
   * ActiveRowCount's own argument allocated one statement earlier, in the
   * same top-level If's control group.
   *
   * Control-group-scoped, not function-scoped -- see the note on the
   * Record.X reuse rule above.
   *
   * HideScroll/UnhideScroll share the same rule (their own Scroll.X
   * argument both contributes to and reads from the same control-group
   * pool, mirroring how they already joined the analogous Record.X
   * reuse-checking list -- see that note above).
   * ADSRECORDS1_WRK.QRYSEARCHBTN.FieldChange (definition 772):
   *
   *   If &nCount = 0 Then
   *      HideScroll(Scroll.ADSRECORDS1_DVW);
   *      ...
   *   Else
   *      UnhideScroll(Scroll.ADSRECORDS1_DVW);
   *      ...
   *   End-If;
   *
   * UnhideScroll's Scroll.ADSRECORDS1_DVW reuses the exact same PSPCMNAME
   * SCROLL row HideScroll's own argument allocated in the other branch of
   * the same top-level If's control group.
   *
   * `FetchValue`'s own Scroll.X argument shares the same rule.
   * BAS_PAR_VW-based Function Update_Event_Display (definition 1627):
   *
   *   &BENRCD = FetchValue(Scroll.BAS_PAR_VW, &I, BAS_PAR_VW.BENEFIT_RCD_NBR);
   *   &EVENT_ID = FetchValue(Scroll.BAS_PAR_VW, &I, BAS_PAR_VW.EVENT_ID);
   *
   * The second FetchValue's own Scroll.BAS_PAR_VW argument reuses the
   * first's, rather than allocating fresh.
   */
  if (/^(?:ActiveRowCount|UpdateValue|Gray|UnGray|DeleteRow|HideScroll|UnhideScroll|FetchValue)$/i.test(name)) {
    reuseScrollReferenceWithinControlGroup = true;
  }

  /*
   * ScrollFlush's OWN participating-map visibility (see
   * `marksControlGroupParticipant`) depends on how many arguments THIS
   * call has, not just the call name.
   *
   * AE_UPGCONV_WRK.AE_REFRESH.FieldChange (definition 840):
   *   ScrollFlush(Record.MESSAGE_LOG);  -- single argument
   * does not mark participating (a later RowScrollSelect allocates fresh,
   * does not find it).
   *
   * ARCH_OTH_CTRL.RECNAME1.FieldChange (definition 1236) and
   * ARCH_WRK.PSARCH_COPY_ROWS.FieldChange (definition 1283):
   *   ScrollFlush(Record.ARCH_TBL, &I, Record.ARCH_KEYFLD_VW2);  -- 3 args
   * DOES mark participating -- and not merely for the third (child)
   * argument: a later RowScrollSelect's own FIRST Record.ARCH_TBL argument
   * (the parent, same position as the single-argument form) reuses it too
   * (definition 1283's own diff, once the third-argument-only version of
   * this rule was disproven). So the distinguishing factor is argument
   * COUNT for the whole call, not argument position within it.
   */
  const isMultiArgScrollFlushCall =
    /^ScrollFlush$/i.test(name) && (() => {
      let i = pos;
      if (source[i] !== '(') return false;
      i++;
      let localDepth = 1;
      while (i < source.length && localDepth > 0) {
        const ch = source[i];
        if (ch === '(') {
          localDepth++;
        } else if (ch === ')') {
          localDepth--;
          if (localDepth === 0) break;
        } else if (ch === ',' && localDepth === 1) {
          return true;
        } else if (ch === '"') {
          i++;
          while (i < source.length && source[i] !== '"') i++;
        }
        i++;
      }
      return false;
    })();

  if (isMultiArgScrollFlushCall) {
    marksControlGroupParticipant = true;
  }

  try {
    parenthesized(() => {
      expression();
      space();

      while (source[pos] === ',') {
        pos++;
        chunks.push(fixed(','));
        expression();
        space();
      }
    }, true);
  } finally {
    /*
     * A RowScrollSelect/RowScrollSelectNew call's LAST Record.X argument
     * (its ultimate "to" table, immediately preceding the SQL where-clause
     * string) becomes visible to a LATER statement's own control-group-
     * scoped reuse check (the same `recordReferencesByControlGroup` pool
     * GetRecord/DeleteRow/ActiveRowCount/UpdateValue/etc already read from
     * via `reuseRecordReferenceWithinControlGroup`) -- unlike every other
     * Record.X argument earlier in the same call, which stays call-private
     * (see `reuseRecordReferenceWithinCallArguments`'s own comment for why).
     *
     * ANALYSIS_DB_WRK.BASE_CUBE_INST_ID.FieldChange (definition 1145):
     *
     *   RowScrollSelectNew(1, Record.ANALYSIS_DB_DIM, Record.ANL_MOD_DIM, "where ANALYSIS_MODEL_ID=:1 ORDER BY MEASURES_DIM_FLG DESC", ANALYSIS_DB.ANALYSIS_MODEL_ID);
     *   ...
     *   UpdateValue(DERIVED.EDITTABLE15, &N_DIM_NUM, Record.ANL_MOD_DIM);
     *
     * RowScrollSelectNew's own fresh Record.ANL_MOD_DIM argument (its last
     * record-typed argument) is reused by the later UpdateValue call's own
     * Record.ANL_MOD_DIM argument, several statements later in the same
     * control group -- not a fresh allocation. UpdateValue reads via
     * `reuseRecordReferenceWithinControlGroup`, which only ever consults
     * `recordReferencesByControlGroup` (never the separate
     * `participatingRecordReferencesByControlGroup` map RowScrollSelect's
     * OWN argument lookup uses), so this registers there directly rather
     * than through that other map. Scoped narrowly to the LAST entry in
     * this call's own `recordReferencesWithinCallArguments` map
     * (insertion-ordered, so the last entry is the last distinct record
     * name this call's own argument list introduced) so earlier, non-final
     * Record.X arguments in the same call keep their proven call-private
     * behavior (ARCH_WRK... definition 1172: neither ActiveRowCount's
     * Record.ANL_MOD_DAT_SRC "from" argument nor its Record.ANL_MOD_DIM_FLD
     * argument -- both NOT the last record argument in that RowScrollSelectNew
     * call -- reuse RowScrollSelectNew's own rows).
     */
    if (
      /^RowScrollSelect(?:New)?$/i.test(name) &&
      recordReferencesWithinCallArguments.size > 0
    ) {
      const lastCallArgumentReference = Array.from(
        recordReferencesWithinCallArguments.values()
      ).pop()!;

      if (lastCallArgumentReference.recordName !== undefined) {
        dependencyScope.recordRecord(
          lastCallArgumentReference.recordName,
          lastCallArgumentReference
        );
      }
    }

    /*
     * See `genericRecordReferencesSinceLastFamilyCall`'s own declaration
     * (definition 843 vs definition 860): every RowScrollSelect-family
     * call -- including this one -- ends the "carry an ordinary call's
     * fresh row forward into the next single-occurrence lookup" window.
     * This call's OWN resolution already read the map above (in the `try`
     * block); clearing here only affects whatever follows it.
     */
    if (/^(?:RowScrollSelect(?:New)?|ScrollSelect)$/i.test(name)) {
      genericRecordReferencesSinceLastFamilyCall.clear();
    }

    reuseRecordReferenceByName =
      previousReuseRecordReferenceByName;
    reuseRecordReferenceWithinControlGroup =
      previousReuseRecordReferenceWithinControlGroup;
    marksControlGroupParticipant =
      previousMarksControlGroupParticipant;
    reuseRowShorthandRecord =
      previousReuseRowShorthandRecord;
    captureRowsetElementRecord =
      previousCaptureRowsetElementRecord;
    reuseScrollReferenceWithinControlGroup =
      previousReuseScrollReferenceWithinControlGroup;
    reuseRecordReferenceWithinCallArguments =
      previousReuseRecordReferenceWithinCallArguments;
    recordReferencesWithinCallArguments =
      previousRecordReferencesWithinCallArguments;
    singleOccurrenceCallArgumentRecordNames =
      previousSingleOccurrenceCallArgumentRecordNames;
    suppressRecordReferenceControlGroupWrite =
      previousSuppressRecordReferenceControlGroupWrite;
  }
};

  /*
   * Cycle 9 (Phase 9C) named the postfix reuse-policy dispatch. The
   * receiver-specific `recordVariableFields` lookup remains first choice,
   * followed by the authoritative scoped FIELD namespace. RECORD paths keep
   * their independently calibrated policies.
   *
   * This function still does not decide whether `member` is a dependency;
   * the caller's ChainSemantics/DependencyKind decision remains upstream.
   */
  const resolvePostfixMemberReuse = (
    member: string,
    dependencyKind: DependencyKind,
    isMethodCall: boolean,
    explicitRecordRootName: string | undefined,
    baseVariableName: string | undefined,
    directLevel0RecordFieldKey: string | undefined
  ): PeopleCodeReference | undefined => {
    if (dependencyKind === 'field') {
      if (explicitRecordRootName === undefined) {
        const receiverBinding = readTracedReusePool(
          'recordVariableFields',
          recordVariableFields,
          `${fieldScopeId()}:${baseVariableName?.toLowerCase() ?? ''}:${member.toLowerCase()}`,
          'postfixResolve:record-variable-field',
          pos - member.length
        );
        if (receiverBinding !== undefined) return receiverBinding;
      }

      return fieldDependencyScope.lookupField(member);
    }

    if (dependencyKind === 'record' && isMethodCall) {
      return references.find(
        item => item.kind === 'scroll' && same(item.recordName, member)
      );
    }

    if (dependencyKind !== 'record') return undefined;
    if (directLevel0RecordFieldKey !== undefined) {
      return level0RowsetRecordsByField.get(directLevel0RecordFieldKey);
    }

    return rowShorthandRecordsByBase.get(
      `${controlGroup}:${baseVariableName?.toLowerCase() ?? ''}:${member.toLowerCase()}`
    ) ?? rowsetElementRecords.get(member.toLowerCase()) ??
      rowShorthandRecordsByControlGroup.get(
        `${controlGroup}:${member.toLowerCase()}`
      ) ??
      /*
       * Cycle 43: this is the SAME map `dependencyScope.recordRecord`
       * writes to (see `recordScopeId()`'s own declaration comment) --
       * must use the identical key computation, not raw `controlGroup`,
       * or an Application Class context whose write side is
       * method-wide-scoped silently stops finding what it wrote.
       */
      recordReferencesByControlGroup.get(
        `${recordScopeId()}:${member.toLowerCase()}`
      );
  };

  /*
   * The Cycle 9 write-back companion to `resolvePostfixMemberReuse`.
   * Receiver-specific FIELD bindings and independently calibrated RECORD
   * policies remain explicit; all eligible FIELD producers also populate the
   * authoritative scoped namespace.
   */
  const recordPostfixMemberReuse = (
    member: string,
    dependencyKind: DependencyKind,
    explicitRecordRootName: string | undefined,
    baseVariableName: string | undefined,
    directLevel0RecordFieldKey: string | undefined,
    fieldMemberFromGetRecord: boolean,
    reference: PeopleCodeReference,
    registersFieldByName = false
  ): void => {
    if (
      dependencyKind === 'record' &&
      reference.kind === 'record'
    ) {
      if (directLevel0RecordFieldKey !== undefined) {
        level0RowsetRecordsByField.set(
          directLevel0RecordFieldKey,
          reference
        );
      }
      writeTracedReusePool(
        'rowShorthandRecords',
        rowShorthandRecords,
        member.toLowerCase(),
        reference,
        'postfixRecord:row-shorthand-record',
        pos - member.length
      );
      rowShorthandRecordsByBase.set(
        `${controlGroup}:${baseVariableName?.toLowerCase() ?? ''}:${member.toLowerCase()}`,
        reference
      );
      rowShorthandRecordsByControlGroup.set(
        `${controlGroup}:${member.toLowerCase()}`,
        reference
      );
      // Cycle 119: and in the method-wide record scope (see the session lookup above)
      if (context?.recordDependenciesHaveMethodWideLifetime) dependencyScope.recordRecord(member, reference);
    } else if (
      dependencyKind === 'field' &&
      baseVariableName !== undefined
    ) {
      writeTracedReusePool(
        'recordVariableFields',
        recordVariableFields,
        `${fieldScopeId()}:${baseVariableName.toLowerCase()}:${member.toLowerCase()}`,
        reference,
        'postfixRecord:record-variable-field',
        pos - member.length
      );
    }

    if (
      dependencyKind === 'field' &&
      reference.kind === 'field' &&
      (
        explicitRecordRootName !== undefined ||
        baseVariableName !== undefined ||
        fieldMemberFromGetRecord ||
        /*
         * Cycle 119: in an Application Class body, a FIELD after a
         * Row-shorthand RECORD (`GetLevel0()(1).PSADSDMW_WRK.PTSESSIONID`,
         * twice in one 28764 statement) registers too -- stored keeps one
         * row per field name (repeats: 5,305 reuse, 19 open, all in 29797
         * / 30170 / 30179).
         *
         * Cycle 118: a declared Record value with no variable of its own
         * (a Record-typed property, `%This.ObjectRecord`) registers its
         * FIELD rows in the same scope, so a later use of the field reuses
         * the row (29954: one APPROVEOPRID row for its repeated
         * `%This.<rec>.APPROVEOPRID`).
         */
        registersFieldByName
      )
    ) {
      fieldDependencyScope.recordField(member, reference);
    }
  };

  const primary = () => {
    space();

    // Bare postfix (...) is calibrated for variable/object indexing such as
    // &rs(1). Do not make every literal/value callable (e.g. True()).
    let allowDirectPostfixCall = source[pos] === '&';
    /*
     * A bare `GetRecord(...)` call (no leading `&variable.` receiver) puts
     * the expression straight into field-reference mode for whatever
     * `.MEMBER` follows, exactly like a `.GetRecord(...)` postfix step
     * later in a chain already does.
     *
     * ADDRESS_TYPE_VW.ADDRESS_TYPE.RowInit (definition 535) proves this
     * matters beyond just the initial field access: a `GetField(Field.X)`
     * called directly on a bare `GetRecord(...)` result must also register
     * into the control-group FIELD reuse pool the same way
     * `&row.GetRecord(...).GetField(Field.X)` already does, so a later
     * bare `.FIELDNAME` property access elsewhere in the same control
     * group can find it.
     */
    let bareGetRecordCallResult = false;

    /*
     * A bare `GetRow()` call (no receiver, no arguments) returns the
     * current Row, exactly like a `rowVariables`-tracked Row variable
     * does -- so its own `.RECORD.FIELD.Value` two-dot postfix chain
     * compiles RECORD and FIELD through PSPCMNAME (0x4A operands), the
     * same as `&row.RECORD.FIELD.Value` already does for a declared Row
     * variable (see `rowStartsRecordFieldChain`'s own comment, a few
     * lines below). Scoped narrowly to the exact empty-parens call, like
     * `bareGetRecordCallResult` already scopes `GetRecord()` similarly.
     *
     * GPGB_SCON_TBL.GPGB_SCON.RowDelete (definition 8027):
     *
     *   &GPGB_SCON = GetRow().GPGB_SCON_TBL.GPGB_SCON.Value;
     *
     * stores two PSPCMNAME references (RECORD GPGB_SCON_TBL, FIELD
     * GPGB_SCON), not inline text.
     */
    let bareGetRowCallResult = false;

    /*
     * Cycle 7 (Phase 7C): a bare `GetLevel0()` call is the encoder's own
     * separately-evidenced, always dependency-bound Level0-rowset root
     * (see the `GetLevel0()(N).GetRowset(Scroll.X)` handling elsewhere in
     * this file, and the Cycle 6/7 research). Recognizing it here lets
     * ChainSemantics' existing method-call inheritance mechanism (the
     * `.GetRow(...)`/`.GetRecord(...)`/`.GetRowset(...)` branch a few
     * hundred lines below, which already inherits binding/provenance from
     * the pre-call receiver) correctly propagate `dependency-bound`
     * through chains like
     * `GetLevel0().GetRow(1).GetRowset(Scroll.X).GetRow(N).RECORD.FIELD`
     * (definition 2876's own shape, one of 53 definitions/33 currently
     * EXACT) without any further change -- no new mechanism, just a
     * missing primary-expression provenance source, symmetric with
     * `bareGetRecordCallResult`/`bareGetRowCallResult` immediately above.
     * Scoped to the exact empty-parens call, like those two.
     */
    let bareGetLevel0CallResult = false;

    /*
     * Cycle 7 (Phase 7C): a bare `GetRowset()` call (no receiver, no
     * arguments) returns the current Rowset, exactly like `GetRecord()`/
     * `GetRow()` above return the current Record/Row -- Cycle 4's own
     * evidence table already names this transition ("GetRowset(...)
     * (bare or postfix) ... intrinsic if bare/no receiver provenance"),
     * it just had no `initialChainSemantics` arm yet. Definition 926
     * (`LaunchProcessRequestDlg(GetRowset().GetRow(1).GetRecord(1),
     * GetRowset().GetRow(1).AGC_PRCSRUNCNTL.RUN_CNTL_ID.Value, ...)`) is
     * currently EXACT under the legacy unconditional binding this cycle's
     * new receiver-provenance gate (see the `expectedReferenceMember`
     * assignment below) would otherwise have wrongly suppressed for a
     * bare `GetRowset()` root -- this arm is required for that gate to be
     * safe, not merely a nice-to-have. Scoped to the exact empty-parens
     * call, like `bareGetRecordCallResult`/`bareGetRowCallResult`.
     */
    let bareGetRowsetCallResult = false;
    const baseVariableName =
      /^&[A-Za-z0-9_]+#?/.exec(source.slice(pos))?.[0];
    const baseApplicationClass =
      baseVariableName === undefined
        ? undefined
        : (
            functionDepth > 0
              ? functionApplicationClassVariables.get(
                  baseVariableName.toLowerCase()
                )
              : undefined
          ) ??
          applicationClassVariables.get(baseVariableName.toLowerCase());

    /*
     * Track Application Class method provenance only while the postfix chain
     * is still operating directly on the typed root variable.
     *
     *   &ServiceManager.LocateService(...)       -> method dependency
     *
     * but:
     *
     *   &collItemType.ProfileItemElements.Push(...)
     *
     * traverses the ProfileItemElements property first, so Push() is a method
     * on that returned collection/object, not on collProfileItemType itself.
     * PeopleTools does not allocate a collProfileItemType.Push PSPCMNAME row.
     */
    let activeApplicationClassReceiver = baseApplicationClass;
    /*
     * Cycle 104 / 109: an `array of <Class>` value awaiting its index
     * groups -- a declared array variable (`applicationClassArrayVariables`)
     * or, in an Application Class program, a property or method result the
     * type-metadata provider declares as one. Each index group consumes one
     * array level; the element reached by the last one is a receiver of the
     * class. Any member step on the array itself (`.Len`, `.Push(...)`)
     * ends it.
     */
    const baseApplicationClassArray =
      (unitScopedClassRows || applicationClassBody) && baseVariableName !== undefined
        ? applicationClassArrayVariables.get(baseVariableName.toLowerCase())
        : undefined;
    let pendingArrayElement: { packagePath: string[]; className: string; remaining: number } | undefined =
      baseApplicationClassArray === undefined
        ? undefined
        : { packagePath: baseApplicationClassArray.packagePath, className: baseApplicationClassArray.className, remaining: baseApplicationClassArray.depth };
    const arrayElementOf = (type: ApplicationClassMemberType & { kind: 'array' }) => ({
      packagePath: type.element.slice(0, -1),
      className: type.element[type.element.length - 1],
      remaining: type.depth
    });

    /*
     * Cycle 93: true once this chain has stepped from an Application Class
     * instance onto a property or method result. The class of that result
     * is external metadata (see `EncodeFragmentContext.externalClassMetadata`).
     */
    let receiverClassIsExternalMetadata = false;

    /*
     * Cycle 67: set true only when THIS primary expression's base token is
     * literally `%Super` -- consulted, and always cleared, by the VERY
     * NEXT postfix `.member` step only (see that step's own comment for
     * why only the first member after `%Super` can be a property name at
     * all: `%Super.Property.Method(...)`'s `.Method` step is a call on
     * the PROPERTY's result, not on `%Super` itself, exactly the same
     * "traverses the property first" distinction `activeApplicationClassReceiver`'s
     * own comment above already makes for `&typedVar.Property.Method(...)`).
     */
    let pendingSuperPropertyResolution = false;

    /*
     * Cycle 82: set true only when this primary's base token is literally
     * `%This` inside an Application Class compilation unit; consulted and
     * cleared by the very next postfix step only.
     */
    let pendingThisMethodResolution = false;

    /*
     * Cycle 108: set when this primary's base is `%This` in an Application
     * Class fragment with a type-metadata provider; consulted and cleared
     * by the very next postfix step (a property of this class or an
     * ancestor).
     */
    let pendingThisPropertyTyping = false;

    /*
     * Track an explicit Record.REC root through the postfix parser so its
     * next dotted identifier is encoded as a FIELD PSPCMNAME operand rather
     * than an inline member name.
     */
    let explicitRecordRootName: string | undefined;

    if (source[pos] === '-') {
      pos++;
      chunks.push(fixed('-'));
      primary();
      return;
    }

    if (source[pos] === '@') {
      pos++;
      chunks.push(fixed('@'));
      space();
      if (source[pos] === '(') {
        parenthesized(expression, false);
      } else {
        primary();
      }
      return;
    }

    if (source[pos] === '%') {
      if (/^%Super\b/i.test(source.slice(pos))) {
        pendingSuperPropertyResolution = true;
      }
      if (
        context?.applicationClassSelfMethodDependency !== undefined &&
        /^%This\b/i.test(source.slice(pos))
      ) {
        pendingThisMethodResolution = true;
      }
      if (
        context?.applicationClassSelfPath !== undefined &&
        context?.applicationClassTypeMetadata !== undefined &&
        /^%This\b/i.test(source.slice(pos))
      ) {
        pendingThisPropertyTyping = true;
      }
      chunks.push(systemVariable());
    } else if (source[pos] === '(') {
      /*
       * Cycle 117: a grouped expression holds the full expression grammar --
       * arithmetic, comparison, And / Or, Not -- whatever its operands.
       * booleanExpression() is that grammar (a group with no comparison or
       * And / Or writes exactly the bytes expression() would: its 0x41 /
       * 0x42 markers only wrap an And / Or chain). The group is followed by
       * this primary's ordinary postfix loop. This replaces five
       * source-shape lookaheads that chose booleanExpression() only for
       * recognized left operands (`&var ...`, `Name(...)`, `%Sys`, `Not`,
       * `&var And`) and expression() otherwise, which stopped at the first
       * comparison of e.g. `Return (%This.AppMsgs.Len > 0)` with "expected
       * )" (`cycle117-grouped-boolean-census.ts`: 131 groups in 51
       * definitions); 813 groups the lookaheads did recognize are
       * byte-identical.
       */
      parenthesized(booleanExpression, false);
    } else if (/^create\b/i.test(source.slice(pos))) {
      word('create');
      chunks.push(Buffer.from([0x69]));

      space();
      const appClass = applicationClassPath();
      chunks.push(appClass.bytes);

      /*
       * The first runtime create of an Application Class establishes a new
       * PACKAGE dependency row even when that class was already imported.
       * Later creates of the same class reuse that runtime dependency.
       *
       * Cycle 93 / 94 (ordinary PeopleCode): the create uses its class
       * AFTER the constructor arguments, in the current allocation unit
       * (see `useApplicationClassRow`).
       *
       *   20249  Local BAS_STATEMENT:PrintConfirmation &oPrint;
       *          &oPrint = create BAS_STATEMENT:PrintConfirmation("", BAS_STMT_SUMM.EFFDT.Value);
       *          => PRINTCONFIRMATION 3 (declaration), BAS_STMT_SUMM.EFFDT 4,
       *             PRINTCONFIRMATION 5 (create)
       *
       * `Local PKG:Class &v = create PKG:Class(args)` needs no special
       * case: the declaration's type already put the class row into this
       * statement's unit before the arguments (24442, 13522). Creates in
       * separate top-level statements each open a row (17900).
       */
      if (!unitScopedClassRows) {
        ensureRuntimeCreateReference(
          appClass.packagePath,
          appClass.className
        );
      }

      space();
      if (source[pos] !== '(') {
        return fail('expected ( after application class name in create');
      }

      parenthesized(() => {
        space();

        if (source[pos] === ')') {
          return;
        }

        expression();
        space();

        while (source[pos] === ',') {
          pos++;
          chunks.push(fixed(','));
          expression();
          space();
        }
      }, true);

      if (unitScopedClassRows) {
        useApplicationClassRow(appClass.packagePath, appClass.className);
      }
    } else {
      const identifier =
        /^[A-Za-z_][A-Za-z0-9_]*#?/.exec(source.slice(pos))?.[0];

      if (identifier && !/^(true|false|null)$/i.test(identifier)) {
      const tail = source.slice(pos);

      if (/^HTML\s*\./i.test(tail)) {
        chunks.push(htmlReference());
      } else if (/^Record\s*\./i.test(tail)) {
        /*
         * Preserve the long-standing Record.X provenance rules.
         *
         * Offset 433 adds a narrower form:
         *
         *   Record.REC.FIELD.Value
         *
         * Only that explicit RECORD -> FIELD chain reuses the RECORD
         * dependency inside the current control group.
         *
         * A bare Record.X expression, including usages such as:
         *
         *   CreateRecord(Record.JOB)
         *   GetRecord(Record.X)
         *
         * must continue through the previously calibrated occurrence /
         * target / control-group rules in recordReference().
         *
         * Offset 23 is the regression guard for this distinction.
         *
         * AMM_DERIVED.IB_FO_BACK_PB.FieldChange (definition 982) proves the
         * chain must NOT match when the second dotted segment is one of the
         * inline Row state/property members (RowNumber/IsNew/IsDeleted/
         * IsChanged/Visible/Selected -- the same set `isInlineRowStateMember`
         * below already recognizes for a Row-variable base):
         *
         *   If Record.AMM_DERIVED.IsChanged = True Or ...
         *
         * `IsChanged` here is a boolean Row-state property of the RECORD's
         * underlying Row, not a field name -- there is no third `.Value`
         * continuation. Taking the explicit-chain branch put
         * `expectedReferenceMember` into `'field'` mode, so the postfix
         * loop's own `isInlineRowStateMember` check (which requires
         * `'record'` mode) never got a chance to keep `IsChanged` inline.
         *
         * Cycle 63 adds `Name`: `Record.Name`/a Record-typed variable's
         * bare `.Name` is the intrinsic Record-object property (the
         * record's own technical name as a string), encoded by stored
         * PeopleTools as plain inline member text (`INLINE_IDENTIFIER_OPCODE`
         * + "Name") exactly like `.Value`/`.FormatLongDate`/any other
         * non-field member -- never a FIELD PSPCMNAME reference, even
         * though a field literally named NAME is a plausible schema name
         * (definitions 29144/29202's `&recValue.Name`, `&recValues[&i].Name`
         * proved this a genuine defect, not merely a Cycle 46-style gap). A
         * corpus-wide census (`cycle63-name-intrinsic-census.ts`) found 144
         * definitions where the encoder allocates a FIELD reference for a
         * bare `.Name` on a Record-typed receiver, and ZERO of them have a
         * matching FIELD row in stored PSPCMNAME -- i.e. zero corpus
         * evidence of a genuine field named NAME ever needing this bare
         * shorthand, and 144/144 support treating it as intrinsic,
         * unconditionally, the same way `isInlineRowStateMember` already
         * treats `RowNumber`/`IsChanged`/etc.
         */
        const explicitRecordFieldChain =
          /^Record\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/i
            .exec(tail);
        const explicitRecordFieldChainIsRowStateMember =
          explicitRecordFieldChain !== null &&
          /^(?:RowNumber|IsNew|IsDeleted|IsChanged|Visible|Selected|Name)$/i.test(
            explicitRecordFieldChain[2]
          );

        if (explicitRecordFieldChain && !explicitRecordFieldChainIsRowStateMember) {
          explicitRecordRootName =
            explicitRecordFieldChain[1];

          chunks.push(
            recordReference({
              explicitChainReuse: true
            })
          );
        } else {
          chunks.push(
            recordReference()
          );
        }
      } else if (/^Field\s*\./i.test(tail)) {
        chunks.push(fieldReference());
      } else if (/^Scroll\s*\./i.test(tail)) {
        chunks.push(scrollReference());
      } else if (
        /^[A-Za-z_][A-Za-z0-9_]*\s*\.\s*["']/.test(tail) &&
        quotedReferenceQualifiers.has(identifier.toLowerCase())
      ) {
        chunks.push(quotedReference());
      } else if (/^Component\s*\./i.test(tail)) {
        chunks.push(componentReference());
      } else if (/^[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*/.test(tail)) {
        chunks.push(ordinaryRecordFieldReference());
      } else if (
        /^[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z_][A-Za-z0-9_]*/.test(tail)
      ) {
        /*
         * Application-package enum/key constants use the same inline-name
         * and 0x57 colon bytes as a class path, but are expression operands
         * and do not allocate a new PACKAGE dependency themselves:
         *
         *   create %metadata:Key(Key:Class_MacroSetId, &src)
         *
         * PSMACROSETACT.PTMACRODEL.FieldFormula (definition 16084) stores
         * `Key:Class_MacroSetId` as 0x0A "Key", 0x57, 0x0A
         * "Class_MacroSetId" inside the call arguments.
         */
        chunks.push(applicationClassPath().bytes);
      } else {
        /*
         * `GetRecord()` with NO arguments is a structurally different
         * construct from `GetRecord(Record.X)` / `GetRecord(N)`: it starts
         * a Row-navigation chain (`.ParentRow.ParentRowset...`), not a
         * field access, and its postfix members must stay plain inline
         * identifiers.
         *
         * ABS_H_D_NLDSBR.SAME_ADDRESS_EMPL.FieldChange (definition 180)
         * proves this: `GetRecord().ParentRow...` must NOT treat
         * `.ParentRow` as a field reference. Only the argumented form
         * (definition 535's `GetRecord(1)` / `GetRecord(Record.X)`) puts a
         * following bare `.MEMBER` into field-reference mode.
         */
        /*
         * Cycle 98: `CreateRecord(Record.X)` returns a Record too; stored
         * binds `CreateRecord(Record.X).FIELD` as a FIELD row in all 15
         * occurrences (7 definitions, e.g. 6694, 21479).
         */
        const wasBareGetRecordCall =
          (/^GetRecord$/i.test(identifier) &&
            !/^GetRecord\s*\(\s*\)/i.test(tail)) ||
          /^CreateRecord$/i.test(identifier);

        /*
         * A bare, EMPTY-PARENS `GetRecord()` call is normally a
         * Row-navigation chain root (definition 180's `.ParentRow...`,
         * kept inline -- see the comment above). But when the member that
         * follows is itself followed by a SECOND dotted member (rather
         * than being the whole chain), the first member is a FIELD access
         * on the row's default record, exactly like the argumented form
         * already puts its following bare `.MEMBER` into field-reference
         * mode -- the difference is structural (one member vs. two), not
         * the presence of call arguments.
         *
         * GPS_POSTADD_WRK.<various>.FieldFormula (definition 10023, one of
         * 26 corpus occurrences of this exact shape):
         *
         *   GetRecord().GPS_BDG_ORG2.SqlText = ExpandSqlBinds(...);
         *
         * stores a real PSPCMNAME FIELD reference (0x4A) for GPS_BDG_ORG2,
         * while SqlText -- a record property, not a field -- stays inline
         * text, matching how `expectedReferenceMember` already reverts to
         * `undefined` (not a second reference level) once a 'field'-mode
         * reference has been consumed.
         *
         * `ParentRow` is the sole exception in the corpus (definitions 180,
         * 9359, 22705, all still a `.ParentRow.ParentRowset...` navigation
         * chain, never a field): of 113 distinct first-member identifiers
         * found across every `GetRecord().MEMBER.MEMBER2` corpus occurrence,
         * `ParentRow` is the only one that is not an
         * ALL_CAPS_WITH_UNDERSCORES field-name shape, so it is excluded by
         * name, matching definition 180's own calibrated comment above.
         */
        const wasBareGetRecordCallNoArgsFieldChain =
          /^GetRecord$/i.test(identifier) &&
          /^GetRecord\s*\(\s*\)\s*\.\s*(?!ParentRow\b)[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*/i
            .test(tail);

        const wasBareGetRowCall =
          /^GetRow$/i.test(identifier) &&
          /^GetRow\s*\(\s*\)/i.test(tail);

        const wasBareGetLevel0Call =
          /^GetLevel0$/i.test(identifier) &&
          /^GetLevel0\s*\(\s*\)/i.test(tail);

        /*
         * Cycle 7: unlike `wasBareGetRecordCall`/`wasBareGetLevel0Call`,
         * this is NOT restricted to empty parens -- `GetRowset(Scroll.X)`
         * (definition 18564, currently EXACT) is just as much a bare
         * chain root as empty-parens `GetRowset()`; the empty/non-empty
         * distinction only matters for `GetRecord()`'s OWN two-shape split
         * (navigation-chain root vs. argumented field-binding root, see
         * `wasBareGetRecordCallNoArgsFieldChain`'s comment), which
         * GetRowset has no evidenced parallel for. Being in this branch
         * at all already means the call is bare (no `.` receiver), so no
         * further `tail` check is needed.
         */
        const wasBareGetRowsetCall =
          /^GetRowset$/i.test(identifier);

        call();

        // A function-call result may itself be invoked/indexed using (...)
        // e.g. GetLevel0()(1).
        allowDirectPostfixCall = true;

        if (wasBareGetRecordCall || wasBareGetRecordCallNoArgsFieldChain) {
          bareGetRecordCallResult = true;
        }

        if (wasBareGetRowCall) {
          bareGetRowCallResult = true;
        }

        if (wasBareGetLevel0Call) {
          bareGetLevel0CallResult = true;
        }

        if (wasBareGetRowsetCall) {
          bareGetRowsetCallResult = true;
        }
      }
      } else {
        chunks.push(value());
      }
    }

    /*
     * A typed Row variable has two distinct postfix forms:
     *
     *   &row.RowNumber
     *   &row.IsDeleted
     *
     * are ordinary Row properties/state members and remain inline names.
     *
     * But a record/field chain rooted at a Row:
     *
     *   &row.RECORD.FIELD.Value
     *
     * compiles RECORD and FIELD through PSPCMNAME (0x4A operands).
     *
     * Therefore a Row variable enters reference-member mode only when the
     * source structurally has at least two dotted identifiers following the
     * Row variable. This preserves ordinary single-member Row properties.
     */
    /*
     * Cycle 98: a SINGLE bare member off a Row is a record reference too
     * (`&rec = &row.REC;`, `&r = GetRow().REC;`): stored binds it as a
     * RECORD row in all 79 occurrences at a chain end (57 definitions, e.g.
     * 536, 2182). The "two dotted identifiers" requirement existed to keep
     * Row properties inline; every inline property member after a Row
     * value in the corpus is now covered by the row-state list and
     * `BUILTIN_OBJECT_PROPERTIES` (IsNew, IsDeleted, RowNumber, IsChanged,
     * Visible, Selected, Style, ChildCount, RecordCount, DeleteEnabled,
     * ParentRowset), and a member followed by `(` is a method, not bound.
     */
    const rowMemberFollows = /^\s*\.\s*[A-Za-z_][A-Za-z0-9_]*(?!\s*\()/;
    const rowStartsRecordFieldChain =
      baseVariableName !== undefined &&
      rowVariables.has(baseVariableName.toLowerCase()) &&
      rowMemberFollows.test(source.slice(pos));

    const bareGetRowCallStartsRecordFieldChain =
      bareGetRowCallResult &&
      rowMemberFollows.test(source.slice(pos));

    /*
     * Cycle 45: a declared `array of Record` variable is an ARRAY object
     * until INDEXED (`&x [&i]`) -- only then does it narrow to a Record,
     * whose own bare `.MEMBER` is a FIELD reference exactly like a scalar
     * `Local Record &rec;`'s `.MEMBER` already is (see `recordArrayVariables`'s
     * own declaration comment for the `&x.Len` regression this lookahead
     * exists to avoid: gated on the array being indexed FIRST, not merely
     * declared as array-of-Record).
     */
    const recordArrayIndexedFieldAccess =
      baseVariableName !== undefined &&
      recordArrayVariables.has(baseVariableName.toLowerCase()) &&
      /^\s*\[/.test(source.slice(pos));

    let expectedReferenceMember:
      'record' | 'field' | undefined =
        explicitRecordRootName !== undefined
          ? 'field'
          : bareGetRecordCallResult
            ? 'field'
            : rowStartsRecordFieldChain || bareGetRowCallStartsRecordFieldChain
              ? 'record'
              : (baseVariableName !== undefined &&
                  recordVariables.has(baseVariableName.toLowerCase())) ||
                recordArrayIndexedFieldAccess
                ? 'field'
                : undefined;

    /*
     * Cycle 5 (see .claude/corpus-progress.md): a pure, read-only
     * ChainSemantics projection of the classification immediately above --
     * introduced to make the postfix chain's semantic state explicit
     * without changing any encoding decision yet. Nothing reads
     * `initialChainSemantics` outside this diagnostic assignment; it
     * cannot affect `generated` output because it does not participate in
     * any branch, lookup, or write below. Confirmed zero-behavior-change
     * by a full 30,209-definition corpus diff (see the progress file for
     * the exact run comparison).
     *
     * This mirrors ONLY `expectedReferenceMember`'s own four direct
     * classification arms above -- it deliberately does NOT yet
     * incorporate the separate schema-provenance pools Cycle 4 also
     * identified (`rowsetElementRecords`, `rowsetRecordNamesByVariable`,
     * `captureRowsetElementRecord`), which establish binding provenance
     * for an UNDECLARED receiver assigned from a schema-bearing call
     * (e.g. `CreateRowset(Record.X)`, definition 524) through a
     * structurally different code path this function does not trace.
     * Those receivers are reported 'unknown'/'dynamic' here even where
     * the corpus shows they actually bind -- a known, deliberate gap,
     * left for a later phase rather than guessed at without tracing that
     * separate mechanism first.
     */
    const initialChainSemantics: ChainSemantics =
      explicitRecordRootName !== undefined
        ? { valueType: 'record', binding: 'dependency-bound', provenance: 'declared' }
        : bareGetRecordCallResult
          ? { valueType: 'record', binding: 'dependency-bound', provenance: 'intrinsic' }
          : rowStartsRecordFieldChain
            ? { valueType: 'row', binding: 'dependency-bound', provenance: 'declared' }
            : bareGetRowCallResult
              ? /*
                 * Cycle 7 addition: `bareGetRowCallStartsRecordFieldChain`
                 * (the arm this replaces) additionally required a
                 * two-dot bare-shorthand lookahead, matching only
                 * `GetRow().RECORD.FIELD`. But a bare `GetRow()` chain
                 * root followed by a METHOD call instead --
                 * `GetRow().GetRecord(...)` (definitions 10002, 14612,
                 * 15947, 17115, 24012, all currently EXACT) -- is the
                 * SAME intrinsic root Cycle 4's evidence already
                 * establishes; the lookahead was only ever needed for
                 * `expectedReferenceMember`'s own narrower bare-shorthand
                 * purpose, not for this general "what does this chain
                 * hold" question. `bareGetRecordCallResult` above was
                 * never narrowed this way; this arm now matches that
                 * precedent.
                 */
                { valueType: 'row', binding: 'dependency-bound', provenance: 'intrinsic' }
              : bareGetLevel0CallResult || bareGetRowsetCallResult
                ? /*
                   * Cycle 7 addition: see `bareGetLevel0CallResult`'s and
                   * `bareGetRowsetCallResult`'s own declaration comments.
                   * Both return the current Rowset intrinsically -- a bare
                   * `GetLevel0()` (the Level0 Rowset) and a bare
                   * `GetRowset()` (Cycle 4's own evidence table names this
                   * transition; definition 926 is the confirmed EXACT
                   * control) share the same valueType/provenance here.
                   */
                  { valueType: 'rowset', binding: 'dependency-bound', provenance: 'intrinsic' }
                : (baseVariableName !== undefined &&
                    recordVariables.has(baseVariableName.toLowerCase())) ||
                  recordArrayIndexedFieldAccess
                  ? { valueType: 'record', binding: 'dependency-bound', provenance: 'declared' }
                  : baseVariableName !== undefined &&
                    (rowVariables.has(baseVariableName.toLowerCase()) ||
                      chainSemanticsDeclaredRowVariables.has(baseVariableName.toLowerCase()))
                    ? /*
                       * Cycle 7 addition: a declared Row variable used as
                       * the receiver of a DIRECT postfix `.GetRowset(...)`/
                       * `.GetRecord(...)` call (rather than the narrower
                       * `rowStartsRecordFieldChain` two-dot-lookahead shape
                       * above, which only covers an IMMEDIATE `.RECORD.FIELD`
                       * chain) was never given its own arm here -- `Local
                       * Row &x;`/`Row`-typed-parameter receivers of a call
                       * like `&RS2.GetRow(&I).RECORD.FIELD` (definition 435)
                       * reported 'unknown'/'dynamic' despite being declared,
                       * purely because this arm did not exist yet. Symmetric
                       * with the existing declared-Record/-Rowset arms;
                       * reads the SAME already-populated `rowVariables` set
                       * those consult (parameters already join it via the
                       * existing evidenced fix above), plus the isolated
                       * `chainSemanticsDeclaredRowVariables` set for the
                       * Component-scope gap that set closes (see its own
                       * declaration comment) -- neither population site is
                       * changed by this arm, only a new read.
                       */
                      { valueType: 'row', binding: 'dependency-bound', provenance: 'declared' }
                    : /*
                       * Cycle 6 addition: a declared Rowset variable
                       * (`Local Rowset &rs;`) is the fourth declared-type
                       * arm Cycle 4's own evidence table names (500
                       * occurrences across 122 EXACT definitions for the
                       * postfix-GetRow `.REC.FIELD.Value` shape reached
                       * through a declared-Rowset-sourced `GetRowset(Scroll.X)`
                       * receiver). `rowVariables`/`recordVariables` were
                       * already read by `initialChainSemantics`'s other arms
                       * above; `rowsetVariables` is the same kind of existing,
                       * already-populated declaration-tracking set, just not
                       * previously consulted here. No declared-Field-variable
                       * tracking set exists anywhere in the encoder today
                       * (unlike Row/Rowset/Record), so that arm is
                       * deliberately left unrepresented rather than invented
                       * -- see the Cycle 6 report for this as a documented
                       * gap, not an oversight. Cycle 7 additionally reads
                       * the isolated `chainSemanticsDeclaredRowsetVariables`
                       * set (Component/Global declarations, and a
                       * Rowset-typed parameter -- see its own declaration
                       * comment) alongside the original `rowsetVariables`.
                       */
                      baseVariableName !== undefined &&
                      (rowsetVariables.has(baseVariableName.toLowerCase()) ||
                        chainSemanticsDeclaredRowsetVariables.has(baseVariableName.toLowerCase()))
                      ? { valueType: 'rowset', binding: 'dependency-bound', provenance: 'declared' }
                      : /*
                         * Cycle 6 addition, closes Cycle 5's own documented
                         * gap: an UNDECLARED variable most recently assigned
                         * `CreateRowset(Record.X)` (definition 524's own
                         * `&RS_Country`) has schema-derived provenance despite
                         * never being declared -- see `schemaBoundVariables`'s
                         * own declaration comment.
                         */
                        baseVariableName !== undefined &&
                        schemaBoundVariables.has(baseVariableName.toLowerCase())
                        ? { valueType: 'rowset', binding: 'dependency-bound', provenance: 'schema' }
                        : { valueType: 'unknown', binding: 'dynamic', provenance: 'unknown' };

    /*
     * Cycle 6: `chainSemantics` evolves as the postfix loop below consumes
     * each `.MEMBER`/`.Method(...)` step, per the transition table in
     * `.claude/corpus-progress.md`'s Cycle 6 section. Every update below
     * is a NEW, ADDITIONAL statement alongside the existing
     * `expectedReferenceMember`/`fieldMemberFromGetRecord` logic, never a
     * replacement of it. As of Cycle 7, `chainSemantics.binding` is also
     * consulted by the bare-member eligibility gate below (see
     * `bareMemberBindingEligible`'s own comment) -- still only for that
     * one, narrowly-scoped consumer.
     */
    let chainSemantics: ChainSemantics = initialChainSemantics;
    /*
     * Cycle 121: in an ordinary program a chain rooted at a variable the
     * program never declares is late-bound: its bare RECORD / FIELD members
     * stay inline names, whatever the chain looks like (13413
     * `&RSPrcsList.GetRow(&nbr).PMN_DERIVED.SELECT_FLAG.Value`, 21519
     * `&level1_row.getRow(&z).GP_ABS_EVENT.EMPL_RCD`, 913
     * `&XLAT.GetRow(&I).GetRecord(1).FIELDVALUE`).
     * `cycle121-record-member-kind-census.ts`: bare members of chains on an
     * undeclared root store inline names in 219 of 219 cases once
     * PanelGroup declarations count as declarations; declared roots store
     * FIELD rows (over 35,000, a handful of exceptions). Symbolic
     * arguments (`GetRecord(Record.X)`, `GetField(Field.X)`) are separate
     * references and unaffected.
     */
    const rootIsUndeclaredVariable =
      ordinaryProgram &&
      baseVariableName !== undefined &&
      !declaredVariableNames.has(baseVariableName.toLowerCase());

    /*
     * Distinguishes "expectedReferenceMember === 'field' because this is
     * the first postfix step off a declared Record variable" from
     * "...because this expression's field context came from a
     * .GetRecord(...) result" (either a bare `GetRecord(...)` primary call,
     * or `.GetRecord(...)` as a postfix step later in the chain). Only the
     * latter enables Field.X control-group reuse for a following
     * .GetField(...) call -- see its own comment where it's checked below.
     */
    let fieldMemberFromGetRecord = bareGetRecordCallResult;
    /*
     * Cycle 119: true for the bare member right after a Row-shorthand RECORD
     * member (`&row.REC.FIELD`, `GetLevel0()(1).REC.FIELD`) -- see the FIELD
     * registration in `recordPostfixMemberReuse`.
     */
    let fieldMemberFromRowShorthand = false;
    let selectedByDirectRowsetPostfix = false;

    // Calibrated postfix forms may be chained arbitrarily:
    //   expr.Member / expr.Method(...)
    //   expr[index]       => 0x4C ... 0x4D
    //   expr(args)        => 0x0B ... 0x14 (e.g. Rowset shorthand &rs(1))
    while (true) {
      space();

      const thisMethodResolutionStep = pendingThisMethodResolution;
      pendingThisMethodResolution = false;

      if (source[pos] === '.') {
        pos++;
        chunks.push(fixed('.'));

        space();

        const memberMatch =
          /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(pos));

        if (!memberMatch) {
          return fail('expected member name after .');
        }

        const member = memberMatch[0];
        pos += member.length;
        // Cycle 109: a member of the array itself (`.Len`, `.Push(...)`) ends its pending element.
        pendingArrayElement = undefined;

        /*
         * Cycle 82: `%This.<ownMethod>(` -- see
         * `ApplicationClassSelfMethodDependency`'s own comment. Allocated
         * here, before the call's arguments are encoded.
         */
        if (
          thisMethodResolutionStep &&
          /^\s*\(/.test(source.slice(pos)) &&
          context?.applicationClassSelfMethodDependency?.isSelfMethodCall(member) === true
        ) {
          const selfRow = context.applicationClassSelfMethodDependency.claim();
          /*
           * Same class-wide identity rule as the ordinary method-call path
           * (Cycle 62): an own-class PACKAGE identity already established
           * -- by an earlier fragment (committed type session) or earlier
           * in this fragment (e.g. `Local <OwnClass> &x`) -- is reused.
           */
          const existingSelfIdentity = selfRow === undefined
            ? undefined
            : context.applicationClassTypeReferenceSession?.lookup(selfRow) ??
              references.find(reference =>
                reference.kind === 'package' &&
                reference.className?.toUpperCase() === selfRow.className
              ) ??
              // Cycle 108: or a row an earlier fragment opened for a method call.
              context.applicationClassProgramRows?.find(selfRow.className!);
          if (selfRow !== undefined && existingSelfIdentity === undefined) {
            nextReference(selfRow);
          }
        }

        /*
         * Cycle 67: resolve `%Super.<property>` to its ancestor-declared
         * Application Class type, exactly once, for the property step
         * immediately following `%Super` -- see
         * `pendingSuperPropertyResolution`'s own declaration comment.
         * Setting `activeApplicationClassReceiver` here reuses the
         * EXISTING, already-proven `isMethodCall` branch below (Cycle 62)
         * to allocate/reuse the type dependency exactly the same way a
         * `&typedVariable.Property.Method(...)` chain already does --
         * no new allocation path, no new dedup logic.
         */
        let resolvedInheritedPropertyThisStep = false;
        /*
         * Cycle 118: the built-in type (`{ kind: 'other' }`) the
         * type-metadata provider declares for this property step, if any --
         * applied below, after the generic property-step reset.
         */
        let metadataBuiltinType: string | undefined;
        if (pendingSuperPropertyResolution) {
          pendingSuperPropertyResolution = false;

          const inheritedType = context?.inheritedPropertyTypes?.get(member.toLowerCase());
          if (inheritedType !== undefined) {
            const components = inheritedType
              .replace(/^(?:array\s+of\s+)+/i, '')
              .trim()
              .split(':');

            if (components.length >= 2) {
              activeApplicationClassReceiver = {
                packagePath: components.slice(0, -1),
                className: components.at(-1)!,
                reuseRuntimeCreateForMethods: false
              };
              resolvedInheritedPropertyThisStep = true;
            }
          } else if (context?.applicationClassSelfPath !== undefined && !/^\s*\(/.test(source.slice(pos))) {
            /*
             * Cycle 108: otherwise the type-metadata provider's declaration
             * of the property on the parent class (or its ancestors). The
             * receiver's class then uses its program row
             * (`ApplicationClassProgramRows`): 28927's eighteen
             * `%Super.TxtCat.<method>(...)` calls, one TEXTCATALOG row.
             * LOCAL SNAPSHOT: 26 generated lists changed, 25 closer, 0
             * farther (13 programs forward-exact).
             */
            const superPath = context.applicationClassTypeMetadata?.superclassOf(context.applicationClassSelfPath);
            const propertyType = superPath === undefined
              ? undefined
              : consultTypeMetadata('member', superPath, member);
            if (propertyType?.kind === 'class') {
              activeApplicationClassReceiver = metadataReceiver(propertyType.path);
              resolvedInheritedPropertyThisStep = true;
            } else if (propertyType?.kind === 'array') {
              // Cycle 109: an array property: its element, once indexed
              pendingArrayElement = arrayElementOf(propertyType);
              resolvedInheritedPropertyThisStep = true;
            } else if (propertyType?.kind === 'other') {
              metadataBuiltinType = propertyType.type;
            }
          }
        }

        /*
         * Cycle 108: `%This.<property>` -- the property's declared class,
         * own (the header's declaration as written, when the source alone
         * names the class) or inherited (the type-metadata provider),
         * becomes the receiver, and uses its program row
         * (`%This.BenDataMgr.GetAdminContactInfo()`, 28874). A `%This`
         * method call is the Cycle 82 self row; its result stays untyped.
         * LOCAL SNAPSHOT: 24 generated lists changed, 24 closer, 0 farther
         * (5 programs forward-exact).
         */
        if (pendingThisPropertyTyping) {
          pendingThisPropertyTyping = false;
          if (!/^\s*\(/.test(source.slice(pos))) {
            const declared = context?.applicationClassOwnPropertyTypes?.get(member.toLowerCase());
            const propertyType: ApplicationClassMemberType | undefined =
              declared !== undefined && !context?.applicationClassTypeMetadataDiagnosticsOnly
                ? declared.depth > 0
                  ? { kind: 'array', element: [...declared.packagePath, declared.className], depth: declared.depth }
                  : { kind: 'class', path: [...declared.packagePath, declared.className] }
                : consultTypeMetadata('member', context!.applicationClassSelfPath!, member);
            if (propertyType?.kind === 'array') {
              // Cycle 109: an array property: its element, once indexed
              pendingArrayElement = arrayElementOf(propertyType);
              resolvedInheritedPropertyThisStep = true;
            } else if (propertyType?.kind === 'class') {
              activeApplicationClassReceiver = metadataReceiver(propertyType.path);
              resolvedInheritedPropertyThisStep = true;
            } else if (propertyType?.kind === 'other') {
              metadataBuiltinType = propertyType.type;
            }
          }
        }

        space();

        const isMethodCall = source[pos] === '(';
        /*
         * Cycle 9 (Phase 9A): `expectedReferenceMember` mixes four roles
         * (see Cycle 8's own role map in .claude/corpus-progress.md) --
         * `dependencyKind` factors out exactly one of them: "if a member
         * here becomes a NEW dependency, is it a RECORD or a FIELD row."
         * This is a pure, same-value derivation (never independently
         * assigned), so it cannot desync from `expectedReferenceMember`;
         * it exists to give the KIND-SPECIFIC consumers below (pool
         * dispatch, allocation, pool population) an explicit, typed name
         * instead of re-deriving 'record'/'field'/'none' from the
         * four-role flag at each site. `expectedReferenceMember` itself
         * is UNCHANGED and still carries provenance, reuse-policy input,
         * and (via `!== undefined`) the diagnostic eligibility reading --
         * none of those roles are touched this cycle.
         */
        const dependencyKind: DependencyKind =
          expectedReferenceMember === 'record'
            ? 'record'
            : expectedReferenceMember === 'field'
              ? 'field'
              : 'none';
        /*
         * Cycle 46: extended from `dependencyKind === 'record'` only (a
         * Row variable's `.RECORD` member, e.g. `&row.IsDeleted`) to also
         * cover `dependencyKind === 'field'` (a Record-typed variable/
         * parameter's own bare member, e.g. `&AbsenceRec.IsDeleted`) --
         * the exact same identifier set the `Record.X.MEMBER` explicit-chain
         * branch above already excludes for the identical reason
         * (definition 982's own `Record.AMM_DERIVED.IsChanged`: "a boolean
         * Row-state property of the RECORD's underlying Row, not a field
         * name"). Definition 29522's `&AbsenceRec.IsDeleted` (a Record-typed
         * method PARAMETER, reachable only once Cycle 46's parameter
         * threading makes `&AbsenceRec` field-mode-eligible at all) is
         * direct evidence this exclusion was missing for the field-mode
         * path -- without it, `.IsDeleted` wrongly became a FIELD reference
         * instead of staying inline text.
         *
         * Cycle 63 adds `Name` -- see the `explicitRecordFieldChainIsRowStateMember`
         * comment above (the explicit `Record.X.MEMBER` chain's own mirrored
         * exclusion) for the population evidence (144/144, zero
         * contradictions) motivating this addition.
         */
        const isInlineRowStateMember =
          ((dependencyKind === 'record' || dependencyKind === 'field') &&
            /^(?:RowNumber|IsNew|IsDeleted|IsChanged|Visible|Selected|Name)$/i.test(member) &&
            /*
             * Cycle 98: `Selected` is a Row property, not a Record one. Off a
             * Record value stored binds it as a FIELD row (6 / 6, e.g.
             * `&rs.GetRow(&i).ADHOC_SALCHG_WK.SELECTED.Value`, 560, 562);
             * no Record-value `.Selected` is inline anywhere.
             */
            !(dependencyKind === 'field' && /^Selected$/i.test(member))) ||
          (!isMethodCall && isBuiltinObjectProperty(dependencyKind, member));

        const hasExistingExpectedReference = references.some(item =>
          expectedReferenceMember === 'record'
            ? (item.kind === 'record' || (isMethodCall && item.kind === 'scroll')) &&
              same(item.recordName, member)
            : expectedReferenceMember === 'field'
              ? item.kind === 'field' && same(item.fieldName, member)
              : false
        );
        const directLevel0RecordField =
          expectedReferenceMember === 'record' &&
          selectedByDirectRowsetPostfix &&
          controlDepth === 0 &&
          functionDepth === 0 &&
          baseVariableName !== undefined &&
          same(
            rowsetRecordNamesByVariable.get(baseVariableName.toLowerCase()),
            member
          )
            ? /^\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(source.slice(pos))?.[1]
            : undefined;
        const directLevel0RecordFieldKey =
          directLevel0RecordField === undefined
            ? undefined
            : `${controlGroup}:${baseVariableName!.toLowerCase()}:${member.toLowerCase()}:${directLevel0RecordField.toLowerCase()}`;

        /*
         * Cycle 6 diagnostic only (see ChainSemanticsDiagnostic's own
         * comment): for a BARE (non-method-call) member -- the exact
         * shape definitions 1423/1424/1721/1722 vs. 432/524 distinguish
         * -- compare ChainSemantics' receiver-provenance-based
         * prediction against what `expectedReferenceMember` (a purely
         * name-based decision with no provenance check) actually
         * decides. Scoped to bare members only: a `.GetField(...)`-style
         * method call is a structurally different, already-well-evidenced
         * case this diagnostic is not about. Fires the optional
         * `chainSemanticsTrace` hook only; never reads its own result,
         * never branches on it.
         */
        if (!isMethodCall && !isInlineRowStateMember) {
          const predictedEligible = chainSemantics.binding === 'dependency-bound';
          const actualEligible = expectedReferenceMember !== undefined;

          if (predictedEligible !== actualEligible) {
            context?.chainSemanticsTrace?.({
              sourceOffset: pos - member.length,
              member,
              predicted: chainSemantics,
              actualBindingEligible: actualEligible
            });
          }
        }

        /*
         * Cycle 7 (Phase 7C): a bare (non-method-call) member is eligible
         * to become a NEW dependency only when the receiver it is being
         * read off carries binding provenance -- `chainSemantics.binding`
         * for the receiver's state immediately before this member (the
         * same state the diagnostic comparison above already reads,
         * unchanged). Scoped to `!isMethodCall` only: the
         * `hasExistingExpectedReference` method-call-reuse branch is
         * untouched, since that is a reuse decision, not the binding
         * question this cycle targets (see the `expectedReferenceMember`
         * assignment's own comment above for why gating THAT value
         * directly caused real regressions by also disturbing
         * `reuseFieldReferenceWithinControlGroup`). Also treats
         * `chainSemantics.provenance === 'selector'` as eligible -- a
         * dynamic reading caused by the separate, deliberately-unmodeled
         * Rowset-selector mechanism (see that transition's own comment)
         * must not be suppressed by this gate; doing so regressed
         * definitions 939/1078 (GetLevel0()(N)-then-selector chains)
         * during Cycle 7's own validation, which is exactly the signal
         * Phase 7D/7E's protocol is designed to catch. Phase 7A's
         * full-corpus census: 0/172 currently EXACT in the population
         * this excludes (the genuinely-no-evidence population, which
         * never passes through the selector mechanism). Cycle 9 (Phase
         * 9B) replaced the former separate `chainSemanticsBindingUnmodeled`
         * boolean with this direct `provenance` check -- see
         * `ChainSemantics.provenance`'s own comment for why `'selector'`
         * is representable there now instead.
         */
        const bareMemberBindingEligible =
          isMethodCall ||
          chainSemantics.binding === 'dependency-bound' ||
          chainSemantics.provenance === 'selector';

        if (
          expectedReferenceMember !== undefined &&
          ((!isMethodCall && bareMemberBindingEligible) || hasExistingExpectedReference) &&
          !isInlineRowStateMember &&
          !rootIsUndeclaredVariable
        ) {
          // Cycle 9 (Phase 9C): see `resolvePostfixMemberReuse`'s own
          // declaration comment -- this call is byte-for-byte the same
          // lookup that used to be inlined here.
          let reference = resolvePostfixMemberReuse(
            member,
            dependencyKind,
            isMethodCall,
            explicitRecordRootName,
            baseVariableName,
            directLevel0RecordFieldKey
          );

          /*
           * Cycle 65 (definition 29099): a compatible FIELD identity for
           * this SAME field name may already have been committed by an
           * EARLIER method's own bare-member/`Field.X` occurrence --
           * `fieldDependencyScope` (Cycle 46) already gives this pool
           * METHOD-WIDE lifetime via `fieldScopeId()`, but (like Cycle
           * 64's `ensureLocalObjectPackageReference` before this cycle)
           * never consulted the class-wide `applicationClassTypeReferenceSession`
           * facade (Cycle 57) before falling back to a fresh allocation --
           * so the SAME field name referenced from a SECOND method
           * allocated its own duplicate FIELD row. This project's own
           * `PeopleCodeReference` shape for `kind: 'field'` carries no
           * `recordName` at all -- field identity is already modeled as
           * "field name only" within one scope (Cycle 9), so extending
           * that same name-only key to be class-wide is a direct,
           * evidence-backed analog of Cycle 64's PACKAGE-kind fix, not a
           * new abstraction. A corpus-wide census
           * (`cycle65-field-classwide-reuse-census.ts`, 1,575 (definition,
           * field-name) candidates referenced in 2+ methods) found 246
           * cases where stored collapses to exactly ONE identity across
           * every method while generated allocated 2+, and the only
           * "under-allocated" mismatches (13, all definition `29797`) are
           * the SAME already-known, pre-existing, unrelated multi-identity
           * gap Cycles 56/57/62/64 each found (generated was already 1
           * before this cycle, so this fix is a no-op for them). Scoped
           * to `dependencyKind === 'field'` only -- Cycle 43/45's own
           * RECORD canonicalization (`dependencyKind === 'record'`) is
           * completely untouched.
           */
          if (reference === undefined && dependencyKind === 'field') {
            reference = context?.applicationClassTypeReferenceSession?.lookup({
              kind: 'field',
              fieldName: member
            });
          }
          /*
           * Cycle 119: in an Application Class body a Row-shorthand RECORD
           * member (`&rwAgcTmplTbl.AGC_TMPL_TBL.DESCR100.Value`) has the
           * same lifetime as an explicit `Record.X` (Cycle 71): the
           * method-wide record scope, then the class-wide session -- one
           * RECORD row per record name in the whole program. Formerly it
           * was looked up only in its own control-group pools, so a later
           * control group or method opened the record again.
           * `cycle119-row-shorthand-lifetime-census.ts` (stored App Class
           * programs): of 8,432 repeated shorthand RECORD occurrences,
           * 8,417 reuse the earlier row (same statement 1,494, same method
           * 5,175, other method 1,748; other control group 2,143) -- the
           * 15 that open again are all in 29797 / 30179. Ordinary programs
           * keep their allocation units (stored opens 3,257 of 20,760
           * same-method repeats there).
           */
          if (reference === undefined && dependencyKind === 'record' && !isMethodCall && context?.recordDependenciesHaveMethodWideLifetime) {
            reference = context?.applicationClassTypeReferenceSession?.lookup({
              kind: 'record',
              recordName: member
            });
          }

          if (reference === undefined) {
            reference =
              dependencyKind === 'record'
                ? nextReference({
                    kind: 'record',
                    recordName: member
                  })
                : nextReference({
                    kind: 'field',
                    fieldName: member
                  });
          }

          // Cycle 9 (Phase 9C): see `recordPostfixMemberReuse`'s own
          // declaration comment -- byte-for-byte the same write-back that
          // used to be inlined here.
          recordPostfixMemberReuse(
            member,
            dependencyKind,
            explicitRecordRootName,
            baseVariableName,
            directLevel0RecordFieldKey,
            fieldMemberFromGetRecord,
            reference,
            (chainSemantics.valueType === 'record' && chainSemantics.provenance === 'declared') ||
              (fieldMemberFromRowShorthand && context?.recordDependenciesHaveMethodWideLifetime === true)
          );

          // This 0x4A path writes its own operand bytes directly instead of
          // going through referenceOperand() (0x21's shared helper), so it
          // must fire its own diagnostic USE trace the same way -- see the
          // matching note on the 0x48 quoted-reference site. Purely
          // observational: does not affect encoding.
          const emitted = unitRecordOperand(reference);
          context?.referenceTrace?.({
            action: 'USE',
            sourceOffset: pos,
            controlGroup,
            controlDepth,
            functionDepth,
            reference: emitted
          });

          chunks.push(Buffer.from([
            0x4a,
            emitted.index & 0xff,
            (emitted.index >>> 8) & 0xff
          ]));

          /*
          * Row shorthand:
          *
          *   &rs(1).RECORD.FIELD.Value
          *
          * RECORD is followed by FIELD. FIELD then returns us to normal
          * member/property encoding.
          */
          fieldMemberFromRowShorthand = expectedReferenceMember === 'record';
          expectedReferenceMember =
            expectedReferenceMember === 'record'
              ? 'field'
              : undefined;
          fieldMemberFromGetRecord = false;
          // Cycle 6: mirrors expectedReferenceMember's own transition
          // immediately above exactly (record->field, else->no longer
          // bound) -- a bound RECORD's own member consumption yields a
          // bound FIELD; consuming a further member past an already-FIELD
          // chain yields a scalar (FIELD's own further members, e.g.
          // .Value, are inline properties per Cycle 4's table).
          /*
           * Cycle 7: the 'field' arm INHERITS binding/provenance from the
           * receiver (same pattern as the method-call branch) -- this
           * matters for definition 939's second member
           * (`.PSSPTIMES.MSGSPTNAME`, a RECORD-then-FIELD pair where BOTH
           * members follow a selector-derived receiver): inheriting
           * `chainSemantics.provenance` here naturally carries `'selector'`
           * through to the FIELD step too (see `ChainSemantics.provenance`'s
           * own comment). Only the 'scalar' arm (FIELD's own further
           * member, e.g. `.Value`) is a genuine fresh reset to `'unknown'`,
           * which by construction is never `'selector'`.
           */
          chainSemantics =
            expectedReferenceMember === 'field'
              ? { valueType: 'field', binding: chainSemantics.binding, provenance: chainSemantics.provenance }
              : { valueType: 'scalar', binding: 'dynamic', provenance: 'unknown' };
          continue;
        }

        if (isInlineRowStateMember) {
          expectedReferenceMember = undefined;
          // Cycle 6: inline Row state/property members (.RowNumber,
          // .IsChanged, etc.) are scalar and do not carry the chain
          // forward as a bound value -- mirrors expectedReferenceMember's
          // own reset immediately above.
          chainSemantics = { valueType: 'scalar', binding: 'dynamic', provenance: 'unknown' };
        }

        chunks.push(
          textOperand(
            INLINE_IDENTIFIER_OPCODE,
            TokenKind.Name,
            member
          )
        );

        if (isMethodCall) {
          if (
            activeApplicationClassReceiver === undefined &&
            receiverClassIsExternalMetadata &&
            ordinaryProgram &&
            context?.externalClassMetadata !== undefined
          ) {
            context.externalClassMetadata.unresolvedReceiverCalls++;
          }

          let methodResultType: ApplicationClassMemberType | undefined;
          if (activeApplicationClassReceiver !== undefined) {
            // The call's RESULT is of a class only the method signature names
            // -- unless the type-metadata provider resolves it (Cycle 107).
            methodResultType = consultTypeMetadata(
              'method-result',
              [...activeApplicationClassReceiver.packagePath, activeApplicationClassReceiver.className],
              member
            );
            if (!activeApplicationClassReceiver.externalMetadataExempt && methodResultType === undefined) receiverClassIsExternalMetadata = true;

            const classKey = [
              ...activeApplicationClassReceiver.packagePath,
              activeApplicationClassReceiver.className
            ].map(component => component.toLowerCase()).join(':');

            /*
             * Leading/declaration-phase instances created in this program may
             * reuse their runtime-create dependency for method calls; offset
             * 179 has no separate method PSPCMNAME row.
             *
             * Offset 411 proves the complementary case: a late initialized
             * Application Class Local, after top-level executable code has
             * begun, stores both the runtime-create dependency and a distinct
             * method dependency.
             */
            /*
             * Cycle 94: in an ordinary program the call uses its class in
             * the current allocation unit -- a new method row unless the
             * unit already has a row for the class (see
             * `useApplicationClassRow`). The reuse logic below is the
             * earlier model, kept for programs encoded without it.
             *
             *   18918  Local HR_EMPL_PHOTO:EmployeePhoto &h = create HR_EMPL_PHOTO:EmployeePhoto();
             *          &h.DisplayPhotoHeader(DERIVED_ABS_SS.EMPLID.Value, ...);
             *          => EMPLOYEEPHOTO 6, EMPLOYEEPHOTO 7 (APPCLASSMETHOD
             *             DISPLAYPHOTOHEADER), EMPLID 8
             */
            if (unitScopedClassRows) {
              useApplicationClassRow(
                activeApplicationClassReceiver.packagePath,
                activeApplicationClassReceiver.className,
                member
              );
            } else if (context?.applicationClassProgramRows !== undefined) {
              /*
               * Cycle 108: in an Application Class program the call uses the
               * program's row of its class (`ApplicationClassProgramRows`):
               * a new row only when the class has none yet. A later Local or
               * `create` of the class in this fragment reuses it too.
               */
              const programRow = context.applicationClassProgramRows.find(
                activeApplicationClassReceiver.className,
                references
              );
              if (programRow === undefined) {
                localApplicationClassPackageReferences.set(
                  `${functionDepth}:${classKey}`,
                  addApplicationClassReference(
                    activeApplicationClassReceiver.packagePath,
                    activeApplicationClassReceiver.className,
                    member
                  )
                );
              }
            } else if (
              !runtimeCreateReferences.has(classKey) ||
              !activeApplicationClassReceiver.reuseRuntimeCreateForMethods
            ) {
              /*
               * Cycle 62: a compatible TYPE-only identity for this SAME
               * class may already have been committed by an EARLIER
               * fragment -- an explicit import, a property/instance
               * declaration, or an earlier create/Local occurrence --
               * exactly the class-wide facade `ensureLocalApplicationClassPackageReference`/
               * `ensureRuntimeCreateReference` already consult (Cycle 57's
               * `applicationClassTypeReferenceSession`). A corpus-wide
               * census (`cycle62-method-dependency-typeonly-reuse-census.ts`,
               * 722 candidates) found ZERO cases where stored PeopleTools
               * allocates a genuinely separate method-qualified PACKAGE row
               * once a type-only identity for the class already exists --
               * 417/722 show stored reusing the existing type row instead
               * (the remaining 305 are an unrelated, pre-existing gap: the
               * receiver's leaf has no PSPCMNAME row of ANY shape in
               * stored, a different, not-yet-characterized defect this
               * cycle does not touch). This call's return value is already
               * discarded by every caller -- the method name itself is
               * encoded as inline text a few lines above, not via this
               * reference's namenum -- so skipping the allocation entirely
               * when a compatible identity already exists is the complete
               * fix; no operand needs to be redirected.
               */
              const classWideTypeIdentity = context?.applicationClassTypeReferenceSession?.lookup({
                kind: 'package',
                packageName: activeApplicationClassReceiver.className.toUpperCase(),
                objectName: activeApplicationClassReceiver.packagePath[0]?.toUpperCase(),
                packagePath: activeApplicationClassReceiver.packagePath.map((component, index) => index === 0 ? component.toUpperCase() : component),
                className: activeApplicationClassReceiver.className.toUpperCase()
              });

              /*
               * Cycle 82: the same reuse applies to an identity this SAME
               * Application Class method already established through a
               * `Local` declaration or `create` (not yet committed to the
               * class-wide session). 28790's `Local PTAI_COLLECTION:Collection
               * &collContextData;` followed by `&collContextData.Item(...)`
               * stores one COLLECTION row, not a second method row. Across
               * all App Classes (LOCAL SNAPSHOT) this changes 57 generated
               * PSPCMNAME lists: 25 now match stored further (all 25 fully),
               * 0 match less. The pool is populated only for Application
               * Class fragments, so ordinary PeopleCode's calibrated
               * create-plus-method behavior (offset 411) is unaffected.
               */
              const methodLocalTypeIdentity =
                localApplicationClassPackageReferences.get(`${functionDepth}:${classKey}`);
              if (classWideTypeIdentity === undefined && methodLocalTypeIdentity === undefined) {
                addApplicationClassReference(
                  activeApplicationClassReceiver.packagePath,
                  activeApplicationClassReceiver.className,
                  member
                );
              }
            }
          }

          /*
           * Without return-type metadata the result of a call cannot retain
           * class provenance. Cycle 107: with it, the declared result class
           * is the receiver of the next step.
           */
          activeApplicationClassReceiver =
            methodResultType?.kind === 'class' ? metadataReceiver(methodResultType.path) : undefined;
          // Cycle 109: an array result: its element, once indexed
          if (methodResultType?.kind === 'array') pendingArrayElement = arrayElementOf(methodResultType);

          const previousReuseRecordReferenceByName =
            reuseRecordReferenceByName;
          const previousReuseRecordReferenceWithinControlGroup =
            reuseRecordReferenceWithinControlGroup;
          const previousMarksControlGroupParticipant =
            marksControlGroupParticipant;
          const previousReuseScrollReferenceWithinControlGroup =
            reuseScrollReferenceWithinControlGroup;
          const previousReuseFieldReferenceWithinControlGroup =
            reuseFieldReferenceWithinControlGroup;
          const previousFieldReferenceOccurrenceOwnedByGetField =
            fieldReferenceOccurrenceOwnedByGetField;

          /*
           * Cycle 66/69: ANY `GetField(...)` call (regardless of
           * `fieldMemberFromGetRecord`, unlike `reuseFieldReferenceWithinControlGroup`
           * just below) owns its own explicit `Field.X` argument's
           * occurrence for ORDINARY PeopleCode only -- see
           * `fieldReferenceOccurrenceOwnedByGetField`'s own declaration
           * comment for the population evidence (Cycle 69 confirmed
           * Application Class bodies do NOT share this behavior).
           */
          if (
            /^GetField$/i.test(member) &&
            !context?.recordDependenciesHaveMethodWideLifetime
          ) {
            fieldReferenceOccurrenceOwnedByGetField = true;
          }

          /*
           * Record.X arguments to Select() reuse the same RECORD dependency
           * within the current control group.
           *
           * DERIVED_CO.FUNCLIB.FieldFormula proves two consecutive
           * &HeaderRowset.Select(Record.CRSE_ALL_SSN_VW, ...) calls both use
           * PSPCMNAME NAMENUM 9 rather than allocating a second RECORD row.
           *
           * Neither GetRecord nor Select has ScrollFlush's proven
           * participating-map exception (see `marksControlGroupParticipant`),
           * so both also mark their own fresh allocation as a participating
           * source, matching this flag's previous combined behavior.
           */
          if (/^(?:GetRecord|Select)$/i.test(member)) {
            reuseRecordReferenceWithinControlGroup = true;
            marksControlGroupParticipant = true;
          }

          if (/^GetRowset$/i.test(member)) {
            reuseScrollReferenceWithinControlGroup = true;
          }

          /*
           * Field.X reuse is scoped to a GetField(...) call immediately
           * chained onto this same expression's own field context coming
           * from a .GetRecord(...) result -- not merely
           * expectedReferenceMember === 'field' by itself, since that is
           * ALSO true on the very first postfix step off a declared
           * Record variable (`&rec.GetField(...)` where `&rec` is
           * `Local Record &rec;`), a structurally different, unrelated
           * case. `fieldMemberFromGetRecord` rules that out: it is only
           * ever true when the current field context was established by a
           * `.GetRecord(...)` result, whether that was a postfix chain
           * step (`&row.GetRecord(...)`) or the bare primary call itself
           * (`GetRecord(Record.X)` with no leading `&variable.` receiver).
           *
           * Deliberately narrow: 'encodeProgramArtifacts allocates
           * repeated Scroll and Field references by occurrence' (existing
           * calibrated test) proves GetField(Field.CODE) called on a
           * STORED Record variable (`&rec = GetRecord(...); &rec.GetField
           * (Field.CODE); &rec.GetField(Field.CODE);`, two separate
           * statements, GetField as the first postfix step both times)
           * remains occurrence-based -- each call gets its own fresh
           * FIELD row. Only a GetField(...) directly continuing the same
           * .GetRecord(...) result (definition 524, and definition 535's
           * bare-call form) reuses.
           */
          if (
            /^GetField$/i.test(member) &&
            fieldMemberFromGetRecord &&
            expectedReferenceMember === 'field'
          ) {
            reuseFieldReferenceWithinControlGroup = true;
          }
          try {
            parenthesized(() => {
              space();

              if (source[pos] === ')') {
                return;
              }

              expression();
              space();

              while (source[pos] === ',') {
                pos++;
                chunks.push(fixed(','));
                expression();
                space();
              }
            }, true);
          } finally {
            reuseRecordReferenceByName =
              previousReuseRecordReferenceByName;
            reuseRecordReferenceWithinControlGroup =
              previousReuseRecordReferenceWithinControlGroup;
            marksControlGroupParticipant =
              previousMarksControlGroupParticipant;
            reuseScrollReferenceWithinControlGroup =
              previousReuseScrollReferenceWithinControlGroup;
            reuseFieldReferenceWithinControlGroup =
              previousReuseFieldReferenceWithinControlGroup;
            fieldReferenceOccurrenceOwnedByGetField =
              previousFieldReferenceOccurrenceOwnedByGetField;
          }

          /*
           * Cycle 7 (Phase 7C): this assignment is deliberately left
           * UNCHANGED (unconditional on the method name, no receiver
           * check) -- an earlier attempt to gate it directly here on
           * `chainSemantics.binding` caused real EXACT regressions
           * (definition 1661 and 113 others) because `expectedReferenceMember`
           * is NOT purely an eligibility flag: `reuseFieldReferenceWithinControlGroup`
           * a few dozen lines below reads it directly
           * (`fieldMemberFromGetRecord && expectedReferenceMember === 'field'`)
           * to decide whether a FOLLOWING `.GetField(...)` call reuses an
           * existing FIELD reference -- a genuine reuse decision Phase 7C
           * explicitly must not change. The receiver-provenance gate is
           * instead applied only at the bare-member (non-method-call)
           * eligibility site below, which is the one Phase 7A's census
           * (0/172 currently EXACT in the "no evidenced provenance"
           * population) actually validated. See the Cycle 7 report in
           * .claude/corpus-progress.md.
           */
          expectedReferenceMember =
            member.toLowerCase() === 'getrecord'
              ? 'field'
              : member.toLowerCase() === 'getrow'
                ? 'record'
                : undefined;
          fieldMemberFromGetRecord =
            member.toLowerCase() === 'getrecord';
          fieldMemberFromRowShorthand = false;
          if (/^GetRow$/i.test(member)) {
            selectedByDirectRowsetPostfix = false;
          }
          /*
           * Cycle 6: unlike expectedReferenceMember's own transition just
           * above (which sets 'field'/'record' from the method NAME
           * alone, with no receiver check -- exactly the gap
           * ChainSemanticsDiagnostic exists to surface), chainSemantics
           * INHERITS binding/provenance from the receiver's OWN state
           * before this call, per Cycle 4's evidence: "Postfix calls
           * inherit whether the receiver chain is statically/schema
           * bound; a method name on a dynamic value does not by itself
           * authorize dependency shorthand." Calling `.GetRecord(...)`/
           * `.GetRow(...)`/`.GetRowset(...)` changes valueType but does
           * NOT itself upgrade an unbound receiver to bound.
           *
           * Cycle 7: the three Get(Record|Row|Rowset) arms inherit
           * `chainSemantics.binding` AND `chainSemantics.provenance` from
           * the receiver, so a `'selector'` provenance (Cycle 9, Phase 9B
           * -- see `ChainSemantics.provenance`'s own comment) passes
           * through unchanged here too. Only the final,
           * unrecognized-method-name arm is a genuine fresh reset (to
           * `provenance: 'unknown'`, never `'selector'`).
           */
          chainSemantics =
            /^GetRecord$/i.test(member)
              ? { valueType: 'record', binding: chainSemantics.binding, provenance: chainSemantics.provenance }
              : /^GetRow$/i.test(member)
                ? { valueType: 'row', binding: chainSemantics.binding, provenance: chainSemantics.provenance }
                : /^GetRowset$/i.test(member)
                  ? { valueType: 'rowset', binding: chainSemantics.binding, provenance: chainSemantics.provenance }
                  : { valueType: 'unknown', binding: 'dynamic', provenance: 'unknown' };
        } else {
          /*
           * A property/member traversal changes the receiver. Without
           * property-type metadata, any later method in the chain must not be
           * attributed to the original Application Class variable.
           *
           * Cycle 67 exception: `%Super.<inheritedProperty>` IS a property
           * traversal WITH property-type metadata (externally resolved via
           * `context.inheritedPropertyTypes`) -- exactly the same shape of
           * carve-out `.ParentRow`/`.ParentRowset` already have a few lines
           * below for `chainSemantics`, just for `activeApplicationClassReceiver`
           * instead. Only this ONE step (the property access itself) is
           * exempted; a SECOND, unrelated bare member later in the same
           * chain still resets normally on its own iteration.
           */
          if (!resolvedInheritedPropertyThisStep) {
            /*
             * Cycle 107: the type-metadata provider may know the
             * property's declared type: an Application Class becomes the
             * receiver (`&cmpSession.Manager.CAFTrace(...)`, 2134); a
             * resolved non-class type ends the chain WITHOUT counting as
             * external metadata; an unresolved one keeps the Cycle 93
             * accounting.
             */
            const propertyType = activeApplicationClassReceiver === undefined
              ? undefined
              : consultTypeMetadata(
                'member',
                [...activeApplicationClassReceiver.packagePath, activeApplicationClassReceiver.className],
                member
              );
            if (propertyType?.kind === 'other') metadataBuiltinType = propertyType.type;
            if (propertyType?.kind === 'class') {
              activeApplicationClassReceiver = metadataReceiver(propertyType.path);
            } else if (propertyType?.kind === 'array') {
              // Cycle 109: an array property: its element, once indexed
              pendingArrayElement = arrayElementOf(propertyType);
              activeApplicationClassReceiver = undefined;
            } else {
              if (
                activeApplicationClassReceiver !== undefined &&
                !activeApplicationClassReceiver.externalMetadataExempt &&
                propertyType === undefined
              ) {
                receiverClassIsExternalMetadata = true;
              }
              activeApplicationClassReceiver = undefined;
            }
          }
          expectedReferenceMember = undefined;
          /*
           * Cycle 6: mirrors the reset immediately above -- an
           * unrecognized property access loses chain-level type/binding
           * tracking (no property-type metadata exists to carry it
           * forward), matching Cycle 4's "inline scalar/property members
           * ... terminate or transform the current member-binding mode."
           *
           * Cycle 7 exception: `.ParentRow`/`.ParentRowset` are the ONE
           * documented exception to that rule -- Cycle 4's own evidence
           * table names them explicitly as NAVIGATION that "preserves,
           * does not establish, provenance" (`ChainSemantics.provenance`
           * even reserves the `'navigation'` value for exactly this,
           * unused until now). Definition 3868
           * (`GetRowset().ParentRow.GetRecord(Record.DEP_BEN_EFF)...`,
           * currently EXACT) proves the gap: without this, `.ParentRow`
           * discarded the bare-`GetRowset()`-intrinsic provenance this
           * cycle's own `bareGetRowsetCallResult` arm established one step
           * earlier, wrongly suppressing the `.GetRecord(...)` call after
           * it.
           *
           * Cycle 9 (Phase 9B) refinement: if the receiver's OWN
           * provenance is `'selector'`, PRESERVE `'selector'` here rather
           * than overwriting it with `'navigation'`. This is not a
           * behavior change -- it exists to reproduce, via `provenance`
           * alone, exactly what the former separate
           * `chainSemanticsBindingUnmodeled` boolean already did: that
           * flag was left untouched (not reset) by this exact arm, so a
           * selector-derived receiver's "unmodeled" status survived
           * `.ParentRow`/`.ParentRowset` navigation unchanged. Every
           * OTHER receiver shape (declared, intrinsic, schema, or no
           * evidence) still becomes `'navigation'` here exactly as
           * before, matching Cycle 4's own evidenced examples (none of
           * which are selector-derived) and matching the OLD flag's own
           * behavior for those shapes too (it was already `false` and
           * stayed `false`, an unobservable no-op either way since
           * `binding` -- not `provenance` -- decided eligibility for
           * them). `binding` itself is unconditionally inherited exactly
           * as before in both arms.
           */
          const isParentNavigation = /^Parent(?:Row|Rowset)$/i.test(member);
          chainSemantics = isParentNavigation
            ? {
                valueType: /^ParentRow$/i.test(member) ? 'row' : 'rowset',
                binding: chainSemantics.binding,
                provenance:
                  chainSemantics.provenance === 'selector'
                    ? 'selector'
                    : 'navigation'
              }
            : { valueType: 'unknown', binding: 'dynamic', provenance: 'unknown' };

          /*
           * Cycle 98: `.ParentRow` returns a Row, whose next bare member
           * is a record name (`&fld.ParentRow.REC.FIELD`, `&rec.ParentRow.REC`)
           * unless it is a Row property. Stored binds it as a RECORD row in
           * all 14 occurrences (10 definitions, e.g. 7912, 21644); every
           * inline member after `.ParentRow` in the corpus is a Row
           * property or method (ParentRowset, RowNumber, IsNew, IsDeleted,
           * DeleteEnabled, GetRecord, GetRowset).
           */
          if (/^ParentRow$/i.test(member) && !isMethodCall) {
            expectedReferenceMember = 'record';
            chainSemantics = { valueType: 'row', binding: 'dependency-bound', provenance: 'navigation' };
          }

          /*
           * Cycle 118: a property the type-metadata provider declares
           * `Record` (`property Record ObjectRecord;`, own or inherited, on
           * `%This`, `%Super` or a typed receiver) is a declared Record
           * value, exactly like a `Local Record &r` base: its next bare
           * member is a FIELD row (`Return %This.ObjectRecord.CAF_FCTLST_ID
           * .Value`, 29128), its intrinsic properties (`.FieldCount`,
           * `.Name`) stay inline, and the FIELD then reaches `.Value` as
           * any Field does. No PACKAGE row: the type is built-in.
           * `cycle118-builtin-metadata-receiver-census.ts`: 545 members
           * after a Record-typed property / method result, 503 with a
           * stored FIELD row of that name (the rest FieldCount 15,
           * GetField 12, Name 11 and 4 others), none with a RECORD row.
           * Only Record: after Row (43), Rowset (66) and Field (23) results
           * no member stores a FIELD row, and Row's 5 RECORD rows do not
           * yet settle a rule. Method results are not typed here: the only
           * Record-returning calls followed by a field (44) are in one
           * unencodable program (29391).
           */
          if (metadataBuiltinType !== undefined && /^Record$/i.test(metadataBuiltinType.trim()) && !isMethodCall) {
            expectedReferenceMember = 'field';
            chainSemantics = { valueType: 'record', binding: 'dependency-bound', provenance: 'declared' };
          }
        }

        continue;
      }

      if (source[pos] === '[') {
        activeApplicationClassReceiver = undefined;

        pos++;
        chunks.push(Buffer.from([0x4c]));

        expression();
        space();

        if (source[pos] !== ']') {
          return fail('expected ] after array subscript');
        }

        pos++;
        chunks.push(Buffer.from([0x4d]));
        if (pendingArrayElement !== undefined && pendingArrayElement.remaining > 0) {
          pendingArrayElement.remaining--;
          if (pendingArrayElement.remaining === 0) {
            activeApplicationClassReceiver = {
              packagePath: pendingArrayElement.packagePath,
              className: pendingArrayElement.className,
              reuseRuntimeCreateForMethods: false,
              externalMetadataExempt: true
            };
            pendingArrayElement = undefined;
          }
        }
        continue;
      }

      if (source[pos] === '(' && allowDirectPostfixCall) {
        parenthesized(() => {
          space();

          if (source[pos] === ')') {
            return;
          }

          expression();
          space();

          while (source[pos] === ',') {
            pos++;
            chunks.push(fixed(','));
            expression();
            space();
          }
        }, true);

          /*
           * Rowset selector result is a Row. Its first dotted member is
           * normally a RECORD dependency even when the RECORD object itself
           * is the complete expression:
           *
           *   &rs(CurrentRowNumber()).AA_HIST_JPN_VW
           *
           * AA_COST_RT_JPN.EMPLID.RowInit proves that single-member form must
           * compile through PSPCMNAME as RECORD.
           *
           * Genuine Row state/properties such as .Visible, .IsNew,
           * .IsDeleted and .IsChanged are filtered by
           * isInlineRowStateMember above and remain inline names.
           */
          expectedReferenceMember = 'record';
          selectedByDirectRowsetPostfix = true;
          /*
           * Cycle 6: NOT one of Phase 6A's named evidenced transitions
           * (the corpus evidence for this specific construct, cited
           * above, predates this cycle and was never expressed in
           * receiver-provenance terms). Deliberately NOT inherited from
           * the receiver's own chainSemantics -- reset to 'unknown'/
           * 'dynamic' rather than guessed at, per "use unknown where
           * evidence is insufficient." This means a discrepancy the
           * diagnostic reports immediately after a Rowset-selector `(...)`
           * call is a DIFFERENT category from the 1423/1424-style
           * receiver-provenance gap: it reflects this construct not
           * being modeled yet, not a claim that the existing
           * `expectedReferenceMember = 'record'` behavior is wrong (it
           * is independently evidence-backed, see the comment above).
           *
           * Cycle 7: the `expectedReferenceMember = 'record'` assignment
           * two lines above is intentionally UNGATED by Cycle 7's own
           * eligibility check for exactly this reason: it is a separate,
           * already-correct mechanism, not the receiver-provenance
           * question that gate targets.
           *
           * Cycle 9 (Phase 9B): this is the ONE site that produces
           * `provenance: 'selector'` -- see `ChainSemantics.provenance`'s
           * own comment. `binding` still reads `'dynamic'` (unchanged from
           * Cycle 6/7): only the LABEL for "this construct's own
           * receiver-provenance rule is unmodeled" moved from a separate
           * boolean into `provenance` itself; the underlying uncertainty
           * this comment describes is unchanged.
           */
          chainSemantics = { valueType: 'row', binding: 'dynamic', provenance: 'selector' };

          continue;
        }
      break;
    }
  };
  let sawTopLevelDeclaration = false;
  /*
   * Cycle 14: an Application Class method body is not a top-level
   * program -- it has no leading declaration SECTION of its own for
   * PeopleTools to mark the close of with a `0x2D` byte. The golden
   * OU_CORPUS:Utilities:TestClass fixture's own method body
   * (`Local OU_CORPUS:Utilities:TestClass &obj;` immediately followed by
   * `&obj = create ...();`) proves this directly: ordinary top-level
   * code with this exact shape (declared-then-assigned-separately, no
   * inline initializer) DOES get a 0x2D boundary marker (this is the
   * `leadingRunHasInitializedLocal`-gated case a few hundred lines
   * below), but the captured method-body bytes have none at all -- their
   * OWN companion blank-line `0x4F` marker(s) are UNAFFECTED and still
   * fire normally. `context?.suppressDeclarationSectionMarkers` therefore
   * gates only the specific `0x2D` pushes below (search for it), not
   * these two tracking flags themselves.
   */
  let closedTopLevelDeclarationSection = false;

  // A leading run of Local declarations is not, by itself, a 0x2D declaration
  // section. Primitive-only fixtures prove that PeopleTools emits no trailing
  // 0x2D and no 0x2D/0x4F transition for ordinary Local declarations.
  //
  // Reference-bearing programs are different: calibrated Record/Field/Rowset/
  // SQL fixtures place 0x2D 0x4F between the leading Local run and the first
  // executable statement. We cannot know whether the program has compiled
  // PSPCMNAME references until parsing has progressed, so remember the chunk
  // insertion point and decide after the full fragment has been parsed.
  let leadingLocalRun = true;
  let sawLeadingLocalDeclaration = false;
  let lastLocalHadInitializer = false;
  let pendingReferenceLocalBoundary: number | undefined;
  let pendingReferenceLocalMarkers = 1;
  /*
   * Cycle 84: the deferred leading-Local boundary's marker count when the
   * close is INFORMAL (no 0x2D, because the run contains an initialized
   * Local): the source's actual blank-line count, which may be zero. The
   * `pendingReferenceLocalMarkers` floor of one belongs to the formal
   * `0x2D 0x4F` close only -- see the flush block at the end of this
   * function. Set alongside `pendingReferenceLocalMarkers` everywhere.
   */
  let pendingReferenceLocalBlankLines = 0;
  /*
   * Cycle 86: deferred leading-Local boundaries of runs that already ended
   * before a top-level Function definition. Each Local run in the
   * declaration phase closes on its own (see the restart in the
   * `isFunction` branch); these are flushed exactly like the current
   * pending boundary, each with its own run's initialized flag.
   */
  const archivedReferenceLocalBoundaries: Array<{
    index: number;
    markers: number;
    blankLines: number;
    initialized: boolean;
  }> = [];
  const pendingReferenceGroupBoundaries: number[] = [];
  let haveCompletedTopLevelStatement = false;

  /*
   * An initialized Local anywhere in the leading declaration run means the
   * run's eventual close (whenever it happens -- at that initializer itself
   * if no further Local follows, or later once the true first non-Local
   * statement is reached) gets no 0x2D declaration-section marker, only the
   * ordinary blank-line 0x4F marker(s) -- the initializer's own execution
   * already ended the "pure declaration" phase without a formal boundary.
   *
   * DAEMONGROUP.DAEMONGROUP.SaveEdit (definition 3539):
   *
   *   Local number &i;
   *   Local number &cnt = 0;
   *
   *   Local number &duprow;
   *
   *   Local Rowset &this;
   *
   *   &this = GetLevel0()(1).GetRowset(Scroll.DAEMONGROUP);
   *
   * stores `... &this; 15 4F 01 "&this" ...` before the assignment -- a
   * lone 0x4F for the blank line, no 0x2D -- even though the program has
   * compiled PSPCMNAME references and would otherwise get a 0x2D/0x4F
   * declaration-section close.
   */
  let leadingRunHasInitializedLocal = false;

  /*
   * Tracks whether ordinary executable top-level code has begun.
   *
   * A leading Application Class Local participates in its calibrated Local
   * declaration section. The same syntax encountered later, after executable
   * statements have started, must not reopen a declaration section merely
   * because it begins with Local.
   */
  let sawTopLevelExecutableStatement = false;

  /*
   * Consecutive top-level imports form one declaration section, even when
   * standalone block comments appear between import groups. PeopleTools emits
   * a single 0x2D when that complete import section ends, not one after each
   * import.
   */
  let importSectionOpen = false;
  let sawWildcardImport = false;
  // Cycle 93: see `importStatement`.
  let claimedWildcardImportMetadata = false;

  let sawApplicationClassLocalSection = false;
  let closedApplicationClassLocalSection = false;

  /*
   * The one state transition every import-section closer shares: the
   * section is no longer open. How that fact gets SERIALIZED differs by
   * site (bare 0x2D, 0x2D+0x4F pushed atomically, or 0x2D followed by a
   * separately-deferred 0x4F) and is left explicit at each call site --
   * only the state mutation itself is centralized here.
   */
  const closeImportSection = (): void => {
    importSectionOpen = false;
  };

  /*
   * An import section closing immediately before an ordinary (non-
   * Application-Class-typed) Local declaration starts a fresh,
   * declaration-only Local run -- a distinct compiled declaration group
   * from the import section that just closed (ACCT_CD_NEW_VW.ACCT_CD.
   * SearchInit). Two of the four import-closer sites need this identical
   * reset (the decoded-trailing-import-comment site and the ordinary
   * non-comment site); the other two (a plain standalone comment, and
   * EOF) do not, because neither is immediately followed by a Local
   * declaration in the shapes those sites handle.
   */
  const restartLocalDeclarationRun = (): void => {
    leadingLocalRun = true;
    sawLeadingLocalDeclaration = false;
    pendingReferenceLocalBoundary = undefined;
    pendingReferenceLocalMarkers = 1;
    pendingReferenceLocalBlankLines = 0;
  };

  /*
   * The state transition shared by the two mid-loop Application-Class-
   * Local closers (a standalone comment following the section, and the
   * ordinary end-of-run path): closing this section also closes the
   * generic top-level declaration section, since one boundary serves
   * both (emitting the generic closer's own 0x2D again would duplicate
   * it). NOT used by the EOF flush -- nothing reads either flag once the
   * fragment has ended. `0x2D`/`0x4F` emission differs between the two
   * mid-loop sites (unconditional at the comment site; conditional on
   * `leadingRunHasInitializedLocal`/`suppressDeclarationSectionMarkers`
   * at the main-path site) and stays explicit at each call site.
   */
  const closeApplicationClassLocalSection = (): void => {
    closedApplicationClassLocalSection = true;
    closedTopLevelDeclarationSection = true;
  };

  /*
   * The one state transition shared by 4 of the 5 Generic-Declaration
   * closing sites (disabled-code, standalone-comment, REM, and the main
   * `closesTopLevelDeclarationSection` path): the section is no longer
   * open. Each site's own firing CONDITION differs on purpose and is
   * proven independently by its own corpus evidence -- the disabled-code
   * and REM sites lack guards the comment site has (`!nextIsLocal`,
   * `pendingReferenceLocalBoundary === undefined`, the
   * `sawApplicationClassLocalSection` exclusion), and this helper does
   * not add them. `0x2D` emission also differs per site (unconditional
   * at 3 sites, conditional on `leadingRunHasInitializedLocal`/
   * `suppressDeclarationSectionMarkers` at the main path) and stays
   * explicit at each call site. The EOF flush does not use this helper:
   * nothing reads the flag once the fragment has ended.
   */
  const closeTopLevelDeclarationSection = (): void => {
    closedTopLevelDeclarationSection = true;
  };

  /*
   * Cycle 87: the serialization of a declaration-section close does not
   * depend on WHICH construct triggers it. The close is informal (no
   * 0x2D, only the ordinary blank-line markers) whenever the open section
   * contains an initialized Local (Cycle 84 rule B), whether the trigger is
   * executable code, a standalone block comment, a REM, or disabled code.
   * The main (executable-code) closer already applied this; the three
   * comment-adjacent closers pushed 0x2D unconditionally.
   *
   * LOCAL SNAPSHOT, measured per comment category (forward-exact gain/loss):
   * standalone block comment, generic section +23/0 (4585
   * `D D D D Li L L L L L[4F] /*Bug 12766944*\/ Evaluate`); standalone
   * comment, App-Class-Local section +8/0 (14623); disabled code +1/0 with
   * the boundary corrected in all 4 changed definitions (2092, 2093,
   * 25330); REM 0/0 with the boundary corrected in all 3 changed
   * definitions (19459, 20295, 22889). Combined +33, 0 lost.
   *
   * Cycle 113: nor is there a 0x2D where the fragment suppresses
   * declaration-section markers (an Application Class method body), the
   * same condition every other close site applies. Stored never writes a
   * 0x2D after a Local run in an Application Class program (LOCAL
   * SNAPSHOT: 0 of 6,044 runs, 806 of them followed by a comment); the
   * comment-site closer wrote one before a comment following an
   * App-Class-typed Local (28782, 28801 `Local PTAI_ACTION_ITEMS:ActionItem
   * &item; <blank> /* ... *\/` stores `15 4F 24`).
   */
  const pushDeclarationSectionCloseByte = (): void => {
    if (!leadingRunHasInitializedLocal && context?.suppressDeclarationSectionMarkers !== true) {
      chunks.push(Buffer.from([0x2d]));
    }
  };

  while (true) {
    const whitespaceStart = pos;
    space();
    const topLevelWhitespace = source.slice(whitespaceStart, pos);
    const hasBlankLine = /(?:\r?\n)[ \t]*(?:\r?\n)/.test(topLevelWhitespace);

    if (pos === source.length) {
      break;
    }

    if (source.startsWith('<*', pos)) {
      /*
       * A standalone disabled-code marker (<* ... *>) can also follow an
       * open top-level declaration section, exactly like the standalone
       * block-comment branch below already handles (see that branch's
       * own `sawTopLevelDeclaration && !closedTopLevelDeclarationSection`
       * check) -- this branch was missing the equivalent close entirely.
       *
       * BN_LIMITTYP_RUN.LIMIT_TYPE.SaveEdit (definition 1929):
       *
       *   Global boolean &RunLimits_Age;
       *
       *   <*
       *   If All(BN_LIMITTYP_RUN.LIMIT_TYPE) Then
       *      ...
       *   End-If;
       *   *>
       *
       *   If None(BN_LIMITTYP_RUN.LIMIT_TYPE) Then
       *
       * stores `... 15 2D 4F 55 ...` -- the 0x2D declaration-section close
       * belongs before the blank-line marker and the disabled-comment's
       * own 0x55 opcode, not omitted entirely.
       */
      if (
        haveCompletedTopLevelStatement &&
        hasBlankLine &&
        sawTopLevelDeclaration &&
        !closedTopLevelDeclarationSection
      ) {
        const disabledCommentEnd = source.indexOf('*>', pos + 2);
        const afterDisabledComment = nextSignificantAfterBlockComments(
          disabledCommentEnd >= 0 ? disabledCommentEnd + 2 : pos
        );
        const nextIsTopLevelDeclarationAfterDisabledComment =
          /^(?:Global|PanelGroup|Component|Constant|Declare\s+Function)\b/i.test(
            source.slice(afterDisabledComment)
          );

        if (!nextIsTopLevelDeclarationAfterDisabledComment) {
          pushDeclarationSectionCloseByte();
          closeTopLevelDeclarationSection();
        }
      }

      /*
       * A standalone disabled-code marker (<* ... *>) does not, by
       * itself, terminate the leading Local declaration run any more than
       * an ordinary block comment does (see the matching block-comment
       * branch's "nextIsLocal" guard just below) -- only close the run
       * early when one had actually started (sawLeadingLocalDeclaration)
       * and no Local declaration immediately follows this marker. If no
       * Local run has started yet, leave leadingLocalRun untouched so a
       * Local declaration reached later can still be tracked.
       *
       * ADDRESS_TYPE_FL.ADDRESS_TYPE.RowDelete (definition 528):
       *
       *   [block comment: move gbl.addresses.address_type.row delete]
       *   <*Bug 25690137*>
       *   Local SQL &SQL1;
       *
       *   SQLExec(...);
       *
       * Previously this branch unconditionally set leadingLocalRun =
       * false, which fired here BEFORE `Local SQL &SQL1;` was even
       * reached (sawLeadingLocalDeclaration is still false at this
       * point) -- permanently preventing the subsequent Local from ever
       * being tracked by the leading-run mechanism at all, so the
       * section's eventual 0x2D/0x4F close before `SQLExec(...)` was
       * never emitted.
       *
       * Cycle 113: the run's close is queued BEFORE the blank-line markers
       * and the 0x55 record, like the block-comment branch's -- 20860 `L L
       * <blank> <*...*>` stores `15 2D 4F 55`, 21323 `15 2D 4F 4F 55`
       * (queued after the 0x55, the close landed behind it).
       */
      /*
       * Cycle 113: like a REM, a disabled-code block closes an open import
       * section unless another import follows it -- 24926 `import ...:*;
       * <blank> <*...*>` stores `15 2D 4F 55`.
       */
      if (importSectionOpen) {
        const disabledCodeEnd = source.indexOf('*>', pos + 2);
        const afterDisabledCode = nextSignificantAfterComments(disabledCodeEnd >= 0 ? disabledCodeEnd + 2 : source.length);
        if (!/^import\b/i.test(source.slice(afterDisabledCode))) {
          chunks.push(Buffer.from([0x2d]));
          closeImportSection();
        }
      }

      if (sawLeadingLocalDeclaration) {
        const disabledCodeEnd = source.indexOf('*>', pos + 2);
        const afterDisabledComment =
          nextSignificantAfterBlockComments(disabledCodeEnd >= 0 ? disabledCodeEnd + 2 : pos);
        const nextIsLocalAfterDisabledComment =
          /^Local\b/i.test(source.slice(afterDisabledComment));

        if (
          leadingLocalRun &&
          !nextIsLocalAfterDisabledComment &&
          pendingReferenceLocalBoundary === undefined
        ) {
          pendingReferenceLocalBoundary = chunks.length;
          pendingReferenceLocalMarkers = 0;
          pendingReferenceLocalBlankLines = 0;
          leadingLocalRun = false;
        }
      }

      if (haveCompletedTopLevelStatement && hasBlankLine) {
        emitBlankLineMarkers(topLevelWhitespace);
      }

      chunks.push(disabledCodeComment());
      haveCompletedTopLevelStatement = true;
      continue;
    }

    if (source.startsWith('/*', pos)) {
      const afterComments =
        nextSignificantAfterBlockComments(pos);

      const nextIsLocal =
        /^Local\b/i.test(source.slice(afterComments));

      /*
       * Cycle 115: a comment followed by a conditional-compilation
       * directive closes no section; the open section closes at the next
       * real statement, after the directive's records. 25883 `Local Row
       * &rowTwilio; <blank> /*AES128*\/ #If ... #Then <blank> &rsTwilio =
       * ...` stores `15 4F 24 75 76 2D 4F`; 4601 `import ...; /* Landing
       * *\/ #If ... #End-If; <blank> Declare` keeps the import section open
       * to the Declare (`15 24 75 76 78 15 2D 4F 31`).
       */
      const conditionalDirectiveFollows =
        conditionalRegionBetween(pos, nextSignificantAfterTrivia(pos));

      const nextIsImport =
        /^import\b/i.test(source.slice(afterComments));
      const nextIsTopLevelDeclaration =
        /^(?:Global|PanelGroup|Component|Constant|Declare\s+Function)\b/i.test(
          source.slice(afterComments)
        );

      /*
       * A standalone block comment following an import belongs to the open
       * import declaration section only when another import follows the
       * comment sequence.
       *
       * This preserves the previously calibrated multi-import case:
       *
       *   import A:B:C;
       *   [group label comment]
       *   import D:E:F;
       *
       * where PeopleTools keeps one import section, while also handling:
       *
       *   import EO:CA:Address;
       *
       *   [block comment]
       *   executable...
       *
       * which stores:
       *
       *   <import> 15 2D 4F 24 ...
       *
       * The comment loop runs before the ordinary non-import transition below,
       * so close the import section here when the comment sequence is followed
       * by anything other than another import.
       */
      // A decoded same-line import comment may be rendered on its own line.
      // Its preserved 0x4E provenance keeps it attached to the import; the
      // import section closes at the following non-import source item.
      if (
        importSectionOpen &&
        !nextIsImport &&
        !conditionalDirectiveFollows &&
        context?.commentOpcodes?.[commentOpcodeIndex] !== 0x4e
      ) {
        chunks.push(Buffer.from([0x2d]));
        closeImportSection();
      }

      /*
       * A standalone block comment does not, by itself, terminate the
       * leading Local declaration run.
       *
       * Example:
       *   Local ...;
       *   [block comment]
       *   Local ...;
       *
       * keeps the comment inside the Local section.
       *
       * But when the comment sequence follows the final Local declaration,
       * PeopleTools closes the Local section before the comment:
       *
       *   Local ...;
       *   [block comment]
       *   executable...
       *
       * Stored shape: ... 15 2D 4F 24 ...
       *
       * When the comment sequence is instead followed by ANOTHER top-level
       * declaration (Global/PanelGroup/Component/Constant/Declare Function)
       * or an import, the Local run has ended but the declaration SECTION
       * has not -- it continues into that following declaration and closes
       * later, at the true first executable statement, via the separate
       * sawTopLevelDeclaration/closedTopLevelDeclarationSection mechanism
       * (mirrors the equivalent non-comment exclusion a few lines below,
       * `leadingLocalRun && !isLocalDeclaration` guarding on
       * `!isTopLevelDeclaration`). Do not record a boundary here in that
       * case, or an extra spurious 0x2D gets inserted right before the
       * comment.
       *
       * ARCH_SQL_LNG.ARCH_SQL.SavePostChange (definition 1257):
       *
       *   Local Record &REC;
       *   /* global strings defined in ARCH_SQL_LNG.ARCH_SQL.FieldChange *\/
       *   Global string &AUDIT_ID, &AUDIT_RECNAME, &AUDIT_PROCESS, &AUDIT_STRING;
       *   Global boolean &AUDIT_THIS;
       *
       *   If (...) Then
       *
       * stores no 0x2D at all before the comment -- the declaration section
       * (Local + both Globals) closes as one unit right before `If`.
       */
      if (
        leadingLocalRun &&
        sawLeadingLocalDeclaration &&
        // Cycle 91: look past REM and disabled code too (13957: `L L L
        // <blank> /*c*\/ REM ... <* *> ... Local` continues the run).
        !/^Local\b/i.test(source.slice(nextSignificantAfterTrivia(pos))) &&
        !conditionalDirectiveFollows &&
        pendingReferenceLocalBoundary === undefined
      ) {
        /*
         * Cycle 91: when the Application-Class-Local section closer below
         * fires at this SAME comment, it owns the single 0x2D for the
         * combined section (mixed plain / App-Class-typed Locals). Queuing
         * the leading-run boundary as well produced `2D 2D 4F` (4916, 18229,
         * 20077, 25289: `import ...; L La L L <blank> /*c*\/`). The
         * executable-statement path already applies the same ownership
         * (`!closesApplicationClassLocalSection` before queuing the leading
         * boundary). The run itself still ends here.
         */
        const applicationClassLocalCloserFiresHere =
          haveCompletedTopLevelStatement &&
          hasBlankLine &&
          sawApplicationClassLocalSection &&
          !closedApplicationClassLocalSection &&
          !nextRealItemContinuesDeclarationSection(pos);
        if (!nextIsTopLevelDeclaration && !nextIsImport && !applicationClassLocalCloserFiresHere) {
          pendingReferenceLocalBoundary = chunks.length;

          /*
           * The ordinary top-level blank-line/comment handling below emits
           * the 0x4F. If this program ultimately has compiled references, the
           * deferred Local-section insertion therefore contributes only 0x2D.
           */
          pendingReferenceLocalMarkers = 0;
          pendingReferenceLocalBlankLines = 0;
        }
        leadingLocalRun = false;
      }

      if (haveCompletedTopLevelStatement && hasBlankLine) {
        /*
         * A comment can occur immediately after a top-level declaration
         * section. Because comments are handled before the normal statement
         * transition logic below, close the declaration section here first.
         *
         * The declaration/comment boundary preserves the same blank-line
         * multiplicity as other calibrated top-level boundaries: the first
         * newline is the ordinary line separator and each additional newline
         * contributes one 0x4F.
         *
         * Examples:
         *
         *   Declare Function ...;
         *
         *   /* comment *\/
         *
         * => ... 15 2D 4F 24 ...
         *
         * Offset 314 has two blank formatting lines before the comment and
         * stores ... 15 2D 4F 4F 24 ... .
         */
        if (
          sawTopLevelDeclaration &&
          !closedTopLevelDeclarationSection &&
          !nextRealItemContinuesDeclarationSection(pos) &&
          !conditionalDirectiveFollows &&
          pendingReferenceLocalBoundary === undefined &&
          !(sawApplicationClassLocalSection && !closedApplicationClassLocalSection)
        ) {
          /*
           * Compiler closure: this condition was missing the `!nextIsLocal`
           * exclusion its sibling block (leadingLocalRun's own comment
           * handling, immediately above) already has. `Local` is not
           * itself a member of `isTopLevelDeclaration`'s set (Global/
           * PanelGroup/Component/Constant/Declare Function), so a comment
           * between a run of Declare-Function/Global/etc statements and a
           * FOLLOWING Local declaration wrongly looked like "declaration
           * section ended here" and closed early with a spurious 0x2D --
           * the section should instead continue through the Local run and
           * close once, at the true end of the whole declaration section
           * (mirrors the ARCH_SQL_LNG.ARCH_SQL.SavePostChange precedent
           * cited a few dozen lines above for the analogous
           * Local-then-comment-then-Global shape).
           *
           * FUNCLIB_HR_JPN.CI_JPN's own defining program (definition 2043):
           *
           *   Declare Function CI_Insert_Jobcode PeopleCode FUNCLIB_HR_JPN.CI_JPN FieldFormula;
           *
           *   /* Codes for Component Publish - Next 2 lines. *\/
           *   Local Message &MSG;
           *   Local Rowset &RS;
           *
           * stores no 0x2D before the comment -- only a bare 0x4F -- with
           * the real section-closing 0x2D deferred to the true end of the
           * Local run that follows.
           *
           * The added `pendingReferenceLocalBoundary === undefined` guard
           * prevents a DIFFERENT double-close: when a Declare-Function/
           * Global/etc run is later followed by an ACTUAL Local run
           * (setting `sawLeadingLocalDeclaration`), and THAT run's own
           * closing comment is followed by something that is neither
           * top-level-declaration nor Local, the sibling `leadingLocalRun`
           * block just above already claims this exact boundary via
           * `pendingReferenceLocalBoundary` (a deferred insertion, not an
           * immediate one) -- without this guard this block fired too,
           * emitting a second, spurious 0x2D on top of the deferred one
           * (found via EO:CA:Address's own defining program, definition
           * 3596, during this fix's own regression testing).
           *
           * The `sawApplicationClassLocalSection` exclusion guards the
           * identical double-close against the THIRD sibling mechanism
           * (the Application-Class-typed Local section closer immediately
           * below this block) -- an Application-Class-typed `Local` (e.g.
           * `Local EO:CA:Address &x;`) sets that flag instead of
           * `sawLeadingLocalDeclaration`, so `pendingReferenceLocalBoundary`
           * alone does not catch this case; confirmed on the SAME
           * definition 3596, whose own Local is Application-Class-typed.
           */
          pushDeclarationSectionCloseByte();
          closeTopLevelDeclarationSection();
        }

        /*
         * An open Application Class Local declaration section closes the
         * same way: a standalone block comment following the section's
         * final Local (application-class or ordinary) is not itself part
         * of the section, so the section's 0x2D boundary belongs before
         * the comment rather than deferred to the next executable
         * statement.
         *
         * ADDRESSES.ADDRESS_TYPE.RowInit (definition 513):
         *
         *   Local EO:CA:Address &LocAddress;
         *   Local string &ciName;
         *
         *   /*trying to bring...*\/
         *   If ...
         *
         * stores the section boundary immediately before the comment:
         *
         *   ... <ciName> 15 2D 4F 24 <comment> ...
         *
         * Without this, the section only closes via the ordinary
         * closesApplicationClassLocalSection path in the ordinary
         * statement branch, which a leading comment bypasses via this
         * loop's early `continue`, so the 0x2D is wrongly deferred past
         * the comment to the next executable statement.
         */
        // Cycle 92: comment-transparent, and a following declaration
        // continues the section (23068, 23567: `La ... /*c*\/ Component`).
        if (
          sawApplicationClassLocalSection &&
          !closedApplicationClassLocalSection &&
          !nextRealItemContinuesDeclarationSection(pos) &&
          !conditionalDirectiveFollows
        ) {
          pushDeclarationSectionCloseByte();
          closeApplicationClassLocalSection();
        }

        emitBlankLineMarkers(topLevelWhitespace);
      }

      do {
        const decodedTrailingImportComment =
          importSectionOpen &&
          !nextIsImport &&
          context?.commentOpcodes?.[commentOpcodeIndex] === 0x4e;
        chunks.push(blockComment());

        const commentWhitespaceStart = pos;
        space();

        // Cycle 115: a directive after the comment, while a section the
        // comment did not close is still open, leaves the gap (its records
        // already written) to the next item, whose close and markers follow
        // the records (25883, 4601). With nothing open the gap's markers
        // stay here (28870 `/* c *\/ #If ... #End-If <blank> /* c *\/`
        // stores `24 75 76 78 4F 24`).
        const sectionAwaitsClose =
          importSectionOpen ||
          (leadingLocalRun && sawLeadingLocalDeclaration && pendingReferenceLocalBoundary === undefined) ||
          (sawTopLevelDeclaration && !closedTopLevelDeclarationSection) ||
          (sawApplicationClassLocalSection && !closedApplicationClassLocalSection);
        if (sectionAwaitsClose && conditionalRegionBetween(commentWhitespaceStart, pos)) {
          pos = commentWhitespaceStart;
          break;
        }

        const commentWhitespace =
          source.slice(commentWhitespaceStart, pos);

        const hasBlankLineAfterComment =
          /(?:\r?\n)[ \t]*(?:\r?\n)/.test(
            commentWhitespace
          );

        if (decodedTrailingImportComment && hasBlankLineAfterComment) {
          chunks.push(Buffer.from([0x2d, 0x4f]));
          closeImportSection();
          if (nextIsLocal) {
            restartLocalDeclarationRun();
          }
        } else if (hasBlankLineAfterComment) {
          /*
           * PeopleTools preserves each blank formatting line after a
           * standalone top-level block comment as a 0x4F boundary.
           *
           * One ordinary newline separates the comment from the next
           * source item; each additional newline contributes one 0x4F.
           */
          emitBlankLineMarkers(commentWhitespace);
        }
      } while (source.startsWith('/*', pos));

      continue;
    }

    if (source[pos] === ';') {
      /*
       * Cycle 114: an empty statement is executable code: it closes an
       * open top-level declaration section first -- the 0x2D only, no
       * floor 0x4F (21969 `Component ... &endDatePinNum;\n;` and 23232
       * `Global string ...;\n;` store `15 2D 15`).
       */
      if (
        sawTopLevelDeclaration &&
        !closedTopLevelDeclarationSection &&
        !(sawApplicationClassLocalSection && !closedApplicationClassLocalSection)
      ) {
        pushDeclarationSectionCloseByte();
        closeTopLevelDeclarationSection();
      }
      pos++;
      chunks.push(fixed(';'));
      /*
       * Cycle 49: a bare top-level `;` (an empty statement -- e.g. an
       * Application Class method-implementation's own structured
       * signature-comment echo, `/+ ... +/;`, which lives inside the body
       * text passed to the shared fragment encoder) is a genuine
       * completed top-level item, exactly like every other branch below
       * that reaches the shared tail at this loop's end (which sets this
       * same flag). This branch instead `continue`s immediately,
       * bypassing that tail entirely -- so a blank-line gap AFTER a bare
       * `;` and before the NEXT statement was never counted at all,
       * regardless of whether a blank line was actually present (verified
       * directly: with and without a blank line produced byte-identical
       * output before this fix). Reproduced in isolation with `%Super =
       * create X();`, an ordinary `&var = ...;`, `%This.Method();`, and
       * `&Obj.Method();` all immediately following a leading bare `;` --
       * every one of them was missing the marker identically, proving the
       * gap is about the PRECEDING bare semicolon, not about `%Super` (or
       * any other receiver) at all. Corpus population: 9 Application
       * Class constructors whose first statement is `%Super = create
       * ...;`, all sharing this exact scenario (their own structured
       * signature-comment echo, a blank line, then the constructor's own
       * first real statement).
       */
      haveCompletedTopLevelStatement = true;
      continue;
    }

    /*
     * A top-level REM statement uses the same calibrated representation as
     * REM inside If/Evaluate bodies:
     *
     *   0x24 <uint16 UTF-16 byte length> <complete REM text including ;>
     *
     * The semicolon is part of the payload, so there is no trailing 0x15.
     * Consume it here, before the ordinary statement/terminator path.
     */
    if (startsRemComment()) {
      /*
       * Cycle 88: an open import section closes BEFORE a top-level REM whose
       * next real item is not another import -- the same rule the
       * standalone block comment branch already applies (`!nextIsImport`).
       * The REM branch had no import close, so the section stayed open
       * across the REM and its 0x2D was serialized after it
       * (`4F REM 2D` instead of stored `2D 4F REM`).
       *
       * PTAFAW_TXN.PTAFPRCS_ID.SavePostChange (definition 18061):
       *
       *   import PTAF_CORE:DEFN:*;
       *
       *   REM Create a Counter for the new Registry entry;
       *
       *   If GetRow().IsNew Then
       *
       * stores `... 15 2D 4F 24 <REM> 4F 1C ...`. LOCAL SNAPSHOT, stored
       * bytes of every definition: REM after an import section, next real
       * item not an import -> 0x2D before the REM in 18/18; next real item
       * an import -> no close in 3/3 (17759, 28853, 30184). As at the main
       * import closer, a following plain Local restarts the Local run
       * (26010: `rem Global ...; rem Local ...; Local date &ASOFDATE;`).
       */
      let remClosedImportSection = false;
      if (importSectionOpen) {
        const remEnd = source.indexOf(';', pos);
        const afterRemComments = nextSignificantAfterComments(
          remEnd < 0 ? source.length : remEnd + 1
        );
        if (!/^import\b/i.test(source.slice(afterRemComments))) {
          chunks.push(Buffer.from([0x2d]));
          closeImportSection();
          remClosedImportSection = true;
          if (/^Local\s+[A-Za-z_][A-Za-z0-9_]*\s+&/i.test(source.slice(afterRemComments))) {
            restartLocalDeclarationRun();
          }
        }
      }

      /*
       * A REM comment after the final leading Local closes a reference-bearing
       * Local section just like a standalone block comment does. The ordinary
       * blank-line path below supplies the 0x4F; defer only the 0x2D until we
       * know the program has compiled references.
       *
       * ACL_WS_WRK.WSOPRACCESS.FieldFormula stores:
       *   Local number &I; 2D 4F REM ...
       */
      /*
       * Cycle 91: a REM does not queue the leading Local run's close when the
       * next real item (past all comment trivia) is another Local -- stored
       * has no close at the REM (28207 `L <blank> REM ... Li Li La L X`,
       * 28285). Same comment transparency Cycle 90 established for the
       * generic declaration section. (Whether a PLAIN run then continues
       * through the REM to a formal close has no corpus instance; the
       * Cycle 87 end-of-branch reset is left unchanged.)
       */
      const remEndForRun = source.indexOf(';', pos);
      const localFollowsRem = /^Local\b/i.test(
        source.slice(nextSignificantAfterTrivia(remEndForRun < 0 ? source.length : remEndForRun + 1))
      );
      if (
        leadingLocalRun &&
        sawLeadingLocalDeclaration &&
        hasBlankLine &&
        pendingReferenceLocalBoundary === undefined &&
        !localFollowsRem
      ) {
        pendingReferenceLocalBoundary = chunks.length;
        pendingReferenceLocalMarkers = 0;
        pendingReferenceLocalBlankLines = 0;
        leadingLocalRun = false;
      }

      if (haveCompletedTopLevelStatement && hasBlankLine) {
        /*
         * Cycle 90: the same close guard as the standalone block comment
         * closer (this REM closer predates those guards and closed
         * unconditionally). A REM does not close the section when the next
         * real item continues it (27360, 28208: `Declare ...; REM ...;
         * Local ...`); the pending-Local-boundary and open App-Class-Local
         * exclusions mirror the block comment closer's own.
         */
        const remEndForClose = source.indexOf(';', pos);
        if (
          sawTopLevelDeclaration &&
          !closedTopLevelDeclarationSection &&
          !nextRealItemContinuesDeclarationSection(remEndForClose < 0 ? source.length : remEndForClose + 1) &&
          pendingReferenceLocalBoundary === undefined &&
          !(sawApplicationClassLocalSection && !closedApplicationClassLocalSection)
        ) {
          pushDeclarationSectionCloseByte();
          closeTopLevelDeclarationSection();
        }
        emitBlankLineMarkers(topLevelWhitespace);
      }
      /*
       * A top-level REM comment may omit its trailing semicolon, the same
       * way every other REM call site in this file already allows
       * (`remComment(true)`) -- this was the one remaining call site still
       * requiring it.
       *
       * AMM_DERIVED.DELETE_BTN.RowInit (definition 964):
       *
       *   rem PSCHNLDEFN is a deprecated table in PT 8.48 and above.
       *
       * has no trailing ";" and decodes back to this exact source.
       */
      chunks.push(remComment(true));
      haveCompletedTopLevelStatement = true;
      /*
       * Cycle 88: the import closer owns the blank-line gap up to the next
       * real item (its own `if (hasBlankLine) emitBlankLineMarkers` at the
       * main import-close site). When this REM took over the import close,
       * it also takes over that gap -- the same way the standalone block
       * comment branch owns the whitespace after itself. Without this, a
       * declaration following the REM lost its 0x4F: no other producer owns
       * a declaration gap with no prior declaration or Local run (23494,
       * 24648: `... 2D 4F REM 4F Declare ...`). Changes exactly those two
       * definitions; the alternative of widening the declaration-gap owner
       * changed six unrelated ones and was not taken.
       */
      if (remClosedImportSection) {
        const remWhitespaceStart = pos;
        space();
        const remWhitespace = source.slice(remWhitespaceStart, pos);
        if (/(?:\r?\n)[ \t]*(?:\r?\n)/.test(remWhitespace)) {
          emitBlankLineMarkers(remWhitespace);
        }
      }
      /*
       * Cycle 87: a REM does not end leading-Local-run eligibility when no
       * Local run has started yet -- the same rule the standalone block
       * comment branch already follows ("If no Local run has started yet,
       * leave leadingLocalRun untouched"). Previously this reset was
       * unconditional, so a REM before the first Local (5242: `Rem Payee
       * List; Local Rowset &RS;`) meant the run never got its formal
       * `2D 4F` close, and a REM before the first declaration lost that
       * declaration's blank-line marker (5613, 7880). LOCAL SNAPSHOT: +15
       * forward-exact, 0 lost; all 22 changed definitions match stored at
       * the changed boundary (incl. Cycle 85 residuals 15609, 28343).
       */
      if (sawLeadingLocalDeclaration) {
        leadingLocalRun = false;
      }
      continue;
    }

    const isFunction = /^Function\b/i.test(source.slice(pos));
    const isImport = /^import\b/i.test(source.slice(pos));
    const isLocalDeclaration = /^Local\b/i.test(source.slice(pos));

    /*
     * Proven top-level block statements may terminate directly at EOF
     * without a source semicolon.
     *
     * Keep these classifications before statement() consumes the source.
     */
    const isIfStatement =
      /^If\b/i.test(source.slice(pos));

    const isEvaluateStatement =
      /^Evaluate\b/i.test(source.slice(pos));

    /*
     * GPFR_AF_DON_SQL.GPFR_AF_APPL.FieldFormula (definition 6844) proves a
     * top-level For/End-For block also self-terminates at EOF without a
     * source semicolon, the same way If/End-If and Evaluate/End-Evaluate
     * already do.
     */
    const isForStatement =
      /^For\b/i.test(source.slice(pos));

    /*
     * GPGB_PFH.MAIN.Step10.OnExecute (definition 26707) proves a top-level
     * While/End-While block may also end at EOF without a source semicolon.
     * Its stored executable ends `... 26 07`, with no `15` between the
     * End-While opcode and the program terminator.
     */
    const isWhileStatement =
      /^While\b/i.test(source.slice(pos));

    /*
     * A bare `Warning <expr>` (or `Error <expr>`) top-level statement may
     * also omit its semicolon at EOF.
     *
     * GPGB_SCON_TBL.GPGB_SCON.FieldFormula (definition 21801):
     *
     *   Warning MsgGetText(17410, 51, "Message not found")
     */
    const isWarningOrErrorStatement =
      /^(?:Warning|Error)\b/i.test(source.slice(pos));

    /*
     * ADDRESS_SBR.COUNTRY.FieldChange (definition 524) proves a top-level
     * try/catch/end-try block may likewise terminate directly at EOF
     * without a source semicolon after end-try:
     *
     *   catch Exception &id
     *      /* Exception Caught. *\/
     *   end-try
     */
    const isTryStatement =
      /^try\b/i.test(source.slice(pos));

    /*
     * Offset 425 proves that a plain top-level assignment may omit its
     * semicolon at EOF:
     *
     *   RECORD.FIELD.Value = OTHER.FIELD.Value
     *
     * Keep this classification deliberately narrow so statement forms such
     * as:
     *
     *   Return True
     *
     * still fail without an explicit semicolon.
     */
    const startsTopLevelAssignment =
      (
        source[pos] === '&' ||
        source[pos] === '@' ||
        /^[A-Za-z_][A-Za-z0-9_]*\s*\./.test(source.slice(pos))
      ) &&
      /=/.test(source.slice(pos));

    /*
     * A bare declared-function call statement may also omit its semicolon
     * at EOF, distinct from startsTopLevelAssignment above.
     *
     * FUNCLIB_ABS_EA.CANCEL_BTN.FieldFormula (definition 4066) and 58 other
     * corpus objects end with a plain call to a Declare Function-declared
     * routine and no trailing semicolon:
     *
     *   Declare Function EA_Cancel_Process PeopleCode ...;
     *
     *   EA_Cancel_Process()
     *
     * Keep this scoped to a bare leading identifier immediately followed by
     * "(", excluding every reserved top-level statement keyword, so forms
     * like "Return True" (no parens, and Return is reserved) still fail
     * without an explicit semicolon.
     */
    const isTopLevelCallStatement =
      !/^(?:import|Declare|Function|Local|Global|PanelGroup|Component|Constant|Return|If|While|For|Repeat|try|throw|Break|Exit|Continue|Error|Warning|Evaluate|REM)\b/i.test(
        source.slice(pos)
      ) &&
      /^[A-Za-z_][A-Za-z0-9_]*#?\s*\(/.test(source.slice(pos));

    /*
     * A `&variable.Method(...)` (or `@(...)`-led) method-call statement,
     * with no assignment `=`, may likewise omit its semicolon at EOF --
     * the same relaxation `isTopLevelCallStatement` already gives a bare
     * declared-function call, just for a variable-led receiver instead
     * of a bare identifier.
     *
     * GPFR_AF_ESC.GPFR_AF_ESC_NAME.SavePreChange (definition 18046):
     *
     *   &esc.OnSavePreChange()
     *
     * Cycle 116: likewise a grouped-expression call statement (5854
     * `(create HRS_CG_SEARCH_FLU:Controller:CustomAction()).LaunchPage(
     * Page.HRS_CAREERS_FL)` at EOF stores no 0x15).
     */
    const isTopLevelVariableLedCallStatement =
      (source[pos] === '&' || source[pos] === '@' || source[pos] === '(') &&
      !/=/.test(source.slice(pos));

    const isApplicationClassLocal =
      /^Local\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z_][A-Za-z0-9_]*\b/i.test(
        source.slice(pos)
      );

    const applicationClassLocalIsDeclarationPhase =
      isApplicationClassLocal &&
      !sawTopLevelExecutableStatement;

    const isTopLevelDeclaration =
      isImport ||
      /^(?:Global|PanelGroup|ComponentLife|Component|Constant|Declare\s+Function)\b/i.test(source.slice(pos));

    /*
     * Cycle 94: allocation units for Application Class rows (see
     * `useApplicationClassRow`). The leading declaration section -- up to
     * and including the first initialized Local -- stays in the initial
     * unit; every later top-level statement starts its own. A Function
     * header stays in the unit before it; its body statements start their
     * own in the Function body loop. Cycle 95: advanced in every ordinary
     * program (RECORD rows use the units even where the class-row model is
     * off).
     */
    /*
     * Cycle 103: built-in type units (see `builtinUnit`). A declaration --
     * or a Function, whose header joins the run -- continues the open
     * leading run unless a Function definition just ended it; anything
     * else, or anything once the section has closed, is its own unit.
     */
    if (ordinaryProgram) {
      const continuesBuiltinRun =
        !sawTopLevelExecutableStatement &&
        !builtinRunSplitPending &&
        (isFunction || isTopLevelDeclaration || isLocalDeclaration);
      if (!continuesBuiltinRun) startBuiltinUnit();
      builtinRunSplitPending = false;
    }
    if (ordinaryProgram && !isFunction) {
      const inLeadingSection =
        !sawTopLevelExecutableStatement &&
        !sawFunctionDefinition &&
        (isTopLevelDeclaration || isLocalDeclaration);
      if (!inLeadingSection) startAllocationUnit();
    }
    /*
     * Cycle 111: a Function definition after the leading section starts a
     * new allocation unit for its header -- an Application-Class-typed
     * parameter there opens its class's row even when the previous
     * Function's last statement used the class. 15800:
     *
     *   ...&params.GetPageLabel(&internalpages [1])...   (last statement)
     *   End-Function;
     *   Function SetInternal(&params As PTIB_PACKAGE:MobileURLParams, &fld As Field, ...)
     *
     * stores MOBILEURLPARAMS 11 (the header) before FIELD 12. LOCAL SNAPSHOT
     * (`cycle111-class-row-event-census.ts`): every such header the
     * committed allocator reused (5: 14899, 15540, 15800, 18110, 24546)
     * stores a new row, and every one it opened (45) agrees; the first
     * Function of the leading section still shares its unit (14356).
     */
    if (ordinaryProgram && isFunction && (sawTopLevelExecutableStatement || sawFunctionDefinition)) startAllocationUnit();


    const closesTopLevelDeclarationSection =
      !isTopLevelDeclaration &&
      !isLocalDeclaration &&
      sawTopLevelDeclaration &&
      !closedTopLevelDeclarationSection &&
      !(sawApplicationClassLocalSection && !closedApplicationClassLocalSection);

    /*
     * Imports are a single declaration section. Close that section only when
     * the first non-import source statement is reached. Comments are handled
     * earlier in this loop and therefore remain inside the import section.
     *
     * ACCOMPLISHMENTS.EMPLID.SavePostChange has ten imports split into three
     * comment-labelled groups. Stored PSPCMPROG has no 0x2D between those
     * imports; it has exactly one 0x2D before the first Local declaration.
     */
    let justClosedImportSection = false;

    /*
     * Cycle 89: the open import section owns a real blank-line gap before
     * its next import. The section stays open (no 0x2D); each blank line is
     * one immediate 0x4F. The Application Class prefix encoder already
     * models this (`emitCompilationUnitPrefix`'s `emitGap`); ordinary
     * PeopleCode had no producer for it: the declaration-gap owner's keyword
     * list excludes `import`, the generic deferred gap excludes
     * declarations, and the first import already cleared `leadingLocalRun`.
     *
     * DERIVED_HR.CAREER_STR_FUNC.FieldChange (definition 5565):
     *
     *   import HJPM_PROFILE_TYPES:Profile:ProfileType_v1_0:ProfileType;
     *
     *   import HJPM_PROFILE_SERVICES:Profile:SetProfileProperties_v1_0:...;
     *
     * stores `... 15 4F 58 ...`. LOCAL SNAPSHOT (`cycle89-import-gap-
     * census.ts`): every ordinary import -> blank line(s) -> import gap was
     * missing its markers (18 one-blank-line gaps, 17551 with two -> 4F 4F);
     * Application Class programs matched in all 35. Comment- and REM-
     * separated import gaps are unaffected: those branches consume their
     * own trailing gap, and a REM that closes the section (Cycle 88) is
     * never followed by an import.
     */
    if (isImport && importSectionOpen && haveCompletedTopLevelStatement && hasBlankLine) {
      emitBlankLineMarkers(topLevelWhitespace);
    }

    if (!isImport && importSectionOpen) {
      chunks.push(Buffer.from([0x2d]));

      /*
       * The import-section boundary's 0x4F marker count scales with
       * blank-line count, like every other marker site in this file.
       * ACCOMPLISHMENTS.EMPLID.SavePostChange (a single blank line before
       * an Application Class Local) only ever exercised the single-marker
       * case, so an earlier pass hardcoded "at most one" for every OTHER
       * (non-Application-Class-Local) following declaration -- CAF_SRCH.
       * CAF_SRCH_BTN.SavePostChange (definition 2200) disproves that:
       *
       *   import CAF_SEARCH_NUI:Search;
       *   import CAFNUI_CORE:OBJECT:CompareSession;
       *   import CAFNUI_API:EntityHandler;
       *
       *
       *   Declare Function GetSearchKey PeopleCode CAF_SRCH.CAF_SRCH_BTN FieldFormula;
       *
       * (two blank lines, next declaration a Declare Function, not a
       * Local) stores TWO 0x4F markers, not one.
       */
      if (hasBlankLine) {
        emitBlankLineMarkers(topLevelWhitespace);
      }

      closeImportSection();
      justClosedImportSection = true;

      /*
       * An import section and a following Local declaration section are
       * distinct compiled declaration groups.
       *
       * ACCT_CD_NEW_VW.ACCT_CD.SearchInit:
       *
       *   import HMCF_CHARTFIELDS:*;
       *
       *   Local Rowset &MYACTIVECFS;
       *   Local Row &ActiveCf;
       *   Local number &I;
       *
       *   If ...
       *
       * stores:
       *
       *   <import> 15 2D 4F
       *   <locals> ... 15 2D 4F
       *   <If>
       *
       * Closing the import section therefore starts a fresh declaration-only
       * Local run when the next source item is Local.
       */
      if (isLocalDeclaration && !isApplicationClassLocal) {
        /*
         * Restart only the ordinary Local declaration-run tracker here.
         *
         * Application Class Locals already have their own calibrated section
         * lifecycle through sawApplicationClassLocalSection /
         * closesApplicationClassLocalSection. Restarting the generic Local
         * tracker for those declarations duplicates their eventual:
         *
         *   2D 4F
         *
         * boundary (offset 179 regression).
         *
         * Ordinary Locals after an import still need the distinct second
         * declaration section proven by offset 411.
         */
        restartLocalDeclarationRun();
      }
    }

    /*
     * Cycle 86: the blank-line gap before a top-level declaration has ONE
     * owner. This block (the declaration-to-declaration boundary, 5026)
     * owns it whenever its predicate holds; the Cycle 49 "first non-Local
     * statement" branch below only takes gaps this block does not own.
     * Both previously emitted immediate markers for the same gap once a
     * Local run could restart after a Function (11552, 13561: `F[2D 4F 4F]`
     * instead of `F[2D 4F]` before a declaration).
     */
    /*
     * Cycle 92: an OPEN Application-Class-Local section is also a prior
     * declaration region for this gap. Its premature closer used to supply
     * the blank-line 0x4F before the first following declaration; with the
     * section now staying open, this owner takes that gap (1417, 12813,
     * 19885, 20824, 23568: stored `La[4F] D`).
     */
    const declarationGapOwnsBlankLine =
      (sawTopLevelDeclaration ||
        sawLeadingLocalDeclaration ||
        (sawApplicationClassLocalSection && !closedApplicationClassLocalSection)) &&
      isTopLevelDeclaration &&
      /^(?:ComponentLife|Component|Global|PanelGroup|Declare\s+Function)\b/i.test(source.slice(pos)) &&
      hasBlankLine &&
      !justClosedImportSection;
    if (declarationGapOwnsBlankLine) {
      /*
       * DERIVED_GPFR_AF.GPFR_AF_DUPLICATE.FieldChange (definition 5026)
       * proves this same declaration-to-declaration boundary also applies
       * when the PRECEDING declaration is a leading Local-declaration run
       * rather than an earlier Global/PanelGroup/Component/Declare
       * Function -- `sawTopLevelDeclaration` alone is too narrow, since
       * plain `Local` declarations never set it:
       *
       *   Local array of string &ValueArray;
       *   Local array of Record &ExceptionArray;
       *   Local Record &REC;
       *   Local SQL &Sql1;
       *
       *   Declare Function ciCreateArray PeopleCode FUNCLIB_CI.CI_ARRAY FieldFormula;
       *
       * stores one 0x4F marker (no 0x2D at all) between `&Sql1;` and
       * `Declare Function` -- previously no marker was emitted here at
       * all, since neither this block (guarded on `sawTopLevelDeclaration`,
       * false here) nor the plain `leadingLocalRun && !isLocalDeclaration`
       * closer (which explicitly excludes `isTopLevelDeclaration` targets,
       * deferring to this block instead) covered this specific transition.
       *
       * AMM_DERIVED.AMM_CANCEL_M.FieldChange (definition 942) proves this
       * boundary scales with blank-line count like every other marker
       * site in this file, rather than always emitting exactly one:
       *
       *   Declare Function LoadSubChannelPubHdr PeopleCode AMM_WORK.FUNCLIB FieldFormula;
       *
       *
       *   Component boolean &msg_refreshed;
       *
       * (two blank lines) stores two 0x4F markers, not one.
       *
       * AMM_DERIVED.AMM_COLLAPSE_ALL.FieldChange (definition 945) proves
       * this trigger list itself was incomplete -- `PanelGroup` belongs
       * on it too, alongside `isTopLevelDeclaration`'s own full set
       * (`Global|PanelGroup|Component|Constant|Declare Function`):
       *
       *   Declare Function CollapseTreeRows PeopleCode AMM_TREE_WS.TREE_LEVEL_NUM FieldFormula;
       *
       *   PanelGroup number &CurrentTreeRow;
       *
       * had NO marker emitted at all (not even a multiplicity bug --
       * PanelGroup simply never triggered this block). `Constant` remains
       * unconfirmed by any corpus evidence and is deliberately left off.
       */
      emitBlankLineMarkers(topLevelWhitespace);
    }

    /*
     * Cycle 92: the Application-Class-Local section stays open across
     * following top-level DECLARATIONS, exactly like the generic declaration
     * section. It closes where the declaration region ends: at a Function
     * definition, executable code, or EOF. The predicate used to be "next
     * item is not a Local", which closed it prematurely at a declaration.
     *
     * LOCAL SNAPSHOT (`cycle92-appclass-local-section-census.ts`, 441
     * programs with an App-Class Local before executable code): stored has
     * no 0x2D at a Local -> declaration transition in 46/46 cases (e.g.
     * 18673 `La L L D D D[2D 4F] X`), and always closes at a Function (35)
     * or executable code.
     */
    const closesApplicationClassLocalSection =
      !isLocalDeclaration &&
      !isTopLevelDeclaration &&
      sawApplicationClassLocalSection &&
      !closedApplicationClassLocalSection;

    /*
     * Blank formatting lines inside a leading declaration-only Local run
     * are preserved as 0x4F source-group boundaries.
     *
     * ACA_ACK_RUNCTL.ACA_ATTACHADD.FieldChange:
     *
     *   Local File &fileWSDL;
     *
     *   Local XmlDoc &XMLdoc;
     *
     * stores:
     *
     *   ... 15 4F 44 0A "XmlDoc" ...
     *
     * The first newline is ordinary source separation; each additional
     * newline contributes one 0x4F.
     */
    if (
      leadingLocalRun &&
      sawLeadingLocalDeclaration &&
      isLocalDeclaration &&
      hasBlankLine
    ) {
      emitBlankLineMarkers(topLevelWhitespace);
    } else if (
      leadingLocalRun &&
      !sawLeadingLocalDeclaration &&
      isLocalDeclaration &&
      haveCompletedTopLevelStatement &&
      !justClosedImportSection &&
      hasBlankLine
    ) {
      /*
       * Cycle 51 (definition 29134 and 18 further corpus definitions,
       * 26 total occurrences): the identical leading bare-`;` gap Cycle
       * 49 fixed for the FIRST non-Local statement in a fragment, but for
       * the case Cycle 49's own fix did not cover -- the first REAL
       * statement in the fragment IS ITSELF the first `Local`
       * declaration of the run. `sawLeadingLocalDeclaration` is still
       * `false` at this exact point (nothing has set it yet, since this
       * IS the first Local reached), so the sibling `if` immediately
       * above -- which requires it `true` -- cannot fire; Cycle 49's own
       * `!isLocalDeclaration`-gated fix cannot fire either, since this
       * statement IS a Local declaration. Neither existing mechanism
       * covers this combination, so the blank line between a bare `;`
       * (an Application Class method implementation's own structured
       * signature-comment echo, e.g. `/+ Returns Personalization +/;`)
       * and its first `Local <AppClassType> &var;` declaration was
       * silently dropped. Reproduced directly against definition 29134's
       * own `CreatePersonalization` method.
       *
       * `!justClosedImportSection` is required: an import section closing
       * right before the SAME kind of "first Local declaration, blank
       * line before it" shape is ALREADY handled, unconditionally,
       * by the import-section-close branch above (its own cited example,
       * ACCT_CD_NEW_VW.ACCT_CD.SearchInit's `import HMCF_CHARTFIELDS:*;`
       * then a blank line then `Local Rowset &MYACTIVECFS;`, is ordinary
       * PeopleCode's own golden fixture 412) -- without this exclusion,
       * this new branch double-emits for every import-then-Local
       * transition, a regression caught directly by that fixture test
       * and by HCDEV definition 6455's own equivalent shape.
       */
      emitBlankLineMarkers(topLevelWhitespace);
    }

    if (
      haveCompletedTopLevelStatement &&
      hasBlankLine &&
      !leadingLocalRun &&
      !isTopLevelDeclaration &&
      !closesTopLevelDeclarationSection &&
      !justClosedImportSection &&
      !closesApplicationClassLocalSection
    ) {
      deferReferenceGatedMarkers(topLevelWhitespace);
    }

    if (
      leadingLocalRun &&
      !isLocalDeclaration
    ) {
      // This is the first non-Local statement following a declaration-only
      // Local run. If the completed program ultimately contains compiled
      // references, PeopleTools closes that declaration section at this
      // exact source boundary.
      if (
        sawLeadingLocalDeclaration &&
        !isTopLevelDeclaration &&
        !closesApplicationClassLocalSection &&
        pendingReferenceLocalBoundary === undefined
      ) {
        pendingReferenceLocalBoundary = chunks.length;
        const sourceBlankLines = Math.max(
          0,
          (topLevelWhitespace.match(/\r?\n/g) ?? []).length - 1
        );
        pendingReferenceLocalMarkers = context?.suppressDeclarationSectionMarkers === true
          ? sourceBlankLines
          : Math.max(1, sourceBlankLines);
        pendingReferenceLocalBlankLines = sourceBlankLines;
      } else if (
        !sawLeadingLocalDeclaration &&
        haveCompletedTopLevelStatement &&
        hasBlankLine &&
        !declarationGapOwnsBlankLine
      ) {
        /*
         * Cycle 49: the FIRST non-Local statement reached while
         * `leadingLocalRun` is still true (this block) normally has its own
         * leading blank-line gap handled one of two ways: the deferred
         * `pendingReferenceLocalBoundary` mechanism above (when a real
         * `Local` declaration run preceded it, `sawLeadingLocalDeclaration`
         * true), or -- for an Application Class method body specifically --
         * `encodeMethodBody`'s own wrapper-level leading-whitespace count
         * (when the fragment's raw text starts with pure whitespace, so the
         * gap never reaches this inner loop at all). Neither covers the
         * case proven here: the fragment's leading content is NON-
         * whitespace but still not a `Local` declaration -- concretely, an
         * Application Class method implementation's own structured
         * signature-comment echo (`/+ &param as Type +/;`, whose trailing
         * `;` is source-owned body text, not stripped by the wrapper's
         * whitespace-only trim) followed by a blank line and then the
         * method's own first real statement. Confirmed in isolation
         * (`%Super = create X();`, an ordinary `&var = ...;`, `%This.
         * Method();`, and `&Obj.Method();` all immediately reproduce
         * identically after a leading bare `;`, proving this gap is about
         * the PRECEDING bare-semicolon/no-Local-run state, not about any
         * particular receiver or statement shape) -- see the bare `;`
         * branch's own comment for why `haveCompletedTopLevelStatement` is
         * newly set there. Population: 9 Application Class constructors
         * whose first statement is `%Super = create ...;`, sharing exactly
         * this scenario.
         */
        emitBlankLineMarkers(topLevelWhitespace);
      }

      // A top-level Function's own continuity is restored after the
      // definition completes -- see the Cycle 86 restart in the
      // `isFunction` branch below.
      leadingLocalRun = false;
    }


    // An application-class Local starts a Local declaration section. The
    // section may contain following ordinary Local declarations and closes
    // only when the run ends (or at EOF), matching the full fixture.
    if (closesApplicationClassLocalSection) {
      /*
       * The complete Local declaration section closes before the first
       * executable statement.
       *
       * ACCOMPLISHMENTS.EMPLID.SavePostChange calibrates this boundary as:
       *
       *   ... <last Local> 15 2D 4F 3C <Evaluate> ...
       *
       * Keep both bytes together here so the generic deferred blank-line
       * mechanism cannot reorder them as 4F 2D.
       *
       * An initialized Local anywhere in the section omits this 0x2D
       * entirely, mirroring `closesTopLevelDeclarationSection`'s own
       * identical `leadingRunHasInitializedLocal` check a few lines below
       * -- this path was missing it.
       *
       * CAFNUI_CTRL_WRK.CAF_DELETE_FLG.FieldChange (definition 2102):
       *
       *   import PT_PAGE_UTILS:Utils;
       *
       *   Local PT_PAGE_UTILS:Utils &PTUtils = create PT_PAGE_UTILS:Utils();
       *
       *   If %Page = Page.CAFNUI_ED_FLST_SCF Then
       *
       * stores only the 0x4F blank-line marker before `If`, no 0x2D.
       *
       * Cycle 14: an Application Class METHOD BODY never gets this 0x2D
       * at all, regardless of `leadingRunHasInitializedLocal` -- see
       * `context.suppressDeclarationSectionMarkers`'s own comment.
       */
      if (!leadingRunHasInitializedLocal && context?.suppressDeclarationSectionMarkers !== true) {
        chunks.push(Buffer.from([0x2d]));
      }

      if (hasBlankLine) {
        emitBlankLineMarkers(topLevelWhitespace);
      }

      // This one section boundary also closes preceding Declare/Component
      // declarations; emitting their boundary again duplicates 0x2D 0x4F.
      closeApplicationClassLocalSection();
    }

    // Calibrated top-level declaration transition:
    //
    //   Global ... ;
    //   Component ... ;
    //   2D
    //   [4F if executable code follows]
    //
    // A declaration-only program gets only the 2D here; encodeProgram()
    // supplies the final program-directory 07.
    //
    // An intervening Local declaration with an initializer (e.g. `Local
    // Row &Row = GetRow();` between a `Declare Function` and the first
    // executable statement) makes this an ordinary blank-line gap, not a
    // formal declaration-section boundary -- omit the 0x2D, mirroring the
    // `pendingReferenceLocalBoundary` insertion site's identical check.
    // See `leadingRunHasInitializedLocal`'s own declaration comment.
    if (closesTopLevelDeclarationSection) {
      if (!leadingRunHasInitializedLocal && context?.suppressDeclarationSectionMarkers !== true) {
        chunks.push(Buffer.from([0x2d]));
      }
      /*
       * Cycle 84: without the 0x2D (an initialized Local ended the pure-
       * declaration phase), this is an ordinary blank-line gap: emit only
       * the source's own blank lines, possibly none. The "at least one
       * 0x4F" floor of `emitBlankLineMarkers` belongs to the formal
       * `0x2D 0x4F` close. BEN_BEN_DTL_WK.BEN_PROV_DETAIL.FieldChange (definition 1769):
       * `Component ... &c; Local Record &rc = ...;` directly followed by
       * `&cPlanXController.OpenResource(...)` on the next line stores no
       * 0x4F. Method bodies (`suppressDeclarationSectionMarkers`) keep their
       * separately calibrated behavior.
       */
      const informalClose =
        leadingRunHasInitializedLocal && context?.suppressDeclarationSectionMarkers !== true;
      if (!informalClose || hasBlankLine) {
        emitBlankLineMarkers(topLevelWhitespace);
      }
      closeTopLevelDeclarationSection();
    }

    statement();

    /*
     * A top-level Local declaration's own initializer makes the
     * currently-open declaration section (tracked by
     * `sawTopLevelDeclaration`/`closedTopLevelDeclarationSection`, NOT
     * the narrower `leadingLocalRun` "run of consecutive Locals" tracker)
     * an ordinary blank-line gap rather than a formal 0x2D boundary when
     * it closes -- independent of whether `leadingLocalRun` itself is
     * still true. A preceding NON-Local top-level declaration (e.g.
     * `Declare Function ...;`) already set `leadingLocalRun = false`
     * before this Local was ever reached (see the
     * `leadingLocalRun && !isLocalDeclaration` closer above), so the
     * `leadingLocalRun`-gated block just below never runs for a Local in
     * that position and never gets a chance to set this flag on its own.
     *
     * DERIVED_GPFRDSN.GPFR_DSN_EXT_STAT.FieldDefault (definition 5002):
     *
     *   Declare Function ComputeEventEeStatus PeopleCode DERIVED_GPFRDSN.GPFR_DSN_EXT_STAT FieldFormula;
     *
     *   Local Row &Row = GetRow();
     *
     *   If %Component = Component.GPFR_DSN_EVT_EE Then
     *
     * stores no 0x2D at all before `If` -- only the three 0x4F blank-line
     * markers. `closesTopLevelDeclarationSection`'s own unconditional
     * 0x2D push (a few lines below) needs this flag true to omit it.
     *
     * An import statement closes `closedTopLevelDeclarationSection`
     * immediately (the `isImport` branch above), independent of whether a
     * following Application Class Local declaration section is still
     * open -- `closesApplicationClassLocalSection`'s own 0x2D push uses
     * this SAME flag (a few dozen lines below) and needs it set even
     * when the generic top-level section already closed.
     *
     * CAFNUI_CTRL_WRK.CAF_DELETE_FLG.FieldChange (definition 2102):
     *
     *   import PT_PAGE_UTILS:Utils;
     *
     *   Local PT_PAGE_UTILS:Utils &PTUtils = create PT_PAGE_UTILS:Utils();
     *
     *   If %Page = Page.CAFNUI_ED_FLST_SCF Then
     *
     * `closedTopLevelDeclarationSection` is already true here (set by the
     * import), so the original `!closedTopLevelDeclarationSection` guard
     * alone never let this flag get set for this Local at all.
     */
    if (
      isLocalDeclaration &&
      lastLocalHadInitializer &&
      ((sawTopLevelDeclaration && !closedTopLevelDeclarationSection) ||
        ((sawApplicationClassLocalSection ||
          (isApplicationClassLocal && applicationClassLocalIsDeclarationPhase)) &&
          !closedApplicationClassLocalSection))
    ) {
      leadingRunHasInitializedLocal = true;
    }

    if (
      leadingLocalRun &&
      isLocalDeclaration
    ) {
      if (lastLocalHadInitializer) {
        /*
         * An initialized Local is executable at declaration time. It does
         * not extend the declaration-only Local section -- but only when
         * the immediately following Local declaration (if any) is itself
         * uninitialized. If an UNINITIALIZED Local declaration follows
         * (before the first truly non-Local statement), the whole run
         * stays one section and the general
         * leadingLocalRun/!isLocalDeclaration closer below (which fires
         * once, at the actual end of the run) supplies the boundary
         * instead.
         *
         * DAEMONGROUP.DAEMONGROUP.SaveEdit (definition 3539):
         *
         *   Local number &i;
         *   Local number &cnt = 0;
         *
         *   Local number &duprow;
         *
         *   Local Rowset &this;
         *
         *   &this = GetLevel0()(1).GetRowset(Scroll.DAEMONGROUP);
         *
         * stores no 0x2D/0x4F boundary between `&i;` and the initialized
         * `&cnt = 0;` -- the section only closes once, right before
         * `&this = GetLevel0()...`, after &duprow and &this (both
         * uninitialized) have also been declared.
         *
         * Deliberately narrow to "next Local is uninitialized": ACA_BGN_MTH_TBL.
         * BEGIN_DT.SaveEdit (definition 256, protected baseline) proves TWO
         * directly-adjacent INITIALIZED Locals --
         *
         *   Local integer &year = Year(ACA_BGN_MTH_TBL.BEGIN_DT);
         *   Local integer &month = Month(ACA_BGN_MTH_TBL.BEGIN_DT);
         *
         * -- must NOT defer to the general closer this way; deferring here
         * caused the general closer to later fire using the wrong anchor
         * position (statementChunkStart of the SECOND initializer, wrongly
         * placing a boundary between the two initializers). When the next
         * Local is itself initialized, fall through to the original
         * behavior below (no boundary set here; leadingLocalRun stays
         * false for the rest of the run, matching pre-existing calibrated
         * behavior for consecutive initialized Locals).
         *
         * If declaration-only Locals preceded this initialized Local AND no
         * uninitialized Local declaration follows it, close the section
         * immediately before this initialized Local. If it is the first
         * Local, there is no declaration-only section and therefore no
         * deferred 0x2D boundary.
         */
        const afterStatementSemicolon =
          source[pos] === ';' ? pos + 1 : pos;
        const afterStatementLookaheadStart =
          nextSignificantAfterBlockComments(afterStatementSemicolon);
        const nextLocalMatch =
          /^Local\s+[A-Za-z_][A-Za-z0-9_]*\s+&[A-Za-z0-9_]+#?\s*(=)?/i.exec(
            source.slice(afterStatementLookaheadStart)
          );
        const nextIsAnotherUninitializedLocal =
          nextLocalMatch !== undefined && nextLocalMatch !== null && nextLocalMatch[1] === undefined;

        /*
         * Cycle 86: an initialized Local never closes a leading run that has
         * already started. It marks the run initialized (so the run's single
         * eventual close is informal, Cycle 84) and the run continues to the
         * first non-Local statement, where the ordinary deferred boundary is
         * anchored. The earlier rule closed the run formally, immediately
         * BEFORE this initialized Local, whenever the next Local was not an
         * uninitialized one. LOCAL SNAPSHOT (`cycle86-initialized-run-
         * census.ts start`): in 52/52 program-start runs of that shape the
         * stored bytes there are only the source's blank lines, never
         * `2D 4F` (e.g. 3869: `L L Li X`); after a top-level Function the
         * same holds (28204, 28210, 25295, 25296). +53 forward-exact, 0 lost.
         * An initialized FIRST Local (no declaration-only run yet, e.g.
         * protected definition 256) still ends the run without a boundary.
         */
        if (nextIsAnotherUninitializedLocal || sawLeadingLocalDeclaration) {
          leadingRunHasInitializedLocal = true;
          sawLeadingLocalDeclaration = true;
        } else {
          leadingLocalRun = false;
        }
      } else {
        sawLeadingLocalDeclaration = true;
      }
      if (process.env.DEBUG_513) console.error('AFTER-LOCAL-STMT', { leadingLocalRun, sawLeadingLocalDeclaration, lastLocalHadInitializer, isApplicationClassLocal });
    }

    if (isFunction) {
      /*
       * functionStatement() consumes the complete Function ... End-Function;
       * definition and emits its trailing 0x2D definition boundary.
       *
       * Mark it as a completed top-level statement before continuing so the
       * next loop iteration can preserve blank-line group boundaries between
       * adjacent Function definitions.
       *
       * Calibrated by ABS_HIST_UK_SBR.SMP_MA_ELIG.FieldFormula:
       *
       *   End-Function;
       *
       *   Function Employee_MA() Returns boolean
       *
       * => ... 37 15 2D 4F 32 ...
       */
      haveCompletedTopLevelStatement = true;
      // Cycle 103: the next declaration starts a new built-in run.
      builtinRunSplitPending = true;

      /*
       * Cycle 86 (generalizes Cycle 85): before executable code begins, a
       * top-level Function definition does not end the declaration phase.
       * A Local run that follows it starts a NEW declaration run, even if an
       * earlier run already closed, or declarations/imports preceded the
       * Function. LOCAL SNAPSHOT (`cycle85-function-continuity-census.ts`):
       * every plain Local run after a Function, before executable code,
       * stores the formal `2D 4F` close (103 definitions, 0 contradictions),
       * e.g. 15038 `L L[2D 4F] F ... F L[2D 4F] X`. The ended run's deferred
       * boundary is archived, then run tracking restarts.
       */
      if (!sawTopLevelExecutableStatement) {
        if (pendingReferenceLocalBoundary !== undefined) {
          archivedReferenceLocalBoundaries.push({
            index: pendingReferenceLocalBoundary,
            markers: pendingReferenceLocalMarkers,
            blankLines: pendingReferenceLocalBlankLines,
            initialized: leadingRunHasInitializedLocal
          });
        }
        restartLocalDeclarationRun();
        leadingRunHasInitializedLocal = false;
      }
      continue;
    }

    space();

    /*
     * A block comment may appear between a top-level statement's
     * expression and its own terminating semicolon, the same way
     * If/For/While bodies already allow -- inline (0x4E) or standalone
     * (0x24) by placement (see `blockCommentByPlacement()`).
     *
     * HR_LINK_WRK.DESCR.FieldFormula (definition 18680):
     *
     *   HR_LINK_WRK.DESCR = MsgGetText(18032, 485, "Message Not Found, 18032, 485") /* Go to *\/;
     */
    while (source.startsWith('/*', pos)) {
      chunks.push(blockCommentByPlacement());
      space();
    }

    /*
     * Some complete block statements are self-terminating at top level.
     *
     * Calibrated cases:
     *
     *   If ... End-If
     *   Evaluate ... End-Evaluate
     *
     * At EOF, PeopleTools emits the block terminator directly before 0x07;
     * there is no synthetic 0x15 semicolon:
     *
     *   ... 1A 07   // End-If
     *   ... 3F 07   // End-Evaluate
     *
     * Ordinary top-level statements still require ';'.
     */
    if (source[pos] !== ';') {
      /*
       * Some complete top-level statements are legal at EOF without an
       * explicit source semicolon.
       *
       * Previously calibrated:
       *   If ... End-If
       *   Evaluate ... End-Evaluate
       *
       * Offset 425 adds an ordinary top-level assignment:
       *
       *   ACC_TYP_TBL_BRA.EFF_STATUS.Value =
       *      ACCDNT_TYPE_TBL.EFF_STATUS.Value
       *
       * Stored PSPCMPROG ends directly with 0x07 after the RHS expression;
       * there is no synthetic 0x15 terminator.
       *
       * Restrict this relaxation to EOF. Any non-EOF ordinary statement
       * still requires its explicit semicolon.
       */
      const trailingStandaloneCommentEnd = source.startsWith('/*', pos)
        ? source.indexOf('*/', pos + 2)
        : -1;
      /*
       * Any self-terminating-at-EOF statement type may have a trailing
       * standalone comment between its own end and true EOF, not just a
       * plain assignment -- HS_EXAM_AUDIO2.<various>.FieldChange
       * (definition 1353) proves this for a top-level `If ... End-If`
       * (no trailing `;`) immediately followed by
       * `/*End Resolution 301452 *\/` and nothing else:
       *
       *   If %Page = ... Then
       *      ...
       *   End-If
       *   /*End Resolution 301452 *\/
       */
      const selfTerminatingBeforeFinalStandaloneComment =
        (
          startsTopLevelAssignment ||
          isIfStatement ||
          isEvaluateStatement ||
          isForStatement ||
          isTopLevelCallStatement ||
          isTopLevelVariableLedCallStatement ||
          isWarningOrErrorStatement ||
          isTryStatement
        ) &&
        trailingStandaloneCommentEnd >= 0 &&
        /^\s*$/.test(source.slice(trailingStandaloneCommentEnd + 2));

      /*
       * A top-level statement immediately followed by a REM comment (no
       * semicolon of its own) may likewise omit it -- the REM statement
       * itself is handled by this same loop's own dedicated REM branch
       * on its next iteration, exactly like the ordinary
       * `;`-then-continue path. Not restricted to EOF: the REM statement
       * may not be the last thing in the file.
       *
       * CAF_FACTOR_360.CAF_CLOSE_BTN.FieldChange (definition 2175):
       *
       *   &cmpSession.Configuration.ComparisonHandler.
       *       DeleteFactorfromAnalysisGrouplets(&RS_Flt_Factor360(&save_i_flt_fac))
       *   rem &cmpSession.ProcessNUIAction("updfactor");
       */
      const precedesRemStatement = startsRemComment();

      const selfTerminatingAtEof =
        (
          pos === source.length &&
          (
            startsTopLevelAssignment ||
            isIfStatement ||
            isEvaluateStatement ||
            isForStatement ||
            isWhileStatement ||
            isTopLevelCallStatement ||
            isTopLevelVariableLedCallStatement ||
            isWarningOrErrorStatement ||
            isTryStatement
          )
        ) || selfTerminatingBeforeFinalStandaloneComment || precedesRemStatement;

      if (!selfTerminatingAtEof) {
        fail('expected ;');
      }
    } else {
      pos++;
      chunks.push(fixed(';'));

      /*
       * A same-line block comment following a top-level statement terminator
       * is the trailing/inline 0x4E representation, exactly like the already
       * calibrated For/While/If body paths.
       *
       * ACA_CAL_YEAR.LASTUPDDTTM.SavePreChange:
       *
       *   End-For; [trailing block comment &I]
       *
       * stores:
       *
       *   ... 2C 15 4E <comment> 07
       *
       * rather than the standalone-comment 0x24 form.
       */
      trailingBlockComments();
    }

    if (isImport) {
      // Imports remain in one open declaration section until the first
      // non-import statement (comments do not close the section).
      importSectionOpen = true;

      // Keep imports out of the generic declaration-section closer; their
      // boundary is managed explicitly by importSectionOpen.
      closedTopLevelDeclarationSection = true;
    } else if (
      isApplicationClassLocal &&
      applicationClassLocalIsDeclarationPhase
    ) {
      sawApplicationClassLocalSection = true;
    } else if (isTopLevelDeclaration) {
      sawTopLevelDeclaration = true;

      /*
       * A completed import section is distinct from a following ordinary
       * top-level declaration section.
       *
       * DERIVED_CO.FUNCLIB.FieldFormula calibrates:
       *
       *   import CO_NAVIGATN:Stack;
       *
       *   Global CO_NAVIGATN:Stack &MyNavStack;
       *   ...
       *   PanelGroup ...;
       *   Global string &SearchBy, &TrnReqFrom, &TrnReqThru;
       *
       *   [standalone comment block]
       *   Function FillSessionGrids(...)
       *
       * The import section has already closed earlier with its own 0x2D.
       * The later Global/PanelGroup declaration section must therefore reopen
       * the generic declaration-section tracker so the comment boundary emits
       * the second required 0x2D:
       *
       *   ... <last Global> 15 2D 4F 24 ...
       *
       * Without reopening here, closedTopLevelDeclarationSection remains true
       * from the import close and the second 0x2D is incorrectly suppressed.
       *
       * Keep this limited to the declaration phase; a declaration encountered
       * after executable top-level code has begun must not reopen the section.
       */
      if (!sawTopLevelExecutableStatement) {
        closedTopLevelDeclarationSection = false;
      }
    }

    /*
     * Once an ordinary executable statement has been encountered, later
     * initialized App Class Locals are executable statements, not a reopened
     * Local declaration section.
     *
     * Keep pure declarations and declaration-only Locals out of this state.
     * Initialized Locals do count because their initializer executes.
     */
    if (
      !isImport &&
      !isTopLevelDeclaration &&
      (
        !isLocalDeclaration ||
        lastLocalHadInitializer
      )
    ) {
      sawTopLevelExecutableStatement = true;
    }

    haveCompletedTopLevelStatement = true;
  }

  /*
   * Cycle 16: this flush decision governs whether the WHOLE
   * COMPILATION UNIT's deferred blank-line/declaration-boundary markers
   * appear at all (Cycle 15's own confirmed finding: identical statement
   * structure and blank-line placement, differing only in whether a
   * LATER statement compiles a reference, changes whether EARLIER gaps
   * get a marker). For every ordinary caller, one `encodeFragmentInternal`
   * call already IS the whole compilation unit, so the local `references`
   * list computed below is the right thing to check.
   *
   * An Application Class method body is the one exception: Cycle 14
   * encodes each method as its OWN independent call, so this local
   * check only sees that ONE method's own references, not the whole
   * class's. `context.compilationUnitHasCompiledReferences`, when
   * explicitly supplied, overrides the local computation with the
   * caller's own whole-program answer instead. Every existing caller
   * omits it (stays `undefined`), so the local, per-call computation
   * -- and therefore all 23,217 currently-EXACT definitions -- is
   * completely unaffected; `??` (not `||`) is used so an explicit
   * `false` is honored rather than falling back.
   */
  const hasCompiledReferences =
    context?.compilationUnitHasCompiledReferences ??
    // The implicit owner placeholder alone does not count as a compiled
    // reference. A bound/inferred owner or any additional PSPCMNAME row does.
    (references.length > 1 ||
    references[0]?.recordName !== undefined ||
    references[0]?.fieldName !== undefined);

  if (hasCompiledReferences) {
    const insertions: Array<{ index: number; bytes: Buffer[] }> = [];

    if (pendingReferenceLocalBoundary !== undefined) {
      insertions.push({
        index: pendingReferenceLocalBoundary,
        bytes: [
          /*
           * An initialized Local anywhere in the leading run means this
           * close is an ordinary blank-line gap, not a formal declaration-
           * section boundary -- omit the 0x2D. See
           * leadingRunHasInitializedLocal's declaration comment above.
           */
          ...(
            leadingRunHasInitializedLocal || context?.suppressDeclarationSectionMarkers === true
              ? []
              : [Buffer.from([0x2d])]
          ),
          /*
           * Cycle 84: an informal close (no 0x2D) carries only the source's
           * actual blank lines; the floor of one in
           * `pendingReferenceLocalMarkers` belongs to the formal 0x2D close.
           * LOCAL SNAPSHOT: 91 definitions whose only difference was this
           * floor marker (e.g. 2959, 3881, 7167) become forward-exact, 0
           * definitions lose exactness.
           */
          ...Array.from(
            {
              length: leadingRunHasInitializedLocal && context?.suppressDeclarationSectionMarkers !== true
                ? pendingReferenceLocalBlankLines
                : pendingReferenceLocalMarkers
            },
            () => Buffer.from([0x4f])
          )
        ]
      });
    }

    for (const archived of archivedReferenceLocalBoundaries) {
      // Same serialization as the current pending boundary above (formal
      // 0x2D + floor, or informal blank lines only -- Cycle 84).
      const informalClose = archived.initialized && context?.suppressDeclarationSectionMarkers !== true;
      insertions.push({
        index: archived.index,
        bytes: [
          ...(archived.initialized || context?.suppressDeclarationSectionMarkers === true
            ? []
            : [Buffer.from([0x2d])]),
          ...Array.from(
            { length: informalClose ? archived.blankLines : archived.markers },
            () => Buffer.from([0x4f])
          )
        ]
      });
    }

    for (const index of pendingReferenceGroupBoundaries) {
      // Do not duplicate the 0x4F already supplied by a leading-Local
      // reference boundary at the same source boundary.
      if (
        index !== pendingReferenceLocalBoundary &&
        !archivedReferenceLocalBoundaries.some(archived => archived.index === index)
      ) {
        insertions.push({
          index,
          bytes: [Buffer.from([0x4f])]
        });
      }
    }

    // Insert from the end so earlier chunk indexes remain stable.
    insertions.sort((a, b) => b.index - a.index);
    for (const insertion of insertions) {
      chunks.splice(insertion.index, 0, ...insertion.bytes);
    }

  }

  const chunksBeforeEndCloses = chunks.length;
  if (importSectionOpen) {
    chunks.push(Buffer.from([0x2d]));
    closeImportSection();
  }

  /*
   * Cycle 113: a declaration run still open at the end of the program
   * closes with 0x2D only when it holds no initialized Local -- the same
   * condition the mid-program close applies (`leadingRunHasInitializedLocal`).
   * 16461 `Declare Function ...; Local boolean &ret = ...;` and 17992
   * (imports, then `Local ... = create ...; Local boolean &check = ...;`)
   * end `15 07`, not `15 2D 07`.
   */
  if (
    sawApplicationClassLocalSection &&
    !closedApplicationClassLocalSection &&
    !leadingRunHasInitializedLocal
  ) {
    chunks.push(Buffer.from([0x2d]));
  }

  if (sawTopLevelDeclaration && !closedTopLevelDeclarationSection && !leadingRunHasInitializedLocal) {
    chunks.push(Buffer.from([0x2d]));
  } else if (
    chunks.length === chunksBeforeEndCloses &&
    leadingLocalRun &&
    sawLeadingLocalDeclaration &&
    pendingReferenceLocalBoundary === undefined &&
    !leadingRunHasInitializedLocal &&
    !sawTopLevelExecutableStatement &&
    context?.suppressDeclarationSectionMarkers !== true
  ) {
    /*
     * Cycle 113: a program that is only a run of uninitialized Locals
     * closes it with 0x2D at the end, references or not -- 11257 `Local
     * integer &a;` and 25511 `Local number &Next;` end `15 2D 07` (one
     * close: not when an import / App-Class-Local close above wrote it).
     */
    chunks.push(Buffer.from([0x2d]));
  }

  const finalBytes = Buffer.concat(chunks);

  return {
    bytes: finalBytes,
    references,
    commentOpcodesConsumed: commentOpcodeIndex
  };
}

export function encodeFragment(source: string): Buffer {
  return encodeFragmentInternal(source).bytes;
}



interface ApplicationClassProgramMetadata {
  importedPath: string[];
  className: string;
  methodName: string;
  parameters: { name: string; type: string }[];
  returnType?: string;
  signatureComments: string[];
  localVariableName: string;
  localClassPath: string[];
  createClassPath: string[];
  callMethodName: string;
  callArgument: string;
  returnValue: string;
}

function encodeInlineName(value: string): Buffer {
  return textOperand(INLINE_IDENTIFIER_OPCODE, TokenKind.Name, value);
}

function encodeKeywordText(value: string): Buffer {
  return textOperand(0x40, TokenKind.Keyword, value);
}

function encodeStringLiteral(value: string): Buffer {
  return textOperand(0x16, TokenKind.StringLiteral, value);
}

function encodeVariableName(value: string): Buffer {
  return textOperand(0x01, TokenKind.Name, value);
}

function encodeApplicationClassPathBytes(path: string[]): Buffer {
  const chunks: Buffer[] = [];

  path.forEach((component, index) => {
    if (index > 0) {
      chunks.push(Buffer.from([0x57]));
    }
    chunks.push(
      component.toLowerCase() === '%metadata'
        ? textOperand(0x12, TokenKind.Name, component)
        : encodeInlineName(component)
    );
  });

  return Buffer.concat(chunks);
}

const APPLICATION_CLASS_WORD_TYPES = new Set([
  'any', 'boolean', 'date', 'datetime', 'integer', 'number', 'object',
  'string', 'time'
]);

/** Cycle 22 TYPE: array words are individual 0x40 operands; class paths are inline names. */
function encodeApplicationClassTypeBytes(typeName: string): Buffer {
  let remaining = typeName.replace(/\s+/g, ' ').trim();
  const chunks: Buffer[] = [];
  while (/^array\s+of\s+/i.test(remaining)) {
    chunks.push(encodeKeywordText('array'), encodeKeywordText('of'));
    remaining = remaining.replace(/^array\s+of\s+/i, '');
  }
  if (APPLICATION_CLASS_WORD_TYPES.has(remaining.toLowerCase())) {
    chunks.push(encodeKeywordText(remaining));
    return Buffer.concat(chunks);
  }
  const path = remaining.split(':').map(component => component.trim()).filter(Boolean);
  path.forEach((component, index) => {
    if (index > 0) chunks.push(Buffer.from([0x57]));
    chunks.push(
      component.toLowerCase() === '%metadata'
        ? textOperand(0x12, TokenKind.Name, component)
        : encodeInlineName(component)
    );
  });
  return Buffer.concat(chunks);
}

function encodeApplicationClassLiteral(value: string): Buffer {
  const encoded = encodeFragmentInternal(`Return ${value};`).bytes;
  if (encoded.length < 2 || encoded[encoded.length - 1] !== 0x15) {
    throw new Error(`Unsupported Application Class constant literal: ${value}`);
  }
  // Return and the declaration's own semicolon are emitted by the caller.
  return encoded.subarray(1, encoded.length - 1);
}

/**
 * Calibrated Application Package / Application Class subset.
 *
 * This deliberately recognizes only the source shape captured from
 * PeopleTools.  It is separate from ordinary Record/Field event PeopleCode:
 * reference allocation is not yet generalized. A current read-only capture
 * contains a PACKAGE row absent from the earlier owner-only assumption;
 * see docs/APPLICATION_CLASS_SIGNATURES.md before changing allocation rules.
 */
function parseApplicationClassProgram(
  source: string
): ApplicationClassProgramMetadata | undefined {
  /*
   * Only route a source unit through the dedicated Application Class program
   * encoder when it contains an actual top-level class declaration. Ordinary
   * event PeopleCode can begin with an import and later contain the word
   * "class" inside a comment; that must remain on the normal fragment path.
   */
  const applicationClassDeclaration =
    /^\s*class\s+[A-Za-z_][A-Za-z0-9_]*\s+method\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/im;

  if (
    !/^\s*import\b/i.test(source) ||
    !applicationClassDeclaration.test(source)
  ) {
    return undefined;
  }

  const importMatch =
    /^\s*import\s+([A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+)\s*;/i.exec(
      source
    );
  if (!importMatch) {
    throw new UnsupportedPeopleCodeError(
      0,
      'unsupported Application Class import'
    );
  }

  const classMatch =
    /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s+method\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:Returns\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;\s*end-class\s*;/im.exec(
      source
    );
  if (!classMatch) {
    throw new UnsupportedPeopleCodeError(
      0,
      'unsupported Application Class declaration'
    );
  }

  const parameters = classMatch[3].trim() === '' ? [] : classMatch[3].split(',').map(parameter => {
    const match = /^\s*(&[A-Za-z0-9_]+#?)\s+As\s+(string|integer|boolean)\s*$/i.exec(parameter);
    if (!match) throw new UnsupportedPeopleCodeError(0, 'unsupported Application Class parameter');
    return { name: match[1], type: match[2] };
  });

  const implementationMatch =
    /\bmethod\s+([A-Za-z_][A-Za-z0-9_]*)\s*((?:\/\+[\s\S]*?\+\/\s*)+)([\s\S]*?)\bend-method\s*;/i.exec(
      source.slice((classMatch.index ?? 0) + classMatch[0].length)
    );
  if (!implementationMatch) {
    throw new UnsupportedPeopleCodeError(
      0,
      'unsupported Application Class method implementation'
    );
  }

  if (implementationMatch[1].toLowerCase() !== classMatch[2].toLowerCase()) {
    throw new UnsupportedPeopleCodeError(
      0,
      'Application Class method declaration/implementation name mismatch'
    );
  }

  const signatureComments = [
    ...implementationMatch[2].matchAll(/\/\+\s*([\s\S]*?)\s*\+\//g)
  ].map(match => match[1].trim());

  const body = implementationMatch[3];

  const localMatch =
    /\bLocal\s+([A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+)\s+(&[A-Za-z0-9_]+#?)\s*;/i.exec(
      body
    );
  const createMatch =
    /(&[A-Za-z0-9_]+#?)\s*=\s*create\s+([A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)+)\s*\(\s*\)\s*;/i.exec(
      body
    );
  const callMatch =
    /(&[A-Za-z0-9_]+#?)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*"([^"]*)"\s*\)\s*;/i.exec(
      body
    );
  const returnMatch =
    /\bReturn\s+"([^"]*)"\s*(?:;)?/i.exec(body);

  if (!localMatch || !createMatch || !callMatch || !returnMatch) {
    throw new UnsupportedPeopleCodeError(
      0,
      'unsupported Application Class method body'
    );
  }

  if (
    localMatch[2].toLowerCase() !== createMatch[1].toLowerCase() ||
    localMatch[2].toLowerCase() !== callMatch[1].toLowerCase()
  ) {
    throw new UnsupportedPeopleCodeError(
      0,
      'Application Class receiver variable mismatch'
    );
  }

  return {
    importedPath: importMatch[1].split(':'),
    className: classMatch[1],
    methodName: classMatch[2],
    parameters,
    returnType: classMatch[4],
    signatureComments,
    localVariableName: localMatch[2],
    localClassPath: localMatch[1].split(':'),
    createClassPath: createMatch[2].split(':'),
    callMethodName: callMatch[2],
    callArgument: callMatch[3],
    returnValue: returnMatch[1]
  };
}

function encodeApplicationClassExecutable(
  metadata: ApplicationClassProgramMetadata
): Buffer {
  const c: Buffer[] = [];

  // import A:B:C;  => 58 path 15 2D 4F
  c.push(Buffer.from([0x58]));
  c.push(encodeApplicationClassPathBytes(metadata.importedPath));
  c.push(Buffer.from([0x15, 0x2d, 0x4f]));

  // class TestClass
  c.push(Buffer.from([0x5a]));
  c.push(encodeInlineName(metadata.className));

  // Method declaration; parameter commas retain source order.
  c.push(Buffer.from([0x63]));
  c.push(encodeInlineName(metadata.methodName));
  c.push(Buffer.from([0x0b]));
  metadata.parameters.forEach((parameter, index) => {
    if (index > 0) c.push(fixed(','));
    c.push(encodeVariableName(parameter.name));
    c.push(Buffer.from([0x35]));
    c.push(encodeKeywordText(parameter.type));
  });
  c.push(Buffer.from([0x14]));
  if (metadata.returnType !== undefined) {
    c.push(Buffer.from([0x39]));
    c.push(encodeKeywordText(metadata.returnType));
  }
  c.push(Buffer.from([0x15]));

  // end-class;
  c.push(Buffer.from([0x5b, 0x15, 0x2d, 0x4f]));

  // method implementation header
  c.push(Buffer.from([0x63, 0x41]));
  c.push(encodeInlineName(metadata.methodName));
  c.push(Buffer.from([0x2d]));

  // /+ ... +/ compiler signature records
  for (const comment of metadata.signatureComments) {
    c.push(textOperand(0x6d, TokenKind.Comment, comment));
  }
  c.push(Buffer.from([0x4f]));

  // Local A:B:C &obj;
  c.push(Buffer.from([0x44]));
  c.push(encodeApplicationClassPathBytes(metadata.localClassPath));
  c.push(encodeVariableName(metadata.localVariableName));
  c.push(Buffer.from([0x15, 0x4f]));

  // &obj = create A:B:C();
  c.push(encodeVariableName(metadata.localVariableName));
  c.push(Buffer.from([0x06, 0x69]));
  c.push(encodeApplicationClassPathBytes(metadata.createClassPath));
  c.push(Buffer.from([0x0b, 0x14, 0x15, 0x4f]));

  // &obj.TestMethod("Input");
  c.push(encodeVariableName(metadata.localVariableName));
  c.push(Buffer.from([0x05]));
  c.push(encodeInlineName(metadata.callMethodName));
  c.push(Buffer.from([0x0b]));
  c.push(encodeStringLiteral(metadata.callArgument));
  c.push(Buffer.from([0x14, 0x15, 0x4f]));

  // Return "Hi" + calibrated Application Class method terminator structure.
  c.push(Buffer.from([0x38]));
  c.push(encodeStringLiteral(metadata.returnValue));
  c.push(Buffer.from([0x64, 0x15, 0x2d]));

  return Buffer.concat(c);
}

function encodeApplicationClassMetadata(
  metadata: ApplicationClassProgramMetadata
): Buffer {
  // Captured trailer begins with owning class path WITHOUT intermediate
  // subpackages from the imported/created dependency:
  //   OU_CORPUS:TestClass\0
  // followed by TestMethod\0.
  const ownerPackage = metadata.importedPath[0];
  const ownerName = `${ownerPackage}:${metadata.className}`;

  const strings = Buffer.concat([
    Buffer.from(ownerName + '\0', 'utf16le'),
    Buffer.from(metadata.methodName + '\0', 'utf16le')
  ]);

  const self = Buffer.alloc(16);
  self.writeUInt32LE(0x400000, 8);
  self.writeUInt32LE(0x07, 12);
  const signature = encodePrimitiveMethodSignature({
    nameOffset: ownerName.length + 1,
    slotOffset: 0,
    parameterTypes: metadata.parameters.map(parameter => parameter.type),
    returnType: metadata.returnType
  });
  return Buffer.concat([strings, self, signature.record, signature.slots]);
}

function encodeApplicationClassProgram(
  metadata: ApplicationClassProgramMetadata
): Buffer {
  const statements = encodeApplicationClassExecutable(metadata);
  const trailer = encodeApplicationClassMetadata(metadata);

  const ownerName =
    `${metadata.importedPath[0]}:${metadata.className}\0`;
  const methodName = `${metadata.methodName}\0`;

  // Captured Application Class header:
  //   @5  executable length including final 0x07
  //   @13 combined UTF-16LE owner-name + method-name byte length
  //   @21 parameter count + 1 dispatch slots
  //   @29 2
  //   @33 0x85
  const header = Buffer.alloc(37);
  header[0] = 0xa0;
  header.writeUInt32LE(0, 1);
  header.writeUInt32LE(statements.length + 1, 5);
  header.writeUInt32LE(0, 9);
  header.writeUInt32LE(
    Buffer.byteLength(ownerName + methodName, 'utf16le'),
    13
  );
  header.writeUInt32LE(0, 17);
  header.writeUInt32LE(metadata.parameters.length + 1, 21);
  header.writeUInt32LE(0, 25);
  header.writeUInt32LE(2, 29);
  header.writeUInt32LE(0x85, 33);

  return Buffer.concat([
    header,
    statements,
    Buffer.from([PROGRAM_DIRECTORY_SEPARATOR]),
    trailer
  ]);
}

interface ApplicationClassLayoutComment {
  start: number;
  end: number;
  opcode: 0x24 | 0x4e | 0x55;
  raw: string;
}

function applicationClassBlankLineCount(value: string): number {
  if (!/^\s*$/.test(value)) return 0;
  return Math.max(0, (value.match(/\r?\n/g) ?? []).length - 1);
}

function applicationClassLayoutCommentOperand(
  comment: ApplicationClassLayoutComment
): Buffer {
  const payload = Buffer.from(comment.raw, 'utf16le');
  if (payload.length > 0xffff) {
    throw new UnsupportedPeopleCodeError(
      comment.start,
      'Application Class layout comment exceeds uint16 payload length'
    );
  }
  const header = Buffer.alloc(3);
  header[0] = comment.opcode;
  header.writeUInt16LE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function scanApplicationClassLayoutComments(
  source: string,
  start: number,
  end: number
): ApplicationClassLayoutComment[] {
  const comments: ApplicationClassLayoutComment[] = [];
  let index = start;
  while (index < end) {
    if (source[index] === '"' || source[index] === "'") {
      const quote = source[index++];
      while (index < end) {
        if (source[index] !== quote) { index++; continue; }
        if (source[index + 1] === quote) { index += 2; continue; }
        index++;
        break;
      }
      continue;
    }

    let commentEnd = -1;
    let opcode: 0x24 | 0x4e | 0x55 | undefined;
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      commentEnd = close < 0 || close + 2 > end ? end : close + 2;
      const lineStart = source.lastIndexOf('\n', index - 1) + 1;
      opcode = source.slice(lineStart, index).trim() === '' ? 0x24 : 0x4e;
    } else if (source.startsWith('<*', index)) {
      const close = source.indexOf('*>', index + 2);
      commentEnd = close < 0 || close + 2 > end ? end : close + 2;
      opcode = 0x55;
    } else if (
      source.slice(index, index + 3).toLowerCase() === 'rem' &&
      (index === 0 || !/[A-Za-z0-9_%&]/.test(source[index - 1])) &&
      /[\s:]/.test(source[index + 3] ?? '')
    ) {
      const semicolon = source.indexOf(';', index + 3);
      commentEnd = semicolon < 0 || semicolon + 1 > end ? end : semicolon + 1;
      opcode = 0x24;
    } else if (source.startsWith('/+', index)) {
      const close = source.indexOf('+/', index + 2);
      index = close < 0 || close + 2 > end ? end : close + 2;
      continue;
    } else if (source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index + 2);
      index = newline < 0 || newline > end ? end : newline;
      continue;
    }

    if (opcode === undefined) {
      index++;
      continue;
    }
    comments.push({
      start: index,
      end: commentEnd,
      opcode,
      raw: source.slice(index, commentEnd)
    });
    index = commentEnd;
  }
  return comments;
}

/**
 * Application Class encoder. Cycle 14 supplies directory/signature assembly,
 * Cycles 17-18 supply implementation wrappers, and Cycle 23 supplies the
 * Cycle 22-proven ordered unit/member statement grammar. Those phases remain
 * deliberately separate: this cycle does not derive dependency identity or a
 * new physical directory ordering rule from executable declaration order.
 */
/*
 * Cycle 100: Application Class directory layout, recovered in full.
 *
 * PeopleTools keeps a class's properties and instances in one chained hash
 * table and its methods in another, and writes the directory by walking
 * them. Stored evidence (`cycle100-appclass-section-census.ts`, LOCAL
 * SNAPSHOT, all 1,510 Application Classes):
 *
 *   hash      h = h * 2 + charCode over the UPPER-CASED name, mod 2^32
 *   capacity  the first of 20, 31, 67, 127, 257, 521, ... whose 80 % load
 *             (ceil) holds the table's symbol count -- properties +
 *             instances for the member table, all declared methods for the
 *             method table. Observed: <= 16 symbols -> 20, 17..25 -> 31,
 *             26..51 -> 67, 57..92 -> 127, 104..189 -> 257, 232 -> 521,
 *             with no overlap.
 *   order     bucket (h mod capacity) ascending; within a bucket, upper-cased
 *             name DESCENDING (987 / 987 collision buckets).
 *
 * The member order predicts 643 / 643 classes with two or more property /
 * instance records -- the population Cycle 31 could not model (it tested
 * fixed capacities and insertion-order chains); the unimplemented-method
 * order predicts 26 / 26.
 *
 * Directory records, in physical order:
 *
 *   1. self (existing Cycle 13 record);
 *   2. every property / instance in member-table order:
 *        instance           private | property | storage, low = storage ordinal
 *        plain property     property | storage (+visibility), low = storage ordinal
 *        readonly property  property | storage | readonly, low = storage ordinal
 *        get property       property | readonly, low 0
 *        get-set property   property, low 0
 *        interface property property | abstract (| readonly for get), low 0
 *      descriptor = the member's type;
 *   3. method / get / set implementations in source order: a method as
 *      before; a getter `getter`, low 0, descriptor = property type; a
 *      setter `setter`, low 1, descriptor 7;
 *   4. methods without an implementation (abstract, and every interface
 *      method) in method-table order, flagged `abstract` only.
 *
 * Names: every record's name in record order, then type-path names as the
 * descriptors of records (in record order) and then slots allocate them
 * (Cycle 29). Slots: methods in declaration order (Cycle 13), then each
 * accessor in source order -- a getter's terminator, a setter's parameter
 * (property type) and terminator.
 *
 * Replaces the Cycle 30 freeze (self, singleton instance, methods only).
 * A type-path name's package ROOT is written in the package definition's
 * case (Cycle 113, `canonicalTypePathName`). Residual, not modeled: a
 * sub-package's canonical case (28942 source `...:page:SubPage:...` is
 * stored `...:Page:...`) and a bare `array` member type (stored `array of
 * any`).
 */
/*
 * Cycle 113: application package names are uppercase definitions, so a
 * type-path name's root is written uppercase whatever the source spelling;
 * the system root is `%Metadata`. Across the local corpus 5,220 stored
 * type-path names have an uppercase root except `%Metadata` (17 programs)
 * -- 29341 source `GPS_car_REPORT_MANAGER:MappingClass` is stored
 * `GPS_CAR_REPORT_MANAGER:MappingClass`, 28722 `%metadata:AppDataSetMgr:
 * AppDataSetMgr` is stored `%Metadata:...`. The rest of the path keeps its
 * source spelling.
 */
function canonicalTypePathName(path: string): string {
  const [root, ...rest] = path.split(':');
  if (rest.length === 0) return path;
  return [/^%metadata$/i.test(root) ? '%Metadata' : root.toUpperCase(), ...rest].join(':');
}

function applicationClassSymbolHash(name: string): number {
  let hash = 0;
  for (const character of name.toUpperCase()) hash = ((hash * 2) + character.charCodeAt(0)) >>> 0;
  return hash;
}

const APPLICATION_CLASS_SYMBOL_TABLE_CAPACITIES = [20, 31, 67, 127, 257, 521, 1031, 2053];

function applicationClassSymbolTableCapacity(symbolCount: number): number {
  for (const capacity of APPLICATION_CLASS_SYMBOL_TABLE_CAPACITIES) {
    if (symbolCount <= Math.ceil(capacity * 0.8)) return capacity;
  }
  throw new UnsupportedPeopleCodeError(0, 'Application Class symbol table capacity beyond the observed range');
}

function buildApplicationClassDirectory(
  parsed: NonNullable<ReturnType<typeof parseApplicationClassSource>>,
  selfName: string,
  methods: ApplicationClassMethodMember[]
): { names: string[]; records: Buffer[]; slots: Buffer[] } {
  const names: string[] = [selfName];
  let nameCharOffset = selfName.length + 1;
  const allocateName = (text: string): number => {
    const offset = nameCharOffset;
    names.push(text);
    nameCharOffset += text.length + 1;
    return offset;
  };
  const members = parsed.members.filter(
    (member): member is ApplicationClassStorageMember => member.kind === 'property' || member.kind === 'instance'
  );
  const bare = (name: string) => name.replace(/^&/, '');
  const capacity = applicationClassSymbolTableCapacity(members.length);
  const memberOrder = [...members].sort((a, b) => {
    const bucket = (applicationClassSymbolHash(bare(a.name)) % capacity) - (applicationClassSymbolHash(bare(b.name)) % capacity);
    if (bucket !== 0) return bucket;
    const ua = bare(a.name).toUpperCase(), ub = bare(b.name).toUpperCase();
    return ua < ub ? 1 : ua > ub ? -1 : 0;
  });
  type Callable =
    | { kind: 'method'; member: ApplicationClassMethodMember }
    | { kind: 'get' | 'set'; property: ApplicationClassStorageMember | undefined; name: string };
  const methodsByName = new Map(methods.map(method => [method.name.toLowerCase(), method]));
  const propertiesByName = new Map(members.map(member => [bare(member.name).toLowerCase(), member]));
  const callables: Callable[] = [];
  const implementedMethods = new Set<ApplicationClassMethodMember>();
  for (const implementation of parsed.implementations) {
    if (implementation.kind === 'method') {
      const member = methodsByName.get(implementation.name.toLowerCase());
      if (member !== undefined && !implementedMethods.has(member)) {
        implementedMethods.add(member);
        callables.push({ kind: 'method', member });
      }
    } else {
      callables.push({ kind: implementation.kind, property: propertiesByName.get(implementation.name.toLowerCase()), name: implementation.name });
    }
  }
  const methodCapacity = applicationClassSymbolTableCapacity(methods.length);
  const unimplemented = methods.filter(member => !implementedMethods.has(member)).sort((a, b) => {
    const bucket = (applicationClassSymbolHash(a.name) % methodCapacity) - (applicationClassSymbolHash(b.name) % methodCapacity);
    if (bucket !== 0) return bucket;
    const ua = a.name.toUpperCase(), ub = b.name.toUpperCase();
    return ua < ub ? 1 : ua > ub ? -1 : 0;
  });
  for (const member of unimplemented) callables.push({ kind: 'method', member });

  // Names of all records first, in physical order.
  const memberNameOffsets = memberOrder.map(member => allocateName(bare(member.name)));
  const callableNameOffsets = callables.map(callable =>
    allocateName(callable.kind === 'method' ? callable.member.name : callable.name));
  const ensureNameOffset = (path: string): number => allocateName(canonicalTypePathName(path));

  // Descriptors: self, members, callables (physical order), then slots.
  const relationshipType = parsed.extendsType ?? parsed.implementsType;
  const selfDescriptor = relationshipType === undefined ? NO_TYPE_DESCRIPTOR : encodeTypeDescriptor(relationshipType, ensureNameOffset);
  const memberDescriptors = memberOrder.map(member => encodeTypeDescriptor(member.type, ensureNameOffset));
  const callableDescriptors = callables.map(callable =>
    callable.kind === 'method'
      ? (callable.member.returnType === undefined ? NO_TYPE_DESCRIPTOR : encodeTypeDescriptor(callable.member.returnType, ensureNameOffset))
      : callable.kind === 'get' && callable.property !== undefined
        ? encodeTypeDescriptor(callable.property.type, ensureNameOffset)
        : NO_TYPE_DESCRIPTOR);

  // Slots: methods in declaration order (Cycle 13), then accessors in physical order.
  const slots: Buffer[] = [];
  for (const member of [...methods].sort((a, b) => a.declarationOrdinal - b.declarationOrdinal)) {
    for (const parameter of member.parameters) {
      const descriptor = encodeTypeDescriptor(parameter.type, ensureNameOffset);
      slots.push(encodeApplicationClassSlot(parameter.out ? descriptor | 0x80000000 : descriptor));
    }
    slots.push(encodeApplicationClassSlot(NO_TYPE_DESCRIPTOR));
  }
  const accessorSlotOffset = new Map<number, number>();
  callables.forEach((callable, index) => {
    if (callable.kind === 'method') return;
    accessorSlotOffset.set(index, slots.length);
    if (callable.kind === 'set' && callable.property !== undefined) {
      slots.push(encodeApplicationClassSlot(encodeTypeDescriptor(callable.property.type, ensureNameOffset)));
    }
    slots.push(encodeApplicationClassSlot(NO_TYPE_DESCRIPTOR));
  });

  const visibility = (value: string) =>
    value === 'private' ? APPLICATION_CLASS_FLAGS.private : value === 'protected' ? APPLICATION_CLASS_FLAGS.protected : 0;
  const records: Buffer[] = [encodeApplicationClassDirectoryRecord({
    nameOffset: 0, signatureSlotOffset: 0, flags: APPLICATION_CLASS_FLAGS.self, low: 0, descriptor: selfDescriptor
  })];
  const isInterface = parsed.unitKind === 'interface';
  memberOrder.forEach((member, index) => {
    const storage = !isInterface && (member.kind === 'instance' || member.mode === 'plain' || member.mode === 'readonly');
    const flags =
      APPLICATION_CLASS_FLAGS.property |
      (isInterface ? APPLICATION_CLASS_FLAGS.abstract : member.kind === 'instance' ? APPLICATION_CLASS_FLAGS.private : visibility(member.visibility)) |
      (storage ? APPLICATION_CLASS_FLAGS.storage : 0) |
      (member.mode === 'readonly' || member.mode === 'get' ? APPLICATION_CLASS_FLAGS.readonly : 0);
    records.push(encodeApplicationClassDirectoryRecord({
      nameOffset: memberNameOffsets[index], signatureSlotOffset: 0, flags,
      low: storage ? member.declarationOrdinal : 0, descriptor: memberDescriptors[index]
    }));
  });
  callables.forEach((callable, index) => {
    if (callable.kind === 'method') {
      const member = callable.member;
      records.push(encodeApplicationClassDirectoryRecord({
        nameOffset: callableNameOffsets[index], signatureSlotOffset: member.signatureSlotOffset,
        flags: member.abstract || isInterface ? APPLICATION_CLASS_FLAGS.abstract : visibility(member.visibility),
        low: member.parameters.length, descriptor: callableDescriptors[index]
      }));
    } else {
      records.push(encodeApplicationClassDirectoryRecord({
        nameOffset: callableNameOffsets[index], signatureSlotOffset: accessorSlotOffset.get(index)!,
        flags: callable.kind === 'get' ? APPLICATION_CLASS_FLAGS.getter : APPLICATION_CLASS_FLAGS.setter,
        low: callable.kind === 'set' ? 1 : 0, descriptor: callableDescriptors[index]
      }));
    }
  });
  return { names, records, slots };
}

function encodeApplicationClassProgramV2(
  source: string,
  context: EncodeProgramContext | undefined
): { program: Buffer; references: PeopleCodeReference[] } | undefined {
  const parsed = parseApplicationClassSource(source);
  if (parsed === undefined) return undefined;
  const methods = parsed.members.filter(
    (member): member is ApplicationClassMethodMember => member.kind === 'method'
  );
  /*
   * Cycle 46: `parsed.implementations` (iterated below to encode each
   * method BODY) carries only `{kind, name, body, ...}` -- no `.parameters`.
   * The class header's OWN `ApplicationClassMethodMember` (in `methods`,
   * above) is where `.parameters` lives. Method names are unique within one
   * Application Class (PeopleCode does not support overloading), so a
   * name-keyed lookup is exact and does not depend on `methods` and
   * `parsed.implementations` sharing the same iteration order (get/set
   * accessor implementations interleave with method implementations in
   * `parsed.implementations` but never appear in `methods`).
   */
  const methodsByName = new Map(methods.map(method => [method.name.toLowerCase(), method]));
  const scalarDeclarationTypes = new Set([
    'string', 'date', 'any', 'boolean', 'time', 'datetime', 'object', 'integer', 'number', 'exception', 'array'
  ]);
  const builtinDeclarationTypes = new Set([
    'file', 'sql', 'record', 'rowset', 'row', 'field', 'processrequest', 'message',
    'apiobject', 'grid', 'javaobject', 'xmldoc', 'xmlnode', 'document', 'compound',
    'collection', 'map', 'mapelement', 'jsonbuilder', 'jsonobject', 'jsonarray'
  ]);
  const dependencyTypeLeaf = (typeName: string): string =>
    typeName.replace(/^(?:array\s+of\s+)+/i, '').trim().split(':').at(-1) ?? '';
  const importTargets = [...source.slice(0, parsed.unitStart).matchAll(/\bimport\s+([^;]+);/gi)]
    .map(match => match[1].trim());
  const importedClassLeaves = new Set(
    importTargets
      .map(target => target.split(':').at(-1)?.trim() ?? '')
      .filter(leaf => leaf !== '' && leaf !== '*')
      .map(leaf => leaf.toLowerCase())
  );
  const importedWildcardRoots = new Set(
    importTargets
      .filter(target => target.endsWith(':*'))
      .map(target => target.slice(0, -2).split(':')[0].toLowerCase())
  );
  const declarationTypes = [
    parsed.extendsType,
    parsed.implementsType,
    ...parsed.statements.flatMap(statement => {
      if (statement.kind === 'method') {
        return [...statement.parameters.map(parameter => parameter.type), statement.returnType];
      }
      if (statement.kind === 'property' || statement.kind === 'instance' || statement.kind === 'instance-statement') {
        return [statement.type];
      }
      return [];
    })
  ].filter((typeName): typeName is string => typeName !== undefined);
  const declarationDependencyTypes = declarationTypes.filter(typeName => {
    const normalizedType = typeName.replace(/^(?:array\s+of\s+)+/i, '').trim();
    const leaf = dependencyTypeLeaf(typeName);
    const root = normalizedType.split(':')[0].toLowerCase();
    const isRelationship = [parsed.extendsType, parsed.implementsType]
      .some(relationship => relationship?.toLowerCase() === typeName.toLowerCase());
    return leaf !== '' &&
      !scalarDeclarationTypes.has(leaf.toLowerCase()) &&
      !importedClassLeaves.has(leaf.toLowerCase()) &&
      !(isRelationship && importedWildcardRoots.has(root));
  });
  const missingDeclarationDependencies = [...new Map(
    declarationDependencyTypes.map(typeName => [dependencyTypeLeaf(typeName).toLowerCase(), typeName])
  ).values()];
  // Cycle 26/32 proves declaration discovery precedes body allocation, and
  // froze modeling to a zero/one new identity population because broader
  // sets' enumeration order was unproven. Cycle 52 population evidence
  // (6/6 multi-symbol "generated allocates fewer references" roots --
  // 28713, 28752, 28755, 29099, 29518, plus 12/12 already-EXACT multi-symbol
  // negative controls -- e.g. 28860, 28898, 29096, 29995, 30038, 30192)
  // shows `declarationDependencyTypes`'s own first-occurrence scan order
  // (extends, implements, then each statement's parameter/return/property/
  // instance types, in source declaration order) already matches stored
  // PSPCMNAME order exactly, with zero contradictions. The enumeration is
  // not compiler-internal after all -- it is the same order this array is
  // already built in.
  const hasModeledDeclarationDependencyOrder = true;
  /*
   * Cycle 32 froze the shared reference session for any `%This.method()`
   * call, reasoning that an INHERITED method's return/parameter metadata
   * (needed to resolve its own dependency identity) is not always
   * available from source alone. That reasoning does not apply when
   * `method` is declared AND implemented by THIS SAME CLASS -- its
   * signature is already fully parsed into `methods` above, no
   * environment/inheritance metadata is needed, and Cycle 34 population
   * evidence (23/43 remaining reference-identity roots, including two of
   * the three "cross-fragment PACKAGE duplicate/failed reuse" roots,
   * 29448 and 29542) shows their `%This.method()` calls are EXCLUSIVELY
   * to their own declared methods -- the prior blanket regex disabled
   * the shared session for them without cause. A genuinely external
   * (inherited/interface) `%This.method()` call -- one that does not
   * name a method this class itself declares -- still disables the
   * session, unchanged from Cycle 32.
   */
  const ownMethodNames = new Set(methods.map(method => method.name.toLowerCase()));
  const hasUnmodeledThisMethodDependencies = [
    ...source.matchAll(/%This\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi)
  ].some(match => !ownMethodNames.has(match[1].toLowerCase()));
  const hasModeledApplicationClassReferenceScope =
    hasModeledDeclarationDependencyOrder && !hasUnmodeledThisMethodDependencies;

  const firstImplementationStart = parsed.implementations[0]?.sourceIndex ?? source.length;
  /*
   * Cycle 113: an Application Class program keeps its blank-line markers
   * whether or not it has compiled references -- the Cycle 15 reference
   * gating is an ordinary-program rule. (Cycle 16's prepass answered
   * "does ANY fragment compile a reference" and dropped every marker when
   * none did.) LOCAL SNAPSHOT: treating every Application Class program
   * as reference-bearing changes exactly 34 programs, all to exact, 0
   * lost -- 29137 `Constants` (string assignments only) stores `15 4F 01`
   * between assignments separated by a blank line; 29090, 29095.
   */
  const programHasCompiledReferences = true;

  const ownerPackagePath =
    context?.owner?.packagePath !== undefined
      ? [...context.owner.packagePath]
      : [context?.owner?.recordName ?? ''].filter(value => value !== '');
  const selfPath = ownerPackagePath.length === 0
    ? [parsed.className]
    : ownerPackagePath[ownerPackagePath.length - 1].toLowerCase() === parsed.className.toLowerCase()
      ? ownerPackagePath
      : [...ownerPackagePath, parsed.className];
  const selfName = selfPath.join(':');

  // Name table, directory records and signature slots: see
  // `buildApplicationClassDirectory` (Cycle 100).
  const directoryLayout = buildApplicationClassDirectory(parsed, selfName, methods);

  // Statement section. Only the class header's own method-declaration
  // and method-implementation wrapper bytes are hand-encoded (no
  // calibrated evidence covers this syntax in the general encoder);
  // every method BODY is delegated to `encodeFragmentInternal`, reusing
  // the same general-purpose, already-calibrated PeopleCode
  // statement/expression encoder every other program type uses.
  const statementChunks: Buffer[] = [];
  const references: PeopleCodeReference[] = [];
  const htmlDependencyScope = new HtmlDependencyScope();
  const applicationClassReferenceScope = new ApplicationClassReferenceScope();
  const applicationClassProgramRows = new ApplicationClassProgramRows();
  /*
   * Cycle 108 / 109: an Application Class type as the source alone names it
   * -- a qualified path, or a short name with a named import -- and its
   * array depth. A built-in object type wins over a same-named import
   * (29585); anything else (primitive, untyped array, unresolved short
   * name) is undefined.
   */
  const namedImportPaths = new Map(importTargets
    .map(target => target.split(':').map(component => component.trim()))
    .filter(components => components.length >= 2 && components.at(-1) !== '*')
    .map(components => [components.at(-1)!.toLowerCase(), components]));
  const declaredApplicationClass = (type: string): { packagePath: string[]; className: string; depth: number } | undefined => {
    const written = type.replace(/\s+/g, ' ').trim();
    const array = /^((?:array\s+of\s+)*)(.*)$/i.exec(written)!;
    const element = array[2].trim();
    if (element === '' || /^array$/i.test(element) || isBuiltinObjectTypeName(element)) return undefined;
    const path = element.includes(':')
      ? element.split(':').map(component => component.trim())
      : namedImportPaths.get(element.toLowerCase());
    return path === undefined
      ? undefined
      : { packagePath: path.slice(0, -1), className: path.at(-1)!, depth: (array[1].match(/array/gi) ?? []).length };
  };
  // See `EncodeFragmentContext.applicationClassOwnPropertyTypes` / `.applicationClassDeclaredVariables`.
  const applicationClassOwnPropertyTypes = new Map<string, { packagePath: string[]; className: string; depth: number }>();
  const programDeclaredVariables = new Map<string, { packagePath: string[]; className: string; depth: number }>();
  const declaredBuiltinVariables = new Map<string, string>();
  const declareOwnPropertyType = (name: string, type: string): void => {
    const declared = declaredApplicationClass(type);
    // Cycle 120: a built-in object type (`instance Record &m_rcXLATITEM;`)
    if (declared === undefined && isBuiltinObjectTypeName(type.trim())) declaredBuiltinVariables.set(`&${name.replace(/^&/, '').toLowerCase()}`, type.trim());
    if (declared === undefined) return;
    applicationClassOwnPropertyTypes.set(name.replace(/^&/, '').toLowerCase(), declared);
    programDeclaredVariables.set(`&${name.replace(/^&/, '').toLowerCase()}`, declared);
  };
  for (const member of parsed.members) {
    if (member.kind === 'property' || member.kind === 'instance') declareOwnPropertyType(member.name, member.type);
  }
  for (const statement of parsed.statements) {
    if (statement.kind === 'instance-statement') {
      for (const name of statement.names) declareOwnPropertyType(name, statement.type);
    }
  }
  const declarationSection = source
    .slice(parsed.unitEnd, parsed.implementations[0]?.sourceIndex ?? source.length)
    .replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
  for (const match of declarationSection.matchAll(/\b(?:Component|Global)\s+((?:array\s+of\s+)*[%A-Za-z_][\w:]*)\s+(&\w+(?:\s*,\s*&\w+)*)/gi)) {
    const declared = declaredApplicationClass(match[1]);
    if (declared !== undefined) {
      for (const name of match[2].split(',')) programDeclaredVariables.set(name.trim().toLowerCase(), declared);
    } else if (isBuiltinObjectTypeName(match[1].trim())) {
      // Cycle 120: `Global Record &GBL_rec_share;` (29617)
      for (const name of match[2].split(',')) declaredBuiltinVariables.set(name.trim().toLowerCase(), match[1].trim());
    }
  }
  const bodyDeclaredVariables = (methodParameters?: { name: string; type: string }[]) => {
    const variables = new Map(programDeclaredVariables);
    for (const parameter of methodParameters ?? []) {
      const name = `&${parameter.name.replace(/^&/, '').toLowerCase()}`;
      const declared = declaredApplicationClass(parameter.type);
      if (declared !== undefined) variables.set(name, declared); else variables.delete(name);
    }
    return variables;
  };
  const selfPackagePath = selfPath.slice(0, -1);
  const ownStorageNames = new Set(parsed.members
    .filter(member => member.kind === 'property' || member.kind === 'instance')
    .map(member => (member as { name: string }).name.replace(/^&/, '').toLowerCase()));
  let selfMethodDependencyClaimed = false;
  const applicationClassSelfMethodDependency: ApplicationClassSelfMethodDependency = {
    // Own AND inherited methods: `%This`'s static class is always this
    // class. Own storage members are excluded because `%This.<prop>(n)`
    // indexes a property rather than calling a method.
    isSelfMethodCall: memberName => !ownStorageNames.has(memberName.toLowerCase()),
    // The row is a class-level identity: no method name, so it shares the
    // TYPE-identity key later own-class type references look up.
    claim: () => {
      if (selfMethodDependencyClaimed) return undefined;
      selfMethodDependencyClaimed = true;
      return {
        kind: 'package',
        packageName: parsed.className.toUpperCase(),
        objectName: selfPackagePath[0]?.toUpperCase(),
        packagePath: selfPackagePath.map((component, index) => index === 0 ? component.toUpperCase() : component),
        className: parsed.className.toUpperCase()
      };
    }
  };
  let nextReferenceIndex = 0;
  let nextCommentOpcodeIndex = 0;
  let firstFragment = true;

  const encodeFragment = (
    fragmentSource: string,
    commentOpcodes = context?.commentOpcodes,
    suppressDeclarationSectionMarkers = true,
    methodParameters?: { name: string; type: string }[],
    sourceStart?: number,
    declaredVariables?: ReadonlyMap<string, { packagePath: readonly string[]; className: string; depth: number }>
  ): Buffer => {
    /*
     * Cycle 81: this closure encodes several independent fragments in
     * sequence (the leading import/prefix leftover, then one per method
     * body). `context.commentOpcodes` is the WHOLE program's comment-
     * opcode provenance list, built once from every 0x24/0x4E token in
     * decoder order (validator.ts's own roundtrip test). Each fragment's
     * own `encodeFragmentInternal` call starts its local comment index at
     * 0, so every fragment after the first was reading the SAME leading
     * entries meant for an EARLIER fragment's comments -- 15 Application
     * Class definitions (e.g. AltAcctCFFullSync.OnNotify, definition
     * 28816) proved this: re-encoding decoded text WITHOUT the (correct,
     * validator-supplied) commentOpcodes array produced byte-exact
     * output via the encoder's own positional fallback, while WITH it
     * produced the wrong bytes, because the array was misaligned per
     * fragment. Slicing from a shared, running index (exactly the same
     * pattern `nextReferenceIndex` already uses for cross-fragment
     * reference numbering below) fixes the alignment. Reference equality
     * against the default distinguishes this shared-array case from the
     * unrelated prefix-leftover call below, which passes its OWN,
     * independently-scoped array from `scanApplicationClassLayoutComments`
     * and must not participate in this shared counter.
     */
    const usesSharedCommentOpcodes = commentOpcodes === context?.commentOpcodes;
    if (usesSharedCommentOpcodes) {
      commentOpcodes = context?.commentOpcodes?.slice(nextCommentOpcodeIndex);
    }
    const applicationClassReferenceSession = hasModeledApplicationClassReferenceScope
      ? applicationClassReferenceScope.beginFragment()
      : undefined;
    // Cycle 57: unlike the gated session above, this is ALWAYS present --
    // see `EncodeFragmentContext.applicationClassTypeReferenceSession`'s
    // own declaration comment for the population evidence and the
    // provenance distinction from `applicationClassReferenceSession`.
    const applicationClassTypeReferenceSession = applicationClassReferenceScope.beginFragment();
    const encoded = encodeFragmentInternal(fragmentSource, {
      ...context,
      // Cycle 115: directive regions are keyed by program offset.
      conditionalDirectiveBase: sourceStart,
      commentOpcodes,
      owner: undefined,
      referenceIndexOffset: nextReferenceIndex,
      suppressOwnerReference: !firstFragment,
      suppressDeclarationSectionMarkers,
      compilationUnitHasCompiledReferences: programHasCompiledReferences,
      htmlDependencyScope,
      htmlDependencyLifetime: 'application-class',
      applicationClassReferenceSession,
      applicationClassTypeReferenceSession,
      applicationClassProgramRows,
      applicationClassSelfPath: selfPath,
      applicationClassOwnPropertyTypes,
      applicationClassDeclaredVariables: declaredVariables,
      applicationClassDeclaredBuiltinVariables: declaredBuiltinVariables,
      applicationClassSelfMethodDependency,
      // Inherited `%This` calls can allocate environment-derived method
      // rows. Freeze that unsupported population on its prior fragment-owner
      // behavior; modeled units keep the mandatory owner row blank.
      bindOwnerReference: hasUnmodeledThisMethodDependencies,
      // Cycle 36: every fragment this closure encodes is either the
      // leading import fragment (no Local declarations) or a method
      // body -- safe to apply uniformly.
      builtinObjectDeclarationsHaveMethodWideLifetime: true,
      recordDependenciesHaveMethodWideLifetime: true,
      // Cycle 46: absent (undefined) for the leading-import fragment and
      // for get/set accessor bodies; only a `kind: 'method'` implementation
      // body's own call site below passes its method's parameter list.
      methodParameters,
      // Cycle 108: trace offsets relative to the whole program, not the fragment.
      referenceTrace: context?.referenceTrace === undefined || sourceStart === undefined
        ? context?.referenceTrace
        : event => context.referenceTrace!({ ...event, sourceOffset: event.sourceOffset + sourceStart })
    });
    applicationClassReferenceScope.commit(encoded.references);
    applicationClassProgramRows.commit(encoded.references);
    firstFragment = false;
    nextReferenceIndex += encoded.references.length;
    if (usesSharedCommentOpcodes) {
      nextCommentOpcodeIndex += encoded.commentOpcodesConsumed;
    }
    references.push(...encoded.references);
    return encoded.bytes;
  };

  const emitMarkers = (count: number): void => {
    for (let marker = 0; marker < count; marker++) {
      statementChunks.push(Buffer.from([0x4f]));
    }
  };

  const allocateModeledDeclarationDependency = (): void => {
    /*
     * Cycle 60: this guard previously used `hasModeledApplicationClassReferenceScope`
     * (`hasModeledDeclarationDependencyOrder && !hasUnmodeledThisMethodDependencies`),
     * which disabled declaration-dependency TYPE discovery entirely for any
     * class with an inherited (not-own-declared) `%This.method()` call --
     * even though that discovery has nothing to do with the method-
     * dependency-resolution uncertainty Cycle 32/34 established the
     * `%This` gate for (this function allocates PACKAGE rows for
     * parameter/return/property/instance TYPES via the already-
     * unconditional `applicationClassReferenceScope` facade, never a
     * method-dependency reference). A corpus-wide census of 82 Application
     * Class definitions with an inherited `%This` call AND at least one
     * undiscovered declaration-dependency type found stored PSPCMNAME
     * allocates an early PACKAGE row for every single one (82/82, zero
     * contradictions) -- the type was simply being discovered late
     * instead (via a body-level Local declaration of the same leaf, if
     * one happened to exist) rather than never. Use
     * `hasModeledDeclarationDependencyOrder` (unconditionally true since
     * Cycle 52) instead, leaving `hasModeledApplicationClassReferenceScope`'s
     * own effect on `applicationClassReferenceSession`/`bindOwnerReference`
     * (genuine method-dependency reuse for inherited calls) completely
     * unchanged.
     */
    if (!hasModeledDeclarationDependencyOrder || missingDeclarationDependencies.length === 0) return;
    if (firstFragment) {
      references.push({
        index: 0,
        sequence: 1,
        kind: 'owner',
        recordName: undefined,
        fieldName: undefined
      });
      nextReferenceIndex = 1;
      firstFragment = false;
    }
    // Cycle 52: stored PSPCMNAME allocates ONE row per distinct declaration-
    // dependency type, in the SAME first-occurrence order this array is
    // already built in (see `hasModeledDeclarationDependencyOrder`'s own
    // comment for the population evidence) -- not just the first one.
    for (const typeName of missingDeclarationDependencies) {
      const normalizedType = typeName.replace(/^(?:array\s+of\s+)+/i, '').trim();
      const components = normalizedType.split(':');
      const leaf = components.at(-1)!;
      const packagePath = components.slice(0, -1);
      const candidate: Omit<PeopleCodeReference, 'index' | 'sequence'> =
        builtinDeclarationTypes.has(leaf.toLowerCase())
          ? {
            kind: 'package',
            packageName: leaf.toUpperCase(),
            objectName: leaf
          }
          : packagePath.length > 0
            ? {
              kind: 'package',
              packageName: leaf.toUpperCase(),
              objectName: packagePath[0].toUpperCase(),
              packagePath: packagePath.map((component, index) =>
                index === 0 ? component.toUpperCase() : component
              ),
              className: leaf.toUpperCase()
            }
            : {
              kind: 'package',
              packageName: leaf.toUpperCase(),
              className: leaf.toUpperCase()
            };
      const existing = applicationClassReferenceScope.beginFragment().lookup(candidate);
      if (existing !== undefined) continue;
      const reference: PeopleCodeReference = {
        ...candidate,
        index: nextReferenceIndex,
        sequence: nextReferenceIndex + 1
      };
      references.push(reference);
      nextReferenceIndex++;
      applicationClassReferenceScope.commit([reference]);
      applicationClassProgramRows.commit([reference]);
      context?.referenceTrace?.({
        action: 'ALLOC',
        sourceOffset: parsed.unitStart,
        controlGroup: 0,
        controlDepth: 0,
        functionDepth: 0,
        reference
      });
    }
  };
  const emittedDeclarationTerminatorOffsets = new Set<number>();

  const emitLayoutRange = (
    start: number,
    end: number,
    flushTrailingGap: boolean,
    includeDeclarationTerminators = false
  ): void => {
    const terminators = includeDeclarationTerminators
      ? parsed.declarationTerminatorOffsets.filter(offset =>
        offset >= start && offset < end && !emittedDeclarationTerminatorOffsets.has(offset))
      : [];
    let terminatorIndex = 0;
    let cursor = start;
    for (const comment of scanApplicationClassLayoutComments(source, start, end)) {
      emitConditionalRegionsIn(cursor, comment.start);
      emitMarkers(applicationClassBlankLineCount(source.slice(cursor, comment.start)));
      while (terminators[terminatorIndex] < comment.start) {
        emittedDeclarationTerminatorOffsets.add(terminators[terminatorIndex]);
        statementChunks.push(Buffer.from([0x15]));
        terminatorIndex++;
      }
      statementChunks.push(applicationClassLayoutCommentOperand(comment));
      cursor = comment.end;
      // Cycle 81: a 0x24/0x4E comment here is a real token in decoder
      // order, so it still occupies a slot in validator.ts's whole-
      // program commentOpcodes array even though it never goes through
      // consumeCommentOpcode() -- keep the shared counter in sync with it
      // (see encodeFragment's own comment for the full explanation).
      // 0x55 (<* *> disabled code) is a different comment family, never
      // counted into that array, and must not advance this counter.
      if (comment.opcode === 0x24 || comment.opcode === 0x4e) {
        nextCommentOpcodeIndex++;
      }
    }
    while (terminatorIndex < terminators.length) {
      emittedDeclarationTerminatorOffsets.add(terminators[terminatorIndex]);
      statementChunks.push(Buffer.from([0x15]));
      terminatorIndex++;
    }
    emitConditionalRegionsIn(cursor, end);
    if (flushTrailingGap) {
      emitMarkers(applicationClassBlankLineCount(source.slice(cursor, end)));
    }
  };

  /*
   * Cycle 113: block comments on the same source line as a closer's `;`
   * (`end-method; /* Name *\/`, `end-class; /* Name *\/`) precede the
   * closer's 0x2D boundary -- stored never writes a 0x2D before an inline
   * comment (28726, 28736). Emits them and returns the offset after them.
   */
  const emitClosingLineComments = (from: number): number => {
    const trailingComment = /^[ \t]*\/\*/;
    let cursor = from;
    for (let match = trailingComment.exec(source.slice(cursor)); match !== null; match = trailingComment.exec(source.slice(cursor))) {
      const start = cursor + match[0].length - 2;
      const close = source.indexOf('*/', start + 2);
      if (close < 0) break;
      statementChunks.push(applicationClassLayoutCommentOperand({ start, end: close + 2, opcode: 0x4e, raw: source.slice(start, close + 2) }));
      nextCommentOpcodeIndex++;
      cursor = close + 2;
    }
    return cursor;
  };

  const emitDeclarationTerminators = (start: number, end: number): void => {
    for (const offset of parsed.declarationTerminatorOffsets) {
      if (offset >= start && offset < end && !emittedDeclarationTerminatorOffsets.has(offset)) {
        emittedDeclarationTerminatorOffsets.add(offset);
        statementChunks.push(Buffer.from([0x15]));
      }
    }
  };

  /*
   * Cycle 115: conditional-compilation directive regions (masked as
   * whitespace; see `conditionalCompilation.ts`) in a gap the wrapper owns
   * -- a method body's leading / trailing whitespace, a layout range, the
   * import prefix -- write their records where the gap starts, before the
   * gap's own markers, exactly as the fragment encoder's whitespace
   * skipping does inside a body.
   */
  const emitConditionalRegionsIn = (start: number, end: number): void => {
    const regions = context?.conditionalDirectiveRegions;
    if (regions === undefined) return;
    for (const region of [...regions.values()].sort((a, b) => a.start - b.start)) {
      if (region.start < start || region.start >= end) continue;
      if (context?.conditionalDirectiveEmissions?.has(region.start)) continue;
      context?.conditionalDirectiveEmissions?.add(region.start);
      statementChunks.push(region.records);
    }
  };

  const emitSharedFragmentRange = (
    start: number,
    end: number,
    flushTrailingGap: boolean
  ): void => {
    const value = source.slice(start, end);
    if (value.trim() === '') {
      emitConditionalRegionsIn(start, end);
      if (flushTrailingGap) emitMarkers(applicationClassBlankLineCount(value));
      return;
    }
    const leadingWhitespace = /^\s*/.exec(value)?.[0] ?? '';
    const trailingWhitespace = /\s*$/.exec(value)?.[0] ?? '';
    const core = value.slice(
      leadingWhitespace.length,
      value.length - trailingWhitespace.length
    );
    const firstChunk = statementChunks.length;
    emitConditionalRegionsIn(start, start + leadingWhitespace.length);
    emitMarkers(applicationClassBlankLineCount(leadingWhitespace));
    if (core.trim() !== '') {
      const commentOpcodes = scanApplicationClassLayoutComments(
        source,
        start + leadingWhitespace.length,
        end - trailingWhitespace.length
      ).flatMap(comment => comment.opcode === 0x24 || comment.opcode === 0x4e ? [comment.opcode] : []);
      try {
        statementChunks.push(encodeFragment(core, commentOpcodes, false, undefined, start + leadingWhitespace.length));
        // Cycle 81: this range's own comments were consumed here, via a
        // locally-scoped array sized just for this range (an explicit
        // override, not the shared default) -- but they still occupy
        // their own slots in the whole-program array, so the shared
        // counter must skip past them for whatever fragment comes next.
        // Only on this success path: the catch below re-emits the same
        // comments through emitLayoutRange, which advances the counter
        // itself.
        nextCommentOpcodeIndex += commentOpcodes.length;
      } catch (error) {
        if (!(error instanceof UnsupportedPeopleCodeError)) throw error;
        // Native/preprocessor declarations remain outside Cycle 25. Preserve
        // the prior encodable path while still retaining evidenced comments.
        statementChunks.length = firstChunk;
        emitLayoutRange(start, end, flushTrailingGap);
        return;
      }
    }
    emitConditionalRegionsIn(end - trailingWhitespace.length, end);
    if (flushTrailingGap) {
      emitMarkers(applicationClassBlankLineCount(trailingWhitespace));
    }
  };

  const emitCompilationUnitPrefix = (): void => {
    const end = parsed.unitStart;
    const prefix = source.slice(0, end);
    type PrefixEvent =
      | { kind: 'import'; start: number; end: number; raw: string }
      | { kind: 'directive'; start: number; end: number; records: Buffer }
      | ({ kind: 'comment' } & ApplicationClassLayoutComment);
    const comments = scanApplicationClassLayoutComments(source, 0, end);
    const events: PrefixEvent[] = [
      ...[...prefix.matchAll(/\bimport\s+[%A-Za-z_][%A-Za-z0-9_]*(?::[%A-Za-z_][%A-Za-z0-9_]*)*(?::\*)?\s*;/gi)].map(match => ({
        kind: 'import' as const,
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        raw: match[0]
      })).filter(event => !comments.some(comment => event.start >= comment.start && event.start < comment.end)),
      ...comments.map(comment => ({
        kind: 'comment' as const,
        ...comment
      })),
      // Cycle 115: directive regions (whitespace in the preprocessed source)
      ...[...(context?.conditionalDirectiveRegions?.values() ?? [])]
        .filter(region => region.start < end)
        .map(region => ({ kind: 'directive' as const, start: region.start, end: region.end, records: region.records }))
    ].sort((left, right) => left.start - right.start);

    let cursor = 0;
    const grammarCovered = !/(^|\n)\s*#/m.test(prefix) && events.every(event => {
      const covered = /^\s*$/.test(prefix.slice(cursor, event.start));
      cursor = Math.max(cursor, event.end);
      return covered;
    }) && /^\s*$/.test(prefix.slice(cursor));
    if (!grammarCovered) {
      const leadingImports = /^\s*(?:import\s+[%A-Za-z_][%A-Za-z0-9_]*(?::[%A-Za-z_][%A-Za-z0-9_]*)*(?::\*)?\s*;\s*)*/i.exec(source)?.[0] ?? '';
      if (leadingImports.trim() !== '') {
        const bytes = encodeFragment(leadingImports, undefined, true, undefined, 0);
        statementChunks.push(bytes);
        if (bytes[bytes.length - 1] !== 0x4f) statementChunks.push(Buffer.from([0x4f]));
      }
      return;
    }

    /*
     * Cycle 81: prefix comments are encoded directly via
     * applicationClassLayoutCommentOperand() below, never through
     * consumeCommentOpcode() -- but they are still ordinary comment
     * tokens in decoder order, so validator.ts's whole-program
     * commentOpcodes array still counts them. Skip past them in the
     * shared counter here so the first method body's own encodeFragment
     * call starts reading from its own true position instead of
     * re-consuming entries meant for these prefix comments.
     */
    nextCommentOpcodeIndex += comments.filter(c => c.opcode === 0x24 || c.opcode === 0x4e).length;

    cursor = 0;
    let importSectionOpen = false;
    const emitGap = (gap: string, nextKind?: PrefixEvent['kind']): void => {
      const markerCount = applicationClassBlankLineCount(gap);
      if (markerCount > 0 && importSectionOpen && nextKind !== 'import') {
        statementChunks.push(Buffer.from([0x2d]));
        importSectionOpen = false;
      }
      emitMarkers(markerCount);
    };
    for (const [eventIndex, event] of events.entries()) {
      if (event.kind === 'directive') {
        // records at once; the gap before the next event spans the region
        if (!context?.conditionalDirectiveEmissions?.has(event.start)) {
          context?.conditionalDirectiveEmissions?.add(event.start);
          statementChunks.push(event.records);
        }
        continue;
      }
      let nextSectionEventKind = event.kind;
      if (event.kind === 'comment') {
        let lookahead = eventIndex + 1;
        while (events[lookahead]?.kind === 'comment' || events[lookahead]?.kind === 'directive') lookahead++;
        if (events[lookahead]?.kind === 'import') nextSectionEventKind = 'import';
      }
      emitGap(prefix.slice(cursor, event.start), nextSectionEventKind);
      if (event.kind === 'comment') {
        statementChunks.push(applicationClassLayoutCommentOperand(event));
      } else {
        const bytes = encodeFragment(event.raw, undefined, false, undefined, event.start);
        statementChunks.push(bytes[bytes.length - 1] === 0x2d ? bytes.subarray(0, bytes.length - 1) : bytes);
        importSectionOpen = true;
      }
      cursor = event.end;
    }
    emitGap(prefix.slice(cursor));
    if (importSectionOpen) statementChunks.push(Buffer.from([0x2d]));
  };

  /*
   * A method body's final statement may omit `;`, while the shared fragment
   * parser requires one. Cycle 28 distinguishes that parser-only completion
   * from a real final source semicolon after masking trailing comments. The
   * synthetic final 0x4F remains stripped as before; when completion was
   * necessary, its synthetic 0x15 is stripped too. Source-owned 0x15 bytes
   * and the wrapper's own closer suffix remain untouched.
   */
  const encodeMethodBody = (
    body: string,
    methodParameters?: { name: string; type: string }[],
    sourceStart?: number
  ): Buffer => {
    const hasSourceTerminator = applicationClassHasTrailingSourceTerminator(body);
    const completed = hasSourceTerminator ? body : `${body};`;
    const bytes = encodeFragment(completed, undefined, true, methodParameters, sourceStart, bodyDeclaredVariables(methodParameters));
    let end = bytes.length;
    if (end > 0 && bytes[end - 1] === 0x4f) end--;
    if (!hasSourceTerminator && end > 0 && bytes[end - 1] === 0x15) end--;
    return bytes.subarray(0, end);
  };

  emitCompilationUnitPrefix();
  allocateModeledDeclarationDependency();

  // CLASS|INTERFACE NAME [EXTENDS path] [IMPLEMENTS path]
  statementChunks.push(Buffer.from([parsed.unitKind === 'class' ? 0x5a : 0x70]));
  statementChunks.push(encodeInlineName(parsed.className));
  if (parsed.extendsType !== undefined) {
    statementChunks.push(Buffer.from([0x5c]));
    statementChunks.push(encodeApplicationClassPathBytes(parsed.extendsType.split(':')));
  }
  if (parsed.implementsType !== undefined) {
    statementChunks.push(Buffer.from([0x72]));
    statementChunks.push(encodeApplicationClassPathBytes(parsed.implementsType.split(':')));
  }
  emitDeclarationTerminators(parsed.unitStart, parsed.unitHeaderEnd);

  // Cycle 22: one executable stream in exact source declaration order.
  // Cycle 25: declaration layout is a separate compilation-unit layer. It
  // interleaves comments and source-counted gaps without changing the member
  // opcodes or their metadata order.
  let declarationCursor = parsed.unitHeaderEnd;
  for (const statement of parsed.statements) {
    emitLayoutRange(declarationCursor, statement.sourceIndex, true, true);
    declarationCursor = statement.sourceEnd;
    if (statement.kind === 'visibility') {
      if (statement.visibility !== 'public') {
        statementChunks.push(Buffer.from([statement.visibility === 'private' ? 0x61 : 0x73]));
      }
      continue;
    }
    if (statement.kind === 'method') {
      statementChunks.push(Buffer.from([0x63]));
      statementChunks.push(encodeInlineName(statement.name));
      statementChunks.push(Buffer.from([0x0b]));
      statement.parameters.forEach((parameter, index) => {
        if (index > 0) statementChunks.push(Buffer.from([0x03]));
        statementChunks.push(encodeVariableName(parameter.name));
        statementChunks.push(Buffer.from([0x35]));
        statementChunks.push(encodeApplicationClassTypeBytes(parameter.type));
        if (parameter.out) statementChunks.push(Buffer.from([0x5d]));
      });
      if (statement.trailingParameterComma) statementChunks.push(Buffer.from([0x03]));
      statementChunks.push(Buffer.from([0x14]));
      if (statement.returnType !== undefined) {
        statementChunks.push(Buffer.from([0x39]));
        statementChunks.push(encodeApplicationClassTypeBytes(statement.returnType));
      }
      if (statement.abstract) statementChunks.push(Buffer.from([0x6f]));
      emitDeclarationTerminators(statement.sourceIndex, statement.sourceEnd);
      continue;
    }
    if (statement.kind === 'property') {
      statementChunks.push(Buffer.from([0x5e]));
      statementChunks.push(encodeApplicationClassTypeBytes(statement.type));
      statementChunks.push(encodeInlineName(statement.name));
      for (const modifier of statement.modifiers) {
        statementChunks.push(Buffer.from([modifier === 'readonly' ? 0x60 : modifier === 'get' ? 0x5f : 0x49]));
      }
      emitDeclarationTerminators(statement.sourceIndex, statement.sourceEnd);
      continue;
    }
    if (statement.kind === 'instance-statement') {
      statementChunks.push(Buffer.from([0x62]));
      statementChunks.push(encodeApplicationClassTypeBytes(statement.type));
      statement.names.forEach((name, index) => {
        if (index > 0) statementChunks.push(Buffer.from([0x03]));
        statementChunks.push(encodeVariableName(name));
      });
      emitDeclarationTerminators(statement.sourceIndex, statement.sourceEnd);
      continue;
    }
    // Flattened instance members are metadata-only; their grouped executable
    // form is the `instance-statement` node handled above.
    if (statement.kind === 'instance') continue;
    if (statement.kind === 'constant') {
      statementChunks.push(Buffer.from([0x56]));
      statementChunks.push(encodeVariableName(statement.name));
      statementChunks.push(Buffer.from([0x06]));
      statementChunks.push(encodeApplicationClassLiteral(statement.value));
      emitDeclarationTerminators(statement.sourceIndex, statement.sourceEnd);
    }
  }
  emitLayoutRange(declarationCursor, parsed.unitCloseStart, true, true);

  // END-CLASS|END-INTERFACE ; and its declaration-boundary 0x2d. Layout
  // between the unit and the first wrapper belongs to the compilation unit;
  // it may contain comments even when there is no implementation.
  statementChunks.push(Buffer.from([parsed.unitKind === 'class' ? 0x5b : 0x71, 0x15]));
  const afterUnitClose = emitClosingLineComments(parsed.unitEnd);
  statementChunks.push(Buffer.from([0x2d]));
  emitSharedFragmentRange(
    afterUnitClose,
    firstImplementationStart,
    parsed.implementations.length > 0
  );

  // Concrete method/getter/setter implementations remain in source order.
  for (const [memberIndex, member] of parsed.implementations.entries()) {
    const implementationOpcode = member.kind === 'method' ? 0x63 : member.kind === 'get' ? 0x5f : 0x49;
    statementChunks.push(Buffer.from([implementationOpcode, 0x41]));
    statementChunks.push(encodeInlineName(member.name));
    statementChunks.push(Buffer.from([0x2d]));
    for (const comment of member.signatureComments) {
      statementChunks.push(textOperand(0x6d, TokenKind.Comment, comment));
    }
    // Body-edge gaps are owned by the wrapper, while statements and comments
    // inside the body remain owned by the shared fragment encoder. Splitting
    // only the leading/trailing whitespace keeps those layers independent.
    if (member.body.trim() === '') {
      emitConditionalRegionsIn(member.sourceIndex, member.sourceEnd);
      emitMarkers(applicationClassBlankLineCount(member.body));
    } else {
      const leadingWhitespace = /^\s*/.exec(member.body)?.[0] ?? '';
      const trailingWhitespace = /\s*$/.exec(member.body)?.[0] ?? '';
      const bodyCore = member.body.slice(
        leadingWhitespace.length,
        member.body.length - trailingWhitespace.length
      );
      const coreStart = source.indexOf(bodyCore, member.sourceIndex);
      emitConditionalRegionsIn(member.sourceIndex, coreStart < 0 ? member.sourceIndex : coreStart);
      emitMarkers(applicationClassBlankLineCount(leadingWhitespace));
      // Cycle 46: only a `kind: 'method'` implementation has a matching
      // class-header `ApplicationClassMethodMember` with `.parameters` --
      // get/set accessor bodies pass `undefined` (no evidenced population).
      const methodParameters =
        member.kind === 'method'
          ? methodsByName.get(member.name.toLowerCase())?.parameters
          : undefined;
      const bodyStart = source.indexOf(bodyCore, member.sourceIndex);
      statementChunks.push(encodeMethodBody(bodyCore, methodParameters, bodyStart < 0 ? undefined : bodyStart));
      if (bodyStart >= 0) emitConditionalRegionsIn(bodyStart + bodyCore.length, member.sourceEnd);
      emitMarkers(applicationClassBlankLineCount(trailingWhitespace));
    }
    const closerOpcode = member.kind === 'method' ? 0x64 : member.kind === 'get' ? 0x6a : 0x6b;
    if (!member.closerTerminated) {
      /*
       * Cycle 114: an unterminated last closer is written as the bare
       * opcode -- no 0x15, no 0x2D. LOCAL SNAPSHOT: all 13 such programs
       * end `64 07` (29494 `end-method` + EOF), against `64 15 2D 07` in
       * the 1,414 terminated ones.
       */
      statementChunks.push(Buffer.from([closerOpcode]));
      continue;
    }
    statementChunks.push(Buffer.from([closerOpcode, 0x15]));
    const afterCloser = emitClosingLineComments(member.sourceEnd);
    statementChunks.push(Buffer.from([0x2d]));
    const nextImplementation = parsed.implementations[memberIndex + 1];
    emitLayoutRange(
      afterCloser,
      nextImplementation?.sourceIndex ?? source.length,
      nextImplementation !== undefined
    );
  }

  const statements = Buffer.concat(statementChunks);
  const nameBytes = Buffer.concat(directoryLayout.names.map(encodeApplicationClassNameEntry));
  const directory = Buffer.concat(directoryLayout.records);
  const slots = Buffer.concat(directoryLayout.slots);
  const trailer = Buffer.concat([nameBytes, directory, slots]);

  const header = Buffer.alloc(37);
  header[0] = 0xa0;
  header.writeUInt32LE(statements.length + 1, 5);
  header.writeUInt32LE(nameBytes.length, 13);
  header.writeUInt32LE(slots.length / 4, 21);
  header.writeUInt32LE(directoryLayout.records.length, 29);
  header.writeUInt32LE(0x85, 33);

  const program = Buffer.concat([
    header,
    statements,
    Buffer.from([PROGRAM_DIRECTORY_SEPARATOR]),
    trailer
  ]);

  return { program, references };
}

/*
 * Replaces block comments and double-quoted string literals with spaces,
 * preserving every other character's exact position, so a regex scan for
 * top-level `Function NAME` headers never matches text that only looks
 * like one inside a comment or a SQL string.
 *
 * AE_WRK.MESSAGE_NBR.FieldChange (definition 908) proves this is a real
 * gap, not a hypothetical one: an entire `Function Check_Integrity ...
 * End-Function;` definition sits inside a `/* ... *\/` block comment,
 * ahead of the two real Functions (`load_stmt`, `Check_Syntax`). The
 * unmasked scan picked up "Check_Integrity" as a genuine third function,
 * inflating the stored function-directory count from 2 to 3 and adding a
 * spurious metadata/trailer entry.
 */
function maskCommentsAndStringLiteralsForFunctionScan(
  source: string
): string {
  let masked = '';
  let i = 0;

  while (i < source.length) {
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      masked += ' '.repeat(stop - i);
      i = stop;
    } else if (source.startsWith('<*', i)) {
      /*
       * Cycle 113: disabled code (`<* ... *>`, ending at the first `*>`,
       * as `disabledCodeComment()` reads it) is not compiled, so a
       * Function header inside it is not a function. 15641 / 11118 /
       * 15626: a `Function` inside `<* ... *>` has no directory entry.
       */
      const end = source.indexOf('*>', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      masked += ' '.repeat(stop - i);
      i = stop;
    } else if (source[i] === '"') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '"') {
          if (source[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      masked += ' '.repeat(j - i);
      i = j;
    } else {
      masked += source[i];
      i++;
    }
  }

  return masked;
}

function parseFunctionMetadata(
  source: string
): FunctionMetadata[] {
  const metadata: FunctionMetadata[] = [];

  /*
   * Function definitions are top-level source items in the calibrated
   * ordinary PeopleCode fixtures. Match only line-start Function headers so
   * Declare Function statements are not included.
   *
   * Matched against the comment/string-masked source (same length, so
   * every offset below still indexes correctly into the real `source`)
   * -- see `maskCommentsAndStringLiteralsForFunctionScan`'s own comment.
   */
  const maskedSource =
    maskCommentsAndStringLiteralsForFunctionScan(source);
  const functionPattern =
    /(?:^|\r?\n)[ \t]*Function\s+([A-Za-z_][A-Za-z0-9_]*)([ \t]*\()?/gi;

  let functionMatch: RegExpExecArray | null;

  while ((functionMatch = functionPattern.exec(maskedSource)) !== null) {
    const name = functionMatch[1];
    const parameterStart = functionPattern.lastIndex;
    const hasParameterList = functionMatch[2] !== undefined;

    const closeParen = hasParameterList
      ? source.indexOf(')', parameterStart)
      : parameterStart;
    if (hasParameterList && closeParen < 0) {
      throw new Error(
        `Unterminated Function parameter list for ${name}`
      );
    }

    const parameterSource =
      source.slice(parameterStart, closeParen).trim();

    const parameterTypes: string[] = [];

    if (parameterSource.length > 0) {
      for (const parameter of parameterSource.split(',')) {
        const typedMatch =
          /^\s*&[A-Za-z0-9_]+#?\s+As\s+((?:array\s+of\s+)*[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)*)\s*$/i.exec(
            parameter
          );

        if (typedMatch) {
          parameterTypes.push(typedMatch[1]);
          continue;
        }

        const untypedMatch =
          /^\s*&[A-Za-z0-9_]+#?\s*$/.exec(parameter);

        if (untypedMatch) {
          /*
           * Untyped Function parameters compile with signature type id 4.
           *
           * ACCOMPLISHMENTS.MAJOR_CODE.SaveEdit:
           *
           *   Function major_code_ckeck(&EMPLID, &COMPANY);
           *
           * stores two parameter descriptors:
           *
           *   0xC0000004
           *   0xC0000004
           *
           * Use the primitive type whose calibrated id is 4.
           */
          parameterTypes.push('__untyped_parameter__');
          continue;
        }

        throw new Error(
          `Unsupported Function parameter: ${parameter.trim()}`
        );
      }
    }

    const afterParameters = source.slice(closeParen + (hasParameterList ? 1 : 0));
    const returnMatch =
      /^[ \t]*Returns\s+((?:array\s+of\s+)*[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)*)/i.exec(
        afterParameters
      );

    metadata.push({
      name,
      parameterTypes,
      returnType: returnMatch?.[1],
      hasParameterList
    });

    /*
     * Resume scanning after this header's close paren. The global regexp will
     * find the next line-start Function definition.
     */
    functionPattern.lastIndex = closeParen + 1;
  }

  return metadata;
}

/**
 * Complete PSPCMPROG bytes for the encodeFragment subset, using the observed
 * 0xa0/0x85 format and empty metadata sections. No PSPCMNAME references are
 * generated. Producing bytes is not a database write or a PeopleTools runtime
 * validation; provider saves remain disabled.
 */
/*
 * Cycle 93: encode an ordinary program's statements, respecting the
 * boundary between class identities the source supplies and class
 * identities only external metadata supplies.
 *
 * The allocation-unit model (`useApplicationClassRow`) places a program's
 * Application Class PACKAGE rows from what the source declares: imports,
 * declarations, creates and calls on declared instances. A method call
 * through a property or a method result
 * (`&joIterator.POPULATION_MANAGER.setAllEligible(...)`) is
 * different: stored may hold a PACKAGE row for the class of that property
 * (13525 NAMENUM 6, PACKAGE.POPULATIONMANAGER / SETALLELIGIBLE), a class
 * named nowhere in the program -- it is declared by the property in the
 * receiver's own class definition. Whether a row is allocated at all
 * depends on that declared type too (a builtin-typed property allocates
 * none), so neither the row nor its absence can be modeled here.
 *
 * LOCAL SNAPSHOT: 49 ordinary definitions store a PACKAGE row whose class
 * name is absent from their source; 45 of the 46 encodable ones contain
 * such a call. 100 ordinary definitions contain one.
 *
 * Cycle 93 encoded those programs with the whole pre-allocation-unit
 * model. Cycle 112 measured it against the normal encoding, program by
 * program (`cycle112-fallback-census.ts`, all 63 fallback programs): the
 * normal encoding is never farther from stored (41 closer, 22 same; 20
 * names-exact vs 8), and the rows it cannot know are missing either way.
 * The one thing the old model kept that mattered was its wildcard rows:
 * each wildcard import claims a blank row, and in 13525 the second blank
 * row stands where the unknowable POPULATIONMANAGER row belongs, keeping
 * it byte-exact. So such a program now uses the normal model with only
 * that claim (`externalMetadataWildcardClaims`): 37 generated lists
 * change, 34 closer, 0 farther; 7 become byte-exact, none stop; 13525
 * stays EXACT. Claiming only the first wildcard (the Cycle 105
 * correction) stays parked behind 13525 until class metadata reaches it.
 *
 * The first pass runs with trace hooks buffered so observers see exactly
 * one pass -- the one whose bytes are returned.
 */
function encodeOrdinaryProgramFragment(
  source: string,
  context?: EncodeProgramContext
): ReturnType<typeof encodeFragmentInternal> {
  const externalClassMetadata = { unresolvedReceiverCalls: 0 };
  const buffered: Array<() => void> = [];
  const buffer = <T>(hook: ((event: T) => void) | undefined) =>
    hook === undefined ? undefined : (event: T) => { buffered.push(() => hook(event)); };

  const encoded = encodeFragmentInternal(source, {
    ...context,
    referenceTrace: buffer(context?.referenceTrace),
    chainSemanticsTrace: buffer(context?.chainSemanticsTrace),
    reusePoolTrace: buffer(context?.reusePoolTrace),
    applicationClassTypeMetadataTrace: buffer(context?.applicationClassTypeMetadataTrace),
    externalClassMetadata
  });

  if (externalClassMetadata.unresolvedReceiverCalls === 0 || context?.suppressExternalMetadataFallback) {
    for (const replay of buffered) replay();
    return encoded;
  }

  context?.onExternalMetadataFallback?.();
  return encodeFragmentInternal(source, {
    ...context,
    externalMetadataWildcardClaims: true
  });
}

export function encodeProgramArtifacts(source: string, context?: EncodeProgramContext): EncodedPeopleCode {
  /*
   * Cycle 115: conditional compilation is lexical and comes first -- every
   * later stage (Application Class parsing, Function metadata, the
   * statement encoder) sees the preprocessed source, where each directive
   * region is a same-length block comment and dead branches are invisible.
   */
  if (context?.conditionalCompilation !== undefined && hasConditionalDirectives(source)) {
    let preprocessed;
    try {
      preprocessed = preprocessConditionalCompilation(source, context.conditionalCompilation);
    } catch (error) {
      if (error instanceof ConditionalCompilationError) throw new UnsupportedPeopleCodeError(error.offset, error.message);
      throw error;
    }
    if (preprocessed !== undefined) {
      const emissions = new Set<number>();
      const encoded = encodeProgramArtifacts(preprocessed.source, {
        ...context,
        conditionalDirectiveRegions: preprocessed.regions,
        conditionalDirectiveEmissions: emissions
      });
      // every directive must have been written exactly where the encoder met it
      for (const region of preprocessed.regions.values()) {
        if (!emissions.has(region.start)) {
          throw new UnsupportedPeopleCodeError(region.start, 'conditional-compilation directive at an unsupported position');
        }
      }
      return encoded;
    }
  }
  /*
   * Cycle 14: the pre-existing narrow, hand-calibrated single-method
   * golden template (`parseApplicationClassProgram`) is tried FIRST and
   * kept authoritative for the one exact shape it recognizes -- it is
   * independently verified byte-exact against a real capture
   * (`src/test/applicationClassMetadata.test.ts`). The new, general
   * `encodeApplicationClassProgramV2` (broader member/body support, but
   * not yet independently re-verified against every construct the OLD
   * hand-written template's own bytes happen to special-case) is used
   * only as a fallback, for every OTHER Application Class shape the
   * narrow template does not itself accept.
   *
   * `parseApplicationClassProgram` only returns `undefined` for a very
   * weak initial test (does this look like `import ...; class NAME
   * method NAME(`); once past that, any OTHER shape it does not
   * recognize (2+ methods, a different body shape, ...) makes it THROW
   * `UnsupportedPeopleCodeError` rather than return `undefined` -- so
   * that throw is caught here and treated the same as "declined",
   * falling through to the general path below, instead of killing the
   * whole encode before `encodeApplicationClassProgramV2` gets a chance.
   * A throw from `encodeApplicationClassProgramV2` itself (a genuinely
   * unsupported construct inside a method BODY, once its own OWN
   * declaration-level scope checks already passed) is NOT caught here --
   * it propagates normally, exactly like any other unsupported syntax.
   */
  let applicationClassMetadata: ApplicationClassProgramMetadata | undefined;
  try {
    applicationClassMetadata = parseApplicationClassProgram(source);
  } catch (error) {
    if (!(error instanceof UnsupportedPeopleCodeError)) throw error;
  }

  if (applicationClassMetadata !== undefined) {
    return {
      program: encodeApplicationClassProgram(applicationClassMetadata),
      references: []
    };
  }

  const applicationClassV2 = encodeApplicationClassProgramV2(source, context);
  if (applicationClassV2 !== undefined) {
    return applicationClassV2;
  }

  const functionMetadata = parseFunctionMetadata(source);
  const encoded = encodeOrdinaryProgramFragment(source, context);
  const statements = encoded.bytes;

  let program: Buffer;

  if (functionMetadata.length === 0) {
    program = Buffer.concat([
      encodeSimpleProgramHeader(statements.length + 1),
      statements,
      Buffer.from([PROGRAM_DIRECTORY_SEPARATOR])
    ]);
  } else {
    const metadata = encodeFunctionMetadata(functionMetadata);
    const executableLength = statements.length + 1;

    program = Buffer.concat([
      encodeFunctionProgramHeader(
        executableLength,
        functionMetadata
      ),
      statements,
      Buffer.from([PROGRAM_DIRECTORY_SEPARATOR]),
      metadata
    ]);
  }

  const references =
    context === undefined &&
    encoded.references[0]?.kind === 'owner' &&
    encoded.references[0].recordName === undefined &&
    encoded.references[0].fieldName === undefined
      ? encoded.references.slice(1)
      : encoded.references;

  return {
    program,
    references
  };
}

export function encodeProgram(source: string, context?: EncodeProgramContext): Buffer {
  return encodeProgramArtifacts(source, context).program;
}
