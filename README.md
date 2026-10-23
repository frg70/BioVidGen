# BioVidGen

Open-source tools that help health-science students in Mexico read and evaluate English-language scientific literature faster and more critically, and that organise papers by the **concepts they build on**, not by text similarity.

> **Status: design phase.** Nothing is built yet. `app/` holds a stub only. Everything below describes the plan, and the decisions behind it live in [docs/](docs/).

## Why

Reading and judging English papers costs students a disproportionate amount of time, and weak, preprint or retracted papers are hard to tell apart from sound ones. BioVidGen reduces that cost without hiding the evidence: it never gives a bare verdict, it shows the sentence it relied on.

## What we are building

1. **Chrome extension (runs locally, free).**
   On an article page or a search-results page it shows:
   - authors, keywords, preprint and retraction status (with source and check date; "no retraction found in X on <date>", never "not retracted");
   - a Spanish summary in sections (topics needed to understand, main topic, methodology, results, conclusions), each claim linked to supporting text;
   - a **reading path**: the concepts you need first, in order, from the knowledge graph.
2. **Knowledge engine.**
   Our own engine builds a graph of concepts and typed relations (prerequisite-of, is-a, part-of, measured-by, contradicts) from papers. Ideas are inferred per paper section, concept identity is decided by an LLM judge plus curators, and a concept's value is measured by the information it brings. No external vocabulary is used. OpenAlex is the only source of papers and metadata.
3. **Delivery in three channels.**
   - *Snapshots:* versioned graph files the extension downloads and queries locally (about $0 to serve).
   - *Self-hosted backend:* the same stack for institutions that want to run their own graph and curators.
   - *Live API:* a public, strictly rate-limited instance.
4. **Later:** a short placement questionnaire that estimates which concepts a student already knows and recommends papers at their level.

First seed topic: **evidence-based medicine and study methods** (about 300 open-access papers).

## Principles

- **Free first.** $0 recurring cost for the extension. Free data sources, on-device or free-tier models, no keys shipped in the repo.
- **Local first and private.** No telemetry, no accounts. Only DOIs/titles and the chosen LLM's input leave the machine.
- **Evidence over verdicts.** Every shown claim points to a passage. Unverified output is labelled.
- **Humans decide the structure.** LLMs and statistics propose; curators approve identity merges and prerequisite edges.
- **Permissive licences only.** The project is MIT with commercial reuse, so no AGPL/GPL dependencies.

## Repository layout

| Path | Contents |
|---|---|
| [`docs/process-design/`](docs/process-design/) | process map, technical specs, dependency register, knowledge-engine decisions |
| [`docs/adr/`](docs/adr/) | architecture decision records |
| [`.claude/skills/`](.claude/skills/) | project skills (process-mapper, process-tech-spec, process-impl-plans) used to produce the design documents |
| `app/` | code stub (nothing implemented) |

## Documentation index

| Document | What it is |
|---|---|
| [process-map.md](docs/process-design/process-map.md) | entities, operations, risks and access rules for the whole process (stage 1). It still includes the study/EUBE trial, which is now out of scope for the software. |
| [tech-spec.md](docs/process-design/tech-spec.md) | first technical spec (hosted architecture). Superseded in part by v2. |
| [tech-spec-v2-local-extension.md](docs/process-design/tech-spec-v2-local-extension.md) | current spec: local-first Chrome extension, operations, stack, phases |
| [dependency-register.md](docs/process-design/dependency-register.md) | prices, limits, licences and versions checked on 2026-10-08, with what is unverified |
| [knowledge-engine-decisions.md](docs/process-design/knowledge-engine-decisions.md) | decisions so far for the concept/knowledge-graph engine (brainstorm in progress) |
| [ADR index](docs/adr/) | 0001, 0002 superseded; 0003 amended; 0004 licence policy; 0005 withdrawn; 0006 local-first extension; 0007 free-first LLM strategy |

## Roadmap (proposed, not committed)

1. **Spikes (about a week):** Gemini Nano context and Spanish quality; extension calling localhost/Ollama; exact retraction and preprint queries; free-tier LLM quotas; TEI citation contexts; EBM open-access coverage; 30 annotated papers to score candidate models.
2. **Flags MVP:** paper detection, preprint and retraction badges, result-list annotator.
3. **Text and summaries:** section extraction, Spanish structured summary with evidence, gold-set evaluation.
4. **Knowledge engine seed:** EBM slice, expert reference graph, first curated snapshot, reading path in the extension.
5. **Later:** questionnaire, live API, citation map, other topic slices.

Estimates and exit criteria are in the specs and are low-confidence until the first spike.

## Contributing

Open an issue or a pull request. For design changes, add or amend an ADR in `docs/adr/`. Code is not accepted until a dependency's licence is checked against the register.

## Licence

MIT, see [LICENSE](LICENSE). Data produced by the engine will get its own data licence, decided before the first public snapshot.
