# 0001 — Modular monolith with an isolated study service

Status: **Superseded by 0006** (study service dropped; EUBE trial removed from the software) · Date: 2026-10-08

## Context
Two-developer team; ≤1,000 participants; trivial load. The one hard boundary is compliance: participant identity and EUBE scores (health-adjacent, LFPDPPP, ethics committee) must never be reachable from code that calls an external LLM.

## Decision
One codebase. Product modules (`core`, `scholarly`, `documents`, `screening`) in one deployable plus a worker process type. The study side (`OP8–OP10`) is a separate service with its own Postgres and credentials. The only product→study call is a read-only `GET /entitlements/{participant_code}`. Module dependency rules are enforced by import-linter in CI.

## Alternatives rejected
- **Single monolith, single DB**: simplest, but participant data sits next to LLM-calling code; harder to defend to the ethics committee.
- **Per-operation microservices**: nothing has an independent scaling need; cost is operational load on two developers.

## Consequences
+ Clear privacy argument; two small deployables; module seams allow a later split.
− Arm gating needs a cross-service check; if study-api is down, new arm-B requests fail closed.
− Two databases to back up and restore-test.

## Revisit when
GPU/self-hosted LLM workers are needed; a second team owns the study side; load grows beyond one container per module.
