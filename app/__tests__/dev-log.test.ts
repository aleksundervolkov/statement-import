/**
 * @jest-environment node
 */
import { copyFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImportController } from '../src/core/importController';
import { decisionLogger, devLog, loggedFetch, loggedTransport } from '../src/devLog';
import { MemoryStore, NodeFileTransport, waitFor } from './helpers/fakes';
import { KIT_DIR, startMock } from './helpers/mock';

(globalThis as { __DEV__?: boolean }).__DEV__ = true;

let mock: Awaited<ReturnType<typeof startMock>>;
let workDir: string;
let controller: ImportController | undefined;

beforeEach(async () => {
  mock = await startMock();
  workDir = mkdtempSync(join(tmpdir(), 'statement-import-log-'));
  devLog.clear();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(async () => {
  controller?.dispose();
  await mock.stop();
  rmSync(workDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

function start(store = new MemoryStore()) {
  let current: ImportController | undefined;
  current = new ImportController({
    baseUrl: mock.base,
    store,
    transport: loggedTransport(new NodeFileTransport(store)),
    fetchFn: loggedFetch(fetch),
    newKey: () => randomUUID(),
    log: decisionLogger(() => current?.getState().job?.revision),
    pollMs: 50,
  });
  controller = current;
  const uri = join(workDir, 'staged.csv');
  copyFileSync(join(KIT_DIR, 'fixtures', 'statement.csv'), uri);
  current.stage({ uri, name: 'statement.csv', size: statSync(uri).size, format: 'csv' });
  return current;
}

const lines = () => devLog.get().map(entry => `${entry.text} | ${entry.note ?? ''}`);

test('lost_ack log shows the lost POST, the by-key GET and the no-duplicate decision', async () => {
  await mock.scenario('lost_ack');
  const app = start();
  await app.upload();
  const log = lines();
  expect(log[0]).toMatch(/^POST \/imports · CSV, \d+ B \| no response$/);
  expect(log[1]).toMatch(/Upload not confirmed/);
  expect(log[2]).toMatch(/^GET \/imports\/by-key\/…\w{4} \| 200 · job-demo-001 queued, revision 1$/);
  expect(log[3]).toMatch(/Same job, no duplicate/);
  expect(log.join('\n')).not.toMatch(/statement\.csv/);
});

test('delete_failure log shows the 503 and the retry that reaches deleted', async () => {
  const app = start();
  await app.upload();
  await waitFor(() => app.getState().job?.status === 'ready');
  await mock.scenario('delete_failure');
  await app.remove();
  expect(lines()).toContainEqual(expect.stringMatching(/^DELETE \/imports\/job-demo-001 \| 503$/));
  expect(lines()).toContainEqual(expect.stringMatching(/^Delete failed\. Screen does not say deleted\./));
  await mock.scenario('happy');
  await app.remove();
  await waitFor(() => app.getState().phase === 'deleted');
  expect(lines()).toContainEqual(expect.stringMatching(/^DELETE \/imports\/job-demo-001 \| 202 · job-demo-001 deleting, revision 4$/));
  expect(lines()).toContainEqual(expect.stringMatching(/^GET \/imports\/job-demo-001 \| 200 · job-demo-001 deleted, revision 5$/));
});

test('stale_status log names the ignored older revision', async () => {
  await mock.scenario('stale_status');
  const app = start();
  await app.upload();
  await waitFor(() => app.getState().job?.status === 'ready');
  await app.refresh();
  expect(lines()).toContainEqual(expect.stringMatching(/processing, revision 2 \| 200|200 · job-demo-001 processing, revision 2/));
  expect(lines()).toContainEqual(expect.stringMatching(/^Ignored processing, revision 2: older than revision 3 on screen\./));
});
