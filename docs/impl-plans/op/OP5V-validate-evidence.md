# OP5V · Validate evidence — Type: Validate (+ Persist: sole writer of Summary) · Class: DETERMINISTIC · Service: SVC4 `summary`

Phase P0 (before any model exists) · Depends on OP4. This op carries the product's core guarantee: **a quote shown as verified exists verbatim in the paper**.

## 1. Objective & metrics
- Objective: **minimise false accepts to zero subject to false rejects ≤10% on real model output**. Serves quote_validity = 100% (H-V2, H-S1).
- Formulation: input = SectionDraft (≤4 per paper; ≤5 quotes per section, each 20–400 chars) + ArticleText section (≤60k chars). Output = Summary section status + offsets. n tiny; budget ≤20 ms per paper.

| Metric | Formula | Unit | Target | Instrument | Alert |
|---|---|---|---|---|---|
| false_accept | adversarial non-quotes accepted / adversarial items | count | 0 | property + adversarial suite (CI) | >0 blocks merge |
| false_reject | true quotes rejected / true quotes (model-output fixtures + gold) | % | ≤10 | eval (VW7) | >10 |
| number_rule_violations | sections failing numbers rule / sections | % | tracked | eval + local log | jump >2× vs previous prompt |
| reject_rate_per_provider | no_verificado sections / sections | % | tracked | diagnostics export | >30 |
| validate_ms | duration | ms | p95 ≤20 | log | >100 |

## 2. Hypothesis tests
| Hypothesis | Falsifier | Data | Protocol | Threshold | If false → |
|---|---|---|---|---|---|
| H1 Method: normalised case-insensitive substring has 0 false accepts on an adversarial set | any accept | 500 generated near-quotes (one-word swaps, negation insertion "no", number changes 0.05→0.5, reordered clauses, merged sentences) | property tests (fast-check) | 0 | tighten normaliser (remove case folding) |
| H2 Input: model quotes differ from source mostly by whitespace/hyphen/quote/ligature/case variants | >10% false rejects after normalisation | 200 quotes from S1/S5 spike outputs vs their source text | eval | ≤10% | add specific normalisations measured from failures (never fuzzy match) |
| H3 Numbers rule catches unsupported numeric claims | planted-number summaries pass | 100 summaries with injected numbers absent from quotes | test | 100% caught | extend number regex |

## 3. Security tests
- Identity: side panel, inside `summary` module. Grants: **C Summary (only writer)**; R ArticleText, draft.
- Tests: (1) Boundary lint: no module other than `summary/validate.ts` imports the `summaries` table writer. (2) Draft containing HTML/JS in `summaryEs` stored as text; VW1 renders via `textContent` (snapshot). (3) Draft claiming `section:"__proto__"` or unknown → `SCHEMA_INVALID` (Zod enum). (4) Oversized draft (summaryEs >2,000 chars, >5 quotes) → section `failed`. (5) No article text written to logs (only lengths and statuses).

## 4. Unit tests
- Invariants (property): for every stored section with `status:"verified"`, every evidence quote satisfies `normalize(sectionText).includes(normalize(quote))` and `start/end` map back to the original text so `original.slice(start,end)` normalises to the quote.
- Normaliser table tests: `“ ” ‘ ’` → `" '`; `‐ ‑ ‒ – — −` → `-`; `ﬁ ﬂ` → `fi fl` (NFKC); `U+00AD`, `U+200B–U+200D`, `U+FEFF` removed; runs of whitespace → single space; case folding (`toLocaleLowerCase("und")`). PDF de-hyphenation already applied by OP4, not here.
- Quote length: <20 chars or <4 words → invalid (`QUOTE_TOO_SHORT`); >400 chars → invalid.
- Section placement: quote found in a different section → accepted, `section` corrected, log `SECTION_MISMATCH`.
- Numbers rule: extract from `summaryEs` with `/[-+±]?\d+(?:[.,]\d+)?\s?%?/g`; canonicalise (`0,05`→`0.05`, strip spaces before `%`); each must appear in the canonicalised union of that section's verified quotes. Years and sample sizes included. Numbers written as words are a documented gap.
- Status rule (strict): any invalid quote OR no quotes OR numbers rule fails → `no_verificado`; schema failure → `failed`; `abstract_only` source → status `abstract_only` (quotes still validated).
- `prerequisiteTopics` never get `verified` (no quotes expected) and keep label `background_knowledge`.
- Idempotency: same (draft, text) → identical Summary (deterministic ordering of evidence by `start`).
- Atomicity: Summary written in one Dexie transaction; failure → nothing written.

## 5. Type tests
```ts
interface SectionDraft {          // SectionDraftSchema v1 — what OP5 (or the stub) must return
  section: SectionName; summaryEs: string;                 // ≤2,000 chars
  evidence: { quote: string; section: SectionName }[];     // 0..5
  notReported?: boolean;                                    // model says section absent
  design?: string | null; n?: number | null; statistics?: string[];   // methodology only
}
interface SummarySection {
  summaryEs: string; status: "verified" | "no_verificado" | "abstract_only" | "failed";
  evidence: { quote: string; section: SectionName; start: number; end: number }[];
  rejected: { quote: string; reason: "NOT_FOUND" | "QUOTE_TOO_SHORT" | "QUOTE_TOO_LONG" }[];
  numbersUnsupported: string[];
  coverage: "full" | "partial";                            // partial = OP5 pre-selected paragraphs (delta D7)
}
interface Summary { doi_norm: string; pipelineVersion: string; mainTopic: string | null;
  prerequisiteTopics: { topic: string; label: "background_knowledge" }[];
  sections: Partial<Record<"methodology" | "results" | "conclusions", SummarySection>>;
  provider: string; modelId: string; promptHash: string; normaliserVersion: string; createdAt: string; schemaVersion: 1 }
validateAndStore(doi: string, drafts: SectionDraft[], text: ArticleText, meta: ProviderMeta): Promise<Result<Summary, "ALL_SECTIONS_FAILED">>
```
- JSON Schema exported from Zod for SVC7 eval (same shapes).
- Compatibility test: v1 fixtures parse under current schema (additive-only).

## 6. Value tests
| Consumer | Decision | Value metric | Baseline | Acceptance | Protocol |
|---|---|---|---|---|---|
| VW1 student | trust or check a claim | planted-error detection with quotes vs without (H-V2 task) | free ChatGPT summary | more errors detected | P1 blind test (concierge items pass through OP5V too) |
| OP13 export | include only verified sections | unverified sections exported | — | 0 by default | snapshot |
| Eval (VW7) | gate decision | false_reject on gold | — | ≤10% | P2/P3 |

## 7. Performance tests
| Scenario | Load | Target | Measured | Fails when |
|---|---|---|---|---|
| 4 sections × 5 quotes, 60k-char sections | 1 paper | p95 ≤20 ms | [pending] | >100 ms |
| Normalised index map build for 200k chars | 1 | ≤30 ms, ≤10 MB | [pending] | >100 ms |

## 8. Spec & logic
| Candidate | Time | Guarantee | Fit |
|---|---|---|---|
| **Normalise both + exact `includes` + offset map** | O(n + m) avg (V8 string search) | exact | **chosen** |
| Fuzzy match (Levenshtein ≤k, token Jaccard) | O(n·m) | weakens the promise | rejected: a near-quote can flip meaning (negation) |
| Suffix automaton/array over section | O(n) build, O(m) query | exact | only if p95 breaks (it won't at n=60k) |

```text
validateAndStore(doi, drafts, text, meta):
  idx = {}                                   # per section: normalised string + offset map
  for name, s in text.sections: idx[name] = normalizeWithMap(s.text)   # map[i] = original index of normalised char i
  out = {}
  for d in drafts:
    if !SectionDraftSchema.safeParse(d).success: out[d.section] = failed(); continue
    ev = []; rej = []
    for q in d.evidence:
      nq = normalize(q.quote)
      if words(nq) < 4 or len(nq) < 20: rej.push(TOO_SHORT); continue
      if len(nq) > 400: rej.push(TOO_LONG); continue
      hit = findIn(idx[q.section], nq) ?? firstHit(otherSections(idx), nq)    # section correction
      if !hit: rej.push(NOT_FOUND); continue
      ev.push({quote: original.slice(map[hit.i], map[hit.i+len(nq)-1]+1), section: hit.section, start, end})
    nums = canonNumbers(d.summaryEs) − canonNumbers(join(ev.quote))
    status = text.source=="abstract_only" ? "abstract_only"
           : (rej.empty and ev.nonEmpty and nums.empty) ? "verified" : "no_verificado"
    out[map(d.section)] = {summaryEs: d.summaryEs, status, evidence: sortBy(ev,"start"), rejected: rej, numbersUnsupported: nums, coverage: d.coverage}
  if all(out, s => s.status=="failed"): return err(ALL_SECTIONS_FAILED)
  summary = build(doi, meta, out); db.transaction("rw", summaries, () => summaries.put(summary)); return ok(summary)
```
Data structures: per-section normalised string + `Int32Array` offset map (O(n) memory, built once per paper); `Set<string>` for canonical numbers. Storage: IndexedDB `summaries` PK `[doi+pipelineVersion]`, index `doi`, `createdAt` (latest by DOI; recent 50 — consolidated in SVC4).
Config: `summary/normaliser.ts` exports `NORMALISER_VERSION`, which is part of `pipelineVersion`.
Properties: idempotent (PK = doi+pipelineVersion, put overwrites identical content); atomic transaction; no retry (pure); no concurrency issue (single writer, one run per doi via orchestrator single-flight).

## 9. Bottlenecks & trade-offs
- Not a performance bottleneck. The real cost is **false rejects** hiding good sections; measured, fixed by adding specific normalisations only.
- Trade-off taken: strict status (any bad quote ⇒ whole section `no_verificado`) — gives up partial display for a simpler, stronger promise. Reopen if false_reject >10% and most failures are one bad quote among good ones; then option "drop bad quote + show warning", decided by QFB.
- Honest limit (carried from v2): validates that quotes exist, not that `summaryEs` follows from them; numbers rule + side-by-side UI + agreement eval cover the rest.

## 10. Dependencies
| Dependency | Kind | Pinned | Failure behaviour | Blocks |
|---|---|---|---|---|
| OP4 ArticleText | operation | v1 + normaliser in OP4 for pdf | missing section → quotes NOT_FOUND | 4 |
| Dexie (`summaries`) | library/store | schema v1 | transaction abort → `failed`, nothing stored | 4 |
| fast-check | library (dev) | lockfile | — | 1 |
| Zod | library | lockfile | — | 2 |

| # | Task | Depends | Estimate | Done when |
|---|---|---|---|---|
| 1 | Adversarial generator + property tests (H1, H3) — red | — | 1 d | failing |
| 2 | Unit/type/security tests (steps 3–5) — red | — | 1 d | failing |
| 3 | Perf test — red | — | 0.25 d | runs |
| 4 | Implement normaliser + offset map + findIn + numbers rule + status + store | 1–3 | 1.5 d | all green; 0 false accepts |
| 5 | Wire stub OP5 → OP5V → VW1 (P0 skeleton) | 4, OP5 stub | 0.5 d | skeleton shows sections with statuses |
| 6 | H2 measurement on S1/S5 spike outputs; add measured normalisations | 4, S1, S5 | 0.5 d | false_reject ≤10% |
| 7 | Rollout: in P0 skeleton; required gate for P3 shadow | 5 | — | CI gate active (merge blocked on any false accept) |
