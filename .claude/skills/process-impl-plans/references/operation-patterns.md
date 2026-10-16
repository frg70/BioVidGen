# Operation patterns: types → algorithms → data structures → access patterns

## Contents
1. How to use this reference
2. Operation types catalog
3. Access pattern → structure/index table
4. Store selection heuristics
5. Complexity and scale checkpoints

## 1. How to use this reference

1. Classify the operation's **primary type** (section 2) from what it computes, not from its method class: "match invoice to PO" is a Match operation whether it's done by rules, ML or a person.
2. Take the candidate algorithms and structures for that type, then judge them against the problem formulation: input size n, growth, latency budget, accuracy need, cost/unit.
3. Write each read and write as an access pattern (section 3) and choose the structure/index that serves it.
4. Apply the store heuristics (section 4) before adding a new store.

Candidates are starting points, not an exhaustive list. If none fits, formulate the problem and choose from first principles, stating complexity.

## 2. Operation types catalog

| Type | What it computes | Candidate algorithms | Typical structures | Watch out for |
|---|---|---|---|---|
| **Persist (CRUD)** | Store and change entity state | Validated write, optimistic concurrency (version check), soft delete | Row/document with version column, append-only history table | Lost updates; deletes vs. retention rules |
| **Validate** | Accept/reject input against rules | Schema validation, decision tables, rule engine (forward chaining), invariant checks | Schema definitions, rule tables | Validation spread across layers; keep one source |
| **Transform / Map** | Convert format or schema | Pure mapping functions, streaming parse, normalization (units, encodings, dates) | Streams/iterators for large inputs | Lossy conversion; timezone and locale |
| **Aggregate / Summarize** | Totals, counts, statistics, rollups | Hash aggregation, sort-based grouping, windowing (tumbling, sliding, session), incremental/materialized aggregation; approximate sketches: HyperLogLog (distinct count), t-digest (quantiles), count-min (frequencies) | Hash maps, pre-aggregated rollup tables, time-partitioned tables | Recomputing everything per request; late-arriving data |
| **Search / Retrieve** | Find items by key, range, text, similarity, location | B-tree lookup/range scan, inverted index with BM25, vector ANN (HNSW, IVF), hybrid (lexical + vector) with reranking, geospatial (R-tree, geohash, S2) | B-tree, inverted index, ANN index, spatial index | Offset pagination on large sets; stale indexes |
| **Match / Join / Deduplicate** | Link records that refer to the same thing | Hash join on exact keys; entity resolution: blocking → pairwise similarity (Jaro-Winkler, Levenshtein, token Jaccard, embeddings) → threshold/classifier → clustering with union-find; MinHash/LSH for near-duplicates at scale; one-to-one assignment with the Hungarian algorithm | Blocking-key index, union-find (disjoint set), similarity cache | O(n²) pairwise comparison without blocking; transitive false merges |
| **Rank / Score / Recommend** | Order items by value | Scoring function + top-k heap (O(n log k)), learning-to-rank, collaborative filtering / matrix factorization, content similarity | Heap, sorted set, precomputed score table, embeddings | Sorting everything for top-k; feedback loops and popularity bias |
| **Classify / Predict / Forecast** | Label or estimate a value | Rules → logistic regression → gradient-boosted trees for tabular data; time series: seasonal naive baseline, exponential smoothing, ARIMA, gradient boosting with lag features; probability calibration (Platt, isotonic) | Feature tables, model registry artifacts | Data leakage across time; uncalibrated thresholds |
| **Detect anomaly** | Flag unusual items or periods | Robust z-score / median absolute deviation, seasonal decomposition + residual threshold, CUSUM/EWMA control charts, isolation forest | Rolling-window stats, time-series store | Alert fatigue; seasonality treated as anomaly |
| **Optimize / Allocate / Schedule** | Best decision under constraints | Greedy (with stated approximation), dynamic programming, LP/MILP, constraint programming, min-cost flow, Hungarian assignment, vehicle-routing heuristics, local search / metaheuristics (simulated annealing, tabu) with time limit | Constraint model, adjacency lists for networks | NP-hard formulations without a time limit or optimality gap; objective not matching the map's metric |
| **Generate / Extract (LLM)** | Produce or pull structured content from unstructured input | Structured/constrained output against a schema, retrieval-augmented generation (chunking + retrieval + reranking), few-shot, extract-then-validate, self-consistency for high-stakes fields | Chunk store, vector + lexical index, prompt/version registry | Unvalidated outputs; prompt injection from inputs |
| **Route / Orchestrate** | Decide and coordinate the next step(s) | Finite state machine, DAG execution in topological order, saga (orchestrated or choreographed) with compensations, transactional outbox | State table with version, workflow log, outbox table | Hidden state in code; partial failure without compensation |
| **Trigger / Schedule (time)** | Run something at a time or after a delay | Cron, delay queues, timer wheel, lease-based scheduler for single execution | Scheduled-jobs table with lease/lock, delay queue | Double execution across instances; timezones and DST |
| **Notify / Emit / Integrate** | Tell another system or a person | Transactional outbox + relay, pub/sub, webhooks with signed payloads and retries, rate limiting (token bucket) | Outbox table, message log/queue | Dual writes (DB + message) without outbox; retry storms |
| **Reconcile / Sync** | Make two sources agree | Diff by key + hash, Merkle trees for large sets, change data capture (CDC), conflict resolution: last-write-wins, version vectors, CRDTs, or rules by source authority | Hash per record, watermark/cursor table | Clock skew in last-write-wins; silent overwrite of the authoritative source |
| **Traverse / Dependency** | Follow relationships | BFS/DFS, shortest path (Dijkstra, A*), topological sort, cycle detection, transitive closure | Adjacency lists, closure table, graph store | Unbounded traversal depth; cycles |
| **Hierarchy** | Trees (categories, org charts, BOMs) | Recursive queries, subtree queries | Adjacency list + recursive CTE (simple, frequent writes), closure table (fast reads), materialized path (prefix queries), nested sets (read-heavy, rare writes) | Choosing a structure that doesn't match the read/write ratio |
| **Approve / Review (HUMAN)** | A person decides | Priority queue by urgency/severity, assignment (round-robin, skill-based, load-balanced), SLA timers with escalation, double review for high severity (separation of duties) | Task table with state, assignee, due time; priority index | Queue starvation; reviewers rubber-stamping (measure agreement) |

## 3. Access pattern → structure/index

| Access pattern | Query shape | Structure / index | Notes |
|---|---|---|---|
| Point lookup | `get by key` | Hash index / key-value; B-tree primary key | O(1) / O(log n) |
| Range / ordered | `between`, `order by … limit` | B-tree; sorted set | Composite index column order = equality first, then range |
| Keyset pagination | `where key > cursor order by key limit k` | B-tree on the sort key | Stable under inserts, unlike offset |
| Prefix / autocomplete | `starts with` | Trie; B-tree with prefix range; edge n-gram index | |
| Full-text | Keywords, relevance | Inverted index (BM25) | Language analyzers, stemming |
| Semantic similarity | Nearest neighbors of a vector | ANN index (HNSW, IVF) | Recall vs. latency tradeoff; re-embed on model change |
| Geospatial | Within radius / polygon | R-tree, geohash, S2 cells | |
| Time-window | Last N minutes/days, rollups | Time-partitioned tables, time-series store, pre-aggregated rollups | Partition pruning; retention by partition drop |
| Graph neighborhood | Neighbors, paths | Adjacency list, graph store | |
| Membership test | "Seen before?" | Hash set; Bloom filter (probabilistic, no false negatives) | Idempotency/dedup stores, with TTL |
| Top-k | Best k by score | Heap; sorted set | |
| Work queue (FIFO) | Next item | Queue / log | Visibility timeout, dead letter |
| Priority work | Most urgent item | Priority queue (heap); indexed priority column | |
| Approximate counts | Distinct, quantiles, heavy hitters | HyperLogLog, t-digest, count-min sketch | Mergeable across partitions |
| Append-only history | Audit, event replay | Append-only log / event store | Immutable; snapshots for fast rebuild |
| Hierarchy | Subtree, ancestors | Closure table, materialized path, recursive CTE | See Hierarchy type |

## 4. Store selection heuristics

- Start with **one general-purpose relational store**. Many cover B-tree, full-text, JSON documents, vector (e.g., pgvector) and geospatial (e.g., PostGIS) in one place. Add a specialized store only when a stated access pattern exceeds its limits at the stated volume and latency.
- Pick by **read/write ratio**, **consistency need**, **volume and growth**, **query shape**, and **operational cost** (who runs it, backup, security). Write the deciding factor in the plan.
- **One writer per entity** (from stage 2). Other stores holding the same data (search index, cache, read model) are projections, updated from events or CDC and rebuildable.
- **Caches** need an explicit invalidation trigger and a staleness bound tied to the view's freshness requirement.

## 5. Complexity and scale checkpoints

- State n (records per call and total), growth per period, and calls per second. Without them, mark `[specify]` and plan the simple algorithm.
- Rough thresholds to revisit a choice: O(n²) beyond ~10⁴ items per call; full scans beyond ~10⁶ rows on a latency path; in-memory structures beyond available memory per instance; LLM calls on a hot path where cost/unit or p95 latency breaks the budget.
- Record each switch point as an adapt rule: "if n > X or p95 > Y → move from algorithm A to B".
