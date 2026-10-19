import { DatabaseProvider } from '../providers/database.js';
import type { DefinitionKey } from '../model/definitions.js';

/**
 * PeopleCode as App Designer and the review snapshot hold it: the stored
 * source (PSPCMTXT) when a database has it, else the program decoded from
 * PSPCMPROG. Returning decoded text made an agent's read-modify-save
 * re-indent every line of a reviewed proposal.
 */
export async function readPeopleCodeSource(provider: { readText(key: DefinitionKey): Promise<string> }, key: DefinitionKey): Promise<string> {
  if (provider instanceof DatabaseProvider) {
    const stored = await provider.readPeopleCodeForEdit(key).catch(() => undefined);
    if (stored) return stored.text;
  }
  return provider.readText(key);
}
