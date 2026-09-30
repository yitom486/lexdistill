import type { SchemaMigration } from './types.js';
export const migration: SchemaMigration = { version: 36, name: 'textbook-vocab-ai-explanation', sql: 'ALTER TABLE textbook_vocab ADD COLUMN ai_explanation TEXT;' };
