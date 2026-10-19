import { IB_PARENTS, IB_SECTIONS, IB_STAMPS, ibSecretColumn, type IbWriteInput } from './ibOperations.js';
import { ibIdentity, type IbKind } from './ibDocument.js';
import { buildStringDocument, ibDocumentProfile, type IbStringElement } from './ibDocumentSchema.js';
import type { Row } from './ibDefinitions.js';
export interface IbNewOptions {serviceKind?:'standard'|'rest';restRole?:'consumer'|'provider';service?:string;method?:'GET'|'POST'|'PUT'|'DELETE'|'HEAD'|'PATCH';operationType?:'A'|'S'|'R'|'N'|'X';messageVersion?:string;elements?:IbStringElement[];}
export function newIbInput(kind:IbKind,key:string[],options:IbNewOptions,config:Row,language:string,service?:Row,toolsRelease='8.62'):IbWriteInput {
 ibIdentity(kind,key);
 const properties=Object.fromEntries(Object.entries(IB_PARENTS[kind].defaults).filter(([k])=>!IB_STAMPS.has(k)&&!ibSecretColumn(k)&&!['IB_REST_SERVICE','IB_PSOFTSERVICE','GENERATED','IB_LOCALIDFLG'].includes(k)));
 const input:IbWriteInput={kind,key:[...key],properties:properties as IbWriteInput['properties'],sections:{}};
 if(kind==='service'){
  if(!options.serviceKind)throw new Error('Choose standard or REST explicitly.');
  input.serviceKind=options.serviceKind;input.restRole=options.restRole;input.properties.IB_NAMESPACE=String(config.IB_NAMESPACE??'').trim();
  if(input.serviceKind==='rest'&&!input.restRole)throw new Error('Choose consumer or provider for a REST service.');
 }
 if(kind==='operation'){
  if(!service)throw new Error('Select an existing service.');
  const flag=Number(service.IB_REST_SERVICE);if(![0,1,2].includes(flag))throw new Error('Owning service has an unsupported kind flag.');
  if(flag>0&&!options.method)throw new Error('REST operations need an HTTP method.');
  input.properties.IB_SERVICENAME=String(service.IB_SERVICENAME).trim();input.properties.DEFAULTVER='v1';input.properties.RTNGTYPE=flag>0?'S':options.operationType??'S';input.properties.IB_RESTMETHOD=options.method??' ';
  if(flag===0&&options.method)throw new Error('Standard operations do not take an HTTP method.');
  // PIA names a REST operation <alias>_<METHOD> and keeps the name typed as its alias [8.61.15 XX_IB_ROP_AD_GET].
  if(flag>0)input.properties.IB_ALIASNAME=options.method&&key[0].endsWith(`_${options.method}`)?key[0].slice(0,-options.method.length-1):key[0];
  input.sections.versions=[{...IB_SECTIONS.operation.versions.defaults,VERSIONNAME:'v1'}] as IbWriteInput['sections'][string];
  const roles=input.properties.RTNGTYPE==='A'?['REQUEST']:['REQUEST','RESPONSE'];
  input.sections.parameters=roles.map(role=>({...IB_SECTIONS.operation.parameters.defaults,VERSIONNAME:'v1',PARAMETERNAME:role,...(flag>0&&role==='REQUEST'&&['GET','DELETE','HEAD'].includes(options.method!)?{MSGNAME:'IB_REST_STUB',IB_MSGVERSION:'IB_REST_STUB'}:{}),...(flag>0&&role==='RESPONSE'?{IB_HTTP_STATUS_CD:200,IB_CONTENT_TYPE:'text/xml'}:{})})) as IbWriteInput['sections'][string];
  input.sections.handlers=[];
 }
 if(kind==='message')input.sections.versions=[{...IB_SECTIONS.message.versions.defaults,APMSGVER:options.messageVersion??'V1'}] as IbWriteInput['sections'][string];
 if(kind==='routing')input.sections.parameters=[];
 if(kind==='document'){
  input.properties.DESCR=key[1].slice(0,30);input.document=buildStringDocument(key,options.elements??[{name:'value',length:100,required:false}],String(config.IB_SCHEMANAMESPACE??'').trim(),language,ibDocumentProfile(toolsRelease,String(config.IB_RESTTGTLOC??'')));
 }
 return input;
}
