"""Every change to your collection goes through here: validation, the audit log, undo, bulk edits, import/export.

Each user action runs in one transaction and gets one batch id in `changes`, so "undo" reverts exactly that action.
"""
import datetime as dt
import json
import re
import secrets
import sqlite3

from . import catalog
from .db import now

ENTRY_FIELDS = ("variant_id", "registered", "owned", "for_trade", "gender", "size", "lucky", "iv_atk", "iv_def",
                "iv_sta", "background_id", "moves", "cp", "nickname", "caught_on", "note", "private_note", "source")
# What makes an entry "special" (not the everyday plain one the quick toggles use).
SPECIMEN_FIELDS = ("gender", "size", "lucky", "iv_atk", "iv_def", "iv_sta", "background_id", "moves", "cp", "nickname")
WISH_FIELDS = ("dex", "form_id", "shiny", "alignment", "max", "gender", "size", "lucky", "min_iv_atk", "min_iv_def",
               "min_iv_sta", "background", "background_id", "moves", "title", "note", "private_note", "priority",
               "status", "public")
SETTINGS = {"owner_name": "", "title": "Pokédex", "intro": "", "default_view": "owned", "link_label": "", "link_url": ""}


class Invalid(ValueError):
    """Bad input: the message is safe to show to the user."""


# ------------------------------------------------------------------ helpers

def new_batch() -> str:
    return dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%S") + "-" + secrets.token_hex(3)


def _row(conn, sql, args=()):
    r = conn.execute(sql, args).fetchone()
    return dict(r) if r else None


def record(conn, batch, action, entity, entity_id, before, after, summary=""):
    conn.execute("""INSERT INTO changes (at, batch, action, entity, entity_id, before, after, summary)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                 (now(), batch, action, entity, str(entity_id),
                  json.dumps(before, ensure_ascii=False) if before is not None else None,
                  json.dumps(after, ensure_ascii=False) if after is not None else None, summary))


def _int(v, lo, hi, name, nullable=True):
    if v is None or v == "":
        if nullable:
            return None
        raise Invalid(f"{name} is required")
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise Invalid(f"{name} must be a whole number") from None
    if not lo <= n <= hi:
        raise Invalid(f"{name} must be between {lo} and {hi}")
    return n


def _bool(v) -> int:
    if isinstance(v, str):
        return 1 if v.lower() in ("1", "true", "yes", "on") else 0
    return 1 if v else 0


def _text(v, limit, name) -> str:
    s = "" if v is None else str(v).strip()
    if len(s) > limit:
        raise Invalid(f"{name} is too long (max {limit} characters)")
    return s


def _choice(v, choices, name, nullable=False):
    if v in (None, ""):
        if nullable:
            return None
        v = ""
    if v not in choices:
        raise Invalid(f"{name} must be one of: {', '.join(c for c in choices if c) or 'blank'}")
    return v


def _ensure_variant(conn, vid) -> str:
    try:
        return catalog.ensure_variant(conn, str(vid))
    except (ValueError, AttributeError):
        raise Invalid("Unknown variant") from None


def slugify(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")[:40]


def _tags(conn, tags) -> list[str]:
    out = []
    for t in tags or []:
        slug = slugify(str(t))
        if not slug:
            continue
        if not conn.execute("SELECT 1 FROM tags WHERE slug = ?", (slug,)).fetchone():
            conn.execute("INSERT INTO tags (slug, label) VALUES (?, ?)", (slug, str(t).strip()[:40] or slug))
        if slug not in out:
            out.append(slug)
    return out


# ------------------------------------------------------------------ entries

def get_entry(conn, entry_id) -> dict | None:
    e = _row(conn, "SELECT * FROM entries WHERE id = ?", (entry_id,))
    if e:
        e["tags"] = [r[0] for r in conn.execute("SELECT tag FROM entry_tags WHERE entry_id = ? ORDER BY tag", (entry_id,))]
    return e


def _put_entry(conn, e: dict):
    """Insert or replace an entry row (incl. tags) exactly as given. Used by writes and undo."""
    cols = ("id",) + ENTRY_FIELDS + ("created_at", "updated_at")
    cur = conn.execute(f"INSERT OR REPLACE INTO entries ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                       [e.get(c) for c in cols])
    e["id"] = e.get("id") or cur.lastrowid
    conn.execute("DELETE FROM entry_tags WHERE entry_id = ?", (e["id"],))
    conn.executemany("INSERT INTO entry_tags (entry_id, tag) VALUES (?, ?)", [(e["id"], t) for t in e.get("tags", [])])
    return e["id"]


def clean_entry(conn, data: dict, current: dict | None = None) -> dict:
    """Validate and normalise entry fields. Unspecified fields keep their current value."""
    e = dict(current or {"registered": 1, "owned": 0, "for_trade": 0, "gender": "", "size": "", "lucky": 0,
                         "moves": "", "nickname": "", "note": "", "private_note": "", "source": "manual", "tags": []})
    d = {k: v for k, v in data.items() if k in ENTRY_FIELDS + ("tags",)}
    if "variant_id" in d:
        e["variant_id"] = _ensure_variant(conn, d["variant_id"])
    if not e.get("variant_id"):
        raise Invalid("variant_id is required")
    for k in ("registered", "lucky"):
        if k in d:
            e[k] = _bool(d[k])
    for k in ("owned", "for_trade"):
        if k in d:
            e[k] = _int(d[k], 0, 9999, k.replace("_", " "), nullable=False)
    if "gender" in d:
        e["gender"] = _choice(d["gender"], ("", "male", "female", "genderless"), "gender")
    if "size" in d:
        e["size"] = _choice(d["size"], ("", "xxs", "xs", "xl", "xxl"), "size")
    for k in ("iv_atk", "iv_def", "iv_sta"):
        if k in d:
            e[k] = _int(d[k], 0, 15, k.replace("iv_", "IV ").title())
    if "cp" in d:
        e["cp"] = _int(d["cp"], 10, 99999, "CP")
    if "background_id" in d:
        bg = d["background_id"] or None
        if bg and not conn.execute("SELECT 1 FROM backgrounds WHERE id = ?", (bg,)).fetchone():
            raise Invalid("Unknown background")
        e["background_id"] = bg
    if "caught_on" in d:
        v = d["caught_on"] or None
        if v:
            try:
                v = dt.date.fromisoformat(str(v)).isoformat()
            except ValueError:
                raise Invalid("Caught on must be a date (YYYY-MM-DD)") from None
        e["caught_on"] = v
    for k, limit in (("moves", 160), ("nickname", 40), ("note", 1000), ("private_note", 2000), ("source", 80)):
        if k in d:
            e[k] = _text(d[k], limit, k.replace("_", " "))
    if "tags" in d:
        e["tags"] = _tags(conn, d["tags"])
    if e["owned"] > 0:
        e["registered"] = 1
    if e["for_trade"] > e["owned"]:
        raise Invalid("You can't offer more for trade than you own")
    return e


def is_plain(e: dict) -> bool:
    return all(not e.get(k) for k in SPECIMEN_FIELDS)


def _is_empty(e: dict) -> bool:
    return not (e["registered"] or e["owned"] or e["for_trade"] or e["note"] or e["private_note"] or e.get("tags"))


def save_entry(conn, batch, data: dict, entry_id=None) -> dict | None:
    current = get_entry(conn, entry_id) if entry_id else None
    if entry_id and not current:
        raise Invalid("That entry no longer exists")
    e = clean_entry(conn, data, current)
    ts = now()
    e["updated_at"] = ts
    if current:
        e["id"], e["created_at"] = current["id"], current["created_at"]
    else:
        e["created_at"], e["id"] = ts, None
    if is_plain(e) and _is_empty(e):          # an unticked plain entry is just removed
        if current:
            delete_entry(conn, batch, e["id"])
        return None
    _put_entry(conn, e)
    after = get_entry(conn, e["id"])
    record(conn, batch, "update" if current else "insert", "entries", e["id"], current, after,
           describe_entry(conn, after))
    return after


def delete_entry(conn, batch, entry_id):
    current = get_entry(conn, entry_id)
    if not current:
        raise Invalid("That entry no longer exists")
    conn.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
    record(conn, batch, "delete", "entries", entry_id, current, None, describe_entry(conn, current))


def plain_entry(conn, variant_id) -> dict | None:
    cond = " AND ".join(f"({k} IS NULL OR {k} = '' OR {k} = 0)" for k in SPECIMEN_FIELDS)
    r = conn.execute(f"SELECT id FROM entries WHERE variant_id = ? AND {cond} ORDER BY id LIMIT 1",
                     (variant_id,)).fetchone()
    return get_entry(conn, r[0]) if r else None


def quick(conn, batch, variant_id: str, op: dict) -> None:
    """The fast toggles on the plain entry of a variant: registered, owned (+/-), for trade (+/-)."""
    _ensure_variant(conn, variant_id)
    e = plain_entry(conn, variant_id)
    reg, owned, trade = (e["registered"], e["owned"], e["for_trade"]) if e else (0, 0, 0)
    if "registered" in op:
        reg = _bool(op["registered"])
        if not reg and owned:
            raise Invalid("Set owned to 0 first: a Pokémon you own is always registered")
    if "owned" in op:
        owned = _int(op["owned"], 0, 9999, "owned", nullable=False)
        trade = min(trade, owned)          # an explicit owned count wins over what was offered
    if "owned_delta" in op:
        owned = max(0, min(9999, owned + _int(op["owned_delta"], -9999, 9999, "owned", nullable=False)))
        trade = min(trade, owned)
    if "for_trade" in op:
        trade = _int(op["for_trade"], 0, 9999, "for trade", nullable=False)
    if "trade_delta" in op:
        trade = max(0, min(9999, trade + _int(op["trade_delta"], -9999, 9999, "for trade", nullable=False)))
    if trade > owned:              # offering one for trade means you own it
        owned = trade
    if owned:
        reg = 1
    save_entry(conn, batch, {"variant_id": variant_id, "registered": reg, "owned": owned, "for_trade": trade},
               e["id"] if e else None)


BULK_ACTIONS = ("register", "own", "unown", "unregister", "untrade")


def bulk(conn, batch, variant_ids: list[str], action: str) -> int:
    if action not in BULK_ACTIONS:
        raise Invalid("Unknown bulk action")
    if len(variant_ids) > 20000:
        raise Invalid("Too many at once")
    changed = 0
    for vid in dict.fromkeys(variant_ids):
        try:
            catalog.parse_variant_id(vid)
        except ValueError:
            raise Invalid(f"Unknown variant {vid}") from None
        totals = conn.execute("SELECT max(registered), sum(owned) FROM entries WHERE variant_id = ?",
                              (vid,)).fetchone()
        reg, owned = (totals[0] or 0), (totals[1] or 0)
        e = plain_entry(conn, vid)
        if action == "register" and not reg:
            quick(conn, batch, vid, {"registered": 1})
        elif action == "own" and not owned:
            quick(conn, batch, vid, {"owned": 1})
        elif action == "unown" and e and e["owned"]:
            quick(conn, batch, vid, {"owned": 0, "for_trade": 0})
        elif action == "untrade" and e and e["for_trade"]:
            quick(conn, batch, vid, {"for_trade": 0})
        elif action == "unregister" and e and e["registered"] and not e["owned"]:
            quick(conn, batch, vid, {"registered": 0})
        else:
            continue
        changed += 1
    return changed


def describe_variant(conn, vid: str) -> str:
    try:
        form_id, shiny, alignment, max_ = catalog.parse_variant_id(vid)
    except ValueError:
        return vid
    f = _row(conn, "SELECT f.name AS form, s.name, s.dex FROM forms f JOIN species s ON s.dex = f.dex WHERE f.id = ?",
             (form_id,))
    if not f:
        return vid
    bits = [("Shiny" if shiny else ""), {"shadow": "Shadow", "purified": "Purified"}.get(alignment, ""),
            {"dynamax": "Dynamax", "gigantamax": "Gigantamax"}.get(max_, ""), f["name"]]
    label = f["name"] if not f["form"] else f"{f['name']} ({f['form']})"
    return " ".join(b for b in bits[:3] if b) + (" " if any(bits[:3]) else "") + label


def describe_entry(conn, e: dict) -> str:
    extra = [x for x in (e.get("size", "").upper(), "Lucky" if e.get("lucky") else "",
                         e.get("gender", "").title(), "Background" if e.get("background_id") else "") if x]
    counts = f"owned {e['owned']}" + (f", {e['for_trade']} for trade" if e["for_trade"] else "") \
        if e["owned"] else ("registered" if e["registered"] else "not registered")
    return f"{describe_variant(conn, e['variant_id'])}{' · ' + ' '.join(extra) if extra else ''}: {counts}"


# ------------------------------------------------------------------ wishes

def get_wish(conn, wish_id) -> dict | None:
    w = _row(conn, "SELECT * FROM wishes WHERE id = ?", (wish_id,))
    if w:
        w["tags"] = [r[0] for r in conn.execute("SELECT tag FROM wish_tags WHERE wish_id = ? ORDER BY tag", (wish_id,))]
    return w


def _put_wish(conn, w: dict):
    cols = ("id",) + WISH_FIELDS + ("created_at", "updated_at", "fulfilled_at")
    cur = conn.execute(f"INSERT OR REPLACE INTO wishes ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                       [w.get(c) for c in cols])
    w["id"] = w.get("id") or cur.lastrowid
    conn.execute("DELETE FROM wish_tags WHERE wish_id = ?", (w["id"],))
    conn.executemany("INSERT INTO wish_tags (wish_id, tag) VALUES (?, ?)", [(w["id"], t) for t in w.get("tags", [])])
    return w["id"]


def clean_wish(conn, data: dict, current: dict | None = None) -> dict:
    w = dict(current or {"priority": "normal", "status": "open", "public": 1, "moves": "", "title": "", "note": "",
                         "private_note": "", "tags": []})
    d = {k: v for k, v in data.items() if k in WISH_FIELDS + ("tags",)}
    if "dex" in d:
        w["dex"] = _int(d["dex"], 1, 9999, "Pokédex number", nullable=False)
        if not conn.execute("SELECT 1 FROM species WHERE dex = ?", (w["dex"],)).fetchone():
            raise Invalid("Unknown Pokédex number")
    if not w.get("dex"):
        raise Invalid("Choose a Pokémon")
    if "form_id" in d:
        fid = d["form_id"] or None
        if fid and not conn.execute("SELECT 1 FROM forms WHERE id = ? AND dex = ?", (fid, w["dex"])).fetchone():
            raise Invalid("That form doesn't belong to this Pokémon")
        w["form_id"] = fid
    for k in ("shiny", "lucky"):
        if k in d:
            w[k] = None if d[k] in (None, "", "any") else _bool(d[k])
    if "alignment" in d:
        w["alignment"] = _choice(d["alignment"], ("normal", "shadow", "purified"), "alignment", nullable=True)
    if "max" in d:
        w["max"] = _choice(d["max"], ("none", "dynamax", "gigantamax"), "max", nullable=True)
    if "gender" in d:
        w["gender"] = _choice(d["gender"], ("male", "female"), "gender", nullable=True)
    if "size" in d:
        w["size"] = _choice(d["size"], ("xxs", "xs", "xl", "xxl"), "size", nullable=True)
    for k in ("min_iv_atk", "min_iv_def", "min_iv_sta"):
        if k in d:
            w[k] = _int(d[k], 0, 15, "minimum IV")
    if "background" in d:
        w["background"] = _choice(d["background"], ("any", "location", "special"), "background", nullable=True)
    if "background_id" in d:
        bg = d["background_id"] or None
        if bg and not conn.execute("SELECT 1 FROM backgrounds WHERE id = ?", (bg,)).fetchone():
            raise Invalid("Unknown background")
        w["background_id"] = bg
    if "priority" in d:
        w["priority"] = _choice(d["priority"], ("high", "normal", "someday"), "priority")
    if "status" in d:
        status = _choice(d["status"], ("open", "fulfilled", "archived"), "status")
        if status == "fulfilled" and w.get("status") != "fulfilled":
            w["fulfilled_at"] = now()
        elif status != "fulfilled":
            w["fulfilled_at"] = None
        w["status"] = status
    if "public" in d:
        w["public"] = _bool(d["public"])
    for k, limit in (("moves", 160), ("title", 80), ("note", 1000), ("private_note", 2000)):
        if k in d:
            w[k] = _text(d[k], limit, k.replace("_", " "))
    if "tags" in d:
        w["tags"] = _tags(conn, d["tags"])
    return w


def save_wish(conn, batch, data: dict, wish_id=None) -> dict:
    current = get_wish(conn, wish_id) if wish_id else None
    if wish_id and not current:
        raise Invalid("That wish no longer exists")
    w = clean_wish(conn, data, current)
    ts = now()
    w["updated_at"] = ts
    if current:
        w["id"], w["created_at"] = current["id"], current["created_at"]
    else:
        w["id"], w["created_at"] = None, ts
    _put_wish(conn, w)
    after = get_wish(conn, w["id"])
    record(conn, batch, "update" if current else "insert", "wishes", w["id"], current, after, describe_wish(conn, after))
    return after


def delete_wish(conn, batch, wish_id):
    current = get_wish(conn, wish_id)
    if not current:
        raise Invalid("That wish no longer exists")
    conn.execute("DELETE FROM wishes WHERE id = ?", (wish_id,))
    record(conn, batch, "delete", "wishes", wish_id, current, None, describe_wish(conn, current))


def describe_wish(conn, w: dict) -> str:
    name = _row(conn, "SELECT name FROM species WHERE dex = ?", (w["dex"],))
    return f"Wish: {w.get('title') or (name or {}).get('name', w['dex'])} ({w['priority']}, {w['status']})"


# ------------------------------------------------------------------ catalog tweaks, settings

def set_target(conn, batch, variant_id: str, target):
    v = _row(conn, "SELECT id, target_override FROM variants WHERE id = ?", (variant_id,))
    if not v:
        _ensure_variant(conn, variant_id)
        v = _row(conn, "SELECT id, target_override FROM variants WHERE id = ?", (variant_id,))
    value = None if target in (None, "", "auto") else _bool(target)
    conn.execute("UPDATE variants SET target_override = ? WHERE id = ?", (value, variant_id))
    record(conn, batch, "update", "variants", variant_id, v, {"id": variant_id, "target_override": value},
           f"{describe_variant(conn, variant_id)}: counts towards completion = {'auto' if value is None else bool(value)}")


def save_background(conn, batch, name: str, kind: str, bg_id: str | None = None) -> dict:
    name = _text(name, 80, "name")
    if not name:
        raise Invalid("Give the background a name")
    kind = _choice(kind, ("location", "special"), "kind")
    if bg_id:
        before = _row(conn, "SELECT * FROM backgrounds WHERE id = ?", (bg_id,))
        if not before:
            raise Invalid("Unknown background")
        conn.execute("UPDATE backgrounds SET name = ?, kind = ?, custom = 1 WHERE id = ?", (name, kind, bg_id))
    else:
        before = None
        bg_id = "custom:" + (slugify(name) or secrets.token_hex(3))
        if conn.execute("SELECT 1 FROM backgrounds WHERE id = ?", (bg_id,)).fetchone():
            raise Invalid("A background with that name already exists")
        conn.execute("INSERT INTO backgrounds (id, name, kind, custom) VALUES (?, ?, ?, 1)", (bg_id, name, kind))
    after = _row(conn, "SELECT * FROM backgrounds WHERE id = ?", (bg_id,))
    record(conn, batch, "update" if before else "insert", "backgrounds", bg_id, before, after, f"Background: {name}")
    return after


def get_settings(conn) -> dict:
    out = dict(SETTINGS)
    out.update({r[0]: r[1] for r in conn.execute("SELECT key, value FROM settings")})
    return out


def save_settings(conn, batch, data: dict) -> dict:
    current = get_settings(conn)
    if data.get("link_url") and not re.fullmatch(r"(/[^\s]*|https://[^\s]+)", str(data["link_url"]).strip()):
        raise Invalid("The link must start with / or https://")
    for key, limit in (("owner_name", 40), ("title", 60), ("intro", 600), ("link_label", 30), ("link_url", 200)):
        if key in data:
            value = _text(data[key], limit, key.replace("_", " "))
            conn.execute("INSERT INTO settings VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                         (key, value))
    if "default_view" in data:
        value = _choice(data["default_view"], ("owned", "registered"), "default view")
        conn.execute("INSERT INTO settings VALUES ('default_view', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                     (value,))
    after = get_settings(conn)
    record(conn, batch, "update", "settings", "settings", current, after, "Settings")
    return after


# ------------------------------------------------------------------ undo / history

def last_batch(conn) -> str | None:
    r = conn.execute("SELECT batch FROM changes WHERE undone = 0 ORDER BY id DESC LIMIT 1").fetchone()
    return r[0] if r else None


def undo(conn, batch: str | None = None) -> dict:
    batch = batch or last_batch(conn)
    if not batch:
        raise Invalid("Nothing to undo")
    rows = conn.execute("SELECT * FROM changes WHERE batch = ? AND undone = 0 ORDER BY id DESC", (batch,)).fetchall()
    if not rows:
        raise Invalid("That change was already undone")
    # Never silently throw away a later edit: if anything in this batch was changed again since, refuse.
    newer = conn.execute(
        """SELECT summary FROM changes c WHERE c.undone = 0 AND c.id > ? AND c.batch != ?
             AND EXISTS (SELECT 1 FROM changes b WHERE b.batch = ? AND b.entity = c.entity AND b.entity_id = c.entity_id)
           ORDER BY c.id LIMIT 1""", (max(r["id"] for r in rows), batch, batch)).fetchone()
    if newer:
        raise Invalid(f"Can't undo that: it was changed again afterwards ({newer[0]}). Undo the newer change first.")
    for r in rows:
        before = json.loads(r["before"]) if r["before"] else None
        if r["entity"] == "entries":
            conn.execute("DELETE FROM entries WHERE id = ?", (int(r["entity_id"]),))
            if before:
                _put_entry(conn, before)
        elif r["entity"] == "wishes":
            conn.execute("DELETE FROM wishes WHERE id = ?", (int(r["entity_id"]),))
            if before:
                _put_wish(conn, before)
        elif r["entity"] == "variants":
            conn.execute("UPDATE variants SET target_override = ? WHERE id = ?",
                         (before["target_override"] if before else None, r["entity_id"]))
        elif r["entity"] == "backgrounds":
            if before:
                conn.execute("UPDATE backgrounds SET name = ?, kind = ?, custom = ? WHERE id = ?",
                             (before["name"], before["kind"], before["custom"], r["entity_id"]))
            elif not conn.execute("SELECT 1 FROM entries WHERE background_id = ? UNION ALL "
                                  "SELECT 1 FROM wishes WHERE background_id = ?",
                                  (r["entity_id"], r["entity_id"])).fetchone():
                conn.execute("DELETE FROM backgrounds WHERE id = ?", (r["entity_id"],))
        elif r["entity"] == "settings":
            conn.execute("DELETE FROM settings")
            conn.executemany("INSERT INTO settings VALUES (?, ?)", list((before or {}).items()))
    conn.execute("UPDATE changes SET undone = 1 WHERE batch = ?", (batch,))
    return {"batch": batch, "changes": len(rows), "summary": rows[-1]["summary"]}


def history(conn, limit=50) -> list[dict]:
    return [dict(r) for r in conn.execute(
        """SELECT batch, min(at) AS at, count(*) AS n, max(undone) AS undone,
                  (SELECT summary FROM changes c2 WHERE c2.batch = c.batch ORDER BY id LIMIT 1) AS summary
           FROM changes c GROUP BY batch ORDER BY max(id) DESC LIMIT ?""", (limit,))]


# ------------------------------------------------------------------ export / import

EXPORT_FORMAT = "godex-collection"


def export(conn) -> dict:
    entries = [get_entry(conn, r[0]) for r in conn.execute("SELECT id FROM entries ORDER BY id")]
    wishes = [get_wish(conn, r[0]) for r in conn.execute("SELECT id FROM wishes ORDER BY id")]
    return {
        "format": EXPORT_FORMAT, "version": 1, "exported_at": now(),
        "settings": get_settings(conn),
        "entries": [{k: v for k, v in e.items() if k != "id"} for e in entries],
        "wishes": [{k: v for k, v in w.items() if k != "id"} for w in wishes],
        "variant_targets": {r[0]: r[1] for r in conn.execute(
            "SELECT id, target_override FROM variants WHERE target_override IS NOT NULL")},
        "custom_backgrounds": [dict(r) for r in conn.execute(
            "SELECT id, name, kind, year FROM backgrounds WHERE custom = 1")],
        "tags": [dict(r) for r in conn.execute("SELECT slug, label, description FROM tags ORDER BY slug")],
    }


IDENTITY = ("variant_id",) + SPECIMEN_FIELDS                 # what makes two entries "the same Pokémon"
WISH_IDENTITY = tuple(f for f in WISH_FIELDS if f not in ("title", "note", "private_note", "priority", "status", "public"))


def _same_entry(conn, e: dict) -> dict | None:
    """An existing entry describing the same Pokémon (same variant and per-Pokémon details), if any."""
    for r in conn.execute("SELECT id FROM entries WHERE variant_id = ?", (e["variant_id"],)).fetchall():
        cur = get_entry(conn, r[0])
        if all((cur.get(k) or None) == (e.get(k) or None) for k in SPECIMEN_FIELDS):
            return cur
    return None


def _same_wish(conn, w: dict) -> bool:
    for r in conn.execute("SELECT * FROM wishes WHERE dex = ?", (w["dex"],)).fetchall():
        if all((r[k] if r[k] not in ("", None) else None) == (w.get(k) if w.get(k) not in ("", None) else None)
               for k in WISH_IDENTITY):
            return True
    return False


def import_collection(conn, batch, data: dict, mode: str) -> dict:
    """Merge (add to what is there) or replace (start over) from an export. Validates everything first;
    the caller's transaction makes it all-or-nothing.

    Merging is safe to repeat: an entry for the same Pokémon (same variant and details) is combined with the
    existing one, keeping the higher counts, and a wish identical to an existing one is skipped."""
    if not isinstance(data, dict) or data.get("format") != EXPORT_FORMAT:
        raise Invalid("This is not a godex collection export")
    if mode not in ("merge", "replace"):
        raise Invalid("Mode must be merge or replace")
    for key in ("entries", "wishes", "tags", "custom_backgrounds"):
        if data.get(key) is not None and not isinstance(data[key], list):
            raise Invalid(f"'{key}' must be a list")
    if data.get("variant_targets") is not None and not isinstance(data["variant_targets"], dict):
        raise Invalid("'variant_targets' must be an object")
    report = {"entries": 0, "merged": 0, "wishes": 0, "duplicates": 0, "skipped": []}
    bad = (Invalid, ValueError, KeyError, TypeError, AttributeError, sqlite3.IntegrityError)
    for t in data.get("tags") or []:
        try:
            conn.execute("INSERT INTO tags (slug, label, description) VALUES (?, ?, ?) ON CONFLICT (slug) DO NOTHING",
                         (slugify(t.get("slug", "")) or "tag", _text(t.get("label"), 40, "tag") or t.get("slug"),
                          _text(t.get("description"), 200, "tag description")))
        except bad as exc:
            report["skipped"].append(f"tag: {exc}")
    for b in data.get("custom_backgrounds") or []:
        try:
            conn.execute("""INSERT INTO backgrounds (id, name, kind, year, custom) VALUES (?, ?, ?, ?, 1)
                            ON CONFLICT (id) DO NOTHING""",
                         (str(b["id"])[:80], _text(b.get("name"), 80, "name") or b["id"],
                          _choice(b.get("kind", "location"), ("location", "special"), "kind"), b.get("year")))
        except bad as exc:
            report["skipped"].append(f"background: {exc}")
    if mode == "replace":
        for r in conn.execute("SELECT id FROM entries").fetchall():
            delete_entry(conn, batch, r[0])
        for r in conn.execute("SELECT id FROM wishes").fetchall():
            delete_wish(conn, batch, r[0])
    for i, e in enumerate(data.get("entries") or []):
        try:
            if not isinstance(e, dict):
                raise Invalid("not an object")
            clean = clean_entry(conn, {k: v for k, v in e.items() if k != "id"})
            same = _same_entry(conn, clean) if mode == "merge" else None
            if same:
                save_entry(conn, batch, {"registered": max(same["registered"], clean["registered"]),
                                         "owned": max(same["owned"], clean["owned"]),
                                         "for_trade": max(same["for_trade"], clean["for_trade"]),
                                         "tags": sorted(set(same["tags"]) | set(clean.get("tags", [])))}, same["id"])
                report["merged"] += 1
            else:
                save_entry(conn, batch, {**e, "source": e.get("source") or "import"})
                report["entries"] += 1
        except bad as exc:
            report["skipped"].append(f"entry {i + 1}: {exc}")
    for i, w in enumerate(data.get("wishes") or []):
        try:
            if not isinstance(w, dict):
                raise Invalid("not an object")
            clean = clean_wish(conn, {k: v for k, v in w.items() if k != "id"})
            if mode == "merge" and _same_wish(conn, clean):
                report["duplicates"] += 1
                continue
            save_wish(conn, batch, {k: v for k, v in w.items() if k != "id"})
            report["wishes"] += 1
        except bad as exc:
            report["skipped"].append(f"wish {i + 1}: {exc}")
    for vid, target in (data.get("variant_targets") or {}).items():
        try:
            set_target(conn, batch, vid, target)
        except bad:
            report["skipped"].append(f"target {vid}")
    if isinstance(data.get("settings"), dict):
        try:
            save_settings(conn, batch, data["settings"])
        except bad as exc:
            report["skipped"].append(f"settings: {exc}")
    return report
