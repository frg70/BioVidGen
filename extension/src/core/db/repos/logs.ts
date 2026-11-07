import type { LogEntry } from '../../log';
import { type DbHandle, unwrap } from '../index';

/** Owner: core/log (SVC0). Ring of the newest `capacity` entries, trimmed on insert. */
export function logsRepo(db: DbHandle, capacity: number) {
  const d = unwrap(db);
  return {
    append: (entry: LogEntry): Promise<void> =>
      d.transaction('rw', d.logs, async () => {
        const { seq, ...row } = entry; // Dexie assigns ++seq
        void seq;
        await d.logs.add(row);
        const n = await d.logs.count();
        if (n > capacity) {
          const oldest = await d.logs.orderBy('seq').limit(n - capacity).primaryKeys();
          await d.logs.bulkDelete(oldest);
        }
      }),
    list: () => d.logs.orderBy('seq').toArray(),
    clear: () => d.logs.clear(),
  };
}
