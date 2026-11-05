"""SQLite in the user data dir. One connection per unit of work (local scale; no pool needed)."""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

# Append-only list: migration N brings the schema from version N to N+1. Never edit a shipped entry.
MIGRATIONS: list[str] = [
    """
    CREATE TABLE logs (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      run_id TEXT NOT NULL,
      op TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      error_code TEXT,
      status INTEGER
    );
    CREATE INDEX logs_run_id ON logs(run_id);
    """,
]
SCHEMA_VERSION = len(MIGRATIONS)


@contextmanager
def connect(path: Path) -> Iterator[sqlite3.Connection]:
    """Commits on success, rolls back on error (each `with` block is one transaction)."""
    conn = sqlite3.connect(path, timeout=5)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        with conn:
            yield conn
    finally:
        conn.close()


def migrate(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as c:
        c.execute("PRAGMA journal_mode = WAL")
        current = c.execute("PRAGMA user_version").fetchone()[0]
        for version in range(current, SCHEMA_VERSION):
            c.executescript(f"BEGIN; {MIGRATIONS[version]} PRAGMA user_version = {version + 1}; COMMIT;")
