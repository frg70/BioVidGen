import { type DbHandle, unwrap } from '../index';
import type { ArticleRow } from '../schema';

/** Owner: scholarly (SVC2). */
export function articlesRepo(db: DbHandle) {
  const t = unwrap(db).articles;
  return {
    get: (doi: string) => t.get(doi),
    bulkGet: (dois: string[]) => t.bulkGet(dois),
    put: (row: ArticleRow) => t.put(row),
  };
}
