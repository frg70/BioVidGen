"""OP5V core (plan section 8), pure: no storage. Drafts are untrusted model output and are parsed here again."""

import re
from collections.abc import Mapping
from dataclasses import dataclass

from pydantic import ValidationError

from .contracts import (
    SECTION_NAMES,
    SUMMARY_KEYS,
    ArticleText,
    Evidence,
    IntroDraft,
    PrerequisiteTopic,
    ProviderMeta,
    Rejected,
    SectionDraft,
    Summary,
    SummarySection,
    u16_len,
)
from .normaliser import NORMALISER_VERSION, Normalised, find_quote, normalize, normalize_with_map

MIN_CHARS = 20
MIN_WORDS = 4
MAX_CHARS = 400

# A sign counts only at the start of a token: "5-10" is 5 and 10, " -3" is -3 (delta D24).
# [0-9], not \d: Python's \d also matches other scripts. [^\W_] is a letter or number.
_NUMBER = re.compile(r"(?<![^\W_])(?<![.,])([-+±]?)([0-9]+(?:[.,][0-9]+)?)( ?%)?")


@dataclass(frozen=True)
class Validated:
    summary: Summary
    counts: dict[str, int]  # counts only, for the log (OP5V-OBS-01). Never text.
    all_failed: bool


def canon_numbers(s: str) -> list[str]:
    """Canonical numbers in `s`: decimal comma to point, "95 %" to "95%"."""
    return [
        f"{sign}{number.replace(',', '.')}{'%' if percent else ''}"
        for sign, number, percent in _NUMBER.findall(normalize(s))
    ]


def _u16_offset(text: str, index: int) -> int:
    """Stored offsets are UTF-16 units: the client slices with them, and the contract is shared with TypeScript."""
    return index if text.isascii() else u16_len(text[:index])


def _failed() -> SummarySection:
    return SummarySection(
        summaryEs="", status="failed", evidence=[], rejected=[], numbersUnsupported=[], coverage="full"
    )


def _locate(index: dict[str, tuple[str, Normalised]], declared: str, needle: str) -> Evidence | None:
    """Declared section first, then the others in paper order (section correction)."""
    for name in (declared, *(n for n in SECTION_NAMES if n != declared)):
        if name not in index:
            continue
        original, norm = index[name]
        i = find_quote(norm, needle)
        if i >= 0:
            start, end = norm.start[i], norm.end[i + len(needle) - 1]
            return Evidence(
                quote=original[start:end],
                section=name,
                start=_u16_offset(original, start),
                end=_u16_offset(original, end),
            )
    return None


def _validate_section(draft: SectionDraft, index: dict, source: str, counts: dict[str, int]) -> SummarySection:
    evidence: list[Evidence] = []
    rejected: list[Rejected] = []
    for q in draft.evidence:
        counts["quotes"] += 1
        needle = normalize(q.quote)
        size = u16_len(needle)
        reason = (
            "QUOTE_TOO_SHORT"
            if size < MIN_CHARS or len(needle.split(" ")) < MIN_WORDS
            else "QUOTE_TOO_LONG"
            if size > MAX_CHARS
            else None
        )
        hit = None if reason else _locate(index, q.section, needle)
        if hit is None:
            reason = reason or "NOT_FOUND"
            rejected.append(Rejected(quote=q.quote, reason=reason))
            counts[f"rejected.{reason}"] += 1
            continue
        if hit.section != q.section:
            counts["section_mismatch"] += 1
        evidence.append(hit)
    evidence.sort(key=lambda e: (SECTION_NAMES.index(e.section), e.start, e.end))

    # Numbers rule: every number claimed must appear in a verified quote of this section.
    supported = {n for e in evidence for n in canon_numbers(e.quote)}
    claims = "\n".join([draft.summaryEs, "" if draft.n is None else str(draft.n), *draft.statistics])
    unsupported = list(dict.fromkeys(n for n in canon_numbers(claims) if n not in supported))

    counts["evidence"] += len(evidence)
    counts["numbers_unsupported"] += len(unsupported)
    clean = not rejected and evidence and not unsupported
    return SummarySection(
        summaryEs=draft.summaryEs,
        status="abstract_only" if source == "abstract_only" else "verified" if clean else "no_verificado",
        evidence=evidence,
        rejected=rejected,
        numbersUnsupported=unsupported,
        coverage=draft.coverage,
    )


def validate_drafts(doi: str, drafts: Mapping, text: ArticleText, meta: ProviderMeta, created_at: str) -> Validated:
    """`drafts` is {"sections": [...], "intro"?: ...}, unparsed. A missing intro is fine; an invalid one is counted."""
    keys = (
        "quotes",
        "evidence",
        "rejected.NOT_FOUND",
        "rejected.QUOTE_TOO_SHORT",
        "rejected.QUOTE_TOO_LONG",
        "section_mismatch",
        "drafts_invalid",
        "numbers_unsupported",
    )
    counts = dict.fromkeys(keys, 0) | dict.fromkeys(
        ("sections.verified", "sections.no_verificado", "sections.abstract_only", "sections.failed"), 0
    )

    index = {
        name: (text.sections[name].text, normalize_with_map(text.sections[name].text))
        for name in SECTION_NAMES
        if name in text.sections
    }

    by_slot: dict[str, SummarySection] = {}
    for raw in drafts["sections"]:
        try:
            draft = SectionDraft.model_validate(raw)
        except ValidationError:
            counts["drafts_invalid"] += 1
            slot = raw.get("section") if isinstance(raw, Mapping) else None
            if slot in SUMMARY_KEYS:
                by_slot[slot] = _failed()
            continue
        by_slot[draft.section] = _validate_section(draft, index, text.source, counts)

    sections = {k: by_slot[k] for k in SUMMARY_KEYS if k in by_slot}
    for s in sections.values():
        counts[f"sections.{s.status}"] += 1

    intro = None
    if "intro" in drafts:
        try:
            intro = IntroDraft.model_validate(drafts["intro"])
        except ValidationError:
            counts["drafts_invalid"] += 1

    return Validated(
        summary=Summary(
            doi=doi,
            pipelineVersion=meta.pipelineVersion,
            mainTopic=intro.mainTopic if intro else None,
            prerequisiteTopics=[
                PrerequisiteTopic(topic=t, label="background_knowledge")
                for t in (intro.prerequisiteTopics if intro else [])
            ],
            sections=sections,
            provider=meta.provider,
            modelId=meta.modelId,
            promptHash=meta.promptHash,
            normaliserVersion=NORMALISER_VERSION,
            createdAt=created_at,
            schemaVersion=1,
        ),
        counts=counts,
        all_failed=all(s.status == "failed" for s in sections.values()),
    )
