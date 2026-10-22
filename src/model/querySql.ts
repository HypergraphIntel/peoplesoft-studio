import type { QueryView, Row } from './queryDefinition.js';

/** Deliberately bounded to the record shapes captured in HRDMO; `joined` holds the other records by RECNAME. */
export interface QueryRecordSql {
  record: string;
  table: string;
  recordType: number;
  querySecurityRecord: string;
  fields: Record<string, { type: number }>;
  /** Key fields in record order (related joins and effective dating, qjn04). */
  keys?: string[];
}
export interface QuerySqlContext extends QueryRecordSql { joined?: Record<string, QueryRecordSql> }

export interface QuerySqlPlan {
  sql: string;
  columns: Row[];
  prompts: Row[];
}

export class QueryUnsupportedError extends Error {}
const text = (v: unknown) => String(v ?? '').trim();
const number = (v: unknown) => Number(v ?? 0);
function refuse(reason: string): never { throw new QueryUnsupportedError(reason); }
const identifier = (v: unknown) => {
  const name = text(v);
  if (!/^[A-Z][A-Z0-9_$#]*$/.test(name)) refuse(`Unsupported SQL identifier: ${name}`);
  return name;
};

/** Windows Query's operator SQL (qcr01-qcr10 and unsaved SQL-tab views); OPERATORS[CONDTYPE]. */
const OPERATORS: Readonly<Record<number,string>>={2:'=',3:'<>',4:'>',5:'<=',6:'<',7:'>=',8:'IN',9:'NOT IN',10:'BETWEEN',11:'NOT BETWEEN',
  14:'LIKE',15:'NOT LIKE',16:'IS NULL',17:'IS NOT NULL',20:'EFFDT <='};
const quoted=(v: unknown)=>`'${String(v ?? '').replace(/'/g, "''")}'`;
const LIST=/^\('(?:[^']|'')*'(?:,'(?:[^']|'')*')*\)$/;

const AGGREGATES: Readonly<Record<number,string>>={2:'SUM',3:'COUNT',4:'MIN',5:'MAX',6:'AVG'};
const TOKEN=/ :%(\d+)\.(\d+)/g;
const SYSDATE_DAY="TO_DATE(TO_CHAR(SYSDATE,'YYYY-MM-DD'),'YYYY-MM-DD')";

/**
 * SQL follows qry01-qry10, qcr01-qcr10, qnm01-qnm04, qjn01-qjn04 (FROM lists, a second-record
 * LEFT OUTER JOIN with its ON criteria, related-record keys and effective dating), qag01-qag05
 * (aggregates, derived GROUP BY, HAVING, DISTINCT), qex01-qex03 (expressions), qsq01-qsq02
 * (IN and correlated EXISTS subqueries), qun01 (UNION) and qxl01-qxl02 (translates); every
 * statement is the one Windows Query shows for the native save. Unsupported shapes never
 * produce partial SQL.
 */
export function compileQuerySql(view: QueryView, context: QuerySqlContext): QuerySqlPlan {
  if (number(view.query.QRYTYPE) !== 1) refuse('Only User queries are supported for execution.');
  if (text(view.query.QRYDISABLED) === 'Y' || number(view.query.QRYDISABLED) === 1) refuse('This query is disabled.');
  const selects = [...view.selects].sort((a,b) => number(a.SELNUM)-number(b.SELNUM));
  if (!selects.length || selects.some((sel,i) => number(sel.SELNUM) !== i+1 || (i ? ![2,3].includes(number(sel.SELECTTYPE)) || number(sel.PARENTSELNUM) !== 1
    : number(sel.SELECTTYPE) !== 1 || number(sel.PARENTSELNUM)))) refuse('Only a top-level select with direct subqueries or unions is calibrated.');
  if (selects.some(sel => number(sel.SELECTTYPE) === 2) && selects.some(sel => number(sel.SELECTTYPE) === 3)) refuse('Subqueries together with unions are not calibrated.');
  const typeOfSelect = (sel: unknown) => number(selects.find(x => number(x.SELNUM) === number(sel))?.SELECTTYPE);
  const recordRows = (sel: unknown) => view.records.filter(r => number(r.SELNUM) === number(sel)).sort((a,b) => number(a.RCDNUM)-number(b.RCDNUM));
  const sources = view.records.map(record => {
    const first = number(record.SELNUM) === 1 && number(record.RCDNUM) === 1;
    const ctx = first ? context : context.joined?.[text(record.RECNAME)] ?? (text(record.RECNAME) === context.record ? context : undefined);
    if (!ctx || text(record.RECNAME) !== ctx.record) refuse('Query record metadata does not match.');
    if (ctx.recordType !== 0) refuse('Execution is currently calibrated for SQL Table records.');
    if (ctx.querySecurityRecord.trim()) refuse('This record requires query row security; that SQL is not calibrated yet.');
    return { record, ctx, alias: identifier(record.CORRNAME), table: identifier(ctx.table), join: number(record.JOINTYPE), sel: number(record.SELNUM) };
  });
  if (new Set(sources.map(src => src.alias)).size !== sources.length) refuse('Record aliases must be unique.');
  const sourceOf = (sel: unknown, rcd: unknown) => sources.find(src => src.sel === number(sel) && number(src.record.RCDNUM) === number(rcd)) ?? refuse('Field references a missing record.');
  const fieldAt = (sel: unknown, fld: unknown) => view.fields.find(f => number(f.SELNUM) === number(sel) && number(f.FLDNUM) === number(fld)) ?? refuse('Criterion references a missing field.');
  const expressionOf = (num: unknown) => view.expressions.find(e => number(e.EXPNUM) === number(num)) ?? refuse('A missing expression is referenced.');
  const typeOf = (field: Row): number | undefined => number(field.FLDEXPNUM) ? number(expressionOf(field.FLDEXPNUM).FIELDTYPE) : sourceOf(field.SELNUM,field.FLDRCDNUM).ctx.fields[text(field.FIELDNAME)]?.type;
  const rawSql = (field: Row) => `${sourceOf(field.SELNUM,field.FLDRCDNUM).alias}.${identifier(field.FIELDNAME)}`;
  // qex01: `:%SELNUM.FLDNUM` tokens are the fields; the text is otherwise as entered.
  const detokenized = (value: unknown) => {
    const raw = String(value ?? '');
    if (/;|--|\/\*|\*\//.test(raw.replace(/'(?:[^']|'')*'/g,"''").replace(TOKEN,''))) refuse('Unsupported expression text.');
    if (/:(?!%\d+\.\d+)/.test(raw.replace(/'(?:[^']|'')*'/g,"''"))) refuse('Expression binds are not calibrated.');
    return raw.replace(TOKEN,(_,sel: string,fld: string) => ` ${rawSql(fieldAt(sel,fld))}`);
  };
  for (const field of view.fields) {
    if (!typeOfSelect(field.SELNUM)) refuse('A field belongs to a missing select.');
    const ttl = number(field.TTLTYPE), xlat = number(field.XLATTYPE);
    if (number(field.GROUPBYNUM) || number(field.SUBTTLNUM) || text(field.AGGREGATEFUNC) || number(field.XLATEXPNUM) || !(ttl === 1 || ttl in AGGREGATES) || ![1,2,3].includes(xlat))
      refuse(`${text(field.QRYFLDNAME)}: this aggregate or translate type is not calibrated.`);
    if (number(field.FLDEXPNUM)) {
      const expr = expressionOf(field.FLDEXPNUM);
      if (![0,2].includes(number(expr.FIELDTYPE)) || text(field.FIELDNAME) || number(field.FLDRCDNUM) || ttl !== 1 || xlat !== 1) refuse('Only plain character and number expression columns are calibrated.');
      detokenized(expr.EXPRESSIONTEXT);
      continue;
    }
    const name = identifier(field.FIELDNAME);
    if (![0,2,4].includes(typeOf(field) ?? -1)) refuse(`${name}: execution is calibrated for character, number and date fields.`);
    if (ttl !== 1 && (typeOf(field) === 4 || xlat !== 1 || typeOfSelect(field.SELNUM) === 2)) refuse('Aggregates are calibrated for character and number fields without translates.');
    if (xlat !== 1 && (typeOf(field) !== 0 || number(field.SELNUM) !== 1 || recordRows(1).length !== 1 || !number(field.COLUMNNUM)
      || !(number(field.XLATEXPRTYPE) === 6 && !number(field.XLATFLDNUM) || number(field.XLATEXPRTYPE) === 2 && typeOf(fieldAt(field.SELNUM,field.XLATFLDNUM)) === 4))) refuse('This translate shape is not calibrated.');
  }
  const prompts: Row[] = [];
  const compile = (sel: number): { sql: string; columns: Row[] } => {
    const kind = typeOfSelect(sel), records = sources.filter(src => src.sel === sel).sort((a,b) => number(a.record.RCDNUM)-number(b.record.RCDNUM));
    if (!records.length) refuse('A select has no record.');
    records.forEach((src,i) => {
      const record = src.record, join = src.join;
      if (number(record.RCDNUM) !== i+1 || (i ? ![1,3,5].includes(join) || sel !== 1 : join !== 1 || number(record.JOINRCDNUM) || number(record.JOINFLDNUM))
        || join === 1 && (number(record.JOINRCDNUM) || number(record.JOINFLDNUM)) || join === 5 && (i !== 1 || number(record.JOINRCDNUM) !== 1 || number(record.JOINFLDNUM))
        || join === 3 && (!number(record.JOINRCDNUM) || number(record.JOINRCDNUM) > i || !number(record.JOINFLDNUM))) refuse('This join shape is not calibrated.');
    });
    const fields = view.fields.filter(f => number(f.SELNUM) === sel);
    const columns = fields.filter(f => number(f.COLUMNNUM) > 0).sort((a,b) => number(a.COLUMNNUM)-number(b.COLUMNNUM));
    if (!columns.length) refuse('Select at least one output field.');
    if (columns.some((f,i) => number(f.COLUMNNUM) !== i+1)) refuse('Output column positions must be consecutive.');
    const aggregated = (field: Row) => `${AGGREGATES[number(field.TTLTYPE)]}( ${rawSql(field)})`;
    const columnSql = (field: Row) => {
      if (number(field.FLDEXPNUM)) return detokenized(expressionOf(field.FLDEXPNUM).EXPRESSIONTEXT);
      // qxl01/qxl02: the translate join's alias is the record alias, the column number and X.
      if (number(field.XLATTYPE) !== 1) return `${sourceOf(sel,field.FLDRCDNUM).alias}${number(field.COLUMNNUM)}X.${number(field.XLATTYPE) === 2 ? 'XLATSHORTNAME' : 'XLATLONGNAME'}`;
      if (number(field.TTLTYPE) !== 1) return aggregated(field);
      // qnm01: a selected date is TO_CHAR(A.START_DT,'YYYY-MM-DD').
      if (typeOf(field) === 4) return kind === 2 ? refuse('Date subquery output is not calibrated.') : `TO_CHAR(${rawSql(field)},'YYYY-MM-DD')`;
      return rawSql(field);
    };
    if (new Set(columns.map(columnSql)).size !== columns.length) refuse('Duplicate output fields are not supported yet.');
    if (kind === 2 && columns.length !== 1) refuse('A subquery selects one field.');
    const criteria = view.criteria.filter(c => number(c.SELNUM) === sel).sort((a,b) => number(a.CRTNUM)-number(b.CRTNUM));
    const firstHaving = criteria.findIndex(c => [4,5,6].includes(number(c.COMBTYPE)));
    const where = firstHaving < 0 ? criteria : criteria.slice(0,firstHaving), having = firstHaving < 0 ? [] : criteria.slice(firstHaving);
    const criterionSql = (c: Row, i: number, isHaving: boolean) => {
      const cond = number(c.CONDTYPE), exprtype = number(c.EXPRTYPE), negation = text(c.NEGATION), comb = number(c.COMBTYPE);
      const exists = cond === 12 || cond === 13;
      if (number(c.CRTNUM) !== criteria.indexOf(c)+1 || !(cond in OPERATORS || exists) || negation && negation !== 'N'
        || (isHaving ? (i ? comb !== 4 : comb !== 6) : ![1,2,3].includes(comb) || (i ? comb === 3 : comb !== 3))
        || (exists ? number(c.LCRTSELNUM) || number(c.LCRTFLDNUM) : number(c.LCRTSELNUM) !== sel)) refuse('This criterion shape is not calibrated.');
      const field = exists ? undefined : fieldAt(c.LCRTSELNUM,c.LCRTFLDNUM), type = field && typeOf(field);
      if (field && number(field.FLDEXPNUM)) refuse('Criteria on expression columns are not calibrated.');
      if (isHaving && (!field || number(field.TTLTYPE) === 1 || number(field.TTLTYPE) === 3 && type !== 2)) refuse('HAVING criteria are calibrated on SUM, MIN, MAX, AVG and numeric COUNT aggregates.');
      const left = field ? (isHaving ? aggregated(field) : rawSql(field)) : '';
      const expression = (side: 'R1'|'R2') => {
        const expr = expressionOf(c[`${side}CRTEXPNUM`]);
        return text(expr.EXPRESSIONTEXT) ? String(expr.EXPRESSIONTEXT) : ' ';
      };
      // Constants: character quoted, number bare (qnm01), date TO_DATE (qnm02).
      const constant = (value: string) => type === 2 ? (/^-?[0-9]+(\.[0-9]+)?$/.test(value) ? value : refuse('Invalid numeric constant.'))
        : type === 4 ? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? `TO_DATE('${value}','YYYY-MM-DD')` : refuse('Invalid date constant.')) : quoted(value);
      const subquery = () => {
        const sub = number(c.R1CRTSELNUM);
        if (typeOfSelect(sub) !== 2 || sub === sel || number(selects[sub-1].PARENTSELNUM) !== sel) refuse('Subquery operand references a missing subquery.');
        const plan = compile(sub);
        if (field && typeOf(plan.columns[0]) !== type) refuse('Subquery output type does not match.');
        return `(${plan.sql})`;
      };
      if (exists) {
        if (exprtype !== 4 || isHaving) refuse('Exists takes a subquery.');
        return `${'( '.repeat(number(c.LPARENLVL))}${negation ? 'NOT ' : ''}${cond === 13 ? 'NOT ' : ''}EXISTS ${subquery()}${')'.repeat(number(c.RPARENLVL))}`;
      }
      if (cond === 20) {
        // qjn04, qxl01: Eff Date <= Current Date is the latest row at or before SYSDATE for the other keys;
        // the select's own first record's is unparenthesized (qxl01), a joined record's parenthesized (qjn04).
        const src = sourceOf(field!.SELNUM,field!.FLDRCDNUM), keys = src.ctx.keys ?? refuse('Record keys are needed for effective dating.');
        if (exprtype !== 6 || negation || isHaving || number(c.LPARENLVL) || number(c.RPARENLVL) || text(field!.FIELDNAME) !== 'EFFDT' || !keys.includes('EFFDT') || keys.includes('EFFSEQ'))
          refuse('Only EFFDT <= current date effective dating is calibrated.');
        const ed = `${src.alias}_ED`, others = keys.filter(k => k !== 'EFFDT').map(k => `${src.alias}.${identifier(k)} = ${ed}.${identifier(k)}`);
        const body = `${src.alias}.EFFDT =\n        (SELECT MAX(${ed}.EFFDT) FROM ${src.table} ${ed}\n        WHERE ${[...others, `${ed}.EFFDT <= SYSDATE`].join('\n          AND ')})`;
        return number(src.record.RCDNUM) === 1 ? body : `( ${body} )`;
      }
      let right = '';
      if ([16,17].includes(cond)) { if (exprtype !== 0) refuse('This null criterion is not calibrated.'); }
      else if ([10,11].includes(cond)) {
        if (exprtype !== 9 || type !== 0) refuse('Only Const-Const between on character fields is calibrated.');
        right = ` ${constant(expression('R1'))} AND ${constant(expression('R2'))}`;
      } else if ([8,9].includes(cond)) {
        if (exprtype === 4) right = ` ${subquery()}`;
        else {
          const list = expression('R1');
          if (exprtype !== 5 || type !== 0 || !LIST.test(list)) refuse('Only constant character lists are calibrated.');
          right = ` ${list}`;
        }
      } else if (exprtype === 1) right = ` ${constant(expression('R1'))}`;
      else if (exprtype === 3) {
        // qex03: an expression operand is its text.
        if (![0,2].includes(type ?? -1) || [14,15].includes(cond)) refuse('Expression operands are calibrated for comparing character and number fields.');
        right = ` ${detokenized(expression('R1')).trim()}`;
      } else if (exprtype === 2) {
        const other = fieldAt(c.R1CRTSELNUM,c.R1CRTFLDNUM);
        // qsq02: a subquery criterion may compare with its parent select's field.
        if (number(c.R1CRTSELNUM) !== sel && !(typeOfSelect(sel) === 2 && number(c.R1CRTSELNUM) === number(selects[sel-1].PARENTSELNUM))) refuse('Criterion references a field of another select.');
        if (type !== 0 || typeOf(other) !== 0 || [14,15].includes(cond) || number(other.FLDEXPNUM)) refuse('Only character field comparisons are calibrated.');
        right = ` ${rawSql(other)}`;
      } else if (exprtype === 8) {
        const match = /^:([1-9][0-9]*)$/.exec(text(expression('R1')));
        if (!match) refuse('Unsupported prompt expression.');
        const prompt = view.binds.find(b => number(b.BNDNUM) === Number(match[1]));
        if (!prompt || number(prompt.FIELDTYPE) !== type || type === 0 && ![0,6].includes(number(prompt.FORMAT)) || type !== 0 && (number(prompt.FORMAT) || number(prompt.DECIMALPOS))
          || type !== 0 && [14,15].includes(cond)) refuse('This prompt type or format is not calibrated.');
        if (![0,16384].includes(number(prompt.USEEDIT))) refuse('This prompt edit type is not calibrated.');
        if (!prompts.includes(prompt)) prompts.push(prompt);
        // qnm03: a date prompt is converted from its YYYY-MM-DD input.
        right = type === 4 ? ` TO_DATE(:${match[1]},'YYYY-MM-DD')` : ` :${match[1]}`;
      } else refuse('This criterion operand type is not calibrated.');
      if (exprtype === 1 && type !== 0 && [14,15].includes(cond)) refuse('Like is calibrated for character fields only.');
      return `${'( '.repeat(number(c.LPARENLVL))}${negation ? 'NOT ' : ''}${left} ${OPERATORS[cond]}${right}${')'.repeat(number(c.RPARENLVL))}`;
    };
    const rendered = where.map((c,i) => ({ c, sql: criterionSql(c,i,false) }));
    // FROM: a list, except the left outer join of the second record with its ON criteria (qjn03).
    let from = `${records[0].table} ${records[0].alias}`;
    for (const src of records.slice(1)) {
      if (src.join !== 5) { from += `, ${src.table} ${src.alias}`; continue; }
      const on = rendered.filter(r => number(r.c.QRYOJSELNUM) === number(src.record.RCDNUM));
      if (!on.length || on.some(r => number(r.c.LPARENLVL) || number(r.c.RPARENLVL))) refuse('Left outer joins need ungrouped ON criteria.');
      from = `(${from} LEFT OUTER JOIN  ${src.table} ${src.alias} ON  ${on.map((r,i) => `${i ? `${number(r.c.COMBTYPE) === 2 ? 'OR' : 'AND'} ` : ''}${r.sql}`).join(' ')} )`;
    }
    if (rendered.some(r => number(r.c.QRYOJSELNUM) && !records.some(src => src.join === 5 && number(src.record.RCDNUM) === number(r.c.QRYOJSELNUM)))) refuse('ON criteria reference a record that is not outer joined.');
    // WHERE: related-record joins first (qjn04 `C.ESTABID = A.ESTABID`), translate dating (qxl01), then the criteria.
    const clauses: string[] = [];
    for (const src of records.filter(s => s.join === 3)) {
      const joining = fieldAt(sel,src.record.JOINFLDNUM), keys = (src.ctx.keys ?? refuse('Record keys are needed for related joins.')).filter(k => k !== 'EFFDT');
      if (keys.length !== 1 || keys[0] !== text(joining.FIELDNAME) || number(joining.FLDRCDNUM) !== number(src.record.JOINRCDNUM)) refuse('Related-record joins are calibrated for a prompt record keyed by the joining field.');
      clauses.push(`${src.alias}.${identifier(keys[0])} = ${rawSql(joining)}`);
    }
    for (const field of columns.filter(f => number(f.XLATTYPE) !== 1)) {
      const x = `${records[0].alias}${number(field.COLUMNNUM)}X`, name = identifier(field.FIELDNAME);
      if (number(field.XLATEXPRTYPE) === 2) {
        from += ` LEFT OUTER JOIN PSXLATITEM ${x} ON ${x}.FIELDNAME='${name}' AND ${x}.FIELDVALUE=${rawSql(field)} AND ${x}.EFF_STATUS = 'A'`;
        clauses.push(`(${x}.EFFDT = (SELECT MAX(EFFDT) FROM PSXLATITEM TB WHERE TB.FIELDNAME=${x}.FIELDNAME AND TB.FIELDVALUE=${x}.FIELDVALUE AND  TB.EFF_STATUS = 'A' AND TB.EFFDT <=  ${rawSql(fieldAt(sel,field.XLATFLDNUM))}) OR ${x}.EFFDT is NULL)`);
      } else {
        from += ` LEFT OUTER JOIN ( SELECT * FROM PSXLATITEM TA WHERE TA.FIELDNAME='${name}' AND TA.EFF_STATUS = 'A' AND TA.EFFDT = (SELECT MAX(EFFDT) FROM PSXLATITEM TB WHERE TB.FIELDNAME='${name}' AND TA.FIELDVALUE=TB.FIELDVALUE AND  TB.EFF_STATUS = 'A' AND\nTB.EFFDT <= ${SYSDATE_DAY})) ${x} ON ${x}.FIELDVALUE = ${rawSql(field)} AND ${x}.FIELDNAME='${name}'`;
      }
    }
    const conditions = (list: Array<{c: Row; sql: string}>, joined: string[]) => {
      let depth = 0;
      for (const r of list) {
        depth += number(r.c.LPARENLVL);
        if (depth - number(r.c.RPARENLVL) < 0) refuse('Criteria parentheses do not balance.');
        depth -= number(r.c.RPARENLVL);
        joined.push(`${joined.length ? `${[2,5].includes(number(r.c.COMBTYPE)) ? 'OR' : 'AND'} ` : ''}${r.sql}`);
      }
      if (depth) refuse('Criteria parentheses do not balance.');
      return joined.map((w,i) => i && !/^(AND|OR) /.test(w) ? `AND ${w}` : w).join('\n     ');
    };
    const whereSql = conditions(rendered.filter(r => !number(r.c.QRYOJSELNUM)), clauses);
    const distinct = text(selects[sel-1].QRYDISTINCT);
    if (distinct && (distinct !== 'Y' || kind === 2)) refuse('This DISTINCT setting is not calibrated.');
    const lines = [`SELECT ${distinct ? 'DISTINCT ' : ''}${columns.map(columnSql).join(',')}`, `FROM ${from}`];
    // qsq02: a subquery's WHERE is not parenthesized.
    if (whereSql) lines.push(kind === 2 ? `WHERE ${whereSql}` : `WHERE ( ${whereSql})`);
    // qag01-qag05: GROUP BY the columns that are not aggregated, HAVING its criteria.
    if (columns.some(f => number(f.TTLTYPE) !== 1)) {
      const groups = columns.filter(f => number(f.TTLTYPE) === 1).map(f => {
        if (number(f.XLATTYPE) !== 1) refuse('Translated columns with aggregates are not calibrated.');
        return number(f.FLDEXPNUM) ? detokenized(expressionOf(f.FLDEXPNUM).EXPRESSIONTEXT).trim() : rawSql(f);
      });
      if (groups.length) lines.push(`GROUP BY  ${groups.join(', ')}`);
    }
    if (having.length) {
      if (kind !== 1 || !columns.some(f => number(f.TTLTYPE) !== 1)) refuse('HAVING needs an aggregate column.');
      lines.push(`HAVING ( ${conditions(having.map((c,i) => ({ c, sql: criterionSql(c,i,true) })),[])})`);
    }
    if (kind !== 1 && fields.some(f => number(f.ORDERBYNUM))) refuse('Ordering a subquery or union select is not calibrated.');
    return { sql: lines.join('\n'), columns };
  };
  const top = compile(1);
  const parts = [top.sql];
  // qun01: each union select follows `UNION` with the same number and types of columns.
  for (const sel of selects.filter(x => number(x.SELECTTYPE) === 3)) {
    const plan = compile(number(sel.SELNUM));
    if (plan.columns.length !== top.columns.length || plan.columns.some((f,i) => typeOf(f) !== typeOf(top.columns[i]))) refuse('Union selects need matching columns.');
    parts.push(plan.sql);
  }
  for (const sel of selects.filter(x => number(x.SELECTTYPE) === 2)) if (!view.criteria.some(c => number(c.EXPRTYPE) === 4 && number(c.R1CRTSELNUM) === number(sel.SELNUM))) refuse('A subquery is not used by any criterion.');
  const lines = [parts.join('\nUNION\n')];
  const columns = top.columns;
  const ordering = view.fields.filter(f => number(f.SELNUM) === 1 && number(f.ORDERBYNUM) > 0).sort((a,b) => number(a.ORDERBYNUM)-number(b.ORDERBYNUM));
  if (ordering.some((f,i) => number(f.ORDERBYNUM) !== i+1)) refuse('Order By positions must be consecutive.');
  if (ordering.length) lines.push(`ORDER BY ${ordering.map(f => {
    if (!columns.includes(f)) refuse('Ordering by hidden fields is not calibrated yet.');
    const direction = text(f.ORDERBYDIR);
    if (!['A','D'].includes(direction)) refuse('Unknown sort direction.');
    return `${number(f.COLUMNNUM)}${direction === 'D' ? ' DESC' : ''}`;
  }).join(',')}`);
  return { sql: lines.join('\n'), columns, prompts };
}

/** Runtime input is separate from SQL; unused saved prompts are not requested (qry10 native run). */
export function bindQueryPrompts(plan: QuerySqlPlan, values: Record<string,string>): Record<string,string> {
  const binds: Record<string,string> = {};
  for (const prompt of plan.prompts) {
    const key = String(number(prompt.BNDNUM));
    if (!Object.hasOwn(values,key)) throw new Error(`Enter ${text(prompt.HEADING) || text(prompt.BNDNAME)}.`);
    const value = values[key];
    if (!value.trim()) throw new QueryUnsupportedError('Blank runtime prompt binding is not calibrated yet. Enter a nonblank value.');
    if (number(prompt.FIELDTYPE) === 2 && !/^-?[0-9]+$/.test(value.trim())) throw new Error(`${text(prompt.HEADING) || text(prompt.BNDNAME)}: enter a whole number.`);
    if (number(prompt.FIELDTYPE) === 4 && !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) throw new Error(`${text(prompt.HEADING) || text(prompt.BNDNAME)}: enter a date as YYYY-MM-DD.`);
    if (value.length > number(prompt.LENGTH)) throw new Error(`${text(prompt.BNDNAME)} exceeds its ${number(prompt.LENGTH)} character length.`);
    binds[key] = number(prompt.FIELDTYPE) !== 0 ? value.trim() : number(prompt.FORMAT) === 0 ? value.toUpperCase() : value;
  }
  return binds;
}
