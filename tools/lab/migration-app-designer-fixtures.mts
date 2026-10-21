/**
 * Migration-created HRDMO fixtures for App Designer checks: sources are created, exported, removed and
 * imported again, then LEFT in place. `--snapshot <prefix> <label>` records their complete rows; `--cleanup <prefix>`
 * removes them. Only the delivered sources HRS_APP_PRINT_PAGE, DEPEND_BENEF and ABS_HIST_GERSBR are read.
 */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {DatabaseProvider} from '../../src/providers/database.js';
import {openDatabase} from '../../src/db/open.js';
import {DefinitionType,makeKey} from '../../src/model/definitions.js';
import {RecordType} from '../../src/model/record.js';
import {canonical} from '../../src/changeReview/model.js';
import {PAGE_SNAPSHOT_TABLES} from '../../src/providers/pageSnapshot.js';
import {COMPONENT_TABLES} from '../../src/providers/componentMigration.js';
import {setWriteNamePrefix} from '../../src/providers/writeScope.js';
import {databaseMigrationTarget} from '../../src/providers/migrationTarget.js';
import {exportMigrationPackage,previewMigrationImport,applyMigrationImport} from '../../src/migrationPackage.js';
const config={name:'HRDMO migration App Designer fixtures',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};assert.match(config.connectString,/hrdmo/i);
const [mode,given,label]=process.argv.slice(2),prefix=given??'ZZ_BV'+randomBytes(3).toString('hex').toUpperCase(),operatorId=process.env.PSLAB_OPERATOR??'JARED';
const n={field:prefix+'F',phone:prefix+'C',record:prefix+'W',root:prefix+'PKG',page:prefix+'G',component:prefix+'M',project:prefix+'P'};
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection();setWriteNamePrefix(prefix);
const sorted=(rows:Record<string,unknown>[])=>rows.sort((a,b)=>canonical(a as never)<canonical(b as never)?-1:1);
async function rows(){
 const q=async(sql:string,binds:Record<string,unknown>)=>((await c.execute<Record<string,unknown>>(sql,binds,{outFormat:pool.types.OUT_FORMAT_OBJECT,fetchInfo:{DESCRLONG:{type:pool.types.STRING},HTMLAREA:{type:pool.types.STRING},FFSTYLELONG:{type:pool.types.STRING}}})).rows??[])
  .map(r=>JSON.stringify(r,(_k,v)=>v instanceof Date?v.toISOString():v)).sort().map(r=>JSON.parse(r));
 const out:Record<string,unknown>={};
 for(const t of PAGE_SNAPSHOT_TABLES)out[t]=await q(`SELECT * FROM ${t} WHERE PNLNAME=:n`,{n:n.page});
 for(const t of COMPONENT_TABLES)out[t]=await q(`SELECT * FROM ${t} WHERE PNLGRPNAME=:n`,{n:n.component});
 for(const t of ['PSDBFIELD','PSDBFLDLABL','PSXLATITEM','PSXLATDEFN'])out[t]=await q(`SELECT * FROM ${t} WHERE FIELDNAME IN (:a,:b)`,{a:n.field,b:n.phone});
 for(const t of ['PSRECDEFN','PSRECFIELD','PSRECFIELDDB'])out[t]=await q(`SELECT * FROM ${t} WHERE RECNAME=:n`,{n:n.record});
 for(const t of ['PSPACKAGEDEFN','PSAPPCLASSDEFN'])out[t]=await q(`SELECT * FROM ${t} WHERE PACKAGEROOT=:n`,{n:n.root});
 return out;
}
async function cleanup(){
 for(const t of [...PAGE_SNAPSHOT_TABLES].reverse())await c.execute(`DELETE FROM ${t} WHERE PNLNAME=:n`,{n:n.page});
 for(const t of [...COMPONENT_TABLES].reverse())await c.execute(`DELETE FROM ${t} WHERE PNLGRPNAME=:n`,{n:n.component});
 for(const t of ['PSRECFIELDDB','PSRECFIELD','PSINDEXDEFN','PSKEYDEFN','PSRECTBLSPC','PSRECDEFN'])await c.execute(`DELETE FROM ${t} WHERE RECNAME=:n`,{n:n.record});
 for(const f of [n.field,n.phone])for(const t of ['PSXLATITEM','PSXLATDEFN','PSXLATDEFNDEL','PSDBFLDLABL','PSDBFIELD'])await c.execute(`DELETE FROM ${t} WHERE FIELDNAME=:n`,{n:f});
 for(const t of ['PSPCMTXT','PSPCMNAME','PSPCMPROG'])await c.execute(`DELETE FROM ${t} WHERE OBJECTID1=104 AND OBJECTVALUE1=:r`,{r:n.root});
 await c.execute('DELETE FROM PSAPPCLASSDEFN WHERE PACKAGEROOT=:r',{r:n.root});await c.execute('DELETE FROM PSPACKAGEDEFN WHERE PACKAGEROOT=:r',{r:n.root});
 for(const t of ['PSPROJECTITEM','PSPROJECTDEFN'])await c.execute(`DELETE FROM ${t} WHERE PROJECTNAME=:n`,{n:n.project});await c.commit();
}
try{await p.connect();
 if(mode==='--cleanup'){assert.ok(given?.startsWith('ZZ_BV'));await cleanup();console.log('removed',prefix);}
 else if(mode==='--snapshot'){assert.ok(given?.startsWith('ZZ_BV')&&label);await mkdir('tools/lab/results/migration-app-designer-check',{recursive:true});await writeFile(`tools/lab/results/migration-app-designer-check/${label}.json`,JSON.stringify({prefix,label,at:new Date().toISOString(),rows:await rows()},null,1)+'\n');console.log('snapshot',label);}
 else if(mode==='--diff'){const [a,b]=[given,label];const x=JSON.parse(await readFile(`tools/lab/results/migration-app-designer-check/${a}.json`,'utf8')).rows,y=JSON.parse(await readFile(`tools/lab/results/migration-app-designer-check/${b}.json`,'utf8')).rows;
  for(const t of Object.keys(x)){const xs=x[t].map((r:unknown)=>JSON.stringify(r)),ys=y[t].map((r:unknown)=>JSON.stringify(r));const gone=xs.filter((r:string)=>!ys.includes(r)),added=ys.filter((r:string)=>!xs.includes(r));if(gone.length||added.length)console.log(t,JSON.stringify({before:gone.map((r:string)=>JSON.parse(r)),after:added.map((r:string)=>JSON.parse(r))},null,0));}}
 else{
  // Sources: properties + translates, a format-family field, a package with a nested class, a Derived/Work record with a subrecord, page and component copies.
  for(const [name,shape,props] of [[n.field,{type:0,length:2,decimalPositions:0},{format:6,formatFamily:'',displayName:'',formatLength:0,defaultCenturyYear:50,imeMode:1,ownerId:'PPT'}],
   [n.phone,{type:0,length:12,decimalPositions:0},{format:14,formatFamily:'PHONE',displayName:'NORMAL',formatLength:10,defaultCenturyYear:50,imeMode:0,ownerId:''}]] as const){
   const v=await p.createField({name,...shape,label:{id:name,longName:'Check '+name.slice(-1),shortName:name.slice(-1)},operatorId});await p.saveField({name,openedVersion:v.version,operatorId,properties:{...props}});}
  for(const item of [{value:'A',effectiveDate:'1900-01-01',status:'A',longName:'Active',shortName:'Act'},{value:'I',effectiveDate:'1900-01-01',status:'A',longName:'Inactive',shortName:'Inact'}])await p.saveTranslate(n.field,{kind:'add',item},operatorId);
  await p.createPackage({name:n.root,operatorId});const doc=(await p.readPackageForMigration(n.root))!;await p.createSubpackage({root:n.root,path:['UI'],openedVersion:doc.version,operatorId});
  await p.savePeopleCode(makeKey(DefinitionType.ApplicationClassPeopleCode,n.root,'UI','Panel','OnExecute'),{source:'class Panel\n   method Panel();\nend-class;\n\nmethod Panel\nend-method;\n',openedFingerprint:'absent',operatorId,createClass:true});
  await p.saveRecord({operatorId,edit:{recname:n.record,recordType:RecordType.DerivedWork,openedVersion:0,isNew:true,properties:{description:'Check record'},fields:[{name:n.field,useEdit:0,useEdit2:0,isNew:true},{name:'ABS_HIST_GERSBR',useEdit:0,useEdit2:0,isNew:true,isSubrecord:true}]}});
  const page=(await p.readPageForMigration('HRS_APP_PRINT_PAGE'))!.data.native,swap=(v:unknown)=>typeof v==='string'&&(v.trim()==='HRS_APP_PRINT_PAGE'||v.startsWith('HRS_APP_PRINT_PAGE$'))?n.page+v.trim().slice(18):v;
  await p.createPageFromMigration({operatorId,data:{name:n.page,native:{scope:page.scope,tables:Object.fromEntries(PAGE_SNAPSHOT_TABLES.map(t=>[t,sorted(page.tables[t].map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,['PNLNAME','PARENTPNLFLDID','PAGEPNLFLDID'].includes(k)?swap(v):v]))) as never)]))} as never}});
  const comp=(await p.readComponentForMigration('DEPEND_BENEF','GBL'))!.data;
  await p.createComponentFromMigration({operatorId,data:{name:n.component,market:'GBL',tables:Object.fromEntries(COMPONENT_TABLES.map(t=>[t,sorted(comp.tables[t].map(r=>({...r,PNLGRPNAME:n.component})))])) as never}});
  const created=await p.createProject({project:n.project,operatorId});
  await p.saveProject({project:n.project,operatorId,openedVersion:created.version,add:[makeKey(DefinitionType.Field,n.field),makeKey(DefinitionType.Field,n.phone),makeKey(DefinitionType.Record,n.record),makeKey(DefinitionType.ApplicationPackage,n.root,n.root,'.'),makeKey(DefinitionType.Page,n.page),makeKey(DefinitionType.Component,n.component,'GBL')]});
  const pkg=await exportMigrationPackage(p,n.project);await cleanup();
  const target=await databaseMigrationTarget(p,operatorId),plan=await previewMigrationImport(pkg,target);assert.deepEqual(plan.blockers,[]);
  const r=await applyMigrationImport(pkg,plan,target);assert.equal(r.error,undefined,r.error);
  console.log(JSON.stringify({prefix,...n,assets:pkg.assets.map(a=>a.kind+':'+a.key.parts.join('.'))}));
 }
}finally{await c.close();await pool.close();await p.dispose();}
