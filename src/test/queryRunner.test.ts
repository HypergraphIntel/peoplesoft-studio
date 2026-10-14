import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requireQueryRecordAccess,validateQueryPromptValues} from '../providers/queryRunner.js';
import type {DbConnection} from '../db/connection.js';

function connection(rows: unknown[], calls:string[]):DbConnection {
 return {execute:async <T>(sql:string)=>{calls.push(sql);return {rows:rows as T[]};},rollback:async()=>{},commit:async()=>{},close:async()=>{},catalog:{columns:async()=>[],tableExists:async()=>true}};
}
test('no access grant, a denied grant, or overlapping unknown grant never authorize query execution',async()=>{
 for(const grants of [[],[{ACCESSIBLE:'N'}],[{ACCESSIBLE:'Y'},{ACCESSIBLE:'N'}],[{ACCESSIBLE:'?'}]]){
  await assert.rejects(()=>requireQueryRecordAccess(connection(grants,[]),'JARED','AAP_TBL'));
 }
 const calls:string[]=[];
 await requireQueryRecordAccess(connection([{ACCESSIBLE:'Y'}],calls),'JARED','AAP_TBL');
 assert(calls[0].includes("D.EFF_STATUS='A'"));
 assert(calls[0].includes('FROM PSTREEDEFN X'));
});
test('a mixed-case No Table Edit prompt stays mixed-case and never queries a prompt table',async()=>{
 const calls:string[]=[];
 const values=await validateQueryPromptValues(connection([],calls),{sql:'unused',columns:[],prompts:[{BNDNUM:2,FIELDTYPE:0,FORMAT:6,LENGTH:30,USEEDIT:0,QRYREQUIREDPROMPT:'Y'}]},'JARED',{'2':'GBI Data Processing Cntr'});
 assert.deepEqual(values,{'2':'GBI Data Processing Cntr'});
 assert.deepEqual(calls,[]);
});
