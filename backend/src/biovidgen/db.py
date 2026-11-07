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
    """
    ALTER TABLE logs ADD COLUMN sizes TEXT;
    CREATE TABLE summaries (
      doi TEXT NOT NULL,
      pipeline_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (doi, pipeline_version)
    );
    CREATE INDEX summaries_doi ON summaries(doi, created_at);
    """,
    """
    CREATE TABLE articles (
      doi TEXT PRIMARY KEY,
      fetched_at TEXT NOT NULL,
      body TEXT NOT NULL
    );
    CREATE INDEX articles_fetched_at ON articles(fetched_at);
    """,
]
SCHEMA_VERSION = len(MIGRATIONS)


@contextmanager
def connect(path: Path) -> Iterator[sqlite3.Connection]:
    """Commits on success, rolls back on error (each `with` block is one transaction)."""
    conn = sqlite3.connect(path, timeout=5)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        # WAL + NORMAL: no fsync per commit (it cost up to 80 ms per log row on a busy disk). Never corrupts; a power
        # cut can lose the last commits, which are logs, a cache and summaries that can be made again.
        conn.execute("PRAGMA synchronous = NORMAL")
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
