/**
 * npm run catalog -- <UNIT> [--strict]
 * Lists test-catalog IDs for <UNIT> (prefix, e.g. OP5V, SYS, SYS-SEC, SVC0) that no test names.
 * --strict exits 1 when any ID is uncovered.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { collectPythonTitles, collectTestTitles, findUncovered, parseCatalogIds } from './catalog-lib';

const ROOT = join(import.meta.dirname, '..');
const CATALOG = join(ROOT, '..', 'docs', 'testing', 'test-catalog.md');
const BACKEND_TESTS = join(ROOT, '..', 'backend', 'tests');
const SKIP = new Set(['node_modules', '.output', '.wxt', 'playwright-report', 'test-results']);

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return testFiles(p);
    return /\.(test|spec)\.tsx?$/.test(name) ? [p] : [];
  });
}

const args = process.argv.slice(2);
const unit = args.find((a) => !a.startsWith('--'));
if (!unit) {
  console.error('usage: npm run catalog -- <UNIT> [--strict]   e.g. OP5V, SYS-SEC, SVC0');
  process.exit(2);
}
const ids = parseCatalogIds(readFileSync(CATALOG, 'utf8'));
const pythonTests = readdirSync(BACKEND_TESTS).filter((name) => /^test_.*\.py$/.test(name));
const titles = [
  ...testFiles(ROOT).flatMap((f) => collectTestTitles(readFileSync(f, 'utf8'))),
  ...pythonTests.flatMap((name) => collectPythonTitles(readFileSync(join(BACKEND_TESTS, name), 'utf8'))),
];
const { covered, uncovered } = findUncovered(ids, titles, unit);
const total = covered.length + uncovered.length;
if (total === 0) {
  console.error(`No catalog IDs with prefix "${unit}-".`);
  process.exit(2);
}
console.log(`Catalog coverage for ${unit}: ${covered.length}/${total} IDs have a test.`);
if (uncovered.length > 0) {
  console.log(`Uncovered (${uncovered.length}):`);
  for (const id of uncovered) console.log(`  ${id}`);
}
if (args.includes('--strict') && uncovered.length > 0) process.exit(1);
