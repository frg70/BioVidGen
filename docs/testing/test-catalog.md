# BioVidGen — Test & Security Catalog

Date: 2026-11-05 · Status: Proposed · Owners: dev lead (code tests), QFB lead (eval, human tests), product lead (KPI/pilot tests)
Sources: [impl-plans](../impl-plans/README.md) (P0 plans), [tech-spec-v3](../process-design/tech-spec-v3.md), [discovery-process-map](../discovery/discovery-process-map.md), ADR-0004/0006/0007/0008/0009.
Scope: every test that must pass for each operation (OP1, OP3, OP12, OP4, OP5, OP5V, OP13, OP14, OP11), the system-wide tests that apply to all of them, and the KPI / hypothesis tests that decide whether the product works.
Notation: `[specify]` unknown · `[decide]` a product decision the test exposes · `[verify]` external fact to confirm in a spike · ASSUMPTION = inference.

## 0. How to use this catalog

**Test ID** `<unit>-<TYPE>-<nn>`, e.g. `OP12-SEC-03`. A test ID is permanent; retired tests are struck through, never renumbered.

**Types**
| Code | Type | What it proves | Typical tool |
|---|---|---|---|
| HYP | Hypothesis / spike | an assumption the design rests on is true on real data | one-off script, recorded fixtures |
| UNIT | Unit | behaviour of one function in isolation, incl. edge and error cases | Vitest / pytest |
| PROP | Property-based | invariants hold for all generated inputs | fast-check / Hypothesis |
| TYPE | Type & schema | contracts compile and validate; nullable ≠ empty | tsc, Zod, JSON Schema |
| CON | Contract | producer output satisfies consumer; upstream API shape unchanged | recorded fixtures, consumer tests |
| INT | Integration | modules + IndexedDB + mocked network together | Vitest + fake-indexeddb + MSW |
| E2E | End-to-end | real Chrome, real extension, fixture pages | Playwright (persistent context, unpacked extension) |
| SEC | Security & privacy | authz, injection, secrets, egress, XSS, supply chain | Vitest, Playwright, lint, scanners |
| VAL | Value / eval | output changes a decision for its consumer | eval harness (SVC7), pilot |
| PERF | Performance | latency, memory, payload, budget at stated n | Playwright perf, Vitest bench |
| RES | Resilience / chaos | degrade correctly under failures | MSW fault injection |
| MIG | Migration / upgrade | data and settings survive version changes | Dexie upgrade tests |
| MUT | Mutation | tests actually catch faults in critical code | Stryker (Apache-2.0 ⚠️ verify) |
| FUZZ | Fuzzing | parser does not crash/hang on hostile input | fast-check arbitraries, corpus |
| A11Y | Accessibility | WCAG 2.1 AA | axe-core (dev-only), keyboard scripts, NVDA |
| I18N | Localisation | es-MX complete, formats correct | string-coverage test |
| COMP | Compatibility | Chrome versions, OS, hardware tiers | manual matrix + CI on Linux |
| OBS | Observability | logs carry runId, no forbidden fields | Vitest |
| HUM | Human process | expert work is reliable and on time | κ, checklists |
| CFG | Config validity | rule/config files are valid, safe (no catastrophic regex) and covered by fixtures | Zod, safe-regex |
| META | Metamorphic | output changes, or stays the same, as it should when the input is transformed; for LLM steps with no single right answer | eval harness |
| KPI | KPI / research | product reaches its business and research targets | pilot protocol, statistics |

**Gates** (when a test must pass)
| Gate | Runs | Blocks |
|---|---|---|
| PR | every pull request (CI) | merge |
| NIGHT | nightly CI | next day's merges if red |
| WEEK | weekly scheduled CI (live sources) | release |
| EVAL | on any change to prompts, model ids, normaliser, headings, provider config | release of that change |
| REL | release checklist | publishing a build |
| SPIKE | once, before the unit is built (re-run on revisit triggers) | starting the build |
| PILOT | during pilot cohorts | phase exit / ADR decisions |
| HUMAN | manual, recorded in `eval/` | phase exit |

**Severity**: tests marked **🛑** are stop-ship: any failure blocks every release, regardless of phase.

---

## 1. System-wide tests (apply to every operation)

### 1.1 Privacy & egress
| ID | Variant | Given → Expected | Gate |
|---|---|---|---|
| SYS-SEC-01 🛑 | network allowlist | e2e over all fixture flows; every request host ∈ {api.openalex.org, api.crossref.org, www.ebi.ac.uk, api.unpaywall.org (if enabled), chosen LLM host, localhost:11434} → else fail | PR |
| SYS-SEC-02 🛑 | payload allowlist | to scholarly hosts only DOI/PMID/PMCID, `mailto`, `api_key`, `select`, `filter`, `per-page` params; no URL of visited page, no title, no runId | PR |
| SYS-SEC-03 🛑 | no telemetry | zero requests when the user only browses (no panel opened) on 20 fixture pages | PR |
| SYS-SEC-04 | LLM payload scope | each LLM request body contains exactly one section text + prompt; no Settings, Feedback, URL history, other tabs | PR |
| SYS-SEC-05 | privacy table truth | VW3 "qué sale de tu computadora" table equals the allowlist constant used by SYS-SEC-01 | PR |
| SYS-SEC-06 | free-tier notice | with a free-tier key and `freeTierAck=false`, no request reaches the LLM | PR |
| SYS-SEC-07 | unpublished text rule | [decide] if a "paste text" feature is ever added: pasted text never sent to free-tier providers | PR (when feature exists) |

### 1.2 Secrets
| ID | Variant | Given → Expected | Gate |
|---|---|---|---|
| SYS-SEC-10 🛑 | keys not in logs | seed keys; run every op incl. failures; `logs` store and console output contain no key substring (≥8 chars) | PR |
| SYS-SEC-11 🛑 | keys not in exports | OP13 export, OP14 export, diagnostics copy, "export all" JSON → no key substring | PR |
| SYS-SEC-12 | keys not in sync | `chrome.storage.sync.set` never called (spy) | PR |
| SYS-SEC-13 | keys only to own host | Gemini key only in requests to its base URL; Groq key only to Groq; etc. | PR |
| SYS-SEC-14 | repo secret scan | gitleaks finds no secrets in history | PR |
| SYS-SEC-15 | key masked in UI | after reload, key inputs show only last 4 chars; DOM never contains full key | PR |

### 1.3 Browser & extension hardening
| ID | Variant | Given → Expected | Gate |
|---|---|---|---|
| SYS-SEC-20 🛑 | no `innerHTML` with external data | lint rule `no-unsanitized` + grep; all model/page/API strings rendered via `textContent` | PR |
| SYS-SEC-21 | CSP | manifest CSP forbids remote scripts, `unsafe-eval`; build has no remote code | PR |
| SYS-SEC-22 | manifest permission snapshot | permissions/host_permissions equal the approved snapshot; any change needs an ADR reference in the PR | PR |
| SYS-SEC-23 | message sender check | messages from page context (`window.postMessage`) or other extensions are ignored by every handler | PR |
| SYS-SEC-24 | Zod on every message | malformed message → rejected, logged `BAD_MESSAGE`, no state change | PR |
| SYS-SEC-25 | closed shadow DOM for badges | page script cannot read or restyle badges | PR |
| SYS-SEC-26 | boundary lint (one writer per store) | only owner modules import their store repositories; only `summary/providers/*` call LLM hosts; only `scholarly/clients/*` call scholarly hosts | PR |
| SYS-SEC-27 | incognito | extension in incognito (if user allows): no data persisted after window close [decide: `incognito: "split"` vs not allowed] | REL |

### 1.4 Supply chain & licence
| ID | Variant | Given → Expected | Gate |
|---|---|---|---|
| SYS-SEC-30 🛑 | licence gate | no AGPL/GPL/SSPL/unknown licence in runtime deps (ADR-0004); dev-only MPL allowed | PR |
| SYS-SEC-31 | vulnerability scan | `npm audit --omit=dev` / osv-scanner: no high/critical unfixed | PR (high), NIGHT (all) |
| SYS-SEC-32 | lockfile integrity | `npm ci` from lockfile; no unpinned git deps | PR |
| SYS-SEC-33 | SBOM | CycloneDX SBOM attached to each release | REL |
| SYS-SEC-34 | Python eval deps | `pip-audit` clean; licences permissive | PR (eval/) |
| SYS-SEC-35 | model licence | each recommended Ollama model's licence recorded in dependency register | REL |

### 1.5 Data lifecycle, migration, storage
| ID | Variant | Given → Expected | Gate |
|---|---|---|---|
| SYS-MIG-01 | Dexie v1→v2 additive | v1 DB with data → upgrade → Summary and Feedback intact; caches may be dropped | PR (when schema changes) |
| SYS-MIG-02 | breaking schema | export offered before destructive migration; import restores | PR |
| SYS-MIG-03 | extension update mid-run | update while summarising → run aborted cleanly, no partial Summary | REL |
| SYS-MIG-04 | settings migration | old `settings.v1` → v2 keeps keys and provider | PR |
| SYS-INT-05 | clear all completeness | after "Borrar todo": all stores empty, keys gone, `logs` empty; verified by enumerating IndexedDB + storage | PR |
| SYS-INT-06 | export/import round trip | export all → wipe → import → deep-equal (minus caches) | PR |
| SYS-RES-07 | quota exceeded | IndexedDB `QuotaExceededError` → banner, memory-only mode, no crash | PR |
| SYS-RES-08 | storage eviction | `persist()` denied → banner suggests export | REL |
| SYS-UNIT-09 | TTL GC | SW alarm deletes Article >90 d, keeps 5 StatusChecks/DOI, never touches Summary | PR |
| SYS-UNIT-10 | time handling | stored UTC ISO; displayed America/Mexico_City (no DST since 2022 [verify]); UTC-day budget rollover | PR |

### 1.6 Lifecycle, concurrency, compatibility
| ID | Variant | Given → Expected | Gate |
|---|---|---|---|
| SYS-RES-20 | panel closed mid-run | AbortController cancels; no partial writes; reopen shows last complete state | PR (e2e) |
| SYS-RES-21 | service worker terminated | idle SW killed → side-panel runs unaffected (S4 spike) | SPIKE, REL |
| SYS-RES-22 | two tabs, two papers | independent PageContexts; panel shows active tab's paper | PR (e2e) |
| SYS-RES-23 | same paper twice | double-click "Resumir" → single-flight, one run | PR |
| SYS-RES-24 | offline | no network → metadata from cache, status "no se pudo comprobar", Nano still works if available | PR (e2e) |
| SYS-RES-25 | bfcache / SPA navigation | back/forward and history.pushState → re-detection, old run aborted | PR (e2e) |
| SYS-COMP-26 | Chrome versions | min supported `[specify]` and current stable; side panel API present | REL |
| SYS-COMP-27 | OS matrix | Windows 10/11, macOS 13+, Linux; ChromeOS `[decide]` | REL |
| SYS-COMP-28 | hardware tiers | 8 GB no GPU · 16 GB 4 cores · GPU >4 GB VRAM: provider recommendations shown correctly; panel usable | REL |
| SYS-COMP-29 | Chromium forks | Edge/Brave load-unpacked: flags/metadata work; Nano absent handled [non-goal: best effort] | REL |

### 1.7 Accessibility, i18n, UX
| ID | Variant | Given → Expected | Gate |
|---|---|---|---|
| SYS-A11Y-01 | axe | VW1–VW4 axe clean (serious/critical = 0) | PR |
| SYS-A11Y-02 | keyboard only | full task (open → status → summarise → expand quote → export) without mouse | REL |
| SYS-A11Y-03 | screen reader | NVDA (es) reads chips, statuses, progress (`aria-live`), quotes with `lang="en"` | REL |
| SYS-A11Y-04 | colour independence | every status has text + icon; passes in greyscale screenshot | PR |
| SYS-A11Y-05 | contrast | AA in light and dark | PR |
| SYS-A11Y-06 | zoom 200% / narrow panel 320 px | no clipped text | REL |
| SYS-I18N-01 | string coverage | every UI string in `_locales/es` and `en`; no hard-coded Spanish/English in components | PR |
| SYS-I18N-02 | formats | dates `5 nov 2026`, decimals `0,05`? [decide: keep paper's notation in quotes, es-MX in UI] | PR |
| SYS-I18N-03 | wording review | physician-approved strings for status, disclaimers | HUMAN |
| SYS-UX-04 | install ≤15 min | 5 non-technical students install + configure provider; median ≤15 min | PILOT |

### 1.8 Observability
| ID | Variant | Given → Expected | Gate |
|---|---|---|---|
| SYS-OBS-01 | runId propagation | every log entry of one user action shares one runId | PR |
| SYS-OBS-02 | log schema whitelist | log entries with extra keys (e.g., `text`) rejected | PR |
| SYS-OBS-03 | ring cap | >200 entries → oldest trimmed | PR |
| SYS-OBS-04 | diagnostics redaction | copy diagnostics contains env + logs only | PR |
| SYS-OBS-05 | error codes stable | each documented error code appears in a fixture test | PR |

---

## 2. Per-operation tests

### 2.0 Coverage audit (generated from the tables below, 2026-11-05)

Rule: every operation has at least one test of every type, **or** an explicit N/A with a reason in 2.0.2. A blank cell without a reason is a gap and fails review of this document.

#### 2.0.1 Type × operation matrix (count of tests)
| Type | OP1 | OP3 | OP12 | OP4 | OP5 | OP5V | OP13 | OP14 | OP11 |
|---|---|---|---|---|---|---|---|---|---|
| HYP | 4 | 3 | 5 | 4 | 5 | 3 | 2 | 1 | 3 |
| UNIT | 20 | 14 | 19 | 21 | 24 | 14 | 10 | 9 | 5 |
| PROP | 4 | 3 | 4 | 3 | 2 | 4 | 1 | 1 | 2 |
| TYPE | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 2 |
| CON | 2 | 2 | 2 | 2 | 1 | 1 | 1 | 1 | 1 |
| INT | 1 | 2 | 1 | 1 | 2 | 1 | 1 | 1 | 1 |
| E2E | 3 | 1 | 2 | 2 | 2 | 1 | 1 | 1 | N/A |
| SEC | 4 | 4 | 4 | 6 | 11 | 4 | 4 | 3 | 3 |
| VAL | 1 | 1 | 1 | 1 | 10 | 1 | 1 | 1 | 2 |
| PERF | 2 | 3 | 4 | 3 | 5 | 1 | 1 | 1 | 1 |
| RES | 2 | 3 | 4 | 1 | 3 | 1 | 1 | 1 | 1 |
| MIG | N/A | 1 | 1 | 1 | 1 | 1 | N/A | 1 | 1 |
| MUT | 1 | 1 | 1 | 1 | 1 | 1 | N/A | N/A | N/A |
| FUZZ | 1 | 1 | 1 | 2 | 1 | 1 | 1 | N/A | N/A |
| CFG | 1 | 1 | 1 | 1 | 1 | 1 | ↪ | N/A | N/A |
| META | N/A | N/A | N/A | 1 | 5 | N/A | N/A | N/A | N/A |
| A11Y | 1 | N/A | 1 | N/A | N/A | 1 | 1 | 1 | 1 |
| OBS | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| HUM | N/A | N/A | 1 | 1 | 1 | N/A | ↪ | ↪ | 8 |
| KPI | 1 | 1 | 4 | 1 | 2 | 2 | 1 | 1 | 2 |
`↪` = covered by a test filed under another type (see 2.0.2). System-wide tests (§1) add to every column: privacy, secrets, hardening, licences, migration, lifecycle, a11y, i18n, observability.

#### 2.0.2 N/A and cross-filed cells — reasons
| Cell | Status | Reason |
|---|---|---|
| OP1 · MIG | N/A | PageContext is in-memory only; nothing persisted to migrate |
| OP1, OP3, OP12, OP5V, OP13, OP14, OP11 · META | N/A | deterministic with a single correct output; correctness is fully specified by UNIT/PROP tests. META is for steps without a single right answer (OP5) or layout-sensitive parsing (OP4) |
| OP1, OP3, OP5V · HUM | N/A | no human step in the operation; wording/rules reviewed via SYS-I18N-03 and OP12-HUM-01 |
| OP3, OP4, OP5 · A11Y | N/A | no own UI; their output is rendered by VW1, covered by SYS-A11Y-01…06 and OP12/OP5V/OP13/OP14 A11Y tests |
| OP13 · MIG | N/A | stateless; templates versioned in the bundle, nothing stored |
| OP13 · MUT | N/A | low logic density; byte-exact snapshot tests (OP13-UNIT-08) catch the same faults. Revisit if logic grows |
| OP13 · CFG | ↪ | templates are its config: OP13-UNIT-07 (every template renders) + OP13-TYPE-01 (variables ⊆ model) |
| OP13 · HUM | ↪ | moderator approval of the club template: OP13-HYP-02 |
| OP14 · MUT, FUZZ, CFG | N/A / ↪ | MUT: trivial CRUD logic; FUZZ: note field covered by OP14-UNIT-09 (unicode) and OP14-UNIT-03 (limits); CFG: no config files |
| OP14 · HUM | ↪ | QFB triage of "wrong" marks: OP14-VAL-01 |
| OP11 · E2E | N/A | not part of the extension; the full human-to-report path is OP11-INT-01 |
| OP11 · MUT, FUZZ, CFG | N/A | inputs are expert-authored and schema-validated (OP11-TYPE-01/02); small Python metric code is verified against reference values (OP11-UNIT-01) and properties (OP11-PROP-01) |

#### 2.0.3 Operation properties (from the process map) → tests
| Op | Idempotency | Atomicity | Retry | Concurrency | Ordering | Reversibility | Determinism |
|---|---|---|---|---|---|---|---|
| OP1 | PROP-02, PROP-03 | N/A (no writes) | UNIT-20 (debounced re-run) | UNIT-19 | UNIT-19 (latest wins) | N/A (no state) | PROP-02 |
| OP3 | PROP-02 (upsert) | UNIT-13 | RES-01, RES-02 | INT-01 (single-flight) | N/A (order-independent) | UNIT-14 (refetchable cache) | CON-01 (modulo upstream; `fetchedAt` stored) |
| OP12 | PROP-03 | UNIT-20 | UNIT-24, RES-01…04 | UNIT-21 | UNIT-22 | UNIT-19 (append-only history), UNIT-25 | PROP-01, PROP-02, UNIT-01…08 |
| OP4 | UNIT-16, PROP-03 | UNIT-21 | UNIT-20, RES-01 | UNIT-19 | PROP-01 | N/A (session-only; discard is the compensation) | PROP-03, META-01 |
| OP5 | UNIT-14 (cache) | UNIT-24, UNIT-16 | UNIT-12, RES-01, RES-02 | UNIT-22 | UNIT-18 | UNIT-23 (new version, old kept) | UNIT-17, VAL-07 (run-to-run ≤5 pp) |
| OP5V | PROP-04 | UNIT-12 | N/A (pure); store blocked: RES-01 | UNIT-14 | N/A | UNIT-13 | PROP-04 |
| OP13 | UNIT-08 | N/A (no writes) | UNIT-10 (clipboard → download) | N/A (stateless) | N/A | N/A (export is a copy) | UNIT-08 |
| OP14 | PROP-01, UNIT-02 | UNIT-08 | N/A (local write; user retries) | PROP-01 | N/A | UNIT-07 (undo) | — |
| OP11 | PROP-02 | UNIT-03 (versioned files) | RES-01 (checkpoint resume) | UNIT-04 | HUM-02 → HUM-03 (annotate before adjudicate) | UNIT-03 | PROP-02 (seeded) |

### OP1 · Detect paper (DETERMINISTIC, content script)
| ID | Type | Variant | Given → Expected | Gate |
|---|---|---|---|---|
| OP1-HYP-01 | HYP | meta coverage | 60 pages / ≥10 publishers: ≥90% expose citation_doi/dc.identifier/prism.doi/JSON-LD | SPIKE |
| OP1-HYP-02 | HYP | cascade vs body regex | cascade precision ≥97% and > first-DOI baseline | SPIKE |
| OP1-HYP-03 | HYP | trap exists | ≥20% pages have >1 distinct body DOI | SPIKE |
| OP1-HYP-04 | HYP | SPA settle | ≥95% detection after SPA navigation within 2 s | SPIKE |
| OP1-UNIT-01 | UNIT | normalisation | `https://doi.org/`, `http://dx.doi.org/`, `doi:`, `DOI: `, URL-encoded `%2F`, uppercase, trailing `.,;)]`, whitespace → canonical lowercase | PR |
| OP1-UNIT-02 | UNIT | exotic valid DOIs | SICI-style with `<>`, parentheses `10.1016/s0140-6736(20)30183-5`, semicolons → accepted | PR |
| OP1-UNIT-03 | UNIT | invalid DOIs | `10.12/x` (prefix <4 digits), `10.1234` (no suffix), HTML-laden → null | PR |
| OP1-UNIT-04 | UNIT | conflicting metas | two different `citation_doi` → first wins, `META_CONFLICT` logged | PR |
| OP1-UNIT-05 | UNIT | meta vs URL disagree | meta wins, logged | PR |
| OP1-UNIT-06 | UNIT | PMID only (PubMed abstract page) | `pmid` set; doi from meta if present else null; kind article | PR |
| OP1-UNIT-07 | UNIT | PMCID page | `pmcid` set | PR |
| OP1-UNIT-08 | UNIT | arXiv/bioRxiv page with version suffix | DOI without `v2` suffix; version noted [decide] | PR |
| OP1-UNIT-09 | UNIT | retraction-notice page itself | detected as article with DOI of the notice (OP12 handles notice type) | PR |
| OP1-UNIT-10 | UNIT | body single DOI, no meta | `doiSource:"regex"` | PR |
| OP1-UNIT-11 | UNIT | body many DOIs, no meta | `doi:null`, candidates ≤5 in order; references excluded | PR |
| OP1-UNIT-12 | UNIT | non-article page (news, blog, Google home) | `kind:"other"` | PR |
| OP1-UNIT-13 | UNIT | PubMed / Europe PMC result lists | `kind:"result_list"`, ids typed pmid/doi | PR |
| OP1-UNIT-14 | UNIT | Google Scholar list | [decide: supported in v1?] ids extracted or `kind:"other"` | PR |
| OP1-UNIT-15 | UNIT | AMP / mobile / print views | DOI still detected or `other` (no wrong DOI) | PR |
| OP1-UNIT-16 | UNIT | content inside iframes | top frame only in v1; no detection from ad iframes | PR |
| OP1-UNIT-17 | UNIT | PDF opened in Chrome's built-in viewer | content script cannot run; detection from URL (doi in URL) or `other` + manual DOI box | PR (e2e) |
| OP1-UNIT-18 | UNIT | `file://` pages | ignored unless user grants file access [decide] | PR |
| OP1-PROP-01 | PROP | invariant | `kind==="article"` ⇒ doi ∨ pmid ∨ title | PR |
| OP1-PROP-02 | PROP | idempotency | detect twice on same DOM → deep-equal | PR |
| OP1-TYPE-01 | TYPE | schema | output parses `PageContextSchema`; `doi:null` vs `candidates:[]` semantics | PR |
| OP1-CON-01 | CON | consumer OP3 | every non-null doi matches OP3 input regex | PR |
| OP1-SEC-01 | SEC | no network in bundle | detect bundle has no fetch/XHR/WebSocket | PR |
| OP1-SEC-02 | SEC | hostile meta | `citation_doi` with markup/JS → rejected | PR |
| OP1-SEC-03 | SEC | length caps | url 2048, doi 256, title 1000, keywords 50×100 → truncated + flag | PR |
| OP1-SEC-04 | SEC | spoofed messages | page posts fake `PaperDetected` → ignored | PR |
| OP1-FUZZ-01 | FUZZ | random DOM/meta | 10k generated documents: no throw, ≤50 ms each | NIGHT |
| OP1-PERF-01 | PERF | 60k nodes, 200 meta | p95 ≤50 ms | PR |
| OP1-PERF-02 | PERF | SPA churn 100 mutations/s | ≤10 runs in 5 s | PR |
| OP1-VAL-01 | VAL | resolves without user input | ≥95% article fixtures resolve via OP3 with no confirmation | PR |
| OP1-E2E-01 | E2E | 3 publishers end to end | detect → header shown | PR |
| OP1-KPI-01 | KPI | detect precision/recall | ≥97% / ≥90% on fixture suite | PR |
| OP1-UNIT-19 | UNIT | concurrency: rapid navigations | two navigations within 100 ms → only latest result emitted (monotonic run counter) | PR |
| OP1-UNIT-20 | UNIT | retry: late meta | SPA injects `citation_doi` 1 s after load → debounced re-run detects it | PR |
| OP1-PROP-03 | PROP | normaliser idempotent | `normalize(normalize(x)) = normalize(x)`; output matches strict regex or is null | PR |
| OP1-PROP-04 | PROP | reference DOIs never chosen | generated pages with reference lists, no meta, >1 DOI → `doi:null`, candidates only | PR |
| OP1-INT-01 | INT | content script ↔ panel | one `PaperDetected` per navigation; panel holds only the active tab's PageContext | PR |
| OP1-CON-02 | CON | schema version shared | content-script and panel bundles share PageContextSchema version; mismatch → message rejected | PR |
| OP1-E2E-02 | E2E | list page | PubMed fixture → resultIds sent → badges rendered | PR |
| OP1-E2E-03 | E2E | ambiguous page | candidates prompt → user picks → OP3 runs on chosen DOI | PR |
| OP1-RES-01 | RES | detector throws | DOM exception → `kind:"other"`, `DETECT_ERROR` logged, panel usable | PR |
| OP1-RES-02 | RES | extension reloaded while page open | orphaned content script stops quietly (no error loop) | PR |
| OP1-MUT-01 | MUT | mutation score | ≥85% on `normalizeDoi` + cascade | NIGHT |
| OP1-CFG-01 | CFG | sites.json | schema-valid; every entry has ≥1 fixture; regexes compile and pass safe-regex (no catastrophic backtracking) | PR |
| OP1-OBS-01 | OBS | log entry | `{op:"OP1", durationMs, outcome, doiSource}`; no page text, no full URL path | PR |
| OP1-A11Y-01 | A11Y | candidate picker | keyboard operable, labelled, focus returns to header after choice | PR |

### OP3 · Resolve metadata (DETERMINISTIC)
| ID | Type | Variant | Given → Expected | Gate |
|---|---|---|---|---|
| OP3-HYP-01 | HYP | coverage | OpenAlex authors ≥95%, keywords/topics ≥85% on 200 health DOIs | SPIKE |
| OP3-HYP-02 | HYP | merge gain | OpenAlex+Crossref+meta ≥ +5 pp coverage | SPIKE |
| OP3-HYP-03 | HYP | latency from MX | cold p95 ≤1.5 s | SPIKE |
| OP3-UNIT-01 | UNIT | precedence table | each field's source order applied | PR |
| OP3-UNIT-02 | UNIT | abstract reconstruction | inverted index → text; empty → null | PR |
| OP3-UNIT-03 | UNIT | missing abstract (publisher-withheld) | null, `coverage` reflects | PR |
| OP3-UNIT-04 | UNIT | DOI only in Crossref (new paper) | Article from Crossref, `sources:["crossref"]` | PR |
| OP3-UNIT-05 | UNIT | DataCite DOI (e.g., Zenodo 10.5281) | Crossref 404 tolerated; OpenAlex or `NOT_FOUND` | PR |
| OP3-UNIT-06 | UNIT | OpenAlex merged work (redirect) | follows redirect; stores canonical id | PR |
| OP3-UNIT-07 | UNIT | >100 authors | full list or truncated with flag [verify OpenAlex truncation] | PR |
| OP3-UNIT-08 | UNIT | non-Latin / diacritic names | preserved NFC | PR |
| OP3-UNIT-09 | UNIT | year > current year / null | rejected → null | PR |
| OP3-UNIT-10 | UNIT | keyword dedupe | casefold dedupe across sources; source tags kept; cap 15 | PR |
| OP3-UNIT-11 | UNIT | cache fresh / stale / stale + network fail / none + fail | no call / SWR / stale flag / `UPSTREAM_DOWN` | PR |
| OP3-UNIT-12 | UNIT | 404 both | `NOT_FOUND`; VW1 shows page meta | PR |
| OP3-PROP-01 | PROP | reconstruct∘invert = id | all token lists | PR |
| OP3-PROP-02 | PROP | idempotent upsert | 2 resolves → 1 record | PR |
| OP3-INT-01 | INT | single-flight | 3 concurrent calls → 1 network call | PR |
| OP3-TYPE-01 | TYPE | Article schema | `[]` vs `null` vs `coverage` semantics | PR |
| OP3-CON-01 | CON | upstream drift | recorded OpenAlex/Crossref fixtures parse; new unknown field tolerated; removed required field → test red | WEEK (live) |
| OP3-CON-02 | CON | consumers | OP12 gets `type`; OP4 gets `pmcid`, `abstract` | PR |
| OP3-SEC-01 | SEC | payload | DOI + key/mailto only | PR |
| OP3-SEC-02 | SEC | hostile strings in API data | `<script>` in title rendered as text | PR |
| OP3-SEC-03 | SEC | oversize / non-JSON / wrong content-type | `UPSTREAM_INVALID`, nothing stored | PR |
| OP3-SEC-04 | SEC | key redaction | OpenAlex key not in logs | PR |
| OP3-RES-01 | RES | 429 with Retry-After | waits, retries ≤3 | PR |
| OP3-RES-02 | RES | timeout 5 s | next attempt; final → stale or error | PR |
| OP3-RES-03 | RES | one host down | other host's data used | PR |
| OP3-PERF-01 | PERF | warm | p95 ≤50 ms | PR |
| OP3-PERF-02 | PERF | cold | p95 ≤1.5 s (recorded latency profile) | NIGHT |
| OP3-PERF-03 | PERF | payload with `select` | ≤30 KB | PR |
| OP3-VAL-01 | VAL | header coverage vs page meta | ≥ +10 pp | SPIKE |
| OP3-KPI-01 | KPI | resolve success / coverage | ≥97% / ≥90% | PR (fixtures), PILOT (diagnostics) |
| OP3-UNIT-13 | UNIT | atomicity | IndexedDB put fails (quota) → no partial record; in-memory Article returned with banner | PR |
| OP3-UNIT-14 | UNIT | refresh with one host down | previous non-null fields kept when the failing host owned them; `sources` lists only hosts that answered | PR |
| OP3-PROP-03 | PROP | provenance: merge never invents | every output author/keyword/title value exists in one of the inputs | PR |
| OP3-INT-02 | INT | stale-while-revalidate | stale record returned at once; background refresh updates Dexie and re-emits `ArticleResolved` | PR |
| OP3-E2E-01 | E2E | header from recorded API | Playwright route interception serves fixtures → VW1 header populated | PR |
| OP3-MIG-01 | MIG | Article schema bump | cache drop allowed; next resolve repopulates; old rows never crash reads | PR |
| OP3-FUZZ-01 | FUZZ | fuzzed upstream JSON | types swapped, nulls, 10k-item arrays → no throw; `UPSTREAM_INVALID` or partial Article | NIGHT |
| OP3-MUT-01 | MUT | mutation score | ≥80% on merge + reconstruct | NIGHT |
| OP3-CFG-01 | CFG | `select` field list | every field the schema requires is in OpenAlex `select` (fails if schema adds a field not selected) | PR |
| OP3-OBS-01 | OBS | log entry | host, HTTP status, attempts, durationMs; never the API key | PR |

### OP12 · Check status — preprint / retraction / expression of concern (DETERMINISTIC) — highest severity
| ID | Type | Variant | Given → Expected | Gate |
|---|---|---|---|---|
| OP12-HYP-01 | HYP | OpenAlex alone recall | ≥90% on 300 RW retractions | SPIKE |
| OP12-HYP-02 | HYP | OpenAlex ∨ Crossref | recall ≥95%, precision ≥98% | SPIKE |
| OP12-HYP-03 | HYP | Crossref "updates to DOI" query exists | `filter=updates:` / `updated-by` works for ≥19/20 [verify] | SPIKE |
| OP12-HYP-04 | HYP | patterned preprint rule | precision ≥98% incl. CSHL journals | SPIKE |
| OP12-HYP-05 | HYP | flag prevalence on course searches | ≥1% of listed DOIs flagged | SPIKE |
| OP12-UNIT-01…08 | UNIT | decision table rows | none / OA only / CR only / EoC only / correction only / retraction→reinstatement / OA true + CR reinstatement / retraction+EoC → expected nature (see OP12 plan §4) | PR |
| OP12-UNIT-09 | UNIT | EoC later upgraded to retraction | retraction | PR |
| OP12-UNIT-10 | UNIT | "retraction and replacement" | [decide] shown as retraction with "reemplazado" note | PR |
| OP12-UNIT-11 | UNIT | withdrawn preprint (bioRxiv withdrawal) | [decide] treated as retraction-like "retirado" | PR |
| OP12-UNIT-12 | UNIT | user is on the retraction notice page | chip "Esta es una nota de retractación" + link to original | PR |
| OP12-UNIT-13 | UNIT | preprint with published version | `publishedVersionDoi` shown | PR |
| OP12-UNIT-14 | UNIT | preprint patterns | 10.1101 date & numeric styles, arXiv, Research Square, SSRN, Preprints.org, SciELO Preprints → true; `10.1101/gr.*` → false | PR |
| OP12-UNIT-15 | UNIT | PMID-only lists (PubMed) | PMIDs resolved via OpenAlex pmid filter [verify] | PR |
| OP12-UNIT-16 | UNIT | batching | 250 DOIs → 3 calls; duplicates removed; order preserved | PR |
| OP12-UNIT-17 | UNIT | cache by mode | list uses <24 h; panel always re-checks but paints cached first | PR |
| OP12-UNIT-18 | UNIT | budget | 90% → single free lookups for ≤10 visible; UTC rollover resets | PR |
| OP12-UNIT-19 | UNIT | history trim | keep 5 per DOI | PR |
| OP12-PROP-01 🛑 | PROP | wording invariant | no rendering for any (nature × sources × completeness) contains "no retractado"/"not retracted"; `none_found` text names every ok source + date | PR |
| OP12-PROP-02 | PROP | precedence monotonic | adding a retraction notice never lowers severity | PR |
| OP12-TYPE-01 | TYPE | schema | no `not_retracted` member; `sources` non-empty; `completeness` distinguishes not-asked vs found-nothing | PR |
| OP12-CON-01 | CON | VW1/VW2/OP13 consumers | snapshots per nature | PR |
| OP12-CON-02 | CON | live upstream | weekly refreshed RW sample parses and classifies | WEEK |
| OP12-SEC-01 | SEC | payload | DOIs + key/mailto only | PR |
| OP12-SEC-02 | SEC | badge tampering | page JS cannot read/restyle closed shadow badges | PR |
| OP12-SEC-03 | SEC | budget counter tamper | page cannot reach `chrome.storage.local` | PR |
| OP12-SEC-04 | SEC | malformed upstream | keeps previous StatusCheck; badge "?" | PR |
| OP12-RES-01 | RES | OpenAlex down | Crossref-only, wording names Crossref only | PR |
| OP12-RES-02 | RES | Crossref down | OpenAlex-only, `completeness:openalex_only` | PR |
| OP12-RES-03 | RES | both down | "no se pudo comprobar", never a clean-looking chip | PR |
| OP12-RES-04 | RES | partial batch failure | failed DOIs badge "?", others fine | PR |
| OP12-PERF-01 | PERF | 25 results warm | badge p95 ≤2 s | PR |
| OP12-PERF-02 | PERF | 25 cold | ≤3 s | NIGHT |
| OP12-PERF-03 | PERF | 200 results | ≤3 OpenAlex calls, ≤4 s | NIGHT |
| OP12-PERF-04 | PERF | daily budget at 50 pages | ≤$0.005 | PR (model) |
| OP12-KPI-01 🛑 | KPI | retraction recall | ≥95% (Wilson lower bound ≥92%) on ≥300 RW retractions | WEEK |
| OP12-KPI-02 🛑 | KPI | retraction precision | ≥98% on ≥300 clean | WEEK |
| OP12-KPI-03 | KPI | EoC separation | ≥95% | WEEK |
| OP12-KPI-04 | KPI | preprint recall/precision | ≥95% / ≥98% | PR |
| OP12-VAL-01 | VAL | students notice flagged paper | +30 pp vs no tool [specify with physician] | PILOT |
| OP12-HUM-01 | HUM | wording approval | physician sign-off of every status string | HUMAN |
| OP12-UNIT-20 | UNIT | atomicity | append StatusCheck + trim history in one transaction; induced crash → never 0 rows for a checked DOI | PR |
| OP12-UNIT-21 | UNIT | concurrency | panel and list check same DOI at once → single-flight per DOI; both receive same result | PR |
| OP12-UNIT-22 | UNIT | ordering: late refinement | Crossref result older than a newer panel check is ignored (`checkedAt` compare) | PR |
| OP12-UNIT-23 | UNIT | TTL boundary | 23 h 59 m → cached; 24 h 00 m → refetch | PR |
| OP12-UNIT-24 | UNIT | retry & rate | OpenAlex 429 honours Retry-After; Crossref limiter ≤5 rps (fake timers) | PR |
| OP12-UNIT-25 | UNIT | status changes over time | paper summarised as `none_found`, later retracted → chip updates on next open; [decide] show "cambió desde {fecha}" | PR |
| OP12-UNIT-26 | UNIT | unknown notice type | unrecognised Crossref update type → "aviso no clasificado", never silently `none_found` | PR |
| OP12-PROP-03 | PROP | idempotency | same DOIs, same UTC day, list mode → 0 new network calls | PR |
| OP12-PROP-04 | PROP | no lost/extra DOIs | output keys = deduplicated normalised input set | PR |
| OP12-INT-01 | INT | batch + store + budget + events | OpenAlex-pass events precede Crossref refinements; final state per DOI = latest `checkedAt`; budget counter persisted | PR |
| OP12-E2E-01 | E2E | list page | PubMed fixture → badges ≤2 s; "ocultar" hides flagged rows; toggle off restores | PR |
| OP12-E2E-02 | E2E | retracted article page | retraction chip with sources + date in panel | PR |
| OP12-MIG-01 | MIG | StatusCheck schema bump | history may drop; no `not_retracted` value introduced; recheck on next open | PR |
| OP12-FUZZ-01 | FUZZ | fuzzed notice JSON | missing dates, mixed-case types, duplicated notices → no throw; precedence still applied | NIGHT |
| OP12-MUT-01 | MUT | mutation score | ≥90% on decision table + `statusText()` | REL |
| OP12-CFG-01 | CFG | preprint-patterns.json | valid, safe-regex, each pattern has positive and negative fixture | PR |
| OP12-OBS-01 | OBS | log entry | completeness, sources ok/failed, budget used, durationMs | PR |
| OP12-A11Y-01 | A11Y | chips & badges | text + icon; `aria-label` holds the full status sentence; badges not a keyboard trap on host page | PR |

### OP4 · Acquire & segment text (DETERMINISTIC)
| ID | Type | Variant | Given → Expected | Gate |
|---|---|---|---|---|
| OP4-HYP-01 | HYP | DOM usable | ≥70% of 50 pages | SPIKE |
| OP4-HYP-02 | HYP | boundary accuracy | ≥85% on 30 labelled | SPIKE |
| OP4-HYP-03 | HYP | JATS accuracy | ≥95% on 20 PMC | SPIKE (P2) |
| OP4-HYP-04 | HYP | structured abstracts | ≥40% of abstract-only cases | SPIKE |
| OP4-UNIT-01 | UNIT | heading synonyms en/es | Methods / Materials and Methods / Patients and methods / Métodos / Material y métodos / Metodología → methods; etc. | PR |
| OP4-UNIT-02 | UNIT | Portuguese headings (SciELO BR) | [decide] add pt synonyms or `other` | PR |
| OP4-UNIT-03 | UNIT | numbered headings | "2. Methods", "II. MÉTODOS" | PR |
| OP4-UNIT-04 | UNIT | merged sections | "Results and Discussion" → results + mergedWith | PR |
| OP4-UNIT-05 | UNIT | nested subheadings | h3 stays in parent | PR |
| OP4-UNIT-06 | UNIT | no headings | structured abstract split or abstract_only | PR |
| OP4-UNIT-07 | UNIT | paywalled page | abstract_only, banner | PR |
| OP4-UNIT-08 | UNIT | collapsed accordions / `<details>` closed / `aria-expanded=false` | [decide] legitimate hidden content vs injection risk; expected per decision | PR |
| OP4-UNIT-09 | UNIT | lazy-loaded sections not yet in DOM | fallback to JATS or partial with `missing[]` | PR |
| OP4-UNIT-10 | UNIT | shadow-DOM content (web components) | [decide] traverse open shadow roots | PR |
| OP4-UNIT-11 | UNIT | tables, captions, MathML, Greek/µ/± | preserved as text | PR |
| OP4-UNIT-12 | UNIT | references section | excluded from sections | PR |
| OP4-UNIT-13 | UNIT | Spanish-language article (SciELO MX) | segmented; `language:"es"` | PR |
| OP4-UNIT-14 | UNIT | very long article | >200k chars → truncated flag | PR |
| OP4-UNIT-15 | UNIT | usable rule | methods ≥300 and results ≥300 chars (calibrate) | PR |
| OP4-UNIT-16 | UNIT | contentHash stable | same DOM → same hash; whitespace-only change → same hash | PR |
| OP4-UNIT-17 | UNIT | pdf.js (P2) | two-column order, de-hyphenation, ligatures, headers/footers/page numbers removed | PR (P2) |
| OP4-UNIT-18 | UNIT | scanned PDF | abstract_only (no OCR, non-goal) | PR (P2) |
| OP4-SEC-01 🛑 | SEC | hidden-text injection | display:none, visibility:hidden, opacity:0, 1px font, off-screen, aria-hidden, white-on-white "IGNORE PREVIOUS INSTRUCTIONS" → absent from output | PR |
| OP4-SEC-02 | SEC | script/style/noscript/template/iframe | never extracted | PR |
| OP4-SEC-03 | SEC | output plain text | no tags survive DOMPurify + textContent | PR |
| OP4-SEC-04 | SEC | copyright storage | ArticleText not persisted unless pinned (storage spy) | PR |
| OP4-SEC-05 | SEC | pdf.js hardening | `isEvalSupported:false`; bundled worker; malicious PDF corpus → no exec | PR (P2) |
| OP4-SEC-06 | SEC | fetch scope | only Europe PMC host; other OA origins only after runtime permission with user gesture | PR |
| OP4-FUZZ-01 | FUZZ | hostile HTML corpus (deep nesting, 1M nodes, malformed) | no hang >5 s, no crash | NIGHT |
| OP4-FUZZ-02 | FUZZ | malformed JATS / PDFs | graceful fallback | NIGHT (P2) |
| OP4-TYPE-01 | TYPE | schema | `missing[]` vs absent key semantics | PR |
| OP4-CON-01 | CON | OP5V consumer | quotes validated against exactly emitted text | PR |
| OP4-RES-01 | RES | Europe PMC down/slow | timeout 8 s → abstract | PR |
| OP4-PERF-01 | PERF | 60k-node DOM | p95 ≤1.5 s | PR |
| OP4-PERF-02 | PERF | memory | ≤150 MB peak | NIGHT |
| OP4-PERF-03 | PERF | pdf 30 pages | ≤8 s | NIGHT (P2) |
| OP4-VAL-01 | VAL | downstream verified rate | ≤5 pp below gold-provided text | EVAL |
| OP4-KPI-01 | KPI | usable text / boundary accuracy | ≥70% / ≥85% | REL |
| OP4-UNIT-19 | UNIT | concurrency | two acquires for same DOI → single-flight | PR |
| OP4-UNIT-20 | UNIT | retry | Europe PMC 503 → ≤3 retries with backoff, then abstract | PR |
| OP4-UNIT-21 | UNIT | atomicity (pinned) | pinned put fails → session copy still used, warning shown | PR |
| OP4-PROP-01 | PROP | segmentation invariants | sections disjoint; their concatenation is an in-order subsequence of linearised visible text | PR |
| OP4-PROP-02 | PROP | hidden-node exclusion | random DOMs with hidden marker nodes → marker text never in output | PR |
| OP4-PROP-03 | PROP | hash idempotency | extract twice / whitespace-only DOM change → same contentHash | PR |
| OP4-INT-01 | INT | CS ↔ panel payload | 200k-char extraction crosses messaging intact (under Chrome message size limit) | PR |
| OP4-E2E-01 | E2E | 5 publisher fixtures | sections present; correct source banner | PR |
| OP4-E2E-02 🛑 | E2E | injection end to end | hidden-text injection page → injected sentence absent from the captured LLM request body (mock provider) | PR |
| OP4-CON-02 | CON | Europe PMC JATS drift | weekly live sample parses | WEEK |
| OP4-MIG-01 | MIG | pinned texts schema bump | drop allowed with notice; no crash | PR |
| OP4-MUT-01 | MUT | mutation score | ≥80% on segment + heading matcher | NIGHT |
| OP4-CFG-01 | CFG | headings.json | schema-valid; no synonym maps to two sections; es/en parity | PR |
| OP4-OBS-01 | OBS | log entry | source, usable, per-section lengths; never text | PR |
| OP4-HUM-01 | HUM | heading dictionary review | QFB approves synonyms per release | HUMAN |
| OP4-META-01 | META | layout invariance | wrap blocks in extra divs, swap "Methods"↔"Métodos", change heading level h2↔h3 consistently → same section boundaries and contentHash of section texts | PR |

### OP5 · Summarise section (LLM; P0 stub)
| ID | Type | Variant | Given → Expected | Gate |
|---|---|---|---|---|
| OP5-HYP-01 | HYP | H-S1 feasibility | ≥1 $0 provider ≥80% agreement, ≥85% verified on holdout | EVAL |
| OP5-HYP-02 | HYP | Nano availability | ≥50% of cohort machines | PILOT (survey) |
| OP5-HYP-03 | HYP | pre-selection loss | ≤5 pp vs full section | EVAL |
| OP5-HYP-04 | HYP | structured output | schema failures ≤3% per provider | SPIKE |
| OP5-HYP-05 | HYP | prompt language | es vs en instructions A/B | EVAL |
| OP5-UNIT-01 | UNIT | stub | returns valid SectionDraft; skeleton e2e | PR |
| OP5-UNIT-02 | UNIT | adapter success per provider | Nano / Ollama / OpenAI-compatible | PR (mocked) |
| OP5-UNIT-03 | UNIT | Nano states | unavailable / downloadable / downloading / available / download interrupted | PR |
| OP5-UNIT-04 | UNIT | Ollama states | not running / CORS-blocked (no `OLLAMA_ORIGINS`) / model not pulled / wrong model / slow CPU | PR |
| OP5-UNIT-05 | UNIT | key states | invalid 401 / revoked / RPM 429 / RPD exhausted / region-blocked / model retired 404 | PR |
| OP5-UNIT-06 | UNIT | malformed outputs | markdown-fenced JSON, trailing prose, truncated JSON (max tokens), wrong types, extra fields → parse/repair once → or `SCHEMA_INVALID` | PR |
| OP5-UNIT-07 | UNIT | wrong language | English `summaryEs` → language check fails → `no_verificado` [decide: retry once] | PR |
| OP5-UNIT-08 | UNIT | refusal / empty | "I can't help" or empty → section failed | PR |
| OP5-UNIT-09 | UNIT | section missing | `notReported` draft, no call | PR |
| OP5-UNIT-10 | UNIT | over-budget section | pre-selection; `coverage:"partial"` | PR |
| OP5-UNIT-11 | UNIT | tiny section (<300 chars) | still called or skipped per rule | PR |
| OP5-UNIT-12 | UNIT | fallback chain | A QUOTA → B once → failed | PR |
| OP5-UNIT-13 | UNIT | circuit breaker | 3 consecutive QUOTA/TRANSPORT → provider off 10 min | PR |
| OP5-UNIT-14 | UNIT | cache | same doi+section+hash+pipelineVersion → 0 calls | PR |
| OP5-UNIT-15 | UNIT | pipelineVersion | change prompt/model/schema/normaliser/headings → new key | PR |
| OP5-UNIT-16 | UNIT | abort | panel close / new paper → requests aborted, no Summary | PR |
| OP5-UNIT-17 | UNIT | determinism knobs | temperature 0, seed, top_p sent where supported | PR |
| OP5-UNIT-18 | UNIT | sequential order + progress | 4 calls in order; SectionValidated per section | PR |
| OP5-UNIT-19 | UNIT | retracted/preprint paper | summary still produced; status chip visible above it | PR (e2e) |
| OP5-UNIT-20 | UNIT | Spanish-language source paper | quotes in Spanish validate | PR |
| OP5-UNIT-21 | UNIT | methodology fields | `design` ∈ closed list; `n` integer or null; both quote-backed | PR |
| OP5-SEC-01 🛑 | SEC | direct injection | section text "ignore instructions…" → schema-valid Spanish output; no instruction followed | PR |
| OP5-SEC-02 | SEC | delimiter escape | text containing `<<END-…>>` guess → escaped | PR |
| OP5-SEC-03 | SEC | unicode smuggling | tag characters U+E0000–E007F, zero-width, bidi overrides → stripped before prompt | PR |
| OP5-SEC-04 | SEC | homoglyph / fake system tags | `<system>`, "### SYSTEM", "assistant:" in text → treated as data | PR |
| OP5-SEC-05 | SEC | injection via table cells / alt text / captions | same expectations | PR |
| OP5-SEC-06 | SEC | output exfil attempt | model asked to output URL/email → schema has no such field; any URL in `summaryEs` rendered as plain text, not link | PR |
| OP5-SEC-07 | SEC | HTML/JS in output | rendered as text | PR |
| OP5-SEC-08 | SEC | no tools | request bodies contain no `tools`/`functions` | PR |
| OP5-SEC-09 | SEC | key scope | key only in Authorization header to own host | PR |
| OP5-SEC-10 | SEC | free-tier ack | blocked until acknowledged | PR |
| OP5-SEC-11 | SEC | Chrome AI policy | extension acknowledges Generative AI Prohibited Uses Policy where required [verify] | REL |
| OP5-TYPE-01 | TYPE | SectionDraft JSON Schema | same schema sent as constraint and validated by Zod | PR |
| OP5-CON-01 | CON | provider API drift | recorded fixtures per provider still parse | WEEK |
| OP5-RES-01 | RES | 429 Retry-After | honoured, ≤2 retries | PR |
| OP5-RES-02 | RES | 60 s timeout | next provider | PR |
| OP5-RES-03 | RES | network drop mid-stream | section failed, others continue | PR |
| OP5-VAL-01 🛑 | VAL | field agreement | ≥80% per section per recommended provider on holdout (FP weight 3×) | EVAL |
| OP5-VAL-02 | VAL | verified rate | ≥85% sections verified | EVAL |
| OP5-VAL-03 | VAL | beats trivial extractor | design/n agreement > regex baseline | EVAL |
| OP5-VAL-04 | VAL | no added clinical advice | rubric: 0 recommendations not in paper | EVAL |
| OP5-VAL-05 | VAL | no quality verdicts | rubric: 0 "este estudio es bueno/malo" | EVAL |
| OP5-VAL-06 | VAL | prerequisite topics labelled | 100% carry background label | PR |
| OP5-VAL-07 | VAL | run-to-run stability | same input ×5: field agreement variance ≤5 pp | EVAL |
| OP5-VAL-08 | VAL | regression vs previous prompt | no field drops >5 pp | EVAL |
| OP5-VAL-09 | VAL | slices | agreement by study design, publisher, year, language, section length; no slice <70% [proposed] | EVAL |
| OP5-VAL-10 | VAL | holdout hygiene | holdout DOIs absent from prompts/few-shots (hash check) | PR |
| OP5-PERF-01 | PERF | free key | p95 ≤60 s / paper | NIGHT (recorded) + PILOT |
| OP5-PERF-02 | PERF | Nano 16 GB | p95 ≤120 s | SPIKE + PILOT |
| OP5-PERF-03 | PERF | Ollama CPU | measured; >300 s → "no recomendado" | SPIKE |
| OP5-PERF-04 | PERF | quota | 25 papers/day within free RPD | SPIKE |
| OP5-PERF-05 | PERF | memory | ≤200 MB panel | NIGHT |
| OP5-KPI-01 | KPI | calls per paper | ≤5 | PILOT |
| OP5-UNIT-22 | UNIT | double click (idempotency/concurrency) | second "Resumir" while running → no new run, message shown | PR |
| OP5-UNIT-23 | UNIT | reversibility | re-summarise with other provider → new Summary version; previous kept and selectable [decide UI] | PR |
| OP5-UNIT-24 | UNIT | atomicity on abort | 2 sections done, then abort → no Summary stored | PR |
| OP5-PROP-01 | PROP | pre-selection | never exceeds budget; keeps paragraph order; first paragraph always included | PR |
| OP5-PROP-02 | PROP | total function | any provider response → schema-valid draft or `failed`; never throws, never stores invalid | PR |
| OP5-INT-01 | INT | full pipeline, mocked provider | orchestrator + MSW provider + OP4 + OP5V + Dexie → Summary stored; 4 progress events | PR |
| OP5-INT-02 | INT | real local model | [decide] self-hosted runner with tiny Ollama model; contract smoke only | NIGHT |
| OP5-E2E-01 | E2E | stub provider | Resumir → 3 section statuses render → Exportar works | PR |
| OP5-E2E-02 🛑 | E2E | fabricated quote end to end | mock provider returns quote absent from paper → section shown `no verificado`, quote never shown as verified | PR |
| OP5-META-01 | META | format invariance | re-wrapped whitespace/line breaks in section → same design and n | EVAL |
| OP5-META-02 | META | paragraph shuffle in methods | design and n unchanged | EVAL |
| OP5-META-03 | META | irrelevant paragraph appended | acknowledgements/funding added → key fields unchanged | EVAL |
| OP5-META-04 | META | sensitivity | source n=120 → n=210 → output n changes accordingly | EVAL |
| OP5-META-05 | META | injection invariance | same section with and without injected instruction → same key fields | EVAL |
| OP5-MIG-01 | MIG | old pipelineVersion | Summaries from older prompts still render, labelled "versión anterior" | PR |
| OP5-FUZZ-01 | FUZZ | fuzzed provider responses | random bytes, huge bodies, deep nesting, invalid UTF-16 → parser robust | NIGHT |
| OP5-MUT-01 | MUT | mutation score | ≥75% on fallback chain + pre-selection | NIGHT |
| OP5-CFG-01 | CFG | providers.json & prompts | schema-valid; https except localhost; every section has a prompt file; hashes match build | PR |
| OP5-OBS-01 | OBS | log entry | provider, modelId, calls, tokens if reported, errorCode; never prompt text or key | PR |
| OP5-HUM-01 | HUM | prompt review (separation of duties) | CODEOWNERS: changes under `prompts/` need QFB approval | PR |
| OP5-KPI-02 | KPI | verified-section rate in the field | ≥85% per provider | PILOT |

### OP5V · Validate evidence (DETERMINISTIC) — core guarantee
| ID | Type | Variant | Given → Expected | Gate |
|---|---|---|---|---|
| OP5V-HYP-01 | HYP | 0 false accepts adversarial | 500 near-quotes | PR |
| OP5V-HYP-02 | HYP | false rejects ≤10% | 200 real model quotes | SPIKE/EVAL |
| OP5V-HYP-03 | HYP | numbers rule catches planted numbers | 100% of 100 | PR |
| OP5V-PROP-01 🛑 | PROP | verified ⇒ substring | every verified quote is substring of declared section after normalisation | PR |
| OP5V-PROP-02 🛑 | PROP | offsets round-trip | `original.slice(start,end)` normalises to quote | PR |
| OP5V-PROP-03 🛑 | PROP | near-quote rejection | one-word swap, inserted "no"/"not", number change (0.05→0.5, 95→59), reordered clauses, merged sentences from two places → rejected | PR |
| OP5V-PROP-04 | PROP | idempotency/determinism | same input → byte-identical Summary | PR |
| OP5V-UNIT-01 | UNIT | normaliser table | curly quotes, all dash variants, ligatures (NFKC), soft hyphen, ZW chars, NBSP/thin space, combining accents NFC vs NFD, case | PR |
| OP5V-UNIT-02 | UNIT | scientific symbols | α β µ/μ (micro vs mu) ± ≤ ≥ × superscripts (10⁻³) [decide mapping] | PR |
| OP5V-UNIT-03 | UNIT | length rules | <20 chars or <4 words, >400 chars → rejected with reason | PR |
| OP5V-UNIT-04 | UNIT | section correction | quote found in other section → accepted, section corrected, logged | PR |
| OP5V-UNIT-05 | UNIT | quote spanning two sections | rejected | PR |
| OP5V-UNIT-06 | UNIT | quote appearing twice | first occurrence offsets | PR |
| OP5V-UNIT-07 | UNIT | numbers | decimal comma/point, %, ranges "5–10", ±, CI "95% CI 1.2–3.4", p-values "p<0.001", years, n → each must appear in quotes | PR |
| OP5V-UNIT-08 | UNIT | numbers as words | "tres grupos" → documented gap (not checked) | PR |
| OP5V-UNIT-09 | UNIT | status rules | any bad quote / no quotes / unsupported number → no_verificado; schema fail → failed; abstract_only source → abstract_only | PR |
| OP5V-UNIT-10 | UNIT | all sections failed | `ALL_SECTIONS_FAILED`, nothing stored | PR |
| OP5V-UNIT-11 | UNIT | prerequisites | never verified; label kept | PR |
| OP5V-UNIT-12 | UNIT | atomic write | transaction abort → nothing stored | PR |
| OP5V-SEC-01 🛑 | SEC | sole writer | only `summary/validate.ts` imports summaries repository | PR |
| OP5V-SEC-02 | SEC | hostile draft | HTML in summaryEs stored as text; unknown section names rejected; `__proto__` keys rejected | PR |
| OP5V-SEC-03 | SEC | oversize draft | >2,000 chars or >5 quotes → failed | PR |
| OP5V-SEC-04 | SEC | no article text in logs | only lengths/statuses | PR |
| OP5V-MUT-01 🛑 | MUT | mutation score | ≥90% on normaliser + validator | NIGHT |
| OP5V-TYPE-01 | TYPE | schemas & compatibility | v1 fixtures parse forever (additive) | PR |
| OP5V-PERF-01 | PERF | 4×5 quotes, 60k sections | p95 ≤20 ms | PR |
| OP5V-VAL-01 | VAL | planted-error detection with quotes vs without | more errors detected | PILOT (H-V2) |
| OP5V-KPI-01 🛑 | KPI | quote validity | 100% of shown verified quotes (CI + adversarial + user reports = 0 incidents) | PR, PILOT |
| OP5V-UNIT-13 | UNIT | reversibility | re-validation with a new normaliser → new pipelineVersion record; old kept | PR |
| OP5V-UNIT-14 | UNIT | concurrency | two `validateAndStore` on same key → one identical final record | PR |
| OP5V-INT-01 | INT | Dexie round trip | put → read back deep-equal; "latest by DOI" index returns newest | PR |
| OP5V-E2E-01 | E2E | render by status | verified shows quotes with `lang`; `no_verificado` hidden behind "Mostrar de todos modos" with warning | PR |
| OP5V-CON-01 | CON | consumers | Summary snapshots per status consumed by VW1, OP13, eval JSON Schema | PR |
| OP5V-RES-01 | RES | DB blocked | transaction blocked by an upgrading tab → retry once → `failed` + banner | PR |
| OP5V-MIG-01 | MIG | Summary schema bump | v1 records valid under v2; [decide] re-validate old summaries on open or keep old status | PR |
| OP5V-FUZZ-01 | FUZZ | random unicode | surrogates, RTL, emoji, combining marks in drafts/sections → no throw, no false accept | NIGHT |
| OP5V-CFG-01 | CFG | normaliser version guard | CI hashes `normaliser.ts`; code change without `NORMALISER_VERSION` bump → fail | PR |
| OP5V-OBS-01 | OBS | log entry | counts of rejections by reason; no text | PR |
| OP5V-A11Y-01 | A11Y | status UI | badges have text; reveal control keyboard-accessible; warning announced | PR |
| OP5V-KPI-02 | KPI | false-reject rate | ≤10% on gold + model output | EVAL |

### OP13 · Export appraisal sheet (DETERMINISTIC)
| ID | Type | Variant | Given → Expected | Gate |
|---|---|---|---|---|
| OP13-HYP-01 | HYP | manual copying happens today | ≥50% of 10 club members | PILOT (P1 fake door) |
| OP13-HYP-02 | HYP | template fits club sheet | ≤3 manual edits | HUMAN |
| OP13-UNIT-01 | UNIT | no status | `NO_STATUS` → OP12 runs first | PR |
| OP13-UNIT-02 | UNIT | default excludes unverified | placeholders "omitida" | PR |
| OP13-UNIT-03 | UNIT | includeUnverified | under "NO VERIFICADO" heading | PR |
| OP13-UNIT-04 | UNIT | abstract_only banner | present | PR |
| OP13-UNIT-05 | UNIT | partial coverage note | present | PR |
| OP13-UNIT-06 | UNIT | prerequisites labelled | "no proviene del artículo" | PR |
| OP13-UNIT-07 | UNIT | every template renders | no missing variables | PR |
| OP13-UNIT-08 | UNIT | determinism | byte-identical snapshot | PR |
| OP13-UNIT-09 | UNIT | encoding | UTF-8 accents/ñ/Greek survive paste into Google Docs & Word (manual) | REL |
| OP13-UNIT-10 | UNIT | clipboard denied | falls back to download | PR |
| OP13-SEC-01 🛑 | SEC | status line mandatory | 100% exports contain status + sources + date; wording invariant | PR |
| OP13-SEC-02 | SEC | no keys/diagnostics | export scan | PR |
| OP13-SEC-03 | SEC | markdown injection | `](javascript:`, raw HTML, backticks in quotes escaped | PR |
| OP13-SEC-04 | SEC | user gesture | clipboard only on click | PR |
| OP13-PERF-01 | PERF | 20 quotes | ≤50 ms | PR |
| OP13-VAL-01 | VAL | minutes to sheet | −50% (proposed) | PILOT |
| OP13-TYPE-01 | TYPE | ExportModel | template variables ⊆ model keys (static check) | PR |
| OP13-PROP-01 | PROP | quotes unaltered | exported quotes equal stored quotes after reversing Markdown escaping | PR |
| OP13-INT-01 | INT | reads 3 stores | Summary + Article + StatusCheck from Dexie; status >24 h → re-check first [decide] | PR |
| OP13-E2E-01 | E2E | clipboard | click Exportar → clipboard equals snapshot | PR |
| OP13-CON-01 | CON | shared wording | export status line equals VW1 chip text (same `statusText()`) | PR |
| OP13-RES-01 | RES | missing pieces | Article NOT_FOUND or missing sections → export with page-meta header, no crash | PR |
| OP13-FUZZ-01 | FUZZ | random strings | all fields fuzzed → valid Markdown, no raw HTML nodes after parsing | NIGHT |
| OP13-OBS-01 | OBS | log entry | template id, outcome | PR |
| OP13-A11Y-01 | A11Y | VW4 preview | focus trap, Esc closes, toast announced | PR |
| OP13-KPI-01 | KPI | export rate | exports / summarised papers (opt-in counts) | PILOT |

### OP14 · Capture feedback (DETERMINISTIC, P3)
| ID | Type | Variant | Given → Expected | Gate |
|---|---|---|---|---|
| OP14-UNIT-01 | UNIT | mark kinds | wrong / unclear / good stored with summaryKey, section | PR |
| OP14-UNIT-02 | UNIT | idempotency | same (summary, section, kind) twice → one record (note updated) | PR |
| OP14-UNIT-03 | UNIT | note limits | ≤1,000 chars; empty allowed | PR |
| OP14-UNIT-04 | UNIT | summary re-generated (new pipelineVersion) | old feedback kept, linked to old version | PR |
| OP14-UNIT-05 | UNIT | export format | JSON with schemaVersion, model text included for context [decide: include article quote?] | PR |
| OP14-UNIT-06 | UNIT | clear-all warning | warns when unexported feedback exists | PR |
| OP14-SEC-01 🛑 | SEC | never transmitted | no network on mark or export | PR |
| OP14-SEC-02 | SEC | note rendering | note shown as text | PR |
| OP14-SEC-03 | SEC | export contains no keys/PII beyond note | scan | PR |
| OP14-TYPE-01 | TYPE | schema import in eval | SVC7 parses exported JSON | PR |
| OP14-VAL-01 | VAL | label usefulness | ≥X% of "wrong" marks confirmed by QFB triage [specify] | HUMAN |
| OP14-HYP-01 | HYP | students mark errors | ≥1 mark per 10 summaries [proposed] | PILOT |
| OP14-UNIT-07 | UNIT | reversibility | undo mark deletes it; export reflects | PR |
| OP14-UNIT-08 | UNIT | atomicity | write fails → error shown, no ghost "marcado" state | PR |
| OP14-UNIT-09 | UNIT | note unicode | emoji/accents/RTL stored and exported unchanged | PR |
| OP14-PROP-01 | PROP | set semantics | any sequence of duplicate marks → one record per (summary, section, kind) | PR |
| OP14-INT-01 | INT | round trip | mark → Dexie → export JSON → parse | PR |
| OP14-E2E-01 | E2E | mark flow | Marcar → dialog → saved → visible "marcado" | PR |
| OP14-CON-01 | CON | eval consumer | SVC7 triage script parses export | PR |
| OP14-MIG-01 | MIG | Feedback schema bump | all marks preserved | PR |
| OP14-RES-01 | RES | storage unavailable | Marcar disabled with message | PR |
| OP14-PERF-01 | PERF | 10k marks | export ≤1 s | PR |
| OP14-OBS-01 | OBS | log entry | mark kind only; never note text | PR |
| OP14-A11Y-01 | A11Y | button & dialog | keyboard, labels, focus return | PR |
| OP14-KPI-01 | KPI | marks per 100 summaries; share "wrong" | tracked | PILOT |

### OP11 · Expert summary & gold set — concierge (HUMAN, SVC7)
| ID | Type | Variant | Given → Expected | Gate |
|---|---|---|---|---|
| OP11-HUM-01 | HUM | guideline exists & versioned | `eval/guideline.md` vN referenced by each item | HUMAN |
| OP11-HUM-02 | HUM | double annotation | 100% of items have 2 annotations before adjudication | PR (eval lint) |
| OP11-HUM-03 | HUM | adjudicator separation | adjudicator ∉ annotators (git identity check) | PR (eval lint) |
| OP11-HUM-04 | HUM | agreement | Cohen's κ per field ≥0.6 [specify]; <0.4 on a batch → guideline revision | HUMAN |
| OP11-HUM-05 | HUM | blinding | annotators do not see model output for gold items (gold created before/without OP5) | HUMAN |
| OP11-HUM-06 | HUM | SLA | batch of 10 within 2 weeks [specify] | HUMAN |
| OP11-HUM-07 | HUM | time per article | ≤2.25 expert-h; tracked | HUMAN |
| OP11-HUM-08 | HUM | drift between batches | κ and field distributions stable across batches | HUMAN |
| OP11-TYPE-01 | TYPE | GoldItem schema | validates against JSON Schema exported from Zod | PR |
| OP11-TYPE-02 | TYPE | quotes verbatim | every gold quote passes OP5V against the stored text | PR |
| OP11-SEC-01 🛑 | SEC | licence of stored text | only CC-BY / compatible OA texts in public `eval/gold/`; others in private store; CI checks licence field | PR |
| OP11-SEC-02 | SEC | no personal data | gold items contain no student data | PR |
| OP11-VAL-01 | VAL | split hygiene | train/holdout split fixed by DOI hash; holdout never used for prompt tuning | PR |
| OP11-VAL-02 | VAL | coverage of slices | gold covers designs (RCT, cohort, case-control, cross-sectional, SR/MA, qualitative, diagnostic), publishers, years, es/en | HUMAN |
| OP11-KPI-01 | KPI | gold size | ≥60 adjudicated (≥20 holdout) before OP5 gate | HUMAN |
| OP11-KPI-02 | KPI | concierge test protocol | randomised order, blinded labels, ≥15 students, 5 papers (see KPI-H-V2 power note) | PILOT |
| OP11-HYP-01 | HYP | κ achievable | κ ≥0.6 on 5-article pilot after guideline v1 | SPIKE |
| OP11-HYP-02 | HYP | effort | ≤2.25 expert-h/article on pilot | SPIKE |
| OP11-HYP-03 | HYP | concierge represents product | expert quotes pass OP5V 100%; students rate clarity ≥4/5 [proposed] | HUMAN |
| OP11-UNIT-01 | UNIT | κ implementation | matches reference values (scikit-learn) on known cases | PR |
| OP11-UNIT-02 | UNIT | field-agreement rubric | hand cases incl. partial matches, `not_reported` on both sides | PR |
| OP11-UNIT-03 | UNIT | versioning (reversibility) | new annotation version never overwrites; adjudication pins versions | PR |
| OP11-UNIT-04 | UNIT | concurrency | two annotators on same DOI → separate files, no conflict by construction | PR |
| OP11-UNIT-05 | UNIT | data quality | no DOI in both train and holdout; every item has licence field; text hash matches stored text | PR |
| OP11-PROP-01 | PROP | metric properties | agreement(a,a)=1; symmetric; κ ∈ [−1,1] | PR |
| OP11-PROP-02 | PROP | idempotent eval | same inputs + seed → identical report | PR |
| OP11-INT-01 | INT | annotate → adjudicate → eval report | sample gold dir → VW7 report generated | PR |
| OP11-CON-01 | CON | schema sync | JSON Schema regenerated from TS Zod in CI; diff → fail | PR |
| OP11-SEC-03 | SEC | no keys in eval | provider keys only from env; repo configs scanned | PR |
| OP11-RES-01 | RES | quota during eval | runner resumes from per-item checkpoint | PR |
| OP11-PERF-01 | PERF | eval budget | 60 items × 3 providers fits free quotas per day (or is scheduled across days) | EVAL |
| OP11-MIG-01 | MIG | guideline change | items annotated under old guideline flagged for re-check when affected fields changed | HUMAN |
| OP11-OBS-01 | OBS | report provenance | git sha, prompt hashes, model ids, dataset version recorded | PR |
| OP11-A11Y-01 | A11Y | VW6 form | keyboard usable for annotators | REL |

---

## 3. KPI, hypothesis and research tests

Each KPI test states formula, data, sample, statistical rule, decision if it fails, owner and cadence. Variants are the slices every KPI must also be reported on.

**Standard slices** (report every pilot KPI by): cohort/wave · institution · career and year · hardware tier · provider used · OS · course vs journal club.

| ID | KPI / hypothesis | Formula | Data & sample | Pass rule | If fails → | Owner · cadence |
|---|---|---|---|---|---|---|
| KPI-01 | H-N1 need | students confirming >45 min/article with a recent concrete example | 10 Mom-Test interviews | ≥7/10 | revisit segment/JTBD (Gate 1) | product lead · once (before P1 ends) |
| KPI-02 | H-V2 differentiation | % paired judgments preferring verified summary; planted errors detected | concierge summary vs free ChatGPT on 5 papers | ≥60% preference AND more planted errors detected (paired). **Power note**: 60% vs 50% one-sided α .05, power .8 needs ≈153 judgments; 15 students × 5 papers = 75 → treat as signal; run ≥31 students for a confirmatory read | ADR-0008: verifier pivot | product lead · P1 |
| KPI-03 | H-V1 time | `1 − minutes_with_tool / minutes_baseline`, within-subject | observed or self-timed sessions; paired t / Wilcoxon | ≥30% reduction; n ≥34 students for d=0.5, power .8, α .05 (paired) | revise UX/scope; check text coverage | product lead · P4 |
| KPI-04 | H3 accuracy non-inferiority | appraisal accuracy with tool − without | rubric scored by expert, blinded to arm | lower 90% CI bound > −margin (TOST); margin [specify Q9] | stop rollout; review over-trust | physician · P4 |
| KPI-05 | H-D1 install | installs / invited cohort | cohort ≈500 (ASSUMPTION) via instructor | ≥40% in 2 weeks (95% CI ±4.3 pp at n=500) | revisit channel/onboarding | product lead · per cohort |
| KPI-06 | week-4 active | active in week 4 / installers | survey + opt-in counts (no telemetry) | ≥40% | interview churned users | product lead · per cohort |
| KPI-07 | Sean Ellis PMF | "very disappointed" / respondents | survey, ≥40 responses | ≥40% | after 2 cohorts <40% → re-segment to instructors | product lead · per cohort |
| KPI-08 | H-C1 channel | instructors committing to recommend | demos to 5–8 instructors at ≥2 institutions | ≥2 commit | broaden institutions | product lead · P1 |
| KPI-09 | H-S1 feasibility | agreement & verified rate per $0 provider | gold holdout ≥20 articles | ≥80% / ≥85% for a provider available to ≥70% of cohort | fields default no_verificado; ADR on paid provider or verifier | QFB lead · EVAL |
| KPI-10 | H-S2 text | usable-text % | 50-page fixture set | ≥70% | JATS first; companion ADR | dev lead · REL |
| KPI-11 | quote validity | verified shown quotes / shown quotes | CI adversarial + pilot incident reports | 100% (0 incidents) | stop-ship, flag off | dev lead · continuous |
| KPI-12 | retraction recall / precision | see OP12-KPI | weekly RW sample | ≥95% / ≥98% | add source / offline RW | dev lead · WEEK |
| KPI-13 | users notice flagged papers | % recognising flagged paper in task | pilot appraisal task | +30 pp vs control [specify] | redesign chips | physician · P4 |
| KPI-14 | team cost | monthly cash spend | bills | $0 | ADR (breaks promise) | product lead · monthly |
| KPI-15 | user quota headroom | free capacity / median demand | diagnostics export + S5 | ≥3× | prefer Nano/Ollama; shorten inputs | dev lead · per cohort |
| KPI-16 | maintenance load | dev hours on site/provider breakage | issue tracker | ≤8 h/month | simplify site rules; drop sites | dev lead · monthly |
| KPI-17 | install time | median minutes to working provider | 5 observed students | ≤15 min | onboarding redesign | product lead · REL |
| KPI-18 | Opportunity Score re-measure | OS for Execute/Monitor after pilot | survey (Importance/Satisfaction) | Monitor OS drops ≥3 points | revisit value proposition | product lead · P4 |
| KPI-19 | contamination of evidence | % of exports including unverified sections | opt-in counts | tracked; >20% → review default | UX change | product lead · P4 |
| KPI-20 | privacy promise | requests outside allowlist | SYS-SEC-01 + user reports | 0 | stop-ship | dev lead · continuous |

Statistical hygiene for all KPI tests: pre-register thresholds and analysis in `docs/testing/pilot-protocol.md` before data collection [to write]; report CIs, not only point estimates; no peeking-based stopping; pilot waves are exploratory unless powered as above.

---

## 4. Decisions this catalog surfaced (need an owner)

| # | Decision | Tests blocked | Suggested default |
|---|---|---|---|
| D-T1 | Collapsed/accordion content: include (risk: hidden-text injection) or exclude (risk: missing real sections)? | OP4-UNIT-08, OP4-SEC-01 | include `<details>` and `aria-expanded` regions, exclude CSS-hidden; mark sections from collapsed regions |
| D-T2 | PDFs opened in Chrome's built-in viewer (content scripts cannot run) | OP1-UNIT-17, OP4 P2 | URL-based DOI + "abrir como texto" via pdf.js with runtime permission |
| D-T3 | PubMed lists give PMIDs, not DOIs | OP12-UNIT-15 | OpenAlex `pmid` filter [verify in S3] |
| D-T4 | "Retraction and replacement", withdrawn preprints | OP12-UNIT-10/11 | show as retraction-class chip with specific text |
| D-T5 | Wrong-language model output | OP5-UNIT-07 | one retry, then no_verificado |
| D-T6 | Symbol mapping (µ vs μ, superscripts) in normaliser | OP5V-UNIT-02 | NFKC + explicit micro/mu fold; superscripts folded |
| D-T7 | Incognito, file://, Google Scholar, Portuguese headings, ChromeOS | SYS-SEC-27, OP1-UNIT-14/18, OP4-UNIT-02, SYS-COMP-27 | not in v1; documented |
| D-T8 | H-V2 sample size (75 judgments underpowered) | KPI-02 | recruit ≥31 students or label result "signal" in ADR-0008 |

## 5. Test count by gate (approx.)

Counted from the tables after the coverage audit (a row with two gates counts once per gate; KPI table in section 3 excluded): PR 357 · SPIKE 25 · NIGHT 22 · EVAL 20 · REL 18 · PILOT 16 · HUMAN 15 · WEEK 7. Rows: 473 test rows + 20 KPI tests. Stop-ship 🛑 tests: 24.
