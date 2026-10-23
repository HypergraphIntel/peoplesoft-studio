/** Read-only native prerequisite report. Never submits, reads credentials from PeopleSoft, or changes IB. */
import {writeFile} from 'node:fs/promises';
import {openDatabase} from '../../../src/db/open.js';
import {readRuntimeMetadata,runtimeBaseline} from '../../../src/providers/processRuntimeReader.js';
import {parseRuntimeWsdl,parseRuntimeResponse} from '../../../src/processRuntime/protocol.js';
const connection={connectString:process.env.PSLAB_ORACLE??'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID!,password:process.env.PSLAB_ACCESSPSWD!};
if(!/hrdmo/i.test(connection.connectString)||!connection.user||!connection.password)throw Error('HRDMO read-only lab environment required.');
const pool=await openDatabase('oracle',connection),c=await pool.getConnection();
try{await c.execute('SET TRANSACTION READ ONLY');const metadata=await readRuntimeMetadata(c,pool.types,'JARED'),baseline=await runtimeBaseline(c,pool.types,'JARED',{process:'ZZ_BC_EXPORT',runControl:'ZZ_BC_ACC01',server:'HCMDMO'});
 const url=new URL(metadata.endpoint);url.searchParams.set('Operation','GetWSDL');url.searchParams.set('wsdl','PROCESSREQUEST.1');const wsdl=await fetch(url,{signal:AbortSignal.timeout(15000)}).then(r=>r.text()),actions=parseRuntimeWsdl(wsdl);
 const response=await fetch(metadata.endpoint,{method:'POST',headers:{'content-type':'text/xml; charset=utf-8',SOAPAction:'"'+actions.PRCS_GETPROMPT+'"'},body:'<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><p:GetPromptValues xmlns:p="http://xmlns.oracle.com/Enterprise/Tools/schemas/PRQ_GETPROMPT_REQ.VERSION_1"><ParameterName>ServerName</ParameterName></p:GetPromptValues></soap:Body></soap:Envelope>',signal:AbortSignal.timeout(15000)});
 let fault='';try{parseRuntimeResponse(await response.text(),'GetPromptValuesResponse');}catch(e){fault=e instanceof Error?e.message:String(e);}
 const report={checkedAt:new Date().toISOString(),scope:'Read-only HRDMO metadata, live published WSDL and anonymous native transport probe; no runtime acceptance',endpoint:metadata.endpoint,operator:metadata.operatorId,control:metadata.runControls.find(r=>r.id==='ZZ_BC_ACC01'),baseline,actions,publicProbe:{http:response.status,fault,transportRejected:fault.includes('(158,554)')},newProcessSubmitted:false,ibConfigurationChanged:false,nativeRuntimeAccepted:false};
 const file=`tools/lab/results/process-runtime-preflight-${new Date().toISOString().slice(0,10)}.json`;await writeFile(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await c.rollback();await c.close();await pool.close();}
