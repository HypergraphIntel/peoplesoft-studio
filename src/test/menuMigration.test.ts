import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ADAPTER_TYPES,type DbConnection} from '../db/connection.js';
import {newMenu,insertBar,insertItem,rowsFromDocument,type Row} from '../model/menuDocument.js';
import {checkedMenuMigration,checkMenuMigrationUpdate,menuMigrationData,readMenuMigration} from '../providers/menuMigration.js';
import {checkedMigrationAsset,exportMigrationPackage,type MigrationPackageReader} from '../migrationPackage.js';
import {DefinitionType,makeKey} from '../model/definitions.js';
import {PC_KEY_COLUMNS} from '../providers/appEngineWriter.js';

function menu() {return insertItem(insertBar(newMenu('ZZ_MENU',0),{name:'USE',label:'Use'}).doc,'USE',{name:'VIEW',type:5,label:'View',component:'PERSONAL_DATA',market:'GBL',searchRecord:'PERSON_SRCH'}).doc;}
function fixture() {
 const rows=rowsFromDocument(menu()), tables:Record<string,Row[]>={PSMENUDEFN:[{...rows.menu,VERSION:5,LASTUPDDTTM:'2026-10-20T10:00:00.000000',LASTUPDOPRID:'JARED'}],PSMENUITEM:rows.items,PSXFERITEM:rows.transfers,PSMENUDEFNLANG:[],PSMENUITEMLANG:[],PSMENUORIGIN:rows.origins,PSMENUDEL:[],PSPCMPROG:[],PSPCMTXT:[],PSPCMNAME:[],PSPCMPROGDEL:[]};
 const pcColumns:Record<string,string[]>={PSPCMPROG:['PROGSEQ','VERSION','NAMECOUNT','PROGLEN','PROGRUNLOC','PROGFLAGS','LICENSE_CODE','LASTUPDDTTM','LASTUPDOPRID','PROGEXTENDS','PTTOOLSREL','PROGTXT'],PSPCMTXT:['PROGSEQ','HASH_SIGNATURE','PCTEXT'],PSPCMNAME:['NAMENUM','RECNAME','REFNAME','PACKAGEROOT','QUALIFYPATH','APPCLASSMETHOD'],PSPCMPROGDEL:['VERSION']};
 const c={catalog:{columns:async(_c:unknown,t:string)=>(pcColumns[t]?[...PC_KEY_COLUMNS,...pcColumns[t]]:Object.keys(tables[t][0]??{MENUNAME:''})).map(name=>({name,dataType:'VARCHAR2'}))},execute:async(sql:string)=>{
   const table=sql.match(/FROM (\w+)/)?.[1];if(!table||!tables[table])throw Error(sql);
   if(sql.includes('MENUNAME <>'))return {rows:[]};
   return {rows:structuredClone(tables[table])};
 }} as unknown as DbConnection;
 return {tables,c};
}
test('menu migration carries complete canonical item/transfer/PeopleCode payloads and declares dependencies',async()=>{
 const doc=menu(),data=menuMigrationData(doc);checkedMenuMigration(data);assert.ok(!('storedGroup' in data));
 const key=makeKey(DefinitionType.Menu,doc.name),source={listProjectItems:async()=>[{key}],readEnvironment:async()=>({toolsRelease:'8.62'}),readMenuForMigration:async()=>({data,token:'native'})} as unknown as MigrationPackageReader;
 const pkg=await exportMigrationPackage(source,'ZZ_PROJECT');assert.equal(pkg.assets[0].kind,'menu');assert.deepEqual(pkg.requirements,[makeKey(DefinitionType.Component,'PERSONAL_DATA','GBL'),makeKey(DefinitionType.Record,'PERSON_SRCH')]);
 assert.throws(()=>checkedMigrationAsset('menu',key,{...data,unexpected:true}));
 assert.throws(()=>checkedMenuMigration({...data,bars:[...data.bars,{name:'EMPTY',label:'',items:[]}]}));
 assert.throws(()=>checkedMenuMigration({...data,languages:[{LANGUAGE_CD:'ESP'}]}));
});
test('full menu token catches unversioned header/item/stamp edits; missing-header children and unknown columns refuse',async()=>{
 const f=fixture(),a=(await readMenuMigration(f.c,ADAPTER_TYPES,'ZZ_MENU'))!;
 f.tables.PSMENUITEM[0].ITEMLABEL='Changed';const b=(await readMenuMigration(f.c,ADAPTER_TYPES,'ZZ_MENU'))!;assert.notEqual(a.token,b.token);assert.equal(a.writerToken,b.writerToken);
 f.tables.PSMENUDEFN[0].LASTUPDDTTM='2026-10-20T10:00:00.000001';assert.notEqual((await readMenuMigration(f.c,ADAPTER_TYPES,'ZZ_MENU'))!.token,b.token);
 f.tables.PSMENUITEM[0].UNKNOWN_NATIVE=7;await assert.rejects(readMenuMigration(f.c,ADAPTER_TYPES,'ZZ_MENU'),/unmodeled/);delete f.tables.PSMENUITEM[0].UNKNOWN_NATIVE;
 f.tables.PSMENUDEFN=[];await assert.rejects(readMenuMigration(f.c,ADAPTER_TYPES,'ZZ_MENU'),/orphaned/);
});
test('menu migration refuses group edits and target item removal while allowing scoped additions and label updates',()=>{
 const before=menuMigrationData(menu());checkMenuMigrationUpdate(undefined,before);
 checkMenuMigrationUpdate(before,{...before,label:'Changed'});
 for(const patch of [{group:'OTHER'},{groupOrder:1},{type:1},{bars:[]}])assert.throws(()=>checkMenuMigrationUpdate(before,{...before,...patch} as typeof before),/cannot/);
});
test('menu migration refuses hidden program keys instead of filtering them from the package',async()=>{
 const f=fixture();f.tables.PSPCMTXT.push({OBJECTID1:3,OBJECTVALUE1:'ZZ_MENU',OBJECTVALUE2:'USE',OBJECTVALUE3:'VIEW',OBJECTVALUE4:'OTHER'});
 await assert.rejects(readMenuMigration(f.c,ADAPTER_TYPES,'ZZ_MENU'),/unmodeled or orphaned menu PeopleCode/);
});
test('menu and explicit ItemSelected project memberships export one owning asset and reject overlapping proposals',async()=>{
 const doc=insertItem(newMenu('ZZ_MENU',1),'MENUITEM1',{name:'RUN',type:9,label:'Run',peopleCode:'MessageBox(0, "", 0, 0, "test");\r\n'}).doc;
 const data=menuMigrationData(doc),key=makeKey(DefinitionType.Menu,doc.name),pc=makeKey(DefinitionType.MenuPeopleCode,doc.name,'MENUITEM1','RUN','ItemSelected');
 const source={listProjectItems:async()=>[{key:pc},{key}],readEnvironment:async()=>({toolsRelease:'8.62'}),readMenuForMigration:async()=>({data,token:'native'}),readPeopleCodeForEdit:async()=>({text:data.bars[0].items[0].peopleCode,fingerprint:'pc'})} as unknown as MigrationPackageReader;
 const pkg=await exportMigrationPackage(source,'ZZ_PROJECT');assert.equal(pkg.assets.length,1);assert.equal(pkg.members.length,2);assert.deepEqual(pkg.requirements,[]);
});
