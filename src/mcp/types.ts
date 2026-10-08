import type {
  DefinitionKey
} from '../model/definitions.js';

export interface McpConnectionDescriptor {
  id: string;
  name: string;
  kind: 'oracle' | 'mssql' | 'db2' | 'projectFile';
  connected: boolean;
  selected: boolean;
}

export interface McpDefinitionDescriptor {
  key: DefinitionKey;
  displayName: string;
  typeLabel: string;
  description?: string;
  lastUpdated?: string;
  lastUpdatedBy?: string;
}
