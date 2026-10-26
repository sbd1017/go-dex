"""Build the catalog: the Pokémon GO reference data the collection is recorded against.

Sources (downloaded into .cache/sources, or read from --sources DIR):
  * PokeMiners game master  - every GO form, families, shadow data, location/special backgrounds
  * pokemon-go-api pokedex  - names, generations, legendary/mythical/ultra beast class, Megas, Gigantamax,
                              GO icon file names, older costumes
  * Leek Duck shiny list    - every released shiny, per form and costume (matched by GO icon file name)
  * pogoapi.net             - which species are released

The catalog holds facts only (names, numbers, types, flags). No images are downloaded or stored here.
Local corrections live in data/overrides.json and are applied last.

    python tools/build_catalog.py            # download (or reuse cached) sources, write data/catalog.json
    python tools/build_catalog.py --refresh  # force a fresh download
    python -m godex.cli catalog-update       # the same on a server, checked and loaded (see docs/DEPLOY.md)
"""
import argparse
import datetime as dt
import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCES = {
    "gm.json": "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json",
    "pokedex.json": "https://pokemon-go-api.github.io/pokemon-go-api/api/pokedex.json",
    "released_pokemon.json": "https://pogoapi.net/api/v1/released_pokemon.json",
    "leekduck_shiny.json": "https://leekduck.com/shiny/pms.json",
}
USER_AGENT = "godex-catalog-builder/1.0 (self-hosted Pokemon GO collection tracker; weekly)"   # ASCII only
MONTHS = {"JAN": "January", "FEB": "February", "MAR": "March", "APR": "April", "JUN": "June", "JUL": "July",
          "AUG": "August", "SEP": "September", "OCT": "October", "NOV": "November", "DEC": "December"}
REGIONS = {1: "kanto", 2: "johto", 3: "hoenn", 4: "sinnoh", 5: "unova", 6: "kalos", 7: "alola", 8: "galar", 9: "paldea"}
REGIONAL_FORMS = {"ALOLA": "alolan", "GALARIAN": "galarian", "HISUIAN": "hisuian", "PALDEA": "paldean"}
CLASSES = {"POKEMON_CLASS_LEGENDARY": "legendary", "POKEMON_CLASS_MYTHIC": "mythical",
           "POKEMON_CLASS_ULTRA_BEAST": "ultra_beast"}


def fetch(dirpath: pathlib.Path, refresh: bool) -> dict:
    dirpath.mkdir(parents=True, exist_ok=True)
    out = {}
    for name, url in SOURCES.items():
        path = dirpath / name
        if refresh or not path.exists():
            print(f"downloading {url}", file=sys.stderr)
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as r:
                path.write_bytes(r.read())
        out[name] = json.loads(path.read_text(encoding="utf-8"))
    return out


def ptype(t):
    return t["type"].removeprefix("POKEMON_TYPE_").lower() if t else None


def titleize(code: str, tokens: dict) -> str:
    """'GOFEST_2024_MTIARA' -> 'GO Fest 2024 Mtiara'. Known tokens keep their spelling; short codes stay upper."""
    found = []
    for k, v in sorted(tokens.items(), key=lambda kv: -len(kv[0])):
        def keep(_m, v=v):
            found.append(v)
            return f"\x01{len(found) - 1}\x01"
        code = re.sub(rf"(?<![A-Z0-9]){re.escape(k)}(?![A-Z0-9])", keep, code)
    out = []
    for w in (w for w in code.split("_") if w):
        if m := re.fullmatch(r"\x01(\d+)\x01", w):
            out.append(found[int(m[1])])
        elif w.isdigit() or (len(w) <= 2 and w.isalpha()):
            out.append(w)
        else:
            out.append(re.sub(r"\x01(\d+)\x01", lambda m: found[int(m[1])], w).capitalize())
    return " ".join(out).strip()


def strip_species(english: str, species_name: str) -> str:
    """'Giratina (Origin Forme)' -> 'Origin Forme'; 'Alolan Rattata' -> 'Alolan'."""
    s = english.replace(species_name, "").replace("(", "").replace(")", "")
    return re.sub(r"\s+", " ", s).strip(" -")


def background_name(code: str, ov: dict) -> tuple[str, str, int | None]:
    if code in ov["background_names"]:
        name = ov["background_names"][code]
    else:
        body = re.sub(r"^LC_(SPECIAL_?BACKGROUND_)?", "", code)
        body = re.sub(r"_0*(\d+)$", lambda m: f" #{int(m[1])}" if int(m[1]) > 1 else "", body)
        name = titleize(body, ov["background_tokens"])
        name = re.sub(r"^(\d{4}) (.*)$", r"\2 \1", name)          # "2024 Madrid GO Fest" -> "Madrid GO Fest 2024"
    kind = "special" if "SPECIAL" in code else "location"
    year = re.search(r"20\d\d", code)
    return name, kind, int(year[0]) if year else None


def build(src: dict, ov: dict) -> dict:
    gm, pokedex = src["gm.json"], src["pokedex.json"]
    shiny_list = [x for x in src["leekduck_shiny.json"] if isinstance(x, dict) and x.get("aa_fn")]
    shiny_names = {x["aa_fn"] for x in shiny_list}               # GO icon names of every released shiny
    shiny_dex = {int(x["dex"]) for x in shiny_list}
    released = {int(k) for k in src["released_pokemon.json"]} | shiny_dex

    settings, form_lists, backgrounds = {}, {}, []
    for t in gm:
        tid, data = t["templateId"], t["data"]
        if m := re.fullmatch(r"V(\d{4})_POKEMON_.+", tid):
            ps = data.get("pokemonSettings")
            if ps:
                settings[(ps["pokemonId"], ps.get("form"))] = ps | {"_dex": int(m[1])}
        elif tid.startswith("FORMS_V"):
            fs = data["formSettings"]
            form_lists[fs["pokemon"]] = fs.get("forms") or []
        elif tid.startswith("LC_") and "locationCardSettings" in data:
            name, kind, year = background_name(tid, ov)
            backgrounds.append({"id": tid, "name": name, "kind": kind, "year": year,
                                "image": data["locationCardSettings"].get("imageUrl") or None})

    api = {p["dexNr"]: p for p in pokedex}
    # A species the game master has but pokemon-go-api is missing (it happens with new releases): build it from the
    # game master, pogoapi's names and data/overrides.json "missing_species", so the Pokédex never skips a number.
    names = {int(k): v.get("name") for k, v in src["released_pokemon.json"].items()}
    gm_species = {}
    for (code, form), ps in settings.items():
        if form is None or ps["_dex"] not in gm_species:
            gm_species[ps["_dex"]] = (code, ps)
    for t in gm:
        if m := re.fullmatch(r"FORMS_V(\d{4})_POKEMON_(.+)", t["templateId"]):
            gm_species.setdefault(int(m[1]), (t["data"]["formSettings"]["pokemon"], {}))
    for dex, (code, ps) in sorted(gm_species.items()):
        if dex in api:
            continue
        extra = ov.get("missing_species", {}).get(str(dex), {})
        types = extra.get("types") or [x.removeprefix("POKEMON_TYPE_").lower() for x in (ps.get("type"), ps.get("type2")) if x]
        if not types:
            print(f"warning: #{dex} {code} has no types anywhere; add it to data/overrides.json missing_species. Skipped.",
                  file=sys.stderr)
            continue
        gen = extra.get("gen") or next(g for g, hi in ((1, 151), (2, 251), (3, 386), (4, 493), (5, 649), (6, 721), (7, 809),
                                                       (8, 905), (9, 9999)) if dex <= hi)
        api[dex] = {"id": code, "dexNr": dex, "generation": gen,
                    "names": {"English": extra.get("name") or names.get(dex) or titleize(code, {})},
                    "primaryType": {"type": "POKEMON_TYPE_" + types[0].upper()},
                    "secondaryType": {"type": "POKEMON_TYPE_" + types[1].upper()} if len(types) > 1 else None,
                    "pokemonClass": None, "assetForms": [], "regionForms": {}, "megaEvolutions": {},
                    "hasGigantamaxEvolution": False}
        print(f"note: #{dex} {api[dex]['names']['English']} added from the game master / overrides", file=sys.stderr)
    gaps = sorted(set(range(1, max(api) + 1)) - set(api))
    if gaps:
        print(f"warning: no data for Pokédex numbers {gaps}", file=sys.stderr)
    regional = set(ov.get("regional_species", []))
    species, forms = [], []
    asset_misses = 0
    unmatched_shiny = []
    for dex in sorted(api):
        p = api[dex]
        code, name = p["id"], p["names"]["English"]
        base_ps = settings.get((code, None), {})
        sp = {
            "dex": dex, "code": code, "name": name, "gen": p["generation"],
            "region": "hisui" if 899 <= dex <= 905 else REGIONS.get(p["generation"], ""),
            "family": (base_ps.get("familyId") or "").removeprefix("FAMILY_") or code,
            "class": CLASSES.get(p.get("pokemonClass"), ""),
            "types": [t for t in (ptype(p["primaryType"]), ptype(p["secondaryType"])) if t],
            "gender_diff": any(a.get("isFemale") for a in p.get("assetForms") or []),
            "released": dex in released, "shiny": dex in shiny_dex,
            "shadow": bool(base_ps.get("shadow")), "gmax": bool(p.get("hasGigantamaxEvolution")),
            "dynamax": False,
            "sizes": True,                               # XXS / XXL records (overrides turn it off, e.g. Mew)
            "lucky": bool(base_ps.get("isTradable")) if base_ps else True,  # only tradable ones can be lucky
            "regional": dex in regional,                     # regional exclusive (list in overrides)
        }
        sp.update(ov["species"].get(str(dex), {}))
        species.append(sp)

        assets = {}
        for a in p.get("assetForms") or []:
            if a.get("isFemale"):
                continue
            key = a.get("form") or (f"c:{a['costume']}" if a.get("costume") else "")
            assets.setdefault(key, a["image"].rsplit("/", 1)[1].removesuffix(".icon.png"))
        base_img = assets.get("", f"pm{dex}")
        is_shiny = lambda *names: any(n in shiny_names for n in names if n)  # noqa: E731
        species_forms_start = len(forms)
        region_names = {k: v["names"]["English"] for k, v in (p.get("regionForms") or {}).items()}
        region_types = {k: [t for t in (ptype(v["primaryType"]), ptype(v.get("secondaryType"))) if t]
                        for k, v in (p.get("regionForms") or {}).items()}

        gm_forms = [f["form"] for f in form_lists.get(code, []) if f.get("form")]
        costume_flags = {f["form"]: bool(f.get("isCostume")) for f in form_lists.get(code, []) if f.get("form")}
        if not gm_forms:
            gm_forms = [f"{code}_NORMAL"]
        sort = 0
        for fid in gm_forms:
            suffix = fid[len(code) + 1:] if fid.startswith(code + "_") else fid.split("_", 1)[-1]
            is_base = suffix == "NORMAL" or (fid == f"{code}_NORMAL")
            if code == "NIDORAN_FEMALE" or code == "NIDORAN_MALE":
                is_base = is_base or fid.endswith("_NORMAL")
            form_id = code if is_base else fid
            region_tag = next((tag for k, tag in REGIONAL_FORMS.items() if suffix.startswith(k)), "")
            if is_base:
                kind = "base"
            elif costume_flags.get(fid):
                kind = "costume"
            elif suffix == "COPY_2019":
                kind = "event"
            elif region_tag:
                kind = "regional"
            else:
                kind = "alternate"
            if is_base:
                fname = ""
            elif fid in ov["form_names"]:
                fname = ov["form_names"][fid]
            elif fid in region_names and kind in ("regional", "alternate"):
                fname = strip_species(region_names[fid], name) or titleize(suffix, ov["form_name_tokens"])
            else:
                fname = titleize(suffix, ov["form_name_tokens"])
            fps = settings.get((code, fid), {})
            types = region_types.get(fid) or [t for t in (ptype({"type": fps["type"]}) if fps.get("type") else None,
                                                          ptype({"type": fps["type2"]}) if fps.get("type2") else None) if t]
            image = None if not is_base else base_img
            if not is_base:
                image = assets.get(suffix) or assets.get(fid)
                if not image:                                  # new forms: GO's own naming pattern
                    image = f"pm{dex}.f{suffix}"
                    asset_misses += 1
            targeted = not (fid in ov["untargeted_forms"] or any(fid.endswith(s) for s in ov["untargeted_form_suffixes"]))
            form = {
                "id": form_id, "dex": dex, "code": "" if is_base else suffix, "name": fname, "kind": kind,
                "region_tag": region_tag, "types": types or sp["types"], "sort": sort, "image": image,
                "released": sp["released"] and targeted,
                "shiny": is_shiny(image, f"pm{dex}" if is_base else None, f"pm{dex}.f{suffix}"),
                "shadow": kind in ("base", "regional", "alternate") and bool(fps.get("shadow") or (is_base and sp["shadow"])),
            }
            form.update(ov["forms"].get(form_id, {}))
            forms.append(form)
            sort += 1

        for mid, mega in (p.get("megaEvolutions") or {}).items():
            suffix = mid[len(code) + 1:] if mid.startswith(code + "_") else mid
            forms.append({
                "id": mid, "dex": dex, "code": suffix, "name": strip_species(mega["names"]["English"], name) or "Mega",
                "kind": "mega", "region_tag": "",
                "types": [t for t in (ptype(mega["primaryType"]), ptype(mega.get("secondaryType"))) if t],
                "sort": 900 + sort, "image": assets.get(suffix) or f"pm{dex}.f{suffix}", "released": sp["released"],
                "shiny": sp["shiny"] or is_shiny(assets.get(suffix), f"pm{dex}.f{suffix}"), "shadow": False,
            } | ov["forms"].get(mid, {}))
            sort += 1
        # Older costumes are a separate "costume" in the game data rather than a form, so the game master's form
        # list misses them; pokemon-go-api's icons and Leek Duck's shiny list have them (pm1.cJAN_2020_NOEVOLVE).
        # The game keeps a "can't evolve" twin of most costumes (..._NOEVOLVE) and one source has a few in lower case;
        # for collecting they are the same costume, so they are merged (shiny if either is).
        by_code = {f["code"].upper(): f for f in forms[species_forms_start:] if f["code"]}
        costume_codes = {k[2:]: v for k, v in assets.items() if k.startswith("c:")}
        for name in shiny_names:
            if m := re.fullmatch(rf"pm{dex}\.c(.+)", name):
                costume_codes.setdefault(m[1], name)
        for ccode, img in sorted(costume_codes.items(), key=lambda kv: (len(kv[0]), kv[0])):
            ccode_n = re.sub(r"_?NOEVOLVE$", "", ccode.upper())
            if ccode_n in by_code:
                by_code[ccode_n]["shiny"] = by_code[ccode_n]["shiny"] or is_shiny(img)
                continue
            ccode = ccode_n
            fid = f"{code}_{ccode}"
            label = ov["form_names"].get(fid) or titleize(re.sub(r"_?NOEVOLVE$", "", ccode), ov["form_name_tokens"] | MONTHS)
            forms.append({
                "id": fid, "dex": dex, "code": ccode, "name": label, "kind": "costume", "region_tag": "",
                "types": sp["types"], "sort": 500 + sort, "image": img, "released": sp["released"],
                "shiny": is_shiny(img), "shadow": False,
            } | ov["forms"].get(fid, {}))
            by_code[ccode] = forms[-1]
            sort += 1
        # Forms newer than the game-data mirrors, which can lag by months. data/overrides.json "new_forms" names them
        # by GO icon (pm4.fGOGGLES_2026); a form on Leek Duck's shiny list is marked shiny.
        for icon, extra in ov.get("new_forms", {}).items():
            m = re.fullmatch(rf"pm{dex}\.f(.+)", icon)
            if not m or m[1].upper() in by_code:
                continue
            fcode = m[1].upper()
            fid = f"{code}_{fcode}"
            forms.append({
                "id": fid, "dex": dex, "code": fcode, "name": titleize(fcode, ov["form_name_tokens"] | MONTHS),
                "kind": "costume", "region_tag": "", "types": sp["types"], "sort": 500 + sort, "image": icon,
                "released": sp["released"], "shiny": is_shiny(icon), "shadow": False,
            } | extra | ov["forms"].get(fid, {}))
            by_code[fcode] = forms[-1]
            sort += 1
        mine = forms[species_forms_start:]
        seen_names = {}
        for f in mine:                                 # two different forms must not look the same in a list
            if f["name"] and f["name"] in seen_names:
                f["name"] = f"{f['name']} ({titleize(f['code'], ov['form_name_tokens'])})"
            seen_names[f["name"]] = f
        if sp["gmax"]:
            # Gigantamax is recorded as a variant of the base form, with its own icon.
            first = mine[0]
            first["gmax_image"] = assets.get("GIGANTAMAX") or f"pm{dex}.fGIGANTAMAX"
            first["gmax_shiny"] = is_shiny(first["gmax_image"], f"pm{dex}.fGIGANTAMAX")
        # Leek Duck lists this species' shiny but no form name matched: count the first form, rather than none.
        if dex in shiny_dex and not any(f["shiny"] for f in mine if f["kind"] != "mega"):
            mine[0]["shiny"] = True
            unmatched_shiny.append(dex)
        sp["shiny"] = any(f["shiny"] for f in mine)
        for f in mine:                                 # a shiny Mega exists whenever the species has a shiny
            if f["kind"] == "mega" and sp["shiny"]:
                f["shiny"] = True
        sp.update({k: v for k, v in ov["species"].get(str(dex), {}).items() if k == "shiny"})

    return {
        "format": "godex-catalog", "version": 1,
        "built_at": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat(),
        "sources": dict(SOURCES),
        "species": species, "forms": forms,
        "backgrounds": sorted(backgrounds, key=lambda b: (b["kind"], -(b["year"] or 0), b["name"])),
        "_stats": {"species": len(species), "forms": len(forms), "backgrounds": len(backgrounds),
                   "forms_without_icon_name": asset_misses,
                   "shiny_species": sum(1 for x in species if x["shiny"]),
                   "shiny_forms": sum(1 for f in forms if f["shiny"]),
                   "shiny_matched_by_species_only": unmatched_shiny},
    }


def build_from(sources: pathlib.Path, refresh: bool) -> dict:
    ov = json.loads((ROOT / "data" / "overrides.json").read_text(encoding="utf-8"))
    return build(fetch(sources, refresh), ov)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sources", type=pathlib.Path, default=ROOT / ".cache" / "sources")
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--out", type=pathlib.Path, default=ROOT / "data" / "catalog.json")
    args = ap.parse_args()
    cat = build_from(args.sources, args.refresh)
    args.out.write_text(json.dumps(cat, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(cat["_stats"]), file=sys.stderr)


if __name__ == "__main__":
    main()
