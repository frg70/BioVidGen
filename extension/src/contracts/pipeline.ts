import { z } from 'zod';

/**
 * Contracts for OP4 → OP5 → OP5V (OP5V plan §5, OP4 plan §5, deltas D7, D22).
 * Additive changes only within schemaVersion 1 (OP5V-TYPE-01).
 */

export const SECTION_NAMES = ['abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusions'] as const;
export const SectionNameSchema = z.enum(SECTION_NAMES);
export type SectionName = z.infer<typeof SectionNameSchema>;

/** Summary slots. A SectionDraft names the slot it fills (delta D22). */
export const SUMMARY_KEYS = ['methodology', 'results', 'conclusions'] as const;
export const SummaryKeySchema = z.enum(SUMMARY_KEYS);
export type SummaryKey = z.infer<typeof SummaryKeySchema>;

/** ArticleTextSchema v1 (OP4 plan §5). Produced by OP4; OP5V reads it. */
export const ArticleTextSchema = z.strictObject({
  doi_norm: z.string(),
  contentHash: z.string(),
  source: z.enum(['dom', 'oa_xml', 'pdfjs', 'abstract_only']),
  sections: z.partialRecord(
    SectionNameSchema,
    z.strictObject({ text: z.string(), headingSeen: z.string().nullable(), mergedWith: SectionNameSchema.nullable() }),
  ),
  missing: z.array(SectionNameSchema),
  language: z.string().nullable(),
  usable: z.boolean(),
  truncated: z.boolean(),
  headingsVersion: z.string(),
  schemaVersion: z.literal(1),
});
export type ArticleText = z.infer<typeof ArticleTextSchema>;

/**
 * What OP5 (or the P0 stub) returns per summary slot. Also the model's structured-output
 * schema, so limits here bound what an untrusted model can make us store (OP5V-SEC-03).
 */
export const SectionDraftSchema = z.strictObject({
  section: SummaryKeySchema,
  summaryEs: z.string().max(2000),
  evidence: z.array(z.strictObject({ quote: z.string().max(2000), section: SectionNameSchema })).max(5),
  notReported: z.boolean().optional(),
  design: z.string().max(100).nullable().optional(),
  n: z.number().int().nonnegative().nullable().optional(),
  statistics: z.array(z.string().max(200)).max(20).optional(),
  coverage: z.enum(['full', 'partial']).optional(), // set by OP5 pre-selection, not by the model (D7)
});
export type SectionDraft = z.infer<typeof SectionDraftSchema>;

/** Output of the intro job (abstract + introduction): topics only, never verified (delta D22). */
export const IntroDraftSchema = z.strictObject({
  mainTopic: z.string().min(1).max(200).nullable(),
  prerequisiteTopics: z.array(z.string().min(1).max(100)).max(10),
});
export type IntroDraft = z.infer<typeof IntroDraftSchema>;

export const REJECT_REASONS = ['NOT_FOUND', 'QUOTE_TOO_SHORT', 'QUOTE_TOO_LONG'] as const;

export const SummarySectionSchema = z.strictObject({
  summaryEs: z.string().max(2000),
  status: z.enum(['verified', 'no_verificado', 'abstract_only', 'failed']),
  evidence: z
    .array(z.strictObject({ quote: z.string(), section: SectionNameSchema, start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }))
    .max(5),
  rejected: z.array(z.strictObject({ quote: z.string().max(2000), reason: z.enum(REJECT_REASONS) })).max(5),
  numbersUnsupported: z.array(z.string()),
  coverage: z.enum(['full', 'partial']),
});
export type SummarySection = z.infer<typeof SummarySectionSchema>;

/** Summary v1. Stored in IndexedDB `summaries` under [doi+pipelineVersion]; written only by OP5V. */
export const SummarySchema = z.strictObject({
  doi: z.string(),
  pipelineVersion: z.string().min(1),
  mainTopic: z.string().nullable(),
  prerequisiteTopics: z.array(z.strictObject({ topic: z.string(), label: z.literal('background_knowledge') })),
  sections: z.strictObject({
    methodology: SummarySectionSchema.optional(),
    results: SummarySectionSchema.optional(),
    conclusions: SummarySectionSchema.optional(),
  }),
  provider: z.string(),
  modelId: z.string(),
  promptHash: z.string(),
  normaliserVersion: z.string(),
  createdAt: z.iso.datetime(),
  schemaVersion: z.literal(1),
});
export type Summary = z.infer<typeof SummarySchema>;

/** Provenance from OP5. pipelineVersion already includes NORMALISER_VERSION (OP5 plan §5). */
export interface ProviderMeta {
  provider: string;
  modelId: string;
  promptHash: string;
  pipelineVersion: string;
}
