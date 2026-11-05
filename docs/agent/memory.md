# BioVidGen — Project memory

Last updated: 2026-11-05.

Update this file at the end of every working session, in the same PR as the work. Keep it short: state, numbers and facts belong here; explanations go in `reasoning.md` or the docs.

## Status
- **Phase:** P0 (spikes + walking skeleton), **not started**. No application code exists yet. `app/agent/` holds v1 notes only.
- **Docs pipeline: complete.**
  - Discovery: `docs/discovery/`
  - Tech spec v3 + ADR-0008/0009: `docs/process-design/`, `docs/adr/`
  - P0 implementation plans: `docs/impl-plans/`
  - Test catalog: `docs/testing/` (473 tests + 20 KPI tests, 24 stop-ship)
- **Discovery verdict:** Go with risks, with one amber flag: differentiation against free ChatGPT and free retraction extensions.
- **Git:** all docs after commit `2da8279` are **uncommitted** on `main`. Commit them on a branch before starting code.

## Next up — P0 order (from `docs/impl-plans/README.md`)
- [ ] **SVC0 scaffold:**
  - WXT + TS strict + Preact + Vitest + fast-check + MSW + Playwright;
  - ESLint with boundaries and no-unsanitized;
  - licence gate, gitleaks, and the network-allowlist e2e;
  - the `catalog` coverage script;
  - CI on GitHub Actions.
- [ ] Spikes S1–S7. Record results in the table below.
- [ ] OP5V Validate evidence (pure TS; build it first so the guarantee exists before any model).
- [ ] OP1 Detect → OP3 Resolve → OP12 Status (panel path) → OP4 Text (DOM only) → OP5 stub → OP13 Export.
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
| S2 | Extension → `localhost:11434` (Local Network Access); `OLLAMA_ORIGINS` | [pending] | | Ollama path |
| S3 | Exact OpenAlex/Crossref retraction, EoC and preprint queries; OpenAlex `pmid` filter; recall/precision on samples | [pending] | | OP12 |
| S4 | Side-panel call lifetime vs service-worker shutdown | [pending] | | orchestration |
| S5 | Live free-tier quotas and `json_schema` support: Gemini, Groq, OpenRouter | [pending] | | OP5, Gate 2 headroom |
| S6 | Citicious code + licence | [pending] | | ADR-0009 |
| S7 | Does browser-native AI already give one-click Spanish page summaries in Mexico? | [pending] | | differentiation flag |

## Verified facts
Format: fact (date, source).
- OpenAlex: single-entity lookup is free and unlimited. List/filter costs $0.10 per 1,000 calls; search costs $1 per 1,000. Budget is $0.10/day keyless and $1/day with a free key. Hard cap 100 req/s. (2026-10-08, help.openalex.org)
- OpenCitations: 180 req/min/IP. (2026-10-08)
- Gemini Nano in Chrome needs ≥22 GB free disk, plus either >4 GB VRAM or 16 GB RAM with 4 cores. Desktop Chrome only. (2026-10-08, 🔎 secondary source)
- PyMuPDF is AGPL → rejected. pypdfium2, pypdf and pdfminer.six are permissive. (2026-10-08, PyPI)
- Health-science enrolment in Mexico 2023-24: 1,291,096 (ANUIES, 🟡).
- Prefix `10.1101` is shared by bioRxiv/medRxiv and Cold Spring Harbor journals (e.g., Genome Research), so the preprint rule must use DOI patterns. (design finding)
- Chrome's built-in PDF viewer does not run content scripts. (design finding; confirm in e2e)
- PubMed result lists expose PMIDs, not DOIs. (design finding)

**Still `[verify]`:**
- Crossref `filter=updates:{doi}` / `updated-by`
- OpenAlex `pmid` filter
- Prompt API names and `responseConstraint`
- the Ollama version that added structured outputs
- per-provider `response_format: json_schema`
- licences of Dexie, zod-to-json-schema, eslint-plugin-boundaries, DOMPurify, mustache, Stryker
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
- Resolved 2026-11-05: the human track (OP11, interviews, instructor demos) **runs in parallel** with P0 code.

## Gotchas learned
Append as you find them, one line each, with the date.

## Session log
- 2026-11-05: Ran discovery → tech spec v3 → P0 impl plans → test catalog with coverage audit → Mermaid diagrams. Wrote CLAUDE.md, memory.md, reasoning.md, prompts.md. No code yet.
