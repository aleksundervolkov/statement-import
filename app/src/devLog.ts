import type { FileTransport, Logger } from './core/types';

export type LogTone = 'plain' | 'ok' | 'warn' | 'error' | 'pending';
export type LogEntry = { id: number; at: number; text: string; note?: string; tone: LogTone; repeat: number };

/** __DEV__ activity log: the app's own requests and decisions. Never file names or bytes. */
export const devLog = (() => {
  let entries: LogEntry[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  return {
    add(text: string, tone: LogTone = 'plain', note?: string) {
      const last = entries[entries.length - 1];
      if (last && last.text === text && last.note === note && last.tone === tone) {
        entries = [...entries.slice(0, -1), { ...last, at: Date.now(), repeat: last.repeat + 1 }];
        emit();
        return last.id;
      }
      const id = nextId++;
      entries = [...entries, { id, at: Date.now(), text, note, tone, repeat: 1 }].slice(-14);
      emit();
      return id;
    },
    update(id: number, text: string, tone: LogTone, note?: string) {
      const index = entries.findIndex(entry => entry.id === id);
      if (index < 0) return;
      const previous = entries[index - 1];
      if (index === entries.length - 1 && previous && previous.text === text && previous.note === note && previous.tone === tone) {
        entries = [...entries.slice(0, index - 1), { ...previous, at: Date.now(), repeat: previous.repeat + 1 }];
      } else {
        entries = entries.map(entry => (entry.id === id ? { ...entry, text, tone, note } : entry));
      }
      emit();
    },
    clear() {
      entries = [];
      emit();
    },
    get: () => entries,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
})();

/** `/imports/by-key/<uuid>` becomes `/imports/by-key/…1a2b` so the log fits a phone line. */
function shortPath(url: string) {
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  return path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, key => `…${key.slice(-4)}`);
}

function summarize(body: unknown) {
  if (!body || typeof body !== 'object') return undefined;
  const { status, revision, jobId } = body as Record<string, unknown>;
  if (typeof status !== 'string') return undefined;
  return `${jobId ?? 'job'} ${status}, revision ${revision}`;
}

function toneFor(http: number): LogTone {
  if (http >= 500) return 'error';
  if (http >= 400) return 'warn';
  return 'plain';
}

export function loggedFetch(fetchFn: typeof fetch): typeof fetch {
  if (!__DEV__) return fetchFn;
  return async (input, init) => {
    const line = `${init?.method ?? 'GET'} ${shortPath(String(input))}`;
    const id = devLog.add(line, 'pending', 'waiting…');
    try {
      const response = await fetchFn(input, init);
      const body = await response.clone().json().catch(() => undefined);
      devLog.update(id, line, toneFor(response.status), `${response.status}${summarize(body) ? ` · ${summarize(body)}` : ''}`);
      return response;
    } catch (error) {
      devLog.update(id, line, 'error', 'no response');
      throw error;
    }
  };
}

export function loggedTransport(transport: FileTransport): FileTransport {
  if (!__DEV__) return transport;
  return {
    exists: file => transport.exists(file),
    remove: file => transport.remove(file),
    async upload(url, headers, file) {
      const line = `POST ${shortPath(url)} · ${file.format.toUpperCase()}, ${file.size} B`;
      const id = devLog.add(line, 'pending', 'sending…');
      try {
        const result = await transport.upload(url, headers, file);
        let body: unknown;
        try { body = JSON.parse(result.body); } catch { body = undefined; }
        devLog.update(id, line, toneFor(result.status), `${result.status}${summarize(body) ? ` · ${summarize(body)}` : ''}`);
        return result;
      } catch (error) {
        devLog.update(id, line, 'error', 'no response');
        throw error;
      }
    },
  };
}

/** Turns the controller's decisions into readable lines. Plain request results come from the wrappers above. */
export function decisionLogger(shownRevision: () => number | undefined): Logger {
  return (event, data) => {
    if (!__DEV__) return;
    console.log('[import]', event, data ?? '');
    const shown = shownRevision();
    switch (event) {
      case 'upload_unconfirmed':
        return void devLog.add('Upload not confirmed. Asking the server by key, not sending again.', 'warn');
      case 'recovered_by_key':
        return void devLog.add('Server already has this upload. Same job, no duplicate.', 'ok');
      case 'recover_miss':
        return void devLog.add('Server has no job for this key yet. Waiting for the user.', 'warn');
      case 'recover_offline':
        return void devLog.add('Server not reachable while checking the key.', 'warn');
      case 'stale_ignored':
        if (shown === data?.revision) return;
        return void devLog.add(`Ignored ${data?.status}, revision ${data?.revision}: older than revision ${shown} on screen.`, 'ok');
      case 'delete_unconfirmed':
        return void devLog.add('Delete not confirmed. Screen does not say deleted.', 'warn');
      case 'delete_response':
        if (data?.http !== 202) devLog.add('Delete failed. Screen does not say deleted. Retry uses the same key.', 'warn');
        return;
      case 'restored':
        return void devLog.add(`App relaunched. Restored step: ${data?.phase}.`, 'plain');
      case 'late_ignored':
        return void devLog.add(`Ignored a late ${data?.request} response for an old operation.`, 'ok');
      default:
        return;
    }
  };
}
