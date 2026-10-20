"""HTTP: the public read-only Pokédex, the admin editor, and the JSON API.

Public (no login):  GET  {base}/  /wishlist  /trade  /stats  /<dex>   GET {base}/api/dataset
Admin (login):      GET  {base}/admin/...                             POST {base}/api/admin/...
Everything that changes data is a POST under /api/admin/, checked for a session, Origin and a CSRF token.
"""
import hmac
import json
import os
import logging
import pathlib
import re
import sqlite3

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import __version__, catalog, config, services
from .auth import COOKIE, SESSION_SECONDS, Auth
from .dataset import DatasetCache
from .db import Database
from .services import Invalid
from .sprites import SpriteIndex

log = logging.getLogger("godex")
STATIC = pathlib.Path(__file__).resolve().parent / "static"
PAGE_RE = re.compile(r"/(|wishlist|trade|stats|\d{1,4})/?")
CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
       "manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")


def create_app(cfg: config.Config | None = None) -> FastAPI:
    cfg = cfg or config.load()
    BASE = cfg.base_path
    db = Database(cfg.db_path)
    with db.read() as conn:
        empty = not conn.execute("SELECT 1 FROM species LIMIT 1").fetchone()
    if empty and cfg.catalog_path.exists():
        log.info("empty database: loading the catalog")
        catalog.load(db, cfg.current_catalog())
    sprites = SpriteIndex(cfg.sprites_dir)
    cache = DatasetCache(db, sprites)
    auth = Auth(cfg)
    index_html = (STATIC / "index.html").read_text(encoding="utf-8")
    static_version = _static_version()

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.db, app.state.cfg = db, cfg

    def get(path):
        """GET routes also answer HEAD (link-preview fetchers and uptime checks use it)."""
        return app.api_route(path, methods=["GET", "HEAD"])

    @app.exception_handler(Invalid)
    async def invalid_input(request: Request, exc: Invalid):
        return JSONResponse({"ok": False, "error": str(exc)}, 400)

    @app.exception_handler(sqlite3.OperationalError)
    async def database_busy(request: Request, exc: sqlite3.OperationalError):
        if "locked" in str(exc) or "busy" in str(exc):
            return JSONResponse({"ok": False, "error": "Busy saving other changes. Try again in a moment."}, 503)
        log.error("database error: %s", exc)
        return JSONResponse({"ok": False, "error": "Something went wrong. Nothing was saved."}, 500)

    def headers(resp: Response, kind: str = "page") -> Response:
        resp.headers["Content-Security-Policy"] = CSP
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "same-origin"
        resp.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
        resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        if "cache-control" not in resp.headers:
            resp.headers["Cache-Control"] = {"private": "private, no-store", "sprite": "public, max-age=604800",
                                             "static": "no-cache"}.get(kind, "no-cache")
        return resp

    def is_admin_path(path: str) -> bool:
        rest = path[len(BASE):]
        return rest == "/admin" or rest.startswith(("/admin/", "/api/admin/"))

    def origin_ok(request: Request) -> bool:
        origin = request.headers.get("origin")
        if not origin:
            return request.headers.get("sec-fetch-site") in (None, "same-origin")
        host = request.headers.get("host", "")
        return origin in (f"https://{host}", f"http://{host}") + cfg.public_origins

    @app.middleware("http")
    async def boundary(request: Request, call_next):
        path = request.url.path
        if BASE and path == BASE:
            return headers(RedirectResponse(BASE + "/" + (f"?{request.url.query}" if request.url.query else ""), 308))
        if not path.startswith(BASE + "/"):
            return headers(PlainTextResponse("Not found", 404))
        if request.method not in ("GET", "HEAD", "POST"):
            return headers(PlainTextResponse("Not allowed", 405))
        request.state.session = None
        if is_admin_path(path):
            session = auth.session(request)
            if session is None:
                if request.method == "GET" and not path.startswith(BASE + "/api/"):
                    if auth.mode == "password":
                        return headers(RedirectResponse(BASE + "/login?next=" + path[len(BASE):], 303), "private")
                return headers(JSONResponse({"error": "Sign in to edit"}, 401), "private")
            request.state.session = session
            if request.method == "POST":
                if not origin_ok(request):
                    return headers(PlainTextResponse("Cross-site request blocked", 403), "private")
                token = request.headers.get("x-csrf-token", "")
                if not (token and hmac.compare_digest(token, session["csrf"])):
                    return headers(JSONResponse({"error": "Security token expired. Reload and try again."}, 403),
                                   "private")
        elif request.method == "POST" and path not in (BASE + "/login", BASE + "/logout"):
            return headers(PlainTextResponse("Not allowed", 405))
        try:
            response = await call_next(request)
        except Exception:  # never leak details
            log.exception("request failed")
            response = JSONResponse({"error": "Something went wrong. Nothing was saved."}, 500)
        kind = "private" if is_admin_path(path) else ("sprite" if path.startswith(BASE + "/media/") else
                                                       "static" if path.startswith(BASE + "/static/") else "page")
        return headers(response, kind)

    # -------------------------------------------------------------- pages
    def page(request: Request, admin: bool) -> HTMLResponse:
        nonlocal static_version
        if os.environ.get("DEX_DEV") == "1":          # local development: pick up edited files without a restart
            static_version = _static_version()
        session = request.state.session
        with db.read() as conn:
            settings = services.get_settings(conn)
            meta = page_meta(conn, request, settings, admin)
        cfg_json = {"base": BASE, "admin": admin, "csrf": session["csrf"] if (admin and session) else "",
                    "auth": auth.mode, "v": static_version, "title": settings["title"],
                    "owner": settings["owner_name"]}
        html = (index_html.replace("{{BASE}}", BASE).replace("{{V}}", static_version)
                .replace("{{TITLE}}", _esc(meta["title"]))
                .replace("{{META}}", meta["html"])
                .replace("{{MANIFEST}}", f"{BASE}/manifest.webmanifest" + ("?admin=1" if admin else ""))
                .replace("{{APPNAME}}", _esc(meta["app"]))
                .replace("{{CONFIG}}", json.dumps(cfg_json).replace("<", "\\u003c")))
        return HTMLResponse(html)

    def origin(request: Request) -> str:
        proto = request.url.scheme
        if request.client and request.client.host in ("127.0.0.1", "::1"):
            proto = request.headers.get("x-forwarded-proto", proto)
        host = request.headers.get("host", "")
        return f"{proto}://{host}" if re.fullmatch(r"[A-Za-z0-9.:\[\]-]{1,255}", host) else ""

    def page_meta(conn, request: Request, settings: dict, admin: bool) -> dict:
        """Title, description and preview image for the page, so shared links show something useful."""
        who = settings["owner_name"]
        whose = f"{who}'s " if who else ""
        dex_title = whose + settings["title"]
        rest = request.url.path[len(BASE):]
        if admin:
            rest = rest[len("/admin"):] if rest.startswith("/admin") else rest
        rest = rest.strip("/")
        query = describe_query(request.url.query)
        image = f"{BASE}/static/v/{static_version}/icon-512.png"
        title, desc = dex_title, (f"{who}'s" if who else "A") + " Pokémon GO collection: what is owned, missing, wished for and up for trade. Search it like the in-game Pokédex."
        q = lambda sql, *a: conn.execute(sql, a).fetchone()[0]  # noqa: E731
        if rest == "wishlist":
            n = q("SELECT count(*) FROM wishes WHERE status = 'open' AND public = 1")
            hi = q("SELECT count(*) FROM wishes WHERE status = 'open' AND public = 1 AND priority = 'high'")
            title, desc = f"{whose}Wishlist", f"{n} Pokémon wanted" + (f", {hi} high priority" if hi else "") + "."
        elif rest == "trade":
            offer = q("SELECT coalesce(sum(for_trade), 0) FROM entries")
            want = q("SELECT count(*) FROM wishes WHERE status = 'open' AND public = 1")
            title, desc = (f"Trade with {who}" if who else "Trade"), f"{offer} Pokémon to offer, {want} wanted."
        elif rest == "stats":
            title, desc = f"{whose}Pokédex stats", "Collection progress: Pokédex, shiny, Shadow, lucky, XXL, costumes and more."
        elif rest.isdigit():
            sp = conn.execute("SELECT dex, name FROM species WHERE dex = ?", (int(rest),)).fetchone()
            if sp:
                have = q("""SELECT count(DISTINCT v.id) FROM entries e JOIN variants v ON v.id = e.variant_id
                            JOIN forms f ON f.id = v.form_id WHERE f.dex = ? AND e.registered = 1""", sp["dex"])
                title = f"#{sp['dex']:03d} {sp['name']} · {dex_title}"
                desc = (f"{have} variant{'s' if have != 1 else ''} in the Pokédex." if have
                        else f"{sp['name']} is not in the Pokédex yet.")
                f = conn.execute("SELECT * FROM forms WHERE dex = ? ORDER BY kind != 'base', sort LIMIT 1", (sp["dex"],)).fetchone()
                sprites.refresh()
                file = sprites.for_form(f, f["image"])[0] if f else None
                if file:
                    image = f"{BASE}/media/sprites/{file}"
        if query and rest in ("", "wishlist", "trade"):
            title = f"{title} · {query}"
        o = origin(request)
        tags = [("description", desc), ("og:title", title), ("og:description", desc), ("og:type", "website"),
                ("og:site_name", dex_title), ("og:image", o + image), ("og:url", o + request.url.path + (f"?{request.url.query}" if request.url.query else "")),
                ("twitter:card", "summary")]
        html = "\n".join(f'<meta {"property" if k.startswith("og:") else "name"}="{k}" content="{_esc(v)}">' for k, v in tags)
        return {"title": title + (" · editing" if admin else ""), "html": html, "app": settings["title"] if not who else f"{who}'s Dex"}

    @get(BASE + "/manifest.webmanifest")
    def manifest(request: Request, admin: int = 0):
        with db.read() as conn:
            s = services.get_settings(conn)
        name = (f"{s['owner_name']}'s " if s["owner_name"] else "") + s["title"]
        data = {
            "name": name + (" (editing)" if admin else ""), "short_name": (f"{s['owner_name']}'s Dex" if s["owner_name"] else "Pokédex")[:20],
            "start_url": f"{BASE}/admin/" if admin else f"{BASE}/", "scope": f"{BASE}/", "display": "standalone",
            "background_color": "#0b1018", "theme_color": "#0b1018",
            "icons": [{"src": f"{BASE}/static/v/{static_version}/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
                      {"src": f"{BASE}/static/v/{static_version}/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}],
        }
        return Response(json.dumps(data, ensure_ascii=False), media_type="application/manifest+json")

    @get(BASE + "/admin")
    @get(BASE + "/admin/{rest:path}")
    def admin_page(request: Request, rest: str = ""):
        return page(request, admin=True)

    @get(BASE + "/login")
    def login_page(request: Request, error: str = "", next: str = "/admin"):
        if auth.mode != "password":
            return RedirectResponse(BASE + "/admin", 303)
        nxt = next if re.fullmatch(r"/admin[A-Za-z0-9/_-]*", next) else "/admin"
        return HTMLResponse(_login_html(BASE, error, static_version, nxt))

    @app.post(BASE + "/login")
    async def login(request: Request):
        if auth.mode != "password":
            return PlainTextResponse("Not allowed", 405)
        if not origin_ok(request):
            return PlainTextResponse("Cross-site request blocked", 403)
        ip = request.headers.get("x-real-ip") if request.client and request.client.host in ("127.0.0.1", "::1") \
            else None
        ip = ip or (request.client.host if request.client else "?")
        form = await request.form()
        nxt = str(form.get("next") or "/admin")
        nxt = nxt if re.fullmatch(r"/admin[A-Za-z0-9/_-]*", nxt) else "/admin"
        if not auth.allowed(ip):
            return RedirectResponse(f"{BASE}/login?error=wait&next={nxt}", 303)
        if not auth.check_password(str(form.get("password") or "")):
            auth.failed(ip)
            return RedirectResponse(f"{BASE}/login?error=wrong&next={nxt}", 303)
        resp = RedirectResponse(BASE + nxt, 303)
        resp.set_cookie(COOKIE, auth.new_cookie(), max_age=SESSION_SECONDS, path=BASE + "/", httponly=True,
                        secure=cfg.secure_cookies, samesite="strict")
        return resp

    @app.post(BASE + "/logout")
    def logout():
        resp = RedirectResponse(BASE + "/", 303)
        resp.delete_cookie(COOKIE, path=BASE + "/")
        return resp

    # -------------------------------------------------------------- public API
    def dataset_response(request: Request, admin: bool) -> Response:
        body, gz, etag = cache.get(admin)
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={"ETag": etag})
        h = {"ETag": etag, "Vary": "Accept-Encoding"}
        if "gzip" in request.headers.get("accept-encoding", ""):
            return Response(gz, media_type="application/json", headers=h | {"Content-Encoding": "gzip"})
        return Response(body, media_type="application/json", headers=h)

    @get(BASE + "/api/dataset")
    def dataset(request: Request):
        return dataset_response(request, admin=False)

    @get(BASE + "/api/health")
    def health():
        with db.read() as conn:
            n = conn.execute("SELECT count(*) FROM species").fetchone()[0]
        return {"ok": True, "species": n, "version": __version__}

    # -------------------------------------------------------------- admin API
    async def body(request: Request) -> dict:
        raw = await request.body()
        if len(raw) > 8 * 1024 * 1024:
            raise Invalid("Too much data in one go")
        try:
            data = json.loads(raw or b"{}")
        except ValueError:
            raise Invalid("Send JSON") from None
        if not isinstance(data, dict):
            raise Invalid("Send a JSON object")
        return data

    def write_now(fn):
        """Run fn(conn, batch) in one transaction; Invalid -> 400 with the message."""
        try:
            batch = services.new_batch()
            with db.write() as conn:
                result = fn(conn, batch)
            return JSONResponse({"ok": True, "batch": batch, **(result or {})})
        except Invalid as exc:
            return JSONResponse({"ok": False, "error": str(exc)}, 400)

    async def write(fn):
        """Database work happens in a worker thread, so a save waiting for SQLite never stalls other requests."""
        return await run_in_threadpool(write_now, fn)

    def variant_entries(conn, vids):
        rows = conn.execute(f"SELECT id FROM entries WHERE variant_id IN ({','.join('?' * len(vids))})", vids)
        return [services.get_entry(conn, r[0]) for r in rows]

    @get(BASE + "/api/admin/dataset")
    def admin_dataset(request: Request):
        return dataset_response(request, admin=True)

    @app.post(BASE + "/api/admin/quick")
    async def quick(request: Request):
        data = await body(request)
        vid = str(data.pop("variant_id", ""))
        return await write(lambda conn, batch: (services.quick(conn, batch, vid, data),
                                          {"entries": variant_entries(conn, [vid])})[1])

    @app.post(BASE + "/api/admin/entries")
    async def entry_create(request: Request):
        data = await body(request)
        return await write(lambda conn, batch: {"entry": services.save_entry(conn, batch, data)})

    @app.post(BASE + "/api/admin/entries/{entry_id}")
    async def entry_update(request: Request, entry_id: int):
        data = await body(request)
        return await write(lambda conn, batch: {"entry": services.save_entry(conn, batch, data, entry_id)})

    @app.post(BASE + "/api/admin/entries/{entry_id}/delete")
    async def entry_delete(entry_id: int):
        return await write(lambda conn, batch: services.delete_entry(conn, batch, entry_id))

    @app.post(BASE + "/api/admin/bulk")
    async def bulk(request: Request):
        data = await body(request)
        ids = data.get("variant_ids")
        if not isinstance(ids, list):
            return JSONResponse({"ok": False, "error": "variant_ids must be a list"}, 400)
        return await write(lambda conn, batch: {"changed": services.bulk(conn, batch, [str(i) for i in ids],
                                                                   str(data.get("action")))})

    @app.post(BASE + "/api/admin/variants/target")
    async def variant_target(request: Request):
        data = await body(request)
        return await write(lambda conn, batch: services.set_target(conn, batch, str(data.get("variant_id")),
                                                             data.get("target")))

    @app.post(BASE + "/api/admin/wishes")
    async def wish_create(request: Request):
        data = await body(request)
        return await write(lambda conn, batch: {"wish": services.save_wish(conn, batch, data)})

    @app.post(BASE + "/api/admin/wishes/{wish_id}")
    async def wish_update(request: Request, wish_id: int):
        data = await body(request)
        return await write(lambda conn, batch: {"wish": services.save_wish(conn, batch, data, wish_id)})

    @app.post(BASE + "/api/admin/wishes/{wish_id}/delete")
    async def wish_delete(wish_id: int):
        return await write(lambda conn, batch: services.delete_wish(conn, batch, wish_id))

    @app.post(BASE + "/api/admin/backgrounds")
    async def background_save(request: Request):
        data = await body(request)
        return await write(lambda conn, batch: {"background": services.save_background(
            conn, batch, data.get("name", ""), data.get("kind", "location"), data.get("id"))})

    @app.post(BASE + "/api/admin/settings")
    async def settings_save(request: Request):
        data = await body(request)
        return await write(lambda conn, batch: {"settings": services.save_settings(conn, batch, data)})

    @app.post(BASE + "/api/admin/undo")
    async def undo(request: Request):
        data = await body(request)
        return await write(lambda conn, batch: {"undone": services.undo(conn, data.get("batch"))})

    @get(BASE + "/api/admin/history")
    def history():
        with db.read() as conn:
            return {"history": services.history(conn, 100)}

    @get(BASE + "/api/admin/export.json")
    def export_json():
        with db.read() as conn:
            data = services.export(conn)
        return Response(json.dumps(data, ensure_ascii=False, indent=1), media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="pokedex-collection.json"'})

    @get(BASE + "/api/admin/export/{what}.csv")
    def export_csv(what: str):
        import csv
        import io
        if what not in ("entries", "wishes"):
            return PlainTextResponse("Not found", 404)
        with db.read() as conn:
            data = services.export(conn)[what]
        out = io.StringIO()
        cols = sorted({k for row in data for k in row}) if data else ["empty"]
        w = csv.DictWriter(out, fieldnames=cols)
        w.writeheader()
        def cell(v):
            v = ";".join(v) if isinstance(v, list) else v
            # A note starting with = + - @ would run as a formula in Excel or Sheets.
            return "'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r") else v
        for row in data:
            w.writerow({k: cell(v) for k, v in row.items()})
        return Response(out.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="pokedex-{what}.csv"'})

    def run_import(data: dict):
        dry = bool(data.get("dry_run"))
        try:
            if not dry:
                db.backup(cfg.data_dir / "backups" / f"before-import-{services.new_batch()}.sqlite3")
            batch = services.new_batch()
            conn = db.connect()
            try:
                conn.execute("BEGIN IMMEDIATE")
                report = services.import_collection(conn, batch, data.get("data"), str(data.get("mode", "merge")))
                if dry:
                    conn.execute("ROLLBACK")
                else:
                    conn.execute("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'data_version'")
                    conn.execute("COMMIT")
            except BaseException:
                if conn.in_transaction:
                    conn.execute("ROLLBACK")
                raise
            finally:
                conn.close()
            return JSONResponse({"ok": True, "dry_run": dry, "batch": batch, "report": report})
        except Invalid as exc:
            return JSONResponse({"ok": False, "error": str(exc)}, 400)

    @app.post(BASE + "/api/admin/import")
    async def import_(request: Request):
        data = await body(request)
        return await run_in_threadpool(run_import, data)

    # -------------------------------------------------------------- static + SPA
    # Pages load everything from /static/v/<version>/..., so module imports carry the version too and can be cached
    # for good (proxies such as Cloudflare otherwise stretch "no-cache" scripts to hours and serve stale modules).
    @get(BASE + "/static/v/{ver}/{rest:path}")
    def versioned_static(ver: str, rest: str):
        path = (STATIC / rest).resolve()
        if STATIC not in path.parents or not path.is_file():
            return PlainTextResponse("Not found", 404)
        cache = "public, max-age=31536000, immutable" if ver == static_version else "no-cache"
        return FileResponse(path, headers={"Cache-Control": cache})

    app.mount(BASE + "/static", StaticFiles(directory=STATIC), name="static")
    cfg.sprites_dir.mkdir(parents=True, exist_ok=True)
    app.mount(BASE + "/media/sprites", StaticFiles(directory=cfg.sprites_dir), name="sprites")

    @get(BASE + "/{rest:path}")
    def public_page(request: Request, rest: str):
        if not PAGE_RE.fullmatch("/" + rest):
            return PlainTextResponse("Not found", 404)
        return page(request, admin=False)

    return app


def describe_query(query: str) -> str:
    """'shiny&missing' or 'q=1-151, shiny' -> 'shiny, missing' / '1-151, shiny' (for page titles)."""
    from urllib.parse import parse_qsl
    parts = []
    for k, v in parse_qsl(query, keep_blank_values=True):
        if k == "q":
            parts.append(v)
        elif k not in ("mode", "group", "sort", "f"):
            parts.append(f"{k}:{v}" if v else k)
    return ", ".join(p.strip() for p in parts if p.strip())[:80]


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _static_version() -> str:
    import hashlib
    h = hashlib.sha256()
    for p in sorted(STATIC.rglob("*")):
        if p.is_file():
            h.update(p.read_bytes())
    return h.hexdigest()[:10]


def _login_html(base: str, error: str, v: str, nxt: str = "/admin") -> str:
    msg = {"wrong": "That password didn't work.", "wait": "Too many tries. Wait a few minutes."}.get(error, "")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title>
<link rel="stylesheet" href="{base}/static/v/{v}/app.css"></head>
<body class="login"><form method="post" action="{base}/login" class="login-card">
<h1>Edit your Pokédex</h1>{f'<p class="err">{msg}</p>' if msg else ''}
<label>Password <input type="password" name="password" autocomplete="current-password" required autofocus></label>
<input type="hidden" name="next" value="{nxt}"><button class="btn primary" type="submit">Sign in</button>
<a href="{base}/">Back to the Pokédex</a></form></body></html>"""
