# Runbook: OP3 Resolve metadata

Owner: dev lead. Code: `backend/src/biovidgen/scholarly/` (`http.py` transport, `openalex.py` mapping, `resolve.py` cache and store), panel header in `extension/entrypoints/sidepanel/paper.tsx`. Plan: `docs/impl-plans/op/OP3-resolve-metadata.md` (delta D36). Tests: `backend/tests/test_op3.py`, `extension/src/backend/client.test.ts`, `extension/tests/e2e/article.spec.ts`.

## What it does
When the panel has a DOI (detected, picked or typed) and the backend is paired, the panel asks `GET /api/v1/article?doi=<doi>`. The backend answers from its cache, or asks OpenAlex for that one work, and the panel shows authors, journal, year, type, keywords and topic.

- **OpenAlex only.** The spike measured +0 pp coverage from Crossref (D36). Crossref comes back with OP12, for retraction notices.
- **Only the DOI leaves the machine,** plus the fixed field list. No key, no email, no page URL.
- **Cache:** table `articles` in `biovidgen.sqlite3`. Fresh for 30 days. After that the next request asks OpenAlex again; if OpenAlex fails, the old copy is answered with `stale: true`. Rows not refreshed for 90 days are deleted when the backend starts.

## Answers
| Backend answer | Cause | Panel shows |
|---|---|---|
| 200 `{article, stale, saved}` | found | the header; "No se pudo actualizar…" when `stale` |
| 404 `NOT_FOUND` | OpenAlex does not have the DOI | "OpenAlex no tiene este DOI" |
| 503 `UPSTREAM_DOWN` | OpenAlex unreachable after 3 attempts, nothing cached | "No se pudieron obtener los datos" |
| 502 `UPSTREAM_INVALID` | OpenAlex answered something that does not parse, or over 2 MB | same |
| 400 `BAD_DOI` | the DOI is not normalised (a bug in the extension) | same |

`saved: false` means the article could not be stored (disk full or locked). The answer is still correct; it just is not cached.

## Failures and responses
| Failure | Detection | Response |
|---|---|---|
| Many `UPSTREAM_DOWN` | log rows `OP3.openalex` with `error_code` `UPSTREAM_DOWN`, `attempts` 3 | check status.openalex.org. Cached papers keep working |
| `UPSTREAM_INVALID` on every paper | same, `UPSTREAM_INVALID`, status 200 or 400 | OpenAlex changed or dropped a field in `OA_FIELDS` (a bad `select` field is a 400). Run `uv run pytest -k op3_con` against a fresh recording |
| 429 storms | log `status` 429 | single lookups are free and unlimited, with a hard cap of 100 requests/s. Check that nothing is looping |
| A paper shows wrong metadata | student report | compare with `https://api.openalex.org/works/doi:<doi>`. OpenAlex errors are reported to OpenAlex, not patched here |

## Logs
One row per lookup, `op = OP3.openalex`: run id (the panel's, through `X-BVG-Run-Id`), duration, OpenAlex HTTP status, `sizes = {attempts, cached, stale}`. Never the DOI or the URL. The panel logs `OP3.lookup` with the same run id.

## Spike
`uv run python scripts/spike_op3.py <dir outside the repo> [--regional]` repeats the coverage and latency numbers in the plan. It uses the live network and saves raw answers, which may hold abstracts that cannot be redistributed: never commit that directory.

## Acceptance (2026-11-07)
- 62 backend tests for OP3 (one nightly); 4 client tests; 2 e2e. Catalog OP3 39/43. Open: HYP-01..03 and VAL-01 are spike rows, measured in the plan.
- Mutation (OP3-MUT-01, `uv run python scripts/mutation_run.py --unit op3`, target 80%): first run 80.6% found 18 real gaps (cut points, length limits, lone surrogates, the 3-topic cap); tests added, code unchanged; now **98.1%** (101/103). Both survivors are equivalent: `frozen=True` on the upstream models (nothing mutates them), and encoding `/` in the DOI (OpenAlex accepts `%2F`, checked live).
- Cold resolve on the recorded latency profile (OP3-PERF-02, nightly): passes; profile in `backend/tests/fixtures/openalex/latency-profile.json` (numbers only).
- Spike: authors 99.0% / 98.0%, keywords or topics 99.0% / 99.5%, both-host p95 0.78 s / 0.71 s (MEDLINE / Latin American samples).
- Live smoke through the real transport: 5 DOIs, including one with `<>;()` characters and the 1,011-author paper (1 MB, 1.5 s).
