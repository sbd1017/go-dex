import json
import time

import pytest
from fastapi.testclient import TestClient

from godex import auth, catalog, config, services
from godex.db import Database
from godex.web import create_app


def make_cfg(tmp_path, **env):
    import os
    old = dict(os.environ)
    os.environ.update({"DEX_DATA_DIR": str(tmp_path / "var"), "DEX_SPRITES_DIR": str(tmp_path / "sprites"),
                       "DEX_AUTH": "none", "DEX_SECURE_COOKIES": "0", **env})
    try:
        return config.load()
    finally:
        os.environ.clear()
        os.environ.update(old)


@pytest.fixture(scope="module")
def loaded(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("dex")
    cfg = make_cfg(tmp)
    app = create_app(cfg)      # loads the catalog into an empty database
    return cfg, app


@pytest.fixture()
def client(loaded):
    cfg, app = loaded
    return TestClient(app, headers={"x-csrf-token": "dev"})


def test_catalog_loaded(loaded):
    cfg, _ = loaded
    with Database(cfg.db_path).read() as conn:
        n = conn.execute("SELECT count(*) FROM species").fetchone()[0]
        assert n > 1000
        assert conn.execute("SELECT kind FROM forms WHERE id = 'PIKACHU_VS_2019'").fetchone()[0] == "costume"
        assert conn.execute("SELECT 1 FROM variants WHERE id = 'CHARIZARD|s|normal|gigantamax'").fetchone()
        assert conn.execute("SELECT catalog_target FROM variants WHERE id = 'MIMIKYU_BUSTED|n|normal|none'").fetchone()[0] == 0


def test_catalog_reload_keeps_collection(loaded, client):
    cfg, _ = loaded
    r = client.post("/dex/api/admin/quick", json={"variant_id": "MEW|s|normal|none", "owned": 1})
    assert r.json()["ok"]
    catalog.load(Database(cfg.db_path), cfg.catalog_path)
    with Database(cfg.db_path).read() as conn:
        assert conn.execute("SELECT owned FROM entries WHERE variant_id = 'MEW|s|normal|none'").fetchone()[0] == 1


def test_quick_rules(client):
    vid = "BULBASAUR|n|normal|none"
    e = client.post("/dex/api/admin/quick", json={"variant_id": vid, "trade_delta": 2}).json()["entries"][0]
    assert (e["for_trade"], e["registered"]) == (2, 1)                    # offering one puts it in the Pokédex
    e = client.post("/dex/api/admin/quick", json={"variant_id": vid, "trade_delta": -1}).json()["entries"][0]
    assert e["for_trade"] == 1
    # Taking it out of the Pokédex clears what was offered too, and an empty plain entry disappears.
    assert client.post("/dex/api/admin/quick", json={"variant_id": vid, "registered": 0}).json()["entries"] == []
    e = client.post("/dex/api/admin/quick", json={"variant_id": vid, "registered": 1}).json()["entries"][0]
    assert (e["registered"], e["for_trade"]) == (1, 0)
    assert client.post("/dex/api/admin/quick", json={"variant_id": "NOPE|n|normal|none", "registered": 1}).status_code == 400


def test_special_entry_validation(client):
    ok = client.post("/dex/api/admin/entries", json={"variant_id": "PALKIA_ORIGIN|n|normal|none", "lucky": 1, "iv_atk": 15,
                                                      "iv_def": 15, "iv_sta": 15, "moves": "Spacial Rend", "tags": ["PvP"]}).json()
    assert ok["ok"] and ok["entry"]["tags"] == ["pvp"]
    bad = client.post("/dex/api/admin/entries", json={"variant_id": "PALKIA|n|normal|none", "iv_atk": 16})
    assert bad.status_code == 400 and "between 0 and 15" in bad.json()["error"]
    bad = client.post("/dex/api/admin/entries", json={"variant_id": "PALKIA|n|normal|none", "owned": 1, "for_trade": 2})
    assert bad.status_code == 400
    bad = client.post("/dex/api/admin/entries", json={"variant_id": "PALKIA|n|normal|none", "background_id": "nope"})
    assert bad.status_code == 400


def test_undo_restores(client):
    r = client.post("/dex/api/admin/wishes", json={"dex": 25, "form_id": "PIKACHU_VS_2019", "shiny": 1, "priority": "high"}).json()
    wid = r["wish"]["id"]
    client.post(f"/dex/api/admin/wishes/{wid}/delete")
    assert not any(w["id"] == wid for w in client.get("/dex/api/admin/dataset").json()["wishes"])
    client.post("/dex/api/admin/undo", json={})
    assert any(w["id"] == wid for w in client.get("/dex/api/admin/dataset").json()["wishes"])


def test_private_data_stays_private(client):
    client.post("/dex/api/admin/entries", json={"variant_id": "EEVEE|n|normal|none", "note": "public bit", "private_note": "SECRET-1"})
    client.post("/dex/api/admin/wishes", json={"dex": 133, "private_note": "SECRET-2"})
    client.post("/dex/api/admin/wishes", json={"dex": 134, "public": 0, "title": "SECRET-3"})
    public = client.get("/dex/api/dataset").text
    assert "public bit" in public
    for s in ("SECRET-1", "SECRET-2", "SECRET-3"):
        assert s not in public
    assert "SECRET-1" in client.get("/dex/api/admin/dataset").text


def test_bulk_and_dataset_etag(client):
    r = client.post("/dex/api/admin/bulk", json={"variant_ids": ["SQUIRTLE|n|normal|none", "WARTORTLE|n|normal|none"], "action": "register"}).json()
    assert r["changed"] == 2
    first = client.get("/dex/api/dataset")
    again = client.get("/dex/api/dataset", headers={"if-none-match": first.headers["etag"]})
    assert again.status_code == 304


def test_export_import_roundtrip(loaded, client):
    data = client.get("/dex/api/admin/export.json").json()
    assert data["format"] == "godex-collection" and data["entries"]
    dry = client.post("/dex/api/admin/import", json={"data": data, "mode": "replace", "dry_run": True}).json()
    assert dry["ok"] and dry["report"]["entries"] == len(data["entries"])
    before = client.get("/dex/api/admin/export.json").json()["entries"]
    client.post("/dex/api/admin/import", json={"data": data, "mode": "replace"})
    after = client.get("/dex/api/admin/export.json").json()["entries"]
    strip = lambda rows: sorted(json.dumps({k: v for k, v in r.items() if k not in ("created_at", "updated_at")}, sort_keys=True) for r in rows)  # noqa: E731
    assert strip(before) == strip(after)
    assert client.post("/dex/api/admin/import", json={"data": {"format": "other"}, "mode": "merge"}).status_code == 400


def test_public_routes(client):
    assert client.get("/dex/").status_code == 200
    assert client.get("/dex/25").status_code == 200
    assert client.get("/dex/wishlist").status_code == 200
    assert client.get("/dex/nope").status_code == 404
    assert client.get("/elsewhere").status_code == 404
    assert client.get("/dex", follow_redirects=False).status_code == 308
    page = client.get("/dex/").text
    assert "<script>" not in page.replace('<script type="application/json"', "")  # only external scripts (CSP)
    assert "script-src 'self'" in client.get("/dex/").headers["content-security-policy"]


def test_public_cannot_write(loaded):
    _, app = loaded
    c = TestClient(app)
    assert c.post("/dex/api/dataset").status_code == 405
    assert c.post("/dex/25").status_code == 405


# ---------------------------------------------------------------- auth modes

def test_password_mode(tmp_path):
    cfg = make_cfg(tmp_path, DEX_AUTH="password", DEX_ADMIN_PASSWORD_HASH=auth.hash_password("correct horse battery"))
    c = TestClient(create_app(cfg), base_url="http://testserver")
    assert c.get("/dex/").status_code == 200
    assert c.get("/dex/admin", follow_redirects=False).status_code == 303
    assert c.get("/dex/api/admin/dataset").status_code == 401
    assert c.post("/dex/api/admin/quick", json={"variant_id": "MEW|n|normal|none", "owned": 1}).status_code == 401
    r = c.post("/dex/login", data={"password": "wrong password!"}, follow_redirects=False)
    assert "error=wrong" in r.headers["location"]
    r = c.post("/dex/login", data={"password": "correct horse battery"}, follow_redirects=False)
    assert r.status_code == 303 and "dex_session" in r.cookies
    page = c.get("/dex/admin").text
    csrf = json.loads(page.split('id="dex-config">')[1].split("</script>")[0])["csrf"]
    assert c.post("/dex/api/admin/quick", json={"variant_id": "MEW|n|normal|none", "owned": 1}).status_code == 403   # no token
    ok = c.post("/dex/api/admin/quick", json={"variant_id": "MEW|n|normal|none", "owned": 1}, headers={"x-csrf-token": csrf})
    assert ok.status_code == 200
    bad_origin = c.post("/dex/api/admin/quick", json={"variant_id": "MEW|n|normal|none", "owned": 2},
                        headers={"x-csrf-token": csrf, "origin": "https://evil.example"})
    assert bad_origin.status_code == 403


def test_site_mode_trusts_only_loopback(tmp_path, monkeypatch):
    key = "k" * 64
    (tmp_path / "proxy-key").write_text(key + "\n")
    monkeypatch.setenv("SITE_PROXY_KEY_FILE", str(tmp_path / "proxy-key"))
    cfg = make_cfg(tmp_path, DEX_AUTH="site")
    app = create_app(cfg)
    hdrs = {"x-site-user": "owner", "x-site-csrf": "c" * 40, "x-site-expires": str(int(time.time()) + 600),
            "x-site-proxy-key": key}
    remote = TestClient(app)                                  # TestClient's peer is "testclient", not loopback
    assert remote.get("/dex/api/admin/dataset", headers=hdrs).status_code == 401
    async def from_loopback(scope, receive, send):
        await app(dict(scope, client=("127.0.0.1", 50000)), receive, send)
    local = TestClient(from_loopback)
    assert local.get("/dex/api/admin/dataset", headers=hdrs).status_code == 200
    assert local.get("/dex/api/admin/dataset").status_code == 401
    expired = hdrs | {"x-site-expires": str(int(time.time()) - 1)}
    assert local.get("/dex/api/admin/dataset", headers=expired).status_code == 401
    ok = local.post("/dex/api/admin/quick", json={"variant_id": "MEW|n|normal|none", "owned": 1}, headers=hdrs | {"x-csrf-token": "c" * 40})
    assert ok.status_code == 200
    no_key = {k: v for k, v in hdrs.items() if k != "x-site-proxy-key"}                # another local process
    assert local.get("/dex/api/admin/dataset", headers=no_key).status_code == 401
    assert local.get("/dex/api/admin/dataset", headers=hdrs | {"x-site-proxy-key": "k" * 63 + "x"}).status_code == 401
    assert local.get("/dex/api/admin/dataset", headers=list(hdrs.items()) + [("x-site-proxy-key", key)]).status_code == 401


def test_site_mode_refuses_to_start_without_proxy_key(tmp_path, monkeypatch):
    monkeypatch.delenv("SITE_PROXY_KEY_FILE", raising=False)
    monkeypatch.delenv("CREDENTIALS_DIRECTORY", raising=False)
    with pytest.raises(SystemExit, match="proxy key"):
        create_app(make_cfg(tmp_path, DEX_AUTH="site"))


def test_password_hashing():
    h = auth.hash_password("long enough pw")
    assert auth.verify_password("long enough pw", h) and not auth.verify_password("nope", h)
    with pytest.raises(ValueError):
        auth.hash_password("short")


def test_variant_ids():
    assert catalog.variant_id("PIKACHU", 1, "shadow") == "PIKACHU|s|shadow|none"
    assert catalog.parse_variant_id("PIKACHU|n|normal|gigantamax") == ("PIKACHU", 0, "normal", "gigantamax")
    with pytest.raises(ValueError):
        catalog.parse_variant_id("PIKACHU|x|normal|none")


def test_services_invalid_messages(loaded):
    cfg, _ = loaded
    db = Database(cfg.db_path)
    with pytest.raises(services.Invalid), db.write() as conn:
        services.save_wish(conn, services.new_batch(), {"dex": 25, "form_id": "RAICHU_ALOLA"})


def test_link_previews_and_manifest(client):
    page = client.get("/dex/?shiny&missing").text
    assert '<meta property="og:title" content="Pokédex · shiny, missing">' in page
    assert 'property="og:image" content="http://testserver/dex/static/v/' in page
    wish = client.get("/dex/wishlist").text
    assert "Pokémon wanted" in wish and "<title>Wishlist</title>" in wish
    assert "#025 Pikachu" in client.get("/dex/25").text
    m = client.get("/dex/manifest.webmanifest").json()
    assert m["start_url"] == "/dex/" and m["display"] == "standalone" and len(m["icons"]) == 2
    assert client.get("/dex/manifest.webmanifest?admin=1").json()["start_url"] == "/dex/admin/"
    evil = client.get("/dex/?q=%3Cscript%3Ealert(1)%3C/script%3E").text
    assert "<script>alert" not in evil


def test_versioned_static(client):
    page = client.get("/dex/").text
    v = page.split("/dex/static/v/")[1].split("/")[0]
    r = client.get(f"/dex/static/v/{v}/js/views/trade.js")
    assert r.status_code == 200 and "immutable" in r.headers["cache-control"]
    assert "immutable" not in client.get("/dex/static/v/old/js/app.js").headers["cache-control"]
    assert client.get(f"/dex/static/v/{v}/../web.py").status_code == 404
    assert client.get(f"/dex/static/v/{v}/%2e%2e/web.py").status_code == 404


# ---------------------------------------------------------------- edge cases

def test_head_and_bad_input(client):
    for path in ("/dex/", "/dex/25", "/dex/api/dataset", "/dex/manifest.webmanifest", "/dex/api/health"):
        assert client.head(path).status_code == 200, path
    r = client.post("/dex/api/admin/quick", content=b"not json", headers={"content-type": "application/json"})
    assert r.status_code == 400 and r.json()["error"] == "Send JSON"
    assert client.post("/dex/api/admin/quick", json=[1, 2]).status_code == 400


def test_import_merge_is_repeatable_and_tolerant(client):
    data = {"format": "godex-collection", "entries": [
        {"variant_id": "ONIX|n|normal|none", "registered": 1, "owned": 2},
        {"variant_id": "ONIX|s|normal|none", "registered": 1, "owned": 1, "size": "xxl"},
        5, {"variant_id": "NOPE|n|normal|none", "owned": 1}],
        "wishes": [{"dex": 95, "shiny": 1, "priority": "high"}, "x"]}
    first = client.post("/dex/api/admin/import", json={"data": data, "mode": "merge"}).json()
    assert first["ok"] and first["report"]["entries"] == 2 and first["report"]["wishes"] == 1
    assert len(first["report"]["skipped"]) == 3
    again = client.post("/dex/api/admin/import", json={"data": data, "mode": "merge"}).json()["report"]
    assert again["entries"] == 0 and again["merged"] == 2 and again["wishes"] == 0 and again["duplicates"] == 1
    entries = [e for e in client.get("/dex/api/admin/dataset").json()["entries"] if e["v"].startswith("ONIX|")]
    assert sorted((e["v"], e["o"]) for e in entries) == [("ONIX|n|normal|none", 2), ("ONIX|s|normal|none", 1)]
    bad = client.post("/dex/api/admin/import", json={"data": {"format": "godex-collection", "entries": "nope"}, "mode": "merge"})
    assert bad.status_code == 400


def test_undo_refuses_to_clobber_newer_changes(client):
    first = client.post("/dex/api/admin/quick", json={"variant_id": "GEODUDE|n|normal|none", "owned": 1}).json()
    client.post("/dex/api/admin/quick", json={"variant_id": "GEODUDE|n|normal|none", "owned": 5})
    r = client.post("/dex/api/admin/undo", json={"batch": first["batch"]})
    assert r.status_code == 400 and "changed again" in r.json()["error"]
    assert client.post("/dex/api/admin/undo", json={}).json()["ok"]            # the newest one is fine
    assert client.post("/dex/api/admin/undo", json={"batch": first["batch"]}).json()["ok"]   # and then the older one


def test_csv_formulas_are_neutralised(client):
    client.post("/dex/api/admin/entries", json={"variant_id": "ZUBAT|n|normal|none", "owned": 1, "note": "=HYPERLINK(1)"})
    csv = client.get("/dex/api/admin/export/entries.csv").text
    assert "'=HYPERLINK(1)" in csv and ",=HYPERLINK" not in csv


def test_login_keeps_destination(tmp_path):
    cfg = make_cfg(tmp_path, DEX_AUTH="password", DEX_ADMIN_PASSWORD_HASH=auth.hash_password("correct horse battery"))
    c = TestClient(create_app(cfg), base_url="http://testserver")
    r = c.get("/dex/admin/wishlist", follow_redirects=False)
    assert r.headers["location"] == "/dex/login?next=/admin/wishlist"
    assert 'value="/admin/wishlist"' in c.get(r.headers["location"]).text
    assert 'value="/admin"' in c.get("/dex/login?next=https://evil.example").text
    r = c.post("/dex/login", data={"password": "correct horse battery", "next": "/admin/wishlist"}, follow_redirects=False)
    assert r.headers["location"] == "/dex/admin/wishlist"


def test_species_records(client):
    sp = lambda dex: next(s for s in client.get("/dex/api/dataset").json()["species"] if s["dex"] == dex)  # noqa: E731
    assert sp(151)["sizes"] == 0 and sp(151)["lucky"] == 0             # catalog: Mew has no size records, can't trade
    assert sp(25)["sizes"] == 1 and sp(25)["lucky"] == 1
    assert client.post("/dex/api/admin/species/record", json={"dex": 25, "record": "sizes", "value": 0}).json()["ok"]
    assert sp(25)["sizes"] == 0
    exported = client.get("/dex/api/admin/export.json").json()
    assert exported["species_records"]["25"] == {"sizes": 0}
    client.post("/dex/api/admin/undo", json={})
    assert sp(25)["sizes"] == 1
    assert client.post("/dex/api/admin/species/record", json={"dex": 25, "record": "shiny", "value": 0}).status_code == 400
    assert sp(764)["regional"] == 1 and sp(25)["regional"] == 0         # Comfey is a regional exclusive
    assert client.post("/dex/api/admin/species/record", json={"dex": 25, "record": "regional", "value": 1}).json()["ok"]
    assert sp(25)["regional"] == 1
    client.post("/dex/api/admin/undo", json={})
