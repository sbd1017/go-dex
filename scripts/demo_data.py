"""Fill a database with a made-up but believable collection: a level 72 trainer who plays most events.

Used for local development (scripts/dev.sh --seed), screenshots and public demos. It refuses to run unless
DEX_DATA_DIR ends in var-dev or var-demo, or DEX_DEMO=1 is set, so it can never touch a real collection.
The same seed always gives the same collection.
"""
import contextlib
import os
import pathlib
import random
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from godex import config, services  # noqa: E402
from godex.db import Database  # noqa: E402

cfg = config.load()
if not (str(cfg.data_dir).rstrip("/").endswith(("var-dev", "var-demo")) or os.environ.get("DEX_DEMO") == "1"):
    sys.exit("demo data only goes into var-dev or var-demo (or set DEX_DEMO=1)")
db = Database(cfg.db_path)
rnd = random.Random(72)
chance = rnd.random

# In-person events this trainer went to (location backgrounds), if the catalog has them.
ATTENDED = ["LC_2023_LONDON_GOFEST_001", "LC_2024_MADRID_GOFEST_001", "LC_2024_MILAN_CITYSAFARI_001",
            "LC_2026_COPENHAGEN_GOFEST_001"]


def registered_rate(kind, cls, dex, shiny, align, max_):
    """How likely this trainer has registered a variant."""
    newest = dex >= 906                                   # Paldea: still catching up
    if max_ == "gigantamax":
        return 0.18 if shiny else 0.82
    if kind == "mega":
        return 0.45 if shiny else 0.95
    if kind == "event":
        return 0.05 if shiny else 0.45
    if kind == "costume":
        return 0.3 if shiny else 0.78
    if align == "shadow":
        return 0.22 if shiny else 0.86
    if align == "purified":
        return 0.12 if shiny else 0.74
    if shiny:
        base = {"legendary": 0.45, "mythical": 0.3, "ultra_beast": 0.35}.get(cls, 0.64)
        return base * (0.7 if newest else 1)
    return 0.9 if newest else 0.985


def owned_count(kind, cls, shiny, align):
    """How many they still have, given it is registered (0 = registered, then transferred or traded)."""
    keep = 0.85 if shiny else 0.88 if cls else 0.6 if kind == "costume" else 0.5
    if align == "shadow":
        keep = 0.6
    if chance() > keep:
        return 0
    if shiny and chance() < 0.12:
        return rnd.randint(2, 6)                          # Community Day leftovers
    return rnd.choice((1, 1, 1, 1, 2, 2, 3))


with db.write() as conn:
    if conn.execute("SELECT count(*) FROM entries").fetchone()[0]:
        sys.exit("already has entries; delete the database first to start again")
    batch = services.new_batch()
    q = lambda sql, *a: conn.execute(sql, a).fetchall()  # noqa: E731
    variants = q("""SELECT v.id, v.shiny, v.alignment, v.max, f.kind, f.dex, s.class, s.gender_diff
                    FROM variants v JOIN forms f ON f.id = v.form_id JOIN species s ON s.dex = f.dex
                    WHERE coalesce(v.target_override, v.catalog_target) = 1 ORDER BY f.dex, f.sort, v.id""")
    special_bgs = [r[0] for r in q("SELECT id FROM backgrounds WHERE kind = 'special' AND custom = 0")]
    attended = [b for b in ATTENDED if q("SELECT 1 FROM backgrounds WHERE id = ?", b)]

    owned_plain = []                                     # (variant id, dex, class, gender_diff) kept, for specials
    for vid, shiny, align, max_, kind, dex, cls, gd in variants:
        if chance() > registered_rate(kind, cls, dex, shiny, align, max_):
            continue
        n = owned_count(kind, cls, shiny, align) if kind != "mega" else 0   # Megas are registered, not kept
        trade = 0
        if n >= 2 and align != "shadow" and chance() < 0.4:
            trade = rnd.randint(1, n - 1)
        services.save_entry(conn, batch, {"variant_id": vid, "registered": 1, "owned": n, "for_trade": trade,
                                          "source": "demo"})
        if n and max_ == "none" and kind in ("base", "regional", "alternate"):
            owned_plain.append((vid, dex, cls, gd))

    def special(vid, **fields):
        services.save_entry(conn, batch, {"variant_id": vid, "registered": 1, "owned": 1, "source": "demo", **fields})

    seen = {}
    for vid, dex, cls, gd in owned_plain:                # one row per species is enough for the specials
        seen.setdefault(dex, (vid, cls, gd))
    species = list(seen.items())
    for _dex, (vid, cls, gd) in species:
        if chance() < 0.52:                              # lucky dex about half done
            special(vid, lucky=1, iv_atk=rnd.randint(12, 15), iv_def=rnd.randint(12, 15), iv_sta=rnd.randint(12, 15))
        if chance() < (0.35 if cls else 0.14):           # hundos: raids make legendary ones likelier
            special(vid, iv_atk=15, iv_def=15, iv_sta=15, lucky=int(chance() < 0.15))
        if chance() < 0.34:
            special(vid, size="xxl", gender="female" if gd and chance() < 0.4 else "")
        if chance() < 0.29:
            special(vid, size="xxs")
        if special_bgs and chance() < 0.12:              # in-game event backgrounds
            special(vid, background_id=rnd.choice(special_bgs))
        if attended and chance() < 0.035:                # caught at an event they went to
            special(vid, background_id=rnd.choice(attended))
    for _dex, (vid, _cls, _gd) in rnd.sample(species, min(40, len(species))):
        special(vid, tags=["pvp"], moves=rnd.choice(["Counter / Ice Punch", "Mud Shot / Earthquake",
                                                      "Shadow Claw / Shadow Ball", "Dragon Breath / Sky Attack",
                                                      "Charm / Moonblast"]),
                note=rnd.choice(["Great League", "Ultra League", "Master League"]))

    # A wishlist this kind of trainer would keep: missing shinies, a few perfect or special ones.
    have = {r[0] for r in q("SELECT DISTINCT variant_id FROM entries WHERE owned > 0")}
    missing_shiny = [r for r in q("""SELECT v.id, f.dex, f.id, s.class FROM variants v JOIN forms f ON f.id = v.form_id
                                     JOIN species s ON s.dex = f.dex
                                     WHERE v.shiny = 1 AND v.alignment = 'normal' AND v.max = 'none'
                                       AND coalesce(v.target_override, v.catalog_target) = 1
                                       AND f.kind IN ('base', 'costume')""")
                     if r[0] not in have]
    for _vid, dex, form_id, cls in rnd.sample(missing_shiny, min(9, len(missing_shiny))):
        services.save_wish(conn, batch, {"dex": dex, "form_id": form_id, "shiny": 1,
                                         "priority": "high" if cls else rnd.choice(["normal", "normal", "someday"]),
                                         "tags": ["special-trade"] if cls == "legendary" and chance() < 0.5 else []})
    for w in [
        {"dex": 484, "form_id": "PALKIA_ORIGIN", "min_iv_atk": 15, "min_iv_def": 15, "min_iv_sta": 15, "tags": ["pvp"],
         "note": "For Master League"},
        {"dex": 321, "size": "xxl", "priority": "someday", "note": "The biggest Wailord there is"},
        {"dex": 384, "background": "location", "priority": "high", "note": "Any in-person event background"},
        {"dex": 25, "shiny": 1, "lucky": 1, "priority": "normal"},
        {"dex": 448, "shiny": 1, "alignment": "shadow", "priority": "someday"},
        {"dex": 778, "size": "xxs", "priority": "normal"},
        {"dex": 150, "shiny": 1, "min_iv_atk": 15, "min_iv_def": 15, "min_iv_sta": 15, "priority": "someday"},
    ]:
        with contextlib.suppress(services.Invalid):        # a form this catalog doesn't have
            services.save_wish(conn, batch, w)
    services.save_settings(conn, batch, {
        "owner_name": os.environ.get("DEX_DEMO_OWNER", "Sam"), "title": "Pokédex",
        "intro": os.environ.get("DEX_DEMO_INTRO", "Demo collection of a level 72 trainer who plays most events. "
                                                  "Search it like the in-game Pokédex: try \"shiny, missing\" or \"xxl\"."),
        "link_label": os.environ.get("DEX_DEMO_LINK_LABEL", ""), "link_url": os.environ.get("DEX_DEMO_LINK_URL", ""),
    })
    counts = q("SELECT count(*), coalesce(sum(owned), 0), coalesce(sum(for_trade), 0) FROM entries")[0]
    print(f"demo collection: {counts[0]} entries, {counts[1]} Pokémon owned, {counts[2]} for trade, "
          f"{q('SELECT count(*) FROM wishes')[0][0]} wishes")
