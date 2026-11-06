"""OP5V normaliser and matcher: the definition of "verbatim" (rule 5, OP5V plan sections 4 and 8, delta D8).
Exact matching after a fixed, documented normalisation. Never fuzzy.

Any change to this file changes what counts as verified: bump NORMALISER_VERSION and append the new hash to
normaliser.versions.json (OP5V-CFG-01). tests/test_op5v_vectors.py holds it to the TypeScript reference.

JavaScript and Python disagree on some classes, so nothing here relies on Python's defaults:
  - whitespace is JavaScript's \\s, not Python's (which adds U+001C-U+001F and U+0085);
  - marks and word characters come from Unicode categories, which `re` cannot match.
"""

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

NORMALISER_VERSION = "1"

_FIRST_MARK = chr(0x300)  # every combining mark is at or above this
_SPACES = frozenset(
    chr(c)
    for c in (
        9,
        10,
        11,
        12,
        13,
        32,
        0xA0,
        0x1680,
        *range(0x2000, 0x200B),
        0x2028,
        0x2029,
        0x202F,
        0x205F,
        0x3000,
        0xFEFF,
    )
)
_ASCII_FOLD = {chr(c): chr(c).lower() for c in range(128)}
# Printable ASCII with single spaces maps 1:1 onto its lowercase form, so it needs no per-character work. This is
# what brings a paper within the OP5V-PERF-01 budget; tests hold it to a plain per-cluster reference.
_PLAIN_RUN = re.compile(r"[!-~]+(?: [!-~]+)*")
_FOLD = {
    **dict.fromkeys((0xAD, 0x200B, 0x200C, 0x200D, 0xFEFF)),  # soft hyphen, zero-width space/non-joiner/joiner, BOM
    **dict.fromkeys((0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212), "-"),
    **dict.fromkeys((0x201C, 0x201D), '"'),
    **dict.fromkeys((0x2018, 0x2019), "'"),
}


@dataclass(frozen=True)
class Normalised:
    """Normalised text plus, per normalised character, the original [start, end) it came from."""

    text: str
    start: list[int]
    end: list[int]


def is_mark(c: str) -> bool:
    return c >= _FIRST_MARK and unicodedata.category(c)[0] == "M"


def is_word(c: str) -> bool:
    return unicodedata.category(c)[0] in "LN"


def is_space(c: str) -> bool:
    return c in _SPACES


@lru_cache(maxsize=8192)
def _fold(cluster: str) -> str:
    """NFKC (ligatures, micro to mu, superscripts, NBSP), lowercase, dash and quote folding, invisibles removed.
    Per cluster, so every output character maps to a whole original cluster."""
    return unicodedata.normalize("NFKC", cluster).lower().translate(_FOLD)


def normalize_with_map(s: str) -> Normalised:
    """Folds clusters (one character plus its combining marks), collapses whitespace runs to one space and trims."""
    out: list[str] = []
    start: list[int] = []
    end: list[int] = []
    space_from = -1
    space_to = -1
    i = 0
    length = len(s)
    while i < length:
        run = _PLAIN_RUN.match(s, i)
        to = run.end() if run else i
        if to < length and is_mark(s[to]):
            to -= 1  # the last ASCII character belongs to the cluster of the mark that follows it
        if to > i:
            if space_from >= 0 and out:
                out.append(" ")
                start.append(space_from)
                end.append(space_to)
            space_from = -1
            out.append(s[i:to].lower())
            start.extend(range(i, to))
            end.extend(range(i + 1, to + 1))
            i = to
            continue
        to = i + 1
        while to < length and is_mark(s[to]):
            to += 1
        cluster = s[i:to]
        for ch in _ASCII_FOLD.get(cluster) or _fold(cluster):
            if ch in _SPACES:
                if space_from < 0:
                    space_from = i
                space_to = to
                continue
            if space_from >= 0 and out:
                out.append(" ")
                start.append(space_from)
                end.append(space_to)
            space_from = -1
            out.append(ch)
            start.append(i)
            end.append(to)
        i = to
    return Normalised("".join(out), start, end)


def normalize(s: str) -> str:
    return normalize_with_map(s).text


def find_quote(hay: Normalised, needle: str) -> int:
    """First index of `needle` (already normalised) in `hay` such that the match covers whole original clusters and
    does not cut a word: a quote may not start or end inside a word ("effective" inside "ineffective") or inside one
    expanded character (delta D23)."""
    if not needle:
        return -1
    text, start, end = hay.text, hay.start, hay.end
    last = len(needle) - 1
    i = text.find(needle)
    while i >= 0:
        j = i + last
        whole_clusters = (i == 0 or start[i - 1] != start[i]) and (j == len(text) - 1 or end[j + 1] != end[j])
        cuts_word = (i > 0 and is_word(text[i - 1]) and is_word(needle[0])) or (
            j < len(text) - 1 and is_word(text[j + 1]) and is_word(needle[last])
        )
        if whole_clusters and not cuts_word:
            return i
        i = text.find(needle, i + 1)
    return -1
