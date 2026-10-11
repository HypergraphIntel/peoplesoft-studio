import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { AppEngineRows, Row } from '../model/appEngine.js';

/*
 * App Designer's App Engine saves, as captured on the lab VM
 * (tools/corpus/save-protocol/results, docs/APP_ENGINE.md): a capture's
 * before / after rows of one program, read back as the tables hold them.
 * Both capture formats (ae-capture.mts, snapshot.ts) keep each watched
 * table as { columns, rows }.
 */

export const RESULTS = path.join('tools', 'corpus', 'save-protocol', 'results');

interface Watched { columns: { name: string }[]; rows: (string | null)[][] }

export function captureExists(caseName: string): boolean {
  return existsSync(path.join(RESULTS, caseName, 'after.json'));
}

const parsed = new Map<string, Record<string, Watched>>();
function watch(caseName: string, phase: 'before' | 'after'): Record<string, Watched> {
  const file = path.join(RESULTS, caseName, `${phase}.json`);
  let w = parsed.get(file);
  if (!w) {
    w = JSON.parse(readFileSync(file, 'utf8')).watch as Record<string, Watched>;
    parsed.set(file, w);
  }
  return w;
}

/** A watched table's rows as objects, for one program. */
export function tableRows(caseName: string, phase: 'before' | 'after', table: string, program: string): Row[] {
  const t = watch(caseName, phase)[table];
  if (!t) return [];
  const rows = t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c.name, r[i]])));
  return rows.filter((r) =>
    'AE_APPLID' in r ? r.AE_APPLID === program
      : 'SQLID' in r ? String(r.SQLID).slice(0, 12) === program.padEnd(12)
        : 'OBJECTVALUE1' in r ? r.OBJECTID1 === '66' && r.OBJECTVALUE1 === program
          : true);
}

export interface CapturedProgram {
  rows: AppEngineRows;
  /** PeopleCode sources by key parts joined with '|'. */
  peopleCode: Map<string, string>;
  sqlDefn: Row[];
  sqlDescr: Row[];
  sqlHash: Row[];
  sqlDel: Row[];
  pcDel: Row[];
  appDel: Row[];
  sectDel: Row[];
  counters: Record<string, number>;
  locks: Record<string, number>;
}

/** A program as one side of a capture holds it; undefined when it has no PSAEAPPLDEFN row there. */
export function capturedProgram(caseName: string, phase: 'before' | 'after', program: string): CapturedProgram | undefined {
  const t = (table: string) => tableRows(caseName, phase, table, program);
  const [prog] = t('PSAEAPPLDEFN');
  const peopleCode = new Map<string, string>();
  const texts = [...t('PSPCMTXT')].sort((a, b) => Number(a.PROGSEQ) - Number(b.PROGSEQ));
  for (const r of texts) {
    const key = [1, 2, 3, 4, 5, 6, 7].map((n) => String(r[`OBJECTVALUE${n}`])).join('|');
    peopleCode.set(key, (peopleCode.get(key) ?? '') + String(r.PCTEXT ?? ''));
  }
  const counter = (table: string) => Object.fromEntries((watch(caseName, phase)[table]?.rows ?? []).map((r) => {
    const cols = watch(caseName, phase)[table].columns.map((c) => c.name);
    return [String(r[cols.indexOf('OBJECTTYPENAME')]).trim(), Number(r[cols.indexOf('VERSION')])];
  }));
  if (!prog) return undefined;
  return {
    rows: {
      program: prog, states: t('PSAEAPPLSTATE'), tempTables: t('PSAEAPPLTEMPTBL'), languages: t('PSAEAPPLLANG'),
      sections: t('PSAESECTDEFN'), variants: t('PSAESECTDTLDEFN'), steps: t('PSAESTEPDEFN'), actions: t('PSAESTMTDEFN'),
      messages: t('PSAESTEPMSGDEFN'), sqlText: t('PSSQLTEXTDEFN')
    },
    peopleCode,
    sqlDefn: t('PSSQLDEFN'), sqlDescr: t('PSSQLDESCR'), sqlHash: t('PSSQLHASH'), sqlDel: t('PSSQLDEL'),
    pcDel: t('PSPCMPROGDEL'), appDel: t('PSAEAPPLDEL'), sectDel: t('PSAESECTDEL'),
    counters: counter('PSVERSION'), locks: counter('PSLOCK')
  };
}

/** The ae-capture cases of ZZ_AE_LAB01 (every case but those of other programs). */
export const LAB = 'ZZ_AE_LAB01';
