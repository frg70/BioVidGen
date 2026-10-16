# 0007 — Free-first, pluggable LLM provider strategy

Status: Proposed, pending spikes S1, S2, S5 · Date: 2026-10-08 · Type 1-lite (affects prompt/output contract, not data)

## Context
Verified 2026-10-08 (see `docs/process-design/dependency-register.md`): Chrome's on-device Gemini Nano is $0 but needs ≥22 GB disk and >4 GB VRAM or 16 GB RAM + 4 cores; Ollama runtime is MIT but each model has its own licence; free API tiers (Gemini Flash/Flash-Lite, Groq, OpenRouter `:free`) have limits that vary by source (≈100–1,500 requests/day) and change without notice; free Gemini inputs may be used to improve Google products. Laya (Apache-2.0, 2026-09-18) is a decision/classification model with 512–1024 token context, zero-shot below majority baseline, so it is not a summarizer.

## Decision
- Define a `Summarizer` port. Adapters: (1) Chrome built-in AI, (2) Ollama at localhost, (3) OpenAI-compatible endpoint with a user-supplied key. Selection order: Nano if available → Ollama if reachable → ask for a free key. No key is ever shipped in the repo.
- Map-reduce per section (≈4 short calls per paper) to fit small contexts; JSON schema output; verbatim-quote validator; Spanish output.
- Never send user-provided unpublished text to a free-tier provider; disclose provider data terms in the options page.
- Runtime prompts are plain text files; DSPy (MIT) is used offline in `eval/` only (ADR-0003 option C).
- Laya is **not** adopted in v1; reconsider only for narrow classification once labelled data exists.

## Alternatives rejected
- Single hard-wired vendor: breaks when free tiers change.
- Paid API as default: violates the $0 goal.
- Runtime LiteLLM/DSPy in the extension: Python libraries, not browser-native, and add dependency churn.

## Consequences
+ No vendor lock-in; $0 default; privacy options (on-device).
− Quality varies by provider; must be measured on the gold set per provider; support burden of three paths.

## Revisit when
Spikes show no provider reaches the agreement gate on student hardware; a free tier disappears; model licences change.
