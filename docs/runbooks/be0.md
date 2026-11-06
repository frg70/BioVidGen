# Runbook — BE0 local Python backend (skeleton)

Owner: dev lead. Code: `backend/`. Decision: ADR-0010. Tests: `backend/tests/` (catalog §1.10, BE0-*).

## What it is
One Python process on the student's machine, listening on `127.0.0.1:<port>` (default 8765). It will hold all domain logic and storage for both the Chrome extension and the local web app. Today it serves `/health` (public) and `/api/v1/status` (needs the token) only.

## Request boundary (in order)
| Check | Refusal | Why |
|---|---|---|
| Host is `127.0.0.1:<port>` or `localhost:<port>` | 403 `FORBIDDEN_HOST` | DNS rebinding: a website pointing its own name at 127.0.0.1 |
| Origin absent, or the extension's `chrome-extension://<id>`, or the backend's own origin | 403 `FORBIDDEN_ORIGIN` | any web page can send requests to localhost |
| `OPTIONS` preflight: answered with the exact origin, never `*` | — | CORS for the extension |
| POST/PUT/PATCH need `Content-Length` ≤ 1 MB | 411 `LENGTH_REQUIRED`, 413 `BODY_TOO_LARGE` | memory exhaustion |
| `X-BVG-Token` equals `<data dir>/token` (constant-time) on every path except `/health` | 401 `UNAUTHORIZED` | other local programs and pages |

## Data
| Item | Where |
|---|---|
| Data dir | Windows `%LOCALAPPDATA%\BioVidGen`, macOS `~/Library/Application Support/BioVidGen`, Linux `$XDG_DATA_HOME/biovidgen`; override `BIOVIDGEN_DATA_DIR` |
| Pairing token | `<data dir>/token`: 64 hex chars, created once, 0600 on POSIX. A secret (CLAUDE.md rule 2) |
| Database | `<data dir>/biovidgen.sqlite3`: WAL; `PRAGMA user_version` = number of applied migrations (`db.py` MIGRATIONS, append-only) |
| Log | table `logs`, newest 200 rows: run_id, route name, status, error code, duration. No path, query, body, token or origin |

## Failures and responses
| Failure | Detection | Response |
|---|---|---|
| Extension says "backend off" | `/health` unreachable | start it: `uv run biovidgen` (packaging is ADR-0010 step 5) |
| Every API call is 401 | log rows `UNAUTHORIZED` | re-pair: paste `<data dir>/token` into the panel (`docs/runbooks/be1.md`) |
| `corrupt pairing token file` at startup | process exits | delete `<data dir>/token`, restart, re-pair |
| 403 `FORBIDDEN_ORIGIN` from the extension | log rows `FORBIDDEN_ORIGIN` | set `BIOVIDGEN_EXTENSION_IDS` to the extension's id (`chrome://extensions`). Unpacked builds get a path-based id |
| Port in use | uvicorn exits at startup | `BIOVIDGEN_PORT=<free port>` for the local app only: the extension knows only 8765 (delta D35) |
| Licence gate fails in CI | `backend` job | replace the package, or (dev-only, permissive) extend `DEV_EXTRA` with a dependency-register entry. Never add GPL-family licences |
| BE0-SEC-10 fails | `backend` job | an HTTP client, certifi or a telemetry SDK entered the runtime closure; remove it (CLAUDE.md rules 1 and 8) |

## Local setup
```
cd backend
uv sync --locked
uv run pytest
uv run biovidgen        # http://127.0.0.1:8765/health
```

## Acceptance (BE0)
17/17 pytest, ruff clean, licence gate passed (25 packages), smoke run: listens on 127.0.0.1 only, no `Server` header, rebinding Host → 403, token → 200.
