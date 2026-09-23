export type CorpusClassification =
  | 'EXACT'
  | 'DECODE_ERROR'
  | 'ENCODE_ERROR'
  | 'DECODE_SOURCE_MISMATCH'
  | 'HEADER_MISMATCH'
  | 'BODY_MISMATCH'
  | 'TRAILER_MISMATCH'
  | 'PSPCMNAME_MISMATCH'
  | 'PSPCMNAME_NOT_COMPARABLE'
  | 'UNKNOWN_OPCODE'
  | 'UNSUPPORTED_SYNTAX'
  | 'AMBIGUOUS_DEFINITION'
  | 'UNKNOWN_MISMATCH';

export interface PeopleCodeDefinitionKey {
  objectId1: number;
  objectValue1: string;
  objectId2: number;
  objectValue2: string;
  objectId3: number;
  objectValue3: string;
  objectId4: number;
  objectValue4: string;
  objectId5: number;
  objectValue5: string;
  objectId6: number;
  objectValue6: string;
  objectId7: number;
  objectValue7: string;
}

export interface BinaryDiff {
  exact: boolean;
  expectedLength: number;
  actualLength: number;
  firstDifference?: number;
  expectedWindow?: string;
  actualWindow?: string;
}

export interface DecodeResult {
  success: boolean;
  normalizedSourceMatch?: boolean;
  decodedSource?: string;
  error?: string;
}

export interface EncodeResult {
  success: boolean;
  exactProgramMatch?: boolean;
  generatedLength?: number;
  diff?: BinaryDiff;
  error?: string;
}

export type NameComparisonStatus =
  | 'EXACT'
  | 'MISMATCH'
  | 'NOT_COMPARABLE';

export interface NameComparisonResult {
  status: NameComparisonStatus;
  storedCount: number;
  generatedCount?: number;
}

export interface CorpusDefinitionResult {
  key: PeopleCodeDefinitionKey;

  ownerType?: string;

  sourceLength: number;
  storedProgramLength: number;

  decode: DecodeResult;
  sourceEncode: EncodeResult;
  semanticRoundTrip: EncodeResult;

  names: NameComparisonResult;

  classification: CorpusClassification;
}

export interface CorpusCapabilities {
  decodeSucceeded: boolean;
  decodedSourceMatched: boolean;
  sourceEncodeSucceeded: boolean;
  sourceEncodeExact: boolean;
  semanticRoundTripSucceeded: boolean;
  semanticRoundTripExact: boolean;
}

export interface CorpusDefinitionResult {
  key: PeopleCodeDefinitionKey;

  ownerType?: string;

  sourceLength: number;
  storedProgramLength: number;

  decode: DecodeResult;
  sourceEncode: EncodeResult;
  semanticRoundTrip: EncodeResult;

  names: NameComparisonResult;

  capabilities: CorpusCapabilities;
  classification: CorpusClassification;
}
