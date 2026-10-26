"""Load data/catalog.json into the database and generate the variants that count towards completion.

Loading is idempotent and never deletes: anything that disappears from the source data is flagged
in_catalog = 0 (species/forms) or loses its catalog_target (variants), so your entries always keep their references.
"""
import json
import pathlib

from .db import Database, now

ALIGNMENTS = ("normal", "shadow", "purified")
MAXES = ("none", "dynamax", "gigantamax")


def variant_id(form_id: str, shiny: int, alignment: str = "normal", max_: str = "none") -> str:
    return f"{form_id}|{'s' if shiny else 'n'}|{alignment}|{max_}"


def parse_variant_id(vid: str) -> tuple[str, int, str, str]:
    form_id, s, alignment, max_ = vid.split("|")
    if s not in ("n", "s") or alignment not in ALIGNMENTS or max_ not in MAXES:
        raise ValueError(f"bad variant id {vid!r}")
    return form_id, 1 if s == "s" else 0, alignment, max_


def catalog_variants(sp: dict, form: dict, first_form: bool):
    """(shiny, alignment, max, counts_towards_completion) for one form, following the catalog's flags."""
    released = bool(form["released"])
    shiny = released and bool(form["shiny"])
    yield 0, "normal", "none", released
    yield 1, "normal", "none", shiny
    if form["shadow"] and form["kind"] in ("base", "regional", "alternate"):
        for alignment in ("shadow", "purified"):
            yield 0, alignment, "none", released
            yield 1, alignment, "none", shiny
    if form["kind"] in ("base", "alternate", "regional"):
        if sp.get("gmax") and first_form:
            yield 0, "normal", "gigantamax", released
            yield 1, "normal", "gigantamax", released and bool(form.get("gmax_shiny", form["shiny"]))
        if sp.get("dynamax"):
            yield 0, "normal", "dynamax", released
            yield 1, "normal", "dynamax", shiny


def built_at(path: pathlib.Path) -> str:
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("built_at") or ""
    except (OSError, ValueError):
        return ""


def newest(*paths: pathlib.Path) -> pathlib.Path:
    """The most recently built of these catalogs (the one shipped with the code, or one the server built itself)."""
    found = [p for p in paths if p and p.exists()]
    if not found:
        raise FileNotFoundError("no catalog found")
    return max(found, key=built_at)


def _snapshot(conn) -> dict:
    """What the database knows now, to report what a load adds."""
    return {
        "species": {r[0] for r in conn.execute("SELECT dex FROM species")},
        "forms": {r[0] for r in conn.execute("SELECT id FROM forms")},
        "shiny": {r[0] for r in conn.execute("SELECT id FROM variants WHERE shiny = 1 AND catalog_target = 1")},
        "backgrounds": {r[0] for r in conn.execute("SELECT id FROM backgrounds")},
    }


def _changes(conn, before: dict) -> dict:
    """New species, forms, shinies and backgrounds compared with `before`, as readable names."""
    form_label = {r[0]: (r[1] if not r[2] else f"{r[1]} ({r[2]})") for r in conn.execute(
        "SELECT f.id, s.name, f.name FROM forms f JOIN species s ON s.dex = f.dex")}
    after = _snapshot(conn)
    new_shiny = after["shiny"] - before["shiny"]
    shiny_forms = sorted({vid.split("|")[0] for vid in new_shiny if vid.split("|")[2] == "normal"})
    return {
        "species": sorted(r[0] for r in conn.execute(
            f"SELECT name FROM species WHERE dex IN ({','.join('?' * len(after['species'] - before['species']))})",
            sorted(after["species"] - before["species"]))) if after["species"] - before["species"] else [],
        "forms": sorted(form_label.get(f, f) for f in after["forms"] - before["forms"]),
        "shinies": [form_label.get(f, f) for f in shiny_forms],
        "backgrounds": sorted(r[0] for r in conn.execute(
            f"SELECT name FROM backgrounds WHERE id IN ({','.join('?' * len(after['backgrounds'] - before['backgrounds']))})",
            sorted(after["backgrounds"] - before["backgrounds"]))) if after["backgrounds"] - before["backgrounds"] else [],
    }


def load(db: Database, path: pathlib.Path) -> dict:
    cat = json.loads(path.read_text(encoding="utf-8"))
    if cat.get("format") != "godex-catalog":
        raise ValueError(f"{path} is not a godex catalog")
    species = {s["dex"]: s for s in cat["species"]}
    with db.write() as conn:
        before = _snapshot(conn)
        conn.execute("UPDATE species SET in_catalog = 0")
        conn.executemany(
            """INSERT INTO species (dex, code, name, generation, region, family, class, type1, type2, gender_diff,
                                    released, shiny, shadow, gmax, dynamax, sizes, lucky, regional, in_catalog)
               VALUES (:dex, :code, :name, :gen, :region, :family, :class, :type1, :type2, :gender_diff,
                       :released, :shiny, :shadow, :gmax, :dynamax, :sizes, :lucky, :regional, 1)
               ON CONFLICT (dex) DO UPDATE SET code = excluded.code, name = excluded.name,
                   generation = excluded.generation, region = excluded.region, family = excluded.family,
                   class = excluded.class, type1 = excluded.type1, type2 = excluded.type2,
                   gender_diff = excluded.gender_diff, released = excluded.released, shiny = excluded.shiny,
                   shadow = excluded.shadow, gmax = excluded.gmax, dynamax = excluded.dynamax, sizes = excluded.sizes,
                   lucky = excluded.lucky, regional = excluded.regional, in_catalog = 1""",
            [{"sizes": True, "lucky": True, "regional": False} | s | {"type1": s["types"][0], "type2": (s["types"] + [None])[1]}
             for s in cat["species"]])

        conn.execute("UPDATE forms SET in_catalog = 0")
        conn.executemany(
            """INSERT INTO forms (id, dex, code, name, kind, region_tag, type1, type2, sort, image, gmax_image,
                                  released, shiny, shadow, in_catalog)
               VALUES (:id, :dex, :code, :name, :kind, :region_tag, :type1, :type2, :sort, :image, :gmax_image,
                       :released, :shiny, :shadow, 1)
               ON CONFLICT (id) DO UPDATE SET dex = excluded.dex, code = excluded.code, name = excluded.name,
                   kind = excluded.kind, region_tag = excluded.region_tag, type1 = excluded.type1,
                   type2 = excluded.type2, sort = excluded.sort, image = excluded.image,
                   gmax_image = excluded.gmax_image, released = excluded.released, shiny = excluded.shiny,
                   shadow = excluded.shadow, in_catalog = 1""",
            [f | {"type1": f["types"][0], "type2": (f["types"] + [None])[1], "gmax_image": f.get("gmax_image")}
             for f in cat["forms"]])

        rows, seen_dex = [], set()
        for f in sorted(cat["forms"], key=lambda f: (f["dex"], f["sort"])):
            first = f["dex"] not in seen_dex and f["kind"] != "mega"
            if first:
                seen_dex.add(f["dex"])
            for shiny, alignment, max_, target in catalog_variants(species[f["dex"]], f, first):
                rows.append((variant_id(f["id"], shiny, alignment, max_), f["id"], shiny, alignment, max_, int(target)))
        conn.execute("UPDATE variants SET catalog_target = 0")
        conn.executemany(
            """INSERT INTO variants (id, form_id, shiny, alignment, max, catalog_target) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (id) DO UPDATE SET catalog_target = excluded.catalog_target""", rows)

        conn.execute("UPDATE backgrounds SET in_catalog = 0 WHERE custom = 0")
        conn.executemany(
            """INSERT INTO backgrounds (id, name, kind, year, image, custom, in_catalog)
               VALUES (:id, :name, :kind, :year, :image, 0, 1)
               ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, year = excluded.year, image = excluded.image,
                   in_catalog = 1, name = CASE WHEN backgrounds.custom = 1 THEN backgrounds.name ELSE excluded.name END""",
            [{"image": None} | b for b in cat["backgrounds"]])

        changes = _changes(conn, before) if before["species"] else {}   # a first load adds everything: not news
        meta = [("catalog_built_at", cat["built_at"]), ("catalog_loaded_at", now())]
        if any(changes.values()):
            meta.append(("catalog_changes", json.dumps({"at": now(), "built_at": cat["built_at"], **changes},
                                                       ensure_ascii=False)))
        for key, value in meta:
            conn.execute("INSERT INTO meta VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                         (key, value))
    return {"species": len(cat["species"]), "forms": len(cat["forms"]), "variants": len(rows),
            "backgrounds": len(cat["backgrounds"]), "new": {k: len(v) for k, v in changes.items()}}


def ensure_variant(conn, vid: str) -> str:
    """Make sure a variant row exists (e.g. a Dynamax form the catalog does not list yet). Returns its id.
    A variant you add yourself counts towards completion until you say otherwise."""
    form_id, shiny, alignment, max_ = parse_variant_id(vid)
    if not conn.execute("SELECT 1 FROM forms WHERE id = ?", (form_id,)).fetchone():
        raise ValueError(f"unknown form {form_id!r}")
    conn.execute("""INSERT INTO variants (id, form_id, shiny, alignment, max, catalog_target, target_override)
                    VALUES (?, ?, ?, ?, ?, 0, 1) ON CONFLICT (id) DO NOTHING""",
                 (vid, form_id, shiny, alignment, max_))
    return vid
