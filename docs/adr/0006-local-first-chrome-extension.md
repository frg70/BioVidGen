# 0006 — Local-first, open-source Chrome extension (no hosted backend)

Status: Proposed · Date: 2026-10-08 · Type 1 (distribution model, repo layout, privacy promise)
Supersedes: 0001, 0002. Withdraws: 0005.

## Context
New requirements: open-source tool that runs locally plus a Chrome web extension; EUBE trial part omitted; use free services wherever possible; output fields = authors, keywords, prerequisite topics, main topic, methodology/results/conclusions summaries, preprint and retraction filter. Team of five, two developers. Install friction for non-technical students is the biggest adoption risk; recurring cost must be $0.

## Decision
Chrome MV3 extension (WXT + TypeScript) is the product. All orchestration runs in the side-panel page; scholarly APIs are called directly from the browser; the LLM is pluggable (ADR-0007). No hosted backend, accounts or telemetry. Local state in IndexedDB / `chrome.storage.local`. A Python companion (FastAPI + SQLite) is **optional** and only built if measured need appears (PDF-only papers, offline Retraction Watch file). Python also stays in the repo for the dev-time evaluation harness.

## Alternatives rejected
- **Extension + mandatory local Python companion**: richer PDF handling, but two runtimes and a harder install for students; deferred, not rejected forever.
- **Hosted service**: easiest for users, but hosting and LLM bills, privacy/legal exposure, contradicts "runnable locally, free".

## Consequences
+ One install, one language at runtime, $0 recurring cost, strong privacy story (only DOI/title and chosen-LLM text leave the machine).
− Bounded by browser constraints: service-worker lifetime (orchestrate in side panel), CORS/localhost access, small on-device context windows, no OCR in v1.
− Chrome-only in v1.

## Revisit when
Spikes S1/S2/S4 fail (Nano too weak, localhost blocked, call lifetime unmanageable); >`[specify]`% of target papers are PDF-only; institutions require a hosted deployment.
