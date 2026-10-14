import type { QueryView, Row } from './queryDefinition.js';

/** Deliberately bounded to the single-record character queries captured in HRDMO. */
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

/** SQL follows qry01, qry03, qry08, qry09 and qry10; unsupported shapes never produce partial SQL. */
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
    if (context.fields[name]?.type !== 0) refuse(`${name}: execution is currently calibrated for character fields.`);
    if (number(field.TTLTYPE) !== 1 || number(field.GROUPBYNUM) || number(field.SUBTTLNUM)
      || number(field.XLATTYPE) !== 1 || text(field.AGGREGATEFUNC)) refuse('Aggregate and translate SQL is not supported yet.');
    return `${alias}.${name}`;
  };
  for (const field of view.fields) fieldSql(field);
  const columns = view.fields.filter(f => number(f.COLUMNNUM) > 0).sort((a,b) => number(a.COLUMNNUM)-number(b.COLUMNNUM));
  if (!columns.length) refuse('Select at least one output field.');
  if (new Set(columns.map(f => text(f.FIELDNAME))).size !== columns.length) refuse('Duplicate output fields are not supported yet.');
  if (columns.some((f,i) => number(f.COLUMNNUM) !== i+1)) refuse('Output column positions must be consecutive.');
  const lines = [`SELECT ${columns.map(fieldSql).join(',')}`, `FROM ${table} ${alias}`];
  const prompts: Row[] = [];
  if (view.criteria.length > 1) refuse('Multiple criteria are not calibrated yet.');
  for (const c of view.criteria) {
    if (number(c.SELNUM) !== 1 || number(c.LCRTSELNUM) !== 1 || number(c.CONDTYPE) !== 2 || number(c.COMBTYPE) !== 3
      || number(c.LPARENLVL) || number(c.RPARENLVL) || text(c.NEGATION) || number(c.QRYOJSELNUM)
      || number(c.R1CRTFLDNUM) || number(c.R1CRTSELNUM) || number(c.R2CRTSELNUM) || number(c.R2CRTFLDNUM) || number(c.R2CRTEXPNUM)) {
      refuse('Only an ungrouped equal-to constant or prompt criterion is calibrated.');
    }
    const field = view.fields.find(f => number(f.SELNUM) === 1 && number(f.FLDNUM) === number(c.LCRTFLDNUM));
    if (!field) refuse('Criterion references a missing field.');
    const expr = view.expressions.find(e => number(e.EXPNUM) === number(c.R1CRTEXPNUM));
    if (!expr) refuse('Criterion references a missing expression.');
    let right: string;
    if (number(c.EXPRTYPE) === 1) right = `'${String(expr.EXPRESSIONTEXT ?? '').replace(/'/g, "''")}'`;
    else if (number(c.EXPRTYPE) === 8) {
      const match = /^:([1-9][0-9]*)$/.exec(text(expr.EXPRESSIONTEXT));
      if (!match) refuse('Unsupported prompt expression.');
      const prompt = view.binds.find(b => number(b.BNDNUM) === Number(match[1]));
      if (!prompt || number(prompt.FIELDTYPE) !== 0 || ![0,6].includes(number(prompt.FORMAT))) refuse('Only captured uppercase or mixed-case character prompts are supported.');
      if (![0,16384].includes(number(prompt.USEEDIT))) refuse('This prompt edit type is not calibrated.');
      prompts.push(prompt);
      right = `:${match[1]}`;
    } else refuse('This criterion operand type is not calibrated.');
    lines.push(`WHERE ( ${fieldSql(field)} = ${right})`);
  }
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
    if (value.length > number(prompt.LENGTH)) throw new Error(`${text(prompt.BNDNAME)} exceeds its ${number(prompt.LENGTH)} character length.`);
    binds[key] = number(prompt.FORMAT) === 0 ? value.toUpperCase() : value;
  }
  return binds;
}
