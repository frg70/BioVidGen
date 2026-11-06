/**
 * npm run vectors — writes the shared OP5V test vectors the Python port runs against (ADR-0010 §6).
 * The TypeScript OP5V is the reference, so these are its outputs, frozen. OP5V-PY-03 fails when the
 * reference changes and the vectors were not regenerated.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import type { ArticleText, ProviderMeta } from '../src/contracts/pipeline';
import { canonNumbers, validateDrafts, type Drafts } from '../src/summary/evidence';
import { findQuote, normalize, normalizeWithMap } from '../src/summary/normaliser';
import { buildNearQuote, buildTrueQuote, corpusText, dress, nearQuoteArb, rawContained, tokenContained, trueQuoteArb } from '../tests/support/near-quotes';

const ROOT = join(import.meta.dirname, '..');
const SUMMARY = join(ROOT, 'src', 'summary');
const OUT = join(ROOT, 'fixtures', 'op5v', 'vectors');
const META: ProviderMeta = { provider: 'stub', modelId: 'stub-0', promptHash: 'p0', pipelineVersion: 'pv1' };
const AT = '2026-11-05T12:00:00.000Z';
const DOI = '10.5555/biovidgen.synthetic.1';
const cp = (...codes: number[]) => String.fromCodePoint(...codes);

export function referenceHash(): string {
  const hash = createHash('sha256');
  for (const file of ['normaliser.ts', 'evidence.ts']) hash.update(readFileSync(join(SUMMARY, file), 'utf8').replace(/\r\n/g, '\n'));
  return hash.digest('hex');
}

/** Every code point except surrogates: what the normaliser does to it alone, and how the regexes class it. */
function unicodeTable() {
  const folded: Record<string, string> = {};
  const classes = { marks: /^\p{M}$/u, word: /^[\p{L}\p{N}]$/u, space: /^\s$/ };
  const ranges: Record<keyof typeof classes, [number, number][]> = { marks: [], word: [], space: [] };
  for (let code = 0; code <= 0x10ffff; code++) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    const c = String.fromCodePoint(code);
    const n = normalize(c);
    if (n !== c) folded[code] = n;
    for (const key of Object.keys(classes) as (keyof typeof classes)[]) {
      if (!classes[key].test(c)) continue;
      const list = ranges[key];
      const last = list.at(-1);
      if (last && last[1] === code - 1) last[1] = code;
      else list.push([code, code]);
    }
  }
  return { unicode: process.versions.unicode, folded, ...ranges };
}

function normaliserCases() {
  const curated = [
    '',
    '   ',
    `  The ${cp(0xfb01)}rst${cp(0xa0)}result ${cp(0x2013)} cafe${cp(0x301)} ${cp(0xad)}X${cp(0x200b)} `,
    `${cp(0x201c)}Hola${cp(0x201d)} ${cp(0x2018)}x${cp(0x2019)}`,
    ['2010', '2011', '2012', '2013', '2014', '2212'].map((h) => `5${cp(parseInt(h, 16))}10`).join(' '),
    `a${cp(0xad)}b${cp(0x200b)}c${cp(0x200c)}d${cp(0x200d)}e${cp(0xfeff)}f`,
    `a${cp(0xa0)}b${cp(0x2009)}c${cp(0x202f)} d\n\t e\x0b\x0c\r`,
    'a\x1cb\x1dc\x1ed\x1fe\x85f', // whitespace in Python, not in JavaScript
    `${cp(0x130)}STANBUL ${cp(0x3a3)}${cp(0x391)}${cp(0x3a3)} ${cp(0xdf)} ${cp(0x1e9e)}`, // special case rules
    `50 ${cp(0xb5)}g 10${cp(0x207b, 0xb3)} M m${cp(0xb2)} ${cp(0xb1)} ${cp(0x2264)} ${cp(0x2265)} ${cp(0xd7)}`,
    `emoji ${cp(0x1f600)} and ${cp(0x20000)}${cp(0x20001)} and math ${cp(0x1d400)}`,
    `${cp(0x301)}leading mark, x${cp(0x301, 0x323)}y, ${cp(0x301, 0x302)}`,
    `${cp(0x627, 0x644, 0x639, 0x631, 0x628, 0x64a, 0x629)} ${cp(0x5e9, 0x5dc, 0x5d5, 0x5dd)} ${cp(0xc548, 0xb155)}`,
    `fullwidth ${cp(0xff21, 0xff11)} digits ${cp(0x661, 0x662)} ${cp(0x966)}`,
  ];
  const random = fc.sample(fc.string({ unit: 'binary', maxLength: 60 }), { numRuns: 400, seed: 20261106 });
  return [...curated, ...random].map((input) => {
    const n = normalizeWithMap(input);
    return { input, text: n.text, start: [...n.start], end: [...n.end], numbers: canonNumbers(input) };
  });
}

function findQuoteCases() {
  const hays = [
    'The supplement was ineffective in reducing admissions. Total ' + cp(0xfb01) + 've.',
    'alpha beta gamma delta. alpha beta gamma delta.',
    `caf${cp(0xe9)} au lait cafe${cp(0x301)} au lait`,
    `${cp(0xfb01)}ve and ${cp(0xfb01)}ne`,
  ];
  const needles = ['effective in reducing admissions', 'ineffective in reducing admis', 'ineffective in reducing admissions', 've.', 'admissions. total five.', 'alpha beta gamma delta', 'epsilon', '', 'fi', 've', 'five and', 'ne', 'au lait', `caf${cp(0xe9)} au lait`];
  // Characters that expand to several, some of them not word characters: only the whole-cluster rule stops these.
  const half = cp(0xbd); // folds to 1, U+2044, 2
  const celsius = cp(0x2103); // folds to degree sign, c
  const fraction = cp(0x2044);
  const degree = cp(0xb0);
  const pairs: [string, string][] = [
    [`dose of ${half} tablet`, 'dose of 1'],
    [`${half} tablet daily`, '2 tablet daily'],
    [half, '1' + fraction + '2'],
    [half, fraction + '2'],
    [half, '1' + fraction],
    [`x ${half}`, '1' + fraction + '2'],
    [`x ${celsius} rose`, 'c rose'],
    [`x ${celsius} rose`, `x ${degree}`],
    [`x ${celsius} rose`, `x ${degree}c`],
    [`x ${celsius}`, `x ${degree}c`],
    [`.${cp(0x2026)}`, '...'], // the first candidate cuts the ellipsis; the overlapping second one is whole
    ['foo bar baz quxy', 'foo bar baz qux'], // cuts the last word, one character from the end
    ['foo bar', 'foo bar'],
  ];
  const all: [string, string][] = [...hays.flatMap((hay) => needles.map((needle): [string, string] => [hay, needle])), ...pairs];
  return all.map(([hay, needle]) => ({ hay, needle, index: findQuote(normalizeWithMap(hay), needle) }));
}

interface Case {
  ids: string[];
  doi: string;
  drafts: Drafts;
  text: string;
  meta: ProviderMeta;
  createdAt: string;
  expected: ReturnType<typeof validateDrafts>;
}

function conformance() {
  const fixture = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'op5v', 'article-text.json'), 'utf8')) as ArticleText & { _note?: string };
  delete fixture._note;
  const big = (fixture.sections.results?.text ?? '').repeat(2);
  const texts: Record<string, ArticleText> = {
    fixture,
    corpus: corpusText(),
    twice: corpusText('dom', { results: 'Alpha beta gamma delta epsilon. Zeta. Alpha beta gamma delta epsilon.' }),
    abstractOnly: corpusText('abstract_only', { abstract: fixture.sections.abstract?.text ?? '' }),
    astral: corpusText('dom', { results: `${cp(0x1f600)} Emoji first ${cp(0x1f600)}${cp(0x1f600)} then the quoted words of this section ${cp(0x1f600)} and the end.` }),
    big: corpusText('dom', { methods: big, results: big }),
    half: corpusText('dom', { results: `Participants took a daily dose of ${cp(0xbd)} tablet with water.` }),
    limit: corpusText('dom', { results: `${'word '.repeat(79)}words end. ${'word '.repeat(79)}wordss end.` }),
  };
  const cases: Case[] = [];
  const add = (ids: string[], text: string, drafts: Drafts) => cases.push({ ids, doi: DOI, drafts, text, meta: META, createdAt: AT, expected: validateDrafts(DOI, structuredClone(drafts), texts[text] as ArticleText, META, AT) });

  const q = 'Acute respiratory infections occurred in 81 participants in the vitamin D group';
  const good = { quote: q, section: 'results' };
  const draft = (over: object = {}) => ({ section: 'results', summaryEs: 'Hubo menos infecciones con vitamina D.', evidence: [good], ...over });
  const rr = { quote: `Acute respiratory infections occurred in 81 participants in the vitamin D group and 99 in the placebo group (risk ratio 0.82, 95% CI 0.71${cp(0x2013)}0.94; p=0.004)`, section: 'results' };

  add(['OP5V-UNIT-03'], 'fixture', { sections: [draft({ evidence: [{ quote: 'Of 498 people', section: 'results' }] })] });
  add(['OP5V-UNIT-03'], 'fixture', { sections: [draft({ evidence: [{ quote: 'in the placebo ab', section: 'results' }] })] });
  add(['OP5V-UNIT-03'], 'fixture', { sections: [draft({ evidence: [{ quote: (fixture.sections.methods?.text ?? '').slice(0, 450), section: 'results' }] })] });
  add(['OP5V-UNIT-03'], 'fixture', { sections: [draft({ summaryEs: 'Resumen.', evidence: [{ quote: 'Of 498 people screened', section: 'results' }] })] });
  add(['OP5V-UNIT-04'], 'fixture', { sections: [draft({ summaryEs: 'Resumen.', evidence: [{ quote: 'Our study was not powered to detect differences in hospital admissions', section: 'results' }] })] });
  add(['OP5V-UNIT-05'], 'fixture', { sections: [draft({ evidence: [{ quote: 'test whether the benefit persists beyond 12 months. In this trial, daily vitamin D3', section: 'conclusions' }] })] });
  add(['OP5V-UNIT-06'], 'twice', { sections: [draft({ summaryEs: 'x', evidence: [{ quote: 'alpha beta gamma delta epsilon', section: 'results' }] })] });
  add(['OP5V-UNIT-07'], 'fixture', { sections: [draft({ summaryEs: `RR 0,82 (IC 95 % 0,71${cp(0x2013)}0,94; p = 0,004): 81 frente a 99.`, evidence: [rr] })] });
  add(['OP5V-UNIT-07'], 'fixture', { sections: [draft({ summaryEs: 'RR 0,82 en 2021, con 413 participantes y 95% de reducción.', evidence: [rr] })] });
  add(['OP5V-UNIT-07'], 'fixture', { sections: [draft({ section: 'methodology', summaryEs: 'ECA.', n: 500, statistics: ['RR 0,82'], evidence: [rr] })] });
  add(['OP5V-UNIT-08'], 'fixture', { sections: [draft({ summaryEs: 'Se compararon tres grupos.' })] });
  add(['OP5V-UNIT-09'], 'fixture', { sections: [draft({ evidence: [good, { quote: 'a fabricated sentence that is not in the paper', section: 'results' }] })] });
  add(['OP5V-UNIT-09'], 'fixture', { sections: [draft({ evidence: [] })] });
  add(['OP5V-UNIT-09'], 'fixture', { sections: [draft({ evidence: [], notReported: true })] });
  add(['OP5V-UNIT-09'], 'fixture', { sections: [draft({ summaryEs: 'Hubo 7 casos.' })] });
  add(['OP5V-UNIT-09'], 'fixture', { sections: [{ ...draft(), evidence: 'nope' }] });
  add(['OP5V-UNIT-09'], 'abstractOnly', { sections: [draft({ summaryEs: 'Resumen.', evidence: [good, { quote: `Infections fell by 18% (95% CI 6${cp(0x2013)}29)`, section: 'abstract' }] })] });
  add(['OP5V-UNIT-10'], 'fixture', { sections: [{ section: 'results' }, { section: 'methodology', summaryEs: 1 }] });
  add(['OP5V-UNIT-10'], 'fixture', { sections: [] });
  add(['OP5V-UNIT-11'], 'fixture', { intro: { mainTopic: 'Vitamina D', prerequisiteTopics: ['ensayo clínico', 'riesgo relativo'] }, sections: [draft()] });
  add(['OP5V-UNIT-11'], 'fixture', { intro: { mainTopic: 'x', prerequisiteTopics: ['y'], evidence: [] }, sections: [draft()] });
  add(['OP5V-UNIT-11'], 'fixture', { intro: null, sections: [draft()] });
  add(['OP5V-SEC-02'], 'fixture', { sections: [draft({ summaryEs: '<img src=x onerror=alert(1)><script>alert(2)</script>' })] });
  add(['OP5V-SEC-02'], 'fixture', { sections: [JSON.parse('{"section":"__proto__","summaryEs":"x","evidence":[]}'), { ...draft(), section: 'introduction' }, JSON.parse('{"__proto__":{"polluted":1},"section":"conclusions","summaryEs":"x","evidence":[]}')] });
  add(['OP5V-SEC-03'], 'fixture', { sections: [draft({ summaryEs: 'a'.repeat(2001) })] });
  add(['OP5V-SEC-03'], 'fixture', { sections: [draft({ summaryEs: 'a'.repeat(2000) })] });
  add(['OP5V-SEC-03'], 'fixture', { sections: [draft({ summaryEs: cp(0x1f600).repeat(1001) })] }); // Zod 4 limits count code points
  add(['OP5V-SEC-03'], 'fixture', { sections: [draft({ evidence: Array(6).fill(good) })] });
  add(['OP5V-SEC-03'], 'fixture', { sections: [draft({ evidence: Array(5).fill(good) })] });
  add(['OP5V-PY-01'], 'astral', { sections: [draft({ summaryEs: 'x', evidence: [{ quote: 'then the quoted words of this section', section: 'results' }] })] }); // offsets stay UTF-16
  add(['OP5V-PY-01'], 'fixture', { sections: [draft({ n: 5, evidence: [] })] });
  add(['OP5V-PY-01'], 'fixture', { sections: [draft({ n: 5.5 })] });
  add(['OP5V-PY-01'], 'fixture', { sections: [draft({ n: -1 })] });
  add(['OP5V-PY-01'], 'fixture', { sections: [draft({ n: '5' })] });
  add(['OP5V-PY-01'], 'fixture', { sections: [draft({ n: true })] });
  add(['OP5V-PY-01'], 'fixture', { sections: [draft({ design: null, n: null, coverage: 'partial', statistics: [], notReported: false })] });
  add(['OP5V-PY-01'], 'fixture', { sections: [draft({ coverage: 'most' })] });
  add(['OP5V-PY-01'], 'fixture', { sections: ['not an object', null, 7, ['results'], { section: ['results'] }] });
  add(['OP5V-PY-01'], 'half', { sections: [draft({ summaryEs: 'Resumen.', evidence: [{ quote: 'Participants took a daily dose of 1', section: 'results' }] })] }); // false accept without the whole-cluster rule
  add(['OP5V-UNIT-03'], 'limit', { sections: [draft({ summaryEs: 'Resumen.', evidence: [{ quote: `${'word '.repeat(79)}words`, section: 'results' }] })] }); // exactly 400
  add(['OP5V-UNIT-03'], 'limit', { sections: [draft({ summaryEs: 'Resumen.', evidence: [{ quote: `${'word '.repeat(79)}wordss`, section: 'results' }] })] }); // 401
  add(['OP5V-PY-01'], 'big', { sections: [draft({ section: 'methodology', evidence: [{ quote: 'Acute respiratory infections occurred in 81 participants', section: 'methods' }] })] });

  const near = fc.sample(nearQuoteArb, { numRuns: 4000, seed: 20261105 }).flatMap((p) => {
    const quote = buildNearQuote(p.kind, p.si, p.sj, p.a, p.len, p.k);
    return quote !== null && !tokenContained(quote) && (p.kind === 'midword' || !rawContained(quote)) ? [dress(quote, p.dress)] : [];
  });
  for (const quote of near.slice(0, 500)) add(['OP5V-HYP-01', 'OP5V-PROP-03', 'OP5V-KPI-01'], 'corpus', { sections: [draft({ summaryEs: 'Resumen.', evidence: [{ quote, section: 'results' }] })] });

  const genuine = fc.sample(trueQuoteArb, { numRuns: 1000, seed: 7 }).flatMap((p) => {
    const quote = dress(buildTrueQuote(p.si, p.a, p.len), p.dress);
    return normalize(quote).length >= 20 ? [quote] : [];
  });
  for (const quote of genuine.slice(0, 300)) add(['OP5V-PROP-01', 'OP5V-PROP-02'], 'corpus', { sections: [draft({ summaryEs: 'Resumen.', evidence: [{ quote, section: 'methods' }] })] });

  for (let i = 0; i < 100; i++) {
    const planted = [`${500 + i}`, `${(i / 100).toFixed(2).replace('.', ',')}`, `${i + 1}%`, `p=0,0${(i % 9) + 1}`][i % 4] as string;
    add(['OP5V-HYP-03'], 'fixture', { sections: [draft({ summaryEs: `De 498 personas, 412 aleatorizadas; dato añadido ${planted}.`, evidence: [{ quote: 'Of 498 people screened, 412 were randomised and 389 (94%) completed follow-up', section: 'results' }] })] });
  }

  const pairs = fc.sample(fc.tuple(fc.string({ unit: 'binary', maxLength: 300 }), fc.string({ unit: 'binary', minLength: 20, maxLength: 120 })), { numRuns: 300, seed: 99 });
  pairs.forEach(([section, quote], i) => {
    const key = `fuzz${i}`;
    texts[key] = corpusText('dom', { results: section });
    add(['OP5V-FUZZ-01'], key, { sections: [draft({ summaryEs: quote, evidence: [{ quote, section: 'results' }] })] });
  });
  return { texts, cases };
}

mkdirSync(OUT, { recursive: true });
const write = (name: string, value: unknown) => {
  writeFileSync(join(OUT, name), `${JSON.stringify(value)}\n`);
  console.log(`${name}: ${readFileSync(join(OUT, name)).length} bytes`);
};
write('unicode-table.json', unicodeTable());
write('normaliser.json', { strings: normaliserCases(), findQuote: findQuoteCases() });
const suite = conformance();
write('conformance.json', suite);
write('reference.json', { sha256: referenceHash() });
console.log(`${suite.cases.length} conformance cases`);
