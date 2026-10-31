import type { Rejection } from '../core/validate';

export const rejectionText: Record<Rejection, string> = {
  empty: 'This file is empty.',
  too_large: 'This file is larger than 10 MiB. Choose a smaller statement.',
  unsupported_content: 'This file is not a PDF or CSV statement, whatever its name says.',
  unreadable: 'The app could not read this file from the system picker.',
};

const errorText: Record<string, string> = {
  offline: 'Can’t reach the server. Check the connection and try again.',
  not_found_yet: 'The server has no record of this upload yet.',
  local_copy_missing: 'The app’s private copy of the file is gone. Start over and choose the file again.',
  job_missing: 'The server no longer knows this import.',
  delete_not_confirmed: 'The server has not confirmed the deletion request.',
  delete_unconfirmed: 'The connection dropped before the server answered. The import may or may not be deleted. Retry sends the same request again.',
  http_409: 'The server rejected the upload: this key was already used for another file.',
  http_413: 'The server rejected the file as too large.',
  http_415: 'The server rejected the file content.',
  http_503: 'The server is temporarily unavailable.',
};

export function describeError(code: string | undefined): string | null {
  if (!code) return null;
  return errorText[code] ?? `Unexpected server response (${code.replace('http_', 'HTTP ')}).`;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / 1024 / 1024).toFixed(1)} MiB`;
}
