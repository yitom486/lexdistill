import type { SchemaMigration } from './types.js';

/** Schema v22 `review-schedule-events` — 已发布，禁止改 version / name / sql。 */
export const migration: SchemaMigration = {
  version: 22,
  name: 'review-schedule-events',
  sql: `
      CREATE TABLE IF NOT EXISTS review_schedule_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        language TEXT NOT NULL,
        algorithm_id TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        rating TEXT NOT NULL,
        input_state_json TEXT NOT NULL,
        output_state_json TEXT NOT NULL,
        evaluated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_review_schedule_user_card_time ON review_schedule_events(user_id, card_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_review_schedule_card_time ON review_schedule_events(card_id, created_at);
    `,
};
