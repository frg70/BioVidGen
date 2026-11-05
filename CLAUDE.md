# BioVidGen — instructions for Claude Code

BioVidGen is an open-source (MIT), local-first **Chrome MV3 extension** for health-science students in Mexico. On an article page it shows authors, keywords and preprint / retraction / expression-of-concern status. It also writes a **Spanish structured summary in which every claim links to a quote verified to exist verbatim in the paper**.

The extension has no backend, no accounts and no telemetry, and costs $0 per month to run. A separate dev-time Python tool (`eval/`) builds the expert gold set and evaluates prompts.

@docs/agent/memory.md

## Sources of truth

Read the relevant source before changing behaviour.

| Need | File |
|---|---|
| Current state, next task, verified facts, open decisions | `docs/agent/memory.md` (imported above) |
| How to reason here; why each decision was made | `docs/agent/reasoning.md` |
| Reusable prompts (unit, spike, review, end of session) | `docs/agent/prompts.md` |
| Architecture, modules, interfaces, NFRs, phases | `docs/process-design/tech-spec-v3.md`, `system-spec-v3.yaml` |
| How each unit is built (test-first plans) | `docs/impl-plans/` (its README holds spec deltas D1–D10) |
| Every test that must pass | `docs/testing/test-catalog.md` |
| Entities, operations, metrics, hypotheses | `docs/discovery/discovery-process-map.md`, `docs/discovery/spec.yaml` |
| Decisions | `docs/adr/` (0001 and 0002 superseded, 0005 withdrawn) |
| Dependency licences, prices, limits | `docs/process-design/dependency-register.md` |

When documents conflict, this is the precedence order. Report the conflict; do not pick silently.
1. Latest ADR
2. Impl-plan spec deltas
3. tech-spec-v3
4. Discovery map
5. tech-spec v2 and v1

## Target repo layout (P0 creates it)

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
  _locales/es, _locales/en
  tests/e2e/, fixtures/pages/, fixtures/api/
eval/                   SVC7  Python 3.12 + uv: gold set, kappa, eval runner (dev-time only)
docs/runbooks/          one section per unit (Definition of Done)
```

`app/agent/main.py` and `app/agent/core/content-extraction/ocr.py` are notes from the v1 server design. Do not build on them. Do not delete them without owner approval.

## Commands

These don't exist yet; the SVC0 scaffold task creates them. Keep this table accurate when they change.

| Task | Command |
|---|---|
| Install | `cd extension && npm ci` |
| Dev (load unpacked, hot reload) | `npm run dev` (wxt) |
| Build / zip | `npm run build` · `npm run zip` |
| Unit + property + integration | `npm test` (vitest run) |
| One test by catalog ID | `npx vitest run -t "OP5V-PROP-03"` |
| E2E (real Chrome, unpacked extension) | `npm run test:e2e` (Playwright persistent context) |
| Lint (incl. module boundaries, no-unsanitized) | `npm run lint` |
| Types | `npm run typecheck` |
| Licence gate | `npm run licenses` |
| Catalog coverage for a unit | `npm run catalog -- OP5V`. It lists catalog IDs that have no test with that ID in its name. |
| Eval tool | `cd eval && uv sync && uv run pytest` |

## Non-negotiable rules

Each rule is guarded by stop-ship tests in the catalog.

1. **Privacy.** Network calls go only to the allowlist: OpenAlex, Crossref, Europe PMC, Unpaywall (if enabled), the user's chosen LLM host, and `localhost:11434`.
   - Scholarly APIs receive identifiers only (DOI, PMID, PMCID).
   - The LLM receives one section of text per call.
   - No telemetry, analytics or remote logging. (SYS-SEC-01…06)
2. **Secrets.** API keys live only in `chrome.storage.local`. They never appear in `storage.sync`, logs, exports, diagnostics, prompts, fixtures or commits. (SYS-SEC-10…15)
3. **Rendering.** Strings from pages, APIs or models are rendered with `textContent`, never with `innerHTML`. (SYS-SEC-20)
4. **One writer per store.** Only the owning module writes its store.
   - `Summary` is written only by `summary/validate.ts` (OP5V).
   - Boundary lint enforces this. (SYS-SEC-26, OP5V-SEC-01)
5. **Verified means verbatim.** Never add fuzzy matching to OP5V. Any change to the normaliser needs a `NORMALISER_VERSION` bump. (OP5V-PROP-01…03, OP5V-CFG-01)
6. **Retraction wording.** Never write "no retractado" or "not retracted". Write "no se encontró retractación en {fuentes} al {fecha}". (OP12-PROP-01)
7. **LLM boundary.**
   - Call the model without tools.
   - Treat page text as data, wrapped in nonce delimiters.
   - Constrain output to a schema.
   - Output is untrusted until OP5V validates it. (OP5-SEC-*)
8. **Licences.**
   - Runtime dependencies must be MIT, BSD, Apache-2.0 or ISC. MPL is allowed for dev-only tools.
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
