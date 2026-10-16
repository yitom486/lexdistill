import { eq } from 'drizzle-orm';
import { localDictionaryEntries, dictionaryTermMeta } from '@lexdistill/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import {
  resolveCardSource as resolveCardSourceUseCase,
  type ResolvableCard as ResolvableCardIn,
  type ResolvedCardSource as ResolvedCardSourceOut,
} from '@lexdistill/flashcards';

/**
 * M7-11 生词卡来源薄 adapter：业务映射已迁入 `@lexdistill/flashcards`，
 * 此处只做 Drizzle 查询及结构化映射，再调用包内用例。
 * 保留既有公开签名，`anki-push` 与 `apkg-export` 无需修改。
 */
export type { ResolvableCard, ResolvedCardSource } from '@lexdistill/flashcards';

export async function resolveCardSourceEntry(
  deps: RepoDeps,
  card: ResolvableCardIn
): Promise<ResolvedCardSourceOut> {
  return resolveCardSourceUseCase(
    {
      findEntryById: async (sourceEntryId) => {
        const entryRows = await deps.db
          .select()
          .from(localDictionaryEntries)
          .where(eq(localDictionaryEntries.id, sourceEntryId))
          .limit(1);
        const entry = entryRows[0];
        if (!entry) return undefined;
        return {
          headword: entry.headword,
          reading: entry.reading,
          romanization: entry.romanization,
          meaningsJson: entry.meaningsJson,
          partOfSpeech: entry.partOfSpeech,
          pronunciationJson: entry.pronunciationJson,
          sourceLabel: entry.sourceLabel,
        };
      },
      findFrequenciesByHeadword: async (headword) => {
        const metaRows = await deps.db
          .select({ freqValue: dictionaryTermMeta.freqValue })
          .from(dictionaryTermMeta)
          .where(eq(dictionaryTermMeta.term, headword))
          .limit(8);
        return metaRows
          .map((r) => r.freqValue)
          .filter((v): v is number => typeof v === 'number');
      },
    },
    card
  );
}
