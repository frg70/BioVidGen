# Implementation plans — BioVidGen — Batch 1 (Phase P0)

Stage 3 of the pipeline (process-mapper → process-tech-spec → **process-impl-plans**). Inputs: [system-spec-v3.yaml](../process-design/system-spec-v3.yaml), [tech-spec-v3.md](../process-design/tech-spec-v3.md), [discovery spec.yaml](../discovery/spec.yaml). Date 2026-11-05.

Every operation plan is test-first, in this order: objective & metrics → hypothesis, security, unit, type, value and performance tests → spec & logic → bottlenecks → dependencies and an ordered task list. In each task list, the first tasks write the tests and show them failing.

## Batch 1 contents (all P0 units)

| Unit | Kind | Plan | Phase coverage |
|---|---|---|---|
| SVC0 core, SVC6 settings, SVC1 detect, SVC2 scholarly, SVC3 text, SVC4 summary, SVC5 workspace | services | [p0-services.md](p0-services.md) | P0 (+ later-phase notes) |
| OP1 Detect paper | operation | [op/OP1-detect-paper.md](op/OP1-detect-paper.md) | P0 |
| OP3 Resolve metadata | operation | [op/OP3-resolve-metadata.md](op/OP3-resolve-metadata.md) | P0 |
| OP12 Check status | operation | [op/OP12-check-status.md](op/OP12-check-status.md) | P0 panel, P1 lists |
| OP4 Acquire & segment text | operation | [op/OP4-acquire-segment-text.md](op/OP4-acquire-segment-text.md) | P0 DOM, P2 JATS/PDF |
| OP5V Validate evidence | operation | [op/OP5V-validate-evidence.md](op/OP5V-validate-evidence.md) | P0 |
| OP5 Summarise section | operation | [op/OP5-summarise-section.md](op/OP5-summarise-section.md) | P0 stub, P3 LLM |
| OP13 Export appraisal sheet | operation | [op/OP13-export-appraisal-sheet.md](op/OP13-export-appraisal-sheet.md) | P0 default, P3 club |
| VW5 Diagnostics, VW3 Options, VW1 Paper panel | views | [p0-views.md](p0-views.md) | P0 (+ P3 notes) |

## P0 build order (critical items first)
1. SVC0 + CI gates: boundary lint, licence scan, secret scan, network allowlist e2e.
2. Spikes S1–S7 run in parallel with step 1. Their numbers go into the hypothesis tables of the op plans.
3. OP5V, before any model exists, so the guarantee is tested first.
4. OP1 → OP3 → OP12 (panel path) → OP4 (DOM) → OP5 stub → OP13.
5. VW5 → VW3 (basic) → VW1 skeleton.
6. P0 exit check (tech-spec-v3 plan): one paper flows end to end on 3 publishers; 0 false accepts; all gates green.

Rough P0 effort from the task lists is 22–30 developer-days plus 1 expert-day. That fits the 2–4 week P0 estimate for two developers, with low confidence.

## Spec deltas (feed back to tech-spec-v3 / system-spec-v3)

| # | Unit | Spec said | Plan needs | Reason |
|---|---|---|---|---|
| D1 | OP1 / PageContext | `{tabId, url, kind, doi?, pmid?, title?, resultIds[]}` | add `pmcid`, `metaKeywords[]`, `doiSource`, `candidates[]`, `truncated`, `rulesVersion` | OP3 merges page keywords; ambiguity must be explicit (cited-DOI guard) |
| D2 | OP4 / manifest permissions | minimal host permissions; optional only for list sites | fixed host `www.ebi.ac.uk` (Europe PMC) in the manifest; other OA origins only through runtime optional permission on user gesture | fetching OA HTML/PDF from arbitrary publishers would otherwise need `<all_urls>` |
| D3 | Article schema | no `pmcid`, `abstract`, `coverage` | add `pmid`, `pmcid`, `abstract`, `isOA`, `coverage`, `sources`, `crossrefType` | OP4 JATS path and abstract-only mode; "none found" ≠ "not asked" |
| D4 | SVC0 | log as in-memory ring buffer | persisted `logs` store (≤200, trimmed) owned by SVC0 | diagnostics must survive panel close |
| D5 | OP12 / NFR badge p95 ≤2 s | single pass | two-pass progressive badges: OpenAlex batch inside 2 s, Crossref refinement after; `completeness` field on StatusCheck | per-DOI Crossref calls for 25 items cannot fit 2 s |
| D6 | OP12 preprint rule | prefix list (10.1101, …) | pattern list (bioRxiv/medRxiv date or numeric suffix) | 10.1101 is shared with Cold Spring Harbor journals (e.g., Genome Research) |
| D7 | Summary schema | sections without coverage info | `coverage: full | partial` per section; `rejected[]`, `numbersUnsupported[]` | small-context pre-selection must be visible; reject reasons feed eval |
| D8 | OP5V normalisation | "exact after normalisation" | normalisation includes case folding (documented) and NFKC; never fuzzy | measured false rejects; case does not change meaning, while fuzzy matching could |
| D9 | SVC4 reliability | retries only | per-provider circuit breaker (3 consecutive QUOTA/TRANSPORT → 10 min off) | avoid burning user quota and time |
| D10 | VW1 | — | "Mostrar de todos modos" reveals `no_verificado` text with a warning; never counts as verified in export | map said text hidden behind a click (v2); made explicit |

| D11 | SVC0 retry count | tech-spec-v3 §7: "retry 3×"; SVC0 plan §5: "3 attempts" | **3 attempts in total** (2 retries) | the two documents conflict; the plan outranks the spec. Change `DEFAULT_RETRY.attempts` if 3 retries were meant |
| D12 | SVC0 timeouts | not stated | a timed-out attempt is **not** retried (`TIMEOUT`); `Retry-After` > 30 s fails fast with `RATE_LIMITED` | the plan's retry list (network, 429, 502–504) excludes timeouts; 3×5 s waits would stall the panel |
| D13 | Boundary lint | `eslint-plugin-boundaries` or `dependency-cruiser` | in-repo ESLint rule `extension/eslint-rules/boundaries.js` plus `no-restricted-globals` for `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource` outside `core/http` | single-writer stores need per-file allow-lists (e.g. only `summary/validate.ts` may import the summaries repo). Tested by SYS-SEC-26 fixtures |
| D14 | Network ownership | §2: only `scholarly/clients/*` call scholarly APIs; §2 figure: SVC3 fetches Europe PMC by PMCID | `core/http` importable from `scholarly/clients/**`, `summary/providers/**`, `text/clients/**` (Europe PMC, OP4) and `settings/probes.ts` | the spec contradicts itself on SVC3; OP4 should put its Europe PMC client in `text/clients/` |
| D15 | SVC0 repositories | "each module gets a narrow repository object from `core/db.ts`" | repositories in `core/db/repos/<store>.ts`; modules receive an opaque `DbHandle` and cannot reach tables without their repository (compile-time, SVC0-TYPE-01) | makes one-writer-per-store structural, not only lint-enforced |
| D16 | Limiter | token bucket | GCRA (virtual-scheduling form of a token bucket), burst = 1 s of rate | a float token balance drifted by 1 ms and broke the rate bound (found by SVC0-PROP-02) |
| D17 | Manifest (P0 scaffold) | `sidePanel`, `storage`, `activeTab`; API host permissions | scaffold ships **only `sidePanel` + `storage`**; no `activeTab`, no host permissions, no `content_scripts` (content entrypoint built with `matches: []`, `registration: 'runtime'`) | least privilege until a feature needs them; OP1 (content matches, activeTab) and OP3 (API hosts, if CORS requires) add them with an ADR reference. A non-empty `matches` leaks into `host_permissions` even with runtime registration |
| D18 | SYS-SEC-02 | allowed scholarly params: `mailto`, `api_key`, `select`, `filter`, `per-page` | unchanged for now | **open:** Unpaywall needs `email=`; add it to the catalog row and `SCHOLARLY_PARAMS` when Unpaywall is enabled |
| D19 | Repo layout | `_locales/es`, `_locales/en` under `extension/` | `extension/public/_locales/{es,en}` | WXT copies `public/` as-is; Chrome has no `es_MX` locale code, so es-MX strings live in `es` |
| D20 | Log schema | whitelist of keys | whitelist of keys **and** constrained values: `op`, `errorCode`, `provider`, `sizes` keys are short identifiers (regex); an invalid entry is replaced by `BAD_LOG_ENTRY` | free text cannot hide inside whitelisted fields |
| D21 | Messaging | Zod both directions + `sender.id` check | also a sender-role check (`extension` vs `content`, default `extension`) and envelope `{v:1, name, payload}`; tab-targeted messages (panel → content script) arrive with OP1 | content scripts run in hostile pages and must not reach privileged handlers |

| D22 | OP5V / SectionDraft | `section: SectionName`; intro job output not typed; `validateAndStore(doi, drafts, text, meta)` | draft `section` names the Summary slot (`methodology`/`results`/`conclusions`); separate `IntroDraftSchema {mainTopic, prerequisiteTopics}`; `drafts = {intro?, sections[]}`; Summary key field is `doi` (SVC0 store key), not `doi_norm` | the plan's `map(d.section)` had no defined mapping, and the intro job's output had no schema |
| D23 | OP5V matching | "normalised substring" | a match must cover whole original clusters and **must not start or end inside a word** (`effective` inside `ineffective` is rejected); the matcher lives in `normaliser.ts`, so the CFG-01 hash guard covers it | a mid-word cut can flip meaning (negation prefix). Stricter, never fuzzy. Known limit: a quote that drops a leading whole word (`not`) is still a verbatim excerpt |
| D24 | OP5V numbers rule | `/[-+±]?\d+(?:[.,]\d+)?\s?%?/` | the sign counts only at the start of a token (`5-10` → 5, 10; `COVID-19` → 19); digits glued to letters are not numbers (`HbA1c`); `n` and `statistics` are checked too | the plan regex turned ranges into negative numbers, which gave false rejects |
| D25 | OP5V errors | `Result<Summary, "ALL_SECTIONS_FAILED">` | adds `STORE_FAILED` (put retried once, then fails; nothing stored) | OP5V-RES-01 needs a code for a blocked or aborted transaction |
| D26 | OP5V-PERF-01 | catalog: p95 ≤ 20 ms; plan §7: target 20 ms, fails when > 100 ms | the PR test asserts the plan's **fail line, p95 ≤ 100 ms**; 20 ms stays the target, printed by the test and recorded in memory.md (this laptop: p50 16 ms, p95 19–27 ms) | owner decision 2026-11-05: a 20 ms wall-clock assertion is flaky on shared machines |
| D27 | OP1 DOI validity | `DOI_RE_STRICT`; strip trailing `.,;)]` | also reject markup: `<` must be followed by a digit (SICI) and `>` needs an earlier `<`; strip `)` only when unbalanced | the plan's regex accepts `10.1234/<script>alert(1)</script>`, against OP1-SEC-02; stripping every `)` corrupts real DOIs ending in `(1)` |
| D28 | OP1 `doiFromUrl` | any DOI in the URL | path, or the `id`/`doi` parameters only; strip page-view tails (`/full`, `/pdf`, `.full.pdf`, `.article-info`…) | Frontiers `…/fpubh.2020.00152/full` would become a wrong DOI; a `?cite=` parameter names another paper |
| D29 | OP1-SEC-03 | oversize values truncated + flag | url, title, keywords as written; an **oversize DOI is rejected** and flagged, never cut | a shortened DOI names a different paper |
| D30 | OP1 `kind` | `jsonLdIsArticle` or `og:type=article` or pmid | scholarly JSON-LD types, `citation_title`, pmid or pmcid; `og:type=article` only with a DOI nearby. OP1-PROP-01 also accepts pmcid | real news pages carry `og:type=article` and a title (OP1-UNIT-12); a PMCID identifies a paper as well as a PMID |
| D31 | OP1 contract | `PageContext{tabId,…}` from `detectPaper`; debounce 500 ms; "version noted" [decide] | `DetectedPage` without `tabId` (panel adds it from `sender.tab.id`); adds `version` (owner, 2026-11-05: strip from the DOI, keep the number; preprint servers only), `notes`, `schemaVersion`; at most one run per 500 ms instead of a pure debounce; `doiSource` logged inside `sizes` (D20 whitelist); `site_rule` source defined but unused | a content script runs in a hostile page and cannot vouch for its tab; a pure debounce never fires on a page that keeps changing |
| D32 | SVC1 runtime, OP1-UNIT-17 | site list + `activeTab`; PDF needs a URL fallback and a manual box | **site list only** (ADR-0011: `activeTab` is not granted with `openPanelOnActionClick` on); no PDF fallback, because content scripts do run in Chrome's PDF viewer. Manual DOI box deferred to OP3/VW1 | both measured in Google Chrome 156, 2026-11-05 |
| D33 | OP1 manual DOI | deferred in D32 | in the panel now: a form when the page gives no usable DOI, on or off the list. Adds `doiSource:"manual"` (additive) and `PanelState.navigation`. Shown as "not checked yet" until OP3 can resolve it. Lost on a tab change or navigation | closes the off-list gap of ADR-0011 with no new permission; off the list the page stays null across navigations, so only a counter stops a typed DOI from carrying over to the next page |
| D34 | OP5V Python port (ADR-0010 step 2) | "ported unchanged"; mutmut | same behaviour, proved by vectors frozen from the TypeScript reference, with two stricter differences: lone surrogates refused at the boundary; a quote cannot start or end inside a word written in characters above U+FFFF. Stored offsets stay UTF-16 units; schema limits count code points, as Zod 4 does. Mutation testing uses `backend/scripts/mutation_run.py` (standard library) | surrogates cannot be stored in SQLite; the reference tests words one UTF-16 unit at a time and misses letters above U+FFFF; mutmut refuses native Windows and cosmic-ray depends on LGPL yattag |
| D35 | ADR-0010 step 3 (`be1-extension-client.md`) | step 3 ships "POST page text → render"; API keys move with the client | step 3 ships pairing and the backend-off state only. Page text and the OP5V endpoint move to OP4 and the OP5 stub; API keys move with OP5. OP1-E2E-04 and OP1-SEC-01 now allow exactly `GET /health`, because the panel checks the backend when it opens; everything else they forbid stays forbidden, and BE1-SEC-03 proves the check carries nothing about the page | nothing produces page text or drafts yet, and no API keys exist, so those parts would have no caller |
| D36 | OP3 (`op/OP3-resolve-metadata.md`) | OpenAlex + Crossref in parallel, merged with page meta; Dexie; stale-while-revalidate; optional OpenAlex key | **OpenAlex only**, in the backend (ADR-0010): `GET /api/v1/article?doi=`, SQLite `articles`. No page meta merge (the panel already shows the page title), no `sources` or `crossrefType`, no key (single lookups are free). A stale record is refreshed inside the request, with the old copy as fallback. Catalog rows UNIT-04, UNIT-14, INT-02, SEC-04, RES-03 rewritten to match | spike 2026-11-07: Crossref added +0 pp coverage on 404 DOIs (H2 threshold +5 pp; plan adapt rule applied, owner approved), and Crossref returned no `subject`. Cold p95 0.78 s makes a background refresh not worth a thread |
| D37 | OP3 Article (found in the OP12 S3 spike) | Article v1 describes the DOI asked for; `type` shown as is | Article **v2** adds `matchedDoi`: the DOI OpenAlex answered with when it differs. The panel names that record above the details and never shows OpenAlex's `preprint` type. Stored v1 rows read as misses and are fetched again (OP3-MIG-01). Backend SQLite uses `synchronous = NORMAL` | OpenAlex answered 12 of 34 bioRxiv DOIs with the published article, and typed all 50 sampled Genome Research / Genes & Development articles as `preprint`. The fsync per commit cost up to 82 ms per log row on a busy disk, breaking OP3-PERF-01 |

None of these change module ownership, entity ownership or phase order.

## Next batch (remaining units)

| Unit | Kind | Phase | Depends on |
|---|---|---|---|
| SVC7 eval (Python tool: queue, adjudication, κ, runner, JSON Schema import) | service | P1 | contracts |
| OP11 Expert summary & gold set (concierge) | operation (HUMAN) | P1–P2 | SVC7 |
| VW6 Annotation queue | view (work_queue) | P1 | SVC7 |
| VW2 Result-list badges | view | P1 | OP12 list path, SVC1 |
| VW7 Eval report | view (report) | P2 | SVC7 |
| OP14 Capture feedback | operation | P3 | OP5V |
| VW4 Export preview | view | P3 | OP13 |

The P1 items (SVC7, OP11, VW6, VW2) should be planned before P0 ends. OP11 batch 1 sits on the critical path (ADR-0008 gate).
