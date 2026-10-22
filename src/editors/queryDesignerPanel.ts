import * as vscode from 'vscode';
import type { QueryView } from '../model/queryDefinition.js';
import { applyQueryOp, parseQueryOp, type QueryCriterion, type QueryFieldInfo, type QueryOp } from '../model/queryDocument.js';
import type { QueryEdit } from '../providers/queryWriter.js';
import type { QuerySqlPlan } from '../model/querySql.js';
import { renderQueryDesigner, type QueryFieldMetadata, type QueryDesignerState } from './queryDesignerHtml.js';

export interface QueryDesignerHost {
  editable: boolean;
  metadata: Record<string, QueryFieldInfo & QueryFieldMetadata>;
  /** Field metadata of every record the query uses, by record name; loadRecord adds a joined, union or subquery record. */
  records?: Record<string, Record<string, QueryFieldInfo & QueryFieldMetadata>>;
  loadRecord?(name: string): Promise<Record<string, QueryFieldInfo & QueryFieldMetadata>>;
  prepare(view: QueryView): Promise<QuerySqlPlan>;
  run(view: QueryView, values: Record<string,string>, limit: number): Promise<NonNullable<QueryDesignerState['result']>>;
  save(view: QueryView, token: string): Promise<QueryEdit>;
  saveAs(view: QueryView): Promise<void>;
  reload(): Promise<QueryEdit | undefined>;
}
export class QueryDesignerPanel {
  private static readonly panels = new Map<string, vscode.WebviewPanel>();
  private static readonly sessions = new Map<string, { dirty(): boolean; reload(): Promise<void> }>();
  static hasUnsaved(connectionId: string, name: string, owner = ''): boolean {
    return this.sessions.get(JSON.stringify([connectionId, name, owner.trim()]))?.dirty() ?? false;
  }
  static async reloadIfOpen(connectionId: string, name: string, owner = ''): Promise<void> {
    await this.sessions.get(JSON.stringify([connectionId, name, owner.trim()]))?.reload();
  }
  static async show(connection: { id: string; displayName: string }, edit: QueryEdit, host: QueryDesignerHost): Promise<void> {
    const name=String(edit.view.query.QRYNAME).trim();
    const id=JSON.stringify([connection.id,name,String(edit.view.query.OPRID).trim()]);
    const existing=this.panels.get(id);
    if (existing) { existing.reveal(); return; }
    const panel=vscode.window.createWebviewPanel('psft.queryDesigner',`${name} — Query`,vscode.ViewColumn.Active,
      {enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]});
    this.panels.set(id,panel);
    let view=structuredClone(edit.view), token=edit.token, dirty=token==='absent';
    let history: QueryView[]=[], future: QueryView[]=[];
    let result: QueryDesignerState['result'];
    let message='';
    const records={...host.records};
    const subqueryRecords=(criteria: QueryCriterion[]): string[]=>criteria.flatMap(c=>[c.value,c.value2].flatMap(v=>v && 'subquery' in v ? [v.subquery.record,...subqueryRecords(v.subquery.criteria ?? [])] : []));
    const needed=(op: QueryOp)=>op.kind==='join' || op.kind==='union' ? [op.record] : op.kind==='criteria' || op.kind==='having' ? subqueryRecords(op.criteria) : [];
    let disposed=false;
    let queue=Promise.resolve();
    const render=async () => {
      let plan: QuerySqlPlan | undefined, unsupported='';
      try { plan=await host.prepare(view); } catch(e) {unsupported=e instanceof Error?e.message:String(e);}
      if (disposed) return;
      panel.title=`${dirty?'● ':''}${name} — Query`;
      panel.webview.html=renderQueryDesigner(name,connection.displayName,view,host.metadata,
        {editable:host.editable,dirty,plan,unsupported,message,result,canUndo:!!history.length,canRedo:!!future.length,records});
    };
    this.sessions.set(id, { dirty: () => dirty, reload: async () => {
      queue = queue.then(async () => {
        if (dirty || disposed) return;
        const loaded = await host.reload();
        if (!loaded || disposed) return;
        view = loaded.view; token = loaded.token; history = []; future = []; result = undefined;
        message = 'Reloaded after an external save.';
        await render();
      });
      await queue;
    } });
    panel.onDidDispose(()=>{disposed=true;this.panels.delete(id);this.sessions.delete(id);});
    panel.webview.onDidReceiveMessage((raw: unknown)=>{
      queue=queue.then(async()=>{
        if (!raw || typeof raw!=='object') throw new Error('Invalid Query message.');
        const m=raw as Record<string,unknown>;
        message='';
        if (['op','undo','redo','save','saveAs'].includes(String(m.kind)) && !host.editable) throw new Error('This Query is read only.');
        switch(m.kind) {
          case 'op': {
            const parsed=parseQueryOp(m.op);
            for (const name of needed(parsed)) if (!records[name]) {
              if (!host.loadRecord) throw new Error('This designer cannot add records.');
              records[name]=await host.loadRecord(name);
            }
            const next=applyQueryOp(view,parsed,host.metadata,Object.fromEntries(Object.entries(records).map(([name,fields])=>[name,{fields}])));
            history.push(view); if(history.length>100)history.shift(); future=[];view=next;dirty=true;result=undefined;break;
          }
          case 'undo': if(history.length){future.push(view);view=history.pop()!;dirty=true;result=undefined;} break;
          case 'redo': if(future.length){history.push(view);view=future.pop()!;dirty=true;result=undefined;} break;
          case 'save': { const saved=await host.save(view,token);view=saved.view;token=saved.token;dirty=false;message='Saved and verified.';break; }
          case 'saveAs': await host.saveAs(view); break;
          case 'reload': {
            if(dirty && await vscode.window.showWarningMessage('Discard unsaved Query changes?',{modal:true},'Discard')!=='Discard')break;
            const loaded=await host.reload();if(!loaded)throw new Error('This query has not been saved yet.');
            view=loaded.view;token=loaded.token;dirty=false;history=[];future=[];result=undefined;break;
          }
          case 'run': {
            if (!m.values || typeof m.values!=='object' || Array.isArray(m.values) || Object.values(m.values).some(v=>typeof v!=='string'))throw new Error('Invalid prompt input.');
            result=undefined;
            result=await host.run(view,m.values as Record<string,string>,Number(m.limit));
            message=`${result.rows.length} rows${result.truncated?' (row limit reached)':''} · ${result.ms} ms`;break;
          }
          default: throw new Error('Unknown Query action.');
        }
      }).catch(e=>{message=e instanceof Error?e.message:String(e);}).then(render);
    });
    await render();
  }
}
