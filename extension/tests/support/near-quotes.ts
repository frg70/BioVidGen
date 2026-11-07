import fc from 'fast-check';
import type { ArticleText, SectionName } from '../../src/contracts/pipeline';

/**
 * Adversarial near-quote generator for OP5V (H1, OP5V-PROP-03). Works on a plain ASCII corpus
 * so the oracle below (lowercase + whitespace split) is obviously correct and independent of
 * the Unicode normaliser under test. Cosmetic "dressing" then adds Unicode variants that a
 * correct normaliser must undo without changing the verdict.
 */
export const CORPUS: Partial<Record<SectionName, string>> = {
  methods:
    'We enrolled 412 adults aged 65 to 85 years from 12 clinics. Participants received 50 micrograms of vitamin D3 daily or a matching placebo for 12 months. ' +
    'The primary outcome was the number of acute respiratory infections, confirmed by a clinician. Allocation was concealed, and outcome assessors were masked to group assignment. ' +
    'The trial had 80% power to detect a 20% relative reduction at an alpha of 0.05.',
  results:
    'Infections occurred in 81 participants in the vitamin D group and in 99 participants in the placebo group. The risk ratio was 0.82 (95% CI 0.71 to 0.94), with p=0.004. ' +
    'Hospital admissions were unchanged between groups, at 14 versus 17 events. The supplement was ineffective in reducing hospital admissions in frail participants. ' +
    'Serum vitamin D increased from 42 to 78 nmol/L in the double-blind treated group.',
  conclusions:
    'Daily vitamin D3 was associated with fewer respiratory infections in older adults. It did not reduce hospital admissions, and longer trials are needed. ' +
    'The benefit was consistent across age groups, although the study was not powered for subgroups.',
};

export function corpusText(source: ArticleText['source'] = 'dom', sections = CORPUS): ArticleText {
  return {
    doi_norm: '10.1234/corpus',
    contentHash: 'c0',
    source,
    sections: Object.fromEntries(Object.entries(sections).map(([k, text]) => [k, { text, headingSeen: k, mergedWith: null }])),
    missing: [],
    language: 'en',
    usable: true,
    truncated: false,
    headingsVersion: 'h1',
    schemaVersion: 1,
  };
}

interface Sentence {
  section: SectionName;
  index: number; // position within its section
  words: string[];
}

const SENTENCES: Sentence[] = Object.entries(CORPUS).flatMap(([section, text]) =>
  text.split(/(?<=\.)\s+/).map((s, index) => ({ section: section as SectionName, index, words: s.split(' ') })),
);
const VOCAB = ['increased', 'decreased', 'children', 'weekly', 'severe', 'mild', 'higher', 'lower', 'women', 'men', 'fewer', 'more', 'placebo'];

const tokens = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);

/** True when `quote` is a run of whole words of one section (the meaning of "verbatim excerpt"). */
export function tokenContained(quote: string, sections = CORPUS): boolean {
  const q = tokens(quote);
  return Object.values(sections).some((text) => {
    const t = tokens(text);
    for (let i = 0; i + q.length <= t.length; i++) if (q.every((w, j) => t[i + j] === w)) return true;
    return false;
  });
}

/** True when `quote` occurs anywhere as a raw substring (lowercase, whitespace collapsed). */
export function rawContained(quote: string, sections = CORPUS): boolean {
  const q = tokens(quote).join(' ');
  return Object.values(sections).some((text) => tokens(text).join(' ').includes(q));
}

export const MUTATIONS = ['swap', 'negate', 'number', 'reorder', 'merge', 'midword', 'span'] as const;
export type Mutation = (typeof MUTATIONS)[number];

const pick = <T>(xs: readonly T[], n: number): T => xs[n % xs.length] as T;

function windowOf(s: Sentence, a: number, len: number): { start: number; words: string[] } {
  const n = Math.min(len, s.words.length);
  const start = a % (s.words.length - n + 1);
  return { start, words: s.words.slice(start, start + n) };
}

function mutateNumber(w: string, k: number): string | null {
  const m = /\d+(?:\.\d+)?/.exec(w);
  if (!m) return null;
  const d = m[0];
  const options = [
    d.includes('.0') ? d.replace('.0', '.') : null, // 0.05 -> 0.5
    d.includes('.') ? String(Number(d) * 10) : null, // 0.82 -> 8.2
    d.length > 1 ? [...d].reverse().join('') : null, // 95 -> 59
    String(Number(d) + 1), // 412 -> 413
  ].filter((x): x is string => x !== null && x !== d);
  if (options.length === 0) return null;
  return w.replace(d, pick(options, k));
}

/** Builds one near-quote, or null when the drawn parameters do not apply to the sentence. */
export function buildNearQuote(kind: Mutation, si: number, sj: number, a: number, len: number, k: number): string | null {
  const s = pick(SENTENCES, si);
  const { words } = windowOf(s, a, len);
  const at = 1 + (k % Math.max(1, words.length - 1)); // never the first word, so the change is inside
  switch (kind) {
    case 'swap': {
      const out = [...words];
      out[at] = pick(VOCAB.filter((v) => v !== out[at]), k);
      return out.join(' ');
    }
    case 'negate':
      return [...words.slice(0, at), pick(['not', 'no'], k), ...words.slice(at)].join(' ');
    case 'number': {
      const i = words.findIndex((w) => /\d/.test(w));
      if (i < 0) return null;
      const changed = mutateNumber(words[i] as string, k);
      if (changed === null) return null;
      const out = [...words];
      out[i] = changed;
      return out.join(' ');
    }
    case 'reorder': {
      const text = s.words.join(' ');
      const c = text.indexOf(', ');
      if (c < 0) return null;
      return `${text.slice(c + 2).replace(/\.$/, '')}, ${text.slice(0, c)}.`;
    }
    case 'merge': {
      const t = pick(SENTENCES, sj);
      if (t === s || (t.section === s.section && Math.abs(t.index - s.index) === 1)) return null;
      return [...s.words.slice(-4), ...t.words.slice(0, 4)].join(' ');
    }
    case 'midword': {
      const first = words[0] ?? '';
      if (!/^[a-z]{5}/i.test(first)) return null; // cut two letters off a real word
      return [first.slice(2), ...words.slice(1)].join(' ');
    }
    case 'span': {
      // Last words of one section + first words of the next: crosses a section boundary.
      const sections = Object.values(CORPUS);
      const i = si % (sections.length - 1);
      const end = (sections[i] as string).split(' ').slice(-4);
      const begin = (sections[i + 1] as string).split(' ').slice(0, 4);
      return [...end, ...begin].join(' ');
    }
  }
}

/** A true quote: whole words of one sentence, ≥ 5 words. */
export function buildTrueQuote(si: number, a: number, len: number): string {
  return windowOf(pick(SENTENCES, si), a, Math.max(5, len)).words.join(' ');
}

/**
 * Cosmetic variants a model (or PDF/HTML pipeline) may introduce. Each is undone by the
 * normaliser, so they must never flip a verdict.
 */
export type Dress = 'none' | 'upper' | 'nbsp' | 'spaces' | 'softhyphen' | 'zwsp' | 'endash' | 'decomposed';
export const DRESSES: readonly Dress[] = ['none', 'upper', 'nbsp', 'spaces', 'softhyphen', 'zwsp', 'endash', 'decomposed'];

export function dress(q: string, d: Dress): string {
  switch (d) {
    case 'none':
      return q;
    case 'upper':
      return q.toUpperCase();
    case 'nbsp':
      return q.replace(/ /g, '\u00A0');
    case 'spaces':
      return ` ${q.replace(/ /g, ' \n\t ')} `;
    case 'softhyphen':
      return q.replace(/([a-z]{3})([a-z]{3})/i, '$1\u00AD$2');
    case 'zwsp':
      return q.replace(/([a-z])([a-z])/i, '$1\u200B$2');
    case 'endash':
      return q.replace(/-/g, '\u2013');
    case 'decomposed':
      return q.normalize('NFD');
  }
}

export const nearQuoteArb = fc.record({
  kind: fc.constantFrom(...MUTATIONS),
  si: fc.nat(1000),
  sj: fc.nat(1000),
  a: fc.nat(1000),
  len: fc.integer({ min: 6, max: 14 }),
  k: fc.nat(1000),
  dress: fc.constantFrom(...DRESSES),
});

export const trueQuoteArb = fc.record({
  si: fc.nat(1000),
  a: fc.nat(1000),
  len: fc.integer({ min: 5, max: 20 }),
  dress: fc.constantFrom(...DRESSES),
});
