import type { SchemaMigration } from './types.js';

/**
 * Schema v33 `textbook-lesson-pedagogy` —— 课前预习导学与课后复习总结增强：
 * - textbook_lessons 扩充 AI 教学增强字段：
 *   - preview_json: 课前导学与破局指南 JSON（核心攻坚点、初学者避坑点、情景达成目标）；
 *   - summary_json: 课后总结与检视清单 JSON（核心骨架背诵句、睡前自测检视清单）。
 */
export const migration: SchemaMigration = {
  version: 33,
  name: 'textbook-lesson-pedagogy',
  sql: `
      ALTER TABLE textbook_lessons ADD COLUMN preview_json TEXT;
      ALTER TABLE textbook_lessons ADD COLUMN summary_json TEXT;
    `,
};
