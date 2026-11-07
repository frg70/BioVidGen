import { z } from 'zod';

/**
 * Article v2, as the backend sends it (backend/src/biovidgen/scholarly/contracts.py; OP3 plan §5, deltas D3, D36).
 * `[]` means asked and none found (see `coverage`); `null` means the source gave no value.
 * Every string here came from OpenAlex: render it as text, never as HTML (rule 3).
 */
const Short = z.string().min(1).max(500);

export const ArticleSchema = z.strictObject({
  doi: z.string().max(256),
  /** The DOI OpenAlex answered with when it is not `doi` (often a preprint's published article, D37): every field below is about that work. */
  matchedDoi: z.string().max(256).nullable(),
  openalexId: z.string().regex(/^W\d{1,12}$/).nullable(),
  pmid: z.string().regex(/^\d{1,9}$/).nullable(),
  pmcid: z.string().regex(/^PMC\d{1,9}$/).nullable(),
  title: z.string().min(1).max(2000).nullable(),
  journal: Short.nullable(),
  year: z.number().int().nullable(),
  authors: z.array(z.strictObject({ name: Short, orcid: z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/).nullable() })),
  keywords: z.array(z.strictObject({ term: Short, source: z.enum(['openalex_keyword', 'openalex_topic']), score: z.number().nullable() })).max(15),
  primaryTopic: z.strictObject({ name: Short, field: Short.nullable() }).nullable(),
  type: Short.nullable(),
  abstract: z.string().min(1).max(50_000).nullable(),
  oaUrl: z.string().max(2048).regex(/^https?:\/\//).nullable(),
  isOA: z.boolean().nullable(),
  coverage: z.strictObject({ authors: z.enum(['found', 'none_found']), keywords: z.enum(['found', 'none_found']) }),
  fetchedAt: z.string(),
  schemaVersion: z.literal(2),
});
export type Article = z.infer<typeof ArticleSchema>;

/** `stale`: OpenAlex could not be reached, this is the last saved copy. `saved`: false if the backend could not store it. */
export const ResolvedSchema = z.strictObject({ article: ArticleSchema, stale: z.boolean(), saved: z.boolean() });
export type Resolved = z.infer<typeof ResolvedSchema>;
