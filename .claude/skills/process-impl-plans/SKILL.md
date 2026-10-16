---
name: process-impl-plans
description: Third stage of the process-mapper pipeline. Generates one detailed implementation plan per operation, per service and per view from a technical spec's unit index, with the logic for each operation type beyond CRUD (validate, transform, aggregate, search, match, rank, predict, detect, optimize, generate, orchestrate, reconcile, and more), algorithm selection with complexity, data structures, storage and access patterns, method-specific build details (rules, NLP, ML, LLM, human tasks), operation-property implementation, security, telemetry, tests and an ordered task list. Use whenever the user wants implementation plans, low-level design, a per-component or per-screen build plan, wants to know which algorithm or data structure fits an operation, or wants to go from a tech spec to buildable tasks, even if they don't mention process-tech-spec.
---

# Process Impl Plans

Stage 3 of the pipeline: **process-mapper → process-tech-spec → process-impl-plans**.

Stage 2 decides boundaries and order. This stage decides **how each unit works inside**: its logic, the algorithm that computes it, the data structures that hold it, and the storage/access patterns that serve it. Most real operations aren't CRUD. They search, match, aggregate, rank, optimize, reconcile, and each of those has specific algorithms and structures that determine whether the system is correct, fast and affordable. Choosing them deliberately, per unit, is the point of this skill.

## Kernel prompt (RTCO + KERNEL)

```
◆ ROLE      → Senior engineer who designs algorithms, data structures and component internals.
▶ TASK      → Write one implementation plan per unit (operation, service, view) listed in the unit index.
✎ CONTEXT   → Input: process-tech-spec output (system YAML preferred) plus the process-mapper spec it references.
              Respect stage-2 decisions (service ownership, interfaces, storage, phases); record any disagreement as a spec delta.
              Classify each operation by type using references/operation-patterns.md before choosing algorithms or structures.
▣ OUTPUT    → For each unit, the matching template below, ordered by phase then dependency.
              Pseudocode for non-trivial logic; tables for access patterns, tests and tasks. Same language as the user.
✕ AVOID     → Picking an algorithm or store without stating the access pattern, volume and complexity that justify it.
              Specialized stores when the general-purpose one meets the requirement.
              Inventing volumes or latencies (mark [specify: …] or ASSUMPTION). Reopening stage-2 decisions without a delta.
```

## Input handling and batching

- **Unit index present** → plan units in its order.
- **No tech spec** → offer to run process-tech-spec first. If the user wants a single unit planned directly, plan it and mark the system-level assumptions it relies on.
- **Many units** → plan the current phase first (or the units the user names) and offer the next batch. Never compress plans into shallow summaries to fit everything; depth per unit is the value.
- **Spec deltas**: if planning reveals a stage-2 problem (wrong owner, missing event, a store that can't serve an access pattern), add `Unit | Spec said | Plan needs | Reason` to a deltas table at the end.

## Planning an operation

Always read `references/operation-patterns.md` first; it maps operation types to algorithms, data structures and access patterns.

### OPn · [name] — Type: [primary type (+ secondary)] · Class: [method class] · Service: [SVC]

**1. Contract**: signature; input/output schemas; preconditions; postconditions; invariants enforced; error cases with codes and caller behavior.

**2. Problem formulation**: state the computation precisely: inputs, output, objective (from the map), constraints, input size n and growth, latency and cost budget per call. This is what algorithm selection is judged against.

**3. Algorithm selection**: `Candidate | Time complexity | Space | Quality/accuracy | Cost | Fit`. Choose one, give the reason, and name the fallback. For knowledge-class operations, the "algorithm" includes the model or prompt strategy plus the deterministic pre/post-processing around it.

**4. Logic**: pseudocode of the full flow, including validation, the core algorithm, guardrails/validators, and how the result is written. List edge cases (empty input, duplicates, out-of-range values, partial failure, concurrent calls) and the handling of each.

**5. Data structures & storage**
- In-memory structures used during computation and why (e.g., heap for top-k, union-find for clustering duplicates).
- Access patterns table: `Pattern | Query shape | Frequency | Volume | Latency target | Structure/index | Store`.
- Write path: what is written where, transaction boundary, and how indexes, caches and projections are kept consistent.

**6. Method build details** (only the matching class)
- DETERMINISTIC: rules as code or decision table, configuration, and versioning.
- NLP: pipeline stages, resources (dictionaries, patterns), and evaluation.
- TRAINABLE ML: features with sources, model family, training data and labels, validation scheme, threshold set from FP/FN costs, calibration, retraining trigger, serving.
- LLM: model criteria, prompt outline, output schema (constrained/structured output), knowledge sources and retrieval strategy, tools with scopes, temperature and version pinning, eval set, injection defenses, fallback.
- HUMAN: task definition, view used (VW id), instructions/checklist, SLA, escalation, assignment algorithm, agreement measurement.

**7. Operation properties, implemented**: idempotency mechanism (key, dedup store, TTL); transaction boundary or saga steps with compensations; retry policy (which errors, backoff, max attempts, dead letter); concurrency control (optimistic versioning, locks, partition-key ordering); state handling.

**8. Security**: identity it runs as; exact permissions (entity.property × CRUD); input trust level and sanitization; secrets used; audit events emitted.

**9. Telemetry**: metrics, structured log fields and trace spans emitted, each mapped to the map's telemetry table; correlation ID handling.

**10. Tests**: `Level | What | Cases`, covering unit, property-based (for invariants and idempotency), contract, integration, eval set with acceptance threshold (knowledge classes), load (for the latency/throughput targets), and security (permission denial, injection).

**11. Tasks**: ordered checklist `# | Task | Depends on | Estimate | Done when`. The first task is always the contract and tests; the last is the rollout step (shadow/canary) from the spec.

## Planning a service

### SVCn · [name]

1. **Responsibility & boundaries**: what it owns, what it explicitly doesn't.
2. **Owned entities & storage provisioning**: schemas, indexes (consolidated from its operations' access-pattern tables), partitioning, and how many connections or how much capacity each is sized for.
3. **Hosted operations**: list, with how each is triggered (API, event, schedule, queue).
4. **API surface & events**: endpoints, events published/consumed, versioning.
5. **Internal structure**: modules/layers (interface → application → domain → infrastructure), and where invariants are enforced (domain layer, never controllers).
6. **Runtime**: deployment unit, scaling policy and the metric it scales on, resource needs (GPU/workers for LLM/ML), configuration, secrets.
7. **Reliability**: SLOs, health checks, timeouts to dependencies, circuit breakers, backup/restore.
8. **Security**: service identity, network exposure, policy enforcement point.
9. **Observability**: dashboards and alerts owned, with routing.
10. **Runbook**: top failure scenarios (from the map's failure modes) → detection → response steps.
11. **Tasks**: ordered checklist (scaffold, storage, CI/CD, observability, then its operations by phase).

## Planning a view

### VWn · [name] — Type: [screen | report | dashboard | work_queue | read_api] · Roles: […]

1. **Purpose & user goal**: the decision or task this view enables, and how success is measured (task time, error rate, adoption).
2. **Layout & components**: component tree with each component's responsibility.
3. **Data requirements**: per component: `Component | Data (entity.property) | Query/endpoint | Read model or projection | Freshness | Volume`. Decide whether a dedicated read model (precomputed projection) is needed, and how it's updated (event-driven, scheduled, on-demand).
4. **View logic**
   - State model: states and transitions (loading, empty, ready, editing, submitting, error, stale), as a state machine for anything beyond trivial.
   - Derived/computed fields and where computed (server vs. client) and why.
   - Filtering, sorting, search and pagination: algorithm and structure (e.g., cursor/keyset pagination over offset for large or changing sets; debounced server search vs. client-side filter by data size).
   - Input validation (shared with the operation contract), optimistic updates and how conflicts are reconciled.
   - Caching: what is cached, where, invalidation trigger.
5. **Actions → operations**: `Action | Operation | Confirmation required | Idempotency key source | Feedback to user`. Irreversible or high-severity actions require confirmation and show the consequence.
6. **Access**: per role, which fields are visible, masked (protected properties) or hidden, and which actions are enabled. Enforced server-side; the UI only reflects it.
7. **Label capture**: for views where people correct or override outputs, how the correction is captured and sent to the label pipeline.
8. **States & accessibility**: empty, error and loading content; keyboard navigation, contrast, screen-reader labels.
9. **Telemetry**: view loads, action success/failure, time-to-task, abandonment.
10. **Tests**: component, state-transition, access per role, end-to-end task flow, performance at target data volume.
11. **Tasks**: ordered checklist.

## Output template

```
# Implementation plans — [System] — [Phase or batch]
## Operations      OPn plans
## Services        SVCn plans
## Views           VWn plans
## Spec deltas
## Next batch      (remaining units by phase)
```

## Notes

- Order within a batch: services first (they host the rest), then operations by dependency, then views.
- A unit with several operation types gets a primary type for algorithm selection; secondary types add their own access patterns and tests.
- Correctness before optimization: give the simple correct algorithm first, then the optimized one only if the stated volume or latency requires it, with the threshold at which to switch.
