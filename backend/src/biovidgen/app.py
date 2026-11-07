"""FastAPI app factory. One process serves the extension API and (later) the local web app."""

import contextlib
import re
import sqlite3
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from . import __version__
from .config import Settings
from .db import migrate
from .log import LogEntry, append, is_run_id, new_run_id
from .scholarly import http
from .scholarly.resolve import Fetch, Resolver, forget_old
from .security import (
    CORS_HEADERS,
    PUBLIC_PATHS,
    allowed_hosts,
    allowed_origins,
    load_or_create_token,
    token_matches,
)

BODY_METHODS = frozenset({"POST", "PUT", "PATCH"})
# Normalised DOI, the extension's DOI_PATTERN (src/contracts/page-context.ts) and DOI_MAX.
DOI = re.compile(r"10\.\d{4,9}/[-._;()/:a-z0-9<>]{1,240}")
# Distinct statuses, because the extension's http client drops error bodies.
ARTICLE_ERRORS = {"NOT_FOUND": 404, "UPSTREAM_INVALID": 502, "UPSTREAM_DOWN": 503}


def create_app(settings: Settings, fetch: Fetch = http.fetch) -> FastAPI:
    migrate(settings.db_path)
    forget_old(settings.db_path, time.time())
    resolver = Resolver(settings.db_path, fetch=fetch)
    token = load_or_create_token(settings.data_dir)
    hosts = allowed_hosts(settings)
    origins = allowed_origins(settings)

    # No docs: Swagger UI loads assets from a CDN (egress) and widens the surface (BE0-SEC-09).
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    def health() -> dict[str, object]:
        return {"ok": True, "version": __version__}

    @app.get("/api/v1/status")
    def status() -> dict[str, object]:
        return {"paired": True}

    @app.get("/api/v1/article")
    def article(request: Request, doi: str = "") -> JSONResponse:
        """OP3: the article's metadata from OpenAlex, cached. Only the DOI comes in, and only the DOI goes out."""
        if not DOI.fullmatch(doi):
            return JSONResponse({"error": "BAD_DOI"}, status_code=400)
        result = resolver.resolve(doi, request.state.run_id)
        if isinstance(result, str):
            return JSONResponse({"error": result}, status_code=ARTICLE_ERRORS[result])
        return JSONResponse(result.model_dump(mode="json"))

    # Route names for the log; never log the raw (attacker-controlled) path.
    op_names = {getattr(r, "path", ""): getattr(r, "name", "") for r in app.routes}

    def guard(request: Request) -> tuple[int, str] | None:
        """(status, code) to refuse the request, or None to let it through. Order matters."""
        if request.headers.get("host", "") not in hosts:
            return 403, "FORBIDDEN_HOST"
        origin = request.headers.get("origin")
        if origin is not None and origin not in origins:
            return 403, "FORBIDDEN_ORIGIN"
        if request.method == "OPTIONS":
            return None  # preflight carries no token by design
        if request.method in BODY_METHODS:
            length = request.headers.get("content-length")
            if length is None:
                return 411, "LENGTH_REQUIRED"
            if not length.isdigit():
                return 400, "BAD_REQUEST"
            if int(length) > settings.max_body_bytes:
                return 413, "BODY_TOO_LARGE"
        if request.url.path not in PUBLIC_PATHS and not token_matches(request.headers.get("x-bvg-token"), token):
            return 401, "UNAUTHORIZED"
        return None

    @app.middleware("http")
    async def boundary(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        start = time.monotonic()
        given_run_id = request.headers.get("x-bvg-run-id")
        run_id = given_run_id if given_run_id is not None and is_run_id(given_run_id) else new_run_id()
        request.state.run_id = run_id

        denied = guard(request)
        if denied is not None:
            response: Response = JSONResponse({"error": denied[1]}, status_code=denied[0])
        elif request.method == "OPTIONS":
            response = Response(status_code=204)
        else:
            response = await call_next(request)

        origin = request.headers.get("origin")
        if origin is not None and origin in origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            if request.method == "OPTIONS":
                response.headers.update(CORS_HEADERS)

        error_code = denied[1] if denied else f"HTTP_{response.status_code}" if response.status_code >= 400 else None
        entry = LogEntry(
            at=datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            run_id=run_id,
            op=op_names.get(request.url.path) or "unrouted",
            duration_ms=int((time.monotonic() - start) * 1000),
            outcome="ok" if response.status_code < 400 else "error",
            error_code=error_code,
            status=response.status_code,
        )
        # Logging must never break the request it observes.
        # ponytail: synchronous SQLite write per request; fine for one local user. Queue it if latency matters.
        with contextlib.suppress(sqlite3.Error):
            append(settings.db_path, entry)
        response.headers["X-BVG-Run-Id"] = run_id
        return response

    return app
