"""OP3 Resolve metadata in the backend (ADR-0010; plan docs/impl-plans/op/OP3-resolve-metadata.md, delta D36).

OpenAlex only: the spike measured +0 pp coverage from Crossref (H2). No test touches the live network: OpenAlex
answers come from recorded fixtures or a server on 127.0.0.1.
"""

import copy
import http.server
import json
import sqlite3
import statistics
import threading
import time
import unicodedata
import urllib.parse
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from biovidgen.app import create_app
from biovidgen.config import Settings
from biovidgen.db import connect, migrate
from biovidgen.log import new_run_id, recent
from biovidgen.scholarly import http as oh
from biovidgen.scholarly.contracts import Article
from biovidgen.scholarly.openalex import OA_FIELDS, OpenAlexWork, parse_work, reconstruct, to_article, work_url
from biovidgen.scholarly.resolve import FRESH_S, KEEP_S, Resolver, forget_old

from .conftest import BASE, EXT_ORIGIN

FIXTURES = Path(__file__).parent / "fixtures" / "openalex"
PLOS_DOI = "10.1371/journal.pone.0185809"
SPM_DOI = "10.21149/16606"
NOW = 1_794_000_000.0  # 2026-11-06T...Z
YEAR = 2026


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text("utf-8"))


PLOS = fixture("plos-one-cc-by.json")
SPM = fixture("salud-publica-mex-no-abstract.json")


def ok(body: dict | bytes, status: int = 200, ctype: str = "application/json") -> oh.Answer:
    raw = body if isinstance(body, bytes) else json.dumps(body).encode()
    return oh.Answer(status=status, content_type=ctype, body=raw, retry_after=None)


class FakeFetch:
    """Stands in for http.fetch: answers in order (the last one repeats) and records every URL."""

    def __init__(self, *answers: oh.Answer | str) -> None:
        self.answers = list(answers)
        self.urls: list[str] = []

    def __call__(self, url: str) -> tuple[oh.Answer | str, int]:
        self.urls.append(url)
        return (self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]), 1


def make(tmp_path: Path, fetch: Callable, now: Callable[[], float] = lambda: NOW) -> tuple[Resolver, Path]:
    db = tmp_path / "biovidgen.sqlite3"
    migrate(db)
    return Resolver(db, fetch=fetch, now=now), db


def article_of(work: dict, doi: str = PLOS_DOI) -> Article:
    parsed = parse_work(ok(work))
    assert isinstance(parsed, OpenAlexWork)
    return to_article(parsed, doi, "2026-11-06T00:00:00.000Z", YEAR)


def rows(db: Path) -> list[tuple]:
    with connect(db) as c:
        return c.execute("SELECT doi, fetched_at FROM articles").fetchall()


# ---- mapping (merge precedence, now one source) ----


def test_op3_unit_01_field_mapping_from_openalex() -> None:
    """OP3-UNIT-01 each Article field comes from its OpenAlex field; ids lose their URL prefix (D36: OpenAlex only)."""
    a = article_of(PLOS)
    assert a.title is not None and a.title.startswith("More than 75 percent decline over 27 years")
    assert (a.journal, a.year, a.type, a.isOA) == ("PLoS ONE", 2017, "article", True)
    assert (a.openalexId, a.pmid, a.pmcid) == ("W2766208183", "29045418", "PMC5646769")
    assert a.authors[0].name == "Caspar A. Hallmann" and a.authors[0].orcid == "0000-0002-4630-0522"
    assert [x.name for x in a.authors] == [x["author"]["display_name"] for x in PLOS["authorships"]]  # source order
    assert a.primaryTopic is not None and a.primaryTopic.name == "Plant and animal studies"
    assert a.primaryTopic.field == "Agricultural and Biological Sciences"
    assert a.oaUrl == PLOS["best_oa_location"]["pdf_url"]
    assert a.coverage.authors == "found" and a.coverage.keywords == "found"
    assert (a.doi, a.schemaVersion) == (PLOS_DOI, 1)


def test_op3_unit_02_abstract_reconstruction() -> None:
    """OP3-UNIT-02 the inverted index becomes text in word order; an empty or missing index gives null."""
    a = article_of(PLOS)
    assert a.abstract is not None and a.abstract.startswith("Global declines in insects")
    assert reconstruct({"world": [1], "hello": [0], "again": [3], "the": [2]}) == "hello world the again"
    assert reconstruct({}) is None and reconstruct(None) is None


def test_op3_unit_03_missing_abstract() -> None:
    """OP3-UNIT-03 a withheld abstract is null; the rest of the article still resolves and coverage holds."""
    a = article_of(SPM, SPM_DOI)
    assert a.abstract is None
    assert a.coverage.authors == "found" and a.authors


def test_op3_unit_04_not_in_openalex_means_not_found_without_crossref(tmp_path: Path) -> None:
    """OP3-UNIT-04 (D36) a DOI OpenAlex does not have → NOT_FOUND; OP3 asks no other host."""
    fake = FakeFetch(ok(b"<html>404</html>", 404, "text/html"))
    resolver, db = make(tmp_path, fake)
    assert resolver.resolve(PLOS_DOI, new_run_id()) == "NOT_FOUND"
    assert len(fake.urls) == 1 and urllib.parse.urlsplit(fake.urls[0]).netloc == "api.openalex.org"
    assert rows(db) == []


def test_op3_unit_05_datacite_doi(tmp_path: Path) -> None:
    """OP3-UNIT-05 a DataCite DOI (Zenodo) resolves when OpenAlex has it, else NOT_FOUND; never an error."""
    doi = "10.5281/zenodo.1234567"
    work = {**copy.deepcopy(SPM), "type": "dataset"}
    resolver, _ = make(tmp_path, FakeFetch(ok(work)))
    got = resolver.resolve(doi, new_run_id())
    assert not isinstance(got, str) and got.article.doi == doi and got.article.type == "dataset"
    resolver, _ = make(tmp_path / "b", FakeFetch(ok(b"", 404, "text/plain")))
    assert resolver.resolve(doi, new_run_id()) == "NOT_FOUND"


def test_op3_unit_06_merged_work_keeps_canonical_id() -> None:
    """OP3-UNIT-06 a merged work answers with its canonical id; that id is stored, not the one asked for."""
    a = article_of({**PLOS, "id": "https://openalex.org/W1234567"})
    assert a.openalexId == "W1234567"


def test_op3_unit_07_more_than_100_authors() -> None:
    """OP3-UNIT-07 1,011 authors are all kept in order (the spike found OpenAlex returns the full list)."""
    many = [{"author": {"display_name": f"Author {i}", "orcid": None}} for i in range(1011)]
    a = article_of({**PLOS, "authorships": many})
    assert len(a.authors) == 1011 and a.authors[1010].name == "Author 1010"


def test_op3_unit_08_names_are_nfc() -> None:
    """OP3-UNIT-08 diacritics are preserved and stored as NFC, whatever form the source used."""
    spm = article_of(SPM, SPM_DOI)
    assert spm.authors[0].name == "Óscar Arrieta"
    decomposed = unicodedata.normalize("NFD", "José Núñez")
    a = article_of({**PLOS, "authorships": [{"author": {"display_name": decomposed}}], "display_name": decomposed})
    assert a.authors[0].name == "José Núñez" == unicodedata.normalize("NFC", decomposed)
    assert a.title == "José Núñez"


@pytest.mark.parametrize(
    ("raw", "expected"), [(2017, 2017), (YEAR, YEAR), (YEAR + 1, None), (2999, None), (0, None), (None, None)]
)
def test_op3_unit_09_year_bounds(raw: int | None, expected: int | None) -> None:
    """OP3-UNIT-09 a year after the current one, zero or missing becomes null."""
    assert article_of({**PLOS, "publication_year": raw}).year == expected


def test_op3_unit_10_keywords_deduped_tagged_capped() -> None:
    """OP3-UNIT-10 keywords then topics, deduplicated by casefold, source tags kept, score < 0.3 dropped, at most 15."""
    keywords = [{"display_name": "Insects", "score": 0.9}, {"display_name": "insects", "score": 0.8}]
    keywords += [{"display_name": "Noise", "score": 0.1}, {"display_name": "Unscored", "score": None}]
    keywords += [{"display_name": f"term {i}", "score": 0.5} for i in range(20)]
    topics = [{"display_name": "INSECTS", "score": 0.9}, {"display_name": "Ecology", "score": 0.7}]
    a = article_of({**PLOS, "keywords": keywords, "topics": topics})
    terms = [k.term for k in a.keywords]
    assert terms[:2] == ["Insects", "Unscored"] and "Noise" not in terms and "insects" not in terms
    assert len(a.keywords) == 15
    small = article_of({**PLOS, "keywords": keywords[:2], "topics": topics})
    assert [(k.term, k.source) for k in small.keywords] == [
        ("Insects", "openalex_keyword"),
        ("Ecology", "openalex_topic"),
    ]
    none = article_of({**PLOS, "keywords": [], "topics": None})
    assert none.keywords == [] and none.coverage.keywords == "none_found"


def test_op3_unit_11_cache_fresh_stale_and_failures(tmp_path: Path) -> None:
    """OP3-UNIT-11 fresh → no call; stale → asked again; stale + failure → stale copy flagged; none + failure → UPSTREAM_DOWN."""
    clock = [NOW]
    fake = FakeFetch(ok(PLOS))
    resolver, _ = make(tmp_path, fake, lambda: clock[0])
    first = resolver.resolve(PLOS_DOI, new_run_id())
    assert not isinstance(first, str) and (first.stale, first.saved) == (False, True)
    clock[0] += FRESH_S - 1
    assert resolver.resolve(PLOS_DOI, new_run_id()) == first and len(fake.urls) == 1
    clock[0] += 2
    fake.answers = ["NETWORK"]
    stale = resolver.resolve(PLOS_DOI, new_run_id())
    assert not isinstance(stale, str) and stale.stale and stale.article == first.article and len(fake.urls) == 2
    fake.answers = [ok(PLOS)]
    fresh = resolver.resolve(PLOS_DOI, new_run_id())
    assert not isinstance(fresh, str) and not fresh.stale and fresh.article.fetchedAt > first.article.fetchedAt
    resolver, _ = make(tmp_path / "b", FakeFetch("TIMEOUT"))
    assert resolver.resolve(PLOS_DOI, new_run_id()) == "UPSTREAM_DOWN"


def test_op3_unit_12_not_found_through_the_endpoint(tmp_path: Path) -> None:
    """OP3-UNIT-12 404 from OpenAlex → 404 {"error": "NOT_FOUND"}; the panel keeps the page's own data."""
    settings = Settings(data_dir=tmp_path, extension_ids=("abcdefghijklmnopabcdefghijklmnop",))
    client = TestClient(create_app(settings, fetch=FakeFetch(ok(b"", 404, "text/html"))), base_url=BASE)
    token = (tmp_path / "token").read_text("ascii")
    r = client.get("/api/v1/article", params={"doi": PLOS_DOI}, headers={"X-BVG-Token": token, "Origin": EXT_ORIGIN})
    assert (r.status_code, r.json()) == (404, {"error": "NOT_FOUND"})
    assert r.headers["access-control-allow-origin"] == EXT_ORIGIN


def test_op3_unit_13_store_failure_returns_article_unsaved(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """OP3-UNIT-13 if the write fails (disk full) there is no partial record; the article is returned with saved=false."""
    resolver, db = make(tmp_path, FakeFetch(ok(PLOS)))

    def full(*_: object) -> None:
        raise sqlite3.OperationalError("database or disk is full")

    monkeypatch.setattr("biovidgen.scholarly.resolve._put", full)
    got = resolver.resolve(PLOS_DOI, new_run_id())
    assert not isinstance(got, str) and (got.saved, got.stale) == (False, False) and got.article.pmid == "29045418"
    assert rows(db) == []


def test_op3_unit_14_failed_refresh_keeps_previous_record(tmp_path: Path) -> None:
    """OP3-UNIT-14 (D36) a refresh that fails or answers garbage leaves the stored record exactly as it was."""
    clock = [NOW]
    fake = FakeFetch(ok(PLOS))
    resolver, db = make(tmp_path, fake, lambda: clock[0])
    resolver.resolve(PLOS_DOI, new_run_id())
    before = rows(db)
    clock[0] += FRESH_S + 1
    for bad in ("NETWORK", ok(b"not json"), ok({"id": 5})):
        fake.answers = [bad]
        got = resolver.resolve(PLOS_DOI, new_run_id())
        assert not isinstance(got, str) and got.stale
        assert rows(db) == before


@given(
    st.lists(st.text(alphabet=st.characters(blacklist_categories=("Zs", "Cc")), min_size=1), min_size=1, max_size=60)
)
def test_op3_prop_01_reconstruct_inverts(tokens: list[str]) -> None:
    """OP3-PROP-01 reconstruct(invert(tokens)) == tokens joined by spaces, for any token list."""
    index: dict[str, list[int]] = {}
    for position, token in enumerate(tokens):
        index.setdefault(token, []).append(position)
    assert reconstruct(index) == " ".join(tokens)


def test_op3_prop_02_upsert_is_idempotent(tmp_path: Path) -> None:
    """OP3-PROP-02 resolving twice (forced refresh) leaves one record, with fetchedAt updated."""
    clock = [NOW]
    resolver, db = make(tmp_path, FakeFetch(ok(PLOS)), lambda: clock[0])
    resolver.resolve(PLOS_DOI, new_run_id())
    first = rows(db)
    clock[0] += FRESH_S + 1
    resolver.resolve(PLOS_DOI, new_run_id())
    second = rows(db)
    assert len(first) == len(second) == 1 and second[0][1] > first[0][1]


names = st.text(min_size=1, max_size=40)


@given(
    title=st.one_of(st.none(), names),
    authors=st.lists(st.one_of(st.none(), names), max_size=8),
    keywords=st.lists(st.tuples(names, st.one_of(st.none(), st.floats(0, 1))), max_size=25),
    topics=st.lists(names, max_size=5),
)
def test_op3_prop_03_merge_never_invents(title: str | None, authors: list, keywords: list, topics: list[str]) -> None:
    """OP3-PROP-03 every title, author and keyword in the Article exists (as NFC text) in the OpenAlex answer."""
    work = {
        "id": "https://openalex.org/W1",
        "display_name": title,
        "authorships": [{"author": {"display_name": n}} for n in authors],
        "keywords": [{"display_name": t, "score": s} for t, s in keywords],
        "topics": [{"display_name": t, "score": 0.5} for t in topics],
    }
    a = article_of(work)

    def seen(values: list[str | None]) -> set[str]:
        return {unicodedata.normalize("NFC", v).strip() for v in values if v}

    assert a.title is None or a.title in seen([title])
    assert {x.name for x in a.authors} <= seen(authors)
    assert {k.term for k in a.keywords} <= seen([t for t, _ in keywords] + topics)


def test_op3_int_01_single_flight(tmp_path: Path) -> None:
    """OP3-INT-01 three concurrent resolves of one DOI → one OpenAlex call, three identical answers."""
    release = threading.Event()
    calls: list[str] = []

    def slow(url: str) -> tuple[oh.Answer, int]:
        calls.append(url)
        release.wait(5)
        return ok(PLOS), 1

    resolver, _ = make(tmp_path, slow)
    results: list[object] = []
    threads = [
        threading.Thread(target=lambda: results.append(resolver.resolve(PLOS_DOI, new_run_id()))) for _ in range(3)
    ]
    for t in threads:
        t.start()
    time.sleep(0.2)
    release.set()
    for t in threads:
        t.join(5)
    assert len(calls) == 1 and len(results) == 3 and results[0] == results[1] == results[2]


def test_op3_int_02_stale_refreshed_in_the_request(tmp_path: Path) -> None:
    """OP3-INT-02 (D36) a stale record is refreshed inside the same request, so the answer is the new record."""
    clock = [NOW]
    fake = FakeFetch(ok(PLOS))
    resolver, _ = make(tmp_path, fake, lambda: clock[0])
    resolver.resolve(PLOS_DOI, new_run_id())
    clock[0] += FRESH_S + 1
    fake.answers = [ok({**PLOS, "display_name": "Corrected title"})]
    got = resolver.resolve(PLOS_DOI, new_run_id())
    assert not isinstance(got, str) and got.article.title == "Corrected title" and not got.stale


def test_op3_type_01_article_schema_semantics() -> None:
    """OP3-TYPE-01 [] means asked and none found (with coverage), null means no value; unknown keys and versions refused."""
    a = article_of({"id": "https://openalex.org/W9", "authorships": [], "keywords": None})
    assert (a.authors, a.coverage.authors, a.keywords, a.coverage.keywords) == ([], "none_found", [], "none_found")
    assert (a.title, a.journal, a.abstract, a.pmid, a.isOA, a.primaryTopic) == (None, None, None, None, None, None)
    body = a.model_dump()
    with pytest.raises(ValidationError):
        Article.model_validate({**body, "extra": 1})
    with pytest.raises(ValidationError):
        Article.model_validate({**body, "schemaVersion": 2})
    with pytest.raises(ValidationError):
        Article.model_validate({**body, "oaUrl": "javascript:alert(1)"})


def test_op3_con_01_recorded_answers_parse_and_drift() -> None:
    """OP3-CON-01 recorded OpenAlex answers parse; a new unknown field is tolerated; losing the required id fails."""
    for work in (PLOS, SPM):
        assert isinstance(parse_work(ok(work)), OpenAlexWork)
    assert isinstance(parse_work(ok({**PLOS, "brand_new_field": {"x": 1}})), OpenAlexWork)
    without_id = {k: v for k, v in PLOS.items() if k != "id"}
    assert parse_work(ok(without_id)) == "UPSTREAM_INVALID"


def test_op3_con_02_consumers_get_their_fields() -> None:
    """OP3-CON-02 OP12 gets type; OP4 gets pmcid and abstract, under the names they read."""
    body = article_of(PLOS).model_dump(mode="json")
    assert body["type"] == "article" and body["pmcid"] == "PMC5646769" and body["abstract"]


def test_op3_con_02_extension_fixtures_match_the_backend() -> None:
    """OP3-CON-02 the answers the extension tests against (extension/fixtures/backend) are what the backend sends."""
    shared = Path(__file__).parents[2] / "extension" / "fixtures" / "backend"
    for work, doi, name in ((PLOS, PLOS_DOI, "resolved-plos.json"), (SPM, SPM_DOI, "resolved-spm.json")):
        a = to_article(OpenAlexWork.model_validate(work), doi, "2026-11-07T00:00:00.000Z", YEAR)
        expected = {"article": a.model_dump(mode="json"), "stale": False, "saved": True}
        assert json.loads((shared / name).read_text("utf-8")) == expected, f"regenerate {name}"


def test_op3_sec_01_request_carries_only_the_doi(tmp_path: Path) -> None:
    """OP3-SEC-01 the OpenAlex request is the DOI and the field list only: no run id, page URL, title or key."""
    fake = FakeFetch(ok(PLOS))
    resolver, _ = make(tmp_path, fake)
    resolver.resolve("10.1002/(sici)1096-8644(199601)99:1<1::aid-ajpa1>3.0.co;2-1", new_run_id())
    url = urllib.parse.urlsplit(fake.urls[0])
    assert (url.scheme, url.netloc) == ("https", "api.openalex.org")
    assert urllib.parse.unquote(url.path) == "/works/doi:10.1002/(sici)1096-8644(199601)99:1<1::aid-ajpa1>3.0.co;2-1"
    assert urllib.parse.parse_qs(url.query) == {"select": [",".join(OA_FIELDS)]}
    assert "<" not in url.path and ";" not in url.path  # encoded, so the DOI cannot add a query or path segment


def test_op3_sec_02_hostile_strings_stay_text() -> None:
    """OP3-SEC-02 markup in OpenAlex strings is kept as plain text, unchanged; the panel renders it with textContent."""
    a = article_of({**PLOS, "display_name": "<script>alert(1)</script> & <b>x</b>"})
    assert a.title == "<script>alert(1)</script> & <b>x</b>"


@pytest.mark.parametrize(
    "answer",
    [
        ok(b"<html>maintenance</html>", 200, "text/html"),
        ok(b"{not json"),
        ok(b"[1, 2]"),
        ok({"id": ["W1"]}),
        "TOO_LARGE",
        ok(b"", 400, "application/json"),
    ],
)
def test_op3_sec_03_invalid_answers_store_nothing(tmp_path: Path, answer: oh.Answer | str) -> None:
    """OP3-SEC-03 oversize, non-JSON, wrong content type or wrong shape → UPSTREAM_INVALID and nothing stored."""
    resolver, db = make(tmp_path, FakeFetch(answer))
    assert resolver.resolve(PLOS_DOI, new_run_id()) == "UPSTREAM_INVALID"
    assert rows(db) == []


def test_op3_sec_04_no_key_and_no_url_in_logs(tmp_path: Path) -> None:
    """OP3-SEC-04 (D36) P0 sends no OpenAlex key (single lookups are free); the log holds neither URL nor DOI."""
    fake = FakeFetch(ok(PLOS))
    resolver, db = make(tmp_path, fake)
    resolver.resolve(PLOS_DOI, new_run_id())
    assert "api_key" not in fake.urls[0] and "mailto" not in fake.urls[0]
    with connect(db) as c:
        dump = "\n".join(str(r) for r in c.execute("SELECT * FROM logs"))
    assert "openalex.org" not in dump and "pone" not in dump and "10.1371" not in dump


def test_op3_res_01_429_honours_retry_after() -> None:
    """OP3-RES-01 429 with Retry-After waits that long and tries again, at most 3 attempts; a wait over the cap gives up."""
    waits: list[float] = []
    busy = oh.Answer(status=429, content_type="application/json", body=b"", retry_after=2.0)
    got, attempts = oh.fetch("https://api.openalex.org/x", once=lambda _: busy, sleep=waits.append, rand=lambda: 0.5)
    assert got == busy and attempts == oh.ATTEMPTS == 3 and waits == [2.0, 2.0]
    waits.clear()
    long = oh.Answer(status=429, content_type="", body=b"", retry_after=oh.RETRY_AFTER_MAX_S + 1)
    _, attempts = oh.fetch("https://api.openalex.org/x", once=lambda _: long, sleep=waits.append, rand=lambda: 0.5)
    assert attempts == 1 and waits == []
    answers = iter(["NETWORK", oh.Answer(503, "", b"", None), ok(PLOS)])
    got, attempts = oh.fetch(
        "https://api.openalex.org/x", once=lambda _: next(answers), sleep=waits.append, rand=lambda: 1.0
    )
    assert attempts == 3 and isinstance(got, oh.Answer) and got.status == 200
    assert waits == [oh.BACKOFF_S, oh.BACKOFF_S * 2]  # full jitter at its top
    _, attempts = oh.fetch("https://api.openalex.org/x", once=lambda _: ok(b"", 404), sleep=waits.append)
    assert attempts == 1  # 404 is an answer, not a failure


class _Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


def serve(handler: Callable[[http.server.BaseHTTPRequestHandler], None]) -> tuple[_Server, str]:
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            handler(self)

        def log_message(self, *_: object) -> None:
            pass

    server = _Server(("127.0.0.1", 0), H)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def test_op3_res_02_deadline_is_total() -> None:
    """OP3-RES-02 a server that trickles bytes forever is cut off at the deadline (the spike saw one call take 752 s)."""

    def trickle(h: http.server.BaseHTTPRequestHandler) -> None:
        h.send_response(200)
        h.send_header("Content-Type", "application/json")
        h.send_header("Content-Length", "1000000")
        h.end_headers()
        for _ in range(100):
            h.wfile.write(b" ")
            h.wfile.flush()
            time.sleep(0.1)

    server, base = serve(trickle)
    try:
        start = time.monotonic()
        got = oh.fetch_once(f"{base}/w", allowed=frozenset({base}), timeout_s=0.5)
        assert got == "TIMEOUT" and time.monotonic() - start < 1.5
    finally:
        server.shutdown()


def test_op3_res_03_transport_rules() -> None:
    """OP3-RES-03 (D36) the one host's transport: only fixed origins, redirects stay on them, size capped, fixed headers."""
    seen: dict[str, str] = {}

    def route(h: http.server.BaseHTTPRequestHandler) -> None:
        seen.update({k.lower(): v for k, v in h.headers.items()})
        if h.path == "/away":
            h.send_response(301)
            h.send_header("Location", "https://evil.example/steal")
            h.end_headers()
            return
        if h.path == "/moved":
            h.send_response(301)
            h.send_header("Location", "/w")
            h.end_headers()
            return
        body = b"x" * (3000 if h.path == "/big" else 2)
        h.send_response(200)
        h.send_header("Content-Type", "application/json; charset=utf-8")
        h.send_header("Content-Length", str(len(body)))
        h.end_headers()
        h.wfile.write(body)

    server, base = serve(route)
    allowed = frozenset({base})
    try:
        got = oh.fetch_once(f"{base}/moved", allowed=allowed)
        assert isinstance(got, oh.Answer) and (got.status, got.content_type, got.body) == (
            200,
            "application/json",
            b"xx",
        )
        assert set(seen) - {"host", "accept-encoding", "connection"} == {"user-agent", "accept"}
        assert seen["user-agent"].startswith("BioVidGen/")
        assert oh.fetch_once(f"{base}/away", allowed=allowed) == "NETWORK"
        assert oh.fetch_once(f"{base}/big", allowed=allowed, max_bytes=1000) == "TOO_LARGE"
        with pytest.raises(ValueError):
            oh.fetch_once("https://evil.example/x")
        with pytest.raises(ValueError):
            oh.fetch_once("http://api.openalex.org/works")  # https only
    finally:
        server.shutdown()


def test_op3_perf_01_warm_p95(tmp_path: Path) -> None:
    """OP3-PERF-01 warm resolve (cached) p95 ≤ 50 ms over 100 calls."""
    resolver, _ = make(tmp_path, FakeFetch(ok(PLOS)))
    resolver.resolve(PLOS_DOI, new_run_id())
    times = []
    for _ in range(100):
        start = time.perf_counter()
        resolver.resolve(PLOS_DOI, new_run_id())
        times.append(time.perf_counter() - start)
    assert statistics.quantiles(times, n=20)[18] <= 0.050


def test_op3_perf_03_select_keeps_payload_small() -> None:
    """OP3-PERF-03 the field list leaves out the heavy lists (spike p95 22 KB with it; target ≤ 30 KB)."""
    heavy = {"referenced_works", "related_works", "counts_by_year", "locations", "concepts", "mesh", "institutions"}
    assert heavy.isdisjoint(OA_FIELDS)
    assert "select=" + ",".join(OA_FIELDS) in work_url(PLOS_DOI)


def test_op3_kpi_01_fixture_resolve_and_coverage(tmp_path: Path) -> None:
    """OP3-KPI-01 every recorded fixture resolves with at least one author and one keyword."""
    for i, (work, doi) in enumerate(((PLOS, PLOS_DOI), (SPM, SPM_DOI))):
        resolver, _ = make(tmp_path / str(i), FakeFetch(ok(work)))
        got = resolver.resolve(doi, new_run_id())
        assert not isinstance(got, str) and got.article.authors and got.article.keywords


def test_op3_cfg_01_select_matches_what_is_read() -> None:
    """OP3-CFG-01 the select list is exactly the fields the parser reads, so a new field cannot be silently missing."""
    assert set(OA_FIELDS) == set(OpenAlexWork.model_fields)


def test_op3_obs_01_log_entry(tmp_path: Path) -> None:
    """OP3-OBS-01 one log entry per resolve: host in op, HTTP status, attempts, duration, run id; never DOI or key."""
    resolver, db = make(tmp_path, FakeFetch(ok(PLOS)))
    rid = new_run_id()
    resolver.resolve(PLOS_DOI, rid)
    resolver.resolve(PLOS_DOI, rid)  # cached
    newest, first = recent(db, 2)
    assert (first.op, first.run_id, first.outcome, first.status, first.sizes) == (
        "OP3.openalex",
        rid,
        "ok",
        200,
        {"attempts": 1, "cached": 0, "stale": 0},
    )
    assert newest.sizes == {"attempts": 0, "cached": 1, "stale": 0} and newest.status is None


def test_op3_mig_01_old_rows_never_crash(tmp_path: Path) -> None:
    """OP3-MIG-01 a stored row from another schema version, or garbage, reads as a miss and is replaced."""
    fake = FakeFetch(ok(PLOS))
    resolver, db = make(tmp_path, fake)
    with connect(db) as c:
        c.execute(
            "INSERT INTO articles (doi, fetched_at, body) VALUES (?, ?, ?)",
            (PLOS_DOI, "2026-11-06T00:00:00.000Z", '{"schemaVersion": 0}'),
        )
        c.execute(
            "INSERT INTO articles (doi, fetched_at, body) VALUES (?, ?, ?)", (SPM_DOI, "2026-11-06T00:00:00.000Z", "{")
        )
    assert not isinstance(resolver.resolve(PLOS_DOI, new_run_id()), str)
    assert not isinstance(resolver.resolve(SPM_DOI, new_run_id()), str)
    assert len(fake.urls) == 2


json_values = st.recursive(
    st.none() | st.booleans() | st.integers() | st.floats(allow_nan=False) | st.text(max_size=20),
    lambda inner: st.lists(inner, max_size=5) | st.dictionaries(st.text(max_size=10), inner, max_size=5),
    max_leaves=30,
)


@given(st.dictionaries(st.sampled_from([*OA_FIELDS, "x"]), json_values, max_size=len(OA_FIELDS)))
def test_op3_fuzz_01_fuzzed_answers_never_throw(work: dict) -> None:
    """OP3-FUZZ-01 (PR-sized) swapped types and nulls give UPSTREAM_INVALID or an Article, never an exception."""
    parsed = parse_work(ok({"id": "https://openalex.org/W1", **work}))
    if isinstance(parsed, OpenAlexWork):
        assert isinstance(to_article(parsed, PLOS_DOI, "2026-11-06T00:00:00.000Z", YEAR), Article)
    else:
        assert parsed == "UPSTREAM_INVALID"


def test_op3_gc_old_articles_removed(tmp_path: Path) -> None:
    """Articles not refreshed for KEEP_S (90 days) are deleted when the backend starts (plan task 5)."""
    clock = [NOW]
    resolver, db = make(tmp_path, FakeFetch(ok(PLOS)), lambda: clock[0])
    resolver.resolve(PLOS_DOI, new_run_id())
    clock[0] += KEEP_S - 1
    resolver.resolve(SPM_DOI, new_run_id())
    assert forget_old(db, NOW + KEEP_S + 1) == 1
    assert [r[0] for r in rows(db)] == [SPM_DOI]


def test_op3_endpoint_refuses_bad_doi_and_needs_token(tmp_path: Path) -> None:
    """The endpoint takes one normalised DOI behind the token; anything else is refused before OpenAlex is asked."""
    fake = FakeFetch(ok(PLOS))
    settings = Settings(data_dir=tmp_path)
    client = TestClient(create_app(settings, fetch=fake), base_url=BASE)
    token = (tmp_path / "token").read_text("ascii")
    assert client.get("/api/v1/article", params={"doi": PLOS_DOI}).status_code == 401
    for bad in ("10.1371/JOURNAL.PONE.0185809", "https://doi.org/10.1/x", "10.1/" + "x" * 300, "", "10.1/a b"):
        r = client.get("/api/v1/article", params={"doi": bad}, headers={"X-BVG-Token": token})
        assert (r.status_code, r.json()) == (400, {"error": "BAD_DOI"}), bad
    assert fake.urls == []
    r = client.get("/api/v1/article", params={"doi": PLOS_DOI}, headers={"X-BVG-Token": token})
    assert r.status_code == 200 and r.json()["article"]["pmid"] == "29045418" and r.json()["stale"] is False
