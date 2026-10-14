import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type { DbConnection, DbTypes, DbBinds } from '../db/connection.js';
import { ibDocument, ibIdentity, ibServiceClassification, validateIbDocument, type IbDocument, type IbKind, type IbSummary, type IbDiagnostic } from '../model/ibDocument.js';
import { isSecretProperty } from '../model/miscDefinitions.js';
import type { Row } from '../model/ibDefinitions.js';
import { TIMESTAMP_FORMAT } from './peopleCodeWriter.js';

const trim = (v: unknown) => String(v ?? '').trim();
const TABLES = {
  message: { table: 'PSMSGDEFN', keys: ['MSGNAME'] },
  document: { table: 'PSLSDEFN', keys: ['IB_PACKAGEID', 'IB_SCHEMANAME', 'IB_VARIANTNAME'] },
  service: { table: 'PSSERVICE', keys: ['IB_SERVICENAME'] },
  operation: { table: 'PSOPERATION', keys: ['IB_OPERATIONNAME'] },
  node: { table: 'PSMSGNODEDEFN', keys: ['MSGNODENAME'] },
  routing: { table: 'PSIBRTNGDEFN', keys: ['ROUTINGDEFNNAME', 'EFFDT'] }
} as const;
export async function rows(c: DbConnection, types: DbTypes, sql: string, binds: DbBinds = {}): Promise<Row[]> {
  return (await c.execute<Row>(sql, binds, { outFormat: types.OUT_FORMAT_OBJECT, fetchTypeHandler: (m: { dbType?: unknown }) =>
    m.dbType === types.DB_TYPE_CLOB || m.dbType === types.DB_TYPE_NCLOB ? { type: types.STRING } : undefined })).rows ?? [];
}
/** Only internal allowlisted tables reach this helper. Password columns are excluded before SELECT. */
export async function safeRows(c: DbConnection, types: DbTypes, table: string, where: string, binds: DbBinds, order = ''): Promise<Row[]> {
  const columns = await c.catalog.columns(c, table);
  if (!columns.length) return [];
  const selected = columns.filter(col => (!isSecretProperty(col.name) || ['TOKENTYPE','TOKEN_ENCRYPTED','TOKEN_SIGNED','IB_USERPWDREQ','IB_EXCLUDE_TOKEN','CHECKTOKENID','IB_ISPRIVATE'].includes(col.name)) && col.name !== 'IB_ZIPDATA').map(col =>
    col.name === 'EFFDT' ? "TO_CHAR(EFFDT,'YYYY-MM-DD') AS EFFDT" : /TIMESTAMP/.test(col.dataType) ? `TO_CHAR(${col.name},${TIMESTAMP_FORMAT}) AS ${col.name}` : col.name);
  return rows(c, types, `SELECT ${selected.join(',')} FROM ${table} WHERE ${where}${order ? ' ORDER BY ' + order : ''}`, binds);
}
export async function propertyRows(c: DbConnection, types: DbTypes, table: string, where: string, binds: Record<string,unknown>, identity: string[]): Promise<Row[]> {
  const columns = await c.catalog.columns(c,table);
  if (!columns.length) return [];
  const selected = columns.filter(col => col.name !== 'PROPVALUE').map(col => col.name === 'EFFDT' ? "TO_CHAR(EFFDT,'YYYY-MM-DD') AS EFFDT" : col.name);
  const properties = await rows(c,types,`SELECT ${selected.join(',')} FROM ${table} WHERE ${where} ORDER BY ${identity.join(',')}`,binds);
  const result: Row[] = [];
  for (const property of properties) {
    if (isSecretProperty(trim(property.PROPID)) || isSecretProperty(trim(property.PROPNAME))) result.push({...property,PROPVALUE:'(not read)'});
    else {
      const extra = Object.fromEntries(identity.map((k,i)=>['p'+i,property[k]]));
      const predicates = identity.map((k,i)=> k + (k === 'EFFDT' ? `=TO_DATE(:p${i},'YYYY-MM-DD')` : `=:p${i}`));
      const [value] = await rows(c,types,`SELECT PROPVALUE FROM ${table} WHERE ${where} AND ${predicates.join(' AND ')}`,{...binds,...extra});
      result.push({...property,PROPVALUE:value?.PROPVALUE});
    }
  }
  return result;
}
export async function listIb(c: DbConnection, types: DbTypes, kind: IbKind, query: string, offset = 0, filter?: 'standard' | 'rest', role?: 'consumer' | 'provider') {
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new Error('Invalid page offset.');
  if ((filter || role) && kind !== 'service' && kind !== 'operation') throw new Error('Service-kind and REST-role filters apply only to services and operations.');
  if (role && filter === 'standard') throw new Error('A standard service has no REST role.');
  const { table, keys } = TABLES[kind];
  const selected = keys.map(k => k === 'EFFDT' ? "TO_CHAR(EFFDT,'YYYY-MM-DD') AS EFFDT" : k);
  const flags = kind === 'service' || kind === 'operation';
  const flagWhere = role ? ` AND IB_REST_SERVICE=${role === 'consumer' ? 1 : 2}` : filter ? ` AND IB_REST_SERVICE${filter === 'rest' ? ' IN (1,2)' : '=0'}` : '';
  const result = await rows(c, types, `SELECT ${selected.join(',')},DESCR${flags ? ',IB_REST_SERVICE' : ''} FROM ${table}
    WHERE (${keys.filter(k => k !== 'EFFDT').map(k => `UPPER(${k}) LIKE :q`).join(' OR ')} OR UPPER(DESCR) LIKE :q)${flagWhere}
    ORDER BY ${keys.join(',')} OFFSET ${offset} ROWS FETCH NEXT 101 ROWS ONLY`, { q: '%' + query.toUpperCase() + '%' });
  const items: IbSummary[] = result.slice(0,100).map(r => ({ key: keys.map(k => trim(r[k])), name: keys.map(k => trim(r[k])).join(' / '), description: trim(r.DESCR), ...(flags ? ibServiceClassification(r.IB_REST_SERVICE) : {}) }));
  return { items, offset, more: result.length > 100 };
}

export async function readIb(c: DbConnection, types: DbTypes, kind: IbKind, key: string[]): Promise<IbDocument | undefined> {
  ibIdentity(kind, key);
  const { table, keys } = TABLES[kind];
  const binds = Object.fromEntries(key.map((v,i) => ['k'+i,v]));
  const where = keys.map((col,i) => col + (col === 'EFFDT' ? `=TO_DATE(:k${i},'YYYY-MM-DD')` : `=:k${i}`)).join(' AND ');
  const [properties] = await safeRows(c,types,table,where,binds);
  if (!properties) return undefined;
  const sections: Record<string,Row[]> = {};
  const add = async (name: string, table: string, where: string, binds: DbBinds, order = '') => { sections[name] = await safeRows(c,types,table,where,binds,order); };
  if (kind === 'message') {
    for (const [name,table,order] of [['versions','PSMSGVER','APMSGVER'],['records','PSMSGREC','APMSGVER,SEQNO,RECNAME'],['fields','PSMSGFLDOVR','APMSGVER,RECNAME,SEQNO,FIELDNAME'],['parts','PSMSGPARTS','APMSGVER,SEQNO'],['attributes','PSMSGATTR','APMSGVER,IB_ATTRIBUTENAME'],['operations','PSOPRVERDFNPARM','IB_OPERATIONNAME,VERSIONNAME,PARAMETERNAME']] as const) await add(name,table,'MSGNAME=:n',{n:key[0]},order);
  } else if (kind === 'service') {
    sections.operations = await rows(c,types,`SELECT O.IB_OPERATIONNAME,O.DESCR,O.IB_ALIASNAME,O.RTNGTYPE,O.DEFAULTVER,O.IB_REST_SERVICE,O.IB_RESTMETHOD
      FROM PSSERVICEOPR S LEFT JOIN PSOPERATION O ON O.IB_OPERATIONNAME=S.IB_OPERATIONNAME WHERE S.IB_SERVICENAME=:n ORDER BY S.IB_OPERATIONNAME`,{n:key[0]});
  } else if (kind === 'operation') {
    await add('service','PSSERVICE','IB_SERVICENAME=:n',{n:trim(properties.IB_SERVICENAME)});
    for (const [name,table,order] of [['versions','PSOPRVERDFN','VERSIONNAME'],['parameters','PSOPRVERDFNPARM','VERSIONNAME,PARAMETERNAME'],['handlers','PSOPRHDLR','SEQNO,HANDLERNAME'],['applicationClassHandlers','PSOPERATIONAC','HANDLERNAME'],['applicationEngineHandlers','PSOPERATIONAE','HANDLERNAME'],['componentInterfaceHandlers','PSOPERATIONCI','HANDLERNAME'],['dataMoverHandlers','PSOPERATIONDMS','HANDLERNAME,SEQNO'],['uriTemplates','PSOPERATIONURI','IB_URI_SEQ'],['uriMessages','PSOPRURIDATA','IB_URI_SEQ,IB_DIRECTION,IB_HTTP_STATUS_CD'],['uriRoots','PSIBOPRROOT','PTIBURLPARAMNAME'],['contentTypes','PSOPRVDCONTTYPE','VERSIONNAME,PARAMETERNAME,IB_HTTP_STATUS_CD'],['queueParameters','PSOPRVERQUEPARM','VERSIONNAME,PARAMETERNAME,QUEUENAME'],['generatedRoutings','PSOPRGENRTGPARM','VERSIONNAME,PARAMETERNAME,ROUTINGDEFNNAME']] as const) await add(name,table,'IB_OPERATIONNAME=:n',{n:key[0]},order);
    await add('routings','PSIBRTNGDEFN','IB_OPERATIONNAME=:n',{n:key[0]},'ROUTINGDEFNNAME,EFFDT');
  } else if (kind === 'routing') {
    await add('operation','PSOPERATION','IB_OPERATIONNAME=:n',{n:trim(properties.IB_OPERATIONNAME)});
    await add('service','PSSERVICE','IB_SERVICENAME=:n',{n:trim(sections.operation[0]?.IB_SERVICENAME)});
    await add('directionalAliases','PSIBRTNGSUBDEFN',where,binds,'SEQNUM');
    await add('parameters','PSRTNGDFNPARM',where,binds,'PARAMETERNAME');
    sections.connectorProperties = await propertyRows(c,types,'PSRTNGDFNCONPRP',where,binds,['PROPID','PROPNAME','SEQNUM']);
    sections.properties = await propertyRows(c,types,'PSRTNGDFNPROP',where,binds,['NAMETYPE','PROPNAME']);
  } else if (kind === 'node') {
    sections.connectorProperties = await propertyRows(c,types,'PSNODECONPROP','MSGNODENAME=:n',{n:key[0]},['PROPID','PROPNAME','SEQNUM']);
    await add('routings','PSIBRTNGDEFN','SENDERNODENAME=:n OR RECEIVERNODENAME=:n',{n:key[0]},'ROUTINGDEFNNAME,EFFDT');
  } else if (kind === 'document') {
    const docWhere = 'IB_PACKAGEID=:k0 AND IB_SCHEMANAME=:k1 AND IB_VARIANTNAME=:k2';
    for (const [name,table,order] of [['dependencies','PSLSDEPCHLDDFN','DATASEQNO'],['physicalSchemas','PSPHYSSCHDEFN','IB_PHYSSCHEMANAME'],['messages','PSMSGVER','MSGNAME,APMSGVER']] as const) await add(name,table,docWhere,binds,order);
    const chunks = await rows(c,types,`SELECT SEQNO,IB_ZIPDATA FROM PSLSDEFNBODY WHERE ${docWhere} ORDER BY SEQNO`,binds);
    const bytes = Buffer.concat(chunks.map(r => Buffer.from(r.IB_ZIPDATA as Uint8Array)));
    const hash = createHash('sha256').update(bytes).digest('hex');
    try {
      const decoded = inflateSync(bytes,{maxOutputLength:16*1024*1024});
      if (decoded.length !== Number(properties.UNCOMPDATALEN) || bytes.length !== Number(properties.COMPDATALEN)) throw new Error('Stored document lengths differ from its body.');
      sections.logicalSchema = [{ format:'PeopleTools schemaDefn XML', xml:decoded.toString('utf8'), sha256:hash }];
    } catch (error) { sections.logicalSchema = [{ format:'unsupported or invalid compressed document', compressedBytes:bytes.length,sha256:hash,error:error instanceof Error ? error.message : String(error) }]; }
    for (const [name,table] of [['xmlSchemas','PSDOCSCMADATA'],['jsonSchemas','PSDOCJSCMADATA']] as const) await add(name,table,docWhere,binds,'CHUNKSEQUENCE');
    for (const name of ['xmlSchemas','jsonSchemas']) {
      const data = sections[name];
      if (data.length) {
        try {
          const decoded = inflateSync(Buffer.from(data.map(r=>String(r.DATACHUNK??'')).join(''),'base64'),{maxOutputLength:16*1024*1024});
          sections[name] = [{text:decoded.toString('utf8')}];
        } catch { sections[name] = [{error:'Unsupported compressed generated schema.'}]; }
      }
    }
    sections.physicalBodies = [];
    for (const schema of sections.physicalSchemas) {
      const data = await rows(c,types,`SELECT SEQNO,IB_ZIPDATA FROM PSPHYSSCHBODY WHERE ${docWhere} AND IB_PHYSSCHEMANAME=:s ORDER BY SEQNO`,{...binds,s:schema.IB_PHYSSCHEMANAME});
      const packed = Buffer.concat(data.map(r=>Buffer.from(r.IB_ZIPDATA as Uint8Array)));
      try {
        const xml = inflateSync(packed,{maxOutputLength:16*1024*1024});
        if (xml.length!==Number(schema.UNCOMPDATALEN)||packed.length!==Number(schema.COMPDATALEN))throw new Error('Physical schema lengths do not match.');
        sections.physicalBodies.push({IB_PHYSSCHEMANAME:schema.IB_PHYSSCHEMANAME,IB_PHYSSCHEMATYPE:schema.IB_PHYSSCHEMATYPE,xml:xml.toString('utf8')});
      } catch { sections.physicalBodies.push({IB_PHYSSCHEMANAME:schema.IB_PHYSSCHEMANAME,error:'Unsupported or invalid physical schema.'}); }
    }
  }
  return ibDocument(kind,key,properties,sections);
}

export async function validateIb(c: DbConnection, types: DbTypes, doc: IbDocument): Promise<IbDiagnostic[]> {
  const ds = validateIbDocument(doc);
  const exists = async (table: string, where: string, binds: DbBinds) => (await rows(c,types,`SELECT 1 AS N FROM ${table} WHERE ${where} FETCH FIRST 1 ROWS ONLY`,binds)).length > 0;
  const missing = (path: string, message: string) => ds.push({severity:'error',path,message});
  for (const [i,p] of (doc.sections.parameters ?? []).entries()) {
    if (doc.kind !== 'operation') break;
    if (trim(p.MSGNAME) && !await exists('PSMSGVER','MSGNAME=:n AND APMSGVER=:v',{n:trim(p.MSGNAME),v:trim(p.IB_MSGVERSION)})) missing(`parameters[${i}].MSGNAME`,'Referenced message version is missing.');
    if (trim(p.QUEUENAME) && !await exists('PSQUEUEDEFN','QUEUENAME=:n',{n:trim(p.QUEUENAME)})) missing(`parameters[${i}].QUEUENAME`,'Referenced queue is missing.');
    for (const field of ['XFRMNAME','OUTXFRMNAME']) if (trim(p[field]) && !await exists('PSSQLDEFN','SQLID=:n AND SQLTYPE=6',{n:trim(p[field])})) missing(`parameters[${i}].${field}`,'Referenced XSLT transform is missing.');
  }
  if (doc.kind === 'routing') {
    for (const field of ['SENDERNODENAME','RECEIVERNODENAME']) if (trim(doc.properties[field]) && trim(doc.properties[field])!=='~~ANY~~' && !await exists('PSMSGNODEDEFN','MSGNODENAME=:n',{n:trim(doc.properties[field])})) missing(field,'Referenced node is missing.');
    if(trim(doc.properties.EFF_STATUS)==='A')for(const field of ['SENDERNODENAME','RECEIVERNODENAME']){const n=trim(doc.properties[field]);if(n&&n!=='~~ANY~~'&&!await exists('PSMSGNODEDEFN',"MSGNODENAME=:n AND ACTIVE_NODE='1'",{n}))missing(field,'Active routing requires active nodes.');}
    if (!await exists('PSOPRVERDFN','IB_OPERATIONNAME=:n AND VERSIONNAME=:v',{n:trim(doc.properties.IB_OPERATIONNAME),v:trim(doc.properties.VERSIONNAME)})) missing('VERSIONNAME','Referenced operation version is missing.');
  }
  if (doc.kind === 'document' && doc.sections.logicalSchema?.[0]?.error) missing('logicalSchema',String(doc.sections.logicalSchema[0].error));
  return ds;
}
