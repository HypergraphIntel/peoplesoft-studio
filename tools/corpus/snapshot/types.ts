export interface SnapshotIdentity {
  definitionId: number;

  objectid1: number;
  objectvalue1: string;

  objectid2: number;
  objectvalue2: string;

  objectid3: number;
  objectvalue3: string;

  objectid4: number;
  objectvalue4: string;

  objectid5: number;
  objectvalue5: string;

  objectid6: number;
  objectvalue6: string;

  objectid7: number;
  objectvalue7: string;

  displayName: string;
}

export interface SnapshotNameRow {
  namenum: number;

  recname: string;
  refname: string;
  packageroot: string;
  qualifypath: string;
  appclassmethod: string;
}

export interface SnapshotDefinition extends SnapshotIdentity {
  sourceText: string;
  sourceSha256: string;

  storedProgram: Buffer;
  storedProgramSha256: string;

  names: SnapshotNameRow[];
}

export interface SnapshotMeta {
  snapshotId: number;
  databaseName: string;
  peopleToolsRelease?: string;
  capturedAt: string;

  definitionCount: number;
  sourceCount: number;
  programCount: number;
  nameRowCount: number;

  completed: boolean;
}