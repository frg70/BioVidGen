import { fileURLToPath } from 'node:url';
import { test as base, chromium, type BrowserContext, type Route, type Worker } from '@playwright/test';
import { BACKEND_HOST } from '../../src/core/egress';
import type { ObservedRequest } from '../support/egress-policy';

/** Built by `wxt build` (npm run test:e2e builds first). */
const EXTENSION_DIR = fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url));
export const FIXTURE_HOST = 'fixtures.biovidgen.test';
/** What the panel asks the local backend when it opens: a fixed address with nothing about the page (BE1-SEC-03). */
export const BACKEND_HEALTH = `http://${BACKEND_HOST}/health`;

export interface Captured extends ObservedRequest {
  fromServiceWorker: boolean;
}

/** The local backend, as the extension sees it. Off by default, as on a machine that never started it. */
export interface BackendStub {
  state: 'off' | 'on' | 'origin-refused';
  token: string;
  /** OP3 answers by DOI; any other DOI is a 404 NOT_FOUND, as when OpenAlex does not have it. */
  articles: Map<string, unknown>;
}

/**
 * Stands in for backend/, refusing an Origin the way its guard does (BE0-SEC-03). Playwright answers CORS itself on
 * routed requests, so the browser's CORS failure is modelled by aborting. Real CORS against the real backend is
 * checked by hand (docs/runbooks/be1.md).
 */
async function answerAsBackend(route: Route, backend: BackendStub): Promise<void> {
  const request = route.request();
  if (backend.state === 'off') return route.abort('connectionrefused');
  const headers = await request.allHeaders();
  if (backend.state === 'origin-refused' && headers.origin !== undefined) return route.abort('failed');
  const path = new URL(request.url()).pathname;
  if (path === '/health') return route.fulfill({ status: 200, json: { ok: true, version: '0.1.0' } });
  if (headers['x-bvg-token'] !== backend.token) return route.fulfill({ status: 401, json: { error: 'UNAUTHORIZED' } });
  if (path === '/api/v1/article') {
    const found = backend.articles.get(new URL(request.url()).searchParams.get('doi') ?? '');
    return found === undefined ? route.fulfill({ status: 404, json: { error: 'NOT_FOUND' } }) : route.fulfill({ status: 200, json: found });
  }
  return route.fulfill({ status: 200, json: { paired: true } });
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
  backend: BackendStub;
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
  // eslint-disable-next-line no-empty-pattern
  backend: async ({}, use) => {
    await use({ state: 'off', token: '', articles: new Map() });
  },
  context: async ({ egress, pages, sites, backend }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`, '--lang=es'],
      env: { ...process.env, LANGUAGE: 'es' }, // Chromium on Linux takes its UI language from here and ignores --lang
    });
    context.on('request', (r) => {
      egress.push({ url: r.url(), method: r.method(), postData: r.postData(), fromServiceWorker: r.serviceWorker() !== null });
    });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === 'chrome-extension:') return route.continue();
      const recorded = sites.get(url.href);
      if (recorded !== undefined) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: recorded });
      if (url.host === BACKEND_HOST) return answerAsBackend(route, backend);
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
