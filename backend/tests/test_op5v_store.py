"""OP5V storage: SQLite in place of the reference's IndexedDB. Rule 4: validate.py is the only writer."""

import json
import re
import threading
from pathlib import Path

import pytest

import biovidgen
from biovidgen.db import connect, migrate
from biovidgen.log import new_run_id, recent
from biovidgen.summary import validate
from biovidgen.summary.contracts import ArticleText, ProviderMeta, Summary
from biovidgen.summary.validate import get_latest_summary, get_summary, validate_and_store

FIXTURE = json.loads(
    (Path(__file__).parents[2] / "extension" / "fixtures" / "op5v" / "article-text.json").read_text("utf-8")
)
FIXTURE.pop("_note")
TEXT = ArticleText.model_validate(FIXTURE)
META = ProviderMeta(provider="stub", modelId="stub-0", promptHash="p0", pipelineVersion="pv1")
DOI = "10.5555/biovidgen.synthetic.1"
QUOTE = "Acute respiratory infections occurred in 81 participants in the vitamin D group"
GOOD = {
    "section": "results",
    "summaryEs": "Hubo menos infecciones.",
    "evidence": [{"quote": QUOTE, "section": "results"}],
}
DRAFTS = {"sections": [GOOD]}


@pytest.fixture
def db(tmp_path: Path) -> Path:
    path = tmp_path / "t.sqlite3"
    migrate(path)
    return path


def clock(*times: float):
    values = iter(times)
    return lambda: next(values)


def rows(db: Path) -> int:
    with connect(db) as c:
        return c.execute("SELECT COUNT(*) FROM summaries").fetchone()[0]


def test_round_trip_and_latest(db: Path) -> None:
    """OP5V-INT-01 store, read back equal; latest by DOI returns the newest."""
    first = validate_and_store(db, new_run_id(), DOI, DRAFTS, TEXT, META, now=clock(1000.0, 1000.0))
    assert isinstance(first, Summary)
    assert first.createdAt == "1970-01-01T00:16:40.000Z"
    assert get_summary(db, DOI, "pv1") == first
    newer = validate_and_store(
        db,
        new_run_id(),
        DOI,
        DRAFTS,
        TEXT,
        META.model_copy(update={"pipelineVersion": "pv2"}),
        now=clock(2000.0, 2000.0),
    )
    assert isinstance(newer, Summary)
    assert get_latest_summary(db, DOI) == newer
    assert get_latest_summary(db, "10.9999/none") is None
    assert get_summary(db, DOI, "nope") is None


def test_all_failed_stores_nothing(db: Path) -> None:
    """OP5V-UNIT-10 all sections failed: ALL_SECTIONS_FAILED, nothing stored."""
    assert (
        validate_and_store(db, new_run_id(), DOI, {"sections": [{"section": "results"}]}, TEXT, META)
        == "ALL_SECTIONS_FAILED"
    )
    assert validate_and_store(db, new_run_id(), DOI, {"sections": []}, TEXT, META) == "ALL_SECTIONS_FAILED"
    assert rows(db) == 0


def test_atomic_write_failure_stores_nothing(db: Path) -> None:
    """OP5V-UNIT-12 OP5V-RES-01 aborted write: nothing stored, retried once, then STORE_FAILED."""
    with connect(db) as c:
        c.execute("CREATE TRIGGER no_write BEFORE INSERT ON summaries BEGIN SELECT RAISE(ABORT, 'blocked'); END")
    assert validate_and_store(db, new_run_id(), DOI, DRAFTS, TEXT, META) == "STORE_FAILED"
    assert rows(db) == 0
    run = new_run_id()
    validate_and_store(db, run, DOI, DRAFTS, TEXT, META)
    entry = next(e for e in recent(db, 10) if e.run_id == run)
    assert (entry.op, entry.outcome, entry.error_code) == ("OP5V", "error", "STORE_FAILED")


def test_blocked_once_then_retried(db: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """OP5V-RES-01 one blocked write is retried and succeeds; attempts are bounded at two."""
    real = validate._put
    calls = []

    def flaky(path: Path, summary: Summary) -> None:
        calls.append(1)
        if len(calls) == 1:
            raise validate.sqlite3.OperationalError("database is locked")
        real(path, summary)

    monkeypatch.setattr(validate, "_put", flaky)
    assert isinstance(validate_and_store(db, new_run_id(), DOI, DRAFTS, TEXT, META), Summary)
    assert len(calls) == 2
    assert rows(db) == 1


def test_attempts_are_bounded_at_two(db: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """OP5V-RES-01 a write that keeps failing is tried exactly twice."""
    calls = []

    def blocked(path: Path, summary: Summary) -> None:
        calls.append(1)
        raise validate.sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(validate, "_put", blocked)
    assert validate_and_store(db, new_run_id(), DOI, DRAFTS, TEXT, META) == "STORE_FAILED"
    assert len(calls) == 2


def test_log_records_the_duration(db: Path) -> None:
    """OP5V-OBS-01 duration_ms is the time between the two clock reads."""
    run = new_run_id()
    validate_and_store(db, run, DOI, DRAFTS, TEXT, META, now=clock(1000.0, 1002.0))
    assert next(e for e in recent(db, 10) if e.run_id == run).duration_ms == 2000


def test_new_pipeline_version_keeps_the_old_record(db: Path) -> None:
    """OP5V-UNIT-13 re-validation under a new pipelineVersion adds a record and keeps the old one."""
    validate_and_store(db, new_run_id(), DOI, DRAFTS, TEXT, META)
    validate_and_store(db, new_run_id(), DOI, DRAFTS, TEXT, META.model_copy(update={"pipelineVersion": "pv2"}))
    assert rows(db) == 2
    assert get_summary(db, DOI, "pv1") is not None


def test_concurrent_writes_leave_one_record(db: Path) -> None:
    """OP5V-UNIT-14 two writers on one key leave one complete record."""
    results = []

    def write() -> None:
        results.append(validate_and_store(db, new_run_id(), DOI, DRAFTS, TEXT, META, now=clock(1000.0, 1000.0)))

    threads = [threading.Thread(target=write) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert rows(db) == 1
    assert results[0] == results[1]
    assert get_summary(db, DOI, "pv1") == results[0]


def test_log_has_counts_never_text(db: Path) -> None:
    """OP5V-SEC-04 OP5V-OBS-01 one log entry with runId and counts by reason; no article or draft text anywhere."""
    run = new_run_id()
    secret = "SECRET fabricated sentence that is not in the paper"
    drafts = {
        "sections": [{**GOOD, "summaryEs": "SECRET resumen", "evidence": [{"quote": secret, "section": "results"}]}]
    }
    validate_and_store(db, run, DOI, drafts, TEXT, META)
    entries = [e for e in recent(db, 10) if e.run_id == run]
    assert len(entries) == 1
    sizes = entries[0].sizes
    assert sizes["quotes"] == 1
    assert sizes["rejected.NOT_FOUND"] == 1
    assert sizes["sections.no_verificado"] == 1
    assert entries[0].op == "OP5V"
    assert "SECRET" not in entries[0].model_dump_json()
    assert DOI not in entries[0].model_dump_json()


def test_corrupt_row_reads_as_missing(db: Path) -> None:
    """OP5V-TYPE-01 a stored row that fails the contract is not handed to the caller."""
    with connect(db) as c:
        c.execute(
            "INSERT INTO summaries (doi, pipeline_version, created_at, body) VALUES (?, ?, ?, ?)",
            (DOI, "pv1", "2026", '{"doi": 1}'),
        )
    assert get_summary(db, DOI, "pv1") is None
    assert get_latest_summary(db, DOI) is None


def test_only_validate_writes_summaries() -> None:
    """OP5V-SEC-01 sole writer: outside db.py's migrations, only summary/validate.py touches the summaries table."""
    root = Path(biovidgen.__file__).parent
    touching = {
        p.relative_to(root).as_posix() for p in root.rglob("*.py") if re.search(r"\bsummaries\b", p.read_text("utf-8"))
    }
    assert touching == {"db.py", "summary/validate.py"}
