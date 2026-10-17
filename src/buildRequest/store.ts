import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { extractText } from './extract.js';
import {
  applyEdit, approvalBlocker, buildSpec, checkSpec, isApproved, newRequest, OBJECT_STATUSES, SCHEMA, specHash,
  type Attachment, type BuildRequest, type ObjectStatus, type RequestEdit
} from './model.js';

/*
 * Build requests on disk, one folder each under the extension's global
 * storage (never the workspace: a business user's documents stay out of
 * source control):
 *
 *   <root>/<id>/request.json
 *   <root>/<id>/files/<attachment id>/<original name>
 *   <root>/<id>/text/<attachment id>.txt      (extracted text, when any)
 *
 * The extension host is the only writer -- the VS Code panel and the MCP
 * server run in it -- so one queue serializes every change.
 */

const ID = /^br-[0-9a-f]{12}$/;
const ATTACHMENT_ID = /^a-[0-9a-f]{10}$/;
/** The largest file a request takes; a build request carries documents, not data loads. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export type Listener = (id: string) => void;

export class BuildRequestStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<Listener>();

  constructor(readonly root: string, private readonly now: () => string = () => new Date().toISOString()) {}

  onDidChange(listener: Listener): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  folder(id: string): string {
    if (!ID.test(id)) throw new Error(`Not a build request id: ${id}.`);
    return path.join(this.root, id);
  }

  attachmentPath(id: string, attachment: Attachment): string {
    if (!ATTACHMENT_ID.test(attachment.id)) throw new Error('Invalid attachment id.');
    return path.join(this.folder(id), 'files', attachment.id, attachment.name);
  }

  async list(): Promise<BuildRequest[]> {
    let names: string[];
    try { names = await fs.readdir(this.root); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const out: BuildRequest[] = [];
    for (const name of names.filter((n) => ID.test(n))) {
      try { out.push(await this.get(name)); } catch { /* a half-written or foreign folder is not a request */ }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<BuildRequest> {
    let text: string;
    try { text = await fs.readFile(path.join(this.folder(id), 'request.json'), 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`No build request ${id}.`);
      throw error;
    }
    const r = JSON.parse(text) as BuildRequest;
    if (r.schema !== SCHEMA || r.id !== id) throw new Error(`${id} is not a ${SCHEMA} request.`);
    return r;
  }

  async create(init: RequestEdit = {}): Promise<BuildRequest> {
    return this.serialized(async () => {
      const id = `br-${randomBytes(6).toString('hex')}`;
      const r = newRequest(id, this.now(), init);
      await fs.mkdir(this.folder(id), { recursive: true, mode: 0o700 });
      await this.write(r);
      return r;
    }, '');
  }

  async delete(id: string): Promise<void> {
    await this.serialized(async () => { await fs.rm(this.folder(id), { recursive: true, force: true }); }, id);
  }

  /** The developer's edits to the request itself. */
  async edit(id: string, edit: RequestEdit): Promise<BuildRequest> {
    return this.mutate(id, (r) => applyEdit(r, edit));
  }

  /** Copies a file into the request and extracts its text. */
  async attach(id: string, name: string, content: Buffer): Promise<Attachment> {
    const safe = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 200) || 'attachment';
    if (content.length > MAX_ATTACHMENT_BYTES) throw new Error(`${safe} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
    let attachment!: Attachment;
    await this.mutate(id, async (r) => {
      const sha256 = createHash('sha256').update(content).digest('hex');
      const same = r.attachments.find((a) => a.sha256 === sha256 && a.name === safe);
      if (same) { attachment = same; return false; }
      const extraction = extractText(safe, content);
      attachment = { id: `a-${randomBytes(5).toString('hex')}`, name: safe, size: content.length, sha256, addedAt: this.now(), extraction: extraction.method,
        ...(extraction.method === 'none' ? { extractionNote: extraction.reason } : { textLength: extraction.text.length }) };
      const file = this.attachmentPath(id, attachment);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await fs.writeFile(file, content, { mode: 0o600 });
      if (extraction.method !== 'none') {
        await fs.mkdir(path.join(this.folder(id), 'text'), { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(this.folder(id), 'text', `${attachment.id}.txt`), extraction.text, { encoding: 'utf8', mode: 0o600 });
      }
      r.attachments.push(attachment);
      r.inputsRevision++;
      return true;
    });
    return attachment;
  }

  async removeAttachment(id: string, attachmentId: string): Promise<BuildRequest> {
    return this.mutate(id, async (r) => {
      const a = r.attachments.find((x) => x.id === attachmentId);
      if (!a) return false;
      r.attachments = r.attachments.filter((x) => x !== a);
      r.inputsRevision++;
      await fs.rm(path.dirname(this.attachmentPath(id, a)), { recursive: true, force: true });
      await fs.rm(path.join(this.folder(id), 'text', `${a.id}.txt`), { force: true });
      return true;
    });
  }

  /** An attachment's extracted text, or undefined when it has none. */
  async attachmentText(id: string, attachmentId: string): Promise<string | undefined> {
    if (!ATTACHMENT_ID.test(attachmentId)) throw new Error('Invalid attachment id.');
    try { return await fs.readFile(path.join(this.folder(id), 'text', `${attachmentId}.txt`), 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  // ---- the agent's side (the MCP tools) ----

  async ask(id: string, questions: Array<{ text: string; why?: string }>): Promise<BuildRequest> {
    return this.mutate(id, (r) => {
      for (const q of questions) {
        if (r.questions.some((x) => !x.answer && x.text.trim() === q.text.trim())) continue;
        r.questions.push({ id: `q${r.questions.length + 1}`, text: q.text.trim(), ...(q.why ? { why: q.why } : {}), askedAt: this.now() });
      }
      return true;
    });
  }

  /** Records a proposed spec; any approval of an earlier one lapses. Refused when it is inconsistent. */
  async proposeSpec(id: string, input: unknown): Promise<BuildRequest> {
    const parsed = buildSpec.safeParse(input);
    if (!parsed.success) throw new Error(`Not a valid build spec: ${parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('; ')}`);
    const problems = checkSpec(parsed.data);
    if (problems.length) throw new Error(`The spec is inconsistent: ${problems.join(' ')}`);
    return this.mutate(id, (r) => {
      const hash = specHash(parsed.data);
      if (r.spec && r.spec.hash === hash && r.spec.basedOnInputs === r.inputsRevision) return false;
      r.spec = { ...parsed.data, revision: (r.spec?.revision ?? 0) + 1, proposedAt: this.now(), basedOnInputs: r.inputsRevision, hash };
      return true;
    });
  }

  /** Records the agent's outcome for one spec object; only an approved, current spec may be built. */
  async report(id: string, entries: Array<{ ref: string; status: ObjectStatus; detail: string; changeSetId?: string }>): Promise<BuildRequest> {
    return this.mutate(id, (r) => {
      if (!isApproved(r)) throw new Error('The build spec is not approved for the request as it stands; nothing may be built or reported. Call psft_build_request_get.');
      const refs = new Set(r.spec!.objects.map((o) => o.ref));
      for (const e of entries) {
        if (!refs.has(e.ref)) throw new Error(`${e.ref} is not an object in the approved spec.`);
        if (!OBJECT_STATUSES.includes(e.status)) throw new Error(`Unknown status ${e.status}.`);
      }
      for (const e of entries) {
        const at = this.now(), prior = r.progress[e.ref];
        r.progress[e.ref] = { status: e.status, detail: e.detail, at, ...(e.changeSetId ?? prior?.changeSetId ? { changeSetId: e.changeSetId ?? prior?.changeSetId } : {}),
          history: [...(prior?.history ?? []), { status: e.status, detail: e.detail, at }] };
      }
      return true;
    });
  }

  // ---- the developer's decisions (the panel only; never an MCP tool) ----

  async answer(id: string, questionId: string, answer: string): Promise<BuildRequest> {
    return this.mutate(id, (r) => {
      const q = r.questions.find((x) => x.id === questionId);
      if (!q) throw new Error(`No question ${questionId}.`);
      if ((q.answer ?? '') === answer.trim()) return false;
      q.answer = answer.trim();
      q.answeredAt = this.now();
      r.inputsRevision++;
      return true;
    });
  }

  async approve(id: string, specRevision: number): Promise<BuildRequest> {
    return this.mutate(id, (r) => {
      const blocker = approvalBlocker(r);
      if (blocker) throw new Error(blocker);
      if (r.spec!.revision !== specRevision) throw new Error('The spec changed while you were reviewing it; review the new revision.');
      r.approval = { specRevision, specHash: r.spec!.hash, inputsRevision: r.inputsRevision, at: this.now() };
      return true;
    });
  }

  async requestChanges(id: string, text: string): Promise<BuildRequest> {
    return this.mutate(id, (r) => {
      if (!r.spec) throw new Error('There is no spec to change.');
      r.feedback.push({ id: `f${r.feedback.length + 1}`, text: text.trim(), at: this.now(), specRevision: r.spec.revision });
      delete r.approval;
      return true;
    });
  }

  async recordHandoff(id: string, phase: 'analyze' | 'build', agent: string): Promise<BuildRequest> {
    return this.mutate(id, (r) => { r.handoffs.push({ phase, agent, at: this.now() }); return true; });
  }

  // ----

  private async mutate(id: string, change: (r: BuildRequest) => boolean | Promise<boolean>): Promise<BuildRequest> {
    return this.serialized(async () => {
      const r = await this.get(id);
      if (await change(r)) {
        r.updatedAt = this.now();
        await this.write(r);
      }
      return r;
    }, id);
  }

  private async write(r: BuildRequest): Promise<void> {
    const file = path.join(this.folder(r.id), 'request.json');
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(r, null, 1), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, file);
  }

  private serialized<T>(work: () => Promise<T>, id: string): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run.then((value) => {
      const changed = id || (value as BuildRequest | undefined)?.id;
      if (changed) for (const l of this.listeners) { try { l(changed); } catch { /* a listener's failure is its own */ } }
      return value;
    });
  }
}
