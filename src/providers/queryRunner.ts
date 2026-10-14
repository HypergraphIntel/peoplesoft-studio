import type { DbConnection } from '../db/connection.js';
import { compileQuerySql, bindQueryPrompts, QueryUnsupportedError, type QuerySqlPlan } from '../model/querySql.js';
import type { QueryView } from '../model/queryDefinition.js';
import { operatorExists } from './peopleCodeWriter.js';
import { tableName } from '../model/recordDdl.js';

const text = (v: unknown) => String(v ?? '').trim();
const identifier = (name: string) => {
  if (!/^[A-Z][A-Z0-9_$#]*$/.test(name)) throw new QueryUnsupportedError('Unsupported query table or field name.');
  return name;
};

/** Role grants and group/record nodes directly observed in HRDMO's Query access tree. */
export async function requireQueryRecordAccess(c: DbConnection, operator: string, record: string): Promise<void> {
  const grants = (await c.execute<{ ACCESSIBLE: string }>(`SELECT DISTINCT G.ACCESSIBLE
    FROM PSROLEUSER U JOIN PSROLECLASS C ON C.ROLENAME=U.ROLENAME
    JOIN PS_SCRTY_ACC_GRP G ON G.CLASSID=C.CLASSID
    JOIN PSTREENODE A ON A.TREE_NAME=G.TREE_NAME AND A.TREE_NODE=G.ACCESS_GROUP AND A.TREE_NODE_TYPE='G'
    JOIN PSTREEDEFN D ON D.SETID=A.SETID AND D.SETCNTRLVALUE=A.SETCNTRLVALUE AND D.TREE_NAME=A.TREE_NAME AND D.EFFDT=A.EFFDT
    JOIN PSTREENODE N ON N.SETID=A.SETID AND N.SETCNTRLVALUE=A.SETCNTRLVALUE AND N.TREE_NAME=A.TREE_NAME
      AND N.EFFDT=A.EFFDT AND N.TREE_NODE_NUM BETWEEN A.TREE_NODE_NUM AND A.TREE_NODE_NUM_END
    WHERE U.ROLEUSER=:o AND N.TREE_NODE=:r AND N.TREE_NODE_TYPE='R'
      AND D.EFF_STATUS='A' AND D.VALID_TREE='Y' AND D.TREE_STRCT_ID='ACCESS_GROUP'
      AND D.LEAF_COUNT=0 AND D.TREE_HAS_RANGES='N' AND D.DUPLICATE_LEAF='N'
      AND N.TREE_BRANCH=' ' AND A.TREE_BRANCH=' '
      AND N.EFFDT=(SELECT MAX(X.EFFDT) FROM PSTREEDEFN X WHERE X.SETID=N.SETID
        AND X.SETCNTRLVALUE=N.SETCNTRLVALUE AND X.TREE_NAME=N.TREE_NAME AND X.EFFDT<=SYSDATE)`,
  { o: operator, r: record })).rows ?? [];
  if (!grants.length) throw new Error(`${operator} has no established Query access grant for ${record}.`);
  // Do not guess deny precedence for overlapping access groups.
  if (grants.some(g => text(g.ACCESSIBLE) !== 'Y')) throw new QueryUnsupportedError(`${record}: conflicting or unsupported Query access grants.`);
}

interface RecordInfo { RECNAME: string; QRYSECRECNAME: string; SQLTABLENAME: string; RECTYPE: number }
async function recordInfo(c: DbConnection, name: string): Promise<RecordInfo> {
  const [record] = (await c.execute<RecordInfo>('SELECT RECNAME,QRYSECRECNAME,SQLTABLENAME,RECTYPE FROM PSRECDEFN WHERE RECNAME=:r', { r: name })).rows ?? [];
  if (!record) throw new Error(`No record named ${name}.`);
  return record;
}

export async function prepareQueryExecution(c: DbConnection, view: QueryView, operator: string): Promise<QuerySqlPlan> {
  if (!operator.trim() || !(await operatorExists(c,operator))) throw new Error('Set a valid PeopleSoft Operator ID before running PS Query.');
  const owner = text(view.query.OPRID);
  if (owner && owner !== operator) throw new Error('Only public queries and your own private queries can be run.');
  if (view.records.length !== 1) throw new QueryUnsupportedError('Joins and multiple-record queries are not calibrated yet.');
  const name = text(view.records[0].RECNAME);
  await requireQueryRecordAccess(c,operator,name);
  const record = await recordInfo(c,name);
  const fields = (await c.execute<{FIELDNAME:string; FIELDTYPE:number}>(`SELECT F.FIELDNAME,D.FIELDTYPE
    FROM PSRECFIELD F JOIN PSDBFIELD D ON D.FIELDNAME=F.FIELDNAME WHERE F.RECNAME=:r`, { r:name })).rows ?? [];
  return compileQuerySql(view, {
    record:name, table:tableName({name,sqlTableName:record.SQLTABLENAME}), recordType:Number(record.RECTYPE),
    querySecurityRecord:text(record.QRYSECRECNAME), fields:Object.fromEntries(fields.map(f => [text(f.FIELDNAME),{type:Number(f.FIELDTYPE)}]))
  });
}

/** Captured Prompt Table edit: validate the bound value through an unsecured, granted record. */
export async function validateQueryPromptValues(c: DbConnection, plan: QuerySqlPlan, operator: string, values: Record<string,string>): Promise<Record<string,string>> {
  const binds = bindQueryPrompts(plan,values);
  for (const prompt of plan.prompts) {
    if (Number(prompt.USEEDIT) !== 16384) continue;
    const name = text(prompt.EDITTABLE);
    if (!name) throw new QueryUnsupportedError('Prompt Table edit needs a prompt table.');
    await requireQueryRecordAccess(c,operator,name);
    const record = await recordInfo(c,name);
    if (text(record.QRYSECRECNAME) || ![0,1].includes(Number(record.RECTYPE))) {
      throw new QueryUnsupportedError('This prompt table requires unsupported security or record semantics.');
    }
    const field = identifier(text(prompt.FIELDNAME));
    const fields=(await c.execute<{FIELDNAME:string;USEEDIT:number;SETCNTRLFLD:string}>('SELECT FIELDNAME,USEEDIT,SETCNTRLFLD FROM PSRECFIELD WHERE RECNAME=:r',{r:name})).rows ?? [];
    if(fields.some(f=>text(f.SETCNTRLFLD) || (Number(f.USEEDIT)&1) && ![field,'EFFDT'].includes(text(f.FIELDNAME))))throw new QueryUnsupportedError('Set-controlled or composite-key prompt lookup is not calibrated.');
    if (!fields.some(f=>text(f.FIELDNAME)===field)) throw new QueryUnsupportedError('Prompt field is not in its prompt table.');
    const table = identifier(tableName({name,sqlTableName:record.SQLTABLENAME}));
    const rows = (await c.execute(`SELECT ${field} FROM ${table} WHERE ${field}=:v AND ROWNUM<=1`, {v:binds[String(Number(prompt.BNDNUM))]})).rows ?? [];
    if (!rows.length) throw new Error(`${text(prompt.HEADING) || text(prompt.BNDNAME)} is not a valid prompt-table value.`);
  }
  return binds;
}
