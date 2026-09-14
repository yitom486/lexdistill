/**
 * D2 种子资产统一出口（具名制；各种子文件本身保持纯数据/纯函数不动）。
 * `seed-sources.ts` 为包内共享契约（seed-bootstrap / repair-apply 内部使用），
 * 不对外暴露。
 */
export { KANA_SEEDS } from './kana-seed.js';
export { HANGUL_SEEDS } from './hangul-seed.js';
export { LESSON_SEEDS } from './lesson-seed.js';
export { LEARNING_CONTENT_TEMPLATE_SEEDS } from './content-template-seed.js';
export { INITIAL_READING_SEEDS } from './reading-seed.js';
export { TEXTBOOK_BOOKS } from './textbook-seed.js';
export {
  INITIAL_CARD_SEEDS,
  INITIAL_EN_CARD_SEEDS,
  INITIAL_QUESTION_SEEDS,
  INITIAL_EN_QUESTION_SEEDS,
  INITIAL_KO_QUESTION_SEEDS,
  INITIAL_MISTAKE_SEEDS,
  INITIAL_SKILL_METRIC_SEEDS,
} from './learning-seed.js';
export { STARTER_WORD_SEEDS } from './starter-words-seed.js';
export { N5_WORD_SEEDS } from './n5-words-seed.js';
export {
  PITCH_LEXICON,
  lookupPitchEntries,
  extractPitchQueryTokens,
  tryPitchLexiconCoachReply,
  formatPitchLexiconCoachReply,
  type PitchLexiconEntry,
} from './pitch-seed.js';
