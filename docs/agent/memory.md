# BioVidGen — Project memory

Last updated: 2026-11-05.

Update this file at the end of every working session, in the same PR as the work. Keep it short: state, numbers and facts belong here; explanations go in `reasoning.md` or the docs.

## Status
- **Phase:** P0 (spikes + walking skeleton), **in progress**. Architecture changed 2026-11-05 (ADR-0010): Chrome extension (thin client) + local web app, both served by one Python backend on 127.0.0.1.
- **Branch chain (all local, nothing pushed):** `docs/pipeline-v3` → `feat/svc0-scaffold` → `feat/op5v-validate-evidence` → `feat/be0-backend-skeleton` → `feat/op1-detect-paper`.
- `app/agent/` (owner's working tree renames it `app/backend/`, uncommitted) holds v1 notes only; the new backend is `backend/`.
- **Docs pipeline: complete.**
  - Discovery: `docs/discovery/`
  - Tech spec v3 + ADR-0008/0009: `docs/process-design/`, `docs/adr/`
  - P0 implementation plans: `docs/impl-plans/`
  - Test catalog: `docs/testing/` (473 tests + 20 KPI tests, 24 stop-ship)
- **Discovery verdict:** Go with risks, with one amber flag: differentiation against free ChatGPT and free retraction extensions.
- **Git:** docs committed on `docs/pipeline-v3` (6 commits, not pushed). `feat/svc0-scaffold` branches from it, so neither is on `main` yet.

## Next up — P0 order (from `docs/impl-plans/README.md`)
- [x] **SVC0 scaffold** (2026-11-05): WXT + TS strict + Preact + Vitest + fast-check + MSW + Playwright; boundary lint (in-repo rule) + no-unsanitized; licence gate; gitleaks; network-allowlist e2e; `catalog` script; CI workflow. **Open:** push the branch and confirm CI green on GitHub. Toolbar click opening the panel verified in Google Chrome 156 (2026-11-05).
- [ ] Spikes S1–S7. Record results in the table below.
- [x] OP5V in TypeScript (reference), committed on `feat/op5v-validate-evidence`:
  - 88/88 unit tests green; catalog OP5V 32/40;
  - 0 false accepts on 500 generated near-quotes; numbers rule caught 100/100 planted numbers;
  - validateDrafts p50 16 ms, p95 19–27 ms (target 20 ms; the test asserts the 100 ms fail line, D26).
- [x] ADR-0010 accepted 2026-11-05. S2 gate passed (Chromium 156).
- [x] **BE0 backend skeleton** (ADR-0010 step 1) on `feat/be0-backend-skeleton`:
  - FastAPI on 127.0.0.1; pairing token; Host/Origin/CORS/body-size checks; SQLite with migrations; log ring with runId;
  - licence gate; CI job `backend`;
  - 17/17 pytest, ruff clean, licence gate 25 packages; smoke run OK.
- [x] **OP1 Detect paper** on `feat/op1-detect-paper` (owner moved it ahead of the OP5V port, 2026-11-05):
  - content script on 14 publishers (ADR-0011, site list only); side panel shows title, DOI, version, PMID, PMCID, or asks when unsure;
  - 139 unit tests, 19 e2e; catalog OP1 53/58 (open: HYP-01..03 spike, VAL-01 needs OP3, MUT-01 needs a tool);
  - fixture suite 11/11 labelled DOIs returned correctly, 0 wrong papers (16 fixtures: 12 real metadata captures, 4 synthetic);
  - p95 9.2 ms on 60k nodes + 200 metas (headless; target 50 ms);
  - manual DOI entry for pages with no usable DOI, on or off the list (D33, no new permission). Unchecked until OP3.
- [ ] **Next: OP5V port to Python** (ADR-0010 step 2), test-first. Vectors: `extension/fixtures/op5v/`, the TS adversarial cases. Add hypothesis (dev). Mutation run with mutmut.
- [ ] Then ADR-0010 step 3: extension client (pairing UI, "backend off" state, rule 1/2 updates).
- [ ] OP3 Resolve → OP12 Status (panel path) → OP4 Text (DOM only) → OP5 stub → OP13 Export.
- [ ] VW5 Diagnostics → VW3 Options (basic) → VW1 Paper panel skeleton.
- [ ] **P0 exit:**
  - one paper flows from detection to export on 3 publishers;
  - OP5V has 0 false accepts on the adversarial set;
  - all gates are green;
  - spike numbers are written into the ADRs.

Human track, in parallel. It is on the critical path through ADR-0008.
- [ ] OP11 guideline v1 + batch 1 of 10 concierge summaries (QFB lead, physician).
- [ ] H-N1: 10 Mom-Test interviews.
- [ ] H-C1: demos for 5–8 instructors.
- [ ] Plan the next batch of units: SVC7, OP11, VW6, VW2 (P1) before P0 ends.

## Spike results
| Spike | Question | Result | Date | Changes |
|---|---|---|---|---|
| S1 | Gemini Nano: availability, context size, Spanish quality on 10 abstracts, `responseConstraint` support | [pending] | | OP5 adapter; default provider |
| S2 | Extension -> local server on 127.0.0.1 (Local Network Access); `OLLAMA_ORIGINS` | **Pass.** (1) Chromium 156 headless: extension page + service worker reach `http://127.0.0.1` with no host permission (CORS preflight with `Origin: chrome-extension://<id>`); a public page is blocked before sending. (2) **Google Chrome 156 stable, headed** (extension loaded via CDP `Extensions.loadUnpacked`, throwaway profile): extension page and service worker -> backend 200, **no prompt**; toolbar click (Extensions menu -> BioVidGen) opens the side panel; a **public page triggers the LNA permission bubble** ("quiere: Acceder a otras aplicaciones y servicios de este dispositivo", Permitir/Bloquear) instead of a silent block. Not checked: Ollama `OLLAMA_ORIGINS` | 2026-11-05 | If a user clicks Permitir on a malicious site, only the backend checks stop it: Origin allowlist + token (BE0-SEC-03/02) are load-bearing, never relax them |
| S3 | Exact OpenAlex/Crossref retraction, EoC and preprint queries; OpenAlex `pmid` filter; recall/precision on samples | [pending] | | OP12 |
| S4 | Side-panel call lifetime vs service-worker shutdown | [pending] | | orchestration |
| S5 | Live free-tier quotas and `json_schema` support: Gemini, Groq, OpenRouter | [pending] | | OP5, Gate 2 headroom |
| S6 | Citicious code + licence | [pending] | | ADR-0009 |
| S7 | Does browser-native AI already give one-click Spanish page summaries in Mexico? | [pending] | | differentiation flag |

## Verified facts
Format: fact (date, source).
- Toolchain pinned 2026-11-05 (npm registry): wxt 0.21.5, preact 11.1.1, dexie 4.4.7 (**Apache-2.0**, not MIT), zod 4.6.7, typescript 6.0.3, vitest 5.1.0, @playwright/test 1.64.1, eslint 10.14.0, typescript-eslint 8.72.1, vite 8.3.6 (transitive). Full list: dependency register §3b.
- typescript-eslint 8.72 requires TypeScript `<6.1.0`; TS 7.0.2 (latest) cannot be used yet. (2026-11-05, npm peerDependencies)
- Zod 4 has `z.toJSONSchema()` (draft 2020-12); `zod-to-json-schema` is not needed. (2026-11-05, SVC0-TYPE-02)
- Playwright loads unpacked MV3 extensions headless with `channel: 'chromium'` (bundled Chromium; Chrome/Edge removed the side-load flags). (2026-11-05, playwright.dev/docs/chrome-extensions + e2e run)
- `context.on('request')` **does** capture fetches from the extension service worker (`request.serviceWorker()` non-null) and from extension pages. (2026-11-05, e2e canary SYS-SEC-01)
- WXT: a content script with non-empty `matches` adds them to `host_permissions` even with `registration: 'runtime'`. (2026-11-05, build output)
- Chrome sidePanel API: Chrome 114+; `setPanelBehavior({openPanelOnActionClick:true})` needs an `action` key. WXT adds the `sidePanel` permission and `side_panel.default_path` automatically. Manifest sets `minimum_chrome_version: 116`. (2026-11-05, developer.chrome.com + build)
- gitleaks 8.30.1 (MIT) is the latest release; the project is feature-complete (security fixes only). gitleaks-action needs no licence key for personal accounts (frg70 is a User). (2026-11-05, GitHub)
- Vite 8 honours tsconfig `jsxImportSource: 'preact'`; no Preact Vite plugin needed for the build. (2026-11-05, build output)
- OpenAlex: single-entity lookup is free and unlimited. List/filter costs $0.10 per 1,000 calls; search costs $1 per 1,000. Budget is $0.10/day keyless and $1/day with a free key. Hard cap 100 req/s. (2026-10-08, help.openalex.org)
- OpenCitations: 180 req/min/IP. (2026-10-08)
- Gemini Nano in Chrome needs ≥22 GB free disk, plus either >4 GB VRAM or 16 GB RAM with 4 cores. Desktop Chrome only. (2026-10-08, 🔎 secondary source)
- PyMuPDF is AGPL → rejected. pypdfium2, pypdf and pdfminer.six are permissive. (2026-10-08, PyPI)
- Health-science enrolment in Mexico 2023-24: 1,291,096 (ANUIES, 🟡).
- Prefix `10.1101` is shared by bioRxiv/medRxiv and Cold Spring Harbor journals (e.g., Genome Research), so the preprint rule must use DOI patterns. (design finding)
- Chrome's built-in PDF viewer **does** run content scripts: the PLOS PDF showed its DOI. Some publishers (Frontiers, MDPI) send PDFs as downloads, so nothing runs. (2026-11-05, Chrome 156; corrects the earlier design finding)
- A toolbar click does **not** grant `activeTab` while `openPanelOnActionClick` is on (refused before and after the click). `tab.url` stays hidden with `content_scripts` access alone. (2026-11-05, Chrome 156)
- Real pages, 2026-11-05: `citation_doi` on all 8 articles whose page loaded with metadata (H1 sample, plan wants 60). More than one distinct DOI in the body on all 8, up to 91 (H3). Forms seen: `DC.Identifier`, `doi:10…`, `og:type=Article`, `@type` arrays. Europe PMC has no paper metadata in its head.
- Prefix 10.64898 belongs to openRxiv. (2026-11-05, Crossref API)
- biomedcentral.com redirects to link.springer.com. (2026-11-05)
- PubMed result lists expose PMIDs, not DOIs. (design finding)

**Still `[verify]`:**
- Crossref `filter=updates:{doi}` / `updated-by`
- OpenAlex `pmid` filter
- Prompt API names and `responseConstraint`
- the Ollama version that added structured outputs
- per-provider `response_format: json_schema`
- licences of DOMPurify, mustache, Stryker (Dexie = Apache-2.0 and eslint-plugin-boundaries = MIT verified 2026-11-05; zod-to-json-schema not needed)
- whether `America/Mexico_City` has no DST

## Decisions (ADR index)
| ADR | Status | Gist |
|---|---|---|
| 0003 | Amended | Runtime uses plain prompts + Zod + validator. DSPy offline only. |
| 0004 | Proposed (verified) | Permissive licences only; PDF toolchain without AGPL. |
| 0006 | Proposed | Local-first Chrome extension; no backend. |
| 0007 | Proposed (pending S1, S2, S5) | Free-first, pluggable LLM: Nano → Ollama → bring-your-own key. |
| 0008 | Proposed | Expert-written (concierge) summaries + blind test vs ChatGPT gate the LLM build. Fail → verifier pivot. |
| 0009 | Proposed (pending S6) | Build OP12 ourselves; Citicious as reference only. |
| 0011 | **Accepted** 2026-11-05 | Paper detection reads only a fixed list of 14 publishers. On-click access failed its Chrome test and is out. |
| 0010 | **Accepted** 2026-11-05 | One local Python backend (FastAPI + SQLite, 127.0.0.1) shared by the extension (thin client) and a local web app. Amends 0006. |
| 0001, 0002 | Superseded by 0006 | |
| 0005 | Withdrawn | |

## Open decisions
- Q1 Interviews to replace assumed Opportunity Scores. Owner: product lead.
- Q2 Partner institutions. Owner: team lead.
- Q3 Student hardware survey. Owner: product lead.
- Q4 Citicious. Owner: dev lead (S6).
- Q5 Browser-native AI (S7). Owner: dev lead.
- Q6 Club appraisal-sheet format. Owner: moderator.
- Q7 Gold-set licensing. Owner: QFB lead.
- Q8 Expert hours per month. Owner: QFB lead.
- Q9 Non-inferiority margin. Owner: physician.
- Q10 Protocol artifact `ChMWi4yjj8Qtq5W3xVJ7WN` unreachable. Owner: team.
- Q11 Licences still to verify. Owner: dev lead.
- Q12 OP11 adjudicator. Owner: QFB lead.
- Q13 Pilot time instrument. Owner: product lead.
- D-T1…D-T8 (test catalog §4):
  - collapsed sections;
  - PDF viewer;
  - PMID lists;
  - retraction-and-replacement and withdrawn preprints;
  - wrong-language output;
  - symbol normalisation;
  - out-of-scope surfaces;
  - **H-V2 sample size: 75 judgments is underpowered; about 153 are needed.**
- Resolved 2026-11-05: `.claude/` stays **fully ignored**. Untrack the skills committed in `2da8279` with `git rm -r --cached .claude` (prompt 0). Project `.claude/settings.json` is not versioned.
- Resolved 2026-11-05: docs use **role names** (dev lead, QFB lead, physician, product lead). Real names are not needed. GitHub handles are needed only if CODEOWNERS/branch protection is set up for OP5-HUM-01 (prompt review); defer until then.
- Resolved 2026-11-05: D-T6 symbol mapping = NFKC as is (µ→μ, superscripts fold; ± ≤ ≥ × unchanged).
- Resolved 2026-11-05: D26 OP5V-PERF-01 asserts p95 ≤ 100 ms (plan fail line); 20 ms is a tracked target.
- Resolved 2026-11-05: VW1 does **not** hide `abstract_only` sections that have rejected quotes (status stays `abstract_only`, plan §4).
- Resolved 2026-11-05: the human track (OP11, interviews, instructor demos) **runs in parallel** with P0 code.

## Gotchas learned
Append as you find them, one line each, with the date.
- 2026-11-05: A float token balance in a token bucket drifts by 1 ms and breaks the rate bound; the limiter uses GCRA (found by SVC0-PROP-02).
- 2026-11-05: An `AbortSignal` already aborted before `addEventListener` never fires; check `signal.aborted` first (found by SVC0-UNIT-05).
- 2026-11-05: ESLint `no-restricted-syntax` selectors: regex attributes with `|` failed to parse; use one selector per name.
- 2026-11-05: Playwright fixtures must destructure (`async ({}, use)`); silence `no-empty-pattern` on those lines.
- 2026-11-05: Test fixtures that contain `it("ID …")` strings make `npm run catalog` count false coverage; build such strings from parts.
- 2026-11-05: ESLint config load costs ~8 s cold inside Vitest; lint tests warm up in `beforeAll`.
- 2026-11-05: Agent tooling: Bash heredocs on this machine collapse `\` and break on apostrophes; write files with the editor tool.

- 2026-11-05: Agent tooling: `\uXXXX` escapes typed by the agent land in files as literal characters; restore visible escapes with a script that takes code points as numbers.
- 2026-11-05: Spreading a typed array into `String.fromCharCode(...)` is ~8× slower than `.apply`; it dominated normaliser time.
- 2026-11-05: Boundary lint matches module names as path segments: `contracts/summary.ts` reads as the `summary` module. Avoid file names equal to module names.
- 2026-11-05: Windows `process.cpuUsage()` ticks at ~15.6 ms; useless for a 20 ms budget.
- 2026-11-05: PowerShell 5.1 `Set-Content -Encoding utf8` and here-strings piped to `git commit -F -` break commit messages (BOM, args). Write the message file with the editor tool, then `git commit -F <file>`.
- 2026-11-05: Windows: killing `uv run biovidgen` leaves the Python child holding the port; a second start fails to bind while clients keep reaching the old server (old token, so 401). Kill the tree (`taskkill /T`). Packaging (ADR-0010 step 5) needs single-instance detection and a real stop command.
- 2026-11-05: In Playwright the panel page stands in for the side panel: never `bringToFront()` it, or it becomes the active tab and the tracker follows it.
- 2026-11-05: Processes started from an agent session die with it. Create long-lived test windows through WMI (`Win32_Process.Create`). Clear stale flag files before a UI Automation run.
- 2026-11-05: `npm audit` reports 10 moderate findings in the eslint dev chain (minimatch via `@eslint/config-array`); runtime is clean. Not force-fixed: `--force` changes major versions.
- 2026-11-05: OP5V-PERF-01 and the FUZZ tests are limited by time and fail under heavy CPU load (p95 133-165 ms with a stuck VS Code installer running), then pass again with no code change. Check load before suspecting a regression. OP1-FUZZ-01 runs 50 pages in PRs; the catalog's 10k nightly run has no workflow yet.
- 2026-11-05: Starlette TestClient warns that httpx is deprecated in favour of `httpx2`; harmless for now (dev only).

## Session log
- 2026-11-05 (e): Owner asked for paper detection ahead of the OP5V port. ADR-0011 drafted, owner chose site list then on-click; on-click failed in real Chrome, so site list only. Version kept in a new field. OP1 built test-first (red 48 → green). Real side panel checked in Chrome 156 through navigation and tab changes. Live: 11 of 14 publishers verified; ScienceDirect and medRxiv blocked automation; Europe PMC list unverified.
- 2026-11-05 (d): Owner accepted ADR-0010 and approved fastapi/uvicorn/pydantic, PSF-2.0 at runtime, and stdlib HTTP (no httpx at runtime). S2 passed. BE0 skeleton built test-first (red: collection error → green 17/17). FastAPI 0.162 brings opentelemetry-api (no-op; BE0-SEC-10 guards against an SDK). Nuitka is AGPL and PyInstaller GPL: Briefcase is the only packaging candidate.
- 2026-11-05 (c): OP5V in TS test-first (red 33 → green 86/87). Owner then asked for a standalone local app and one shared Python backend; drafted ADR-0010 (Proposed) and paused OP5V. Nothing committed.
- 2026-11-05 (b): SVC0 scaffold on `feat/svc0-scaffold`. Numbers: 54 unit/property/integration tests (Vitest ~8 s), 7 e2e (Playwright headless ~35–41 s), catalog SVC0 35/35, SYS-OBS 3/5, SYS-SEC 10/27 (rest belong to later units). Build 218 KB (side panel chunk 200 KB: Dexie + Zod; no budget set yet). Licence gate 340 packages pass. gitleaks: no leaks. Spec deltas D11–D21 recorded in impl-plans README.
- 2026-11-05: Ran discovery → tech spec v3 → P0 impl plans → test catalog with coverage audit → Mermaid diagrams. Wrote CLAUDE.md, memory.md, reasoning.md, prompts.md. No code yet.
