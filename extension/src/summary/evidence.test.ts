import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ArticleText, ProviderMeta, SectionDraft, SummaryKey } from '../contracts/pipeline';
import {
  buildNearQuote,
  buildTrueQuote,
  corpusText,
  dress,
  nearQuoteArb,
  rawContained,
  tokenContained,
  trueQuoteArb,
} from '../../tests/support/near-quotes';
import { canonNumbers, validateDrafts, type Drafts } from './evidence';
import { normalize } from './normaliser';

const ROOT = join(import.meta.dirname, '..', '..');
const { _note, ...fixture } = JSON.parse(readFileSync(join(ROOT, 'fixtures/op5v/article-text.json'), 'utf8')) as ArticleText & { _note: string };
void _note;
const TEXT: ArticleText = fixture;
const META: ProviderMeta = { provider: 'stub', modelId: 'stub-0', promptHash: 'p0', pipelineVersion: 'pv1' };
const AT = '2026-11-05T12:00:00.000Z';
const DOI = '10.5555/biovidgen.synthetic.1';

const draft = (over: Partial<SectionDraft> = {}): SectionDraft => ({
  section: 'results',
  summaryEs: 'Hubo menos infecciones con vitamina D.',
  evidence: [{ quote: 'Acute respiratory infections occurred in 81 participants in the vitamin D group', section: 'results' }],
  ...over,
});
const run = (sections: unknown[], text: ArticleText = TEXT, intro?: unknown) =>
  validateDrafts(DOI, intro === undefined ? { sections } : { intro, sections }, text, META, AT);
const one = (d: unknown, text: ArticleText = TEXT, key: SummaryKey = 'results') => run([d], text).summary.sections[key];

describe('OP5V validate evidence (pure)', () => {
  it('OP5V-HYP-01 OP5V-KPI-01 0 false accepts on 500 generated near-quotes', () => {
    const text = corpusText();
    let checked = 0;
    fc.assert(
      fc.property(nearQuoteArb, (p) => {
        const q = buildNearQuote(p.kind, p.si, p.sj, p.a, p.len, p.k);
        fc.pre(q !== null && !tokenContained(q) && (p.kind === 'midword' || !rawContained(q)));
        checked++;
        const s = one(draft({ summaryEs: 'Resumen.', evidence: [{ quote: dress(q as string, p.dress), section: 'results' }] }), text);
        expect(s?.status, `${p.kind}/${p.dress}: ${q}`).toBe('no_verificado');
        expect(s?.evidence).toEqual([]);
      }),
      { numRuns: 500, seed: 20261105 },
    );
    expect(checked).toBe(500);
  });

  it('OP5V-PROP-03 each mutation kind is rejected: swap, negation, number, reorder, merge, mid-word cut, cross-section', () => {
    const text = corpusText();
    const cases = [
      'Infections occurred in 81 participants in the vitamin D group and in 99 women', // swap
      'Hospital admissions were not unchanged between groups, at 14 versus 17 events.', // inserted "not"
      'The risk ratio was 8.2 (95% CI 0.71 to 0.94), with p=0.004.', // 0.82 -> 8.2
      'The trial had 80% power to detect a 20% relative reduction at an alpha of 0.5.', // 0.05 -> 0.5
      'The risk ratio was 0.82 (59% CI 0.71 to 0.94), with p=0.004.', // 95 -> 59
      'longer trials are needed, It did not reduce hospital admissions.', // reordered clauses
      'confirmed by a clinician. The supplement was ineffective in reducing', // merged from two places
      'effective in reducing hospital admissions in frail participants.', // cut inside "ineffective"
      'at an alpha of 0.05. Infections occurred in 81 participants', // spans methods -> results
    ];
    for (const q of cases) {
      expect(tokenContained(q), q).toBe(false);
      const s = one(draft({ summaryEs: 'Resumen.', evidence: [{ quote: q, section: 'results' }] }), text);
      expect(s?.status, q).toBe('no_verificado');
      expect(s?.rejected, q).toEqual([{ quote: q, reason: 'NOT_FOUND' }]);
    }
  });

  it('OP5V-PROP-01 OP5V-PROP-02 true quotes with cosmetic variants are verified; verified ⇒ substring; offsets round-trip', () => {
    const text = corpusText();
    fc.assert(
      fc.property(trueQuoteArb, (p) => {
        const q = dress(buildTrueQuote(p.si, p.a, p.len), p.dress);
        fc.pre(normalize(q).length >= 20);
        const res = run([draft({ summaryEs: 'Resumen.', evidence: [{ quote: q, section: 'methods' }] })], text).summary;
        const s = res.sections.results;
        expect(s?.status, q).toBe('verified');
        for (const e of s?.evidence ?? []) {
          const original = text.sections[e.section]?.text ?? '';
          expect(normalize(original).includes(normalize(e.quote))).toBe(true); // PROP-01
          expect(original.slice(e.start, e.end)).toBe(e.quote); // stored quote is the paper's own text
          expect(normalize(e.quote)).toBe(normalize(q)); // PROP-02
        }
      }),
      { numRuns: 300, seed: 7 },
    );
  });

  it('OP5V-PROP-01 OP5V-PROP-02 on the Unicode fixture (NBSP, \u00B5, non-breaking hyphens, ligature, curly quotes, soft hyphen)', () => {
    const quotes: [string, SectionDraft['evidence'][number]['section']][] = [
      ['randomly assigned (1:1) to receive 50 \u00B5g of vitamin D3 daily', 'methods'], // NBSP in paper, ASCII space here
      ['We conducted a double-blind, placebo-controlled randomised trial', 'methods'], // U+2011 in paper
      ['asked to avoid "over-the-counter" supplements during the trial', 'methods'], // curly quotes in paper
      ['These findings are consistent with earlier meta-analyses', 'discussion'], // ligature in paper
      ['Daily vitamin D3 supplementation was associated with fewer respiratory infections', 'conclusions'], // soft hyphen
      ['RISK RATIO 0.82, 95% CI 0.71-0.94; P=0.004', 'results'], // case + en dash
    ];
    for (const [q, section] of quotes) {
      const s = one(draft({ summaryEs: 'Resumen.', evidence: [{ quote: q, section }] }));
      expect(s?.status, q).toBe('verified');
      const e = s?.evidence[0];
      const original = TEXT.sections[section]?.text ?? '';
      expect(normalize(original.slice(e?.start, e?.end))).toBe(normalize(q));
      expect(e?.quote).toBe(original.slice(e?.start, e?.end));
    }
  });

  it('OP5V-PROP-04 same input → byte-identical Summary', () => {
    const drafts: Drafts = {
      intro: { mainTopic: 'Vitamina D', prerequisiteTopics: ['ensayo clínico'] },
      sections: [
        draft(),
        draft({ section: 'methodology', summaryEs: 'ECA con 412 participantes.', evidence: [{ quote: 'The sample size of 412 participants provided 80% power', section: 'methods' }] }),
      ],
    };
    const a = JSON.stringify(validateDrafts(DOI, drafts, TEXT, META, AT));
    const b = JSON.stringify(validateDrafts(DOI, structuredClone(drafts), structuredClone(TEXT), { ...META }, AT));
    expect(a).toBe(b);
  });

  it('OP5V-UNIT-03 length rules: <20 chars or <4 words → QUOTE_TOO_SHORT; >400 chars → QUOTE_TOO_LONG', () => {
    const long = (TEXT.sections.methods?.text ?? '').slice(0, 450);
    for (const [quote, reason] of [
      ['three word quote here', null], // 4 words, 21 chars: allowed length, found? no → NOT_FOUND
      ['Of 498 people screened', null],
      ['Of 498 people', 'QUOTE_TOO_SHORT'], // 3 words
      ['vitamin D3 supple\u00ADmentation', 'QUOTE_TOO_SHORT'], // 3 words, ≥ 20 chars
      ['in the placebo ab', 'QUOTE_TOO_SHORT'], // 4 words, 17 chars
      [long, 'QUOTE_TOO_LONG'],
    ] as const) {
      const s = one(draft({ evidence: [{ quote, section: 'results' }] }));
      if (reason) expect(s?.rejected, quote).toEqual([{ quote, reason }]);
      else expect(s?.rejected.every((r) => r.reason === 'NOT_FOUND'), quote).toBe(true);
    }
    expect(one(draft({ summaryEs: 'Resumen.', evidence: [{ quote: 'Of 498 people screened', section: 'results' }] }))?.status).toBe('verified');
  });

  it('OP5V-UNIT-04 quote found in another section → accepted, section corrected, counted', () => {
    const r = run([draft({ summaryEs: 'Resumen.', evidence: [{ quote: 'Our study was not powered to detect differences in hospital admissions', section: 'results' }] })]);
    expect(r.summary.sections.results?.status).toBe('verified');
    expect(r.summary.sections.results?.evidence[0]?.section).toBe('discussion');
    expect(r.counts.section_mismatch).toBe(1);
  });

  it('OP5V-UNIT-05 quote spanning two sections → rejected', () => {
    const q = 'beyond 12 months. Background: Vitamin D supplementation may reduce';
    const s = one(draft({ evidence: [{ quote: 'test whether the benefit persists beyond 12 months. In this trial, daily vitamin D3', section: 'conclusions' }, { quote: q, section: 'conclusions' }] }));
    expect(s?.rejected.map((r) => r.reason)).toEqual(['NOT_FOUND', 'NOT_FOUND']);
    expect(s?.status).toBe('no_verificado');
  });

  it('OP5V-UNIT-06 quote appearing twice → first occurrence offsets', () => {
    const text = corpusText('dom', { results: 'Alpha beta gamma delta epsilon. Zeta. Alpha beta gamma delta epsilon.' });
    const s = one(draft({ summaryEs: 'x', evidence: [{ quote: 'alpha beta gamma delta epsilon', section: 'results' }] }), text);
    expect(s?.evidence[0]).toMatchObject({ start: 0, end: 30 });
  });

  it('OP5V-UNIT-07 numbers: decimal comma/point, %, ranges, ±, CI, p-values, years, n → each must appear in quotes', () => {
    expect(canonNumbers('IC 95 % 0,71\u20130,94; p<0.001; ±1,5; n=412; 2019; -3 y \u22124; 5-10')).toEqual(['95%', '0.71', '0.94', '0.001', '±1.5', '412', '2019', '-3', '-4', '5', '10']);
    expect(canonNumbers('COVID-19 e IL-6')).toEqual(['19', '6']);
    expect(canonNumbers('sin números')).toEqual([]);
    const q = { quote: 'Acute respiratory infections occurred in 81 participants in the vitamin D group and 99 in the placebo group (risk ratio 0.82, 95% CI 0.71\u20130.94; p=0.004)', section: 'results' as const };
    const ok = one(draft({ summaryEs: 'RR 0,82 (IC 95 % 0,71\u20130,94; p = 0,004): 81 frente a 99.', evidence: [q] }));
    expect(ok?.status).toBe('verified');
    expect(ok?.numbersUnsupported).toEqual([]);
    const bad = one(draft({ summaryEs: 'RR 0,82 en 2021, con 413 participantes y 95% de reducción.', evidence: [q] }));
    expect(bad?.status).toBe('no_verificado');
    expect(bad?.numbersUnsupported).toEqual(['2021', '413']);
    // methodology n and statistics are claims too
    const m = run([draft({ section: 'methodology', summaryEs: 'ECA.', n: 500, statistics: ['RR 0,82'], evidence: [q] })]).summary.sections.methodology;
    expect(m?.numbersUnsupported).toEqual(['500']);
  });

  it('OP5V-HYP-03 numbers rule catches 100 of 100 planted numbers', () => {
    const q = { quote: 'Of 498 people screened, 412 were randomised and 389 (94%) completed follow-up', section: 'results' as const };
    const supported = new Set(canonNumbers(normalize(q.quote)));
    let caught = 0;
    for (let i = 0; i < 100; i++) {
      const planted = [`${500 + i}`, `${(i / 100).toFixed(2).replace('.', ',')}`, `${i + 1}%`, `p=0,0${i % 9 + 1}`][i % 4] as string;
      if ([...canonNumbers(planted)].every((x) => supported.has(x))) continue; // not a planted number
      const s = one(draft({ summaryEs: `De 498 personas, 412 aleatorizadas; dato añadido ${planted}.`, evidence: [q] }));
      if (s?.status === 'no_verificado' && s.numbersUnsupported.length > 0) caught++;
      else throw new Error(`planted ${planted} passed`);
    }
    expect(caught).toBeGreaterThanOrEqual(95);
  });

  it('OP5V-UNIT-08 numbers written as words are a documented gap (not checked)', () => {
    const s = one(draft({ summaryEs: 'Se compararon tres grupos.' }));
    expect(s?.numbersUnsupported).toEqual([]);
    expect(s?.status).toBe('verified');
  });

  it('OP5V-UNIT-09 status rules: bad quote / no quotes / unsupported number → no_verificado; schema fail → failed; abstract_only source', () => {
    const good = draft().evidence[0] as SectionDraft['evidence'][number];
    expect(one(draft())?.status).toBe('verified');
    expect(one(draft({ evidence: [good, { quote: 'a fabricated sentence that is not in the paper', section: 'results' }] }))?.status).toBe('no_verificado');
    expect(one(draft({ evidence: [] }))?.status).toBe('no_verificado');
    expect(one(draft({ evidence: [], notReported: true }))?.status).toBe('no_verificado');
    expect(one(draft({ summaryEs: 'Hubo 7 casos.' }))?.status).toBe('no_verificado');
    expect(one({ ...draft(), evidence: 'nope' })).toMatchObject({ status: 'failed', summaryEs: '', evidence: [], rejected: [] });
    const abs = corpusText('abstract_only', { abstract: TEXT.sections.abstract?.text ?? '' });
    const s = one(draft({ summaryEs: 'Resumen.', evidence: [good, { quote: 'Infections fell by 18% (95% CI 6\u201329)', section: 'abstract' }] }), abs);
    expect(s?.status).toBe('abstract_only');
    expect(s?.evidence.map((e) => e.section)).toEqual(['abstract']); // quotes still validated
    expect(s?.rejected).toEqual([{ quote: good.quote, reason: 'NOT_FOUND' }]);
  });

  it('OP5V-UNIT-10 all sections failed → allFailed', () => {
    expect(run([{ section: 'results' }, { section: 'methodology', summaryEs: 1 }]).allFailed).toBe(true);
    expect(run([]).allFailed).toBe(true);
    expect(run([{ section: 'results' }, draft({ section: 'conclusions', evidence: [] })]).allFailed).toBe(false);
  });

  it('OP5V-UNIT-11 prerequisites are never verified and keep the background_knowledge label', () => {
    const r = run([draft()], TEXT, { mainTopic: 'Vitamina D', prerequisiteTopics: ['ensayo clínico', 'riesgo relativo'] }).summary;
    expect(r.mainTopic).toBe('Vitamina D');
    expect(r.prerequisiteTopics).toEqual([
      { topic: 'ensayo clínico', label: 'background_knowledge' },
      { topic: 'riesgo relativo', label: 'background_knowledge' },
    ]);
    const bad = run([draft()], TEXT, { mainTopic: 'x', prerequisiteTopics: ['y'], evidence: [] }).summary; // invalid intro
    expect([bad.mainTopic, bad.prerequisiteTopics]).toEqual([null, []]);
    expect(run([draft()]).summary.prerequisiteTopics).toEqual([]);
  });

  it('OP5V-SEC-02 hostile draft: HTML kept as inert text; unknown and __proto__ sections rejected without pollution', () => {
    const html = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    expect(one(draft({ summaryEs: html }))?.summaryEs).toBe(html);
    const hostile = [JSON.parse('{"section":"__proto__","summaryEs":"x","evidence":[]}'), { ...draft(), section: 'introduction' }, JSON.parse(`{"__proto__":{"polluted":1},"section":"conclusions","summaryEs":"x","evidence":[]}`)];
    const r = run(hostile);
    expect(Object.keys(r.summary.sections)).toEqual(['conclusions']);
    expect(r.summary.sections.conclusions?.status).toBe('failed');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(r.counts.drafts_invalid).toBe(3);
  });

  it('OP5V-SEC-03 oversize draft: >2,000 chars or >5 quotes → failed', () => {
    expect(one(draft({ summaryEs: 'a'.repeat(2001) }))?.status).toBe('failed');
    expect(one(draft({ summaryEs: 'a'.repeat(2000) }))?.status).not.toBe('failed');
    const q = draft().evidence[0] as SectionDraft['evidence'][number];
    expect(one(draft({ evidence: Array(6).fill(q) }))?.status).toBe('failed');
    expect(one(draft({ evidence: Array(5).fill(q) }))?.status).toBe('verified');
  });

  it('OP5V-FUZZ-01 random unicode in drafts and sections: no throw, no false accept', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), fc.string({ unit: 'binary', minLength: 20, maxLength: 120 }), (section, quote) => {
        const text = corpusText('dom', { results: section });
        const s = one(draft({ summaryEs: quote, evidence: [{ quote, section: 'results' }] }), text);
        if (s?.status === 'verified') expect(normalize(section).includes(normalize(quote))).toBe(true);
        for (const e of s?.evidence ?? []) expect(normalize(section.slice(e.start, e.end))).toBe(normalize(quote));
      }),
      { numRuns: 1000, seed: 99 },
    );
  });

  // D26 (owner, 2026-11-05): assert the plan §7 fail line (100 ms); 20 ms is the target, printed and tracked.
  it('OP5V-PERF-01 4 sections × 5 quotes on 60k-char sections: p95 ≤ 100 ms (target 20 ms)', () => {
    const base = TEXT.sections.results?.text ?? '';
    const big = (base + ' ').repeat(Math.ceil(60_000 / base.length)).slice(0, 60_000);
    const text = corpusText('dom', { methods: big, results: big, discussion: big, conclusions: big });
    const q = (s: string) => Array.from({ length: 5 }, () => ({ quote: 'No serious adverse events were attributed to the intervention', section: s as 'results' }));
    const drafts = [
      draft({ section: 'methodology', evidence: q('methods') }),
      draft({ section: 'results', evidence: q('results') }),
      draft({ section: 'conclusions', evidence: q('conclusions') }),
      draft({ section: 'results', evidence: q('discussion') }),
    ];
    const times: number[] = [];
    for (let i = 0; i < 25; i++) {
      const t0 = performance.now();
      run(drafts, text);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1] as number;
    console.info(`OP5V-PERF-01 p50=${times[12]?.toFixed(1)} ms p95=${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThanOrEqual(100);
  });
});
