import { type DbHandle, unwrap } from '../index';
import type { FeedbackRow } from '../schema';

/** Owner: workspace (SVC5). */
export function feedbackRepo(db: DbHandle) {
  const t = unwrap(db).feedback;
  return {
    add: (row: FeedbackRow) => t.add(row),
    bySummaryKey: (summaryKey: string) => t.where('summaryKey').equals(summaryKey).toArray(),
    all: () => t.toArray(),
  };
}
