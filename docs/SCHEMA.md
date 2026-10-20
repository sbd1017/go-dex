# Data model

The aim is that nothing has to be rebuilt later when the collection gets more detailed. A single
`pokemon_id + owned` flag cannot say "shiny costume Pikachu", "XXL with the Madrid background", or "three of these
for trade", so the model separates what exists in the game from what you have.

## Two layers

**Catalog** (reloaded from `data/catalog.json`, never edited by hand in the database)

| Table | One row is | Key |
|---|---|---|
| `species` | a National Dex entry, with generation, region, types, legendary/mythical/ultra beast, family, release flags | `dex` |
| `forms` | a GO form: base, regional, alternate (Unown letters, Origin Forme ...), costume, event (clones), Mega/Primal | text id from the game data, e.g. `PIKACHU_VS_2019` |
| `variants` | something the Pokédex can tell apart: **form × shiny × normal/Shadow/Purified × none/Dynamax/Gigantamax** | `PIKACHU_VS_2019\|s\|normal\|none` |
| `backgrounds` | a location or special background (from the game data, plus any you add) | `LC_...` or `custom:<slug>` |

Catalog reloads are idempotent and never delete. Rows that disappear from the source get `in_catalog = 0`;
variants lose `catalog_target`. Collection rows always keep their references.

`variants.catalog_target` says whether a variant counts towards completion according to the catalog rules
(released, shiny released, shadow exists, Gigantamax exists, not battle-only). `target_override` is your own
decision and wins. "Missing" only ever means "counts and you don't have it".

**Collection** (your data)

| Table | Holds |
|---|---|
| `entries` | Pokémon in your Pokédex. `registered`, `for_trade` (count), `owned` (kept at least as high as `for_trade`; the app no longer shows it), plus per-Pokémon details: gender, size (XXS/XS/XL/XXL), lucky, IVs, background, moves, CP, nickname, date, public note, private note, source |
| `wishes` | what you want. Species, optional form, and requirements where NULL means "any": shiny, Shadow/Purified, Dynamax/Gigantamax, gender, size, lucky, minimum IVs, any/location/special background or a specific one, moves. Priority (high/normal/someday), status (open/fulfilled/archived), public flag, notes |
| `tags`, `entry_tags`, `wish_tags` | free labels (pvp, living-dex, special-trade, event names ...) |
| `settings` | page title, owner name, intro, default view, header link |
| `changes` | every change with before/after JSON and a batch id. Undo reverts one batch |

## Why a variant, and why entries can be several rows

Things the in-game Pokédex shows separately, like shiny, Shadow, costumes and Gigantamax, are **variants**.
Things that differ between two Pokémon of the same variant, like size, lucky, IVs, background and moves, are
**entry details**. That gives:

* Shiny costume Pikachu: variant `PIKACHU_VS_2019|s|normal|none`.
* Shadow shiny: `...|s|shadow|none`.
* XXL shiny: an entry on the shiny variant with `size = 'xxl'`.
* A legendary with a location background: an entry with `background_id`.
* Several backgrounds for one species: several entries.
* In the Pokédex: `registered = 1`. Three spare to trade: `for_trade = 3`.

The app treats "have it" as "it's in your Pokédex". The schema keeps an `owned` count (useful for imports from
other tools, and so a future version could show storage again); the app keeps it in step with `for_trade`.
* The same Pokémon wished for in different ways: several wish rows.

Every variant has one "plain" entry (no details) that the quick toggles edit. Anything special gets its own
entry. Rules enforced by the database and the service layer:

* owning one means it is registered (`CHECK (owned = 0 OR registered = 1)`);
* you can't offer more than you own (`CHECK (for_trade <= owned)`);
* IVs 0-15, known sizes/genders only, backgrounds and forms must exist;
* ids never get reused (`AUTOINCREMENT`), so undo can restore rows safely.

## Ready for later

* **Trade matching**: quantities are already per entry, and wishes are structured, so comparing someone
  else's list with yours is a query rather than a schema change.
* **Imports** (CSV, pasted lists, screenshot recognition): everything goes through `services.save_entry` /
  `save_wish` with the same validation, inside one transaction, under one undoable batch. `entries.source`
  records where a row came from.
* **New collection attributes**: add a column to `entries` (migration), a field to the editor and one term
  to the search registry.
* **New game content**: rebuild the catalog. New forms and variants appear; nothing you recorded moves.
