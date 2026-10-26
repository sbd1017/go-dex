-- The game's artwork name for each background (lc_GoTour2023, sb_GoFest2024_radiance). Images are never shipped:
-- tools/fetch_sprites.py --backgrounds puts them in media/sprites/backgrounds/.
ALTER TABLE backgrounds ADD COLUMN image TEXT;
