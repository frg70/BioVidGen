"""OP5V entry point and the only writer of Summary (rule 4, OP5V-SEC-01).
Validation itself is pure (evidence.py); this file adds storage and the log entry."""

import sqlite3
import time
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import ValidationError

from ..db import connect
from ..log import LogEntry, append
from .contracts import ArticleText, ProviderMeta, Summary
from .evidence import validate_drafts

ValidateCode = Literal["ALL_SECTIONS_FAILED", "STORE_FAILED"]


def _iso(seconds: float) -> str:
    return datetime.fromtimestamp(seconds, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _put(db: Path, summary: Summary) -> None:
    """One statement in one transaction: all or nothing. Same key and same content overwrite, so it is idempotent."""
    with connect(db) as c:
        c.execute(
            "INSERT OR REPLACE INTO summaries (doi, pipeline_version, created_at, body) VALUES (?, ?, ?, ?)",
            (summary.doi, summary.pipelineVersion, summary.createdAt, summary.model_dump_json()),
        )


def _store(db: Path, summary: Summary) -> Summary | Literal["STORE_FAILED"]:
    for _ in range(2):  # retried once: another writer may hold the database (OP5V-RES-01)
        try:
            _put(db, summary)
        except sqlite3.Error:
            continue  # the transaction rolled back: nothing was written
        return summary
    return "STORE_FAILED"


def validate_and_store(
    db: Path,
    run_id: str,
    doi: str,
    drafts: Mapping,
    text: ArticleText,
    meta: ProviderMeta,
    now: Callable[[], float] = time.time,
) -> Summary | ValidateCode:
    t0 = now()
    validated = validate_drafts(doi, drafts, text, meta, _iso(t0))
    result = "ALL_SECTIONS_FAILED" if validated.all_failed else _store(db, validated.summary)
    failed = isinstance(result, str)
    t1 = now()
    append(
        db,
        LogEntry(
            at=_iso(t1),
            run_id=run_id,
            op="OP5V",
            duration_ms=int((t1 - t0) * 1000),
            outcome="error" if failed else "ok",
            error_code=result if failed else None,
            sizes=validated.counts,
        ),
    )
    return result


def _parse(row: tuple[str] | None) -> Summary | None:
    if row is None:
        return None
    try:
        return Summary.model_validate_json(row[0])
    except ValidationError:
        return None


def get_summary(db: Path, doi: str, pipeline_version: str) -> Summary | None:
    with connect(db) as c:
        return _parse(
            c.execute(
                "SELECT body FROM summaries WHERE doi = ? AND pipeline_version = ?", (doi, pipeline_version)
            ).fetchone()
        )


def get_latest_summary(db: Path, doi: str) -> Summary | None:
    with connect(db) as c:
        return _parse(
            c.execute(
                "SELECT body FROM summaries WHERE doi = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", (doi,)
            ).fetchone()
        )
