# OP3 · Resolve metadata — Type: Search/Retrieve (point lookup) + Transform + Match (merge two sources) · Class: DETERMINISTIC · Service: SVC2 `scholarly`

Phase P0 · Depends on OP1.

## 1. Objective & metrics
- Objective: **maximise field coverage (authors, keywords, type, topic) for a DOI subject to sending only the DOI off-machine and p95 ≤1.5 s warm / ≤3 s cold**. Serves VW1 header and OP12/OP4 inputs.
- Formulation: input = normalised DOI (1 per call; list pages use OP12 batch, not OP3). Output = `Article`. n = 1; growth = user's reading history (≤ a few thousand Articles per user, ASSUMPTION). Cost: OpenAlex single-entity lookup free/unlimited (dependency register 🟢); Crossref free.

| Metric | Formula | Unit | Target | Instrument | Alert |
|---|---|---|---|---|---|
| resolve_success | resolved / requests | % | ≥97 (with DOI) | log `{op:"OP3", outcome}` | <90 in pilot diagnostics |
| field_coverage | Articles with ≥1 author AND ≥1 keyword / resolved | % | ≥90 | fixture report | <85 |
| resolve_ms | warm (cache) / cold | ms | p95 ≤50 warm, ≤1500 cold | log durationMs | p95 cold >3000 |
| upstream_error_rate | failed calls / calls per host | % | ≤5 | log errorCode | >10 |
Logs carry `runId` from the orchestrator.

## 2. Hypothesis tests
| Hypothesis | Falsifier | Data | Protocol | Threshold | If false → |
|---|---|---|---|---|---|
| H1 OpenAlex has authors for ≥95% and keywords/topics for ≥85% of target health-science DOIs | lower coverage | 200 DOIs sampled from PubMed (2015–2026), stratified by year | spike: recorded responses | ≥95 / ≥85 | add Crossref `subject`, page `citation_keywords` (already merged) and Europe PMC MeSH as 3rd source |
| H2 Method: merging OpenAlex+Crossref+page meta raises coverage vs OpenAlex alone by ≥5 pp | gain <5 pp | same 200 | compute both | ≥5 pp | drop Crossref from the OP3 hot path (keep for OP12) |
| H3 Single lookup cold p95 ≤1.5 s from Mexico | slower | 50 timed calls from a MX connection | spike | ≤1.5 s | show progressive header (title from page meta first) |

## 3. Security tests
- Identity: side-panel orchestrator. Grants: C/R/U Article; outbound to `api.openalex.org`, `api.crossref.org` only.
- Tests: (1) request URL/body contain only DOI, `mailto`/`api_key` params, `select` — assert via fetch mock; no URL of the page, no title, no runId. (2) OpenAlex key (if user set) never logged: log redaction test. (3) Response with HTML in `display_name` (`<script>`) stored as text and rendered with `textContent` (VW1 test). (4) Response >2 MB or non-JSON → `UPSTREAM_INVALID`, nothing stored. (5) Only `scholarly` may write `articles` store (boundary lint).

## 4. Unit tests
- Invariants: `year ≤ currentYear`; every keyword has `source ∈ {page, openalex_keyword, openalex_topic, crossref_subject}`; authors ordered as in source.
- Abstract reconstruction (property): for any token list, `reconstruct(invertedIndex(tokens)) === tokens.join(" ")`; empty index → `null`.
- Merge table tests: OpenAlex missing authors + Crossref has `author[{given,family}]` → Crossref authors; both missing → `[]` (not null: "asked, none found") with `coverage.authors = "none_found"`.
- Cache: fresh (<30 d) → no network; stale → return stale immediately + background refresh; network fail with stale → return stale + `stale:true`; network fail without cache → `UPSTREAM_DOWN`.
- Single-flight: 3 concurrent `resolve(doi)` → 1 network call, 3 identical results.
- Idempotency: two resolves → one record (upsert by `doi_norm`), `fetchedAt` updated.
- Errors: 404 from OpenAlex and Crossref → `NOT_FOUND` (VW1 shows page-meta header only); 429 → retry per SVC0 policy honoring `Retry-After`.

## 5. Type tests
```ts
interface Article {               // ArticleSchema v1 (Zod)
  doi_norm: string; openalexId: string | null; pmid: string | null; pmcid: string | null;
  title: string | null; journal: string | null; year: number | null;
  authors: { name: string; orcid: string | null }[];
  keywords: { term: string; source: "page" | "openalex_keyword" | "openalex_topic" | "crossref_subject"; score: number | null }[];
  primaryTopic: { name: string; field: string | null } | null;
  type: string | null; crossrefType: string | null;
  abstract: string | null; oaUrl: string | null; isOA: boolean | null;
  coverage: { authors: "found" | "none_found"; keywords: "found" | "none_found" };
  fetchedAt: string; sources: ("openalex" | "crossref" | "page")[]; schemaVersion: 1;
}
resolve(doi: string, opts?: { pageMeta?: Pick<PageContext, "title" | "metaKeywords" | "pmid"> }): Promise<Result<Article, "NOT_FOUND" | "UPSTREAM_DOWN" | "UPSTREAM_INVALID">>
```
- Upstream schemas: `OpenAlexWorkSchema` and `CrossrefWorkSchema` (Zod, `.passthrough()` for unknown fields, required fields minimal) validated on every response; recorded fixtures as contract tests (provider-side drift detection).
- `pmcid` needed by OP4 (Europe PMC JATS) — see spec delta D3.

## 6. Value tests
| Consumer | Decision | Value metric | Baseline | Acceptance | Protocol |
|---|---|---|---|---|---|
| VW1 header | student knows authors/keywords/topic | field_coverage | page meta only (measure) | ≥ baseline +10 pp | fixture comparison |
| OP12 | type for preprint rule | `type` present | — | ≥97% | fixtures |
| OP4 | pmcid / oaUrl for text | pmcid present when PMC exists | — | ≥95% of PMC fixtures | fixtures |

## 7. Performance tests
| Scenario | Load | Target | Measured | Fails when |
|---|---|---|---|---|
| Warm cache | 100 sequential resolves | p95 ≤50 ms | [pending] | >100 ms |
| Cold, OpenAlex + Crossref parallel | 50 DOIs, 1 at a time | p95 ≤1.5 s | [pending] | >3 s |
| Concurrency | 10 parallel distinct DOIs | no 429 from OpenAlex (limiter ≤10 rps) | [pending] | any 429 storm |
| Payload | `select=` fields | ≤30 KB per work | [pending] | >100 KB |

## 8. Spec & logic
Algorithm: two parallel point lookups + deterministic merge (precedence table). Alternatives: OpenAlex only (simpler; rejected unless H2 fails); Semantic Scholar (not verified ⚠️, no need).
```text
resolve(doi, pageMeta):
  cached = db.articles.get(doi)                         # B-tree PK lookup
  if cached and age(cached) < 30d: return ok(cached)
  return singleFlight(doi, async () =>
    [oa, cr] = await allSettled(
       http.get(OPENALEX + "/works/doi:" + encode(doi) + "?select=" + OA_FIELDS + keyParams),
       http.get(CROSSREF + "/works/" + encode(doi) + "?mailto=" + email?))
    if both failed: return cached ? ok({...cached, stale:true}) : err(classify(oa, cr))
    a = merge(validate(oa), validate(cr), pageMeta)      # precedence below
    db.articles.put(a)                                   # single-record write, Dexie transaction
    return ok(a))

merge precedence:
  title     : openalex.display_name > crossref.title[0] > page.title
  authors   : openalex.authorships[].author.display_name (+orcid) > crossref.author[] (given+family)
  keywords  : dedupe(casefold) of page.metaKeywords ∪ openalex.keywords (score≥0.3 [ASSUMPTION calibrate]) ∪ openalex.topics[:3] ∪ crossref.subject, cap 15, keep source tags
  year      : openalex.publication_year > crossref.issued
  type      : openalex.type ; crossrefType: crossref.type
  pmid/pmcid: openalex.ids.pmid / ids.pmcid (strip URL prefix)
  abstract  : reconstruct(openalex.abstract_inverted_index) > crossref.abstract (strip JATS tags to text)
  oaUrl     : openalex.best_oa_location.pdf_url | landing_page_url ; isOA: openalex.open_access.is_oa
reconstruct(idx): arr = []; for (word, positions) in idx: for p in positions: arr[p] = word; return arr.filter(Boolean).join(" ")   # O(T)
```
Access patterns:
| Pattern | Query | Freq | Volume | Latency | Structure | Store |
|---|---|---|---|---|---|---|
| get by DOI | `articles.get(doi_norm)` | per panel open | ≤10k records/user | ≤50 ms | PK B-tree | IndexedDB `articles` |
| upsert | `put(article)` | per cold resolve | 1 | ≤20 ms | PK | same |
| GC stale | `where fetchedAt < now-90d` delete (SW alarm daily) | daily | ≤10k | background | index `fetchedAt` | same |
In-memory: `Map<doi, Promise>` single-flight table (entries deleted on settle).
Properties: idempotent upsert by PK; atomic single put; retry delegated to SVC0 http (3×, full jitter, honours `Retry-After`), 5 s timeout per host; consistency eventual vs upstream (30 d refresh, stale-while-revalidate); no DLQ.

## 9. Bottlenecks & trade-offs
- Cold latency dominated by the slower of two hosts → parallel calls; VW1 renders page-meta title immediately (progressive), metadata fills in.
- Trade-off: Crossref on hot path costs latency for coverage; keep only if H2 shows ≥5 pp gain.
- Keyword score threshold trades noise vs recall; calibrate on the 200-DOI sample.
- Rejected: title-based search to resolve DOI-less pages in P0 (wrong-match risk RPN 48, costs $1/1,000 searches); reopen on user request feature in P3+.

## 10. Dependencies
| Dependency | Kind | Pinned | Failure behaviour | Blocks |
|---|---|---|---|---|
| OpenAlex Works API | external | `select` field list v1; recorded fixtures | 5 s timeout, retry, stale cache, Crossref-only | 4 |
| Crossref REST | external | fixtures | same; OpenAlex-only | 4 |
| SVC0 http/limiter, db | service | v1 | — | 4 |
| OP1 PageContext | operation | PageContextSchema v1 | missing DOI → OP3 not called | — |

| # | Task | Depends | Estimate | Done when |
|---|---|---|---|---|
| 1 | Spike H1/H2/H3: 200-DOI sample, record responses as fixtures | — | 1 d | coverage + latency numbers in this file |
| 2 | Unit/type/security tests (steps 3–5) incl. upstream Zod schemas — red | 1 | 1 d | failing |
| 3 | Perf harness (warm/cold) — red | 1 | 0.5 d | runs |
| 4 | Implement clients, merge, reconstruct, single-flight, cache | 2 | 1.5 d | green |
| 5 | SW daily GC alarm | 4 | 0.25 d | test green |
| 6 | Wire to orchestrator; emit `ArticleResolved` | 4 | 0.25 d | VW1 header populated |
| 7 | Rollout: team shadow (P0 exit) | 6 | — | resolve_success ≥97% on team usage |
