/**
 * Scratch HRDMO definitions for the App Designer File > Delete captures (dl*): `create` or `cleanup`. The page and
 * component are row copies of delivered HRS_APP_PRINT_PAGE / DEPEND_BENEF (read only), each with one PeopleCode program.
 */
import assert from 'node:assert/strict';
import {DatabaseProvider} from '../../src/providers/database.js';
import {openDatabase} from '../../src/db/open.js';
import {DefinitionType,makeKey} from '../../src/model/definitions.js';
import {canonical} from '../../src/changeReview/model.js';
import {PAGE_SNAPSHOT_TABLES} from '../../src/providers/pageSnapshot.js';
import {COMPONENT_TABLES} from '../../src/providers/componentMigration.js';
import {setWriteNamePrefix} from '../../src/providers/writeScope.js';
const config={name:'HRDMO deletion capture fixture',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};assert.match(config.connectString,/hrdmo/i);
export const DELETION_FIXTURES={page:'ZZ_PCODE_LAB_DPG',component:'ZZ_PCODE_LAB_DCM',field:'ZZ_PCODE_LAB_DF',root:'ZZ_PCODE_LAB_DPK'};
const n=DELETION_FIXTURES,operatorId=process.env.PSLAB_OPERATOR??'JARED';
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection();setWriteNamePrefix('ZZ_PCODE_LAB');
const sorted=<T,>(rows:T[])=>rows.sort((a,b)=>canonical(a as never)<canonical(b as never)?-1:1);
try{await p.connect();
 if(process.argv[2]==='create'){
  const page=(await p.readPageForMigration('HRS_APP_PRINT_PAGE'))!.data.native,swap=(v:unknown)=>typeof v==='string'&&(v.trim()==='HRS_APP_PRINT_PAGE'||v.startsWith('HRS_APP_PRINT_PAGE$'))?n.page+v.trim().slice(18):v;
  await p.createPageFromMigration({operatorId,data:{name:n.page,native:{scope:page.scope,tables:Object.fromEntries(PAGE_SNAPSHOT_TABLES.map(t=>[t,sorted(page.tables[t].map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,['PNLNAME','PARENTPNLFLDID','PAGEPNLFLDID'].includes(k)?swap(v):v]))))]))} as never}});
  await p.savePeopleCode(makeKey(DefinitionType.PagePeopleCode,n.page,'Activate'),{source:'Local number &n = 1;\r\n',openedFingerprint:'absent',operatorId});
  const comp=(await p.readComponentForMigration('DEPEND_BENEF','GBL'))!.data;
  await p.createComponentFromMigration({operatorId,data:{name:n.component,market:'GBL',tables:Object.fromEntries(COMPONENT_TABLES.map(t=>[t,sorted(comp.tables[t].map(r=>({...r,PNLGRPNAME:n.component})))])) as never}});
  await p.savePeopleCode(makeKey(DefinitionType.ComponentPeopleCode,n.component,'GBL','PreBuild'),{source:'Local number &n = 2;\r\n',openedFingerprint:'absent',operatorId});
  const v=await p.createField({name:n.field,type:0,length:2,decimalPositions:0,label:{id:n.field,longName:'Deletion field',shortName:'Del'},operatorId});
  await p.saveField({name:n.field,openedVersion:v.version,operatorId,labels:[{id:n.field,longName:'Deletion field',shortName:'Del',isDefault:true},{id:n.field+'2',longName:'Second label',shortName:'Two',isDefault:false}]});
  await p.saveTranslate(n.field,{kind:'add',item:{value:'A',effectiveDate:'1900-01-01',status:'A',longName:'Active',shortName:'Act'}},operatorId);
  await p.createPackage({name:n.root,operatorId});const doc=(await p.readPackageForMigration(n.root))!;await p.createSubpackage({root:n.root,path:['UI'],openedVersion:doc.version,operatorId});
  await p.savePeopleCode(makeKey(DefinitionType.ApplicationClassPeopleCode,n.root,'UI','Panel','OnExecute'),{source:'class Panel\r\nend-class;\r\n',openedFingerprint:'absent',operatorId,createClass:true});
  console.log('created',JSON.stringify(n));
 }else if(process.argv[2]==='package2'){
  const root=n.root+'2';await p.createPackage({name:root,operatorId});const doc=(await p.readPackageForMigration(root))!;await p.createSubpackage({root,path:['UI'],openedVersion:doc.version,operatorId});
  for(const parts of [['Top'],['UI','Panel']])await p.savePeopleCode(makeKey(DefinitionType.ApplicationClassPeopleCode,root,...parts,'OnExecute'),{source:`class ${parts.at(-1)}\r\nend-class;\r\n`,openedFingerprint:'absent',operatorId,createClass:true});
  console.log('created',root);
 }else if(process.argv[2]==='plain'){
  // Without PeopleCode / translate values / classes, and a package with two classes for single-class deletion.
  const page=(await p.readPageForMigration('HRS_APP_PRINT_PAGE'))!.data.native,to=n.page+'N',swap=(v:unknown)=>typeof v==='string'&&(v.trim()==='HRS_APP_PRINT_PAGE'||v.startsWith('HRS_APP_PRINT_PAGE$'))?to+v.trim().slice(18):v;
  await p.createPageFromMigration({operatorId,data:{name:to,native:{scope:page.scope,tables:Object.fromEntries(PAGE_SNAPSHOT_TABLES.map(t=>[t,sorted(page.tables[t].map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,['PNLNAME','PARENTPNLFLDID','PAGEPNLFLDID'].includes(k)?swap(v):v]))))]))} as never}});
  const comp=(await p.readComponentForMigration('DEPEND_BENEF','GBL'))!.data;
  await p.createComponentFromMigration({operatorId,data:{name:n.component+'N',market:'GBL',tables:Object.fromEntries(COMPONENT_TABLES.map(t=>[t,sorted(comp.tables[t].map(r=>({...r,PNLGRPNAME:n.component+'N'})))])) as never}});
  await p.createField({name:n.field+'N',type:0,length:2,decimalPositions:0,label:{id:n.field+'N',longName:'Plain field',shortName:'Plain'},operatorId});
  for(const [root,classes] of [[n.root+'E',[]],[n.root+'C',[['Top'],['UI','Panel']]]] as const){await p.createPackage({name:root,operatorId});const doc=(await p.readPackageForMigration(root))!;await p.createSubpackage({root,path:['UI'],openedVersion:doc.version,operatorId});
   for(const parts of classes)await p.savePeopleCode(makeKey(DefinitionType.ApplicationClassPeopleCode,root,...parts,'OnExecute'),{source:`class ${parts.at(-1)}\r\nend-class;\r\n`,openedFingerprint:'absent',operatorId,createClass:true});}
  console.log('created plain fixtures');
 }else if(process.argv[2]==='cleanup'){
  for(const pg of [n.page,n.page+'N']){for(const t of [...PAGE_SNAPSHOT_TABLES].reverse())await c.execute(`DELETE FROM ${t} WHERE PNLNAME=:n`,{n:pg});await c.execute('DELETE FROM PSPNLDEL WHERE PNLNAME=:n',{n:pg});}
  for(const cm of [n.component,n.component+'N']){for(const t of [...COMPONENT_TABLES].reverse())await c.execute(`DELETE FROM ${t} WHERE PNLGRPNAME=:n`,{n:cm});await c.execute('DELETE FROM PSPNLGRPDEL WHERE PNLGRPNAME=:n',{n:cm});}
  for(const f of [n.field,n.field+'N'])for(const t of ['PSXLATITEM','PSXLATDEFN','PSXLATDEFNDEL','PSDBFLDLABL','PSDBFIELD'])await c.execute(`DELETE FROM ${t} WHERE FIELDNAME=:n`,{n:f});
  for(const [id,v] of [[9,n.page],[10,n.component],[104,n.root],[104,n.root+'2'],[104,n.root+'E'],[104,n.root+'C']] as const)for(const t of ['PSPCMTXT','PSPCMNAME','PSPCMPROG','PSPCMPROGDEL'])await c.execute(`DELETE FROM ${t} WHERE OBJECTID1=:i AND OBJECTVALUE1=:n`,{i:id,n:v});
  for(const r of [n.root,n.root+'2',n.root+'E',n.root+'C']){await c.execute('DELETE FROM PSAPPCLASSDEFN WHERE PACKAGEROOT=:r',{r});await c.execute('DELETE FROM PSPACKAGEDEFN WHERE PACKAGEROOT=:r',{r});await c.execute('DELETE FROM PSPACKAGEDEL WHERE PACKAGEROOT=:r',{r});}
  await c.commit();console.log('removed');
 }else throw Error('create|cleanup');
}finally{await c.close();await pool.close();await p.dispose();}
