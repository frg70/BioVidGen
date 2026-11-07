import { defineConfig } from 'wxt';

// Manifest permissions are a Type 1 decision (CLAUDE.md). Any change here must
// update the snapshot in tests/e2e/extension.spec.ts (SYS-SEC-22) and cite an ADR.
export default defineConfig({
  imports: false,
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'es',
    minimum_chrome_version: '116',
    action: { default_title: '__MSG_actionTitle__' },
    permissions: ['storage'],
  },
});
