/** Catalog coverage: which test-catalog IDs for a unit have no test with that ID in its title. */
export interface CatalogId {
  id: string;
  retired: boolean;
}

const ID_CELL = /^(~~)?([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2})(?:~~)?(?=\s|$)/;

/** IDs from the first cell of every table row in test-catalog.md. Struck-through IDs are retired. */
export function parseCatalogIds(markdown: string): CatalogId[] {
  const seen = new Map<string, CatalogId>();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cell = (line.split('|')[1] ?? '').trim();
    const m = ID_CELL.exec(cell);
    const id = m?.[2];
    if (id && !seen.has(id)) seen.set(id, { id, retired: m[1] === '~~' });
  }
  return [...seen.values()];
}

const TITLE = /\b(?:it|test|describe)(?:\.\w+)*(?:\([^()]*\))?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** Titles of it/test/describe calls (string literal first argument) in a test source file. */
export function collectTestTitles(source: string): string[] {
  return [...source.matchAll(TITLE)].map((m) => m[2] ?? '');
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Active IDs with prefix `${unit}-` that appear in no title (ID followed by a non-digit). */
export function findUncovered(ids: CatalogId[], titles: string[], unit: string): { covered: string[]; uncovered: string[] } {
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const { id, retired } of ids) {
    if (retired || !id.startsWith(`${unit}-`)) continue;
    const re = new RegExp(`(^|[^A-Z0-9-])${escape(id)}(?![0-9])`);
    (titles.some((t) => re.test(t)) ? covered : uncovered).push(id);
  }
  return { covered, uncovered };
}
