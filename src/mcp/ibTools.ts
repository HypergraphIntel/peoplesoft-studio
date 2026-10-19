import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { ibKind } from '../model/ibDocument.js';
import { DatabaseProvider } from '../providers/database.js';
import type { Workspace } from '../workspace.js';
import { jsonResult, requireProvider } from './tools.js';
import { READ_ONLY, WRITE, GATES, writable, approve, type McpWriteHost } from './writeTools.js';
import { ibWriteInput, inputForIb, ibDefinitionKey } from '../model/ibOperations.js';
import { ibStringElement } from '../model/ibDocumentSchema.js';

export const IB_REFERENCE = {
  families: ['message', 'document', 'service', 'operation', 'node', 'routing'],
  writes: 'Use psft_ib_new then psft_ib_create, or edit psft_ib_get.input and pass its token to psft_ib_save. dryRun returns a concrete plan. Writes calibrated on 8.62.09 and 8.61.15. PIA dates a new routing 1900-01-01 (key [name, \'1900-01-01\']). A new routing gets the default parameters PIA gives it (request, and the swapped response when synchronous) and a new node its blank-language PSNODEDEFNLANG row; a new REST operation is named <alias>_<METHOD>, and gets the routing PIA generates (provider: ~~ANY~~ to the local node, with the REST base URL from Service Configuration; consumer: the local node to WADL_NODE through HTTPTARGET). Other patches of 8.61 or 8.62 are accepted when the tables written have the calibrated patch\'s columns; otherwise the refusal names the differing tables. Service kind/REST role cannot be converted in place. Credentials, OpenAPI/application-service writes, moving operations, child deletion and other message structures, composite/relational document writes and uncalibrated handler creation stay in PIA until separately calibrated.',
  workflow: 'psft_ib_list searches one family; psft_ib_get returns properties and related sections; psft_ib_validate checks stored structure and references.',
  keys: { message:['name'],document:['package','document','version'],service:['name'],operation:['name'],node:['name'],routing:['name','YYYY-MM-DD effective date'] },
  services: 'Service kind is independent of routing type. PSSERVICE.IB_REST_SERVICE: 0 standard, 1 REST consumer, 2 REST provider. REST responses return serviceKind=rest and restRole=consumer/provider. Unknown flags remain unknown. Standard services can have synchronous or asynchronous operations. HTTP method alone never determines service kind. Operation and service flags should agree.',
  rest: 'REST operations expose HTTP method, base URL or URL definition, URI-message mappings, content types and status codes. REST consumers call external resources; REST providers expose resources. A standard service namespace or alias is not a REST resource URL.',
  messages: 'Message name + message version identifies its payload. Rowset structures, field overrides, multipart composition, attributes, document references and operation usages are separate sections. Document messages link by package, document and variant/version.',
  documents: 'Document Builder definitions are PSLSDEFN, keyed package/document/version, with their compressed PSLSDEFNBODY schemaDefn XML, dependencies and physical representations. These are not Document Layout definitions (PSDOCLODEFN). Logical XML is exposed only when decompression and both stored lengths verify.',
  operations: 'Operation name is global; versions, version parameters, handlers and routings are separate children. Handler type is its implementation kind; HANDLERID is its event (OnRequest, OnNotify, etc.). Request/response message versions and queue/transform references belong to version parameters.',
  routings: 'Routing identity includes effective date. Lists and related routing sections include history; do not assume the latest row is currently effective. Sender and receiver nodes and the operation version identify the integration. Routing parameters carry directional aliases. A future effective date is not active today.',
  nodes: 'Node authentication settings are visible, but passwords and secret connector-property values are never read by these tools.',
  validation: 'Checks structure and existence, not endpoint reachability, runtime execution, gateway health, credentials, or authorization.',
  evidence: 'HRDMO PeopleTools 8.62.09: service flags and IB_REST_FUNC translates; IB_SERVICEDEFN.PostBuild and PSSERVICESWRK.SAVE_PB.FieldChange; all 319 document bodies inflate to declared lengths.'
};
export function registerIbTools(server: McpServer, workspace: Workspace, host?: McpWriteHost): void {
  const provider = async (connection: string) => {
    const p = await requireProvider(workspace,connection);
    if (!(p instanceof DatabaseProvider) || !p.isConnected) throw new Error('Integration Broker requires a connected database.');
    return p;
  };
  server.registerTool('psft_ib_reference', { title:'Integration Broker reference', description:'Read before working with Integration Broker: all six definition families, keys, relationships, standard versus REST services, REST consumer versus provider, versions and effective-dated routings.',inputSchema:z.object({}),annotations:READ_ONLY },async()=>jsonResult(IB_REFERENCE));
  server.registerTool('psft_ib_list', {
    title:'Search Integration Broker definitions',
    description:'Search messages, Document Builder documents, services, operations, nodes or routings. Pages have 100 entries. Use serviceKind=standard/rest and optional restRole=consumer/provider for services and operations. Kind and role are determined by numeric IB_REST_SERVICE, never guessed from HTTP method. Routing keys include effective date; documents have package/document/version keys.',
    inputSchema:z.object({connection:z.string().min(1),kind:ibKind,query:z.string().max(254).default(''),offset:z.number().int().nonnegative().max(1000000).default(0),serviceKind:z.enum(['standard','rest']).optional(),restRole:z.enum(['consumer','provider']).optional()}),annotations:READ_ONLY
  },async({connection,kind,query,offset,serviceKind,restRole})=>jsonResult(await(await provider(connection)).listIntegrationBroker(kind,query,offset,serviceKind,restRole)));
  server.registerTool('psft_ib_get',{
    title:'Read Integration Broker definition',
    description:'Return structured properties, related sections and token for one IB definition. Keys: message/service/operation/node [name]; document [package,document,version]; routing [name,effective date YYYY-MM-DD]. Services and their operations/routings explicitly report serviceKind (standard/rest/unknown) and restRole (consumer/provider). Includes message structures, document XML, operation versions/messages/handlers/URI mappings, node connector properties and routing history. Passwords and secret property values are not read.',
    inputSchema:z.object({connection:z.string().min(1),kind:ibKind,key:z.array(z.string()).min(1).max(3)}),annotations:READ_ONLY
  },async({connection,kind,key})=>{
    const p=await provider(connection),doc=await p.readIntegrationBroker(kind,key);
    if(!doc)throw new Error('Integration Broker definition not found.');
    return jsonResult({ ...doc,input:inputForIb(doc),validation:await p.validateIntegrationBroker(doc) });
  });
  server.registerTool('psft_ib_validate',{
    title:'Validate Integration Broker definition',
    description:'Read-only structural/reference validation of a stored IB definition: service/operation kind agreement, REST HTTP method, default versions, notify handler sequences, referenced messages, queues, XSLT transforms, routing nodes and operation versions, and document decompression. Does not invoke a service or test runtime connectivity.',
    inputSchema:z.object({connection:z.string().min(1),kind:ibKind,key:z.array(z.string()).min(1).max(3)}),annotations:READ_ONLY
  },async({connection,kind,key})=>{const p=await provider(connection),doc=await p.readIntegrationBroker(kind,key);if(!doc)throw new Error('Integration Broker definition not found.');return jsonResult({kind,key,token:doc.token,validation:await p.validateIntegrationBroker(doc)});});
  const newOptions = {serviceKind:z.enum(['standard','rest']).optional(),restRole:z.enum(['consumer','provider']).optional(),service:z.string().optional(),method:z.enum(['GET','POST','PUT','DELETE','HEAD','PATCH']).optional(),operationType:z.enum(['A','S','R','N','X']).optional(),messageVersion:z.string().max(30).optional(),elements:z.array(ibStringElement).min(1).max(100).optional()};
  server.registerTool('psft_ib_new',{
    title:'Prepare a new Integration Broker definition',
    description:'Returns a creation input with calibrated PIA defaults; does not write. Choose kind and key (psft_ib_reference documents keys). Services require explicit serviceKind=standard/rest; REST requires restRole=consumer/provider. Operations require an existing service; REST operations require method, while standard operations use operationType. Fill descriptions and message/version references before creating. Messages default to a nonrowset version. Documents support flat string elements (name,length,required), with native logical, XML, JSON and HTML schemas. Routing key includes effective date; supply its operation, version, nodes and parameters.',
    inputSchema:z.object({connection:z.string().min(1),kind:ibKind,key:z.array(z.string()).min(1).max(3),...newOptions}),annotations:READ_ONLY
  },async({connection,kind,key,...options})=>jsonResult({input:await(await provider(connection)).newIntegrationBroker(kind,key,options),expectedToken:'absent'}));
  server.registerTool('psft_ib_document_build',{
    title:'Build a native Document Builder schema package',
    description:'Generate a native flat string document schema package for this database\'s release (8.62.09 or 8.61.15) without saving; its JSON schema $id is the configured REST Target Location (ORACLE_ENDPOINT when blank): key [package,document,version], elements [{name,length,required}]. Includes logical/XML/JSON/HTML bodies and generated schemas. Use the document property of the returned input for creation or editing; supplied document keys must remain consistent. Other document shapes remain opaque and should be edited in PIA until calibrated.',
    inputSchema:z.object({connection:z.string().min(1),key:z.array(z.string()).length(3),elements:z.array(ibStringElement).min(1).max(100)}),annotations:READ_ONLY
  },async({connection,key,elements})=>jsonResult({input:await(await provider(connection)).newIntegrationBroker('document',key,{elements})}));
  if(!host)return;
  const save = async(connection:string,input:z.infer<typeof ibWriteInput>,expectedToken:string,dryRun=false)=>{
    const gate=await writable(workspace,host,connection,input.key[0]);
    const request={input,expectedToken,operatorId:gate.operatorId};
    const preview=await gate.provider.saveIntegrationBroker({...request,dryRun:true});
    const planned={changes:preview.plan.changes,counters:preview.plan.increments,statements:preview.plan.statements.length};
    if(dryRun||!preview.plan.statements.length)return jsonResult({saved:false,reason:dryRun?'dry run':'no changes',planned,validation:preview.validation});
    const key=ibDefinitionKey(input.kind,input.key);
    await approve(host,gate,key,(expectedToken==='absent'?'create ':'save ')+input.kind+' '+input.key.join(' / '),planned.changes.join('\n'));
    const result=await gate.provider.saveIntegrationBroker(request);
    host.saved(gate.provider.id,key);
    return jsonResult({saved:result.written,token:result.token,planned,verification:'read back before and after COMMIT',validation:result.validation});
  };
  server.registerTool('psft_ib_create',{
    title:'Create an Integration Broker definition',
    description:'Create a definition from psft_ib_new input. Supports all six families on calibrated PeopleTools 8.62.09 and 8.61.15, with native related rows and cache versions. Services explicitly choose standard or REST and REST consumer/provider. Operation kind is inherited from its service. Use dryRun for the concrete write plan. Restricted services, credential changes, OpenAPI/application-service changes, moving operations, deleting children, other message structures, and composite/relational document changes remain in PIA. Creating a standard operation generates no routing (add manual routings or use the generation controls in PIA); creating a REST operation generates the routing PIA forces for it. '+GATES,
    inputSchema:z.object({connection:z.string().min(1),input:ibWriteInput,dryRun:z.boolean().optional()}),annotations:WRITE
  },async({connection,input,dryRun})=>save(connection,input,'absent',!!dryRun));
  server.registerTool('psft_ib_save',{
    title:'Save an Integration Broker definition',
    description:'Edit the input returned by psft_ib_get and supply its expectedToken. Properties use stored field names. Sections use the named arrays returned in input; omitted sections are preserved. Existing child keys are immutable; add rows with full properties or calibrated defaults. Save preserves credential columns and secret properties, validates references, locks and checks the token, updates native cache versions, reads back and verifies before committing, then verifies again. Service kind and REST consumer/provider role are immutable after creation. dryRun previews without writing. '+GATES,
    inputSchema:z.object({connection:z.string().min(1),input:ibWriteInput,expectedToken:z.string().min(1),dryRun:z.boolean().optional()}),annotations:WRITE
  },async({connection,input,expectedToken,dryRun})=>{if(expectedToken==='absent')throw new Error('Use psft_ib_create for a new definition.');return save(connection,input,expectedToken,!!dryRun);});

}
