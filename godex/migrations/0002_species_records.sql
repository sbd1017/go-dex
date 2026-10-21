-- Which per-Pokémon records the game keeps for a species. The catalog sets sizes/lucky; your own choice
-- (*_override, NULL = follow the catalog) wins. Used so "xxs, missing" and the lucky total skip impossible ones.
ALTER TABLE species ADD COLUMN sizes INTEGER NOT NULL DEFAULT 1;           -- can be recorded as XXS / XXL
ALTER TABLE species ADD COLUMN lucky INTEGER NOT NULL DEFAULT 1;           -- can be lucky (only tradable ones)
ALTER TABLE species ADD COLUMN sizes_override INTEGER;
ALTER TABLE species ADD COLUMN lucky_override INTEGER;
