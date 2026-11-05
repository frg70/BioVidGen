import { type DbHandle, unwrap } from '../index';
import type { StatusCheckRow } from '../schema';

/** Owner: scholarly (SVC2). */
export function statusChecksRepo(db: DbHandle) {
  const t = unwrap(db).status_checks;
  return {
    put: (row: StatusCheckRow) => t.put(row),
    /** Newest check for a DOI (ISO timestamps sort lexically; at most a few rows per DOI). */
    latest: async (doi: string): Promise<StatusCheckRow | undefined> => (await t.where('doi').equals(doi).sortBy('checkedAt')).at(-1),
  };
}
