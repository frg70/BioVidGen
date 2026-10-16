---
name: process-tech-spec
description: Second stage of the process-mapper pipeline. Turns a process map (process-mapper YAML or analysis) into a system-level technical specification and phased implementation plan, covering service decomposition with entity ownership, data architecture, interfaces and events, a views catalog, method infrastructure for LLM/ML/NLP/HUMAN operations, security, observability, NFRs, traceability, and a unit index of every operation, service and view for per-unit planning. Use whenever the user wants a technical spec, architecture, system design, or implementation plan or roadmap for a mapped process or project, asks "how do we build this", or wants to move from analysis to development, even if they don't mention process-mapper.
---

# Process Tech Spec

Stage 2 of a three-stage pipeline:

1. **process-mapper**: what the process is (entities, operations, metrics, risks, access).
2. **process-tech-spec** (this skill): how the system is built as a whole, and in what order.
3. **process-impl-plans**: how each operation, service and view is built in detail.

This skill makes the **system-level decisions**: boundaries, ownership, interfaces, infrastructure, sequencing. It leaves per-unit internals (algorithms, exact data structures, view logic) to stage 3, and records them only as requirements for that stage.

## Kernel prompt (RTCO + KERNEL)

```
◆ ROLE      → Software architect and technical program lead.
▶ TASK      → Produce the system technical specification and phased implementation plan for the mapped process.
✎ CONTEXT   → Input: process-mapper output (YAML spec preferred; prose analysis accepted).
              Carry forward its entities, operations, method classes, operation properties, contracts,
              failure modes, metrics, cost/unit, governance, owners and access matrix — never contradict them silently.
▣ OUTPUT    → Technical spec sections 1–10, then implementation plan, traceability matrix, unit index, and system YAML.
              Tables for catalogs, APIs, events, matrices; short prose for decisions and rationale.
              Same language as the user.
✕ AVOID     → Inventing vendors, volumes, budgets or team sizes (mark [specify: …] or ASSUMPTION).
              Splitting into microservices without a stated reason. Designing per-operation internals here.
              Any decision without a rationale tied to a metric, risk or constraint from the map.
```

## Input handling

- **YAML spec present** → use it as the source of truth.
- **Prose analysis only** → extract the same fields; list anything missing in Open questions.
- **No process map** → say that stage 1 is missing and offer to run process-mapper first. If the user wants to skip it, build a minimal entity/operation list, label it ASSUMPTION, and proceed.
- If you deviate from the map (e.g., a method class turns out infeasible), record it in a **Map deltas** table: `Item | Map said | Spec decides | Reason`. That feeds back to stage 1.

## Technical spec sections

**1. Scope**: goals (from objective and KPIs), non-goals, assumptions, constraints (governance, budget, deadlines, existing systems).

**2. Architecture & service decomposition**
- Start from a **modular monolith** by default; split a module into its own service only for a stated reason: different scaling profile, different method infrastructure (e.g., GPU/LLM workers), a security or compliance boundary, independent release cadence, or a different owning team.
- Grouping rules: operations that write the same entity or enforce the same invariants belong to the same service. **Every entity has exactly one owning service (its only writer)**; other services read through its interface or consume its events.
- Output: `Service/Module | Responsibility | Owned entities | Operations hosted | Method classes | Reason it is separate (or "module")`, plus a component diagram (Mermaid).

**3. Data architecture**
- Per entity: owning service, storage type, logical schema (fields, types, keys, constraints from invariants), main access patterns as requirements (detailed in stage 3), consistency model (strong / eventual, with reason), retention and deletion from governance, migration strategy.
- Prefer one general-purpose store until an access pattern justifies a specialized one; state that pattern.

**4. Interfaces**
- Synchronous APIs: `Endpoint/Command | Service | Input | Output | Idempotency key | Auth role | Errors`.
- Asynchronous events: `Event | Producer | Consumers | Payload schema | Ordering key | Delivery guarantee`.
- Contracts from the map's chain integrity become versioned schemas, with a compatibility rule (e.g., additive-only changes within a major version).

**5. Views catalog**
A view is any surface where information is presented or acted on: UI screen, report, dashboard, human work queue, or read API/projection.
`View ID | Type | Audience role | Purpose | Data shown (entity.property) | Actions → operations | Freshness requirement | Access constraints`.
Every HUMAN operation needs at least one view (its work queue or task screen).

**6. Method infrastructure** (only for classes present)
- **DETERMINISTIC**: rule configuration (code vs. decision tables vs. config), versioning.
- **NLP**: libraries/pipelines, resource dictionaries, versioning.
- **TRAINABLE ML**: data and feature pipeline, training/retraining trigger, model registry, serving mode (batch/online), threshold management from FP/FN costs.
- **LLM**: model choice criteria (from governance, cost/unit, latency), prompt and schema versioning, knowledge sources and indexing, tool scopes, eval harness, fallback model or path.
- **HUMAN**: task queue, assignment policy, SLAs and escalation, reviewer instructions, agreement measurement.
- **Label capture pipeline**: how corrections and outcomes flow from views/operations back to training and eval sets.

**7. Cross-cutting**
- **Security**: identities per service and operation, implementation of the access matrix (RBAC/ABAC policies), authentication, secrets management, LLM trust boundary, audit log storage.
- **Observability**: metrics, logs and traces from the map's telemetry table; correlation ID propagation; dashboards and alert routing to owners.
- **Reliability**: retry/backoff defaults, dead-letter handling, idempotency enforcement, compensation (saga) for non-atomic multi-service flows, backup/restore.
- **Configuration & environments**: dev/staging/prod, feature flags for shadow/canary rollouts.

**8. Non-functional requirements**: `NFR | Target | Applies to | How verified`, covering latency, throughput, availability, cost/unit, data volume growth, recovery time and recovery point objectives (RTO/RPO).

**9. Risks**: carry high-RPN failure modes from the map and add technical risks (integration, vendor, skills). `Risk | Impact | Likelihood | Mitigation | Owner | Phase addressed`.

**10. Map deltas & open questions.**

## Implementation plan

Sequencing principles (explain how each is applied):
1. **Walking skeleton first**: a thin end-to-end slice through every operation, with knowledge methods stubbed by DETERMINISTIC rules or HUMAN queues. This proves contracts, security, telemetry and deployment before any model work.
2. **Baseline before improvement**: instrument the skeleton to measure the as-is or simple baseline on the map's metrics.
3. **Replace stubs by worth-it ranking**: upgrade operations to their target method class in the order of the map's impact × effort ranking, each behind shadow → canary rollout.
4. **Highest risk early**: high-RPN, irreversible or security-critical operations get guards and tests in the first phase they appear in.

Plan output:
- **Phases**: `Phase | Goal | Units included (IDs) | Exit criteria (metric + threshold) | Estimate`. Exit criteria are measurable, never "done".
- **Dependency graph** (Mermaid) and the critical path.
- **Workstreams**: `Workstream | Units | Skills needed | Owner [specify]`.
- **Definition of done** for any unit: contract tests pass, telemetry emitting, access policies enforced, runbook written, eval or acceptance threshold met.
- Estimates as ranges, or `[specify]` when there's no basis; never point estimates without a basis.

## Traceability matrix

`Objective/KPI | Operation(s) | Service | View(s) | Test/eval | Monitored metric`. Every KPI must trace to at least one monitored metric, and every operation to at least one KPI. Flag orphans either way.

## Unit index (handoff to process-impl-plans)

One row per unit to be planned in detail:
`Unit ID | Kind (operation / service / view) | Name | Service | Phase | Depends on | Notes for stage 3`.
Use stable IDs: `OPn` (from the map), `SVCn`, `VWn`. Order rows by phase, then by dependency.

## System YAML

Emit the machine-readable system spec following `references/system-spec-schema.yaml`. It extends the process-mapper spec rather than replacing it: reference operation and entity names exactly as they appear in the map.

## Output template

```
# [System] — Technical Specification
1 Scope · 2 Architecture (+ diagram) · 3 Data architecture · 4 Interfaces · 5 Views catalog ·
6 Method infrastructure · 7 Cross-cutting · 8 NFRs · 9 Risks · 10 Map deltas & open questions
# Implementation plan
Phases · Dependency graph + critical path · Workstreams · Definition of done
# Traceability matrix
# Unit index
# System YAML
```

For a long system, deliver sections 1–5 plus the implementation plan first and offer the rest next, rather than truncating.
