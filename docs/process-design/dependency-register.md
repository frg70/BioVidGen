# BioVidGen — Dependency, price and licence register

Checked: **2026-10-08**, via PyPI metadata, GitHub pages, vendor docs and web search in this session.
Legend: ✅ read from the primary source this session · 🔎 third-party source only, confirm · ⚠️ not checked, from memory, confirm before relying · ❌ rejected.
Policy: **$0 by default**; every dependency permissively licensed (project is MIT with commercial reuse); no API key shipped in the repo (users bring their own).

## 1. Data services (runtime, called from the user's machine)

| Service | Use | Cost / limits found | Status | Notes |
|---|---|---|---|---|
| OpenAlex | metadata, authors, keywords, topics, type (preprint), `is_retracted`, OA, citations | Free API key = **$1/day** budget (resets 00:00 UTC), no card. Keyless = **$0.10/day**. Single-entity lookup (by ID/DOI) **free, unlimited**; list+filter $0.10 per 1,000 calls (100 results/call, ≤100 OR values per filter); search $1 per 1,000. Hard cap 100 req/s. Pay-as-you-go $1 steps; plans from $5,000/yr (not needed) | ✅ help.openalex.org/access/pricing, /example-costs, rate-limits page (updated 2026-08-19) | Polite-pool/email policy not on the pages I read. One results page of ≤100 DOIs = 1 filter call (≈$0.0001). **2026-11-07, live:** keyless single lookups answer `X-RateLimit-Cost-USD: 0`; a missing DOI is 404 with an HTML body; an unknown `select` field is 400; `/works/doi:` accepts any case and percent-encoded DOIs; a 1,011-author work returns all authors (about 1 MB with `select`). OP3 sends no key and no email |
| Crossref REST | retraction notices (`update-to`, `source: retraction-watch` or `publisher`), `posted-content` (preprints), relations | No sign-up; `mailto=` for polite pool. Numeric rate limits **not stated** on the page I read. **2026-11-07, live:** public pool answers `x-rate-limit-limit: 5`, `x-rate-limit-interval: 1s`; `subject` absent on all 404 sampled works; missing DOI is 404 text/plain | ✅ partly · 🔎 limits | Example: `filter=update-type:retraction`. Exact filter to ask "is DOI X retracted" must be tested in the spike |
| Retraction Watch dataset (via Crossref GitLab) | offline retraction/EoC lookup | CSV, updated each working day; columns include `OriginalPaperDOI`, `RetractionNature` (Retraction/Correction/Expression of concern/Reinstatement). Download by `git clone gitlab.com/crossref/retraction-watch-data` | ✅ | **Data licence not stated on the page** ⚠️ confirm before bundling/redistributing |
| OpenCitations Index API v2 | references/citations by DOI (Mapa) | **180 req/min/IP**; access token recommended, not stated as required; endpoints `/citations/doi:`, `/references/doi:`, counts | ✅ api.opencitations.net/index/v2 | Docs CC BY 4.0; **data licence not stated on that page** ⚠️ |
| Unpaywall | OA PDF/landing links | Free; email required; asked to stay ≤ **100,000 calls/day** | 🔎 (confirmed by multiple third parties + an unpaywall.org/api/v2 hit) | Third-party claim that commercial use needs a key: unconfirmed |
| Europe PMC REST | OA full text XML for biomedicine | No key (third-party). Official limits/terms **not retrieved** (HTTP 403) | 🔎 | Per-article licence varies |
| Semantic Scholar, PubMed E-utilities | alternatives | not checked | ⚠️ | Only if gaps found |

## 2. LLM options (all $0 paths first)

| Option | Cost | Constraints found | Status |
|---|---|---|---|
| **Chrome built-in AI** (Gemini Nano via Prompt API / Summarizer API) | $0, on-device, offline after model download | Desktop Chrome (Win 10/11, macOS 13+, Linux); ≥**22 GB** free on profile volume; **>4 GB VRAM** *or* **16 GB RAM + 4 CPU cores**; unmetered connection for the download; extensions must acknowledge Google's Generative AI Prohibited Uses Policy; Prompt API stable in Chrome 138+ (one 2026 source: stable for extensions). Context window size not found | 🔎 mostly from a mirrored Chrome doc (May 2025) and tutorials; check `chrome://on-device-internals` and current docs |
| **Ollama** + open-weight model | $0 (your hardware) | Runtime is MIT ✅. Models carry their own licence: Qwen3 line mostly Apache-2.0 but some releases use other terms; Gemma 4 Apache-2.0 (Gemma 1–3n custom terms); Llama = Llama Community License (not OSI, 700M-MAU clause, restrictions on training other models) | ✅ runtime · 🔎 model licences: read each model card |
| **Bring-your-own free API key** | $0 within quotas | **Gemini**: Flash/Flash-Lite free; Pro paid-only since Apr 2026; sources disagree on limits (≈100 RPD … 1,500 RPD, 5–15 RPM); free-tier inputs may be used to improve Google products. **Groq**: per-model daily limits (e.g. 30 RPM, 1,000 RPD, 200K tokens/day on gpt-oss-120b per one source). **OpenRouter**: ~20 `:free` models, daily caps changed in 2026. All numbers change without notice | 🔎 third-party blogs only |
| Paid API (e.g. Anthropic, OpenAI, Gemini paid) | per token | not default | n/a |
| **Laya** (Convai Innovations, Apache-2.0, released 2026-09-18 per Flowtivity post) | $0 self-hosted | Decision/classification model, **not** a text generator. Checkpoints 421M/322M params; context **512–1024 tokens**; zero-shot base scores 0.362 < 0.461 majority baseline; 0.766 only after fine-tuning; poor calibration; on CPU-only VPS median ~49 s per warm prediction (GPU recommended); repo URL not given | 🔎 one blog post. Decision: see tech-spec-v2 §6.3 |

## 3. Libraries

| Library | Version seen | Licence | Status | Verdict |
|---|---|---|---|---|
| DSPy | 3.4.0 (py ≥3.10,<3.15) | MIT | ✅ PyPI | **Dev-time only** (offline prompt optimization/eval) |
| LiteLLM | 1.104.2 | MIT (package metadata) | ✅ PyPI | Optional dev-time; avoid in extension. Check no non-MIT `enterprise/` code is vendored ⚠️ |
| PyMuPDF | 1.28.2 | **AGPL-3.0 or Artifex commercial** | ✅ | ❌ rejected (MIT promise) |
| pypdfium2 | 5.14.0 | BSD-3-Clause / Apache-2.0 (+ dependency licences) | ✅ | ✅ companion PDF text |
| pypdf | 6.19.0 | BSD-3-Clause | ✅ | ✅ fallback |
| pdfminer.six | 20260107 | MIT | ✅ | ✅ fallback / layout |
| Docling | 2.135.0 (py ≥3.10) | MIT | ✅ code · ⚠️ bundled model weights' licences and install size | Optional extra only after measuring |
| FastAPI | 0.143.0 | MIT | ✅ | ✅ optional companion |
| Ollama | repo MIT, Windows installer available | MIT | ✅ | ✅ optional provider |
| WXT (extension framework) | 0.20.x (two versions quoted: 0.20.8 / 0.20.24) | MIT | 🔎 | ✅ choose over Plasmo (maintenance concerns, 🔎) |
| Mozilla Readability | — | Apache-2.0 | ✅ GitHub page | ✅ DOM article extraction in content script (clone the document; sanitize output) |
| pdf.js | — | Apache-2.0 | ✅ GitHub page | ✅ in-extension PDF text |
| GROBID | — | Apache-2.0 | 🔎 docs | Optional companion; "full" image reported ≈9.5 GB (fork author's claim, 🔎) → too heavy for the default install; CRF-only image is smaller |
| Tesseract OCR | — | Apache-2.0 | ⚠️ | Optional companion for scans |
| React (or Preact), Zod, DOMPurify, Cytoscape.js, SQLite, Pydantic, httpx | — | MIT / MIT / Apache-2.0+MPL / MIT / public domain / MIT / BSD | ⚠️ from memory | Confirm with a licence scanner in CI |

## 3b. Extension toolchain (SVC0 scaffold, added 2026-11-05)

Checked 2026-11-05 with `npm view <pkg> version license` (npm registry metadata ✅) and enforced on every PR by `npm run licenses`, which reads the `license` field of all 340 packages in `extension/package-lock.json` (SYS-SEC-30). Versions are pinned exactly (`npm i -E`).

| Package | Version | Licence | Scope | Use | Notes |
|---|---|---|---|---|---|
| preact | 11.1.1 | MIT ✅ | **runtime** | side panel / options UI | JSX via tsconfig `jsxImportSource: "preact"`; no Vite plugin needed |
| dexie | 4.4.7 | **Apache-2.0** ✅ | **runtime** | IndexedDB wrapper | tech-spec-v3 §3 said "MIT ⚠️ verify": it is Apache-2.0, still allowed |
| zod | 4.6.7 | MIT ✅ | **runtime** | schemas at every boundary; `z.toJSONSchema()` for eval | Zod 4 exports JSON Schema natively, so `zod-to-json-schema` is **not** needed |
| wxt | 0.21.5 | MIT ✅ | dev (its small runtime helpers are bundled) | extension framework, build, zip | Register previously listed 0.20.x |
| typescript | 6.0.3 | Apache-2.0 ✅ | dev | type checking | 7.0.2 is latest, but typescript-eslint 8.72 requires `<6.1.0` |
| vitest | 5.1.0 | MIT ✅ | dev | unit / property / integration tests | |
| fast-check | 4.10.2 | MIT ✅ | dev | property tests | |
| jsdom | 31.0.0 | MIT ✅ | dev | DOM for OP1 unit tests (added 2026-11-05) | real-browser behaviour stays in Playwright |
| @types/jsdom | 30.0.0 | MIT ✅ | dev | types for jsdom (added 2026-11-05) | |
| msw | 3.0.3 | MIT ✅ | dev | HTTP mocking for client tests (OP3+) | installed now, first used by scholarly clients |
| fake-indexeddb | 6.2.7 | Apache-2.0 ✅ | dev | IndexedDB in Node tests | |
| @playwright/test | 1.64.1 | Apache-2.0 ✅ | dev | e2e in bundled Chromium (headless via `channel: 'chromium'`) | browsers downloaded by `npx playwright install chromium` |
| eslint | 10.14.0 | MIT ✅ | dev | lint | |
| @eslint/js | 10.0.1 | MIT ✅ | dev | lint presets | |
| typescript-eslint | 8.72.1 | MIT ✅ | dev | TS lint | |
| eslint-plugin-no-unsanitized | 4.1.5 | MPL-2.0 ✅ | dev only (allowed) | SYS-SEC-20 | |
| globals | 17.14.0 | MIT ✅ | dev | ESLint globals | |
| tsx | 4.23.15 | MIT ✅ | dev | runs `scripts/*.ts` | |
| @types/node | 22.20.5 | MIT ✅ | dev | Node types for scripts/tests | |
| lightningcss (transitive, via vite) | 1.33.0 | MPL-2.0 ✅ | dev only (allowed) | CSS tooling in Vite 8 | |
| gitleaks (CLI, not npm) | 8.30.1 | MIT ✅ (GitHub licence API) | CI tool | SYS-SEC-14 secret scan | Binary pinned by sha256 in CI. README says the project is feature-complete (security fixes only; author moved to "Betterleaks"): revisit if it stops receiving fixes |
| GitHub Actions: actions/checkout v7.0.1, actions/setup-node v7.1.0, actions/upload-artifact v7.0.2 | pinned by commit SHA | MIT | CI | | gitleaks-action is not used (we run the binary directly) |

**Rejected / not added:** eslint-plugin-boundaries 7.4.1 (MIT ✅): replaced by a ~90-line in-repo rule (`extension/eslint-rules/boundaries.js`) because one-writer-per-store needs per-file allow-lists. zod-to-json-schema: unnecessary with Zod 4. @preact/preset-vite: unnecessary for the empty scaffold (no HMR for Preact components; revisit if UI work needs it).

**Licence totals (2026-11-05):** runtime 3 packages (2 MIT, 1 Apache-2.0); dev 337 (259 MIT, 20 Apache-2.0, 19 ISC, 19 BSD-2-Clause, 5 BSD-3-Clause, 13 MPL-2.0 = eslint-plugin-no-unsanitized + lightningcss and its 11 platform binaries, 1 BlueOak-1.0.0, 1 MIT OR CC0-1.0). `npm audit --omit=dev`: 0 vulnerabilities. Full `npm audit`: 10 moderate, all in the ESLint toolchain (minimatch via @eslint/config-array, typescript-estree); dev-only, below the PR gate (high/critical runtime).

## 3c. Local Python backend (BE0 skeleton, added 2026-11-05, ADR-0010)

Checked 2026-11-05 against PyPI JSON metadata and the installed package metadata. CI enforces this with `uv run python scripts/licence_gate.py` (BE0-SEC-08), which reads PEP 639 `License-Expression`, then `License`, then classifiers. Runtime scope is the lockfile closure from `uv export --no-dev`. Versions are pinned in `backend/pyproject.toml` and locked in `uv.lock`.

**Owner decisions (2026-11-05):**
- Runtime dependencies fastapi, uvicorn and pydantic are approved.
- **PSF-2.0 is allowed at runtime.** typing-extensions needs it, and pydantic needs typing-extensions.
- **Outbound HTTP uses the standard library** (`urllib.request`, OS certificate store). No httpx, requests or certifi at runtime, so MPL-2.0 stays out of what ships.

| Package | Version | Licence | Scope | Use | Notes |
|---|---|---|---|---|---|
| fastapi | 0.162.0 | MIT ✅ | **runtime** | HTTP API | docs/OpenAPI routes disabled (BE0-SEC-09) |
| uvicorn | 0.54.0 | BSD-3-Clause ✅ | **runtime** | ASGI server | started with `server_header=False`, `proxy_headers=False`, `access_log=False` |
| pydantic | 2.14.3 | MIT ✅ | **runtime** | schemas at boundaries | |
| starlette, pydantic-core, anyio, h11, idna, click, annotated-types, annotated-doc, typing-inspection | locked | MIT / BSD-3-Clause ✅ | runtime (transitive) | | colorama (BSD) on Windows via click |
| typing-extensions | 4.16.0 | **PSF-2.0** ✅ (allowed by owner decision) | runtime (transitive) | pydantic requirement | |
| opentelemetry-api | 1.45.2 | Apache-2.0 ✅ | runtime (transitive, via fastapi) | none by us | API only: a no-op without an SDK and exporter, so **no telemetry**. BE0-SEC-10 fails if an SDK or exporter is ever added or if `src/` imports it |
| pytest | 9.2.0 | MIT ✅ | dev | tests | |
| hypothesis | 6.170.15 | MPL-2.0 ✅ (dev only) | dev | property tests for the OP5V port (added 2026-11-06) | |
| ruff | 0.17.3 | MIT ✅ | dev | lint + format | |
| httpx | 0.28.1 | BSD-3-Clause ✅ | **dev only** | FastAPI `TestClient` | pulls certifi (MPL-2.0, dev-only, allowed). Starlette now warns that `httpx` is deprecated for its TestClient in favour of `httpx2`; not switched (new package, unverified) |
| uv | 0.9.11 | MIT OR Apache-2.0 ✅ (PyPI classifiers) | dev / CI tool | environment, lockfile, build backend (`uv_build`) | installed in CI with `pipx install uv==0.9.11` |

**Mutation testing (2026-11-06, delta D34):** no package. mutmut 3.8.1 (BSD-3) refuses native Windows, and cosmic-ray 8.7.0 (MIT) depends on yattag (LGPL), which the licence gate refuses. OP5V-MUT-01 uses `backend/scripts/mutation_run.py` (standard library).

**Checked, not added yet:** keyring 25.7.0 (MIT, for API keys when OP5 lands), import-linter 2.15 (BSD-2, add when there are two or more modules).

**Packaging candidates (ADR-0010):** Briefcase 0.4.7 (BSD-3-Clause) is the only candidate that passes rule 8. PyInstaller 6.22.3 (GPL-2.0-or-later with a bootloader exception) and Nuitka 4.3.4 (AGPL-3.0) are rejected.

## 4. Distribution

| Item | Cost | Status |
|---|---|---|
| Chrome Web Store developer registration | **$5 one-time** | 🔎 Chromium Blog (2020); confirm on the current dashboard |
| Load unpacked extension (developer mode) for local use | $0 | ✅ standard Chrome behaviour (pdf.js page also documents it) |
| Firefox AMO / Edge Add-ons | not checked | ⚠️ (Chrome-only in v1; Gemini Nano is Chrome-only) |
| Hosting | $0: there is no server | design decision |

**Estimated recurring cost at v1: $0** (OpenAlex free key, Crossref/OpenCitations/Unpaywall free, LLM via on-device or free-tier BYO key). One-time: $5 store fee if published.

## 5. Things I could not verify (do in the first spike)
1. Whether an extension page/service worker fetching `http://localhost:*` triggers Chrome's Local Network Access prompt (Chrome docs describe LNA for websites; extension handling not confirmed).
2. Whether Ollama accepts `chrome-extension://` origins by default (typically needs `OLLAMA_ORIGINS`) ⚠️.
3. Gemini Nano's actual context limit and Spanish quality.
4. Exact Crossref query for "is this DOI retracted" and whether OpenAlex `is_retracted` derives from Retraction Watch ⚠️.
5. Retraction Watch and OpenCitations data licences.
6. Today's free-tier quotas of Gemini/Groq/OpenRouter (read the live pages in AI Studio/console).
