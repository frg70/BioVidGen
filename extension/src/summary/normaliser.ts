/**
 * OP5V normaliser and matcher: the definition of "verbatim" (CLAUDE.md rule 5, OP5V plan §4, §8,
 * delta D8). Exact matching after a fixed, documented normalisation. Never fuzzy.
 *
 * Any change to this file changes what counts as verified: bump NORMALISER_VERSION and append
 * the new hash to normaliser.versions.json (OP5V-CFG-01). The version is part of pipelineVersion.
 */
export const NORMALISER_VERSION = '1';

/** Normalised text plus, per normalised char, the original [start, end) it came from. */
export interface Normalised {
  text: string;
  start: Int32Array;
  end: Int32Array;
}

// One code point plus its combining marks: the unit that is normalised and mapped back.
const CLUSTER = /\P{M}\p{M}*|\p{M}+/uy;
const INVISIBLE = /[\u00AD\u200B-\u200D\uFEFF]/g; // soft hyphen, ZW space/non-joiner/joiner, BOM
const DASHES = /[\u2010-\u2014\u2212]/g; // \u2010 \u2011 \u2012 \u2013 \u2014 \u2212
const DOUBLE_QUOTES = /[\u201C\u201D]/g;
const SINGLE_QUOTES = /[\u2018\u2019]/g;
const SPACE = /\s/;
const WORD = /[\p{L}\p{N}]/u;

/**
 * NFKC (ligatures, \u00B5→\u03BC, superscripts, NBSP), lowercase, dash/quote folding, invisibles removed.
 * Per cluster, so every output char maps to a whole original cluster.
 */
function fold(cluster: string): string {
  return cluster
    .normalize('NFKC')
    .toLowerCase()
    .replace(INVISIBLE, '')
    .replace(DASHES, '-')
    .replace(DOUBLE_QUOTES, '"')
    .replace(SINGLE_QUOTES, "'");
}

/** Folds clusters, collapses whitespace runs to one space and trims. */
export function normalizeWithMap(s: string): Normalised {
  // Typed arrays, no closures: this runs over ~240k chars per paper (OP5V-PERF-01).
  let cap = s.length + 16;
  let out = new Uint16Array(cap);
  let start = new Int32Array(cap);
  let end = new Int32Array(cap);
  let n = 0;
  let spaceFrom = -1; // original range of the pending whitespace run
  let spaceTo = -1;
  let i = 0;
  while (i < s.length) {
    const code = s.charCodeAt(i);
    // Fast path: ASCII not followed by a combining mark (all marks are ≥ U+0300). Same result as fold().
    if (code < 0x80 && !(s.charCodeAt(i + 1) >= 0x300)) {
      if (code === 32 || (code >= 9 && code <= 13)) {
        if (spaceFrom < 0) spaceFrom = i;
        spaceTo = i + 1;
      } else {
        if (n + 2 > cap) {
          cap = cap * 2;
          out = grow(out, new Uint16Array(cap));
          start = grow(start, new Int32Array(cap));
          end = grow(end, new Int32Array(cap));
        }
        if (spaceFrom >= 0 && n > 0) {
          out[n] = 32;
          start[n] = spaceFrom;
          end[n] = spaceTo;
          n++;
        }
        spaceFrom = -1;
        out[n] = code >= 65 && code <= 90 ? code + 32 : code;
        start[n] = i;
        end[n] = i + 1;
        n++;
      }
      i++;
      continue;
    }
    CLUSTER.lastIndex = i;
    const cluster = CLUSTER.exec(s)?.[0] ?? s.charAt(i);
    const to = i + cluster.length;
    const folded = fold(cluster);
    for (let k = 0; k < folded.length; k++) {
      const c = folded.charCodeAt(k);
      if (SPACE.test(folded.charAt(k))) {
        if (spaceFrom < 0) spaceFrom = i;
        spaceTo = to;
        continue;
      }
      if (n + 2 > cap) {
        cap = cap * 2;
        out = grow(out, new Uint16Array(cap));
        start = grow(start, new Int32Array(cap));
        end = grow(end, new Int32Array(cap));
      }
      if (spaceFrom >= 0 && n > 0) {
        out[n] = 32;
        start[n] = spaceFrom;
        end[n] = spaceTo;
        n++;
      }
      spaceFrom = -1;
      out[n] = c;
      start[n] = i;
      end[n] = to;
      n++;
    }
    i = to;
  }
  let text = '';
  // apply, not spread: spreading a typed array is ~8× slower here.
  for (let k = 0; k < n; k += 8192) text += String.fromCharCode.apply(null, out.subarray(k, Math.min(n, k + 8192)) as unknown as number[]);
  return { text, start: start.subarray(0, n), end: end.subarray(0, n) };
}

function grow<T extends Uint16Array | Int32Array>(from: T, to: T): T {
  to.set(from);
  return to;
}

export function normalize(s: string): string {
  return normalizeWithMap(s).text;
}

/**
 * First index of `needle` (already normalised) in `hay` such that the match covers whole
 * original clusters and does not cut a word: a quote may not start or end inside a word
 * ("effective" inside "ineffective") or inside one expanded character (delta D23).
 */
export function findQuote(hay: Normalised, needle: string): number {
  if (needle.length === 0) return -1;
  const { text, start, end } = hay;
  const last = needle.length - 1;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    const j = i + last;
    const wholeClusters = (i === 0 || start[i - 1] !== start[i]) && (j === text.length - 1 || end[j + 1] !== end[j]);
    const cutsWord =
      (i > 0 && WORD.test(text[i - 1] as string) && WORD.test(needle[0] as string)) ||
      (j < text.length - 1 && WORD.test(text[j + 1] as string) && WORD.test(needle[last] as string));
    if (wholeClusters && !cutsWord) return i;
  }
  return -1;
}
