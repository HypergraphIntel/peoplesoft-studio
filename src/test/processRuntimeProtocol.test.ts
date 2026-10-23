import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ProcessRuntimeClient,parseRuntimeWsdl,parseRuntimeResponse,runtimeUrl,type RuntimeOperation} from '../processRuntime/protocol.js';
const endpoint='https://example.com/PSIGW/PeopleSoftServiceListeningConnector';
const wsdl=readFileSync('src/test/fixtures/process-runtime/processrequest-wsdl.xml','utf8');
const envelope=(body:string)=>'<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'+body+'</soap:Body></soap:Envelope>';
test('live HRDMO WSDL supplies aliases rather than guessed operation SOAP actions',()=>{
 const actions=parseRuntimeWsdl(wsdl);assert.equal(actions.PRCS_SCHEDULE,'PRQ_SCHEDULE.v1');assert.equal(actions.PRCS_GETREQUEST,'PRQ_GET_REQUEST.v1');assert.equal(actions.PRCS_GETPROCESSNAMES,'PRCS_GETPROCESSNAMES.v1');
 assert.throws(()=>parseRuntimeWsdl(wsdl.replaceAll('name="PRCS_GETREPORT"','name="OTHER"')),/missing PRCS_GETREPORT/);
 assert.throws(()=>runtimeUrl('http://example.com/PSIGW/PeopleSoftServiceListeningConnector'),/HTTPS/);
 assert.throws(()=>runtimeUrl(endpoint+'?secret=bad'),/query/);
 assert.throws(()=>runtimeUrl('https://user:password@example.com/PSIGW/PeopleSoftServiceListeningConnector'),/credentials/);
});
test('runtime SOAP posts escaped operator/request values using discovered aliases and never retries',async()=>{
 const calls:Array<{url:string;init?:RequestInit}>=[];
 const fake:typeof fetch=async(input,init)=>{calls.push({url:String(input),init});if(!init?.method)return new Response(wsdl);return new Response(envelope('<r:ScheduleResponse xmlns:r="urn:response"><ProcessInstance>607999</ProcessInstance></r:ScheduleResponse>'));};
 const client=new ProcessRuntimeClient(endpoint,{operatorId:'JARED&TEST',password:'private<&password'},fake);
 assert.equal(await client.schedule({process:'ZZ_RUNTIME',runControl:'A&B',server:'PSUNX'}),607999);
 assert.equal(calls.length,2);assert.equal((calls[1].init?.headers as Record<string,string>).SOAPAction,'"PRQ_SCHEDULE.v1"');
 const body=String(calls[1].init?.body);assert.ok(body.includes('JARED&amp;TEST'));// PeopleSoft ignores the token unless the header is marked mustUnderstand (158,535 natively).
 assert.ok(body.includes('<wsse:Security soap:mustUnderstand="1" '));assert.ok(body.includes('private&lt;&amp;password'));assert.ok(body.includes('<RunControlId>A&amp;B</RunControlId>'));
 assert.equal(calls[1].init?.redirect,'error');assert.ok(body.includes('<OutputDestinationType>WEB</OutputDestinationType>'));assert.ok(body.includes('<OutputDestinationFormat>TXT</OutputDestinationFormat>'));
 let posts=0;const lost=new ProcessRuntimeClient(endpoint,{operatorId:'JARED',password:'not-retained'},async(_input,init)=>{if(!init?.method)return new Response(wsdl);posts++;throw Error('Lost reply');});
 await assert.rejects(()=>lost.schedule({process:'ZZ_RUNTIME',runControl:'ONCE',server:''}),/outcome before retrying/);assert.equal(posts,1);
});
test('SOAP faults are bounded/redacted and invalid XML, DTD and unexpected bodies refuse',()=>{
 assert.throws(()=>parseRuntimeResponse(envelope('<Fault><faultstring>null</faultstring><detail><IBResponse><DefaultMessage>HTTPS required (158,554)</DefaultMessage></IBResponse></detail></Fault>'),'Result'),/HTTPS required \(158,554\)/);
 assert.throws(()=>parseRuntimeResponse(envelope('<Fault><faultstring>Wrong password sensitive-value</faultstring></Fault>'),'Result','sensitive-value'),error=>{assert.match(String(error),/\[redacted\]/);assert.ok(!String(error).includes('sensitive-value'));return true;});
 assert.throws(()=>parseRuntimeResponse('<!DOCTYPE x [<!ENTITY p "test">]>'+envelope('<Result/>'),'Result'),/invalid/);
 assert.throws(()=>parseRuntimeResponse(envelope('<Unexpected/>'),'Expected'),/unexpected/);
});
test('native status/report reads bind operator, instance, content ID and HTTPS report identity',async()=>{
 let owner='JARED';let content=94853;
 const fake:typeof fetch=async(_input,init)=>{if(!init?.method)return new Response(wsdl);const action=(init.headers as Record<string,string>).SOAPAction;
 if(action==='"PRQ_GET_REQUEST.v1"')return new Response(envelope('<GetRequestResponse><ProcessRequestItem><ProcessInstance>607265</ProcessInstance><ProcessType>Application Engine</ProcessType><ProcessName>ZZ_BC_EXPORT</ProcessName><OperatorId>'+owner+'</OperatorId><RunControlId>TEST</RunControlId><RunStatus>Success</RunStatus><ContentId>94853</ContentId></ProcessRequestItem></GetRequestResponse>'));
 return new Response(envelope('<GetReportResponse><Report><ContentID>'+content+'</ContentID><ReportDetails><ReportURL>//example.com/psreports/SITE/94853/file.csv</ReportURL><ReportDescription>CSV</ReportDescription></ReportDetails></Report></GetReportResponse>'));};
 const client=new ProcessRuntimeClient(endpoint,{operatorId:'JARED',password:'private'},fake),reports=await client.reports(607265);
 assert.equal(reports[0].name,'file.csv');assert.equal(reports[0].url,'https://example.com/psreports/SITE/94853/file.csv');
 content=90000;await assert.rejects(()=>client.reports(607265),/identity mismatch/);
 owner='ANOTHER';await assert.rejects(()=>client.get(607265),/identity/);
});
test('report downloading rejects redirected/login pages, oversized bodies and foreign origins',async()=>{
 const report={id:'id',contentId:1,name:'log.out',description:'Log',url:'https://example.com/psreports/SITE/1/log.out'};
 const client=new ProcessRuntimeClient(endpoint,{operatorId:'JARED',password:'private'},async()=>new Response('<html>Sign in</html>',{headers:{'content-type':'text/html'}}));
 await assert.rejects(()=>client.download(report),/browser sign-in/);
 await assert.rejects(()=>client.download({...report,url:'https://other.example.com/log.out'}),/another origin/);
 const oversized=new ProcessRuntimeClient(endpoint,{operatorId:'JARED',password:'private'},async()=>new Response('too big',{headers:{'content-length':String(30*1024*1024)}}));
 await assert.rejects(()=>oversized.download(report),/size limit/);
});
// Keep the operation contract explicit for additions.
const operation:RuntimeOperation='PRCS_FINDREQUESTS';assert.equal(operation,'PRCS_FINDREQUESTS');
test('native calls run one at a time, and a failed call does not block the next',async()=>{
 let open=0,peak=0,posts=0;
 const fake:typeof fetch=async(_input,init)=>{if(!init?.method)return new Response(wsdl);open++;peak=Math.max(peak,open);await new Promise(r=>setTimeout(r,5));open--;
  if(++posts===1)throw Error('socket closed');
  return new Response(envelope(String(init.body).includes('GetProcessNames')?'<r:GetProcessNamesResponse xmlns:r="urn:response"><ProcessName>ZZ_A</ProcessName></r:GetProcessNamesResponse>':'<r:GetPromptValuesResponse xmlns:r="urn:response"><PromptValue>PSUNX</PromptValue></r:GetPromptValuesResponse>'));};
 const client=new ProcessRuntimeClient(endpoint,{operatorId:'JARED',password:'pw'},fake);await client.discover();
 const [first,processes,servers]=await Promise.allSettled([client.servers(),client.processes(),client.servers()]);
 assert.equal(first.status,'rejected');assert.deepEqual(processes,{status:'fulfilled',value:['ZZ_A']});assert.deepEqual(servers,{status:'fulfilled',value:['PSUNX']});
 assert.equal(peak,1);assert.equal(posts,3);
});
