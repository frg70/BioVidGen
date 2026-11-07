# Runbook: OP5V Validate evidence

## What it does
OP5V is the product's core guarantee: a quote shown as verified exists word for word in the paper. It takes the model's drafts, finds each quote in the article text after a fixed normalisation, checks that every number in the summary appears in a verified quote, and stores the result. It never matches approximately (rule 5).

There are two implementations:
- **`backend/src/biovidgen/summary/`** is what the product will run (ADR-0010). `validate.py` is the only writer of `summaries` (rule 4).
- **`extension/src/summary/`** is the TypeScript reference. The Python port is tested against vectors frozen from it.

## Statuses
| Status | Meaning |
|---|---|
| `verified` | No rejected quote, at least one quote, no unsupported number |
| `no_verificado` | A quote was not found or was the wrong length, there were no quotes, or a number has no support |
| `abstract_only` | The source was only the abstract. Quotes are still checked |
| `failed` | The draft did not match the schema |

If every section failed, nothing is stored and the code is `ALL_SECTIONS_FAILED`.

## Symptoms
| Symptom | Likely cause | What to do |
|---|---|---|
| A quote that is not in the paper shows as verified | **Stop-ship.** Treat as an incident, turn off `summary.enabled` | Add the pair as a test first. Look at the normaliser and `find_quote` |
| Many real quotes rejected | The model changes more than the normaliser folds (H2) | Collect examples through eval. Do not add fuzzy matching. Any new fold needs a version bump |
| `STORE_FAILED` in the log | The database stayed locked or unavailable after one retry | Check for a second backend process (see `docs/runbooks/be0.md`). Nothing was written |
| `OP5V-PERF-01` fails with no code change | CPU is busy: it measures wall time | Check load and rerun before suspecting a regression |
| `OP5V-CFG-01` fails | `normaliser.py` or `.ts` changed | If behaviour changed, bump `NORMALISER_VERSION`, append the new hash, regenerate vectors. If only formatting changed, the same applies until a version has shipped |
| `OP5V-PY-03` fails | The TypeScript reference changed | `cd extension && npm run vectors`, then run the Python tests |
| `OP5V-PY-02` fails after a Python or Node upgrade | A newer Unicode changed the table | Check that the differences are only newly assigned characters, then update the test's version check |

## Differences from the TypeScript reference (delta D34)
On purpose, and both stricter:
- Lone surrogates are refused. JSON can carry them, but SQLite and UTF-8 cannot.
- A quote cannot start or end inside a word written in characters above U+FFFF. The reference treats those as non-word characters.

Python 3.12 has Unicode 15.0 and Node 22 has 16.0. Characters assigned after 15.0 are not folded in Python; they still match themselves exactly.

## Mutation run
`cd backend && uv run python scripts/mutation_run.py` runs on temporary copies, so an interrupted run cannot leave a mutant in the source. About 30 minutes on 4 workers. Target is 90% (OP5V-MUT-01). No scheduled job runs it yet.

Last result (2026-11-06): 93.9%, 248 of 264. 7 kills are `TIMEOUT` lines, all in loop mutants. A timeout outside a loop on a busy machine would be a false kill, so read those lines.

The 16 survivors, none of which changes behaviour:
| Where | Mutant | Why it changes nothing |
|---|---|---|
| `normaliser.py` `space_from`, `space_to` = -1 (4) | -1 to -2 | Only ever compared with `< 0` and `>= 0` |
| `normaliser.py` `i < length` | `<=` | The extra pass reads an empty cluster and folds nothing |
| `normaliser.py` `to -= 1` | `to -= 2` | One more character takes the slow path, with the same result |
| `normaliser.py` `_PLAIN_RUN` | pattern changed | Turns the fast path off; only speed changes |
| `normaliser.py` `space_from >= 0`, `< 0` (4) | boundary moved to 0 or 1 | Differs only for text already written with `space_from` 0, which needs a character folding to text then a trailing space. Checked all code points: none |
| `normaliser.py` `range(128)` | 129 | U+0080 folds to itself either way |
| `normaliser.py` `_FOLD` entry U+2011 | U+2012 | NFKC already turns U+2011 into U+2010 |
| `normaliser.py` `"LN"` | string changed | No Unicode category starts with the added letter |
| `validate.py` `ValidateCode` (2) | string changed | A type alias: never read at run time |

A new survivor outside this table needs a test or a reason added here.

## Not built yet
There is no HTTP endpoint for OP5V: that arrives with the extension client (ADR-0010 step 3).
