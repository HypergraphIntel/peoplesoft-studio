import { writeOrigin } from '../providers/writeGuard.js';
import type { DefinitionKey } from '../model/definitions.js';
type Observer = <T>(connection: string, key: DefinitionKey, write: () => Promise<T>) => Promise<T>;
let observer: Observer | undefined;
export function setManualHistoryObserver(value: Observer | undefined): void { observer = value; }
export function observeManualHistory<T>(connection: string, key: DefinitionKey, write: () => Promise<T>): Promise<T> { return writeOrigin() === 'user' && observer ? observer(connection, key, write) : write(); }
