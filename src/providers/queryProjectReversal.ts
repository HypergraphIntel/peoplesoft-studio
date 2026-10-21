import type {DbConnection,DbTypes} from '../db/connection.js';
import {hash,canonical,type Json} from '../changeReview/model.js';
import {querySnapshot,queryView} from '../changeReview/query.js';
import {QUERY_TABLES,queryRows} from '../model/querySavePlan.js';
import {readQueryForEdit,readQueryMigration,saveQuery} from './queryWriter.js';
import {prepareQueryExecution} from './queryRunner.js';
import {readProjectCreationSnapshot,projectCreationItems,projectReviewName} from './projectSnapshot.js';
import {NEW_PROJECT_VALUES,createProject,saveProject} from './projectWriter.js';
import type {DefinitionKey} from '../model/definitions.js';
import {DefinitionType,makeKey} from '../model/definitions.js';
import {projectKeyIdentity} from '../projectCompare.js';
import {validateOperatorId} from '../peoplecode/writeback/savePlan.js';
import {writeScopeRefusal} from './writeScope.js';
import {select,expectRows,operatorExists} from './peopleCodeWriter.js';

export interface ReversalState {value:Json;token:string;hash:string;deleted:boolean}
const count=async(c:DbConnection,sql:string,binds:Record<string,unknown>={})=>{
 const rows=await select<{N:number}>(c,sql,binds);if(rows.length!==1||!Number.isSafeInteger(Number(rows[0].N))||Number(rows[0].N)<0)throw Error('Incomplete reversal scope count.');return Number(rows[0].N);
};
function queryIdentity(name:string,owner:string){if(!/^[A-Z][A-Z0-9_]{0,29}$/.test(name)||owner!==owner.trim()||owner.length>30||owner&&validateOperatorId(owner))throw Error('Invalid Query reversal identity.');return {n:name,o:owner||' '};}
const markerToken=(kind:string,rows:unknown)=>kind+'-deleted:'+hash(rows as Json);
async function release(c:DbConnection){const rows=await select<{TOOLSREL:string}>(c,'SELECT TOOLSREL FROM PSSTATUS');if(rows.length!==1||String(rows[0].TOOLSREL).trim()!=='8.62')throw Error('Query/project reversal requires Oracle PeopleTools 8.62.');}
async function operator(c:DbConnection,name:string,operatorId:string){const error=writeScopeRefusal(name)||validateOperatorId(operatorId);if(error)throw Error(error);if(!await operatorExists(c,operatorId))throw Error('Configured PeopleSoft operator does not exist.');}
async function cache(c:DbConnection,kind:'QDM'|'PJM',lock=false){
 const suffix=lock?' FOR UPDATE':'';
 const v=await select<{T:string;V:number}>(c,`SELECT OBJECTTYPENAME AS T,VERSION AS V FROM PSVERSION WHERE OBJECTTYPENAME IN ('${kind}','SYS') ORDER BY OBJECTTYPENAME${suffix}`);
 const l=await select<{T:string;V:number}>(c,`SELECT OBJECTTYPENAME AS T,VERSION AS V FROM PSLOCK WHERE OBJECTTYPENAME='${kind}'${suffix}`);
 if(v.length!==2||l.length!==1)throw Error('Incomplete reversal cache counters.');
 const state={v:Object.fromEntries(v.map(r=>[String(r.T).trim(),Number(r.V)])),l:Number(l[0].V)};
 if([...Object.values(state.v),state.l].some(n=>!Number.isSafeInteger(n)||n<0)||state.v[kind]!==state.l)throw Error('Invalid reversal cache counters.');return state;
}
async function advance(c:DbConnection,kind:'QDM'|'PJM'){
 await expectRows(c,`UPDATE PSVERSION SET VERSION=VERSION+1 WHERE OBJECTTYPENAME IN ('${kind}','SYS')`,{},2,'Advancing reversal cache');
 await expectRows(c,`UPDATE PSLOCK SET VERSION=VERSION+1 WHERE OBJECTTYPENAME='${kind}'`,{},1,'Advancing reversal lock');
}
async function verifyCache(c:DbConnection,kind:'QDM'|'PJM',before:Awaited<ReturnType<typeof cache>>,delta:number){const after=await cache(c,kind);for(const n of [kind,'SYS'])if(after.v[n]!==before.v[n]+delta)throw Error('Unexpected reversal cache movement.');if(after.l!==before.l+delta)throw Error('Unexpected reversal lock movement.');}
async function keyedTables(c:DbConnection,column:string){
 return select<{TABLE_NAME:string}>(c,`SELECT T.TABLE_NAME FROM ALL_TABLES T WHERE T.OWNER=SYS_CONTEXT('USERENV','CURRENT_SCHEMA')
 AND SUBSTR(T.TABLE_NAME,1,2)='PS' AND EXISTS (SELECT 1 FROM ALL_TAB_COLUMNS C WHERE C.OWNER=T.OWNER AND C.TABLE_NAME=T.TABLE_NAME AND C.COLUMN_NAME=:col) ORDER BY T.TABLE_NAME`,{col:column});
}
async function noAncillary(c:DbConnection,column:'QRYNAME'|'PROJECTNAME',name:string,allowed:readonly string[],owner?:string){
 for(const {TABLE_NAME:table} of await keyedTables(c,column)){
  if(allowed.includes(table))continue;if(!/^[A-Z0-9_]+$/.test(table))throw Error('Invalid ancillary table identifier.');
  // Internal Query ancillary rows are owner-specific; external name references
  // can mean either public/private ownership, so they conservatively block both.
  const ownerScoped=owner!==undefined&&table.startsWith('PSQRY')&&(await c.catalog.columns(c,table)).some(col=>col.name==='OPRID');
  if(await count(c,`SELECT COUNT(*) AS N FROM ${table} WHERE ${column}=:n${ownerScoped?' AND OPRID=:o':''}`,{n:name,...(ownerScoped?{o:owner||' '}:{})}))throw Error(table+': related/reference rows require a wider reviewed scope.');
 }
}
const queryTables=Object.keys(QUERY_TABLES);
export async function readQueryReversalState(c:DbConnection,types:DbTypes,name:string,owner:string,allowDeleted=false,lock=false):Promise<ReversalState>{
 const binds=queryIdentity(name,owner),markers=await select<{OPRID:string;QRYNAME:string;VERSION:number}>(c,`SELECT OPRID,QRYNAME,VERSION FROM PSQRYDEL WHERE QRYNAME=:n AND OPRID=:o${lock?' FOR UPDATE':''}`,binds);
 // References do not prevent reading a live checkpoint; only owner-scoped
 // PSQRY ancillary rows belong to its native definition snapshot.
 for(const {TABLE_NAME:table} of await keyedTables(c,'QRYNAME'))if(table.startsWith('PSQRY')&&!queryTables.includes(table)&&table!=='PSQRYDEL'){
  const columns=await c.catalog.columns(c,table),hasOwner=columns.some(col=>col.name==='OPRID');
  if(await count(c,`SELECT COUNT(*) AS N FROM ${table} WHERE QRYNAME=:n${hasOwner?' AND OPRID=:o':''}`,hasOwner?binds:{n:name}))throw Error(table+': unsupported Query ancillary rows.');
 }
 const live=await readQueryForEdit(c,types,name,owner,lock);
 if(markers.length){
  if(!allowDeleted||live||markers.length!==1||!Number.isSafeInteger(Number(markers[0].VERSION))||Number(markers[0].VERSION)<1)throw Error('Deleted or mixed Query scope requires explicit reviewed restoration.');
  for(const table of queryTables)if(await count(c,`SELECT COUNT(*) AS N FROM ${table} WHERE QRYNAME=:n AND OPRID=:o`,binds))throw Error('Orphan Query rows coexist with deletion marker.');
  return {value:null,hash:hash(null),token:markerToken('query',markers),deleted:true};
 }
 if(!live){for(const table of queryTables)if(await count(c,`SELECT COUNT(*) AS N FROM ${table} WHERE QRYNAME=:n AND OPRID=:o`,binds))throw Error('Orphan Query rows are not absence.');return {value:null,hash:hash(null),token:'absent',deleted:false};}
 const value=querySnapshot(live.view);return {value,hash:hash(value),token:live.token,deleted:false};
}
export interface QueryReversalRequest {name:string;owner:string;after:Json;operatorId:string;expectedSnapshotToken:string;expectedAfterHash:string;dryRun?:boolean;allowDeletedBaseline?:boolean;proposedProjectDeletions?:readonly string[]}
async function mentions(c:DbConnection,name:string){
 for(const [table,column] of [['PSPCMTXT','PCTEXT'],['PSSQLTEXTDEFN','SQLTEXT']])if(await count(c,`SELECT COUNT(*) AS N FROM ${table} WHERE DBMS_LOB.INSTR(UPPER(${column}),:n)>0`,{n:name}))throw Error('Stored source references or mentions this definition.');
 if(await count(c,'SELECT COUNT(*) AS N FROM PSCONTENT WHERE DBMS_LOB.INSTR(CONTDATA,:needle)>0',{needle:Buffer.from(name,'utf16le')}))throw Error('Stored content mentions this definition.');
}
function assumptions(r:{dryRun?:boolean;proposedProjectDeletions?:readonly string[]}){if(!r.dryRun&&r.proposedProjectDeletions?.length)throw Error('Proposed deletions are rollback-preview assumptions only.');for(const n of r.proposedProjectDeletions??[])projectReviewName(n);}
export async function writeQueryReversal(c:DbConnection,types:DbTypes,r:QueryReversalRequest){
 try{
  await release(c);queryIdentity(r.name,r.owner);await operator(c,r.name,r.operatorId);assumptions(r);if(r.owner&&r.owner!==r.operatorId)throw Error('Only public or own private Queries can be written.');
  if(!r.expectedSnapshotToken||!r.expectedAfterHash)throw Error('Reviewed Query baseline and after-image required.');
  const counters=await cache(c,'QDM',true),before=await readQueryReversalState(c,types,r.name,r.owner,r.allowDeletedBaseline,true);
  if(before.token!==r.expectedSnapshotToken)throw Error('Complete Query baseline changed.');
  const binds=queryIdentity(r.name,r.owner);let delta=1;
  if(r.after===null){
   if(before.value===null)throw Error('Cannot delete an absent Query.');
   const full=await readQueryMigration(c,types,r.name,r.owner);if(!full||hash(full.data.view)!==before.hash)throw Error('Query checkpoint is not completely reproducible.');
   await prepareQueryExecution(c,queryView(before.value),r.operatorId);
   await noAncillary(c,'QRYNAME',r.name,[...queryTables,'PSQRYDEL'],r.owner);await mentions(c,r.name);
   const projects=r.proposedProjectDeletions??[],extra=projects.map((_,i)=>':p'+i).join(',');
   if(await count(c,`SELECT COUNT(*) AS N FROM PSPROJECTITEM WHERE OBJECTTYPE=10 AND OBJECTVALUE1=:n AND OBJECTVALUE2=:o${projects.length?' AND PROJECTNAME NOT IN ('+extra+')':''}`,{...binds,...Object.fromEntries(projects.map((v,i)=>['p'+i,v]))}))throw Error('A project still references this Query.');
   const view=queryView(before.value);for(const table of [...queryTables].reverse())await expectRows(c,`DELETE FROM ${table} WHERE QRYNAME=:n AND OPRID=:o`,binds,queryRows(view,table as keyof typeof QUERY_TABLES).length,'Deleting '+table);
   await expectRows(c,'INSERT INTO PSQRYDEL (OPRID,QRYNAME,VERSION) VALUES (:o,:n,:v)',{...binds,v:counters.v.QDM+1},1,'Recording Query deletion');await advance(c,'QDM');
  }else{
   const view=queryView(r.after);if(String(view.query.QRYNAME).trim()!==r.name||String(view.query.OPRID).trim()!==r.owner)throw Error('Query after-image identity differs.');
   if(before.deleted)await expectRows(c,'DELETE FROM PSQRYDEL WHERE QRYNAME=:n AND OPRID=:o',binds,1,'Clearing reviewed Query marker');
   if(before.value!==null)view.query={...queryView(before.value).query,...view.query};
   const saved=await saveQuery(c,types,{view,openedToken:before.deleted?'absent':before.token,operatorId:r.operatorId},true);delta=saved.written?1:0;
  }
  const after=await readQueryReversalState(c,types,r.name,r.owner,true,true);
  if(after.hash!==r.expectedAfterHash||(r.after===null?!after.deleted:after.deleted))throw Error('Complete Query after-image differs from review.');
  if(r.after===null&&after.token!==markerToken('query',[{OPRID:binds.o,QRYNAME:r.name,VERSION:counters.v.QDM+1}]))throw Error('Query marker version differs from QDM.');
  await verifyCache(c,'QDM',counters,delta);
  if(r.dryRun){await c.rollback();const restored=await readQueryReversalState(c,types,r.name,r.owner,true);if(restored.token!==before.token||canonical(await cache(c,'QDM'))!==canonical(counters))throw Error('Query rollback did not restore its complete baseline.');}else await c.commit();
  return {before,after};
 }catch(error){await c.rollback().catch(()=>{});throw error;}
}

export async function readProjectReversalState(c:DbConnection,types:DbTypes,name:string,allowDeleted=false,lock=false):Promise<ReversalState>{
 projectReviewName(name);const markers=await select<{PROJECTNAME:string;VERSION:number}>(c,`SELECT PROJECTNAME,VERSION FROM PSPROJECTDEL WHERE PROJECTNAME=:n${lock?' FOR UPDATE':''}`,{n:name});
 if(lock){await select(c,'SELECT PROJECTNAME FROM PSPROJECTDEFN WHERE PROJECTNAME=:n FOR UPDATE',{n:name});await select(c,'SELECT PROJECTNAME FROM PSPROJECTITEM WHERE PROJECTNAME=:n FOR UPDATE',{n:name});}
 const live=await readProjectCreationSnapshot(c,types,name);
 if(live.value===null)await noAncillary(c,'PROJECTNAME',name,['PSPROJECTDEFN','PSPROJECTITEM','PSPROJECTDEL']);
 if(markers.length){if(!allowDeleted||live.value!==null||markers.length!==1||!Number.isSafeInteger(Number(markers[0].VERSION))||Number(markers[0].VERSION)<1)throw Error('Deleted or mixed project scope requires explicit reviewed restoration.');await noAncillary(c,'PROJECTNAME',name,['PSPROJECTDEFN','PSPROJECTITEM','PSPROJECTDEL']);return {...live,token:markerToken('project',markers),deleted:true};}
 return {...live,deleted:false};
}
export function projectMembers(value:Json,name:string):DefinitionKey[]{
 const keys=projectCreationItems(value,name);return keys.map(k=>k.type===DefinitionType.SqlDefinition&&k.parts[1]==='0'?makeKey(k.type,k.parts[0]):k).sort((a,b)=>projectKeyIdentity(a).localeCompare(projectKeyIdentity(b)));
}
export function projectProjection(state:ReversalState,name:string,mode:'full'|'members'):Json{return state.value===null||mode==='full'?state.value:{name,members:projectMembers(state.value,name)} as unknown as Json;}
function defaultProject(value:Json,name:string){
 projectCreationItems(value,name);const header=(value as unknown as {tables:{PSPROJECTDEFN:unknown[]}}).tables.PSPROJECTDEFN[0];
 const expected={PROJECTNAME:name,...Object.fromEntries(Object.entries(NEW_PROJECT_VALUES).filter(([k])=>!['TGTOPRID','TGTOPRACCT'].includes(k)))};
 if(canonical(header as Json)!==canonical(expected as Json))throw Error('Project metadata differs from the calibrated creation defaults; cannot delete/recreate it.');
}
export interface ProjectReversalRequest {name:string;items:DefinitionKey[]|null;operatorId:string;expectedSnapshotToken:string;expectedAfterHash:string;mode:'full'|'members';dryRun?:boolean;allowDeletedBaseline?:boolean;proposed?:readonly DefinitionKey[]}
export async function writeProjectReversal(c:DbConnection,types:DbTypes,r:ProjectReversalRequest){
 try{
  await release(c);projectReviewName(r.name);await operator(c,r.name,r.operatorId);if(!r.expectedSnapshotToken||!r.expectedAfterHash)throw Error('Reviewed project baseline and after-image required.');
  if(!r.dryRun&&r.proposed?.length)throw Error('Proposed definitions are rollback-preview assumptions only.');
  const counters=await cache(c,'PJM',true),before=await readProjectReversalState(c,types,r.name,r.allowDeletedBaseline,true);
  if(before.token!==r.expectedSnapshotToken)throw Error('Complete project baseline changed.');
  await noAncillary(c,'PROJECTNAME',r.name,['PSPROJECTDEFN','PSPROJECTITEM','PSPROJECTDEL']);
  // Observe presence only. Never select, retain, restore or delete a configured
  // target account under the noncredential project-history contract.
  if(await count(c,"SELECT COUNT(*) AS N FROM PSPROJECTDEFN WHERE PROJECTNAME=:n AND (TRIM(TGTOPRID) IS NOT NULL OR TRIM(TGTOPRACCT) IS NOT NULL)",{n:r.name}))throw Error('Project target credentials are outside this reviewed scope.');
  let delta=1;
  if(r.items===null){
   if(before.value===null)throw Error('Cannot delete an absent project.');defaultProject(before.value,r.name);await mentions(c,r.name);
   const rows=await count(c,'SELECT COUNT(*) AS N FROM PSPROJECTITEM WHERE PROJECTNAME=:n',{n:r.name});
   await expectRows(c,'DELETE FROM PSPROJECTITEM WHERE PROJECTNAME=:n',{n:r.name},rows,'Deleting project membership');await expectRows(c,'DELETE FROM PSPROJECTDEFN WHERE PROJECTNAME=:n',{n:r.name},1,'Deleting project header');
   await expectRows(c,'INSERT INTO PSPROJECTDEL (PROJECTNAME,VERSION) VALUES (:n,:v)',{n:r.name,v:counters.v.PJM+1},1,'Recording project deletion');await advance(c,'PJM');
  }else{
   if(before.value!==null)throw Error('Project restoration requires a vacant scope; membership removal is not calibrated.');
   if(before.deleted)await expectRows(c,'DELETE FROM PSPROJECTDEL WHERE PROJECTNAME=:n',{n:r.name},1,'Clearing reviewed project marker');
   const created=await createProject(c,{project:r.name,operatorId:r.operatorId},true);
   if(r.items.length){await saveProject(c,{project:r.name,operatorId:r.operatorId,openedVersion:created.version,add:r.items},{deferCommit:true,proposed:r.proposed??[]});delta=2;}
  }
  const after=await readProjectReversalState(c,types,r.name,true,true),value=projectProjection(after,r.name,r.mode);
  if(hash(value)!==r.expectedAfterHash||(r.items===null?!after.deleted:after.deleted))throw Error('Complete project after-image differs from review.');
  if(r.items===null&&after.token!==markerToken('project',[{PROJECTNAME:r.name,VERSION:counters.v.PJM+1}]))throw Error('Project marker version differs from PJM.');
  await verifyCache(c,'PJM',counters,delta);
  if(r.dryRun){await c.rollback();const restored=await readProjectReversalState(c,types,r.name,true);if(restored.token!==before.token||canonical(await cache(c,'PJM'))!==canonical(counters))throw Error('Project rollback did not restore its complete baseline.');}else await c.commit();
  return {before,after};
 }catch(error){await c.rollback().catch(()=>{});throw error;}
}
