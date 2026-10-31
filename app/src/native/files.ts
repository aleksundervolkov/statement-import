import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import {
  cacheDirectory, copyAsync, getInfoAsync, makeDirectoryAsync, readAsStringAsync,
  FileSystemSessionType, FileSystemUploadType, uploadAsync,
} from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import type { FileIo, PickedFile } from '../core/prepare';
import type { FileTransport, OperationStore, StoredOperation } from '../core/types';

/** App-private, not backed up (Library/Caches on iOS, cacheDir on Android). */
const stagingDir = () => new Directory(Paths.cache, 'statement-staging');
/** Keys and job metadata only (see StoredOperation). Must survive a cache purge, so not in cache. */
const operationFile = () => new File(Paths.document, 'import-operation.json');

/** Copies the picker makes for us: Android cache/DocumentPicker, iOS tmp/<bundle>-Inbox. */
const PICKER_COPY = /\/(cache|Caches)\/DocumentPicker\/|\/tmp\/[^/]+-Inbox\//;

function pickerCopyDirs(): Directory[] {
  const dirs = [new Directory(Paths.cache, 'DocumentPicker')];
  if (Platform.OS === 'ios') {
    const tmp = new Directory(Paths.document.parentDirectory, 'tmp');
    if (tmp.exists) {
      dirs.push(...tmp.list().filter((entry): entry is Directory => entry instanceof Directory && entry.name.endsWith('-Inbox')));
    }
  }
  return dirs;
}

export async function pickStatement(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'text/csv', 'text/comma-separated-values'],
    // iOS: skip the extra copy; we stage ourselves. Android: SAF content://
    // is not readable until the picker copies it into the app cache.
    copyToCacheDirectory: Platform.OS === 'android',
    multiple: false,
  });
  if (result.canceled) return null;
  const [asset] = result.assets;
  return { uri: asset.uri, name: asset.name, size: asset.size ?? null };
}

/** Deletes the picker's own copy on both platforms; never touches the user's original. */
export function releasePicked(picked: PickedFile) {
  if (!picked.uri.startsWith('file://') || !PICKER_COPY.test(picked.uri)) return;
  const file = new File(picked.uri);
  if (file.exists) file.delete();
}

export const fileIo: FileIo = {
  async copyToPrivate(uri) {
    const dirUri = `${cacheDirectory}statement-staging/`;
    await makeDirectoryAsync(dirUri, { intermediates: true }).catch(() => undefined);
    const dest = `${dirUri}${randomUUID()}.bin`;
    await copyAsync({ from: uri, to: dest });
    const info = await getInfoAsync(dest);
    return { uri: dest, size: info.exists ? info.size ?? 0 : 0 };
  },
  async readHead(uri, length) {
    const b64 = await readAsStringAsync(uri, { encoding: 'base64', position: 0, length });
    const binary = globalThis.atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  },
  async remove(uri) {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
};

/**
 * Deletes copies left by a crash: staged copies except the one the saved operation still needs,
 * and every picker copy (none is needed once a pick has been checked).
 */
export function removeOrphanCopies(keepUri: string | undefined) {
  for (const directory of [stagingDir(), ...pickerCopyDirs()]) {
    if (!directory.exists) continue;
    for (const entry of directory.list()) {
      if (entry instanceof File && entry.uri !== keepUri) entry.delete();
    }
  }
}

export const nativeTransport: FileTransport = {
  async upload(url, headers, file) {
    const result = await uploadAsync(url, file.uri, {
      httpMethod: 'POST',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      sessionType: FileSystemSessionType.FOREGROUND,
      headers,
    });
    return { status: result.status, body: result.body };
  },
  async exists(file) {
    return new File(file.uri).exists;
  },
  async remove(file) {
    await fileIo.remove(file.uri);
  },
};

export const operationStore: OperationStore = {
  async load() {
    const file = operationFile();
    if (!file.exists) return null;
    try {
      return JSON.parse(await file.text()) as StoredOperation;
    } catch {
      return null;
    }
  },
  async save(operation) {
    const file = operationFile();
    if (operation) file.write(JSON.stringify(operation));
    else if (file.exists) file.delete();
  },
};
