-- Autosave used to write straight over the live row with status "draft", which
-- silently pulled a published article off the website the moment an editor
-- opened it. In-progress edits to a published article now park here instead,
-- leaving the live columns untouched until the editor saves deliberately.
ALTER TABLE content ADD COLUMN draft_content TEXT;
ALTER TABLE content ADD COLUMN draft_saved_at TEXT;
