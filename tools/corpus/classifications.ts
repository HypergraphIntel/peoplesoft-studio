export type CorpusClassification =
  | 'EXACT'
  | 'NO_SOURCE'
  | 'NO_PROGRAM'
  | 'DECODE_ERROR'
  | 'DECODE_SOURCE_MISMATCH'
  | 'ENCODE_ERROR'
  | 'SOURCE_BODY_MISMATCH'
  | 'SOURCE_REFERENCE_MISMATCH'
  | 'ROUNDTRIP_ERROR'
  | 'ROUNDTRIP_BODY_MISMATCH'
  | 'ROUNDTRIP_REFERENCE_MISMATCH'
  | 'UNKNOWN_MISMATCH';

export interface CorpusDefinitionKey {
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

export interface CorpusDefinition {
  offset: number;
  key: CorpusDefinitionKey;
  displayName: string;
}

export interface CorpusResult {
  definition: CorpusDefinition;

  sourceChars: number;
  sourceSha256?: string;

  storedProgramBytes: number;
  generatedProgramBytes?: number;

  pscmnameRows: number;

  decodeSuccess: boolean;
  sourceMatch: boolean;

  sourceEncodeSuccess: boolean;
  sourceEncodeExact: boolean;

  roundtripSuccess: boolean;
  roundtripExact: boolean;

  classification: CorpusClassification;

  firstDiffOffset?: number;

  construct?: string;
  errorMessage?: string;

  storedSha256?: string;
  generatedSha256?: string;

  storedDiffHex?: string;
  generatedDiffHex?: string;
}

export function definitionKeyString(
  key: CorpusDefinitionKey
): string {
  return [
    key.objectId1,
    key.objectValue1,
    key.objectId2,
    key.objectValue2,
    key.objectId3,
    key.objectValue3,
    key.objectId4,
    key.objectValue4,
    key.objectId5,
    key.objectValue5,
    key.objectId6,
    key.objectValue6,
    key.objectId7,
    key.objectValue7
  ].join('|');
}

export function isExact(result: CorpusResult): boolean {
  return result.classification === 'EXACT';
}