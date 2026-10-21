"""The one JSON document the browser needs: catalog + collection. The search engine runs on it client-side.

The public version leaves out private notes and private wishes. Both versions are cached per data version
(and sprite folder state), so repeated page loads cost nothing.
"""
import gzip
import hashlib
import json
import threading

from . import services
from .db import data_version

ALIGN = {"normal": 0, "shadow": 1, "purified": 2}
MAX = {"none": 0, "dynamax": 1, "gigantamax": 2}
ENTRY_KEYS = {  # db column -> short key; defaults are left out
    "id": "id", "variant_id": "v", "registered": "r", "owned": "o", "for_trade": "t", "gender": "g", "size": "sz",
    "lucky": "l", "iv_atk": "ia", "iv_def": "id_", "iv_sta": "is", "background_id": "bg", "moves": "mv", "cp": "cp",
    "nickname": "nn", "caught_on": "co", "note": "n", "private_note": "pn", "updated_at": "u",
}


def _compact(row: dict, keys: dict) -> dict:
    return {short: row[col] for col, short in keys.items() if row.get(col) not in (None, "", 0) or col in ("registered", "owned")}


def build(conn, sprites, admin: bool) -> dict:
    species = []
    for s in conn.execute("SELECT * FROM species ORDER BY dex"):
        species.append({
            "dex": s["dex"], "code": s["code"], "name": s["name"], "gen": s["generation"], "region": s["region"],
            "family": s["family"], "class": s["class"], "types": [t for t in (s["type1"], s["type2"]) if t],
            "gd": s["gender_diff"], "rel": s["released"], "shiny": s["shiny"], "shadow": s["shadow"],
            "gmax": s["gmax"], "dmax": s["dynamax"],
            "sizes": s["sizes"] if s["sizes_override"] is None else s["sizes_override"],
            "lucky": s["lucky"] if s["lucky_override"] is None else s["lucky_override"],
        })
    forms, form_index = [], {}
    base_image = {r[0]: r[1] for r in conn.execute(
        "SELECT dex, image FROM forms WHERE kind = 'base' OR sort = 0 ORDER BY sort DESC")}
    for f in conn.execute("SELECT * FROM forms ORDER BY dex, sort"):
        form_index[f["id"]] = len(forms)
        forms.append({
            "id": f["id"], "dex": f["dex"], "code": f["code"], "name": f["name"], "kind": f["kind"],
            "rt": f["region_tag"], "types": [t for t in (f["type1"], f["type2"]) if t],
            "img": sprites.for_form(f, base_image.get(f["dex"])), "rel": f["released"],
        })
    variants = [
        [v["id"], form_index[v["form_id"]], v["shiny"], ALIGN[v["alignment"]], MAX[v["max"]],
         int(v["target_override"] if v["target_override"] is not None else v["catalog_target"])]
        for v in conn.execute("SELECT * FROM variants ORDER BY rowid")
    ]
    entry_tags = {}
    for r in conn.execute("SELECT entry_id, tag FROM entry_tags"):
        entry_tags.setdefault(r[0], []).append(r[1])
    keys = ENTRY_KEYS if admin else {k: v for k, v in ENTRY_KEYS.items() if k != "private_note"}
    entries = []
    for e in conn.execute("SELECT * FROM entries ORDER BY id"):
        c = _compact(dict(e), keys)
        if e["id"] in entry_tags:
            c["tags"] = entry_tags[e["id"]]
        entries.append(c)
    wish_tags = {}
    for r in conn.execute("SELECT wish_id, tag FROM wish_tags"):
        wish_tags.setdefault(r[0], []).append(r[1])
    wishes = []
    for w in conn.execute("SELECT * FROM wishes " + ("" if admin else "WHERE public = 1 ") + "ORDER BY id"):
        d = {k: w[k] for k in w.keys() if w[k] not in (None, "") and (admin or k != "private_note")}
        d["tags"] = wish_tags.get(w["id"], [])
        wishes.append(d)
    settings = services.get_settings(conn)
    meta = {r[0]: r[1] for r in conn.execute("SELECT key, value FROM meta")}
    return {
        "format": "godex-dataset", "version": int(meta["data_version"]), "admin": admin,
        "catalog_built_at": meta.get("catalog_built_at"), "settings": settings,
        "catalog": ({"loaded_at": meta.get("catalog_loaded_at"),
                     "changes": json.loads(meta["catalog_changes"]) if meta.get("catalog_changes") else None}
                    if admin else None),
        "species": species, "forms": forms, "variants": variants, "entries": entries, "wishes": wishes,
        "backgrounds": [[b["id"], b["name"], b["kind"], b["year"]] for b in conn.execute(
            "SELECT * FROM backgrounds ORDER BY kind, year DESC, name")],
        "tags": [[t["slug"], t["label"]] for t in conn.execute("SELECT slug, label FROM tags ORDER BY label")],
        "sprites": sprites.count,
    }


class DatasetCache:
    def __init__(self, db, sprites):
        self.db, self.sprites = db, sprites
        self._lock = threading.Lock()
        self._build_locks = {True: threading.Lock(), False: threading.Lock()}
        self._cache = {}

    def get(self, admin: bool) -> tuple[bytes, bytes, str]:
        """(json bytes, gzip bytes, etag). One build at a time per audience; others wait and reuse it."""
        sig = self.sprites.refresh()
        with self.db.read() as conn:
            conn.execute("BEGIN")                      # one consistent snapshot even while saves are happening
            try:
                key = (admin, data_version(conn), sig)
                with self._lock:
                    if key in self._cache:
                        return self._cache[key]
                with self._build_locks[admin]:
                    with self._lock:
                        if key in self._cache:
                            return self._cache[key]
                    body = json.dumps(build(conn, self.sprites, admin), ensure_ascii=False, separators=(",", ":")).encode()
                    etag = '"' + hashlib.sha256(body).hexdigest()[:20] + '"'
                    value = (body, gzip.compress(body, 6), etag)
                    with self._lock:
                        self._cache = {k: v for k, v in self._cache.items() if k[0] != admin}
                        self._cache[key] = value
                    return value
            finally:
                conn.execute("COMMIT")
