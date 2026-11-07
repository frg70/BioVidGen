# BioVidGen — Prompts for implementation sessions

Copy a prompt into Claude Code from the repository root. `CLAUDE.md` loads automatically and imports `memory.md`, so no prompt needs to repeat the rules. Replace the `{…}` placeholders before sending.

---

## 0. One-time: commit the docs

```
Prepare the repo for implementation.

1. Create branch `docs/pipeline-v3` from main.
2. Stage and commit the uncommitted docs, in separate commits:
   - discovery
   - tech-spec v3 + ADR-0008/0009 + system-spec-v3.yaml
   - impl-plans
   - test catalog
   - agent files (CLAUDE.md, docs/agent/)
3. Add one more commit that untracks `.claude/` (decision: fully ignored): `git rm -r --cached .claude`. Files stay on disk.
4. Before committing, show `git status` and the commit plan.
5. Do not push until I confirm.
```

## 1. Kickoff: P0 scaffold (SVC0)

```
Start P0 of BioVidGen. Unit: SVC0 core + repo scaffold.

Read first:
- CLAUDE.md
- docs/agent/memory.md
- docs/agent/reasoning.md (Part A)
- docs/impl-plans/README.md
- docs/impl-plans/p0-services.md (SVC0 and the repo layout)
- the system-wide section (§1) of docs/testing/test-catalog.md

Goal: a buildable, empty-but-wired extension, with every CI gate in place before any feature code.

Scope:
1. Branch `feat/svc0-scaffold`.
2. Create `extension/` with:
   - WXT, TypeScript strict, Preact;
   - entrypoints: content script, side panel, options page, background.
   - Use the WXT and Chrome side-panel docs that are current today. Verify the CLI commands; don't assume them.
3. Tooling:
   - Vitest, fast-check, MSW;
   - Playwright configured to load the unpacked extension in a persistent Chromium context (verify the current Playwright guidance for extensions);
   - ESLint with module-boundary rules matching tech-spec-v3 §2, plus a no-unsanitized/no-innerHTML rule;
   - a licence check that fails on AGPL/GPL;
   - gitleaks.
4. `src/core/`, as the SVC0 plan specifies:
   - Dexie schema v1 with per-module repositories;
   - http client with full-jitter retry, Retry-After support and per-host token bucket;
   - runId; ring-buffer log persisted in a `logs` store with a key whitelist;
   - flags; Zod-validated messaging with sender check; i18n helper.
5. `src/contracts/`: empty Zod module, plus a script that exports JSON Schema for `eval/`.
6. Network-allowlist e2e test (SYS-SEC-01/02/03) running against the empty extension.
7. `npm run catalog -- <UNIT>`: a script that reads docs/testing/test-catalog.md and lists the catalog IDs for a unit that no test name contains.
8. GitHub Actions workflow running lint, typecheck, unit tests, e2e (headless if supported, verify), licences and gitleaks.
9. Add an entry to docs/process-design/dependency-register.md for every new dependency: version, licence, date checked. Stop and ask if a licence is unclear.
10. Update the Commands table in CLAUDE.md to the real commands.

Test-first:
- Write the SVC0 tests first, with catalog IDs in their names: retry/jitter/limiter with fake timers, messaging sender checks, log whitelist, SYS-OBS-01…03, SYS-SEC-01…03 (allowlist), SYS-SEC-12 (no sync storage).
- Show them failing, then implement.

Done when:
- `npm ci && npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run licenses` all pass locally;
- the extension loads unpacked in Chrome, and the side panel opens with an empty state;
- CI is green on the branch;
- memory.md is updated.

Report:
- what was built;
- the exact command output;
- anything you verified or could not verify;
- deviations from the plan as spec deltas.

Do not start OP5V or any feature in this session.
```

## 2. Implement one unit (reuse for every operation, service and view)

```
Implement unit {UNIT_ID} ({unit name}) of BioVidGen.

Read:
- CLAUDE.md
- docs/agent/memory.md
- docs/agent/reasoning.md (Part A, and the Part B rows that mention {UNIT_ID})
- the plan: {docs/impl-plans/op/…md | p0-services.md#… | p0-views.md#…}
- every {UNIT_ID}-* row in docs/testing/test-catalog.md, plus the system-wide (§1) rows that touch this unit

Steps:
1. Branch `feat/{unit-id}-{slug}`.
2. List the catalog IDs you will cover in this PR, and any you defer (with the reason and the gate they belong to: SPIKE, EVAL, PILOT or HUMAN tests are not code).
3. Write the tests first, with IDs in the test names. Run them and paste the failing output.
4. Implement plan §8 (logic, data structures, access patterns), until the tests are green.
   If a test cannot pass as specified, do not weaken it. Add a spec delta to docs/impl-plans/README.md and tell me.
5. Run lint, typecheck, unit tests, e2e for this area, licences, and `npm run catalog -- {UNIT_ID}`. Paste the outputs.
6. Definition of Done:
   - Zod contracts exist;
   - config files have fixtures;
   - log entries carry runId;
   - boundary lint is green;
   - strings are in _locales;
   - views have an a11y check;
   - docs/runbooks/{unit-id}.md exists;
   - the acceptance metric is recorded in memory.md.
7. Update docs/agent/memory.md: check off the unit, record numbers and gotchas.

Stop and ask if you hit:
- any Type 1 change (new permission or host, runtime dependency, schema break, provider default, the privacy/secret rules);
- a `[decide]` item;
- a `[verify]` fact you cannot confirm.

Report:
- tests covered vs deferred;
- command outputs;
- spec deltas;
- open questions.
```

## 3. Run a spike

```
Run spike {S#} for BioVidGen: {question from memory.md spike table}.

Read:
- CLAUDE.md
- docs/agent/memory.md
- the hypothesis rows in {plan file} that this spike feeds ({IDs, e.g. OP12-HYP-01…04})

Rules:
- Spike code lives in `spikes/{s#}-{slug}/` and is throwaway; it is not imported by the extension.
- Use only permissive dependencies.
- Record raw numbers, sample sizes and sources. Recorded API responses go to extension/fixtures/api/ if they will become test fixtures (strip anything non-redistributable).
- Do not tune the design to the result. Compare against each hypothesis's decision threshold and apply the plan's "If false →" column.

Output:
1. Fill in the memory.md spike row: result, date, what it changes.
2. Update the hypothesis rows' "Measured" cells in the plan.
3. If a threshold fails, propose the adapt rule and any ADR change, and wait for my decision.
4. Write a short summary with the numbers.
```

## 4. Review a unit before merge

```
Review branch {branch} for unit {UNIT_ID} against its plan and the test catalog. Do not change code.

Check, and show evidence for each item:
1. `npm run catalog -- {UNIT_ID}`: which catalog IDs have no test. For each, is it deferred to a non-code gate with a reason, or missing?
2. Stop-ship tests touching this unit: all present and passing?
3. Non-negotiable rules 1–10 in CLAUDE.md: any violation in the diff (network hosts, keys, innerHTML, writer boundaries, normaliser version, wording, LLM tools, licences)?
4. Plan §8 conformance: algorithm, data structures, access patterns, retry and idempotency mechanisms. List any undocumented deviation.
5. Definition of Done items.
6. memory.md updated with numbers.

Output: a pass/fail table with evidence (command output or file:line), then the blocking issues first.
```

## 5. End of session

```
We're stopping for today. Update docs/agent/memory.md:
- status and checklist;
- spike results;
- verified facts with dates;
- new gotchas (one line each);
- open decisions that changed;
- a one-line session log entry.

Keep it under about 150 lines: move explanations to reasoning.md or the docs.
Show me the diff before committing.
```

## 6. Plan the next batch of units

```
Run the process-impl-plans method for the next batch listed in docs/impl-plans/README.md ("Next batch"): SVC7, OP11, VW6, VW2 (P1), then OP14, VW4, VW7.

Inputs:
- docs/process-design/system-spec-v3.yaml
- tech-spec-v3.md
- docs/discovery/spec.yaml
- the matching test-catalog rows

Write the plans in the same format as the batch-1 files.
Add any spec deltas to the README table.
Then check the new plans against the test catalog, using the type × operation coverage audit in §2.0, and add missing test rows.
```
