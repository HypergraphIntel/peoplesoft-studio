import type {
  DefinitionKey
} from '../model/definitions.js';

export interface McpConnectionDescriptor {
  id: string;
  name: string;
  kind: 'oracle' | 'mssql' | 'db2' | 'projectFile';
  connected: boolean;
  selected: boolean;
  /** The client library a connected connection uses, e.g. "node-oracledb 6.10.0 Thick, Oracle Client 23.6.0.0.0". */
  driver?: string;
}

export interface McpDefinitionDescriptor {
  key: DefinitionKey;
  displayName: string;
  typeLabel: string;
  description?: string;
  lastUpdated?: string;
  lastUpdatedBy?: string;
}
