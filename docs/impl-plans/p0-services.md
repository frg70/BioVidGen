# Implementation plans — BioVidGen — P0 services (modules)

All modules live in one WXT/MV3 extension (`extension/`). "Runtime" means the Chrome execution context, not a server. Order follows the unit index: SVC0 → SVC6 → SVC1 → SVC2 → SVC3 → SVC4 → SVC5.

Repo layout (proposed):
```
extension/
  src/core/        (SVC0)  db.ts http.ts limiter.ts log.ts runid.ts flags.ts messaging.ts i18n.ts
  src/contracts/           Zod schemas (+ JSON Schema export script)
  src/detect/      (SVC1)  detect.ts sites.json badges.ts
  src/scholarly/   (SVC2)  clients/openalex.ts clients/crossref.ts resolve.ts status.ts preprint-patterns.json budget.ts
  src/text/        (SVC3)  extract-dom.ts segment.ts jats.ts pdf.ts headings.json
  src/summary/     (SVC4)  summarize.ts validate.ts normaliser.ts providers/{nano,ollama,openai}.ts prompts/*.txt providers.json
  src/workspace/   (SVC5)  export.ts feedback.ts templates/*.md
  src/settings/    (SVC6)  settings.ts probes.ts
  entrypoints/     content.ts sidepanel/ options/ background.ts
  _locales/es/ _locales/en/
  tests/ fixtures/
eval/              (SVC7, Python; next batch)
```

---

## SVC0 · core

1. **Responsibility & boundaries**: shared infrastructure: IndexedDB wrapper, HTTP client with retry and per-host limiter, runId, structured local log, feature flags, i18n, typed messaging. Owns no domain entity and holds no business rules. Owns the `logs` store (spec delta D4).
2. **Storage provisioning** (Dexie, DB `biovidgen`, version 1; consolidated from the op plans):
   | Store | Primary key | Indexes | Owner (writer) |
   |---|---|---|---|
   | `articles` | `doi` | `fetchedAt` | SVC2 |
   | `status_checks` | `[doi+checkedAt]` | `doi` | SVC2 |
   | `texts` (pinned only) | `[doi+contentHash]` | `doi` | SVC3 |
   | `summaries` | `[doi+pipelineVersion]` | `doi`, `createdAt` | SVC4 (OP5V) |
   | `feedback` | `++id` | `summaryKey` | SVC5 |
   | `logs` | `++seq` | `runId`, `at` | SVC0 |
   Capacity: one user, ≤10k articles (ASSUMPTION). IndexedDB quota is not a concern below ~100 MB, and summaries are ~10 KB each. `navigator.storage.persist()` is requested on first run, so Chrome will not evict.
   Per-store write guards: each module gets a narrow repository object from `core/db.ts`, and boundary lint stops other modules from importing another module's repository.
3. **Hosted operations**: none.
4. **API surface**: `db.repo(storeName)`; `http.get/post(url, {timeoutMs, retry, host})`; `limiter.for(host)`; `log.op(runId, op, fn)` (wraps timing and outcome); `newRunId()`; `flags.get(name)`; `t(key, subs)`; `messaging.send/handle(name, schema)`.
5. **Internal structure**: there is no domain layer. Messaging validates both directions with Zod and checks `sender.id === chrome.runtime.id`.
   Retry policy: 3 attempts, full jitter `sleep(random(0, min(cap, base·2^attempt)))`, base 500 ms, cap 8 s, `Retry-After` honoured. Retries happen only on network errors, 429, 502, 503 and 504.
   Limiter: one token bucket per host (OpenAlex 10 rps, Crossref 5 rps, Europe PMC 5 rps, LLM providers from `providers.json`).
6. **Runtime**: the code is imported into each context. Log writes go from the side panel (and the options page) to IndexedDB. Content scripts send log events to the panel and do not write to IndexedDB themselves.
7. **Reliability**: an IndexedDB open failure (private profile, quota) puts the extension in memory-only mode with a banner. The log ring keeps the last 200 entries, trimmed on insert.
8. **Security**: no secrets handled. The log schema has no free-text field for article content: only `{seq, at, runId, op, durationMs, outcome, errorCode, provider?, calls?, sizes?}`. A test asserts that no other keys are accepted.
9. **Observability**: provides the primitives. VW5 reads `logs`.
10. **Runbook**:
    | Failure | Detection | Response |
    |---|---|---|
    | DB upgrade fails | banner + log `DB_UPGRADE_FAIL` | offer export, then reset caches (articles, status, texts); keep summaries and feedback |
    | 429 storm from a host | VW5 shows repeated `RATE_LIMITED` | lower the limiter rate in config; check budget |
11. **Tasks**: (1) tests for retry/jitter/limiter with fake timers; for messaging sender checks; for the log schema whitelist (0.5 d). (2) Dexie schema v1 and repositories (0.5 d). (3) http and limiter (0.5 d). (4) log, runId, flags, i18n (0.5 d). (5) boundary lint config (`eslint-plugin-boundaries`, verify licence) plus CI (lint, tsc, vitest, licence scan failing on AGPL/GPL, gitleaks) (1 d).

## SVC6 · settings

1. **Responsibility**: owns Settings (provider choice, API keys, OpenAlex key and email, filter mode, enabled sites, free-tier acknowledgement). Does not call providers except for availability probes.
2. **Storage**: `chrome.storage.local` keys `settings.v1` (non-secret) and `keys.v1` (secrets map). Nothing goes in `storage.sync`. A test spies on `chrome.storage.sync`, which is never called.
3. **Operations**: none from the map. Probes: Nano `availability()`, Ollama `GET /api/tags`, key test (1 tiny call, user-triggered).
4. **API**: `getSettings()`, `setSettings(patch)` (options page only), `getKey(providerId)` (callable only from `summary/providers/*`, enforced by lint), `probe(providerId)`.
5. **Structure**: Zod `SettingsSchema` with defaults and migration `vN→vN+1` functions.
6. **Runtime**: options page writes; side panel reads; `storage.onChanged` propagates updates.
7. **Reliability**: corrupt settings fall back to defaults, and keys are kept if they parse.
8. **Security**: keys are masked in the UI (last 4 characters shown) and excluded from export and diagnostics (redaction test). "Clear all" removes keys after confirmation.
9. **Observability**: probe results are logged as `{op:"PROBE", provider, outcome}`.
10. **Runbook**: when a key is rejected (401), VW3 shows "clave inválida" and the summary path uses the next provider.
11. **Tasks**: tests (schema, redaction, sync spy) 0.5 d → implementation 0.5 d → probes 0.5 d (after S1/S2).

## SVC1 · detect

1. **Responsibility**: runs OP1 in the content script and renders list badges (VW2 in the next batch). Owns PageContext. Has no network and no storage of domain data.
2. **Storage**: in-memory PageContext per tab, plus `sites.json`.
3. **Operations**: OP1, triggered on `document_idle`, debounced DOM mutations and navigation events. Also `detect.renderBadges` on the panel's request.
4. **API/events**: emits the `PaperDetected` message. Handles `detect.getPageContext`, `detect.renderBadges` and `text.extractDom` (hosted here for SVC3 because it needs the page context; the code is owned by SVC3 and lives in `src/text/extract-dom.ts`).
5. **Structure**: `content.ts` entrypoint → `detect.ts` (pure) → `messaging`. Badges render in a closed shadow root.
6. **Runtime**: manifest `content_scripts` match patterns: the article/publisher sites in `sites.json` plus `activeTab` for any page when the user opens the panel. List sites use optional host permissions (`chrome.permissions.request` from VW3).
7. **Reliability**: if the DOM throws, the error is caught and `PaperDetected{kind:"other"}` is sent with log `DETECT_ERROR`.
8. **Security**: isolated world; sender checks; no `innerHTML`.
9. **Observability**: detection outcome and duration are logged via the panel.
10. **Runbook**:
    | Failure | Detection | Response |
    |---|---|---|
    | Site layout change | user issue `site-breakage`, fixture fails | add or adjust `sites.json` entry with a fixture |
    | Wrong paper | user reports, title mismatch | check meta order and cited-DOI guard |
11. **Tasks**: see OP1 plan. Then the content entrypoint and match patterns (0.5 d).

## SVC2 · scholarly

1. **Responsibility**: owns Article and StatusCheck. Talks to OpenAlex and Crossref (Unpaywall is optional, later). Does not do text or summaries.
2. **Storage**: `articles`, `status_checks` (see SVC0). Budget counter `budget.openalex.{yyyy-mm-dd}` in `chrome.storage.local`.
3. **Operations**: OP3 (on `PaperDetected` with DOI), OP12 (panel open, re-check button, list pages).
4. **API/events**: `scholarly.resolve`, `scholarly.checkStatus`, `scholarly.getArticle`, `scholarly.latestStatus`. Emits `ArticleResolved` and `StatusChecked`.
5. **Structure**: `clients/*` (HTTP and upstream Zod schemas) → `resolve.ts`, `status.ts` (merge rules, decision table, pure functions) → repositories. The wording function `statusText()` lives here and is shared by VW1, VW2 and OP13.
6. **Runtime**: side panel. Service-worker alarm `gc-daily` deletes articles older than 90 d and trims status history.
7. **Reliability**: timeouts 5 s; stale-while-revalidate; degrade to "no se pudo comprobar" with the sources that failed.
8. **Security**: outbound allowlist (OpenAlex, Crossref); payload is DOIs only; OpenAlex key from SVC6 is added only to OpenAlex URLs.
9. **Observability**: per-host error rate, latency, budget usage in VW5. Weekly CI job for recall and precision (OP12 task 8). Alerts go to the dev lead via CI failure.
10. **Runbook**:
    | Failure | Detection | Response |
    |---|---|---|
    | OpenAlex outage | errors in VW5, CI fixtures pass | stale cache is shown automatically; nothing to do |
    | Recall drop | weekly CI red | inspect new RW items missed; update query or patterns |
    | Budget exhausted | `BUDGET_EXCEEDED` logs | advise adding a free OpenAlex key (VW3) |
11. **Tasks**: OP3 tasks → OP12 P0 tasks → GC alarm → OP12 P1 tasks.

## SVC3 · text

1. **Responsibility**: owns ArticleText. Acquires and segments text. Holds no model logic.
2. **Storage**: session `Map` in the side panel. `texts` store only for pinned items.
3. **Operations**: OP4, triggered by user "Resumir" (and, in P3, prefetch when the panel opens on a usable article, behind a flag).
4. **API**: `text.acquire(doi, tabId)`; content-script handler `text.extractDom`. Emits `TextAcquired`.
5. **Structure**: `extract-dom.ts` (content script), `segment.ts`, `jats.ts`, `pdf.ts` (side panel), `headings.json`.
6. **Runtime**: the pdf.js worker is bundled (P2). The Europe PMC fetch needs host permission `https://www.ebi.ac.uk/*` in the manifest.
7. **Reliability**: fallback chain DOM → JATS → abstract.
8. **Security**: visible text only; DOMPurify; no HTML to the panel; session-only storage.
9. **Observability**: `source`, `usable` and the sizes of each section are logged, never the text.
10. **Runbook**: when usable text drops on a site, check fixtures, Readability version and heading synonyms.
11. **Tasks**: see the OP4 plan.

## SVC4 · summary

1. **Responsibility**: owns Summary. Contains the provider adapters, prompts, orchestration of the four calls, and the validator. **OP5V is the only writer of `summaries`.** This module holds the LLM trust boundary.
2. **Storage**: `summaries` (PK `[doi+pipelineVersion]`, indexes `doi`, `createdAt`). Session draft cache in memory.
3. **Operations**: OP5 (user action "Resumir"), OP5V (called by OP5 only).
4. **API/events**: `summary.summarize`, `summary.getLatest(doi)`, `summary.listRecent(50)`. Emits `SectionValidated` and `SummaryStored`.
5. **Structure**: `summarize.ts` (application) → `providers/*` (infrastructure, the only network code here) and `validate.ts` + `normaliser.ts` (domain invariants). `pipelineVersion` is computed at build time from prompt file hashes plus `providers.json` model ids, and at run time combined with the actual model id.
6. **Runtime**: side panel page. The panel must stay open during summarisation; the S4 spike confirms the panel keeps calls alive. On panel close, AbortController cancels and no partial Summary is stored.
7. **Reliability**: 2 retries per provider, then the next provider once. Timeouts are 60 s per section. Circuit breaker per provider: 3 consecutive `QUOTA` or `TRANSPORT` errors mark the provider "no disponible" for 10 min.
8. **Security**: no tools; delimiter nonce; schema-constrained output; keys from SVC6 used only inside `providers/*`; free-tier acknowledgement gate; output rendered as text.
9. **Observability**: per provider: calls, schema failures, reject rate, p95. Eval report (VW7) per prompt version. A drop in CI eval agreement alerts the QFB lead.
10. **Runbook**:
    | Failure | Detection | Response |
    |---|---|---|
    | Free tier changed (quota/model removed) | `QUOTA`/404 spikes, user reports | update `providers.json`, release |
    | Validator false rejects up | reject rate >30% for a provider | inspect `rejected` reasons; add measured normalisation (OP5V task 6) |
    | Validity incident (unverified quote shown as verified) | user report / CI adversarial | **stop-ship**: disable `summary.enabled` flag in a hotfix release; add a regression test |
11. **Tasks**: OP5V tasks 1–5 (P0) → OP5 task 1 stub (P0) → OP5 tasks 2–11 (P3).

## SVC5 · workspace

1. **Responsibility**: owns Feedback. Hosts export (OP13) and feedback capture (OP14, next batch).
2. **Storage**: `feedback` store; templates bundled.
3. **Operations**: OP13 (user click), OP14 (user click, P3).
4. **API**: `workspace.export`, `workspace.mark`, `workspace.exportFeedback`.
5. **Structure**: `export.ts` (buildModel and render), `feedback.ts`, `templates/`.
6. **Runtime**: side panel.
7. **Reliability**: pure functions; a failed clipboard write falls back to download.
8. **Security**: no keys or diagnostics in exports; escaping.
9. **Observability**: export count is local only (shown in VW5 for opt-in diagnostics).
10. **Runbook**: if a template renders with missing fields, check the template-render test.
11. **Tasks**: see the OP13 plan; OP14 is in the next batch.
