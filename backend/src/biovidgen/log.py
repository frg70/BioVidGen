"""Structured log (port of extension SVC0 log, delta D20): whitelisted keys, constrained values, no free text.
Ring of LOG_CAPACITY rows in SQLite so diagnostics survive restarts."""

import re
import uuid
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

from .db import connect

LOG_CAPACITY = 200
RUN_ID_PATTERN = r"^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

RunId = Annotated[str, StringConstraints(pattern=RUN_ID_PATTERN)]
Op = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_.-]{1,40}$")]
Code = Annotated[str, StringConstraints(pattern=r"^[A-Z][A-Z0-9_]{1,39}$")]


class LogEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    at: str
    run_id: RunId
    op: Op
    duration_ms: int
    outcome: Literal["ok", "error", "aborted"]
    error_code: Code | None = None
    status: int | None = None


def new_run_id() -> str:
    return f"run_{uuid.uuid4()}"


def is_run_id(value: str | None) -> bool:
    return value is not None and re.fullmatch(RUN_ID_PATTERN, value) is not None


def append(db: Path, entry: LogEntry) -> None:
    with connect(db) as c:
        c.execute(
            "INSERT INTO logs (at, run_id, op, duration_ms, outcome, error_code, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (entry.at, entry.run_id, entry.op, entry.duration_ms, entry.outcome, entry.error_code, entry.status),
        )
        c.execute("DELETE FROM logs WHERE seq <= (SELECT MAX(seq) FROM logs) - ?", (LOG_CAPACITY,))


def recent(db: Path, limit: int) -> list[LogEntry]:
    with connect(db) as c:
        rows = c.execute(
            "SELECT at, run_id, op, duration_ms, outcome, error_code, status FROM logs ORDER BY seq DESC LIMIT ?",
            (limit,),
        ).fetchall()
    keys = ("at", "run_id", "op", "duration_ms", "outcome", "error_code", "status")
    return [LogEntry(**dict(zip(keys, r, strict=True))) for r in rows]
