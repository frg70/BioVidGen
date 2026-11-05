import {
  IntroDraftSchema,
  SECTION_NAMES,
  SectionDraftSchema,
  SUMMARY_KEYS,
  SummaryKeySchema,
  type ArticleText,
  type ProviderMeta,
  type SectionDraft,
  type SectionName,
  type Summary,
  type SummaryKey,
  type SummarySection,
} from '../contracts/pipeline';
import { findQuote, normalize, normalizeWithMap, NORMALISER_VERSION, type Normalised } from './normaliser';

/**
 * OP5V core (plan §8), pure: no storage, no browser APIs, so any surface can reuse it.
 * Drafts are untrusted model output and are parsed here again.
 */

export interface Drafts {
  intro?: unknown;
  sections: unknown[];
}

export interface Validated {
  summary: Summary;
  /** Counts only, for the log (OP5V-OBS-01). Never text. */
  counts: Record<string, number>;
  allFailed: boolean;
}

const MIN_CHARS = 20;
const MIN_WORDS = 4;
const MAX_CHARS = 400;

// A sign counts only at the start of a token: "5-10" is 5 and 10, " -3" is -3 (delta D24).
const NUMBER = /(?<![\p{L}\p{N}.,])([-+±]?)(\d+(?:[.,]\d+)?)( ?%)?/gu;

/** Canonical numbers in `s`: decimal comma → point, "95 %" → "95%". */
export function canonNumbers(s: string): string[] {
  return [...normalize(s).matchAll(NUMBER)].map((m) => `${m[1]}${(m[2] as string).replace(',', '.')}${m[3] ? '%' : ''}`);
}

const FAILED: () => SummarySection = () => ({ summaryEs: '', status: 'failed', evidence: [], rejected: [], numbersUnsupported: [], coverage: 'full' });

type Index = Map<SectionName, { original: string; norm: Normalised }>;
type Counter = (key: string, by?: number) => void;

/** Declared section first, then the others in paper order (section correction). */
function locate(idx: Index, declared: SectionName, nq: string) {
  for (const name of [declared, ...SECTION_NAMES.filter((n) => n !== declared)]) {
    const s = idx.get(name);
    if (!s) continue;
    const i = findQuote(s.norm, nq);
    if (i >= 0) {
      const start = s.norm.start[i] as number;
      const end = s.norm.end[i + nq.length - 1] as number;
      return { section: name, start, end, quote: s.original.slice(start, end) };
    }
  }
  return null;
}

function validateSection(d: SectionDraft, idx: Index, source: ArticleText['source'], inc: Counter): SummarySection {
  const evidence: SummarySection['evidence'] = [];
  const rejected: SummarySection['rejected'] = [];
  for (const q of d.evidence) {
    inc('quotes');
    const nq = normalize(q.quote);
    const tooShort = nq.length < MIN_CHARS || nq.split(' ').length < MIN_WORDS;
    const reason = tooShort ? 'QUOTE_TOO_SHORT' : nq.length > MAX_CHARS ? 'QUOTE_TOO_LONG' : null;
    const hit = reason ? null : locate(idx, q.section, nq);
    if (!hit) {
      rejected.push({ quote: q.quote, reason: reason ?? 'NOT_FOUND' });
      inc(`rejected.${reason ?? 'NOT_FOUND'}`);
      continue;
    }
    if (hit.section !== q.section) inc('section_mismatch');
    evidence.push(hit);
  }
  evidence.sort((a, b) => SECTION_NAMES.indexOf(a.section) - SECTION_NAMES.indexOf(b.section) || a.start - b.start || a.end - b.end);

  // Numbers rule: every number claimed must appear in a verified quote of this section.
  const supported = new Set(evidence.flatMap((e) => canonNumbers(e.quote)));
  const claims = [d.summaryEs, d.n == null ? '' : String(d.n), ...(d.statistics ?? [])].join('\n');
  const numbersUnsupported = [...new Set(canonNumbers(claims).filter((x) => !supported.has(x)))];

  inc('evidence', evidence.length);
  inc('numbers_unsupported', numbersUnsupported.length);
  const clean = rejected.length === 0 && evidence.length > 0 && numbersUnsupported.length === 0;
  return {
    summaryEs: d.summaryEs,
    status: source === 'abstract_only' ? 'abstract_only' : clean ? 'verified' : 'no_verificado',
    evidence: evidence.map(({ quote, section, start, end }) => ({ quote, section, start, end })),
    rejected,
    numbersUnsupported,
    coverage: d.coverage ?? 'full',
  };
}

export function validateDrafts(doi: string, drafts: Drafts, text: ArticleText, meta: ProviderMeta, createdAt: string): Validated {
  const counts: Record<string, number> = {};
  const inc: Counter = (key, by = 1) => {
    counts[key] = (counts[key] ?? 0) + by;
  };
  for (const k of ['quotes', 'evidence', 'rejected.NOT_FOUND', 'rejected.QUOTE_TOO_SHORT', 'rejected.QUOTE_TOO_LONG', 'section_mismatch', 'drafts_invalid', 'numbers_unsupported']) inc(k, 0);
  for (const k of ['verified', 'no_verificado', 'abstract_only', 'failed']) inc(`sections.${k}`, 0);

  const idx: Index = new Map();
  for (const name of SECTION_NAMES) {
    const original = text.sections[name]?.text;
    if (original !== undefined) idx.set(name, { original, norm: normalizeWithMap(original) });
  }

  const bySlot: Partial<Record<SummaryKey, SummarySection>> = {};
  for (const raw of drafts.sections) {
    const parsed = SectionDraftSchema.safeParse(raw);
    if (parsed.success) {
      bySlot[parsed.data.section] = validateSection(parsed.data, idx, text.source, inc);
      continue;
    }
    inc('drafts_invalid');
    const slot = SummaryKeySchema.safeParse(typeof raw === 'object' && raw !== null ? (raw as { section?: unknown }).section : undefined);
    if (slot.success) bySlot[slot.data] = FAILED();
  }

  const sections: Summary['sections'] = {};
  for (const k of SUMMARY_KEYS) {
    const s = bySlot[k];
    if (!s) continue;
    sections[k] = s;
    inc(`sections.${s.status}`);
  }

  const intro = drafts.intro === undefined ? null : IntroDraftSchema.safeParse(drafts.intro);
  if (intro && !intro.success) inc('drafts_invalid');
  const topics = intro?.success ? intro.data : { mainTopic: null, prerequisiteTopics: [] };

  return {
    summary: {
      doi,
      pipelineVersion: meta.pipelineVersion,
      mainTopic: topics.mainTopic,
      prerequisiteTopics: topics.prerequisiteTopics.map((topic) => ({ topic, label: 'background_knowledge' as const })),
      sections,
      provider: meta.provider,
      modelId: meta.modelId,
      promptHash: meta.promptHash,
      normaliserVersion: NORMALISER_VERSION,
      createdAt,
      schemaVersion: 1,
    },
    counts,
    allFailed: SUMMARY_KEYS.every((k) => sections[k] === undefined || sections[k].status === 'failed'),
  };
}
