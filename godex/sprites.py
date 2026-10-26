"""Find the image file for each form, if you have one. Images are never shipped with the project.

Looked up in DEX_SPRITES_DIR (default media/sprites), first match wins:
  1. custom/<FORM_ID>.png         custom/<FORM_ID>.s.png        your own images for a form (shiny: .s)
     custom/<FORM_ID>.gmax.png    custom/<FORM_ID>.gmax.s.png
  2. <icon>.icon.png  <icon>.s.icon.png                         Pokémon GO icon names, as in the PokeMiners
                                                                 pogo_assets / pokemon-go-api assets dumps
  3. the species' base icon (same naming)
  4. fallback/<dex>.png  fallback/shiny/<dex>.png               any flat dump numbered by National Dex
.png and .webp both work. Anything missing is drawn as a placeholder by the browser.
Backgrounds: backgrounds/<LC_ID> (your own picture for one) or backgrounds/<artwork name> (lc_GoTour2023, as in
the game's LocationCards folder).
"""
import os
import pathlib

EXTS = (".png", ".webp")


class SpriteIndex:
    def __init__(self, root: pathlib.Path):
        self.root = root
        self._sig = None
        self._files: set[str] = set()

    def _signature(self):
        sig = []
        for sub in ("", "custom", "fallback", "fallback/shiny", "backgrounds"):
            try:
                sig.append(os.stat(self.root / sub).st_mtime_ns)
            except FileNotFoundError:
                sig.append(0)
        return tuple(sig)

    def refresh(self) -> tuple:
        sig = self._signature()
        if sig != self._sig:
            files = set()
            if self.root.is_dir():
                for dirpath, _dirs, names in os.walk(self.root):
                    rel = pathlib.Path(dirpath).relative_to(self.root).as_posix()
                    prefix = "" if rel == "." else rel + "/"
                    files.update(prefix + n for n in names if n.endswith(EXTS))
            self._files, self._sig = files, sig
        return self._sig

    def find(self, *stems: str) -> str | None:
        for stem in stems:
            if not stem:
                continue
            for ext in EXTS:
                if stem + ext in self._files:
                    return stem + ext
        return None

    def for_form(self, form, species_image: str | None) -> list:
        """[normal, shiny, gigantamax, gigantamax shiny] relative file names (or None)."""
        fid, dex, img, gimg = form["id"], form["dex"], form["image"], form["gmax_image"]
        base = species_image or f"pm{dex}"
        normal = self.find(f"custom/{fid}", img and f"{img}.icon", f"{base}.icon", f"fallback/{dex}")
        shiny = self.find(f"custom/{fid}.s", img and f"{img}.s.icon", f"{base}.s.icon", f"fallback/shiny/{dex}")
        gmax = gshiny = None
        if gimg:
            gmax = self.find(f"custom/{fid}.gmax", f"{gimg}.icon")
            gshiny = self.find(f"custom/{fid}.gmax.s", f"{gimg}.s.icon")
        return [normal, shiny, gmax, gshiny]

    def for_background(self, bg) -> str | None:
        return self.find(f"backgrounds/{bg['id']}", bg["image"] and f"backgrounds/{bg['image']}")

    @property
    def count(self) -> int:
        return len(self._files)
