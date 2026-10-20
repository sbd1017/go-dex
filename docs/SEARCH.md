# Search

One language for the Pokédex, the wishlist and the trade page. The quick-filter buttons only edit the
search text, and the address bar always holds the search, so any view can be shared.

## Syntax

| You type | Means |
|---|---|
| `a, b` (or `a & b`) | both |
| `a \| b` (or `a ; b`) | either |
| `!a` | not |
| `25` | Pokédex #25 |
| `1-151`, `-151`, `387-` | number ranges |
| `pikachu`, `pika`, `libre`, `pikachu libre` | names of Pokémon or forms. An exact name wins, so `mew` is not Mewtwo |
| `+eevee` | the whole evolution family |
| `@special rend` | an entry or wish with that move |
| `#pvp`, `pvp`, `living dex` | a tag |
| `bg:madrid` | a background by name |
| `form:origin`, `type:fire`, `gen:4`, `note:text`, `priority:someday` | explicit fields |

## Words

Generated from the registry in `godex/static/js/query.js` (the ? next to the search box lists them all):

* **Collection:** `have` (also `owned`, `registered`), `trade`, `missing`, `wish`, `unreleased`
* **Variant:** `shiny`, `shadow`, `purified`, `dynamax`, `gigantamax` (`gmax`), `max`
* **Details:** `xxl`, `xl`, `xs`, `xxs`, `lucky`, `perfect` (`hundo`, `4*`), `background`,
  `locationbackground`, `specialbackground`, `female`, `male`
* **Form:** `costume`, `event`, `clone`, `regional`, `alolan`, `galarian`, `hisuian`, `paldean`, `mega`, `form`
* **Pokémon:** `legendary`, `mythical`, `ultrabeast`, regions (`kanto` ... `paldea`, `hisui`), `gen1` ... `gen9`,
  the 18 types
* **Wishlist:** `high`, `someday`, `open`, `fulfilled`, `archived`

## How "have" and "missing" work

"Have" means it is in your Pokédex. Detail words are about one Pokémon, so
`xxl, shiny` means "a shiny that is also XXL", not "any shiny and any XXL".

* `shiny, missing`: shiny variants that count towards completion where you have none.
* `xxl, missing`: variants where you have no XXL.
* `background, missing`: backgrounds on your wishlist that nothing you own satisfies yet.
* `!xxl`: no XXL. `!have`: not in your Pokédex.
* `trade` means at least one is offered for trade.

## Adding a word

Add one object to `TERMS` in `query.js`:

```js
def({ key: 'buddy', aliases: ['best-buddy'], group: 'Details', label: 'Best Buddy',
  entry: e => e.tags.includes('best-buddy'), wish: w => w.tags.includes('best-buddy') });
```

`species(sp, form)` tests facts about the Pokémon, `variant(v)` facts about the variant, `entry(e)` facts about
one Pokémon you have, and `wish(w)` the same word on a wish. Add a test in `tests/js/query.test.mjs`.

## Copy for Pokémon GO

The **Copy for GO** button on the Pokédex turns the current results into a Pokémon GO search: their Pokédex
numbers (shortened to ranges, `1-3,7,25`) plus GO search words, pre-picked from your search (`xxl, missing` gives
`xxl&...`). Tap a word once to include it, twice to exclude it (`!shadow`). Words of the same kind are either/or
(`xxs,xxl`); different kinds must all match (`xxs,xxl&shiny&1-3,7`), which is how GO reads `,` and `&`.
