"""Settings from environment variables. Loopback only (ADR-0010 Decision 1)."""

import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

LOOPBACK = "127.0.0.1"
DEFAULT_PORT = 8765
EXTENSION_ID = re.compile(r"[a-p]{32}")


def default_data_dir() -> Path:
    """Per-user data directory: %LOCALAPPDATA%, ~/Library/Application Support or $XDG_DATA_HOME."""
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "BioVidGen"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "BioVidGen"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "biovidgen"


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    port: int = DEFAULT_PORT
    host: str = LOOPBACK
    extension_ids: tuple[str, ...] = ()
    max_body_bytes: int = 1_000_000  # ~1 MB: one paper's text with headroom (OP4 caps text at 200k chars)

    def __post_init__(self) -> None:
        if self.host != LOOPBACK:
            raise ValueError(f"the backend binds to {LOOPBACK} only (ADR-0010), not {self.host!r}")
        bad = [i for i in self.extension_ids if not EXTENSION_ID.fullmatch(i)]
        if bad:
            raise ValueError(f"invalid Chrome extension id: {bad}")

    @property
    def db_path(self) -> Path:
        return self.data_dir / "biovidgen.sqlite3"

    @classmethod
    def from_env(cls) -> "Settings":
        ids = tuple(i.strip() for i in os.environ.get("BIOVIDGEN_EXTENSION_IDS", "").split(",") if i.strip())
        return cls(
            data_dir=Path(os.environ.get("BIOVIDGEN_DATA_DIR") or default_data_dir()),
            port=int(os.environ.get("BIOVIDGEN_PORT", DEFAULT_PORT)),
            extension_ids=ids,
        )
