import type { z } from 'zod';

/**
 * Contract registry: the single source of entity and message schemas (tech-spec-v3 §4.4).
 * Empty until the first entity lands (OP1 PageContext). Every schema added here is exported
 * to JSON Schema for eval/ by `npm run schemas`.
 */
export const contracts: Readonly<Record<string, z.ZodType>> = {};
