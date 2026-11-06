import type { DetectedPage, PageContext } from '../contracts/page-context';
import type { Logger } from '../core/log';
import type { Result } from '../core/result';
import { newRunId } from '../core/runid';
import { emptyPage, parseManualDoi } from './detect';
import { DetectionSchema, type Detection } from './messages';

/**
 * What the side panel knows: only the active tab of its own window (OP1-INT-01). The tab id comes
 * from Chrome, never from the message, because a content script runs inside a hostile page.
 */
export interface PanelState {
  tabId: number | null;
  page: PageContext | null;
  /**
   * Changes on every tab change or navigation. Views key their local state on it: on a site off
   * the list the page stays null across navigations, so nothing else tells two pages apart.
   */
  navigation: number;
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
  /** A DOI typed by the student. Returns false, changing nothing, when it is not a DOI. */
  enterDoi(raw: string): boolean;
  /** Drops the typed DOI and goes back to what the page gave. */
  clearManual(): void;
}

export function createPanelTracker({ tabs, windowId, request, log, onChange }: PanelTrackerOptions): PanelTracker {
  let tabId: number | null = null;
  let page: PageContext | null = null;
  let underManual: PageContext | null = null; // what the page gave while a typed DOI is showing
  let lastSeq = -1;
  let navigation = 0; // also marks replies from before the latest tab change or navigation as stale

  const publish = () => onChange({ tabId, page, navigation });

  const logDetection = ({ notes, doiSource }: DetectedPage, durationMs: number) => {
    const [note] = notes;
    void log.event({
      runId: newRunId(),
      op: 'OP1',
      durationMs,
      outcome: note === 'DETECT_ERROR' ? 'error' : 'ok',
      ...(note ? { errorCode: note } : {}),
      sizes: doiSource ? { [`doiSource.${doiSource}`]: 1 } : {},
    });
  };

  const receive = (from: number, detection: Detection) => {
    lastSeq = detection.seq;
    const received = { ...detection.page, tabId: from };
    // A result with no DOI must not erase the one the student typed. The page's own DOI does replace it.
    if (page?.doiSource === 'manual' && !received.doi) {
      underManual = received;
      return false;
    }
    page = received;
    underManual = null;
    publish();
    logDetection(detection.page, detection.durationMs);
    return true;
  };

  const reset = (to: number) => {
    navigation++;
    lastSeq = -1;
    tabId = to;
    page = null;
    underManual = null;
    publish();
    return navigation;
  };

  const refresh = async (from: number, mine: number) => {
    const reply = await request(from);
    // No reply means no content script here: a site off the list, or a page still loading.
    if (mine !== navigation || !reply.ok || reply.value.seq < lastSeq) return;
    receive(from, reply.value);
  };

  const onActivated: ActivatedListener = ({ tabId: to, windowId: from }) => {
    if (from === windowId) void refresh(to, reset(to));
  };
  const onUpdated: UpdatedListener = (updated, { status }) => {
    if (updated !== tabId) return;
    // Clear at once: the previous paper must never be shown for a new page.
    if (status === 'loading') reset(updated);
    else if (status === 'complete') void refresh(updated, navigation);
  };

  return {
    async start() {
      tabs.onActivated.addListener(onActivated);
      tabs.onUpdated.addListener(onUpdated);
      const active = await tabs.activeTabId();
      if (active !== undefined) await refresh(active, reset(active));
    },
    stop() {
      navigation++;
      tabs.onActivated.removeListener(onActivated);
      tabs.onUpdated.removeListener(onUpdated);
    },
    accept(raw, from) {
      const parsed = DetectionSchema.safeParse(raw);
      if (!parsed.success || from !== tabId || parsed.data.seq < lastSeq) return false;
      return receive(from, parsed.data);
    },
    enterDoi(raw) {
      const typed = parseManualDoi(raw);
      if (!typed || tabId === null) return false;
      underManual = page?.doiSource === 'manual' ? underManual : page;
      const base = underManual ?? { ...emptyPage(''), tabId };
      page = { ...base, kind: 'article', doi: typed.doi, doiSource: 'manual', version: typed.version, candidates: [] };
      publish();
      logDetection(page, 0);
      return true;
    },
    clearManual() {
      if (page?.doiSource !== 'manual') return;
      page = underManual;
      underManual = null;
      publish();
    },
  };
}
