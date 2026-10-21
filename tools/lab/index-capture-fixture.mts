/** Scratch HRDMO definitions for the App Designer user-index (ix*), SubRecord (sb*) and package-property (pk*) captures. */
import assert from 'node:assert/strict';
import {DatabaseProvider} from '../../src/providers/database.js';
import {openDatabase} from '../../src/db/open.js';
import {DefinitionType,makeKey} from '../../src/model/definitions.js';
import {RecordType} from '../../src/model/record.js';
import {applyRecordOperations} from '../../src/model/recordOperations.js';
import {setWriteNamePrefix} from '../../src/providers/writeScope.js';
const config={name:'HRDMO capture fixture',platform:'oracle' as const,connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};assert.match(config.connectString,/hrdmo/i);
const table='ZZ_PCODE_LAB_IX',subrecord='ZZ_PCODE_LAB_SB',pkg='ZZ_PCODE_LAB_PK',operatorId=process.env.PSLAB_OPERATOR??'JARED';
const p=new DatabaseProvider(config),pool=await openDatabase('oracle',config),c=await pool.getConnection();setWriteNamePrefix('ZZ_PCODE_LAB');
try{await p.connect();
 if(process.argv[2]==='create'){
  assert.equal(await p.readRecordLayout(makeKey(DefinitionType.Record,table)),undefined);
  const edit=applyRecordOperations({recname:table,recordType:RecordType.Table,openedVersion:0,fields:[],isNew:true},RecordType.Table,[
   {op:'insert_field',field:'EMPLID'},{op:'insert_field',field:'EFFDT'},{op:'insert_field',field:'DESCR'},{op:'insert_field',field:'EFF_STATUS'},
   {op:'set_use',field:'EMPLID',key:true},{op:'set_use',field:'EFFDT',key:true},{op:'set_properties',description:'Index capture'}]);
  await p.saveRecord({operatorId,edit});console.log('created',table);
 }else if(process.argv[2]==='package'){
  assert.equal(await p.readPackageForMigration(pkg),undefined);await p.createPackage({name:pkg,operatorId});
  const doc=(await p.readPackageForMigration(pkg))!;await p.createSubpackage({root:pkg,path:['SUB'],openedVersion:doc.version,operatorId});console.log('created',pkg);
 }else if(process.argv[2]==='cleanup-package'){
  for(const t of ['PSPCMTXT','PSPCMNAME','PSPCMPROG'])await c.execute(`DELETE FROM ${t} WHERE OBJECTID1=104 AND OBJECTVALUE1=:r`,{r:pkg});
  await c.execute('DELETE FROM PSAPPCLASSDEFN WHERE PACKAGEROOT=:r',{r:pkg});await c.execute('DELETE FROM PSPACKAGEDEFN WHERE PACKAGEROOT=:r',{r:pkg});await c.commit();console.log('removed',pkg);
 }else if(process.argv[2]==='cleanup'){
  for(const r of [table,subrecord])for(const t of ['PSKEYDEFN','PSINDEXDEFN','PSIDXDDLPARM','PSRECFIELDDB','PSRECFIELD','PSRECTBLSPC','PSRECDDLPARM','PSRECDEFN','PSRECDEL'])await c.execute(`DELETE FROM ${t} WHERE RECNAME=:n`,{n:r});
  await c.commit();console.log('removed');
 }else throw Error('create|cleanup');
}finally{await c.close();await pool.close();await p.dispose();}
