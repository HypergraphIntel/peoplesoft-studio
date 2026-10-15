import * as vscode from 'vscode';
import { DATA_MOVER_TEMPLATES, dataMoverLanguage } from './model/dataMoverTemplates.js';

export async function newDataMoverScript(): Promise<void> {
  const template = await vscode.window.showQuickPick(DATA_MOVER_TEMPLATES, { title: 'New Data Mover Script' });
  if (!template) return;
  const extension = vscode.extensions.getExtension('RichardWood.peoplesoft-datamover');
  const language = dataMoverLanguage(extension?.packageJSON);
  const document = await vscode.workspace.openTextDocument({ content: template.content, language: language ?? 'plaintext' });
  await vscode.window.showTextDocument(document);
  if (!language) {
    const action = 'Find the Data Mover extension';
    const chosen = await vscode.window.showInformationMessage(
      'Data Mover language support is provided by RichardWood.peoplesoft-datamover. Studio creates scripts but does not run Data Mover.', action);
    if (chosen === action) await vscode.commands.executeCommand('workbench.extensions.search', 'RichardWood.peoplesoft-datamover');
  }
}
