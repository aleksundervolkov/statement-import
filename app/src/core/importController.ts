import type { FileTransport, JobView, Logger, Operation, OperationStore, Phase, StagedFile, StoredOperation } from './types';

type Deps = {
  baseUrl: string;
  store: OperationStore;
  transport: FileTransport;
  fetchFn: typeof fetch;
  newKey: () => string;
  log: Logger;
  pollMs?: number;
  timeoutMs?: number;
};

const IDLE: Operation = { phase: 'idle' };
const JOB_PHASES: Phase[] = ['tracking', 'delete_pending', 'delete_failed'];

export function toStored(operation: Operation): StoredOperation {
  const { file, job, ...rest } = operation;
  const stored: StoredOperation = rest;
  if (file) stored.file = { uri: file.uri, size: file.size, format: file.format };
  if (job) stored.job = { jobId: job.jobId, status: job.status, revision: job.revision };
  return stored;
}

/** The original name is not stored; a resend after relaunch uses a neutral one. */
function fromStored(stored: StoredOperation): Operation {
  const { file, ...rest } = stored;
  return file ? { ...rest, file: { ...file, name: `statement.${file.format}` } } : rest;
}

/**
 * Owns one import operation: persists the idempotency key before POST, recovers an
 * uncertain POST by key, accepts only newer revisions, and claims deletion only after GET deleted.
 * Every response is checked against the key, job or delete key it was sent for; a response
 * for an operation the user already left is dropped.
 */
export class ImportController {
  private state: Operation = IDLE;
  private listeners = new Set<() => void>();
  private pollToken = 0;
  private readonly pollMs: number;
  private readonly timeoutMs: number;

  constructor(private deps: Deps) {
    this.pollMs = deps.pollMs ?? 700;
    this.timeoutMs = deps.timeoutMs ?? 15000;
  }

  getState = (): Operation => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  dispose() {
    this.pollToken += 1;
    this.listeners.clear();
  }

  /** Called on launch. Never re-sends the file on its own. */
  async restore() {
    const saved = await this.deps.store.load();
    if (!saved) return;
    const operation = fromStored(saved);
    await this.deps.store.save(toStored(operation));
    this.set(operation);
    this.deps.log('restored', { phase: operation.phase });
    switch (operation.phase) {
      case 'uploading':
      case 'unknown':
        return this.recover();
      case 'tracking':
        await this.refresh();
        return this.startPolling();
      case 'delete_pending':
        await this.refresh();
        return this.confirmDeletion();
    }
  }

  stage(file: StagedFile) {
    this.set({ phase: 'confirm', file });
  }

  async cancel() {
    const { file } = this.state;
    if (file) await this.deps.transport.remove(file);
    await this.update(IDLE);
  }

  /** Clears a finished, failed or abandoned operation and its local copy. */
  async discard() {
    this.pollToken += 1;
    await this.cancel();
  }

  async upload() {
    if (this.state.phase !== 'confirm' || !this.state.file) return;
    await this.update({ phase: 'uploading', file: this.state.file, idempotencyKey: this.deps.newKey() });
    await this.send();
  }

  /** User-initiated retry of an unconfirmed POST: same key, same private copy. */
  async retryUpload() {
    const { file } = this.state;
    if (this.state.phase !== 'unknown' || !file || !this.state.idempotencyKey) return;
    if (!(await this.deps.transport.exists(file))) {
      return this.update({ phase: 'failed', error: 'local_copy_missing' });
    }
    await this.update({ phase: 'uploading', error: undefined });
    await this.send();
  }

  async recover() {
    const key = this.state.idempotencyKey;
    if (!key || !this.awaitingJob(key)) return;
    try {
      const response = await this.request(`${this.deps.baseUrl}/imports/by-key/${encodeURIComponent(key)}`);
      if (!this.awaitingJob(key)) return this.late('recover');
      if (response.status === 200) {
        this.deps.log('recovered_by_key');
        return this.onJobKnown(key, await response.json());
      }
      this.deps.log('recover_miss', { http: response.status });
      await this.update({ phase: 'unknown', error: response.status === 404 ? 'not_found_yet' : `http_${response.status}` });
    } catch {
      if (!this.awaitingJob(key)) return this.late('recover');
      this.deps.log('recover_offline');
      await this.update({ phase: 'unknown', error: 'offline' });
    }
  }

  async refresh() {
    const jobId = this.state.job?.jobId;
    if (!jobId) return;
    const current = () => this.state.job?.jobId === jobId && JOB_PHASES.includes(this.state.phase);
    try {
      const response = await this.request(`${this.deps.baseUrl}/imports/${jobId}`);
      if (!current()) return this.late('refresh');
      if (response.status === 200) return this.apply(await response.json());
      if (response.status === 404) return this.update({ phase: 'failed', error: 'job_missing' });
    } catch {
      if (current()) this.set({ ...this.state, error: 'offline' });
    }
  }

  /** Requests server-side deletion. Same delete key on every retry. */
  async remove() {
    const { job } = this.state;
    if (!job || !['tracking', 'delete_failed'].includes(this.state.phase)) return;
    const deleteKey = this.state.deleteKey ?? this.deps.newKey();
    await this.update({ phase: 'delete_pending', deleteKey, error: undefined });
    const current = () => this.state.phase === 'delete_pending' && this.state.deleteKey === deleteKey;
    let response: Response;
    try {
      response = await this.request(`${this.deps.baseUrl}/imports/${job.jobId}`, {
        method: 'DELETE', headers: { 'Idempotency-Key': deleteKey },
      });
    } catch {
      if (!current()) return this.late('delete');
      this.deps.log('delete_unconfirmed');
      return this.update({ phase: 'delete_failed', error: 'delete_unconfirmed' });
    }
    if (!current()) return this.late('delete');
    this.deps.log('delete_response', { http: response.status });
    if (response.status === 404) return this.update({ phase: 'not_on_server', error: undefined });
    if (response.status !== 202) return this.update({ phase: 'delete_failed', error: `http_${response.status}` });
    const view: JobView = await response.json();
    if (view.status === 'deleting') await this.apply(view);
    await this.refresh();
    await this.confirmDeletion();
  }

  /** Only a GET may report `deleted`; the DELETE body is never taken as proof. */
  private async confirmDeletion() {
    if (this.state.phase !== 'delete_pending') return;
    if (this.state.job?.status !== 'deleting') {
      return this.update({ phase: 'delete_failed', error: 'delete_not_confirmed' });
    }
    this.startPolling();
  }

  private async send() {
    const { file, idempotencyKey } = this.state;
    if (!file || !idempotencyKey) return;
    try {
      const result = await this.deps.transport.upload(`${this.deps.baseUrl}/imports`, {
        'Content-Type': 'application/octet-stream',
        'Idempotency-Key': idempotencyKey,
        'X-File-Name': file.name,
      }, file);
      if (!this.awaitingJob(idempotencyKey)) return this.late('upload');
      this.deps.log('upload_response', { http: result.status });
      if (result.status === 202) return this.onJobKnown(idempotencyKey, JSON.parse(result.body));
      if (result.status >= 400 && result.status < 500) {
        await this.deps.transport.remove(file);
        return this.update({ phase: 'failed', file: undefined, error: `http_${result.status}` });
      }
    } catch {
      if (!this.awaitingJob(idempotencyKey)) return this.late('upload');
      this.deps.log('upload_unconfirmed');
    }
    await this.recover();
  }

  /** True while the operation that sent `key` still waits to learn its job. */
  private awaitingJob(key: string) {
    return this.state.idempotencyKey === key && (this.state.phase === 'uploading' || this.state.phase === 'unknown');
  }

  private async onJobKnown(key: string, view: JobView) {
    if (!this.awaitingJob(key)) return this.late('job_known');
    const { file } = this.state;
    await this.update({ phase: 'tracking', file: undefined, error: undefined });
    if (file) await this.deps.transport.remove(file);
    await this.apply(view);
    this.startPolling();
  }

  /** Revisions only move forward; anything else is a late or stale response. */
  private async apply(view: JobView) {
    const current = this.state.job;
    const newer = !current || (current.jobId === view.jobId && (
      view.revision > current.revision
      // Same revision after relaunch: the stored job has no report, the server body does.
      || (view.revision === current.revision && !current.items && !!view.items)
    ));
    if (!JOB_PHASES.includes(this.state.phase) || !newer) {
      this.deps.log('stale_ignored', { jobId: view.jobId, status: view.status, revision: view.revision });
      return;
    }
    this.deps.log('job_status', { jobId: view.jobId, status: view.status, revision: view.revision });
    const phase = view.status === 'deleted' ? 'deleted' : view.status === 'deleting' ? 'delete_pending' : this.state.phase;
    await this.update({ phase, job: view, error: undefined });
  }

  private late(request: string) {
    this.deps.log('late_ignored', { request });
  }

  private async request(url: string, init?: RequestInit) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      return await this.deps.fetchFn(url, { ...init, signal: abort.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private startPolling() {
    void this.poll();
  }

  private async poll() {
    const token = ++this.pollToken;
    while (token === this.pollToken && this.needsPolling()) {
      await new Promise(done => setTimeout(done, this.pollMs));
      if (token !== this.pollToken) return;
      await this.refresh();
    }
  }

  private needsPolling() {
    const status = this.state.job?.status;
    if (this.state.phase === 'tracking') return status === 'queued' || status === 'processing';
    return this.state.phase === 'delete_pending' && status === 'deleting';
  }

  /** State changes before the await so late responses already see the new phase. */
  private async update(patch: Partial<Operation>) {
    const next = { ...this.state, ...patch };
    if (next.phase === 'idle') {
      this.set(IDLE);
      await this.deps.store.save(null);
      return;
    }
    this.set(next);
    await this.deps.store.save(toStored(next));
  }

  private set(next: Operation) {
    this.state = next;
    this.listeners.forEach(listener => listener());
  }
}
