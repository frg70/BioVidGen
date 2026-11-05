from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from biovidgen.app import create_app
from biovidgen.config import Settings
from biovidgen.security import load_or_create_token

EXT_ID = "abcdefghijklmnopabcdefghijklmnop"
EXT_ORIGIN = f"chrome-extension://{EXT_ID}"
BASE = "http://127.0.0.1:8765"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path, port=8765, extension_ids=(EXT_ID,))


@pytest.fixture
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings), base_url=BASE)


@pytest.fixture
def token(settings: Settings, client: TestClient) -> str:
    return load_or_create_token(settings.data_dir)
