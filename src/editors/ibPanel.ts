import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { DatabaseProvider } from '../providers/database.js';
import { IB_TITLES, type IbKind } from '../model/ibDocument.js';
import type { Workspace } from '../workspace.js';
import { ibWriteInput, inputForIb } from '../model/ibOperations.js';
import type { IbDocument } from '../model/ibDocument.js';
import { ibHtml } from './ibHtml.js';
const PANELS = new Map<string,vscode.WebviewPanel>();
const DIRTY=new Set<string>();
export function refreshIbPanels(connection:string):void {for(const [id,panel] of PANELS)if(id.startsWith(connection+':')&&!DIRTY.has(id))void panel.webview.postMessage({type:'refresh'});}
export const hasUnsavedIb=(connection:string,kind:IbKind)=>DIRTY.has(connection+':'+kind);
export function openIbPanel(workspace:Workspace,provider: DatabaseProvider, kind: IbKind): vscode.WebviewPanel {
  const id=provider.id+':'+kind,old=PANELS.get(id);if(old){old.reveal();return old;}
  const panel=vscode.window.createWebviewPanel('psft.integrationBroker',IB_TITLES[kind],vscode.ViewColumn.Active,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]});
  PANELS.set(id,panel);panel.onDidDispose(()=>{PANELS.delete(id);DIRTY.delete(id);});panel.webview.html=ibHtml(kind,provider.displayName,randomBytes(18).toString('hex'));
  let queue=Promise.resolve(),doc:IbDocument|undefined;
  const editable=()=>workspace.isWritable(provider.id)&&!!workspace.configFor(provider.id)?.peoplesoftOperatorId?.trim();
  panel.webview.onDidReceiveMessage((m:unknown)=>{queue=queue.then(async()=>{
    if(!m||typeof m!=='object')return;
    const message=m as {type?:string;query?:string;offset?:number;serviceKind?:'standard'|'rest';restRole?:'consumer'|'provider';key?:string[];input?:unknown;options?:Record<string,unknown>;dryRun?:boolean};
    if(message.type==='dirty'){DIRTY.add(id);return;}
    if(['load','new'].includes(message.type??'')&&DIRTY.has(id)){if(await vscode.window.showWarningMessage('Discard unsaved Integration Broker changes?',{modal:true},'Discard Changes')!=='Discard Changes')return;}
    if(message.type==='ready')await panel.webview.postMessage({type:'list',...await provider.listIntegrationBroker(kind)});
    if(message.type==='search'){
      if(typeof message.query!=='string'||message.query.length>254)throw new Error('Invalid search text.');
      if(message.serviceKind&&!['standard','rest'].includes(message.serviceKind))throw new Error('Invalid service kind.');
      if(message.restRole&&!['consumer','provider'].includes(message.restRole))throw new Error('Invalid REST role.');
      await panel.webview.postMessage({type:'list',...await provider.listIntegrationBroker(kind,message.query,message.offset??0,message.serviceKind,message.restRole)});
    }
    if(message.type==='load'){
      if(!Array.isArray(message.key)||message.key.some(k=>typeof k!=='string'))throw new Error('Invalid definition key.');
      doc=await provider.readIntegrationBroker(kind,message.key);if(!doc)throw new Error('Definition no longer exists.');
      await panel.webview.postMessage({type:'entry',doc,input:inputForIb(doc),editable:editable(),validation:await provider.validateIntegrationBroker(doc)});
      DIRTY.delete(id);
    }
    if(message.type==='new'){
      if(!message.key)throw new Error('Definition key is required.');
      const input=await provider.newIntegrationBroker(kind,message.key,message.options??{});doc=undefined;DIRTY.delete(id);
      await panel.webview.postMessage({type:'draft',input,editable:editable()});
    }
    if(message.type==='save'){
      if(!editable())throw new Error('Set this connection to Writable and configure its Operator ID.');
      const input=ibWriteInput.parse(message.input);
      if(input.kind!==kind||doc&&JSON.stringify(input.key)!==JSON.stringify(doc.key))throw new Error('Definition identity cannot change on Save.');
      const result=await provider.saveIntegrationBroker({input,expectedToken:doc?.token??'absent',operatorId:workspace.configFor(provider.id)!.peoplesoftOperatorId!.trim(),dryRun:!!message.dryRun});
      if(message.dryRun){await panel.webview.postMessage({type:'preview',plan:result.plan});return;}
      doc=await provider.readIntegrationBroker(kind,input.key);if(!doc)throw new Error('Saved definition could not be read.');DIRTY.delete(id);
      await panel.webview.postMessage({type:'entry',doc,input:inputForIb(doc),editable:editable(),validation:await provider.validateIntegrationBroker(doc),saved:true});
    }
  }).catch(async e=>{await panel.webview.postMessage({type:'error',message:e instanceof Error?e.message:String(e)});});});
  return panel;
}
