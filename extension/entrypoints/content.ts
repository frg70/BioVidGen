import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import type { DetectedPage } from '../src/contracts/page-context';
import { createMessaging, type RuntimeLike } from '../src/core/messaging';
import { ok } from '../src/core/result';
import { DEFAULT_RULES, safeDetect } from '../src/detect/detect';
import { GetPageContext, PaperDetected, type Detection } from '../src/detect/messages';
import { createDetectionLoop } from '../src/detect/watch';

// Runs inside pages we do not control, so it stays unprivileged: it reads the page, answers the
// panel, holds no settings or keys and makes no network calls (ADR-0011, OP1-SEC-01). It listens
// to no window messages, so a page cannot talk to it. Match patterns are a Type 1 decision: see
// ADR-0011 and the snapshot in tests/e2e/extension.spec.ts.
export default defineContentScript({
  matches: DEFAULT_RULES.entries.flatMap((site) => site.matches),
  main(ctx) {
    const messaging = createMessaging(browser.runtime as unknown as RuntimeLike);
    let durationMs = 0;
    let current: Detection | undefined;
    let seq = 0;
    const detect = () => safeDetect(document, new URL(location.href), DEFAULT_RULES);

    const loop = createDetectionLoop<DetectedPage>({
      run() {
        const started = performance.now();
        const page = detect();
        durationMs = performance.now() - started;
        return page;
      },
      emit(page) {
        seq = Math.max(seq + 1, Date.now()); // keeps growing across full page loads of one tab
        current = { page, durationMs, seq };
        void messaging.send(PaperDetected, current); // NO_RECEIVER just means the panel is closed
      },
      isAlive: () => !ctx.isInvalid,
      onStop: () => observer.disconnect(),
    });
    const observer = new MutationObserver(() => loop.trigger());

    observer.observe(document.documentElement, { childList: true, subtree: true });
    ctx.addEventListener(window, 'popstate', () => loop.trigger());
    ctx.addEventListener(window, 'wxt:locationchange', () => loop.trigger());
    ctx.onInvalidated(() => loop.stop());
    messaging.handle(GetPageContext, async () => ok(current ?? { page: detect(), durationMs: 0, seq: 0 }));
    loop.runNow();
  },
});
