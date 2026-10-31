export type FileFormat = 'pdf' | 'csv';

export type JobStatus = 'queued' | 'processing' | 'ready' | 'deleting' | 'deleted';

export type RecurringItem = {
  id: string;
  merchant: string;
  amountMinor: number;
  cadence: string;
  lastSeen: string;
};

export type JobView = {
  jobId: string;
  status: JobStatus;
  revision: number;
  currency?: string;
  items?: RecurringItem[];
};

/** Private app-owned copy of the picked file. */
export type StagedFile = {
  uri: string;
  name: string;
  size: number;
  format: FileFormat;
};

export type Phase =
  | 'idle'
  | 'confirm'
  | 'uploading'
  | 'unknown'
  | 'tracking'
  | 'delete_pending'
  | 'delete_failed'
  | 'deleted'
  | 'not_on_server'
  | 'failed';

export type Operation = {
  phase: Phase;
  file?: StagedFile;
  idempotencyKey?: string;
  job?: JobView;
  deleteKey?: string;
  error?: string;
};

/** What survives a relaunch: keys and job metadata only. No file name, no report. */
export type StoredOperation = Omit<Operation, 'file' | 'job'> & {
  file?: Omit<StagedFile, 'name'>;
  job?: Pick<JobView, 'jobId' | 'status' | 'revision'>;
};

export type HttpResult = { status: number; body: string };

export interface OperationStore {
  load(): Promise<StoredOperation | null>;
  save(operation: StoredOperation | null): Promise<void>;
}

export interface FileTransport {
  /** Streams the staged file bytes as the request body. Rejects on network failure. */
  upload(url: string, headers: Record<string, string>, file: StagedFile): Promise<HttpResult>;
  exists(file: StagedFile): Promise<boolean>;
  remove(file: StagedFile): Promise<void>;
}

/** Only event names and job metadata; never file names, bytes or transaction text. */
export type Logger = (event: string, data?: Record<string, string | number>) => void;
