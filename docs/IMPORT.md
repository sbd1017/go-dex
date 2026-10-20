# Import format

`Data -> Import` (or `python -m godex.cli import FILE`) reads the same JSON that `Data -> Export` writes. You can
also produce it yourself, from a spreadsheet or a script, to fill in a collection quickly. Always run the check
(dry run) first: nothing is saved until you confirm, and a database backup is taken before every import.

```json
{
  "format": "godex-collection",
  "version": 1,
  "entries": [
    {"variant_id": "PIKACHU|n|normal|none", "registered": 1, "owned": 2, "for_trade": 1},
    {"variant_id": "PIKACHU_VS_2019|s|normal|none", "owned": 1, "size": "xxl", "lucky": 1},
    {"variant_id": "PALKIA_ORIGIN|n|normal|none", "owned": 1, "iv_atk": 15, "iv_def": 15, "iv_sta": 15,
     "moves": "Dragon Tail / Spacial Rend", "background_id": "LC_2024_MADRID_GOFEST_001", "tags": ["pvp"]}
  ],
  "wishes": [
    {"dex": 25, "form_id": "PIKACHU_VS_2019", "shiny": 1, "priority": "high"},
    {"dex": 778, "size": "xxl", "note": "Any form"}
  ]
}
```

## Entries

`variant_id` is `FORM|n or s|normal, shadow or purified|none, dynamax or gigantamax`. Form ids come from
`data/catalog.json` (`forms[].id`): the base form is the species name in capitals (`PIKACHU`, `MR_MIME`), other
forms add a suffix (`RATTATA_ALOLA`, `GIRATINA_ORIGIN`, `CHARIZARD_MEGA_X`). The admin page shows the id of any
form.

| Field | Values |
|---|---|
| `registered` | 1 or 0 (owning one always means registered) |
| `owned`, `for_trade` | counts; `for_trade` can't be more than `owned` |
| `size` | `xxs`, `xs`, `xl`, `xxl` |
| `lucky` | 1 or 0 |
| `gender` | `male`, `female`, `genderless` |
| `iv_atk`, `iv_def`, `iv_sta` | 0-15 |
| `background_id` | a background id from the catalog (or one you added) |
| `moves`, `nickname`, `note`, `private_note` | text |
| `cp` | number; `caught_on` is `YYYY-MM-DD`; `tags` is a list of words |

## Wishes

`dex` is required. Everything else is optional and means "any" when left out: `form_id`, `shiny` (1/0),
`alignment`, `max`, `size`, `lucky`, `gender`, `min_iv_atk` / `min_iv_def` / `min_iv_sta`, `background`
(`any`, `location`, `special`) or `background_id`, `moves`, `title`, `note`, `private_note`, `tags`,
`priority` (`high`, `normal`, `someday`), `status` (`open`, `fulfilled`, `archived`), `public` (1/0).

## Merging is safe to repeat

In "Add to my collection" mode, an entry for the same Pokémon (same variant and same details) is combined with
the one you already have, keeping the higher counts, and a wish that already exists is skipped. Importing the same
file twice changes nothing the second time. "Replace my collection" starts over instead. Anything that can't be
read is skipped and listed in the report; the rest still imports.
