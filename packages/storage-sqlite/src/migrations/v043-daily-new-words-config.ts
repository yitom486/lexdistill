import type { SchemaMigration } from './types.js';

/**
 * 每日新词配置，随打卡目标同表同路（learner_language_profiles 为准）：
 * - daily_goal_new_words：每日新词数，0 表示只复习不推新词。
 * - word_level_filter_json：用户限定的 JLPT 集合（JSON 数组），NULL = 按词汇门自动定级。
 * 存量行取默认值，不回填。
 */
const sql = `
ALTER TABLE learner_language_profiles ADD COLUMN daily_goal_new_words INTEGER NOT NULL DEFAULT 10;
ALTER TABLE learner_language_profiles ADD COLUMN word_level_filter_json TEXT;
ALTER TABLE learner_profiles ADD COLUMN daily_goal_new_words INTEGER NOT NULL DEFAULT 10;
ALTER TABLE learner_profiles ADD COLUMN word_level_filter_json TEXT;
`;
export const migration: SchemaMigration = { version: 43, name: 'daily-new-words-config', sql,
  statements: sql.split(';').map(value => value.trim()).filter(Boolean) };
