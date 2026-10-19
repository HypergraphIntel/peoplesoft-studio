import { flatStringElements } from '../model/ibDocumentSchema.js';
import { requireCalibratedRelease } from './calibratedRelease.js';
import { deflate } from 'pako';
/**
 * PIA compresses document bodies with reference zlib at level 6. Node's zlib (Chromium's
 * fork) gives other bytes for the same text; pako, a port of reference zlib, reproduced every
 * PIA body captured (six on 8.61.15, three on 8.62.09) byte for byte.
 */
export const ibDeflate=(data:Buffer):Buffer=>Buffer.from(deflate(data,{level:6}));
import { XMLValidator, XMLParser } from 'fast-xml-parser';
import type { DbConnection, DbTypes } from '../db/connection.js';
import { ibDocument, ibIdentity, type IbDocument, type IbDiagnostic, } from '../model/ibDocument.js';
import { IB_PARENTS, IB_SECTIONS, IB_STAMPS, ibSecretColumn, ibWriteInput, inputForIb, validateIbInput, type IbWriteInput, type IbTable } from '../model/ibOperations.js';
import type { Row } from '../model/ibDefinitions.js';
import { isSecretProperty } from '../model/miscDefinitions.js';
import { readIb, rows, safeRows, propertyRows, validateIb } from './ibReader.js';
import { operatorExists, TIMESTAMP_FORMAT } from './peopleCodeWriter.js';
import { writeScopeRefusal } from './writeScope.js';
import { presentOnly, tableColumns } from './tableColumns.js';

export interface IbSaveRequest { input:IbWriteInput; expectedToken:string; operatorId:string; dryRun?:boolean; /** Draws for a generated routing name (tests). */ random?:()=>number; }
export interface IbStatement { sql:string; binds:Record<string,unknown>; expect?:number; }
export interface IbPlan { changes:string[]; increments:Record<string,number>; statements:IbStatement[]; }
export interface IbSaveResult { written:boolean; token?:string; plan:IbPlan; validation:IbDiagnostic[]; }
const str=(v:unknown)=>String(v??'').trim();
const same=(a:unknown,b:unknown)=>a===b || (typeof a==='number'||typeof b==='number')&&a!==null&&b!==null&&str(a)!==''&&str(b)!==''&&Number(a)===Number(b) || typeof a==='string'&&typeof b==='string'&&a.trim()===''&&b.trim()==='';
const secretProperty=(r:Row)=>isSecretProperty(str(r.PROPID))||isSecretProperty(str(r.PROPNAME));
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,trimValues:false});
function validateXml(xml:string,key:string[],name:string):void {
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error(`${name} must be valid schemaDefn XML without DTDs or entities.`);
 const root=parser.parse(xml)?.schemaDefn?.rowset;
 if(!root||!root.row||String(root['@_count'])!=='1')throw new Error(`${name} needs one native definition row.`);
 const r=root.row;
 for(const [i,field] of ['m_key.m_atmPackageName','m_key.m_atmLogicalSchemaName','m_key.m_atmVariantName'].entries())if(str(r[field])!==key[i])throw new Error(`${name}: ${field} must match the document key.`);
}
function predicate(keys:string[],row:Row,prefix='k') {
 const binds:Record<string,unknown>={};
 const sql=keys.map((k,i)=>{binds[prefix+i]=row[k];return `${k}=${k==='EFFDT'?`TO_DATE(:${prefix+i},'YYYY-MM-DD')`:`:${prefix+i}`}`}).join(' AND ');
 return {sql,binds};
}
function keyOf(table:IbTable,row:Row){return JSON.stringify(table.keys.map(k=>str(row[k])));}
function put(plan:IbPlan,table:IbTable,before:Row|undefined,after:Row,types:DbTypes) {
 const fields=Object.keys(after).filter(k=>!before||!same(before[k],after[k]));
 if(!fields.length)return;
 const binds:Record<string,unknown>={};
 const placeholders=fields.map((k,i)=>{
  const v=after[k];binds['v'+i]=Buffer.isBuffer(v)?{val:v,type:types.BLOB}:['DESCRLONG','COMMENTS','DATACHUNK'].includes(k)&&typeof v==='string'?{val:v,type:types.CLOB}:v;
  return k==='EFFDT'?`TO_DATE(:v${i},'YYYY-MM-DD')`:k==='LASTUPDDTTM'?`TO_TIMESTAMP(:v${i},${TIMESTAMP_FORMAT})`:`:v${i}`;
 });
 if(before){const where=predicate(table.keys,before);plan.statements.push({sql:`UPDATE ${table.table} SET ${fields.map((k,i)=>k+'='+placeholders[i]).join(',')} WHERE ${where.sql}`,binds:{...binds,...where.binds},expect:1});}
 else plan.statements.push({sql:`INSERT INTO ${table.table} (${fields.join(',')}) VALUES (${placeholders.join(',')})`,binds,expect:1});
}
/**
 * The parameters PIA gives a new routing (PSRTNGDFNPARM), by the operation's routing type and which end is the default
 * local node: the request and, for a synchronous operation, its response with sender and receiver swapped; each aliased
 * operation.version. Inbound (receiver local): INREQUEST, OUTRESPONSE. Outbound (sender local, or both): OUTREQUEST,
 * INRESPONSE. Neither end local: none (no evidence). [PIA 8.61.15 XX_IB_RT_AD; every delivered routing on HCDEV]
 */
/**
 * A routing's sub-definition for its request parameter: inbound (INREQUEST) under the parameter's alias, outbound under the
 * operation's own name and version (every one of 701 outbound and 1,678 of 1,680 inbound delivered rows) [8.61.15].
 */
export function routingSubdefinition(request:Row,routing:Row):Row {
 const inbound=str(request.PARAMETERNAME)==='INREQUEST';
 return {IB_DIRECTION:inbound?'I':'O',RTNGTYPE:routing.RTNGTYPE,SENDERNODENAME:request.SENDERNODENAME,RECEIVERNODENAME:request.RECEIVERNODENAME,
  ALIASNAME:inbound?request.ALIASNAME:`${str(routing.IB_OPERATIONNAME)}.${str(routing.VERSIONNAME)}`};
}
/** PSSERVICESWRK.SAVE_PB getrandomname("~GENERATED~", 10000000, 99999999): "~GENERATED~" | String(Int(Rand() * 99999999) + 10000000). */
export function generatedRoutingName(random:()=>number=Math.random):string {
 return `~GENERATED~${Math.floor(random()*99999999)+10000000}`;
}
export function routingParameters(routing:Row,routingType:string,localNode:string):Row[] {
 const sender=str(routing.SENDERNODENAME),receiver=str(routing.RECEIVERNODENAME),version=str(routing.VERSIONNAME);
 const inbound=receiver===localNode&&sender!==localNode,outbound=sender===localNode;
 if(!inbound&&!outbound)return [];
 const row=(name:string,from:string,to:string):Row=>({PARAMETERNAME:name,SENDERNODENAME:from,RECEIVERNODENAME:to,ALIASNAME:`${str(routing.IB_OPERATIONNAME)}.${version}`,VERSIONNAME:version});
 const request=row(inbound?'INREQUEST':'OUTREQUEST',sender,receiver);
 return routingType==='S'?[request,row(inbound?'OUTRESPONSE':'INRESPONSE',receiver,sender)]:[request];
}
/** The shapes matched to PIA on 8.61.15 as well as 8.62.09; REST, nodes, routings and handlers were matched on 8.62.09 only. */
export function ibStandardShape(input:IbWriteInput):boolean {
 const none=(...names:string[])=>names.every(n=>!(input.sections[n]??[]).length);
 switch(input.kind){
  case 'message':return none('records','fields','parts','attributes')&&(input.sections.versions??[]).every(v=>Number(v.IB_MSGTYPE)===2);
  case 'service':return input.serviceKind==='standard';
  case 'operation':return !str(input.properties.IB_RESTMETHOD)&&none('handlers','applicationClassHandlers','applicationEngineHandlers','componentInterfaceHandlers','dataMoverHandlers','uriTemplates','uriMessages','contentTypes');
  case 'document':return !!input.document;
  default:return false;
 }
}
/**
 * A new input as this release's tables can store it. The creation defaults name 8.62
 * columns (PSOPERATION.URL_ID, PSMSGNODEDEFN.PTIB_NOPING) that 8.61.15 lacks, and the
 * writer refuses any column an input names that its table does not have.
 */
export async function presentIbInput(c:DbConnection,input:IbWriteInput):Promise<IbWriteInput> {
 type Stored=IbWriteInput['properties'];
 const keep=async(table:string,row:Stored)=>{const have=await tableColumns(c,table);return have.size?presentOnly(row,have).row as Stored:row;};
 const sections:IbWriteInput['sections']={};
 for(const [name,list] of Object.entries(input.sections)){const table=IB_SECTIONS[input.kind][name];sections[name]=table?await Promise.all(list.map(r=>keep(table.table,r))):list;}
 return {...input,properties:await keep(IB_PARENTS[input.kind].table,input.properties),sections};
}
export async function checkedRow(c:DbConnection,table:IbTable,input:Row,before:Row|undefined,parent:Row):Promise<Row> {
 const columns=await c.catalog.columns(c,table.table);if(!columns.length)throw new Error(`${table.table} is not installed.`);
 const names=new Set(columns.map(c=>c.name));
 for(const key of Object.keys(input))if(!names.has(key))throw new Error(`${table.table}.${key} is not a stored column.`);
 const row:Row={...(before??table.defaults),...input,...parent};
 // A creation default for a column this release lacks (8.62's PSOPERATION.URL_ID, PSMSGNODEDEFN.PTIB_NOPING on 8.61.15) is not written.
 for(const key of Object.keys(row))if(!names.has(key))delete row[key];
 for(const col of columns){
  if(IB_STAMPS.has(col.name))continue;
  if(!(col.name in row)){
   if(before)continue;
   throw new Error(`${table.table}.${col.name}: no calibrated creation default; provide it explicitly.`);
  }
  const v=row[col.name];
  if(v===null){if(!/CLOB|LONG/.test(col.dataType)&&col.name!=='COMMENTS')throw new Error(`${table.table}.${col.name} cannot be null.`);continue;}
  if(/NUMBER|DECIMAL|INTEGER|NUMERIC/.test(col.dataType)){
   if(typeof v!=='number'||!Number.isFinite(v))throw new Error(`${table.table}.${col.name} requires a number.`);
  }else if(col.name!=='EFFDT'&&!/TIMESTAMP/.test(col.dataType)&&!Buffer.isBuffer(v)){
   if(typeof v!=='string')throw new Error(`${table.table}.${col.name} requires text.`);
   row[col.name]=v===''?(/CLOB|LONG/.test(col.dataType)?null:' '):v;
  }
 }
 const textFields=Object.entries(row).filter(([k,v])=>typeof v==='string'&&!IB_STAMPS.has(k)&&k!=='EFFDT');
 if(textFields.length){const fields=await rows(c,{OUT_FORMAT_OBJECT:4002} as DbTypes,`SELECT FIELDNAME,LENGTH,FIELDTYPE FROM PSDBFIELD WHERE FIELDNAME IN (${textFields.map((_,i)=>':f'+i).join(',')})`,Object.fromEntries(textFields.map(([k],i)=>['f'+i,k])));for(const f of fields){if(Number(f.FIELDTYPE)===0&&String(row[str(f.FIELDNAME)]??'').length>Number(f.LENGTH))throw new Error(`${table.table}.${str(f.FIELDNAME)} exceeds ${f.LENGTH} characters.`);}}
 return row;
}
async function currentRows(c:DbConnection,types:DbTypes,table:IbTable,parent:Row,lock:boolean) {
 const keys=table.keys.filter(k=>k in parent),where=predicate(keys,parent);
 if(lock)await rows(c,types,`SELECT ${table.keys.join(',')} FROM ${table.table} WHERE ${where.sql} FOR UPDATE`,where.binds);
 return table.keys.includes('PROPNAME') ? propertyRows(c,types,table.table,where.sql,where.binds,table.keys) : safeRows(c,types,table.table,where.sql,where.binds,table.keys.join(','));
}
async function buildPlan(c:DbConnection,types:DbTypes,request:IbSaveRequest,opened:IbDocument|undefined):Promise<{plan:IbPlan;proposed:IbDocument;validation:IbDiagnostic[]}> {
 const input=request.input,parentTable=IB_PARENTS[input.kind];
 if (input.kind==='operation'&&opened) {
  const current=inputForIb(opened);
  input.sections.versions??=current.sections.versions;
  input.sections.handlers??=current.sections.handlers;
 }
 if(input.kind==='routing'&&!opened&&!(input.sections.parameters??[]).length){
  const [operation]=await safeRows(c,types,'PSOPERATION','IB_OPERATIONNAME=:n',{n:str(input.properties.IB_OPERATIONNAME)});
  const local=await rows(c,types,"SELECT MSGNODENAME FROM PSMSGNODEDEFN WHERE LOCALDEFAULTFLG='Y'");
  if(operation&&local.length===1)input.sections.parameters=routingParameters(input.properties,str(operation.RTNGTYPE),str(local[0].MSGNODENAME)) as IbWriteInput['sections'][string];
 }
 if(input.document)input.document.physicalSchemas.sort((a,b)=>['XML','JSON','HTML'].indexOf(a.name)-['XML','JSON','HTML'].indexOf(b.name));
 const parentKey=Object.fromEntries(parentTable.keys.map((k,i)=>[k,input.key[i]]));
 const plan:IbPlan={changes:[],increments:{},statements:[]};
 const inc=(key:string,n=1)=>{plan.increments[key]=(plan.increments[key]??0)+n;};
 let properties=await checkedRow(c,parentTable,input.properties,opened?.properties,parentKey);
 if(input.kind==='service'){
  const flag=input.serviceKind==='standard'?0:input.restRole==='consumer'?1:2;
  if(opened&&Number(opened.properties.IB_REST_SERVICE)!==flag)throw new Error('PIA service kind and REST role are immutable after creation. Create a separate service.');
  if(opened&&str(opened.properties.IB_PSOFTSERVICE)==='Y')throw new Error('PeopleSoft restricted service is read only in PIA.');
  properties.IB_REST_SERVICE=flag;
  if(!str(properties.DESCR)||!str(properties.IB_NAMESPACE))throw new Error('Service description and namespace are required.');
  if(Number(properties.PT_OPEN_API)!==0)throw new Error('OpenAPI/application-service writes need a separately calibrated protocol. Existing OpenAPI definitions are read only here.');
  if(str(properties.IB_ALIASNAME)){
   const duplicate=await rows(c,types,'SELECT IB_SERVICENAME FROM PSSERVICE WHERE IB_SERVICENAME<>:n AND (IB_SERVICENAME=:a OR IB_ALIASNAME=:a) FETCH FIRST 1 ROWS ONLY',{n:input.key[0],a:str(properties.IB_ALIASNAME)});
   if(duplicate.length)throw new Error('Service alias is already a service name or alias.');
  }
 }
 const sections={...(opened?.sections??{})};
 const childWork:{name:string;table:IbTable;before:Row[];after:Row[];changed:boolean}[]=[];
 for(const [name,proposed] of Object.entries(input.sections)){
  const table=IB_SECTIONS[input.kind][name];
  const before=await currentRows(c,types,table,parentKey,!request.dryRun);
  const after:Row[]=[];const ids=new Set<string>();
  for(const input0 of proposed){
   let row=input0;
   // PIA stores a class at the package root with a blank path (the page shows ':'; every delivered row is blank) [8.61.15].
   if(name==='applicationClassHandlers'&&str(row.QUALIFYPATH)===':')row={...row,QUALIFYPATH:' '};
   const keyRow={...row,...parentKey};
   for(const k of table.keys)if(!(k in keyRow)||!str(keyRow[k]))throw new Error(`${name}.${k} is required.`);
   const id=keyOf(table,keyRow);if(ids.has(id))throw new Error(`${name} contains duplicate keys.`);ids.add(id);
   const old=before.find(r=>keyOf(table,r)===id);
   // A new handler without a description takes the operation's, as the Handlers page saves it [8.61.15].
   if(name==='handlers'&&!old&&!str(row.DESCR))row={...row,DESCR:str(properties.DESCR)||' '};
   after.push(await checkedRow(c,table,row,old,parentKey));
  }
  for(const row of before.filter(secretProperty))if(!ids.has(keyOf(table,row)))after.push(row);
  const removed=before.filter(r=>!after.some(n=>keyOf(table,n)===keyOf(table,r)));
  if(removed.length)throw new Error(`${name}: deleting stored child definitions is not calibrated. Preserve the existing rows.`);
  const changed=after.some(r=>{const old=before.find(b=>keyOf(table,b)===keyOf(table,r));return !old||Object.keys(r).some(k=>!IB_STAMPS.has(k)&&!same(old[k],r[k]));});
  sections[name]=after;childWork.push({name,table,before,after,changed});
 }
 let service:Row|undefined;
 let mappingNew=false;
 /** The routing PIA generates with a new REST operation: a provider's from ~~ANY~~ to the local node, a consumer's from it to WADL_NODE. */
 let generated:{name:string;sender:string;receiver:string;localIdFlag:number;gateway:string;connector:string;active:boolean;description:string}|undefined;
 if(input.kind==='operation'){
  [service]=await safeRows(c,types,'PSSERVICE','IB_SERVICENAME=:n',{n:str(properties.IB_SERVICENAME)});
  if(!service)throw new Error('The owning service does not exist.');
  if(!opened){const refusal=writeScopeRefusal(str(properties.IB_SERVICENAME));if(refusal)throw new Error(refusal);}
  if(str(service.IB_PSOFTSERVICE)==='Y')throw new Error('Cannot change a PeopleSoft restricted service.');
  if(opened&&str(opened.properties.IB_SERVICENAME)!==str(properties.IB_SERVICENAME))throw new Error('Moving operations between services needs a separately calibrated protocol.');
  properties.IB_REST_SERVICE=service.IB_REST_SERVICE;sections.service=[service];
  if(Number(service.IB_REST_SERVICE)>0){
   if(str(properties.RTNGTYPE)!=='S')throw new Error('REST operations must be synchronous.');
   if(!['GET','POST','PUT','DELETE','HEAD','PATCH'].includes(str(properties.IB_RESTMETHOD)))throw new Error('Choose an HTTP method for REST operations.');
  }else if(str(properties.IB_RESTMETHOD))throw new Error('Standard service operations cannot acquire a REST HTTP method.');
  if(Number(service.IB_REST_SERVICE)===1&&!str(properties.IB_RESTBASE_URL)&&!str(properties.URL_ID))throw new Error('REST consumer operation requires a base URL or URL definition.');
  if(!str(properties.DESCR)||!str(properties.DEFAULTVER))throw new Error('Operation description and default version are required.');
  if(!(sections.versions??[]).length)throw new Error('An operation requires at least one version.');
  for(const v of sections.versions??[])if(!str(v.DESCR))v.DESCR=properties.DESCR;
  for(const v of sections.versions??[]){const params=(sections.parameters??[]).filter(p=>str(p.VERSIONNAME)===str(v.VERSIONNAME));for(const role of str(properties.RTNGTYPE)==='A'?['REQUEST']:['REQUEST','RESPONSE']){if(!params.some(p=>str(p.PARAMETERNAME)===role&&str(p.MSGNAME)&&str(p.IB_MSGVERSION)))throw new Error('Operation version '+str(v.VERSIONNAME)+' requires '+role+' message/version.');}}
  const map=await rows(c,types,'SELECT IB_OPERATIONNAME FROM PSSERVICEOPR WHERE IB_SERVICENAME=:s AND IB_OPERATIONNAME=:n',{s:str(properties.IB_SERVICENAME),n:input.key[0]});mappingNew=!map.length;
  if(!opened&&Number(service.IB_REST_SERVICE)>0){
   const provider=Number(service.IB_REST_SERVICE)===2;
   // The base URL a REST provider operation is reached at: Service Configuration's REST target location, then the service alias [8.61.15].
   if(provider&&!str(properties.IB_RESTBASE_URL)){const [setup]=await rows(c,types,'SELECT IB_RESTTGTLOC FROM PSIBSVCSETUP');if(str(setup?.IB_RESTTGTLOC))properties.IB_RESTBASE_URL=`${str(setup.IB_RESTTGTLOC)}/${str(service.IB_ALIASNAME)}/`;}
   // A consumer's routing carries the service's token on its request; with one set, the page copies credentials this writer does not handle.
   if(!provider&&str(service.TOKENTYPE)&&str(service.TOKENTYPE)!=='NONE')throw new Error('The service has a token type: create its REST consumer operations in PIA, which copies the service credentials to the generated routing.');
   const local=await rows(c,types,"SELECT MSGNODENAME, ACTIVE_NODE FROM PSMSGNODEDEFN WHERE LOCALDEFAULTFLG='Y'");
   if(local.length!==1)throw new Error('Exactly one default local node is required.');
   const [label]=await rows(c,types,'SELECT MESSAGE_TEXT FROM PSMSGCATDEFN WHERE MESSAGE_SET_NBR=158 AND MESSAGE_NBR=2382');
   let name='';for(let i=0;i<10&&!name;i++){const candidate=generatedRoutingName(request.random);if(!(await rows(c,types,'SELECT 1 AS N FROM PSIBRTNGDEFN WHERE ROUTINGDEFNNAME=:n',{n:candidate})).length)name=candidate;}
   if(!name)throw new Error('Failed to generate a unique Routing Definition Name.');
   const localNode=str(local[0].MSGNODENAME);
   let gateway=' ';
   if(!provider){
    if(!(await rows(c,types,"SELECT 1 AS N FROM PSMSGNODEDEFN WHERE MSGNODENAME='WADL_NODE'")).length)throw new Error('WADL_NODE, the node a REST consumer routing is generated to, does not exist.');
    const [g]=await rows(c,types,"SELECT CONNGATEWAYID FROM PSGATEWAY WHERE LOCAL_FLAG='Y'");gateway=str(g?.CONNGATEWAYID)||' ';
   }
   generated={name,sender:provider?'~~ANY~~':localNode,receiver:provider?localNode:'WADL_NODE',localIdFlag:provider?2:1,gateway,connector:provider?' ':'HTTPTARGET',
    active:str(local[0].ACTIVE_NODE)!=='0',description:str(label?.MESSAGE_TEXT)||'GENERATED'};
  }
  if(!opened&&(sections.handlers??[]).length)throw new Error('Create the operation first, then add handlers.');
  for(const h of sections.handlers??[]){const old=opened?.sections.handlers?.find(r=>str(r.HANDLERNAME)===str(h.HANDLERNAME));if(old&&['HANDLERTYPE','HANDLERID'].some(k=>!same(old[k],h[k])))throw new Error('Changing handler event or implementation type requires PIA.');if(!old&&(str(h.HANDLERID)!=='RQST'||str(h.HANDLERNAME)!=='REQUESTHDLR'||str(h.HANDLERTYPE)!=='ApplicationClass'))throw new Error('New handler protocol is calibrated for ApplicationClass REQUESTHDLR / OnRequest only.');if(str(h.HANDLERTYPE)==='ApplicationClass'){const a=sections.applicationClassHandlers?.find(r=>str(r.HANDLERNAME)===str(h.HANDLERNAME));if(!a)throw new Error('Application class handler needs its implementation row.');if(!(await rows(c,types,'SELECT 1 AS N FROM PSAPPCLASSDEFN WHERE PACKAGEROOT=:p AND QUALIFYPATH=:q AND APPCLASSID=:c',{p:a.PACKAGEROOT,q:str(a.QUALIFYPATH)||':',c:a.APPCLASSID})).length)throw new Error('Referenced application class does not exist.');if(str(h.HANDLERID)==='RQST'&&str(a.APPCLASSMETHOD)!=='OnRequest')throw new Error('OnRequest handler implementation must use OnRequest.');}}
 }
 if(input.kind==='node'){
  if(!str(properties.DESCR)||!str(properties.USERID))throw new Error('Node description and default user are required.');
  if(!await operatorExists(c,str(properties.USERID)))throw new Error('Node default user does not exist.');
  if(!opened&&(Number(properties.LOCALNODE)!==0||str(properties.LOCALDEFAULTFLG)!=='N'))throw new Error('Local node identity must be configured in PIA.');
  if(!opened&&str(properties.AUTHOPTN)!=='N')throw new Error('Create a node without credentials, then configure its authentication in PIA.');
  if(opened&&['LOCALNODE','LOCALDEFAULTFLG','AUTHOPTN','TOKENTYPE','TOKEN_ENCRYPTED','TOKEN_SIGNED','IB_ENCRYPTLEVEL','USERID'].some(k=>!same(opened.properties[k],properties[k])))throw new Error('Node identity/authentication changes must be made in PIA; this writer preserves credentials.');
 }
 if(input.kind==='message'){
  if(!(sections.versions??[]).length)throw new Error('A message requires a version.');
  for(const v of sections.versions??[]){
   if(![1,2,3,4,5,6].includes(Number(v.IB_MSGTYPE)))throw new Error('Unsupported message type.');
   if(Number(v.IB_MSGTYPE)!==2)throw new Error('This write protocol is calibrated for nonrowset messages; other message structures must be saved in PIA.');
   if(Number(v.IB_MSGTYPE)===6&&!await rows(c,types,'SELECT 1 AS N FROM PSLSDEFN WHERE IB_PACKAGEID=:p AND IB_SCHEMANAME=:d AND IB_VARIANTNAME=:v',{p:str(v.IB_PACKAGEID),d:str(v.IB_SCHEMANAME),v:str(v.IB_VARIANTNAME)}).then(r=>r.length))throw new Error('Document message references a missing document version.');
  }
 }
 if(input.kind==='routing'){
  const [operation]=await safeRows(c,types,'PSOPERATION','IB_OPERATIONNAME=:n',{n:str(properties.IB_OPERATIONNAME)});
  if(!operation)throw new Error('Routing operation is missing.');
  [service]=await safeRows(c,types,'PSSERVICE','IB_SERVICENAME=:n',{n:str(operation.IB_SERVICENAME)});sections.operation=[operation];sections.service=service?[service]:[];
  properties.RTNGTYPE=operation.RTNGTYPE;
  const local=await rows(c,types,"SELECT MSGNODENAME FROM PSMSGNODEDEFN WHERE LOCALDEFAULTFLG='Y'");
  if(local.length!==1)throw new Error('Exactly one default local node is required.');
  const name=str(local[0].MSGNODENAME),sender=str(properties.SENDERNODENAME),receiver=str(properties.RECEIVERNODENAME);
  if(!sender||!receiver)throw new Error('Sender and receiver nodes are required.');
  properties.IB_LOCALIDFLG=sender===name&&receiver===name?3:sender===name?1:receiver===name?2:0;
  if(!str(properties.DESCR))properties.DESCR=operation.DESCR;
  for(const p of sections.parameters??[]){if(!str(p.ALIASNAME))throw new Error('Routing parameters require external aliases.');if(str(p.VERSIONNAME)!==str(properties.VERSIONNAME))throw new Error('Routing parameter version must agree with its routing.');}
 }
 const logical=input.document;
 if(input.kind==='document'){
  validateXml(logical!.logicalSchema,input.key,'Logical schema');
  if(!flatStringElements(logical!.logicalSchema))throw new Error('Only calibrated flat string document writes are supported; use PIA for other shapes.');
  if(!logical!.physicalSchemas.length)throw new Error('Supply the native physical schemas with the logical schema.');
  for(const p of logical!.physicalSchemas)validateXml(p.xml,input.key,`Physical ${p.name}`);
  if(logical!.physicalSchemas.some(p=>!['XML','JSON','HTML'].includes(p.name)))throw new Error('Relational/custom physical schemas need a separately calibrated protocol.');
  if((opened?.sections.dependencies??[]).length)throw new Error('Compound/document dependency writes need a separately calibrated protocol.');
  if((await rows(c,types,'SELECT 1 AS N FROM PSDOCLODEFN WHERE (IB_PACKAGEID=:p AND IB_SCHEMANAME=:d AND IB_VARIANTNAME=:v) OR (IB_PACKAGE2=:p AND IB_SCHEMANAME2=:d AND IB_VARIANTNAME2=:v) FETCH FIRST 1 ROWS ONLY',{p:input.key[0],d:input.key[1],v:input.key[2]})).length)throw new Error('This document is used by a Document Layout; resynchronization must be handled in PIA.');
  const body=Buffer.from(logical!.logicalSchema,'utf8');properties.COMPDATALEN=ibDeflate(body).length;properties.UNCOMPDATALEN=body.length;
  if(!str(properties.DESCR))properties.DESCR=input.key[1].slice(0,30);
 }
 const parentChanged=!opened||Object.keys(properties).some(k=>!IB_STAMPS.has(k)&&!same(opened.properties[k],properties[k]));
 const bodyChanged=input.kind==='document'&&JSON.stringify(input.document)!==JSON.stringify({logicalSchema:opened?.sections.logicalSchema?.[0]?.xml,physicalSchemas:(opened?.sections.physicalBodies??[]).map(r=>({name:r.IB_PHYSSCHEMANAME,type:r.IB_PHYSSCHEMATYPE,xml:r.xml})).sort((a,b)=>['XML','JSON','HTML'].indexOf(String(a.name))-['XML','JSON','HTML'].indexOf(String(b.name))),xmlSchema:opened?.sections.xmlSchemas?.[0]?.text??'',jsonSchema:opened?.sections.jsonSchemas?.[0]?.text??''});
 const changed=parentChanged||childWork.some(t=>t.changed)||bodyChanged;
 const proposed=ibDocument(input.kind,input.key,properties,sections);
 const validation=await validateIb(c,types,proposed);
 if(!changed)return {plan,proposed,validation};
 plan.changes.push(`${opened?'Update':'Create'} ${input.kind} ${input.key.join(' / ')}`);
 for(const t of childWork.filter(t=>t.changed))plan.changes.push(`Save ${t.name} (${t.after.length} rows)`);
 if(input.kind==='document'){
  inc('LSDM',opened?2:1);inc('PSCHM',logical!.physicalSchemas.length+(opened?1:0));inc('DSCMA',opened?2:1);inc('SYS',opened?logical!.physicalSchemas.length+4:logical!.physicalSchemas.length+2);
 }else{
  inc(parentTable.counter!);inc('SYS');
  if(input.kind==='node')inc('MSDM');
  if(input.kind==='operation'){
   inc('OPRVM',(sections.versions??[]).length);inc('SYS',(sections.versions??[]).length);
   if(mappingNew){inc('SRVM');inc('SYS');}
   if(generated){inc('RTDM');inc('SYS');}
   for(const h of sections.handlers??[]){
    const before=(opened?.sections.handlers??[]).find(b=>str(b.HANDLERNAME)===str(h.HANDLERNAME));
    const implementationChanged=childWork.some(t=>t.name.endsWith('Handlers')&&t.changed&&t.after.some(r=>str(r.HANDLERNAME)===str(h.HANDLERNAME)));
    if(!before||implementationChanged||Object.keys(h).some(k=>!IB_STAMPS.has(k)&&!same(before[k],h[k]))){inc('OPRHM');inc('SYS');}
   }
  }
 }
 const counters=await rows(c,types,`SELECT OBJECTTYPENAME,VERSION FROM PSVERSION WHERE OBJECTTYPENAME IN (${Object.keys(plan.increments).map((_,i)=>':c'+i).join(',')}) ORDER BY OBJECTTYPENAME${request.dryRun?'':' FOR UPDATE'}`,Object.fromEntries(Object.keys(plan.increments).map((k,i)=>['c'+i,k])));
 const next:Record<string,number>={};for(const name of Object.keys(plan.increments)){const counter=counters.find(c=>str(c.OBJECTTYPENAME)===name);if(!counter)throw new Error(`PSVERSION ${name} is missing.`);next[name]=Number(counter.VERSION)+plan.increments[name];}
 const [clock]=await rows(c,types,`SELECT TO_CHAR(CAST(SYSTIMESTAMP AS TIMESTAMP(6)),${TIMESTAMP_FORMAT}) AS TS FROM DUAL`);const stamp={LASTUPDDTTM:clock.TS,LASTUPDOPRID:request.operatorId};
 for(const [name,v] of Object.entries(next)){
  plan.statements.push({sql:'UPDATE PSVERSION SET VERSION=:v WHERE OBJECTTYPENAME=:n',binds:{v,n:name},expect:1});
  if(name!=='SYS')plan.statements.push({sql:'UPDATE PSLOCK SET VERSION=:v WHERE OBJECTTYPENAME=:n',binds:{v,n:name},expect:1});
 }
 properties={...properties,...stamp,VERSION:next[parentTable.counter!]+(input.kind==='document'?1:0)};
 put(plan,parentTable,opened?.properties,properties,types);
 // A new node also gets its description in PSNODEDEFNLANG under a blank language code; later saves leave that row alone
 // (PIA 8.61.15 XX_IB_ND_AD, 8.62.09 ZZ_IB_NODE).
 if(input.kind==='node'&&!opened)put(plan,{table:'PSNODEDEFNLANG',keys:['MSGNODENAME','LANGUAGE_CD'],defaults:{}},undefined,{MSGNODENAME:input.key[0],LANGUAGE_CD:' ',DESCR:properties.DESCR??' ',DESCRLONG:properties.DESCRLONG??null},types);
 let versionSequence=(next.OPRVM??0)-(plan.increments.OPRVM??0),handlerSequence=(next.OPRHM??0)-(plan.increments.OPRHM??0);
 for(const t of childWork){
  for(let after of t.after){const before=t.before.find(r=>keyOf(t.table,r)===keyOf(t.table,after));
   if(t.table.counter==='OPRVM')after={...after,...stamp,VERSION:++versionSequence};
   if(t.table.counter==='OPRHM'){
    const dirty=!before||Object.keys(after).some(k=>!IB_STAMPS.has(k)&&!same(before[k],after[k]))||childWork.some(w=>w.name.endsWith('Handlers')&&w.changed&&w.after.some(r=>str(r.HANDLERNAME)===str(after.HANDLERNAME)));
    if(dirty)after={...after,...stamp,VERSION:++handlerSequence};
   }
   put(plan,t.table,before,after,types);
  }
 }
 if(input.kind==='operation'&&generated){
  // The public routing PIA generates with a REST provider operation: ~~ANY~~ to the local node, its parameters and sub-definition,
  // and the operation version's PSOPRGENRTGPARM row naming it (PSSERVICESWRK.SAVE_PB, public service) [8.61.15 XX_IB_ROP_AD_GET].
  const version=str(properties.DEFAULTVER),key={ROUTINGDEFNNAME:generated.name,EFFDT:'1900-01-01'};
  const routing:Row={...IB_PARENTS.routing.defaults,...key,EFF_STATUS:generated.active?'A':'I',GENERATED:'Y',SENDERNODENAME:generated.sender,RECEIVERNODENAME:generated.receiver,
   RTNGTYPE:properties.RTNGTYPE,IB_OPERATIONNAME:input.key[0],VERSIONNAME:version,LOGMSGDTLFLG:2,DESCR:generated.description,IB_RESTMETHOD:properties.IB_RESTMETHOD,
   IB_LOCALIDFLG:generated.localIdFlag,CONNGATEWAYID:generated.gateway,CONNID:generated.connector,...stamp,VERSION:next.RTDM};
  put(plan,IB_PARENTS.routing,undefined,routing,types);
  const localNode=generated.localIdFlag===2?generated.receiver:generated.sender;
  const parameters=routingParameters({...routing,IB_OPERATIONNAME:str(properties.IB_ALIASNAME)||input.key[0]},str(properties.RTNGTYPE),localNode);
  for(const p of parameters)put(plan,IB_SECTIONS.routing.parameters,undefined,{...IB_SECTIONS.routing.parameters.defaults,...key,...p},types);
  const request=parameters[0];
  put(plan,{table:'PSIBRTNGSUBDEFN',keys:['ROUTINGDEFNNAME','EFFDT','SEQNUM'],defaults:{}},undefined,{...key,SEQNUM:1,...routingSubdefinition(request,routing)},types);
  put(plan,{table:'PSOPRGENRTGPARM',keys:['IB_OPERATIONNAME','VERSIONNAME','PARAMETERNAME','ROUTINGDEFNNAME'],defaults:{}},undefined,
   {IB_OPERATIONNAME:input.key[0],VERSIONNAME:version,PARAMETERNAME:{S:'PUBSRVCSYNC',A:'PUBSRVCASYNC',R:'PUBSRVCASYNCRR'}[str(properties.RTNGTYPE)]??'PUBSRVCSYNC',ROUTINGDEFNNAME:generated.name},types);
  plan.changes.push(`Generate the routing ${generated.name} (${generated.sender} to ${generated.receiver})`);
 }
 if(input.kind==='operation'&&mappingNew){
  const serviceKey={IB_SERVICENAME:properties.IB_SERVICENAME};
  put(plan,IB_PARENTS.service,service,{...serviceKey,VERSION:next.SRVM,...stamp},types);
  plan.statements.push({sql:'INSERT INTO PSSERVICEOPR (IB_SERVICENAME,IB_OPERATIONNAME) VALUES (:s,:n)',binds:{s:properties.IB_SERVICENAME,n:input.key[0]},expect:1});
 }
 if(input.kind==='routing'){
  const where=predicate(parentTable.keys,parentKey);plan.statements.push({sql:`DELETE FROM PSIBRTNGSUBDEFN WHERE ${where.sql}`,binds:where.binds});
  let sequence=0;
  for(const p of sections.parameters??[])if(['INREQUEST','OUTREQUEST'].includes(str(p.PARAMETERNAME))){
   put(plan,{table:'PSIBRTNGSUBDEFN',keys:['ROUTINGDEFNNAME','EFFDT','SEQNUM'],defaults:{}},undefined,{...parentKey,SEQNUM:++sequence,...routingSubdefinition(p,properties)},types);
  }
 }
 if(input.kind==='document'){
  const where=predicate(parentTable.keys,parentKey);
  const body=(table:string,extra:Row,xml:string)=>{
   const data=ibDeflate(Buffer.from(xml,'utf8'));
   const keys={...parentKey,...extra};const condition=predicate(Object.keys(keys),keys);
   plan.statements.push({sql:`DELETE FROM ${table} WHERE ${condition.sql}`,binds:condition.binds});
   put(plan,{table,keys:[...Object.keys(keys),'SEQNO'],defaults:{}},undefined,{...keys,SEQNO:0,IB_ZIPDATA:data},types);
   return {COMPDATALEN:data.length,UNCOMPDATALEN:Buffer.byteLength(xml,'utf8')};
  };
  body('PSLSDEFNBODY',{},logical!.logicalSchema);
  let physicalSequence=next.PSCHM-logical!.physicalSchemas.length;
  for(const p of logical!.physicalSchemas){
   const old=opened?.sections.physicalSchemas?.find(s=>str(s.IB_PHYSSCHEMANAME)===p.name);
   const sizes=body('PSPHYSSCHBODY',{IB_PHYSSCHEMANAME:p.name},p.xml);
   put(plan,{table:'PSPHYSSCHDEFN',keys:[...parentTable.keys,'IB_PHYSSCHEMANAME'],defaults:{}},old,{...parentKey,IB_PHYSSCHEMANAME:p.name,IB_PHYSSCHEMATYPE:p.type,...sizes,VERSION:++physicalSequence+1,...stamp,OBJECTOWNERID:properties.OBJECTOWNERID,DESCR:properties.DESCR,DESCRLONG:properties.DESCRLONG},types);
  }
  for(const [table,text] of [['PSDOCSCMADATA',logical!.xmlSchema],['PSDOCJSCMADATA',logical!.jsonSchema]]){
   const data=ibDeflate(Buffer.from(text,'utf8')).toString('base64');
   plan.statements.push({sql:`DELETE FROM ${table} WHERE ${where.sql}`,binds:where.binds});
   put(plan,{table,keys:[...parentTable.keys,'CHUNKSEQUENCE'],defaults:{}},undefined,{...parentKey,CHUNKSEQUENCE:0,CHUNKSIZE:data.length*2,DATACHUNK:data},types);
  }
  const [existing]=await safeRows(c,types,'PSDOCSCMADFN',where.sql,where.binds);
  const [config]=await safeRows(c,types,'PSIBSVCSETUP','1=1',{});
  put(plan,{table:'PSDOCSCMADFN',keys:parentTable.keys,defaults:{}},existing,{...parentKey,VERSION:next.DSCMA,PUBLISHER:request.operatorId,IB_TGTLOCATION:config?.IB_TGTLOCATION,...stamp,OBJECTOWNERID:properties.OBJECTOWNERID},types);
 }
 return {plan,proposed,validation};
}

export async function saveIb(c:DbConnection,types:DbTypes,request:IbSaveRequest):Promise<IbSaveResult> {
 const input=ibWriteInput.parse(request.input);validateIbInput(input);ibIdentity(input.kind,input.key);
 const scope=writeScopeRefusal(input.kind==='document'?input.key[0]:input.key[0]);if(scope)throw new Error(scope);
 if(!request.expectedToken)throw new Error('An expectedToken is required; use absent only to create.');
 if(!await operatorExists(c,request.operatorId))throw new Error('A valid PeopleSoft Operator ID is required.');
 await requireCalibratedRelease(c,ibStandardShape(input)?'integrationBrokerStandard':'integrationBroker');
 try{
  if(!request.dryRun){const table=IB_PARENTS[input.kind],key=Object.fromEntries(table.keys.map((k,i)=>[k,input.key[i]])),where=predicate(table.keys,key);await rows(c,types,`SELECT ${table.keys.join(',')} FROM ${table.table} WHERE ${where.sql} FOR UPDATE`,where.binds);}
  const opened=await readIb(c,types,input.kind,input.key);
  if(request.expectedToken!==(opened?.token??'absent'))throw new Error('Definition changed since it was read; read it again before saving.');
  const {plan,proposed,validation}=await buildPlan(c,types,{...request,input},opened);
  const errors=validation.filter(d=>d.severity==='error');
  if(errors.length)throw new Error(errors.map(d=>d.path+': '+d.message).join('\n'));
  if(request.dryRun||!plan.statements.length){await c.rollback();return {written:false,token:opened?.token,plan,validation};}
  for(const statement of plan.statements){const result=await c.execute(statement.sql,statement.binds);if(statement.expect!==undefined&&result.rowsAffected!==statement.expect)throw new Error(`Expected ${statement.expect} row(s) writing an IB definition.`);}
  const stored=await readIb(c,types,input.kind,input.key);if(!stored)throw new Error('Saved definition is missing before commit.');
  for(const [k,v] of Object.entries(proposed.properties))if(!IB_STAMPS.has(k)&&!ibSecretColumn(k)&&!same(stored.properties[k],v))throw new Error(`Stored property ${k} differs from the proposed value.`);
  for(const [name,proposedRows] of Object.entries(input.sections)){
   const table=IB_SECTIONS[input.kind][name];
   for(const proposedRow of proposed.sections[name]??proposedRows){const r=(stored.sections[name]??[]).find(r=>table.keys.filter(k=>!IB_PARENTS[input.kind].keys.includes(k)).every(k=>same(r[k],proposedRow[k])));if(!r)throw new Error(`Stored ${name} row is missing.`);for(const [k,v] of Object.entries(proposedRow))if(!IB_STAMPS.has(k)&&!ibSecretColumn(k)&&!same(r[k],v))throw new Error(`Stored ${name}.${k} differs from proposed input.`);}
  }
  if(input.document&&stored.sections.logicalSchema?.[0]?.xml!==input.document.logicalSchema)throw new Error('Stored logical document body differs from input.');
  if(input.document){for(const p of input.document.physicalSchemas){if(stored.sections.physicalBodies?.find(r=>str(r.IB_PHYSSCHEMANAME)===p.name)?.xml!==p.xml)throw new Error('Stored physical document body differs from input.');}if(stored.sections.xmlSchemas?.[0]?.text!==input.document.xmlSchema||stored.sections.jsonSchemas?.[0]?.text!==input.document.jsonSchema)throw new Error('Stored generated schemas differ from input.');}
  await c.commit();return {written:true,token:stored.token,plan,validation};
 }catch(e){await c.rollback();throw e;}
}
