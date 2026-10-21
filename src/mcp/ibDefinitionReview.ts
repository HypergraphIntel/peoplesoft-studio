import type { Workspace } from '../workspace.js';
import { writable, type McpWriteHost } from './writeTools.js';
import { ibWriteInput, ibDefinitionKey } from '../model/ibOperations.js';
import { ibLifecycleIdentity, type IbLifecycleKey } from '../providers/ibLifecycle.js';
import type { Json } from '../changeReview/model.js';

export async function prepareIbDefinitionReview(workspace:Workspace,host:McpWriteHost|undefined,name:string,args:Record<string,unknown>):Promise<{adapter:string;key:Json;after:Json;expectedToken:string}|{outside:string}>{
    if(!host)throw new Error('IB definition review requires a write host.');
    const input=name==='psft_ib_create'?ibWriteInput.parse(args.input):undefined;
    if(input&&input.kind!=='service'&&input.kind!=='operation')return {outside:'this IB family has no lifecycle adapter'};
    const k:IbLifecycleKey=input?{kind:input.kind as 'service'|'operation',name:input.key[0],...(input.kind==='operation'?{service:String(input.properties.IB_SERVICENAME).trim()}:{})}:{kind:args.kind as 'service'|'operation',name:String(args.name),...(args.kind==='operation'?{service:String(args.service??'')}:{})};
    ibLifecycleIdentity(k);
    const gate=await writable(workspace,host,String(args.connection),k.name);
    for(const key of [ibDefinitionKey(k.kind,[k.name]),...(k.service?[ibDefinitionKey('service',[k.service])]:[])])if(host.hasUnsavedEditor(gate.provider.id,key))throw new Error('IB definition or owning service has unsaved editor changes.');
    const key:Json=k.service?[k.name,k.service]:[k.name];
    if(input){
        // A refusal is explicit when grouped; unsupported creation outside a set
        // retains the existing per-write confirmation path.
        try{const preview=await gate.provider.previewIbDefinitionCreation(input,gate.operatorId);return {adapter:'ib-'+k.kind+'-definition',key,after:preview.after.value,expectedToken:preview.before.token};}
        catch(error){return {outside:error instanceof Error?error.message:String(error)};}
    }
    const before=await gate.provider.readIbDefinitionForReview(k);
    if(before.token!==args.expectedToken)throw new Error('Complete IB lifecycle baseline changed; read the definition checkpoint again.');
    if(before.value===null)throw new Error('Cannot delete an absent IB definition.');
    return {adapter:'ib-'+k.kind+'-definition',key,after:null,expectedToken:before.token};
}
