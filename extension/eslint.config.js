// @ts-check
import js from '@eslint/js';
import nounsanitized from 'eslint-plugin-no-unsanitized';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import local from './eslint-rules/boundaries.js';

// Tests for the security and boundary rules below: tests/lint/boundaries.test.ts.

const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((name) => ({
  name,
  message: 'Use core/http (allowlist, retry, limiter). Direct network access is forbidden (SYS-SEC-01, SYS-SEC-26).',
}));

export default tseslint.config(
  { ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': [
        'error',
        ...["innerHTML", "outerHTML"].map((p) => ({
          selector: `AssignmentExpression[left.property.name="${p}"]`,
          message: `Never assign ${p}. Render with textContent (SYS-SEC-20).`,
        })),
        ...["insertAdjacentHTML", "write", "writeln", "setHTMLUnsafe", "createContextualFragment"].map((m) => ({
          selector: `CallExpression[callee.property.name="${m}"]`,
          message: `${m}() injects HTML and is forbidden. Render with textContent (SYS-SEC-20).`,
        })),
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden (SYS-SEC-20).',
        },
        {
          selector: "MemberExpression[property.name='sync'][object.property.name='storage']",
          message: 'chrome.storage.sync is forbidden: keys and settings stay in storage.local (SYS-SEC-12).',
        },
      ],
    },
  },
  nounsanitized.configs.recommended,
  {
    // Module boundaries + single-writer stores (tech-spec-v3 §2). See eslint-rules/boundaries.js.
    files: ['src/**/*.{ts,tsx}', 'entrypoints/**/*.{ts,tsx}'],
    plugins: { local },
    rules: { 'local/boundaries': 'error' },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'entrypoints/**/*.{ts,tsx}'],
    ignores: ['src/core/http.ts', '**/*.test.ts'],
    rules: { 'no-restricted-globals': ['error', ...NETWORK_GLOBALS] },
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts', 'scripts/**/*.ts', 'eslint-rules/**/*.js', '*.config.{ts,js}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
