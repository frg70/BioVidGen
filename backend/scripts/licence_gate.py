"""Licence gate for the Python backend (CLAUDE.md rule 8, owner decision 2026-11-05).

Runtime: MIT, BSD, Apache-2.0, ISC, PSF-2.0. Dev-only adds MPL-2.0 and a few public-domain-like
licences. GPL family, SSPL, proprietary and unknown fail everywhere. Run: `uv run python scripts/licence_gate.py`.
"""

import re
import subprocess
import sys
from dataclasses import dataclass
from importlib.metadata import distributions
from pathlib import Path
from shutil import which

RUNTIME_OK = {"MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "PSF-2.0", "Python-2.0"}
DEV_EXTRA = {"MPL-2.0", "Unlicense", "CC0-1.0", "BlueOak-1.0.0"}

CLASSIFIERS = {
    "MIT License": "MIT",
    "BSD License": "BSD-3-Clause",
    "Apache Software License": "Apache-2.0",
    "ISC License (ISCL)": "ISC",
    "Python Software Foundation License": "PSF-2.0",
    "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
}
SPDX_LIKE = re.compile(r"^[A-Za-z0-9.+-]+(?: (?:OR|AND|WITH) [A-Za-z0-9.+-]+)*$")


@dataclass(frozen=True)
class Dist:
    name: str
    expression: str | None  # PEP 639 License-Expression
    license: str | None  # legacy License field
    classifiers: list[str]


@dataclass(frozen=True)
class Violation:
    name: str
    scope: str
    licence: str


def norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def is_allowed(expr: str | None, scope: str) -> bool:
    if not expr:
        return False
    ok = RUNTIME_OK | (DEV_EXTRA if scope == "dev" else set())
    alternatives = expr.replace("(", " ").replace(")", " ").split(" OR ")
    return any(all(part.strip() in ok for part in alt.split(" AND ")) for alt in alternatives)


def licence_of(d: Dist) -> str | None:
    if d.expression:
        return d.expression
    if d.license and SPDX_LIKE.match(d.license.strip()):
        return d.license.strip()
    found = [
        CLASSIFIERS.get(c.split(" :: ")[-1], c.split(" :: ")[-1]) for c in d.classifiers if c.startswith("License ::")
    ]
    return " OR ".join(found) or None


def check(dists: list[Dist], runtime: set[str]) -> list[Violation]:
    rt = {norm(n) for n in runtime}
    bad = []
    for d in dists:
        scope = "runtime" if norm(d.name) in rt else "dev"
        lic = licence_of(d)
        if not is_allowed(lic, scope):
            bad.append(Violation(d.name, scope, lic or "UNKNOWN"))
    return bad


def installed() -> list[Dist]:
    return [
        Dist(
            d.metadata["Name"],
            d.metadata.get("License-Expression"),
            d.metadata.get("License"),
            d.metadata.get_all("Classifier") or [],
        )
        for d in distributions()
    ]


def runtime_names() -> set[str]:
    """Runtime closure from the lockfile (all platforms' markers included)."""
    uv = which("uv")
    if uv is None:
        raise RuntimeError("uv not found on PATH")
    out = subprocess.run(  # noqa: S603 (fixed argv, no shell)
        [uv, "export", "--no-dev", "--no-hashes", "--no-emit-project", "--format", "requirements-txt"],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return {norm(m.group(1)) for m in re.finditer(r"^([A-Za-z0-9][A-Za-z0-9._-]*)==", out, re.M)}


if __name__ == "__main__":
    dists = installed()
    violations = check(dists, runtime_names())
    for v in violations:
        print(f"{v.name} ({v.scope}): {v.licence}")
    print(f"Licence gate {'FAILED' if violations else 'passed'}: {len(dists)} packages checked.")
    sys.exit(1 if violations else 0)
