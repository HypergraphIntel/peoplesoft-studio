/*
 * The Discovery & Intelligence Network's local engine (docs/intelligence):
 * the finding schema, deterministic fingerprints, the privacy scan, the
 * local store, and adapters that turn research evidence into observations.
 * No `vscode`, no network: the extension, the MCP and the tools/ scripts all
 * use it.
 */
export * from './schema.js';
export { canonicalJson, findingFingerprint, findingId, observationDigest } from './fingerprint.js';
export { classify, PrivacyRejectedError, scanFinding, type PrivacyViolation } from './privacy.js';
export { DiscoveryInputError, DiscoveryStore, STORE_FORMAT, type FindingSummary, type ListFilter, type RecordOutcome, type RecordResult, type SubmissionRecord } from './store.js';
export { BACKGROUND_TABLES, observationFromCapture, sanitizedDeltaOf } from './adapters/saveCapture.js';
export { previewSubmission, type ProjectionOptions, type Removal, type SubmissionPreview } from './submission.js';
export { decideUpload, policyFileLocations, type MachinePolicy, type UploadDecision, type UploadInputs, type UploadMode } from './policy.js';
export { BUNDLE_FORMAT, ENVELOPE_FORMAT, keyIdOf, KnowledgeStore, verifyEnvelope, type KnowledgeBundle, type KnowledgeFinding, type TrustedKey, type VerifyResult } from './knowledge.js';
export { TRUSTED_KNOWLEDGE_KEYS } from './trustedKeys.js';
export { answerCapability, KNOWLEDGE_NEVER_GRANTS, type CapabilityAnswer, type CapabilityEvidence, type CapabilityQuestion, type CapabilityResult } from './capability.js';
export { observationFromLabRun, parseLabRun, type LabRunResult } from './adapters/labRun.js';
export { engineeringTask, type EngineeringTask } from './engineering.js';
