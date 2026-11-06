import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toJsonSchemas } from '../../src/contracts/json-schema';
import { collectPythonTitles, collectTestTitles, findUncovered, parseCatalogIds } from '../../scripts/catalog-lib';
import { checkLockfile, isAllowed } from '../../scripts/licenses-lib';

const ROOT = join(import.meta.dirname, '..', '..');

describe('catalog coverage script', () => {
  const md = [
    '| ID | Variant | Given → Expected | Gate |',
    '|---|---|---|---|',
    '| OP5V-PROP-01 🛑 | verbatim | … | PR |',
    '| OP5V-PROP-02 | near quotes | … | PR |',
    '| ~~OP5V-UNIT-09~~ | retired | … | PR |',
    '| OP5-UNIT-01 | stub | … | PR |',
    '| SYS-SEC-01 🛑 | allowlist | … | PR |',
    '| SYS-SEC-010 | not an id | … | PR |',
    'Text mentioning OP5V-PROP-07 outside a table is ignored.',
  ].join('\n');

  it('SVC0-UNIT-21 parses table IDs, marks struck-through IDs retired, ignores prose', () => {
    expect(parseCatalogIds(md)).toEqual([
      { id: 'OP5V-PROP-01', retired: false },
      { id: 'OP5V-PROP-02', retired: false },
      { id: 'OP5V-UNIT-09', retired: true },
      { id: 'OP5-UNIT-01', retired: false },
      { id: 'SYS-SEC-01', retired: false },
    ]);
  });

  it('SVC0-UNIT-22 finds uncovered IDs per unit (OP5 ≠ OP5V; SYS-SEC-01 ≠ SYS-SEC-010)', () => {
    // Built from parts so this file itself never looks like it covers these IDs to `npm run catalog`.
    const [IT, TEST, DESCRIBE] = ['it', 'test', 'describe'];
    const src = [
      `${IT}("OP5V-PROP-01 rejects near-quotes", () => {});`,
      `${TEST}('SYS-SEC-010 something else', () => {});`,
      `${DESCRIBE}(\`OP5-UNIT-01 stub\`, () => {});`,
      `${IT}.each([1])('OP5V-PROP-02 %s', () => {});`,
    ].join('\n');
    const titles = collectTestTitles(src);
    expect(titles).toEqual(['OP5V-PROP-01 rejects near-quotes', 'SYS-SEC-010 something else', 'OP5-UNIT-01 stub', 'OP5V-PROP-02 %s']);
    const ids = parseCatalogIds(md);
    expect(findUncovered(ids, titles, 'OP5V')).toEqual({ covered: ['OP5V-PROP-01', 'OP5V-PROP-02'], uncovered: [] });
    expect(findUncovered(ids, titles.slice(0, 2), 'OP5V')).toEqual({ covered: ['OP5V-PROP-01'], uncovered: ['OP5V-PROP-02'] });
    expect(findUncovered(ids, titles, 'OP5')).toEqual({ covered: ['OP5-UNIT-01'], uncovered: [] });
    expect(findUncovered(ids, titles, 'SYS')).toEqual({ covered: [], uncovered: ['SYS-SEC-01'] });
  });

  it('SVC0-UNIT-22 reads IDs from the docstrings of Python tests, and only from tests', () => {
    const q = '"'.repeat(3);
    const src = [
      `${q}Module docstring naming OP5V-PROP-01 covers nothing.${q}`,
      'def helper() -> None:',
      `    ${q}OP5V-PROP-02 helper, not a test.${q}`,
      'def test_one(db: Path) -> None:',
      `    ${q}OP5V-UNIT-12 OP5V-RES-01 first "quoted" line`,
      '    second line.',
      `    ${q}`,
      'def test_no_docstring() -> None:',
      '    assert True',
      'def test_two(',
      '    a: int,',
      ') -> None:',
      `    ${q}OP5-UNIT-01 multi-line signature.${q}`,
    ].join('\n');
    expect(collectPythonTitles(src)).toEqual(['OP5V-UNIT-12 OP5V-RES-01 first "quoted" line\n    second line.\n    ', 'OP5-UNIT-01 multi-line signature.']);
  });
});

describe('licence gate', () => {
  it('SYS-SEC-30 licence gate: runtime allows only MIT/BSD/Apache-2.0/ISC; GPL family, SSPL and unknown fail everywhere', () => {
    for (const l of ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '(MIT OR Apache-2.0)', 'MIT AND ISC']) {
      expect(isAllowed(l, 'runtime'), l).toBe(true);
    }
    for (const l of ['MPL-2.0', 'BlueOak-1.0.0', 'CC0-1.0', '(MIT OR CC0-1.0)', 'CC-BY-4.0', 'Python-2.0', '0BSD', 'Unlicense']) {
      expect(isAllowed(l, 'dev'), l).toBe(true);
    }
    expect(isAllowed('MPL-2.0', 'runtime')).toBe(false);
    for (const l of ['GPL-3.0', 'GPL-2.0-only', 'AGPL-3.0-or-later', 'LGPL-2.1', 'SSPL-1.0', 'UNLICENSED', 'SEE LICENSE IN LICENSE', undefined, '']) {
      expect(isAllowed(l, 'dev'), String(l)).toBe(false);
      expect(isAllowed(l, 'runtime'), String(l)).toBe(false);
    }
    expect(isAllowed('(MIT OR GPL-3.0)', 'runtime')).toBe(true); // dual licence: we take MIT
    expect(isAllowed('MIT AND GPL-3.0', 'runtime')).toBe(false);
  });

  it('SYS-SEC-30 lockfile check reports offending packages with scope', () => {
    const v = checkLockfile({
      packages: {
        '': {},
        'node_modules/ok': { license: 'MIT' },
        'node_modules/copyleft': { license: 'GPL-3.0' },
        'node_modules/devmpl': { license: 'MPL-2.0', dev: true },
        'node_modules/runmpl': { license: 'MPL-2.0' },
        'node_modules/nolicense': { dev: true },
      },
    });
    expect(v.map((x) => `${x.pkg}:${x.scope}`)).toEqual(['copyleft:runtime', 'runmpl:runtime', 'nolicense:dev']);
  });

  it('SVC0-SEC-04 runtime code imports only runtime dependencies (so the licence gate covers what ships)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    const allowed = new Set([...Object.keys(pkg.dependencies), 'wxt']); // wxt runtime helpers are MIT and bundled
    const files = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
      });
    const bad: string[] = [];
    for (const f of [...files(join(ROOT, 'src')), ...files(join(ROOT, 'entrypoints'))]) {
      for (const m of readFileSync(f, 'utf8').matchAll(/(?:^|\n)\s*(?:import|export)(?!\s+type\b)[^'"]*?from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1] ?? '';
        if (spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('~/')) continue;
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : (spec.split('/')[0] ?? '');
        if (!allowed.has(name)) bad.push(`${f}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('contracts JSON Schema export', () => {
  it('SVC0-TYPE-02 exports draft 2020-12 JSON Schema for each registry entry', () => {
    const out = toJsonSchemas({ Sample: z.strictObject({ doi: z.string(), year: z.number().int().optional() }) });
    expect(Object.keys(out)).toEqual(['Sample']);
    expect(out.Sample).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['doi'],
      additionalProperties: false,
    });
    expect(toJsonSchemas({})).toEqual({});
  });
});
