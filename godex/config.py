"""Settings come from environment variables (see .env.example)."""
import os
import pathlib
from dataclasses import dataclass

PKG = pathlib.Path(__file__).resolve().parent
ROOT = PKG.parent


@dataclass(frozen=True)
class Config:
    data_dir: pathlib.Path
    sprites_dir: pathlib.Path
    catalog_path: pathlib.Path
    base_path: str            # URL prefix, e.g. /dex  ('' to serve at the root)
    auth: str                 # site | password | none
    password_hash: str        # for auth=password (python -m godex.cli hash-password)
    secure_cookies: bool
    public_origins: tuple     # extra allowed Origin values for admin POSTs
    pokeapi_db: pathlib.Path | None  # optional PokeAPI SQLite file for species facts (see godex/pokedex_facts.py)
    host: str
    port: int

    @property
    def db_path(self) -> pathlib.Path:
        return self.data_dir / "dex.sqlite3"

    @property
    def auto_catalog_path(self) -> pathlib.Path:
        """Where `godex.cli catalog-update` keeps the catalog it builds on the server."""
        return self.data_dir / "catalog.json"

    def current_catalog(self) -> pathlib.Path:
        from .catalog import newest
        return newest(self.catalog_path, self.auto_catalog_path)


def load() -> Config:
    env = os.environ.get
    auth = env("DEX_AUTH", "password")
    if auth not in ("site", "password", "none"):
        raise SystemExit("DEX_AUTH must be site, password or none")
    base = "/" + env("DEX_BASE_PATH", "/dex").strip("/")
    return Config(
        data_dir=pathlib.Path(env("DEX_DATA_DIR", str(ROOT / "var"))),
        sprites_dir=pathlib.Path(env("DEX_SPRITES_DIR", str(ROOT / "media" / "sprites"))),
        catalog_path=pathlib.Path(env("DEX_CATALOG", str(ROOT / "data" / "catalog.json"))),
        base_path="" if base == "/" else base,
        auth=auth,
        password_hash=env("DEX_ADMIN_PASSWORD_HASH", ""),
        secure_cookies=env("DEX_SECURE_COOKIES", "1") == "1",
        public_origins=tuple(o for o in env("DEX_PUBLIC_ORIGINS", "").split(",") if o),
        pokeapi_db=pathlib.Path(pokeapi) if (pokeapi := env("DEX_POKEAPI_DB", "/srv/pokeapi/pokeapi.sqlite")) else None,
        host=env("DEX_HOST", "127.0.0.1"),
        port=int(env("DEX_PORT", "8782")),
    )
