import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDetectionLoop, RERUN_MS } from './watch';

describe('OP1 detection loop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (values: () => string = () => 'a', alive: () => boolean = () => true) => {
    const run = vi.fn(values);
    const emit = vi.fn();
    return { run, emit, loop: createDetectionLoop({ run, emit, isAlive: alive }) };
  };

  it('OP1-UNIT-21 10 mutations within 500 ms → 1 run', () => {
    const { run, loop } = setup();
    for (let i = 0; i < 10; i++) {
      loop.trigger();
      vi.advanceTimersByTime(40);
    }
    vi.advanceTimersByTime(RERUN_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('OP1-PERF-02 SPA churn, 100 mutations/s for 5 s → ≤10 runs, and detection is not starved', () => {
    const { run, loop } = setup();
    for (let i = 0; i < 500; i++) {
      loop.trigger();
      vi.advanceTimersByTime(10);
    }
    expect(run.mock.calls.length).toBeGreaterThan(0);
    expect(run.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it('OP1-UNIT-19 two navigations within 100 ms → only the latest result is emitted', () => {
    let current = 'first-paper';
    const { run, emit, loop } = setup(() => current);
    loop.trigger();
    vi.advanceTimersByTime(50);
    current = 'second-paper';
    loop.trigger();
    vi.advanceTimersByTime(RERUN_MS);
    expect(run).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls.map((c) => c[0])).toEqual(['second-paper']);
  });

  it('OP1-UNIT-20 late meta: a re-run after an SPA injects citation_doi 1 s later detects it', () => {
    let current = 'no-doi';
    const { emit, loop } = setup(() => current);
    loop.runNow();
    vi.advanceTimersByTime(1000);
    current = 'with-doi';
    loop.trigger();
    vi.advanceTimersByTime(RERUN_MS);
    expect(emit.mock.calls.map((c) => c[0])).toEqual(['no-doi', 'with-doi']);
  });

  it('OP1-INT-01 unchanged result is not emitted again (one message per navigation)', () => {
    const { run, emit, loop } = setup();
    loop.runNow();
    loop.trigger();
    vi.advanceTimersByTime(RERUN_MS);
    loop.trigger();
    vi.advanceTimersByTime(RERUN_MS);
    expect(run).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(loop.latest()).toBe('a');
  });

  it('OP1-RES-02 extension reloaded: an orphaned loop stops quietly and never runs again', () => {
    let alive = true;
    const onStop = vi.fn();
    const run = vi.fn(() => 'a');
    const emit = vi.fn();
    const loop = createDetectionLoop({ run, emit, isAlive: () => alive, onStop });
    loop.runNow();
    alive = false;
    loop.trigger();
    vi.advanceTimersByTime(RERUN_MS);
    loop.trigger();
    vi.advanceTimersByTime(RERUN_MS);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('OP1-RES-02 stop cancels a pending run', () => {
    const { run, loop } = setup();
    loop.trigger();
    loop.stop();
    vi.advanceTimersByTime(RERUN_MS);
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
