import { defineContentScript } from 'wxt/utils/define-content-script';

// Placeholder until OP1. Match patterns are a Type 1 decision owned by OP1 (sites.json).
// Empty `matches` + `registration: 'runtime'` keeps it out of the manifest and adds no
// host permission (a non-empty list here would leak into host_permissions).
export default defineContentScript({
  matches: [],
  registration: 'runtime',
  main() {},
});
