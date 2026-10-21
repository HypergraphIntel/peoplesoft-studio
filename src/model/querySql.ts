import type { QueryView, Row } from './queryDefinition.js';

/** Deliberately bounded to the single-record character, number and date queries captured in HRDMO. */
export interface QuerySqlContext {
  record: string;
  table: string;
  recordType: number;
  querySecurityRecord: string;
  fields: Record<string, { type: number }>;
}

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
  14:'LIKE',15:'NOT LIKE',16:'IS NULL',17:'IS NOT NULL'};
const quoted=(v: unknown)=>`'${String(v ?? '').replace(/'/g, "''")}'`;
const LIST=/^\('(?:[^']|'')*'(?:,'(?:[^']|'')*')*\)$/;

/** SQL follows qry01-qry10, qcr01-qcr10 and qnm01-qnm04; unsupported shapes never produce partial SQL. */
export function compileQuerySql(view: QueryView, context: QuerySqlContext): QuerySqlPlan {
  if (number(view.query.QRYTYPE) !== 1) refuse('Only User queries are supported for execution.');
  if (text(view.query.QRYDISABLED) === 'Y' || number(view.query.QRYDISABLED) === 1) refuse('This query is disabled.');
  if (view.selects.length !== 1 || number(view.selects[0].SELECTTYPE) !== 1 || number(view.selects[0].SELNUM) !== 1
    || number(view.selects[0].PARENTSELNUM) || number(view.selects[0].HAVECRTCOUNT)) refuse('Subqueries, unions and HAVING are not supported yet.');
  if (text(view.selects[0].QRYDISTINCT)) refuse('DISTINCT execution has not been calibrated yet.');
  if (view.records.length !== 1 || number(view.records[0].SELNUM) !== 1 || number(view.records[0].JOINTYPE) !== 1
    || number(view.records[0].JOINRCDNUM) || number(view.records[0].JOINFLDNUM)) refuse('Joins are not supported yet.');
  if (context.recordType !== 0) refuse('Execution is currently calibrated for SQL Table records.');
  if (context.querySecurityRecord.trim()) refuse('This record requires query row security; that SQL is not calibrated yet.');
  const record = view.records[0];
  if (text(record.RECNAME) !== context.record) refuse('Query record metadata does not match.');
  const alias = identifier(record.CORRNAME);
  const table = identifier(context.table);
  const rcd = number(record.RCDNUM);
  const fieldSql = (field: Row) => {
    if (number(field.SELNUM) !== 1 || number(field.FLDRCDNUM) !== rcd || number(field.FLDEXPNUM)) refuse('Expression columns are not supported yet.');
    const name = identifier(field.FIELDNAME);
    if (![0,2,4].includes(context.fields[name]?.type ?? -1)) refuse(`${name}: execution is calibrated for character, number and date fields.`);
    if (number(field.TTLTYPE) !== 1 || number(field.GROUPBYNUM) || number(field.SUBTTLNUM)
      || number(field.XLATTYPE) !== 1 || text(field.AGGREGATEFUNC)) refuse('Aggregate and translate SQL is not supported yet.');
    return `${alias}.${name}`;
  };
  // qnm01: a selected date is TO_CHAR(A.START_DT,'YYYY-MM-DD').
  const columnSql = (field: Row) => context.fields[text(field.FIELDNAME)].type === 4 ? `TO_CHAR(${fieldSql(field)},'YYYY-MM-DD')` : fieldSql(field);
  for (const field of view.fields) fieldSql(field);
  const columns = view.fields.filter(f => number(f.COLUMNNUM) > 0).sort((a,b) => number(a.COLUMNNUM)-number(b.COLUMNNUM));
  if (!columns.length) refuse('Select at least one output field.');
  if (new Set(columns.map(f => text(f.FIELDNAME))).size !== columns.length) refuse('Duplicate output fields are not supported yet.');
  if (columns.some((f,i) => number(f.COLUMNNUM) !== i+1)) refuse('Output column positions must be consecutive.');
  const lines = [`SELECT ${columns.map(columnSql).join(',')}`, `FROM ${table} ${alias}`];
  const prompts: Row[] = [];
  const criteria = [...view.criteria].sort((a,b) => number(a.CRTNUM)-number(b.CRTNUM));
  let depth = 0;
  criteria.forEach((c, i) => {
    const cond = number(c.CONDTYPE), exprtype = number(c.EXPRTYPE), negation = text(c.NEGATION);
    if (number(c.SELNUM) !== 1 || number(c.LCRTSELNUM) !== 1 || number(c.CRTNUM) !== i+1 || number(c.QRYOJSELNUM)
      || !(cond in OPERATORS) || number(c.COMBTYPE) !== (i ? number(c.COMBTYPE) : 3) || ![1,2,3].includes(number(c.COMBTYPE)) || i && number(c.COMBTYPE) === 3
      || negation && negation !== 'N') refuse('This criterion shape is not calibrated.');
    const field = view.fields.find(f => number(f.SELNUM) === 1 && number(f.FLDNUM) === number(c.LCRTFLDNUM));
    if (!field) refuse('Criterion references a missing field.');
    const type = context.fields[text(field.FIELDNAME)]?.type;
    const expression = (side: 'R1'|'R2') => {
      const expr = view.expressions.find(e => number(e.EXPNUM) === number(c[`${side}CRTEXPNUM`]));
      if (!expr) refuse('Criterion references a missing expression.');
      return text(expr.EXPRESSIONTEXT) ? String(expr.EXPRESSIONTEXT) : ' ';
    };
    // Constants: character quoted, number bare (qnm01), date TO_DATE (qnm02).
    const constant = (value: string) => type === 2 ? (/^-?[0-9]+(\.[0-9]+)?$/.test(value) ? value : refuse('Invalid numeric constant.'))
      : type === 4 ? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? `TO_DATE('${value}','YYYY-MM-DD')` : refuse('Invalid date constant.')) : quoted(value);
    let right = '';
    if ([16,17].includes(cond)) { if (exprtype !== 0) refuse('This null criterion is not calibrated.'); }
    else if ([10,11].includes(cond)) {
      if (exprtype !== 9 || type !== 0) refuse('Only Const-Const between on character fields is calibrated.');
      right = ` ${constant(expression('R1'))} AND ${constant(expression('R2'))}`;
    } else if ([8,9].includes(cond)) {
      const list = expression('R1');
      if (exprtype !== 5 || type !== 0 || !LIST.test(list)) refuse('Only constant character lists are calibrated.');
      right = ` ${list}`;
    } else if (exprtype === 1) right = ` ${constant(expression('R1'))}`;
    else if (exprtype === 2) {
      const other = view.fields.find(f => number(f.SELNUM) === 1 && number(c.R1CRTSELNUM) === 1 && number(f.FLDNUM) === number(c.R1CRTFLDNUM));
      if (!other || type !== 0 || context.fields[text(other.FIELDNAME)]?.type !== 0 || [14,15].includes(cond)) refuse('Only character field comparisons are calibrated.');
      right = ` ${fieldSql(other)}`;
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
    depth += number(c.LPARENLVL);
    if (depth - number(c.RPARENLVL) < 0) refuse('Criteria parentheses do not balance.');
    depth -= number(c.RPARENLVL);
    const body = `${'( '.repeat(number(c.LPARENLVL))}${negation ? 'NOT ' : ''}${fieldSql(field)} ${OPERATORS[cond]}${right}${')'.repeat(number(c.RPARENLVL))}`;
    lines.push(i ? `     ${number(c.COMBTYPE) === 2 ? 'OR' : 'AND'} ${body}` : `WHERE ( ${body}`);
  });
  if (depth) refuse('Criteria parentheses do not balance.');
  if (criteria.length) lines[lines.length-1] += ')';
  const ordering = view.fields.filter(f => number(f.ORDERBYNUM) > 0).sort((a,b) => number(a.ORDERBYNUM)-number(b.ORDERBYNUM));
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
