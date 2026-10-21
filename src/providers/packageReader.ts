import type { DbConnection } from '../db/connection.js';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { packageDocument, type ApplicationPackageDocument } from '../model/appPackages.js';
import { select } from './peopleCodeWriter.js';

/** Exact root scope, including empty subpackages and classes without a program. */
export async function readApplicationPackage(c: DbConnection, root: string): Promise<ApplicationPackageDocument | undefined> {
  const packages = await select<{ PACKAGEID: string; QUALIFYPATH: string; VERSION: number }>(c,
    `SELECT PACKAGEID, QUALIFYPATH, VERSION FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :r ORDER BY PACKAGELEVEL, PACKAGEID`, { r: root });
  const head = packages.find(p => p.QUALIFYPATH.trim() === '.' && p.PACKAGEID.trim() === root);
  if (!head) return undefined;
  const classes = await select<{ APPCLASSID: string; QUALIFYPATH: string }>(c,
    `SELECT APPCLASSID, QUALIFYPATH FROM PSAPPCLASSDEFN WHERE PACKAGEROOT = :r ORDER BY QUALIFYPATH, APPCLASSID`, { r: root });
  return packageDocument([
    ...packages.map(p => ({ key: makeKey(DefinitionType.ApplicationPackage, p.PACKAGEID.trim(), root, p.QUALIFYPATH.trim()) })),
    ...classes.map(p => ({ key: makeKey(DefinitionType.ApplicationClassPeopleCode, root,
      ...p.QUALIFYPATH.trim().split(':').filter(Boolean), p.APPCLASSID.trim(), 'OnExecute') }))
  ], root, Number(head.VERSION));
}
