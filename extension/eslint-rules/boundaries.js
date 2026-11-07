// @ts-check
/*
 * Local ESLint rule: module boundaries and single-writer stores.
 * Source of the rules: tech-spec-v3 §2 and the SVC0 plan §2. Tests: tests/lint/boundaries.test.ts.
 *
 * Import specifiers are matched as strings, so relative paths ("../scholarly/x") and the
 * WXT alias ("@/src/scholarly/x") are both covered. Paths are relative to the ESLint cwd
 * (the extension root).
 */
import path from 'node:path';

/** App modules under src/ and which other modules each may import (besides itself). */
export const MODULE_DEPS = {
  core: [],
  contracts: [],
  detect: ['core', 'contracts'],
  scholarly: ['core', 'contracts', 'settings'],
  text: ['core', 'contracts'],
  summary: ['core', 'contracts', 'text', 'scholarly', 'settings'],
  workspace: ['core', 'contracts', 'summary', 'scholarly'],
  settings: ['core', 'contracts'],
};

/** Files importable only from the listed globs. */
export const RESTRICTED = [
  { re: /(^|\/)core\/db\/schema$/, allow: ['src/core/db/**'], why: 'Raw Dexie tables are private to core/db. Use your module repository.' },
  { re: /(^|\/)repos\/articles$/, allow: ['src/scholarly/**'], why: 'articles is written only by scholarly (SVC2).' },
  { re: /(^|\/)repos\/status-checks$/, allow: ['src/scholarly/**'], why: 'status_checks is written only by scholarly (SVC2).' },
  { re: /(^|\/)repos\/texts$/, allow: ['src/text/**'], why: 'texts is written only by text (SVC3).' },
  { re: /(^|\/)repos\/summaries$/, allow: ['src/summary/validate.ts'], why: 'summaries is written only by OP5V (summary/validate.ts).' },
  { re: /(^|\/)repos\/feedback$/, allow: ['src/workspace/**'], why: 'feedback is written only by workspace (SVC5).' },
  { re: /(^|\/)repos\/logs$/, allow: ['src/core/log*.ts'], why: 'logs is written only by core/log (SVC0).' },
  {
    re: /(^|\/)core\/http$/,
    allow: ['src/core/**', 'src/scholarly/clients/**', 'src/summary/providers/**', 'src/text/clients/**', 'src/settings/probes.ts'],
    why: 'Network calls live only in client/provider folders (SYS-SEC-26).',
  },
  { re: /(^|\/)settings\/keys$/, allow: ['src/settings/**', 'src/summary/providers/**'], why: 'API keys are read only by summary/providers (SVC6).' },
];

/** Minimal glob → RegExp (supports ** and *). */
export function globToRegExp(/** @type {string} */ glob) {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .split('**')
    .map((part) => part.replace(/\*/g, '[^/]*'))
    .join('.*');
  return new RegExp(`^${body}$`);
}

/** Violation message for importing `spec` from `file` (posix, relative to root), or null. */
export function checkImport(/** @type {string} */ file, /** @type {string} */ spec) {
  const m = /^src\/([^/]+)\//.exec(file);
  const mod = m?.[1];
  if (mod && mod in MODULE_DEPS) {
    const allowed = new Set([mod, ...MODULE_DEPS[/** @type {keyof typeof MODULE_DEPS} */ (mod)]]);
    for (const other of Object.keys(MODULE_DEPS)) {
      if (!allowed.has(other) && new RegExp(`(^|/)${other}(/|$)`).test(spec)) {
        return `Module boundary: ${mod} may not import ${other} (tech-spec-v3 §2).`;
      }
    }
  }
  for (const r of RESTRICTED) {
    if (r.re.test(spec) && !r.allow.some((g) => globToRegExp(g).test(file))) return r.why;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: { type: 'problem', schema: [], docs: { description: 'Enforce module boundaries and single-writer stores.' } },
  create(context) {
    const file = path.relative(context.cwd, context.filename).split(path.sep).join('/');
    if (file.startsWith('..') || /\.test\.tsx?$/.test(file)) return {};
    /** @param {any} node */
    const check = (node) => {
      if (!node?.source || typeof node.source.value !== 'string') return;
      const message = checkImport(file, node.source.value);
      if (message) context.report({ node: node.source, message });
    };
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};

export default { rules: { boundaries: rule } };
