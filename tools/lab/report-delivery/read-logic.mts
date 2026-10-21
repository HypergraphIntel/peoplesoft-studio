/** Read delivered native report-node configuration logic, without executing it. */
import {DatabaseProvider} from '../../../src/providers/database.js';
import {DefinitionType,makeKey} from '../../../src/model/definitions.js';
const p=new DatabaseProvider({name:'HRDMO report logic',platform:'oracle',connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!});
try{
 await p.connect();
 console.log(await p.readText(makeKey(DefinitionType.RecordPeopleCode,'CDM_URL_PROPS','CDM_TRPROTOCOL','FieldFormula')));
 const rows=await p.runReadOnlyQuery("SELECT DISTINCT OBJECTID3,OBJECTID4,OBJECTVALUE1 V1,OBJECTVALUE2 V2,OBJECTVALUE3 V3,OBJECTVALUE4 V4 FROM PSPCMPROG WHERE OBJECTVALUE1='PRCSDISTNODEDEFN' AND (OBJECTID3=12 OR OBJECTID4=12) ORDER BY V2,V3,V4");
 for(const r of rows.rows){const parts=[r.V1,r.V2,r.V3,...(Number(r.OBJECTID4)===12?[r.V4]:[])].map(v=>String(v).trim());const type=Number(r.OBJECTID3)===12?DefinitionType.ComponentPeopleCode:DefinitionType.ComponentRecordPeopleCode;
  console.log(parts.join('.'));const text=await p.readText(makeKey(type,...parts));console.log(text);
 }
}finally{await p.dispose();}
