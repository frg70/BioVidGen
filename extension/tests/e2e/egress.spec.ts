import { checkEgress } from '../support/egress-policy';
import { FIXTURE_HOST, expect, syntheticArticles, test } from './fixtures';

/*
 * Network fitness functions (tech-spec-v3 §7). Against the empty P0 extension the allowlist checks
 * pass trivially; the canary test proves the capture can see extension traffic, so the checks
 * become meaningful as soon as a feature adds requests.
 */

test('SYS-SEC-01 canary: the capture sees requests from the service worker and from extension pages', async ({
  context,
  serviceWorker,
  extensionId,
  egress,
}) => {
  await serviceWorker.evaluate(() => fetch('https://canary-sw.invalid/ping').catch(() => undefined));
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.evaluate(() => fetch('https://canary-page.invalid/ping').catch(() => undefined));
  await expect.poll(() => egress.map((r) => new URL(r.url).host)).toEqual(expect.arrayContaining(['canary-sw.invalid', 'canary-page.invalid']));
  expect(egress.find((r) => r.url.includes('canary-sw'))?.fromServiceWorker).toBe(true);
  const v = checkEgress(egress, { extensionOrigin: `chrome-extension://${extensionId}` });
  expect(v.map((x) => new URL(x.url).host).sort()).toEqual(['canary-page.invalid', 'canary-sw.invalid']);
});

test('SYS-SEC-01 network allowlist: opening the side panel and options page reaches only allowlisted hosts', async ({
  context,
  extensionId,
  egress,
}) => {
  for (const page of ['sidepanel.html', 'options.html']) {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extensionId}/${page}`);
    await p.waitForLoadState('networkidle');
  }
  await new Promise((r) => setTimeout(r, 2_000)); // let any deferred startup work fire
  expect(checkEgress(egress, { extensionOrigin: `chrome-extension://${extensionId}` })).toEqual([]);
});

test('SYS-SEC-02 payload allowlist: no scholarly request carries page URLs, titles or runIds', async ({ context, extensionId, egress, pages }) => {
  const articles = syntheticArticles(3);
  for (const a of articles) pages.set(a.path, a.html);
  for (const a of articles) {
    const p = await context.newPage();
    await p.goto(`https://${FIXTURE_HOST}${a.path}`);
  }
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.waitForLoadState('networkidle');
  const forbiddenValues = articles.flatMap((a) => [`https://${FIXTURE_HOST}${a.path}`, a.title]);
  expect(checkEgress(egress, { extensionOrigin: `chrome-extension://${extensionId}`, fixtureHosts: [FIXTURE_HOST], forbiddenValues })).toEqual([]);
});

test('SYS-SEC-03 no telemetry: browsing 20 pages without opening the panel makes zero extension requests', async ({
  context,
  serviceWorker,
  egress,
  pages,
}) => {
  void serviceWorker; // ensure the extension is up before browsing
  const articles = syntheticArticles(20);
  for (const a of articles) pages.set(a.path, a.html);
  const tab = await context.newPage();
  for (const a of articles) {
    await tab.goto(`https://${FIXTURE_HOST}${a.path}`);
    await expect(tab.locator('h1')).toHaveText(a.title);
  }
  await new Promise((r) => setTimeout(r, 1_000));
  const foreign = egress.filter((r) => new URL(r.url).host !== FIXTURE_HOST);
  expect(foreign).toEqual([]);
  expect(egress.filter((r) => r.fromServiceWorker)).toEqual([]);
  expect(egress).toHaveLength(20);
});
