/** Portable standalone SQL metadata. Installation-local versions/stamps are excluded. */
export interface SqlDefinitionData {
  name: string;
  text: string;
  description: string;
  definition: string;
  ownerId: string;
}

export const SQL_TEXT_ROW_LIMIT = 14000;
/** Native SQL stores CRLF and no final whitespace (see RECORD_SAVE r33/r34). */
export function prepareSqlText(text: string): string {
  return text.replace(/\r?\n/g, '\r\n').replace(/\s+$/, '');
}
