"""Outbound HTTPS to the scholarly APIs (rules 1 and 8): stdlib urllib and the OS certificate store only.

Fixed origins, redirects that stay on them, a total deadline per attempt, a size cap, retries with full jitter.
"""

import random
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from .. import __version__

ALLOWED = frozenset({"https://api.openalex.org"})
USER_AGENT = f"BioVidGen/{__version__} (+https://github.com/frg70/BioVidGen)"
TIMEOUT_S = 5.0  # whole attempt, not per read: the OP3 spike saw one call take 752 s with a 15 s socket timeout
MAX_BYTES = 2_000_000  # a work with 1,011 authors is about 1 MB
ATTEMPTS = 3
BACKOFF_S = 0.5
RETRY_AFTER_MAX_S = 10.0  # a longer wait is not worth holding the panel for

Failure = Literal["TIMEOUT", "NETWORK", "TOO_LARGE"]


@dataclass(frozen=True)
class Answer:
    status: int
    content_type: str
    body: bytes
    retry_after: float | None


def _origin(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


class _StayOnOrigin(urllib.request.HTTPRedirectHandler):
    def __init__(self, allowed: frozenset[str]) -> None:
        self.allowed = allowed

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if _origin(newurl) not in self.allowed:
            raise urllib.error.URLError("redirect off the allowlist")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _retry_after(value: str | None) -> float | None:
    return float(value) if value is not None and value.strip().isdigit() else None  # HTTP dates fall back to backoff


def fetch_once(
    url: str,
    *,
    allowed: frozenset[str] = ALLOWED,
    timeout_s: float = TIMEOUT_S,
    max_bytes: int = MAX_BYTES,
) -> Answer | Failure:
    if _origin(url) not in allowed:
        raise ValueError("origin not on the allowlist")  # a programming error, never a runtime condition
    deadline = time.monotonic() + timeout_s
    opener = urllib.request.build_opener(_StayOnOrigin(allowed))
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})  # noqa: S310 allowlisted
    try:
        # ponytail: the socket timeout bounds each read; the deadline is checked between reads, so one attempt
        # ends within about timeout_s + timeout_s / 2. Move to a selector loop if that slack matters.
        with opener.open(request, timeout=timeout_s / 2) as response:
            chunks: list[bytes] = []
            size = 0
            while chunk := response.read1(65536):
                size += len(chunk)
                if size > max_bytes:
                    return "TOO_LARGE"
                if time.monotonic() > deadline:
                    return "TIMEOUT"
                chunks.append(chunk)
            return Answer(response.status, response.headers.get_content_type(), b"".join(chunks), None)
    except urllib.error.HTTPError as e:
        return Answer(e.code, e.headers.get_content_type(), b"", _retry_after(e.headers.get("Retry-After")))
    except TimeoutError:
        return "TIMEOUT"
    except (urllib.error.URLError, OSError, ValueError):  # ValueError: malformed response line
        return "NETWORK"


def _retryable(got: Answer | Failure) -> bool:
    if isinstance(got, Answer):
        return got.status == 429 or got.status >= 500
    return got != "TOO_LARGE"


def fetch(
    url: str,
    *,
    once: Callable[[str], Answer | Failure] = fetch_once,
    sleep: Callable[[float], None] = time.sleep,
    rand: Callable[[], float] = random.random,
) -> tuple[Answer | Failure, int]:
    """The final answer and how many attempts it took."""
    for attempt in range(1, ATTEMPTS + 1):
        got = once(url)
        if not _retryable(got) or attempt == ATTEMPTS:
            return got, attempt
        wait = got.retry_after if isinstance(got, Answer) else None
        if wait is None:
            wait = rand() * BACKOFF_S * 2 ** (attempt - 1)  # full jitter
        elif wait > RETRY_AFTER_MAX_S:
            return got, attempt
        sleep(wait)
    raise AssertionError("unreachable")
