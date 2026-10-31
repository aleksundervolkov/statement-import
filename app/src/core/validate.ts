import type { FileFormat } from './types';

export const MAX_BYTES = 10 * 1024 * 1024;
export const HEAD_BYTES = 32;

const CSV_HEADER = 'date,description,amount\n';

export type Rejection = 'empty' | 'too_large' | 'unsupported_content' | 'unreadable';

/** Mirrors the server's byte check: PDF magic or the exact CSV header in the first 24 bytes. */
export function sniffFormat(head: Uint8Array): FileFormat | null {
  if (ascii(head.subarray(0, 5)) === '%PDF-') return 'pdf';
  if (ascii(head.subarray(0, 24)).replace(/\r/g, '').startsWith(CSV_HEADER)) return 'csv';
  return null;
}

export function checkSize(size: number | null | undefined): Rejection | null {
  if (size === 0) return 'empty';
  if (size != null && size > MAX_BYTES) return 'too_large';
  return null;
}

/** Size must come from file metadata; head is at most HEAD_BYTES read from the private copy. */
export function inspect(size: number, head: Uint8Array): { format: FileFormat } | { rejection: Rejection } {
  const sizeRejection = checkSize(size);
  if (sizeRejection) return { rejection: sizeRejection };
  const format = sniffFormat(head);
  return format ? { format } : { rejection: 'unsupported_content' };
}

function ascii(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}
