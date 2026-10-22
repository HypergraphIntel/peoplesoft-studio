import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { Workspace } from '../workspace.js';
import { DatabaseProvider } from '../providers/database.js';
import { parseUri } from '../util/uri.js';
import type { DefinitionKey } from '../model/definitions.js';
import type { ProcessView } from '../model/processDefinition.js';
import { PROCESS_FIELDS, processEdit, processToken, type ProcessEdit } from '../model/processEdit.js';
import { writeScopeRefusal } from '../providers/writeScope.js';
import { processHtml } from './processHtml.js';

class ProcessDocument implements vscode.CustomDocument {
  readonly panels = new Set<vscode.WebviewPanel>();
  readonly disposed = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.disposed.event;
  edit: ProcessEdit;
  token: string;
  queue = Promise.resolve();
  saving = false;
  constructor(readonly uri: vscode.Uri, readonly provider: DatabaseProvider, readonly key: DefinitionKey, public view: ProcessView) {
    this.edit=processEdit(view);this.token=processToken(view);
  }
  dispose(): void {this.disposed.fire();this.disposed.dispose();}
  get dirty(): boolean {return JSON.stringify(this.edit)!==JSON.stringify(processEdit(this.view));}
}
export class ProcessEditorProvider implements vscode.CustomEditorProvider<ProcessDocument> {
  static readonly viewType='psft.processEditor';
  private static readonly documents = new Map<ProcessDocument, ProcessEditorProvider>();
  static hasUnsaved(connectionId: string, key: DefinitionKey): boolean {
    return [...this.documents.keys()].some(doc => doc.provider.id === connectionId &&
      JSON.stringify(doc.key.parts) === JSON.stringify(key.parts) && (doc.dirty || doc.saving));
  }
  static async reloadIfOpen(connectionId: string, key: DefinitionKey): Promise<void> {
    for (const [doc, editor] of this.documents) {
      if (doc.provider.id !== connectionId || JSON.stringify(doc.key.parts) !== JSON.stringify(key.parts)) continue;
      doc.queue = doc.queue.then(async () => {
        if (doc.dirty || doc.saving) return;
        doc.view = await doc.provider.readProcessDocument(doc.key);
        doc.edit = processEdit(doc.view); doc.token = processToken(doc.view);
        await editor.paint(doc, 'Reloaded after an external save.');
      }).catch(async error => { await editor.paint(doc, error instanceof Error ? error.message : String(error)); });
      await doc.queue;
    }
  }
  private readonly changed=new vscode.EventEmitter<vscode.CustomDocumentEditEvent<ProcessDocument>>();
  readonly onDidChangeCustomDocument=this.changed.event;
  constructor(private readonly workspace: Workspace) {}
  static register(workspace: Workspace): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(this.viewType,new ProcessEditorProvider(workspace),{webviewOptions:{retainContextWhenHidden:true},supportsMultipleEditorsPerDocument:false});
  }
  async openCustomDocument(uri:vscode.Uri,context:vscode.CustomDocumentOpenContext):Promise<ProcessDocument> {
    const {handle,key}=parseUri(uri),provider=await this.workspace.requireByHandle(handle);
    if(!(provider instanceof DatabaseProvider))throw new Error('Process editor requires a database connection.');
    const doc=new ProcessDocument(uri,provider,key,await provider.readProcessDocument(key));
    ProcessEditorProvider.documents.set(doc, this);
    doc.onDidDispose(() => ProcessEditorProvider.documents.delete(doc));
    if(context.backupId){const backup=JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.parse(context.backupId))).toString('utf8'));doc.edit=backup.edit;doc.token=backup.token;}
    return doc;
  }
  private reason(doc:ProcessDocument):string|undefined {
    if(doc.provider.platform!=='oracle')return 'Viewing only: saves are currently supported on Oracle.';
    if(!this.workspace.isWritable(doc.provider.id))return 'Viewing only: set this connection to Writable to edit.';
    if(!this.workspace.configFor(doc.provider.id)?.peoplesoftOperatorId?.trim())return 'Viewing only: configure a PeopleSoft Operator ID to edit.';
    return writeScopeRefusal(doc.key.parts[1]);
  }
  private async paint(doc:ProcessDocument,message=''):Promise<void> {
    const reason=this.reason(doc);
    await Promise.all([...doc.panels].map(p=>p.webview.postMessage({type:'state',process:doc.view.process,fields:PROCESS_FIELDS,translates:Object.fromEntries([...doc.view.translates].map(([k,v])=>[k,Object.fromEntries(v)])),edit:doc.edit,connection:doc.provider.displayName,editable:!reason&&!doc.saving,reason,busy:doc.saving,dirty:doc.dirty,message})));
  }
  async resolveCustomEditor(doc:ProcessDocument,panel:vscode.WebviewPanel):Promise<void> {
    doc.panels.add(panel);panel.onDidDispose(()=>doc.panels.delete(panel));panel.webview.options={enableScripts:true};panel.webview.html=processHtml(randomBytes(18).toString('hex'));
    panel.webview.onDidReceiveMessage((m:unknown)=>{
      doc.queue=doc.queue.then(async()=>{
        if(!m||typeof m!=='object')return;
        const message=m as {type?:string;edit?:ProcessEdit};
        if(message.type==='ready')await this.paint(doc);
        else if(message.type==='edit'){
          if(this.reason(doc)||doc.saving)return;
          if(!message.edit||typeof message.edit.properties!=='object'||!Array.isArray(message.edit.components)||!Array.isArray(message.edit.groups))throw new Error('Invalid edit.');
          const before=structuredClone(doc.edit),after=structuredClone(message.edit);
          if(JSON.stringify(before)===JSON.stringify(after))return;
          doc.edit=after;
          this.changed.fire({document:doc,label:'Edit process definition',undo:async()=>{doc.edit=structuredClone(before);await this.paint(doc);},redo:async()=>{doc.edit=structuredClone(after);await this.paint(doc);}});
        }else if(message.type==='run'){
          if(doc.dirty||doc.saving)throw new Error('Save or revert the process definition before running.');
          if(doc.key.parts[0]!=='Application Engine')throw new Error('Run and Monitor currently supports Application Engine processes.');
          await vscode.commands.executeCommand('psft.process.run',doc.provider.id,doc.key.parts[1]);
        }else if(message.type==='save'){
          // Run after this message queue has drained, since Save awaits queued edits.
          void vscode.commands.executeCommand('workbench.action.files.save');
        }else if(message.type==='revert'){
          if(doc.dirty){void vscode.commands.executeCommand('workbench.action.files.revert');}else {doc.view=await doc.provider.readProcessDocument(doc.key);doc.edit=processEdit(doc.view);doc.token=processToken(doc.view);await this.paint(doc,'Reloaded stored definition.');}
        }
      }).catch(async e=>{await panel.webview.postMessage({type:'notice',error:true,message:e instanceof Error?e.message:String(e)});});
    });
  }
  async saveCustomDocument(doc:ProcessDocument,_cancellation:vscode.CancellationToken):Promise<void> {
    await doc.queue;
    const reason=this.reason(doc);if(reason)throw new Error(reason);
    doc.saving=true;
    await this.paint(doc,'Saving…');
    try {
      const view=await doc.provider.saveProcessDocument({key:[...doc.key.parts],token:doc.token,edit:structuredClone(doc.edit),operatorId:this.workspace.configFor(doc.provider.id)!.peoplesoftOperatorId!.trim()});
      doc.view=view;doc.edit=processEdit(view);doc.token=processToken(view);
      doc.saving=false;await this.paint(doc,'Saved and verified.');
    }catch(e){doc.saving=false;await this.paint(doc);throw e;}
  }
  async saveCustomDocumentAs():Promise<void> {throw new Error('Save As is not supported for process definitions.');}
  async revertCustomDocument(doc:ProcessDocument,_cancellation:vscode.CancellationToken):Promise<void> {
    await doc.queue;doc.view=await doc.provider.readProcessDocument(doc.key);doc.edit=processEdit(doc.view);doc.token=processToken(doc.view);await this.paint(doc,'Reloaded stored definition.');
  }
  async backupCustomDocument(doc:ProcessDocument,context:vscode.CustomDocumentBackupContext):Promise<vscode.CustomDocumentBackup> {
    await doc.queue;
    await vscode.workspace.fs.writeFile(context.destination,Buffer.from(JSON.stringify({edit:doc.edit,token:doc.token})));
    return {id:context.destination.toString(),delete:()=>{void vscode.workspace.fs.delete(context.destination);}};
  }
}
