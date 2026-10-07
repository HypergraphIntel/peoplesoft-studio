/*
 * Which definitions the writers may change. By default every definition on
 * a Writable connection; a name prefix (setting
 * `peoplesoft.writeNamePrefix`, e.g. ZZ_) limits writes to
 * names starting with it.
 */

let prefix = '';

/** Sets the prefix writes are limited to; '' (the default) lifts the limit. */
export function setWriteNamePrefix(value: string | undefined): void {
  prefix = (value ?? '').trim().toUpperCase();
}

export function writeNamePrefix(): string {
  return prefix;
}

/** Whether a definition of this name may be written. */
export function isWritableName(name: string | undefined | null): boolean {
  if (!prefix) return true;
  return typeof name === 'string' && name.trim().toUpperCase().startsWith(prefix);
}

/** Why a definition of this name may not be written, or undefined. */
export function writeScopeRefusal(name: string): string | undefined {
  return isWritableName(name) ? undefined : `${name} does not start with ${prefix}: writes are limited to that prefix (setting peoplesoft.writeNamePrefix).`;
}
