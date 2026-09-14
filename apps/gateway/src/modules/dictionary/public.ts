/**
 * M1-2 词典（lexicon）领域公共表面。
 *
 * 跨模块只许 import 本文件（R5 allowlist 登记到 public.js，不再登记深路径）；
 * 本文件只转出已查证的跨域消费符号 + 本域仓储契约，不搬业务实现。
 */
export type { DictionaryEntryCollection } from './persistence/dictionary.js';
export { buildTermKey, recordTermExposure } from '@study-studio/storage-sqlite';
export type { LexiconRepository } from './ports.js';
