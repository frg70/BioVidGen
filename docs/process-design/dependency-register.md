# BioVidGen — Dependency, price and licence register

Checked: **2026-10-08**, via PyPI metadata, GitHub pages, vendor docs and web search in this session.
Legend: ✅ read from the primary source this session · 🔎 third-party source only, confirm · ⚠️ not checked, from memory, confirm before relying · ❌ rejected.
Policy: **$0 by default**; every dependency permissively licensed (project is MIT with commercial reuse); no API key shipped in the repo (users bring their own).

## 1. Data services (runtime, called from the user's machine)

| Service | Use | Cost / limits found | Status | Notes |
|---|---|---|---|---|
| OpenAlex | metadata, authors, keywords, topics, type (preprint), `is_retracted`, OA, citations | Free API key = **$1/day** budget (resets 00:00 UTC), no card. Keyless = **$0.10/day**. Single-entity lookup (by ID/DOI) **free, unlimited**; list+filter $0.10 per 1,000 calls (100 results/call, ≤100 OR values per filter); search $1 per 1,000. Hard cap 100 req/s. Pay-as-you-go $1 steps; plans from $5,000/yr (not needed) | ✅ help.openalex.org/access/pricing, /example-costs, rate-limits page (updated 2026-08-19) | Polite-pool/email policy not on the pages I read. One results page of ≤100 DOIs = 1 filter call (≈$0.0001) |
| Crossref REST | retraction notices (`update-to`, `source: retraction-watch` or `publisher`), `posted-content` (preprints), relations | No sign-up; `mailto=` for polite pool. Numeric rate limits **not stated** on the page I read | ✅ partly · 🔎 limits | Example: `filter=update-type:retraction`. Exact filter to ask "is DOI X retracted" must be tested in the spike |
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
