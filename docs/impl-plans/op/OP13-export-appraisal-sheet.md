# OP13 · Export appraisal sheet — Type: Transform/Map (templating) · Class: DETERMINISTIC · Service: SVC5 `workspace`

Phase P0 (Markdown, default template) → P3 (club template, VW4 preview) · Depends on OP5V.

## 1. Objective & metrics
- Objective: **minimise minutes to complete the appraisal sheet subject to never exporting unverified content as verified and always including status + sources + check date**. Serves Conclude stage (OS 12), H-V1.
- Formulation: input = Summary + Article + latest StatusCheck; output = Markdown string (≤20 KB) → clipboard or `.md` download. n = 1; budget ≤50 ms.

| Metric | Formula | Unit | Target | Instrument | Alert |
|---|---|---|---|---|---|
| minutes_to_sheet | pilot timing with vs without export | min | −50% (proposed) | pilot protocol | — |
| export_status_line | exports with status line / exports | % | 100 | snapshot tests | <100 blocks release |
| unverified_leak | `no_verificado` content in default export | count | 0 | snapshot tests | >0 |
| export_ms | duration | ms | ≤50 | log | >200 |

## 2. Hypothesis tests
| Hypothesis | Falsifier | Data | Protocol | Threshold | If false → |
|---|---|---|---|---|---|
| H1 Problem: students copy summary content into their sheet manually today | <50% of 10 club members do | moderator + 10 students | ask/observe during P1 concierge (fake-door "Exportar" in concierge PDF) | ≥50% | keep export minimal (clipboard only), drop VW4 |
| H2 Method: one Markdown template covers the club's sheet with ≤3 manual edits | >3 edits | club sheet format (Q6) + 5 exports | moderator review | ≤3 | add second template (CASP-like) |

## 3. Security tests
- Identity: side panel. Grants: R Summary, Article, StatusCheck. No network.
- Tests: (1) Export never contains API keys, runId, provider key names, or diagnostics. (2) Markdown injection: quote text containing `](javascript:` or raw HTML is escaped (`<` → `&lt;`, brackets escaped) — snapshot. (3) Clipboard write only on user gesture (`navigator.clipboard.writeText` inside click handler; test that programmatic call without gesture fails gracefully).

## 4. Unit tests
- Precondition: no StatusCheck → `NO_STATUS` → UI triggers OP12 first, then export.
- Default excludes `no_verificado`/`failed` sections, replaced by line "Sección no verificada — omitida"; option `includeUnverified` adds them under a "NO VERIFICADO" heading.
- `abstract_only` → banner line "Basado solo en el resumen".
- Quotes rendered as blockquotes with section label; `prerequisiteTopics` under "Conocimiento previo (no proviene del artículo)".
- Status line: from `statusText()` (same function as VW1; never "no retractado").
- Determinism: same inputs → byte-identical output (snapshot).

## 5. Type tests
```ts
export(summaryKey: [string, string], templateId: "default" | "club" , opts?: { includeUnverified?: boolean }): Result<string, "NO_STATUS" | "NOT_FOUND">
interface ExportModel { title: string; authors: string; year: string; doi: string; statusLine: string; statusSources: string; checkedAt: string;
  mainTopic: string | null; prerequisites: string[]; sections: { name: string; status: string; summaryEs: string | null; quotes: { text: string; section: string }[] }[]; generatedWith: string }
```
- Template files `workspace/templates/{id}.md` (Mustache syntax) versioned; a test renders every template with a fixture model (no missing variables).

## 6. Value tests
| Consumer | Decision | Value metric | Baseline | Acceptance | Protocol |
|---|---|---|---|---|---|
| Student / moderator | sheet assembled and defended with quotes | minutes_to_sheet; moderator rating of sheet evidence | manual | −50% time; rating ≥ baseline | P4 pilot |

## 7. Performance tests
| Scenario | Load | Target | Measured | Fails when |
|---|---|---|---|---|
| Full summary, 20 quotes | 1 | ≤50 ms | [pending] | >200 ms |

## 8. Spec & logic
| Candidate | Fit |
|---|---|
| **Mustache (MIT), logic-less templates over a prepared ExportModel** | chosen: templates editable by non-devs; logic stays in TS |
| Hand-written string builder | simpler, but templates not editable by moderator |
```text
export(key, templateId, opts):
  s = summary.get(key) ?? err(NOT_FOUND); a = scholarly.getArticle(s.doi_norm); st = scholarly.latestStatus(s.doi_norm) ?? err(NO_STATUS)
  m = buildModel(s, a, st, opts)            # escapes Markdown; filters sections by status; statusText(st)
  return ok(Mustache.render(templates[templateId], m, {}, {escape: identity}))   # escaping done in buildModel
```
Storage: none (templates bundled). Properties: pure, idempotent, no retry, stateless.

## 9. Bottlenecks & trade-offs
- None technical. Trade-off: Markdown (portable, pastes into Docs/Word) over DOCX/PDF generation (heavier libs). Reopen if the club requires a DOCX form.

## 10. Dependencies
| Dependency | Kind | Pinned | Failure behaviour | Blocks |
|---|---|---|---|---|
| mustache.js | library (MIT ⚠️ verify) | lockfile | — | 3 |
| OP5V Summary, OP12 StatusCheck, OP3 Article | operations | v1 schemas | missing status → run OP12 | 3 |
| Club sheet format (Q6) | input from moderator | — | default template | 5 |

| # | Task | Depends | Estimate | Done when |
|---|---|---|---|---|
| 1 | Snapshot/unit/security/type tests — red | — | 0.5 d | failing |
| 2 | Default template (es-MX) | — | 0.25 d | reviewed by QFB |
| 3 | `buildModel` + render + clipboard/download | 1, 2 | 0.5 d | green |
| 4 | Fake-door "Exportar" in P1 concierge material (H1) | OP11 | 0.25 d | counts recorded |
| 5 | Club template (Q6) + VW4 preview | 3, Q6 | 0.5 d | ≤3 manual edits (H2) |
| 6 | Rollout: P0 skeleton (default); P3 club template | 5 | — | pilot use |
