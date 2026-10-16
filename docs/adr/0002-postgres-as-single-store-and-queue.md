# 0002 — PostgreSQL as the only data store and job queue

Status: **Superseded by 0006** (local-first extension: IndexedDB, no server DB or queue) · Date: 2026-10-08

## Context
Access patterns in the process map are key lookups, small joins, JSONB reports, and a citation neighbourhood of a few hundred nodes. Volume ≤50k reports (ASSUMPTION). Team cannot operate several data systems.

## Decision
PostgreSQL (one instance per boundary, see ADR-0001) for relational data, JSONB reports, audit log, citation edges (adjacency table, recursive CTE), and the job queue (`SKIP LOCKED` / outbox; library such as `procrastinate` or hand-rolled, to be confirmed). Object storage only for PDFs. pgvector may be added if OP7b is approved.

## Alternatives rejected
- **Document DB for reports**: JSONB gives the same flexibility with transactions.
- **Graph DB for Mapa**: no traversal workload that justifies it at this size.
- **Redis/Celery or a cloud queue**: extra infrastructure for tens of jobs per minute.
- **Vector DB**: no embeddings in v1.

## Consequences
+ One engine to run, back up, restore-test; transactional outbox for free.
− Queue throughput and visibility tooling are weaker than a dedicated broker; watch queue-age metric.

## Revisit when
Queue age breaches the latency NFR under load; graph traversal exceeds depth 2 or ~10k nodes; embeddings are adopted at scale.
