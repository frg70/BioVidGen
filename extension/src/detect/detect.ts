import {
  CANDIDATES_MAX,
  DOI_MAX,
  DOI_PATTERN,
  KEYWORD_MAX,
  KEYWORDS_MAX,
  RESULT_IDS_MAX,
  TITLE_MAX,
  URL_MAX,
  type DetectedPage,
  type DetectNote,
  type DoiSource,
} from '../contracts/page-context';
import sites from './sites.json';

/**
 * OP1 (plan §8), pure: reads the document and URL it is given, makes no network calls and never
 * guesses. Ambiguous pages return candidates, because showing a cited paper as the page's paper
 * is the failure this module exists to prevent.
 */

export interface SiteRule {
  id: string;
  matches: string[];
  host?: string;
  urlPmid?: string;
  urlPmcid?: string;
  listPattern?: string;
  listIdSelector?: string;
  listIdFrom?: string;
  listIdPattern?: string;
  ignoreKeywords?: boolean;
}
export interface SiteRules {
  version: string;
  entries: SiteRule[];
}
export const DEFAULT_RULES: SiteRules = sites;

const PREFIX = /^(?:https?:\/\/(?:dx\.|www\.)?doi\.org\/|doi:\s*)/i;
// `<` and `>` are legal only in SICI DOIs, where `<` is followed by a digit. Anything else is markup (delta D27).
const NOT_SICI = /<(?!\d)|^[^<]*>/;
const RAW_MAX = 2048;

function stripTrailing(input: string): string {
  let s = input;
  for (;;) {
    const last = s.at(-1);
    const closesNothing = last === ')' && s.split(')').length > s.split('(').length;
    if (last !== '.' && last !== ',' && last !== ';' && last !== ']' && !closesNothing) return s;
    s = s.slice(0, -1);
  }
}

export function normalizeDoi(raw: string | null | undefined): string | null {
  if (!raw || raw.length > RAW_MAX) return null;
  let s = raw.trim();
  if (s.includes('%')) {
    try {
      s = decodeURIComponent(s);
    } catch {
      return null;
    }
  }
  s = stripTrailing(s.trim().replace(PREFIX, '').trim().toLowerCase());
  return s.length <= DOI_MAX && DOI_PATTERN.test(s) && !NOT_SICI.test(s) ? s : null;
}

// Preprint servers only: `v2` can be a real ending elsewhere, and 10.1101 is shared with journals (delta D6).
const VERSIONED = /^(10\.1101\/(?:\d{4}\.\d{2}\.\d{2}\.\d+|\d{6,})|10\.64898\/\d{4}\.\d{2}\.\d{2}\.\d+|10\.48550\/arxiv\.[a-z0-9./-]+?)v(\d{1,4})$/;

function splitVersion(doi: string): { doi: string; version: number | null } {
  const m = VERSIONED.exec(doi);
  return m ? { doi: m[1] as string, version: Number(m[2]) } : { doi, version: null };
}

const DOI_IN_PATH = /(?:^|\/)(10\.\d{4,9}\/.+)$/;
// Page views that follow a DOI in publisher URLs. Without this, `/full` would become part of the DOI (delta D28).
const VIEW_TAIL =
  /(?:\/(?:full|fulltext|full-text|abstract|abs|summary|pdf|epdf|epub|pdfft|html|xml|references|citations|figures|tables|metrics|authors|suppl|supplementary|supplemental|info|reader|download)|\.(?:full|full-text|abstract|short|long|pdf|pdf\+html|html|xml|article-info|article-metrics|supplementary-material|figures-only|external-links|e-letters|peer-review))$/i;

function stripViews(input: string): string {
  let s = input.replace(/\/+$/, '');
  for (let next = s.replace(VIEW_TAIL, ''); next !== s; next = s.replace(VIEW_TAIL, '')) s = next.replace(/\/+$/, '');
  return s;
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** A DOI named by the URL itself: in the path, or in an `id` or `doi` parameter. Other parameters may cite other papers. */
export function doiFromUrl(url: URL): { doi: string; version: number | null } | null {
  const inPath = DOI_IN_PATH.exec(decode(url.pathname))?.[1];
  const raw = inPath ?? url.searchParams.get('doi') ?? url.searchParams.get('DOI') ?? url.searchParams.get('id');
  const doi = raw ? normalizeDoi(stripViews(raw)) : null;
  return doi ? splitVersion(doi) : null;
}

/** What a student pastes into the panel: a DOI, a doi.org link or a publisher's link. */
export function parseManualDoi(raw: string): { doi: string; version: number | null } | null {
  const text = raw.trim();
  const doi = normalizeDoi(text);
  if (doi) return splitVersion(doi);
  if (!/^https?:\/\//i.test(text) || !URL.canParse(text)) return null;
  return doiFromUrl(new URL(text));
}

const SCHOLARLY_TYPES = new Set(['scholarlyarticle', 'medicalscholarlyarticle']);
const JSONLD_SCRIPTS_MAX = 5;
const JSONLD_CHARS_MAX = 200_000;
type Json = Record<string, unknown>;
const isObject = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const asArray = (x: unknown): unknown[] => (Array.isArray(x) ? x : x === undefined || x === null ? [] : [x]);

function scholarlyNodes(doc: Document): Json[] {
  const nodes: Json[] = [];
  const scripts = [...doc.querySelectorAll('script[type="application/ld+json"]')].slice(0, JSONLD_SCRIPTS_MAX);
  for (const script of scripts) {
    const text = script.textContent ?? '';
    if (text.length > JSONLD_CHARS_MAX) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue; // publishers ship broken JSON-LD; the rest of the cascade still applies
    }
    for (const top of asArray(parsed)) {
      if (!isObject(top)) continue;
      for (const node of [top, ...asArray(top['@graph'])]) {
        if (isObject(node) && asArray(node['@type']).some((t) => typeof t === 'string' && SCHOLARLY_TYPES.has(t.toLowerCase()))) nodes.push(node);
      }
    }
  }
  return nodes;
}

function jsonLdDoi(nodes: Json[]): string | null {
  for (const node of nodes) {
    for (const value of [...asArray(node.identifier), ...asArray(node.sameAs)]) {
      const raw = isObject(value) ? value.value : value;
      const doi = typeof raw === 'string' ? normalizeDoi(raw) : null;
      if (doi) return doi;
    }
  }
  return null;
}

const INDEXED_META = new Set(['citation_doi', 'dc.identifier', 'prism.doi', 'citation_pmid', 'citation_pmcid', 'citation_title', 'dc.title', 'og:title', 'og:type', 'citation_keywords', 'keywords']);

/** Only the names used here, so `citation_reference` lists (often hundreds of tags) are never kept. */
function metaIndex(doc: Document): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const meta of doc.head?.querySelectorAll('meta') ?? []) {
    const content = meta.getAttribute('content')?.trim();
    if (!content) continue;
    for (const attr of ['name', 'property']) {
      const key = meta.getAttribute(attr)?.toLowerCase();
      if (key && INDEXED_META.has(key)) index.set(key, [...(index.get(key) ?? []), content]);
    }
  }
  return index;
}

const REGIONS = 'article header, .abstract, #abstract';
const EXCLUDED = 'ol.references, .references, #references, .ref-list, .bibliography, #bibliography, [role="doc-bibliography"], script, style, noscript';
const HEADER_CHARS_MAX = 20_000;
const SHOW_TEXT = 4; // NodeFilter.SHOW_TEXT
const DOI_IN_TEXT = /\b10\.\d{4,9}\/[^\s"'<>]+/g;

/** Text around the title and abstract, without reference lists, capped so huge pages stay cheap. */
function articleHeaderText(doc: Document): string {
  const regions = [...doc.querySelectorAll(REGIONS)];
  const h1 = doc.querySelector('h1');
  if (h1) regions.push(h1.parentElement && !/^(BODY|HTML)$/.test(h1.parentElement.tagName) ? h1.parentElement : h1);
  let text = '';
  for (const region of regions) {
    const walker = doc.createTreeWalker(region, SHOW_TEXT);
    for (let node = walker.nextNode(); node && text.length < HEADER_CHARS_MAX; node = walker.nextNode()) {
      if (!node.parentElement?.closest(EXCLUDED)) text += `${node.textContent ?? ''} `;
    }
  }
  return text.slice(0, HEADER_CHARS_MAX);
}

const hostMatches = (hostname: string, host: string) => hostname === host || hostname.endsWith(`.${host}`);

function ruleFor(url: URL, rules: SiteRules): SiteRule | undefined {
  return rules.entries.find((r) => r.host !== undefined && hostMatches(url.hostname, r.host));
}

const firstGroup = (pattern: string | undefined, value: string): string | null => (pattern ? (new RegExp(pattern).exec(value)?.[1] ?? null) : null);
const PMID = /^\d{1,9}$/;
const PMCID = /^PMC\d{1,9}$/;

function resultIds(doc: Document, rule: SiteRule): DetectedPage['resultIds'] {
  if (!rule.listIdSelector) return [];
  const seen = new Set<string>();
  for (const el of doc.querySelectorAll(rule.listIdSelector)) {
    const value = rule.listIdFrom === 'href' ? (el.getAttribute('href') ?? '') : (el.textContent ?? '').trim();
    const id = firstGroup(rule.listIdPattern, value);
    if (id && PMID.test(id)) seen.add(id);
  }
  return [...seen].map((id) => ({ type: 'pmid' as const, id }));
}

export function emptyPage(url: string, rulesVersion: string = DEFAULT_RULES.version): DetectedPage {
  return {
    url: url.slice(0, URL_MAX),
    kind: 'other',
    doi: null,
    doiSource: null,
    version: null,
    candidates: [],
    pmid: null,
    pmcid: null,
    title: null,
    metaKeywords: [],
    resultIds: [],
    truncated: url.length > URL_MAX,
    notes: [],
    rulesVersion,
    schemaVersion: 1,
  };
}

export function detectPaper(doc: Document, url: URL, rules: SiteRules = DEFAULT_RULES): DetectedPage {
  const page = emptyPage(url.href, rules.version);
  const meta = metaIndex(doc);
  const rule = ruleFor(url, rules);
  const notes: DetectNote[] = [];
  const first = (...keys: string[]) => keys.flatMap((k) => meta.get(k) ?? [])[0] ?? null;
  let truncated = page.truncated;

  const rawPmid = first('citation_pmid');
  const pmid = rawPmid && PMID.test(rawPmid) ? rawPmid : firstGroup(rule?.urlPmid, url.pathname);
  const rawPmcid = first('citation_pmcid');
  const pmcid = rawPmcid && PMCID.test(rawPmcid) ? rawPmcid : firstGroup(rule?.urlPmcid, url.pathname);

  const rawTitle = first('citation_title', 'dc.title', 'og:title');
  if (rawTitle && rawTitle.length > TITLE_MAX) truncated = true;
  const title = rawTitle?.slice(0, TITLE_MAX) ?? null;

  const keywordSources = rule?.ignoreKeywords ? ['citation_keywords'] : ['citation_keywords', 'keywords'];
  const allKeywords = [...new Set(keywordSources.flatMap((k) => meta.get(k) ?? []).flatMap((v) => v.split(/[;,]/)).map((w) => w.trim()).filter(Boolean))];
  if (allKeywords.length > KEYWORDS_MAX || allKeywords.some((w) => w.length > KEYWORD_MAX)) truncated = true;
  const metaKeywords = allKeywords.slice(0, KEYWORDS_MAX).map((w) => w.slice(0, KEYWORD_MAX));

  const base = { ...page, pmid, pmcid, title, metaKeywords, notes };

  const citationDois = (meta.get('citation_doi') ?? []).map(normalizeDoi).filter((d) => d !== null);
  if (new Set(citationDois).size > 1) notes.push('META_CONFLICT');

  // A DOI too long to be real is rejected, not cut: a shortened DOI names a different paper (delta D29).
  const rawDois = ['citation_doi', 'dc.identifier', 'prism.doi'].flatMap((k) => meta.get(k) ?? []);
  if (rawDois.some((raw) => raw.length > DOI_MAX && /^(?:doi:\s*)?10\.\d/i.test(raw))) truncated = true;

  const nodes = scholarlyNodes(doc);
  const urlDoi = doiFromUrl(url);
  const cascade: [DoiSource, string | null | undefined][] = [
    ['meta', citationDois[0]],
    ['meta', (meta.get('dc.identifier') ?? []).map(normalizeDoi).find((d) => d !== null)],
    ['meta', (meta.get('prism.doi') ?? []).map(normalizeDoi).find((d) => d !== null)],
    ['jsonld', jsonLdDoi(nodes)],
    ['url', urlDoi?.doi],
  ];
  for (const [doiSource, found] of cascade) {
    if (!found) continue;
    const { doi, version } = splitVersion(found);
    if (urlDoi && urlDoi.doi !== doi) notes.push('URL_MISMATCH');
    // bioRxiv's own meta has no suffix: the version is in the URL, and only counts if it names the same paper.
    return { ...base, truncated, kind: 'article', doi, doiSource, version: version ?? (urlDoi?.doi === doi ? urlDoi.version : null) };
  }

  if (rule?.listPattern && !pmid && !pmcid && new RegExp(rule.listPattern).test(url.pathname + url.search)) {
    const ids = resultIds(doc, rule);
    return { ...base, truncated: truncated || ids.length > RESULT_IDS_MAX, kind: 'result_list', resultIds: ids.slice(0, RESULT_IDS_MAX) };
  }

  const bodyDois = [...new Set((articleHeaderText(doc).match(DOI_IN_TEXT) ?? []).map(normalizeDoi).filter((d) => d !== null))];
  const [only] = bodyDois;
  if (bodyDois.length === 1 && only) {
    const { doi, version } = splitVersion(only);
    return { ...base, truncated, kind: 'article', doi, doiSource: 'regex', version };
  }

  // og:type=article and a title alone describe any news page: they need a DOI nearby to count (delta D30).
  const ogArticle = first('og:type')?.toLowerCase() === 'article';
  const looksScholarly = Boolean(pmid || pmcid || nodes.length > 0 || first('citation_title') || (ogArticle && bodyDois.length > 0));
  return {
    ...base,
    truncated,
    kind: looksScholarly && (pmid || pmcid || title) ? 'article' : 'other',
    candidates: bodyDois.slice(0, CANDIDATES_MAX),
  };
}

/** A broken page must never break the panel (OP1-RES-01). */
export function safeDetect(doc: Document, url: URL, rules: SiteRules = DEFAULT_RULES): DetectedPage {
  try {
    return detectPaper(doc, url, rules);
  } catch {
    return { ...emptyPage(url.href, rules.version), notes: ['DETECT_ERROR'] };
  }
}
