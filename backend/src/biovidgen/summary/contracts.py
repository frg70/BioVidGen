"""Contracts for OP5V: the Python side of extension/src/contracts/pipeline.ts (ADR-0010).

Field names stay camelCase so the JSON is the same on both sides. Length limits count code points,
as Zod 4 does, so one payload is valid or invalid on both sides alike. One difference, on purpose:
lone surrogates are refused here (delta D34). JSON can carry them, but SQLite and UTF-8 cannot.
"""

from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StrictStr, StringConstraints

SECTION_NAMES = ("abstract", "introduction", "methods", "results", "discussion", "conclusions")
SUMMARY_KEYS = ("methodology", "results", "conclusions")
SectionName = Literal["abstract", "introduction", "methods", "results", "discussion", "conclusions"]
SummaryKey = Literal["methodology", "results", "conclusions"]
Status = Literal["verified", "no_verificado", "abstract_only", "failed"]
RejectReason = Literal["NOT_FOUND", "QUOTE_TOO_SHORT", "QUOTE_TOO_LONG"]
Coverage = Literal["full", "partial"]

MAX_SAFE_INTEGER = 2**53 - 1


def u16_len(s: str) -> int:
    """Length as JavaScript's .length counts it: characters above U+FFFF are two units."""
    return len(s) if s.isascii() else len(s.encode("utf-16-le", "surrogatepass")) // 2


def _well_formed(value: str) -> str:
    value.encode("utf-8")  # raises UnicodeEncodeError, a ValueError, on a lone surrogate
    return value


Text = Annotated[StrictStr, AfterValidator(_well_formed)]


def _whole_number(value: object) -> object:
    # JSON has one number type: 5.0 is the integer 5 in JavaScript and passes z.number().int().
    return int(value) if isinstance(value, float) and value.is_integer() else value


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ArticleSection(_Model):
    text: Text
    headingSeen: Text | None
    mergedWith: SectionName | None


class ArticleText(_Model):
    doi_norm: Text
    contentHash: Text
    source: Literal["dom", "oa_xml", "pdfjs", "abstract_only"]
    sections: dict[SectionName, ArticleSection]
    missing: list[SectionName]
    language: Text | None
    usable: bool
    truncated: bool
    headingsVersion: Text
    schemaVersion: Literal[1]


class DraftQuote(_Model):
    quote: Annotated[Text, Field(max_length=2000)]
    section: SectionName


class SectionDraft(_Model):
    """What OP5 returns per summary slot. Limits bound what an untrusted model can make us store."""

    section: SummaryKey
    summaryEs: Annotated[Text, Field(max_length=2000)]
    evidence: Annotated[list[DraftQuote], Field(max_length=5)]
    notReported: bool = False
    design: Annotated[Text, Field(max_length=100)] | None = None
    n: Annotated[int, BeforeValidator(_whole_number), Field(ge=0, le=MAX_SAFE_INTEGER)] | None = None
    statistics: Annotated[list[Annotated[Text, Field(max_length=200)]], Field(max_length=20)] = []
    coverage: Coverage = "full"


class IntroDraft(_Model):
    mainTopic: Annotated[Text, Field(min_length=1, max_length=200)] | None
    prerequisiteTopics: Annotated[list[Annotated[Text, Field(min_length=1, max_length=100)]], Field(max_length=10)]


class Evidence(_Model):
    quote: Text
    section: SectionName
    start: Annotated[int, Field(ge=0)]  # UTF-16 units, so the client can slice with the same numbers
    end: Annotated[int, Field(ge=0)]


class Rejected(_Model):
    quote: Annotated[Text, Field(max_length=2000)]
    reason: RejectReason


class SummarySection(_Model):
    summaryEs: Annotated[Text, Field(max_length=2000)]
    status: Status
    evidence: Annotated[list[Evidence], Field(max_length=5)]
    rejected: Annotated[list[Rejected], Field(max_length=5)]
    numbersUnsupported: list[Text]
    coverage: Coverage


class PrerequisiteTopic(_Model):
    topic: Text
    label: Literal["background_knowledge"]


class Summary(_Model):
    """Summary v1, written only by summary/validate.py (rule 4)."""

    doi: Text
    pipelineVersion: Annotated[Text, Field(min_length=1)]
    mainTopic: Text | None
    prerequisiteTopics: list[PrerequisiteTopic]
    sections: dict[SummaryKey, SummarySection]
    provider: Text
    modelId: Text
    promptHash: Text
    normaliserVersion: Text
    createdAt: Annotated[Text, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$")]
    schemaVersion: Literal[1]


class ProviderMeta(_Model):
    """Provenance from OP5. pipelineVersion already includes NORMALISER_VERSION."""

    provider: Text
    modelId: Text
    promptHash: Text
    pipelineVersion: Text
