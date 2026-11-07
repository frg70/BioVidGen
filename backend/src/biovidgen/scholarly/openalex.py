"""OpenAlex work → Article (OP3 plan §8, delta D36: OpenAlex is the only source). Pure functions.

The upstream schema keeps only what is read, tolerates new fields and requires only `id`: OpenAlex can add
fields without breaking us, and a field we read changing type fails as UPSTREAM_INVALID (OP3-CON-01).
"""

import json
import math
import re
import unicodedata
import urllib.parse
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from .contracts import ARTICLE_SCHEMA_VERSION, Article, Author, Coverage, Keyword, Topic
from .http import Answer, Failure

OPENALEX = "https://api.openalex.org"
KEYWORD_MIN_SCORE = 0.3  # ASSUMPTION from the plan; the spike saw no coverage change at this cut (99.0% both ways)
KEYWORDS_MAX = 15
TOPICS_USED = 3
ABSTRACT_WORDS_MAX = 20_000


class _Up(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)


class _Named(_Up):
    display_name: str | None = None


class _Author(_Up):
    display_name: str | None = None
    orcid: str | None = None


class _Authorship(_Up):
    author: _Author | None = None


class _Scored(_Up):
    display_name: str | None = None
    score: float | None = None


class _Topic(_Up):
    display_name: str | None = None
    field: _Named | None = None


class _Location(_Up):
    source: _Named | None = None
    pdf_url: str | None = None
    landing_page_url: str | None = None


class _OpenAccess(_Up):
    is_oa: bool | None = None


class _Ids(_Up):
    pmid: str | None = None
    pmcid: str | None = None


class OpenAlexWork(_Up):
    id: str
    doi: str | None = None
    display_name: str | None = None
    publication_year: int | None = None
    type: str | None = None
    ids: _Ids | None = None
    authorships: list[_Authorship] | None = None
    keywords: list[_Scored] | None = None
    topics: list[_Scored] | None = None
    primary_topic: _Topic | None = None
    primary_location: _Location | None = None
    best_oa_location: _Location | None = None
    open_access: _OpenAccess | None = None
    abstract_inverted_index: dict[str, list[int]] | None = None


OA_FIELDS = tuple(OpenAlexWork.model_fields)


def work_url(doi: str) -> str:
    """Only the DOI and the field list leave the machine (OP3-SEC-01). Every DOI character outside `/` is encoded."""
    return f"{OPENALEX}/works/doi:{urllib.parse.quote(doi, safe='/')}?select={','.join(OA_FIELDS)}"


def parse_work(answer: Answer | Failure) -> OpenAlexWork | Literal["UPSTREAM_INVALID"]:
    if not isinstance(answer, Answer) or answer.status != 200 or answer.content_type != "application/json":
        return "UPSTREAM_INVALID"
    try:
        return OpenAlexWork.model_validate(json.loads(answer.body))
    except (ValueError, ValidationError):  # JSONDecodeError and UnicodeDecodeError are ValueErrors
        return "UPSTREAM_INVALID"


def _text(value: str | None, limit: int) -> str | None:
    """NFC, trimmed, bounded. Lone surrogates (valid in JSON, not in UTF-8) become "?" so SQLite can store them."""
    if not value:
        return None
    clean = unicodedata.normalize("NFC", value.encode("utf-8", "replace").decode("utf-8")).strip()
    return clean[:limit].rstrip() or None


def _tail(value: str | None, pattern: str) -> str | None:
    match = re.search(pattern, value or "")
    return match.group(1) if match else None


def reconstruct(index: dict[str, list[int]] | None) -> str | None:
    """OpenAlex abstract_inverted_index → text. O(T log T) for T positions; absurd sizes give null."""
    if not index:
        return None
    pairs = [(p, word) for word, positions in index.items() for p in positions if p >= 0]
    if not pairs or len(pairs) > ABSTRACT_WORDS_MAX:
        return None
    return " ".join(word for _, word in sorted(pairs))


def _keywords(work: OpenAlexWork) -> list[Keyword]:
    found = [
        (k.display_name, "openalex_keyword", k.score)
        for k in work.keywords or []
        if k.score is None or k.score >= KEYWORD_MIN_SCORE
    ]
    found += [(t.display_name, "openalex_topic", t.score) for t in (work.topics or [])[:TOPICS_USED]]
    seen: set[str] = set()
    out: list[Keyword] = []
    for raw, source, score in found:
        term = _text(raw, 500)
        if term is None or term.casefold() in seen:
            continue
        seen.add(term.casefold())
        finite = score is not None and math.isfinite(score)
        out.append(Keyword(term=term, source=source, score=score if finite else None))
        if len(out) == KEYWORDS_MAX:
            break
    return out


def _oa_url(location: object) -> str | None:
    if not isinstance(location, _Location):
        return None
    url = location.pdf_url or location.landing_page_url
    return url if url and len(url) <= 2048 and re.match(r"^https?://", url) else None


def to_article(work: OpenAlexWork, doi: str, fetched_at: str, current_year: int) -> Article:
    authors = []
    for a in work.authorships or []:
        name = _text(a.author.display_name if a.author else None, 500)
        if name is not None:
            orcid = _tail(a.author.orcid if a.author else None, r"(?:^|/)(\d{4}-\d{4}-\d{4}-\d{3}[\dX])$")
            authors.append(Author(name=name, orcid=orcid))
    keywords = _keywords(work)
    ids = work.ids or _Ids()
    year = work.publication_year
    topic = work.primary_topic
    topic_name = _text(topic.display_name, 500) if topic else None
    abstract = _text(reconstruct(work.abstract_inverted_index), 50_000)
    pmcid = _tail(ids.pmcid, r"(?:^|/)(?:PMC)?(\d{1,9})/?$")
    return Article(
        doi=doi,
        openalexId=_tail(work.id, r"(?:^|/)(W\d{1,12})$"),
        pmid=_tail(ids.pmid, r"(?:^|/)(\d{1,9})/?$"),
        pmcid=f"PMC{pmcid}" if pmcid else None,
        title=_text(work.display_name, 2000),
        journal=_text(work.primary_location.source.display_name, 500)
        if work.primary_location and work.primary_location.source
        else None,
        year=year if year is not None and 0 < year <= current_year else None,
        authors=authors,
        keywords=keywords,
        primaryTopic=Topic(name=topic_name, field=_text(topic.field.display_name if topic.field else None, 500))
        if topic and topic_name
        else None,
        type=_text(work.type, 500),
        abstract=abstract,
        oaUrl=_oa_url(work.best_oa_location),
        isOA=work.open_access.is_oa if work.open_access else None,
        coverage=Coverage(
            authors="found" if authors else "none_found",
            keywords="found" if keywords else "none_found",
        ),
        fetchedAt=fetched_at,
        schemaVersion=ARTICLE_SCHEMA_VERSION,
    )
