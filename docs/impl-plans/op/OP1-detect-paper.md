# OP1 · Detect paper — Type: Transform/Extract (+ Match: choose the right identifier) · Class: DETERMINISTIC · Service: SVC1 `detect`

Phase P0 · Depends on SVC0 · Source: system-spec-v3 unit index, discovery spec OP1.

## 1. Objective & metrics
- Objective: **maximise correct paper identification subject to never silently picking a cited reference's DOI**. Serves KPI install/week-4 active (H-D1): every downstream feature starts here.
- Formulation: input = live DOM of the active tab (meta tags m ≈ 20–200, DOM nodes n ≈ 2k–60k, ASSUMPTION) + URL. Output = `PageContext{kind, doi?, pmid?, pmcid?, title?, metaKeywords[], resultIds[]}`. Budget: p95 ≤50 ms on the main thread per run; $0; no network.

| Metric | Formula | Unit | Target | Instrument | Alert |
|---|---|---|---|---|---|
| detect_precision | correct DOI / pages where a DOI was returned | % | ≥97 | fixture suite (CI) | <95 on fixtures |
| detect_recall | pages with DOI returned / article pages with a DOI | % | ≥90 | fixture suite | <85 |
| wrong_paper_rate | returned DOI ≠ page article DOI | % | ≤1 | fixture suite incl. reference-heavy pages | >1 |
| detect_ms | duration of `detectPaper()` | ms | p95 ≤50 | local log `{op:"OP1", durationMs}` | p95 >100 in perf test |
`runId` is not created here: OP1 runs on page events; the side panel creates `runId` when it consumes `PaperDetected` and logs OP1 duration under it.

## 2. Hypothesis tests
| Hypothesis | Falsifier | Data & sample | Protocol | Threshold | If false → |
|---|---|---|---|---|---|
| H1 Input: ≥90% of target article pages expose `citation_doi` / `dc.identifier` / `prism.doi` / JSON-LD | <90% in sample | 60 saved pages: PubMed, PMC, Europe PMC, bioRxiv, medRxiv, Elsevier/ScienceDirect, Springer, Wiley, MDPI, Frontiers, PLOS, BMC, SciELO, Redalyc `[specify final list Q2]` | spike in P0, store as fixtures | ≥90% | invest in `sites.json` selectors; raise priority of URL patterns |
| H2 Method: meta-first cascade beats "first DOI in body" on precision | cascade precision ≤ body-regex precision | same 60 pages + 20 reference-heavy pages | compare both on fixtures | cascade ≥97% and > baseline | revisit cascade order |
| H3 Problem: reference DOIs appear in body on most article pages (the trap exists) | <20% of pages have >1 distinct DOI in body | same | count distinct body DOIs | ≥20% | keep the guard anyway (cheap) but drop the candidate-picker UI from P0 |
| H4 SPA pages (Europe PMC) settle within 2 s after navigation | detection misses on SPA fixtures | 10 SPA navigations (Playwright) | e2e | ≥95% detected | add explicit route hooks per site |

## 3. Security tests
- Identity: content script, isolated world. Grants: C/R/U/D PageContext (own tab). No `chrome.storage` reads of Settings; no network.
- Tests:
  1. `detect` bundle contains no `fetch`/`XMLHttpRequest` (boundary lint + bundle grep in CI).
  2. Messages from content script are accepted by the side panel only if `sender.id === chrome.runtime.id` and `sender.tab.id` matches the active tab; forged message from page context (`window.postMessage`) is ignored.
  3. Hostile meta: `citation_doi` = `10.1/x"><img src=x onerror=alert(1)>` → rejected by DOI regex; no HTML reaches the panel (panel renders with `textContent`).
  4. Length caps: url ≤2048, doi ≤256, title ≤1000, metaKeywords ≤50 items × ≤100 chars; oversize → truncated + `truncated:true`.
  5. Audit: n/a (no state change outside the tab); log entry has no page text except DOI/title.

## 4. Unit tests
- Invariant (property, fast-check): for any generated meta set, `kind === "article"` ⇒ `doi || pmid || title` present.
- Normalisation (table tests): `https://doi.org/10.1000/ABC` → `10.1000/abc`; `doi:10.1000/abc.` → `10.1000/abc` (trailing `.,;)]` stripped); URL-encoded `10.1000%2Fabc` → decoded; whitespace trimmed.
- Edge cases: no meta + no DOI → `kind:"other"`; two different `citation_doi` metas → take first, log `META_CONFLICT`; meta DOI and URL DOI differ → meta wins, log; PubMed page with only `citation_pmid` → `pmid` set, `doi` from `citation_doi` if present; body has 1 distinct DOI and no meta → candidate with `confidence:"regex"`; body has >1 distinct DOI and no meta → `doi:null`, `candidates[≤5]` in document order, `kind:"article"` only if JSON-LD/`og:type=article` present.
- Result-list pages: PubMed `/?term=` → `kind:"result_list"`, `resultIds` = PMIDs from `.docsum-pmid` (selector from `sites.json`); Europe PMC search → ids from result anchors.
- Idempotency: running `detectPaper()` twice on same DOM → deep-equal outputs.
- Debounce: 10 DOM mutations within 500 ms → 1 run.

## 5. Type tests
```ts
type PageKind = "article" | "result_list" | "other";
interface PageContext {           // Zod: PageContextSchema v1
  tabId: number; url: string; kind: PageKind;
  doi: string | null;             // null = looked, none found (never undefined)
  doiSource: "meta" | "jsonld" | "url" | "site_rule" | "regex" | null;
  candidates: string[];           // [] when doi resolved or none found
  pmid: string | null; pmcid: string | null; title: string | null;
  metaKeywords: string[]; resultIds: { type: "doi" | "pmid"; id: string }[];
  truncated: boolean; rulesVersion: string;
}
function detectPaper(doc: Document, url: URL, rules: SiteRules): PageContext;
```
- `doi: null` vs `candidates: []` distinguish "none found" from "ambiguous" (`candidates.length > 1`).
- CI: `tsc --noEmit`; Zod parse of every fixture output; round-trip `JSON.parse(JSON.stringify(x))` equals x; contract test with consumer `scholarly.resolve` (accepts `doi` string matching `/^10\.\d{4,9}\/\S+$/`).

## 6. Value tests
| Consumer | Decision enabled | Value metric | Baseline | Acceptance | Protocol |
|---|---|---|---|---|---|
| OP3 resolve | fetch the right metadata | resolve success on detected DOIs | manual DOI paste (100% effort) | ≥95% of article fixtures resolve without user input | fixtures → recorded OpenAlex responses |
| VW1 header | student confirms paper | "¿Es este el artículo?" prompts shown | — | ≤5% of article fixtures need confirmation | fixtures |
| VW2 badges | list annotation | result ids found on list pages | 0 | ≥95% of visible results on PubMed/Europe PMC fixtures | fixtures |
Cost/unit $0; value positive whenever recall >0.

## 7. Performance tests
| Scenario | Load | Target | Measured | Fails when |
|---|---|---|---|---|
| Large article (60k nodes, 200 meta) | 1 run | p95 ≤50 ms | [pending] | >100 ms |
| PubMed list, 200 results | 1 run | ≤30 ms | [pending] | >60 ms |
| SPA churn | 100 mutations/s for 5 s | ≤10 runs total | [pending] | >10 runs |
| Memory | — | <1 MB retained | [pending] | >5 MB |

## 8. Spec & logic
Algorithm selection:
| Candidate | Time | Space | Quality | Fit |
|---|---|---|---|---|
| **Priority cascade over sources (meta → JSON-LD → URL → site rule → body regex guarded)** | O(m + k) (+ O(L) bounded body scan, L ≤ 20k chars) | O(1) | high precision | **chosen** |
| First DOI in body text | O(n) | O(1) | poor (reference trap) | rejected (H2 baseline) |
| Score all DOIs by DOM position/frequency | O(n) | O(d) | medium | fallback only if H1 fails |

```text
detectPaper(doc, url, rules):
  meta = index <meta name|property → content[]> (single pass over doc.head meta tags)
  pmid  = first(meta["citation_pmid"]) or rules.urlPmid(url)
  pmcid = first(meta["citation_pmcid"]) or rules.urlPmcid(url)
  title = first(meta["citation_title"], meta["dc.title"], meta["og:title"]) |> cap(1000)
  kw    = split(meta["citation_keywords"] ∪ meta["keywords"], /[;,]/) |> trim |> dedupe |> cap(50)
  for (src, raw) in [("meta", meta["citation_doi"]), ("meta", meta["dc.identifier"] filter doi-like),
                     ("meta", meta["prism.doi"]), ("jsonld", jsonLdDoi(doc)),     # @type ScholarlyArticle|MedicalScholarlyArticle; identifier|sameAs
                     ("url", doiFromUrl(url)), ("site_rule", rules.selectorDoi(doc, url))]:
      d = normalizeDoi(raw); if d: return build(kind="article", doi=d, doiSource=src, ...)
  if rules.isResultList(url): return build(kind="result_list", resultIds=rules.extractIds(doc))
  bodyDois = distinct(normalizeDoi(m) for m in DOI_RE.findAll(articleHeaderText(doc, max=20_000)))
  if len(bodyDois) == 1: return build(kind="article", doi=bodyDois[0], doiSource="regex")
  isArticle = jsonLdIsArticle(doc) or meta["og:type"] == "article" or pmid
  return build(kind = isArticle ? "article" : "other", doi=null, candidates=bodyDois[:5], pmid, title)

normalizeDoi(s): s = decodeURIComponent(trim(s)); strip /^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i;
                 strip trailing [.,;)\]]+; lowercase; return DOI_RE_STRICT.test(s) ? s : null
DOI_RE_STRICT = /^10\.\d{4,9}\/[-._;()\/:a-z0-9<>]+$/  (Crossref-recommended pattern, lowercase after normalisation)
```
`articleHeaderText` = text of `<article> header`, `.abstract`, first `<h1>` region; excludes elements matching `ol.references, #references, .ref-list, [role=doc-bibliography]`.
Data structures: `Map<string, string[]>` for meta index (point lookup); `Set<string>` for distinct body DOIs; `sites.json` = array of `{hostPattern, urlDoi?, urlPmid?, selectorDoi?, listPattern?, listIdSelector?}` compiled once to RegExp. No persistent storage (PageContext lives in memory per tab; access pattern = get by tabId).
DETERMINISTIC build: rules in code + `sites.json` (version `rulesVersion`, semver). Each site entry has ≥1 fixture.
Operation properties: idempotent (pure function); no transaction; retry = re-run on debounced `MutationObserver` (500 ms, subtree, childList) and on `popstate`/`navigation` events; concurrency: latest run wins (monotonic counter); stateless.

## 9. Bottlenecks & trade-offs
- Bottleneck: body regex on huge pages → bounded to 20k chars of header region; reference lists excluded.
- Trade-off: precision over recall — ambiguous pages return candidates instead of guessing (costs a click; prevents RPN-112 failure).
- Trade-off: `sites.json` maintenance vs generality — generic meta first keeps the table small; add a site only with a fixture.
- Rejected: ML page classifier (Laya etc.) — rules + meta cover the need at $0. Reopen if `kind` misclassification >5% on fixtures.

## 10. Dependencies
| Dependency | Kind | Pinned | Failure behaviour | Blocks |
|---|---|---|---|---|
| SVC0 messaging + log | service | contracts v1 | n/a | 5 |
| `sites.json` | config | rulesVersion | missing entry → generic path | 6 |
| Zod | library (MIT) | lockfile | — | 3 |
| fast-check | library (MIT, dev) | lockfile | — | 2 |
| Saved HTML fixtures | test data | `fixtures/pages/*` | — | 1 |

| # | Task | Depends | Estimate | Done when |
|---|---|---|---|---|
| 1 | Collect 60 article + 20 reference-heavy + 6 list fixtures; label expected PageContext | — | 1–1.5 d | fixtures committed with labels (H1/H3 measured) |
| 2 | Write unit/property/type tests (steps 4–5) — red | 1 | 0.5 d | tests fail |
| 3 | Write security tests 2–4 and bundle-network lint — red | — | 0.5 d | tests fail |
| 4 | Perf tests (step 7) with Playwright on 2 large fixtures — red | 1 | 0.5 d | harness runs |
| 5 | Implement `normalizeDoi`, meta index, cascade, guarded regex | 2,3 | 1 d | steps 2–5 green |
| 6 | `sites.json` v1 for PubMed, Europe PMC, bioRxiv/medRxiv, ScienceDirect | 5 | 0.5–1 d | list + site fixtures green |
| 7 | MutationObserver debounce + SPA e2e (H4) | 5 | 0.5 d | H4 ≥95% |
| 8 | Emit `PaperDetected`; panel consumption + confirmation prompt for candidates | 5, SVC1 | 0.5 d | VW1 shows header or prompt |
| 9 | Rollout: shadow in team build on 3 publishers (P0 exit) | 8 | — | precision ≥97% on fixtures, no wrong-paper on team usage log |
