import type { DetectedPage, PageContext } from '../contracts/page-context';
import type { Logger } from '../core/log';
import type { Result } from '../core/result';
import { newRunId } from '../core/runid';
import { DetectionSchema, type Detection } from './messages';

/**
 * What the side panel knows: only the active tab of its own window (OP1-INT-01). The tab id comes
 * from Chrome, never from the message, because a content script runs inside a hostile page.
 */
export interface PanelState {
  tabId: number | null;
  page: PageContext | null;
}

type ActivatedListener = (info: { tabId: number; windowId: number }) => void;
type UpdatedListener = (tabId: number, change: { status?: string }) => void;
export interface TabsLike {
  activeTabId(): Promise<number | undefined>;
  onActivated: { addListener(l: ActivatedListener): void; removeListener(l: ActivatedListener): void };
  onUpdated: { addListener(l: UpdatedListener): void; removeListener(l: UpdatedListener): void };
}

export interface PanelTrackerOptions {
  tabs: TabsLike;
  windowId: number;
  request: (tabId: number) => Promise<Result<Detection, string>>;
  log: Logger;
  onChange: (state: PanelState) => void;
}

export interface PanelTracker {
  start(): Promise<void>;
  stop(): void;
  /** Handles PaperDetected. `tabId` is `sender.tab.id`. Returns false when the message is ignored. */
  accept(raw: unknown, tabId: number): boolean;
}

export function createPanelTracker({ tabs, windowId, request, log, onChange }: PanelTrackerOptions): PanelTracker {
  let state: PanelState = { tabId: null, page: null };
  let lastSeq = -1;
  let generation = 0; // replies from before the latest tab change or navigation are stale

  const publish = (next: PanelState) => {
    state = next;
    onChange(state);
  };

  const show = (tabId: number, page: DetectedPage, durationMs: number) => {
    publish({ tabId, page: { ...page, tabId } });
    const [note] = page.notes;
    void log.event({
      runId: newRunId(),
      op: 'OP1',
      durationMs,
      outcome: note === 'DETECT_ERROR' ? 'error' : 'ok',
      ...(note ? { errorCode: note } : {}),
      sizes: page.doiSource ? { [`doiSource.${page.doiSource}`]: 1 } : {},
    });
  };

  const reset = (tabId: number) => {
    generation++;
    lastSeq = -1;
    publish({ tabId, page: null });
    return generation;
  };

  const refresh = async (tabId: number, mine: number) => {
    const reply = await request(tabId);
    // No reply means no content script here: a site off the list, or a page still loading.
    if (mine !== generation || !reply.ok || reply.value.seq < lastSeq) return;
    lastSeq = reply.value.seq;
    show(tabId, reply.value.page, reply.value.durationMs);
  };

  const onActivated: ActivatedListener = ({ tabId, windowId: from }) => {
    if (from === windowId) void refresh(tabId, reset(tabId));
  };
  const onUpdated: UpdatedListener = (tabId, { status }) => {
    if (tabId !== state.tabId) return;
    // Clear at once: the previous paper must never be shown for a new page.
    if (status === 'loading') reset(tabId);
    else if (status === 'complete') void refresh(tabId, generation);
  };

  return {
    async start() {
      tabs.onActivated.addListener(onActivated);
      tabs.onUpdated.addListener(onUpdated);
      const tabId = await tabs.activeTabId();
      if (tabId !== undefined) await refresh(tabId, reset(tabId));
    },
    stop() {
      generation++;
      tabs.onActivated.removeListener(onActivated);
      tabs.onUpdated.removeListener(onUpdated);
    },
    accept(raw, tabId) {
      const parsed = DetectionSchema.safeParse(raw);
      if (!parsed.success || tabId !== state.tabId || parsed.data.seq < lastSeq) return false;
      lastSeq = parsed.data.seq;
      show(tabId, parsed.data.page, parsed.data.durationMs);
      return true;
    },
  };
}
