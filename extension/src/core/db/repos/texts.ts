import { type DbHandle, unwrap } from '../index';
import type { TextRow } from '../schema';

/** Owner: text (SVC3). Pinned texts only; session texts stay in memory. */
export function textsRepo(db: DbHandle) {
  const t = unwrap(db).texts;
  return {
    get: (doi: string, contentHash: string) => t.get([doi, contentHash]),
    put: (row: TextRow) => t.put(row),
    remove: (doi: string, contentHash: string) => t.delete([doi, contentHash]),
  };
}
