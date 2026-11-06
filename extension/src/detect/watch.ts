/** At most one re-run per interval, so a page that never stops changing is still detected (OP1-PERF-02). */
export const RERUN_MS = 500;

export interface DetectionLoopOptions<T> {
  run: () => T;
  emit: (value: T) => void;
  /** False once the extension was reloaded and this content script is orphaned (OP1-RES-02). */
  isAlive: () => boolean;
  onStop?: () => void;
}

export interface DetectionLoop<T> {
  trigger(): void;
  runNow(): void;
  stop(): void;
  latest(): T | undefined;
}

/** Runs the detector on page changes and emits only when the result differs from the last one. */
export function createDetectionLoop<T>({ run, emit, isAlive, onStop }: DetectionLoopOptions<T>): DetectionLoop<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let lastKey: string | undefined;
  let value: T | undefined;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const stop = () => {
    clear();
    if (stopped) return;
    stopped = true;
    onStop?.();
  };
  const tick = () => {
    clear();
    if (stopped) return;
    if (!isAlive()) {
      stop();
      return;
    }
    value = run();
    const key = JSON.stringify(value);
    if (key !== lastKey) {
      lastKey = key;
      emit(value);
    }
  };

  return {
    trigger() {
      if (stopped || timer !== undefined) return;
      if (!isAlive()) {
        stop();
        return;
      }
      timer = setTimeout(tick, RERUN_MS);
    },
    runNow: tick,
    stop,
    latest: () => value,
  };
}
