import type { browser } from 'wxt/browser';
import { expect, test } from './fixtures';

// Runs inside the extension service worker via `evaluate`; typed with WXT's chrome API types.
declare const chrome: typeof browser;

test('SYS-SEC-22 manifest permission snapshot: only the approved permissions and the ADR-0011 site list', async ({ serviceWorker }) => {
  const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
  // Changing this snapshot is a Type 1 decision: cite the ADR in the PR (CLAUDE.md, SYS-SEC-22).
  expect({
    permissions: [...(manifest.permissions ?? [])].sort(),
    host_permissions: manifest.host_permissions ?? [],
    optional_permissions: manifest.optional_permissions ?? [],
    optional_host_permissions: (manifest as { optional_host_permissions?: string[] }).optional_host_permissions ?? [],
    content_scripts: (manifest.content_scripts ?? []).map((c) => ({ matches: [...(c.matches ?? [])].sort(), js: c.js, all_frames: c.all_frames ?? false })),
    externally_connectable: (manifest as { externally_connectable?: unknown }).externally_connectable,
  }).toEqual({
    permissions: ['sidePanel', 'storage'],
    host_permissions: [],
    optional_permissions: [],
    optional_host_permissions: [],
    content_scripts: [
      {
        // ADR-0011. Adding a site makes Chrome ask existing users to re-approve the extension.
        matches: [
          '*://www.scielo.org.mx/*',
          'https://*.biomedcentral.com/*',
          'https://*.onlinelibrary.wiley.com/*',
          'https://*.scielo.org/*',
          'https://europepmc.org/*',
          'https://journals.plos.org/*',
          'https://link.springer.com/*',
          'https://pmc.ncbi.nlm.nih.gov/*',
          'https://pubmed.ncbi.nlm.nih.gov/*',
          'https://www.biorxiv.org/*',
          'https://www.frontiersin.org/*',
          'https://www.mdpi.com/*',
          'https://www.medrxiv.org/*',
          'https://www.redalyc.org/*',
          'https://www.scielo.br/*',
          'https://www.sciencedirect.com/*',
        ],
        js: ['content-scripts/content.js'],
        all_frames: false,
      },
    ],
    externally_connectable: undefined,
  });
});

test('SVC0-E2E-01 toolbar icon opens the side panel, which shows the empty state in Spanish', async ({ context, serviceWorker, extensionId }) => {
  const behavior = await serviceWorker.evaluate(() => chrome.sidePanel.getPanelBehavior());
  expect(behavior.openPanelOnActionClick).toBe(true);
  const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
  expect((manifest as { side_panel?: { default_path?: string } }).side_panel?.default_path).toBe('sidepanel.html');

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole('heading', { level: 1 })).toHaveText('BioVidGen');
  await expect(panel.getByText('Abre un artículo científico para ver sus datos aquí.')).toBeVisible();
  await expect(panel.locator('html')).toHaveAttribute('lang', 'es');
});

test('SVC0-E2E-02 options page renders', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Opciones de BioVidGen');
});
