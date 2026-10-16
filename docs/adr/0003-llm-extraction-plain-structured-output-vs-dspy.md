# 0003 — LLM extraction layer for Criba (OP5) and Spanish abstract (OP6): plain structured output vs DSPy

Status: **Amended** — runtime stays plain prompts + schema + validator (TypeScript); DSPy only offline in eval/ (option C); see tech-spec-v2 §6.3 · Date: 2026-10-08

## Context
OP5 must return `{value, evidence_span}` per field with ≥80% agreement and 100% verbatim spans; a deterministic validator is mandatory. Gold set does not exist yet. Library API details below are `[verify]`.

## Decision
1. Define an `Extractor` port in the `screening` module (input: sections; output: Pydantic report; no tools).
2. Implement **A: plain Pydantic structured output with a hand-versioned prompt** first.
3. At the gold-set gate, implement **B: DSPy** behind the same port (Signatures + an optimizer such as MIPROv2 / BootstrapFewShot / GEPA, metric = field agreement + span validity, validator as assertion) and compare with A on agreement, variance across runs, cost per report and latency.
4. Choose by measured results. Option **C** (use DSPy offline to search prompts, freeze the result as plain text in the repo) is the expected fallback if DSPy helps but runtime dependence is unwanted.
5. Whatever wins, the validator, schema versioning (`pipeline_version`) and eval harness are shared, and the prompt is exported as human-readable text for the QFB and physician.

## Alternatives rejected (now)
- **DSPy from day one**: optimizers need labels we do not have; adds a fast-moving dependency before the baseline is measured.
- **Free-text JSON parsing**: violates the contract-first rule.

## Consequences
+ Working OP5 in days; the DSPy experiment costs days, not a rewrite; model/provider swap stays cheap.
− Two implementations briefly exist; manual prompt iteration until the gold set matures.

## Revisit when
Agreement plateaus <80% after two manual error-analysis rounds; provider/model changes; the gold set exceeds roughly 100 double-annotated articles `[specify]`.
