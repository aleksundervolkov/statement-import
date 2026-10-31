import { checkSize, HEAD_BYTES, inspect, type Rejection } from './validate';
import type { StagedFile } from './types';

/** What the system picker reported. `size` is metadata and may be missing. */
export type PickedFile = { uri: string; name: string; size: number | null };

export interface FileIo {
  /** Native copy into app-private storage; never loads the file into JS memory. */
  copyToPrivate(uri: string): Promise<{ uri: string; size: number }>;
  readHead(uri: string, length: number): Promise<Uint8Array>;
  remove(uri: string): Promise<void>;
}

export async function prepareFile(picked: PickedFile, io: FileIo): Promise<{ file: StagedFile } | { rejection: Rejection }> {
  const early = checkSize(picked.size);
  if (early) return { rejection: early };

  const copy = await io.copyToPrivate(picked.uri);
  try {
    const result = inspect(copy.size, await io.readHead(copy.uri, HEAD_BYTES));
    if ('rejection' in result) {
      await io.remove(copy.uri);
      return result;
    }
    return { file: { uri: copy.uri, name: picked.name, size: copy.size, format: result.format } };
  } catch (error) {
    await io.remove(copy.uri);
    throw error;
  }
}
