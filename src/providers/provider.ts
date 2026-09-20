import { DefinitionKey, DefinitionType } from '../model/definitions.js';
import { RecordDefinition } from '../model/record.js';

export interface DefinitionSummary {
  key: DefinitionKey;
  description?: string;
  lastUpdated?: Date;
  lastUpdatedBy?: string;
}

export interface SearchQuery {
  type?: DefinitionType;
  /** Matched against the first key part, case-insensitively. '%' and '_' act as SQL wildcards. */
  namePattern?: string;
  limit?: number;
}

export interface ProjectSummary {
  name: string;
  description?: string;
}

/**
 * What a source of PeopleSoft definitions must be able to do.
 *
 * Two implementations exist: {@link OracleProvider}, which reads the PeopleTools
 * tables directly, and {@link ProjectFileProvider}, which reads an App Designer
 * XML export from disk. The rest of the extension is written against this
 * interface only, so a view or editor never learns which one it is talking to.
 *
 * Capability differences are declared rather than thrown: a project export has
 * no DDL and cannot be searched beyond its own contents, so it reports those
 * capabilities as absent and the UI hides the corresponding affordances.
 */
export interface DefinitionProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  connect(): Promise<void>;
  dispose(): Promise<void>;
  readonly isConnected: boolean;

  listProjects(): Promise<ProjectSummary[]>;
  listProjectItems(project: string): Promise<DefinitionSummary[]>;

  search(query: SearchQuery): Promise<DefinitionSummary[]>;

  /** Text payload for PeopleCode and SQL definitions. */
  readText(key: DefinitionKey): Promise<string>;
  writeText(key: DefinitionKey, text: string): Promise<void>;

  readRecord(key: DefinitionKey): Promise<RecordDefinition>;
  writeRecord(record: RecordDefinition): Promise<void>;

  /**
   * The definitions nested under `key`, as App Designer shows them when a node
   * is expanded: a record's fields, a component's pages.
   *
   * Children are returned as definitions in their own right, keyed so that
   * opening one opens that definition — expanding a record and clicking a field
   * opens the field, exactly as it would from the field list.
   *
   * Returns an empty array for a definition with no children, or one whose
   * children this provider cannot supply. Callers must tolerate an empty result
   * for a type {@link canExpand} accepts.
   */
  listChildren(key: DefinitionKey): Promise<DefinitionSummary[]>;
}

/**
 * Whether a type is worth offering an expander for.
 *
 * This is a UI affordance decided without a round trip, so it is deliberately
 * a property of the type rather than of the definition: fetching every record's
 * field list just to decide whether to draw a twisty would make expanding a
 * project unusable.
 */
export function canExpand(type: DefinitionType): boolean {
  return type === DefinitionType.Record || type === DefinitionType.Component;
}

export interface ProviderCapabilities {
  /** Can definitions be modified through this provider? */
  readonly write: boolean;
  /** Can the whole environment be searched, or only the loaded project? */
  readonly globalSearch: boolean;
  /** Can DDL be generated and run? */
  readonly build: boolean;
}

export class ProviderError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class UnsupportedOperationError extends ProviderError {
  constructor(operation: string, provider: string) {
    super(`${provider} does not support ${operation}.`);
    this.name = 'UnsupportedOperationError';
  }
}
