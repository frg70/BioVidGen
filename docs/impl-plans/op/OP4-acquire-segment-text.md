# OP4 · Acquire & segment text — Type: Transform/Extract (+ Route: source fallback chain) · Class: DETERMINISTIC · Service: SVC3 `text`

Phase P0 (DOM + Readability + headings) → P2 (Europe PMC JATS, pdf.js, structured-abstract split) · Depends on OP3.

## 1. Objective & metrics
- Objective: **maximise share of article pages yielding usable, correctly bounded sections subject to visible-text-only input (injection defence), session-only storage (copyright) and p95 ≤1.5 s**. Serves H-S2 and every OP5/OP5V call.
- Formulation: input = active tab DOM (n ≈ 2k–60k nodes) or JATS XML (≤ ~1 MB) or PDF (≤ 20 MB, P2). Output = `ArticleText{source, sections, usable}`. Total text ≤200k chars (cap).

| Metric | Formula | Unit | Target | Instrument | Alert |
|---|---|---|---|---|---|
| usable_text | pages with `usable=true` / article pages | % | ≥70 | 50-page fixture set per release | <70 |
| boundary_accuracy | sections whose start/end within ±1 paragraph of label / labelled sections | % | ≥85 | 30-page labelled subset | <80 |
| hidden_text_leak | hidden-element text present in output | count | 0 | injection fixtures | >0 |
| acquire_ms | DOM path duration | ms | p95 ≤1500 | log | >3000 |

## 2. Hypothesis tests
| Hypothesis | Falsifier | Data | Protocol | Threshold | If false → |
|---|---|---|---|---|---|
| H1 Input (H-S2): ≥70% of target pages expose full text in DOM with IMRaD-like headings | <70% | 50 pages across fixture publishers, student-reachable (OA or institutional access `[specify]`) | P0 spike | ≥70% | prioritise Europe PMC JATS (P0 instead of P2); companion PDF path ADR |
| H2 Method: heading-dictionary segmentation ≥85% boundary accuracy vs annotator labels | <85% | 30 pages labelled by dev + QFB check | fixtures | ≥85% | add per-site section selectors (`<section data-title>`, `sec-type`) |
| H3 JATS (Europe PMC) gives ≥95% boundary accuracy when available | lower | 20 PMC OA articles | fixtures | ≥95% | treat JATS as equal to DOM |
| H4 Structured abstracts (BACKGROUND/METHODS/RESULTS/CONCLUSIONS) exist in ≥40% of abstract-only cases | <40% | 50 PubMed abstracts | count | ≥40% | abstract-only mode shows abstract as single section |

## 3. Security tests
- Identity: content-script part (DOM read) + side-panel part (Europe PMC fetch, pdf.js). Grants: C/R ArticleText. Outbound: `www.ebi.ac.uk` (Europe PMC) only in P0–P2; other OA origins only via runtime optional permission (spec delta D2).
- Tests: (1) **hidden text**: fixture page with `display:none`, `visibility:hidden`, `aria-hidden`, `opacity:0`, 1px font, off-screen absolute, white-on-white text containing "IGNORE PREVIOUS INSTRUCTIONS" → none of it in output (uses `checkVisibility({checkOpacity:true, checkVisibilityCSS:true})` + size/off-screen check; white-on-white handled by contrast check of computed colour vs background where cheap, else documented gap). (2) Output is plain text only (no HTML tags survive; DOMPurify on Readability HTML, then `textContent`). (3) `<script>`, `<style>`, `<noscript>`, `<template>` content never extracted. (4) Size caps: >200k chars → truncated with `truncated:true`. (5) ArticleText never written to IndexedDB unless `pinned` (storage spy test). (6) pdf.js runs with `isEvalSupported:false` and worker from extension bundle (no remote worker).

## 4. Unit tests
- Heading matcher (table): "Materials and Methods", "MATERIAL Y MÉTODOS", "2. Methods", "Patients and methods", "Métodos" → `methods`; "Results and Discussion" → `results` + flag `merged_with: discussion`; unknown heading → child of current top-level section.
- Nesting: h2 Methods > h3 Statistical analysis → stays in `methods`.
- Structured abstract split: "BACKGROUND: … METHODS: … RESULTS: … CONCLUSIONS: …" → 4 sections, `source:"abstract_only"`.
- Normalisation: NFC; collapse whitespace; soft hyphen U+00AD removed; for `pdfjs` only, de-hyphenate `word-\nword` when the joined token is in the page's own token set.
- `usable = len(methods) ≥ 300 && len(results) ≥ 300` (ASSUMPTION; calibrate in H1 spike).
- Fallback chain: DOM unusable + pmcid present → JATS; JATS fails → abstract (from OP3) → `abstract_only`; nothing → `NO_TEXT`.
- Idempotency: same DOM → same `contentHash` (SHA-256 of normalised sections JSON).

## 5. Type tests
```ts
type SectionName = "abstract" | "introduction" | "methods" | "results" | "discussion" | "conclusions";
interface ArticleText {          // ArticleTextSchema v1
  doi_norm: string; contentHash: string;
  source: "dom" | "oa_xml" | "pdfjs" | "abstract_only";
  sections: Partial<Record<SectionName, { text: string; headingSeen: string | null; mergedWith: SectionName | null }>>;
  missing: SectionName[];        // asked, not found (distinct from absent key = not applicable)
  language: string | null; usable: boolean; truncated: boolean; headingsVersion: string; schemaVersion: 1;
}
acquire(doi: string, tabId: number): Promise<Result<ArticleText, "NO_TEXT">>
extractDom(tabId) /* CS message */ : { blocks: { tag: string; level: number | null; text: string }[]; lang: string | null }
```
- Contract test with OP5V: quotes are validated against `sections[name].text` exactly as emitted here (same normaliser version recorded in `pipelineVersion`).

## 6. Value tests
| Consumer | Decision | Value metric | Baseline | Acceptance | Protocol |
|---|---|---|---|---|---|
| OP5/OP5V | summarise correct section | verified-section rate on gold set using OP4 output vs gold-provided text | gold text | ≤5 pp lower | P2 eval |
| VW1 | student sees source and coverage | "solo resumen" banner accuracy | — | 100% when abstract_only | fixtures |

## 7. Performance tests
| Scenario | Load | Target | Measured | Fails when |
|---|---|---|---|---|
| DOM 60k nodes, visibility pass + Readability on clone | 1 | p95 ≤1.5 s | [pending] | >3 s |
| JATS 1 MB parse (DOMParser) | 1 | ≤500 ms + network | [pending] | >1.5 s |
| pdf.js 30 pages (P2) | 1 | ≤8 s | [pending] | >15 s |
| Memory peak | 1 | ≤150 MB | [pending] | >300 MB |

## 8. Spec & logic
| Candidate | Time | Quality | Fit |
|---|---|---|---|
| **Readability on visibility-pruned clone + linear heading scan** | O(n) | good on HTML articles | **chosen for DOM** |
| JATS `<sec sec-type>` / `<title>` walk | O(n) | best when available | chosen when pmcid OA (P2; P0 if H1 fails) |
| GROBID / Docling | heavy, server/Python | best for PDFs | rejected for extension (ADR-0006); companion only |

```text
# content script
extractDom(tab):
  hidden = Set()
  for el in TreeWalker(document.body, SHOW_ELEMENT):
      if el.tagName in {SCRIPT, STYLE, NOSCRIPT, TEMPLATE, IFRAME}: hidden.add(path(el)); skip subtree
      if !el.checkVisibility({checkOpacity:true, checkVisibilityCSS:true}) or tinyOrOffscreen(el): hidden.add(path(el)); skip subtree
  clone = document.cloneNode(true); remove nodes at paths in hidden (deepest first)
  art = new Readability(clone, {keepClasses:false}).parse()          # mutates clone only
  html = DOMPurify.sanitize(art.content, {RETURN_DOM:true})
  blocks = linearize(html)    # [{tag:h1-h6|p|li|caption|td, level, text}] in document order; tables kept as tab-separated rows
  return {blocks, lang: document.documentElement.lang}

# side panel
acquire(doi, tab):
  art = scholarly.getArticle(doi)
  dom = msg(tab, "text.extractDom"); t = segment(dom.blocks, "dom")
  if !t.usable and art.pmcid: t = segment(parseJats(fetchEuropePmc(art.pmcid)), "oa_xml")      # P2 (P0 if H1 fails)
  if !t.usable and art.abstract: t = splitStructuredAbstract(art.abstract)                        # abstract_only
  if !t: return err(NO_TEXT)
  t.contentHash = sha256(canonicalJson(t.sections)); cacheSession.set(doi, t); return ok(t)

segment(blocks, source):
  current = "preamble"; out = {}
  for b in blocks:
      if b.isHeading:
          name = matchHeading(normalize(b.text), headingsDict)          # dict lookup on normalised tokens, O(1) per heading
          if name and b.level <= topLevel(current): current = name; continue
      out[current] += b.text + "\n\n"
  map preamble → "introduction" only if no introduction found and preamble ≥ 300 chars after abstract
  return {sections: out, usable: rule, missing: required − keys(out)}
```
Data structures: `Set<string>` of hidden node paths (membership test); heading dictionary = `Map<normalisedHeading, SectionName>` loaded from `text/headings.json` (versioned; es/en synonyms); linear block array (streaming order). Storage: session `Map<doi, ArticleText>` in the side panel; IndexedDB `texts` only when pinned (key `[doi+contentHash]`).
Access patterns: get by DOI (session map, O(1)); pinned get (IndexedDB PK). No other queries.
Properties: idempotent by contentHash; no transaction beyond optional pinned put; retry only network (Europe PMC) via SVC0; concurrency: one acquire per (tab, doi) via single-flight; stateless.

## 9. Bottlenecks & trade-offs
- `checkVisibility` on every element is the cost hot spot (60k calls) → skip subtrees once hidden; measure; if >1 s, restrict to elements containing text nodes.
- Readability can drop methods tables/figure captions → we keep captions and tables as text rows; trade some noise for completeness.
- White-on-white text detection is approximate (documented gap); mitigation is OP5 having no tools and OP5V quotes still being from the visible page in most cases.
- Copyright vs convenience: session-only storage means re-extraction after panel close (≈1 s). Accepted.
- Switch points: usable <70% (H1) → JATS to P0 and companion ADR; pdf.js two-column ordering errors >20% on sample → defer PDFs to companion.

## 10. Dependencies
| Dependency | Kind | Pinned | Failure behaviour | Blocks |
|---|---|---|---|---|
| @mozilla/readability | library (Apache-2.0) | lockfile | parse null → blocks from `<article>`/`<main>` | 5 |
| DOMPurify | library (Apache-2.0/MPL-2.0 dual ⚠️ verify) | lockfile | — | 5 |
| Europe PMC REST (P2) | external | fixtures | timeout 8 s; skip to abstract | 8 |
| pdf.js (P2) | library (Apache-2.0) | lockfile; bundled worker | failure → abstract_only | 9 |
| OP3 Article (pmcid, abstract) | operation | v1 | missing → DOM only | 5 |

| # | Task | Depends | Estimate | Done when |
|---|---|---|---|---|
| 1 | H1/H2 spike: 50 pages, label 30 for boundaries; injection fixture page | — | 1.5 d | numbers recorded |
| 2 | Unit/type/security tests — red | 1 | 1 d | failing |
| 3 | Perf harness — red | 1 | 0.5 d | runs |
| 4 | `headings.json` v1 (es/en) with QFB review | 1 | 0.5 d | reviewed |
| 5 | Content-script `extractDom` (visibility prune, clone, Readability, DOMPurify, linearize) | 2, 4 | 1.5 d | security tests green |
| 6 | `segment`, `splitStructuredAbstract`, contentHash, session cache | 5 | 1 d | unit tests green |
| 7 | Emit `TextAcquired`; VW1 source/"solo resumen" banner | 6 | 0.5 d | VW1 shows source |
| 8 | P2: Europe PMC JATS path | 6 | 1–1.5 d | H3 ≥95% |
| 9 | P2: pdf.js path (line grouping, font-size headings) | 6 | 2–3 d | ≥60% usable on PDF sample (else defer) |
| 10 | Rollout: P0 DOM path in team build; P2 full path to pilot | 7–9 | — | usable ≥70%, boundary ≥85% |
