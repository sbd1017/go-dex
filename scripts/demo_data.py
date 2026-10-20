"""Fill a development database with a believable, made-up collection (for trying things out and screenshots).
Refuses to run unless DEX_DATA_DIR ends in var-dev or var-demo, so it can never touch a real collection."""
import pathlib
import random
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from godex import config, services  # noqa: E402
from godex.db import Database  # noqa: E402

cfg = config.load()
if not str(cfg.data_dir).rstrip("/").endswith(("var-dev", "var-demo")):
    sys.exit("demo data only goes into var-dev or var-demo")
db = Database(cfg.db_path)
rnd = random.Random(25)

with db.write() as conn:
    if conn.execute("SELECT count(*) FROM entries").fetchone()[0]:
        sys.exit("already has entries; delete the var-dev folder to start again")
    batch = services.new_batch()
    q = lambda sql, *a: conn.execute(sql, a).fetchall()  # noqa: E731
    variants = q("""SELECT v.id, v.shiny, v.alignment, v.max, f.kind, f.dex, s.class FROM variants v
                    JOIN forms f ON f.id = v.form_id JOIN species s ON s.dex = f.dex
                    WHERE coalesce(v.target_override, v.catalog_target) = 1""")
    for vid, shiny, align, mx, kind, dex, cls in variants:
        p = 0.0
        if align == "normal" and mx == "none" and kind in ("base", "regional", "alternate"):
            p = 0.93 if dex <= 493 else 0.8 if dex <= 809 else 0.55
            p = p if not shiny else (0.55 if dex <= 251 else 0.35)
        elif align == "shadow":
            p = 0.4 if not shiny else 0.06
        elif align == "purified":
            p = 0.3 if not shiny else 0.04
        elif kind == "costume":
            p = 0.25 if not shiny else 0.08
        elif kind == "mega":
            p = 0.7 if not shiny else 0.1
        elif mx == "gigantamax":
            p = 0.45 if not shiny else 0.05
        if cls and shiny:
            p *= 0.6
        if rnd.random() < p:
            owned = rnd.choice([0, 1, 1, 1, 1, 2, 3]) if rnd.random() < 0.8 else 0
            trade = 1 if owned >= 2 and rnd.random() < 0.35 else 0
            services.save_entry(conn, batch, {"variant_id": vid, "registered": 1, "owned": owned, "for_trade": trade, "source": "demo"})

    def special(vid, **kw):
        services.save_entry(conn, batch, {"variant_id": vid, "registered": 1, "owned": kw.pop("owned", 1), "source": "demo", **kw})

    special("MIMIKYU_DISGUISED|n|normal|none", size="xxl", note="Caught at GO Fest")
    special("PALKIA_ORIGIN|n|normal|none", lucky=1, moves="Spacial Rend", iv_atk=14, iv_def=15, iv_sta=13)
    special("PIKACHU|s|normal|none", size="xxl", background_id="LC_2024_MADRID_GOFEST_001")
    special("DIALGA_ORIGIN|s|normal|none", background_id="LC_2024_NYC_GOFEST_001")
    special("GROUDON|n|normal|none", iv_atk=15, iv_def=15, iv_sta=15, tags=["pvp"])
    special("MEDICHAM|n|shadow|none", tags=["pvp"], moves="Counter / Ice Punch / Psychic", note="Great League")
    special("WAILORD|n|normal|none", size="xxl", owned=2, for_trade=1)
    special("SNORLAX|s|normal|none", size="xxs", lucky=1)
    special("CHARIZARD|n|normal|gigantamax", iv_atk=15, iv_def=15, iv_sta=15)
    special("BULBASAUR|s|normal|none", lucky=1, owned=3, for_trade=2, note="Happy to trade one")
    special("TOGEPI|s|normal|none", owned=2, for_trade=2)
    special("LAPRAS|n|normal|none", lucky=1, owned=2, for_trade=1)
    special("RATTATA_ALOLA|s|normal|none", owned=2, for_trade=1)

    for w in [
        {"dex": 25, "form_id": "PIKACHU_VS_2019", "shiny": 1, "priority": "high"},
        {"dex": 484, "form_id": "PALKIA_ORIGIN", "moves": "Spacial Rend", "tags": ["pvp"]},
        {"dex": 484, "form_id": "PALKIA_ORIGIN", "min_iv_atk": 15, "min_iv_def": 15, "min_iv_sta": 15, "priority": "someday"},
        {"dex": 484, "form_id": "PALKIA_ORIGIN", "lucky": 1},
        {"dex": 778, "size": "xxl", "priority": "high", "note": "Any form"},
        {"dex": 150, "background": "location", "priority": "normal"},
        {"dex": 383, "shiny": 1, "background": "any", "priority": "someday"},
        {"dex": 132, "shiny": 1, "tags": ["special-trade"], "priority": "high"},
        {"dex": 448, "shiny": 1, "alignment": "shadow", "note": "Shiny Shadow Lucario, the dream"},
        {"dex": 6, "max": "gigantamax", "shiny": 1},
        {"dex": 700, "shiny": 1, "tags": ["living-dex"]},
    ]:
        services.save_wish(conn, batch, w)
    services.save_settings(conn, batch, {"owner_name": "Ash", "title": "Pokédex", "link_label": "GO tools", "link_url": "/pokemon",
                                         "intro": "Demo collection. Search it like the in-game Pokédex: try 'shiny, missing' or 'xxl'."})
print("demo collection created")
