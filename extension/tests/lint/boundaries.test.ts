import { join } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const eslint = new ESLint({ cwd: ROOT });

/** Rule ids reported for `code` as if it lived at `file` (relative to the extension root). */
async function lint(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.ruleId ?? `fatal: ${m.message}`);
}
const imp = (spec: string) => `import { x } from '${spec}';\nexport const y = x;\n`;

describe('boundary lint (eslint-rules/boundaries.js)', () => {
  // ESLint loads the typescript-eslint config on first use (~8 s cold); keep that out of test timeouts.
  beforeAll(() => lint('src/core/warmup.ts', 'export {};\n'), 60_000);

  it('SYS-SEC-26 module dependency rules from tech-spec-v3 §2', async () => {
    const BAD = ['local/boundaries'];
    expect(await lint('src/detect/detect.ts', imp('../scholarly/resolve'))).toEqual(BAD);
    expect(await lint('src/detect/detect.ts', imp('../core/log'))).toEqual([]);
    expect(await lint('src/core/log.ts', imp('../summary/summarize'))).toEqual(BAD);
    expect(await lint('src/core/http.ts', imp('@/src/settings/settings'))).toEqual(BAD);
    expect(await lint('src/summary/summarize.ts', imp('../text/segment'))).toEqual([]);
    expect(await lint('src/summary/summarize.ts', imp('../scholarly/resolve'))).toEqual([]);
    expect(await lint('src/workspace/export.ts', imp('../summary/summarize'))).toEqual([]);
    expect(await lint('src/scholarly/resolve.ts', imp('../summary/summarize'))).toEqual(BAD);
    expect(await lint('src/text/segment.ts', imp('../detect/detect'))).toEqual(BAD);
    expect(await lint('src/scholarly/status.ts', `export const f = () => import('../workspace/export');\n`)).toEqual(BAD);
  });

  it('OP5V-SEC-01 sole writer of Summary: only summary/validate.ts imports the summaries repository (lint + real tree)', async () => {
    const BAD = ['local/boundaries'];
    expect(await lint('src/summary/validate.ts', imp('../core/db/repos/summaries'))).toEqual([]);
    // Test files are exempt from the boundary rule (SVC0 design); the real-tree scan below covers production code.
    for (const f of ['src/summary/evidence.ts', 'src/summary/normaliser.ts', 'src/summary/summarize.ts', 'src/summary/providers/nano.ts']) {
      expect(await lint(f, imp(f.split('/').length > 3 ? '../../core/db/repos/summaries' : '../core/db/repos/summaries')), f).toEqual(BAD);
    }
    // The real tree: no other source file names the summaries repository.
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((x) => (statSync(join(d, x)).isDirectory() ? walk(join(d, x)) : /\.tsx?$/.test(x) ? [join(d, x)] : []));
    const importers = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'entrypoints'))]
      .filter((f) => /repos\/summaries['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/'))
      .filter((f) => !f.startsWith('src/core/db/')); // core/db owns the repositories and their tests
    expect(importers).toEqual(['src/summary/validate.ts']);
  });

  it('SYS-SEC-26 one writer per store: only the owner imports its repository', async () => {
    const BAD = ['local/boundaries'];
    expect(await lint('src/summary/validate.ts', imp('../core/db/repos/summaries'))).toEqual([]);
    expect(await lint('src/summary/summarize.ts', imp('../core/db/repos/summaries'))).toEqual(BAD);
    expect(await lint('src/workspace/export.ts', imp('../core/db/repos/summaries'))).toEqual(BAD);
    expect(await lint('src/scholarly/resolve.ts', imp('../core/db/repos/articles'))).toEqual([]);
    expect(await lint('src/workspace/export.ts', imp('../core/db/repos/articles'))).toEqual(BAD);
    expect(await lint('src/text/segment.ts', imp('../core/db/repos/texts'))).toEqual([]);
    expect(await lint('src/workspace/feedback.ts', imp('../core/db/repos/feedback'))).toEqual([]);
    expect(await lint('src/core/log-sink.ts', imp('./db/repos/logs'))).toEqual([]);
    expect(await lint('src/scholarly/resolve.ts', imp('../core/db/repos/logs'))).toEqual(BAD);
    expect(await lint('src/scholarly/resolve.ts', imp('../core/db/schema'))).toEqual(BAD);
    expect(await lint('entrypoints/sidepanel/main.tsx', imp('../../src/core/db/repos/summaries'))).toEqual(BAD);
    expect(await lint('src/core/db/repos/articles.ts', imp('../schema'))).toEqual([]);
  });

  it('SYS-SEC-26 network only from client/provider folders; keys only from providers', async () => {
    const BAD = ['local/boundaries'];
    expect(await lint('src/scholarly/clients/openalex.ts', imp('../../core/http'))).toEqual([]);
    expect(await lint('src/summary/providers/ollama.ts', imp('../../core/http'))).toEqual([]);
    expect(await lint('src/scholarly/resolve.ts', imp('../core/http'))).toEqual(BAD);
    expect(await lint('src/detect/detect.ts', imp('../core/http'))).toEqual(BAD);
    expect(await lint('src/summary/providers/nano.ts', imp('../../settings/keys'))).toEqual([]);
    expect(await lint('src/scholarly/clients/openalex.ts', imp('../../settings/keys'))).toEqual(BAD);
    expect(await lint('src/scholarly/clients/openalex.ts', `export const r = fetch('https://x');\n`)).toEqual(['no-restricted-globals']);
    expect(await lint('src/detect/detect.ts', `export const s = new WebSocket('wss://x');\n`)).toEqual(['no-restricted-globals']);
  });

  it('SYS-SEC-20 no innerHTML with external data: HTML sinks are lint errors', async () => {
    const sinks = [
      `export function f(el: HTMLElement, s: string) { el.innerHTML = s; }\n`,
      `export function f(el: HTMLElement, s: string) { el.outerHTML = s; }\n`,
      `export function f(el: HTMLElement, s: string) { el.insertAdjacentHTML('beforeend', s); }\n`,
      `export function f(s: string) { document.write(s); }\n`,
    ];
    for (const code of sinks) expect(await lint('src/text/render.ts', code)).toContain('no-restricted-syntax');
    expect(await lint('entrypoints/sidepanel/app.tsx', `export const A = (p: { s: string }) => <div dangerouslySetInnerHTML={{ __html: p.s }} />;\n`)).toContain(
      'no-restricted-syntax',
    );
    expect(await lint('src/text/render.ts', `export function f(el: HTMLElement, s: string) { el.textContent = s; }\n`)).toEqual([]);
  });

  it('SYS-SEC-12 chrome.storage.sync is a lint error', async () => {
    expect(await lint('src/settings/settings.ts', `import { browser } from 'wxt/browser';\nexport const p = browser.storage.sync.set({ k: 1 });\n`)).toEqual([
      'no-restricted-syntax',
    ]);
    expect(await lint('src/settings/settings.ts', `import { browser } from 'wxt/browser';\nexport const p = browser.storage.local.set({ k: 1 });\n`)).toEqual([]);
  });
});
