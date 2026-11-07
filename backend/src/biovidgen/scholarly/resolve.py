"""OP3 Resolve metadata: cache, single flight, store, log. The only writer of `articles` (rule 4).

Fresh for 30 days. A stale record is refreshed inside the request (delta D36: cold p95 was 0.78 s in the spike, so
stale-while-revalidate is not worth a background thread); if OpenAlex fails, the stale copy is returned flagged.
"""

import sqlite3
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import ValidationError

from ..db import connect
from ..log import LogEntry, append
from . import http
from .contracts import Article, Resolved
from .openalex import parse_work, to_article, work_url

ResolveCode = Literal["NOT_FOUND", "UPSTREAM_DOWN", "UPSTREAM_INVALID"]
Fetch = Callable[[str], tuple[http.Answer | http.Failure, int]]

DAY_S = 86_400
FRESH_S = 30 * DAY_S
KEEP_S = 90 * DAY_S


def _iso(seconds: float) -> str:
    return datetime.fromtimestamp(seconds, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _seconds(iso: str) -> float:
    return datetime.fromisoformat(iso).timestamp()


def _get(db: Path, doi: str) -> Article | None:
    """A row from another schema version, or one that does not parse, is a miss (OP3-MIG-01)."""
    with connect(db) as c:
        row = c.execute("SELECT body FROM articles WHERE doi = ?", (doi,)).fetchone()
    if row is None:
        return None
    try:
        return Article.model_validate_json(row[0])
    except ValidationError:
        return None


def _put(db: Path, article: Article) -> None:
    """One statement, one transaction: no partial record. Upsert by DOI, so repeating it is harmless."""
    with connect(db) as c:
        c.execute(
            "INSERT OR REPLACE INTO articles (doi, fetched_at, body) VALUES (?, ?, ?)",
            (article.doi, article.fetchedAt, article.model_dump_json()),
        )


def forget_old(db: Path, now: float) -> int:
    """Deletes articles not refreshed for KEEP_S; run at start. ISO strings in one format sort as time."""
    with connect(db) as c:
        return c.execute("DELETE FROM articles WHERE fetched_at < ?", (_iso(now - KEEP_S),)).rowcount


class Resolver:
    def __init__(self, db: Path, fetch: Fetch = http.fetch, now: Callable[[], float] = time.time) -> None:
        self._db = db
        self._fetch = fetch
        self._now = now
        self._lock = threading.Lock()
        self._flights: dict[str, Future] = {}

    def resolve(self, doi: str, run_id: str) -> Resolved | ResolveCode:
        start = time.monotonic()
        cached = _get(self._db, doi)
        if cached is not None and self._now() - _seconds(cached.fetchedAt) < FRESH_S:
            result: Resolved | ResolveCode = Resolved(article=cached, stale=False, saved=True)
            attempts, status = 0, None
        else:
            result, attempts, status = self._shared(doi, lambda: self._refresh(doi, cached))
        failed = isinstance(result, str)
        append(
            self._db,
            LogEntry(
                at=_iso(self._now()),
                run_id=run_id,
                op="OP3.openalex",
                duration_ms=int((time.monotonic() - start) * 1000),
                outcome="error" if failed else "ok",
                error_code=result if isinstance(result, str) else None,
                status=status,
                sizes={
                    "attempts": attempts,
                    "cached": int(attempts == 0),
                    "stale": int(not isinstance(result, str) and result.stale),
                },
            ),
        )
        return result

    def _shared(self, doi: str, work: Callable[[], tuple]) -> tuple:
        """Concurrent requests for one DOI share one OpenAlex call (OP3-INT-01)."""
        with self._lock:
            flight = self._flights.get(doi)
            leader = flight is None
            if flight is None:
                flight = self._flights[doi] = Future()
        if not leader:
            return flight.result()
        try:
            flight.set_result(work())
        except BaseException as e:
            flight.set_exception(e)
            raise
        finally:
            with self._lock:
                del self._flights[doi]
        return flight.result()

    def _refresh(self, doi: str, cached: Article | None) -> tuple[Resolved | ResolveCode, int, int | None]:
        got, attempts = self._fetch(work_url(doi))
        status = got.status if isinstance(got, http.Answer) else None
        if status == 404:
            return "NOT_FOUND", attempts, status
        code: ResolveCode
        if status == 200 or got == "TOO_LARGE" or (status is not None and 400 <= status < 500 and status != 429):
            work = parse_work(got)
            if not isinstance(work, str):
                now = self._now()
                article = to_article(work, doi, _iso(now), datetime.fromtimestamp(now, UTC).year)
                try:
                    _put(self._db, article)
                except sqlite3.Error:
                    return Resolved(article=article, stale=False, saved=False), attempts, status
                return Resolved(article=article, stale=False, saved=True), attempts, status
            code = "UPSTREAM_INVALID"
        else:
            code = "UPSTREAM_DOWN"
        if cached is not None:
            return Resolved(article=cached, stale=True, saved=True), attempts, status
        return code, attempts, status
