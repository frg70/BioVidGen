import type { z } from 'zod';
import { ArticleTextSchema, IntroDraftSchema, SectionDraftSchema, SummarySchema } from './pipeline';

/**
 * Contract registry: the single source of entity and message schemas (tech-spec-v3 §4.4).
 * Every schema added here is exported to JSON Schema for eval/ by `npm run schemas`.
 */
export const contracts: Readonly<Record<string, z.ZodType>> = {
  ArticleText: ArticleTextSchema,
  SectionDraft: SectionDraftSchema,
  IntroDraft: IntroDraftSchema,
  Summary: SummarySchema,
};
