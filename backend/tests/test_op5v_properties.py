"""OP5V properties that hold on their own, without the TypeScript reference. Oracles here are plain lowercase
token comparison on ASCII text, so they do not depend on the normaliser under test."""

import hashlib
import json
import re
import time
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from biovidgen.summary import normaliser
from biovidgen.summary.contracts import ArticleText, ProviderMeta, Summary
from biovidgen.summary.evidence import validate_drafts
from biovidgen.summary.normaliser import NORMALISER_VERSION, find_quote, normalize, normalize_with_map

META = ProviderMeta(provider="stub", modelId="stub-0", promptHash="p0", pipelineVersion="pv1")
AT = "2026-11-05T12:00:00.000Z"
DOI = "10.5555/biovidgen.synthetic.1"
FIXTURES = Path(__file__).parents[2] / "extension" / "fixtures" / "op5v"
SLOW = settings(deadline=None, max_examples=300)


def article(text: str, source: str = "dom", name: str = "results") -> ArticleText:
    return ArticleText(
        doi_norm="10.1234/x",
        contentHash="c",
        source=source,
        sections={name: {"text": text, "headingSeen": name, "mergedWith": None}},
        missing=[],
        language="en",
        usable=True,
        truncated=False,
        headingsVersion="h1",
        schemaVersion=1,
    )


def one(quote: str, text: str, summary: str = "Resumen.") -> dict:
    drafts = {
        "sections": [{"section": "results", "summaryEs": summary, "evidence": [{"quote": quote, "section": "results"}]}]
    }
    return validate_drafts(DOI, drafts, article(text), META, AT).summary.model_dump()["sections"]["results"]


words = st.lists(
    st.sampled_from(
        ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "412", "0.05", "95%", "placebo", "trial"]
    ),
    min_size=6,
    max_size=40,
)
any_text = st.text(max_size=200)


@given(any_text)
def test_offset_map_points_at_what_it_came_from(s: str) -> None:
    """OP5V-PROP-02 every normalised character maps to an original range that normalises to contain it."""
    n = normalize_with_map(s)
    assert len(n.start) == len(n.text) == len(n.end)
    for i, ch in enumerate(n.text):
        assert 0 <= n.start[i] < n.end[i] <= len(s)
        if ch != " ":
            assert ch in normalize(s[n.start[i] : n.end[i]])


def _per_cluster(s: str) -> tuple[str, list[int], list[int]]:
    """The normaliser written out plainly, one cluster at a time, with no fast path."""
    out, start, end = [], [], []
    pending = None
    i = 0
    while i < len(s):
        to = i + 1
        while to < len(s) and normaliser.is_mark(s[to]):
            to += 1
        for ch in normaliser._fold(s[i:to]):
            if normaliser.is_space(ch):
                pending = (pending[0] if pending else i, to)
                continue
            if pending and out:
                out.append(" ")
                start.append(pending[0])
                end.append(pending[1])
            pending = None
            out.append(ch)
            start.append(i)
            end.append(to)
        i = to
    return "".join(out), start, end


# Plain text with the things that end a fast run dropped in: marks after ASCII, odd spaces, double spaces.
tricky = st.lists(
    st.one_of(
        st.text(alphabet=st.characters(min_codepoint=32, max_codepoint=126), max_size=8),
        st.sampled_from(
            [
                " ",
                "  ",
                "\n",
                "\t ",
                chr(0xA0),
                chr(0x301),
                chr(0x301) * 2,
                chr(0xAD),
                chr(0x200B),
                chr(0xFB01),
                chr(0xE9),
                "e" + chr(0x301),
                chr(0x1F600),
                chr(0x1C),
                chr(0x85),
                chr(0x7F),
                chr(0x130),
            ]
        ),
    ),
    max_size=12,
).map("".join)


@settings(deadline=None, max_examples=1000)
@given(st.one_of(tricky, any_text))
def test_fast_path_matches_the_plain_reference(s: str) -> None:
    """OP5V-PY-05 the ASCII fast path gives exactly what per-cluster processing gives: text and whole offset map."""
    n = normalize_with_map(s)
    assert (n.text, n.start, n.end) == _per_cluster(s)


@given(any_text)
def test_normalize_is_idempotent(s: str) -> None:
    """OP5V-UNIT-01 normalising twice changes nothing on the second pass, and there is never a double space."""
    once = normalize(s)
    assert "  " not in once
    assert once == once.strip(" ")


@SLOW
@given(words, st.integers(0, 39), st.integers(4, 12))
def test_any_run_of_whole_words_verifies(tokens: list[str], at: int, length: int) -> None:
    """OP5V-PROP-01 a run of whole words from the section is verified, and the offsets give back its own text."""
    text = "  ".join(tokens) + "."
    start = at % len(tokens)
    quote = " ".join(tokens[start : start + length])
    if len(quote) < 20 or len(quote.split(" ")) < 4:
        return
    section = one(quote, text)
    assert section["status"] == "verified"
    e = section["evidence"][0]
    assert normalize(text[e["start"] : e["end"]]) == normalize(quote)


@SLOW
@given(words, st.integers(0, 39), st.sampled_from(["not", "no", "never", "increased"]))
def test_inserted_word_is_rejected(tokens: list[str], at: int, word: str) -> None:
    """OP5V-PROP-03 inserting one word into a real quote is never accepted, unless the result is really in the text."""
    text = " ".join(tokens) + "."
    i = 1 + at % (len(tokens) - 1)
    changed = [*tokens[:i], word, *tokens[i:]]
    quote = " ".join(changed)
    if len(quote) > 400:
        return
    assert quote.lower() not in text.lower()
    section = one(quote, text)
    assert section["status"] == "no_verificado"
    assert section["evidence"] == []


@SLOW
@given(st.text(max_size=120), st.text(min_size=20, max_size=120))
def test_fuzz_never_throws_and_never_falsely_accepts(section_text: str, quote: str) -> None:
    """OP5V-FUZZ-01 random unicode in drafts and sections: no throw, no false accept."""
    section = one(quote, section_text, summary=quote)
    if section["status"] == "verified":
        assert normalize(quote) in normalize(section_text)


def test_lone_surrogates_are_refused_at_the_boundary() -> None:
    """OP5V-FUZZ-01 a lone surrogate cannot reach storage: the draft fails and the text is refused, without a throw inside."""
    lone = chr(0xD800)
    section = one(f"a real looking quote with {lone} inside it", "some section text here")
    assert section["status"] == "failed"
    with pytest.raises(ValidationError):
        article(f"text with {lone} inside")
    assert (
        validate_drafts(
            DOI, {"intro": {"mainTopic": lone, "prerequisiteTopics": []}, "sections": []}, article("x"), META, AT
        ).summary.mainTopic
        is None
    )


def test_astral_letters_count_as_word_characters() -> None:
    """OP5V-PY-04 a quote cannot start inside a word written in characters above U+FFFF (stricter than the reference, D34)."""
    a, b = chr(0x20000), chr(0x20001)
    hay = normalize_with_map(f"{a}{b} words of this section here")
    assert find_quote(hay, f"{b} words of this section") == -1
    assert find_quote(hay, f"{a}{b} words of this section") == 0


HALF, CELSIUS, FRACTION, DEGREE, ELLIPSIS = chr(0xBD), chr(0x2103), chr(0x2044), chr(0xB0), chr(0x2026)


@pytest.mark.parametrize(
    ("hay", "needle", "index"),
    [
        (f"dose of {HALF} tablet", "dose of 1", -1),  # ends inside the fraction: "1" is not what the paper says
        (f"{HALF} tablet daily", "2 tablet daily", -1),  # starts inside it
        (HALF, f"1{FRACTION}2", 0),
        (HALF, f"{FRACTION}2", -1),
        (HALF, f"1{FRACTION}", -1),
        (f"x {HALF}", f"1{FRACTION}2", 2),
        (f"x {CELSIUS} rose", "c rose", -1),
        (f"x {CELSIUS} rose", f"x {DEGREE}", -1),
        (f"x {CELSIUS} rose", f"x {DEGREE}c", 0),
        (f"x {CELSIUS}", f"x {DEGREE}c", 0),
        (f".{ELLIPSIS}", "...", 1),  # first candidate cuts the ellipsis; the overlapping second one is whole
        ("foo bar baz quxy", "foo bar baz qux", -1),  # cuts the last word, one character from the end
        ("foo bar", "foo bar", 0),
    ],
)
def test_quote_covers_whole_clusters_and_words(hay: str, needle: str, index: int) -> None:
    """OP5V-PROP-03 a quote may not end or start inside an expanded character, even when the next character is not a word character."""
    assert find_quote(normalize_with_map(hay), needle) == index


def test_quote_length_limit_is_exact() -> None:
    """OP5V-UNIT-03 400 normalised characters pass; 401 are too long, even though they are in the text."""
    body = "word " * 79
    text = f"{body}words end. {body}wordss end."
    assert one(f"{body}words", text)["status"] == "verified"
    long = one(f"{body}wordss", text)
    assert long["status"] == "no_verificado"
    assert long["rejected"][0]["reason"] == "QUOTE_TOO_LONG"


def test_determinism() -> None:
    """OP5V-PROP-04 same input gives a byte-identical Summary."""
    text = json.loads((FIXTURES / "article-text.json").read_text("utf-8"))
    text.pop("_note")
    drafts = {
        "intro": {"mainTopic": "Vitamina D", "prerequisiteTopics": ["ensayo clinico"]},
        "sections": [
            {
                "section": "results",
                "summaryEs": "Hubo menos infecciones.",
                "evidence": [
                    {"quote": "Acute respiratory infections occurred in 81 participants", "section": "results"}
                ],
            }
        ],
    }
    a = validate_drafts(DOI, drafts, ArticleText.model_validate(text), META, AT).summary.model_dump_json()
    b = validate_drafts(
        DOI, json.loads(json.dumps(drafts)), ArticleText.model_validate(text), META, AT
    ).summary.model_dump_json()
    assert a == b


@pytest.mark.parametrize("name", ["summary.v1.full-text.json", "summary.v1.abstract-only.json"])
def test_v1_fixtures_parse_forever(name: str) -> None:
    """OP5V-TYPE-01 frozen v1 summaries from the reference parse, and a new key or wrong version does not."""
    raw = json.loads((FIXTURES / name).read_text("utf-8"))
    assert Summary.model_validate(raw).model_dump() == raw
    with pytest.raises(ValidationError):
        Summary.model_validate({**raw, "extra": 1})
    with pytest.raises(ValidationError):
        Summary.model_validate({**raw, "schemaVersion": 2})


def test_normaliser_version_guard() -> None:
    """OP5V-CFG-01 normaliser.py is pinned to NORMALISER_VERSION: any change needs a bump and a new hash."""
    path = Path(normaliser.__file__)
    source = path.read_bytes().replace(b"\r\n", b"\n")
    digest = hashlib.sha256(source).hexdigest()
    lock = json.loads(path.with_name("normaliser.versions.json").read_text("utf-8"))
    assert lock.get(NORMALISER_VERSION) == digest, (
        f"normaliser.py changed (sha256 {digest}). Bump NORMALISER_VERSION and append it."
    )
    assert len(set(lock.values())) == len(lock), "two versions share one hash"
    assert NORMALISER_VERSION == "1", (
        "the port must stay on the version it was checked against, or regenerate the vectors"
    )


def test_numbers_rule_is_ascii_only() -> None:
    """OP5V-UNIT-07 only ASCII digits are numbers, as in the reference: Python's \\d would also match other scripts."""
    from biovidgen.summary.evidence import canon_numbers

    assert canon_numbers(f"{chr(0x661)}{chr(0x662)} y 5") == ["5"]
    assert canon_numbers("x5 5x") == ["5"]
    assert canon_numbers("a_5") == ["5"]  # underscore is not a letter or number, whatever Python's \w says
    assert re.fullmatch(r"\d", chr(0x661)) is not None  # why this test exists


def test_performance() -> None:
    """OP5V-PERF-01 4 sections x 5 quotes on 60k-char sections: p95 under the 100 ms fail line (target 20 ms, D26)."""
    fixture = json.loads((FIXTURES / "article-text.json").read_text("utf-8"))
    base = fixture["sections"]["results"]["text"]
    big = ((base + " ") * (60_000 // len(base) + 1))[:60_000]
    sections = {
        n: {"text": big, "headingSeen": n, "mergedWith": None}
        for n in ("methods", "results", "discussion", "conclusions")
    }
    text = ArticleText(
        doi_norm="10.1234/x",
        contentHash="c",
        source="dom",
        sections=sections,
        missing=[],
        language="en",
        usable=True,
        truncated=False,
        headingsVersion="h1",
        schemaVersion=1,
    )
    quote = "No serious adverse events were attributed to the intervention"

    def q(section: str) -> list[dict]:
        return [{"quote": quote, "section": section}] * 5

    slots = [
        ("methodology", "methods"),
        ("results", "results"),
        ("conclusions", "conclusions"),
        ("results", "discussion"),
    ]
    drafts = {"sections": [{"section": slot, "summaryEs": "Resumen.", "evidence": q(name)} for slot, name in slots]}
    times = []
    for _ in range(25):
        t0 = time.perf_counter()
        validate_drafts(DOI, drafts, text, META, AT)
        times.append((time.perf_counter() - t0) * 1000)
    times.sort()
    print(f"OP5V-PERF-01 p50={times[12]:.1f} ms p95={times[23]:.1f} ms")
    assert times[23] <= 100
