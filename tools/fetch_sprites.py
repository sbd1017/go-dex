#!/usr/bin/env python3
"""Optional: download Pokémon GO icons into media/sprites for your own copy of the site.

The images are © Nintendo / Creatures / GAME FREAK / Niantic. They are NOT part of this project and must not be
committed. This script fetches the icons named in data/catalog.json from a public asset mirror (default: the
pokemon-go-api/assets repository, which uses the same file names as the PokeMiners pogo_assets dump) for your
personal use. You can equally drop in any dump yourself: see media/sprites/README.md for the naming.

    python tools/fetch_sprites.py                 # everything the catalog names (normal + shiny), skips existing files
    python tools/fetch_sprites.py --no-shiny      # normal icons only
    python tools/fetch_sprites.py --limit 50      # try a few first
"""
import argparse
import concurrent.futures as cf
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIRROR = "https://raw.githubusercontent.com/pokemon-go-api/assets/main/Pokemon/"
PNG = b"\x89PNG\r\n\x1a\n"


def wanted(catalog: dict, shiny: bool) -> list[str]:
    names = set()
    for f in catalog["forms"]:
        for base in (f.get("image"), f.get("gmax_image"), f"pm{f['dex']}"):
            if base:
                names.add(f"{base}.icon.png")
                if shiny:
                    names.add(f"{base}.s.icon.png")
    return sorted(names)


def fetch(name: str, dest: pathlib.Path, mirror: str) -> str:
    out = dest / name
    if out.exists():
        return "skip"
    req = urllib.request.Request(mirror + name, headers={"User-Agent": "godex-sprite-fetch"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read(4 * 1024 * 1024 + 1)
            if not data.startswith(PNG) or len(data) > 4 * 1024 * 1024:
                return "bad"
            tmp = out.with_suffix(".part")
            tmp.write_bytes(data)
            tmp.replace(out)
            return "ok"
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return "missing"
            time.sleep(1 + attempt * 2)
        except (urllib.error.URLError, TimeoutError):
            time.sleep(1 + attempt * 2)
    return "error"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dest", type=pathlib.Path, default=ROOT / "media" / "sprites")
    ap.add_argument("--catalog", type=pathlib.Path, default=ROOT / "data" / "catalog.json")
    ap.add_argument("--mirror", default=MIRROR)
    ap.add_argument("--no-shiny", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    names = wanted(json.loads(args.catalog.read_text(encoding="utf-8")), not args.no_shiny)
    if args.limit:
        names = names[:args.limit]
    args.dest.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    with cf.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 16))) as pool:
        for i, result in enumerate(pool.map(lambda n: fetch(n, args.dest, args.mirror), names), 1):
            counts[result] = counts.get(result, 0) + 1
            if i % 250 == 0:
                print(f"{i}/{len(names)} {counts}", file=sys.stderr)
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
