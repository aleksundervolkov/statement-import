import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HEAD_BYTES, MAX_BYTES, inspect } from '../src/core/validate';
import { KIT_DIR } from './helpers/mock';

const fixture = (name: string) => readFileSync(join(KIT_DIR, 'fixtures', name));
const head = (bytes: Uint8Array) => bytes.subarray(0, HEAD_BYTES);

test('accepts statement.csv and statement.pdf by content', () => {
  const csv = fixture('statement.csv');
  const pdf = fixture('statement.pdf');
  expect(inspect(csv.length, head(csv))).toEqual({ format: 'csv' });
  expect(inspect(pdf.length, head(pdf))).toEqual({ format: 'pdf' });
});

test('rejects spoofed.pdf despite the extension', () => {
  const spoofed = fixture('spoofed.pdf');
  expect(inspect(spoofed.length, head(spoofed))).toEqual({ rejection: 'unsupported_content' });
});

test('rejects files over 10 MiB before looking at content', () => {
  const csv = fixture('statement.csv');
  expect(inspect(MAX_BYTES + 1, head(csv))).toEqual({ rejection: 'too_large' });
  expect(inspect(MAX_BYTES, head(csv))).toEqual({ format: 'csv' });
});

test('rejects empty files', () => {
  expect(inspect(0, new Uint8Array())).toEqual({ rejection: 'empty' });
});
