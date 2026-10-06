import type { ApplicationClassTypeMetadataProvider } from './applicationClassTypeMetadata.js';

/*
 * Cycle 184: the compiler profile -- the PeopleTools compile context a
 * program is encoded under, as one object.
 *
 * Terms:
 * - PeopleTools release family: PSSTATUS.TOOLSREL, e.g. "8.61". It is what
 *   `#If #ToolsRel` compares against, and it selects the profile.
 * - patch: PSSTATUS.PTPATCHREL, e.g. 15. Informational; no modeled
 *   behavior depends on it.
 * - compiler profile: the release family plus the compile context
 *   (metadata universe) and the evidence-backed behavior deltas.
 * - lab release: a concrete installation (8.61.15, 8.62.09) --
 *   `PEOPLETOOLS_RELEASES` in corpus/controlledCompileRunner.ts, which maps
 *   each lab release to a profile id. Not a compiler concept.
 * - metadata universe: the Application Class definitions a program is
 *   typed against (HCDEV's, HRDMO's, a test's). Supplied per profile
 *   instance, never global; source-visible declarations still win.
 *
 * PT861 and PT862 currently share the same modeled syntax, byte-layout and
 * reference-allocation behavior. The first-class distinction supplies
 * release context (`#If #ToolsRel`) and the correct metadata universe;
 * future controlled evidence may add explicit profile deltas. Every 8.62
 * finding so far was release-neutral: H2 (an end-of-body close bug), 28943
 * (parser), 4601 / 4602 / 18249 / 18256 (release context), 23497
 * (metadata universe).
 */

export type CompilerProfileId = 'PT861' | 'PT862';

/*
 * Behavior deltas, by family. Each list holds the evidence-backed ways a
 * profile departs from the shared model; every list is empty today. A
 * future delta is a typed entry (a union member with its evidence), never a
 * bare boolean.
 */
export type CompilerSyntaxDelta = never;
export type CompilerByteLayoutDelta = never;
export type CompilerReferenceAllocationDelta = never;

export interface CompilerSyntaxProfile {
  readonly deltas: readonly CompilerSyntaxDelta[];
}
export interface CompilerByteLayoutProfile {
  readonly deltas: readonly CompilerByteLayoutDelta[];
}
export interface CompilerReferenceAllocationProfile {
  readonly deltas: readonly CompilerReferenceAllocationDelta[];
}

export interface CompilerProfile {
  readonly id: CompilerProfileId;
  /** The PeopleTools release family (PSSTATUS.TOOLSREL), the one authoritative `#ToolsRel` value. */
  readonly toolsRelease: string;
  /** PSSTATUS.PTPATCHREL, when the caller knows it. Informational. */
  readonly patchLevel?: number;
  /** The metadata universe for Application Class typing; absent: the source alone. */
  readonly applicationClassTypeMetadata?: ApplicationClassTypeMetadataProvider;
  readonly syntax: CompilerSyntaxProfile;
  readonly byteLayout: CompilerByteLayoutProfile;
  readonly referenceAllocation: CompilerReferenceAllocationProfile;
}

export interface CompilerProfileOptions {
  patchLevel?: number;
  applicationClassTypeMetadata?: ApplicationClassTypeMetadataProvider;
}

const SHARED_SYNTAX: CompilerSyntaxProfile = Object.freeze({ deltas: Object.freeze([]) });
const SHARED_BYTE_LAYOUT: CompilerByteLayoutProfile = Object.freeze({ deltas: Object.freeze([]) });
const SHARED_REFERENCE_ALLOCATION: CompilerReferenceAllocationProfile = Object.freeze({ deltas: Object.freeze([]) });

function createProfile(id: CompilerProfileId, toolsRelease: string, options: CompilerProfileOptions): CompilerProfile {
  return Object.freeze({
    id,
    toolsRelease,
    ...(options.patchLevel !== undefined ? { patchLevel: options.patchLevel } : {}),
    ...(options.applicationClassTypeMetadata !== undefined ? { applicationClassTypeMetadata: options.applicationClassTypeMetadata } : {}),
    syntax: SHARED_SYNTAX,
    byteLayout: SHARED_BYTE_LAYOUT,
    referenceAllocation: SHARED_REFERENCE_ALLOCATION
  });
}

/** PeopleTools 8.61 (the HCDEV corpus). */
export function createPt861CompilerProfile(options: CompilerProfileOptions = {}): CompilerProfile {
  return createProfile('PT861', '8.61', options);
}

/** PeopleTools 8.62 (the home lab, 8.62.09). Same modeled behavior as PT861 today. */
export function createPt862CompilerProfile(options: CompilerProfileOptions = {}): CompilerProfile {
  return createProfile('PT862', '8.62', options);
}

/** The profile factories, by id: the one extension point for a future release. */
export const COMPILER_PROFILES: Readonly<Record<CompilerProfileId, (options?: CompilerProfileOptions) => CompilerProfile>> = Object.freeze({
  PT861: createPt861CompilerProfile,
  PT862: createPt862CompilerProfile
});

/* Release family (exact PSSTATUS.TOOLSREL) -> profile id. Explicit: an unlisted release has no profile. */
const PROFILE_BY_TOOLS_RELEASE: Readonly<Record<string, CompilerProfileId>> = Object.freeze({
  '8.61': 'PT861',
  '8.62': 'PT862'
});

export class UnsupportedCompilerProfileError extends Error {}

/** A compile context that names a profile and contradicts it (another release or metadata universe). */
export class CompilerProfileConflictError extends Error {}

/** The profile id for a PeopleTools release family (PSSTATUS.TOOLSREL, e.g. "8.62"); throws for any other value. */
export function compilerProfileIdForToolsRelease(toolsRelease: string): CompilerProfileId {
  const id = PROFILE_BY_TOOLS_RELEASE[toolsRelease.trim()];
  if (id === undefined) {
    throw new UnsupportedCompilerProfileError(
      `No compiler profile for PeopleTools release "${toolsRelease}" (supported: ${Object.keys(PROFILE_BY_TOOLS_RELEASE).join(', ')}).`
    );
  }
  return id;
}

/** The profile for a PeopleTools release family; throws for an unsupported release. */
export function compilerProfileForToolsRelease(toolsRelease: string, options: CompilerProfileOptions = {}): CompilerProfile {
  return COMPILER_PROFILES[compilerProfileIdForToolsRelease(toolsRelease)](options);
}
