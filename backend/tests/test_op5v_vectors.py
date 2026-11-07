"""OP5V port against vectors frozen from the TypeScript reference (npm run vectors, ADR-0010 section 6)."""

import json
import unicodedata
from pathlib import Path

import pytest

from biovidgen.summary.contracts import ArticleText, ProviderMeta
from biovidgen.summary.evidence import canon_numbers, validate_drafts
from biovidgen.summary.normaliser import find_quote, is_mark, is_space, is_word, normalize, normalize_with_map

VECTORS = Path(__file__).parents[2] / "extension" / "fixtures" / "op5v" / "vectors"
SUITE = json.loads((VECTORS / "conformance.json").read_text("utf-8"))
NORMALISER = json.loads((VECTORS / "normaliser.json").read_text("utf-8"))
TABLE = json.loads((VECTORS / "unicode-table.json").read_text("utf-8"))
CASES = SUITE["cases"]
TEXTS = {name: ArticleText.model_validate(text) for name, text in SUITE["texts"].items()}


def run(case: dict) -> dict:
    v = validate_drafts(
        case["doi"], case["drafts"], TEXTS[case["text"]], ProviderMeta(**case["meta"]), case["createdAt"]
    )
    return {"summary": v.summary.model_dump(), "counts": v.counts, "allFailed": v.all_failed}


def tagged(tag: str) -> list[dict]:
    return [c for c in CASES if tag in c["ids"]]


def u16(text: str, index: int) -> int:
    return len(text[:index].encode("utf-16-le", "surrogatepass")) // 2


def u16_slice(text: str, start: int, end: int) -> str:
    return text.encode("utf-16-le", "surrogatepass")[start * 2 : end * 2].decode("utf-16-le", "surrogatepass")


@pytest.mark.parametrize("index", range(len(CASES)), ids=lambda i: f"{i}-{CASES[i]['ids'][0]}")
def test_conformance(index: int) -> None:
    """OP5V-PY-01 same drafts and text give the same Summary and counts as the TypeScript reference."""
    case = CASES[index]
    assert run(case) == case["expected"]


def test_near_quotes_rejected() -> None:
    """OP5V-HYP-01 OP5V-PROP-03 OP5V-KPI-01 0 false accepts on 500 generated near-quotes."""
    cases = tagged("OP5V-HYP-01")
    assert len(cases) == 500
    for case in cases:
        section = run(case)["summary"]["sections"]["results"]
        quote = case["drafts"]["sections"][0]["evidence"][0]["quote"]
        assert section["status"] == "no_verificado", quote
        assert section["evidence"] == [], quote
        assert section["rejected"][0]["reason"] == "NOT_FOUND", quote


def test_true_quotes_verified() -> None:
    """OP5V-PROP-01 OP5V-PROP-02 true quotes with cosmetic variants verify, and offsets round-trip."""
    cases = tagged("OP5V-PROP-01")
    assert len(cases) == 300
    for case in cases:
        section = run(case)["summary"]["sections"]["results"]
        quote = case["drafts"]["sections"][0]["evidence"][0]["quote"]
        assert section["status"] == "verified", quote
        for e in section["evidence"]:
            original = TEXTS[case["text"]].sections[e["section"]].text
            assert normalize(e["quote"]) in normalize(original)
            assert u16_slice(original, e["start"], e["end"]) == e["quote"]
            assert normalize(e["quote"]) == normalize(quote)


def test_planted_numbers_caught() -> None:
    """OP5V-HYP-03 numbers rule catches 100 of 100 planted numbers."""
    cases = tagged("OP5V-HYP-03")
    assert len(cases) == 100
    for case in cases:
        section = run(case)["summary"]["sections"]["results"]
        assert section["status"] == "no_verificado", case["drafts"]["sections"][0]["summaryEs"]
        assert section["numbersUnsupported"], case["drafts"]["sections"][0]["summaryEs"]


def test_fuzz_vectors_no_false_accept() -> None:
    """OP5V-FUZZ-01 random unicode from the reference: no throw, nothing verified that is not in the section."""
    cases = tagged("OP5V-FUZZ-01")
    assert len(cases) == 300
    for case in cases:
        section = run(case)["summary"]["sections"]["results"]
        original = TEXTS[case["text"]].sections["results"].text
        quote = case["drafts"]["sections"][0]["evidence"][0]["quote"]
        if section["status"] == "verified":
            assert normalize(quote) in normalize(original)


def _ranges_contain(ranges: list[list[int]], code: int) -> bool:
    return any(a <= code <= b for a, b in ranges)


def _expanded(ranges: list[list[int]]) -> set[int]:
    return {code for a, b in ranges for code in range(a, b + 1)}


def test_every_code_point_folds_and_classes_like_the_reference() -> None:
    """OP5V-PY-02 every code point: same fold, mark, word and space class. Only characters Python's older Unicode
    does not know may differ."""
    folded = {int(k): v for k, v in TABLE["folded"].items()}
    marks, word, space = _expanded(TABLE["marks"]), _expanded(TABLE["word"]), _expanded(TABLE["space"])
    differ = []
    for code in range(0x110000):
        if 0xD800 <= code <= 0xDFFF:
            continue
        c = chr(code)
        same = (
            normalize(c) == folded.get(code, c)
            and is_mark(c) == (code in marks)
            and is_word(c) == (code in word)
            and is_space(c) == (code in space)
        )
        if not same:
            differ.append(code)
    assigned = [hex(code) for code in differ if unicodedata.category(chr(code)) != "Cn"]
    assert assigned == []
    assert TABLE["unicode"] == "16.0" and unicodedata.unidata_version == "15.0.0", "versions changed: review this test"
    assert len(differ) < 8000  # characters added in Unicode 15.1 and 16.0


@pytest.mark.parametrize("index", range(len(NORMALISER["strings"])))
def test_normaliser_vectors(index: int) -> None:
    """OP5V-PY-01 OP5V-UNIT-01 OP5V-UNIT-02 OP5V-UNIT-07 normalised text, full offset map and numbers match the reference."""
    case = NORMALISER["strings"][index]
    n = normalize_with_map(case["input"])
    assert n.text == case["text"]
    # Python maps per code point in code points; JavaScript per UTF-16 unit in UTF-16 units.
    start, end = [], []
    for i, ch in enumerate(n.text):
        units = 2 if ord(ch) > 0xFFFF else 1
        start += [u16(case["input"], n.start[i])] * units
        end += [u16(case["input"], n.end[i])] * units
    assert start == case["start"]
    assert end == case["end"]
    assert canon_numbers(case["input"]) == case["numbers"]


@pytest.mark.parametrize("index", range(len(NORMALISER["findQuote"])))
def test_find_quote_vectors(index: int) -> None:
    """OP5V-PROP-03 OP5V-UNIT-06 whole clusters, whole words, first occurrence: same as the reference."""
    case = NORMALISER["findQuote"][index]
    hay = normalize_with_map(case["hay"])
    found = find_quote(hay, case["needle"])
    expected = case["index"]
    assert (found if found < 0 else u16(hay.text, found)) == expected
