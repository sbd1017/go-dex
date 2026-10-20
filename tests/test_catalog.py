"""Catalog building and updates, on tiny synthetic sources (no network)."""
import json

from godex import catalog, catalog_build, cli
from godex.db import Database

OV = json.loads((catalog_build.ROOT / "data" / "overrides.json").read_text(encoding="utf-8"))


def sources(shinies=("pm1", "pm1.cJAN_2020_NOEVOLVE"), extra_lc=()):
    gm = [
        {"templateId": "V0001_POKEMON_BULBASAUR", "data": {"pokemonSettings": {
            "pokemonId": "BULBASAUR", "type": "POKEMON_TYPE_GRASS", "type2": "POKEMON_TYPE_POISON",
            "familyId": "FAMILY_BULBASAUR", "shadow": {}}}},
        {"templateId": "FORMS_V0001_POKEMON_BULBASAUR", "data": {"formSettings": {"pokemon": "BULBASAUR", "forms": [
            {"form": "BULBASAUR_NORMAL"}, {"form": "BULBASAUR_FALL_2019", "isCostume": True}]}}},
        {"templateId": "LC_2024_MADRID_GOFEST_001", "data": {"locationCardSettings": {}}},
        *({"templateId": lc, "data": {"locationCardSettings": {}}} for lc in extra_lc),
    ]
    img = "https://example/Pokemon/{}.icon.png"
    pokedex = [{"id": "BULBASAUR", "dexNr": 1, "generation": 1, "names": {"English": "Bulbasaur"},
                "primaryType": {"type": "POKEMON_TYPE_GRASS"}, "secondaryType": {"type": "POKEMON_TYPE_POISON"},
                "pokemonClass": None, "regionForms": {}, "megaEvolutions": {}, "hasGigantamaxEvolution": False,
                "assetForms": [
                    {"form": None, "costume": None, "isFemale": False, "image": img.format("pm1")},
                    {"form": "FALL_2019", "costume": None, "isFemale": False, "image": img.format("pm1.fFALL_2019")},
                    {"form": None, "costume": "JAN_2020_NOEVOLVE", "isFemale": False,
                     "image": img.format("pm1.cJAN_2020_NOEVOLVE")},
                    {"form": None, "costume": "JAN_2020", "isFemale": False, "image": img.format("pm1.cJAN_2020")},
                ]}]
    return {"gm.json": gm, "pokedex.json": pokedex, "released_pokemon.json": {"1": {"name": "Bulbasaur"}},
            "leekduck_shiny.json": [{"dex": 1, "aa_fn": s} for s in shinies]}


def test_build_uses_leek_duck_and_older_costumes():
    cat = catalog_build.build(sources(), OV)
    forms = {f["id"]: f for f in cat["forms"]}
    assert forms["BULBASAUR"]["shiny"] is True
    assert forms["BULBASAUR_FALL_2019"]["shiny"] is False              # not on the shiny list
    jan = [f for f in cat["forms"] if f["code"] == "JAN_2020"]
    assert len(jan) == 1, "the _NOEVOLVE twin is merged into one costume"
    assert jan[0]["name"] == "January 2020" and jan[0]["kind"] == "costume" and jan[0]["shiny"] is True
    assert cat["species"][0]["shiny"] is True and cat["species"][0]["released"] is True


def test_update_checks_reject_a_shrinking_catalog():
    good = catalog_build.build(sources(), OV)
    assert cli.catalog_problems(good, good) == []
    broken = dict(good, species=[], forms=good["forms"][:1])
    assert any("fewer species" in p for p in cli.catalog_problems(good, broken))
    no_shiny = catalog_build.build(sources(shinies=()), OV)
    assert any("shiny" in p for p in cli.catalog_problems(good, no_shiny))


def test_reload_reports_what_is_new(tmp_path):
    db = Database(tmp_path / "dex.sqlite3")
    first = tmp_path / "a.json"
    first.write_text(json.dumps(catalog_build.build(sources(shinies=("pm1",)), OV)))
    assert catalog.load(db, first)["new"] == {}                         # a first load is not "news"
    second = tmp_path / "b.json"
    second.write_text(json.dumps(catalog_build.build(
        sources(shinies=("pm1", "pm1.fFALL_2019"), extra_lc=("LC_2026_COPENHAGEN_GOFEST_001",)), OV)))
    new = catalog.load(db, second)["new"]
    assert new["shinies"] == 1 and new["backgrounds"] == 1
    with db.read() as conn:
        changes = json.loads(conn.execute("SELECT value FROM meta WHERE key = 'catalog_changes'").fetchone()[0])
    assert changes["shinies"] == ["Bulbasaur (Fall 2019)"]
    assert changes["backgrounds"] == ["Copenhagen GO Fest 2026"]


def test_newest_catalog_wins(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    a.write_text(json.dumps({"built_at": "2026-01-01T00:00:00+00:00"}))
    b.write_text(json.dumps({"built_at": "2026-10-01T00:00:00+00:00"}))
    assert catalog.newest(a, b) == b and catalog.newest(b, a) == b
    assert catalog.newest(a, tmp_path / "missing.json") == a
