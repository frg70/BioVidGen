import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RETRY, backoffDelay, createHttp, parseRetryAfter, type HttpDeps } from './http';
import { createLimiterRegistry, sleep as realSleep, type LimiterRegistry } from './limiter';

const OA = 'https://api.openalex.org/works/doi:10.1000/xyz';
const NOW = Date.parse('2026-11-05T12:00:00Z');

type Step = Response | Error | 'hang';
const res = (status: number, headers: Record<string, string> = {}) => new Response(status === 204 ? null : 'x', { status, headers });

const noLimiter: LimiterRegistry = { for: () => ({ take: async () => {} }) };

function setup(steps: Step[], overrides: Partial<HttpDeps> = {}) {
  const queue = [...steps];
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected extra fetch');
    if (next === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }
    if (next instanceof Error) throw next;
    return next;
  });
  const sleeps: number[] = [];
  const deps: HttpDeps = {
    fetch: fetchMock as unknown as typeof fetch,
    random: () => 0.5,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => NOW,
    limiter: noLimiter,
    ...overrides,
  };
  return { http: createHttp(deps), fetchMock, sleeps };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('core/http retry policy', () => {
  it('SVC0-PROP-01 full jitter: delay is in [0, min(cap, base·2^n)) for every retry index and random draw', () => {
    fc.assert(
      fc.property(fc.nat(20), fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }), (n, r) => {
        const d = backoffDelay(n, DEFAULT_RETRY, () => r);
        const upper = Math.min(DEFAULT_RETRY.capMs, DEFAULT_RETRY.baseMs * 2 ** n);
        return Number.isInteger(d) && d >= 0 && d < upper && d <= DEFAULT_RETRY.capMs;
      }),
    );
  });

  it('SVC0-UNIT-01 retries network errors, 429, 502, 503 and 504, then succeeds', async () => {
    for (const first of [new TypeError('fetch failed'), res(429), res(502), res(503), res(504)]) {
      const { http, fetchMock } = setup([first, res(200)]);
      const r = await http.get(OA, { timeoutMs: 5_000 });
      expect(r.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it('SVC0-UNIT-02 does not retry 400, 401, 403, 404 or 500', async () => {
    for (const status of [400, 401, 403, 404, 500]) {
      const { http, fetchMock } = setup([res(status)]);
      const r = await http.get(OA, { timeoutMs: 5_000 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(r).toEqual({ ok: false, code: status === 500 ? 'UPSTREAM_ERROR' : 'HTTP_ERROR', status });
    }
  });

  it('SVC0-UNIT-03 stops after 3 attempts and maps the last failure to a stable code', async () => {
    const cases: Array<[Step, string]> = [
      [res(503), 'UPSTREAM_ERROR'],
      [res(429), 'RATE_LIMITED'],
      [new TypeError('fetch failed'), 'NETWORK'],
    ];
    for (const [step, code] of cases) {
      const { http, fetchMock, sleeps } = setup([step, step, step]);
      const r = await http.get(OA, { timeoutMs: 5_000 });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(sleeps).toHaveLength(2);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(code);
    }
  });

  it('SVC0-UNIT-04 honours Retry-After (seconds and HTTP-date) and fails fast when it is too long', async () => {
    const a = setup([res(429, { 'Retry-After': '2' }), res(200)]);
    expect((await a.http.get(OA, { timeoutMs: 5_000 })).ok).toBe(true);
    expect(a.sleeps).toEqual([2_000]);

    const date = new Date(NOW + 3_000).toUTCString();
    const b = setup([res(503, { 'Retry-After': date }), res(200)]);
    expect((await b.http.get(OA, { timeoutMs: 5_000 })).ok).toBe(true);
    expect(b.sleeps).toEqual([3_000]);

    const c = setup([res(429, { 'Retry-After': '120' })]);
    expect(await c.http.get(OA, { timeoutMs: 5_000 })).toEqual({ ok: false, code: 'RATE_LIMITED', status: 429 });
    expect(c.fetchMock).toHaveBeenCalledTimes(1);

    expect(parseRetryAfter(null, NOW)).toBeUndefined();
    expect(parseRetryAfter('soon', NOW)).toBeUndefined();
    expect(parseRetryAfter('0', NOW)).toBe(0);
  });

  it('SVC0-UNIT-05 a hung attempt ends with TIMEOUT (not retried); a caller abort ends with ABORTED', async () => {
    vi.useFakeTimers();
    const a = setup(['hang', res(200)]);
    const p = a.http.get(OA, { timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toEqual({ ok: false, code: 'TIMEOUT' });
    expect(a.fetchMock).toHaveBeenCalledTimes(1);

    const ctrl = new AbortController();
    const b = setup(['hang', res(200)]);
    const q = b.http.get(OA, { timeoutMs: 5_000, signal: ctrl.signal });
    await vi.advanceTimersByTimeAsync(0); // attempt is in flight
    expect(b.fetchMock).toHaveBeenCalledTimes(1);
    ctrl.abort();
    expect(await q).toEqual({ ok: false, code: 'ABORTED' });
    expect(b.fetchMock).toHaveBeenCalledTimes(1);

    const pre = new AbortController();
    pre.abort();
    const c = setup([res(200)]);
    expect(await c.http.get(OA, { timeoutMs: 5_000, signal: pre.signal })).toEqual({ ok: false, code: 'ABORTED' });
    expect(c.fetchMock).not.toHaveBeenCalled();
  });

  it('SVC0-UNIT-06 waits the jittered backoff on the real timer (fake clock) before each retry', async () => {
    vi.useFakeTimers();
    const { http, fetchMock } = setup([res(503), res(503), res(200)], { random: () => 0.999, sleep: realSleep });
    const p = http.get(OA, { timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(498); // first retry waits floor(0.999·500) = 499 ms
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999); // second retry waits floor(0.999·1000) = 999 ms
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((await p).ok).toBe(true);
  });

  it('SVC0-UNIT-07 takes a limiter token for the request host before every attempt', async () => {
    const hosts: string[] = [];
    const limiter: LimiterRegistry = { for: (host) => ({ take: async () => void hosts.push(host) }) };
    const { http } = setup([res(503), res(200)], { limiter });
    await http.get(OA, { timeoutMs: 5_000 });
    expect(hosts).toEqual(['api.openalex.org', 'api.openalex.org']);
  });

  it('SVC0-SEC-01 refuses non-allowlisted hosts and plain http before any I/O', async () => {
    for (const url of ['https://evil.example/x', 'http://api.openalex.org/works', 'https://api.openalex.org.evil.example/']) {
      const { http, fetchMock } = setup([]);
      expect(await http.get(url, { timeoutMs: 5_000 })).toEqual({ ok: false, code: 'HOST_NOT_ALLOWED' });
      expect(fetchMock).not.toHaveBeenCalled();
    }
    const llm = setup([res(200), res(200)], { userLlmHosts: () => ['api.groq.com'] });
    expect((await llm.http.post('https://api.groq.com/openai/v1/chat/completions', '{}', { timeoutMs: 60_000 })).ok).toBe(true);
    expect((await llm.http.get('http://localhost:11434/api/tags', { timeoutMs: 5_000 })).ok).toBe(true);
  });

  it('SVC0-UNIT-08 registry wires the per-host rates into real buckets', async () => {
    vi.useFakeTimers();
    const registry = createLimiterRegistry({ 'api.crossref.org': 1 }, 5, { now: Date.now, sleep: realSleep });
    const { http, fetchMock } = setup([res(200), res(200)], { limiter: registry });
    const p1 = http.get('https://api.crossref.org/works/10.1/a', { timeoutMs: 5_000 });
    const p2 = http.get('https://api.crossref.org/works/10.1/b', { timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await Promise.all([p1, p2]);
  });
});
