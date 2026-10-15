export interface DataMoverTemplate {
  label: string;
  description: string;
  content: string;
}

export const DATA_MOVER_TEMPLATES: readonly DataMoverTemplate[] = [
  {
    label: 'Export records',
    description: 'Export a record with a WHERE filter',
    content: `-- Replace <path>, RECNAME, FIELDNAME and <value> before running in Data Mover.
SET LOG <path>/export.log;
SET OUTPUT <path>/export.dat;
EXPORT RECNAME WHERE FIELDNAME = '<value>';
`
  },
  {
    label: 'Import records',
    description: 'Import a record from a data file',
    content: `-- Replace <path> and RECNAME before running in Data Mover.
SET LOG <path>/import.log;
SET INPUT <path>/export.dat;
IMPORT RECNAME;
`
  },
  {
    label: 'Replace all records',
    description: 'Delete existing rows and import the record',
    content: `-- REPLACE_ALL deletes all existing rows in RECNAME before importing.
-- Replace <path> and RECNAME before running in Data Mover.
SET LOG <path>/replace.log;
SET INPUT <path>/export.dat;
REPLACE_ALL RECNAME;
`
  },
  {
    label: 'Log and output header',
    description: 'Start an export script with log and output paths',
    content: `-- Replace <path> and add EXPORT statements before running in Data Mover.
SET LOG <path>/export.log;
SET OUTPUT <path>/export.dat;
`
  },
  { label: 'Empty script', description: 'Start with a blank document', content: '' }
];

/** Resolve the installed extension's .dms language without assuming its id. */
export function dataMoverLanguage(packageJSON: unknown): string | undefined {
  const languages = (packageJSON as { contributes?: { languages?: unknown } } | undefined)?.contributes?.languages;
  if (!Array.isArray(languages)) return undefined;
  return languages.find(language => typeof language?.id === 'string' && language.id.length > 0
    && Array.isArray(language.extensions) && language.extensions.includes('.dms'))?.id;
}
