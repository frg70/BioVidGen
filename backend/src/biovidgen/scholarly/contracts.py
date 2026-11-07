"""Article v1 (OP3 plan §5 with deltas D3 and D36). The extension mirrors it in src/contracts/article.ts.

Semantics: `[]` means "asked, none found" and `coverage` says so; `null` means the source gave no value.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

ARTICLE_SCHEMA_VERSION = 1

Short = Annotated[str, Field(min_length=1, max_length=500)]
Long = Annotated[str, Field(min_length=1, max_length=2000)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class Author(_Strict):
    name: Short
    orcid: Annotated[str, Field(pattern=r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")] | None


class Keyword(_Strict):
    term: Short
    source: Literal["openalex_keyword", "openalex_topic"]
    score: float | None


class Topic(_Strict):
    name: Short
    field: Short | None


class Coverage(_Strict):
    authors: Literal["found", "none_found"]
    keywords: Literal["found", "none_found"]


class Article(_Strict):
    doi: Annotated[str, Field(max_length=256)]
    openalexId: Annotated[str, Field(pattern=r"^W\d{1,12}$")] | None
    pmid: Annotated[str, Field(pattern=r"^\d{1,9}$")] | None
    pmcid: Annotated[str, Field(pattern=r"^PMC\d{1,9}$")] | None
    title: Long | None
    journal: Short | None
    year: int | None
    authors: list[Author]
    keywords: Annotated[list[Keyword], Field(max_length=15)]
    primaryTopic: Topic | None
    type: Short | None
    abstract: Annotated[str, Field(min_length=1, max_length=50_000)] | None
    oaUrl: Annotated[str, Field(max_length=2048, pattern=r"^https?://")] | None
    isOA: bool | None
    coverage: Coverage
    fetchedAt: str
    schemaVersion: Literal[1]


class Resolved(_Strict):
    """What the endpoint answers. `stale`: OpenAlex could not be reached, so this is the last copy.
    `saved`: false when storing failed; the article is still correct, it just is not cached."""

    article: Article
    stale: bool
    saved: bool
