import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findQuote, normalize, normalizeWithMap, NORMALISER_VERSION } from './normaliser';

describe('OP5V normaliser', () => {
  it('OP5V-UNIT-01 normaliser table: quotes, dashes, ligatures, invisibles, spaces, NFC/NFD, case', () => {
    expect(normalize('\u201CHola\u201D \u2018x\u2019')).toBe(`"hola" 'x'`);
    for (const d of ['\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2212']) expect(normalize(`5${d}10`), d).toBe('5-10');
    expect(normalize('\uFB01ndings \uFB02ow')).toBe('findings flow'); // NFKC ligatures
    expect(normalize('a\u00ADb\u200Bc\u200Cd\u200De\uFEFFf')).toBe('abcdef'); // soft hyphen, ZW chars, BOM removed
    expect(normalize('  a\u00A0b\u2009c\u202F d\n\t e  ')).toBe('a b c d e'); // NBSP, thin, narrow NBSP, runs, trim
    expect(normalize('cafe\u0301')).toBe(normalize('café')); // NFD == NFC
    expect(normalize('café')).toBe('café');
    expect(normalize('ÁRBOL Δ Ñ')).toBe('árbol δ ñ'); // case folding
    expect(normalize('')).toBe('');
    expect(normalize(' \u00AD\u200B ')).toBe('');
  });

  it('OP5V-UNIT-02 scientific symbols: NFKC only (D-T6 resolved): micro→mu, superscripts fold; ± ≤ ≥ × α β unchanged', () => {
    const cp = (...c: number[]) => String.fromCharCode(...c);
    const MICRO = cp(0xb5); // µ MICRO SIGN
    const MU = cp(0x3bc); // μ GREEK SMALL LETTER MU
    expect(normalize(`50 ${MICRO}g`)).toBe(`50 ${MU}g`);
    expect(normalize(`50 ${MICRO}g`)).toBe(normalize(`50 ${MU}g`));
    expect(normalize(`10${cp(0x207b, 0xb3)} M`)).toBe('10-3 m'); // superscript minus + three
    expect(normalize(`m${cp(0xb2)}`)).toBe('m2');
    expect(normalize('± ≤ ≥ × α β')).toBe('± ≤ ≥ × α β');
    expect(normalize('A ≥ B')).not.toBe(normalize('A > B')); // no extra folds: ≥ is not >
  });

  it('OP5V-PROP-02 offset map: every normalised char maps to an original range that normalises to it', () => {
    const s = '  The \uFB01rst\u00A0result \u2013 cafe\u0301 \u00ADX\u200B ';
    const n = normalizeWithMap(s);
    expect(n.text).toBe('the first result - café x');
    expect(n.start).toHaveLength(n.text.length);
    expect(n.end).toHaveLength(n.text.length);
    // 'fi' both come from the ligature at original index 6
    const fi = n.text.indexOf('fi');
    expect([n.start[fi], n.end[fi], n.start[fi + 1], n.end[fi + 1]]).toEqual([6, 7, 6, 7]);
    // 'é' comes from 'e' + combining acute (two code units)
    const e = n.text.indexOf('é');
    expect(s.slice(n.start[e], n.end[e])).toBe('e\u0301');
  });

  it('OP5V-UNIT-06 findQuote returns the first occurrence', () => {
    const hay = normalizeWithMap('alpha beta gamma delta. alpha beta gamma delta.');
    expect(findQuote(hay, 'alpha beta gamma delta')).toBe(0);
    expect(findQuote(hay, 'epsilon zeta')).toBe(-1);
  });

  it('OP5V-PROP-03 findQuote never starts or ends inside a word or inside an expanded character', () => {
    const hay = normalizeWithMap('The supplement was ineffective in reducing admissions. Total \uFB01ve.');
    expect(findQuote(hay, 'effective in reducing admissions')).toBe(-1); // inside "ineffective"
    expect(findQuote(hay, 'ineffective in reducing admis')).toBe(-1); // cut inside "admissions"
    expect(findQuote(hay, 'ineffective in reducing admissions')).toBeGreaterThan(0);
    expect(findQuote(hay, 'ive.')).toBe(-1); // starts inside the ligature + word
    expect(findQuote(hay, 'admissions. total five.')).toBeGreaterThan(0);
  });

  it('OP5V-CFG-01 normaliser version guard: normaliser.ts content is pinned to NORMALISER_VERSION', () => {
    const src = readFileSync(join(import.meta.dirname, 'normaliser.ts'), 'utf8').replace(/\r\n/g, '\n');
    const hash = createHash('sha256').update(src).digest('hex');
    const lock = JSON.parse(readFileSync(join(import.meta.dirname, 'normaliser.versions.json'), 'utf8')) as Record<string, string>;
    expect(
      lock[NORMALISER_VERSION],
      `normaliser.ts changed (sha256 ${hash}). Bump NORMALISER_VERSION and append "<new version>": "<hash>" to normaliser.versions.json. Never edit an existing entry.`,
    ).toBe(hash);
    expect(new Set(Object.values(lock)).size, 'two versions share one hash').toBe(Object.keys(lock).length);
  });
});
