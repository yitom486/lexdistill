import type { SchemaMigration } from './types.js';

const formats = ['multiple_choice', 'fill_blank', 'reorder', 'short_answer', 'translation', 'writing'];
// v044 has already run in a desktop development database. Extend it; never replace it.
const statements = [
  'ALTER TABLE generation_tasks ADD COLUMN audio_attempts INTEGER NOT NULL DEFAULT 0 CHECK(audio_attempts>=0)',
  `UPDATE bank_questions SET answer_type=CASE
    WHEN json_extract(legacy_json,'$.type') IN ('MULTIPLE_CHOICE','CHOICE') THEN 'MULTIPLE_CHOICE'
    WHEN json_extract(legacy_json,'$.type') IN ('FILL_IN_BLANK','FILL_BLANK','LISTENING_DICTATION') THEN 'FILL_BLANK'
    WHEN json_extract(legacy_json,'$.type') IN ('SENTENCE_REORDER','REORDER') THEN 'REORDER'
    WHEN json_extract(legacy_json,'$.type') IN ('SHORT_ANSWER','TRANSLATION','WRITING') THEN json_extract(legacy_json,'$.type')
    ELSE 'LEGACY' END
    WHERE status='LEGACY_PENDING' AND level_source='LEGACY_UNKNOWN' AND answer_type='LEGACY' AND json_valid(legacy_json)`,
  ...formats.map(type => `INSERT OR IGNORE INTO bank_${type}_questions (question_id,answer_json)
    SELECT id,json_object('legacy',1,'type',answer_type,'correctAnswer',json_extract(legacy_json,'$.correctAnswer'),
      'optionsJson',json_extract(legacy_json,'$.options'),'chunksJson',json_extract(legacy_json,'$.chunks'))
    FROM bank_questions WHERE status='LEGACY_PENDING' AND answer_type='${type.toUpperCase()}' AND json_valid(legacy_json)`),
];
export const migration: SchemaMigration = { version: 45, name: 'generation-audio-budget-and-legacy-types', statements, sql: statements.join(';\n') + ';' };
