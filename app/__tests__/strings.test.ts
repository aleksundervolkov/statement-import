import { MAX_BYTES } from '../src/core/validate';
import { formatBytes } from '../src/ui/strings';

test('sizes use binary units, matching the 10 MiB limit text', () => {
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(1536)).toBe('1.5 KiB');
  expect(formatBytes(MAX_BYTES)).toBe('10.0 MiB');
});
