# Your Pokémon images go here

Pokémon images are © Nintendo / Creatures / GAME FREAK / Niantic and are not part of this project. This folder
is ignored by git (only this file is committed). Use images you are allowed to use, for your own site.

## Easiest: a Pokémon GO icon dump

Copy the files into this folder as they are. godex looks for the standard Pokémon GO icon names:

| File | Is |
|---|---|
| `pm25.icon.png` | Pikachu |
| `pm25.s.icon.png` | shiny Pikachu |
| `pm25.fVS_2019.icon.png` / `pm25.fVS_2019.s.icon.png` | a form or costume (Libre) |
| `pm6.fMEGA_X.icon.png` | Mega Charizard X |
| `pm6.fGIGANTAMAX.icon.png` | Gigantamax Charizard |

The PokeMiners `pogo_assets` repository ("Images/Pokemon - 256x256/Addressable Assets") uses these names.
Or run `python tools/fetch_sprites.py` to download the icons the catalog names from a public mirror
(about 2,900 files, 80 MB).

## Your own picture for one form

Put it in `custom/`, named by the form id (shown in the admin page and in `data/catalog.json`):

```
custom/PIKACHU_GOFEST_2026_CAP_RED.png       normal
custom/PIKACHU_GOFEST_2026_CAP_RED.s.png     shiny
custom/CHARIZARD.gmax.png                    Gigantamax (and .gmax.s.png)
```

## Anything numbered by Pokédex

`fallback/25.png` and `fallback/shiny/25.png` are used when nothing more specific exists, so a flat
numbered sprite set works too.

`.png` and `.webp` both work. Changes are picked up without a restart. Anything missing is drawn as a numbered
placeholder. `python -m godex.cli sprites` tells you how many forms have an image.
