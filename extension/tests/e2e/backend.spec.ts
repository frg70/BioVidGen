import { checkEgress } from '../support/egress-policy';
import { FIXTURE_HOST, expect, syntheticArticles, test } from './fixtures';

const TOKEN = 'c'.repeat(64);

test('BE1-E2E-01 BE1-A11Y-01 backend off, then started: the student pairs by keyboard and the token leaves the page', async ({ context, extensionId, backend }) => {
  backend.state = 'off';
  backend.token = TOKEN;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const status = panel.getByRole('status');
  await expect(status).toContainText('uv run biovidgen');

  const retry = panel.getByRole('button', { name: 'Reintentar' });
  await retry.press('Enter'); // still off: the keyboard user stays on the button
  await expect(status).toContainText('uv run biovidgen');
  await expect(retry).toBeFocused();

  backend.state = 'on';
  await retry.press('Enter');

  const field = panel.getByLabel('Código de enlace');
  await expect(field).toBeVisible();
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('type', 'password');
  await expect(field).toHaveAttribute('autocomplete', 'off');

  await field.fill('no es un código');
  await field.press('Enter');
  await expect(panel.getByRole('alert')).toContainText('no parece');
  await expect(field).toBeFocused();

  await field.fill('d'.repeat(64));
  await field.press('Enter');
  await expect(panel.getByRole('alert')).toContainText('no lo aceptó');
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();

  await field.fill(TOKEN);
  await field.press('Enter');
  await expect(status).toHaveText('Conectado a BioVidGen en esta computadora.');
  await expect(field).toHaveCount(0);
  expect(await panel.content()).not.toContain(TOKEN);

  await panel.reload();
  await expect(panel.getByRole('status')).toHaveText('Conectado a BioVidGen en esta computadora.');
});

test('BE1-A11Y-01 opening the panel does not pull focus into the pairing field', async ({ context, extensionId, backend }) => {
  backend.state = 'on';
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByLabel('Código de enlace')).toBeVisible();
  await expect(panel.getByLabel('Código de enlace')).not.toBeFocused();
});

test('BE1-E2E-02 a running backend that does not know this extension names the id to allow, instead of saying it is off', async ({ context, extensionId, backend }) => {
  backend.state = 'origin-refused';
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole('status')).toContainText(`BIOVIDGEN_EXTENSION_IDS=${extensionId}`);
  await expect(panel.getByRole('button', { name: 'Reintentar' })).toBeVisible();
});

test('BE1-E2E-03 paper detection and manual DOI keep working while the backend is off', async ({ context, extensionId, backend, pages }) => {
  backend.state = 'off';
  const [article] = syntheticArticles(1);
  if (!article) throw new Error('no fixture');
  pages.set(article.path, article.html);
  const tab = await context.newPage();
  await tab.goto(`https://${FIXTURE_HOST}${article.path}`);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole('status')).toContainText('uv run biovidgen');
  await expect(panel.getByLabel('¿Conoces el DOI? Escríbelo o pégalo aquí')).toBeVisible();
});

test('BE1-SEC-03 SYS-SEC-01 SYS-SEC-02 the backend receives two fixed addresses and nothing about the page', async ({ context, extensionId, backend, egress, pages }) => {
  backend.state = 'on';
  backend.token = TOKEN;
  const articles = syntheticArticles(2);
  for (const a of articles) pages.set(a.path, a.html);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByLabel('Código de enlace').fill(TOKEN);
  await panel.getByLabel('Código de enlace').press('Enter');
  await expect(panel.getByRole('status')).toHaveText('Conectado a BioVidGen en esta computadora.');
  for (const a of articles) {
    const tab = await context.newPage();
    await tab.goto(`https://${FIXTURE_HOST}${a.path}`);
    await tab.close();
  }
  const toBackend = egress.filter((r) => new URL(r.url).host === '127.0.0.1:8765');
  expect(toBackend.length).toBeGreaterThan(0);
  expect([...new Set(toBackend.map((r) => `${r.method} ${new URL(r.url).pathname}${new URL(r.url).search}`))].sort()).toEqual(['GET /api/v1/status', 'GET /health']);
  expect(toBackend.every((r) => !r.postData)).toBe(true);
  expect(checkEgress(egress, { extensionOrigin: `chrome-extension://${extensionId}`, fixtureHosts: [FIXTURE_HOST] })).toEqual([]);
});
