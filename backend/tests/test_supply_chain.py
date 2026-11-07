"""Licence gate and runtime dependency rules (CLAUDE.md rules 1, 8; ADR-0010)."""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from licence_gate import Dist, check, is_allowed, runtime_names  # noqa: E402


def test_be0_sec_08_licence_policy() -> None:
    """BE0-SEC-08 runtime: MIT/BSD/Apache-2.0/ISC/PSF-2.0 only; dev adds MPL-2.0; GPL family and unknown fail everywhere."""
    for lic in [
        "MIT",
        "ISC",
        "Apache-2.0",
        "BSD-2-Clause",
        "BSD-3-Clause",
        "PSF-2.0",
        "Apache-2.0 OR BSD-2-Clause",
        "MIT AND ISC",
    ]:
        assert is_allowed(lic, "runtime"), lic
    for lic in ["MPL-2.0", "MIT OR MPL-2.0"]:
        assert is_allowed(lic, "dev"), lic
    assert not is_allowed("MPL-2.0", "runtime")
    for lic in [
        "GPL-3.0",
        "GPL-2.0-or-later",
        "AGPL-3.0-or-later",
        "LGPL-2.1",
        "SSPL-1.0",
        "",
        None,
        "Proprietary",
        "MIT AND GPL-3.0",
    ]:
        assert not is_allowed(lic, "dev"), lic
        assert not is_allowed(lic, "runtime"), lic
    assert is_allowed("MIT OR GPL-3.0", "runtime")  # dual licence: we take MIT


def test_be0_sec_08_licence_check_reports_scope() -> None:
    """BE0-SEC-08 the check reads PEP 639 expressions, then License, then classifiers, and reports package + scope."""
    dists = [
        Dist("ok", "MIT", None, []),
        Dist("cls", None, None, ["License :: OSI Approved :: BSD License"]),
        Dist("psf", None, None, ["License :: OSI Approved :: Python Software Foundation License"]),
        Dist("mpl-run", None, "MPL-2.0", []),
        Dist("mpl-dev", None, None, ["License :: OSI Approved :: Mozilla Public License 2.0 (MPL 2.0)"]),
        Dist("gpl", None, None, ["License :: OSI Approved :: GNU General Public License v2 (GPLv2)"]),
        Dist("none", None, None, []),
    ]
    bad = check(dists, runtime={"ok", "cls", "psf", "mpl-run", "gpl"})
    assert [f"{v.name}:{v.scope}" for v in bad] == ["mpl-run:runtime", "gpl:runtime", "none:dev"]


def test_be0_sec_08_installed_environment_passes() -> None:
    """BE0-SEC-08 the real locked environment passes the gate (same check CI runs)."""
    from licence_gate import installed

    assert check(installed(), runtime_names()) == []


def test_be0_sec_10_no_httpx_or_certifi_at_runtime_and_no_telemetry() -> None:
    """BE0-SEC-10 runtime closure has no HTTP client libs (stdlib urllib only) and no telemetry SDK/exporter;
    src/ never imports httpx, requests, urllib3, certifi or opentelemetry."""
    rt = runtime_names()
    assert {"httpx", "httpcore", "requests", "urllib3", "certifi"} & rt == set()
    assert {
        n for n in rt if n.startswith("opentelemetry") and n != "opentelemetry-api"
    } == set()  # API only: no-op without an SDK
    banned = re.compile(r"^\s*(?:import|from)\s+(httpx|requests|urllib3|certifi|opentelemetry)\b", re.M)
    offenders = [str(p) for p in (ROOT / "src").rglob("*.py") if banned.search(p.read_text(encoding="utf-8"))]
    assert offenders == []
