"""Production entry point: python -m godex.serve (settings from the environment, see .env.example)."""
import logging

import uvicorn

from . import config
from .web import create_app


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    cfg = config.load()
    if cfg.auth == "none" and cfg.host not in ("127.0.0.1", "::1", "localhost"):
        raise SystemExit("DEX_AUTH=none is for local development only: it refuses to listen beyond 127.0.0.1")
    # proxy_headers stays False: identity headers are only trusted from the loopback peer itself.
    uvicorn.run(create_app(cfg), host=cfg.host, port=cfg.port, proxy_headers=False, access_log=False,
                server_header=False, date_header=False)


if __name__ == "__main__":
    main()
