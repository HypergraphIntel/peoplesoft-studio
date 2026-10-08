import type { DbConnection as Connection } from '../db/connection.js';
import { writeScopeRefusal } from './writeScope.js';
import { validateOperatorId } from '../peoplecode/writeback/savePlan.js';
import { expectRows, operatorExists, select, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';

/*
 * Creating an empty Application Package, as App Designer's first save of a
 * new one does (case c03, ZZ_PCODE_LAB_PK2):
 *
 *   PSPACKAGEDEFN  PACKAGEID = PACKAGEROOT = the name, QUALIFYPATH '.',
 *                  PACKAGELEVEL 0, PACKAGEREF / DESCR / OBJECTOWNERID ' ', no
 *                  DESCRLONG; VERSION = the new PSVERSION APM; stamped
 *   PSVERSION      APM + 1, SYS + 1
 *   PSLOCK         APM + 1
 *
 * Scope: a root package without classes.
 */

export class PackageCreateRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageCreateRefusedError';
  }
}

export async function createPackage(c: Connection, request: { name: string; operatorId: string }): Promise<{ version: number; lastupddttm: string }> {
  const name = request.name;
  try {
    const operatorError = validateOperatorId(request.operatorId);
    if (operatorError) throw new PackageCreateRefusedError(operatorError);
    if (!/^[A-Z0-9_]{1,30}$/.test(name)) throw new PackageCreateRefusedError(`${name} is not a valid package name (A-Z, 0-9, _; at most 30).`);
    const scope = writeScopeRefusal(name);
    if (scope) throw new PackageCreateRefusedError(scope);
    const [{ N: taken }] = await select<{ N: number }>(c,
      `SELECT (SELECT COUNT(*) FROM PSPACKAGEDEFN WHERE PACKAGEROOT = :n OR PACKAGEID = :n)
            + (SELECT COUNT(*) FROM PSPCMPROG WHERE OBJECTID1 = 104 AND OBJECTVALUE1 = :n) AS N FROM DUAL`, { n: name });
    if (Number(taken) > 0) throw new PackageCreateRefusedError(`A package named ${name} already exists, or left rows behind.`);
    if (!(await operatorExists(c, request.operatorId))) {
      throw new PackageCreateRefusedError(`PeopleSoft operator ${request.operatorId} does not exist in this database (PSOPRDEFN).`);
    }

    const v = await select<{ T: string; V: number }>(c,
      `SELECT OBJECTTYPENAME AS T, VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN ('APM', 'SYS') FOR UPDATE`);
    const l = await select<{ V: number }>(c, `SELECT VERSION AS V FROM PSLOCK WHERE OBJECTTYPENAME = 'APM' FOR UPDATE`);
    const get = (n: string) => {
      const r = v.find((x) => String(x.T).trim() === n);
      if (!r) throw new PackageCreateRefusedError(`PSVERSION ${n} is missing; refusing to write.`);
      return Number(r.V) + 1;
    };
    if (l.length !== 1) throw new PackageCreateRefusedError('PSLOCK APM is missing; refusing to write.');
    const next = { apm: get('APM'), sys: get('SYS'), lockApm: Number(l[0].V) + 1 };
    const [{ TS: lastupddttm }] = await select<{ TS: string }>(c,
      `SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);

    await expectRows(c,
      `INSERT INTO PSPACKAGEDEFN (PACKAGEID, PACKAGEROOT, QUALIFYPATH, PACKAGELEVEL, PACKAGEREF, DESCR, VERSION,
                                         LASTUPDDTTM, LASTUPDOPRID, OBJECTOWNERID, DESCRLONG)
       VALUES (:n, :n, '.', 0, ' ', ' ', :v, TO_TIMESTAMP(:ts, ${TIMESTAMP_FORMAT}), :op, ' ', NULL)`,
      { n: name, v: next.apm, ts: lastupddttm, op: request.operatorId }, 1, 'Inserting PSPACKAGEDEFN');
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'APM'`, { v: next.apm }, 1, 'Updating PSVERSION APM');
    await expectRows(c, `UPDATE PSVERSION SET VERSION = :v WHERE OBJECTTYPENAME = 'SYS'`, { v: next.sys }, 1, 'Updating PSVERSION SYS');
    await expectRows(c, `UPDATE PSLOCK SET VERSION = :v WHERE OBJECTTYPENAME = 'APM'`, { v: next.lockApm }, 1, 'Updating PSLOCK APM');

    const [d] = await select<{ VERSION: number; TS: string }>(c,
      `SELECT VERSION, TO_CHAR(CAST(LASTUPDDTTM AS TIMESTAMP(6)), ${TIMESTAMP_FORMAT}) AS TS FROM PSPACKAGEDEFN
        WHERE PACKAGEROOT = :n AND PACKAGEID = :n AND QUALIFYPATH = '.'`, { n: name });
    if (!d || Number(d.VERSION) !== next.apm || d.TS !== lastupddttm) throw new PackageCreateRefusedError('The package did not land as planned; rolled back.');
    await c.commit();
    return { version: next.apm, lastupddttm };
  } catch (error) {
    await c.rollback().catch(() => { /* the original error matters more */ });
    throw error;
  }
}
