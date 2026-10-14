import {test} from 'node:test';
import assert from 'node:assert/strict';
import {awaitWriteApproval,runAsAgent,withWriteRequest} from '../providers/writeGuard.js';
test('timed out approvals never trigger a write when accepted later',async()=>{
 let accept!:(v:boolean)=>void,written=false;
 const pending=new Promise<boolean>(r=>accept=r);
 await assert.rejects(()=>runAsAgent(async()=>{if(await awaitWriteApproval(pending,'Test approval',5))written=true;}),/timed out/);
 accept(true);await Promise.resolve();assert.equal(written,false);
});
test('MCP cancellation stops approval waits and ignores a late session approval',async()=>{
 const c=new AbortController();let accept!:(v:boolean)=>void,written=false;
 const pending=new Promise<boolean>(r=>accept=r);
 const call=withWriteRequest(c.signal,()=>runAsAgent(async()=>{if(await awaitWriteApproval(pending,'Ownership approval'))written=true;}));
 c.abort();await assert.rejects(call,/cancelled/);accept(true);await Promise.resolve();assert.equal(written,false);
});
