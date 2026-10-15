import { isReviewedWrite, reviewedPolicyIdentity } from './changeReview/authorization.js';
import {creationKey,setCreationStore,type CreationReceipt} from './providers/creationProvenance.js';
import * as vscode from 'vscode';
import { gunzipSync, gzipSync } from 'node:zlib';
import { displayName } from './model/definitions.js';
import { decideWrite, OWNERSHIP_LABELS, type Classification } from './model/ownership.js';
import { DatabaseProvider } from './providers/database.js';
import { BaselineIndex, setBaselineResolver, type BaselineFile, type DatabaseRelease } from './providers/ownershipReader.js';
import { awaitWriteApproval, setPolicyReader, setWriteGuard, type GuardedWrite } from './providers/writeGuard.js';
import { readCustomizationPolicy } from './views/customizationView.js';
import type { Workspace } from './workspace.js';

/*
 * The delivered-object policy in VS Code (docs/CUSTOMIZATION.md): the guard
 * every DatabaseProvider write passes (providers/writeGuard.ts) -- it
 * classifies the definition and, as peoplesoft.customization
 * .deliveredObjectPolicy says, refuses the write, asks the user, or lets it
 * through and records it; the delivered baselines (captured from a vanilla
 * demo database, kept in the extension's storage); and the audit log.
 */

const VERBS = { save: 'Save', delete: 'Delete', rename: 'Rename' } as const;

export function installCustomizationGuard(context: vscode.ExtensionContext, workspace: Workspace): void {
  const storage = context.globalStorageUri;
  const baselines = vscode.Uri.joinPath(storage, 'baselines');
  const auditFile = vscode.Uri.joinPath(storage, 'customization-audit.jsonl');
  const output = vscode.window.createOutputChannel('PeopleSoft Customization');
  /** Approvals for the rest of the session: connection, type, key. */
  const sessionApprovals = new Set<string>();
  const cache = new Map<string, { mtime: number; index: BaselineIndex }>();

  const receiptFile=vscode.Uri.joinPath(storage,'creation-receipts.json');
  const receipts=new Map<string,CreationReceipt>();
  const loaded=(async()=>{
    let bytes:Uint8Array;
    try{bytes=await vscode.workspace.fs.readFile(receiptFile);}catch(e){if((e as {code?:string}).code==='FileNotFound' || (e as Error).message?.includes('ENOENT'))return;throw e;}
    const file=JSON.parse(Buffer.from(bytes).toString('utf8')) as {format:string;receipts:CreationReceipt[]};
    if(file.format!=='psft-creation-receipts/1' || !Array.isArray(file.receipts))throw new Error('Invalid creation receipt file.');
    for(const r of file.receipts){
      if(typeof r.scope!=='string' || typeof r.createdAt!=='string' || !r.key || !Number.isInteger(r.key.type) || !Array.isArray(r.key.parts)
        || r.key.parts.some(p=>typeof p!=='string') || !Number.isFinite(r.stamp?.version) || typeof r.stamp.operator!=='string' || typeof r.stamp.updated!=='string')throw new Error('Invalid creation receipt.');
      receipts.set(creationKey(r.scope,r.key),r);
    }
  })();
  // Observe rejected loads immediately; callers still fail closed rather than silently discarding a corrupt ledger.
  void loaded.catch(e=>output.appendLine(`Creation receipts unavailable: ${e instanceof Error?e.message:String(e)}`));
  let writes=Promise.resolve();
  setCreationStore({
    find:async(scope,key)=>{await loaded;return receipts.get(creationKey(scope,key));},
    put:receipt=>{
      const next=writes.then(async()=>{await loaded;receipts.set(creationKey(receipt.scope,receipt.key),receipt);await vscode.workspace.fs.createDirectory(storage);
        await vscode.workspace.fs.writeFile(receiptFile,Buffer.from(JSON.stringify({format:'psft-creation-receipts/1',receipts:[...receipts.values()]})));});
      writes=next.catch(()=>{});return next;
    }
  });

  setPolicyReader(() => readCustomizationPolicy());

  setBaselineResolver(async (release: DatabaseRelease) => {
    let entries: [string, vscode.FileType][];
    try { entries = await vscode.workspace.fs.readDirectory(baselines); } catch { return undefined; }
    const found: BaselineIndex[] = [];
    for (const [name] of entries.filter(([n]) => n.endsWith('.json.gz'))) {
      const uri = vscode.Uri.joinPath(baselines, name);
      const stat = await vscode.workspace.fs.stat(uri);
      let hit = cache.get(uri.toString());
      if (!hit || hit.mtime !== stat.mtime) {
        try {
          const file = JSON.parse(gunzipSync(await vscode.workspace.fs.readFile(uri)).toString('utf8')) as BaselineFile;
          if (file.format !== 'psft-delivered-baseline/1') continue;
          hit = { mtime: stat.mtime, index: new BaselineIndex(file) };
          cache.set(uri.toString(), hit);
        } catch (error) {
          output.appendLine(`Skipped baseline ${name}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }
      if (hit.index.file.appRelease === release.appRelease) found.push(hit.index);
    }
    // The application release decides; the same tools release is preferred.
    return found.find((b) => b.file.toolsRelease === release.toolsRelease) ?? found[0];
  });

  const audit = async (entry: Record<string, unknown>) => {
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
    output.appendLine(line);
    try {
      await vscode.workspace.fs.createDirectory(storage);
      let prior: Uint8Array = new Uint8Array();
      try { prior = await vscode.workspace.fs.readFile(auditFile); } catch { /* the first entry */ }
      await vscode.workspace.fs.writeFile(auditFile, Buffer.concat([Buffer.from(prior), Buffer.from(line + '\n')]));
    } catch (error) {
      output.appendLine(`Could not write the audit log: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  setWriteGuard(async ({ provider, key, action, origin }: GuardedWrite) => {
    if (!(provider instanceof DatabaseProvider)) return;
    const policy = readCustomizationPolicy();
    let classification: Classification;
    let exists = true;
    try {
      const r = await provider.classifyDefinition(key, policy.prefixes);
      classification = r.classification;
      exists = r.evidence.exists;
    } catch (error) {
      classification = { ownership: 'UNKNOWN', confidence: 'LOW', evidence: [`Could not classify it: ${error instanceof Error ? error.message : String(error)}`] };
    }
    const agent = origin === 'agent';
    const policyName = agent ? 'agentDeliveredObjectPolicy' : 'deliveredObjectPolicy';
    const decision = decideWrite(classification, agent ? policy.agentDeliveredObjectPolicy : policy.deliveredObjectPolicy, exists);
    if (isReviewedWrite(provider.id, key) && !isReviewedWrite(provider.id, key, reviewedPolicyIdentity(policy, classification, exists))) throw new Error('Ownership or policy changed after Change Review; revalidate and review again.');
    if (decision.action === 'allow') return;
    const name = displayName(key);
    const record = (outcome: string) => audit({
      outcome, action, by: agent ? 'agent (MCP)' : 'user', connection: provider.displayName, type: key.type, key: key.parts, name,
      ownership: classification.ownership, confidence: classification.confidence, evidence: classification.evidence, policy: `${policyName}: ${agent ? policy.agentDeliveredObjectPolicy : policy.deliveredObjectPolicy}`
    });
    if (decision.action === 'refuse') {
      await record('refused');
      throw new Error(`${VERBS[action]} of ${name} refused: ${decision.reason} (peoplesoft.customization.${policyName} is "block".)`);
    }
    if (decision.action === 'audit') { await record('allowed with audit'); return; }
    if (isReviewedWrite(provider.id, key, reviewedPolicyIdentity(policy, classification, exists))) { await record('approved exact Change Review revision'); return; }
    // A person's session approval does not cover an agent's writes, nor the other way round.
    const session = `${origin}\u0000${provider.id}\u0000${key.type}\u0000${key.parts.join('.')}`;
    if (sessionApprovals.has(session)) { await record('approved for the session'); return; }
    const answer = await awaitWriteApproval(vscode.window.showWarningMessage(
      `${agent ? 'An AI agent wants to ' + action : VERBS[action]} ${name}${agent ? ' through the MCP' : ''}. ${decision.reason}`,
      { modal: true, detail: `${OWNERSHIP_LABELS[classification.ownership]} (${classification.confidence.toLowerCase()} confidence) on ${provider.displayName}:\n- ${classification.evidence.join('\n- ')}\n\nThis is the delivered-object approval (peoplesoft.customization.${policyName}); it covers this ${action} only, or this definition for the rest of the session${agent ? ' (agent writes only)' : ''}.` },
      'Approve', 'Approve for This Session'), 'Delivered-object approval');
    if (!answer) {
      await record('declined');
      throw new Error(`${VERBS[action]} of ${name} not approved: nothing was written.`);
    }
    if (answer === 'Approve for This Session') sessionApprovals.add(session);
    await record(answer === 'Approve' ? 'approved' : 'approved for the session');
  });

  context.subscriptions.push(
    output,
    { dispose: () => { setWriteGuard(undefined); setBaselineResolver(undefined); setCreationStore(undefined); } },
    vscode.commands.registerCommand('psft.customization.showAuditLog', async () => {
      try {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(auditFile));
      } catch {
        void vscode.window.showInformationMessage('No delivered-object writes have been recorded yet.');
      }
    }),
    vscode.commands.registerCommand('psft.customization.captureBaseline', () => captureBaselineCommand(workspace, baselines, cache))
  );
}

/**
 * Capture Delivered Baseline: from a connection the user says is a vanilla
 * demo database of the release, every definition Oracle's operator saved,
 * stored as <application release>.json.gz.
 */
async function captureBaselineCommand(workspace: Workspace, baselines: vscode.Uri, cache: Map<string, unknown>): Promise<void> {
  const providers = workspace.activeProviders.filter((p): p is DatabaseProvider => p instanceof DatabaseProvider && p.isConnected);
  if (!providers.length) { void vscode.window.showWarningMessage('Connect to a vanilla PeopleSoft demo database first.'); return; }
  const picked = providers.length === 1 ? providers[0] : (await vscode.window.showQuickPick(providers.map((p) => ({ label: p.displayName, p })),
    { title: 'Capture Delivered Baseline', placeHolder: 'A vanilla demo database of the release (nothing customized)' }))?.p;
  if (!picked) return;
  const release = await picked.databaseRelease();
  const ok = await vscode.window.showWarningMessage(`Capture the delivered baseline of ${release.appRelease || 'this release'} from ${picked.displayName}?`,
    { modal: true, detail: 'Use a vanilla demo database (an untouched PUM image) of the same application release as the databases you develop on: every definition saved by PPLSOFT there is taken as Oracle-delivered. Read only.' },
    'Capture');
  if (ok !== 'Capture') return;
  const file = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Capturing the delivered baseline from ${picked.displayName}` },
    (progress) => picked.captureDeliveredBaseline((what) => progress.report({ message: what })));
  await vscode.workspace.fs.createDirectory(baselines);
  const name = `${(file.appRelease || 'release').replace(/[^A-Za-z0-9.]+/g, '_')}_PT${file.toolsRelease}.json.gz`;
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(baselines, name), gzipSync(Buffer.from(JSON.stringify(file))));
  cache.clear();
  const counts = Object.entries(file.kinds).map(([k, v]) => `${k} ${v.length}`).join(', ');
  void vscode.window.showInformationMessage(`Delivered baseline ${file.appRelease} (PeopleTools ${file.toolsRelease}) captured: ${counts}.`);
  void vscode.commands.executeCommand('psft.customization.refresh');
}

