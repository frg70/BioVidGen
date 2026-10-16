# 0005 — Study data capture: REDCap vs custom module

Status: **Withdrawn** (EUBE trial removed from the software scope) · Date: 2026-10-08

## Context
OP9 needs consent, stratified randomization, questionnaires (EUBE, time per article, appraisal test) at baseline/6/12 months, severe-band referral, and arm-based tool entitlement. Ethics approval is pending. Allocation and assessment records must be immutable/auditable.

## Options
| Option | Upside | Cost | What gets hard |
|---|---|---|---|
| A. REDCap (institution-hosted) | Standard in clinical research, ethics committees know it, built-in audit and randomization module | Needs institutional hosting and a REDCap admin; UI is not Spanish-first branded | Entitlement gating and referral alerts need API glue; product ↔ REDCap contract |
| B. Custom module in `study-api` (Postgres, triggers, VW5/6/10/11) | Full control, one stack, tight entitlement integration | 5–8 dev-weeks (phase T3); we own audit, security, consent versioning | More surface for ethics review |
| C. Generic form tool (Google Forms/Qualtrics) | Fast | Weak audit and randomization, data residency questions | Not recommended |

## Decision
Provisional: **B**, built so that the capture layer is replaceable. Switch to **A** if the institution provides REDCap and the ethics committee prefers it; in that case SVC5 reduces to an entitlement service reading allocations through the REDCap API. Decide in phase T0 once question 1 (open questions) is answered.

## Consequences
+ Either path keeps the same entities (`Participant`, `Allocation`, `Assessment`) and the same `GET /entitlements` contract.
− Under B we carry the burden of proof for audit/immutability; mitigated by DB triggers, append-only tables, and restore drills.

## Revisit when
Ethics committee requires a validated platform; REDCap becomes available; maintenance of the custom module exceeds budget.
