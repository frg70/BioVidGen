import { isAllowedUrl } from './egress';
import { DEFAULT_RATE, HOST_RATES, createLimiterRegistry, sleep, type LimiterRegistry } from './limiter';
import { err, ok, type Err, type Ok } from './result';

/**
 * HTTP client (SVC0 plan §5): allowlist check, per-attempt timeout, per-host limiter,
 * full-jitter retry on network errors / 429 / 502 / 503 / 504, Retry-After honoured.
 *
 * Codes: HOST_NOT_ALLOWED (refused before any I/O, or redirected off the allowlist) · TIMEOUT
 * (attempt exceeded timeoutMs; not retried) · ABORTED (caller signal) · NETWORK (fetch threw after
 * all attempts) · RATE_LIMITED (429 after all attempts, or Retry-After above maxRetryAfterMs) ·
 * UPSTREAM_ERROR (5xx; status set) · HTTP_ERROR (other non-2xx; status set; not retried).
 */
export type HttpCode = 'HOST_NOT_ALLOWED' | 'TIMEOUT' | 'ABORTED' | 'NETWORK' | 'RATE_LIMITED' | 'UPSTREAM_ERROR' | 'HTTP_ERROR';
export type HttpResult = Ok<Response> | Err<HttpCode>;

export interface RetryPolicy {
  /** Total attempts including the first (SVC0 plan: 3). */
  readonly attempts: number;
  readonly baseMs: number;
  readonly capMs: number;
  /** A Retry-After longer than this fails fast with RATE_LIMITED instead of waiting. */
  readonly maxRetryAfterMs: number;
}
export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseMs: 500, capMs: 8_000, maxRetryAfterMs: 30_000 };
export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 502, 503, 504]);

/** Full jitter: random(0, min(cap, base·2^retryIndex)), retryIndex 0 for the first retry. */
export function backoffDelay(retryIndex: number, policy: RetryPolicy, random: () => number): number {
  return Math.floor(random() * Math.min(policy.capMs, policy.baseMs * 2 ** retryIndex));
}

/** Retry-After as delta-seconds or HTTP-date → milliseconds from now; undefined if absent/invalid. */
export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (header === null) return undefined;
  const s = header.trim();
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const at = Date.parse(s);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

export interface HttpDeps {
  fetch: typeof fetch;
  random: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
  limiter: LimiterRegistry;
  /** The user's chosen LLM host(s), from Settings. */
  userLlmHosts?: () => readonly string[];
}

export interface RequestOptions {
  timeoutMs: number;
  retry?: Partial<RetryPolicy> | false;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface Http {
  get(url: string, opts: RequestOptions): Promise<HttpResult>;
  post(url: string, body: string, opts: RequestOptions): Promise<HttpResult>;
}

type Attempt = { done: true; result: HttpResult } | { done: false; result: Err<HttpCode>; retryAfterMs?: number };

export function createHttp(deps: HttpDeps): Http {
  async function attempt(method: string, url: string, body: string | undefined, opts: RequestOptions): Promise<Attempt> {
    if (opts.signal?.aborted) return { done: true, result: err('ABORTED') };
    const ctrl = new AbortController();
    const onCallerAbort = () => ctrl.abort(opts.signal?.reason);
    opts.signal?.addEventListener('abort', onCallerAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort(new DOMException('timeout', 'TimeoutError'));
    }, opts.timeoutMs);
    try {
      const init: RequestInit = { method, signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' };
      if (opts.headers) init.headers = opts.headers;
      if (body !== undefined) init.body = body;
      const response = await deps.fetch(url, init);
      if (response.redirected && !isAllowedUrl(response.url, deps.userLlmHosts?.() ?? [])) {
        return { done: true, result: err('HOST_NOT_ALLOWED') };
      }
      if (response.ok) return { done: true, result: ok(response) };
      response.body?.cancel().catch(() => undefined);
      const status = response.status;
      if (RETRYABLE_STATUS.has(status)) {
        const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'), deps.now());
        const result = err(status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR', status);
        return retryAfterMs === undefined ? { done: false, result } : { done: false, result, retryAfterMs };
      }
      return { done: true, result: err(status >= 500 ? 'UPSTREAM_ERROR' : 'HTTP_ERROR', status) };
    } catch {
      if (opts.signal?.aborted) return { done: true, result: err('ABORTED') };
      if (timedOut) return { done: true, result: err('TIMEOUT') };
      return { done: false, result: err('NETWORK') };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  async function request(method: string, url: string, body: string | undefined, opts: RequestOptions): Promise<HttpResult> {
    if (!isAllowedUrl(url, deps.userLlmHosts?.() ?? [])) return err('HOST_NOT_ALLOWED');
    const host = new URL(url).host;
    const policy: RetryPolicy = opts.retry === false ? { ...DEFAULT_RETRY, attempts: 1 } : { ...DEFAULT_RETRY, ...opts.retry };
    let last: Err<HttpCode> = err('NETWORK');
    for (let i = 0; i < policy.attempts; i++) {
      try {
        await deps.limiter.for(host).take(opts.signal);
      } catch {
        return err('ABORTED');
      }
      const a = await attempt(method, url, body, opts);
      if (a.done) return a.result;
      last = a.result;
      if (i === policy.attempts - 1) break;
      let delay = backoffDelay(i, policy, deps.random);
      if (a.retryAfterMs !== undefined) {
        if (a.retryAfterMs > policy.maxRetryAfterMs) return last;
        delay = a.retryAfterMs;
      }
      try {
        await deps.sleep(delay, opts.signal);
      } catch {
        return err('ABORTED');
      }
    }
    return last;
  }

  return {
    get: (url, opts) => request('GET', url, undefined, opts),
    post: (url, body, opts) => request('POST', url, body, opts),
  };
}

/** Production wiring. `userLlmHosts` reads the chosen provider host from Settings (SVC6). */
export function createDefaultHttp(userLlmHosts?: () => readonly string[]): Http {
  const deps: HttpDeps = {
    fetch: (input, init) => globalThis.fetch(input, init),
    random: Math.random,
    sleep,
    now: Date.now,
    limiter: createLimiterRegistry(HOST_RATES, DEFAULT_RATE, { now: Date.now, sleep }),
  };
  if (userLlmHosts) deps.userLlmHosts = userLlmHosts;
  return createHttp(deps);
}
