import Dexie, { type Table } from 'dexie';
import type { LogEntry } from '../log';

/**
 * IndexedDB `biovidgen`, schema v1 (SVC0 plan §2). Private to core/db: modules use their
 * repository (core/db/repos/*), enforced by eslint-rules/boundaries.js (SYS-SEC-26).
 * Row types stay open until the entity contracts land in src/contracts (OP1+).
 */
export const DB_NAME = 'biovidgen';
export const DB_VERSION = 1;

export const STORES_V1 = {
  articles: 'doi, fetchedAt',
  status_checks: '[doi+checkedAt], doi',
  texts: '[doi+contentHash], doi',
  summaries: '[doi+pipelineVersion], doi, createdAt',
  feedback: '++id, summaryKey',
  logs: '++seq, runId, at',
} as const;

type Row = Record<string, unknown>;
export type ArticleRow = Row & { doi: string; fetchedAt: string };
export type StatusCheckRow = Row & { doi: string; checkedAt: string };
export type TextRow = Row & { doi: string; contentHash: string };
export type SummaryRow = Row & { doi: string; pipelineVersion: string; createdAt: string };
export type FeedbackRow = Row & { id?: number; summaryKey: string };
export type LogRow = LogEntry;

export type DexieOptions = ConstructorParameters<typeof Dexie>[1];

export class BioVidGenDb extends Dexie {
  articles!: Table<ArticleRow, string>;
  status_checks!: Table<StatusCheckRow, [string, string]>;
  texts!: Table<TextRow, [string, string]>;
  summaries!: Table<SummaryRow, [string, string]>;
  feedback!: Table<FeedbackRow, number>;
  logs!: Table<LogRow, number>;

  constructor(name: string = DB_NAME, options?: DexieOptions) {
    super(name, options);
    this.version(DB_VERSION).stores(STORES_V1);
  }
}
