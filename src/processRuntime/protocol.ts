import {boundedBody,ReportRepository} from './reportRepository.js';
export {boundedBody} from './reportRepository.js';
import {createHash} from 'node:crypto';
import {XMLParser, XMLValidator} from 'fast-xml-parser';

export const PROCESS_TYPE = 'Application Engine';
export const RUNTIME_OPERATIONS = ['PRCS_SCHEDULE','PRCS_GETREQUEST','PRCS_GETREPORT','PRCS_GETPROMPT','PRCS_GETPROCESSNAMES','PRCS_FINDREQUESTS'] as const;
export type RuntimeOperation = typeof RUNTIME_OPERATIONS[number];
export interface RuntimeCredentials {operatorId:string; password:string;}
export interface RuntimeRun {instance:number; process:string; processType:string; runControl:string; operator:string; server:string; runStatus:string; distributionStatus:string; requested:string; scheduled:string; started:string; ended:string; contentIds:number[];}
export interface RuntimeReport {id:string; contentId:number; name:string; description:string; url:string;}
export interface RuntimeRequest {process:string; runControl:string; server:string;}
export type RuntimeActions = Record<RuntimeOperation,string>;
const parser = new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,trimValues:true,processEntities:true});
const list = (v:any):any[] => v===undefined || v===null ? [] : Array.isArray(v) ? v : [v];
const plain = (v:any):string => typeof v==='string'||typeof v==='number' ? String(v).trim() : typeof v?.['#text']==='string' ? v['#text'].trim() : '';
const field = (v:any,name:string):string => plain(v?.[Object.keys(v??{}).find(k=>k.toLowerCase()===name.toLowerCase())??name]);
export const xml = (v:string):string => v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export function runtimeUrl(value:string):URL {
  let url:URL;try{url=new URL(value);}catch{throw Error('Enter the HTTPS PeopleSoft service endpoint.');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('The scheduler endpoint must be HTTPS, without credentials, query or fragment.');
  if(!url.pathname.endsWith('/PeopleSoftServiceListeningConnector'))throw Error('Use the delivered PeopleSoftServiceListeningConnector endpoint.');
  return url;
}
function parsed(text:string):any {
  if(text.length>4*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(text)||XMLValidator.validate(text)!==true)throw Error('The native service returned invalid or oversized XML.');
  return parser.parse(text);
}
export function parseRuntimeWsdl(text:string):RuntimeActions {
  const doc=parsed(text).definitions;if(!doc || !field(doc,'@_targetNamespace').endsWith('/PROCESSREQUEST.1'))throw Error('The endpoint did not return the PROCESSREQUEST.1 WSDL.');
  const actions:Partial<RuntimeActions>={};
  for(const binding of list(doc.binding))for(const op of list(binding.operation)){
    const name=field(op,'@_name') as RuntimeOperation,action=field(op.operation,'@_soapAction');
    if(RUNTIME_OPERATIONS.includes(name)&&action){if(!/^[A-Za-z0-9_]+\.v1$/.test(action))throw Error('Unsupported scheduler SOAP action version.');actions[name]=action;}
  }
  for(const name of RUNTIME_OPERATIONS)if(!actions[name])throw Error('The published PROCESSREQUEST.1 WSDL is missing '+name+'.');
  return actions as RuntimeActions;
}
export class RuntimeFault extends Error {constructor(message:string,readonly authentication=false){super(message);this.name='RuntimeFault';}}
export function parseRuntimeResponse(text:string,root:string,password=''):any {
  const doc=parsed(text),body=doc.Envelope?.Body;
  if(!body||typeof body!=='object')throw Error('The native service returned no SOAP body.');
  if(body.Fault){const fault=body.Fault,detail=field(fault.detail?.IBResponse,'DefaultMessage');let message=detail||field(fault,'faultstring')||'The native service refused the request.';
    if(password)message=message.split(password).join('[redacted]');
    message=message.replace(/[\x00-\x1f]/g,' ').slice(0,1000);
    throw new RuntimeFault(message,/authentication|invalid.*password|user.*password|sign.?on|158,.*10/i.test(message));}
  if(body[root]===undefined)throw Error('The native service returned an unexpected response.');
  return body[root];
}
function positive(v:unknown,label:string):number {const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)throw Error('Invalid '+label+'.');return n;}
export function parseRuntimeRun(row:any):RuntimeRun {
  const instance=positive(field(row,'ProcessInstance'),'process instance');
  return {instance,process:field(row,'ProcessName'),processType:field(row,'ProcessType'),runControl:field(row,'RunControlId'),operator:field(row,'OperatorId'),server:field(row,'ServerNameRun'),runStatus:field(row,'RunStatus'),distributionStatus:field(row,'DistributionStatus'),requested:field(row,'RequestDateTime'),scheduled:field(row,'RunDateTime'),started:field(row,'BeginDateTime'),ended:field(row,'EndDateTime'),contentIds:list(row.ContentId??row.ContentID).map(v=>positive(plain(v),'content ID'))};
}
export function validateRuntimeRequest(raw:RuntimeRequest):RuntimeRequest {
  const process=raw.process?.trim(),runControl=raw.runControl?.trim(),server=raw.server?.trim()??'';
  if(!process||!/^[-A-Za-z0-9_#$@]{1,12}$/.test(process))throw Error('Select a valid Application Engine process.');
  if(!runControl||runControl.length>30||/[\x00-\x1f]/.test(runControl))throw Error('Choose an existing run control (at most 30 characters).');
  if(server.length>30||/[\x00-\x1f]/.test(server))throw Error('Invalid scheduler server.');
  return {process,runControl,server};
}
/** Delivered, authenticated PROCESSREQUEST only. Never retries a scheduling POST. */
export class ProcessRuntimeClient {
  readonly endpoint:URL;
  private actions?:RuntimeActions;
  private readonly repository:ReportRepository;
  constructor(endpoint:string,private readonly credentials:RuntimeCredentials,private readonly transport:typeof fetch=fetch){
    this.endpoint=runtimeUrl(endpoint);if(!credentials.operatorId.trim()||!credentials.password)throw Error('Sign in with the configured PeopleSoft operator.');
    this.repository=new ReportRepository(this.endpoint.origin,credentials,transport);
  }
  async discover():Promise<RuntimeActions>{
    const url=new URL(this.endpoint);url.searchParams.set('Operation','GetWSDL');url.searchParams.set('wsdl','PROCESSREQUEST.1');
    const response=await this.transport(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Cannot read the native PROCESSREQUEST WSDL (HTTP '+response.status+').');
    return this.actions=parseRuntimeWsdl(new TextDecoder().decode(await boundedBody(response,4*1024*1024)));
  }
  private async call(operation:RuntimeOperation,request:string,responseRoot:string):Promise<any>{
    const actions=this.actions??await this.discover();
    const security=`<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><wsse:UsernameToken><wsse:Username>${xml(this.credentials.operatorId)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${xml(this.credentials.password)}</wsse:Password></wsse:UsernameToken></wsse:Security>`;
    const body=`<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Header>${security}</soap:Header><soap:Body>${request}</soap:Body></soap:Envelope>`;
    let response:Response;
    try{response=await this.transport(this.endpoint,{method:'POST',redirect:'error',headers:{'content-type':'text/xml; charset=utf-8',SOAPAction:'"'+actions[operation]+'"'},body,signal:AbortSignal.timeout(45000)});}catch{throw Error('The native service response was not received. Check the submission outcome before retrying.');}
    if(response.status===401||response.status===403)throw new RuntimeFault('PeopleSoft rejected this operator sign-in or service permission.',true);
    const text=new TextDecoder().decode(await boundedBody(response,4*1024*1024));
    if(!response.ok&&!text.includes('Fault'))throw Error('The native service returned HTTP '+response.status+'.');
    return parseRuntimeResponse(text,responseRoot,this.credentials.password);
  }
  async processes():Promise<string[]>{
    const r=await this.call('PRCS_GETPROCESSNAMES',`<prq:GetProcessNames xmlns:prq="http://xmlns.oracle.com/Enterprise/Tools/schemas/PRQ_GETPROCESSNAMES_REQ.VERSION_1"><ProcessType>${PROCESS_TYPE}</ProcessType></prq:GetProcessNames>`,'GetProcessNamesResponse');
    return list(r.ProcessName).map(plain).filter(Boolean);
  }
  async servers():Promise<string[]>{
    const r=await this.call('PRCS_GETPROMPT','<prq:GetPromptValues xmlns:prq="http://xmlns.oracle.com/Enterprise/Tools/schemas/PRQ_GETPROMPT_REQ.VERSION_1"><ParameterName>ServerName</ParameterName></prq:GetPromptValues>','GetPromptValuesResponse');
    return list(r.PromptValue).map(plain).filter(Boolean);
  }
  async schedule(raw:RuntimeRequest):Promise<number>{
    const r=validateRuntimeRequest(raw);
    const result=await this.call('PRCS_SCHEDULE',`<prq:Schedule xmlns:prq="http://xmlns.oracle.com/Enterprise/Tools/schemas/PRQ_SCHEDULE_REQ.VERSION_1"><RunControlId>${xml(r.runControl)}</RunControlId><ProcessType>${PROCESS_TYPE}</ProcessType><ProcessName>${xml(r.process)}</ProcessName>${r.server?'<ServerName>'+xml(r.server)+'</ServerName>':''}<OutputDestinationType>WEB</OutputDestinationType><OutputDestinationFormat>TXT</OutputDestinationFormat></prq:Schedule>`,'ScheduleResponse');
    return positive(field(result,'ProcessInstance'),'returned process instance');
  }
  async get(instance:number):Promise<RuntimeRun>{
    positive(instance,'process instance');
    const r=await this.call('PRCS_GETREQUEST',`<prq:GetRequest xmlns:prq="http://xmlns.oracle.com/Enterprise/Tools/schemas/PRQ_GETREQUEST_REQ.VERSION_1"><ProcessInstance>${instance}</ProcessInstance></prq:GetRequest>`,'GetRequestResponse');
    const rows=list(r.ProcessRequestItem);if(rows.length!==1)throw Error('The native service returned no unique process request.');
    const run=parseRuntimeRun(rows[0]);if(run.instance!==instance||run.operator!==this.credentials.operatorId||run.processType!==PROCESS_TYPE)throw Error('The native process identity does not match this operator and Application Engine request.');return run;
  }
  async find(process:string):Promise<RuntimeRun[]>{
    validateRuntimeRequest({process,runControl:'lookup',server:''});
    const r=await this.call('PRCS_FINDREQUESTS',`<prq:FindRequests xmlns:prq="http://xmlns.oracle.com/Enterprise/Tools/schemas/PRQ_FINDREQUESTS_REQ.VERSION_1"><OperatorId>${xml(this.credentials.operatorId)}</OperatorId><ProcessType>${PROCESS_TYPE}</ProcessType><ProcessName>${xml(process)}</ProcessName><ProcessRequestCount>100</ProcessRequestCount></prq:FindRequests>`,'FindRequestsResponse');
    return list(r.ProcessRequestItem).map(parseRuntimeRun).filter(run=>run.operator===this.credentials.operatorId&&run.process===process&&run.processType===PROCESS_TYPE);
  }
  async reports(instance:number):Promise<RuntimeReport[]>{
    const run=await this.get(instance),reports:RuntimeReport[]=[];
    for(const contentId of run.contentIds){const r=await this.call('PRCS_GETREPORT',`<prq:GetReport xmlns:prq="http://xmlns.oracle.com/Enterprise/Tools/schemas/PRQ_GETREPORT_REQ.VERSION_1"><ContentId>${contentId}</ContentId></prq:GetReport>`,'GetReportResponse');
      for(const report of list(r.Report)){
        if(positive(field(report,'ContentID'),'report content ID')!==contentId)throw Error('Native report identity mismatch.');
        for(const details of list(report.ReportDetails)){const raw=field(details,'ReportURL');if(!raw)continue;const url=new URL(raw,this.endpoint);
          if(url.protocol!=='https:'||url.username||url.password)throw Error('The native report URL must use HTTPS without embedded credentials.');
          const name=decodeURIComponent(url.pathname.split('/').pop()??'');if(!name||/[\x00-\x1f/\\]/.test(name))throw Error('Invalid native report filename.');
          reports.push({id:createHash('sha256').update(contentId+'\n'+url.href).digest('hex'),contentId,name,description:field(details,'ReportDescription'),url:url.href});
        }
      }
    }return reports;
  }
  async download(report:RuntimeReport):Promise<Uint8Array>{
    return this.repository.download(report);
  }
}
