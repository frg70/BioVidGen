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
