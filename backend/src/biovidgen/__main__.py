"""`uv run biovidgen` / `python -m biovidgen`: start the local backend on 127.0.0.1."""

import uvicorn

from .app import create_app
from .config import Settings


def main() -> None:
    settings = Settings.from_env()
    uvicorn.run(
        create_app(settings),
        host=settings.host,  # always 127.0.0.1 (Settings refuses anything else)
        port=settings.port,
        server_header=False,
        proxy_headers=False,  # no proxy in front; never trust X-Forwarded-*
        access_log=False,  # our own log has no paths or query strings
        log_level="warning",
    )


if __name__ == "__main__":
    main()
