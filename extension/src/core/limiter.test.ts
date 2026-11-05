import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST_RATES, createLimiterRegistry, createTokenBucket, reserve, sleep, type BucketState } from './limiter';

afterEach(() => {
  vi.useRealTimers();
});

describe('core/limiter token bucket', () => {
  it('SVC0-UNIT-09 allows a burst of `capacity`, then one request per 1/rate seconds (fake timers)', async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const bucket = createTokenBucket(5, 5, { now: Date.now, sleep });
    const doneAt: number[] = [];
    const all = Array.from({ length: 7 }, () => bucket.take().then(() => doneAt.push(Date.now() - start)));
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all(all);
    expect(doneAt).toEqual([0, 0, 0, 0, 0, 200, 400]);
  });

  it('SVC0-UNIT-10 hosts have independent buckets and the plan rates (OpenAlex 10, Crossref 5, Europe PMC 5)', async () => {
    expect(HOST_RATES).toMatchObject({ 'api.openalex.org': 10, 'api.crossref.org': 5, 'www.ebi.ac.uk': 5 });
    vi.useFakeTimers();
    const reg = createLimiterRegistry({ a: 1, b: 1 }, 5, { now: Date.now, sleep });
    await reg.for('a').take();
    let aDone = false;
    const a2 = reg.for('a').take().then(() => (aDone = true));
    await reg.for('b').take(); // not blocked by host a
    await vi.advanceTimersByTimeAsync(999);
    expect(aDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await a2;
    expect(aDone).toBe(true);
    expect(reg.for('a')).toBe(reg.for('a'));
  });

  it('SVC0-PROP-02 never grants more than capacity + rate·T requests in any window of T ms', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.array(fc.integer({ min: 0, max: 400 }), { minLength: 1, maxLength: 60 }),
        (rate, gaps) => {
          let state: BucketState = { tat: 0 };
          let now = 0;
          const grants: number[] = [];
          for (const gap of gaps) {
            now += gap;
            const r = reserve(state, now, rate, rate);
            state = r.state;
            grants.push(now + r.waitMs);
          }
          grants.sort((x, y) => x - y);
          for (let i = 0; i < grants.length; i++) {
            for (let j = i; j < grants.length; j++) {
              const windowMs = (grants[j] ?? 0) - (grants[i] ?? 0);
              if (j - i + 1 > rate + (rate * windowMs) / 1000 + 1e-9) return false;
            }
          }
          return true;
        },
      ),
    );
  });

  it('SVC0-UNIT-11 sleep rejects with the abort reason when the signal fires', async () => {
    vi.useFakeTimers();
    const ctrl = new AbortController();
    const p = sleep(10_000, ctrl.signal);
    ctrl.abort(new DOMException('stop', 'AbortError'));
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
