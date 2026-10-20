"""Command line: python -m godex.cli <command>

  init                      create the database and load data/catalog.json
  catalog-load [PATH]       (re)load the catalog (default: the newest one); your collection is never touched
  catalog-update            download the sources, rebuild the catalog, check it, save it in var/ and load it
                            (needs internet; run weekly by the catalog timer, see docs/DEPLOY.md)
  set-password              set the admin password for DEX_AUTH=password (stored hashed in var/admin.json)
  hash-password             print a hash for DEX_ADMIN_PASSWORD_HASH instead
  backup [--keep N]         online backup into var/backups (integrity-checked), keep the newest N (default 30)
  export [FILE]             write your collection as JSON (stdout if no FILE)
  import FILE [--replace]   merge (default) or replace from an export; a backup is taken first
  stats                     counts, to check things are where you expect
  sprites                   how many forms have an image in the sprites folder
"""
import argparse
import datetime as dt
import getpass
import json
import os
import pathlib
import sys

from . import auth, catalog, config, services
from .db import Database
from .sprites import SpriteIndex


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m godex.cli", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    p = sub.add_parser("catalog-load")
    p.add_argument("path", nargs="?")
    sub.add_parser("catalog-update")
    sub.add_parser("set-password")
    sub.add_parser("hash-password")
    p = sub.add_parser("backup")
    p.add_argument("--keep", type=int, default=30)
    p = sub.add_parser("export")
    p.add_argument("file", nargs="?")
    p = sub.add_parser("import")
    p.add_argument("file")
    p.add_argument("--replace", action="store_true")
    sub.add_parser("stats")
    sub.add_parser("sprites")
    args = ap.parse_args(argv)
    cfg = config.load()

    if args.cmd == "hash-password":
        print(auth.hash_password(getpass.getpass("Admin password: ")))
        return
    if args.cmd == "set-password":
        pw = getpass.getpass("New admin password: ")
        if pw != getpass.getpass("Again: "):
            sys.exit("The two passwords don't match")
        cfg.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = cfg.data_dir / "admin.json"
        fd = os.open(path.with_suffix(".tmp"), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump({"password_hash": auth.hash_password(pw)}, f)
        os.replace(path.with_suffix(".tmp"), path)
        print(f"Saved to {path}")
        return

    db = Database(cfg.db_path)
    if args.cmd in ("init", "catalog-load"):
        path = pathlib.Path(getattr(args, "path", None) or cfg.current_catalog())
        print(json.dumps(catalog.load(db, path)))
    elif args.cmd == "catalog-update":
        sys.exit(catalog_update(cfg, db))
    elif args.cmd == "backup":
        dest = cfg.data_dir / "backups" / f"dex-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}.sqlite3"
        db.backup(dest)
        old = sorted((cfg.data_dir / "backups").glob("dex-*.sqlite3"))[:-args.keep] if args.keep > 0 else []
        for p in old:
            p.unlink()
        print(f"backup ok: {dest} ({dest.stat().st_size // 1024} KB), removed {len(old)} old")
    elif args.cmd == "export":
        with db.read() as conn:
            text = json.dumps(services.export(conn), ensure_ascii=False, indent=1)
        if args.file:
            pathlib.Path(args.file).write_text(text, encoding="utf-8")
        else:
            print(text)
    elif args.cmd == "import":
        data = json.loads(pathlib.Path(args.file).read_text(encoding="utf-8"))
        db.backup(cfg.data_dir / "backups" / f"before-import-{services.new_batch()}.sqlite3")
        with db.write() as conn:
            report = services.import_collection(conn, services.new_batch(), data,
                                                "replace" if args.replace else "merge")
        print(json.dumps(report, indent=1))
    elif args.cmd == "stats":
        with db.read() as conn:
            q = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
            print(json.dumps({
                "species": q("SELECT count(*) FROM species"), "forms": q("SELECT count(*) FROM forms"),
                "variants": q("SELECT count(*) FROM variants"),
                "target_variants": q("SELECT count(*) FROM variants WHERE coalesce(target_override, catalog_target) = 1"),
                "entries": q("SELECT count(*) FROM entries"), "owned": q("SELECT coalesce(sum(owned), 0) FROM entries"),
                "for_trade": q("SELECT coalesce(sum(for_trade), 0) FROM entries"),
                "wishes_open": q("SELECT count(*) FROM wishes WHERE status = 'open'"),
                "backgrounds": q("SELECT count(*) FROM backgrounds"),
            }, indent=1))
    elif args.cmd == "sprites":
        idx = SpriteIndex(cfg.sprites_dir)
        idx.refresh()
        with db.read() as conn:
            forms = conn.execute("SELECT * FROM forms").fetchall()
            base = {r[0]: r[1] for r in conn.execute("SELECT dex, image FROM forms WHERE kind = 'base' OR sort = 0 "
                                                      "ORDER BY sort DESC")}
        have = sum(1 for f in forms if idx.for_form(f, base.get(f["dex"]))[0])
        print(f"{idx.count} image files in {cfg.sprites_dir}; {have} of {len(forms)} forms have an image")


def catalog_update(cfg, db) -> int:
    """Rebuild from fresh downloads. Nothing changes unless the new catalog passes the checks."""
    from . import catalog_build
    current = json.loads(cfg.current_catalog().read_text(encoding="utf-8"))
    try:
        new = catalog_build.build_from(cfg.data_dir / "cache" / "sources", refresh=True)
    except Exception as exc:  # network, a source changed shape ...: keep what we have
        print(f"catalog update failed, nothing changed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    problems = catalog_problems(current, new)
    if problems:
        print("catalog update rejected, nothing changed:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    tmp = cfg.auto_catalog_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(new, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, cfg.auto_catalog_path)
    result = catalog.load(db, cfg.auto_catalog_path)
    print(json.dumps({"built_at": new["built_at"], **result}))
    return 0


def catalog_problems(current: dict, new: dict) -> list[str]:
    """Sanity checks: a source that broke or changed shape must not shrink the Pokédex."""
    n = lambda c, k: len(c.get(k) or [])  # noqa: E731
    problems = []
    if n(new, "species") < n(current, "species"):
        problems.append(f"fewer species ({n(new, 'species')} < {n(current, 'species')})")
    if n(new, "forms") < 0.97 * n(current, "forms"):
        problems.append(f"far fewer forms ({n(new, 'forms')} vs {n(current, 'forms')})")
    if n(new, "backgrounds") < 0.9 * n(current, "backgrounds"):
        problems.append(f"far fewer backgrounds ({n(new, 'backgrounds')} vs {n(current, 'backgrounds')})")
    shiny = lambda c: sum(1 for s in c.get("species", []) if s.get("shiny"))  # noqa: E731
    if shiny(new) < 0.95 * shiny(current):
        problems.append(f"far fewer shiny species ({shiny(new)} vs {shiny(current)})")
    return problems


if __name__ == "__main__":
    main()
