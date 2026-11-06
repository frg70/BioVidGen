import { fileURLToPath } from 'node:url';
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import type { ObservedRequest } from '../support/egress-policy';

/** Built by `wxt build` (npm run test:e2e builds first). */
const EXTENSION_DIR = fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url));
export const FIXTURE_HOST = 'fixtures.biovidgen.test';

export interface Captured extends ObservedRequest {
  fromServiceWorker: boolean;
}

/**
 * Persistent Chromium context with the unpacked extension (playwright.dev/docs/chrome-extensions).
 * Every request the context sees is recorded in `egress`. Fixture pages on FIXTURE_HOST are served
 * from memory; every other non-extension request is recorded and then aborted, so a failing test
 * never leaks real traffic.
 */
export const test = base.extend<{
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  egress: Captured[];
  pages: Map<string, string>;
  /** Recorded pages served on real publisher hostnames, keyed by full URL. Never reaches the network. */
  sites: Map<string, string>;
}>({
  // Playwright requires an object pattern as the first fixture argument.
  // eslint-disable-next-line no-empty-pattern
  pages: async ({}, use) => {
    await use(new Map());
  },
  // eslint-disable-next-line no-empty-pattern
  sites: async ({}, use) => {
    await use(new Map());
  },
  // eslint-disable-next-line no-empty-pattern
  egress: async ({}, use) => {
    await use([]);
  },
  context: async ({ egress, pages, sites }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`, '--lang=es'],
    });
    context.on('request', (r) => {
      egress.push({ url: r.url(), method: r.method(), postData: r.postData(), fromServiceWorker: r.serviceWorker() !== null });
    });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === 'chrome-extension:') return route.continue();
      const recorded = sites.get(url.href);
      if (recorded !== undefined) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: recorded });
      if (url.host === FIXTURE_HOST) {
        const html = pages.get(url.pathname);
        return html === undefined ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'text/html', body: html });
      }
      return route.abort('blockedbyclient');
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(serviceWorker.url().split('/')[2] ?? '');
  },
});
export const expect = test.expect;

/** Synthetic article-like pages (title, DOI meta, abstract). Real OA fixtures replace these in OP1. */
export function syntheticArticles(count: number): Array<{ path: string; title: string; html: string }> {
  return Array.from({ length: count }, (_, i) => {
    const title = `Synthetic study ${i + 1} on outcome measures`;
    const doi = `10.5555/biovidgen.fixture.${i + 1}`;
    return {
      path: `/article/${i + 1}`,
      title,
      html: `<!doctype html><html lang="en"><head><title>${title}</title><meta name="citation_title" content="${title}"><meta name="citation_doi" content="${doi}"></head><body><h1>${title}</h1><section><h2>Abstract</h2><p>Background. Methods. Results. Conclusions.</p></section></body></html>`,
    };
  });
}
