-- Regional exclusives (Comfey, Tauros, Heracross ...): only caught in some parts of the world. The catalog sets
-- regional from data/overrides.json; your own choice (regional_override, NULL = follow the catalog) wins.
ALTER TABLE species ADD COLUMN regional INTEGER NOT NULL DEFAULT 0;
ALTER TABLE species ADD COLUMN regional_override INTEGER;
