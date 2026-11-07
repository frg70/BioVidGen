import { type DbHandle, unwrap } from '../index';
import type { SummaryRow } from '../schema';

/** Owner: summary/validate.ts (OP5V) only. */
export function summariesRepo(db: DbHandle) {
  const t = unwrap(db).summaries;
  return {
    get: (doi: string, pipelineVersion: string) => t.get([doi, pipelineVersion]),
    put: (row: SummaryRow) => t.put(row),
    latestByDoi: async (doi: string): Promise<SummaryRow | undefined> => (await t.where('doi').equals(doi).sortBy('createdAt')).at(-1),
    listRecent: (limit: number): Promise<SummaryRow[]> => t.orderBy('createdAt').reverse().limit(limit).toArray(),
  };
}
