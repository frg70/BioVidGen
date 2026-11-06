import { describe, expect, it, vi } from 'vitest';
import type { DetectedPage } from '../contracts/page-context';
import { createLogger, createMemorySink } from '../core/log';
import { err, ok } from '../core/result';
import { emptyPage } from './detect';
import type { Detection } from './messages';
import { createPanelTracker, type PanelState, type TabsLike } from './panel-tracker';

const WINDOW = 1;
const page = (doi: string | null, over: Partial<DetectedPage> = {}): DetectedPage => ({
  ...emptyPage('https://journal.example/x'),
  kind: doi ? 'article' : 'other',
  doi,
  doiSource: doi ? 'meta' : null,
  ...over,
});
const detection = (doi: string | null, seq = 1, over: Partial<DetectedPage> = {}): Detection => ({ page: page(doi, over), durationMs: 3, seq });

function fakeTabs(active = 7) {
  let onActivated: ((info: { tabId: number; windowId: number }) => void) | undefined;
  let onUpdated: ((tabId: number, change: { status?: string }) => void) | undefined;
  const tabs: TabsLike = {
    activeTabId: async () => active,
    onActivated: { addListener: (l) => void (onActivated = l), removeListener: () => void (onActivated = undefined) },
    onUpdated: { addListener: (l) => void (onUpdated = l), removeListener: () => void (onUpdated = undefined) },
  };
  return {
    tabs,
    activate: (tabId: number, windowId = WINDOW) => {
      active = tabId;
      onActivated?.({ tabId, windowId });
    },
    update: (tabId: number, status: string) => onUpdated?.(tabId, { status }),
    listening: () => onActivated !== undefined,
  };
}

async function setup(request: (tabId: number) => Promise<ReturnType<typeof ok<Detection>> | ReturnType<typeof err<string>>>, tabs = fakeTabs()) {
  const sink = createMemorySink();
  const states: PanelState[] = [];
  const tracker = createPanelTracker({ tabs: tabs.tabs, windowId: WINDOW, request, log: createLogger(sink), onChange: (s) => states.push(s) });
  await tracker.start();
  return { tracker, tabs, sink, states, last: () => states.at(-1) as PanelState };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('OP1 panel tracker', () => {
  it('OP1-INT-01 panel asks the active tab on open and holds only that tab, with the tab id from Chrome', async () => {
    const request = vi.fn(async () => ok(detection('10.1000/a')));
    const { last } = await setup(request);
    expect(request).toHaveBeenCalledWith(7);
    expect(last().page).toMatchObject({ tabId: 7, doi: '10.1000/a' });
  });

  it('OP1-SEC-04 PaperDetected from a tab that is not the active one is ignored', async () => {
    const { tracker, last } = await setup(async () => ok(detection('10.1000/a')));
    tracker.accept(detection('10.1000/other'), 99);
    expect(last().page?.doi).toBe('10.1000/a');
    tracker.accept(detection('10.1000/new', 2), 7);
    expect(last().page?.doi).toBe('10.1000/new');
  });

  it('OP1-UNIT-22 older results are dropped: only the newest seq per tab is shown', async () => {
    const { tracker, last } = await setup(async () => ok(detection('10.1000/a', 5)));
    tracker.accept(detection('10.1000/stale', 4), 7);
    expect(last().page?.doi).toBe('10.1000/a');
    tracker.accept(detection('10.1000/fresh', 6), 7);
    expect(last().page?.doi).toBe('10.1000/fresh');
  });

  it('OP1-UNIT-23 switching tabs shows the new tab; a slow reply from the old tab cannot overwrite it', async () => {
    let releaseOld: (v: ReturnType<typeof ok<Detection>>) => void = () => undefined;
    const request = vi.fn((tabId: number) => (tabId === 7 ? new Promise<ReturnType<typeof ok<Detection>>>((r) => (releaseOld = r)) : Promise.resolve(ok(detection('10.1000/eight')))));
    const f = fakeTabs();
    const sink = createMemorySink();
    const states: PanelState[] = [];
    const tracker = createPanelTracker({ tabs: f.tabs, windowId: WINDOW, request, log: createLogger(sink), onChange: (s) => states.push(s) });
    void tracker.start();
    await flush();
    f.activate(8);
    await flush();
    expect(states.at(-1)?.page).toMatchObject({ tabId: 8, doi: '10.1000/eight' });
    releaseOld(ok(detection('10.1000/seven')));
    await flush();
    expect(states.at(-1)?.page).toMatchObject({ tabId: 8, doi: '10.1000/eight' });
    tracker.stop();
    expect(f.listening()).toBe(false);
  });

  it('OP1-UNIT-24 a tab activated in another window is ignored (one side panel per window)', async () => {
    const request = vi.fn(async () => ok(detection('10.1000/a')));
    const { tabs, last } = await setup(request);
    tabs.activate(8, WINDOW + 1);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(last().page?.tabId).toBe(7);
  });

  it('OP1-UNIT-25 the active tab starts navigating: the old paper is cleared at once, then re-detected', async () => {
    const request = vi.fn(async () => ok(detection('10.1000/a')));
    const { tabs, last, states } = await setup(request);
    tabs.update(7, 'loading');
    expect(last().page).toBeNull(); // never show the previous paper for a new page
    request.mockResolvedValueOnce(ok(detection('10.1000/next', 2)));
    tabs.update(7, 'complete');
    await flush();
    expect(last().page?.doi).toBe('10.1000/next');
    expect(states.length).toBeGreaterThan(2);
  });

  it('OP1-UNIT-26 no content script and no readable URL (site not on the list) → no page, panel usable', async () => {
    const { last } = await setup(async () => err('NO_RECEIVER'));
    expect(last()).toMatchObject({ tabId: 7, page: null });
  });

  it('OP1-OBS-01 one log entry with runId, duration and doiSource; no URL, title or other text', async () => {
    const { sink } = await setup(async () => ok(detection('10.1000/a', 1, { title: 'SECRET TITLE', url: 'https://journal.example/SECRET-PATH' })));
    const entries = await sink.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ op: 'OP1', durationMs: 3, outcome: 'ok', sizes: { 'doiSource.meta': 1 } });
    expect(entries[0]?.runId).toMatch(/^run_/);
    const text = JSON.stringify(entries);
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('10.1000');
  });

  it('OP1-RES-01 OP1-UNIT-04 DETECT_ERROR and META_CONFLICT reach the log as codes', async () => {
    const { sink } = await setup(async () => ok(detection(null, 1, { notes: ['DETECT_ERROR'] })));
    expect((await sink.list())[0]).toMatchObject({ outcome: 'error', errorCode: 'DETECT_ERROR' });
    const second = await setup(async () => ok(detection('10.1000/a', 1, { notes: ['META_CONFLICT'] })));
    expect((await second.sink.list())[0]).toMatchObject({ outcome: 'ok', errorCode: 'META_CONFLICT' });
  });

  it('OP1-CON-02 a payload from another schema version is rejected', async () => {
    const { tracker, last } = await setup(async () => ok(detection('10.1000/a')));
    expect(tracker.accept({ ...detection('10.1000/old', 9), page: { ...page('10.1000/old'), schemaVersion: 2 } } as unknown as Detection, 7)).toBe(false);
    expect(last().page?.doi).toBe('10.1000/a');
  });
});
