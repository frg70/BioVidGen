# BioVidGen — reasoning guide

Part A says how to think through a task in this repo. Part B records why the system is shaped the way it is, so the same decisions don't get re-argued. Part C lists the unknowns that should change your reasoning once they are answered. Read Part A before any non-trivial task. Read Part B before you propose changing something it covers.

## Part A — How to reason through a task

1. **Find the metric.** Name the KPI or engineering metric the change serves. The traceability matrix in tech-spec-v3 maps each metric to operations. If no metric applies, the change is probably out of scope, so say so instead of building it.
2. **Classify before you design.**
   - Identify the operation type (validate, transform, retrieve, generate…) using the operation-patterns reference.
   - Identify the method class.
   - Prefer DETERMINISTIC. Use the LLM only when a rule cannot be written, which here means OP5 and nothing else.
3. **Test-first, in this order:**
   1. objective and metrics;
   2. hypothesis tests;
   3. security;
   4. unit;
   5. type;
   6. value;
   7. performance;
   8. only then the logic.

   A test written after the code tends to describe the code rather than the requirement.
4. **Ask which error is worse, and lean to the safe side.**
   | Output | Worse error | Design choice |
   |---|---|---|
   | Retraction status | missing a real retraction (false negative) | OR the two sources; never say "not retracted" |
   | Evidence | showing an unverified quote as verified (false positive) | strict validator; hide the section rather than mislead |
   | Detection | wrong paper (false positive) | ask the user rather than guess |
5. **Simplest correct version first.** Optimise only when a stated threshold is crossed; each plan names its switch points in §9. Don't add abstractions, stores or services without a present requirement.
6. **Type 1 vs Type 2.**
   - Type 1 changes are expensive to reverse: permissions, network hosts, data schema, provider defaults, licences, privacy promises. They get an ADR and the user's approval.
   - Type 2 changes are cheap to reverse: names, internal helpers, log format. Decide and move on.
7. **Evidence discipline.**
   - Label numbers 🟢 (primary source read), 🟡 (secondary source) or 🔴 (assumption).
   - Treat external API behaviour marked `[verify]` as unknown until checked against the live API, then record it with a date.
   - Never invent volumes, latencies or limits. Write `[specify]` instead.
8. **Measure claims.** Never say "all covered", "works" or "complete" without measuring it.
   - Generate the coverage matrix: `npm run catalog`, or the audit in test-catalog §2.0.
   - Run the tests and paste the output.
   - Report failures as failures.
9. **Fail visibly.** Every failure path ends in a named, visible state: stale label, abstract-only, no verificado, "no se pudo comprobar". There are no silent drops and no crashes.
10. **Respect existing decisions.** Before you reverse something in Part B, read its source and its revisit trigger. If the trigger has not fired, keep the decision. If you think it should change anyway, draft an ADR.

## Part B — Why things are the way they are

| Decision | Why | What we gave up | Revisit when | Source |
|---|---|---|---|---|
| Local-first Chrome extension, no backend | $0 cost, privacy, one install for students | richer PDF handling; cross-browser support | spikes fail; >X% of papers are PDF-only; an institution wants hosting | ADR-0006 |
| Free-first pluggable LLM (Nano → Ollama → own key) | $0, no vendor lock-in, on-device option | uniform quality; we support three paths | no $0 provider passes the gate; a free tier disappears | ADR-0007 |
| Modular monolith; one writer per store | two developers; boundaries without operating separate services | process isolation (not needed) | a second team or a different runtime appears | tech-spec-v3 §2 |
| OP5 (LLM) split from OP5V (validator); OP5V the only Summary writer | the operation mixed method classes; makes "verified = verbatim" structural | nothing material | — | discovery map, map delta |
| Strict validator: any bad quote → whole section `no_verificado` | simple, strong promise | partial display of mostly-good sections | false rejects >10%, mostly one bad quote among good ones (QFB decides) | OP5V plan §9 |
| No fuzzy quote matching | a near-quote can flip meaning (negation, numbers) | some true quotes rejected | never; fix false rejects with measured normalisations instead | OP5V plan |
| Concierge-first gate (H-V2) before the LLM build | differentiation unproven; the summariser is the most expensive phase | expert time front-loaded | blind test can't recruit enough students; browser AI adds verified quotes | ADR-0008 |
| Verifier pivot kept ready | same entities, OP4 and OP5V reused if H-V2 fails | — | gate result | ADR-0008 |
| Build OP12 ourselves; others' code as reference | highest-severity op (RPN 189); our wording invariants; avoids runtime dependence on a small project | reuse | Citicious exposes a maintained library; our recall stays <95% | ADR-0009 |
| Status: OR of OpenAlex and Crossref; never "not retracted" | missed retraction is the dangerous direction; sources lag | some over-alarm | recall <95% → add offline Retraction Watch data | OP12 plan |
| Two-pass list badges (OpenAlex first, Crossref after) | 2 s budget cannot fit per-DOI Crossref calls | first paint is OpenAlex-only, and the wording says so | — | spec delta D5 |
| Preprint rule by DOI pattern, not prefix | `10.1101` is shared with CSHL journals | a longer pattern list to maintain | — | delta D6 |
| No topic classifier (old OP2); Laya not adopted | OpenAlex gives topics for free; Laya is weak zero-shot | — | labelled data exists and a narrow decision needs it | tech-spec v2 §6.3 |
| DOM text first, Europe PMC JATS fallback, no OCR | most journal pages serve HTML; OCR is heavy | scanned PDFs | usable text <70% → JATS first, companion ADR | OP4 plan |
| Hidden-text pruning before extraction | prompt injection via invisible text | possibly legitimate collapsed content | decision D-T1 | OP4 plan |
| Article text kept for the session only | copyright | re-extraction after the panel closes (~1 s) | — | ADR-0006, OP4 plan |
| No telemetry; pilot KPIs from surveys and opt-in export | privacy promise | automatic product analytics | never silently; only by ADR | tech-spec-v3 §7 |
| Map-reduce per section (4 calls) with deterministic pre-selection | small contexts (Nano); free quotas | fidelity on very long sections (shown as "partial") | H3 loss >5 pp → add a reduce call | OP5 plan |
| Plain prompts at runtime; DSPy only offline | no labels early; avoids Python at runtime | automated prompt search at runtime | ≥60 gold items and manual iteration has plateaued | ADR-0003 |
| Markdown export, not DOCX | portable; no heavy libraries | Word-native formatting | the club requires DOCX | OP13 plan |
| Permissive licences only | the MIT + commercial-reuse promise is public | PyMuPDF speed | legal advice | ADR-0004 |
| Expert gold set: double annotation, κ, adjudication, CC-BY texts only in the public repo | reliable labels; licence safety | expert hours (~105–135 h) | κ <0.4 → revise guideline | OP11, test catalog |

## Part C — Unknowns that should change your reasoning once answered

- **S1 / S5 (provider reality).** If Nano is weak in Spanish or rarely available, the default onboarding becomes "free key". Gate 2 headroom changes with the measured free quotas.
- **H-V2 result.** If it fails, stop optimising summaries and build the verifier (P3′).
- **S3 recall.** If OpenAlex alone is ≥95%, Crossref leaves the list hot path entirely.
- **Q3 hardware survey.** Decides which provider path is the default.
- **D-T1 collapsed sections.** Changes OP4 extraction and its security test expectations.
- **S7 browser-native AI.** If Chrome already gives Spanish summaries with quotes, the differentiation flag turns red and needs re-discussion with the user.
