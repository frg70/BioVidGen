import re
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from biovidgen import __version__
from biovidgen.config import Settings, default_data_dir
from biovidgen.db import SCHEMA_VERSION, connect, migrate
from biovidgen.log import LOG_CAPACITY, LogEntry, append, new_run_id, recent

from .conftest import EXT_ORIGIN


def test_be0_unit_01_health(client: TestClient) -> None:
    """BE0-UNIT-01 /health says the backend is up and its version, nothing else."""
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "version": __version__}


def test_be0_unit_02_sqlite_migrations_idempotent(tmp_path: Path) -> None:
    """BE0-UNIT-02 SQLite in the data dir: WAL, user_version = SCHEMA_VERSION, migrate() is idempotent."""
    db = tmp_path / "biovidgen.sqlite3"
    migrate(db)
    migrate(db)
    with connect(db) as c:
        assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert c.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert c.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "logs" in tables


def test_be0_unit_03_config_from_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """BE0-UNIT-03 settings come from env vars; defaults are loopback, 8765, a per-user data dir."""
    for k in ("BIOVIDGEN_DATA_DIR", "BIOVIDGEN_PORT", "BIOVIDGEN_EXTENSION_IDS"):
        monkeypatch.delenv(k, raising=False)
    s = Settings.from_env()
    assert (s.host, s.port, s.data_dir, s.extension_ids) == ("127.0.0.1", 8765, default_data_dir(), ())
    monkeypatch.setenv("BIOVIDGEN_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("BIOVIDGEN_PORT", "9000")
    monkeypatch.setenv("BIOVIDGEN_EXTENSION_IDS", "abcdefghijklmnopabcdefghijklmnop, ponmlkjihgfedcbaponmlkjihgfedcba")
    s = Settings.from_env()
    assert (s.port, s.data_dir) == (9000, tmp_path)
    assert s.extension_ids == ("abcdefghijklmnopabcdefghijklmnop", "ponmlkjihgfedcbaponmlkjihgfedcba")


def entry(i: int, run_id: str) -> LogEntry:
    return LogEntry(at="2026-11-05T12:00:00Z", run_id=run_id, op="health", duration_ms=i, outcome="ok")


def test_be0_obs_01_log_whitelist_and_ring(tmp_path: Path) -> None:
    """BE0-OBS-01 log entries: strict whitelist with constrained values; ring of LOG_CAPACITY in SQLite."""
    db = tmp_path / "biovidgen.sqlite3"
    migrate(db)
    rid = new_run_id()
    assert re.fullmatch(r"run_[0-9a-f-]{36}", rid)
    for i in range(LOG_CAPACITY + 5):
        append(db, entry(i, rid))
    rows = recent(db, 1000)
    assert len(rows) == LOG_CAPACITY
    assert rows[0].duration_ms == LOG_CAPACITY + 4  # newest first
    with pytest.raises(ValueError):
        LogEntry(at="2026-11-05T12:00:00Z", run_id=rid, op="health", duration_ms=1, outcome="ok", text="secret")  # type: ignore[call-arg]
    with pytest.raises(ValueError):
        LogEntry(at="2026-11-05T12:00:00Z", run_id=rid, op="free text here", duration_ms=1, outcome="ok")
    with pytest.raises(ValueError):
        LogEntry(at="2026-11-05T12:00:00Z", run_id="anything", op="health", duration_ms=1, outcome="ok")
    with pytest.raises(ValueError):
        LogEntry(
            at="2026-11-05T12:00:00Z", run_id=rid, op="health", duration_ms=1, outcome="ok", error_code="has spaces"
        )


def test_be0_obs_02_every_request_logged_with_run_id_no_content(
    client: TestClient, settings: Settings, token: str
) -> None:
    """BE0-OBS-02 each request → one log row with runId (caller's if valid), op, status code; no path query, body or token."""
    rid = new_run_id()
    client.get(
        "/api/v1/status?doi=10.1/secret-query",
        headers={"X-BVG-Token": token, "X-BVG-Run-Id": rid, "Origin": EXT_ORIGIN},
    )
    client.get("/api/v1/status", headers={"X-BVG-Run-Id": "not a run id"})  # 401, gets a fresh run id
    client.get("/health", headers={"Origin": "https://evil.example"})  # 403
    rows = recent(settings.data_dir / "biovidgen.sqlite3", 10)
    assert [(r.op, r.outcome, r.error_code) for r in rows] == [
        ("health", "error", "FORBIDDEN_ORIGIN"),
        ("status", "error", "UNAUTHORIZED"),
        ("status", "ok", None),
    ]
    assert rows[2].run_id == rid
    assert rows[1].run_id != "not a run id" and rows[1].run_id.startswith("run_")
    with sqlite3.connect(settings.data_dir / "biovidgen.sqlite3") as c:
        dump = "\n".join(str(r) for r in c.execute("SELECT * FROM logs"))
    for leak in ("secret-query", "10.1/", token, "evil.example"):
        assert leak not in dump
