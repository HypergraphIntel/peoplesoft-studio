import * as vscode from 'vscode';
import { inlineCallsAt } from './inlineCalls.js';
import { gated } from './languageFeatures.js';

export function registerPeopleCodeInlineCalls(context:vscode.ExtensionContext):void {
  const provider:vscode.InlineCompletionItemProvider={
    provideInlineCompletionItems(document,position,completion,token) {
      if(token.isCancellationRequested||document.isClosed||vscode.workspace.getConfiguration('peoplesoft').get<boolean>('peoplecode.inlineCallPreview')===false)return [];
      // Most requests cannot start a call; do not scan a large program for those requests.
      if(!/[A-Za-z_][A-Za-z0-9_]{2,}[ \t]*(?:\([ \t]*)?$/.test(document.lineAt(position.line).text.slice(0,position.character)))return [];
      const source=document.getText(), offset=document.offsetAt(position), selected=completion.selectedCompletionInfo;
      return inlineCallsAt(source,offset).flatMap(call=>{
        const range=new vscode.Range(document.positionAt(call.start),document.positionAt(call.end));
        if(selected&&(!range.isEqual(selected.range)||!call.text.startsWith(selected.text)))return [];
        const item=new vscode.InlineCompletionItem(new vscode.SnippetString(call.snippet),range);
        // The range may include VS Code's auto-inserted closing parenthesis.
        item.filterText=source.slice(call.start,call.end);
        return [item];
      });
    }
  };
  context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({language:'psft-peoplecode'},gated(provider)));
}
