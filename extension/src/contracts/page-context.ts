import { z } from 'zod';

/**
 * PageContext v1: what OP1 found on a page (OP1 plan §5, deltas D1, D27-D31).
 * The content script produces DetectedPage. Only the side panel adds tabId, from Chrome's
 * `sender.tab.id`, because a content script runs in a hostile page and cannot vouch for it.
 */

/** Crossref-recommended pattern, lowercase after normalisation (OP1 plan §8). */
export const DOI_PATTERN = /^10\.\d{4,9}\/[-._;()/:a-z0-9<>]+$/;
export const DOI_MAX = 256;
export const URL_MAX = 2048;
export const TITLE_MAX = 1000;
export const KEYWORDS_MAX = 50;
export const KEYWORD_MAX = 100;
export const CANDIDATES_MAX = 5;
export const RESULT_IDS_MAX = 200;

export const PageKindSchema = z.enum(['article', 'result_list', 'other']);
export const DoiSourceSchema = z.enum(['meta', 'jsonld', 'url', 'site_rule', 'regex']);
export type DoiSource = z.infer<typeof DoiSourceSchema>;
export const DetectNoteSchema = z.enum(['META_CONFLICT', 'URL_MISMATCH', 'DETECT_ERROR']);
export type DetectNote = z.infer<typeof DetectNoteSchema>;

const Doi = z.string().max(DOI_MAX).regex(DOI_PATTERN);
const Pmid = z.string().regex(/^\d{1,9}$/);
const Pmcid = z.string().regex(/^PMC\d{1,9}$/);

export const DetectedPageSchema = z.strictObject({
  url: z.string().max(URL_MAX),
  kind: PageKindSchema,
  doi: Doi.nullable(), // null = looked, none found. Never undefined.
  doiSource: DoiSourceSchema.nullable(),
  version: z.number().int().positive().nullable(), // preprint version; never part of the DOI
  candidates: z.array(Doi).max(CANDIDATES_MAX), // ambiguous when non-empty and doi is null
  pmid: Pmid.nullable(),
  pmcid: Pmcid.nullable(),
  title: z.string().max(TITLE_MAX).nullable(),
  metaKeywords: z.array(z.string().max(KEYWORD_MAX)).max(KEYWORDS_MAX),
  resultIds: z
    .array(z.discriminatedUnion('type', [z.strictObject({ type: z.literal('doi'), id: Doi }), z.strictObject({ type: z.literal('pmid'), id: Pmid })]))
    .max(RESULT_IDS_MAX),
  truncated: z.boolean(),
  notes: z.array(DetectNoteSchema).max(DetectNoteSchema.options.length),
  rulesVersion: z.string().min(1),
  schemaVersion: z.literal(1),
});
export type DetectedPage = z.infer<typeof DetectedPageSchema>;

export const PageContextSchema = DetectedPageSchema.extend({ tabId: z.number().int().nonnegative() });
export type PageContext = z.infer<typeof PageContextSchema>;
