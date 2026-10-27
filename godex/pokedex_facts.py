"""Species facts (category, Pokédex entry, height, weight, gender) from a local PokeAPI database, if there is one.

DEX_POKEAPI_DB points at a SQLite file with the tables en_species (id, identifier, genus, flavor, gender_rate) and
en_pokemon (species_id, identifier, is_default, height_dm, weight_hg), as built from the PokeAPI CSV dump
(github.com/PokeAPI/pokeapi, data/v2/csv; BSD-3-Clause). Without the file the Pokémon page simply leaves facts out.
The file is opened read-only for each lookup, so a refresh that swaps it in place is picked up without a restart.
"""
import functools
import pathlib
import sqlite3


class Facts:
    def __init__(self, path: pathlib.Path | None):
        self.path = path

    def _stamp(self):
        try:
            return self.path.stat().st_mtime_ns if self.path else None
        except OSError:
            return None

    def get(self, dex: int, code: str = "") -> dict | None:
        stamp = self._stamp()
        return _lookup(str(self.path), stamp, dex, code.strip().lower()) if stamp else None


@functools.lru_cache(maxsize=512)
def _lookup(path: str, stamp: int, dex: int, code: str) -> dict | None:
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.Error:
        return None
    try:
        sp = conn.execute("SELECT identifier, genus, flavor, gender_rate FROM en_species WHERE id = ?", (dex,)).fetchone()
        if not sp:
            return None
        mons = conn.execute("SELECT identifier, is_default, height_dm, weight_hg FROM en_pokemon WHERE species_id = ?",
                            (dex,)).fetchall()
    except sqlite3.Error:
        return None
    finally:
        conn.close()
    mon = _match(sp[0], code, mons)
    rate = sp[3]
    return {
        "genus": sp[1] or None,
        "entry": sp[2] or None,
        "height_m": mon[2] / 10 if mon and mon[2] is not None else None,
        "weight_kg": mon[3] / 10 if mon and mon[3] is not None else None,
        "female_pct": None if rate is None or rate < 0 else rate * 100 / 8,   # PokeAPI: eighths female, -1 genderless
        "genderless": rate == -1,
    }


def _match(species: str, code: str, mons):
    """The PokeAPI Pokémon for a GO form code: ALOLA -> rattata-alola, MEGA_X -> charizard-mega-x, DUSK_MANE ->
    necrozma-dusk. Costumes and anything unknown use the default Pokémon."""
    by_id = {m[0]: m for m in mons}
    default = next((m for m in mons if m[1]), mons[0] if mons else None)
    if not code:
        return default
    slug = code.replace("_", "-")
    words = slug.split("-")
    for n in range(len(words), 0, -1):
        m = by_id.get(f"{species}-{'-'.join(words[:n])}")
        if m:
            return m
    return default
