# BioVidGen — instructions for Claude Code

BioVidGen is an open-source (MIT), local-first tool for health-science students in Mexico. On an article page it shows authors, keywords and preprint / retraction / expression-of-concern status. It also writes a **Spanish structured summary in which every claim links to a quote verified to exist verbatim in the paper**.

**Two surfaces, one local backend (ADR-0010, accepted 2026-11-05):**
- a **Chrome MV3 extension**, which becomes a thin client: it detects the paper, reads the page and renders the results;
- a **local web app**, served by the backend, that works without Chrome.

Both talk to **one Python backend** (`backend/`) on the user's machine, bound to `127.0.0.1` only. It holds the domain logic and storage.

There is no hosted server, no accounts and no telemetry, and it costs $0 per month to run. A separate dev-time Python tool (`eval/`) builds the expert gold set and evaluates prompts.

The TypeScript OP5V in `extension/src/summary/` is the reference implementation and test-vector source for the Python port.

@docs/agent/memory.md

## Sources of truth

Read the relevant source before changing behaviour.

| Need | File |
|---|---|
| Current state, next task, verified facts, open decisions | `docs/agent/memory.md` (imported above) |
| How to reason here; why each decision was made | `docs/agent/reasoning.md` |
| Reusable prompts (unit, spike, review, end of session) | `docs/agent/prompts.md` |
| Architecture, modules, interfaces, NFRs, phases | `docs/process-design/tech-spec-v3.md`, `system-spec-v3.yaml` |
| How each unit is built (test-first plans) | `docs/impl-plans/` (its README holds spec deltas D1–D34) |
| Every test that must pass | `docs/testing/test-catalog.md` |
| Entities, operations, metrics, hypotheses | `docs/discovery/discovery-process-map.md`, `docs/discovery/spec.yaml` |
| Decisions | `docs/adr/` (0001 and 0002 superseded, 0005 withdrawn, 0010 amends 0006; 0011 page access for OP1) |
| Dependency licences, prices, limits | `docs/process-design/dependency-register.md` |

When documents conflict, this is the precedence order. Report the conflict; do not pick silently.
1. Latest ADR
2. Impl-plan spec deltas
3. tech-spec-v3
4. Discovery map
5. tech-spec v2 and v1

## Repo layout (SVC0 created the extension skeleton)

```
extension/              WXT + TypeScript + Preact, Chrome MV3
  src/core/             SVC0  db, http (retry/limiter), log, runId, flags, messaging, i18n
  src/contracts/        Zod schemas (single source; JSON Schema exported for eval/)
  src/detect/           SVC1  OP1, badges, sites.json
  src/scholarly/        SVC2  OP3, OP12, clients/, preprint-patterns.json
  src/text/             SVC3  OP4, headings.json
  src/summary/          SVC4  OP5 providers/, prompts/, OP5V validate.ts + normaliser.ts
  src/workspace/        SVC5  OP13 templates/, OP14
  src/settings/         SVC6
  entrypoints/          content.ts, sidepanel/, options/, background.ts
  public/_locales/es, public/_locales/en   (WXT copies public/ as-is; delta D19)
  eslint-rules/         in-repo boundary rule (delta D13)
  scripts/              licences, catalog coverage, JSON Schema export
  tests/e2e/, fixtures/pages/, fixtures/api/
backend/                BE0   Python 3.12 + uv + FastAPI + SQLite, 127.0.0.1 only (ADR-0010)
  src/biovidgen/        config, security (token, Origin/Host, CORS, body limit), db, log, app
  src/biovidgen/summary/  OP5V: contracts, normaliser, evidence, validate (ADR-0010 step 2)
  scripts/              licence_gate.py (rule 8), mutation_run.py (OP5V-MUT-01)
  tests/                pytest; each test's docstring starts with its catalog ID (BE0-*)
eval/                   SVC7  Python 3.12 + uv: gold set, kappa, eval runner (dev-time only)
docs/runbooks/          one section per unit (Definition of Done)
```

`app/agent/main.py` and `app/agent/core/content-extraction/ocr.py` are notes from the v1 server design (the owner's working tree renames them to `app/backend/`, uncommitted). Do not build on them; the new backend is `backend/`. Do not delete them without owner approval.

## Commands

Run from `extension/` (created by the SVC0 scaffold, 2026-11-05). Keep this table accurate when they change.

| Task | Command |
|---|---|
| Install | `cd extension && npm ci` (runs `wxt prepare`), then once `npx playwright install chromium` |
| Dev (Chromium with the extension, hot reload) | `npm run dev` (wxt) |
| Build / zip | `npm run build` (→ `.output/chrome-mv3`) · `npm run zip` |
| Unit + property + integration | `npm test` (vitest run) |
| One test by catalog ID | `npx vitest run -t "OP5V-PROP-03"` |
| E2E (bundled Chromium, unpacked extension, headless) | `npm run test:e2e` (builds first; Playwright persistent context) |
| Lint (module boundaries, single-writer stores, HTML sinks, storage.sync, network globals) | `npm run lint` |
| Types | `npm run typecheck` |
| Licence gate | `npm run licenses` (reads `package-lock.json`) |
| Secret scan | `npm run secrets` (needs gitleaks 8.30.1 on PATH; CI installs it) |
| Catalog coverage for a unit | `npm run catalog -- OP5V` (any ID prefix: `SVC0`, `SYS-SEC`). Lists catalog IDs that have no test with that ID in its name; `--strict` exits 1 |
| Export contracts as JSON Schema for eval/ | `npm run schemas` (→ `eval/schemas/`) |
| Regenerate the vectors the Python OP5V runs against | `npm run vectors` (→ `fixtures/op5v/vectors/`; needed when OP5V-PY-03 fails) |
| Eval tool | `cd eval && uv sync && uv run pytest` (not created yet: SVC7) |
| Backend: install / test | `cd backend && uv sync --locked` · `uv run pytest` · one test: `uv run pytest -k be0_sec_04` |
| Backend: lint / format / licences | `uv run ruff check .` · `uv run ruff format --check .` · `uv run python scripts/licence_gate.py` |
| Backend: mutation run (minutes; on temporary copies) | `uv run python scripts/mutation_run.py` |
| Backend: run locally | `uv run biovidgen` (env: `BIOVIDGEN_DATA_DIR`, `BIOVIDGEN_PORT` default 8765, `BIOVIDGEN_EXTENSION_IDS` comma-separated). The pairing token is in `<data dir>/token` |

## Non-negotiable rules

Each rule is guarded by stop-ship tests in the catalog.

1. **Privacy.** Network calls go only to the allowlist: OpenAlex, Crossref, Europe PMC, Unpaywall (if enabled), the user's chosen LLM host, and `localhost:11434`.
   - Scholarly APIs receive identifiers only (DOI, PMID, PMCID).
   - The LLM receives one section of text per call.
   - No telemetry, analytics or remote logging. (SYS-SEC-01…06)
   - The backend binds to `127.0.0.1` only and follows the same allowlist. Every request passes the Host check, the Origin allowlist and the pairing token (BE0-SEC-01…04). The extension's call to the backend joins the allowlist with the extension-client step (ADR-0010 step 3).
2. **Secrets.** API keys live only in `chrome.storage.local`. They never appear in `storage.sync`, logs, exports, diagnostics, prompts, fixtures or commits. (SYS-SEC-10…15)
   - The backend pairing token (`<data dir>/token`) is a secret under the same rules.
   - ADR-0010 moves API keys to the backend (OS keychain via keyring). Update this rule in that step.
3. **Rendering.** Strings from pages, APIs or models are rendered with `textContent`, never with `innerHTML`. (SYS-SEC-20)
4. **One writer per store.** Only the owning module writes its store.
   - `Summary` is written only by `summary/validate.ts` (OP5V), and in the backend only by `summary/validate.py`.
   - Boundary lint enforces this. (SYS-SEC-26, OP5V-SEC-01)
5. **Verified means verbatim.** Never add fuzzy matching to OP5V. Any change to the normaliser needs a `NORMALISER_VERSION` bump. (OP5V-PROP-01…03, OP5V-CFG-01)
6. **Retraction wording.** Never write "no retractado" or "not retracted". Write "no se encontró retractación en {fuentes} al {fecha}". (OP12-PROP-01)
7. **LLM boundary.**
   - Call the model without tools.
   - Treat page text as data, wrapped in nonce delimiters.
   - Constrain output to a schema.
   - Output is untrusted until OP5V validates it. (OP5-SEC-*)
8. **Licences.**
   - Runtime dependencies must be MIT, BSD, Apache-2.0, ISC or PSF-2.0 (PSF-2.0 added by the owner on 2026-11-05 for typing-extensions). MPL is allowed for dev-only tools.
   - Backend outbound HTTP uses the standard library (`urllib.request`, OS certificate store). Never httpx, requests or certifi at runtime (BE0-SEC-10).
   - No AGPL or GPL anywhere: no PyMuPDF, no Ghostscript.
   - Add a dated entry to the dependency register before adding any dependency. (SYS-SEC-30)
9. **$0.** No paid services. No API key ships in the repo.
10. **No verdicts.** The tool never rates a paper as good or bad. Prerequisite topics are labelled "background knowledge, not from the paper".

## How to work on a unit

1. Read `memory.md` and take the next unit in P0 order. Read its plan in `docs/impl-plans/` and its rows in `docs/testing/test-catalog.md`.
2. Create a branch `feat/<unit-id>-<slug>` from `main`. Never commit to `main` directly.
3. **Tests first.**
   - Write tests for the unit's catalog IDs, putting the ID in the test name: `it("OP5V-PROP-03 rejects near-quotes", …)`.
   - Run them and confirm they fail.
   - PR tests never touch the live network. Use recorded fixtures (MSW for unit/integration tests, Playwright `route` for e2e).
4. Implement until the tests are green, following the plan's §8 logic.
   - If the plan cannot satisfy a test, do not weaken the test. Add a row to the spec-delta table in `docs/impl-plans/README.md` and tell the user.
5. Run lint, typecheck, unit tests, e2e for the touched area, the licence gate, and `npm run catalog -- <UNIT>`.
6. Meet the Definition of Done:
   - contract tests and rule fixtures exist;
   - log entries carry `runId`;
   - boundaries are green;
   - strings are in `_locales`;
   - views have an a11y check;
   - `docs/runbooks/<unit>.md` exists;
   - the acceptance metric is recorded in `memory.md`.
7. Update `docs/agent/memory.md` in the same PR: status, numbers learned, new gotchas.
8. Use Conventional Commits. Keep PRs to one unit or one sub-task.

## Stop and ask before

- Any Type 1 change:
  - a new permission or host;
  - a new runtime dependency;
  - a breaking schema change;
  - changing the default provider;
  - anything touching rules 1–10;
  - adding a paid service;
  - deleting legacy files.

  Draft an ADR in `docs/adr/NNNN-*.md` and ask first.
- Any item marked `[decide]` (test catalog §4, plans, memory open decisions).
- A spike result that misses a plan's hypothesis threshold. Report the numbers and propose the plan's adapt rule.
- An external fact marked `[verify]`. Verify it against live docs or the API first, then record it with its date in the dependency register. Never guess API behaviour.

## Conventions

- **TypeScript:** strict; ESM; named exports; kebab-case files.
- **Code:** errors are `Result<T, Code>` with documented codes; Zod at every boundary (messages, upstream APIs, LLM output, storage).
- **Tests:** unit tests as `*.test.ts` beside the source; e2e in `extension/tests/e2e/`; fixtures in `extension/fixtures/`.
- **Language:** code, comments and commits in English. UI strings in es-MX, with English secondary. Evidence quotes stay in the paper's language.
- **Fixtures:** store only open-access pages, or strip pages to minimal structural HTML. Never commit non-redistributable full text. Public gold-set texts must be CC-BY or compatible.
- **Python (`eval/`):** 3.12, uv, ruff, pytest, hypothesis. API keys come from environment variables only.
- **Diagrams:** Mermaid, in the docs they explain.
