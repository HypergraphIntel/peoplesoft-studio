import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, canonical, privacy, type ChangeSet, type Json } from './model.js';
/** Single-machine storage. Never remove a live/unknown owner's lock. */
export class ReviewStore {
    constructor(readonly root: string) { }
    private location(kind: string, id: string): string {
        if (!/^[a-zA-Z0-9-]+$/.test(id))
            throw new Error('Invalid storage identifier.');
        return path.join(this.root, kind, id + '.json');
    }
    async init(): Promise<void> {
        await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
        for (const d of ['sets', 'blobs'])
            await fs.mkdir(path.join(this.root, d), { recursive: true, mode: 0o700 });
    }
    private async reclaimDeadOwner(): Promise<void> {
        const directory = path.join(this.root, 'lock-recovery');
        try {
            await fs.mkdir(directory, { mode: 0o700 });
        }
        catch {
            throw new Error('Change Review storage is locked; recovery is already in progress.');
        }
        try {
            const file = path.join(this.root, 'writer.lock');
            let content: string;
            try {
                content = await fs.readFile(file, 'utf8');
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                    return;
                throw error;
            }
            if (!/^[1-9][0-9]*$/.test(content))
                throw new Error('Unknown lock owner; manual investigation required.');
            try {
                process.kill(Number(content), 0);
                throw new Error('Change Review storage is locked by a live process.');
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
                    throw error;
            }
            await fs.unlink(file);
        }
        finally {
            await fs.rmdir(directory);
        }
    }
    async exclusive<T>(fn: () => Promise<T>): Promise<T> {
        await this.init();
        const lock = path.join(this.root, 'writer.lock');
        let handle;
        try {
            handle = await fs.open(lock, 'wx', 0o600);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
                throw error;
            await this.reclaimDeadOwner();
            handle = await fs.open(lock, 'wx', 0o600);
        }
        await handle.writeFile(String(process.pid));
        await handle.sync();
        try {
            return await fn();
        }
        finally {
            await handle.close();
            await fs.unlink(lock);
        }
    }
    private async atomic(file: string, text: string): Promise<void> {
        const temp = file + '.' + randomUUID() + '.tmp';
        const f = await fs.open(temp, 'wx', 0o600);
        try {
            await f.writeFile(text);
            await f.sync();
        }
        finally {
            await f.close();
        }
        await fs.rename(temp, file);
        const dir = await fs.open(path.dirname(file), 'r');
        try {
            await dir.sync();
        }
        finally {
            await dir.close();
        }
    }
    async blob(value: Json): Promise<string> {
        privacy(value);
        if (Buffer.byteLength(canonical(value)) > 8 * 1024 * 1024)
            throw new Error('Snapshot exceeds the 8 MiB limit.');
        const id = hash(value), file = this.location('blobs', id);
        await this.init();
        try {
            const existing = await this.readBlob(id);
            if (canonical(existing) !== canonical(value))
                throw new Error('Snapshot hash collision.');
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
            await this.atomic(file, canonical(value));
        }
        return id;
    }
    async readBlob(id: string): Promise<Json> {
        const value = JSON.parse(await fs.readFile(this.location('blobs', id), 'utf8')) as Json;
        if (hash(value) !== id)
            throw new Error('Snapshot integrity check failed.');
        return value;
    }
    async put(set: ChangeSet): Promise<void> {
        // Approval provenance lives in this extension-owned store, not MCP arguments.
        const value = JSON.parse(JSON.stringify(set)) as Json;
        privacy(value);
        if (set.objects.length > 1000 || Buffer.byteLength(canonical(value)) > 32 * 1024 * 1024)
            throw new Error('Change Set storage limit exceeded.');
        await this.atomic(this.location('sets', set.id), canonical({ checksum: hash(value), value }));
    }
    async get(id: string): Promise<ChangeSet> {
        const envelope = JSON.parse(await fs.readFile(this.location('sets', id), 'utf8')) as {
            checksum: string;
            value: ChangeSet;
        };
        if (hash(envelope.value) !== envelope.checksum || envelope.value.schema !== 1 || envelope.value.id !== id || !Array.isArray(envelope.value.objects))
            throw new Error('Corrupt or unsupported Change Set.');
        for (const c of envelope.value.objects) {
            await this.readBlob(c.before);
            await this.readBlob(c.after);
        }
        return envelope.value;
    }
    async list(): Promise<ChangeSet[]> {
        await this.init();
        const names = await fs.readdir(path.join(this.root, 'sets'));
        const sets: ChangeSet[] = [];
        for (const name of names.filter(n => n.endsWith('.json')))
            sets.push(await this.get(name.slice(0, -5)));
        return sets.sort((a, b) => b.created.localeCompare(a.created));
    }
}
