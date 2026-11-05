# 0009 — Status checks (OP12): build our own module; use existing open-source checkers as reference only

Status: Proposed, pending spike S6 · Date: 2026-11-05 · Type 2 (internal module; reversible)

## Context
OP12 flags preprints, retractions, expressions of concern and corrections. Discovery found free Chrome extensions doing part of this. The main one is **Citicious**, reported as MIT-licensed, which checks Retraction Watch data via the Crossref API and separates expressions of concern and corrections from retractions. Its code and licence were **not inspected** in this session (source: search summary, 🟡). OP12 has the highest-severity failure mode in the map: a retraction missed (RPN 189). It also has product-specific invariants. Wording must never say "not retracted", it must say "no retraction found in {sources} on {date}". OpenAlex `is_retracted` is OR-ed with Crossref, results are batched for list pages, and a 24 h TTL applies.

## Decision
Build OP12 inside `scholarly` (SVC2) behind a `StatusChecker` function, at roughly 1–2 developer-weeks. Spike S6 reads Citicious (and RetractCheck if open) to reuse **query patterns and test cases**, such as which Crossref fields signal a retraction and known edge DOIs. Code is copied only if the licence is confirmed MIT/BSD/Apache, with attribution in `NOTICE`. Do not depend on another extension at runtime.

## Alternatives rejected
- **Recommend users install Citicious alongside BioVidGen**: that is two installs and the result-list UX is split. Our wording and preprint invariants could not be enforced, and the summary card would lack the status.
- **Fork Citicious as the base of BioVidGen**: its architecture targets a different job, and the fork would inherit its maintenance and design.

## Consequences
+ Full control of the high-severity wording and recall testing. No runtime dependency on a small third-party project.
− We maintain the Crossref/OpenAlex query logic ourselves. The spike reduces the risk of rediscovering known pitfalls.

## Revisit when
S6 shows Citicious exposes a reusable, maintained library. Our retraction recall stays below 95% after two iterations while another tool does better on the same sample.
