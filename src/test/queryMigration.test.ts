import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyQueryOp, newQueryDocument } from '../model/queryDocument.js';
import { querySnapshot } from '../changeReview/query.js';
import { DefinitionType, makeKey } from '../model/definitions.js';
import { checkedMigrationAsset, exportMigrationPackage, type MigrationPackageReader } from '../migrationPackage.js';

const name='ZZ_MIG_QRY';
function view(owner='') {
  return applyQueryOp(newQueryDocument(name,owner,'AAP_TBL'),{kind:'select',field:'DESCR',selected:true},{DESCR:{type:0,length:30,decimalPositions:0,format:6,shortName:'Descr',longName:'Description',editTable:'',useEdit:0}});
}
test('Query migration carries all seven semantic table scopes, owner and record prerequisite without audit stamps', async()=>{
  const source={listProjectItems:async()=>[{key:makeKey(DefinitionType.Query,name)}],readEnvironment:async()=>({toolsRelease:'8.62'}),
    readQueryForMigration:async()=>({data:{name,owner:'',view:querySnapshot(view())},token:'native-token'})} as unknown as MigrationPackageReader;
  const pkg=await exportMigrationPackage(source,'ZZ_PROJECT');assert.equal(pkg.assets.length,1);assert.equal(pkg.assets[0].kind,'query');
  assert.deepEqual(pkg.requirements,[makeKey(0,'AAP_TBL')]);assert.ok(!JSON.stringify(pkg).includes('VERSION'));assert.ok(!JSON.stringify(pkg).includes('native-token'));
});
test('Query migration rejects mismatched ownership, unhandled joins, counts and missing tables before staging',()=>{
  const data={name,owner:'',view:querySnapshot(view())},key=makeKey(DefinitionType.Query,name);
  checkedMigrationAsset('query',key,data);
  assert.throws(()=>checkedMigrationAsset('query',key,{...data,owner:'OTHER'}),/identity/);
  const multiple=view();multiple.records.push({...multiple.records[0],RCDNUM:2});
  assert.throws(()=>checkedMigrationAsset('query',key,{...data,view:querySnapshot(multiple)}),/Unsupported Query/);
  const invalid=view();invalid.query.SELCOUNT=4;
  assert.throws(()=>checkedMigrationAsset('query',key,{...data,view:querySnapshot(invalid)}),/Unsupported Query/);
  const partial=querySnapshot(view()) as Record<string,unknown>;delete partial.binds;
  assert.throws(()=>checkedMigrationAsset('query',key,{...data,view:partial}),/Unsupported Query|Incomplete Query/);
});
