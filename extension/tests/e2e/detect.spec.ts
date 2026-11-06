import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const ROOT = fileURLToPath(new URL('../../fixtures/pages/', import.meta.url));
const LABELS = JSON.parse(readFileSync(`${ROOT}labels.json`, 'utf8')) as Record<string, { url: string; expected: { doi: string | null; pmid: string | null } }>;
const fixture = (name: string) => ({ url: (LABELS[name] as { url: string }).url, html: readFileSync(`${ROOT}${name}.html`, 'utf8') });

const ON_SITE = 'https://www.mdpi.com';

async function openPanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return panel;
}

/** The panel page stands in for the side panel, so the paper's tab must be the active one. */
async function openPaper(context: BrowserContext, url: string): Promise<Page> {
  const paper = await context.newPage();
  await paper.goto(url);
  await paper.bringToFront();
  return paper;
}

test('OP1-E2E-01 3 publishers: opening an article shows its title and DOI in the panel', async ({ context, extensionId, sites }) => {
  const panel = await openPanel(context, extensionId);
  for (const name of ['plos', 'frontiers', 'pmc']) {
    const { url, html } = fixture(name);
    sites.set(url, html);
    const paper = await openPaper(context, url);
    await expect(panel.getByText(LABELS[name]?.expected.doi as string, { exact: true }), name).toBeVisible();
    await expect(panel.getByRole('heading', { level: 2 }), name).not.toBeEmpty();
    await paper.close();
  }
});

test('OP1-UNIT-08 preprint: the panel shows the DOI without the version, and the version apart', async ({ context, extensionId, sites }) => {
  const { html } = fixture('biorxiv');
  const url = 'https://www.biorxiv.org/content/10.1101/2020.02.07.937862v3.full';
  sites.set(url, html);
  const panel = await openPanel(context, extensionId);
  await openPaper(context, url);
  await expect(panel.getByText('10.1101/2020.02.07.937862', { exact: true })).toBeVisible();
  await expect(panel.getByText('Versión del preprint')).toBeVisible();
  await expect(panel.locator('dd', { hasText: /^3$/ })).toBeVisible();
});

test('OP1-E2E-02 list page: the panel reports the result ids found (badges arrive with VW2)', async ({ context, extensionId, sites }) => {
  const { url, html } = fixture('pubmed-list');
  sites.set(url, html);
  const panel = await openPanel(context, extensionId);
  await openPaper(context, url);
  await expect(panel.getByText('Lista de resultados: 10 artículos.')).toBeVisible();
});

test('OP1-E2E-03 OP1-A11Y-01 ambiguous page: keyboard-operable picker, chosen DOI shown, focus returns to the header', async ({ context, extensionId, sites }) => {
  const url = `${ON_SITE}/ambiguous`;
  sites.set(url, '<!doctype html><head><meta property="og:type" content="article"><meta property="og:title" content="Dudoso"></head><body><div class="abstract">10.1000/one 10.1000/two</div></body>');
  const panel = await openPanel(context, extensionId);
  await openPaper(context, url);
  const group = panel.getByRole('group', { name: 'Encontramos estos DOI. ¿Cuál es el de este artículo?' });
  await expect(group.getByRole('button')).toHaveText(['10.1000/one', '10.1000/two']);

  // No bringToFront: the panel page stands in for the side panel and must not become the active tab.
  await group.getByRole('button', { name: '10.1000/two' }).focus();
  await panel.keyboard.press('Enter');
  await expect(panel.locator('dd', { hasText: '10.1000/two' })).toBeVisible();
  await expect(group).toHaveCount(0);
  await expect(panel.getByRole('heading', { level: 2 })).toBeFocused();
});

test('OP1-UNIT-10 a DOI found only in page text is confirmed by the student, not shown as fact', async ({ context, extensionId, sites }) => {
  const url = `${ON_SITE}/one-doi`;
  sites.set(url, '<!doctype html><body><article><header><h1>Un artículo</h1><p>10.1000/only.one</p></header></article></body>');
  const panel = await openPanel(context, extensionId);
  await openPaper(context, url);
  await expect(panel.getByRole('button', { name: '10.1000/only.one' })).toBeVisible();
  await expect(panel.locator('dd')).toHaveCount(0);
});

test('OP1-INT-01 the panel follows navigation and tab changes and never shows the previous paper', async ({ context, extensionId, sites, pages }) => {
  const a = fixture('plos');
  const b = fixture('frontiers');
  sites.set(a.url, a.html);
  sites.set(b.url, b.html);
  pages.set('/not-a-listed-site', '<!doctype html><title>Otra cosa</title>');
  const unlisted = 'https://fixtures.biovidgen.test/not-a-listed-site';
  const panel = await openPanel(context, extensionId);
  const doiA = LABELS.plos?.expected.doi as string;
  const doiB = LABELS.frontiers?.expected.doi as string;

  const paper = await openPaper(context, a.url);
  await expect(panel.getByText(doiA, { exact: true })).toBeVisible();

  await paper.goto(b.url); // same tab, next paper
  await expect(panel.getByText(doiB, { exact: true })).toBeVisible();
  await expect(panel.getByText(doiA, { exact: true })).toHaveCount(0);

  const other = await openPaper(context, a.url); // switching tabs
  await expect(panel.getByText(doiA, { exact: true })).toBeVisible();
  await paper.bringToFront();
  await expect(panel.getByText(doiB, { exact: true })).toBeVisible();
  await other.close();

  await paper.goto(unlisted); // a site with no content script: the old paper must go away
  await expect(panel.getByText(doiB, { exact: true })).toHaveCount(0);
  await expect(panel.getByText('Abre un artículo científico para ver sus datos aquí.')).toBeVisible();
});

test('OP1-UNIT-20 OP1-HYP-04 single-page site: metadata injected 1 s after load, and a later in-page navigation, are detected', async ({ context, extensionId, sites }) => {
  const url = `${ON_SITE}/spa`;
  sites.set(
    url,
    `<!doctype html><head></head><body><script>
      const put = (doi) => { document.head.querySelector('meta[name=citation_doi]')?.remove(); const m = document.createElement('meta'); m.name = 'citation_doi'; m.content = doi; document.head.append(m); };
      setTimeout(() => put('10.1000/spa.first'), 1000);
      addEventListener('message', (e) => { if (e.data.nav) { history.pushState({}, '', '/spa/next'); put(e.data.nav); } });
    </script></body>`,
  );
  const panel = await openPanel(context, extensionId);
  const paper = await openPaper(context, url);
  await expect(panel.getByText('10.1000/spa.first', { exact: true })).toBeVisible({ timeout: 4000 });
  await paper.evaluate(() => window.postMessage({ nav: '10.1000/spa.second' }, '*'));
  await expect(panel.getByText('10.1000/spa.second', { exact: true })).toBeVisible({ timeout: 4000 });
  await expect(panel.getByText('10.1000/spa.first', { exact: true })).toHaveCount(0);
});

test('OP1-SEC-04 SYS-SEC-20 a hostile page cannot forge detection or inject markup into the panel', async ({ context, extensionId, sites }) => {
  const url = `${ON_SITE}/hostile`;
  const payload = '<img src=x onerror=&quot;document.title=&apos;PWNED&apos;&quot;>';
  sites.set(url, `<!doctype html><head><meta name="citation_title" content="${payload}"><meta name="citation_doi" content="10.1000/real"></head><body></body>`);
  const panel = await openPanel(context, extensionId);
  const paper = await openPaper(context, url);
  await expect(panel.getByText('10.1000/real', { exact: true })).toBeVisible();

  await paper.evaluate((id) => {
    const forged = { v: 1, name: 'detect.paperDetected', payload: { page: { doi: '10.1000/forged' }, durationMs: 0, seq: Number.MAX_SAFE_INTEGER } };
    window.postMessage(forged, '*');
    const runtime = (globalThis as unknown as { chrome?: { runtime?: { sendMessage?: (id: string, m: unknown) => void } } }).chrome?.runtime;
    try {
      runtime?.sendMessage?.(id, forged);
    } catch {
      // expected: pages have no route to the extension
    }
  }, extensionId);
  await paper.waitForTimeout(800);

  await expect(panel.getByText('10.1000/forged')).toHaveCount(0);
  await expect(panel.getByText('10.1000/real', { exact: true })).toBeVisible();
  await expect(panel.locator('img')).toHaveCount(0);
  await expect(panel.getByRole('heading', { level: 2 })).toContainText('<img src=x');
  expect(await panel.title()).not.toBe('PWNED');
});

test('OP1-UNIT-16 detection runs in the top frame only', async ({ serviceWorker }) => {
  const manifest = await serviceWorker.evaluate(() => (globalThis as unknown as { chrome: { runtime: { getManifest(): { content_scripts?: { all_frames?: boolean }[] } } } }).chrome.runtime.getManifest());
  expect(manifest.content_scripts?.[0]?.all_frames ?? false).toBe(false);
});

// Headless Chromium has no PDF viewer, so this uses a stand-in document. In Google Chrome 156 the
// content script does run in the viewer: the PLOS PDF showed its DOI (checked by hand, 2026-11-05).
test('OP1-UNIT-17 PDF address on a listed site: the DOI comes from the URL', async ({ context, extensionId, sites }) => {
  const url = 'https://www.biorxiv.org/content/10.1101/2020.02.07.937862v2.full.pdf';
  sites.set(url, '<!doctype html><body><embed type="application/pdf"></body>');
  const panel = await openPanel(context, extensionId);
  await openPaper(context, url);
  await expect(panel.getByText('10.1101/2020.02.07.937862', { exact: true })).toBeVisible();
});

test('OP1-SEC-01 SYS-SEC-01 content bundle has no network API, and detection sends nothing anywhere', async ({ context, extensionId, sites, egress }) => {
  const bundle = readFileSync(fileURLToPath(new URL('../../.output/chrome-mv3/content-scripts/content.js', import.meta.url)), 'utf8');
  expect(bundle).not.toMatch(/\bfetch\(|XMLHttpRequest|new WebSocket|sendBeacon|EventSource/);

  const { url, html } = fixture('plos');
  sites.set(url, html);
  const panel = await openPanel(context, extensionId);
  await openPaper(context, url);
  await expect(panel.getByText(LABELS.plos?.expected.doi as string, { exact: true })).toBeVisible();
  await panel.waitForTimeout(1000);
  expect(egress.map((r) => r.url).filter((u) => !u.startsWith('chrome-extension:') && u !== url && u !== 'about:blank')).toEqual([]);
});

test('OP1-OBS-01 OP1-PERF-01 log has duration and source only; 60k nodes + 200 meta: p95 ≤ 100 ms (target 50 ms)', async ({ context, extensionId, sites }) => {
  test.slow();
  const url = `${ON_SITE}/huge`;
  const metas = Array.from({ length: 199 }, (_, i) => `<meta name="citation_reference" content="ref ${i}">`).join('');
  const nodes = '<div><span>text</span></div>'.repeat(20_000); // 3 nodes each
  sites.set(url, `<!doctype html><head>${metas}<meta name="citation_title" content="SECRET-TITLE"></head><body><h1>SECRET-TITLE</h1><div class="abstract">10.1000/a 10.1000/b</div>${nodes}</body>`);
  const panel = await openPanel(context, extensionId);
  const paper = await openPaper(context, url);
  await expect(panel.getByRole('button', { name: '10.1000/a' })).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 9; i++) {
    await paper.reload();
    await expect(panel.getByRole('button', { name: '10.1000/a' })).toBeVisible({ timeout: 20_000 });
  }
  const entries = await panel.evaluate(
    () =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const open = indexedDB.open('biovidgen');
        open.onerror = () => reject(new Error('open failed'));
        open.onsuccess = () => {
          const all = open.result.transaction('logs').objectStore('logs').getAll();
          all.onsuccess = () => resolve(all.result as Record<string, unknown>[]);
        };
      }),
  );
  const op1 = entries.filter((e) => e.op === 'OP1');
  expect(op1.length).toBeGreaterThan(0);
  const text = JSON.stringify(op1);
  expect(text).not.toContain('SECRET');
  expect(text).not.toContain('mdpi.com');
  const times = op1.map((e) => e.durationMs as number).filter((t) => t > 0).sort((a, b) => a - b);
  expect(times.length).toBeGreaterThanOrEqual(9);
  const p95 = times[Math.ceil(times.length * 0.95) - 1] as number;
  console.info(`OP1-PERF-01 runs=${times.length} p50=${times[Math.floor(times.length / 2)]?.toFixed(1)} ms p95=${p95.toFixed(1)} ms`);
  expect(p95).toBeLessThanOrEqual(100);
});
