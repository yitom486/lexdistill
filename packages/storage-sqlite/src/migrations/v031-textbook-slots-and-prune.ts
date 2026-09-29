import type { SchemaMigration } from './types.js';

/**
 * Schema v31 `textbook-slots-and-prune` —— 目录优先与槽位提炼支持：
 * - textbook_lessons 扩充槽位字段：
 *   - start_page / end_page：目录提取识别的对应教材真实物理页码；
 *   - status：槽位生命周期状态（'pending' 待大模型填充 | 'ready' 已填充结构化内容，默认 pending）；
 *   - passage_md：整节排版完好、带发音与对照的精读正文/对话全文 Markdown（逐步取代行级碎片表 textbook_lines）。
 */
export const migration: SchemaMigration = {
  version: 31,
  name: 'textbook-slots-and-prune',
  sql: `
      ALTER TABLE textbook_lessons ADD COLUMN start_page INTEGER;
      ALTER TABLE textbook_lessons ADD COLUMN end_page INTEGER;
      ALTER TABLE textbook_lessons ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE textbook_lessons ADD COLUMN passage_md TEXT;
    `,
};
