import { z } from 'zod';
import type { Result } from './result';
import { RUN_ID_PATTERN, isRunId, newRunId, type RunId } from './runid';

/**
 * Log entry whitelist (SVC0 plan §8). No free-text field exists, so article content cannot
 * enter the log. Strict: any other key is rejected (SYS-OBS-02).
 */
export const LogEntrySchema = z.strictObject({
  seq: z.number().int().nonnegative().optional(),
  at: z.iso.datetime(),
  runId: z.string().regex(RUN_ID_PATTERN),
  op: z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/),
  durationMs: z.number().nonnegative(),
  outcome: z.enum(['ok', 'error', 'aborted']),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/).optional(),
  provider: z.string().regex(/^[a-z0-9_.-]{1,40}$/).optional(),
  calls: z.number().int().nonnegative().optional(),
  sizes: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/), z.number().int().nonnegative()).optional(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;
export type LogMeta = Pick<LogEntry, 'provider' | 'calls' | 'sizes'>;

export const LOG_CAPACITY = 200;

export interface LogSink {
  append(entry: LogEntry): Promise<void>;
  list(): Promise<LogEntry[]>;
}

/** In-memory ring (memory-only mode and tests). Keeps the newest `capacity` entries. */
export function createMemorySink(capacity: number = LOG_CAPACITY): LogSink {
  const ring: LogEntry[] = [];
  let seq = 0;
  return {
    async append(entry) {
      ring.push({ ...entry, seq: ++seq });
      if (ring.length > capacity) ring.splice(0, ring.length - capacity);
    },
    async list() {
      return [...ring];
    },
  };
}

export interface Logger {
  /**
   * Runs `fn`, then appends one entry with timing and outcome. Never throws because of
   * logging; rethrows what `fn` throws (logged as UNCAUGHT, or `aborted` for AbortError).
   */
  op<T, C extends string>(runId: RunId, op: string, fn: () => Promise<Result<T, C>>, meta?: LogMeta): Promise<Result<T, C>>;
  /** Appends a pre-built event (e.g. BAD_MESSAGE). An invalid entry is replaced by BAD_LOG_ENTRY. */
  event(entry: Omit<LogEntry, 'at' | 'seq'>): Promise<void>;
}

const isAbort = (e: unknown) => typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';

export function createLogger(sink: LogSink, now: () => number = Date.now): Logger {
  async function write(candidate: Record<string, unknown>): Promise<void> {
    const parsed = LogEntrySchema.safeParse(candidate);
    const entry: LogEntry = parsed.success
      ? parsed.data
      : {
          at: new Date(now()).toISOString(),
          runId: isRunId(candidate.runId) ? candidate.runId : newRunId(),
          op: 'log',
          durationMs: 0,
          outcome: 'error',
          errorCode: 'BAD_LOG_ENTRY',
        };
    try {
      await sink.append(entry);
    } catch {
      // Logging must never break the operation it observes.
    }
  }

  return {
    async op(runId, op, fn, meta) {
      const start = now();
      const base = { at: new Date(start).toISOString(), runId, op, ...meta };
      try {
        const r = await fn();
        await write({ ...base, durationMs: now() - start, outcome: r.ok ? 'ok' : 'error', ...(r.ok ? {} : { errorCode: r.code }) });
        return r;
      } catch (e) {
        const aborted = isAbort(e);
        await write({ ...base, durationMs: now() - start, outcome: aborted ? 'aborted' : 'error', ...(aborted ? {} : { errorCode: 'UNCAUGHT' }) });
        throw e;
      }
    },
    async event(entry) {
      await write({ ...entry, at: new Date(now()).toISOString() });
    },
  };
}
