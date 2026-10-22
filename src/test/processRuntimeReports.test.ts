import {test} from 'node:test';import assert from 'node:assert/strict';
import {ReportRepository,reportSignIn} from '../processRuntime/reportRepository.js';
const origin='https://example.com',report={id:'file',contentId:1,name:'export.csv',description:'CSV',url:origin+'/psreports/SITE/1/export.csv'};
const form='<form id="login" name="login" method="post" action="?&amp;cmd=login&amp;languageCd=ENG"><input type="hidden" name="lcsrf_token" value="native-csrf"><input type="text" name="userid"><input type="password" name="pwd"></form>';
test('native repository sign-in retains transient cookies and CSRF; download returns only report bytes',async()=>{
 let authenticated=false;const requests:Array<{url:string;init?:RequestInit}>=[];
 const repository=new ReportRepository(origin,{operatorId:'JARED',password:'private'},async(input,init)=>{
  const url=new URL(String(input));requests.push({url:url.href,init});
  if(init?.method==='POST'){const values=new URLSearchParams(String(init.body));assert.equal(values.get('userid'),'JARED');assert.equal(values.get('pwd'),'private');assert.equal(values.get('lcsrf_token'),'native-csrf');assert.match((init.headers as Record<string,string>).cookie,/SESSION=session/);authenticated=true;return new Response('OK',{headers:{'set-cookie':'PS_TOKEN=native-token; Path=/; Secure; HttpOnly'}});}
  if(authenticated){assert.match((init?.headers as Record<string,string>).cookie,/PS_TOKEN=native-token/);return new Response('exact,csv\n1,2\n',{headers:{'content-type':'text/csv'}});}
  if(!url.search)return new Response(null,{status:302,headers:{location:report.url+'?&','set-cookie':'SESSION=session; Path=/; HttpOnly'}});
  return new Response(form,{headers:{'content-type':'text/html'}});
 });
 assert.equal(new TextDecoder().decode(await repository.download(report)),'exact,csv\n1,2\n');
 assert.equal(requests.filter(r=>r.init?.method==='POST').length,1);assert.equal(new TextDecoder().decode(await repository.download(report)),'exact,csv\n1,2\n');assert.equal(requests.filter(r=>r.init?.method==='POST').length,1);
});
test('repository refuses foreign redirect/form actions and never follows a credential replay redirect',async()=>{
 const url=new URL(report.url);
 assert.throws(()=>reportSignIn(form.replace('?&amp;cmd=login&amp;languageCd=ENG','https://attacker.example/steal?cmd=login'),url,url),/unsupported/);
 assert.throws(()=>reportSignIn(form.replace('?&amp;cmd=login&amp;languageCd=ENG','/unrelated?cmd=login'),url,url),/unsupported/);
 let posts=0;const repository=new ReportRepository(origin,{operatorId:'JARED',password:'private'},async(_input,init)=>{
  if(init?.method==='POST'){posts++;return new Response(null,{status:307,headers:{location:'/somewhere'}});}return new Response(form,{headers:{'content-type':'text/html'}});
 });await assert.rejects(()=>repository.download(report),/credential redirect/);assert.equal(posts,1);
 let calls=0;const other=new ReportRepository(origin,{operatorId:'JARED',password:'private'},async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://attacker.example/steal'}});});
 await assert.rejects(()=>other.download(report),/configured HTTPS origin/);assert.equal(calls,1);
});
test('failed repository login is refused without repeatedly posting the operator password',async()=>{
 let posts=0;const repository=new ReportRepository(origin,{operatorId:'JARED',password:'private'},async(_input,init)=>{if(init?.method==='POST')posts++;return new Response(form,{headers:{'content-type':'text/html'}});});
 await assert.rejects(()=>repository.download(report),/did not accept/);await assert.rejects(()=>repository.download(report),/browser sign-in/);assert.equal(posts,1);
});
