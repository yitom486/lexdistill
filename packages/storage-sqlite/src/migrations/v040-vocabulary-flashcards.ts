import type { SchemaMigration } from './types.js';

// Versioned DDL/data migration. Preserve card IDs and every FSRS/history value.
const sql = `
ALTER TABLE flashcards ADD COLUMN vocabulary_id TEXT REFERENCES global_vocabulary(id);
ALTER TABLE flashcards ADD COLUMN part_of_speech TEXT;
ALTER TABLE flashcards ADD COLUMN examples_json TEXT NOT NULL DEFAULT '[]';
INSERT OR IGNORE INTO global_vocabulary(id,user_id,language,word,reading,meaning,created_at)
SELECT 'vocabulary_legacy_' || lower(hex(randomblob(16))), f.user_id, f.language,
       trim(e.headword), trim(coalesce(e.reading,e.romanization,'')), f.back, datetime('now')
FROM flashcards f JOIN local_dictionary_entries e ON e.id=f.source_entry_id AND e.language=f.language
WHERE f.type='VOCABULARY';
UPDATE flashcards SET vocabulary_id=(
  SELECT g.id FROM global_vocabulary g WHERE g.user_id=flashcards.user_id AND g.language=flashcards.language
  AND g.word=trim(flashcards.front) AND g.reading=trim(coalesce(flashcards.phonetic,''))
) WHERE type='VOCABULARY' AND (
  SELECT count(*) FROM flashcards f WHERE f.user_id=flashcards.user_id AND f.language=flashcards.language
  AND f.type='VOCABULARY' AND trim(f.front)=trim(flashcards.front)
  AND trim(coalesce(f.phonetic,''))=trim(coalesce(flashcards.phonetic,''))
)=1;
UPDATE flashcards SET part_of_speech=json_extract(tags,'$[1]'), examples_json=CASE
  WHEN coalesce(json_extract(tags,'$[2]'),'')<>'' THEN json_array(json_object(
    'text',json_extract(tags,'$[2]'),'translation',coalesce(json_extract(tags,'$[3]'),''))) ELSE '[]' END,
  tags=(SELECT json_group_array(value) FROM json_each(flashcards.tags)
    WHERE CAST(key AS INTEGER)=0 OR CAST(key AS INTEGER)>=4)
WHERE json_valid(tags) AND (json_extract(tags,'$[0]') IN ('词典生词','教材生词')
  OR id IN ('card_01','card_02','card_en_01','card_en_02')) AND json_array_length(tags)>=4;
CREATE UNIQUE INDEX IF NOT EXISTS idx_flashcards_user_vocabulary ON flashcards(user_id,vocabulary_id)
WHERE vocabulary_id IS NOT NULL AND type='VOCABULARY';
`;
export const migration: SchemaMigration = { version: 40, name: 'vocabulary-flashcards', sql,
  statements: sql.split(';').map(value => value.trim()).filter(Boolean) };
