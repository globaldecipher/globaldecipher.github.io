-- Optional override for the card picture. Left empty, the site falls back to
-- the first image already embedded in the article body, so Word imports get a
-- lead image with no extra step.
ALTER TABLE content ADD COLUMN image TEXT;
ALTER TABLE content ADD COLUMN image_alt TEXT;
