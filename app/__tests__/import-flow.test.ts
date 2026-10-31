/**
 * @jest-environment node
 */
import { closeSync, copyFileSync, existsSync, mkdtempSync, openSync, readdirSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareFile, type FileIo } from '../src/core/prepare';
import { MAX_BYTES } from '../src/core/validate';
import { monthlyTotalMinor } from '../src/core/money';
import type { StagedFile } from '../src/core/types';
import { createHarness, holdFetch, MemoryStore, waitFor } from './helpers/fakes';
import { KIT_DIR, startMock } from './helpers/mock';

let mock: Awaited<ReturnType<typeof startMock>>;
let workDir: string;
const controllers: { dispose(): void }[] = [];

beforeEach(async () => {
  mock = await startMock();
  workDir = mkdtempSync(join(tmpdir(), 'statement-import-files-'));
});
afterEach(async () => {
  controllers.splice(0).forEach(controller => controller.dispose());
  await mock.stop();
  rmSync(workDir, { recursive: true, force: true });
});

function staged(fixture: 'statement.csv' | 'statement.pdf'): StagedFile {
  const uri = join(workDir, `staged-${fixture}`);
  copyFileSync(join(KIT_DIR, 'fixtures', fixture), uri);
  return { uri, name: fixture, size: statSync(uri).size, format: fixture.endsWith('.pdf') ? 'pdf' : 'csv' };
}

function harness(options?: Parameters<typeof createHarness>[1]) {
  const result = createHarness(mock.base, options);
  controllers.push(result.controller);
  return result;
}

const state = (h: ReturnType<typeof harness>) => h.controller.getState();

test('persists key before POST', async () => {
  const h = harness();
  h.controller.stage(staged('statement.csv'));
  await h.controller.upload();
  const [{ headers, storeAtSend }] = h.transport.uploads;
  expect(storeAtSend?.phase).toBe('uploading');
  expect(storeAtSend?.idempotencyKey).toBe(headers['Idempotency-Key']);
  expect(headers['Content-Type']).toBe('application/octet-stream');
});

test('happy: real bytes sent, 202 is not a report, ready shows mock data', async () => {
  const h = harness();
  const file = staged('statement.pdf');
  h.controller.stage(file);
  await h.controller.upload();
  expect(state(h).phase).toBe('tracking');
  expect(state(h).job?.status).toBe('queued');
  expect(state(h).job?.items).toBeUndefined();
  expect(existsSync(file.uri)).toBe(false);

  await waitFor(() => state(h).job?.status === 'ready');
  const job = state(h).job!;
  expect(job.revision).toBe(3);
  expect(job.currency).toBe('AUD');
  expect(job.items?.map(item => item.merchant)).toEqual(['StreamBeam', 'BrightGrid']);
  expect(monthlyTotalMinor(job.items!)).toBe(15199);
  expect(await mock.stats()).toMatchObject({ createRequests: 1, newJobs: 1, acceptedBytes: file.size });
});

test('lost_ack: one job, recovered by key, relaunch does not resend', async () => {
  await mock.scenario('lost_ack');
  const first = harness();
  first.controller.stage(staged('statement.csv'));
  await first.controller.upload();
  expect(state(first).phase).toBe('tracking');
  const jobId = state(first).job?.jobId;
  expect(jobId).toBe('job-demo-001');

  const relaunchStore = new MemoryStore();
  relaunchStore.value = first.transport.uploads[0].storeAtSend;
  const relaunched = harness({ store: relaunchStore });
  await relaunched.controller.restore();
  expect(state(relaunched).job?.jobId).toBe(jobId);
  await waitFor(() => state(relaunched).job?.status === 'ready');
  expect(relaunched.transport.uploads).toHaveLength(0);
  expect(await mock.stats()).toMatchObject({ createRequests: 1, newJobs: 1, duplicateHits: 0 });
});

test('manual retry after unconfirmed POST reuses key and yields the same job', async () => {
  await mock.scenario('lost_ack');
  let byKeyDown = true;
  const flakyFetch: typeof fetch = (input, init) =>
    byKeyDown && String(input).includes('/by-key/') ? Promise.reject(new TypeError('offline')) : fetch(input, init);
  const h = harness({ fetchFn: flakyFetch });
  h.controller.stage(staged('statement.csv'));
  await h.controller.upload();
  expect(state(h).phase).toBe('unknown');
  expect(state(h).file).toBeDefined();

  byKeyDown = false;
  await h.controller.retryUpload();
  expect(state(h).phase).toBe('tracking');
  expect(h.transport.uploads.map(u => u.headers['Idempotency-Key'])).toEqual([
    h.transport.uploads[0].headers['Idempotency-Key'], h.transport.uploads[0].headers['Idempotency-Key'],
  ]);
  expect(await mock.stats()).toMatchObject({ createRequests: 2, newJobs: 1, duplicateHits: 1 });
});

test('Check again racing the launch recover: one job, the copy removed once', async () => {
  await mock.scenario('lost_ack');
  let byKeyDown = true;
  const flakyFetch: typeof fetch = (input, init) =>
    byKeyDown && String(input).includes('/by-key/') ? Promise.reject(new TypeError('offline')) : fetch(input, init);
  const h = harness({ fetchFn: flakyFetch });
  h.controller.stage(staged('statement.csv'));
  await h.controller.upload();
  expect(state(h).phase).toBe('unknown');

  byKeyDown = false;
  await Promise.all([h.controller.recover(), h.controller.recover()]);
  expect(state(h).phase).toBe('tracking');
  expect(h.transport.removed).toHaveLength(1);
  expect(h.logs.filter(entry => (entry as [string])[0] === 'job_status')).toHaveLength(1);
});

test('relaunch with an unsent key: 404 by key, no automatic POST', async () => {
  const store = new MemoryStore();
  const { name: _name, ...storedFile } = staged('statement.csv');
  store.value = { phase: 'uploading', idempotencyKey: 'never-sent-key-001', file: storedFile };
  const h = harness({ store });
  await h.controller.restore();
  expect(state(h).phase).toBe('unknown');
  expect(h.transport.uploads).toHaveLength(0);
  expect(await mock.stats()).toMatchObject({ createRequests: 0, newJobs: 0 });

  await h.controller.retryUpload();
  expect(state(h).phase).toBe('tracking');
  expect(h.transport.uploads[0].headers).toMatchObject({ 'Idempotency-Key': 'never-sent-key-001', 'X-File-Name': 'statement.csv' });
  expect(await mock.stats()).toMatchObject({ createRequests: 1, newJobs: 1 });
});

test('discard during an in-flight recover does not resurrect the job', async () => {
  await mock.scenario('lost_ack');
  const held = holdFetch(url => url.includes('/by-key/'));
  const h = harness({ fetchFn: held.fetchFn });
  h.controller.stage(staged('statement.csv'));
  const pending = h.controller.upload();
  await held.reached;
  await h.controller.discard();
  const next = staged('statement.pdf');
  h.controller.stage(next);
  held.release();
  await pending;
  expect(state(h).phase).toBe('confirm');
  expect(state(h).file?.uri).toBe(next.uri);
  expect(state(h).job).toBeUndefined();
  expect(h.store.value).toBeNull();
});

test('late by-key 404 does not overwrite a newly staged file', async () => {
  const store = new MemoryStore();
  store.value = { phase: 'unknown', idempotencyKey: 'never-sent-key-002' };
  const held = holdFetch(url => url.includes('/by-key/'));
  const h = harness({ store, fetchFn: held.fetchFn });
  const pending = h.controller.restore();
  await held.reached;
  await h.controller.discard();
  const next = staged('statement.csv');
  h.controller.stage(next);
  held.release();
  await pending;
  expect(state(h)).toEqual({ phase: 'confirm', file: next });
});

test('a hanging request times out instead of waiting forever', async () => {
  const store = new MemoryStore();
  store.value = { phase: 'unknown', idempotencyKey: 'never-sent-key-003' };
  const hanging: typeof fetch = (_input, init) => new Promise((_done, fail) => {
    init?.signal?.addEventListener('abort', () => fail(new Error('aborted')));
  });
  const h = harness({ store, fetchFn: hanging, timeoutMs: 100 });
  const outcome = await Promise.race([
    h.controller.restore().then(() => 'settled'),
    new Promise(done => setTimeout(() => done('hung'), 2000)),
  ]);
  expect(outcome).toBe('settled');
  expect(state(h)).toMatchObject({ phase: 'unknown', error: 'offline' });
});

test('stored operation keeps no file name or report; relaunch fetches the report again', async () => {
  const h = harness();
  h.controller.stage(staged('statement.csv'));
  await h.controller.upload();
  expect(h.transport.uploads[0].storeAtSend?.file).not.toHaveProperty('name');
  await waitFor(() => state(h).job?.status === 'ready');
  expect(h.store.value?.job).toEqual({ jobId: state(h).job?.jobId, status: 'ready', revision: 3 });
  expect(JSON.stringify(h.store.value)).not.toMatch(/StreamBeam|BrightGrid|AUD/);

  const relaunchStore = new MemoryStore();
  relaunchStore.value = h.store.value;
  const relaunched = harness({ store: relaunchStore });
  await relaunched.controller.restore();
  expect(state(relaunched).job?.items?.map(item => item.merchant)).toEqual(['StreamBeam', 'BrightGrid']);
  expect(state(relaunched).job?.revision).toBe(3);
});

test('stale_status: processing/r2 after ready/r3 does not roll back', async () => {
  await mock.scenario('stale_status');
  const h = harness();
  h.controller.stage(staged('statement.csv'));
  await h.controller.upload();
  await waitFor(() => state(h).job?.status === 'ready');
  await h.controller.refresh();
  expect(state(h).job).toMatchObject({ status: 'ready', revision: 3 });
  expect(state(h).job?.items).toHaveLength(2);
  expect(h.logs).toContainEqual(['stale_ignored', expect.objectContaining({ revision: 2 })]);
});

async function readyImport() {
  const h = harness();
  h.controller.stage(staged('statement.csv'));
  await h.controller.upload();
  await waitFor(() => state(h).job?.status === 'ready');
  return h;
}

test('delete_failure: 503 is not deletion; retry with same key reaches deleted', async () => {
  const h = await readyImport();
  await mock.scenario('delete_failure');
  await h.controller.remove();
  expect(state(h).phase).toBe('delete_failed');
  expect(state(h).job?.status).toBe('ready');
  const deleteKey = state(h).deleteKey;
  expect(h.store.value?.deleteKey).toBe(deleteKey);

  await mock.scenario('happy');
  await h.controller.remove();
  expect(state(h).deleteKey).toBe(deleteKey);
  expect(state(h).phase).toBe('delete_pending');
  await waitFor(() => state(h).phase === 'deleted');
  expect(state(h).job).toMatchObject({ status: 'deleted', revision: 5 });
  expect(await mock.stats()).toMatchObject({ deleteRequests: 2 });
});

test('late response does not resurrect a deleted job', async () => {
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  let holdNextGet = false;
  const gatedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (holdNextGet && (init?.method ?? 'GET') === 'GET') { holdNextGet = false; await gate; }
    return response;
  };
  const h = harness({ fetchFn: gatedFetch });
  h.controller.stage(staged('statement.csv'));
  await h.controller.upload();
  await waitFor(() => state(h).job?.status === 'ready');

  holdNextGet = true;
  const late = h.controller.refresh();
  await h.controller.remove();
  await waitFor(() => state(h).phase === 'deleted');
  release();
  await late;
  expect(state(h).phase).toBe('deleted');
  expect(state(h).job?.status).toBe('deleted');
});

test('late 404 after deleted does not turn Deleted into failed', async () => {
  let armed = false;
  const held = holdFetch(
    (url, method) => armed && method === 'GET' && /\/imports\/job-/.test(url),
    () => new Response(JSON.stringify({ error: 'job not found' }), { status: 404 }),
  );
  const h = harness({ fetchFn: held.fetchFn });
  h.controller.stage(staged('statement.csv'));
  await h.controller.upload();
  await waitFor(() => state(h).job?.status === 'ready');

  armed = true;
  const late = h.controller.refresh();
  await held.reached;
  await h.controller.remove();
  await waitFor(() => state(h).phase === 'deleted');
  held.release();
  await late;
  expect(state(h).phase).toBe('deleted');
  expect(state(h).error).toBeUndefined();
});

test('lost DELETE response: deletion not confirmed, retry with the same key reaches deleted', async () => {
  let loseNext = true;
  const lossy: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (loseNext && init?.method === 'DELETE') { loseNext = false; throw new TypeError('connection reset'); }
    return response;
  };
  const h = harness({ fetchFn: lossy });
  h.controller.stage(staged('statement.csv'));
  await h.controller.upload();
  await waitFor(() => state(h).job?.status === 'ready');

  await h.controller.remove();
  expect(state(h)).toMatchObject({ phase: 'delete_failed', error: 'delete_unconfirmed' });
  const deleteKey = state(h).deleteKey;
  expect(h.store.value?.deleteKey).toBe(deleteKey);
  await h.controller.remove();
  expect(state(h).deleteKey).toBe(deleteKey);
  await waitFor(() => state(h).phase === 'deleted');
  expect(await mock.stats()).toMatchObject({ deleteRequests: 2 });
});

test('DELETE body alone does not mark deleted; the following GET decides', async () => {
  const fakeDelete: typeof fetch = async (input, init) => {
    if (init?.method !== 'DELETE') return fetch(input, init);
    const jobId = String(input).split('/').pop();
    return new Response(JSON.stringify({ jobId, status: 'deleted', revision: 5 }), { status: 202 });
  };
  const h = harness({ fetchFn: fakeDelete });
  h.controller.stage(staged('statement.csv'));
  await h.controller.upload();
  await waitFor(() => state(h).job?.status === 'ready');

  await h.controller.remove();
  expect(state(h)).toMatchObject({ phase: 'delete_failed', error: 'delete_not_confirmed' });
  expect(state(h).job?.status).toBe('ready');
});

test('DELETE 404: server has no record, a distinct state', async () => {
  const wrongId: typeof fetch = (input, init) =>
    fetch(init?.method === 'DELETE' ? String(input).replace(/job-demo-\d+$/, 'job-demo-999') : input, init);
  const h = harness({ fetchFn: wrongId });
  h.controller.stage(staged('statement.csv'));
  await h.controller.upload();
  await waitFor(() => state(h).job?.status === 'ready');

  await h.controller.remove();
  expect(state(h).phase).toBe('not_on_server');
  expect(h.store.value?.phase).toBe('not_on_server');
});

const nodeIo = (dir: string): FileIo => ({
  async copyToPrivate(uri) {
    const target = join(dir, `copy-${Date.now()}`);
    copyFileSync(uri, target);
    return { uri: target, size: statSync(target).size };
  },
  async readHead(uri, length) {
    const fd = openSync(uri, 'r');
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, 0);
    closeSync(fd);
    return new Uint8Array(buffer.subarray(0, read));
  },
  async remove(uri) { rmSync(uri, { force: true }); },
});

test('rejects spoofed and oversize files before POST', async () => {
  const before = await mock.stats();
  const oversize = join(workDir, 'oversize.csv');
  writeFileSync(oversize, Buffer.alloc(MAX_BYTES + 1, 65));
  const io = nodeIo(workDir);
  const copySpy = jest.spyOn(io, 'copyToPrivate');

  const spoofed = await prepareFile({ uri: join(KIT_DIR, 'fixtures', 'spoofed.pdf'), name: 'spoofed.pdf', size: null }, io);
  expect(spoofed).toEqual({ rejection: 'unsupported_content' });
  const big = await prepareFile({ uri: oversize, name: 'oversize.csv', size: MAX_BYTES + 1 }, io);
  expect(big).toEqual({ rejection: 'too_large' });
  const bigUnknownSize = await prepareFile({ uri: oversize, name: 'oversize.csv', size: null }, io);
  expect(bigUnknownSize).toEqual({ rejection: 'too_large' });

  expect(copySpy).toHaveBeenCalledTimes(2);
  expect(await mock.stats()).toEqual(before);
  expect(readdirSync(workDir).filter(name => name.startsWith('copy-'))).toEqual([]);
});

test('logs never contain file names, bytes or transaction text', async () => {
  await mock.scenario('lost_ack');
  const h = harness();
  h.controller.stage(staged('statement.csv'));
  await h.controller.upload();
  await waitFor(() => state(h).job?.status === 'ready');
  await h.controller.remove();
  await waitFor(() => state(h).phase === 'deleted');
  const text = JSON.stringify(h.logs);
  expect(h.logs.length).toBeGreaterThan(0);
  for (const secret of ['statement', 'StreamBeam', 'BrightGrid', 'date,description', '%PDF']) {
    expect(text).not.toContain(secret);
  }
});
