/*
 * PeopleSoft Query definitions, as the PeopleTools tables hold them (HRDMO,
 * PeopleTools 8.62; docs/QUERIES.md), and a read-only text view: records,
 * columns, prompts, expressions and criteria per select (the top level,
 * subqueries, unions). Criteria are shown as Query Manager words them, not
 * as SQL: Query adds effective-date subselects, security joins and date
 * formatting when it runs.
 */

export type Row = Record<string, unknown>;

const str = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => Number(v ?? 0);
const stamp = (r: Row) => str(r.LASTUPD) || str(r.LASTUPDDTTM);

/**
 * PSQRYCRITERIA.CONDTYPE: PSXLATITEM's CONDTYPE_CHAR / CPQCONDTYPE /
 * EQRY_OPERATOR, which agree, and the operands each takes on HRDMO (8 a
 * list or subquery, 10 two operands, 12 / 13 a subquery and no left side).
 */
export const CONDITIONS: Readonly<Record<number, string>> = {
  1: 'none', 2: 'equal to', 3: 'not equal to', 4: 'greater than', 5: 'not greater than', 6: 'less than', 7: 'not less than',
  8: 'in list', 9: 'not in list', 10: 'between', 11: 'not between', 12: 'exists', 13: 'does not exist', 14: 'like', 15: 'not like',
  16: 'is null', 17: 'is not null', 20: 'Eff Date <=', 21: 'Eff Date >='
};

/** PSQRYCRITERIA.COMBTYPE: 3 opens the criteria (2,606 of 2,606 rows are first), then 1 AND, 2 OR. */
export const CONNECTORS: Readonly<Record<number, string>> = { 1: 'AND', 2: 'OR', 3: 'WHERE' };

/** PSQRYSELECT.SELECTTYPE (PSXLATITEM QRYLEVELTYPE's levels; 2,397 top levels for 2,397 queries, 328 subqueries for 328 subquery operands). */
export const SELECT_TYPES: Readonly<Record<number, string>> = { 1: 'Top Level', 2: 'Subquery', 3: 'Union' };

/** PSQRYRECORD.JOINTYPE: 5 Left Outer Join (all 608 carry ON criteria, QRYOJSELNUM); 1 the first record or a standard join. */
export const JOIN_TYPES: Readonly<Record<number, string>> = { 1: 'Standard', 5: 'Left Outer Join' };

/** PSQRYDEFN.QRYTYPE, from the queries' names (_ROLE_ ..., _DBAG_ ..., ..._ARCHVE). */
export const QUERY_TYPES: Readonly<Record<number, string>> = { 1: 'User', 3: 'Process', 4: 'Role', 5: 'Database Agent', 7: 'Archive' };

export interface QueryView {
  query: Row;
  selects: Row[];
  records: Row[];
  fields: Row[];
  criteria: Row[];
  expressions: Row[];
  binds: Row[];
}

export function renderQuery(name: string, view: QueryView): string {
  const q = view.query;
  const out: string[] = [];
  const owner = str(q.OPRID);
  out.push(`Query ${name}${str(q.DESCR) ? ` -- ${str(q.DESCR)}` : ''}`);
  out.push(`  ${owner ? `Private (${owner})` : 'Public'}   Type: ${QUERY_TYPES[num(q.QRYTYPE)] ?? `type ${num(q.QRYTYPE)}`}` +
    `${str(q.QRYFOLDER) ? `   Folder: ${str(q.QRYFOLDER)}` : ''}${str(q.QRYDISABLED) === 'Y' || num(q.QRYDISABLED) === 1 ? '   DISABLED' : ''}`);
  out.push(`  Version: ${num(q.VERSION)}   Last updated: ${stamp(q)} by ${str(q.LASTUPDOPRID)}`);

  const rawExpression = new Map(view.expressions.map((e) => [num(e.EXPNUM), String(e.EXPRESSIONTEXT ?? '').trim()]));
  const recordsOf = (sel: number) => view.records.filter((r) => num(r.SELNUM) === sel).sort((a, b) => num(a.RCDNUM) - num(b.RCDNUM));
  const alias = (sel: number, rcd: number) => str(view.records.find((r) => num(r.SELNUM) === sel && num(r.RCDNUM) === rcd)?.CORRNAME) || `R${rcd}`;
  const field = (sel: number, fld: number, depth = 0): string => {
    const f = view.fields.find((x) => num(x.SELNUM) === sel && num(x.FLDNUM) === fld);
    if (!f) return `field ${sel}/${fld}`;
    if (num(f.FLDEXPNUM) && depth < 4) return expressionText(num(f.FLDEXPNUM), depth + 1);
    return `${alias(num(f.SELNUM), num(f.FLDRCDNUM))}.${str(f.FIELDNAME)}`;
  };
  // An expression's text with its field references resolved: ":%1.22" is select 1's field 22 (all 405 such
  // column expressions on HRDMO name an existing field; column 8 of COMP_SRCH_TRW_CHILD1 is headed by it).
  const expressionText = (exp: number, depth = 0): string => {
    const text = rawExpression.get(exp);
    if (text === undefined) return `expression ${exp}`;
    return text.replace(/:%(\d+)\.(\d+)/g, (_m, sel: string, fld: string) => field(Number(sel), Number(fld), depth));
  };
  // A right-hand operand: a field, an expression (a constant, prompt or list is one), a subquery, or the current date.
  const operand = (c: Row, side: 'R1' | 'R2'): string => {
    const exp = num(c[`${side}CRTEXPNUM`]);
    // Operand type 1 is a constant ('A', ' ', '0' ...): quoted, so a blank one shows.
    if (exp) {
      if (num(c.EXPRTYPE) !== 1) return expressionText(exp);
      // A constant as stored: PeopleSoft's blank is one space, which trimming would lose.
      const constant = String(view.expressions.find((e) => num(e.EXPNUM) === exp)?.EXPRESSIONTEXT ?? '');
      return `'${constant.trim() ? constant.trim() : constant}'`;
    }
    const fld = num(c[`${side}CRTFLDNUM`]);
    if (fld) return field(num(c[`${side}CRTSELNUM`]), fld);
    const sub = num(c[`${side}CRTSELNUM`]);
    if (sub && num(c.EXPRTYPE) === 4) return `(Subquery ${sub})`;
    if (num(c.EXPRTYPE) === 6) return 'Current Date';
    return '';
  };

  if (view.binds.length) {
    out.push('', '  Prompts');
    for (const b of [...view.binds].sort((a, c) => num(a.BNDNUM) - num(c.BNDNUM))) {
      out.push(`    :${num(b.BNDNUM)}  ${str(b.BNDNAME).padEnd(18)} ${str(b.FIELDNAME).padEnd(18)} "${str(b.HEADING)}"` +
        `${str(b.EDITTABLE) ? `  prompt table ${str(b.EDITTABLE)}` : ''}${str(b.QRYREQUIREDPROMPT) === 'Y' || num(b.QRYREQUIREDPROMPT) === 1 ? '  required' : ''}`);
    }
  }

  for (const sel of [...view.selects].sort((a, b) => num(a.SELNUM) - num(b.SELNUM))) {
    const n = num(sel.SELNUM);
    const kind = SELECT_TYPES[num(sel.SELECTTYPE)] ?? `select type ${num(sel.SELECTTYPE)}`;
    out.push('', `  ${n === 1 ? 'Query' : `${kind} ${n}`}${str(sel.QRYDISTINCT) === 'Y' ? '  (Distinct)' : ''}`);
    out.push('    Records');
    for (const r of recordsOf(n)) {
      const join = num(r.JOINTYPE);
      const how = num(r.RCDNUM) === 1 || join === 1 ? '' : `  ${JOIN_TYPES[join] ?? `join type ${join}`}` +
        `${num(r.JOINRCDNUM) ? ` to ${alias(n, num(r.JOINRCDNUM))}` : ''}`;
      out.push(`      ${(str(r.CORRNAME) || `R${num(r.RCDNUM)}`).padEnd(3)} ${str(r.RECNAME)}${how}`);
    }
    const columns = view.fields.filter((f) => num(f.SELNUM) === n && num(f.COLUMNNUM) > 0).sort((a, b) => num(a.COLUMNNUM) - num(b.COLUMNNUM));
    if (columns.length) {
      out.push('    Columns');
      for (const f of columns) {
        const order = num(f.ORDERBYNUM) ? `  order ${num(f.ORDERBYNUM)}${str(f.ORDERBYDIR) === 'D' ? ' desc' : ''}` : '';
        const agg = str(f.AGGREGATEFUNC) === 'Y' ? '  aggregate' : '';
        const heading = str(f.HEADING) ? ` "${str(f.HEADING)}"` : '';
        out.push(`      ${String(num(f.COLUMNNUM)).padStart(3)}  ${field(n, num(f.FLDNUM)).padEnd(30)}${heading}${order}${agg}`.trimEnd());
      }
    }
    const crit = view.criteria.filter((c) => num(c.SELNUM) === n).sort((a, b) => num(a.CRTNUM) - num(b.CRTNUM));
    if (crit.length) {
      out.push('    Criteria');
      for (const c of crit) {
        const cond = num(c.CONDTYPE);
        const left = num(c.LCRTFLDNUM) ? field(num(c.LCRTSELNUM), num(c.LCRTFLDNUM)) : '';
        const r1 = operand(c, 'R1');
        const r2 = operand(c, 'R2');
        const right = cond === 10 || cond === 11 ? `${r1} and ${r2}` : r1;
        const words = `${str(c.NEGATION) === 'Y' ? 'not ' : ''}${CONDITIONS[cond] ?? `condition ${cond}`}`;
        const joinOn = num(c.QRYOJSELNUM) ? `  (ON ${alias(n, num(c.QRYOJSELNUM))})` : '';
        const open = '('.repeat(Math.max(0, num(c.LPARENLVL)));
        const close = ')'.repeat(Math.max(0, num(c.RPARENLVL)));
        out.push(`      ${(CONNECTORS[num(c.COMBTYPE)] ?? `combine ${num(c.COMBTYPE)}`).padEnd(5)} ${open}${[left, words, right].filter(Boolean).join(' ')}${close}${joinOn}`);
      }
    }
  }
  if (view.expressions.length) {
    out.push('', '  Expressions');
    for (const e of [...view.expressions].sort((a, b) => num(a.EXPNUM) - num(b.EXPNUM))) {
      out.push(`    ${String(num(e.EXPNUM)).padStart(3)}  ${expressionText(num(e.EXPNUM))}`);
    }
  }
  return out.join('\n') + '\n';
}
