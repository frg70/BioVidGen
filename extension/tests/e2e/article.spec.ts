import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { BACKEND_HOST } from '../../src/core/egress';
import { FIXTURE_HOST, expect, syntheticArticles, test } from './fixtures';

/** OP3 in the panel: the backend's answer (recorded from the real backend, extension/fixtures/backend) as a header. */
const TOKEN = 'e'.repeat(64);
const PAGES = fileURLToPath(new URL('../../fixtures/pages/', import.meta.url));
const LABELS = JSON.parse(readFileSync(`${PAGES}labels.json`, 'utf8')) as Record<string, { url: string; expected: { doi: string } }>;
const RESOLVED = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/backend/resolved-plos.json', import.meta.url)), 'utf8')) as {
  article: Record<string, unknown>;
};

const answerFor = (doi: string, changes: Record<string, unknown> = {}) => ({ ...RESOLVED, article: { ...RESOLVED.article, doi, ...changes } });

async function paired(serviceWorker: Worker): Promise<void> {
  await serviceWorker.evaluate(async (token) => {
    const chrome = (globalThis as unknown as { chrome: { storage: { local: { set(items: object): Promise<void> } } } }).chrome;
    await chrome.storage.local.set({ backendToken: token });
  }, TOKEN);
}

async function openPanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole('status')).toHaveText('Conectado a BioVidGen en esta computadora.');
  return panel;
}

async function openPaper(context: BrowserContext, url: string): Promise<Page> {
  const paper = await context.newPage();
  await paper.goto(url);
  await paper.bringToFront(); // the panel page stands in for the side panel: the paper's tab must be active
  return paper;
}

test('OP3-E2E-01 OP3-SEC-01 a detected paper gets its OpenAlex header; the backend is sent the DOI and nothing else', async ({
  context,
  extensionId,
  serviceWorker,
  sites,
  backend,
  egress,
}) => {
  const { url } = LABELS.plos as { url: string };
  const doi = LABELS.plos?.expected.doi as string;
  sites.set(url, readFileSync(`${PAGES}plos.html`, 'utf8'));
  backend.state = 'on';
  backend.token = TOKEN;
  backend.articles.set(doi, answerFor(doi));
  await paired(serviceWorker);
  const panel = await openPanel(context, extensionId);
  await openPaper(context, url);

  const value = (label: string) => panel.locator(`dt:text-is("${label}") + dd`);
  await expect(value('Autores')).toContainText('Caspar A. Hallmann; Martin Sorg');
  await expect(value('Revista')).toHaveText('PLoS ONE');
  await expect(value('Año')).toHaveText('2017');
  await expect(value('Tipo')).toHaveText('Artículo');
  await expect(value('Palabras clave')).toContainText('flying insects');
  await expect(panel.getByText('Datos de OpenAlex.')).toBeVisible();

  const toBackend = egress.filter((r) => new URL(r.url).host === BACKEND_HOST).map((r) => `${r.method} ${new URL(r.url).pathname}${new URL(r.url).search}`);
  expect([...new Set(toBackend)].sort()).toEqual([`GET /api/v1/article?doi=${encodeURIComponent(doi)}`, 'GET /api/v1/status', 'GET /health']);
  expect(egress.filter((r) => new URL(r.url).host === BACKEND_HOST).every((r) => !r.postData)).toBe(true);
});

test('OP3-UNIT-06 a preprint OpenAlex answers with its journal article: the panel says whose details these are, and shows no type', async ({
  context,
  extensionId,
  serviceWorker,
  pages,
  backend,
}) => {
  const [article] = syntheticArticles(1);
  if (!article) throw new Error('no fixture');
  pages.set(article.path, article.html);
  backend.state = 'on';
  backend.token = TOKEN;
  backend.articles.set('10.1101/2024.01.22.576596', answerFor('10.1101/2024.01.22.576596', { matchedDoi: '10.1007/s12035-026-06127-w', type: 'preprint' }));
  await paired(serviceWorker);
  const panel = await openPanel(context, extensionId);
  await openPaper(context, `https://${FIXTURE_HOST}${article.path}`);
  const field = panel.getByLabel('¿Conoces el DOI? Escríbelo o pégalo aquí');
  await field.fill('10.1101/2024.01.22.576596');
  await field.press('Enter');
  await expect(panel.getByText(/OpenAlex identifica este DOI con otro registro, 10\.1007\/s12035-026-06127-w/)).toBeVisible();
  await expect(panel.locator('dt:text-is("Tipo")')).toHaveCount(0);
});

test('OP3-SEC-02 OP3-UNIT-12 a typed DOI: hostile OpenAlex text stays text, and an unknown DOI is explained', async ({ context, extensionId, serviceWorker, pages, backend }) => {
  const [article] = syntheticArticles(1);
  if (!article) throw new Error('no fixture');
  pages.set(article.path, article.html);
  backend.state = 'on';
  backend.token = TOKEN;
  backend.articles.set('10.1234/hostile', answerFor('10.1234/hostile', { title: '<img src=x onerror="document.title=1">Título real' }));
  await paired(serviceWorker);
  const panel = await openPanel(context, extensionId);
  await openPaper(context, `https://${FIXTURE_HOST}${article.path}`);

  const field = panel.getByLabel('¿Conoces el DOI? Escríbelo o pégalo aquí');
  await field.fill('10.1234/hostile');
  await field.press('Enter');
  await expect(panel.getByText('<img src=x onerror="document.title=1">Título real', { exact: true })).toBeVisible();
  await expect(panel.locator('img')).toHaveCount(0);
  await expect(panel.getByText('todavía no se ha comprobado')).toHaveCount(0); // the lookup is the check now

  await panel.getByRole('button', { name: 'Cambiar DOI' }).click();
  await field.fill('10.1234/unknown');
  await field.press('Enter');
  await expect(panel.getByText('OpenAlex no tiene este DOI. Revisa que esté bien escrito.')).toBeVisible();
});
