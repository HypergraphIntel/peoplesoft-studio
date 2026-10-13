import * as vscode from 'vscode';
import { BUILTIN_SIGNATURES, signatureContextAt } from './signatures.js';

/*
 * Signature help for the built-in functions in BUILTIN_SIGNATURES: while a call
 * is being typed, the parameter list with the current parameter highlighted.
 * Triggered by "(" and ",". Unknown functions get nothing (the user's own
 * functions are already offered by completion).
 */
export function registerPeopleCodeSignatureHelp(context: vscode.ExtensionContext): void {
  const provider: vscode.SignatureHelpProvider = {
    provideSignatureHelp(document, position) {
      const ctx = signatureContextAt(document.lineAt(position.line).text, position.character);
      if (!ctx) return undefined;
      const sig = BUILTIN_SIGNATURES[ctx.name];
      if (!sig) return undefined;

      const info = new vscode.SignatureInformation(sig.label, new vscode.MarkdownString(sig.doc));
      info.parameters = sig.parameters.map((p) => new vscode.ParameterInformation(p));
      const help = new vscode.SignatureHelp();
      help.signatures = [info];
      help.activeSignature = 0;
      help.activeParameter = Math.min(ctx.activeParameter, Math.max(0, sig.parameters.length - 1));
      return help;
    }
  };
  context.subscriptions.push(
    vscode.languages.registerSignatureHelpProvider({ language: 'psft-peoplecode' }, provider, '(', ','));
}
