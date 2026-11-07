"""Local-server boundary (ADR-0010 Decision 5). Any web page and any local process can reach 127.0.0.1."""

import os
import stat
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from biovidgen.app import create_app
from biovidgen.config import Settings
from biovidgen.security import load_or_create_token

from .conftest import BASE, EXT_ID, EXT_ORIGIN

PROTECTED = "/api/v1/status"


def test_be0_sec_01_binds_loopback_only(tmp_path: Path) -> None:
    """BE0-SEC-01 the server refuses any bind address other than 127.0.0.1."""
    assert Settings(data_dir=tmp_path).host == "127.0.0.1"
    for host in ("0.0.0.0", "::", "192.168.1.10", "localhost"):
        with pytest.raises(ValueError, match=r"127\.0\.0\.1"):
            Settings(data_dir=tmp_path, host=host)
    with pytest.raises(ValueError, match="extension id"):
        Settings(data_dir=tmp_path, extension_ids=("not-an-id",))


def test_be0_sec_02_token_required_and_compared(client: TestClient, token: str) -> None:
    """BE0-SEC-02 API routes need the pairing token: missing or wrong → 401; /health is public."""
    assert client.get(PROTECTED).status_code == 401
    assert client.get(PROTECTED, headers={"X-BVG-Token": "x" * 64}).status_code == 401
    assert client.get(PROTECTED, headers={"X-BVG-Token": ""}).status_code == 401
    r = client.get(PROTECTED, headers={"X-BVG-Token": token})
    assert r.status_code == 200
    assert r.json() == {"paired": True}
    assert client.get("/health").status_code == 200
    assert client.get(PROTECTED).json() == {"error": "UNAUTHORIZED"}


def test_be0_sec_03_foreign_origin_rejected(client: TestClient, token: str) -> None:
    """BE0-SEC-03 a foreign Origin is refused even with the right token; allowed origins pass."""
    for origin in (
        "https://evil.example",
        "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "null",
        "http://127.0.0.1:9999",
    ):
        r = client.get(PROTECTED, headers={"X-BVG-Token": token, "Origin": origin})
        assert (r.status_code, r.json()) == (403, {"error": "FORBIDDEN_ORIGIN"}), origin
        assert client.get("/health", headers={"Origin": origin}).status_code == 403, origin
    for origin in (EXT_ORIGIN, BASE, "http://localhost:8765"):
        assert client.get(PROTECTED, headers={"X-BVG-Token": token, "Origin": origin}).status_code == 200, origin
    # No Origin (navigation, curl): allowed, but the token is still required.
    assert client.get(PROTECTED, headers={"X-BVG-Token": token}).status_code == 200


def test_be0_sec_04_dns_rebinding_host_rejected(settings: Settings, token: str) -> None:
    """BE0-SEC-04 a Host header other than 127.0.0.1:<port> / localhost:<port> → 403 (DNS rebinding)."""
    app = create_app(settings)
    for base in ("http://evil.example:8765", "http://127.0.0.1:80", "http://attacker.localhost:8765"):
        r = TestClient(app, base_url=base).get("/health")
        assert (r.status_code, r.json()) == (403, {"error": "FORBIDDEN_HOST"}), base
    for base in (BASE, "http://localhost:8765"):
        assert TestClient(app, base_url=base).get("/health").status_code == 200, base


def test_be0_sec_05_cors_exact_origin_never_wildcard(client: TestClient, token: str) -> None:
    """BE0-SEC-05 preflight answers only allowed origins, echoing the exact origin; never '*'."""
    pre = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-bvg-token, content-type"}
    ok = client.options(PROTECTED, headers={**pre, "Origin": EXT_ORIGIN})
    assert ok.status_code == 204
    assert ok.headers["access-control-allow-origin"] == EXT_ORIGIN
    assert ok.headers["vary"] == "Origin"
    assert "x-bvg-token" in ok.headers["access-control-allow-headers"].lower()
    bad = client.options(PROTECTED, headers={**pre, "Origin": "https://evil.example"})
    assert bad.status_code == 403
    assert "access-control-allow-origin" not in bad.headers
    r = client.get(PROTECTED, headers={"X-BVG-Token": token, "Origin": EXT_ORIGIN})
    assert r.headers["access-control-allow-origin"] == EXT_ORIGIN
    assert "access-control-allow-origin" not in client.get(PROTECTED, headers={"X-BVG-Token": token}).headers
    assert "*" not in "".join(v for k, v in ok.headers.items() if k.startswith("access-control"))


def test_be0_sec_06_body_size_limit(settings: Settings, token: str) -> None:
    """BE0-SEC-06 bodies over the limit → 413 before any handler runs; chunked bodies are refused."""
    client = TestClient(
        create_app(Settings(data_dir=settings.data_dir, extension_ids=(EXT_ID,), max_body_bytes=100)), base_url=BASE
    )
    tok = load_or_create_token(settings.data_dir)
    r = client.post(PROTECTED, headers={"X-BVG-Token": tok}, content=b"x" * 101)
    assert (r.status_code, r.json()) == (413, {"error": "BODY_TOO_LARGE"})
    r = client.post(PROTECTED, headers={"X-BVG-Token": tok}, content=iter([b"x" * 10]))  # chunked: no Content-Length
    assert (r.status_code, r.json()) == (411, {"error": "LENGTH_REQUIRED"})


def test_be0_sec_07_token_file_random_private_stable(tmp_path: Path) -> None:
    """BE0-SEC-07 token: 256-bit random hex, created once, user-only file permissions, stable across restarts."""
    a = load_or_create_token(tmp_path)
    assert len(a) == 64 and int(a, 16) >= 0
    assert load_or_create_token(tmp_path) == a
    assert load_or_create_token(tmp_path / "other") != a
    if sys.platform != "win32":  # Windows: per-user profile ACLs; POSIX mode bits checked here
        mode = stat.S_IMODE(os.stat(tmp_path / "token").st_mode)
        assert mode == 0o600


def test_be0_sec_09_no_docs_or_external_assets(client: TestClient, token: str) -> None:
    """BE0-SEC-09 OpenAPI docs are off: Swagger UI would load assets from a CDN (egress) and widen the surface."""
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 401, path  # unauthenticated: stopped before routing
        assert client.get(path, headers={"X-BVG-Token": token}).status_code == 404, path
    assert "server" not in {k.lower() for k in client.get("/health").headers}
