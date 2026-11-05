import type { DbHandle } from './db/index';
import { logsRepo } from './db/repos/logs';
import { LOG_CAPACITY, type LogSink } from './log';

/** Persisted ring in the `logs` store (spec delta D4). Written from extension pages only. */
export function createDbLogSink(db: DbHandle, capacity: number = LOG_CAPACITY): LogSink {
  const repo = logsRepo(db, capacity);
  return { append: repo.append, list: repo.list };
}
