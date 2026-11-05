# Runbook — SVC0 core and CI gates

Owner: dev lead. Code: `extension/src/core/`, `extension/eslint-rules/`, `extension/scripts/`, `.github/workflows/ci.yml`.

## What SVC0 provides
| Piece | File | Contract |
|---|---|---|
| HTTP client | `src/core/http.ts` | allowlist → limiter → fetch with per-attempt timeout; 3 attempts, full jitter (500 ms base, 8 s cap), retries only network errors, 429, 502, 503, 504; `Retry-After` honoured up to 30 s. Codes: `HOST_NOT_ALLOWED`, `TIMEOUT`, `ABORTED`, `NETWORK`, `RATE_LIMITED`, `UPSTREAM_ERROR`, `HTTP_ERROR` |
| Egress allowlist | `src/core/egress.ts` | the only list of outbound hosts; used by http and the e2e fitness function |
| Limiter | `src/core/limiter.ts` | per-host GCRA bucket: OpenAlex 10 rps, Crossref 5, Europe PMC 5, others 5 |
| Log | `src/core/log.ts`, `log-sink.ts` | `log.op(runId, op, fn)`; strict whitelist; ring of 200 in IndexedDB `logs` (memory ring if the DB cannot open) |
| DB | `src/core/db/` | Dexie `biovidgen` v1; modules get an opaque `DbHandle` and their own repository only |
| Messaging | `src/core/messaging.ts` | Zod both ways; foreign senders ignored; content scripts refused by extension-only handlers |
| Flags, i18n, runId | `flags.ts`, `i18n.ts`, `runid.ts` | `summary.enabled` defaults to **false** until OP5 ships |

## Gates (all run in CI on every push and PR)
| Gate | Command | Fails when |
|---|---|---|
| Lint | `npm run lint` | module boundary or single-writer violation, `fetch` outside `core/http`, `innerHTML`/`insertAdjacentHTML`/`dangerouslySetInnerHTML`, `storage.sync` |
| Types | `npm run typecheck` | any TS error (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) |
| Unit | `npm test` | any Vitest failure |
| E2E | `npm run test:e2e` | a request outside the allowlist, a scholarly payload outside SYS-SEC-02, any extension request while browsing, or a manifest permission change |
| Licences | `npm run licenses` | a runtime package not MIT/BSD/Apache-2.0/ISC, or any GPL-family/SSPL/unknown licence |
| Audit | `npm audit --omit=dev --audit-level=high` | high/critical vulnerability in runtime dependencies |
| Secrets | gitleaks 8.30.1 in CI (`npm run secrets` locally if gitleaks is on PATH) | a secret anywhere in git history |

## Failures and responses
| Failure | Detection | Response |
|---|---|---|
| DB upgrade or open fails | `openDb` returns `DB_OPEN_FAIL`; panel logs to memory only | VW1 banner (when built): offer export, then reset caches (articles, status_checks, texts); keep summaries and feedback |
| 429 storm from a host | VW5 shows repeated `RATE_LIMITED` | lower the host rate in `HOST_RATES`; check the OpenAlex budget |
| E2E SYS-SEC-01 fails | CI e2e job; `playwright-report` artifact | read the violation URL. A new host needs an ADR, an `egress.ts` change and a VW3 privacy-table update; never widen the allowlist to make a test pass |
| SYS-SEC-22 manifest snapshot fails | CI e2e job | a permission changed. Type 1: cite the ADR in the PR and update the snapshot in `tests/e2e/extension.spec.ts` |
| Licence gate fails | CI checks job lists package, scope, licence | replace the dependency, or (dev-only, permissive) add the licence to `DEV_EXTRA` in `scripts/licenses-lib.ts` with a dependency-register entry |
| gitleaks finds a secret | CI secrets job (redacted output) | rotate the secret first, then purge history; never add an allow rule for a real key |
| Boundary lint blocks a legitimate import | `local/boundaries` error | the boundary is the design (tech-spec-v3 §2). Change `eslint-rules/boundaries.js` only with a spec delta and a fixture in `tests/lint/boundaries.test.ts` |

## Local setup
```
cd extension
npm ci                       # runs `wxt prepare`
npx playwright install chromium
npm run dev                  # opens Chromium with the extension loaded (WXT)
```
Load unpacked by hand: `npm run build`, then `chrome://extensions` → Developer mode → Load unpacked → `extension/.output/chrome-mv3`. Click the toolbar icon: the side panel opens with "Abre un artículo científico para ver sus datos aquí."

## Acceptance metric (P0 gate for SVC0)
All gates green locally and in CI; e2e allowlist canary proves capture of service-worker and extension-page requests.
