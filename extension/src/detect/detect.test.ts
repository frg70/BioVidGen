import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { DetectedPageSchema, DOI_PATTERN } from '../contracts/page-context';
import { detectPaper, doiFromUrl, DEFAULT_RULES, normalizeDoi, safeDetect } from './detect';
import sites from './sites.json';

const ROOT = join(import.meta.dirname, '..', '..', 'fixtures', 'pages');
const HOST = 'https://journal.example';
const doc = (html: string, url = `${HOST}/paper/1`) => new JSDOM(html, { url }).window.document;
const detect = (html: string, url = `${HOST}/paper/1`) => detectPaper(doc(html, url), new URL(url), DEFAULT_RULES);
const meta = (name: string, content: string) => `<meta name="${name}" content="${content}">`;

interface Label {
  url: string;
  origin: 'real' | 'synthetic';
  expected: Record<string, unknown>;
}
const LABELS = JSON.parse(readFileSync(join(ROOT, 'labels.json'), 'utf8')) as Record<string, Label>;
const fixture = (name: string) => {
  const label = LABELS[name] as Label;
  return detectPaper(doc(readFileSync(join(ROOT, `${name}.html`), 'utf8'), label.url), new URL(label.url), DEFAULT_RULES);
};

describe('OP1 normalizeDoi', () => {
  it('OP1-UNIT-01 normalisation: prefixes, encoding, case, trailing punctuation, whitespace', () => {
    for (const raw of [
      'https://doi.org/10.1000/ABC',
      'http://dx.doi.org/10.1000/abc',
      'https://www.doi.org/10.1000/abc',
      'doi:10.1000/abc.',
      'DOI: 10.1000/abc',
      'doi:10.1000/abc',
      '10.1000%2Fabc',
      '  10.1000/abc;  ',
      '10.1000/abc,',
      '10.1000/abc)',
      '10.1000/abc].',
    ]) {
      expect(normalizeDoi(raw), raw).toBe('10.1000/abc');
    }
  });

  it('OP1-UNIT-02 exotic valid DOIs: parentheses, SICI, semicolons; a balanced closing parenthesis stays', () => {
    expect(normalizeDoi('10.1016/S0140-6736(20)30183-5')).toBe('10.1016/s0140-6736(20)30183-5');
    expect(normalizeDoi('10.1002/(SICI)1096-8644(199601)99:1<1::AID-AJPA1>3.0.CO;2-1')).toBe('10.1002/(sici)1096-8644(199601)99:1<1::aid-ajpa1>3.0.co;2-1');
    expect(normalizeDoi('10.1000/a;b')).toBe('10.1000/a;b');
    expect(normalizeDoi('10.1000/abc(1)')).toBe('10.1000/abc(1)'); // real ending, not sentence punctuation
    expect(normalizeDoi('(10.1000/abc(1))')).toBeNull(); // not a DOI as written
  });

  it('OP1-UNIT-03 invalid DOIs and HTML-laden input → null', () => {
    for (const raw of ['10.12/x', '10.1234', '10.1234/', 'not a doi', '', '   ', null, undefined, '%E0%A4%A', '10.1234/a b', '10.1234/<b>x</b>']) {
      expect(normalizeDoi(raw), String(raw)).toBeNull();
    }
  });

  it('OP1-SEC-02 hostile meta: markup and script in a DOI are rejected', () => {
    for (const raw of [
      '10.1/x"><img src=x onerror=alert(1)>',
      '10.1234/x"><img src=x onerror=alert(1)>',
      '10.1234/<script>alert(1)</script>',
      '10.1234/<img/src=x/onerror=alert(1)>',
      '10.1234/x>y',
      'javascript:alert(1)',
    ]) {
      expect(normalizeDoi(raw), raw).toBeNull();
      expect(detect(`<head>${meta('citation_doi', raw.replace(/"/g, '&quot;'))}</head>`).doi, raw).toBeNull();
    }
  });

  it('OP1-PROP-03 normaliser idempotent; output matches the strict pattern or is null', () => {
    const doiLike = fc.tuple(fc.integer({ min: 1000, max: 999999 }), fc.string({ unit: fc.constantFrom(...'abcXYZ019-._;()/:<>'), maxLength: 30 }), fc.constantFrom('', '.', ',', ')', ';', ' ')).map(([p, s, t]) => `10.${p}/${s}${t}`);
    fc.assert(
      fc.property(fc.oneof(fc.string(), doiLike), (raw) => {
        const once = normalizeDoi(raw);
        expect(normalizeDoi(once)).toBe(once);
        if (once !== null) expect(once).toMatch(DOI_PATTERN);
      }),
      { numRuns: 2000, seed: 20261105 },
    );
  });
});

describe('OP1 doiFromUrl', () => {
  it('OP1-UNIT-15 URL views: view suffixes are not part of the DOI (no wrong DOI from AMP, print, PDF or tab URLs)', () => {
    const cases: [string, string | null, number | null][] = [
      ['https://www.frontiersin.org/articles/10.3389/fpubh.2020.00152/full', '10.3389/fpubh.2020.00152', null],
      ['https://www.frontiersin.org/journals/public-health/articles/10.3389/fpubh.2020.00152/pdf', '10.3389/fpubh.2020.00152', null],
      ['https://onlinelibrary.wiley.com/doi/full/10.1002/jmv.25678', '10.1002/jmv.25678', null],
      ['https://onlinelibrary.wiley.com/doi/epdf/10.1002/jmv.25678', '10.1002/jmv.25678', null],
      ['https://www.cell.com/action/showPdf?doi=10.1016/j.cell.2020.02.052', '10.1016/j.cell.2020.02.052', null],
      ['https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0230548', '10.1371/journal.pone.0230548', null],
      ['https://www.biorxiv.org/content/10.1101/2020.02.07.937862v2.full.pdf', '10.1101/2020.02.07.937862', 2],
      ['https://www.biorxiv.org/content/10.1101/2020.02.07.937862v3.full-text', '10.1101/2020.02.07.937862', 3],
      ['https://www.biorxiv.org/content/10.1101/2020.02.07.937862v1.article-info', '10.1101/2020.02.07.937862', 1],
      ['https://link.springer.com/content/pdf/10.1007/s10654-020-00671-y.pdf', '10.1007/s10654-020-00671-y', null],
      ['https://doi.org/10.1000%2Fabc', '10.1000/abc', null],
      ['https://journal.example/doi/10.1000/abc/references', '10.1000/abc', null],
      ['https://blog.example/post?cite=10.1234/abc', null, null], // a citation parameter is not this page's paper
      ['https://journal.example/paper/1', null, null],
    ];
    for (const [url, doi, version] of cases) {
      const r = doiFromUrl(new URL(url));
      expect(r?.doi ?? null, url).toBe(doi);
      expect(r?.version ?? null, url).toBe(version);
    }
  });

  it('OP1-UNIT-08 preprint version: stripped from the DOI and kept in `version`; never touched on other DOIs', () => {
    const page = (raw: string, url = `${HOST}/x`) => detect(`<head>${meta('citation_doi', raw)}</head>`, url);
    expect(page('10.1101/2020.02.07.937862v2')).toMatchObject({ doi: '10.1101/2020.02.07.937862', version: 2 });
    expect(page('10.1101/123456v4')).toMatchObject({ doi: '10.1101/123456', version: 4 });
    expect(page('10.64898/2026.01.02.123456v3')).toMatchObject({ doi: '10.64898/2026.01.02.123456', version: 3 });
    expect(page('10.48550/arXiv.2301.00001v2')).toMatchObject({ doi: '10.48550/arxiv.2301.00001', version: 2 });
    // version only in the URL (bioRxiv's own meta has no suffix)
    expect(page('10.1101/2020.02.07.937862', 'https://www.biorxiv.org/content/10.1101/2020.02.07.937862v5.full')).toMatchObject({ doi: '10.1101/2020.02.07.937862', version: 5 });
    // shared prefix, journal article (delta D6); and a real DOI ending in v2 elsewhere
    expect(page('10.1101/gr.123456v2')).toMatchObject({ doi: '10.1101/gr.123456v2', version: null });
    expect(page('10.1234/abcv2')).toMatchObject({ doi: '10.1234/abcv2', version: null });
    // a URL for another paper must not lend its version
    expect(page('10.1101/2020.02.07.937862', 'https://www.biorxiv.org/content/10.1101/2021.01.01.111111v5')).toMatchObject({ version: null });
  });
});

describe('OP1 detectPaper cascade', () => {
  it('OP1-UNIT-04 two different citation_doi metas → first wins, META_CONFLICT noted', () => {
    const r = detect(`<head>${meta('citation_doi', '10.1000/first')}${meta('citation_doi', '10.1000/second')}</head>`);
    expect(r).toMatchObject({ kind: 'article', doi: '10.1000/first', doiSource: 'meta', notes: ['META_CONFLICT'] });
    expect(detect(`<head>${meta('citation_doi', 'garbage')}${meta('citation_doi', '10.1000/second')}</head>`).doi).toBe('10.1000/second');
    expect(detect(`<head>${meta('citation_doi', '10.1000/same')}${meta('citation_doi', 'DOI:10.1000/SAME')}</head>`).notes).toEqual([]);
  });

  it('OP1-UNIT-05 meta and URL disagree → meta wins, URL_MISMATCH noted', () => {
    const r = detect(`<head>${meta('citation_doi', '10.1000/meta')}</head>`, `${HOST}/doi/10.1000/url`);
    expect(r).toMatchObject({ doi: '10.1000/meta', doiSource: 'meta', notes: ['URL_MISMATCH'] });
  });

  it('OP1-UNIT-06 PMID only (PubMed abstract page): pmid set, doi from meta if present, kind article', () => {
    const url = 'https://pubmed.ncbi.nlm.nih.gov/32250385/';
    expect(detect('<head></head>', url)).toMatchObject({ kind: 'article', pmid: '32250385', doi: null, candidates: [] });
    expect(detect(`<head>${meta('citation_pmid', '32250385')}${meta('citation_doi', '10.1000/x')}</head>`, url)).toMatchObject({ pmid: '32250385', doi: '10.1000/x' });
    expect(detect(`<head>${meta('citation_pmid', '777')}</head>`)).toMatchObject({ kind: 'article', pmid: '777' });
    expect(detect(`<head>${meta('citation_pmid', 'x"><b>')}</head>`).pmid).toBeNull();
  });

  it('OP1-UNIT-07 PMCID page: pmcid from meta or URL', () => {
    expect(detect('<head></head>', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7228878/')).toMatchObject({ kind: 'article', pmcid: 'PMC7228878' });
    expect(detect(`<head>${meta('citation_pmcid', 'PMC123')}${meta('citation_title', 'T')}</head>`)).toMatchObject({ pmcid: 'PMC123', kind: 'article' });
    expect(detect('<head></head>', 'https://europepmc.org/article/PMC/PMC7228878')).toMatchObject({ pmcid: 'PMC7228878' });
    expect(fixture('europepmc').metaKeywords).toEqual([]); // the site's own keywords, not the paper's
  });

  it('OP1-UNIT-09 retraction-notice page: an article with the DOI of the notice', () => {
    expect(detect(`<head>${meta('citation_doi', '10.1000/retraction.1')}${meta('citation_title', 'Retraction Notice to: A study')}</head>`)).toMatchObject({ kind: 'article', doi: '10.1000/retraction.1', title: 'Retraction Notice to: A study' });
  });

  it('OP1-UNIT-10 one DOI in the article header, no meta → doiSource regex', () => {
    expect(detect('<body><article><header><h1>T</h1><p>https://doi.org/10.1000/only.one.</p></header></article></body>')).toMatchObject({ kind: 'article', doi: '10.1000/only.one', doiSource: 'regex', candidates: [] });
  });

  it('OP1-UNIT-11 many DOIs, no meta → doi null, candidates ≤5 in order; references excluded', () => {
    const dois = Array.from({ length: 7 }, (_, i) => `10.1000/c${i}`);
    const r = detect(`<head><meta property="og:type" content="article"><meta property="og:title" content="T"></head><body><div class="abstract">${dois.join(' ')}</div><ol class="references"><li>10.9999/ref.1</li></ol></body>`);
    expect(r).toMatchObject({ kind: 'article', doi: null, doiSource: null, candidates: dois.slice(0, 5) });
    // one real DOI + a reference list: the reference is never counted
    expect(detect('<body><div class="abstract">10.1000/own</div><section id="references"><p>10.9999/ref.1 10.9999/ref.2</p></section></body>').doi).toBe('10.1000/own');
  });

  it('OP1-PROP-04 generated pages with reference lists, no meta, >1 DOI → doi null, candidates only, never a reference', () => {
    const CONTAINERS = ['<ol class="references">', '<div id="references">', '<ul class="ref-list">', '<section role="doc-bibliography">'];
    const CLOSE = ['</ol>', '</div>', '</ul>', '</section>'];
    fc.assert(
      fc.property(fc.nat(3), fc.integer({ min: 2, max: 5 }), fc.integer({ min: 1, max: 30 }), (c, own, refs) => {
        const body = Array.from({ length: own }, (_, i) => `10.1000/own${i}`).join(' ');
        const list = Array.from({ length: refs }, (_, i) => `<li>10.9999/ref${i}</li>`).join('');
        const r = detect(`<head><meta property="og:type" content="article"><meta name="citation_title" content="T"></head><body><div class="abstract">${body}</div>${CONTAINERS[c]}${list}${CLOSE[c]}</body>`);
        expect(r.doi).toBeNull();
        expect(r.candidates.length).toBe(own);
        expect(r.candidates.every((d) => d.startsWith('10.1000/own'))).toBe(true);
      }),
      { numRuns: 100, seed: 11 },
    );
  }, 30_000);

  it('OP1-UNIT-12 non-article pages (news, blog, home) → kind other', () => {
    expect(detect('<head><title>Google</title></head><body>Search</body>', 'https://www.google.com/')).toMatchObject({ kind: 'other', doi: null, candidates: [] });
    // Real news pages carry og:type=article and a title; that alone must not make them papers.
    expect(detect('<head><meta property="og:type" content="article"><meta property="og:title" content="Noticia"></head><body><h1>Noticia</h1></body>').kind).toBe('other');
    expect(detect('<head><script type="application/ld+json">{"@type":"NewsArticle","name":"N"}</script></head><body></body>').kind).toBe('other');
  });

  it('OP1-UNIT-13 PubMed and Europe PMC result lists: kind result_list, ids typed', () => {
    expect(fixture('pubmed-list').kind).toBe('result_list');
    expect(fixture('pubmed-list').resultIds).toEqual(LABELS['pubmed-list']?.expected.resultIds);
    expect(fixture('pubmed-list').resultIds.length).toBe(10);
    expect(fixture('europepmc-list').resultIds).toEqual([{ type: 'pmid', id: '32250385' }, { type: 'pmid', id: '32422208' }]);
  });

  it('OP1-UNIT-14 Google Scholar list is not supported in v1 → kind other, no ids (D-T7)', () => {
    const r = detect('<body><div class="gs_r"><a href="https://doi.org/10.1000/a">A</a></div></body>', 'https://scholar.google.com/scholar?q=vitamin');
    expect(r).toMatchObject({ kind: 'other', resultIds: [] });
    expect(sites.entries.some((s) => s.matches.some((m) => m.includes('scholar')))).toBe(false);
  });

  it('OP1-UNIT-16 content inside iframes is not read', () => {
    const r = detect(`<head></head><body><iframe srcdoc="<meta name='citation_doi' content='10.1000/ad'>"></iframe></body>`);
    expect(r).toMatchObject({ kind: 'other', doi: null });
  });

  it('OP1-UNIT-17 PDF viewer: no metadata to read, detection comes from the URL or kind other', () => {
    const viewer = '<head></head><body><embed type="application/pdf"></body>';
    expect(detect(viewer, 'https://www.biorxiv.org/content/10.1101/2020.02.07.937862v2.full.pdf')).toMatchObject({ kind: 'article', doi: '10.1101/2020.02.07.937862', doiSource: 'url', version: 2 });
    expect(detect(viewer, 'https://www.sciencedirect.com/science/article/pii/S014067362030183X/pdfft')).toMatchObject({ kind: 'other', doi: null });
  });

  it('OP1-UNIT-18 file:// pages are not in the match list (D-T7)', () => {
    expect(sites.entries.flatMap((s) => s.matches).filter((m) => m.startsWith('file:') || m.includes('<all_urls>'))).toEqual([]);
  });

  it('OP1-UNIT-27 JSON-LD: ScholarlyArticle identifier forms, @type arrays and @graph; invalid JSON ignored', () => {
    const ld = (o: unknown) => `<head><script type="application/ld+json">${JSON.stringify(o)}</script></head>`;
    const page = (o: unknown) => detect(ld(o));
    expect(page({ '@type': 'ScholarlyArticle', identifier: 'doi:10.1000/a' })).toMatchObject({ doi: '10.1000/a', doiSource: 'jsonld', kind: 'article' });
    expect(page({ '@type': ['Article', 'ScholarlyArticle'], identifier: { '@type': 'PropertyValue', propertyID: 'DOI', value: '10.1000/b' } }).doi).toBe('10.1000/b');
    expect(page({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'MedicalScholarlyArticle', sameAs: 'https://doi.org/10.1000/c' }] }).doi).toBe('10.1000/c');
    expect(page({ '@type': 'NewsArticle', identifier: '10.1000/d' }).doi).toBeNull();
    expect(detect('<head><script type="application/ld+json">{not json</script></head>')).toMatchObject({ kind: 'other', doi: null });
  });

  it('OP1-PROP-01 kind article ⇒ doi, pmid, pmcid or title', () => {
    const scratch = new JSDOM('').window.document;
    const value = fc.oneof(fc.constant('10.1000/abc'), fc.constant('123'), fc.constant('Título'), fc.constant(''), fc.string({ maxLength: 12 }));
    const name = fc.constantFrom('citation_doi', 'dc.identifier', 'prism.doi', 'citation_pmid', 'citation_title', 'dc.title', 'og:title', 'og:type', 'keywords');
    fc.assert(
      fc.property(fc.array(fc.tuple(name, value), { maxLength: 8 }), (pairs) => {
        const metas = pairs.map(([n, v]) => {
          const m = scratch.createElement('meta');
          m.setAttribute('name', n);
          m.setAttribute('content', v);
          return m.outerHTML;
        });
        const r = detect(`<head>${metas.join('')}</head>`);
        if (r.kind === 'article') expect(Boolean(r.doi || r.pmid || r.pmcid || r.title)).toBe(true);
      }),
      { numRuns: 200, seed: 3 },
    );
  }, 30_000);

  it('OP1-PROP-02 detect twice on the same DOM → deep-equal', () => {
    for (const name of Object.keys(LABELS)) expect(fixture(name), name).toEqual(fixture(name));
  });

  it('OP1-TYPE-01 every output parses DetectedPageSchema and survives a JSON round trip; doi null vs candidates semantics', () => {
    for (const name of Object.keys(LABELS)) {
      const r = fixture(name);
      expect(DetectedPageSchema.safeParse(r).success, name).toBe(true);
      expect(JSON.parse(JSON.stringify(r))).toEqual(r);
      if (r.doi !== null) expect(r.candidates).toEqual([]);
    }
    expect(DetectedPageSchema.safeParse({ ...fixture('plos'), extra: 1 }).success).toBe(false);
  });

  it('OP1-CON-01 every non-null doi matches the OP3 input regex', () => {
    const OP3_INPUT = /^10\.\d{4,9}\/\S+$/;
    for (const name of Object.keys(LABELS)) {
      const { doi } = fixture(name);
      if (doi !== null) expect(doi).toMatch(OP3_INPUT);
    }
  });

  it('OP1-SEC-03 length caps: url, title, keywords truncated and flagged; an oversize DOI is rejected, never cut', () => {
    const long = 'x'.repeat(3000);
    const url = `${HOST}/${long}`;
    const words = Array.from({ length: 80 }, (_, i) => `kw${i}`).join(';');
    const r = detect(`<head>${meta('citation_title', long)}${meta('citation_keywords', `${words};${'y'.repeat(300)}`)}</head>`, url);
    expect(r.url.length).toBe(2048);
    expect(r.title?.length).toBe(1000);
    expect(r.metaKeywords.length).toBe(50);
    expect(r.truncated).toBe(true);
    const longDoi = detect(`<head>${meta('citation_doi', `10.1000/${'a'.repeat(300)}`)}${meta('citation_title', 'T')}</head>`);
    expect(longDoi).toMatchObject({ doi: null, truncated: true });
    const k = detect(`<head>${meta('citation_title', 'T')}${meta('keywords', `a;${'y'.repeat(300)}`)}</head>`).metaKeywords;
    expect(k.every((w) => w.length <= 100)).toBe(true);
    expect(detect(`<head>${meta('citation_title', 'T')}${meta('keywords', 'a, b; a')}</head>`)).toMatchObject({ metaKeywords: ['a', 'b'], truncated: false });
  });

  it('OP1-RES-01 detector throws → kind other, DETECT_ERROR noted', () => {
    const broken = new Proxy(doc('<head></head>'), {
      get(target, prop) {
        if (prop === 'head' || prop === 'querySelectorAll' || prop === 'querySelector') throw new Error('boom');
        return Reflect.get(target, prop) as unknown;
      },
    });
    const r = safeDetect(broken, new URL(`${HOST}/x`), DEFAULT_RULES);
    expect(r).toMatchObject({ kind: 'other', doi: null, notes: ['DETECT_ERROR'] });
    expect(DetectedPageSchema.safeParse(r).success).toBe(true);
  });

  it('OP1-FUZZ-01 random DOM and meta: no throw, valid output', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), fc.string({ maxLength: 60 }), (body, value) => {
        const d = new JSDOM(`<!doctype html><head><meta name="citation_doi"></head><body>${body}</body>`, { url: `${HOST}/x` }).window.document;
        d.querySelector('meta')?.setAttribute('content', value);
        const r = detectPaper(d, new URL(`${HOST}/x`), DEFAULT_RULES);
        expect(DetectedPageSchema.safeParse(r).success).toBe(true);
      }),
      { numRuns: 50, seed: 5 },
    );
  }, 30_000);
});

describe('OP1 site rules and fixtures', () => {
  it('OP1-KPI-01 fixture suite: every labelled page detected exactly as labelled (precision and recall)', () => {
    let returned = 0;
    let correct = 0;
    let withDoi = 0;
    for (const [name, label] of Object.entries(LABELS)) {
      const r = fixture(name);
      const { resultIds, ...expected } = label.expected;
      expect(r, name).toMatchObject(expected);
      if (resultIds) expect(r.resultIds, name).toEqual(resultIds);
      if (r.doi) {
        returned++;
        if (r.doi === label.expected.doi) correct++;
      }
      if (label.expected.doi) withDoi++;
    }
    expect(correct / returned).toBeGreaterThanOrEqual(0.97);
    expect(returned / withDoi).toBeGreaterThanOrEqual(0.9);
    console.info(`OP1-KPI-01 fixtures=${Object.keys(LABELS).length} real=${Object.values(LABELS).filter((l) => l.origin === 'real').length} precision=${correct}/${returned} recall=${returned}/${withDoi}`);
  });

  it('OP1-UNIT-28 first-DOI baseline would pick a reference: the cascade picks the paper (H2 on the trap page)', () => {
    const html = `<head>${meta('citation_doi', '10.1000/own')}</head><body><p>Cited: 10.9999/first.in.body</p></body>`;
    expect(detect(html).doi).toBe('10.1000/own');
  });

  it('OP1-CFG-01 sites.json: valid, every entry has a fixture, patterns compile and have no nested quantifiers', () => {
    expect(sites.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(sites.entries.map((s) => s.id).sort()).toEqual(['biorxiv', 'bmc', 'europepmc', 'frontiers', 'medrxiv', 'mdpi', 'plos', 'pmc', 'pubmed', 'redalyc', 'sciencedirect', 'scielo', 'springer', 'wiley'].sort());
    const NESTED = /\([^)]*[+*][^)]*\)[+*{]/;
    const files = new Set(readdirSync(ROOT));
    for (const s of sites.entries) {
      expect(files.has(`${s.id}.html`), `${s.id} needs a fixture`).toBe(true);
      expect(s.matches.length, s.id).toBeGreaterThan(0);
      for (const m of s.matches) expect(m, s.id).toMatch(/^(https|\*):\/\/(\*\.)?[a-z0-9.-]+\/\*$/);
      for (const key of ['urlPmid', 'urlPmcid', 'listPattern', 'listIdPattern'] as const) {
        const src = (s as Record<string, unknown>)[key];
        if (typeof src !== 'string') continue;
        expect(() => new RegExp(src), `${s.id}.${key}`).not.toThrow();
        expect(NESTED.test(src), `${s.id}.${key} has a nested quantifier`).toBe(false);
      }
    }
  });

  it('OP1-SEC-01 detect sources contain no network API', () => {
    for (const file of ['detect.ts', 'watch.ts', 'messages.ts']) {
      expect(readFileSync(join(import.meta.dirname, file), 'utf8'), file).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/);
    }
  });
});
