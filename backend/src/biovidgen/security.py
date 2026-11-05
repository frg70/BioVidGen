"""Local-server boundary (ADR-0010 Decision 5).

Any web page and any local process can send requests to 127.0.0.1, so every request passes:
Host check (DNS rebinding) -> Origin allowlist -> CORS preflight -> body size -> pairing token.
"""

import hmac
import os
import re
import secrets
from pathlib import Path

from .config import Settings

TOKEN_FILE = "token"  # noqa: S105 (a file name, not a secret)
TOKEN_RE = re.compile(r"[0-9a-f]{64}")
PUBLIC_PATHS = frozenset({"/health"})  # liveness only; reveals nothing but the version


def load_or_create_token(data_dir: Path) -> str:
    """256-bit pairing token, created once with user-only permissions (0600 on POSIX)."""
    data_dir.mkdir(parents=True, exist_ok=True)
    path = data_dir / TOKEN_FILE
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, "w", encoding="ascii") as f:
            f.write(secrets.token_hex(32))
    token = path.read_text(encoding="ascii").strip()
    if not TOKEN_RE.fullmatch(token):
        raise RuntimeError(f"corrupt pairing token file: {path} (delete it to re-pair)")
    return token


def token_matches(given: str | None, expected: str) -> bool:
    return given is not None and hmac.compare_digest(given.encode(), expected.encode())


def allowed_hosts(s: Settings) -> frozenset[str]:
    return frozenset({f"127.0.0.1:{s.port}", f"localhost:{s.port}"})


def allowed_origins(s: Settings) -> frozenset[str]:
    own = {f"http://127.0.0.1:{s.port}", f"http://localhost:{s.port}"}
    return frozenset(own | {f"chrome-extension://{i}" for i in s.extension_ids})


CORS_HEADERS = {
    "Access-Control-Allow-Methods": "GET, POST",
    "Access-Control-Allow-Headers": "X-BVG-Token, X-BVG-Run-Id, Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
}
