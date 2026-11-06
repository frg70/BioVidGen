import { render } from 'preact';
import { browser } from 'wxt/browser';
import { openDb, requestPersistence } from '../../src/core/db/index';
import { createLogger, createMemorySink } from '../../src/core/log';
import { createDbLogSink } from '../../src/core/log-sink';
import { createMessaging, type RuntimeLike } from '../../src/core/messaging';
import { err, ok } from '../../src/core/result';
import { GetPageContext, PaperDetected } from '../../src/detect/messages';
import { createPanelTracker, type TabsLike } from '../../src/detect/panel-tracker';
import { PaperView } from './paper';

// Composition root. IndexedDB failure falls back to memory-only logging (SVC0 plan §7);
// the banner for that state belongs to VW1.
async function boot() {
  const root = document.getElementById('app');
  if (root) render(<PaperView state={{ tabId: null, page: null }} />, root);

  const db = await openDb();
  if (db.ok) await requestPersistence();
  const log = createLogger(db.ok ? createDbLogSink(db.value) : createMemorySink());

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
      if (root) render(<PaperView state={state} />, root);
    },
  });
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
