/**
 * Per-host token bucket (SVC0 plan §5), implemented as GCRA (virtual scheduling): equivalent to
 * a bucket of `capacity` tokens refilled at `ratePerSec`, but tracked as one timestamp, so there
 * is no floating-point drift in a running token balance.
 */
export interface BucketState {
  /** Theoretical arrival time (ms) of the next request if no burst allowance were used. */
  readonly tat: number;
}

/**
 * Pure reservation step: grants the next slot and returns how long the caller must wait.
 * Callers queue in call order (FIFO).
 */
export function reserve(state: BucketState, nowMs: number, ratePerSec: number, capacity: number): { state: BucketState; waitMs: number } {
  const interval = 1000 / ratePerSec;
  const burst = (capacity - 1) * interval;
  const grantAt = Math.max(nowMs, state.tat - burst);
  const waitMs = Math.max(0, Math.ceil(grantAt - nowMs - 1e-6));
  return { state: { tat: Math.max(state.tat, grantAt) + interval }, waitMs };
}

export interface TokenBucket {
  take(signal?: AbortSignal): Promise<void>;
}
export interface LimiterDeps {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}
export interface LimiterRegistry {
  for(host: string): TokenBucket;
}

/** Requests/second per host. LLM provider rates join from providers.json (SVC4). */
export const HOST_RATES: Readonly<Record<string, number>> = {
  'api.openalex.org': 10,
  'api.crossref.org': 5,
  'www.ebi.ac.uk': 5,
};
export const DEFAULT_RATE = 5;

export function createTokenBucket(ratePerSec: number, capacity: number, deps: LimiterDeps): TokenBucket {
  let state: BucketState = { tat: deps.now() };
  return {
    async take(signal) {
      signal?.throwIfAborted();
      const r = reserve(state, deps.now(), ratePerSec, capacity);
      state = r.state;
      if (r.waitMs > 0) await deps.sleep(r.waitMs, signal);
    },
  };
}

export function createLimiterRegistry(rates: Readonly<Record<string, number>>, defaultRate: number, deps: LimiterDeps): LimiterRegistry {
  const buckets = new Map<string, TokenBucket>();
  return {
    for(host) {
      let b = buckets.get(host);
      if (!b) {
        const rate = rates[host] ?? defaultRate;
        b = createTokenBucket(rate, rate, deps);
        buckets.set(host, b);
      }
      return b;
    },
  };
}

/** setTimeout-based sleep that rejects with the signal's reason on abort. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
