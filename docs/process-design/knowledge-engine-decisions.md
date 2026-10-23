# Knowledge engine — decisions so far (brainstorm in progress)

Status: **not the final spec.** Sections 1 and 2 of the design are approved. Still to design: snapshot format, reading-path job, questionnaire, live API. The written spec follows once all sections are approved.
Last updated: 2026-10-22.

## Goal
Match and order papers by **concepts and prerequisite relations**, not by semantic (embedding) similarity, so a student can build knowledge from foundations toward specialised topics. We build the engine that ingests papers and generates the graph.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | First job: **reading path for one paper** (what to know before reading it). Then shared knowledge base, then a **placement questionnaire** that finds the student's level and recommends papers | Smallest test of the idea; fits the extension's "Temas necesarios" |
| 2 | Delivery: **snapshots** (extension, ~$0 to serve) + **self-hostable backend** (institutions) + **rate-limited live API** | Local-first for students, reuse for institutions |
| 3 | **No external vocabulary** (no MeSH, DeCS, UMLS, Wikidata). OpenAlex is the only source of papers and metadata (metadata CC0) | Licence simplicity; the concept and prerequisite layer is ours |
| 4 | Concept identity = our own stable IDs. Each concept has es/en labels, a one-line definition, aliases. An **LLM judge** compares a mention with candidate concepts (same / broader / narrower / different / unsure); candidates come from string and metadata-profile matching, **not text embeddings**. Merges and splits are logged events; curators approve | Identity is a recorded decision with evidence |
| 5 | Ideas are **section-scoped and inferred**, not literal terms (introduction: presupposes/motivates; methods: uses/measures; results: finds; discussion: claims/limits/implies) | Relevant ideas are rarely stated literally |
| 6 | Verification **A+**: second LLM pass checks the passage supports the idea; promotion needs corroboration by a cross-reference; curators audit a sample; error rate published with each snapshot | Statistics cannot understand text; an LLM interprets, code and people check |
| 7 | Concept value = **information it brings**: self-information (specificity), topic information gain, subfield entropy (generality), fan-out (what it unlocks), corroboration count. Use self-information and conditional probabilities normalised against base rates, not the entropy of "is present" and not the difference of conditional entropies | Entropy of presence is not monotone in generality; the difference of conditional entropies reduces to the difference of marginals |
| 8 | Prerequisite edge proposed from ≥2 independent signals: introduction presupposes it; citation context says it is defined elsewhere; normalised conditional-probability asymmetry; defined in teaching papers but only used in applied papers. Curators approve every edge in the first release | Avoid LLM- or statistics-only edges |
| 9 | Ingestion LLM: one **OpenAI-compatible adapter** (`base_url`, `model`, `api_key`) pointing at a rented batch GPU / local server **or** OpenRouter `:free` models. Every output stores model ID, prompt hash, temperature. A model ingests into the graph only after passing the gold-set gate | No GPU yet; free-tier models change |
| 10 | First slice: **evidence-based medicine and study methods**; ~300 open-access papers (about one third teaching, two thirds applied) | Small finite concept set, formulaic methods sections, ties to the Criba methodology summary |
| 11 | Evaluation (approach 2): experts hand-write a **held-out reference graph** (~100–150 concepts, definitions, prerequisite edges) that never enters a prompt and only scores the induced graph | Gives a real accuracy measure without an external vocabulary |

## Pipeline (approved)
1. Select papers (OpenAlex filter) → 2. download full text (`openalex download`, TEI XML) → 3. split sections + citation contexts → 4. infer ideas per section (LLM) → 5. verify (LLM, different prompt) → 6. resolve identity (LLM judge) → 7. cross-reference ideas via citation contexts → 8. compute information statistics → 9. propose edges → 10. curator review and versioned snapshot release.

## Proposed success criteria for the seed (change if wrong)
≥70% recall of reference concepts · ≥60% of reference prerequisite edges recovered · merge-judge precision ≥90% on a curator-audited sample · reading path for 10 held-out applied papers rated useful by a student sample.

## Verified facts used (2026-10-08 … 2026-10-22)
- OpenAlex metadata is CC0; free key = $1/day budget; single-entity lookups are free; full-text cache of >50M open-access works (PDF) and ~43M GROBID TEI XML; PDFs keep their original copyright; a PDF download costs $10 per 1,000.
- OpenRouter free models (`:free`): 20 requests/min; 50 requests/day under 10 credits purchased, 1,000/day at ≥10 credits.

## Not yet verified (first spike)
- Whether OpenAlex TEI XML marks the sentence around each citation (stage 7 relies on it).
- How much of the EBM slice has open-access full text with a licence that allows quoting.
- Which `:free` models exist today, their context sizes and quality on the annotated set.
- Whether the QFB specialist and the physician can spend a few days on the reference graph (assumed yes).

## Spike (about a week, before building)
30 hand-annotated papers; candidate models scored (OpenRouter `:free` models plus one paid ceiling run); OpenAlex coverage count for the EBM slice.
