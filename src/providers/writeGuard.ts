import { AsyncLocalStorage } from 'node:async_hooks';
import type { DefinitionKey } from '../model/definitions.js';

/*
 * The delivered-object guard (docs/CUSTOMIZATION.md): one hook every write
 * of DatabaseProvider passes before it touches an existing definition --
 * from an editor, a designer or the MCP alike -- so the policy cannot be
 * skipped by taking another path. The extension installs the guard (it asks
 * the user, refuses, or records the write); without one, as in tests and the
 * command-line tools, writes go through unguarded.
 */

export type WriteAction = 'save' | 'delete' | 'rename';

/** Who is writing: a person in an editor or designer, or an AI agent through the MCP. */
export type WriteOrigin = 'user' | 'agent';

const origin = new AsyncLocalStorage<WriteOrigin>();

/** Runs an MCP tool call so every write it makes, however deep, is known to be an agent's (mcp/server.ts wraps every tool). */
export function runAsAgent<T>(fn: () => T): T {
  return origin.run('agent', fn);
}

/** The origin of the write in progress: an agent's inside runAsAgent, else a person's. */
export function writeOrigin(): WriteOrigin {
  return origin.getStore() ?? 'user';
}

/** What the guard is told: the provider (to classify with), the definition, and the action. */
export interface GuardedWrite {
  provider: unknown;
  key: DefinitionKey;
  action: WriteAction;
  /** Filled in by guardWrite from the running call. */
  origin?: WriteOrigin;
}

/** Throws to refuse the write. */
export type WriteGuard = (write: GuardedWrite) => Promise<void>;

let guard: WriteGuard | undefined;

export function setWriteGuard(g: WriteGuard | undefined): void {
  guard = g;
}

export async function guardWrite(write: GuardedWrite): Promise<void> {
  if (guard) await guard({ ...write, origin: write.origin ?? writeOrigin() });
}

/**
 * The effective customization policy (peoplesoft.customization.*), for code
 * without `vscode` (the MCP tools). The extension installs the reader; the
 * default is what the settings default to.
 */
export interface EffectivePolicy {
  prefixes: { prefix: string; owner: 'organization' | 'partner'; name?: string }[];
  defaultStrategy: 'configurationFirst' | 'allowDirect';
  /** For people, in the editors and designers. */
  deliveredObjectPolicy: 'block' | 'requireApproval' | 'allowWithAudit';
  /** For AI agents, through the MCP. */
  agentDeliveredObjectPolicy: 'block' | 'requireApproval' | 'allowWithAudit';
}

let policyReader: () => EffectivePolicy = () => ({
  prefixes: [], defaultStrategy: 'configurationFirst', deliveredObjectPolicy: 'allowWithAudit', agentDeliveredObjectPolicy: 'requireApproval'
});

export function setPolicyReader(r: () => EffectivePolicy): void { policyReader = r; }
export function effectivePolicy(): EffectivePolicy { return policyReader(); }

const requestSignal=new AsyncLocalStorage<AbortSignal|undefined>();
export function withWriteRequest<T>(signal:AbortSignal|undefined,fn:()=>T):T {return requestSignal.run(signal,fn);}
export function assertWriteRequestActive():void {requestSignal.getStore()?.throwIfAborted();}

/** MCP approval cannot keep a tool alive indefinitely or authorize a cancelled request later. */
export class WriteApprovalTimeoutError extends Error {
  constructor(stage: string, timeoutMs: number) {
    super(`${stage} timed out after ${Math.ceil(timeoutMs / 1000)} seconds. Nothing was written. Open PeopleSoft: AI Write Approvals to see the expired request, then retry the original tool for a fresh approval.`);
    this.name = 'WriteApprovalTimeoutError';
  }
}

export async function awaitWriteApproval<T>(pending:PromiseLike<T>|((signal:AbortSignal)=>PromiseLike<T>),stage:string,timeoutMs=60_000):Promise<T> {
  if(writeOrigin()!=='agent')return await (typeof pending === 'function' ? pending(new AbortController().signal) : pending);
  const signal=requestSignal.getStore();
  signal?.throwIfAborted();
  const approval = new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  let fail:()=>void=()=>{};
  try {
    return await new Promise<T>((resolve,reject)=>{
      fail=()=>{const error=new Error(`${stage} was cancelled; nothing was written.`);approval.abort(error);reject(error);};
      timer=setTimeout(()=>{const error=new WriteApprovalTimeoutError(stage,timeoutMs);approval.abort(error);reject(error);},timeoutMs);
      signal?.addEventListener('abort',fail,{once:true});
      if(signal?.aborted)fail();
      if(!approval.signal.aborted)Promise.resolve(typeof pending === 'function' ? pending(approval.signal) : pending).then(resolve,reject);
    });
  } finally {if(timer)clearTimeout(timer);signal?.removeEventListener('abort',fail);}
}
