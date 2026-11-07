import { render } from 'preact';
import { browser } from 'wxt/browser';
import { createDefaultBackendClient, type BackendResult } from '../../src/backend/client';
import { openDb, requestPersistence } from '../../src/core/db/index';
import { createLogger, createMemorySink } from '../../src/core/log';
import { createDbLogSink } from '../../src/core/log-sink';
import { createMessaging, type RuntimeLike } from '../../src/core/messaging';
import { err, ok } from '../../src/core/result';
import { GetPageContext, PaperDetected } from '../../src/detect/messages';
import { createPanelTracker, type PanelState, type TabsLike } from '../../src/detect/panel-tracker';
import { newRunId } from '../../src/core/runid';
import { BackendStatus, type BackendView } from './backend';
import { PaperView } from './paper';

// Composition root. IndexedDB failure falls back to memory-only logging (SVC0 plan §7);
// the banner for that state belongs to VW1.
const root = document.getElementById('app');
const TOKEN_KEY = 'backendToken'; // a secret (rule 2): chrome.storage.local only
const backend = createDefaultBackendClient({
  get: async () => (await browser.storage.local.get(TOKEN_KEY))[TOKEN_KEY],
  set: (token) => browser.storage.local.set({ [TOKEN_KEY]: token }),
});

let panel: PanelState = { tabId: null, page: null, navigation: 0 };
let backendView: BackendView = 'checking';
let studentActed = false;
let actions: { onEnterDoi: (raw: string) => boolean; onClearDoi: () => void } = { onEnterDoi: () => false, onClearDoi: () => undefined };
let backendActions: { onRetry: () => void; onPair: (token: string) => void } = { onRetry: () => undefined, onPair: () => undefined };
function draw() {
  if (!root) return;
  render(
    <PaperView state={panel} {...actions}>
      <BackendStatus view={backendView} extensionId={browser.runtime.id} moveFocus={studentActed} {...backendActions} />
    </PaperView>,
    root,
  );
}
draw();

async function boot() {
  const db = await openDb();
  if (db.ok) await requestPersistence();
  const log = createLogger(db.ok ? createDbLogSink(db.value) : createMemorySink());

  const showBackend = async (op: string, call: (runId: ReturnType<typeof newRunId>) => Promise<BackendResult>) => {
    const runId = newRunId();
    const result = await log.op(runId, op, () => call(runId));
    backendView = result.ok ? 'paired' : result.code;
    draw();
  };
  backendActions = {
    onRetry: () => {
      studentActed = true;
      backendView = 'checking';
      draw();
      void showBackend('backend.check', backend.check);
    },
    onPair: (token) => void showBackend('backend.pair', (runId) => backend.pair(token, runId)),
  };
  void showBackend('backend.check', backend.check);

  const messaging = createMessaging(browser.runtime as unknown as RuntimeLike, {
    tabs: { sendMessage: (tabId, message) => browser.tabs.sendMessage(tabId, message) },
  });
  const tabs: TabsLike = {
    activeTabId: async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id,
    onActivated: browser.tabs.onActivated,
    onUpdated: browser.tabs.onUpdated as unknown as TabsLike['onUpdated'],
  };
  const { id: windowId } = await browser.windows.getCurrent();
  const tracker = createPanelTracker({
    tabs,
    windowId: windowId ?? -1,
    request: (tabId) => messaging.sendToTab(GetPageContext, tabId, {}),
    log,
    onChange: (state) => {
      panel = state;
      draw();
    },
  });
  actions = { onEnterDoi: (raw) => tracker.enterDoi(raw), onClearDoi: () => tracker.clearManual() };
  messaging.handle(
    PaperDetected,
    async (detection, sender) => {
      if (sender.tab?.id === undefined) return err('FORBIDDEN_SENDER');
      tracker.accept(detection, sender.tab.id); // a tab that is not the active one is ignored, not an error (OP1-SEC-04)
      return ok({});
    },
    { allow: 'content' },
  );
  await tracker.start();
}
void boot();
