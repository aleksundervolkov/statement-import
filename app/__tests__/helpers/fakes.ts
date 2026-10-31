import { existsSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ImportController } from '../../src/core/importController';
import type { FileTransport, Logger, OperationStore, StagedFile, StoredOperation } from '../../src/core/types';

export class MemoryStore implements OperationStore {
  value: StoredOperation | null = null;
  async load() { return this.value && structuredClone(this.value); }
  async save(operation: StoredOperation | null) { this.value = operation && structuredClone(operation); }
}

/** Node stand-in for the native uploadAsync transport: sends the file's real bytes over HTTP. */
export class NodeFileTransport implements FileTransport {
  uploads: { headers: Record<string, string>; storeAtSend: StoredOperation | null }[] = [];
  removed: string[] = [];
  constructor(private store: MemoryStore) {}
  async upload(url: string, headers: Record<string, string>, file: StagedFile) {
    this.uploads.push({ headers, storeAtSend: structuredClone(this.store.value) });
    const response = await fetch(url, { method: 'POST', headers, body: readFileSync(file.uri) });
    return { status: response.status, body: await response.text() };
  }
  async exists(file: StagedFile) { return existsSync(file.uri); }
  async remove(file: StagedFile) { this.removed.push(file.uri); rmSync(file.uri, { force: true }); }
}

export function createHarness(base: string, options: { store?: MemoryStore; fetchFn?: typeof fetch; timeoutMs?: number } = {}) {
  const store = options.store ?? new MemoryStore();
  const transport = new NodeFileTransport(store);
  const logs: unknown[] = [];
  const log: Logger = (event, data) => { logs.push([event, data]); };
  const controller = new ImportController({
    baseUrl: base, store, transport, log, pollMs: 50, timeoutMs: options.timeoutMs,
    newKey: () => `key-${randomUUID()}`,
    fetchFn: options.fetchFn ?? fetch,
  });
  return { controller, store, transport, logs };
}

/**
 * Holds the first matching request until release(). With `replace`, answers it with that
 * response instead of the mock; otherwise the real mock response arrives late.
 */
export function holdFetch(match: (url: string, method: string) => boolean, replace?: () => Response) {
  let release!: () => void;
  const opened = new Promise<void>(done => { release = done; });
  let reachedDone!: () => void;
  const reached = new Promise<void>(done => { reachedDone = done; });
  let armed = true;
  const fetchFn: typeof fetch = async (input, init) => {
    if (armed && match(String(input), init?.method ?? 'GET')) {
      armed = false;
      const response = replace ? replace() : await fetch(input, init);
      reachedDone();
      await opened;
      return response;
    }
    return fetch(input, init);
  };
  return { fetchFn, release, reached };
}

export async function waitFor(check: () => boolean, timeoutMs = 5000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(done => setTimeout(done, 20));
  }
}
