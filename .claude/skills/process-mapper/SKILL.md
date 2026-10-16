---
name: process-mapper
description: Project-analysis methodology that maps any information-processing process (business workflow, system, idea, automation, agent) into entities and operations, each engineered through an 8-step cycle (Problem definition, Raw data, Data→Information, Train/adjust, Evaluation, Deploy, Monitor, Adapt). Classifies each operation as DETERMINISTIC, NLP, LLM, TRAINABLE ML or HUMAN; checks encapsulation, idempotency and atomicity; models ontologies with relationships and cardinality; adds failure modes, chain integrity, unit cost, governance, ownership, access control and a YAML spec. Use whenever the user wants to analyze a project, scope or design a system, map, automate or "AI-ify" a process, asks which problems are solved, what the abstractions or process are, or whether a step needs code, an LLM, NLP, ML or a person, even without naming the 8 steps.
---

# Process Mapper

A pipeline for mapping **any information-processing process**. Every process, however different, reduces to the same two primitives:

- **Entities**: the things information is about (ontology).
- **Operations**: transformations that read, create, update or delete entity properties, executed by a **method**.

Each operation is engineered with the same 8-step cycle and assigned a method class. Because every process is described in the same terms, any two processes can be compared, composed, secured and monitored the same way.

## Kernel prompt (RTCO + KERNEL)

This is the contract every analysis satisfies.

```
◆ ROLE      → Process engineer and data scientist who maps information-processing systems into measurable, secure, automatable pipelines.
▶ TASK      → Map the user's process into entities and operations, and engineer the whole process and each operation through the 8-step cycle.
✎ CONTEXT   → Input: the user's idea, process description, documents, or data samples.
              Cycle: 1 Problem definition · 2 Raw data collection · 3 Raw data → Information · 4 Train/adjust ·
              5 Evaluation · 6 Action/Deploy · 7 Monitor/Telemetry · 8 Adapt.
              Method classes: DETERMINISTIC · NLP · LLM · TRAINABLE ML · HUMAN.
              Cross-cutting layers: operation properties, failure modes, chain integrity, unit cost,
              governance, ownership, access control.
▣ OUTPUT    → 0 Framing & gate → Ontology → Top-level 8-step cycle → Operation cards → Chain integrity →
              Access-control layer → Summary table → YAML spec → Open questions.
              Tables for catalogs, ontologies, CRUD, permissions and metrics; short prose elsewhere.
              Same language as the user.
✕ AVOID     → Inventing numbers, instruments, systems or data not given (mark [specify: …] or ASSUMPTION).
              Choosing LLM/ML where a rule works; choosing a method before the metric it optimizes.
              Metrics without unit, target and formula. Skipping a step or layer — write "N/A — reason".
```

## Workflow

1. **Read the input.** If not even the target variable can be identified, ask one short question. Otherwise proceed and mark gaps `[specify: …]`.
2. **Section 0 — Framing & gate** (below).
3. **Ontology** — the full entity model, shared by all operations.
4. **Top-level 8-step cycle** — full depth.
5. **Operation cards** — every operation through the cycle in condensed form, plus classification, operation properties, failure modes, cost, governance, owner and access.
6. **Chain integrity** — contracts between operations and end-to-end error budget.
7. **Access-control layer** — consolidated view.
8. **Summary table**, **YAML spec** (schema in `references/spec-schema.yaml`), **open questions & assumptions**.

Keep the top level deep and the cards compact; the value is in comparing operations side by side. If output would be very long, deliver sections 0–4 plus the summary table first and offer the cards next rather than truncating.

## 0. Framing & gate

- **Problems solved**: one line each: who is affected, what happens, measurable symptom.
- **Abstractions**: core entities and operations, independent of tools or vendors.
- **Process map**: ordered operations as `ID · name · input → transformation → output · method class`, using SIPOC (Supplier, Input, Process, Output, Customer). Aim for 4–9 operations.
- **As-is baseline**: today's cycle time, throughput, cost per unit, error/defect rate, and bottleneck, for the whole process and per operation where knowable.
- **Worth-it gate**: per operation, `impact` (time, cost or risk removed per period) × `effort` (build + run + maintain). Rank operations and say which to engineer first and which to leave as-is.

## Ontology

Every entity gets:

- **Properties table**: `Property | Type | Unit | Source field | Certainty | Visibility`.
  - Certainty: **Measured** (direct instrument), **Derived** (deterministic computation), **Inferred** (method output, give expected confidence), **Assumed** (default or human guess).
  - Visibility (encapsulation): **public** (readable by consumers), **internal** (only the owning operation reads/writes), **protected** (readable by named roles only).
- **Invariants**: rules that must always hold (e.g., `total = Σ lines + tax`). Only the entity's own interface may change state, so invariants can't be bypassed.
- **Interface**: the operations allowed on the entity. External operations go through it, never directly to fields.
- **Relationships**: `Entity A | relation | Entity B | Cardinality (1:1, 1:N, N:M) | Optionality | Ownership (composition vs. reference)`.
- **Identity**: natural vs. surrogate key, and how duplicates are detected.
- **Data structure**: storage choice (relational, document, graph, time series, vector index, event log) and why.
- **CRUD per property**: `Property | Create | Read/Retrieve | Update (rule, versioning) | Delete (soft/hard, retention)`. Who may do each is in the access-control layer.

Flag fields whose name suggests one thing but represent another (e.g., "date" is entry date, not event date).

## The 8-step cycle

Use process-engineering vocabulary: control points, cycle time, throughput, yield / first-pass yield, defect rate, WIP, bottleneck, variability. **Cost per unit** is a first-class metric in every step that has metrics.

**1. Problem definition**
- Problem statement: current state → desired state, as a measurable gap.
- Variable catalog: `Variable | Role (input/control/state/output) | Data type | Unit | Range | Source`.
- Target variable with formula.
- **Objective**: state as `minimize/maximize X subject to constraints C`. The method follows from the objective, never the other way around.
- KPIs (business outcome) and engineering metrics (accuracy, latency p95, throughput, error rate, cost/unit), each with unit, target and formula.

**2. Raw data collection**
- Datasets: granularity (one row = ?), volume, frequency.
- Metadata: owner, timestamp semantics, schema, provenance, lineage.
- Measurement instrument per field (sensor, form, API, log, human entry), its resolution (smallest detectable change, sampling rate) and error rate (known, or how to estimate it: audit sample, duplicate %, missing %).
- **Governance**: personal or sensitive data, legal basis and consent, applicable regulation (e.g., LFPDPPP in Mexico, GDPR, sector rules), data residency, and whether data may leave the organization or reach third-party models.

**3. Raw data → Information**
- Map raw fields to the ontology. For each operation, state which entity properties it reads and writes.
- Data quality checks at ingestion: schema, ranges, uniqueness, referential integrity.

**4. Train / adjust parameters**
- **Baseline first**: the as-is process, or the simplest rule/heuristic (majority class, last value, fixed threshold).
- **Method selection from the objective**: given "reduce X subject to C", pick the method that optimizes it. Candidates include exact solvers, heuristics, search, learned models, prompted models and rules. Justify the choice against the metric, data available, cost/unit and failure severity.
- Tunable parameters: thresholds, rules, prompts, features, hyperparameters, solver settings.
- Data still needed: labels, ground truth, volume, and how they'll be collected (see label capture in step 6).

**5. Evaluation**
- Baseline vs. candidate on step 1 metrics, including cost/unit. Protocol: holdout, cross-validation, A/B, golden set, or human review sample.
- Acceptance criteria to deploy. Evaluate per operation **and** end to end. If nothing has been measured yet, define the plan and mark results `[pending]`.

**6. Action / Deploy**
- The action or function executed with the output (decision, write, API call, document, alert).
- Mode (batch / event / real-time), interface (API, job, UI, human queue), rollout (shadow → canary → full), rollback trigger.
- **Label capture by design**: every human correction, override, or downstream outcome is logged as `(input, method output, corrected output, who, when)` so step 4 gets training/eval data automatically.

**7. Monitor / Telemetry**
- `Metric | Health signal | Frequency | Instrument | Alert threshold | Alert owner`.
- Cover input drift, output quality, operational (latency, failures, retries), cost/unit, business KPI, and security events (denied access, anomalous reads).

**8. Adapt**
- Decision rules from telemetry to action: e.g., "precision < X for N days → error analysis + retrain"; "cost/unit > Y → move to a cheaper method class"; "new input category > Z% → extend ontology".
- Root-cause method (5 Whys, Pareto of defects, error analysis on a sample) and prioritization (impact × effort).
- Who decides and executes (from ownership).

## Method classification

Decide in this order; stop at the first match:

1. **DETERMINISTIC**: the rule can be fully written; same input → same correct output; verifiable by a unit test. Includes exact optimization solvers when the objective and constraints are fully specified.
2. **NLP (classical)**: text input; narrow, stable task; bounded vocabulary or patterns; low cost, speed or explainability needed (regex/NER, keyword or TF-IDF classification, fuzzy matching, language detection).
3. **TRAINABLE ML**: structured, numeric or embedded input; a target learnable from labeled history; clear metric; patterns that drift, so retraining is needed (forecasting, scoring, anomaly detection).
4. **LLM**: open-ended, ambiguous or highly variable input; needs reasoning, world knowledge, summarization, generation, or mapping messy input to a schema; few or no labels. **Retrieval and tool use are an LLM operating with knowledge sources and tools**: document the knowledge source, the tools, and their permissions.
5. **HUMAN**: accountability, legal sign-off, or judgment that must not be delegated; failure severity too high for any automated method's error rate; or volume too low to justify automating.

For each operation record:
- **why** — the criterion that decided it;
- **knowledge required**;
- **hybrid/fallback** — e.g., LLM extracts → deterministic validator checks → HUMAN on failure;
- **migration signal** — when to move class, e.g., an LLM step with stable patterns and enough logged labels can move to NLP/ML for cost.

## Operation properties

Check every operation:

| Property | Question |
|---|---|
| Encapsulation | Does it change entities only through their interface, with a declared input/output contract and hidden internals? |
| Idempotency | Does running it twice with the same input leave the same state? If not, how are duplicates prevented (idempotency key, dedup)? |
| Determinism | Same input → same output? If not (LLM, sampling), what is pinned (model version, seed, temperature) and how is variance measured? |
| Side effects | What does it change outside its output (writes, messages, payments, emails)? |
| Atomicity | All-or-nothing? What transaction boundary applies? |
| Reversibility | Can the effect be undone? If not, what is the compensating action? Irreversible + high severity → HUMAN approval or strong guard. |
| Retry & failure | Is retry safe? Timeout, backoff, dead-letter handling. |
| Concurrency & ordering | Does order matter? Race conditions? Locking or versioning strategy? |
| State | Stateless or stateful? Where does state live? |

## Failure modes (FMEA-lite)

Per operation: `Failure mode | Effect | Severity (1–10) | Occurrence (1–10) | Detection (1–10, 10 = undetectable) | RPN = S×O×D | Mitigation`.

Also state the **cost of a false positive vs. a false negative**. These costs set the decision threshold and the human-in-the-loop policy: high severity combined with low detectability forces a validator, a human checkpoint, or class HUMAN.

## Chain integrity

- **Data contracts** between consecutive operations: schema, ranges, required fields, certainty level. Each operation validates its input before using it; violations route to a defined handler and are not silently passed on.
- **End-to-end error budget**: overall yield ≈ product of per-operation yields (five operations at 95% each ≈ 77%). Set per-operation targets that meet the end-to-end target.
- **Traceability**: a correlation ID across operations, so an end-to-end failure can be traced to the operation that caused it.

## Access-control security layer

- **Identity per actor**: each operation runs as a distinct identity (service account, agent, or human role), never a shared superuser.
- **Permission matrix**: `Actor | Entity.property | C | R | U | D | Condition`. Least privilege: each operation gets only the properties it reads and writes in step 3. Use RBAC (by role), or ABAC (by attribute, e.g., region or ownership) where conditions apply.
- **Encapsulation as security**: internal properties are inaccessible outside their owning operation; protected ones only to named roles.
- **LLM/agent boundary**: treat untrusted input (emails, documents, web content) as data, never instructions. Scope tools to the minimum; require confirmation for irreversible or high-severity tool actions; don't send sensitive data to models that governance excludes.
- **Separation of duties**: the actor who creates a high-severity record cannot also approve it.
- **Secrets & keys**: where stored, rotation, never in prompts or logs.
- **Audit log**: every C/U/D, every denied access and every human override, with actor, time, before/after. Retention per governance.

## Ownership

Light RACI: an accountable **owner** per operation and per alert, plus who is consulted or informed for changes in step 8. Use `[specify: role]` when unknown; never invent names.

## Output template

```
# [Process] — Process Map
## 0. Framing & gate      (problems · abstractions · process map · as-is baseline · worth-it ranking)
## Ontology               (entities · properties · invariants · interfaces · relationships · CRUD)
## Top-level cycle        (1 → 8)
## Operation cards
### OP1 · [name] — Class: [DETERMINISTIC | NLP | LLM | TRAINABLE ML | HUMAN]
Why · Knowledge · Hybrid/fallback · Migration signal
Properties (encapsulation, idempotency, …) · Failure modes · Cost/unit · Governance · Owner · Access
1 … 8 (condensed)
## Chain integrity
## Access-control layer
## Summary table          Operation | Class | Why | Key metric | Cost/unit | Max RPN | Owner
## YAML spec
## Open questions & assumptions
```

Read `references/spec-schema.yaml` before writing the YAML spec, and `references/example.md` to calibrate operation-card depth.

## Notes

- Deterministic and HUMAN operations still go through all 8 steps: for deterministic, "train/adjust" is rule/threshold calibration and "evaluation" is test coverage plus defect rate; for HUMAN, they are training/checklists and inter-reviewer agreement.
- An operation that mixes classes is usually two operations; split it.
- The same mapping applies to non-business processes (a scientific pipeline, a personal workflow, a software system, an agent). Don't force business KPIs where they don't fit; the target variable and objective still apply.
- **Pipeline**: this skill is stage 1 of three. Once the map is reviewed, offer `process-tech-spec` (system spec and implementation plan), which then feeds `process-impl-plans` (one plan per operation, service and view).
