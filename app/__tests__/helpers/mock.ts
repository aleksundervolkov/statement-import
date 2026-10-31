import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const KIT_DIR = resolve(__dirname, '../../../kit');

export type MockStats = {
  createRequests: number;
  newJobs: number;
  duplicateHits: number;
  acceptedBytes: number;
  deleteRequests: number;
};

/** Runs the unmodified kit server in a child process with an isolated state file. */
export async function startMock() {
  const directory = mkdtempSync(join(tmpdir(), 'statement-import-mock-'));
  const serverUrl = pathToFileURL(join(KIT_DIR, 'mock-server.mjs')).href;
  const script = `
    const { createMockServer } = await import(${JSON.stringify(serverUrl)});
    const server = createMockServer({ statePath: ${JSON.stringify(join(directory, 'state.json'))} });
    server.listen(0, '127.0.0.1', () => console.log('PORT ' + server.address().port));
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise<number>((done, fail) => {
    child.once('exit', code => fail(new Error(`mock exited with ${code}`)));
    child.stdout.on('data', chunk => {
      const match = /PORT (\d+)/.exec(String(chunk));
      if (match) done(Number(match[1]));
    });
  });
  const base = `http://127.0.0.1:${port}`;

  return {
    base,
    async scenario(mode: 'happy' | 'lost_ack' | 'stale_status' | 'delete_failure') {
      const response = await fetch(`${base}/__test/scenario`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
      });
      if (response.status !== 200) throw new Error(`scenario ${mode}: ${response.status}`);
    },
    async stats(): Promise<MockStats> {
      return (await (await fetch(`${base}/__test/state`)).json()).stats;
    },
    async stop() {
      child.removeAllListeners('exit');
      await new Promise(done => { child.once('exit', done); child.kill(); });
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
