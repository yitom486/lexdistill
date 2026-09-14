import type { Result, BusinessError } from '@study-studio/shared';
import type { TargetLanguage } from '@study-studio/learner-core';
import type { AgentAdapter } from '@study-studio/agent-runtime';
import type {
  LocalDictionaryEntry,
  DictionaryEntryCollection,
  DictionarySearchRecord,
} from './persistence/dictionary.js';
import type {
  EncounteredTerm,
  RecordTermExposureInput,
  RecordReadingExposuresInput,
} from '@study-studio/storage-sqlite';
import type { TermExampleItem } from './application/term-examples.js';
import type { WordlistGroup } from './persistence/wordlists.js';

/**
 * M1-2 词典（lexicon）领域仓储能力契约。
 *
 * - 方法签名与 DrizzleLearnerRepository 实现逐字对齐（`implements` 编译期锁定）；
 * - `TargetLanguage`（learner-core，`'ja'|'en'|'ko'`）与 infra `TrackLanguage` 同构，
 *   此处统一用包契约类型，infra 侧保持原样；
 * - 不含 raw 句柄（`getRawDb` 等留在实现类，M4 再收敛）。
 */
export interface LexiconRepository {
  searchLocalDictionary(
    language: TargetLanguage,
    query: string,
    limit?: number
  ): Promise<Result<LocalDictionaryEntry[], BusinessError>>;
  collectDictionaryEntry(
    userId: string,
    entryId: string
  ): Promise<Result<DictionaryEntryCollection, BusinessError>>;
  recordDictionarySearch(
    userId: string,
    language: TargetLanguage,
    query: string,
    hitCount: number,
    topEntryId?: string
  ): Promise<void>;
  getDictionarySearchHistory(
    userId: string,
    language: TargetLanguage,
    limit?: number
  ): Promise<Result<DictionarySearchRecord[], BusinessError>>;
  recordTermExposure(
    input: RecordTermExposureInput
  ): Promise<Result<EncounteredTerm, BusinessError>>;
  listEncounteredTerms(
    userId: string,
    language: string,
    limit?: number
  ): Promise<Result<EncounteredTerm[], BusinessError>>;
  backfillEncounteredTermsFromHistory(
    userId: string,
    language: string
  ): Promise<Result<{ terms: number; occurrences: number }, BusinessError>>;
  recordReadingExposures(
    input: RecordReadingExposuresInput
  ): Promise<Result<{ recorded: number; skipped: boolean }, BusinessError>>;
  getTermExamples(
    input: { language: string; headword: string; reading?: string; meanings: string[] },
    adapter?: AgentAdapter | undefined
  ): Promise<Result<TermExampleItem[], BusinessError>>;
  listWordlists(
    userId: string,
    language: string
  ): Promise<Result<WordlistGroup[], BusinessError>>;
  updateDictionarySourceConfig(
    sourceId: string,
    patch: { enabled?: boolean; priority?: number }
  ): Promise<Result<{ id: string; enabled: boolean; priority: number }, BusinessError>>;
  sampleLocalDictionaryEntries(
    language: TargetLanguage,
    limit?: number
  ): Promise<Result<LocalDictionaryEntry[], BusinessError>>;
}
