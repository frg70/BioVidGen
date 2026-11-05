import { SummarySchema, type ArticleText, type ProviderMeta, type Summary } from '../contracts/pipeline';
import type { DbHandle } from '../core/db';
import { summariesRepo } from '../core/db/repos/summaries';
import type { Logger } from '../core/log';
import { err, ok, type Result } from '../core/result';
import type { RunId } from '../core/runid';
import { validateDrafts, type Drafts } from './evidence';

/**
 * OP5V entry point and the only writer of Summary (CLAUDE.md rule 4, OP5V-SEC-01).
 * Validation itself is pure (evidence.ts); this file adds storage and the log entry.
 */

export interface ValidateDeps {
  db: DbHandle;
  log: Logger;
  now?: () => number;
}

export type ValidateCode = 'ALL_SECTIONS_FAILED' | 'STORE_FAILED';

export async function validateAndStore(
  deps: ValidateDeps,
  runId: RunId,
  doi: string,
  drafts: Drafts,
  text: ArticleText,
  meta: ProviderMeta,
): Promise<Result<Summary, ValidateCode>> {
  const now = deps.now ?? Date.now;
  const t0 = now();
  const { summary, counts, allFailed } = validateDrafts(doi, drafts, text, meta, new Date(t0).toISOString());
  const result: Result<Summary, ValidateCode> = allFailed ? err('ALL_SECTIONS_FAILED') : await store(deps.db, summary);
  await deps.log.event({
    runId,
    op: 'OP5V',
    durationMs: now() - t0,
    outcome: result.ok ? 'ok' : 'error',
    ...(result.ok ? {} : { errorCode: result.code }),
    provider: meta.provider,
    sizes: counts,
  });
  return result;
}

/** One put = one IndexedDB transaction: all or nothing. Retried once (blocked by an upgrading tab, OP5V-RES-01). */
async function store(db: DbHandle, summary: Summary): Promise<Result<Summary, 'STORE_FAILED'>> {
  const repo = summariesRepo(db);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await repo.put(summary);
      return ok(summary);
    } catch {
      // aborted transaction: nothing was written
    }
  }
  return err('STORE_FAILED');
}

const parse = (row: unknown): Summary | undefined => {
  const r = SummarySchema.safeParse(row);
  return r.success ? r.data : undefined;
};

export async function getSummary(db: DbHandle, doi: string, pipelineVersion: string): Promise<Summary | undefined> {
  return parse(await summariesRepo(db).get(doi, pipelineVersion));
}

export async function getLatestSummary(db: DbHandle, doi: string): Promise<Summary | undefined> {
  return parse(await summariesRepo(db).latestByDoi(doi));
}
