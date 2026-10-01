import type { SchemaMigration } from './types.js';

/** Forward migration: existing structured content is copied once; no runtime legacy reader. */
const sql = `
ALTER TABLE documents ADD COLUMN chapters_json TEXT;
ALTER TABLE documents ADD COLUMN source_fingerprint TEXT;
CREATE TABLE global_vocabulary (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, language TEXT NOT NULL,
  word TEXT NOT NULL, reading TEXT NOT NULL DEFAULT '', meaning TEXT NOT NULL,
  jlpt_level TEXT CHECK(jlpt_level IS NULL OR jlpt_level IN ('N5','N4','N3','N2','N1')),
  level_source TEXT CHECK(level_source IS NULL OR level_source = 'MODEL_ESTIMATE'), created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_global_vocabulary_identity ON global_vocabulary(user_id, language, word, reading);
CREATE TABLE textbook_vocabulary (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL, ord INTEGER NOT NULL, vocabulary_id TEXT NOT NULL REFERENCES global_vocabulary(id),
  meaning TEXT NOT NULL, part_of_speech TEXT, pitch TEXT, explanation TEXT, examples_json TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX idx_textbook_vocabulary_word ON textbook_vocabulary(document_id, chapter_id, vocabulary_id);
CREATE TABLE textbook_knowledge (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL, ord INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('GRAMMAR','PRONUNCIATION','USAGE')),
  title TEXT NOT NULL, explanation TEXT NOT NULL, connection TEXT, ai_explanation TEXT,
  examples_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL CHECK(source IN ('TEXTBOOK','AI'))
);
CREATE TABLE textbook_articles (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL, ord INTEGER NOT NULL, title TEXT, text TEXT NOT NULL, translation TEXT,
  source TEXT NOT NULL CHECK(source IN ('TEXTBOOK','AI'))
);
CREATE TABLE textbook_sentences (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL, ord INTEGER NOT NULL, text TEXT NOT NULL, translation TEXT, explanation TEXT, speaker TEXT,
  source TEXT NOT NULL CHECK(source IN ('TEXTBOOK','AI'))
);
CREATE TABLE textbook_exercise_items (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL, ord INTEGER NOT NULL, type TEXT NOT NULL CHECK(type IN ('CHOICE','MULTI_CHOICE','FILL_BLANK','TRANSLATION','ORDERING','MATCHING','SHORT_ANSWER')), prompt TEXT NOT NULL,
  options_json TEXT, left_json TEXT, right_json TEXT, answer_json TEXT NOT NULL, explanation TEXT, grading_notes TEXT,
  source TEXT NOT NULL CHECK(source IN ('TEXTBOOK','AI'))
);
CREATE TABLE textbook_materials (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, chapter_id TEXT NOT NULL,
  text TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(document_id, chapter_id)
);
CREATE INDEX idx_textbook_vocabulary_chapter ON textbook_vocabulary(document_id, chapter_id, ord);
CREATE INDEX idx_textbook_knowledge_chapter ON textbook_knowledge(document_id, chapter_id, ord);
CREATE INDEX idx_textbook_articles_chapter ON textbook_articles(document_id, chapter_id, ord);
CREATE INDEX idx_textbook_sentences_chapter ON textbook_sentences(document_id, chapter_id, ord);
CREATE INDEX idx_textbook_exercises_chapter ON textbook_exercise_items(document_id, chapter_id, ord);

UPDATE documents SET source_fingerprint = json_extract(ast_json, '$.sourceFingerprint')
WHERE json_valid(ast_json) AND json_type(ast_json, '$.lessons') = 'array';
UPDATE documents SET chapters_json = (
  SELECT json_group_array(json_object('id', l.lesson_id, 'title', l.title, 'order', l.chapter_order, 'kind', l.kind,
    'startPage', l.start_page, 'endPage', l.end_page, 'status', l.status))
  FROM (SELECT *, row_number() OVER(PARTITION BY document_id ORDER BY coalesce(sort_order,lesson_number),lesson_id) AS chapter_order FROM textbook_lessons WHERE kind='lesson' OR (kind='section' AND NOT EXISTS(SELECT 1 FROM textbook_lessons p WHERE p.document_id=textbook_lessons.document_id AND p.lesson_id=textbook_lessons.parent_id AND p.kind IN ('lesson','section'))) ORDER BY chapter_order) l WHERE l.document_id = documents.id
  AND (l.kind = 'lesson' OR (l.kind = 'section' AND NOT EXISTS (
    SELECT 1 FROM textbook_lessons p WHERE p.document_id = l.document_id AND p.lesson_id = l.parent_id
      AND p.kind IN ('lesson','section'))))
) WHERE EXISTS (SELECT 1 FROM textbook_lessons l WHERE l.document_id = documents.id);

CREATE TEMP TABLE v037_chapter_map AS
WITH RECURSIVE membership(document_id,node_id,chapter_id) AS (
 SELECT d.id,json_extract(c.value,'$.id'),json_extract(c.value,'$.id') FROM documents d,json_each(d.chapters_json) c
 UNION
 SELECT l.document_id,l.lesson_id,m.chapter_id FROM textbook_lessons l JOIN membership m ON l.document_id=m.document_id AND l.parent_id=m.node_id
) SELECT * FROM membership;

INSERT OR IGNORE INTO global_vocabulary(id,user_id,language,word,reading,meaning,jlpt_level,level_source,created_at)
SELECT 'vocab_' || lower(hex(randomblob(16))), d.user_id, d.language, trim(v.surface), trim(coalesce(v.reading,'')),
 coalesce(v.gloss_zh,''), NULL, NULL, d.created_at
FROM textbook_vocab v JOIN documents d ON d.id=v.document_id WHERE trim(v.surface) <> '';
INSERT INTO textbook_vocabulary(id,document_id,chapter_id,ord,vocabulary_id,meaning,part_of_speech,pitch,explanation,examples_json)
SELECT coalesce(json_extract(c.content_json,'$.vocabularies[' || v.ord || '].id'),'word_' || lower(hex(randomblob(16)))), v.document_id,coalesce(m.chapter_id,v.lesson_id),v.ord,g.id,coalesce(v.gloss_zh,''),v.pos,v.pitch,v.ai_explanation,
 CASE WHEN json_type(c.content_json,'$.vocabularies[' || v.ord || '].examples')='array' THEN
   (SELECT json_group_array(json_patch(json_object('text',json_extract(ex.value,'$.text')),
      CASE WHEN json_extract(ex.value,'$.translation') IS NOT NULL THEN json_object('translation',json_extract(ex.value,'$.translation')) ELSE '{}' END))
    FROM json_each(c.content_json,'$.vocabularies[' || v.ord || '].examples') ex)
 ELSE CASE WHEN v.example_ja IS NOT NULL AND trim(v.example_ja) <> '' THEN json_array(json_patch(json_object('text',v.example_ja),CASE WHEN v.example_zh IS NOT NULL THEN json_object('translation',v.example_zh) ELSE '{}' END)) ELSE '[]' END END
FROM textbook_vocab v JOIN documents d ON d.id=v.document_id
JOIN textbook_lessons c ON c.document_id=v.document_id AND c.lesson_id=v.lesson_id
LEFT JOIN v037_chapter_map m ON m.document_id=v.document_id AND m.node_id=v.lesson_id
JOIN global_vocabulary g ON g.user_id=d.user_id AND g.language=d.language AND g.word=trim(v.surface) AND g.reading=trim(coalesce(v.reading,''))
GROUP BY v.document_id,coalesce(m.chapter_id,v.lesson_id),g.id;

INSERT INTO textbook_knowledge(id,document_id,chapter_id,ord,kind,title,explanation,connection,ai_explanation,examples_json,source)
SELECT CASE WHEN count(*) OVER(PARTITION BY json_extract(c.content_json,'$.knowledgePoints[' || g.ord || '].id')) > 1
 THEN 'knowledge_' || lower(hex(randomblob(16)))
 ELSE coalesce(json_extract(c.content_json,'$.knowledgePoints[' || g.ord || '].id'),'knowledge_' || lower(hex(randomblob(16)))) END,
 g.document_id,g.lesson_id,g.ord,'GRAMMAR',g.title,coalesce(g.explanation,''),g.connection,g.ai_explanation,
 CASE WHEN json_type(c.content_json,'$.knowledgePoints[' || g.ord || '].examples')='array' THEN
   (SELECT json_group_array(json_patch(json_object('text',json_extract(ex.value,'$.text')),
      CASE WHEN json_extract(ex.value,'$.translation') IS NOT NULL THEN json_object('translation',json_extract(ex.value,'$.translation')) ELSE '{}' END))
    FROM json_each(c.content_json,'$.knowledgePoints[' || g.ord || '].examples') ex)
 ELSE (SELECT json_group_array(json_patch(json_object('text',json_extract(ex.value,'$.japanese')),
      CASE WHEN json_extract(ex.value,'$.chinese') IS NOT NULL THEN json_object('translation',json_extract(ex.value,'$.chinese')) ELSE '{}' END)) FROM json_each(g.examples_json) ex) END,
 coalesce(g.source,'TEXTBOOK') FROM textbook_grammar g JOIN textbook_lessons c ON c.document_id=g.document_id AND c.lesson_id=g.lesson_id;
INSERT INTO textbook_articles(id,document_id,chapter_id,ord,title,text,translation,source)
SELECT CASE WHEN count(*) OVER(PARTITION BY block_id)>1 THEN 'article_' || lower(hex(randomblob(16)))
 ELSE coalesce(block_id,'article_' || lower(hex(randomblob(16)))) END,document_id,lesson_id,ord,NULL,ja,zh,coalesce(source,'TEXTBOOK')
FROM textbook_lines WHERE coalesce(kind,'PARAGRAPH')='PARAGRAPH';
INSERT INTO textbook_sentences(id,document_id,chapter_id,ord,text,translation,explanation,speaker,source)
SELECT CASE WHEN count(*) OVER(PARTITION BY block_id)>1 THEN 'sentence_' || lower(hex(randomblob(16)))
 ELSE coalesce(block_id,'sentence_' || lower(hex(randomblob(16)))) END,document_id,lesson_id,ord,ja,zh,NULL,speaker,coalesce(source,'TEXTBOOK')
FROM textbook_lines WHERE kind='DIALOGUE';
INSERT INTO textbook_exercise_items(id,document_id,chapter_id,ord,type,prompt,options_json,left_json,right_json,answer_json,explanation,grading_notes,source)
SELECT CASE WHEN count(*) OVER(PARTITION BY e.exercise_id)>1 THEN 'exercise_' || lower(hex(randomblob(16)))
 ELSE coalesce(e.exercise_id,'exercise_' || lower(hex(randomblob(16)))) END,e.document_id,e.lesson_id,e.ord,e.type,e.prompt,
 (SELECT json_group_array(CASE WHEN o.type='object' THEN json_extract(o.value,'$.text') ELSE o.value END) FROM json_each(e.options_json) o),
 CASE WHEN json_type(e.content_json,'$.left')='array' THEN (SELECT json_group_array(json_extract(o.value,'$.text')) FROM json_each(e.content_json,'$.left') o) END,
 CASE WHEN json_type(e.content_json,'$.right')='array' THEN (SELECT json_group_array(json_extract(o.value,'$.text')) FROM json_each(e.content_json,'$.right') o) END,
 CASE
  WHEN json_type(e.answer_json,'$.text')='text' THEN json_quote(json_extract(e.answer_json,'$.text'))
  WHEN json_type(e.answer_json,'$.optionIds')='array' THEN
   (SELECT json_group_array((SELECT json_extract(o.value,'$.text') FROM json_each(
    CASE WHEN json_type(e.content_json,'$.options')='array' THEN json_extract(e.content_json,'$.options') ELSE e.options_json END
   ) o WHERE o.type='object' AND json_extract(o.value,'$.id')=a.value)) FROM json_each(e.answer_json,'$.optionIds') a)
  WHEN json_type(e.answer_json,'$.pairs')='array' THEN
   (SELECT json_group_array(json_object('left',(SELECT json_extract(o.value,'$.text') FROM json_each(e.content_json,'$.left') o WHERE json_extract(o.value,'$.id')=json_extract(a.value,'$.leftId')),
   'right',(SELECT json_extract(o.value,'$.text') FROM json_each(e.content_json,'$.right') o WHERE json_extract(o.value,'$.id')=json_extract(a.value,'$.rightId')))) FROM json_each(e.answer_json,'$.pairs') a)
  ELSE json_quote(e.answer) END,
 e.explanation,NULL,coalesce(e.source,'TEXTBOOK') FROM textbook_exercises e;

INSERT INTO textbook_materials(document_id,chapter_id,text,updated_at)
SELECT l.document_id,l.lesson_id,
 coalesce(l.passage_md,'') ||
 CASE WHEN l.preview_json IS NOT NULL THEN char(10)||char(10)||'AI 预习导学'||char(10)||coalesce(json_extract(l.preview_json,'$.canDoGoal'),'')||char(10)||
 (SELECT coalesce(group_concat(value,char(10)),'') FROM json_each(l.preview_json,'$.keyPoints'))||char(10)||(SELECT coalesce(group_concat(value,char(10)),'') FROM json_each(l.preview_json,'$.pitfalls')) ELSE '' END ||
 CASE WHEN l.summary_json IS NOT NULL THEN char(10)||char(10)||'AI 总结'||char(10)||(SELECT coalesce(group_concat(value,char(10)),'') FROM json_each(l.summary_json,'$.goldenSentences'))||char(10)||(SELECT coalesce(group_concat(value,char(10)),'') FROM json_each(l.summary_json,'$.selfCheckQuestions')) ELSE '' END, d.updated_at
FROM textbook_lessons l JOIN documents d ON d.id=l.document_id
WHERE (coalesce(l.passage_md,'')<>'' OR l.preview_json IS NOT NULL OR l.summary_json IS NOT NULL)
 AND EXISTS(SELECT 1 FROM json_each(d.chapters_json) c WHERE json_extract(c.value,'$.id')=l.lesson_id);
UPDATE textbook_knowledge SET chapter_id=coalesce((SELECT m.chapter_id FROM v037_chapter_map m WHERE m.document_id=textbook_knowledge.document_id AND m.node_id=textbook_knowledge.chapter_id),chapter_id);
UPDATE textbook_articles SET chapter_id=coalesce((SELECT m.chapter_id FROM v037_chapter_map m WHERE m.document_id=textbook_articles.document_id AND m.node_id=textbook_articles.chapter_id),chapter_id);
UPDATE textbook_sentences SET chapter_id=coalesce((SELECT m.chapter_id FROM v037_chapter_map m WHERE m.document_id=textbook_sentences.document_id AND m.node_id=textbook_sentences.chapter_id),chapter_id);
UPDATE textbook_exercise_items SET chapter_id=coalesce((SELECT m.chapter_id FROM v037_chapter_map m WHERE m.document_id=textbook_exercise_items.document_id AND m.node_id=textbook_exercise_items.chapter_id),chapter_id);
WITH ordering AS(SELECT id,row_number() OVER(PARTITION BY document_id,chapter_id ORDER BY ord,id)-1 AS n FROM textbook_vocabulary) UPDATE textbook_vocabulary SET ord=(SELECT n FROM ordering WHERE ordering.id=textbook_vocabulary.id);
WITH ordering AS(SELECT id,row_number() OVER(PARTITION BY document_id,chapter_id ORDER BY ord,id)-1 AS n FROM textbook_knowledge) UPDATE textbook_knowledge SET ord=(SELECT n FROM ordering WHERE ordering.id=textbook_knowledge.id);
WITH ordering AS(SELECT id,row_number() OVER(PARTITION BY document_id,chapter_id ORDER BY ord,id)-1 AS n FROM textbook_articles) UPDATE textbook_articles SET ord=(SELECT n FROM ordering WHERE ordering.id=textbook_articles.id);
WITH ordering AS(SELECT id,row_number() OVER(PARTITION BY document_id,chapter_id ORDER BY ord,id)-1 AS n FROM textbook_sentences) UPDATE textbook_sentences SET ord=(SELECT n FROM ordering WHERE ordering.id=textbook_sentences.id);
WITH ordering AS(SELECT id,row_number() OVER(PARTITION BY document_id,chapter_id ORDER BY ord,id)-1 AS n FROM textbook_exercise_items) UPDATE textbook_exercise_items SET ord=(SELECT n FROM ordering WHERE ordering.id=textbook_exercise_items.id);
DROP TABLE v037_chapter_map;
UPDATE documents SET ast_json=NULL,content='' WHERE chapters_json IS NOT NULL;
DELETE FROM textbook_fts;
INSERT INTO textbook_fts(surface,reading,gloss,document_id,lesson_id,kind,ref)
SELECT g.word,g.reading,v.meaning,v.document_id,v.chapter_id,'vocab',v.id FROM textbook_vocabulary v JOIN global_vocabulary g ON g.id=v.vocabulary_id;
INSERT INTO textbook_fts(ja,zh,document_id,lesson_id,kind,ref)
SELECT text,translation,document_id,chapter_id,'line',id FROM textbook_articles;
INSERT INTO textbook_fts(ja,zh,document_id,lesson_id,kind,ref)
SELECT text,translation,document_id,chapter_id,'line',id FROM textbook_sentences;
DROP TABLE textbook_lessons;
DROP TABLE textbook_lines;
DROP TABLE textbook_vocab;
DROP TABLE textbook_grammar;
DROP TABLE textbook_exercises;
`;

// Every statement in this migration is static SQL without embedded semicolons.
// Individual execution makes SQLite reject malformed data before recording the version.
export const migration: SchemaMigration = { version:37, name:'textbook-learning-tables', sql,
  statements: sql.split(';').map(statement=>statement.trim()).filter(Boolean),
};
