import { z } from 'zod';

/** Converts each registry entry to a JSON Schema (draft 2020-12) document for eval/ (tech-spec-v3 §4.4). */
export function toJsonSchemas(registry: Readonly<Record<string, z.ZodType>>): Record<string, Record<string, unknown>> {
  return Object.fromEntries(Object.entries(registry).map(([name, schema]) => [name, z.toJSONSchema(schema) as Record<string, unknown>]));
}
