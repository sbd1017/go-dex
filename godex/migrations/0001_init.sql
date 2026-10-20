-- godex schema v1. See docs/SCHEMA.md for the reasoning.
--
-- Two layers:
--   catalog    (species, forms, variants, backgrounds): reference data, reloaded from data/catalog.json.
--              Rows are keyed by stable text ids and are never deleted while anything refers to them.
--   collection (entries, wishes, tags, settings, changes): your data. Only ever written by you.

-- ------------------------------------------------------------------ catalog
CREATE TABLE species (
    dex            INTEGER PRIMARY KEY,                  -- National Pokédex number
    code           TEXT NOT NULL UNIQUE,                 -- game id, e.g. PIKACHU
    name           TEXT NOT NULL,
    generation     INTEGER NOT NULL,
    region         TEXT NOT NULL DEFAULT '',             -- kanto ... paldea, hisui
    family         TEXT NOT NULL DEFAULT '',             -- evolution family code
    class          TEXT NOT NULL DEFAULT '' CHECK (class IN ('', 'legendary', 'mythical', 'ultra_beast')),
    type1          TEXT NOT NULL,
    type2          TEXT,
    gender_diff    INTEGER NOT NULL DEFAULT 0,           -- has visible male/female differences
    released       INTEGER NOT NULL DEFAULT 0,
    shiny          INTEGER NOT NULL DEFAULT 0,           -- shiny released
    shadow         INTEGER NOT NULL DEFAULT 0,           -- shadow exists
    gmax           INTEGER NOT NULL DEFAULT 0,
    dynamax        INTEGER NOT NULL DEFAULT 0,
    in_catalog     INTEGER NOT NULL DEFAULT 1            -- 0: gone from the source data, kept for your records
);

CREATE TABLE forms (
    id             TEXT PRIMARY KEY,                     -- PIKACHU (base), PIKACHU_VS_2019, CHARIZARD_MEGA_X ...
    dex            INTEGER NOT NULL REFERENCES species(dex),
    code           TEXT NOT NULL DEFAULT '',             -- VS_2019 ('' for the base form)
    name           TEXT NOT NULL DEFAULT '',             -- 'Libre' ('' for the base form)
    kind           TEXT NOT NULL CHECK (kind IN ('base', 'alternate', 'regional', 'costume', 'event', 'mega')),
    region_tag     TEXT NOT NULL DEFAULT '',             -- alolan / galarian / hisuian / paldean
    type1          TEXT NOT NULL,
    type2          TEXT,
    sort           INTEGER NOT NULL DEFAULT 0,
    image          TEXT,                                 -- icon base name, e.g. pm25.fVS_2019 (see media/sprites)
    gmax_image     TEXT,
    released       INTEGER NOT NULL DEFAULT 1,
    shiny          INTEGER NOT NULL DEFAULT 0,
    shadow         INTEGER NOT NULL DEFAULT 0,
    in_catalog     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX forms_dex ON forms(dex, sort);

-- A variant is one Pokédex-distinct thing you can have: form x shiny x shadow/purified x Dynamax/Gigantamax.
-- Things that vary between individual Pokémon (size, lucky, IVs, background, gender, moves) live on entries.
CREATE TABLE variants (
    id               TEXT PRIMARY KEY,                   -- '<form>|<n|s>|<normal|shadow|purified>|<none|dynamax|gigantamax>'
    form_id          TEXT NOT NULL REFERENCES forms(id),
    shiny            INTEGER NOT NULL CHECK (shiny IN (0, 1)),
    alignment        TEXT NOT NULL CHECK (alignment IN ('normal', 'shadow', 'purified')),
    max              TEXT NOT NULL CHECK (max IN ('none', 'dynamax', 'gigantamax')),
    catalog_target   INTEGER NOT NULL DEFAULT 0,         -- counts towards completion, according to the catalog rules
    target_override  INTEGER CHECK (target_override IN (0, 1)),   -- your decision; NULL = use the catalog
    UNIQUE (form_id, shiny, alignment, max)
);

CREATE TABLE backgrounds (
    id         TEXT PRIMARY KEY,                         -- LC_2024_MADRID_GOFEST_001, or custom:<slug>
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('location', 'special')),
    year       INTEGER,
    custom     INTEGER NOT NULL DEFAULT 0,               -- 1 = added by you
    in_catalog INTEGER NOT NULL DEFAULT 1
);

-- ------------------------------------------------------------------ collection
-- One row = a group of Pokémon that are the same for collection purposes. The everyday "plain" entry
-- (no size/lucky/IV/background/gender/move detail) carries the quick toggles; add more rows for special ones.
CREATE TABLE entries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,   -- never reused, so undo can restore ids safely
    variant_id    TEXT NOT NULL REFERENCES variants(id),
    registered    INTEGER NOT NULL DEFAULT 1 CHECK (registered IN (0, 1)),
    owned         INTEGER NOT NULL DEFAULT 0 CHECK (owned BETWEEN 0 AND 9999),
    for_trade     INTEGER NOT NULL DEFAULT 0 CHECK (for_trade BETWEEN 0 AND 9999),
    gender        TEXT NOT NULL DEFAULT '' CHECK (gender IN ('', 'male', 'female', 'genderless')),
    size          TEXT NOT NULL DEFAULT '' CHECK (size IN ('', 'xxs', 'xs', 'xl', 'xxl')),
    lucky         INTEGER NOT NULL DEFAULT 0 CHECK (lucky IN (0, 1)),
    iv_atk        INTEGER CHECK (iv_atk BETWEEN 0 AND 15),
    iv_def        INTEGER CHECK (iv_def BETWEEN 0 AND 15),
    iv_sta        INTEGER CHECK (iv_sta BETWEEN 0 AND 15),
    background_id TEXT REFERENCES backgrounds(id),
    moves         TEXT NOT NULL DEFAULT '',              -- free text, e.g. "Dragon Tail / Special Rend"
    cp            INTEGER CHECK (cp BETWEEN 10 AND 99999),
    nickname      TEXT NOT NULL DEFAULT '',
    caught_on     TEXT,                                  -- ISO date
    note          TEXT NOT NULL DEFAULT '',              -- shown publicly
    private_note  TEXT NOT NULL DEFAULT '',              -- admin only
    source        TEXT NOT NULL DEFAULT 'manual',        -- manual / bulk / import:<file>
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    CHECK (owned = 0 OR registered = 1),                 -- owning one means it is in your Pokédex
    CHECK (for_trade <= owned)
);
CREATE INDEX entries_variant ON entries(variant_id);
CREATE INDEX entries_trade ON entries(for_trade) WHERE for_trade > 0;

-- A wish describes what you want. NULL in a requirement column means "any".
-- The same species/form can be wished for several times with different requirements.
CREATE TABLE wishes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    dex           INTEGER NOT NULL REFERENCES species(dex),
    form_id       TEXT REFERENCES forms(id),
    shiny         INTEGER CHECK (shiny IN (0, 1)),
    alignment     TEXT CHECK (alignment IN ('normal', 'shadow', 'purified')),
    max           TEXT CHECK (max IN ('none', 'dynamax', 'gigantamax')),
    gender        TEXT CHECK (gender IN ('male', 'female')),
    size          TEXT CHECK (size IN ('xxs', 'xs', 'xl', 'xxl')),
    lucky         INTEGER CHECK (lucky IN (0, 1)),
    min_iv_atk    INTEGER CHECK (min_iv_atk BETWEEN 0 AND 15),
    min_iv_def    INTEGER CHECK (min_iv_def BETWEEN 0 AND 15),
    min_iv_sta    INTEGER CHECK (min_iv_sta BETWEEN 0 AND 15),
    background    TEXT CHECK (background IN ('any', 'location', 'special')),   -- wants some background
    background_id TEXT REFERENCES backgrounds(id),                            -- wants this one
    moves         TEXT NOT NULL DEFAULT '',
    title         TEXT NOT NULL DEFAULT '',             -- optional custom label
    note          TEXT NOT NULL DEFAULT '',
    private_note  TEXT NOT NULL DEFAULT '',
    priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'someday')),
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'archived')),
    public        INTEGER NOT NULL DEFAULT 1 CHECK (public IN (0, 1)),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    fulfilled_at  TEXT
);
CREATE INDEX wishes_dex ON wishes(dex);

-- Free-form labels for entries and wishes (pvp, living-dex, special-trade, event names ...).
CREATE TABLE tags (
    slug        TEXT PRIMARY KEY CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
    label       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);
CREATE TABLE entry_tags (
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    tag      TEXT NOT NULL REFERENCES tags(slug) ON UPDATE CASCADE,
    PRIMARY KEY (entry_id, tag)
);
CREATE TABLE wish_tags (
    wish_id INTEGER NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL REFERENCES tags(slug) ON UPDATE CASCADE,
    PRIMARY KEY (wish_id, tag)
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Every change you make, with before/after, so mistakes can be undone and history reconciled.
CREATE TABLE changes (
    id        INTEGER PRIMARY KEY,
    at        TEXT NOT NULL,
    batch     TEXT NOT NULL,                             -- one user action = one batch (undo works per batch)
    action    TEXT NOT NULL,                             -- insert / update / delete
    entity    TEXT NOT NULL,                             -- entries / wishes / variants / backgrounds / settings
    entity_id TEXT NOT NULL,
    before    TEXT,                                      -- JSON row
    after     TEXT,
    summary   TEXT NOT NULL DEFAULT '',
    undone    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX changes_batch ON changes(batch);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO meta(key, value) VALUES ('data_version', '0');

INSERT INTO tags(slug, label, description) VALUES
    ('pvp', 'PvP', 'Wanted or kept for GO Battle League'),
    ('living-dex', 'Living Dex', 'Part of a living Pokédex'),
    ('special-trade', 'Special Trade', 'Needs a Special Trade'),
    ('raid', 'Raid', 'From or for raids'),
    ('event', 'Event', 'Event exclusive'),
    ('community-day', 'Community Day', 'Community Day exclusive'),
    ('research', 'Research', 'Research encounter'),
    ('lucky-trade', 'Lucky trade', 'Hoping for a lucky trade'),
    ('regional', 'Regional', 'Region exclusive');
