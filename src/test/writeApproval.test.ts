import {test} from 'node:test';
import assert from 'node:assert/strict';
import {awaitWriteApproval,runAsAgent,withWriteRequest} from '../providers/writeGuard.js';
import { WriteApprovals } from '../model/writeApprovals.js';
test('timed out approvals never trigger a write when accepted later',async()=>{
 let accept!:(v:boolean)=>void,written=false;
 const pending=new Promise<boolean>(r=>accept=r);
 await assert.rejects(()=>runAsAgent(async()=>{if(await awaitWriteApproval(pending,'Test approval',5))written=true;}),/timed out/);
 accept(true);await Promise.resolve();assert.equal(written,false);
});
test('visible approval expiry removes authorization; retry gets a fresh identity and decision', async () => {
 const queue = new WriteApprovals(); let writes = 0;
 const input = { title: 'Save lab object', detail: 'Exact connection/object/payload', choices: ['Allow'] };
 const first = runAsAgent(async () => { if (await awaitWriteApproval(signal => queue.request(input, signal), 'Write', 5)) writes++; });
 const id = queue.list()[0].id;
 await assert.rejects(first, /timed out.*Nothing was written/);
 assert.equal(queue.list()[0].state, 'EXPIRED');
 assert.equal(queue.decide(id, 'Allow'), false);
 assert.equal(writes, 0);
 const retry = runAsAgent(async () => { if (await awaitWriteApproval(signal => queue.request(input, signal), 'Write')) writes++; });
 const fresh = queue.list()[0].id; assert.notEqual(fresh, id);
 assert.equal(queue.decide(fresh, 'Approve for This Session'), false);
 assert.equal(queue.decide(fresh, 'Allow'), true);
 assert.equal(queue.decide(fresh, 'Allow'), false);
 await retry; assert.equal(writes, 1);
 assert.deepEqual(queue.list().map(r => r.state), ['APPROVED', 'EXPIRED']);
});
test('cancellation closes only its own pending card and cannot approve another request', async () => {
 const queue = new WriteApprovals(), controller = new AbortController();
 const input = { title: 'Save', detail: 'Lab', choices: ['Allow'] };
 const first = withWriteRequest(controller.signal, () => runAsAgent(() => awaitWriteApproval(signal => queue.request(input, signal), 'Write')));
 const oldId = queue.list()[0].id;
 const second = runAsAgent(() => awaitWriteApproval(signal => queue.request(input, signal), 'Write'));
 controller.abort(); await assert.rejects(first, /cancelled/);
 assert.equal(queue.list().find(r => r.id === oldId)?.state, 'CANCELLED');
 assert.equal(queue.decide(oldId, 'Allow'), false);
 assert.equal(queue.list()[0].state, 'PENDING');
 queue.decide(queue.list()[0].id); assert.equal(await second, undefined);
 assert.equal(queue.list()[0].state, 'DECLINED');
});
test('already cancelled requests never create a pending confirmation', async () => {
 const queue = new WriteApprovals(), controller = new AbortController();controller.abort();
 await assert.rejects(withWriteRequest(controller.signal, () => runAsAgent(() => awaitWriteApproval(signal => queue.request({title:'Save',detail:'Lab',choices:['Allow']}, signal), 'Write'))));
 assert.equal(queue.list().length, 0);
});
test('MCP cancellation stops approval waits and ignores a late session approval',async()=>{
 const c=new AbortController();let accept!:(v:boolean)=>void,written=false;
 const pending=new Promise<boolean>(r=>accept=r);
 const call=withWriteRequest(c.signal,()=>runAsAgent(async()=>{if(await awaitWriteApproval(pending,'Ownership approval'))written=true;}));
 c.abort();await assert.rejects(call,/cancelled/);accept(true);await Promise.resolve();assert.equal(written,false);
});
