/** npm run schemas — writes eval/schemas/<Name>.schema.json from the Zod contract registry. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contracts } from '../src/contracts/index';
import { toJsonSchemas } from '../src/contracts/json-schema';

const OUT = join(import.meta.dirname, '..', '..', 'eval', 'schemas');
const schemas = toJsonSchemas(contracts);
const names = Object.keys(schemas);
if (names.length > 0) mkdirSync(OUT, { recursive: true });
for (const name of names) writeFileSync(join(OUT, `${name}.schema.json`), `${JSON.stringify(schemas[name], null, 2)}\n`);
console.log(`Exported ${names.length} schema(s)${names.length ? ` to ${OUT}` : ' (registry is empty until OP1)'}.`);
