#!/usr/bin/env python3
"""Optional: download Pokémon GO icons into media/sprites for your own copy of the site.

The images are © Nintendo / Creatures / GAME FREAK / Niantic. They are NOT part of this project and must not be
committed. This script fetches the icons named in data/catalog.json from a public asset mirror (default: the
pokemon-go-api/assets repository, which uses the same file names as the PokeMiners pogo_assets dump) for your
personal use. You can equally drop in any dump yourself: see media/sprites/README.md for the naming.

    python tools/fetch_sprites.py                 # everything the catalog names (normal + shiny), skips existing files
    python tools/fetch_sprites.py --no-shiny      # normal icons only
    python tools/fetch_sprites.py --limit 50      # try a few first
    python tools/fetch_sprites.py --backgrounds   # background artwork (location and special) into media/sprites/backgrounds
                                                  # (saved as .webp if Pillow is installed, else as the original .png)
"""
import argparse
import concurrent.futures as cf
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIRROR = "https://raw.githubusercontent.com/pokemon-go-api/assets/main/Pokemon/"
BG_MIRROR = "https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Images/LocationCards/"
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


BG_LISTING = "https://api.github.com/repos/PokeMiners/pogo_assets/contents/Images/LocationCards"


def backgrounds(catalog: dict) -> list[str]:
    return sorted({f"{b['image']}.png" for b in catalog["backgrounds"] if b.get("image")})


def remote_names(listing: str) -> dict[str, str]:
    """The game's artwork names and the dump's file names differ in case (lc_2026_br_001 / lc_2026_BR_001.png)."""
    req = urllib.request.Request(listing, headers={"User-Agent": "godex-sprite-fetch"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return {item["name"].lower(): item["name"] for item in json.load(r)}


def to_webp(path: pathlib.Path) -> None:
    """Background artwork is 512 px PNG (~400 KB); as WebP it is ~10x smaller. Optional: needs Pillow."""
    try:
        from PIL import Image
    except ImportError:
        return
    with Image.open(path) as im:
        im.save(path.with_suffix(".webp"), "WEBP", quality=80)
    path.unlink()


def fetch(name: str, dest: pathlib.Path, mirror: str, webp: bool = False, remote: str | None = None) -> str:
    out = dest / name
    if out.exists() or (webp and out.with_suffix(".webp").exists()):
        return "skip"
    req = urllib.request.Request(mirror + urllib.parse.quote(remote or name), headers={"User-Agent": "godex-sprite-fetch"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read(4 * 1024 * 1024 + 1)
            if not data.startswith(PNG) or len(data) > 4 * 1024 * 1024:
                return "bad"
            tmp = out.with_suffix(".part")
            tmp.write_bytes(data)
            tmp.replace(out)
            if webp:
                to_webp(out)
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
    ap.add_argument("--backgrounds", action="store_true", help="background artwork instead of Pokémon icons")
    args = ap.parse_args()
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    if args.backgrounds:
        args.dest = args.dest / "backgrounds"
        if args.mirror == MIRROR:
            args.mirror = BG_MIRROR
    names = backgrounds(catalog) if args.backgrounds else wanted(catalog, not args.no_shiny)
    remote = remote_names(BG_LISTING) if args.backgrounds and args.mirror == BG_MIRROR else {}
    if args.limit:
        names = names[:args.limit]
    args.dest.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    with cf.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 16))) as pool:
        for i, result in enumerate(pool.map(lambda n: fetch(n, args.dest, args.mirror, args.backgrounds, remote.get(n.lower())), names), 1):
            counts[result] = counts.get(result, 0) + 1
            if i % 250 == 0:
                print(f"{i}/{len(names)} {counts}", file=sys.stderr)
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
