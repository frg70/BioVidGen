# BioVidGen — Process Map

Source: research protocol artifact (claude.ai/artifact/ChMWi4yjj8Qtq5W3xVJ7WN, Oct 2026 – Nov 2027) plus the user-flow stub in `app/agent/main.py` (request ID → async queue → topic classifier → OpenAlex call). `ocr.py` is empty. The code is a stub, so everything below is **design**, not as-built.

Conventions: `[specify: …]` = unknown, must be supplied. `ASSUMPTION:` = my inference. `[pending]` = nothing measured yet.

---

## 0. Framing & gate

### Problems solved
| # | Who | What happens | Measurable symptom |
|---|---|---|---|
| P1 | Health-science students, Mexico | Reading/evaluating English-language papers takes disproportionate time | Minutes per article (H2); artifact cites +90.8% reading time for low-English readers (Amano 2023) |
| P2 | Same | Time pressure feeds emotional exhaustion | EUBE score (Barraza 2011, 15 items); artifact cites 55.4% of students with exhaustion |
| P3 | Same | Students cannot cheaply tell weak, retracted or preprint papers from sound ones | Critical-appraisal accuracy (H3); >10,000 retractions in 2023 |
| P4 | Research team | Need causal evidence the tools reduce exhaustion, not just usage | H1: EUBE difference A vs B at 6 and 12 months |

### Abstractions (tool-independent)
- **Entities**: Request, Article, ScreeningReport, CitationGraph, Participant, Allocation, Assessment, ClubSession.
- **Operations**: resolve a paper, extract its evidence structure, show it with provenance, relate it to other papers, discuss it with humans, allocate and measure participants, estimate the effect.

### Process map (SIPOC)
- **Suppliers**: student, OpenAlex / Crossref / OpenCitations, publishers (OA PDFs), institutions, ethics committee.
- **Customers**: student (reader), moderator, research team, receiving organization (takes over H1 analysis Dec 2027).

| ID | Operation | Input → Output | Class |
|---|---|---|---|
| OP1 | Intake & queue | question / topic / paper (DOI, PDF, URL) → Request with unique ID | DETERMINISTIC |
| OP2 | Classify intent & topic | Request text → intent + knowledge area | NLP |
| OP3 | Resolve & enrich metadata | Request/DOI → Article (ids, retraction, preprint, OA status) | DETERMINISTIC |
| OP4 | Acquire text | Article → full text (OA PDF → OCR if scanned) | NLP (OCR) |
| OP5 | Criba screening | full text → ScreeningReport (structured, with supporting sentence) | LLM + deterministic validator |
| OP6 | Spanish abstract | Article abstract/text → Spanish abstract | LLM |
| OP7 | Mapa graph | Article + citations → CitationGraph nodes with quality flags | DETERMINISTIC |
| OP8 | Club session | ScreeningReport + sheet → appraisal sheet + discussion | HUMAN |
| OP9 | Allocate & measure | Participant → Allocation, Assessments (EUBE, time, appraisal accuracy) | DETERMINISTIC (+ HUMAN participant) |
| OP10 | Estimate effect | Assessments + Allocation → ITT ANCOVA result | DETERMINISTIC |

OP1–OP7 are the **product** pipeline; OP8 is the human intervention; OP9–OP10 are the **trial**. They share the Article/ScreeningReport entities only through usage logs, so the trial can run even if the product pipeline changes.

### As-is baseline
| Metric | Value |
|---|---|
| Reading time per article | `[specify: measured in Wave 1 baseline]` |
| EUBE baseline | `[specify: measured at baseline; population norm not given]` |
| Cost per article screened | `[specify]` |
| Defect rate (wrong extraction vs expert) | `[specify]`; gate is ≥80% agreement (artifact) |
| Bottleneck | ASSUMPTION: reading + English comprehension for students; expert annotation for the team (gold set) |

### Worth-it gate (impact × effort)
| Rank | Operation | Impact | Effort | Verdict |
|---|---|---|---|---|
| 1 | OP5 Criba | Directly cuts reading time (H2); core of the hypothesis | High (LLM + gold set + validator) | Engineer first |
| 2 | OP3 Metadata | Cheap, high-trust signals (retraction, preprint, OA) that need no LLM | Low | Engineer first |
| 3 | OP9/OP10 Trial | Without it nothing is proven; ethics-critical | Medium | Engineer before scale-up |
| 4 | OP6 Spanish abstract | Removes language barrier | Low–Med | Engineer, ship with OP5 |
| 5 | OP4 Acquire text | Needed when only PDF is given | Med (OCR) | Defer: start with abstract + OA text only |
| 6 | OP7 Mapa | Phase 3 in the protocol; exploratory value | Med | After Criba gate passes |
| 7 | OP2 Topic classifier | Routing only; one fixed prompt may suffice early | Low | Leave minimal: ASSUMPTION it can start as a rule/keyword table |
| 8 | OP8 Club | Human, no software dependency | Low software | Run as-is; tooling = sheet only |

---

## Ontology

### Entity: Request
Key: `request_id` (surrogate UUID). Dedup: same `(participant_id, normalized_input)` within [specify] minutes returns the existing request.
Storage: relational (queue state + audit).
Invariant: `status ∈ {queued, running, done, failed}`; `done` ⇒ ScreeningReport exists or a failure reason is stored.
Interface: create (OP1), set_intent (OP2), attach_article (OP3), set_status (pipeline), read.

| Property | Type | Unit | Source | Certainty | Visibility |
|---|---|---|---|---|---|
| request_id | uuid | — | generated | Derived | public |
| participant_id | code | — | session | Measured | protected (never shown with identity) |
| raw_input | text | — | user | Measured | internal (OP1, OP2; untrusted) |
| input_type | enum {question, topic, doi, pdf, url} | — | OP1 | Derived | public |
| intent / knowledge_area | enum | — | OP2 | Inferred (conf. [specify]) | public |
| status | enum | — | pipeline | Derived | public |
| created_at, finished_at | timestamp UTC | — | system | Measured | public |

### Entity: Article
Key: DOI when present (natural), else OpenAlex ID, else content hash (surrogate). Dedup: DOI normalized lowercase; preprint↔published linked, not merged.
Storage: relational + object store for PDFs.
Invariants: `is_retracted` comes only from a retraction source (Crossref / Retraction Watch data, [specify: source]); `is_preprint` and `is_published_version` not both true for the same record.

| Property | Type | Unit | Source | Certainty | Visibility |
|---|---|---|---|---|---|
| doi, openalex_id | string | — | OpenAlex/Crossref | Measured | public |
| title, abstract, authors, journal, year | text | — | OpenAlex/Crossref | Measured | public |
| is_retracted | bool | — | retraction source | Measured (source-limited) | public |
| is_preprint | bool | — | OpenAlex/Crossref type | Derived | public |
| oa_status | enum | — | OpenAlex | Measured | public |
| full_text | text | chars | OP4 | Measured (OA) / Inferred (OCR, char error rate [specify]) | internal (copyright; OP4, OP5, OP6) |
| language | iso-639 | — | OP4 | Inferred | public |

### Entity: ScreeningReport
Key: `(article_id, pipeline_version)` surrogate. Storage: document (JSON per version).
Invariants: every populated checklist field has `evidence_span` (a sentence quoted verbatim from `full_text`) or is explicitly `not_reported`; **no report contains a bare verdict** (artifact requirement).
Interface: create (OP5), annotate_correction (student/moderator), read.

| Property | Type | Unit | Certainty | Visibility |
|---|---|---|---|---|
| study_design | enum | — | Inferred | public |
| sample_size | int | participants | Inferred → Derived if regex-verified in span | public |
| statistics_reported | list | — | Inferred | public |
| conflicts_of_interest | text | — | Inferred | public |
| evidence_span[field] | text + char offsets | — | Derived (substring check) | public |
| spanish_abstract | text | — | Inferred (translation) | public |
| model_version, prompt_version | string | — | Measured | internal |
| validator_result | struct | — | Derived | internal |

### Entity: CitationGraph (node/edge)
Node key: `article_id`; edge: `(citing, cited, source)`. Storage: graph (ASSUMPTION: relational adjacency list is enough for the pilot, graph DB only if traversal depth/latency requires it). Node quality flags are copied from Article and ScreeningReport, never recomputed in the graph.

### Entity: Participant / Allocation / Assessment
- **Participant**: anonymized code (surrogate); stratifiers `career_year`, `sex`; `institution`; `consent_at`. Contact identity stored separately from the code (protected).
- **Allocation**: `(participant_code, arm A|B, wave, block_id, stratum, assigned_at, seed_ref)`. Invariant: immutable after assignment; arm B `access_from = assigned_at + 6 months`.
- **Assessment**: `(participant_code, instrument, timepoint {baseline, 6m, 12m}, value, collected_at)`; instruments: EUBE (15 items, 0–100%), minutes-per-article, appraisal accuracy %. Invariant: EUBE band "Severe" (75–100%) ⇒ referral protocol event is raised.
- **ClubSession**: `(session_id, date, moderator, article_id, attendance, appraisal_sheet_id)`.

### Relationships
| A | Relation | B | Card. | Optional | Ownership |
|---|---|---|---|---|---|
| Request | resolves to | Article | N:1 | yes (question/topic requests resolve to many via OP3 search) | reference |
| Article | has | ScreeningReport | 1:N (versions) | yes | composition |
| Article | cites / cited-by | Article | N:M | yes | reference (edge) |
| Participant | makes | Request | 1:N | no | reference |
| Participant | has | Allocation | 1:1 | no | composition |
| Participant | has | Assessment | 1:N | no | composition |
| ClubSession | discusses | Article | N:1 | no | reference |
| Participant | attends | ClubSession | N:M | yes | reference |

### CRUD per key property
| Property | Create | Read | Update | Delete |
|---|---|---|---|---|
| Request.raw_input | OP1 | OP2 only (internal) | never | hard delete after retention [specify] |
| Article.* | OP3 | all pipeline, students | refresh on re-resolve (versioned, retraction changes logged) | never (soft) |
| Article.full_text | OP4 | OP5, OP6 | replace if better source | hard delete on license/takedown |
| ScreeningReport | OP5 | student, moderator, research team | new version only; corrections as separate records | soft |
| Allocation | OP9 | research team (analysts blinded to nothing but need arm), system | **never** | never |
| Assessment | OP9 | analyst (coded) | correction with audit trail | hard delete on consent withdrawal |

Field-name traps: `year` may be the preprint year, not the publication year; `Article.abstract` from OpenAlex is an inverted index that is reassembled, so treat it as Derived.

---

## Top-level cycle

### 1. Problem definition
- **Gap**: reading time and exhaustion today `[specify]` → lower reading time (H2) and lower EUBE at 6/12 months (H1).
- **Target variable**: primary = `ΔEUBE = EUBE_t − EUBE_baseline`, ITT, by arm. Product proxy = `minutes_per_article`.
- **Objective**: *minimize* reading time and EUBE *subject to* appraisal accuracy not decreasing (H3) and screening agreement with experts ≥80%.
- **Variables**
| Variable | Role | Type | Unit | Range | Source |
|---|---|---|---|---|---|
| arm | control | A/B | — | 2 | OP9 |
| career_year, sex | control (strata) | cat. | — | — | enrollment |
| EUBE baseline | input | num. | % | 0–100 | instrument |
| minutes_per_article | output | num. | min | ≥0 | logged/self-report `[specify]` |
| appraisal_accuracy | output | num. | % | 0–100 | rubric vs expert |
| EUBE at 6/12 m | output | num. | % | 0–100 | instrument |
| criba_agreement | state | num. | % | 0–100 | gold set |
- **KPIs** (artifact): active users ≥60% of a wave; ≥2,000 generated records; ≥50% club retention; contamination <15% of arm B using tool early.
- **Engineering metrics**: field agreement `= matched fields / expert fields` (target ≥80% as gate); evidence-span validity `= spans found verbatim / spans cited` (target 100%); p95 latency s `[specify]`; cost per report USD `[specify]`.

### 2. Raw data collection
| Dataset | Row = | Volume | Frequency |
|---|---|---|---|
| Requests/usage log | one request | ≥2,000 records (KPI) | event |
| Scholarly metadata | one article | per request | on demand + refresh |
| Gold set | one article annotated by experts | `[specify]` | one-off per domain |
| Assessments | participant × timepoint | up to 1,000 participants across waves | baseline, 6 m, 12 m |
| Club attendance & sheets | session × participant | biweekly | biweekly |

- **Instruments & error**: OpenAlex/Crossref (coverage gaps; measure missing-DOI %); retraction source (lag; measure on known-retracted sample); OCR (char error rate, measure on 50 scans); EUBE (self-report, α=.86 in Barraza); time-per-article (self-report vs logged: log is preferred, ASSUMPTION).
- **Governance**
  - Personal and **health-adjacent** data (burnout scores) of students: sensitive. Regulation: LFPDPPP (Mexico); `[specify: ethics committee + institution policy]`. Informed consent, anonymized codes, referral protocol for "Severe" EUBE.
  - **Third-party LLM**: article text is public/OA, so allowed in principle; **participant data and EUBE never go to the LLM**. Confirm provider terms and copyright for non-OA PDFs `[specify]`.
  - Open-source MIT with commercial reuse: the repo must contain no participant data or secrets.

### 3. Raw data → Information
Read/write map (basis of access control):
| Op | Reads | Writes |
|---|---|---|
| OP1 | — | Request.{id, raw_input, input_type, created_at} |
| OP2 | Request.raw_input | Request.{intent, knowledge_area} |
| OP3 | Request.{raw_input, intent} | Article.{ids, meta, is_retracted, is_preprint, oa_status}, Request.article link |
| OP4 | Article.{doi, oa_status} | Article.{full_text, language} |
| OP5 | Article.{full_text, meta} | ScreeningReport.{fields, evidence_span, validator_result} |
| OP6 | Article.{abstract, full_text} | ScreeningReport.spanish_abstract |
| OP7 | Article.*, ScreeningReport.flags, external citations | CitationGraph |
| OP8 | ScreeningReport, Article | ClubSession, appraisal sheet |
| OP9 | Participant | Allocation, Assessment |
| OP10 | Allocation, Assessment | AnalysisResult |

Ingestion checks: DOI regex, schema, uniqueness, `year ≤ current year`, language detected, PDF has extractable text (else OP4 OCR).

### 4. Train / adjust
- **Baseline first**: (a) student reading unaided; (b) trivial extractor: regex for "n =", "randomized", "double-blind" over the abstract. The LLM must beat (b) on agreement at an acceptable cost.
- **Method choice from objective**: OP3/OP7/OP9/OP10 are fully specifiable → deterministic. OP5 needs free-text understanding with few labels → LLM, constrained by a verbatim-evidence validator. OP2 can begin as a rule table (cheapest) and graduate to a small classifier when logged requests exist.
- **Tunable**: prompt, field schema, few-shot examples, chunking, model version, validator rules, stratified block size.
- **Data needed**: gold set annotated by the QFB and physician; EUBE normative data for the population `[specify]`.

### 5. Evaluation
- OP5: field agreement vs expert on the gold set `[pending]`; gate ≥80% (artifact) before Phase 2 continues. Report per field, not only overall. Evidence-span validity 100% (hard).
- OP9: allocation balance across strata and reproducibility from the seed.
- OP10: pre-registered ITT ANCOVA (EUBE ~ arm + baseline + year + sex); power: d=0.5, 63/arm, ≈79/arm with 20% attrition. **Wave 1 and 2 are pilot, not confirmatory.** Confirmatory = Wave 3. No results exist yet: `[pending]`.
- End-to-end: product works only if OP5 agreement AND user time saving AND no loss of appraisal accuracy (H3) hold together.

### 6. Action / Deploy
- Student-facing action: a Criba card (checklist + supporting sentence per field) and flags. **Never a bare verdict.**
- Mode: OP1–OP7 event-driven async queue (stub already describes this); OP9 batch by wave; OP10 batch.
- Rollout: shadow (reports shown to the team only) → Wave 1 pilot → Wave 2 → Wave 3 confirmatory → Wave 4 scale (700, no control). Rollback trigger: agreement <80% on rolling audit, or any report with an unverifiable evidence span reaching a student.
- **Label capture**: every student/moderator "this is wrong" click becomes `(article, field, model value, corrected value, who, when)`, feeding the gold set and the migration decision in OP5.

### 7. Monitor / telemetry
| Metric | Signal | Freq. | Instrument | Alert threshold | Owner |
|---|---|---|---|---|---|
| Field agreement (audited sample) | Quality | weekly | expert audit `[specify n]` | <80% | `[specify: QFB lead]` |
| Evidence-span validity | Quality | per report | validator | any <100% shown | `[specify: dev lead]` |
| Validator reject rate | Drift | daily | logs | +X pp vs baseline `[specify]` | dev lead |
| p95 latency, failures, retries | Ops | continuous | logs/metrics | `[specify]` | dev lead |
| Cost per report | Cost | daily | token/billing logs | > `[specify]` | dev lead |
| Active users % of wave | KPI | weekly | usage log | <60% | coordinator |
| Arm B early use (contamination) | Study | weekly | access log | >15% | coordinator |
| Club retention | KPI | biweekly | attendance | <50% | coordinator / moderator |
| Severe EUBE referrals | Safety | per collection | assessment | any | physician |
| Denied access / anomalous reads | Security | real-time | audit log | any burst | dev lead |

### 8. Adapt
- Agreement <80% → error analysis on 30 failures, Pareto by field; fix prompt/validator; if one field dominates, mark that field `not_reported`-by-default or HUMAN.
- Cost per report > target → apply OP5 migration signal; shorten input to relevant sections.
- Contamination >15% → tighten access control for arm B; report as protocol deviation, do not silently change analysis.
- New knowledge area >Z% of requests `[specify]` → extend OP2 taxonomy and gold set.
- Decisions: research team lead `[specify]`; clinical/ethics changes → physician and ethics committee.

---

## Operation cards

### OP1 · Intake & queue — DETERMINISTIC
**Why**: ID creation, validation and enqueue are fully rule-expressible. **Hybrid**: none. **Migration signal**: none expected.
- **Properties**: encapsulated (writes Request via `create`); idempotent with `(participant_id, normalized_input)` key; deterministic; side effect: enqueue; atomic (write + enqueue in one transaction/outbox); reversible (cancel); retry safe; order-independent; stateful (queue).
- **Failure modes**
| Mode | Effect | S | O | D | RPN | Mitigation |
|---|---|---|---|---|---|---|
| Duplicate submissions | Double cost | 3 | 5 | 2 | 30 | Idempotency key |
| Oversized/malicious PDF | Resource exhaustion | 6 | 3 | 3 | 54 | Size/type limits, sandboxed parse |
| Lost request on crash | Student sees nothing | 5 | 3 | 4 | 60 | Outbox, status endpoint |
- FP/FN: n/a. **Cost/unit**: ≈ negligible. **Governance**: stores participant code with query text → protected. **Owner**: `[specify: developer]`. **Access**: `svc-intake`, C on Request, no R on Article.
- Cycle (condensed): 1 target = accepted-request rate; 2 web form logs; 3 writes Request; 4 N/A rules; 5 unit + load test; 6 API, canary; 7 queue depth, age of oldest; 8 scale workers on depth.

### OP2 · Classify intent & topic — NLP
**Why**: bounded label set, short text, needs low cost and speed (`main.py` proposes classifiers). **Knowledge**: medical/biological taxonomy `[specify: e.g., MeSH / OpenAlex topics]`. **Hybrid**: low confidence → ask the student or search all areas. **Migration signal**: start rule/keyword → trained classifier once ≥ `[specify]` labeled requests.
- **Properties**: encapsulated; idempotent; deterministic (model pinned); no side effects; atomic; retry safe.
- **Failure modes**
| Mode | Effect | S | O | D | RPN | Mitigation |
|---|---|---|---|---|---|---|
| Wrong area | Irrelevant search results | 4 | 4 | 5 | 80 | Show chosen area, allow override; log override |
| Prompt-injection text in query | Misrouting | 3 | 2 | 4 | 24 | Classifier has no tools/instructions channel |
- FP vs FN: wrong area costs a re-search; cheap. **Cost/unit**: ≈ negligible. **Governance**: raw_input is participant text; local model preferred. **Owner**: `[specify]`. **Access**: `svc-classify`, R Request.raw_input, U Request.intent only.
- Cycle: 1 accuracy/macro-F1 `[target specify]`; 2 requests + overrides; 3 writes intent; 4 baseline = keyword table; 5 holdout from labeled requests `[pending]`; 6 inline in queue; 7 override rate, confidence histogram; 8 override rate >Y% → retrain.

### OP3 · Resolve & enrich metadata — DETERMINISTIC
**Why**: OpenAlex/Crossref/OpenCitations return structured fields; retraction, preprint and OA status are lookups, not inference. This is where Criba gets its trustworthiness at near-zero cost. **Hybrid**: question/topic requests → ranked candidate list; student picks (HUMAN choice, no auto-selection). **Migration signal**: none.
- **Properties**: encapsulated; idempotent (upsert by DOI); deterministic modulo upstream data → store `retrieved_at` and source version; side effects: external API calls; atomic per article; retry with backoff and rate-limit respect (polite pool); order-independent; stateless (cache).
- **Failure modes**
| Mode | Effect | S | O | D | RPN | Mitigation |
|---|---|---|---|---|---|---|
| Retraction missed (source lag) | Student trusts retracted paper | 9 | 3 | 7 | 189 | Show "retraction status checked on <date> via <source>", never "not retracted"; refresh before display; second source |
| Wrong paper matched (DOI typo, title match) | Report on the wrong paper | 7 | 3 | 3 | 63 | Show title/authors for confirmation |
| API outage / quota | No result | 4 | 4 | 2 | 32 | Cache, degrade to stored data, backoff + jitter |
- FP vs FN: false "retracted" is a visible, correctable annoyance; false "not retracted" is the dangerous direction → wording above. **Cost/unit**: API calls, free tiers `[verify limits]`. **Governance**: queries leak interests to third parties; send only DOI/title, no participant code. **Owner**: `[specify]`. **Access**: `svc-resolve`, CU Article, no R on Participant.
- Cycle: 1 resolution success %, retraction recall; 2 API responses; 3 maps to Article; 4 N/A (rules; calibrate match threshold); 5 test set of known DOIs incl. retracted `[pending]`; 6 async worker; 7 API error rate, missing-field %, latency; 8 coverage gap in a field → add source.

### OP4 · Acquire text — NLP (OCR)
**Why**: classical OCR/PDF text extraction; bounded task, no reasoning. **Hybrid**: OA full text via API first → PDF parse → OCR only if the PDF has no text layer → else abstract-only mode flagged as such. **Migration signal**: OCR volume high and quality poor → move layout step to LLM vision (cost check first).
- **Properties**: encapsulated; idempotent (hash of file); deterministic; side effect: object-store write; atomic per file; retry safe; stateless.
- **Failure modes**
| Mode | Effect | S | O | D | RPN | Mitigation |
|---|---|---|---|---|---|---|
| OCR garbles numbers (n, p) | Wrong sample size downstream | 7 | 4 | 6 | 168 | OP5 validator requires the span in the text; confidence flag; abstract-only fallback |
| Paywalled content processed | Copyright exposure | 6 | 3 | 3 | 54 | Only OA or user-uploaded; `[specify: legal review]` |
| Multi-column layout interleaved | Mixed sentences | 5 | 5 | 6 | 150 | Layout-aware parser, test on journal sample |
- **Cost/unit**: compute `[specify]`. **Governance**: user-uploaded PDFs may be copyrighted → retain only as long as the request needs `[specify]`. **Owner**: `[specify]`. **Access**: `svc-text`, U Article.full_text only.
- Cycle: 1 char error rate, % articles with usable text; 2 PDFs; 3 writes full_text; 4 baseline = pdf text layer; 5 50-scan audit `[pending]`; 6 worker; 7 empty-text rate; 8 high failure on a publisher → add parser.

### OP5 · Criba screening — Class: LLM + deterministic validator (HUMAN on failure)
**Why**: papers vary in structure and wording; extracting "design, n, statistics, COI" needs reading comprehension; few labels at start. **Knowledge**: study-design taxonomy, reporting conventions (CONSORT/STROBE-like), `[specify: checklist adopted]`. **Hybrid**: LLM extracts `{value, evidence_span}` → validator checks the span exists verbatim in `full_text`, `sample_size` appears in the span, enum values valid → failures set field to `not_reported`/"unverified" and queue for team review. **Migration signal**: if a field (e.g., sample size) reaches stable patterns and ≥ `[specify]` corrections are logged, move it to regex/NLP.
- **LLM context**: knowledge source = the article text only (no web). Tools: **none**; output is schema-constrained JSON. Article text is untrusted data, never instructions.
- **Properties**: encapsulated (writes ScreeningReport via create, versioned); idempotent on `(article_id, pipeline_version)`; non-deterministic → pin model version, temperature 0, measure variance on gold set; side effects none; atomic per report; reversible (new version supersedes); retry safe; order-independent; stateless.
- **Failure modes**
| Mode | Effect | S | O | D | RPN | Mitigation |
|---|---|---|---|---|---|---|
| Hallucinated value with fake span | Student believes false evidence | 8 | 3 | 2 | 48 | Verbatim span check |
| Real span, wrong interpretation (e.g., n of screened vs analyzed) | Wrong appraisal | 7 | 5 | 6 | 210 | Gold-set error analysis per field; label the span so the student can verify; moderator training |
| Misses COI statement | False reassurance | 7 | 4 | 6 | 168 | Show "not found in text" rather than "none"; check end-of-paper section |
| Prompt injection in paper | Altered output | 8 | 2 | 4 | 64 | Data-only input, schema-only output, no tools |
| Student treats card as verdict | Over-trust (artifact risk) | 8 | 5 | 7 | 280 | UI shows checklist+sentence only, caveat text, no score; H3 measures accuracy |
- **FP vs FN**: wrongly flagging a good paper costs an extra look; missing a design flaw means a bad paper trusted → bias toward `not_reported`/unverified over confident values.
- **Cost/unit**: tokens × price `[specify]` + validator ≈ negligible; compare to student minutes × `[specify]`.
- **Governance**: input is article text only (no participant data); confirm provider terms and OA licence `[specify]`.
- **Owner**: Accountable `[specify: QFB / dev lead]`; Consulted physician; Informed coordinator. **Access**: runs as `svc-criba`; R Article.full_text, C ScreeningReport; no R on Participant/Assessment.
- Cycle:
  1. **Problem**: target = field agreement with expert; metrics agreement %, span validity %, p95 latency, cost/report.
  2. **Data**: article texts; gold set labelled by two experts (inter-rater agreement measured); OCR errors noted.
  3. **Information**: writes ScreeningReport fields (Inferred), validator promotes verified ones to Derived.
  4. **Train/adjust**: baseline = regex over abstract and student alone; tune schema, prompt, chunking, few-shots.
  5. **Evaluation**: gold set per field, gate ≥80% agreement `[pending]`, spans 100%, plus H3 comparison with/without tool.
  6. **Deploy**: shadow → Wave 1; correction button logs labels.
  7. **Monitor**: weekly audit agreement, reject rate, cost, correction rate.
  8. **Adapt**: per-field Pareto; rollback if <80%; migrate stable fields to NLP.

### OP6 · Spanish abstract — LLM
**Why**: translation of scientific text is open-ended; no practical rule. **Hybrid**: terminology check against a glossary `[specify]`; numbers in source and translation must match (deterministic check); flagged "machine translation" in UI. **Migration signal**: if a dedicated MT service meets quality at lower cost, switch (benchmark first).
- **Properties**: idempotent per (article, version); pinned model; no side effects; reversible; stateless.
- **Failure modes**
| Mode | Effect | S | O | D | RPN | Mitigation |
|---|---|---|---|---|---|---|
| Number/negation changed | Reverses finding | 8 | 2 | 4 | 64 | Numeric and negation-cue check; link to original |
| Term mistranslated | Confusion | 4 | 5 | 6 | 120 | Glossary, bilingual terms shown |
- **Cost/unit**: short text, `[specify]`. **Governance**: abstract only, public. **Owner**: `[specify]`. **Access**: `svc-criba` (shares OP5 identity) or separate `svc-translate`, W spanish_abstract only (ASSUMPTION: separate, least privilege).
- Cycle: 1 adequacy score by bilingual reviewer sample, number-match %; 2 abstracts; 3 writes spanish_abstract; 4 baseline = raw MT; 5 reviewer sample `[pending]`; 6 inline in report; 7 numeric mismatch rate; 8 mismatch → glossary/prompt fix.

### OP7 · Mapa graph — DETERMINISTIC
**Why**: nodes/edges come from OpenAlex/OpenCitations/Crossref; flags are copied lookups. "Similarity" (embedding) is a separate TRAINABLE/NLP sub-operation: **ASSUMPTION: defer it; the protocol states similarity, but no embedding choice is given → `[specify]`.** Split it out as OP7b if required. **Migration signal**: add OP7b when graph navigation by citation alone proves insufficient in Wave 2 feedback.
- **Properties**: idempotent (upsert edges); deterministic given upstream snapshot; atomic per node batch; reads external APIs; stateless.
- **Failure modes**
| Mode | Effect | S | O | D | RPN | Mitigation |
|---|---|---|---|---|---|---|
| Missing/incorrect citation edges | Misleading neighborhood | 5 | 5 | 6 | 150 | Show source of edge; coverage note |
| Quality flag stale | See OP3 | 8 | 3 | 7 | 168 | Re-check on display |
| Graph too large | Slow UI | 3 | 5 | 2 | 30 | Depth/size caps |
- **Cost/unit**: API + storage `[specify]`. **Governance**: public data only. **Owner**: `[specify]`. **Access**: `svc-graph`, CRUD CitationGraph, R Article/ScreeningReport flags.
- Cycle: 1 edge coverage vs reference sample, render latency; 2 API exports; 3 writes graph; 4 N/A; 5 sample check `[pending]`; 6 UI view (Phase 3); 7 coverage, staleness; 8 low coverage → add source.

### OP8 · Club session — HUMAN
**Why**: accountability and judgment (critical appraisal) are the intervention; moderator's training matters. **Hybrid**: software only supplies Criba cards and the appraisal sheet; no automated scoring of the discussion. **Migration signal**: none.
- **Properties**: side effects: appraisal sheets, attendance; not idempotent (attendance recorded once per session ID); reversible (corrections); stateful.
- **Failure modes**
| Mode | Effect | S | O | D | RPN | Mitigation |
|---|---|---|---|---|---|---|
| Low retention | Weak exposure, attrition | 6 | 5 | 3 | 90 | Retention KPI ≥50%, reminders |
| Moderator variability | Inconsistent appraisal | 5 | 5 | 5 | 125 | Training, shared sheet, calibrate on 1 session |
| Session ≥2 h | Fatigue (adds to burnout) | 5 | 3 | 2 | 30 | Time-boxed <2 h (protocol) |
- **Cost/unit**: moderator time per session `[specify]`. **Governance**: attendance linked to code, not name. **Owner**: `[specify: physician/coordinator]`. **Access**: moderator RU ClubSession; students R their own sheet.
- Cycle: 1 retention, appraisal accuracy; 2 attendance, sheets; 3 writes ClubSession; 4 train moderators; 5 inter-rater agreement on sheets `[pending]`; 6 biweekly in Spanish; 7 retention; 8 low retention → reschedule/format.

### OP9 · Allocate & measure — DETERMINISTIC (+ HUMAN participant input)
**Why**: stratified block randomization (1:1, blocks of 4; strata career year × sex; stepped waves) is a fully specified algorithm; measurements are instruments. **Hybrid**: allocation generated by someone independent of enrolment; the participant fills EUBE; referral protocol is a HUMAN branch. **Migration signal**: none.
- **Properties**: encapsulated (Allocation immutable); idempotent via participant code (re-run returns existing); deterministic with stored seed; side effects: unlocks tool access for arm A, schedules arm B access at +6 months; atomic per participant; **irreversible** after assignment (documented deviation only); concurrency: per-stratum lock; stateful.
- **Failure modes**
| Mode | Effect | S | O | D | RPN | Mitigation |
|---|---|---|---|---|---|---|
| Allocation visible before enrolment | Selection bias | 8 | 2 | 5 | 80 | Allocate after baseline consent; concealment |
| Arm B uses tool early | Contamination dilutes H1 | 7 | 5 | 3 | 105 | Access control by arm; monitor 15% |
| Severe EUBE not referred | Harm to student | 10 | 2 | 4 | 80 | Automatic alert to physician, tested protocol |
| Attrition >20% | Underpowered | 7 | 5 | 2 | 70 | Reminders, planned 79/arm |
| Re-identification | Privacy breach | 9 | 2 | 5 | 90 | Codes, separate key store |
- FP/FN: n/a. **Cost/unit**: participant time + coordination `[specify]`. **Governance**: highest sensitivity: ethics approval **before baseline**; consent; right to withdraw; LFPDPPP. **Owner**: Accountable `[specify: coordinator + PI]`; Consulted physician, ethics committee. **Access**: `svc-trial`; analysts get coded data only.
- Cycle: 1 balance, response rate; 2 forms; 3 writes Allocation/Assessment; 4 N/A; 5 simulate allocation; 6 deploy only after ethics approval; 7 contamination, attrition, referrals; 8 deviation rules in protocol.

### OP10 · Estimate effect — DETERMINISTIC
**Why**: pre-specified ITT ANCOVA (EUBE ~ arm + baseline + year + sex). **Hybrid**: statistician review. **Migration signal**: none.
- **Properties**: idempotent and deterministic (fixed seed/scripts in repo); no side effects other than the result; reproducible from versioned data snapshot.
- **Failure modes**
| Mode | Effect | S | O | D | RPN | Mitigation |
|---|---|---|---|---|---|---|
| Pilot treated as confirmatory | False claim | 8 | 4 | 3 | 96 | Wave labelling in results, pre-registration |
| d=0.5 optimistic | Underpowered | 6 | 5 | 4 | 120 | State assumption; pilot to estimate d |
| Post-hoc analysis choices | Bias | 7 | 3 | 5 | 105 | Pre-specified analysis plan |
- **Cost/unit**: negligible. **Governance**: coded data only. **Owner**: `[specify: statistician / receiving organization after Dec 2027]`. **Access**: read-only analysts.
- Cycle: 1 effect size with CI; 2 assessments; 3 reads Allocation + Assessment; 4 fixed model; 5 sensitivity (per-protocol secondary); 6 report; 7 N/A; 8 feed into scale decision.

---

## Chain integrity

### Data contracts
| From → To | Contract | On violation |
|---|---|---|
| OP1 → OP2 | `raw_input` non-empty, ≤ `[specify]` chars, `input_type` set | Reject with message |
| OP2 → OP3 | `intent ∈ taxonomy` or `unknown` | Default to broad search |
| OP3 → OP4 | Article has DOI or OpenAlex ID; `oa_status` known | Student chooses candidate |
| OP4 → OP5 | `full_text` ≥ N chars, language detected, extraction mode recorded | Abstract-only mode, flagged |
| OP5 → UI | Each field has `evidence_span` or `not_reported`; validator passed | Field hidden/marked unverified |
| OP5/OP3 → OP7 | Flags with `source` and `checked_at` | Node shown without flag |
| OP9 → OP10 | Allocation immutable; Assessment has timepoint | Excluded with logged reason |
Each operation validates input; violations go to a handler, never pass silently.

### End-to-end error budget
Illustrative only (no measured yields): if OP3 99%, OP4 95%, OP5 85% field-level, OP6 98%, the product yield ≈ 0.99 × 0.95 × 0.85 × 0.98 ≈ 78%. To reach the ≥80% gate, OP4 must be ≥97% or the abstract-only fallback must count as an accepted outcome. `[pending: measure]`.

### Traceability
`request_id` is the correlation ID across OP1–OP7. `pipeline_version` (model + prompt + validator) is stored on every ScreeningReport. Study operations key on the anonymized `participant_code`; the two ID spaces are linked only through `participant_code` on Request, protected.

---

## Access-control layer

Model: hybrid (RBAC for services and staff, ABAC for arm/wave conditions).

| Actor | Resource | C | R | U | D | Condition |
|---|---|---|---|---|---|---|
| svc-intake | Request | ✔ | ✔ | — | — | |
| svc-classify | Request.raw_input / intent | — | R | U(intent) | — | |
| svc-resolve | Article meta | ✔ | ✔ | ✔ | — | |
| svc-text | Article.full_text | ✔ | ✔ | ✔ | — | OA or user-uploaded |
| svc-criba | Article.full_text / ScreeningReport | C | R(text) | new version | — | no access to Participant |
| svc-graph | CitationGraph | ✔ | ✔ | ✔ | ✔ | |
| Student | own Request / reports | ✔ | ✔ own | — | withdraw own | arm A now, arm B after access_from |
| Moderator | ClubSession, sheets | ✔ | ✔ | ✔ | — | assigned sessions |
| Coordinator | usage, attendance | — | ✔ | — | — | coded |
| Physician | Assessment.EUBE (referral only) | — | ✔ | — | — | band ≥ 75% or participant-requested |
| svc-trial | Allocation, Assessment | ✔ | ✔ | — | — | allocation independent of enrolment staff |
| Analyst | coded Assessment, Allocation | — | ✔ | — | — | no identity |

- **Encapsulation as security**: `Request.raw_input`, `Article.full_text`, model/prompt versions = internal; `participant_id` identity map = protected.
- **LLM boundary**: article text and queries are untrusted data; no tools, no network for the LLM; no participant data to any external model.
- **Separation of duties**: allocation is not produced by the person doing recruitment; ScreeningReport rule changes are approved by someone other than the one who tunes the prompt.
- **Secrets**: API keys in a secret manager/CI secrets, never in the (public MIT) repo, rotation `[specify]`; never in prompts or logs.
- **Audit log**: all C/U/D on Allocation/Assessment, denied access, referrals, report corrections, rule/prompt version changes; retention per ethics approval `[specify]`.

---

## Summary table

| Operation | Class | Why | Key metric | Cost/unit | Max RPN | Owner |
|---|---|---|---|---|---|---|
| OP1 Intake | DETERMINISTIC | Rules | accepted-request % | ~0 | 60 | [specify] |
| OP2 Classify | NLP | Bounded labels | macro-F1 | ~0 | 80 | [specify] |
| OP3 Metadata | DETERMINISTIC | Lookups | resolve %, retraction recall | API free tier | 189 | [specify] |
| OP4 Acquire text | NLP (OCR) | Classical OCR | char error rate | compute | 168 | [specify] |
| OP5 Criba | LLM + validator | Open-ended reading | field agreement ≥80% | tokens [specify] | 280 | [specify] |
| OP6 Spanish abstract | LLM | Translation | number-match %, adequacy | tokens, small | 120 | [specify] |
| OP7 Mapa | DETERMINISTIC | API graph | edge coverage | API/storage | 168 | [specify] |
| OP8 Club | HUMAN | Judgment | retention ≥50% | moderator time | 125 | [specify] |
| OP9 Allocate & measure | DETERMINISTIC + HUMAN | Protocol | balance, attrition, contamination <15% | participant time | 105 | [specify] |
| OP10 Effect | DETERMINISTIC | Pre-specified | ΔEUBE CI | ~0 | 120 | [specify] |

Highest risk: **OP5 over-trust (RPN 280)**, **OP5 misinterpretation (210)**, **OP3 missed retraction (189)**.

---

## YAML spec

```yaml
process:
  name: BioVidGen
  problems:
    - "Health-science students in Mexico spend disproportionate time reading English-language literature"
    - "Time pressure contributes to emotional exhaustion (EUBE)"
    - "Students cannot cheaply discriminate weak or retracted papers"
  objective: "minimize reading time and EUBE score subject to appraisal accuracy not decreasing and Criba agreement with experts >= 80%"
  target_variable: {name: delta_EUBE, formula: "EUBE_t - EUBE_baseline, ITT, by arm", unit: "% of scale (0-100)"}
  kpis:
    - {name: active_users, formula: "active participants / enrolled in wave", unit: "%", target: ">=60"}
    - {name: records_generated, formula: "count of ScreeningReports", unit: "count", target: ">=2000"}
    - {name: club_retention, formula: "attended / enrolled", unit: "%", target: ">=50"}
    - {name: contamination, formula: "arm B users with early tool access / arm B", unit: "%", target: "<15"}
  as_is_baseline: {cycle_time: "[specify]", throughput: "[specify]", cost_per_unit: "[specify]", defect_rate: "[specify]", bottleneck: "ASSUMPTION: student reading time"}
  end_to_end_error_budget:
    target_yield: ">=80% field agreement (gate)"
    per_operation_targets: {OP3: "[specify]", OP4: "ASSUMPTION: >=97% usable text or abstract-only fallback", OP5: ">=80% field agreement"}

entities:
  - name: Request
    identity: {key: request_id, type: surrogate, dedup_rule: "(participant_id, normalized_input) within window"}
    storage: relational
    invariants: ["done implies ScreeningReport exists or failure reason stored"]
    interface: [create, set_intent, attach_article, set_status]
    properties:
      - {name: raw_input, type: text, unit: "", source_field: user, certainty: measured, visibility: internal, crud: {create: OP1, read: OP2, update: never, delete: "hard after retention [specify]"}}
      - {name: intent, type: enum, unit: "", source_field: OP2, certainty: inferred, confidence: "[specify]", visibility: public, crud: {create: OP2, read: pipeline, update: "override logged", delete: soft}}
    relationships:
      - {to: Article, relation: resolves_to, cardinality: "N:1", optional: true, ownership: reference}
  - name: Article
    identity: {key: doi, type: natural, dedup_rule: "normalized lowercase DOI; fallback openalex_id then content hash"}
    storage: relational
    invariants: ["is_retracted only from retraction source", "preprint and published linked, not merged"]
    interface: [upsert_metadata, set_full_text]
    properties:
      - {name: is_retracted, type: bool, unit: "", source_field: retraction_source, certainty: measured, visibility: public, crud: {create: OP3, read: all, update: "versioned refresh", delete: never}}
      - {name: full_text, type: text, unit: chars, source_field: OP4, certainty: inferred, confidence: "char error rate [specify]", visibility: internal, crud: {create: OP4, read: "OP5,OP6", update: replace, delete: "hard on takedown"}}
    relationships:
      - {to: ScreeningReport, relation: has, cardinality: "1:N", optional: true, ownership: composition}
      - {to: Article, relation: cites, cardinality: "N:M", optional: true, ownership: reference}
  - name: ScreeningReport
    identity: {key: "(article_id, pipeline_version)", type: surrogate, dedup_rule: "same key replaces nothing; new version only"}
    storage: document
    invariants: ["each populated field has verbatim evidence_span or not_reported", "no bare verdict"]
    interface: [create, annotate_correction]
    properties:
      - {name: study_design, type: enum, unit: "", source_field: OP5, certainty: inferred, confidence: ">=80% target", visibility: public, crud: {create: OP5, read: "student,moderator", update: "new version", delete: soft}}
      - {name: sample_size, type: int, unit: participants, source_field: OP5, certainty: inferred, confidence: "verified by span check", visibility: public, crud: {create: OP5, read: "student,moderator", update: "new version", delete: soft}}
      - {name: spanish_abstract, type: text, unit: "", source_field: OP6, certainty: inferred, confidence: "[specify]", visibility: public, crud: {create: OP6, read: student, update: "new version", delete: soft}}
    relationships: []
  - name: Participant
    identity: {key: participant_code, type: surrogate, dedup_rule: "institutional id hashed, held separately"}
    storage: relational
    invariants: ["identity map stored apart from codes"]
    interface: [enroll, withdraw]
    properties:
      - {name: career_year, type: int, unit: year, source_field: enrollment_form, certainty: measured, visibility: protected, crud: {create: enrollment, read: "svc-trial,analyst coded", update: "audited", delete: "on withdrawal"}}
    relationships:
      - {to: Allocation, relation: has, cardinality: "1:1", optional: false, ownership: composition}
      - {to: Assessment, relation: has, cardinality: "1:N", optional: true, ownership: composition}

operations:
  - id: OP1
    name: Intake and queue
    input: [Request.raw_input]
    output: [Request.request_id, Request.input_type]
    method_class: DETERMINISTIC
    why: "Fully rule-expressible"
    knowledge_required: none
    hybrid_fallback: none
    migration_signal: none
    properties: {encapsulated: true, idempotent: {value: true, mechanism: "participant+normalized_input key"}, deterministic: {value: true, pinned: ""}, side_effects: [enqueue], atomic: {value: true, boundary: "write+outbox"}, reversible: {value: true, compensation: cancel}, retry: safe, ordering: independent, state: stateful}
    contract_in: {schema: "raw_input non-empty, size limit", checks: [type, size], on_violation: reject}
    failure_modes:
      - {mode: lost_request, effect: "no result", severity: 5, occurrence: 3, detection: 4, rpn: 60, mitigation: "outbox and status endpoint"}
    error_costs: {false_positive: n/a, false_negative: n/a}
    metrics: [{name: accepted_rate, formula: "accepted / submitted", unit: "%", target: "[specify]"}]
    cost_per_unit: "~0"
    governance: {sensitive_data: [participant_code], regulation: [LFPDPPP], external_models_allowed: false}
    deploy: {mode: event, interface: API, rollout: canary, rollback_trigger: "error rate"}
    label_capture: n/a
    telemetry: [{metric: queue_depth, frequency: continuous, instrument: metrics, alert_threshold: "[specify]", alert_owner: "[specify]"}]
    adapt_rules: [{condition: "queue age > threshold", action: "scale workers"}]
    owner: {accountable: "[specify]", consulted: [], informed: []}
    actor_identity: svc-intake
  - id: OP2
    name: Classify intent and topic
    input: [Request.raw_input]
    output: [Request.intent, Request.knowledge_area]
    method_class: NLP
    why: "Bounded label set, cheap and fast"
    knowledge_required: "taxonomy [specify]"
    hybrid_fallback: "low confidence -> ask user or broad search"
    migration_signal: "rule table -> trained classifier at >= [specify] labels"
    properties: {encapsulated: true, idempotent: {value: true, mechanism: "same input same label"}, deterministic: {value: true, pinned: "model version"}, side_effects: [], atomic: {value: true, boundary: request}, reversible: {value: true, compensation: override}, retry: safe, ordering: independent, state: stateless}
    contract_in: {schema: "Request", checks: [non_empty], on_violation: "broad search"}
    failure_modes:
      - {mode: wrong_area, effect: "irrelevant results", severity: 4, occurrence: 4, detection: 5, rpn: 80, mitigation: "show area, allow override"}
    error_costs: {false_positive: "re-search", false_negative: "re-search"}
    metrics: [{name: macro_f1, formula: "mean per-class F1", unit: ratio, target: "[specify]"}]
    cost_per_unit: "~0"
    governance: {sensitive_data: [raw_input], regulation: [LFPDPPP], external_models_allowed: false}
    deploy: {mode: event, interface: queue worker, rollout: shadow, rollback_trigger: "override rate"}
    label_capture: "user overrides"
    telemetry: [{metric: override_rate, frequency: weekly, instrument: logs, alert_threshold: "[specify]", alert_owner: "[specify]"}]
    adapt_rules: [{condition: "override rate high", action: "retrain / extend taxonomy"}]
    owner: {accountable: "[specify]", consulted: [], informed: []}
    actor_identity: svc-classify
  - id: OP3
    name: Resolve and enrich metadata
    input: [Request.raw_input, Request.intent]
    output: [Article.doi, Article.is_retracted, Article.is_preprint, Article.oa_status]
    method_class: DETERMINISTIC
    why: "Structured lookups, no inference needed"
    knowledge_required: "OpenAlex, Crossref, OpenCitations, retraction source"
    hybrid_fallback: "candidate list chosen by the student"
    migration_signal: none
    properties: {encapsulated: true, idempotent: {value: true, mechanism: "upsert by DOI"}, deterministic: {value: true, pinned: "upstream snapshot date stored"}, side_effects: [external_api_calls], atomic: {value: true, boundary: article}, reversible: {value: true, compensation: refresh}, retry: "backoff+jitter", ordering: independent, state: stateless}
    contract_in: {schema: "doi or title", checks: [doi_regex], on_violation: "ask user"}
    failure_modes:
      - {mode: retraction_missed, effect: "retracted paper trusted", severity: 9, occurrence: 3, detection: 7, rpn: 189, mitigation: "show checked-on date and source, refresh, second source"}
    error_costs: {false_positive: "annoyance", false_negative: "trust in retracted paper"}
    metrics: [{name: retraction_recall, formula: "found retractions / known retractions", unit: "%", target: "[specify]"}]
    cost_per_unit: "API free tier [verify]"
    governance: {sensitive_data: [], regulation: [], external_models_allowed: true}
    deploy: {mode: event, interface: worker, rollout: canary, rollback_trigger: "wrong-match reports"}
    label_capture: "user reports wrong match"
    telemetry: [{metric: api_error_rate, frequency: continuous, instrument: logs, alert_threshold: "[specify]", alert_owner: "[specify]"}]
    adapt_rules: [{condition: "coverage gap", action: "add source"}]
    owner: {accountable: "[specify]", consulted: [], informed: []}
    actor_identity: svc-resolve
  - id: OP4
    name: Acquire text
    input: [Article.doi, Article.oa_status]
    output: [Article.full_text, Article.language]
    method_class: NLP
    why: "Classical OCR and PDF parsing"
    knowledge_required: "layout parsing"
    hybrid_fallback: "OA API -> PDF text layer -> OCR -> abstract-only"
    migration_signal: "poor OCR quality at volume -> LLM vision after cost check"
    properties: {encapsulated: true, idempotent: {value: true, mechanism: "file hash"}, deterministic: {value: true, pinned: "OCR version"}, side_effects: [object_store_write], atomic: {value: true, boundary: file}, reversible: {value: true, compensation: delete}, retry: safe, ordering: independent, state: stateless}
    contract_in: {schema: "Article with doi", checks: [license], on_violation: "abstract-only"}
    failure_modes:
      - {mode: ocr_garbles_numbers, effect: "wrong sample size downstream", severity: 7, occurrence: 4, detection: 6, rpn: 168, mitigation: "span validation, confidence flag"}
    error_costs: {false_positive: n/a, false_negative: "abstract-only result"}
    metrics: [{name: char_error_rate, formula: "edit distance / chars", unit: "%", target: "[specify]"}]
    cost_per_unit: "compute [specify]"
    governance: {sensitive_data: [], regulation: [copyright], external_models_allowed: true}
    deploy: {mode: event, interface: worker, rollout: shadow, rollback_trigger: "empty-text rate"}
    label_capture: "flagged bad extraction"
    telemetry: [{metric: empty_text_rate, frequency: daily, instrument: logs, alert_threshold: "[specify]", alert_owner: "[specify]"}]
    adapt_rules: [{condition: "failures cluster by publisher", action: "add parser"}]
    owner: {accountable: "[specify]", consulted: [], informed: []}
    actor_identity: svc-text
  - id: OP5
    name: Criba screening
    input: [Article.full_text, Article.title, Article.abstract]
    output: [ScreeningReport.study_design, ScreeningReport.sample_size, ScreeningReport.statistics_reported, ScreeningReport.conflicts_of_interest, ScreeningReport.evidence_span]
    method_class: LLM
    why: "Open-ended reading, few labels at start"
    knowledge_required: "study-design taxonomy, reporting checklist [specify]"
    hybrid_fallback: "validator checks verbatim span; failures -> unverified and team review"
    migration_signal: "stable fields with >= [specify] corrections move to regex/NLP"
    llm_context: {knowledge_sources: ["article text only"], tools: []}
    properties: {encapsulated: true, idempotent: {value: true, mechanism: "(article_id, pipeline_version)"}, deterministic: {value: false, pinned: "model version, temperature 0, variance on gold set"}, side_effects: [], atomic: {value: true, boundary: report}, reversible: {value: true, compensation: "new version"}, retry: safe, ordering: independent, state: stateless}
    contract_in: {schema: "Article with full_text", checks: [min_length, language], on_violation: "abstract-only mode"}
    failure_modes:
      - {mode: student_treats_card_as_verdict, effect: "over-trust", severity: 8, occurrence: 5, detection: 7, rpn: 280, mitigation: "checklist+sentence only, no score, H3 measurement"}
      - {mode: wrong_interpretation_with_real_span, effect: "wrong appraisal", severity: 7, occurrence: 5, detection: 6, rpn: 210, mitigation: "per-field gold-set analysis, visible span"}
      - {mode: prompt_injection_in_paper, effect: "altered output", severity: 8, occurrence: 2, detection: 4, rpn: 64, mitigation: "data-only input, schema output, no tools"}
    error_costs: {false_positive: "extra look at a good paper", false_negative: "bad paper trusted"}
    metrics:
      - {name: field_agreement, formula: "matched fields / expert fields", unit: "%", target: ">=80"}
      - {name: span_validity, formula: "spans found verbatim / spans cited", unit: "%", target: "100"}
    cost_per_unit: "tokens x price [specify]"
    governance: {sensitive_data: [], regulation: [copyright, "provider terms"], external_models_allowed: true}
    deploy: {mode: event, interface: queue worker, rollout: "shadow -> Wave 1 -> Wave 2 -> Wave 3", rollback_trigger: "agreement < 80% or unverifiable span shown"}
    label_capture: "(article, field, model value, corrected value, who, when)"
    telemetry:
      - {metric: field_agreement, frequency: weekly, instrument: "expert audit", alert_threshold: "<80%", alert_owner: "[specify]"}
    adapt_rules:
      - {condition: "agreement < 80%", action: "error analysis on 30 failures, Pareto by field, rollback if persists"}
      - {condition: "cost above target", action: "apply migration signal"}
    owner: {accountable: "[specify]", consulted: [physician], informed: [coordinator]}
    actor_identity: svc-criba
  - id: OP6
    name: Spanish abstract
    input: [Article.abstract]
    output: [ScreeningReport.spanish_abstract]
    method_class: LLM
    why: "Open-ended translation of scientific text"
    knowledge_required: "biomedical terminology glossary [specify]"
    hybrid_fallback: "numeric and negation check; link to original"
    migration_signal: "dedicated MT meets quality at lower cost"
    llm_context: {knowledge_sources: [glossary], tools: []}
    properties: {encapsulated: true, idempotent: {value: true, mechanism: "article+version"}, deterministic: {value: false, pinned: "model version, temperature 0"}, side_effects: [], atomic: {value: true, boundary: report}, reversible: {value: true, compensation: "new version"}, retry: safe, ordering: independent, state: stateless}
    contract_in: {schema: "abstract text", checks: [non_empty], on_violation: skip}
    failure_modes:
      - {mode: number_or_negation_changed, effect: "reverses finding", severity: 8, occurrence: 2, detection: 4, rpn: 64, mitigation: "deterministic check"}
    error_costs: {false_positive: "extra review", false_negative: "mistranslated finding"}
    metrics: [{name: number_match, formula: "matched numbers / source numbers", unit: "%", target: "100"}]
    cost_per_unit: "tokens, small [specify]"
    governance: {sensitive_data: [], regulation: [], external_models_allowed: true}
    deploy: {mode: event, interface: worker, rollout: shadow, rollback_trigger: "mismatch rate"}
    label_capture: "student/reviewer corrections"
    telemetry: [{metric: numeric_mismatch_rate, frequency: daily, instrument: validator, alert_threshold: "[specify]", alert_owner: "[specify]"}]
    adapt_rules: [{condition: "mismatches rising", action: "fix prompt/glossary"}]
    owner: {accountable: "[specify]", consulted: [], informed: []}
    actor_identity: svc-translate
  - id: OP7
    name: Mapa graph
    input: [Article.doi, ScreeningReport.flags]
    output: [CitationGraph.nodes, CitationGraph.edges]
    method_class: DETERMINISTIC
    why: "Graph from APIs; flags are copied lookups"
    knowledge_required: "OpenAlex, OpenCitations, Crossref"
    hybrid_fallback: "similarity (embeddings) split into OP7b if adopted"
    migration_signal: "add OP7b when citation-only navigation is insufficient"
    properties: {encapsulated: true, idempotent: {value: true, mechanism: "edge upsert"}, deterministic: {value: true, pinned: "snapshot date"}, side_effects: [external_api_calls], atomic: {value: true, boundary: "node batch"}, reversible: {value: true, compensation: rebuild}, retry: backoff, ordering: independent, state: stateless}
    contract_in: {schema: "Article with ids", checks: [id_present], on_violation: skip}
    failure_modes:
      - {mode: missing_edges, effect: "misleading neighborhood", severity: 5, occurrence: 5, detection: 6, rpn: 150, mitigation: "show edge source and coverage"}
    error_costs: {false_positive: "spurious link", false_negative: "missing link"}
    metrics: [{name: edge_coverage, formula: "edges found / reference edges", unit: "%", target: "[specify]"}]
    cost_per_unit: "API and storage [specify]"
    governance: {sensitive_data: [], regulation: [], external_models_allowed: true}
    deploy: {mode: event, interface: UI, rollout: "Phase 3", rollback_trigger: "wrong flags reported"}
    label_capture: "reported errors"
    telemetry: [{metric: staleness, frequency: weekly, instrument: job, alert_threshold: "[specify]", alert_owner: "[specify]"}]
    adapt_rules: [{condition: "low coverage", action: "add source"}]
    owner: {accountable: "[specify]", consulted: [], informed: []}
    actor_identity: svc-graph
  - id: OP8
    name: Club session
    input: [ScreeningReport, Article]
    output: [ClubSession, appraisal_sheet]
    method_class: HUMAN
    why: "Accountability and judgment are the intervention"
    knowledge_required: "critical appraisal, trained moderator"
    hybrid_fallback: none
    migration_signal: none
    properties: {encapsulated: true, idempotent: {value: true, mechanism: "session_id attendance"}, deterministic: {value: false, pinned: ""}, side_effects: [attendance, sheets], atomic: {value: true, boundary: session}, reversible: {value: true, compensation: correction}, retry: n/a, ordering: independent, state: stateful}
    contract_in: {schema: "article assigned", checks: [moderator_trained], on_violation: reschedule}
    failure_modes:
      - {mode: moderator_variability, effect: "inconsistent appraisal", severity: 5, occurrence: 5, detection: 5, rpn: 125, mitigation: "training, calibration"}
    error_costs: {false_positive: n/a, false_negative: n/a}
    metrics: [{name: retention, formula: "attended / enrolled", unit: "%", target: ">=50"}]
    cost_per_unit: "moderator time [specify]"
    governance: {sensitive_data: [participant_code], regulation: [LFPDPPP], external_models_allowed: false}
    deploy: {mode: batch, interface: "in-person/online, biweekly, <2h", rollout: "per wave", rollback_trigger: "retention < 50%"}
    label_capture: "appraisal sheets"
    telemetry: [{metric: retention, frequency: biweekly, instrument: attendance, alert_threshold: "<50%", alert_owner: "[specify]"}]
    adapt_rules: [{condition: "retention low", action: "adjust format"}]
    owner: {accountable: "[specify]", consulted: [physician], informed: [coordinator]}
    actor_identity: moderator_role
  - id: OP9
    name: Allocate and measure
    input: [Participant]
    output: [Allocation, Assessment]
    method_class: DETERMINISTIC
    why: "Specified randomization algorithm and instruments"
    knowledge_required: "trial design, EUBE scoring"
    hybrid_fallback: "participant self-report; physician referral for Severe band"
    migration_signal: none
    properties: {encapsulated: true, idempotent: {value: true, mechanism: participant_code}, deterministic: {value: true, pinned: "stored seed"}, side_effects: ["arm A access enabled", "arm B scheduled +6 months"], atomic: {value: true, boundary: participant}, reversible: {value: false, compensation: "documented deviation"}, retry: safe, ordering: "per-stratum lock", state: stateful}
    contract_in: {schema: "consented participant with strata", checks: [consent, ethics_approved], on_violation: block}
    failure_modes:
      - {mode: severe_not_referred, effect: harm, severity: 10, occurrence: 2, detection: 4, rpn: 80, mitigation: "automatic physician alert"}
      - {mode: contamination, effect: "diluted H1", severity: 7, occurrence: 5, detection: 3, rpn: 105, mitigation: "arm-based access, monitor <15%"}
    error_costs: {false_positive: "unneeded referral", false_negative: "missed severe case"}
    metrics: [{name: attrition, formula: "lost / enrolled", unit: "%", target: "<=20"}]
    cost_per_unit: "participant time [specify]"
    governance: {sensitive_data: [EUBE, identity], regulation: [LFPDPPP, "ethics committee"], external_models_allowed: false}
    deploy: {mode: batch, interface: "forms and trial service", rollout: "stepped waves", rollback_trigger: "ethics hold"}
    label_capture: n/a
    telemetry: [{metric: contamination, frequency: weekly, instrument: access_log, alert_threshold: ">15%", alert_owner: "[specify]"}]
    adapt_rules: [{condition: "contamination > 15%", action: "tighten access, report deviation"}]
    owner: {accountable: "[specify: PI/coordinator]", consulted: [physician, ethics_committee], informed: []}
    actor_identity: svc-trial
  - id: OP10
    name: Estimate effect
    input: [Allocation, Assessment]
    output: [AnalysisResult]
    method_class: DETERMINISTIC
    why: "Pre-specified ITT ANCOVA"
    knowledge_required: "biostatistics"
    hybrid_fallback: "statistician review"
    migration_signal: none
    properties: {encapsulated: true, idempotent: {value: true, mechanism: "versioned data snapshot"}, deterministic: {value: true, pinned: "script version, seed"}, side_effects: [], atomic: {value: true, boundary: analysis}, reversible: {value: true, compensation: rerun}, retry: safe, ordering: independent, state: stateless}
    contract_in: {schema: "coded assessments", checks: [timepoints, allocation_immutable], on_violation: "exclude with reason"}
    failure_modes:
      - {mode: pilot_treated_as_confirmatory, effect: "false claim", severity: 8, occurrence: 4, detection: 3, rpn: 96, mitigation: "wave labels, pre-registration"}
    error_costs: {false_positive: "false efficacy claim", false_negative: "missed effect"}
    metrics: [{name: effect_size, formula: "adjusted mean difference A-B / pooled SD", unit: "d", target: "d=0.5 assumed"}]
    cost_per_unit: "~0"
    governance: {sensitive_data: [coded_EUBE], regulation: [LFPDPPP], external_models_allowed: false}
    deploy: {mode: batch, interface: "script/notebook", rollout: "Wave 3 confirmatory, Dec 2027", rollback_trigger: n/a}
    label_capture: n/a
    telemetry: []
    adapt_rules: [{condition: "d lower than assumed", action: "re-power before scale-up decision"}]
    owner: {accountable: "[specify: statistician/receiving organization]", consulted: [], informed: []}
    actor_identity: analyst_role

access_control:
  model: hybrid
  matrix:
    - {actor: svc-criba, resource: Article.full_text, c: false, r: true, u: false, d: false, condition: ""}
    - {actor: svc-criba, resource: ScreeningReport, c: true, r: true, u: false, d: false, condition: "new version only"}
    - {actor: svc-trial, resource: Allocation, c: true, r: true, u: false, d: false, condition: "independent of recruitment"}
    - {actor: analyst, resource: Assessment, c: false, r: true, u: false, d: false, condition: "coded data only"}
    - {actor: physician, resource: Assessment.EUBE, c: false, r: true, u: false, d: false, condition: "band >= 75% or participant request"}
    - {actor: student, resource: ScreeningReport, c: false, r: true, u: false, d: false, condition: "own requests; arm B after access_from"}
  separation_of_duties:
    - "Allocation not generated by recruitment staff"
    - "Prompt/rule changes approved by someone other than the author"
  secrets: {storage: "secret manager / CI secrets, never in public repo", rotation: "[specify]"}
  audit_log: {events: [allocation, assessment_cud, denied_access, referral, report_correction, pipeline_version_change], retention: "[specify per ethics approval]"}

open_questions:
  - "Ethics committee approval and institutional collaborators are pending: when is baseline possible?"
  - "Which retraction source (Crossref/Retraction Watch/other) and its update lag?"
  - "Which checklist defines Criba fields (CONSORT/STROBE-like) and who annotates the gold set (size, inter-rater agreement)?"
  - "How is minutes-per-article measured (logged vs self-report)?"
  - "Similarity in Mapa: embeddings or citation-only? (OP7b)"
  - "Which LLM provider and is sending OA/uploaded PDF text permitted by provider terms and copyright?"
  - "Latency, cost-per-report and uptime targets"
  - "Who owns each operation and alert (names/roles)?"
  - "Retention periods for raw_input, uploaded PDFs, assessments"
  - "d=0.5 is the midpoint of a meta-analytic range (0.30–0.70): confirm the power plan if Wave 1/2 estimate is lower"
```

---

## Open questions & assumptions

**Assumptions**
1. Scope = the whole BioVidGen system (product pipeline + trial), because the protocol bundles both. If you want only the software (OP1–OP7), OP8–OP10 can be split into a separate map.
2. `main.py` stub ordering (queue → topic classifier → OpenAlex) is the intended flow; nothing else in `app/` exists yet.
3. Abstract-only mode is acceptable as a fallback when full text isn't available.
4. OP2 starts as rules, not a model.
5. Services get separate identities, even if deployed in one process.

**Open questions**: see the `open_questions` list in the YAML. The most blocking: ethics approval timing, retraction source, gold-set annotation plan, and LLM provider/copyright terms.

**Next stage**: once reviewed, `process-tech-spec` turns this map into a system spec and implementation plan, which feeds `process-impl-plans`.
