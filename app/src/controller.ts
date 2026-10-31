import { randomUUID } from 'expo-crypto';
import { API_BASE_URL } from './config';
import { ImportController } from './core/importController';
import { decisionLogger, loggedFetch, loggedTransport } from './devLog';
import { nativeTransport, operationStore } from './native/files';

let instance: ImportController | undefined;

export const controller = new ImportController({
  baseUrl: API_BASE_URL,
  store: operationStore,
  transport: loggedTransport(nativeTransport),
  fetchFn: loggedFetch(fetch),
  newKey: randomUUID,
  log: decisionLogger(() => instance?.getState().job?.revision),
});
instance = controller;
