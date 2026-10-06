import type { SchemaMigration } from './types.js';

const formats = ['multiple_choice', 'fill_blank', 'reorder', 'short_answer', 'translation', 'writing'];
const statements = [
  `CREATE TABLE generation_tasks (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL, turn_id TEXT NOT NULL,
    config_json TEXT NOT NULL CHECK(json_valid(config_json)),
    status TEXT NOT NULL CHECK(status IN ('ACTIVE','COMPLETED','CANCELLED')),
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE bank_materials (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, language TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('READING','LISTENING')),
    fingerprint TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(user_id,language,fingerprint), UNIQUE(id,type), UNIQUE(id,user_id)
  )`,
  ...['reading', 'listening'].map(type => `CREATE TABLE bank_${type}_materials (
    material_id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT '${type.toUpperCase()}' CHECK(type='${type.toUpperCase()}'),
    content_json TEXT NOT NULL CHECK(json_valid(content_json)),
    FOREIGN KEY(material_id,type) REFERENCES bank_materials(id,type) ON DELETE CASCADE
  )`),
  `CREATE TABLE bank_questions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, language TEXT NOT NULL,
    category TEXT NOT NULL, answer_type TEXT NOT NULL CHECK(answer_type IN
      ('MULTIPLE_CHOICE','FILL_BLANK','REORDER','SHORT_ANSWER','TRANSLATION','WRITING','LEGACY')),
    target_level TEXT, difficulty_tier INTEGER CHECK(difficulty_tier BETWEEN 1 AND 5),
    difficulty_reason TEXT, level_source TEXT NOT NULL CHECK(level_source IN ('AI_ESTIMATE','LEGACY_UNKNOWN')),
    status TEXT NOT NULL CHECK(status IN ('VALIDATED','LEGACY_PENDING')),
    prompt TEXT NOT NULL, explanation TEXT NOT NULL, skill_ids_json TEXT NOT NULL CHECK(json_valid(skill_ids_json)),
    citations_json TEXT NOT NULL CHECK(json_valid(citations_json)), material_id TEXT,
    fingerprint TEXT NOT NULL, model_id TEXT, prompt_version TEXT, legacy_json TEXT,
    created_at TEXT NOT NULL, UNIQUE(user_id,language,fingerprint), UNIQUE(id,answer_type),
    FOREIGN KEY(material_id,user_id) REFERENCES bank_materials(id,user_id)
  )`,
  ...formats.map(type => `CREATE TABLE bank_${type}_questions (
    question_id TEXT PRIMARY KEY, answer_type TEXT NOT NULL DEFAULT '${type.toUpperCase()}' CHECK(answer_type='${type.toUpperCase()}'),
    answer_json TEXT NOT NULL CHECK(json_valid(answer_json)),
    FOREIGN KEY(question_id,answer_type) REFERENCES bank_questions(id,answer_type) ON DELETE CASCADE
  )`),
  `CREATE INDEX bank_questions_pool ON bank_questions(user_id,language,status,target_level,category)`,
  `CREATE TABLE generation_task_questions (
    task_id TEXT NOT NULL REFERENCES generation_tasks(id), question_id TEXT NOT NULL REFERENCES bank_questions(id),
    PRIMARY KEY(task_id,question_id)
  )`,
  `CREATE TABLE generation_receipts (
    task_id TEXT NOT NULL REFERENCES generation_tasks(id), operation TEXT NOT NULL, request_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)),
    PRIMARY KEY(task_id,operation,request_key)
  )`,
  `CREATE TABLE bank_papers (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES generation_tasks(id), user_id TEXT NOT NULL,
    title TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE bank_paper_items (
    paper_id TEXT NOT NULL REFERENCES bank_papers(id), ordinal INTEGER NOT NULL,
    question_id TEXT NOT NULL REFERENCES bank_questions(id), snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
    PRIMARY KEY(paper_id,ordinal), UNIQUE(paper_id,question_id)
  )`,
  `CREATE TABLE bank_audio_assets (
    task_id TEXT NOT NULL REFERENCES generation_tasks(id), material_id TEXT NOT NULL REFERENCES bank_materials(id),
    claim_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('RUNNING','READY')),
    mime_type TEXT, audio_bytes BLOB, created_at TEXT NOT NULL,
    CHECK((status='RUNNING' AND audio_bytes IS NULL) OR (status='READY' AND length(audio_bytes)>0 AND mime_type IS NOT NULL)),
    PRIMARY KEY(task_id,material_id)
  )`,
  // Preserve identity and original values; unknown seed levels must not become invented exam levels.
  `INSERT INTO bank_questions (id,user_id,language,category,answer_type,level_source,status,
      prompt,explanation,skill_ids_json,citations_json,fingerprint,legacy_json,created_at)
    SELECT id,user_id,language,category,'LEGACY','LEGACY_UNKNOWN','LEGACY_PENDING',prompt,explanation,
      json_array(tested_skill_id),'[]','legacy:' || id,
      json_object('type',type,'content',content,'options',options,'chunks',chunks,
        'correctAnswer',correct_answer,'difficulty',difficulty,'extrasJson',extras_json),created_at
    FROM quiz_questions`,
];
export const migration: SchemaMigration = { version: 44, name: 'question-generation-bank', statements, sql: statements.join(';\n') + ';' };
